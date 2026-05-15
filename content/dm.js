// Content script for dm-drogeriemarkt.bg
// Heavy SPA — saved HTML samples are 10KB shells with no product data
// rendered server-side. The adapter waits for hydration, then tries
// schema.org microdata first (Vue/Nuxt typically emits it after mount),
// then falls back to scanning visible "X,XX €" tokens inside the
// product detail container.
//
// Best-effort: without a live render sample we can't lock in stable
// selectors. If extraction breaks on a real visit, the user can send
// a saved page and we tighten the selectors.
(async function () {
  const settings = await chrome.storage.local.get(['enableDm']);
  if (settings.enableDm === false) return;

  function isProductPage() {
    const url = window.location.href;
    return /dm-drogeriemarkt\.bg\/p\/d\/\d+/i.test(url);
  }

  function parseEurFromText(txt) {
    if (!txt) return null;
    const m = txt.match(/(\d[\d\s., ]*)\s*€/);
    return m ? ProductParser.parsePrice(m[1]) : null;
  }

  async function extractProductData() {
    try {
      // Generous wait for SPA hydration.
      await ProductParser.waitForElement('h1, [data-dmid], [itemprop="price"], [class*="price"]', 8000).catch(() => { });

      const url = window.location.href;
      const productId = ProductParser.extractProductId(url);

      // Title — H1 first, then microdata.
      let title = '';
      const h1 = document.querySelector('h1');
      if (h1) title = h1.textContent.trim();
      if (!title) {
        const og = document.querySelector('meta[property="og:title"]');
        if (og && og.content) title = og.content.trim();
      }

      // Price: microdata first, then any element whose textContent
      // contains an EUR amount inside the product-detail region.
      let price = null;
      const priceMeta = document.querySelector('meta[itemprop="price"]');
      const currencyMeta = document.querySelector('meta[itemprop="priceCurrency"]');
      if (priceMeta && priceMeta.content && (!currencyMeta || (currencyMeta.content || '').toUpperCase() === 'EUR')) {
        const parsed = parseFloat(priceMeta.content);
        if (Number.isFinite(parsed) && parsed > 0) price = Math.round(parsed * 100) / 100;
      }
      if (price == null) {
        // Scan plausible price elements. Prefer ones inside a product
        // detail container if present.
        const region = document.querySelector('[data-dmid="product-detail"], [class*="ProductDetail"], main') || document.body;
        const candidates = region.querySelectorAll('[data-dmid*="price"], [class*="price"], [itemprop="price"]');
        for (const el of candidates) {
          const p = parseEurFromText(el.textContent);
          if (p && p > 0) { price = p; break; }
        }
      }

      // OOS — best-effort. dm renders client-side and we don't have a
      // confirmed OOS sample, so we check several signals:
      //   1. JSON-LD `availability` if any LD block is emitted post-mount.
      //   2. Common Bulgarian OOS phrases within the product-detail region.
      //   3. Absence of a buy/add-to-cart button anywhere on the page.
      // Order matters: positive signals first, then a buy-button-absence
      // fallback (most conservative — if dm renders a buy button on every
      // page including OOS variants we'd never fire OOS, but if they
      // hide the button on OOS, this catches it).
      const ldBlocks = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of ldBlocks) {
        try {
          const d = JSON.parse(s.textContent);
          const cs = Array.isArray(d) ? d : [d];
          for (const c of cs) {
            if (c && c['@type'] === 'Product') {
              const off = Array.isArray(c.offers) ? c.offers[0] : c.offers;
              if (off && /OutOfStock|Discontinued/i.test(off.availability || '')) price = null;
            }
          }
        } catch (_) { /* skip */ }
      }
      const detail = document.querySelector('[data-dmid="product-detail"], [data-dmid="pdp"], [class*="ProductDetail"], [class*="Pdp"]') || document.body;
      if (price != null && detail) {
        const detailText = detail.textContent || '';
        if (/Изчерпан|Няма наличност|Не е наличен|Извън наличност|Sold\s*out|Currently\s*unavailable/i.test(detailText)) {
          price = null;
        }
      }
      if (price != null) {
        // Buy-button absence guard — if no element looks like a purchase CTA,
        // treat as OOS. Tight enough to avoid false positives on dm-style
        // shells that always render some clickable.
        const buyish = document.querySelector(
          'button[data-dmid*="add-to-cart"], button[data-dmid*="buy"], ' +
          '[data-dmid*="add-to-cart"], [data-dmid*="buy-button"], ' +
          'button.add-to-cart, button.buy-button, button[type="submit"]'
        );
        if (!buyish && /\/p\/d\/\d+/.test(window.location.pathname)) {
          // Only fire when we're confident we're on a real PDP (URL pattern
          // confirms) and no buy CTA is present.
          // price = null;  // disabled: too aggressive without live samples
        }
      }

      // Discount detection — dm shows old prices with strike-through.
      // Best-effort: any element with class containing "old" or "rrp" near price.
      let originalPrice = null;
      const oldEl = document.querySelector('[class*="oldPrice"], [class*="rrp"], [data-dmid*="rrp"], s, del');
      if (oldEl) {
        const p = parseEurFromText(oldEl.textContent);
        if (p && p > 0 && (price == null || p > price)) originalPrice = p;
      }
      const discount = originalPrice ? ProductParser.calculateDiscount(originalPrice, price) : null;

      let thumbnail = null;
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) thumbnail = og.content;

      return {
        id: productId,
        url: url,
        title: title,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        site: 'dm',
        thumbnail: thumbnail,
        ean: ProductParser.extractEAN(document)
      };
    } catch (error) {
      console.error('[Fake Discount] dm extract error:', error);
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
    // Defensive layering. dm's SPA shell uses absolute/fixed-position
    // sub-trees and z-index stacks for header/menu; without these we
    // saw the widget render BEHIND product content AND in front of the
    // fixed top menu. Force the widget into its own stacking context
    // and clamp it to the document flow.
    widgetContainer.style.position = 'relative';
    widgetContainer.style.zIndex = '0';
    widgetContainer.style.isolation = 'isolate';

    let inserted = false;
    // dm is a heavy SPA. The live DOM uses `data-dmid="..."` attributes
    // but exact values are hard to predict — try several common
    // patterns including substring matches (`*=`) before falling
    // back to wildcard class names. Priority: description block
    // (right under the hero) → tabs section → recommendation rails.
    const anchors = [
      // Right under hero — description / info
      '[data-dmid="product-description"]',
      '[data-dmid="pdp-description"]',
      '[data-dmid*="description"]',
      '[data-dmid*="product-info"]',
      '[data-dmid*="ProductInfo"]',
      '[class*="ProductDescription"]',
      '[class*="ProductInfo"]:not([class*="Card"])',
      // Mid-page — tabs
      '[data-dmid="product-detail-tabs"]',
      '[data-dmid*="tabs"]',
      '[data-dmid*="Tabs"]',
      '[class*="ProductTabs"]',
      '[class*="PdpTabs"]',
      // Lower — recommendations
      '[data-dmid="product-recommendation"]',
      '[data-dmid*="recommend"]',
      '[data-dmid*="related"]',
      '[data-dmid*="similar"]',
      '[class*="ProductRecommendation"]',
      '[class*="RelatedProducts"]',
      '[class*="SimilarProducts"]'
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
      // Append inside the PDP container if we found it.
      const pdp = document.querySelector('[data-dmid="product-detail"], [data-dmid="pdp"], [class*="ProductDetail"], [class*="Pdp"]');
      if (pdp) {
        pdp.appendChild(widgetContainer);
        inserted = true;
      }
    }
    if (!inserted) {
      // No safe anchor — skip rather than dump the widget into an
      // unknown shell where it overlaps the layout (z-index defense
      // helps but doesn't fix wrong positioning).
      console.warn('[Fake Discount] dm: no product-detail anchor found; widget not injected. Send a saved page if this persists.');
      return;
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
  // SPA shell: wait long for the product render.
  await new Promise(resolve => setTimeout(resolve, 2500));
  if (isProductPage()) setTimeout(trackAndDisplay, 1500);
})();
