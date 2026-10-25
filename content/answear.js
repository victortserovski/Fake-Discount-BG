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

  function getSelectedSizeToken(mainCard) {
    if (mainCard) {
      const selected = mainCard.querySelector(
        '[data-test*="size"][aria-selected="true"], [data-test*="size"][aria-pressed="true"], ' +
        '[data-test*="Size"][aria-selected="true"], [data-test*="sizeOption"][aria-checked="true"], ' +
        'button[aria-pressed="true"][data-test*="size"], input[type="radio"][name*="size"]:checked'
      );
      if (selected) {
        const token = (selected.getAttribute('data-size') || selected.textContent || '').trim();
        if (token) return token;
      }
    }
    const params = new URLSearchParams(window.location.search);
    for (const key of ['size', 'variant', 'sku']) {
      const v = params.get(key);
      if (v) return v.trim();
    }
    return null;
  }

  function extractAnswearVariantEAN(mainCard) {
    const selectedSize = getSelectedSizeToken(mainCard);
    const productIdMatch = window.location.pathname.match(/-(\d{4,})(?:[/?#]|$)/);
    const productId = productIdMatch ? productIdMatch[1] : null;
    const html = document.documentElement.innerHTML;
    const eanPattern = /"ean"\s*:\s*"(\d{8,14})"/g;
    const candidates = [];
    let match;
    while ((match = eanPattern.exec(html)) !== null) {
      const ean = match[1];
      if (!ProductParser.validateGTIN(ean)) continue;
      const start = Math.max(0, match.index - 500);
      candidates.push({ ean, context: html.slice(start, match.index + 100) });
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].ean;

    if (selectedSize) {
      const sizeEsc = selectedSize.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const { ean, context } of candidates) {
        if (new RegExp(`"size"\\s*:\\s*"${sizeEsc}"`, 'i').test(context) ||
            new RegExp(`"sizeName"\\s*:\\s*"${sizeEsc}"`, 'i').test(context) ||
            new RegExp(`"name"\\s*:\\s*"${sizeEsc}"`, 'i').test(context)) {
          return ean;
        }
      }
    }

    if (productId) {
      for (const { ean, context } of candidates) {
        if (context.includes(`"id":${productId}`) ||
            context.includes(`"id":"${productId}"`) ||
            context.includes(`"variantId":${productId}`) ||
            context.includes(`"sku":"${productId}"`)) {
          return ean;
        }
      }
    }

    return null;
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
      // not a related-products carousel below it.
      let mainCard = document.querySelector('[data-test="productCardDetails"]');
      if (!mainCard && h1) {
        mainCard = h1.closest('[class*="ProductDetailLayout"], [class*="ProductDetailsLayout"], [class*="ProductDetail"], [class*="ProductPage"], [class*="ProductCardStylesProvider__details"]')
          || h1.parentElement;
      }
      if (!mainCard) mainCard = document.querySelector('main') || document;

      let price = null;
      // 1. Prefer SALE price (discounted current price).
      const saleEl = mainCard.querySelector('[data-test*="priceSale"], [class*="priceSaleMinimal"], [class*="priceSale"]:not([class*="priceRegular"])');
      if (saleEl) {
        const p = parseEurFromText(saleEl.textContent);
        if (p && p > 0) price = p;
      }
      // 2. Full-price products use data-test="regularPrice" (not priceActual).
      if (price == null) {
        const regEl = mainCard.querySelector('[data-test="regularPrice"], [data-test*="regularPrice"], [class*="priceRegular__"]:not([class*="Minimal"]):not([class*="Label"])');
        if (regEl) {
          const p = parseEurFromText(regEl.textContent);
          if (p && p > 0) price = p;
        }
      }
      // 3. Legacy "actual" / single-price element.
      if (price == null) {
        const actualEl = mainCard.querySelector('[data-test*="priceActual"], [class*="priceActualLabel"]');
        if (actualEl) {
          const p = parseEurFromText(actualEl.textContent);
          if (p && p > 0) price = p;
        }
      }
      // 4. Last resort: scan price containers only — never whole-card
      //    textContent (title dimensions like "30x50 cm" yield spurious €).
      if (price == null) {
        const priceContainers = mainCard.querySelectorAll('[data-test*="price"], [class*="priceSale"], [class*="priceRegular"], [class*="priceActual"]');
        for (const el of priceContainers) {
          if (/MinimalLabel|priceRegularMinimalLabel/i.test(el.className || '')) continue;
          const p = parseEurFromText(el.textContent);
          if (p && p > 0) { price = p; break; }
        }
      }

      // OOS — disabled basket only. Do not scan card text for OUT_OF_STOCK:
      // variant JSON for other sizes embeds that string while the active
      // variant is in stock (Tommy Jeans corpus false-positive).
      if (mainCard.querySelector(
        '[data-test*="addToBasket"][disabled], [data-test*="addToCart"][disabled], ' +
        '[data-test="add_to_cart"][disabled], [data-test="add_to_basket"][disabled]'
      )) {
        price = null;
      }
      // Unavailable products keep the price block but render no basket
      // button at all, plus the visible "Недостъпен продукт" notice. Both
      // are required, so in-stock pages (button present) are never hit.
      const basketButton = mainCard.querySelector(
        '[data-test*="addToBasket"], [data-test*="addToCart"], [data-test="add_to_cart"], [data-test="add_to_basket"]'
      );
      if (!basketButton && /Недостъпен продукт/i.test(mainCard.textContent || '')) {
        price = null;
      }

      // Was-price (when discounted) — MinimalLabel variants are was-price rows.
      let originalPrice = null;
      const oldEl = mainCard.querySelector('[class*="priceRegularMinimal"], [class*="priceRegularMinimalLabel"], [data-test*="priceRegular"]');
      if (oldEl && !oldEl.matches('[data-test="regularPrice"], [data-test*="regularPrice"]')) {
        const p = parseEurFromText(oldEl.textContent);
        if (p && p > 0 && (price == null || p > price)) originalPrice = p;
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      let thumbnail = null;
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) thumbnail = og.content;

      // EAN — match active variant in SPA JSON (not first `"ean"` in doc order).
      let ean = extractAnswearVariantEAN(mainCard);
      if (!ean) ean = ProductParser.extractEAN(document);

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'answear',
        thumbnail: thumbnail,
        ean: ean
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
    // Anchor: before the whole description tabs block. `#tab-product-
    // description-tabs_0` is a single tab *button* inside a flex tab bar —
    // inserting next to it wedged the panel into the tab row — so climb to
    // the tabs root (the block right after the gallery/details hero).
    const tab = document.querySelector('#tab-product-description-tabs_0');
    const tabs = (tab && tab.closest('[class*="tabsRoot"]'))
      || document.querySelector('[class*="TabsStyleProvider__tabsRoot"], [class*="ProductDescription"], [class*="DescriptionTabs"]');
    if (tabs && tabs.parentNode) {
      tabs.parentNode.insertBefore(widgetContainer, tabs);
      inserted = true;
    }
    if (!inserted) {
      const main = document.querySelector('#main-container, main, #root') || document.body;
      main.appendChild(widgetContainer);
    }
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableAnswear' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // React + scoped CSS Module hydration is slow on Answear.
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (isProductPage()) setTimeout(trackAndDisplay, 1000);
})();
