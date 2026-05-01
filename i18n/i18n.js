// Internationalization utility
class I18n {
  constructor() {
    this.translations = {};
    this.currentLang = 'bg'; // Default to Bulgarian
    this._loadPromise = null; // Track loading promise to avoid duplicate loads
    // Don't load translations in constructor - lazy load instead
    // This prevents errors when chrome.runtime is not available
  }

  async loadTranslations() {
    // If already loading, return the existing promise
    if (this._loadPromise) {
      return this._loadPromise;
    }
    
    // Create loading promise
    this._loadPromise = (async () => {
      // Load language preference from storage (check if chrome.storage is available)
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          const result = await chrome.storage.local.get(['language']);
          if (result.language) {
            this.currentLang = result.language;
          }
        } catch (e) {
          console.warn('[i18n] Could not access chrome.storage:', e);
        }
      } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Fallback: use message passing to get language
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getLanguage' }, (response) => {
              resolve(response);
            });
          });
          if (response && response.language) {
            this.currentLang = response.language;
          }
        } catch (e) {
          console.warn('[i18n] Could not get language via message:', e);
        }
      }

      // Get extension URL
      let runtimeUrl;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        runtimeUrl = chrome.runtime.getURL(`i18n/${this.currentLang}.json`);
      } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Fallback: use message passing to get extension URL
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getExtensionUrl', path: `i18n/${this.currentLang}.json` }, (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(response);
              }
            });
          });
          if (response && response.url) {
            runtimeUrl = response.url;
          }
        } catch (e) {
          console.warn('[i18n] Could not get extension URL via message:', e);
        }
      }
      
      if (!runtimeUrl) {
        console.error('[i18n] Could not determine extension URL, cannot load translations');
        this.translations = {};
        return;
      }
      
      try {
        const response = await fetch(runtimeUrl);
        if (!response.ok) {
          throw new Error(`Failed to load i18n: ${response.status} ${response.statusText}`);
        }
        // Check if response is actually JSON (not HTML error page)
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Response is not JSON');
        }
        this.translations = await response.json();
        console.log('[i18n] Translations loaded successfully');
      } catch (e) {
        console.error('[i18n] Error loading translations:', e);
        this.translations = {};
      }
    })();
    
    return this._loadPromise;
  }

  async setLanguage(lang) {
    this.currentLang = lang;
    this._loadPromise = null; // Reset load promise to force reload
    
    // Save language preference if chrome.storage is available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ language: lang });
      } catch (e) {
        console.warn('[i18n] Could not save language preference:', e);
      }
    }
    
    // Reload translations with new language
    await this.loadTranslations();
  }

  t(key, params = {}) {
    const keys = key.split('.');
    let value = this.translations;
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // Return key if translation not found
      }
    }

    if (typeof value !== 'string') {
      return key;
    }

    // Replace parameters in translation string. Use replaceAll so a placeholder
    // that appears multiple times (e.g. "{current}/{needed}" alongside another
    // "{needed}") gets substituted at every occurrence, not just the first.
    let translated = value;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      translated = translated.replaceAll(`{${paramKey}}`, paramValue);
    }

    return translated;
  }

  getCurrentLanguage() {
    return this.currentLang;
  }
}

// Export class
if (typeof window !== 'undefined') {
  window.I18n = I18n;
} else if (typeof self !== 'undefined') {
  self.I18n = I18n;
}

// Create global instance (only in window context)
// Don't auto-load translations - let consumers call loadTranslations() explicitly
if (typeof window !== 'undefined') {
  window.i18n = new I18n();
  // Also create in global scope for popup/widget access
  const i18n = window.i18n;
  // Note: loadTranslations() must be called explicitly
  // This prevents errors when chrome.runtime is not available at construction time
}
