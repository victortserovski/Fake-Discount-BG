// Background service worker
try {
  importScripts('../utils/storage.js');
} catch (e) {
  console.error('[Fake Discount] Failed to load storage.js:', e);
}
try {
  importScripts('price-tracker.js');
} catch (e) {
  console.error('[Fake Discount] Failed to load price-tracker.js:', e);
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

// Validate that an imported product has the minimum required shape.
function isValidImportedProduct(productId, p) {
  if (typeof productId !== 'string' || !productId) return false;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (!Array.isArray(p.history)) return false;
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
    url: typeof p.url === 'string' ? p.url : '',
    title: typeof p.title === 'string' ? p.title : '',
    site: p.site === 'emag' || p.site === 'ozone' ? p.site : 'emag',
    thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : null,
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
    const site = productData.site || (productId.startsWith('emag_') ? 'emag' : 'ozone');

    // Save/update product in storage - returns the updated product directly
    const product = await storageManager.saveProduct(productId, {
      url: productData.url,
      title: productData.title,
      price: productData.price,
      originalPrice: productData.originalPrice,
      discount: productData.discount,
      site: site,
      thumbnail: productData.thumbnail || null
    });

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
