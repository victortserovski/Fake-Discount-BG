// Content script for eBag.bg
// React SPA — body is an empty `<div id="store-root">` shell, but the
// `<head>` carries a reliable server-rendered schema.org Product JSON-LD
// block with EUR price + availability. Drive everything from JSON-LD.
(async function () {
  const settings = await chrome.storage.local.get(['enableEbag']);
  if (settings.enableEbag === false) return;

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
    // eBag URLs: /<slug>/<numericId> — distinct from category pages which
    // don't have the trailing numeric id. JSON-LD probe also confirms.
    if (!/ebag\.bg\/[^/]+\/\d+/i.test(url)) return false;
    return !!readProductJsonLd();
  }

  function isDomOos() {
    const page = document.querySelector('[data-page-name="productPage"], #store-root');
    const heading = page?.querySelector('h1');
    if (heading && /не\s*е\s*наличен|изчерпан|няма\s*наличност/i.test(heading.textContent || '')) return true;
    const root = page && Array.from(page.querySelectorAll('[data-product-id]')).find(el => {
      try {
        return new URL(el.getAttribute('data-product-id'), window.location.origin).pathname === window.location.pathname;
      } catch (_) { return false; }
    });
    if (!root) return false;
    for (const el of root.querySelectorAll('.sr-only, [class*="sr-only"], [class*="visually-hidden"]')) {
      if (/не\s*е\s*наличен|изчерпан|няма\s*наличност/i.test(el.textContent || '')) return true;
    }
    for (const btn of root.querySelectorAll('button, a')) {
      if (/^Извести\s*ме/i.test((btn.textContent || '').trim())) return true;
    }
    return false;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"]', 6000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const ld = readProductJsonLd();

      let title = '';
      if (ld && typeof ld.name === 'string') {
        const brand = ld.brand && (typeof ld.brand === 'string' ? ld.brand : ld.brand.name) || '';
        const rawName = ld.name.replace(/&quot;/g, '"').trim();
        title = brand && !rawName.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${rawName}` : rawName;
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      let price = null;
      const domOos = isDomOos();
      if (!domOos && ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }

      // OOS via JSON-LD availability — only when DOM doesn't contradict.
      if (!domOos && ld && ld.offers) {
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer && /OutOfStock|Discontinued/i.test(offer.availability || '')) price = null;
      }
      if (domOos) price = null;

      // No reliable visible was-price selector in the saved SPA shell
      // samples — rely on history-based fake-discount detection.
      const originalPrice = null;
      const discount = null;

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
        site: 'ebag',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] eBag extract error:', error);
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
    // Verified against live HTML: eBag is a Tailwind + Headless-UI
    // React SPA with NO semantic class names (no `#pdpTabs`, no
    // `.ProductDescription` — those classes are inherited from a
    // different platform). The only stable hooks are
    // `[data-page-name="productPage"]` and `[data-product-id]` on the
    // main product card. Strategy: walk up from H1 to find the direct
    // child of the page-root that wraps the main product card row,
    // then insert the widget as its next sibling. That places it
    // immediately under the entire product row, full-width, above
    // everything else on the page.
    const pageRoot = document.querySelector('[data-page-name="productPage"]') || document.querySelector('#store-root');
    const h1 = document.querySelector('h1');
    if (pageRoot && h1) {
      // Walk up from H1 until we find an ancestor that is a direct
      // child of pageRoot.
      let target = h1;
      while (target.parentElement && target.parentElement !== pageRoot) {
        target = target.parentElement;
      }
      if (target.parentElement === pageRoot && target.nextSibling) {
        pageRoot.insertBefore(widgetContainer, target.nextSibling);
        inserted = true;
      } else if (target.parentElement === pageRoot) {
        pageRoot.appendChild(widgetContainer);
        inserted = true;
      }
    }
    if (!inserted) {
      const root = document.querySelector('#store-root, main') || document.body;
      root.appendChild(widgetContainer);
    }
    ContentScriptBase.loadWidgetCSS();
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableEbag' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // SPA hydration delay before first extraction.
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (isProductPage()) setTimeout(trackAndDisplay, 800);
})();
