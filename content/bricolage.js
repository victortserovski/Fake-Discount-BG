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

  function isEurPriceText(text) {
    if (!text) return false;
    if (/€/.test(text)) return true;
    if (/лв/i.test(text)) return false;
    return false;
  }

  function readVisibleEurCurrent() {
    const selectors = [
      '.product__prices-block--euro .product__price--new',
      '.product__prices-block--euro .product__price-value',
      '.euro__price.product__price--new',
      '.euro__price.product__price-value',
      '.product__prices-block:not(.product__prices-block--euro) .product__price--new',
      '.product__prices-block:not(.product__prices-block--euro) .product__price-value'
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.textContent || '';
        if (!isEurPriceText(text)) continue;
        const m = text.match(/(\d[\d\s., ]*)/);
        if (m) {
          const p = ProductParser.parsePrice(m[1]);
          if (p && p > 0) return p;
        }
      }
    }
    return null;
  }

  function readVisibleEurOld() {
    // Plain block holds EUR was-price; `--euro` block can be mislabeled BGN.
    const selectors = [
      '.product__prices-block:not(.product__prices-block--euro) .product__price--old',
      '.product__prices-block--euro .product__price--old',
      '.euro__price.product__price--old'
    ];
    for (const sel of selectors) {
      for (const oldEl of document.querySelectorAll(sel)) {
        const text = oldEl.textContent || '';
        if (!/€/.test(text)) continue;
        const m = text.match(/(\d[\d\s., ]*)/);
        if (m) {
          const p = ProductParser.parsePrice(m[1]);
          if (p && p > 0) return p;
        }
      }
    }
    return null;
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
        // Visible-DOM EUR fallback. `--euro` can be mislabeled BGN on some
        // PDPs — require € in text, reject лв/ЛВ without €.
        price = readVisibleEurCurrent();
      }

      if (ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      const originalPrice = readVisibleEurOld();
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
    // Anchor BEFORE the full-width PDP tab section (`#pdpTabs` /
    // `.brico-tabs`) or the recommendation rails. Inserting after the
    // `.product__prices` block kept the widget inside the right rail
    // — a narrow column — which squished the chart. The tab section
    // below the hero is full-width on every PDP layout.
    const anchors = [
      '#pdpTabs',
      '.brico-tabs',
      '.ProductRecommendedSlot',
      '.ProductRelatedSlot',
      '.initialDescription'
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
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableBricolage' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  if (isProductPage()) setTimeout(trackAndDisplay, 500);
})();
