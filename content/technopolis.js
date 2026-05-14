// Content script for Technopolis.bg
// Uses ContentScriptBase for shared functionality.
//
// Technopolis is an Angular SPA. Product pages expose a clean schema.org
// Product JSON-LD block which is by far the most reliable source for the
// title, image, sku, and price. The visible DOM uses Angular component
// scoping (_ngcontent-* attributes) which would make selectors brittle, so
// we lean on JSON-LD first and only fall back to `.price-value` text when
// the JSON-LD isn't yet hydrated. Note: unlike Notino, Technopolis's
// JSON-LD `offers.price` IS the visible displayed price (no promo-code
// inflation), so we can trust it directly.
(async function () {
  const settings = await chrome.storage.local.get(['enableTechnopolis']);
  if (settings.enableTechnopolis === false) {
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

  // Product URLs always end in /p/<digits>; categories use /c/<id> instead,
  // so requiring `/p/` makes this a reliable product-only signature. We
  // also confirm with the JSON-LD probe so a half-loaded SPA doesn't trigger.
  function isProductPage() {
    const url = window.location.href;
    if (!/\/p\/\d+(?:[/?#]|$)/i.test(url)) return false;
    return !!readProductJsonLd();
  }

  // Visible-DOM price fallback — first .price-value inside .product-pdp__prices,
  // which holds the EUR amount. The sibling .price-value (after a "/" sep)
  // holds the BGN amount; we want the first one.
  function readVisiblePrice() {
    const container = document.querySelector('.product-pdp__prices, .product-pdp__prices__mobile');
    if (!container) return null;
    const span = container.querySelector('.price-value');
    if (!span) return null;
    return ProductParser.parsePrice(span.textContent);
  }

  // Visible old-price (struck through). Only present on items currently
  // on sale; absent for full-price products. Same EUR/BGN dual layout.
  function readVisibleOldPrice() {
    const oldEl = document.querySelector('.product-pdp__prices .old-price .price-value, .product-pdp .old-price .price-value, .pdp-details .old-price .price-value');
    if (!oldEl) return null;
    return ProductParser.parsePrice(oldEl.textContent);
  }

  async function extractProductData() {
    try {
      // Wait for either the JSON-LD or the visible price to appear.
      await ProductParser.waitForElement(
        'script[type="application/ld+json"], .product-pdp__prices .price-value',
        7000
      ).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const productLd = readProductJsonLd();

      // Title: JSON-LD `name` with brand prepended for context, fall back
      // to the page <h1>. The brand-prepend mirrors Notino's behaviour and
      // avoids accidentally double-printing the brand if the name already
      // contains it.
      let title = '';
      if (productLd && typeof productLd.name === 'string') {
        const brand = productLd.brand && productLd.brand.name ? productLd.brand.name : '';
        const rawName = productLd.name.replace(/&quot;/g, '"').trim();
        if (brand && !rawName.toLowerCase().includes(brand.toLowerCase())) {
          title = `${brand} ${rawName}`;
        } else {
          title = rawName;
        }
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      // Current price: trust JSON-LD when present (it equals the visible
      // displayed price on Technopolis). Fall back to the DOM scan otherwise.
      let price = null;
      if (productLd && productLd.offers) {
        const offer = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }
      if (price == null) price = readVisiblePrice();

      // OOS guard #1 — JSON-LD availability check. Catches the case where
      // the product is fully out of stock (no online + no stores). Recording
      // a price the user can't buy at would pollute the history.
      if (productLd && productLd.offers) {
        const offer = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
        const availability = (offer && offer.availability) || '';
        if (/OutOfStock/i.test(availability)) {
          price = null;
        }
      }

      // OOS guard #2 — DOM check for "online OOS but available in stores".
      // Technopolis distinguishes these two states: when a product is sold
      // out for online delivery but still in stock at physical locations,
      // JSON-LD reports `availability: "InStock"` (because it IS stocked
      // somewhere), but the visible DOM shows a `<span class="status
      // not-available">Продуктът е изчерпан онлайн. Провери наличност по
      // магазини.</span>` banner. From the extension's perspective the user
      // still can't online-purchase at the displayed price, so treat this
      // the same as OOS.
      if (document.querySelector('.status.not-available')) {
        price = null;
      }

      // Original price — only present when an item is on sale. Read from the
      // visible DOM (.old-price .price-value); JSON-LD doesn't expose it.
      const originalPrice = readVisibleOldPrice();
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Thumbnail: JSON-LD `image` (string or array), fallback to the first
      // <img> inside the product preview area.
      let thumbnail = null;
      if (productLd && productLd.image) {
        thumbnail = Array.isArray(productLd.image) ? productLd.image[0] : productLd.image;
      }
      if (!thumbnail) {
        const img = document.querySelector('.product-pdp__preview img, cx-media img');
        if (img && img.src) thumbnail = img.src;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'technopolis',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Technopolis extract error:', error);
      return null;
    }
  }

  async function injectWidget(product, analysis) {
    if (!ContentScriptBase.isContextValid()) return;
    const s = await chrome.storage.local.get(['showWidget']);
    if (s.showWidget === false) return;
    if (document.getElementById('fake-discount-widget')) return;

    const widgetContainer = ContentScriptBase.createWidgetContainer();
    widgetContainer.style.minHeight = '100px';
    widgetContainer.style.padding = '0 15px';

    let inserted = false;

    // Preferred anchor: the spec/description tabs section (.tabs-table) sits
    // right after the buy block, so inserting before it puts the widget in
    // a consistent spot under the price/availability area.
    const tabsTable = document.querySelector('.tabs-table');
    if (tabsTable && tabsTable.parentNode) {
      tabsTable.parentNode.insertBefore(widgetContainer, tabsTable);
      inserted = true;
    }

    // Fallback: append after .pdp-details (the price + buy block).
    if (!inserted) {
      const details = document.querySelector('.pdp-details');
      if (details && details.parentNode) {
        details.parentNode.insertBefore(widgetContainer, details.nextSibling);
        inserted = true;
      }
    }

    // Fallback: append inside .product-pdp (whole right column).
    if (!inserted) {
      const productPdp = document.querySelector('.product-pdp');
      if (productPdp) {
        productPdp.appendChild(widgetContainer);
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

  // Angular hydrates a lot after `load`; give the JSON-LD and price block
  // a moment to appear before the first extraction attempt.
  await new Promise(resolve => setTimeout(resolve, 1200));

  if (isProductPage()) {
    setTimeout(trackAndDisplay, 1500);
  }
})();
