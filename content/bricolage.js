// Content script for Mr.Bricolage (mr-bricolage.bg)
// Server-rendered. Has clean schema.org Product JSON-LD with EUR price.
// Visible DOM uses `.euro__price.product__price--new` (current) and
// `.euro__price.product__price--old` (struck-through was-price).
(async function () {
  const settings = await chrome.storage.local.get(['enableBricolage']);
  if (settings.enableBricolage === false) return;

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
    if (!/mr-bricolage\.bg\/.+\/p\/\d+/i.test(url)) return false;
    return !!readProductJsonLd() || !!document.querySelector('.product__price, .product__prices');
  }

  function readVisibleEur(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"], .product__price--new, .product__price-value', 5000).catch(() => { });
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
        // Visible-DOM EUR fallback. The price block has both EUR and BGN
        // inside `.product__prices-block`; use the `--euro` variant.
        price = readVisibleEur('.product__prices-block--euro .product__price--new, .product__prices-block--euro .product__price-value, .euro__price.product__price--new, .euro__price.product__price-value');
      }

      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      const originalPrice = readVisibleEur('.product__prices-block--euro .product__price--old, .euro__price.product__price--old');
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
        site: 'bricolage',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Mr.Bricolage extract error:', error);
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
    // Anchor: after the price block, before specs/description.
    const pricesBlock = document.querySelector('.product__prices, .product__prices-block');
    if (pricesBlock && pricesBlock.parentNode) {
      const wrap = pricesBlock.closest('.product__prices') || pricesBlock;
      wrap.parentNode.insertBefore(widgetContainer, wrap.nextSibling);
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
  if (isProductPage()) setTimeout(trackAndDisplay, 500);
})();
