// Content script for Praktiker.bg
// Angular SPA. Reliable schema.org Product JSON-LD with EUR price.
// Note: even on confirmed-OOS samples Praktiker's JSON-LD reports
// `availability: InStock` while the visible UI swaps the buy button
// for a "Провери наличност" (check availability in stores) link.
// We treat that visible signal as the authoritative OOS check.
//
// EAN often appears in the description text (free-form barcode mention)
// — the generic `ProductParser.extractEAN(document)` visible-text scan
// catches it.
(async function () {
  const settings = await chrome.storage.local.get(['enablePraktiker']);
  if (settings.enablePraktiker === false) return;

  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && c['@type'] === 'Product') return c;
        }
      } catch (_) { /* skip */ }
    }
    return null;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/praktiker\.bg\/.+\/p\/\d+/i.test(url)) return false;
    return !!readProductJsonLd();
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"]', 7000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const ld = readProductJsonLd();

      let title = '';
      if (ld && typeof ld.name === 'string') {
        const brand = ld.brand && (typeof ld.brand === 'string' ? ld.brand : ld.brand.name) || '';
        const rawName = ld.name.replace(/&quot;/g, '"').trim();
        title = brand && !rawName.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${rawName}` : rawName;
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      let price = null;
      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }

      // OOS guard #1 — JSON-LD availability (catches the rare case where
      // Praktiker actually marks the product OutOfStock in JSON-LD).
      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }
      // OOS guard #2 — `.pdp__status` text. The Angular template renders
      //   In stock  : <span class="pdp__status"> В наличност </span>
      //   Online OOS: <span class="pdp__status"> Продуктът е изчерпан онлайн… </span>
      // Don't use the generic "Провери наличност" button as a signal —
      // that button is present on EVERY product page as a check-in-stores
      // CTA, so testing for it marked all products as OOS.
      if (price != null) {
        const status = document.querySelector('.pdp__status');
        if (status && /изчерпан|out\s*of\s*stock/i.test(status.textContent || '')) {
          price = null;
        }
      }

      const discount = null; // Praktiker doesn't expose a struck-through prior price reliably.
      const originalPrice = null;

      let thumbnail = null;
      if (ld && ld.image) thumbnail = Array.isArray(ld.image) ? ld.image[0] : ld.image;
      if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) thumbnail = og.content;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'praktiker',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Praktiker extract error:', error);
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
    // Anchor: before the spec/description tabs section if present.
    const tabs = document.querySelector('.tabs__panel, .tabs-nav, [class*="tabs__panel"]');
    if (tabs && tabs.parentNode) {
      tabs.parentNode.insertBefore(widgetContainer, tabs);
      inserted = true;
    }
    if (!inserted) {
      const main = document.querySelector('main, app-root') || document.body;
      main.appendChild(widgetContainer);
    }
    ContentScriptBase.loadWidgetCSS();
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage);
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay);
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // Angular hydration delay before first extraction.
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (isProductPage()) setTimeout(trackAndDisplay, 1000);
})();
