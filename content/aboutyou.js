// Content script for About You (aboutyou.bg)
// React SPA. JSON-LD ProductGroup carries name/brand but no offer/price.
// Visible-DOM `[data-testid="finalPrice"]` is the canonical current price
// and `[data-testid="originalPrice"]` is the struck-through was-price.
// OOS via JSON-LD availability OR a disabled add-to-basket button.
(async function () {
  const settings = await chrome.storage.local.get(['enableAboutyou']);
  if (settings.enableAboutyou === false) return;

  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          const t = c && c['@type'];
          if (t === 'Product' || t === 'ProductGroup' || (Array.isArray(t) && (t.includes('Product') || t.includes('ProductGroup')))) return c;
        }
      } catch (_) { /* skip */ }
    }
    return null;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/aboutyou\.bg\/p\//i.test(url)) return false;
    return !!document.querySelector('[data-testid="finalPrice"], [data-testid="priceBox"]') || !!readProductJsonLd();
  }

  function readEur(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    // EUR comes first in the dual-price text, e.g. "63,99 € / 125,15 лв."
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)\s*€/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('[data-testid="finalPrice"], [data-testid="priceBox"]', 7000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const ld = readProductJsonLd();

      let title = '';
      if (ld && typeof ld.name === 'string') title = ld.name.replace(/&quot;/g, '"').trim();
      if (!title) {
        const og = document.querySelector('meta[property="og:title"]');
        if (og && og.content) title = og.content.trim();
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      let price = readEur('[data-testid="finalPrice"]');
      if (price == null) price = readEur('[data-testid="priceBox"]');

      // OOS: JSON-LD availability OR disabled basket button.
      let oos = false;
      if (ld && ld.offers) {
        const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
        oos = offers.some(o => /OutOfStock/i.test(o.availability || ''));
      }
      const basketBtn = document.querySelector('#addToBasketButton, [data-testid="addToBasketButton"]');
      if (basketBtn && (basketBtn.disabled || basketBtn.getAttribute('aria-disabled') === 'true')) {
        oos = true;
      }
      if (oos) price = null;

      const originalPrice = readEur('[data-testid="originalPrice"]');
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
        site: 'aboutyou',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] AboutYou extract error:', error);
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
    // Preferred anchor: AboutYou's product info area carries id #Productinfos
    // — full-width section under the hero.
    const productInfo = document.getElementById('Productinfos');
    if (productInfo && productInfo.parentNode) {
      productInfo.parentNode.insertBefore(widgetContainer, productInfo);
      inserted = true;
    }
    if (!inserted) {
      const root = document.querySelector('#react-root, main') || document.body;
      root.appendChild(widgetContainer);
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
  // React hydration delay before first extraction.
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (isProductPage()) setTimeout(trackAndDisplay, 1000);
})();
