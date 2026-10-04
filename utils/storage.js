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
        this._migrationPromise = null;
        // Per-product write queue: serializes writes to the same product so two
        // overlapping saveProduct calls can't clobber each other.
        this._writeQueue = new Map();
        // Serializes product_index read-modify-write so concurrent new-product /
        // import / delete ops can't drop IDs from the index.
        this._indexQueue = Promise.resolve();
        this._mutationQueue = Promise.resolve();
      }

      // Serialize product_index RMW operations.
      _withIndexLock(fn) {
        const current = this._indexQueue
          .catch(() => {})
          .then(() => fn());
        this._indexQueue = current;
        return current;
      }

      // All mutations share an admission queue, including clear and bulk import.
      _withMutationLock(fn) {
        const current = this._mutationQueue.catch(() => {}).then(fn);
        this._mutationQueue = current;
        return current;
      }

      ensureMigrated() {
        if (!this._migrationPromise) {
          // Publish the promise before the first storage read yields.
          this._migrationPromise = this._migrateFromOldFormat().catch(error => {
            this._migrationPromise = null;
            throw error;
          });
        }
        return this._migrationPromise;
      }

      async _migrateFromOldFormat() {
        const stored = await chrome.storage.local.get(null);
        const changes = {};
        const old = !stored[MIGRATION_FLAG] && stored[OLD_STORAGE_KEY];
        if (old) {
          for (const [id, product] of Object.entries(old)) {
            // Existing per-product data wins; never overwrite a newer record.
            if (!stored[PRODUCT_PREFIX + id]) changes[PRODUCT_PREFIX + id] = product;
          }
        }
        const products = { ...stored, ...changes };
        changes[INDEX_KEY] = Object.keys(products).filter(key =>
          key.startsWith(PRODUCT_PREFIX) && products[key] && Array.isArray(products[key].history)
        ).map(key => key.slice(PRODUCT_PREFIX.length));
        changes[MIGRATION_FLAG] = true;
        // Also repairs orphaned product records left by earlier versions.
        await chrome.storage.local.set(changes);
        if (stored[OLD_STORAGE_KEY]) await chrome.storage.local.remove([OLD_STORAGE_KEY]);
        return true;
      }

      // Get product index (list of all product IDs)
      async getProductIndex() {
        await this._mutationQueue.catch(() => {});
        await this.ensureMigrated();
        const result = await chrome.storage.local.get([INDEX_KEY]);
        return result[INDEX_KEY] || [];
      }

      // Get all products (for popup display, export, etc.)
      async getAllProducts() {
        await this._mutationQueue.catch(() => {});
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
        await this._mutationQueue.catch(() => {});
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
          .then(() => this._withMutationLock(() => this._saveProductInternal(productId, productData)));

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
        const existingResult = await chrome.storage.local.get([key]);
        const existing = existingResult[key];

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

          await this._withIndexLock(async () => {
            const idxResult = await chrome.storage.local.get([INDEX_KEY]);
            const idx = idxResult[INDEX_KEY] || [];
            if (!idx.includes(productId)) {
              idx.push(productId);
            }
            await chrome.storage.local.set({
              [key]: updatedProduct,
              [INDEX_KEY]: idx
            });
          });
        }

        return updatedProduct;
      }

      // Import a product with full history preserved (used for data import).
      // Serialized per-product via _writeQueue like saveProduct.
      async importProduct(productId, productData) {
        await this.ensureMigrated();

        const key = PRODUCT_PREFIX + productId;
        const previousWrite = this._writeQueue.get(key) || Promise.resolve();
        const currentWrite = previousWrite
          .catch(() => {})
          .then(() => this._withMutationLock(() => this._importProductInternal(productId, productData)));

        this._writeQueue.set(key, currentWrite);

        try {
          return await currentWrite;
        } finally {
          if (this._writeQueue.get(key) === currentWrite) {
            this._writeQueue.delete(key);
          }
        }
      }

      async _importProductInternal(productId, productData) {
        return this._importProductsInternal({ [productId]: productData });
      }

      async importProducts(products) {
        await this.ensureMigrated();
        return this._withMutationLock(() => this._importProductsInternal(products));
      }

      async _importProductsInternal(products) {
        const stored = await chrome.storage.local.get([INDEX_KEY]);
        const index = new Set(stored[INDEX_KEY] || []);
        const changes = {};
        for (const [id, product] of Object.entries(products)) {
          changes[PRODUCT_PREFIX + id] = product;
          index.add(id);
        }
        changes[INDEX_KEY] = Array.from(index);
        // One Chrome storage batch: quota validation precedes committing values.
        await chrome.storage.local.set(changes);
      }

      async setPriceTarget(productId, legacyUrl, value) {
        return this._withMutationLock(async () => {
          const result = await chrome.storage.local.get(['priceTargets']);
          const targets = result.priceTargets || {};
          if (value == null) delete targets[productId];
          else targets[productId] = value;
          if (legacyUrl && legacyUrl !== productId) delete targets[legacyUrl];
          await chrome.storage.local.set({ priceTargets: targets });
        });
      }

      // Delete a specific product — serialized per key via _writeQueue.
      async deleteProduct(productId) {
        await this.ensureMigrated();

        const key = PRODUCT_PREFIX + productId;
        const previousWrite = this._writeQueue.get(key) || Promise.resolve();
        const currentWrite = previousWrite
          .catch(() => {})
          .then(() => this._withMutationLock(() => this._deleteProductInternal(productId)));

        this._writeQueue.set(key, currentWrite);

        try {
          return await currentWrite;
        } finally {
          if (this._writeQueue.get(key) === currentWrite) {
            this._writeQueue.delete(key);
          }
        }
      }

      async _deleteProductInternal(productId) {
        const key = PRODUCT_PREFIX + productId;
        const result = await chrome.storage.local.get([key]);

        if (!result[key]) {
          return false;
        }

        const idxResult = await chrome.storage.local.get([INDEX_KEY]);
        const index = (idxResult[INDEX_KEY] || []).filter(id => id !== productId);
        // Remove the record value and its index entry in one batch. A worker
        // interruption before removing the empty key cannot resurrect its data.
        await chrome.storage.local.set({ [key]: null, [INDEX_KEY]: index });
        await chrome.storage.local.remove([key]);

        return true;
      }

      // Clear all history
      async clearAll() {
        await this.ensureMigrated();
        return this._withMutationLock(async () => {
          const stored = await chrome.storage.local.get(null);
          const keys = Object.keys(stored).filter(key => key.startsWith(PRODUCT_PREFIX));
          keys.push(INDEX_KEY);
          await chrome.storage.local.remove(keys);
        });
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
