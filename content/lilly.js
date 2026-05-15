// Content script for Lilly Drogerie (lillydrogerie.bg)
// Magento storefront, server-rendered. Reliable schema.org Product
// JSON-LD with EUR price + availability.
(async function () {
  const settings = await chrome.storage.local.get(['enableLilly']);
  if (settings.enableLilly === false) return;

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
    // Lilly product pages are at the root, not under /p/. The JSON-LD
    // probe is the cleanest signal — only product pages emit it.
    return /lillydrogerie\.bg\//i.test(url) && !!readProductJsonLd();
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"]', 5000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const ld = readProductJsonLd();

      let title = '';
      if (ld && typeof ld.name === 'string') title = ld.name.replace(/&quot;/g, '"').trim();
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
      if (price == null) {
        // Visible-DOM fallback. Lilly uses Magento `.price-box` markup
        // with `.final-price` for current and `.old-price` for the
        // crossed-out previous price. Both contain BGN+EUR; we want EUR.
        const el = document.querySelector('.price-box.price-final_price .final-price .price.euro, .final-price .price.euro, .price.euro');
        if (el) {
          const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
          if (m) price = ProductParser.parsePrice(m[1]);
        }
      }

      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      let originalPrice = null;
      const oldEl = document.querySelector('.old-price .price.euro, .old-price .price');
      if (oldEl) {
        const m = (oldEl.textContent || '').match(/(\d[\d\s., ]*)/);
        if (m) originalPrice = ProductParser.parsePrice(m[1]);
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

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
        site: 'lilly',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Lilly extract error:', error);
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
    // Anchor BEFORE the related/recommended-products rails (which sit
    // far below the product info on the live page — anchoring there
    // pushed the widget near the page footer). Try the
    // related/recommended slots first, then the product description,
    // then standard Magento tab containers.
    const anchors = [
      '.related-products-field',
      '.stenik-recommended-products',
      '.description',
      '.product.info.detailed',
      '.product-info-tabs',
      '.additional-attributes-wrapper'
    ];
    for (const sel of anchors) {
      const el = document.querySelector(sel);
      if (el && el.parentNode) {
        el.parentNode.insertBefore(widgetContainer, el);
        inserted = true;
        break;
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

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay);
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  if (isProductPage()) setTimeout(trackAndDisplay, 500);
})();
