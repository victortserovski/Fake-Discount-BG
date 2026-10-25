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
        // Scope to the main product container and skip upsell rails.
        const UPSELL_BLOCK = '.upsell-products, .upsell, .related-products, .crosssell, .cross-sell, [id*="upsell"], .similar-products, #related-products-field, .stenik-recommended-products';
        const scopedSelectors = [
          '.product-info-main .price-box.price-final_price .final-price .price.euro',
          '.product-info-main .final-price .price.euro',
          '#product_addtocart_form .final-price .price.euro',
          '.price-box.price-final_price .final-price .price.euro',
          '.final-price .price.euro',
          '.price.euro'
        ];
        for (const sel of scopedSelectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (el.closest(UPSELL_BLOCK)) continue;
            const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
            if (m) {
              price = ProductParser.parsePrice(m[1]);
              break;
            }
          }
          if (price != null) break;
        }
      }

      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      let originalPrice = null;
      const UPSELL_BLOCK = '.upsell-products, .upsell, .related-products, .crosssell, .cross-sell, [id*="upsell"], .similar-products, #related-products-field, .stenik-recommended-products';
      const oldPriceSelectors = [
        '.product-info-main .old-price .price.euro',
        '.product-info-main .old-price .price',
        '#product_addtocart_form .old-price .price.euro',
        '.old-price .price.euro',
        '.old-price .price'
      ];
      for (const sel of oldPriceSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest(UPSELL_BLOCK)) continue;
          const wrapper = el.closest('.old-price') || el;
          // Skip RRP-labeled wrappers (ПЦД / ПЦ) — not a previous selling price.
          if (/ПЦД|ПЦ/.test(wrapper.textContent)) continue;
          const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
          if (m) {
            originalPrice = ProductParser.parsePrice(m[1]);
            break;
          }
        }
        if (originalPrice != null) break;
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      let thumbnail = null;
      if (ld && ld.image) thumbnail = ProductParser.imageUrl(ld.image);
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
    // Verified against live HTML: Lilly's PDP renders the
    // related-products carousel BEFORE the description block in
    // document order (.product-info-main → H1 → #related-products-field
    // → #description → .additional-attributes). So anchoring before
    // `.description` actually places the widget AFTER the recommendation
    // rail — which is exactly the "way too low" position the user saw.
    // Anchor BEFORE `#related-products-field` instead: that places it
    // directly under the hero (.product-info-main).
    // Current (Hyvä) theme: `section#description` follows the hero
    // directly, and `#related-products-field` is now a hidden <input>
    // inside the cart form (anchoring there pushed the panel into the
    // narrow buy column via the form relocation), so the description
    // section comes first.
    const anchors = [
      'section#description',
      '#related-products-field',
      '.related-products-field',
      '.stenik-recommended-products',
      '#description',
      '.description'
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
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableLilly' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  ContentScriptBase.whenProductPage(isProductPage, trackAndDisplay, 500);
})();
