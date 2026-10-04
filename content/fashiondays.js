// Content script for Fashion Days (fashiondays.bg)
// Server-rendered. Reliable schema.org Product JSON-LD with EUR price.
// Exclude the 30-day reference and any ПЦД-labelled manufacturer reference.
(async function () {
  const settings = await chrome.storage.local.get(['enableFashiondays']);
  if (settings.enableFashiondays === false) return;

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
    if (!/fashiondays\.bg\/p\//i.test(url)) return false;
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

  function readRrpPrice() {
    const oldEl = document.querySelector('.rrp-price, .old-price__value');
    if (!oldEl) return null;
    // ПЦД is the manufacturer's reference, even when visually struck through.
    if (/ПЦД|ПЦ/.test((oldEl.closest('.rrp-wrapper') || oldEl).textContent)) return null;
    let attr = oldEl.getAttribute('data-rrp-price');
    if (!attr) {
      const wrapper = oldEl.closest('.rrp-wrapper');
      const attrEl = wrapper && wrapper.querySelector('[data-rrp-price]');
      if (attrEl) attr = attrEl.getAttribute('data-rrp-price');
    }
    if (attr) {
      const parsed = parseFloat(attr);
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 100) / 100;
    }
    const primary = oldEl.querySelector('.primary');
    if (primary) {
      const intPart = (primary.textContent || '').trim();
      const decEl = oldEl.querySelector('.price__decimals, i');
      const decPart = decEl ? (decEl.textContent || '').replace(/[^\d]/g, '') : '';
      const combined = decPart ? `${intPart}.${decPart}` : intPart;
      const p = ProductParser.parsePrice(combined);
      if (p && p > 0) return p;
    }
    const decEl = oldEl.querySelector('.price__decimals, i.price__decimals, i');
    if (decEl) {
      let intPart = '';
      for (const n of oldEl.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) intPart += n.textContent;
        else if (n === decEl) break;
      }
      const decPart = (decEl.textContent || '').replace(/[^\d]/g, '');
      if (intPart.trim() && decPart) {
        const p = ProductParser.parsePrice(`${intPart.trim()}.${decPart}`);
        if (p && p > 0) return p;
      }
    }
    const m = (oldEl.textContent || '').match(/(\d[\d\s., ]*)/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      await ProductParser.waitForElement('script[type="application/ld+json"]', 5000).catch(() => { });
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
      if (ld && ld.offers) {
        const offer = pickMatchingOffer(ld.offers);
        if (offer && (offer.priceCurrency || '').toUpperCase() === 'EUR') {
          const parsed = parseFloat(offer.price);
          if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
        }
      }
      if (price == null) {
        const el = document.querySelector('.sale-price.new-price, .sale-price, .new-price');
        if (el) {
          const m = (el.textContent || '').match(/(\d[\d\s., ]*)/);
          if (m) price = ProductParser.parsePrice(m[1]);
        }
      }

      if (ld && ld.offers) {
        const offer = pickMatchingOffer(ld.offers);
        if (offer && /OutOfStock/i.test(offer.availability || '')) price = null;
      }

      // Was-price: accept an unlabelled struck-through price (previous
      // selling price). Skip the `.cmmp30-price` slot — that's the
      // EU-mandated lowest-30-day reference, not a was-price.
      let originalPrice = readRrpPrice();
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
        site: 'fashiondays',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] FashionDays extract error:', error);
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
    // Fashion Days renders a full-width tab content area below the
    // image+price hero. Anchor BEFORE the recommendations carousel
    // (".similar-products") which is the first major section that
    // spans the page width — that puts the widget right after the
    // hero area at the same full width.
    const anchors = [
      '.similar-products',
      '.tab-content.responsive',
      '.product-description-content',
      '.product-information'
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
    ContentScriptBase.loadWidgetCSS();
    await ContentScriptBase.loadWidgetScripts(widgetContainer, product, analysis);
  }

  async function trackAndDisplay() {
    await ContentScriptBase.trackAndDisplay(extractProductData, injectWidget, isProductPage, { enableStorageKey: 'enableFashiondays' });
  }

  ContentScriptBase.setupNavigation(isProductPage, trackAndDisplay, { navigationDelayMs: 2500 });
  await new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  if (isProductPage()) setTimeout(trackAndDisplay, 600);
})();
