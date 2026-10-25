// Content script for Decathlon.bg
// Server-rendered. Clean schema.org Product JSON-LD with EUR price and
// availability — same easy-mode pattern as Technopolis.
(async function () {
  const settings = await chrome.storage.local.get(['enableDecathlon']);
  if (settings.enableDecathlon === false) return;

  function readProductJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && (c['@type'] === 'Product' || (Array.isArray(c['@type']) && c['@type'].includes('Product')))) return c;
        }
      } catch (_) { /* skip */ }
    }
    return null;
  }

  function isProductPage() {
    const url = window.location.href;
    if (!/decathlon\.bg\/p\//i.test(url)) return false;
    return !!readProductJsonLd();
  }

  function offerPathname(offerUrl) {
    if (typeof offerUrl !== 'string') return null;
    try {
      return new URL(offerUrl, window.location.origin).pathname;
    } catch (_) {
      return null;
    }
  }

  function pickMatchingOffer(offers) {
    if (!offers) return null;
    const list = Array.isArray(offers) ? offers : [offers];
    const here = window.location.pathname.replace(/\/$/, '') || '/';
    const matched = list.find(o => {
      const op = offerPathname(o.url);
      if (!op) return false;
      const offer = op.replace(/\/$/, '') || '/';
      return offer === here || offer.startsWith(here + '/');
    });
    return matched || list[0];
  }

  function readVisiblePrice() {
    const el = document.querySelector('.price_amount, [class*="price_amount"]');
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  function readVisibleOldPrice() {
    const el = document.querySelector('.price_barred-amount, [class*="price_barred"]');
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"], .price_amount', 5000).catch(() => { });
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
        const offer = pickMatchingOffer(ld.offers);
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }
      if (price == null) price = readVisiblePrice();

      // OOS via JSON-LD availability.
      if (ld && ld.offers) {
        const offer = pickMatchingOffer(ld.offers);
        if (offer && /OutOfStock|Discontinued/i.test(offer.availability || '')) price = null;
      }

      const originalPrice = readVisibleOldPrice();
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
        site: 'decathlon',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] Decathlon extract error:', error);
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
    // Anchor: directly after the hero (gallery + buy column), above the
    // "Предимства на дизайна" / product-information / reviews sections.
    const hero = document.querySelector('.js-product-info, .product-info');
    if (hero && hero.parentNode) {
      hero.parentNode.insertBefore(widgetContainer, hero.nextSibling);
      inserted = true;
    }
    // Fallback: before product reviews (full-width section below the hero).
    const reviews = !inserted && document.querySelector('#product-reviews, .product-reviews, [data-testid="product-reviews"]');
    if (reviews && reviews.parentNode) {
      reviews.parentNode.insertBefore(widgetContainer, reviews);
      inserted = true;
    }
    if (!inserted) {
      const main = document.querySelector('main') || document.body;
      main.appendChild(widgetContainer);
    }
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableDecathlon' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  ContentScriptBase.whenProductPage(isProductPage, trackAndDisplay, 500);
})();
