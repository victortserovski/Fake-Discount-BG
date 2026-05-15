// Background service worker
//
// importScripts paths are built via chrome.runtime.getURL() rather
// than as `../utils/...` / `./...` relatives. Spec-wise the relative
// form should resolve against the service worker's own URL
// (chrome-extension://<id>/background/service-worker.js), so
// `../utils/storage.js` → `chrome-extension://<id>/utils/storage.js`.
// In practice some Chrome installs / packaged-zip uploads fail to
// resolve the `..` hop and bail out at boot with
// `[object DOMException]` + "An unknown error occurred when fetching
// the script", which then prevents the service worker from
// registering at all. The absolute URLs from chrome.runtime.getURL
// don't have this failure mode.
try {
  importScripts(chrome.runtime.getURL('utils/storage.js'));
} catch (e) {
  console.error('[Fake Discount] Failed to load storage.js:', e);
}
try {
  importScripts(chrome.runtime.getURL('background/price-tracker.js'));
} catch (e) {
  console.error('[Fake Discount] Failed to load price-tracker.js:', e);
}
try {
  importScripts(chrome.runtime.getURL('utils/supabase-sync.js'));
} catch (e) {
  console.error('[Fake Discount] Failed to load supabase-sync.js:', e);
}

// Storage manager with retry logic
let storageManager = null;
let storageInitAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;

async function initStorageManager() {
  if (storageManager) return true;

  while (storageInitAttempts < MAX_INIT_ATTEMPTS) {
    storageInitAttempts++;
    try {
      if (typeof PriceStorageManager !== 'undefined' && typeof PriceStorageManager === 'function') {
        storageManager = new PriceStorageManager();
        return true;
      }
    } catch (e) {
      console.warn(`PriceStorageManager init attempt ${storageInitAttempts} failed:`, e);
    }
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 500 * storageInitAttempts));
  }
  return false;
}

// Initialize on startup
initStorageManager();

// Notify content scripts when a tab's URL changes (for SPA navigation detection)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    chrome.tabs.sendMessage(tabId, { action: 'urlChanged', url: changeInfo.url }).catch(() => {});
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'trackProduct') {
    handleProductTracking(request.data, sendResponse, sender);
    return true; // Indicates we will send a response asynchronously
  }

  if (request.action === 'getProductAnalysis') {
    handleGetAnalysis(request.productId, sendResponse);
    return true;
  }

  if (request.action === 'getLanguage') {
    (async () => {
      try {
        const result = await chrome.storage.local.get(['language']);
        sendResponse({ language: result.language || 'bg' });
      } catch (e) {
        sendResponse({ language: 'bg' });
      }
    })();
    return true;
  }

  if (request.action === 'getCurrentTabId') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ tabId: tab?.id });
      } catch (e) {
        sendResponse({ tabId: null });
      }
    })();
    return true;
  }

  if (request.action === 'getStorageUsage') {
    (async () => {
      try {
        const bytesUsed = await chrome.storage.local.getBytesInUse(null);
        sendResponse({ bytesUsed: bytesUsed });
      } catch (e) {
        console.error('Error getting storage usage:', e);
        sendResponse({ bytesUsed: 0 });
      }
    })();
    return true;
  }

  if (request.action === 'getExtensionUrl') {
    (async () => {
      try {
        const path = request.path || '';
        const url = chrome.runtime.getURL(path);
        sendResponse({ url: url });
      } catch (e) {
        console.error('Error getting extension URL:', e);
        sendResponse({ url: null });
      }
    })();
    return true;
  }

  if (request.action === 'deleteProduct') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false, error: 'PriceStorageManager not initialized' });
          return;
        }
        const deleted = await storageManager.deleteProduct(request.productId);
        sendResponse({ success: deleted });
      } catch (e) {
        console.error('Error deleting product:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === 'getAllProducts') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false, products: {} });
          return;
        }
        const products = await storageManager.getAllProducts();
        sendResponse({ success: true, products: products });
      } catch (e) {
        console.error('Error getting all products:', e);
        sendResponse({ success: false, products: {} });
      }
    })();
    return true;
  }

  if (request.action === 'getProductCount') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false, count: 0 });
          return;
        }
        const count = await storageManager.getProductCount();
        sendResponse({ success: true, count: count });
      } catch (e) {
        console.error('Error getting product count:', e);
        sendResponse({ success: false, count: 0 });
      }
    })();
    return true;
  }

  if (request.action === 'cleanupOldProducts') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false, cleaned: 0 });
          return;
        }
        const products = await storageManager.getAllProducts();
        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Manual cleanup: delete any product not seen in 90+ days.
        // Only triggered when the user explicitly clicks the button.
        let cleaned = 0;
        for (const [productId, productData] of Object.entries(products)) {
          const lastUpdated = new Date(productData.lastUpdated);
          if (lastUpdated < ninetyDaysAgo) {
            await storageManager.deleteProduct(productId);
            cleaned++;
          }
        }

        sendResponse({ success: true, cleaned: cleaned });
      } catch (e) {
        console.error('Error cleaning up:', e);
        sendResponse({ success: false, cleaned: 0, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === 'clearAllProducts') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false });
          return;
        }
        await storageManager.clearAll();
        sendResponse({ success: true });
      } catch (e) {
        console.error('Error clearing all:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === 'exportData') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false, data: null });
          return;
        }
        const products = await storageManager.getAllProducts();
        sendResponse({ success: true, data: { priceHistory: products } });
      } catch (e) {
        console.error('Error exporting:', e);
        sendResponse({ success: false, data: null, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === 'importData') {
    (async () => {
      try {
        if (!storageManager) {
          sendResponse({ success: false });
          return;
        }
        const products = request.data?.priceHistory;
        if (!products || typeof products !== 'object' || Array.isArray(products)) {
          sendResponse({ success: false, error: 'invalidShape' });
          return;
        }

        let imported = 0;
        let skipped = 0;
        for (const [productId, productData] of Object.entries(products)) {
          if (!isValidImportedProduct(productId, productData)) {
            skipped++;
            continue;
          }
          // Sanitize: keep only fields we know about, drop bad history rows.
          const cleaned = sanitizeImportedProduct(productData);
          await storageManager.importProduct(productId, cleaned);
          imported++;
        }
        sendResponse({ success: true, imported, skipped });
      } catch (e) {
        console.error('Error importing:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// Hosts the extension supports. Used to reject malicious imported URLs.
const SUPPORTED_HOSTS = new Set([
  'emag.bg', 'www.emag.bg',
  'ozone.bg', 'www.ozone.bg',
  'notino.bg', 'www.notino.bg',
  'technopolis.bg', 'www.technopolis.bg',
  'technomarket.bg', 'www.technomarket.bg',
  'zora.bg', 'www.zora.bg',
  'ardes.bg', 'www.ardes.bg',
  'plesio.bg', 'www.plesio.bg',
  'aboutyou.bg', 'www.aboutyou.bg',
  'answear.bg', 'www.answear.bg',
  'decathlon.bg', 'www.decathlon.bg',
  'dm-drogeriemarkt.bg', 'www.dm-drogeriemarkt.bg',
  'fashiondays.bg', 'www.fashiondays.bg',
  'lillydrogerie.bg', 'www.lillydrogerie.bg',
  'mr-bricolage.bg', 'www.mr-bricolage.bg',
  'obuvki.bg', 'www.obuvki.bg',
  'praktiker.bg', 'www.praktiker.bg',
  'sopharmacy.bg', 'www.sopharmacy.bg',
  'sportdepot.bg', 'www.sportdepot.bg',
  'ebag.bg', 'www.ebag.bg'
]);

// Returns true iff the URL is an https:// link to one of the supported
// store domains. Used to reject malicious or off-domain entries in
// imported backup files — otherwise an attacker who tricks a user into
// importing a crafted JSON could store arbitrary `product.url` values
// that the popup would then open with `chrome.tabs.create`.
function isSupportedProductUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return SUPPORTED_HOSTS.has(u.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

// Returns true iff the thumbnail URL is a plain https:// link. We can't
// restrict thumbnails to the store domain (most products serve images
// from CDNs like cdn.ozone.bg, fdcdn.akamaized.net) so we only enforce
// the scheme — no `javascript:`, `data:`, or `http:` URLs.
function isSafeThumbnailUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Validate that an imported product has the minimum required shape AND
// that its URL belongs to a supported store domain.
function isValidImportedProduct(productId, p) {
  if (typeof productId !== 'string' || !productId) return false;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (!Array.isArray(p.history)) return false;
  // Reject entries whose URL doesn't match a supported store. Protects
  // against malicious backup files that could otherwise inject arbitrary
  // navigation targets (popup opens product.url with chrome.tabs.create).
  if (!isSupportedProductUrl(p.url)) return false;
  // At least one history row must be a valid {date, price} entry.
  return p.history.some(h =>
    h && typeof h === 'object' &&
    typeof h.date === 'string' && !isNaN(new Date(h.date).getTime()) &&
    typeof h.price === 'number' && isFinite(h.price) && h.price > 0
  );
}

// Strip unknown fields and drop malformed history rows from imported data.
function sanitizeImportedProduct(p) {
  const history = p.history
    .filter(h =>
      h && typeof h === 'object' &&
      typeof h.date === 'string' && !isNaN(new Date(h.date).getTime()) &&
      typeof h.price === 'number' && isFinite(h.price) && h.price > 0
    )
    .map(h => ({
      date: h.date,
      price: h.price,
      originalPrice: typeof h.originalPrice === 'number' && isFinite(h.originalPrice) ? h.originalPrice : null,
      discount: typeof h.discount === 'number' && isFinite(h.discount) ? h.discount : null
    }));

  return {
    // URL has already passed `isSupportedProductUrl` in the validator.
    url: typeof p.url === 'string' ? p.url : '',
    title: typeof p.title === 'string' ? p.title : '',
    site: ['emag','ozone','notino','technopolis','technomarket','zora','ardes','plesio','aboutyou','answear','decathlon','dm','fashiondays','lilly','bricolage','obuvki','praktiker','sopharmacy','sportdepot','ebag'].includes(p.site) ? p.site : 'emag',
    // Thumbnails come from many merchant CDNs; we can only require https://.
    thumbnail: isSafeThumbnailUrl(p.thumbnail) ? p.thumbnail : null,
    ean: typeof p.ean === 'string' && /^\d{8,14}$/.test(p.ean) ? p.ean : null,
    history: history,
    firstSeen: typeof p.firstSeen === 'string' ? p.firstSeen : history[0]?.date || '',
    lastUpdated: typeof p.lastUpdated === 'string' ? p.lastUpdated : history[history.length - 1]?.date || '',
    isActive: p.isActive !== false
  };
}

async function handleProductTracking(productData, sendResponse, sender) {
  // Try to initialize if not ready
  if (!storageManager) {
    const initialized = await initStorageManager();
    if (!initialized) {
      sendResponse({
        success: false,
        error: 'PriceStorageManager not initialized'
      });
      return;
    }
  }

  try {
    const productId = productData.id;

    // Determine site from URL or productId
    const site = productData.site || (
      productId.startsWith('emag_') ? 'emag' :
      productId.startsWith('notino_') ? 'notino' :
      productId.startsWith('technopolis_') ? 'technopolis' :
      productId.startsWith('technomarket_') ? 'technomarket' :
      productId.startsWith('zora_') ? 'zora' :
      productId.startsWith('ardes_') ? 'ardes' :
      productId.startsWith('plesio_') ? 'plesio' :
      productId.startsWith('aboutyou_') ? 'aboutyou' :
      productId.startsWith('answear_') ? 'answear' :
      productId.startsWith('decathlon_') ? 'decathlon' :
      productId.startsWith('dm_') ? 'dm' :
      productId.startsWith('fashiondays_') ? 'fashiondays' :
      productId.startsWith('lilly_') ? 'lilly' :
      productId.startsWith('bricolage_') ? 'bricolage' :
      productId.startsWith('obuvki_') ? 'obuvki' :
      productId.startsWith('praktiker_') ? 'praktiker' :
      productId.startsWith('sopharmacy_') ? 'sopharmacy' :
      productId.startsWith('sportdepot_') ? 'sportdepot' :
      productId.startsWith('ebag_') ? 'ebag' :
      'ozone'
    );

    // Save/update product in storage - returns the updated product directly
    const product = await storageManager.saveProduct(productId, {
      url: productData.url,
      title: productData.title,
      price: productData.price,
      originalPrice: productData.originalPrice,
      discount: productData.discount,
      site: site,
      thumbnail: productData.thumbnail || null,
      ean: productData.ean || null
    });

    // Best-effort write-through to Supabase. Fire-and-forget — never block
    // local save or widget render on the network.
    if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isConfigured()) {
      const latest = product.history && product.history.length > 0
        ? product.history[product.history.length - 1]
        : null;
      if (latest) {
        SupabaseSync.pushDatapoint({
          productId,
          site,
          url: product.url,
          title: product.title,
          thumbnail: product.thumbnail,
          ean: product.ean,
          price: latest.price,
          originalPrice: latest.originalPrice,
          discount: latest.discount,
          date: latest.date
        });
      }
    }

    // Perform fake discount analysis
    const analysis = detectFakeDiscount({
      currentPrice: productData.price,
      originalPrice: productData.originalPrice,
      history: product.history || []
    });

    // Set badge on extension icon based on verdict
    try {
      const tabId = sender?.tab?.id;
      if (analysis.verdict === 'FAKE_DISCOUNT') {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId });
      } else if (analysis.verdict === 'REAL_DEAL') {
        chrome.action.setBadgeText({ text: '✓', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId });
      } else {
        chrome.action.setBadgeText({ text: '', tabId });
      }
    } catch (e) {
      // Badge API may not be available in all contexts
    }

    // Check price targets and notify (per-tab so it doesn't override other tabs)
    try {
      const tabId = sender?.tab?.id;
      const targetResult = await chrome.storage.local.get(['priceTargets']);
      const targets = targetResult.priceTargets || {};
      const productUrl = productData.url || '';
      if (targets[productUrl] && productData.price <= targets[productUrl]) {
        chrome.action.setBadgeText({ text: '🎯', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#3B82F6', tabId });
      }
    } catch (e) {}

    sendResponse({
      success: true,
      product: product,
      analysis: analysis
    });
  } catch (error) {
    console.error('Error tracking product:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

async function handleGetAnalysis(productId, sendResponse) {
  // Try to initialize if not ready
  if (!storageManager) {
    const initialized = await initStorageManager();
    if (!initialized) {
      sendResponse({
        success: false,
        error: 'PriceStorageManager not initialized'
      });
      return;
    }
  }

  try {
    const product = await storageManager.getProduct(productId);

    if (!product) {
      sendResponse({
        success: false,
        error: 'Product not found'
      });
      return;
    }

    // Get latest price from history
    const latestEntry = product.history[product.history.length - 1];
    const currentPrice = latestEntry ? latestEntry.price : null;
    const originalPrice = latestEntry ? latestEntry.originalPrice : null;

    // Perform analysis
    const analysis = detectFakeDiscount({
      currentPrice: currentPrice || 0,
      originalPrice: originalPrice,
      history: product.history || []
    });

    sendResponse({
      success: true,
      product: product,
      analysis: analysis
    });
  } catch (error) {
    console.error('Error getting analysis:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Auto-cleanup intentionally disabled. Storage retention is unlimited so the
// price history stays accurate. The popup's "Cleanup old" button still lets
// the user delete products not seen for 90+ days on demand.
