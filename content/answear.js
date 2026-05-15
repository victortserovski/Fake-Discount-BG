// Content script for Answear.bg
// React SPA. JSON-LD is sparse and unreliable; CSS modules use hashed
// class names (Webpack/Parcel) that change between builds. Fallback
// strategy: scan within the product detail container for the first
// element whose textContent contains an EUR amount, ignoring elements
// that look like the original/struck-through price (which has classes
// containing "regular" or "minimal").
(async function () {
  const settings = await chrome.storage.local.get(['enableAnswear']);
  if (settings.enableAnswear === false) return;

  function isProductPage() {
    const url = window.location.href;
    if (!/answear\.bg\/p\//i.test(url)) return false;
    return !!document.querySelector('h1, [class*="ProductCardStylesProvider"], [data-test*="price"]');
  }

  function parseEurFromText(txt) {
    if (!txt) return null;
    // Bulgarian dual-price text — EUR is the smaller secondary one,
    // shown after a slash, e.g. "164,99 zł / 84,33 €". Pull the EUR
    // amount directly.
    const m = txt.match(/(\d[\d\s., ]*)\s*€/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      // Wait for the product card to mount.
      await ProductParser.waitForElement('h1, [class*="ProductCardStylesProvider"]', 7000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Title — H1 (Answear puts the product name there).
      const h1 = document.querySelector('h1');
      const title = h1 ? h1.textContent.trim() : '';

      // Current EUR price — must be scoped to the MAIN product card,
      // not a related-products carousel below it. Answear reuses the
      // same `ProductCardStylesProvider` class on every product card on
      // the page, so an unscoped query can return the FIRST price in
      // document order — which is sometimes a related/recommended
      // product, not the one the user opened. Walk up from H1 to find
      // the nearest container that wraps the main product details, and
      // only query within it.
      let mainCard = document;
      if (h1) {
        mainCard = h1.closest('[class*="ProductDetailLayout"], [class*="ProductDetailsLayout"], [class*="ProductDetail"], [class*="ProductPage"], main')
          || h1.parentElement
          || document;
      }

      let price = null;
      // 1. Prefer SALE price (discounted current price) — when present
      //    on a sale product, this is the buyable price.
      const saleEl = mainCard.querySelector('[data-test*="priceSale"], [class*="priceSaleMinimal"], [class*="priceSale"]:not([class*="priceRegular"])');
      if (saleEl) {
        const p = parseEurFromText(saleEl.textContent);
        if (p && p > 0) price = p;
      }
      // 2. Fall back to the "actual" / single-price element for full-
      //    price products.
      if (price == null) {
        const actualEl = mainCard.querySelector('[data-test*="priceActual"], [class*="priceActualLabel"]');
        if (actualEl) {
          const p = parseEurFromText(actualEl.textContent);
          if (p && p > 0) price = p;
        }
      }
      // 3. Last resort: scan EUR amounts within the main card only —
      //    NEVER the whole document (that's how a 11.75 EUR product
      //    once recorded a 64.99 EUR spike from a related-product card).
      if (price == null && mainCard !== document) {
        price = parseEurFromText(mainCard.textContent);
      }

      // OOS — Answear uses a custom enum "OUT_OF_STOCK"; visible button
      // becomes disabled. We check both signals where they're visible.
      const allText = (document.body && document.body.textContent) || '';
      if (/OUT_OF_STOCK/.test(allText) || document.querySelector('[data-test*="addToBasket"][disabled], [data-test*="addToCart"][disabled]')) {
        price = null;
      }

      // Was-price (when discounted) — scoped to main card for the same
      // reason as above.
      let originalPrice = null;
      const oldEl = mainCard.querySelector('[class*="priceRegularMinimal"], [class*="priceRegular"], [data-test*="priceRegular"]');
      if (oldEl) {
        const p = parseEurFromText(oldEl.textContent);
        if (p && p > 0 && (price == null || p > price)) originalPrice = p;
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      let thumbnail = null;
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) thumbnail = og.content;

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'answear',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Answear extract error:', error);
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
    // Anchor: before the description tabs section if available.
    const tabs = document.querySelector('#tab-product-description-tabs_0, [class*="ProductDescription"], [class*="DescriptionTabs"]');
    if (tabs && tabs.parentNode) {
      tabs.parentNode.insertBefore(widgetContainer, tabs);
      inserted = true;
    }
    if (!inserted) {
      const main = document.querySelector('#main-container, main, #root') || document.body;
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
  // React + scoped CSS Module hydration is slow on Answear.
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (isProductPage()) setTimeout(trackAndDisplay, 1000);
})();
