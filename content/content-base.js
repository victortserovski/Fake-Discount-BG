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
    showWidgetError(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'padding: 20px; background: rgba(254, 226, 226, 0.9); border: 1px solid #fcc; border-radius: 12px; color: #c00; text-align: center;';
        errorDiv.textContent = 'Error loading widget';
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
            if (typeof FakeDiscountWidget === 'undefined' || !FakeDiscountWidget.init) {
                console.error('[Fake Discount] FakeDiscountWidget not available');
                this.showWidgetError(widgetContainer);
                return;
            }
            await FakeDiscountWidget.init(widgetContainer, product, analysis);
        } catch (error) {
            console.error('[Fake Discount] Widget init error:', error);
            this.showWidgetError(widgetContainer);
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

    // Generic track and display flow
    async trackAndDisplay(extractProductData, injectWidget, isProductPage) {
        // Bail out if the extension was reloaded while this page was open —
        // any chrome.* call from this orphaned script would otherwise reject
        // with "Extension context invalidated".
        if (!this.isContextValid()) return;

        const productData = await extractProductData();

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

        if (!productData || !productData.price) {
            await injectWidget(
                {
                    history: [],
                    title: 'Unknown Product',
                    url: window.location.href,
                    site: productData && productData.site ? productData.site : undefined
                },
                emptyAnalysis
            );
            return;
        }

        try {
            const response = await this.trackProduct(productData);
            if (response && response.success) {
                await injectWidget(response.product, response.analysis);
            } else {
                await injectWidget({ history: [], site: productData.site }, emptyAnalysis);
            }
        } catch (error) {
            await injectWidget({ history: [], site: productData.site }, emptyAnalysis);
        }
    },

    // Setup SPA navigation detection via background messages and popstate
    setupNavigation(isProductPage, trackAndDisplay) {
        let lastUrl = location.href;
        let navigationTimeout = null;

        const handleUrlChange = () => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                this.cleanupWidget();

                if (navigationTimeout) {
                    clearTimeout(navigationTimeout);
                }

                navigationTimeout = setTimeout(async () => {
                    if (isProductPage()) {
                        trackAndDisplay();
                    }
                }, 800);
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
