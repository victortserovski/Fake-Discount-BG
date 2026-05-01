// Content script for Emag.bg
// Uses ContentScriptBase for shared functionality
(async function () {
  // Check if extension is enabled for Emag
  const settings = await chrome.storage.local.get(['enableEmag']);
  if (settings.enableEmag === false) {
    return;
  }

  // Check if this is a product page - Emag specific detection
  function isProductPage() {
    const url = window.location.href;
    // Must have /p/ or /pd/ pattern (Emag product URL patterns)
    const hasProductPath = /\/p\/[A-Z0-9]+/i.test(url) || /\/pd\/[A-Z0-9]+/i.test(url);
    if (!hasProductPath) return false;

    // Verify by checking for product page elements
    const hasProductElements = !!(
      document.querySelector('.product-page-pricing') ||
      document.querySelector('.product-new-price') ||
      document.querySelector('[data-product-id]') ||
      document.querySelector('.product-page')
    );
    return hasProductElements;
  }

  // Extract product data from Emag page
  async function extractProductData() {
    try {
      // Wait for a price element to appear in the DOM (Emag can load prices dynamically)
      const priceSelectors = [
        '.product-new-price',
        '[data-price]',
        '.product-page-pricing .product-new-price',
        '.product-highlight .product-new-price',
        '.main-product-form .product-new-price',
        '[data-dynamic="product-price"]',
        '.price-container .product-new-price',
        '.product-page-pricing-container .product-new-price'
      ];

      await ProductParser.waitForElement(priceSelectors.join(', '), 5000).catch(() => {});

      let priceElement = null;
      for (const selector of priceSelectors) {
        priceElement = document.querySelector(selector);
        if (priceElement) break;
      }

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Extract title
      const titleSelectors = [
        'h1.page-title',
        '.product-page-title',
        'h1.product-title',
        'h1[itemprop="name"]',
        '.product-title h1',
        'h1'
      ];

      let titleElement = null;
      for (const selector of titleSelectors) {
        titleElement = document.querySelector(selector);
        if (titleElement) break;
      }
      const title = titleElement ? titleElement.textContent.trim() : '';

      // Extract current price
      let priceText = '';
      if (priceElement) {
        // Some Emag elements store price in data-price attribute
        if (priceElement.hasAttribute('data-price')) {
          priceText = priceElement.getAttribute('data-price');
        } else {
          priceText = priceElement.textContent;
        }
      }
      const price = ProductParser.parsePrice(priceText);

      // Extract original price (if discounted)
      const oldPriceSelectors = [
        '.product-old-price',
        '.product-page-pricing .product-old-price',
        '.product-highlight .product-old-price',
        '[data-old-price]',
        '.product-was-price',
        '.price-was',
        '.old-price'
      ];

      let originalPriceElement = null;
      for (const selector of oldPriceSelectors) {
        originalPriceElement = document.querySelector(selector);
        if (originalPriceElement) break;
      }

      const originalPriceText = originalPriceElement ? originalPriceElement.textContent : '';
      const originalPrice = ProductParser.parsePrice(originalPriceText);

      // Calculate discount
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Extract thumbnail image
      const thumbnailSelectors = [
        '.product-gallery img',
        '.product-image img',
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
        site: 'emag',
        thumbnail: thumbnail
      };
    } catch (error) {
      console.error('[Fake Discount] Error extracting product data:', error);
      return null;
    }
  }

  // Inject price graph widget - Emag specific insertion
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

    let inserted = false;

    // Emag-specific insertion points
    const mainProductForm = document.querySelector('form.main-product-form');
    if (mainProductForm && mainProductForm.parentNode) {
      mainProductForm.parentNode.insertBefore(widgetContainer, mainProductForm.nextSibling);
      inserted = true;
    }

    if (!inserted) {
      const pricingSection = document.querySelector('.product-page-pricing');
      if (pricingSection) {
        const highlightBox = pricingSection.closest('.highlight-box');
        if (highlightBox && highlightBox.parentNode) {
          highlightBox.parentNode.insertBefore(widgetContainer, highlightBox.nextSibling);
          inserted = true;
        }
      }
    }

    if (!inserted) {
      const formColumn = document.querySelector('.col-md-6:has(form.main-product-form), .col-lg-6:has(form.main-product-form)');
      if (formColumn) {
        formColumn.appendChild(widgetContainer);
        inserted = true;
      }
    }

    if (!inserted) {
      const priceElement = document.querySelector('.product-new-price[data-test="main-price"]');
      if (priceElement) {
        let container = priceElement;
        for (let i = 0; i < 10; i++) {
          container = container.parentElement;
          if (container && container.className && container.className.includes('col-')) {
            container.appendChild(widgetContainer);
            inserted = true;
            break;
          }
        }
      }
    }

    if (!inserted) {
      const fallbackContainer = document.querySelector('main, .container') || document.body;
      fallbackContainer.appendChild(widgetContainer);
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

  // If the initial page is already a product page, kick off tracking.
  if (isProductPage()) {
    setTimeout(trackAndDisplay, 1500);
  }
})();
