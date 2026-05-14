// Content script for Obuvki.bg (eobuwie.cloud-hosted images)
// Nuxt SSR storefront. Reliable schema.org Product/ProductGroup JSON-LD;
// EAN-13 is the trailing 13-digit number in the URL slug AND `sku` in
// JSON-LD. Visible price uses `.product-price-new` for current and
// `.price-wrapper.discount` for sales.
(async function () {
  const settings = await chrome.storage.local.get(['enableObuvki']);
  if (settings.enableObuvki === false) return;

  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && (c['@type'] === 'Product' || c['@type'] === 'ProductGroup')) return c;
        }
      } catch (_) { /* skip */ }
    }
    return null;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/obuvki\.bg\/p\//i.test(url)) return false;
    return !!readProductJsonLd() || !!document.querySelector('.product-price-new, .price-wrapper');
  }

  function readVisibleEur(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"], .product-price-new, .price-wrapper', 5000).catch(() => { });
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

      // Price — JSON-LD ProductGroup may not carry an offer; visible
      // `.product-price-new` is more reliable on this site.
      let price = null;
      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }
      if (price == null) {
        price = readVisibleEur('.product-price-new, .price-wrapper.discount .price, .price-wrapper .price');
      }

      // OOS via JSON-LD or visible markers.
      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      // Old/struck price — Obuvki does NOT expose a real previous selling
      // price. The `.omnibus` block contains two regulatory references:
      // (1) "Редовна цена" (regular/list-price RRP, like Ozone's ПЦД) and
      // (2) "Най-ниската цена в периода от 30 дни преди намалението"
      // (the EU Omnibus Directive 30-day low). Both can be inflated by
      // the seller and don't represent what the user actually paid
      // previously. Leave `originalPrice = null` and let history-based
      // fake-discount detection do the work.
      const originalPrice = null;
      const discount = null;

      let thumbnail = null;
      if (ld && ld.image) thumbnail = Array.isArray(ld.image) ? ld.image[0] : ld.image;
      if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) thumbnail = og.content;
      }

      // EAN — Obuvki URLs end in the EAN-13. Fast path: parse it from
      // the URL slug; verify with the GTIN check digit. Fall back to
      // generic extractor.
      let ean = null;
      const eanFromUrl = url.match(/-(\d{13})(?:[/?#]|$)/);
      if (eanFromUrl && ProductParser.validateGTIN(eanFromUrl[1])) {
        ean = eanFromUrl[1];
      }
      if (!ean) ean = ProductParser.extractEAN(document);

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'obuvki',
        thumbnail: thumbnail,
        ean: ean
      };
    } catch (error) {
      console.error('[Fake Discount] Obuvki extract error:', error);
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
    // Anchor: before the description / size guide / specs section.
    const tabs = document.querySelector('.product-description, .product-tabs, [class*="ProductDescription"]');
    if (tabs && tabs.parentNode) {
      tabs.parentNode.insertBefore(widgetContainer, tabs);
      inserted = true;
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

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay);
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  if (isProductPage()) setTimeout(trackAndDisplay, 800);
})();
