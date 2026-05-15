// Content script for Sopharmacy.bg
// Server-rendered Hybris/SAP Commerce. JSON-LD has BGN price (useless to
// us) — read the EUR amount from the visible DOM `.price--euro` family.
// Sopharmacy is a pharmacy: products use proprietary 18-digit codes, not
// EAN. The generic ProductParser.extractEAN tries anyway.
(async function () {
  const settings = await chrome.storage.local.get(['enableSopharmacy']);
  if (settings.enableSopharmacy === false) return;

  function isProductPage() {
    const url = window.location.href;
    if (!/sopharmacy\.bg\/[a-z]{2}\/product\/\d+/i.test(url)) return false;
    return !!document.querySelector('.price--euro, .product-detail');
  }

  function readVisibleEur(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('.price--euro', 5000).catch(() => { });
      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // JSON-LD only used for title/image (its `price` is BGN, ignore).
      const ldEl = document.querySelector('script[type="application/ld+json"]');
      let ld = null;
      if (ldEl) try { ld = JSON.parse(ldEl.textContent); } catch (_) { /* skip */ }
      if (Array.isArray(ld)) ld = ld.find(c => c && c['@type'] === 'Product') || null;
      if (ld && ld['@type'] !== 'Product') ld = null;

      let title = '';
      if (ld && typeof ld.name === 'string') title = ld.name.replace(/&quot;/g, '"').trim();
      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      // Current EUR price — prefer the discount variant, fall back to
      // the plain euro price.
      let price = readVisibleEur('.price.price--discount.price--euro, .price--discount.price--euro');
      if (price == null) price = readVisibleEur('.price.price--euro, .price--euro');

      // OOS — visible markers.
      const allText = (document.body && document.body.textContent) || '';
      if (/Изчерпан|Няма наличност|Не е наличен/i.test(allText) && !document.querySelector('.add-to-cart-btn:not([disabled]), button.add-to-cart:not([disabled])')) {
        // Only nuke price if the buy button is missing/disabled too —
        // otherwise the strings could appear in unrelated copy.
        // Note: Sopharmacy may not have these strings on regular pages,
        // so this guard is defensive.
        if (/Изчерпан|Няма наличност/i.test(document.querySelector('.product-detail, .product-info')?.textContent || '')) {
          price = null;
        }
      }

      // Old/struck price.
      let originalPrice = readVisibleEur('.price.price--old.price--euro, .price--old.price--euro');
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
        site: 'sopharmacy',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Sopharmacy extract error:', error);
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
    // Sopharmacy's PDP renders the spec tabs (`.tabs`) below the hero.
    // Previously we inserted BEFORE the tabs which placed the widget
    // too high (right under the price box, squeezed). Instead insert
    // AFTER the tab block — still full-width, just below the spec/
    // description tabs, in the "extra info / reviews / related"
    // gap before the page footer.
    const tabs = document.querySelector('.tabs, .product-tabs, .product-detail-info');
    if (tabs && tabs.parentNode) {
      tabs.parentNode.insertBefore(widgetContainer, tabs.nextSibling);
      inserted = true;
    }
    if (!inserted) {
      const main = document.querySelector('main, .site') || document.body;
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
  if (isProductPage()) setTimeout(trackAndDisplay, 500);
})();
