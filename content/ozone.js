// Content script for Ozone.bg
// Uses ContentScriptBase for shared functionality
(async function () {
  // Check if extension is enabled for Ozone
  const settings = await chrome.storage.local.get(['enableOzone']);
  if (settings.enableOzone === false) {
    return;
  }

  // Check if this is a product page - Ozone specific detection
  function isProductPage() {
    const url = window.location.href;
    // Must have /product/ pattern (Ozone product URL pattern)
    const hasProductPath = /\/product\/[a-z0-9-]+/i.test(url);
    if (!hasProductPath) return false;

    // Verify by checking for product page elements (Ozone.bg specific selectors)
    const hasProductElements = !!(
      document.querySelector('#product_addtocart_form') ||
      document.querySelector('[id^="product-price-"]') ||
      document.querySelector('.product-essential') ||
      document.querySelector('.product-view') ||
      document.querySelector('.price-box')
    );
    return hasProductElements;
  }

  // Extract product data from Ozone page
  async function extractProductData() {
    try {
      // Wait for price element with Ozone-specific selectors
      await ProductParser.waitForElement('[id^="product-price-"], .price-box .price, .special-price', 5000).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Extract title - Ozone.bg specific selectors
      const titleSelectors = [
        '#product_addtocart_form .middle-info h1',
        '.product-name h1',
        '.product-essential h1',
        'h1.product-name',
        'h1[itemprop="name"]',
        '.product-view h1',
        'h1'
      ];

      let titleElement = null;
      for (const selector of titleSelectors) {
        titleElement = document.querySelector(selector);
        if (titleElement && titleElement.textContent.trim()) break;
      }
      const title = titleElement ? titleElement.textContent.trim() : '';

      // Extract current price - Ozone.bg specific selectors.
      //
      // Cascade order: ALL main-product-scoped selectors first (special →
      // prefix-id → regular → generic), THEN unscoped fallbacks last. This
      // is critical because Ozone pages typically render upsell products
      // below the buy area, and those upsells have their own `.special-price`
      // / `[id^="product-price-"]` / `.price-box` elements. An unscoped
      // selector reaching the upsell rail before the scoped main-product
      // selector would record the upsell's price, not the main product's.
      //
      // Bug history:
      //   - /product/ps5-reanimal/ recorded 30.00 EUR (an upsell's whole-unit
      //     id-based price) while the page showed 29.99 EUR until the prefix-id
      //     selector got scoped to .product-essential / #product_addtocart_form.
      //   - /product/xtrike-gm-515/ recorded 99.99 EUR (the FIRST upsell's
      //     special-price) while the main product was 11.24 EUR — until the
      //     unscoped `.price-box .special-price .price` got moved to the
      //     bottom of the cascade. Don't reintroduce unscoped selectors high
      //     in the priority list.
      const priceSelectors = [
        // Phase 1 — main-product-scoped (highest confidence)
        '.product-essential .price-box .special-price .price',
        '#product_addtocart_form .price-box .special-price .price',
        '.product-view-main .price-box .special-price .price',
        '#product_addtocart_form [id^="product-price-"]',
        '.product-essential [id^="product-price-"]',
        '.product-view-main [id^="product-price-"]',
        '.product-essential .price-box .regular-price .price',
        '.product-essential .price',
        // Phase 2 — unscoped last-resort fallbacks. Only fire when phase 1
        // fully misses, e.g. a future Ozone layout that drops the standard
        // scoping classes. Risky on pages with upsell rails — see comment.
        '.price-box .special-price .price',
        '.price-box .regular-price .price',
        '.price-box .price',
        '.special-price .price',
        '.regular-price .price'
      ];

      let priceElement = null;
      let priceText = '';
      let price = null;

      // Selectors at the bottom of the cascade are unscoped (`.price-box
      // .special-price .price`, etc.). On a normal Ozone layout the
      // scoped phase 1 selectors win and never reach phase 2 — but if the
      // page hits a transient state where the main-product wrapper class
      // is missing (A/B test, partial render, future redesign), an
      // unscoped selector's `querySelector` returns the FIRST match in
      // document order, which is the first upsell in the rail below
      // the main product. That's exactly how /product/xtrike-gm-515/
      // recorded a phantom 99.99 EUR price (the first upsell's
      // `.special-price .price` text "99,99 €") in May 2026 even after
      // the original scoping fix landed. Defence-in-depth: per selector,
      // walk querySelectorAll's matches and skip any element nested in
      // an upsell / related / cross-sell rail — guarantees we never
      // record an upsell price even when the scoped selectors miss.
      const UPSELL_BLOCK_SELECTOR = '.upsell-products, .upsell, .related-products, .crosssell, .cross-sell, [id*="upsell"]';

      for (const selector of priceSelectors) {
        const candidates = document.querySelectorAll(selector);
        for (const el of candidates) {
          if (el.closest(UPSELL_BLOCK_SELECTOR)) continue;
          const text = el.textContent.trim();
          const parsed = ProductParser.parsePrice(text);
          if (parsed && parsed > 0) {
            priceElement = el;
            priceText = text;
            price = parsed;
            break;
          }
        }
        if (price) break;
      }

      // Fallback: find price by pattern in main product area only
      if (!price || price === 0) {
        const mainProductContainer = document.querySelector('.product-essential, .product-view, #product_addtocart_form');
        const searchArea = mainProductContainer || document.body;

        const allPriceElements = searchArea.querySelectorAll('[id*="price"], [class*="price"]');

        for (const el of allPriceElements) {
          if (el.closest('.old-price') || el.classList.contains('old-price')) continue;
          if (el.closest('[id*="upsell"], .upsell, .recommended, .related-products')) continue;

          const text = el.textContent.trim();
          const parsed = ProductParser.parsePrice(text);

          if (parsed && parsed >= 1 && parsed <= 100000) {
            price = parsed;
            priceText = text;
            priceElement = el;
            break;
          }
        }
      }

      // Extract original price (if discounted) - Ozone.bg specific.
      //
      // CRITICAL: Ozone's `.old-price` wrapper carries a "ПЦД:" label
      // (Препоръчителна цена на дребно — manufacturer's recommended retail
      // price, i.e. RRP/MSRP). It is NOT a "previous selling price." Treating
      // it as `originalPrice` makes the FAKE_DISCOUNT detector fire on
      // products that never sold above the displayed price, comparing against
      // a manufacturer's claim rather than seller behaviour. Skip any old-price
      // wrapper that contains the ПЦД label; if Ozone ever ships a real
      // struck-through "was X" price (no ПЦД label), the loop will still
      // capture it.
      const oldPriceSelectors = [
        '.price-box .old-price .price',
        '.price-box .old-price',
        'p.old-price',
        '.old-price .price',
        '.was-price',
        '[data-old-price]'
      ];

      let originalPriceElement = null;
      let originalPriceText = '';
      for (const selector of oldPriceSelectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const wrapper = el.closest('.old-price') || el;
        // Skip RRP-labeled wrappers — that's not a previous selling price.
        if (/ПЦД/.test(wrapper.textContent)) continue;
        originalPriceElement = el;
        originalPriceText = el.textContent.trim();
        if (originalPriceText) break;
      }

      const originalPrice = ProductParser.parsePrice(originalPriceText);
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Out-of-stock guard — same Notino pattern. Ozone marks unavailable
      // products with a visible `<p class="availability out-of-stock">
      // Изчерпан</p>` and the JSON-LD shows `availability: "OutOfStock"`.
      // The DOM signal is the cheaper of the two to read. When OOS, set
      // price=null so ContentScriptBase.trackAndDisplay skips creating a
      // phantom datapoint at a price the user can't actually buy at —
      // recording it would understate min/max and break verdicts on
      // restock. Existing history is preserved (we just don't add today's
      // visit); the widget renders empty stats per the existing no-history
      // branch in trackAndDisplay.
      const oosEl = document.querySelector('p.availability.out-of-stock, .availability.out-of-stock');
      if (oosEl) {
        price = null;
      }

      // Extract thumbnail. Ozone runs on Magento and exposes the product
      // image inside `.gallery-main-images` / `.gallery-box` — the older
      // selectors below it never matched a real Ozone product page.
      const thumbnailSelectors = [
        '.gallery-main-images img',
        '.gallery-box img',
        '.product-image img',
        '.product-gallery img',
        '[data-image] img',
        '.product-photo img',
        'img[itemprop="image"]'
      ];

      let thumbnail = null;
      for (const selector of thumbnailSelectors) {
        const img = document.querySelector(selector);
        if (img && img.src) {
          thumbnail = img.src;
          break;
        }
      }
      // Final fallback: the <link rel="preload" as="image"> tag Ozone emits
      // for the first product image (present even when the gallery hasn't
      // hydrated yet).
      if (!thumbnail) {
        const preload = document.querySelector('link[rel="preload"][as="image"][href*="/catalog/product/"]');
        if (preload && preload.href) thumbnail = preload.href;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'ozone',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Error extracting product data:', error);
      return null;
    }
  }

  // Inject price graph widget - Ozone specific insertion
  async function injectWidget(product, analysis) {
    // Orphaned-script guard (see ContentScriptBase.isContextValid).
    if (!ContentScriptBase.isContextValid()) return;
    // Check if widget should be shown
    const settings = await chrome.storage.local.get(['showWidget']);
    if (settings.showWidget === false) {
      return;
    }

    // Check if widget already exists
    if (document.getElementById('fake-discount-widget')) {
      return;
    }

    // Create widget container using shared utility
    const widgetContainer = ContentScriptBase.createWidgetContainer();
    widgetContainer.style.minHeight = '100px';
    widgetContainer.style.padding = '0 15px';

    let inserted = false;

    // 1. PREFERRED on Ozone: insert right BEFORE the promotional / upsell
    //    banner so the widget sits just under the product info, not at the
    //    bottom of the page. The Insider personalization banner
    //    (#ins-container-product-1) is the highest of the promo blocks; if it's
    //    not present on a given product, fall back to the upsell row.
    const promoCandidates = [
      '#ins-container-product-1', // "ВИЖ ОЩЕ ... ПРЕДЛОЖЕНИЯ ЗА ТЕБ" banner
      '.upsell-products',         // "Най-популярни в същата категория"
      '.related-products',
      '.crosssell'
    ];
    for (const selector of promoCandidates) {
      const promo = document.querySelector(selector);
      if (promo && promo.parentNode) {
        promo.parentNode.insertBefore(widgetContainer, promo);
        inserted = true;
        break;
      }
    }

    // 2. Fallback: append inside the main product view container.
    if (!inserted) {
      const productViewMain = document.querySelector('.product-view-main');
      if (productViewMain) {
        productViewMain.appendChild(widgetContainer);
        inserted = true;
      }
    }

    if (!inserted) {
      const productForm = document.querySelector('#product_addtocart_form');
      if (productForm) {
        // Insert AFTER the form, never inside it (to avoid triggering add-to-cart)
        let insertParent = productForm.parentNode;
        // If parent is also a form or inside a form, walk up
        while (insertParent && insertParent.closest('form')) {
          insertParent = insertParent.parentNode;
        }
        if (insertParent) {
          insertParent.appendChild(widgetContainer);
          inserted = true;
        } else if (productForm.parentNode) {
          productForm.parentNode.insertBefore(widgetContainer, productForm.nextSibling);
          inserted = true;
        }
      }
    }

    if (!inserted) {
      const productViewWrapper = document.querySelector('.product-view-wrapper');
      if (productViewWrapper) {
        productViewWrapper.appendChild(widgetContainer);
        inserted = true;
      }
    }

    if (!inserted) {
      document.body.appendChild(widgetContainer);
    }

    // Load widget using shared utilities
    ContentScriptBase.loadWidgetCSS();
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  // Track and display using shared flow
  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage);
  }

  // Always set up SPA navigation listener — register before any early return
  // so users who land on a non-product page first still get the widget when
  // they navigate to a product.
  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay);

  // Wait for page to load
  await new Promise(resolve => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve);
    }
  });

  // Additional wait for Ozone's dynamic content (SPA)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // If the initial page is already a product page, kick off tracking.
  if (isProductPage()) {
    setTimeout(trackAndDisplay, 1500);
  }
})();
