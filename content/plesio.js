// Content script for Plesio.bg
// Uses ContentScriptBase for shared functionality.
//
// Plesio is a server-rendered ASP.NET storefront — no SPA hydration delay
// needed. Product pages can have one or two pricing rows:
//
//   .productPricingRow.productPrices  — the online ("Интернет Цена") price.
//                                       Always present, always what we want.
//   .productPricingRow.storesPrice    — the in-store ("Цена в магазина") price.
//                                       Only shown on items tagged "WEB ONLY"
//                                       (where the in-store price differs).
//                                       NEVER use this for tracking — the
//                                       user can't actually pay this online.
//
// Within `.productPrices`, the EUR amount is the first `€`-suffixed token;
// BGN follows after a "/" or "|" separator.
//
// OOS detection — Plesio embeds a hidden SEO/feed-export tracker
// `<div class="ptto-availability">1</div>` whose value is `1` when the
// product is purchasable online and `0` otherwise. The HTML comment in
// the page literally documents this: `<!-- 1 if available, 0 if unavailable -->`.
//
// `og:image` on Plesio has a server-side concat bug (it produces strings
// like `http://www.plesio.bghttps://plesioimages.…`); strip the bogus
// prefix before using it.
(async function () {
  const settings = await chrome.storage.local.get(['enablePlesio']);
  if (settings.enablePlesio === false) {
    return;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/plesio\.bg\/.+-p-\d+\.html/i.test(url)) return false;
    return !!document.querySelector('.productPricingRow.productPrices');
  }

  // Read the first €-suffixed token inside the online-price row.
  // Handles both observed layouts:
  //   Regular:  <div class="productPriceElement">399.00&nbsp;€</div>
  //   Web-only: <div class="price-container-element row">439.00&nbsp;€ | 858.61&nbsp;лв.</div>
  function readOnlineEurPrice() {
    const onlineRow = document.querySelector('.productPricingRow.productPrices');
    if (!onlineRow) return null;
    const text = onlineRow.textContent || '';
    const m = text.match(/(\d[\d\s.,]*)\s*€/);
    if (!m) return null;
    return ProductParser.parsePrice(m[1]);
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('.productPricingRow.productPrices', 5000).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Title — the product H1 carries class `productTitle`.
      let title = '';
      const h1 = document.querySelector('h1.productTitle, h1');
      if (h1) title = h1.textContent.trim();
      if (!title) {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) title = ogTitle.content.trim();
      }

      // Current online EUR price.
      let price = readOnlineEurPrice();

      // OOS guard — `.ptto-availability` hidden tracker div.
      const availDiv = document.querySelector('.ptto-availability');
      if (availDiv && (availDiv.textContent || '').trim() === '0') {
        price = null;
      }

      // Original price — no struck-through element observed in samples;
      // rely on history-based fake-discount detection.
      const originalPrice = null;
      const discount = null;

      // Thumbnail — pull from product gallery <img> first (cleanest URL).
      // Fall back to og:image but strip the well-known concat bug prefix
      // `http://www.plesio.bg` that gets prepended to an absolute URL.
      let thumbnail = null;
      const galleryImg = document.querySelector(
        '.productImagesArea img, .productImageWrap img, .productImage img, img.productImage, .productGallery img'
      );
      if (galleryImg && galleryImg.src) thumbnail = galleryImg.src;
      if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) {
          let raw = og.content;
          // Server-side concat bug: "http://www.plesio.bghttps://…"
          raw = raw.replace(/^https?:\/\/www\.plesio\.bg(?=https?:\/\/)/i, '');
          thumbnail = raw;
        }
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'plesio',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Plesio extract error:', error);
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

    // Preferred anchor: full-width, BEFORE the spec/description block
    // (`<section id="productDetailsArea">` — contains "ОПИСАНИЕ" /
    // "ХАРАКТЕРИСТИКИ" tabs). Inserting here puts the widget below the
    // entire product image + buy area at full page width, just above the
    // characteristics — the natural spot a buyer scans next.
    const detailsArea = document.getElementById('productDetailsArea');
    if (detailsArea && detailsArea.parentNode) {
      detailsArea.parentNode.insertBefore(widgetContainer, detailsArea);
      inserted = true;
    }

    // Fallback: after the buy-button row, inside the right rail.
    if (!inserted) {
      const buyWrap = document.getElementById('buyButtonWrapper');
      if (buyWrap && buyWrap.parentNode) {
        buyWrap.parentNode.insertBefore(widgetContainer, buyWrap.nextSibling);
        inserted = true;
      }
    }

    if (!inserted) {
      const priceRow = document.querySelector('.productPricingRow.productPrices');
      if (priceRow && priceRow.parentNode) {
        priceRow.parentNode.insertBefore(widgetContainer, priceRow.nextSibling);
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
