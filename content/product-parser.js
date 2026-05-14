// Shared product data extraction utilities
class ProductParser {
  // Extract product ID from URL
  static extractProductId(url) {
    try {
      const urlObj = new URL(url);

      // Ozone: check first since Ozone also uses /product/ which would match the Emag regex
      const ozoneMatch = url.match(/ozone\.bg.*?\/(?:product|p)\/([^\/\?]+)/);
      if (ozoneMatch) {
        return `ozone_${ozoneMatch[1]}`;
      }

      // Technopolis: product URLs end in `/p/<numeric-sku>`, e.g.
      //   /bg/Televizori/Televizor-SMARTTECH-32HW01V/p/13682
      // Categories use /c/<id> instead, so requiring `/p/` makes this
      // a reliable product-only signature.
      const technopolisMatch = url.match(/technopolis\.bg\/.+\/p\/(\d+)(?:[/?#]|$)/i);
      if (technopolisMatch) {
        return `technopolis_${technopolisMatch[1]}`;
      }

      // Notino: /<brand>/<product-slug>/p-<variantId>/  (variant page)
      // Or fall back to the brand+slug pair when no /p-XX/ segment is present
      // (the canonical default-variant URL).
      const notinoVariantMatch = url.match(/notino\.bg\/[^\/]+\/[^\/]+\/p-([0-9]+)/i);
      if (notinoVariantMatch) {
        return `notino_${notinoVariantMatch[1]}`;
      }
      const notinoSlugMatch = url.match(/notino\.bg\/([^\/?#]+)\/([^\/?#]+)\/?(?:[?#]|$)/i);
      if (notinoSlugMatch) {
        return `notino_${notinoSlugMatch[1]}_${notinoSlugMatch[2]}`;
      }

      // Plesio: /<category>-c-<categoryId>/<slug>-p-<productId>.html
      // Match before Emag because Emag's /(p|pd|product)/ regex would mis-fire
      // on Plesio URLs that don't actually contain a /p/ segment but do contain
      // -p- as part of the slug-id separator.
      const plesioMatch = url.match(/plesio\.bg\/.+-p-(\d+)\.html/i);
      if (plesioMatch) {
        return `plesio_${plesioMatch[1]}`;
      }

      // Praktiker: /bg/<category>/<SLUG-IN-CAPS>/p/<numericId>
      const praktikerMatch = url.match(/praktiker\.bg\/.+\/p\/(\d+)(?:[/?#]|$)/i);
      if (praktikerMatch) {
        return `praktiker_${praktikerMatch[1]}`;
      }

      // Mr.Bricolage: /<slug>/p/<numericId>
      const bricolageMatch = url.match(/mr-bricolage\.bg\/.+\/p\/(\d+)(?:[/?#]|$)/i);
      if (bricolageMatch) {
        return `bricolage_${bricolageMatch[1]}`;
      }

      // Sopharmacy: /bg/product/<longNumericId>
      const sopharmacyMatch = url.match(/sopharmacy\.bg\/[a-z]{2}\/product\/(\d+)(?:[/?#]|$)/i);
      if (sopharmacyMatch) {
        return `sopharmacy_${sopharmacyMatch[1]}`;
      }

      // Lilly Drogerie: /<slug>(-<id>)?  — trailing 6-digit id when present
      const lillyMatch = url.match(/lillydrogerie\.bg\/([^?#]+?)(?:[/?#]|$)/i);
      if (lillyMatch) {
        const tail = lillyMatch[1].match(/-(\d{4,8})$/);
        return tail ? `lilly_${tail[1]}` : `lilly_${lillyMatch[1].replace(/[^a-z0-9-]/gi, '')}`;
      }

      // dm-drogeriemarkt: /p/d/<numericId>/<slug>
      const dmMatch = url.match(/dm-drogeriemarkt\.bg\/p\/d\/(\d+)/i);
      if (dmMatch) {
        return `dm_${dmMatch[1]}`;
      }

      // Decathlon: /p/<numericId>-<numericId>-<slug>.html — first numeric id is stable
      const decathlonMatch = url.match(/decathlon\.bg\/p\/(\d+)/i);
      if (decathlonMatch) {
        return `decathlon_${decathlonMatch[1]}`;
      }

      // Sport Depot: /product/<slug>-<id>-basic.html?i=<num> — query `i` param is stable
      const sportdepotMatch = url.match(/sportdepot\.bg\/product\/[^?#]+\.html\?[^#]*\bi=(\d+)/i);
      if (sportdepotMatch) {
        return `sportdepot_${sportdepotMatch[1]}`;
      }
      // Fallback for sportdepot without query: use the slug
      const sportdepotSlugMatch = url.match(/sportdepot\.bg\/product\/([^?#/]+)\.html/i);
      if (sportdepotSlugMatch) {
        return `sportdepot_${sportdepotSlugMatch[1]}`;
      }

      // Fashion Days: /p/<slug-with-cyrillic>-p<numericId>-<variant>/?gtm_data=...
      // The product id sits as `p<digits>` near the end of the slug.
      const fashiondaysMatch = url.match(/fashiondays\.bg\/p\/.*?-p(\d{6,})-\d+/i);
      if (fashiondaysMatch) {
        return `fashiondays_${fashiondaysMatch[1]}`;
      }

      // About You: /p/<brand>/<slug>-<numericId>
      const aboutyouMatch = url.match(/aboutyou\.bg\/p\/[^/]+\/[^/]+-(\d+)(?:[/?#]|$)/i);
      if (aboutyouMatch) {
        return `aboutyou_${aboutyouMatch[1]}`;
      }

      // Answear: /p/<slug>-<numericId>
      const answearMatch = url.match(/answear\.bg\/p\/[^/]+-(\d{4,})(?:[/?#]|$)/i);
      if (answearMatch) {
        return `answear_${answearMatch[1]}`;
      }

      // Obuvki: /p/<slug>-<EAN-13> — last 13-digit number is the EAN
      const obuvkiMatch = url.match(/obuvki\.bg\/p\/.*?-(\d{13})(?:[/?#]|$)/i);
      if (obuvkiMatch) {
        return `obuvki_${obuvkiMatch[1]}`;
      }

      // eBag: /<slug>/<numericId> — trailing 4-7-digit number is the ID
      const ebagMatch = url.match(/ebag\.bg\/[^/]+\/(\d{4,7})(?:[/?#]|$)/i);
      if (ebagMatch) {
        return `ebag_${ebagMatch[1]}`;
      }

      // Technomarket: /<category>/<slug>-<8-digit-code>
      // The 8-digit suffix is the canonical product code (also exposed in
      // JSON-LD `sku` and inline data attributes).
      const technomarketMatch = url.match(/technomarket\.bg\/[^\/]+\/[a-z0-9-]+-(\d{8})(?:[/?#]|$)/i);
      if (technomarketMatch) {
        return `technomarket_${technomarketMatch[1]}`;
      }

      // Ardes: /product/<slug>-<numericId>  (4–7 trailing digits)
      // Strip query string before matching since Ardes appends `?rlv_rid=...`
      // tracking params on referrer hits.
      const ardesMatch = url.match(/ardes\.bg\/product\/.+-(\d{4,7})(?:[\/?#]|$)/i);
      if (ardesMatch) {
        return `ardes_${ardesMatch[1]}`;
      }

      // Zora: /product/<slug>  — slug-based since the numeric data-product-id
      // requires JS to populate; the URL slug is canonical and stable.
      const zoraMatch = url.match(/zora\.bg\/product\/([^\/?#]+)/i);
      if (zoraMatch) {
        return `zora_${zoraMatch[1]}`;
      }

      // Emag: /p/PRODUCT_ID/ or /pd/PRODUCT_ID/
      const emagMatch = url.match(/\/(?:p|pd|product)\/([^\/]+)/);
      if (emagMatch) {
        return `emag_${emagMatch[1]}`;
      }

      // Fallback: use full URL path as ID
      return urlObj.hostname.replace('.', '_') + '_' + urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_');
    } catch (error) {
      console.error('Error extracting product ID:', error);
      return `product_${Date.now()}`;
    }
  }

  // Parse price from text
  // Handles formats: "999,00 лв.", "1 199.00 лв.", "510,78 €", "1 199,00 лв."
  static parsePrice(priceText) {
    if (!priceText) return null;

    let cleaned = priceText.trim();

    // Remove currency symbols and text, keep numbers, spaces, commas, dots
    // Use [\s\u00A0] to also match non-breaking spaces common in Bulgarian price formatting
    cleaned = cleaned.replace(/[^\d,\s\u00A0.]+/g, '').trim();

    // Detect format: if it has both comma and dot, dot is decimal, comma is thousand separator
    // If only comma, it's decimal separator
    // If only dot, it's decimal separator
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
      // Format like "1 199,00" or "1.199,00" - comma is decimal
      // Remove dots (they're thousand separators), replace comma with dot
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
      // Format like "999,00" - comma is decimal
      cleaned = cleaned.replace(',', '.');
    } else if (!hasComma && hasDot) {
      // Format like "1 199.00" - dot is decimal, keep it
      // Just remove spaces
      cleaned = cleaned.replace(/[\s\u00A0]+/g, '');
    } else {
      // No decimal separator, just remove spaces
      cleaned = cleaned.replace(/[\s\u00A0]+/g, '');
    }

    // Remove any remaining spaces and non-breaking spaces (thousand separators)
    cleaned = cleaned.replace(/[\s\u00A0]+/g, '');

    const price = parseFloat(cleaned);

    // Validate price range (0.01 to 1,000,000)
    if (isNaN(price) || price < 0.01 || price > 1000000) {
      return null;
    }

    return Math.round(price * 100) / 100;
  }

  // Calculate discount percentage
  static calculateDiscount(originalPrice, currentPrice) {
    if (!originalPrice || !currentPrice || originalPrice <= currentPrice) {
      return null;
    }
    return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  // Validate a GTIN-8 / GTIN-12 / GTIN-13 / GTIN-14 check digit. Used to
  // filter out random digit runs picked up by the visible-DOM scan (phone
  // numbers, internal product codes, order IDs) — only real barcodes pass.
  static validateGTIN(code) {
    if (typeof code !== 'string') return false;
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
    const digits = code.split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    let mult = 3;
    for (let i = digits.length - 1; i >= 0; i--) {
      sum += digits[i] * mult;
      mult = mult === 3 ? 1 : 3;
    }
    const computed = (10 - (sum % 10)) % 10;
    return computed === check;
  }

  // Generic EAN/GTIN extractor — site-agnostic, runs all tiers in order
  // and returns the first valid barcode found. Returns null if none.
  // Tiers, in order of reliability:
  //   1. schema.org Product JSON-LD (gtin13/12/8/14/gtin/mpn) — used by
  //      Notino out of the box; sometimes by Emag/Ozone.
  //   2. <meta> tags (product:gtin, og:upc, etc.) — common on legacy
  //      Magento-based shops.
  //   3. Microdata attributes ([itemprop="gtin13"] etc.).
  //   4. Visible-DOM text scan for "EAN: 1234567890123" / "Баркод: ..." /
  //      "Barcode: ..." patterns — covers Emag/Ozone product spec tables.
  // Every candidate goes through validateGTIN(), so a 13-digit phone or
  // order ID will not be misidentified as an EAN.
  static extractEAN(doc) {
    const root = doc || document;

    // Tier 1: JSON-LD Product
    try {
      const scripts = root.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        let data;
        try { data = JSON.parse(s.textContent); } catch (_) { continue; }
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          if (item['@type'] !== 'Product') continue;
          const candidates = [item.gtin13, item.gtin12, item.gtin8, item.gtin14, item.gtin, item.mpn];
          for (const c of candidates) {
            if (c == null) continue;
            const v = String(c).replace(/\s+/g, '');
            if (ProductParser.validateGTIN(v)) return v;
          }
        }
      }
    } catch (_) { /* fall through to next tier */ }

    // Tier 2: <meta> tags (Open Graph / product schema)
    const metaSelectors = [
      'meta[property="product:gtin"]',
      'meta[property="product:ean"]',
      'meta[property="og:upc"]',
      'meta[property="product:retailer_item_id"]',
      'meta[name="ean"]',
      'meta[name="gtin"]'
    ];
    for (const sel of metaSelectors) {
      const el = root.querySelector(sel);
      const v = el && el.getAttribute('content') ? el.getAttribute('content').trim() : '';
      if (v && ProductParser.validateGTIN(v)) return v;
    }

    // Tier 3: schema.org microdata
    const microSelectors = [
      '[itemprop="gtin13"]',
      '[itemprop="gtin12"]',
      '[itemprop="gtin8"]',
      '[itemprop="gtin14"]',
      '[itemprop="gtin"]'
    ];
    for (const sel of microSelectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const v = (el.getAttribute('content') || el.textContent || '').trim().replace(/\s+/g, '');
      if (v && ProductParser.validateGTIN(v)) return v;
    }

    // Tier 4: visible-DOM text scan
    // Restrict to body innerText to skip <script> / <style> contents.
    try {
      const text = root.body && root.body.innerText ? root.body.innerText : '';
      if (text) {
        // Label keywords: English, Bulgarian, Cyrillic. Avoid generic words
        // like "Код" — too broad and would match internal product IDs.
        const re = /(?:EAN(?:-?13)?|GTIN(?:-?(?:8|12|13|14))?|UPC|Barcode|Баркод|Баркод(?:а)?|EAN\s*код)\s*[:#\-]?\s*(\d{8,14})/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          const candidate = m[1];
          if (ProductParser.validateGTIN(candidate)) return candidate;
        }
      }
    } catch (_) { /* nothing else to try */ }

    return null;
  }

  // Wait for element to appear in DOM
  static async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }
}
