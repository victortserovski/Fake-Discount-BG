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

  function findProductPriceRoot() {
    return document.querySelector('[data-testid="productCardDetails"]')
      || document.querySelector('[data-test-id="productCardDetails"]')
      || (document.querySelector('[data-testid="priceBox"]') && document.querySelector('[data-testid="priceBox"]').closest('[data-testid="productCardDetails"], [class*="ProductDetail"]'))
      || (document.querySelector('h1') && document.querySelector('h1').closest('[class*="ProductDetail"], main'))
      || document;
  }

  function readEur(selector, root) {
    const scope = root || document;
    const el = scope.querySelector(selector);
    if (!el) return null;
    // EUR comes first in the dual-price text, e.g. "63,99 € / 125,15 лв."
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)\s*€/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  function offerPathname(offerUrl) {
    if (!offerUrl) return '';
    try {
      return new URL(offerUrl, window.location.origin).pathname.replace(/\/+$/, '');
    } catch (_) {
      return '';
    }
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

      const priceRoot = findProductPriceRoot();
      let price = readEur('[data-testid="finalPrice"]', priceRoot);
      if (price == null) price = readEur('[data-testid="priceBox"]', priceRoot);

      // OOS: URL-matched offer availability OR disabled basket button.
      // Do NOT use offers.some(OutOfStock) — other size variants can be
      // OOS while the active variant is in stock.
      let oos = false;
      if (ld && ld.offers) {
        const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
        const here = window.location.pathname.replace(/\/+$/, '');
        const matched = offers.find(o => offerPathname(o.url) === here);
        if (matched && /OutOfStock/i.test(matched.availability || '')) oos = true;
      }
      const basketBtn = document.querySelector('#addToBasketButton, [data-testid="addToBasketButton"]');
      if (basketBtn && (basketBtn.disabled || basketBtn.getAttribute('aria-disabled') === 'true')) {
        oos = true;
      }
      // Fully sold-out pages keep showing a price but drop the basket
      // button (and JSON-LD) and offer a back-in-stock reminder instead:
      // "За съжаление разпродадено".
      if (!basketBtn && (document.querySelector('[data-testid="sizeReminderNotifyButton"]')
        || /За съжаление разпродадено/i.test(document.body.textContent || ''))) {
        oos = true;
      }
      if (oos) price = null;

      const originalPrice = readEur('[data-testid="originalPrice"]', priceRoot);
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
    // About You is a React SPA. The product page renders far more
    // sections below the hero (details accordion, recommendations,
    // similar items, recently viewed, newsletter, footer) — anchoring
    // at the wrong one buried the widget below the newsletter.
    //
    // The most reliable hooks are the data-test-id / data-testid /
    // hashed class names that survive between builds. Try several
    // variants and a few common positional fallbacks.
    const anchors = [
      // Highest-priority: section right under the hero (details
      // accordion / care info / sizing)
      '[data-test-id="productDetailAccordion"]',
      '[data-test-id="ProductDetailAccordion"]',
      '[data-testid="productDetailAccordion"]',
      '[data-test-id*="productDetail"]',
      '[data-testid*="productDetail"]',
      '[data-test-id*="ProductDetail"]',
      '[data-testid*="ProductDetail"]',
      '[class*="ProductDetailsAccordion"]',
      '[class*="ProductInformationAccordion"]',
      '[class*="ProductDescription"]',
      '[class*="ProductDetails__"]',
      // Mid-priority: recommendations / similar / related
      '[data-testid*="similar"]',
      '[data-testid*="recommended"]',
      '[data-testid*="related"]',
      '[class*="SimilarProducts"]',
      '[class*="RecommendedProducts"]',
      '[class*="RelatedProducts"]',
      // Lowest: previous default
      '#Productinfos'
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
      // No anchor found — try inserting AFTER the H1 instead of dumping
      // into the React root (which lands at the very bottom of the body).
      const h1 = document.querySelector('h1');
      const card = h1 && h1.closest('[class*="ProductDetail"], main, section');
      if (card && card.parentNode) {
        card.parentNode.insertBefore(widgetContainer, card.nextSibling);
        inserted = true;
      }
    }
    if (!inserted) {
      const root = document.querySelector('#react-root, main') || document.body;
      root.appendChild(widgetContainer);
    }
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableAboutyou' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // React hydration delay before first extraction.
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (isProductPage()) setTimeout(trackAndDisplay, 1000);
})();
