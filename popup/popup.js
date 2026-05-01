// Popup logic
(async function () {
  // Initialize i18n immediately
  const i18n = new I18n();
  await i18n.loadTranslations();

  // Get language preference
  const lang = (await chrome.storage.local.get(['language'])).language || 'bg';
  if (i18n.getCurrentLanguage() !== lang) {
    await i18n.setLanguage(lang);
  }

  const t = (key, params) => i18n.t(key, params);

  // Load settings
  async function loadSettings() {
    const settings = await chrome.storage.local.get([
      'language',
      'enableEmag',
      'enableOzone',
      'showWidget'
    ]);

    document.getElementById('language-select').value = settings.language || 'bg';
    document.getElementById('enable-emag').checked = settings.enableEmag !== false;
    document.getElementById('enable-ozone').checked = settings.enableOzone !== false;
    document.getElementById('show-widget').checked = settings.showWidget !== false;

    updateUI();
  }

  // Update UI with translations
  function updateUI() {
    document.getElementById('settings-title').textContent = t('settings.title');
    document.getElementById('language-label').textContent = t('settings.language');
    document.getElementById('enable-emag-label').textContent = t('settings.enableEmag');
    document.getElementById('enable-ozone-label').textContent = t('settings.enableOzone');
    document.getElementById('show-widget-label').textContent = t('settings.showWidget');
    document.getElementById('enable-emag-desc').textContent = t('settings.enableEmagDesc');
    document.getElementById('enable-ozone-desc').textContent = t('settings.enableOzoneDesc');
    document.getElementById('show-widget-desc').textContent = t('settings.showWidgetDesc');
    document.getElementById('storage-title').textContent = t('storage');
    document.getElementById('storage-used-label').textContent = t('settings.storageUsed');
    document.getElementById('tracked-products-label').textContent = t('settings.trackedProducts');
    document.getElementById('followed-products-title').textContent = t('settings.followedProducts');
    document.getElementById('no-products-message').textContent = t('settings.noProducts');
    document.getElementById('cleanup-old').textContent = t('settings.cleanupOld');
    document.getElementById('clear-history').textContent = t('settings.clearHistory');
    document.getElementById('data-title').textContent = t('settings.data') || 'Data';
    document.getElementById('export-data').textContent = t('settings.exportData');
    document.getElementById('import-data').textContent = t('settings.importData');
  }

  // Load and display followed products
  async function loadFollowedProducts() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getAllProducts' }, (response) => {
          resolve(response);
        });
      });

      // Load price targets so we can mark products with an active target.
      let priceTargets = {};
      try {
        const result = await chrome.storage.local.get(['priceTargets']);
        priceTargets = result.priceTargets || {};
      } catch (e) {}

      const products = response?.products || {};
      const productList = document.getElementById('followed-products-list');
      const noProductsMsg = document.getElementById('no-products-message');

      // Clear list safely
      while (productList.firstChild) {
        productList.removeChild(productList.firstChild);
      }

      const productArray = Object.entries(products)
        .filter(([id, product]) => product.isActive)
        .map(([id, product]) => ({ id, ...product }))
        .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

      if (productArray.length === 0) {
        productList.style.display = 'none';
        noProductsMsg.style.display = 'block';
        return;
      }

      productList.style.display = 'block';
      noProductsMsg.style.display = 'none';

      const currency = t('currency') || t('lev') || 'EUR';

      productArray.forEach(product => {
        const latestPrice = product.history && product.history.length > 0
          ? product.history[product.history.length - 1].price
          : 0;
        const previousPrice = product.history && product.history.length > 1
          ? product.history[product.history.length - 2].price
          : latestPrice;

        const trend = latestPrice > previousPrice ? 'up' :
          latestPrice < previousPrice ? 'down' : 'stable';
        const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

        const site = product.site || 'emag';
        const siteLabel = site === 'emag' ? 'EM' : 'OZ';

        // Calculate price range
        const allPrices = product.history ? product.history.map(h => h.price).filter(p => typeof p === 'number' && !isNaN(p)) : [];
        const priceLow = allPrices.length > 0 ? Math.min(...allPrices) : null;
        const priceHigh = allPrices.length > 0 ? Math.max(...allPrices) : null;

        // Create product item with DOM methods (safe from XSS)
        const productItem = document.createElement('div');
        productItem.className = 'product-item';

        // Thumbnail
        if (product.thumbnail) {
          const img = document.createElement('img');
          img.src = product.thumbnail;
          img.alt = product.title;
          img.className = 'product-thumbnail';
          img.onerror = function () { this.style.display = 'none'; };
          productItem.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'product-thumbnail';
          productItem.appendChild(placeholder);
        }

        // Product info
        const productInfo = document.createElement('div');
        productInfo.className = 'product-info';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'product-title';
        titleDiv.title = product.title;
        titleDiv.textContent = product.title;
        productInfo.appendChild(titleDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'product-meta';

        const priceSpan = document.createElement('span');
        priceSpan.className = 'product-price';
        priceSpan.textContent = `${latestPrice.toFixed(2)} ${currency}`;
        metaDiv.appendChild(priceSpan);

        const trendSpan = document.createElement('span');
        trendSpan.className = `product-trend ${trend}`;
        trendSpan.textContent = trendSymbol;
        metaDiv.appendChild(trendSpan);

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `site-badge ${site}`;
        badgeSpan.textContent = siteLabel;
        metaDiv.appendChild(badgeSpan);

        // Price range row
        if (priceLow !== null && priceHigh !== null && allPrices.length > 1) {
          const rangeDiv = document.createElement('div');
          rangeDiv.className = 'product-price-range';
          rangeDiv.textContent = `${priceLow.toFixed(2)} – ${priceHigh.toFixed(2)} ${currency}`;
          productInfo.appendChild(rangeDiv);
        }

        // Price-target indicator (only if a target is set for this product).
        const targetValue = product.url ? priceTargets[product.url] : null;
        if (typeof targetValue === 'number' && targetValue > 0) {
          const targetDiv = document.createElement('div');
          targetDiv.className = 'product-price-target';
          const reached = latestPrice <= targetValue;
          if (reached) targetDiv.classList.add('reached');
          const labelText = t('priceTarget.label') || 'Target:';
          const reachedSuffix = reached ? ` ✓ ${t('priceTarget.reached') || 'Target reached!'}` : '';
          targetDiv.textContent = `🎯 ${labelText} ${targetValue.toFixed(2)} ${currency}${reachedSuffix}`;
          productInfo.appendChild(targetDiv);
        }

        productInfo.appendChild(metaDiv);
        productItem.appendChild(productInfo);

        // Click to open product URL
        if (product.url) {
          productItem.addEventListener('click', (e) => {
            if (e.target.closest('.delete-product-btn')) return;
            chrome.tabs.create({ url: product.url });
          });
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-product-btn';
        deleteBtn.setAttribute('data-product-id', product.id);
        deleteBtn.title = t('settings.deleteProduct');
        deleteBtn.textContent = '🗑️';
        productItem.appendChild(deleteBtn);

        // Add delete handler
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const productId = deleteBtn.getAttribute('data-product-id');
          if (confirm(t('settings.deleteProduct') + '?')) {
            try {
              const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'deleteProduct', productId: productId }, (response) => {
                  resolve(response);
                });
              });

              if (response?.success) {
                productItem.remove();
                updateStorageInfo();
                loadFollowedProducts(); // Refresh list
              } else {
                alert(t('errors.deleteFailed') || 'Error deleting');
              }
            } catch (error) {
              console.error('Error deleting product:', error);
              alert(t('errors.deleteFailed') || 'Error deleting');
            }
          }
        });

        productList.appendChild(productItem);
      });
    } catch (error) {
      console.error('Error loading followed products:', error);
    }
  }

  // Update storage info - uses message passing
  async function updateStorageInfo() {
    try {
      // Get storage usage
      const bytesUsed = await chrome.storage.local.getBytesInUse(null);
      const storageLimit = 10 * 1024 * 1024; // 10MB
      const rawPct = (bytesUsed / storageLimit) * 100;

      // Adaptive precision: tiny values get more decimals so users can see
      // actual usage (e.g. "0.03%") instead of a misleading flat "0%".
      let displayPct;
      if (rawPct === 0) {
        displayPct = '0%';
      } else if (rawPct < 0.1) {
        displayPct = `${rawPct.toFixed(3)}%`;
      } else if (rawPct < 1) {
        displayPct = `${rawPct.toFixed(2)}%`;
      } else if (rawPct < 10) {
        displayPct = `${rawPct.toFixed(1)}%`;
      } else {
        displayPct = `${Math.round(rawPct)}%`;
      }

      document.getElementById('storage-percentage').textContent = displayPct;
      const fillElement = document.getElementById('storage-fill');
      // Cap the visual bar at 100%; raw percentage drives the width otherwise.
      fillElement.style.width = `${Math.min(rawPct, 100)}%`;
      fillElement.className = 'storage-fill';

      if (rawPct < 50) {
        fillElement.classList.add('green');
      } else if (rawPct < 80) {
        fillElement.classList.add('yellow');
      } else {
        fillElement.classList.add('red');
      }

      // Get product count via message passing
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getProductCount' }, (response) => {
          resolve(response);
        });
      });
      const productCount = response?.count || 0;
      document.getElementById('tracked-products-count').textContent = productCount;
    } catch (error) {
      console.error('Error updating storage info:', error);
    }
  }

  // Event listeners
  document.getElementById('language-select').addEventListener('change', async (e) => {
    const lang = e.target.value;
    await chrome.storage.local.set({ language: lang });
    await i18n.setLanguage(lang);
    updateUI();
  });

  document.getElementById('enable-emag').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableEmag: e.target.checked });
  });

  document.getElementById('enable-ozone').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableOzone: e.target.checked });
  });

  document.getElementById('show-widget').addEventListener('change', (e) => {
    chrome.storage.local.set({ showWidget: e.target.checked });
  });

  // Cleanup old products - uses message passing
  document.getElementById('cleanup-old').addEventListener('click', async () => {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'cleanupOldProducts' }, (response) => {
          resolve(response);
        });
      });

      if (response?.success) {
        const cleaned = response.cleaned || 0;
        alert(t('settings.cleanupComplete', { count: cleaned }) || `Cleaned ${cleaned} old products`);
        updateStorageInfo();
        loadFollowedProducts();
      } else {
        alert(t('errors.cleanupFailed') || 'Error cleaning up');
      }
    } catch (error) {
      console.error('Error cleaning up:', error);
      alert(t('errors.cleanupFailed') || 'Error cleaning up');
    }
  });

  // Clear all history - uses message passing
  document.getElementById('clear-history').addEventListener('click', async () => {
    if (confirm(t('settings.clearHistoryConfirm'))) {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'clearAllProducts' }, (response) => {
            resolve(response);
          });
        });

        if (response?.success) {
          alert(t('settings.historyCleared') || 'History cleared');
          updateStorageInfo();
          loadFollowedProducts();
        } else {
          alert(t('errors.clearFailed') || 'Error clearing history');
        }
      } catch (error) {
        console.error('Error clearing history:', error);
        alert(t('errors.clearFailed') || 'Error clearing history');
      }
    }
  });

  // Export data - uses message passing
  document.getElementById('export-data').addEventListener('click', async () => {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'exportData' }, (response) => {
          resolve(response);
        });
      });

      if (response?.success && response.data) {
        const dataStr = JSON.stringify(response.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fake-discount-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert(t('errors.exportFailed') || 'Export error');
      }
    } catch (error) {
      console.error('Error exporting data:', error);
      alert(t('errors.exportFailed') || 'Export error');
    }
  });

  document.getElementById('import-data').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  // Import data - uses message passing
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.priceHistory) {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'importData', data: data }, (response) => {
            resolve(response);
          });
        });

        if (response?.success) {
          const imported = response.imported || 0;
          const skipped = response.skipped || 0;
          const baseMsg = t('settings.dataImported') || 'Data imported';
          const summary = skipped > 0
            ? `${baseMsg} (${imported} imported, ${skipped} skipped as invalid)`
            : `${baseMsg} (${imported})`;
          alert(summary);
          updateStorageInfo();
          loadFollowedProducts();
        } else {
          alert(t('errors.importFailed') || 'Import error');
        }
      } else {
        alert(t('errors.invalidFile') || 'Invalid file');
      }
    } catch (error) {
      console.error('Error importing data:', error);
      alert(t('errors.importFailed') || 'Import error');
    }

    e.target.value = '';
  });

  // Initialize
  loadSettings();
  updateStorageInfo();
  loadFollowedProducts();

  // Refresh when storage changes (e.g. user opened a product page in another tab).
  // Debounced so a burst of writes doesn't trigger a burst of refreshes.
  let refreshTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // Only refresh on changes that affect the popup's UI: per-product keys,
    // the index, or the price-target map. Ignore unrelated key writes.
    const relevant = Object.keys(changes).some(k =>
      k.startsWith('p_') || k === 'product_index' || k === 'priceTargets'
    );
    if (!relevant) return;

    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      updateStorageInfo();
      loadFollowedProducts();
    }, 1000);
  });
})();
