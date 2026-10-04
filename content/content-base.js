// Shared content script utilities for Emag and Ozone
// Runs in content script isolated world - bypasses host page CSP

const ContentScriptBase = {
    // Returns true while this content script can still talk to the extension.
    // Becomes false after the extension is reloaded/updated/disabled while
    // the page is open — at that point the script is "orphaned" in the page's
    // memory and any chrome.* call rejects with "Extension context invalidated".
    // Guarding our entry points lets the orphaned script silently give up
    // instead of throwing uncaught promise rejections into the dev console.
    isContextValid() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (_) {
            return false;
        }
    },

    // Show error in widget container
    async showWidgetError(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'padding: 20px; background: rgba(254, 226, 226, 0.9); border: 1px solid #fcc; border-radius: 12px; color: #c00; text-align: center;';
        const translations = window.i18n;
        if (translations) await translations.loadTranslations();
        errorDiv.textContent = translations ? translations.t('errorLoadingWidget') : '';
        container.appendChild(errorDiv);
    },

    // Cleanup existing widget
    cleanupWidget() {
        const widget = document.getElementById('fake-discount-widget');
        if (widget) {
            widget.remove();
        }
    },

    // Create widget container with common styles. The z-index + position
    // + isolation defense is applied at the base layer because several
    // SPA storefronts (dm, About You, Answear) use overlay containers,
    // transforms, or position:fixed sub-trees that previously caused
    // the widget to render BEHIND product content or in front of fixed
    // top menus depending on which container we inserted into.
    createWidgetContainer() {
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'fake-discount-widget';
        widgetContainer.style.marginTop = '20px';
        widgetContainer.style.marginBottom = '20px';
        widgetContainer.style.width = '100%';
        widgetContainer.style.clear = 'both';
        widgetContainer.style.boxSizing = 'border-box';
        widgetContainer.style.position = 'relative';
        widgetContainer.style.zIndex = '0';
        widgetContainer.style.isolation = 'isolate';
        return widgetContainer;
    },

    // Initialize widget directly (scripts loaded via manifest.json content_scripts)
    async loadWidgetScripts(widgetContainer, product, analysis) {
        try {
            if (product.url && window.location.href !== product.url) {
                widgetContainer.remove();
                return;
            }
            // Retailer submit controls must never own our target input.
            const form = widgetContainer.closest('form');
            if (form) {
                let outerForm = form;
                while (outerForm.parentElement?.closest('form')) outerForm = outerForm.parentElement.closest('form');
                outerForm.parentNode.insertBefore(widgetContainer, outerForm.nextSibling);
            }
            if (typeof FakeDiscountWidget === 'undefined' || !FakeDiscountWidget.init) {
                console.error('[Fake Discount] FakeDiscountWidget not available');
                await this.showWidgetError(widgetContainer);
                return;
            }
            await FakeDiscountWidget.init(widgetContainer, product, analysis);
        } catch (error) {
            console.error('[Fake Discount] Widget init error:', error);
            await this.showWidgetError(widgetContainer);
        }
    },

    // Load widget CSS
    loadWidgetCSS() {
        if (!this.isContextValid()) return;
        if (!document.querySelector('link[href*="price-graph-widget.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL('ui/price-graph-widget.css');
            document.head.appendChild(link);
        }
    },

    // Send product data and get analysis
    async trackProduct(productData) {
        if (!this.isContextValid()) return { success: false };
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                {
                    action: 'trackProduct',
                    data: productData
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError });
                    } else {
                        resolve(response || { success: false });
                    }
                }
            );
        });
    },

    // Returns true unless the user explicitly disabled this store in Settings.
    async checkSiteEnabled(storageKey) {
        if (!this.isContextValid()) return false;
        const result = await chrome.storage.local.get([storageKey]);
        return result[storageKey] !== false;
    },

    // Generic track and display flow
    async trackAndDisplay(extractProductData, injectWidget, isProductPage, options = {}) {
        // Bail out if the extension was reloaded while this page was open —
        // any chrome.* call from this orphaned script would otherwise reject
        // with "Extension context invalidated".
        if (!this.isContextValid()) return;

        const startedUrl = window.location.href;
        const isCurrent = () => this.isContextValid() && window.location.href === startedUrl && isProductPage();
        if (!isCurrent()) return;
        if (options.enableStorageKey) {
            const enabled = await this.checkSiteEnabled(options.enableStorageKey);
            if (!enabled) return;
        }

        const productData = await extractProductData();
        if (!isCurrent()) return;

        // Empty-state analysis used when there is no usable price (e.g. an
        // out-of-stock variant) or the background failed to record. Mirrors
        // what detectFakeDiscount() returns for an empty history so the
        // widget renders the TRACKING verdict (gray) with a properly-
        // substituted reason line, not a misleading yellow STABLE_PRICE
        // and the literal `{needed}` / `{current}` placeholders.
        const emptyAnalysis = {
            result: 'tracking',
            verdict: 'TRACKING',
            confidence: 0,
            reasonKey: 'insufficientData',
            reasonParams: { current: 0, needed: 7 }
        };

        if (!productData) {
            await injectWidget({ history: [], url: startedUrl }, { ...emptyAnalysis, reasonKey: 'extractionFailed', reasonParams: {} });
            return;
        }
        if (!productData.price) {
            const oosProduct = {
                history: [],
                url: window.location.href,
                site: productData && productData.site ? productData.site : undefined
            };
            if (productData) {
                if (productData.id) oosProduct.id = productData.id;
                if (productData.title) oosProduct.title = productData.title;
                if (productData.thumbnail) oosProduct.thumbnail = productData.thumbnail;
                if (productData.ean) oosProduct.ean = productData.ean;
                if (productData.originalPrice != null) oosProduct.originalPrice = productData.originalPrice;
            }
            if (!oosProduct.title) {
                oosProduct.title = document.querySelector('h1')?.textContent?.trim() || document.title || '';
            }
            await injectWidget(oosProduct, emptyAnalysis);
            return;
        }

        try {
            const response = await this.trackProduct(productData);
            if (!isCurrent()) return;
            if (response && response.success) {
                await injectWidget(response.product, response.analysis);
            } else {
                await injectWidget({
                    history: [],
                    site: productData.site,
                    title: productData.title,
                    url: productData.url,
                    id: productData.id
                }, { ...emptyAnalysis, reasonKey: 'trackingFailed', reasonParams: {} });
            }
        } catch (error) {
            if (!isCurrent()) return;
            await injectWidget({
                history: [],
                site: productData.site,
                title: productData.title,
                url: productData.url,
                id: productData.id
            }, { ...emptyAnalysis, reasonKey: 'trackingFailed', reasonParams: {} });
        }
    },

    // Setup SPA navigation detection via background messages and popstate
    setupNavigation(isProductPage, trackAndDisplay, options = {}) {
        const navDelayMs = options.navigationDelayMs || 800;
        const navigationMaxWaitMs = options.navigationMaxWaitMs || navDelayMs * 4;
        let lastUrl = location.href;
        let navigationTimeout = null;
        let navigationInterval = null;

        const clearNavigationPoll = () => {
            if (navigationTimeout) {
                clearTimeout(navigationTimeout);
                navigationTimeout = null;
            }
            if (navigationInterval) {
                clearInterval(navigationInterval);
                navigationInterval = null;
            }
        };

        const handleUrlChange = () => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                this.cleanupWidget();
                clearNavigationPoll();

                const pollStart = Date.now();

                const tryTrack = () => {
                    if (isProductPage()) {
                        clearNavigationPoll();
                        trackAndDisplay();
                        return true;
                    }
                    return false;
                };

                navigationTimeout = setTimeout(() => {
                    navigationTimeout = null;
                    if (tryTrack()) return;

                    navigationInterval = setInterval(() => {
                        if (tryTrack()) return;
                        if (Date.now() - pollStart >= navigationMaxWaitMs) {
                            clearNavigationPoll();
                        }
                    }, 250);
                }, navDelayMs);
            }
        };

        // Listen for URL change messages from background service worker
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'urlChanged') {
                handleUrlChange();
            }
        });

        // Listen for popstate events (browser back/forward)
        window.addEventListener('popstate', handleUrlChange);
    }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
    window.ContentScriptBase = ContentScriptBase;
}
