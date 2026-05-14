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
      let price = ProductParser.parsePrice(priceText);

      // Out-of-stock guard — same Notino/Ozone pattern. Emag marks
      // unavailable products with a visible <span class="label
      // label-out_of_stock">Изчерпана наличност</span> AND with JSON-LD
      // `availability: "http://schema.org/OutOfStock"`. The DOM signal is
      // the cheapest reliable read. When OOS, set price=null so
      // ContentScriptBase.trackAndDisplay short-circuits into the empty-
      // history branch instead of recording a phantom datapoint at a
      // price the user can't actually buy at — see CLAUDE.md §6.
      if (document.querySelector('.label-out_of_stock, [class*="label-out_of_stock"]')) {
        price = null;
      }

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
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Error extracting product data:', error);
      return null;
    }
  }

  // Inject price graph widget - Emag specific insertion
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

    // UNIVERSAL EMAG PLACEMENT: every Emag product page wraps the buy
    // area in a single `<section class="page-section page-section-light">`,
    // and the next sibling is always the start of the secondary content —
    // could be alternative offers, ad slot, recommendation carousel, or
    // description, depending on the product. Inserting the widget right
    // after that buy section therefore lands it just below the buy area
    // and just above whatever comes next, on every page, without us
    // having to know which optional sub-sections are present.
    //
    // Verified against the html samples in `emag html pages/` — both the
    // multi-seller phone page (S25 FE) and the single-seller trailer page
    // (Vivatechnix) have form.main-product-form inside a page-section, with
    // distinct but consistent next-sibling sections after it.
    let inserted = false;
    const form = document.querySelector('form.main-product-form');
    const buyAreaSection = form ? form.closest('section') : null;
    if (buyAreaSection && buyAreaSection.parentNode) {
      buyAreaSection.parentNode.insertBefore(widgetContainer, buyAreaSection.nextSibling);
      inserted = true;
    }

    // Last-resort fallback if Emag ever ships a layout where the form
    // isn't inside a section: append to <main> (or <body>) so the widget
    // still renders somewhere visible.
    if (!inserted) {
      const fallback = document.querySelector('main') || document.body;
      fallback.appendChild(widgetContainer);
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
