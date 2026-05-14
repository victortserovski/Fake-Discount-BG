// Content script for Technomarket.bg
// Uses ContentScriptBase for shared functionality.
//
// Technomarket is a custom-component SPA (`<tm-price>`, `<tm-tooltip>`,
// `<tm-product-credit-preview>` etc.) hydrated from inline data attributes.
// Its JSON-LD Product block is reliable for title/image/brand/sku, but the
// price field is BGN (`"priceCurrency":"BGN"`) — useless to us. The EUR
// amount is rendered separately in the visible DOM at
// `.price-wrapper > .price > tm-price > span.bgn.eu` (yes, the EUR span
// has class "bgn eu" — "bgn" is a generic price-block class on this site,
// "eu" is the modifier that flags it as the euro variant).
//
// `.price-wrapper > .price-info > .old-price` carries a "ПЦ" (Препоръчителна
// цена — manufacturer's recommended price) tooltip, exactly analogous to
// Ozone's ПЦД trap. It is NOT a previous selling price, so we skip it.
(async function () {
  const settings = await chrome.storage.local.get(['enableTechnomarket']);
  if (settings.enableTechnomarket === false) {
    return;
  }

  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && c['@type'] === 'Product') return c;
        }
      } catch (_) { /* malformed JSON-LD — skip */ }
    }
    return null;
  }

  // Product URLs are `/<category>/<slug>-<8-digit-code>` (the trailing 8
  // digits are the canonical product code, also exposed in JSON-LD `sku`).
  // Verify with a JSON-LD probe so a half-loaded SPA doesn't trigger.
  function isProductPage() {
    const url = window.location.href;
    if (!/technomarket\.bg\/[^\/]+\/[a-z0-9-]+-\d{8}(?:[/?#]|$)/i.test(url)) return false;
    return !!readProductJsonLd();
  }

  // Read the visible EUR amount from the main price block.
  //
  // Markup (current price, EUR):
  //   <div class="price-wrapper">
  //     <div class="price">
  //       <tm-price format="subtype">
  //         <span class="bgn">…BGN…</span>
  //         <span class="divider">/</span>
  //         <span class="bgn eu">
  //           <span class="primary"> 579</span>
  //           <span class="dot">.</span>
  //           <span class="secondary">00 </span>
  //           <span class="currency">€</span>
  //         </span>
  //       </tm-price>
  //     </div>
  //     …
  //   </div>
  function readVisibleEurPrice() {
    const eurSpan = document.querySelector('.price-wrapper .price tm-price .bgn.eu');
    if (!eurSpan) return null;
    return ProductParser.parsePrice(eurSpan.textContent);
  }

  async function extractProductData() {
    try {
      // Wait for either the JSON-LD or the visible price block to appear.
      await ProductParser.waitForElement(
        'script[type="application/ld+json"], .price-wrapper .price tm-price',
        7000
      ).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);
      const productLd = readProductJsonLd();

      // Title: JSON-LD `name` (server-rendered, clean) with brand prepended
      // for context. Mirrors the Notino/Technopolis pattern; avoids double-
      // printing the brand if the name already contains it.
      let title = '';
      if (productLd && typeof productLd.name === 'string') {
        const brand = productLd.brand && productLd.brand.name ? productLd.brand.name : '';
        const rawName = productLd.name.replace(/&quot;/g, '"').trim();
        if (brand && !rawName.toLowerCase().includes(brand.toLowerCase())) {
          title = `${brand} ${rawName}`;
        } else {
          title = rawName;
        }
      }
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      // Current price — visible-DOM EUR only. JSON-LD `offers.price` is BGN
      // here, so we deliberately do NOT trust it. (See file header.)
      let price = readVisibleEurPrice();

      // Original price — Technomarket's only "old price" surface is the
      // ПЦ (manufacturer-recommended) tooltip, which is not a previous
      // selling price. Skip any `.old-price` whose textContent contains
      // the ПЦ label. Same trap as Ozone's ПЦД guard. If Technomarket ever
      // ships a real struck-through "was X" price (without the ПЦ label),
      // we can revisit; the user has confirmed no such price exists today.
      let originalPrice = null;
      const oldPriceEl = document.querySelector('.price-wrapper .price-info .old-price');
      if (oldPriceEl && !/ПЦ/.test(oldPriceEl.textContent)) {
        // ПЦ = U+041F U+0426 — Cyrillic П + Ц. Reject if the literal label
        // is present anywhere in the wrapper text.
        const eurOld = oldPriceEl.querySelector('.euro_price');
        if (eurOld) originalPrice = ProductParser.parsePrice(eurOld.textContent);
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      // Out-of-stock guard. The user did not provide an OOS sample, so this
      // is best-effort: when the visible EUR price is missing OR the main
      // add-to-cart button is `disabled`, treat as OOS and skip recording.
      // Existing history is preserved (we just don't append today).
      const addCartBtn = document.querySelector('button[data-action="addCart"]');
      const isOos = !readVisibleEurPrice() || (addCartBtn && addCartBtn.hasAttribute('disabled'));
      if (isOos) price = null;

      // Thumbnail: first JSON-LD image (Technomarket exposes a multi-image
      // gallery with the hero image first), fallback to the og:image meta,
      // fallback to first product gallery <img>.
      let thumbnail = null;
      if (productLd && productLd.image) {
        thumbnail = Array.isArray(productLd.image) ? productLd.image[0] : productLd.image;
      }
      if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) thumbnail = og.content;
      }
      if (!thumbnail) {
        const img = document.querySelector('.product-gallery img, .gallery img, img[itemprop="image"]');
        if (img && img.src) thumbnail = img.src;
      }

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'technomarket',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Technomarket extract error:', error);
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

    // Preferred anchor: full-width, BEFORE the next major section
    // (`section.product_sections` / `section.product-sections` — the
    // "Общ преглед" / specs / similar-products block) which is the
    // sibling of `section.product_details`. Inserting here puts the
    // widget below the entire product-detail row at full page width
    // instead of cramped inside the right-rail buy column.
    const sectionsAnchor = document.querySelector(
      'section.product_sections, section.product-sections'
    );
    if (sectionsAnchor && sectionsAnchor.parentNode) {
      sectionsAnchor.parentNode.insertBefore(widgetContainer, sectionsAnchor);
      inserted = true;
    }

    // Fallback: append after the entire product-details section.
    if (!inserted) {
      const detailsSection = document.querySelector(
        'section.product_details, section.product-details'
      );
      if (detailsSection && detailsSection.parentNode) {
        detailsSection.parentNode.insertBefore(widgetContainer, detailsSection.nextSibling);
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

  // Custom Web Components hydrate late on Technomarket — give the
  // <tm-price> block a moment to render before the first extraction.
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (isProductPage()) {
    setTimeout(trackAndDisplay, 1500);
  }
})();
