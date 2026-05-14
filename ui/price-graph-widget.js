// Price Graph Widget - Runs in content script isolated world
(function() {
  'use strict';

  let i18n = null;

  // Map the extension's language code to a BCP-47 locale for date formatting.
  function getLocale() {
    const lang = (i18n && i18n.getCurrentLanguage && i18n.getCurrentLanguage()) || 'bg';
    return lang === 'en' ? 'en-US' : 'bg-BG';
  }

  async function loadI18n() {
    if (i18n) return i18n;

    try {
      if (window.i18n && window.i18n.loadTranslations) {
        try {
          await window.i18n.loadTranslations();
          if (window.i18n.translations && Object.keys(window.i18n.translations).length > 0) {
            i18n = window.i18n;
            return i18n;
          }
        } catch (e) {}
      }

      if (window.I18n) {
        try {
          i18n = new window.I18n();
          await i18n.loadTranslations();
          if (i18n.translations && Object.keys(i18n.translations).length > 0) {
            return i18n;
          }
        } catch (e) {}
      }
    } catch (e) {}

    let lang = 'bg';
    try {
      const langResult = await chrome.storage.local.get(['language']);
      lang = langResult.language || 'bg';
    } catch (e) {}

    try {
      const runtimeUrl = chrome.runtime.getURL(`i18n/${lang}.json`);
      const response = await fetch(runtimeUrl);
      if (response.ok) {
        const translations = await response.json();
        if (translations && typeof translations === 'object') {
          i18n = {
            t: (key, params = {}) => {
              const keys = key.split('.');
              let value = translations;
              for (const k of keys) {
                if (value && typeof value === 'object') {
                  value = value[k];
                } else {
                  return key;
                }
              }
              if (typeof value !== 'string') return key;
              let translated = value;
              for (const [paramKey, paramValue] of Object.entries(params)) {
                // replaceAll so repeated placeholders (e.g. "{needed}" appearing
                // twice in the same string) are all substituted, not just the first.
                translated = translated.replaceAll(`{${paramKey}}`, paramValue);
              }
              return translated;
            },
            getCurrentLanguage: () => lang
          };
          return i18n;
        }
      }
    } catch (e) {
      console.error('[Fake Discount] Error loading i18n:', e);
    }

    return { t: (key) => key, getCurrentLanguage: () => lang };
  }

  const globalObj = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined') ? self : global;

  if (typeof globalObj.FakeDiscountWidget === 'function') {
    delete globalObj.FakeDiscountWidget;
  }

  globalObj.FakeDiscountWidget = {
    async init(container, product, analysis) {
      if (!container || !container.parentNode) {
        return;
      }

      try {
        await loadI18n();
      } catch (e) {}

      const t = (key, params) => {
        if (i18n && i18n.t) {
          return i18n.t(key, params);
        }
        return key;
      };

      try {
        const fragment = this.buildWidgetHTML(product, analysis, t);

        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        container.appendChild(fragment);
        container.style.backgroundColor = '';
        container.setAttribute('data-widget-status', 'initialized');

        // Prevent widget events from bubbling up to the host page (e.g. Ozone's
        // add-to-cart form). Bubble phase only — a capture-phase listener here
        // would swallow the event before it reaches our own input/button.
        for (const eventType of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit']) {
          container.addEventListener(eventType, (e) => {
            e.stopPropagation();
            if (eventType === 'submit') e.preventDefault();
          });
        }

        void container.offsetHeight;

        await new Promise(resolve => setTimeout(resolve, 100));

        let chartContainer = container.querySelector('.fake-discount-chart') ||
                            container.querySelector('[id^="price-chart-"]');

        if (!chartContainer) {
          const chartContainerParent = container.querySelector('.fake-discount-chart-container');
          if (chartContainerParent) {
            chartContainer = chartContainerParent.querySelector('.fake-discount-chart');
            if (!chartContainer && chartContainerParent.children.length > 0) {
              chartContainer = chartContainerParent.children[0];
            }
          }
        }

        if (chartContainer) {
          await this.renderChart(product, analysis, t, container);
        } else {
          const chartContainerParent = container.querySelector('.fake-discount-chart-container');
          if (chartContainerParent) {
            const chartDiv = document.createElement('div');
            chartDiv.className = 'fake-discount-chart';
            chartDiv.id = `price-chart-${Date.now()}`;
            while (chartContainerParent.firstChild) {
              chartContainerParent.removeChild(chartContainerParent.firstChild);
            }
            chartContainerParent.appendChild(chartDiv);
            await this.renderChart(product, analysis, t, container);
          }
        }

        // Setup price target (analysis is needed so we can re-render the chart
        // when the user changes the target without losing the verdict context).
        this.setupPriceTarget(container, product, analysis, t);
      } catch (e) {
        console.error('[Fake Discount] Widget error:', e);
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fake-discount-error';
        errorDiv.textContent = t('errorLoadingWidget') || 'Error loading widget';
        container.appendChild(errorDiv);
      }
    },

    buildWidgetHTML(product, analysis, t) {
      const fragment = document.createDocumentFragment();

      const verdict = analysis.verdict || 'STABLE_PRICE';
      const verdictClass = verdict === 'FAKE_DISCOUNT' ? 'fake' :
                          verdict === 'REAL_DEAL' ? 'real' :
                          verdict === 'STABLE_PRICE' ? 'stable' :
                          verdict === 'VOLATILE_PRICE' ? 'volatile' : 'neutral';
      const verdictText = t(`verdicts.${verdict}`) || verdict;
      // URL-fallback site detection — order matters: longer/more-specific
      // hostnames first so e.g. `technomarket.bg` doesn't accidentally match
      // a substring inside another URL. `product.site` from the adapter is
      // always preferred when present.
      const site = product.site || (
        product.url?.includes('technomarket.bg') ? 'technomarket' :
        product.url?.includes('technopolis.bg') ? 'technopolis' :
        product.url?.includes('emag.bg') ? 'emag' :
        product.url?.includes('notino.bg') ? 'notino' :
        product.url?.includes('zora.bg') ? 'zora' :
        product.url?.includes('ardes.bg') ? 'ardes' :
        product.url?.includes('plesio.bg') ? 'plesio' :
        product.url?.includes('aboutyou.bg') ? 'aboutyou' :
        product.url?.includes('answear.bg') ? 'answear' :
        product.url?.includes('decathlon.bg') ? 'decathlon' :
        product.url?.includes('dm-drogeriemarkt.bg') ? 'dm' :
        product.url?.includes('fashiondays.bg') ? 'fashiondays' :
        product.url?.includes('lillydrogerie.bg') ? 'lilly' :
        product.url?.includes('mr-bricolage.bg') ? 'bricolage' :
        product.url?.includes('obuvki.bg') ? 'obuvki' :
        product.url?.includes('praktiker.bg') ? 'praktiker' :
        product.url?.includes('sopharmacy.bg') ? 'sopharmacy' :
        product.url?.includes('sportdepot.bg') ? 'sportdepot' :
        product.url?.includes('ebag.bg') ? 'ebag' :
        'ozone'
      );
      const SITE_NAMES = {
        emag: 'eMAG.bg',
        ozone: 'Ozone.bg',
        notino: 'Notino.bg',
        technopolis: 'Technopolis.bg',
        technomarket: 'Technomarket.bg',
        zora: 'Zora.bg',
        ardes: 'Ardes.bg',
        plesio: 'Plesio.bg',
        aboutyou: 'Aboutyou.bg',
        answear: 'Answear.bg',
        decathlon: 'Decathlon.bg',
        dm: 'dm-drogeriemarkt.bg',
        fashiondays: 'Fashiondays.bg',
        lilly: 'Lillydrogerie.bg',
        bricolage: 'Mr-bricolage.bg',
        obuvki: 'Obuvki.bg',
        praktiker: 'Praktiker.bg',
        sopharmacy: 'Sopharmacy.bg',
        sportdepot: 'Sportdepot.bg',
        ebag: 'eBag.bg'
      };
      const siteName = SITE_NAMES[site] || 'Ozone.bg';
      const stats = analysis.stats || {};
      const allTimeLow = stats.allTimeLow ?? (product.history && product.history.length > 0 ? Math.min(...product.history.map(h => h.price)) : 0);
      const allTimeHigh = stats.allTimeHigh ?? (product.history && product.history.length > 0 ? Math.max(...product.history.map(h => h.price)) : 0);
      const currency = t('currency') || 'EUR';
      const hasHistory = product.history && product.history.length > 0;

      // Verdict Banner with reason text
      const verdictBanner = document.createElement('div');
      verdictBanner.className = `fake-discount-verdict-banner ${verdictClass}`;
      const siteIndicator = document.createElement('div');
      siteIndicator.className = `fake-discount-site-indicator ${site}`;
      siteIndicator.textContent = siteName;
      verdictBanner.appendChild(siteIndicator);

      const verdictContent = document.createElement('div');
      verdictContent.className = 'fake-discount-verdict-content';
      const verdictTitle = document.createElement('div');
      verdictTitle.className = 'fake-discount-verdict-title';
      verdictTitle.textContent = verdictText;
      verdictContent.appendChild(verdictTitle);

      // Add reason text below the verdict (always show it — including for the
      // TRACKING state, where the reason explains how many days are still needed).
      const reasonKey = analysis.reasonKey;
      if (reasonKey) {
        const reasonText = t(`reasons.${reasonKey}`, analysis.reasonParams || {});
        if (reasonText && reasonText !== `reasons.${reasonKey}`) {
          const reasonDiv = document.createElement('div');
          reasonDiv.className = 'fake-discount-verdict-reason';
          reasonDiv.textContent = reasonText;
          verdictContent.appendChild(reasonDiv);
        }
      }

      verdictBanner.appendChild(verdictContent);
      fragment.appendChild(verdictBanner);

      // Stats Grid - 2 stats: Low and High
      const statsGrid = document.createElement('div');
      statsGrid.className = 'fake-discount-stats-grid two-cols';

      const stat1 = document.createElement('div');
      stat1.className = 'fake-discount-stat-item';
      const label1 = document.createElement('div');
      label1.className = 'fake-discount-stat-label';
      label1.textContent = t('stats.allTimeLow');
      const value1 = document.createElement('div');
      value1.className = 'fake-discount-stat-value low';
      value1.textContent = hasHistory ? `${allTimeLow.toFixed(2)} ${currency}` : `N/A`;
      stat1.appendChild(label1);
      stat1.appendChild(value1);
      statsGrid.appendChild(stat1);

      const stat2 = document.createElement('div');
      stat2.className = 'fake-discount-stat-item';
      const label2 = document.createElement('div');
      label2.className = 'fake-discount-stat-label';
      label2.textContent = t('stats.allTimeHigh');
      const value2 = document.createElement('div');
      value2.className = 'fake-discount-stat-value high';
      value2.textContent = hasHistory ? `${allTimeHigh.toFixed(2)} ${currency}` : `N/A`;
      stat2.appendChild(label2);
      stat2.appendChild(value2);
      statsGrid.appendChild(stat2);

      fragment.appendChild(statsGrid);

      // Chart Container
      const chartContainerParent = document.createElement('div');
      chartContainerParent.className = 'fake-discount-chart-container';

      const chartDiv = document.createElement('div');
      chartDiv.className = 'fake-discount-chart';
      chartDiv.id = `price-chart-${Date.now()}`;
      chartContainerParent.appendChild(chartDiv);
      fragment.appendChild(chartContainerParent);

      // Bottom bar: only last price change
      const lastChangeDate = hasHistory ? this.getLastPriceChangeDate(product.history) : null;
      const infoBar = document.createElement('div');
      infoBar.className = 'fake-discount-info-bar';

      const changeItem = document.createElement('div');
      changeItem.className = 'fake-discount-info-item';
      const changeIcon = document.createElement('span');
      changeIcon.className = 'fake-discount-info-icon';
      changeIcon.innerHTML = '&#x1F504;';
      const changeText = document.createElement('span');
      changeText.className = 'fake-discount-info-text';
      changeText.textContent = lastChangeDate
        ? `${t('bottomBar.lastChange') || 'Changed'}: ${lastChangeDate}`
        : (t('bottomBar.noChanges') || 'No changes');
      changeItem.appendChild(changeIcon);
      changeItem.appendChild(changeText);
      infoBar.appendChild(changeItem);

      // Price target section
      const targetItem = document.createElement('div');
      targetItem.className = 'fake-discount-info-item fake-discount-target-item';
      const targetIcon = document.createElement('span');
      targetIcon.className = 'fake-discount-info-icon';
      targetIcon.innerHTML = '&#x1F3AF;';
      const targetLabel = document.createElement('span');
      targetLabel.className = 'fake-discount-info-text';
      targetLabel.textContent = t('priceTarget.label') || 'Target:';
      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.className = 'fake-discount-target-input';
      targetInput.placeholder = `${currency}`;
      targetInput.min = '0';
      targetInput.step = '0.01';
      targetInput.setAttribute('data-product-id', product.url || '');
      const targetBtn = document.createElement('button');
      targetBtn.type = 'button'; // Prevent native form submission if inside a <form>
      targetBtn.className = 'fake-discount-target-btn';
      targetBtn.textContent = t('priceTarget.set') || 'Set';
      const targetStatus = document.createElement('span');
      targetStatus.className = 'fake-discount-info-text fake-discount-target-status';
      targetItem.appendChild(targetIcon);
      targetItem.appendChild(targetLabel);
      targetItem.appendChild(targetInput);
      targetItem.appendChild(targetBtn);
      targetItem.appendChild(targetStatus);
      infoBar.appendChild(targetItem);

      fragment.appendChild(infoBar);

      return fragment;
    },

    getLastPriceChangeDate(history) {
      if (!history || history.length < 2) return null;
      for (let i = history.length - 1; i > 0; i--) {
        if (history[i].price !== history[i - 1].price) {
          const date = new Date(history[i].date);
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit' });
          }
        }
      }
      return null;
    },

    async setupPriceTarget(container, product, analysis, t) {
      const input = container.querySelector('.fake-discount-target-input');
      const btn = container.querySelector('.fake-discount-target-btn');
      const status = container.querySelector('.fake-discount-target-status');
      if (!input || !btn) return;

      const productKey = product.url || '';
      const currency = t('currency') || 'EUR';
      const self = this;

      // Update the inline status pill based on the current target value.
      const renderStatus = (targetValue) => {
        status.classList.remove('active', 'text-success', 'reached');
        if (!targetValue) {
          status.textContent = '';
          return;
        }
        const currentPrice = product.history && product.history.length > 0
          ? product.history[product.history.length - 1].price : null;
        const reached = currentPrice != null && currentPrice <= targetValue;
        if (reached) {
          status.textContent = `${t('priceTarget.reached') || 'Target reached!'} (${targetValue} ${currency})`;
          status.classList.add('reached');
        } else {
          status.textContent = `${targetValue} ${currency}`;
          status.classList.add('active');
        }
      };

      // Load existing target
      try {
        const result = await chrome.storage.local.get(['priceTargets']);
        const targets = result.priceTargets || {};
        if (targets[productKey]) {
          input.value = targets[productKey];
          renderStatus(targets[productKey]);
        }
      } catch (e) {}

      btn.addEventListener('click', async () => {
        const targetPrice = parseFloat(input.value);
        if (!targetPrice || targetPrice <= 0) {
          // Clear target
          try {
            const result = await chrome.storage.local.get(['priceTargets']);
            const targets = result.priceTargets || {};
            delete targets[productKey];
            await chrome.storage.local.set({ priceTargets: targets });
            renderStatus(null);
            input.value = '';
            // Re-render chart so the target line disappears.
            await self.renderChart(product, analysis, t, container);
          } catch (e) {}
          return;
        }

        try {
          const result = await chrome.storage.local.get(['priceTargets']);
          const targets = result.priceTargets || {};
          targets[productKey] = targetPrice;
          await chrome.storage.local.set({ priceTargets: targets });
          renderStatus(targetPrice);

          // Flash confirmation
          btn.textContent = '!';
          setTimeout(() => { btn.textContent = t('priceTarget.set') || 'Set'; }, 1000);

          // Re-render chart so the new target line appears.
          await self.renderChart(product, analysis, t, container);
        } catch (e) {
          console.error('[Fake Discount] Error saving price target:', e);
        }
      });

      // Also set on Enter key
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btn.click();
      });
    },

    async renderChart(product, analysis, t, widgetContainer) {
      if (!window.AdvancedChart) {
        console.warn('[Fake Discount] AdvancedChart not available');
        return;
      }

      let chartContainer = widgetContainer.querySelector('.fake-discount-chart') ||
                          widgetContainer.querySelector('[id^="price-chart-"]');

      if (!chartContainer) {
        return;
      }

      if (!product || !product.history || !Array.isArray(product.history) || product.history.length === 0) {
        while (chartContainer.firstChild) {
          chartContainer.removeChild(chartContainer.firstChild);
        }

        const chartWidth = chartContainer.clientWidth || chartContainer.offsetWidth || 800;
        try {
          new window.AdvancedChart(chartContainer, {
            width: chartWidth,
            height: 280,
            data: [],
            lineColor: '#3498db',
            t: t,
            locale: getLocale()
          });

          setTimeout(() => {
            const svg = chartContainer.querySelector('svg');
            if (svg) {
              const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              text.setAttribute('x', '50%');
              text.setAttribute('y', '50%');
              text.setAttribute('text-anchor', 'middle');
              text.setAttribute('font-size', '16');
              text.setAttribute('fill', '#666');
              text.textContent = t('insufficientData') || 'Insufficient data';
              svg.appendChild(text);
            }
          }, 100);
        } catch (e) {
          const placeholder = document.createElement('div');
          placeholder.className = 'fake-discount-empty-state';
          placeholder.textContent = t('insufficientData') || 'Insufficient data';
          chartContainer.appendChild(placeholder);
        }
        return;
      }

      const chartData = product.history
        .filter(entry => entry && entry.date && typeof entry.price === 'number' && !isNaN(entry.price))
        .map(entry => ({ date: entry.date, price: entry.price }));

      if (chartData.length === 0) {
        while (chartContainer.firstChild) {
          chartContainer.removeChild(chartContainer.firstChild);
        }
        const placeholder = document.createElement('div');
        placeholder.className = 'fake-discount-empty-state';
        placeholder.textContent = t('insufficientData') || 'Insufficient data';
        chartContainer.appendChild(placeholder);
        return;
      }

      let lineColor = '#3B82F6';
      const verdict = analysis.verdict || 'STABLE_PRICE';
      if (verdict === 'FAKE_DISCOUNT') {
        lineColor = '#EF4444';
      } else if (verdict === 'REAL_DEAL') {
        lineColor = '#10B981';
      } else if (verdict === 'STABLE_PRICE') {
        lineColor = '#F59E0B';
      } else if (verdict === 'VOLATILE_PRICE') {
        // Distinct from stable yellow and fake-discount red — sits between
        // them visually because volatility is a "neither buy nor avoid" state.
        lineColor = '#F97316';
      }

      if (chartContainer.clientWidth === 0) {
        chartContainer.style.width = '100%';
        chartContainer.style.minWidth = '400px';
      }

      // Look up the user's target price for this product so we can draw it
      // as a horizontal line on the chart.
      let targetPrice = null;
      if (product && product.url) {
        try {
          const result = await chrome.storage.local.get(['priceTargets']);
          const targets = result.priceTargets || {};
          if (typeof targets[product.url] === 'number') {
            targetPrice = targets[product.url];
          }
        } catch (e) {}
      }

      try {
        while (chartContainer.firstChild) {
          chartContainer.removeChild(chartContainer.firstChild);
        }

        const chartWidth = chartContainer.clientWidth || chartContainer.offsetWidth || 800;
        new window.AdvancedChart(chartContainer, {
          width: chartWidth,
          height: 280,
          data: chartData,
          lineColor: lineColor,
          averagePrice: analysis.stats?.averagePrice || analysis.historicalAvg,
          targetPrice: targetPrice,
          t: t,
          locale: getLocale()
        });
      } catch (error) {
        console.error('[Fake Discount] Chart error:', error);
        while (chartContainer.firstChild) {
          chartContainer.removeChild(chartContainer.firstChild);
        }
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fake-discount-error';
        errorDiv.textContent = 'Error rendering chart';
        chartContainer.appendChild(errorDiv);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.FakeDiscountWidget = globalObj.FakeDiscountWidget;
  }
})();
