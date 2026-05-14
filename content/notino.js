// Content script for Notino.bg
// Uses ContentScriptBase for shared functionality.
//
// Notino is a Next.js SPA. The page exposes clean schema.org Product JSON-LD,
// which is the most reliable source for the product name, brand, image and
// SKU. The displayed price, however, is read directly from the visible DOM
// (`[data-testid="pd-dual-price"]`) — Notino's JSON-LD frequently contains
// the *promo-code-applied* price (e.g. with the "COMBI" code), not what a
// regular visitor without the code actually pays. Tracking that would
// understate prices and produce false REAL_DEAL verdicts.
(async function () {
  const settings = await chrome.storage.local.get(['enableNotino']);
  if (settings.enableNotino === false) {
    return;
  }

  // Read and parse all Product-typed JSON-LD blocks on the page.
  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && c['@type'] === 'Product') return c;
        }
      } catch (_) { /* malformed JSON-LD — skip */ }
    }
    return null;
  }

  // A product page on Notino has the URL pattern /<brand>/<slug>/ (with an
  // optional /p-<variantId>/ suffix for a specific variant) AND a Product
  // JSON-LD block. Category/listing pages don't have the JSON-LD so the
  // second check rules them out reliably.
  function isProductPage() {
    const url = window.location.href;
    if (!/notino\.bg\//i.test(url)) return false;

    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const segments = path.split('/').filter(Boolean);
    // Need at least <brand>/<slug>; /p-XX/ counts as a third segment.
    if (segments.length < 2) return false;

    return !!readProductJsonLd();
  }

  // Pull the first EUR amount out of a text blob like "22,10 € / 43,22 лв.".
  // Notino interleaves comments (<!-- -->) inside the price markup, so we
  // operate on `textContent` which strips them.
  function parseEurFromText(text) {
    if (!text) return null;
    const match = text.match(/(\d[\d\s., ]*)\s*€/);
    if (!match) return null;
    return ProductParser.parsePrice(match[1]);
  }

  async function extractProductData() {
    try {
      // Wait for the price block (Notino hydrates client-side).
      await ProductParser.waitForElement(
        '[data-testid="pd-dual-price"], [data-testid="pd-price-wrapper"]',
        7000
      ).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const productLd = readProductJsonLd();

      // Title: prefer JSON-LD (clean, language-correct), fall back to <h1>.
      let title = '';
      if (productLd && typeof productLd.name === 'string') {
        const brand = productLd.brand && productLd.brand.name ? productLd.brand.name : '';
        title = brand ? `${brand} ${productLd.name}`.replace(`${brand} ${brand} `, `${brand} `) : productLd.name;
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      // Current price: visible DOM is the source of truth (see file header).
      let price = null;
      const dualPriceEl = document.querySelector('[data-testid="pd-dual-price"]');
      if (dualPriceEl) {
        price = parseEurFromText(dualPriceEl.textContent);
      }
      if (price == null) {
        const wrapperEl = document.querySelector('[data-testid="pd-price-wrapper"]');
        if (wrapperEl) price = parseEurFromText(wrapperEl.textContent);
      }
      // Last-resort fallback: pick the highest EUR-priced offer in JSON-LD
      // matching the current URL. We pick the highest because JSON-LD often
      // reflects the promo-code price; the highest-of-set is closest to the
      // regular displayed price for the selected variant.
      if (price == null && productLd && Array.isArray(productLd.offers)) {
        const eurOffers = productLd.offers.filter(o => (o.priceCurrency || '').toUpperCase() === 'EUR');
        if (eurOffers.length > 0) {
          const here = window.location.pathname;
          const matching = eurOffers.filter(o => typeof o.url === 'string' && here.includes(o.url));
          const pool = matching.length > 0 ? matching : eurOffers;
          const numeric = pool
            .map(o => parseFloat(o.price))
            .filter(p => Number.isFinite(p) && p > 0);
          if (numeric.length > 0) price = Math.max(...numeric);
        }
      }

      // Skip recording for out-of-stock variants. Notino's JSON-LD keeps a
      // stale `price` on OutOfStock offers (the last-known list price), and
      // for OOS variants the visible price block is also hidden — so without
      // this guard we'd record a phantom data point that the user can't
      // actually buy at, polluting both the local history and any future
      // cloud sync. Returning price=null lets ContentScriptBase.trackAndDisplay
      // render the widget with existing history without saving a new entry.
      if (productLd && Array.isArray(productLd.offers)) {
        const here = window.location.pathname;
        const matched = productLd.offers.find(o => typeof o.url === 'string' && here.includes(o.url));
        const availability = matched
          ? (matched.availability || '')
          : (productLd.offers[0] && productLd.offers[0].availability) || '';
        if (/OutOfStock/i.test(availability)) {
          price = null;
        }
      }

      // Original price: Notino does not consistently expose a struck-through
      // "was" price for its products (the EU-mandated "lowest 30-day" line is
      // separate informational text, not a seller-claimed original). Leaving
      // this null lets the historical-comparison branch of the detector do
      // the work, which is fine — it's the same path that handles Emag/Ozone
      // products without an explicit old price.
      const originalPrice = null;
      const discount = null;

      // Thumbnail: JSON-LD `image` is reliable.
      let thumbnail = null;
      if (productLd && productLd.image) {
        thumbnail = Array.isArray(productLd.image) ? productLd.image[0] : productLd.image;
      }
      if (!thumbnail) {
        const img = document.querySelector('main img, picture img');
        if (img && img.src) thumbnail = img.src;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'notino',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Error extracting product data:', error);
      return null;
    }
  }

  async function injectWidget(product, analysis) {
    // Orphaned-script guard (see ContentScriptBase.isContextValid).
    if (!ContentScriptBase.isContextValid()) return;
    const settings = await chrome.storage.local.get(['showWidget']);
    if (settings.showWidget === false) return;

    if (document.getElementById('fake-discount-widget')) return;

    const widgetContainer = ContentScriptBase.createWidgetContainer();
    widgetContainer.style.minHeight = '100px';
    widgetContainer.style.padding = '0 15px';

    let inserted = false;

    // Preferred anchor: the description/composition tab strip
    // (`[data-testid="tablist"]`). It always exists on a Notino product page
    // and always sits *after* the right-column product info block, so
    // inserting before it puts the widget in a consistent spot under the
    // price/buy area regardless of which variant is selected. (An earlier
    // attempt to walk up N parents from the price wrapper landed at
    // different depths between variants and produced inconsistent results.)
    const tablist = document.querySelector('[data-testid="tablist"]');
    if (tablist && tablist.parentNode) {
      tablist.parentNode.insertBefore(widgetContainer, tablist);
      inserted = true;
    }

    // Fallback: above the description block.
    if (!inserted) {
      const desc = document.querySelector('[data-testid="pd-description-wrapper"]');
      if (desc && desc.parentNode) {
        desc.parentNode.insertBefore(widgetContainer, desc);
        inserted = true;
      }
    }

    if (!inserted) {
      const main = document.querySelector('main') || document.body;
      main.appendChild(widgetContainer);
    }

    ContentScriptBase.loadWidgetCSS();
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage);
  }

  // Register the SPA-navigation listener before any early return so the
  // widget appears even when the user lands on a non-product page first.
  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay);

  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });

  // Notino hydrates a lot after `load`; give the JSON-LD and price block a
  // moment to appear before the first extraction attempt.
  await new Promise(resolve => setTimeout(resolve, 1200));

  if (isProductPage()) {
    setTimeout(trackAndDisplay, 1500);
  }
})();
