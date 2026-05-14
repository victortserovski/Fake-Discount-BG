// Content script for Ardes.bg
// Uses ContentScriptBase for shared functionality.
//
// Ardes is fully server-rendered (no SPA hydration delay needed). Product
// pages expose two pricing tiers side-by-side inside `#buying-info`:
//
//   .real-price    — in-store reference (label "цена в магазин:") OR, on
//                    discounted items, the crossed-out previous online price
//                    (marked with `.strike-horizontal.original-price`).
//   .common-price  — the actual online price the user pays (always present).
//
// We always read `.common-price .eur-price .price-tag` (+ `.after-decimal`
// for the fractional part). For the was-price we ONLY accept
// `.real-price .strike-horizontal.original-price` — the strike class is
// the proof it's a real previous selling price, not the in-store reference.
// (The in-store reference uses `.full-price.original-price` WITHOUT
// `.strike-horizontal`, so the strike-only selector naturally excludes it.)
//
// OOS: when the product is on long-lead/special-order ("По заявка"), the
// availability strip shows that label inside `.availability-check strong`.
// Per the user, we treat this as OOS — they can't actually purchase at
// the displayed price right now (~60-day lead time, possible deposit).
(async function () {
  const settings = await chrome.storage.local.get(['enableArdes']);
  if (settings.enableArdes === false) {
    return;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/ardes\.bg\/product\/.+-\d{4,7}(?:[\/?#]|$)/i.test(url)) return false;
    return !!document.querySelector('#buying-info, .product-price-box');
  }

  // Read the current online EUR price. The DOM splits the integer and
  // fractional parts into separate spans; concat before parsing.
  //
  //   <div class="common-price …">
  //     <span class="full-price ">
  //       <span class="eur-price">
  //         <span class="price-tag" itemprop="price"> 599</span>
  //         <span class="after-decimal">.00</span>
  //         <span class="currency">€</span>
  //       </span>
  //       <span class="bgn-price">…BGN…</span>
  //     </span>
  //   </div>
  function readCommonEurPrice() {
    const integer = document.querySelector('.common-price .eur-price .price-tag');
    if (!integer) return null;
    const decimal = document.querySelector('.common-price .eur-price .after-decimal');
    const text = (integer.textContent || '').trim() + (decimal ? (decimal.textContent || '').trim() : '');
    return ProductParser.parsePrice(text);
  }

  // Read the crossed-out previous online price, if any. Only the
  // `.strike-horizontal.original-price` flavour qualifies — the in-store
  // reference uses `.full-price.original-price` without the strike class.
  function readStrikeEurOldPrice() {
    const integer = document.querySelector('.real-price .eur-price .strike-horizontal.original-price');
    if (!integer) return null;
    // Integer + .after-decimal child render the EUR amount.
    const decimal = integer.querySelector('.after-decimal');
    // Strip the .after-decimal child's text from the integer span first so
    // it's not double-counted when we read the integer's textContent.
    let intText = '';
    integer.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) intText += n.textContent;
    });
    const text = intText.trim() + (decimal ? (decimal.textContent || '').trim() : '');
    return ProductParser.parsePrice(text);
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('#buying-info, .product-price-box', 5000).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Title — prefer og:title (clean), fall back to <h1> or document.title.
      let title = '';
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.content) title = ogTitle.content.trim();
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : (document.title || '').trim();
      }

      // Current online EUR price.
      let price = readCommonEurPrice();

      // OOS guard — "По заявка" inside `.availability-check strong`.
      // Treat this as OOS per user's request (special-order, ~60-day lead,
      // not actually purchasable at the displayed price right now).
      const availStrong = document.querySelector('.availability-check strong');
      const availText = availStrong ? (availStrong.textContent || '').trim() : '';
      if (/По\s*заявка/i.test(availText)) {
        price = null;
      }

      // Was-price — only the strike-horizontal flavour qualifies (skips
      // the in-store reference).
      const originalPrice = readStrikeEurOldPrice();
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Thumbnail — og:image is reliable on Ardes (canonical product image).
      let thumbnail = null;
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) thumbnail = og.content;
      if (!thumbnail) {
        const img = document.querySelector('.product-image img, .gallery img, img[itemprop="image"]');
        if (img && img.src) thumbnail = img.src;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'ardes',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Ardes extract error:', error);
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

    // Preferred anchor: after the price/buy column. `.product-price-box`
    // is the right column; insert after its row container so the widget
    // sits beneath the buy area.
    const priceBox = document.querySelector('.product-price-box');
    if (priceBox && priceBox.parentNode) {
      const row = priceBox.closest('.row') || priceBox.parentNode;
      if (row.parentNode) {
        row.parentNode.insertBefore(widgetContainer, row.nextSibling);
        inserted = true;
      }
    }

    if (!inserted) {
      const main = document.querySelector('main') || document.body;
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

  // Server-rendered — no hydration delay needed.
  if (isProductPage()) {
    setTimeout(trackAndDisplay, 200);
  }
})();
