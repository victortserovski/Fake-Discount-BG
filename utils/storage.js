// Storage utilities for price history
// Refactored to use per-product keys for O(1) access instead of O(N)
(function () {
  'use strict';

  // Determine global scope - prioritize self for service workers
  let _globalScope;
  if (typeof self !== 'undefined') {
    _globalScope = self;
  } else if (typeof window !== 'undefined') {
    _globalScope = window;
  } else if (typeof global !== 'undefined') {
    _globalScope = global;
  } else {
    _globalScope = this;
  }

  // Storage key prefixes
  const PRODUCT_PREFIX = 'p_';
  const INDEX_KEY = 'product_index';
  const OLD_STORAGE_KEY = 'priceHistory';
  const MIGRATION_FLAG = 'storage_migrated_v2';

  try {
    // Named PriceStorageManager to avoid conflict with the built-in Web StorageManager API
    _globalScope.PriceStorageManager = class PriceStorageManager {
      constructor() {
        this.MAX_PRODUCTS = 10000;
        this._migrationPromise = null;
        // Per-product write queue: serializes writes to the same product so two
        // overlapping saveProduct calls can't clobber each other.
        this._writeQueue = new Map();
      }

      // Ensure migration has completed before any operation
      async ensureMigrated() {
        if (this._migrationPromise) {
          return this._migrationPromise;
        }

        const result = await chrome.storage.local.get([MIGRATION_FLAG]);
        if (result[MIGRATION_FLAG]) {
          return true;
        }

        this._migrationPromise = this._migrateFromOldFormat();
        return this._migrationPromise;
      }

      // Migrate from old monolithic format to per-product keys
      async _migrateFromOldFormat() {
        try {
          const result = await chrome.storage.local.get([OLD_STORAGE_KEY]);
          const oldProducts = result[OLD_STORAGE_KEY];

          if (!oldProducts || Object.keys(oldProducts).length === 0) {
            // No old data, just mark as migrated
            await chrome.storage.local.set({ [MIGRATION_FLAG]: true });
            return true;
          }

          console.log(`[PriceStorageManager] Migrating ${Object.keys(oldProducts).length} products to new format...`);

          // Build new storage structure
          const newData = {};
          const productIds = [];

          for (const [productId, productData] of Object.entries(oldProducts)) {
            const key = PRODUCT_PREFIX + productId;
            newData[key] = productData;
            productIds.push(productId);
          }

          // Add index and migration flag
          newData[INDEX_KEY] = productIds;
          newData[MIGRATION_FLAG] = true;

          // Write all new keys
          await chrome.storage.local.set(newData);

          // Remove old monolithic key
          await chrome.storage.local.remove([OLD_STORAGE_KEY]);

          console.log('[PriceStorageManager] Migration complete');
          return true;
        } catch (error) {
          console.error('[PriceStorageManager] Migration failed:', error);
          return false;
        }
      }

      // Get product index (list of all product IDs)
      async getProductIndex() {
        await this.ensureMigrated();
        const result = await chrome.storage.local.get([INDEX_KEY]);
        return result[INDEX_KEY] || [];
      }

      // Get all products (for popup display, export, etc.)
      async getAllProducts() {
        await this.ensureMigrated();

        const index = await this.getProductIndex();
        if (index.length === 0) {
          return {};
        }

        // Fetch all product keys at once
        const keys = index.map(id => PRODUCT_PREFIX + id);
        const result = await chrome.storage.local.get(keys);

        // Reconstruct products object
        const products = {};
        for (const id of index) {
          const key = PRODUCT_PREFIX + id;
          if (result[key]) {
            products[id] = result[key];
          }
        }

        return products;
      }

      // Get a specific product - O(1) operation
      async getProduct(productId) {
        await this.ensureMigrated();
        const key = PRODUCT_PREFIX + productId;
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
      }

      // Save or update a product - O(1) operation.
      // Serialized per-product via _writeQueue so concurrent calls don't race.
      async saveProduct(productId, productData) {
        await this.ensureMigrated();

        const key = PRODUCT_PREFIX + productId;
        const previousWrite = this._writeQueue.get(key) || Promise.resolve();
        const currentWrite = previousWrite
          .catch(() => {}) // don't let a previous failure poison the chain
          .then(() => this._saveProductInternal(productId, productData));

        this._writeQueue.set(key, currentWrite);

        try {
          return await currentWrite;
        } finally {
          if (this._writeQueue.get(key) === currentWrite) {
            this._writeQueue.delete(key);
          }
        }
      }

      async _saveProductInternal(productId, productData) {
        const key = PRODUCT_PREFIX + productId;
        const existingResult = await chrome.storage.local.get([key, INDEX_KEY]);
        const existing = existingResult[key];
        const index = existingResult[INDEX_KEY] || [];

        let updatedProduct;
        const today = this.getTodayDate();

        if (existing) {
          // Update existing product
          const todayEntry = existing.history.find(h => h.date === today);

          if (todayEntry) {
            // Update today's entry
            todayEntry.price = productData.price;
            todayEntry.originalPrice = productData.originalPrice || null;
            todayEntry.discount = productData.discount || null;
          } else {
            // Add new entry for today
            existing.history.push({
              date: today,
              price: productData.price,
              originalPrice: productData.originalPrice || null,
              discount: productData.discount || null
            });
          }

          // Update metadata
          existing.lastUpdated = today;
          existing.title = productData.title || existing.title;
          existing.url = productData.url || existing.url;
          existing.site = productData.site || existing.site || (productId.startsWith('emag_') ? 'emag' : 'ozone');
          existing.thumbnail = productData.thumbnail || existing.thumbnail;
          existing.ean = productData.ean || existing.ean || null;
          existing.isActive = true;

          // Keep history sorted chronologically. No compression — full history
          // is preserved so original-price comparisons stay accurate.
          existing.history.sort((a, b) => new Date(a.date) - new Date(b.date));

          updatedProduct = existing;

          // Save only this product
          await chrome.storage.local.set({ [key]: updatedProduct });
        } else {
          // New product
          updatedProduct = {
            url: productData.url,
            title: productData.title,
            site: productData.site || (productId.startsWith('emag_') ? 'emag' : 'ozone'),
            thumbnail: productData.thumbnail || null,
            ean: productData.ean || null,
            history: [{
              date: today,
              price: productData.price,
              originalPrice: productData.originalPrice || null,
              discount: productData.discount || null
            }],
            firstSeen: today,
            lastUpdated: today,
            isActive: true
          };

          // Add to index
          index.push(productId);

          // Check storage limit
          if (index.length > this.MAX_PRODUCTS) {
            await this._evictOldProducts(index);
          }

          // Save product and updated index
          await chrome.storage.local.set({
            [key]: updatedProduct,
            [INDEX_KEY]: index
          });
        }

        return updatedProduct;
      }

      // Import a product with full history preserved (used for data import)
      async importProduct(productId, productData) {
        await this.ensureMigrated();

        const key = PRODUCT_PREFIX + productId;
        const result = await chrome.storage.local.get([INDEX_KEY]);
        const index = result[INDEX_KEY] || [];

        // Store the full product data as-is
        await chrome.storage.local.set({ [key]: productData });

        // Add to index if not already present
        if (!index.includes(productId)) {
          index.push(productId);
          await chrome.storage.local.set({ [INDEX_KEY]: index });
        }
      }

      // Evict old inactive products (private method)
      async _evictOldProducts(index) {
        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Fetch all products to determine which to evict
        const keys = index.map(id => PRODUCT_PREFIX + id);
        const result = await chrome.storage.local.get(keys);

        const productArray = index.map(id => ({
          id,
          data: result[PRODUCT_PREFIX + id],
          lastUpdated: new Date(result[PRODUCT_PREFIX + id]?.lastUpdated || 0),
          isActive: result[PRODUCT_PREFIX + id]?.isActive
        }));

        // Sort by lastUpdated, inactive first
        productArray.sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? 1 : -1;
          return a.lastUpdated - b.lastUpdated;
        });

        // Remove oldest inactive products until under limit
        let toRemove = index.length - this.MAX_PRODUCTS;
        const keysToRemove = [];
        const idsToRemove = new Set();

        for (const product of productArray) {
          if (toRemove <= 0) break;
          if (!product.isActive || product.lastUpdated < ninetyDaysAgo) {
            keysToRemove.push(PRODUCT_PREFIX + product.id);
            idsToRemove.add(product.id);
            toRemove--;
          }
        }

        if (keysToRemove.length > 0) {
          await chrome.storage.local.remove(keysToRemove);

          // Update index
          const newIndex = index.filter(id => !idsToRemove.has(id));
          await chrome.storage.local.set({ [INDEX_KEY]: newIndex });
        }
      }

      // Mark product as inactive
      async markInactive(productId) {
        const product = await this.getProduct(productId);
        if (product) {
          product.isActive = false;
          await chrome.storage.local.set({ [PRODUCT_PREFIX + productId]: product });
        }
      }

      // Delete a specific product - O(1) operation
      async deleteProduct(productId) {
        await this.ensureMigrated();

        const key = PRODUCT_PREFIX + productId;
        const result = await chrome.storage.local.get([key, INDEX_KEY]);

        if (!result[key]) {
          return false;
        }

        // Remove from storage
        await chrome.storage.local.remove([key]);

        // Update index
        const index = result[INDEX_KEY] || [];
        const newIndex = index.filter(id => id !== productId);
        await chrome.storage.local.set({ [INDEX_KEY]: newIndex });

        return true;
      }

      // Clear all history
      async clearAll() {
        await this.ensureMigrated();

        const index = await this.getProductIndex();
        const keys = index.map(id => PRODUCT_PREFIX + id);
        keys.push(INDEX_KEY);

        await chrome.storage.local.remove(keys);
        await chrome.storage.local.set({ [INDEX_KEY]: [] });
      }

      // Get today's date in YYYY-MM-DD format using LOCAL time, not UTC.
      // Previously this used toISOString() which is UTC-based; for users in
      // UTC+N timezones (e.g. Sofia +03), visits between local midnight and
      // 02:59 would silently land on the previous day's UTC date and
      // overwrite the price entry there instead of starting a fresh one.
      getTodayDate() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }

      // Get product count - O(1) operation
      async getProductCount() {
        const index = await this.getProductIndex();
        return index.length;
      }
    };
  } catch (e) {
    console.error('Error defining PriceStorageManager class:', e);
    if (!_globalScope.PriceStorageManager) {
      throw e;
    }
  }
})();
