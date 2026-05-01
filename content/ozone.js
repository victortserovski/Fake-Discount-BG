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

      // Extract current price - Ozone.bg specific selectors
      const priceSelectors = [
        '[id^="product-price-"]',
        '.price-box .special-price .price',
        '.price-box .regular-price .price',
        '.price-box .price',
        '.product-essential .price',
        '.special-price .price',
        '.regular-price .price'
      ];

      let priceElement = null;
      let priceText = '';
      let price = null;

      for (const selector of priceSelectors) {
        priceElement = document.querySelector(selector);
        if (priceElement) {
          priceText = priceElement.textContent.trim();
          price = ProductParser.parsePrice(priceText);
          if (price && price > 0) break;
          priceElement = null;
        }
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

      // Extract original price (if discounted) - Ozone.bg specific
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
        originalPriceElement = document.querySelector(selector);
        if (originalPriceElement) {
          originalPriceText = originalPriceElement.textContent.trim();
          if (originalPriceText) break;
        }
      }

      const originalPrice = ProductParser.parsePrice(originalPriceText);
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Extract thumbnail
      const thumbnailSelectors = [
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

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'ozone',
        thumbnail: thumbnail
      };
    } catch (error) {
      console.error('[Fake Discount] Error extracting product data:', error);
      return null;
    }
  }

  // Inject price graph widget - Ozone specific insertion
  async function injectWidget(product, analysis) {
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
