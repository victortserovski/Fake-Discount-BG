// Content script for Zora.bg
// Uses ContentScriptBase for shared functionality.
//
// Zora runs on the CloudCart SaaS platform. Server-rendered microdata is
// our most reliable source — `<meta itemprop="price" content="…">` and
// `<meta itemprop="priceCurrency" content="EUR">` are present in the
// document head/body before any JS runs. The visible price spans
// (`.price-new-js`, `.price-old-js > i`) are EMPTY or `0.00` until a
// jQuery hydration pass populates them, so we don't read them for the
// current price; we only consult `.price-old-js` after a delay for the
// optional was-price.
//
// OOS signals (server-rendered):
//   - <link itemprop="availability" href="https://schema.org/OutOfStock">
//   - the "Продуктът е изчерпан онлайн…" notice in the parameters block
//     (online-only sell-out; microdata still says InStock)
(async function () {
  const settings = await chrome.storage.local.get(['enableZora']);
  if (settings.enableZora === false) {
    return;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/zora\.bg\/product\//i.test(url)) return false;
    // Server-rendered microdata is present on every product page.
    return !!document.querySelector('meta[itemprop="price"]');
  }

  // Read the current price from server-rendered microdata, confirming
  // currency is EUR. Returns null if anything looks off.
  function readMicrodataPrice() {
    const priceMeta = document.querySelector('meta[itemprop="price"]');
    const currencyMeta = document.querySelector('meta[itemprop="priceCurrency"]');
    if (!priceMeta || !priceMeta.content) return null;
    if (currencyMeta && (currencyMeta.content || '').toUpperCase() !== 'EUR') return null;
    const parsed = parseFloat(priceMeta.content);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100) / 100;
  }

  // Visible-DOM fallback for current price (only used if microdata missing).
  // After hydration, `.price-new-js` text contains "1 259,00 €" or similar.
  function readVisiblePrice() {
    const el = document.querySelector('._product-details-price-new.price-new-js, .price-new-js-product');
    if (!el) return null;
    const m = el.textContent.match(/(\d[\d\s., ]*)\s*€/);
    if (!m) return null;
    return ProductParser.parsePrice(m[1]);
  }

  // Visible-DOM was-price (only present on discounted items, populated by
  // jQuery after `load`). The element exists on every page but holds `0.00`
  // when there's no discount; we only use it when > 0 and > current.
  // CloudCart exposes list/sale in inline `cc_page_data = {...}` — not a page
  // global; MV3 content scripts cannot read `typeof cc_page_data`.
  function parseCcPageDataFromScript() {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const text = s.textContent || '';
      const m = text.match(/cc_page_data\s*=\s*(\{[\s\S]*?\})\s*;/);
      if (!m) continue;
      try {
        const data = JSON.parse(m[1]);
        if (data && data.price != null) return data;
      } catch (_) { /* skip malformed */ }
    }
    return null;
  }

  // The main price block keeps a struck `.price-old-js` without `.hide` only
  // when the shop shows a was-price (server-rendered, before hydration fills
  // it in). Full-price pages mark it `.hide`; flyer ("Брошура") pages omit
  // it although cc_page_data still carries a higher list price — a hidden
  // list price is not a claim the shopper sees, so it never counts.
  function showsOldPrice() {
    const el = document.querySelector('.product-details-js .price-old-js');
    return !!el && !el.classList.contains('hide');
  }

  function readCcPageDataWasPrice(currentPrice) {
    if (!showsOldPrice()) return null;
    const cc = parseCcPageDataFromScript();
    if (!cc) return null;
    const list = parseFloat(cc.price);
    const sale = parseFloat(cc.discount_price);
    if (!Number.isFinite(list) || !Number.isFinite(sale) || list <= sale) return null;
    if (currentPrice && Math.abs(currentPrice - sale) > 0.02) return null;
    return Math.round(list * 100) / 100;
  }

  function readVisibleOldPrice(currentPrice) {
    if (!showsOldPrice()) return null;
    const el = document.querySelector('.product-details-js .price-old-js');
    // The numeric value is rendered inside an <i> child after hydration.
    const text = (el.querySelector('i')?.textContent || el.textContent || '').trim();
    const m = text.match(/(\d[\d\s., ]*)/);
    if (!m) return null;
    const parsed = ProductParser.parsePrice(m[1]);
    if (!parsed || parsed <= 0) return null;
    if (currentPrice && parsed <= currentPrice) return null;
    return parsed;
  }

  async function extractProductData() {
    try {
      // Wait for the microdata or visible price block.
      await ProductParser.waitForElement(
        'meta[itemprop="price"], ._product-details-price-new',
        7000
      ).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Title — server-rendered <h1>.
      const h1 = document.querySelector('h1.js-product-title, h1');
      const title = h1 ? h1.textContent.trim() : '';

      // Current price — microdata first, visible-DOM as fallback.
      let price = readMicrodataPrice();
      if (price == null) price = readVisiblePrice();

      // Out-of-stock — trust the server-rendered microdata
      // `<link itemprop="availability">`. The `<span class="_product-out-of-stock">`
      // element is present in the DOM on EVERY product page (in-stock or
      // not) — its parent carries `<div class="… out-of-stock-js hide">`
      // and JS removes the `hide` class only when the selected variant is
      // unavailable. Treating the span's mere presence as OOS made every
      // Zora product return `price=null`. Microdata is server-rendered and
      // matches the variant URL, so it's the safe signal here.
      const availLink = document.querySelector('link[itemprop="availability"]');
      const oosFromMicrodata = availLink && /OutOfStock/i.test(availLink.getAttribute('href') || '');
      if (oosFromMicrodata) {
        price = null;
      }
      // Online-only sell-outs keep InStock microdata and in_stock variant
      // data, but drop the buy button and show an orange notice in the
      // parameters block ("Продуктът е изчерпан онлайн, ограничени
      // наличности само в някои физически магазини"). It can't be bought
      // online at that price, so treat it as OOS (same rule as Technopolis).
      // Zora's own script matches the notice with this selector.
      const onlineOos = [...document.querySelectorAll('.product-details-js ._product-details-parameters p > span')]
        .some(el => /изчерпан онлайн/i.test(el.textContent || ''));
      if (onlineOos) {
        price = null;
      }

      // Original price — cc_page_data first (pre-hydration), then DOM.
      let originalPrice = readCcPageDataWasPrice(price);
      if (originalPrice == null) originalPrice = readVisibleOldPrice(price);
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Thumbnail — server-rendered microdata image.
      let thumbnail = null;
      const imgMeta = document.querySelector('meta[itemprop="image"]');
      if (imgMeta && imgMeta.content) thumbnail = imgMeta.content;
      if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) thumbnail = og.content;
      }
      if (!thumbnail) {
        const img = document.querySelector('._product-details-image img, .js-image-slider img');
        if (img && img.src) thumbnail = img.src;
      }

      // EAN — Zora embeds Loadbee's product enrichment widget which carries
      // the canonical EAN-13 on a `data-loadbee-gtin` attribute. This is
      // the cleanest source on this site (JSON-LD Product blocks aren't
      // present and the visible-text scan finds nothing). Validate via the
      // generic GTIN check before trusting it; fall back to the generic
      // multi-tier extractor if the Loadbee div isn't present.
      let ean = null;
      const loadbeeEl = document.querySelector('[data-loadbee-gtin]');
      if (loadbeeEl) {
        const candidate = (loadbeeEl.getAttribute('data-loadbee-gtin') || '').trim().replace(/^0+(?=\d{8,14}$)/, '');
        if (ProductParser.validateGTIN(candidate)) ean = candidate;
      }
      if (!ean) {
        const cc = parseCcPageDataFromScript();
        if (cc && cc.barcode != null) {
          const candidate = String(cc.barcode).trim().replace(/^0+(?=\d{8,14}$)/, '');
          if (ProductParser.validateGTIN(candidate)) ean = candidate;
        }
      }
      if (!ean) {
        const flixEl = document.querySelector('[data-flix-ean]');
        if (flixEl) {
          const candidate = (flixEl.getAttribute('data-flix-ean') || '').trim().replace(/^0+(?=\d{8,14}$)/, '');
          if (ProductParser.validateGTIN(candidate)) ean = candidate;
        }
      }
      if (!ean) ean = ProductParser.extractEAN(document);

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'zora',
        thumbnail: thumbnail,
        ean: ean
      };
    } catch (error) {
      console.error('[Fake Discount] Zora extract error:', error);
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

    // Preferred anchor: full-width, BEFORE the description / specs tab
    // block (`<div class="tabbed-content _product-details-tabs">`), which
    // is a sibling of the product-details row and spans the full content
    // width. Inserting here lets the widget take the whole content width
    // instead of being squeezed inside the right-rail buy column.
    // The whole product section (tabs included) sits inside the add-to-cart
    // form, so opt out of the loader's form relocation — otherwise the
    // panel drops below the tabs and the tall right sidebar.
    const tabsBlock = document.querySelector('.tabbed-content._product-details-tabs');
    if (tabsBlock && tabsBlock.parentNode) {
      tabsBlock.parentNode.insertBefore(widgetContainer, tabsBlock);
      widgetContainer.dataset.allowInForm = 'true';
      inserted = true;
    }

    // Fallback: append inside the product-details container (still
    // full-width on most layouts).
    if (!inserted) {
      const detailsRoot = document.querySelector('.product-details-js');
      if (detailsRoot) {
        detailsRoot.appendChild(widgetContainer);
        inserted = true;
      }
    }

    if (!inserted) {
      const main = document.querySelector('main') || document.body;
      main.appendChild(widgetContainer);
    }

    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableZora' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });

  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });

  // CloudCart hydrates `.price-old-js` from JS after `load`; give it time
  // before we try to read the optional was-price.
  await new Promise(resolve => setTimeout(resolve, 1200));

  ContentScriptBase.whenProductPage(isProductPage, trackAndDisplay, 800);
})();
