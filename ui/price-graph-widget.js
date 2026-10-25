// In-page price panel. Runs in the content-script isolated world and renders
// into an open shadow root on the #fake-discount-widget host, so retailer CSS
// can't restyle it and its styles can't leak into the retailer page.
(function () {
  'use strict';

  const kit = window.FDKit;
  const { h, icon } = kit;
  const RANGES = [['1m', 30], ['3m', 90], ['1y', 365]];
  const FAILURE_REASONS = new Set(['extractionFailed', 'trackingFailed']);
  const isolated = new WeakSet();
  let i18nPromise = null;

  function loadI18n() {
    if (!i18nPromise) {
      const fallback = { t: key => key, getCurrentLanguage: () => 'bg' };
      i18nPromise = (async () => {
        const instance = window.i18n || (window.I18n ? new window.I18n() : null);
        if (!instance) return fallback;
        await instance.loadTranslations();
        return instance;
      })().catch(() => fallback);
    }
    return i18nPromise;
  }

  function extensionUrl(path) {
    try { return chrome.runtime.getURL(path); } catch (_) { return ''; }
  }

  // Keep widget events away from the host page (e.g. Ozone's add-to-cart
  // form, retailer keyboard shortcuts). Bubble phase only — a capture-phase
  // listener here would swallow the event before it reaches our own
  // input/button.
  function isolate(container) {
    if (isolated.has(container)) return;
    isolated.add(container);
    for (const eventType of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit', 'keydown', 'keyup', 'keypress']) {
      container.addEventListener(eventType, (e) => {
        e.stopPropagation();
        if (eventType === 'submit') e.preventDefault();
      });
    }
  }

  // Shadow root + stylesheet. The stage stays invisible until the stylesheet
  // has loaded so the page never flashes unstyled widget markup.
  function mount(container) {
    const shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    const stage = h('div', { class: 'fd-stage' });
    stage.style.visibility = 'hidden';
    const href = extensionUrl('ui/price-graph-widget.css');
    let ready = Promise.resolve();
    if (href) {
      const link = h('link', { rel: 'stylesheet', href });
      ready = new Promise(resolve => {
        link.addEventListener('load', resolve);
        link.addEventListener('error', resolve);
        setTimeout(resolve, 2500);
      });
      shadow.appendChild(link);
    }
    shadow.appendChild(stage);
    return { stage, ready: ready.then(() => { stage.style.visibility = ''; }) };
  }

  // Reason params arrive as raw numbers; prices are formatted here so the
  // explanation uses the same currency format as the rest of the panel.
  function formatReasonParams(params, fmt) {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) {
      if (typeof value !== 'number') out[key] = value;
      else out[key] = /Price$/.test(key) ? fmt.price(value) : fmt.number(value);
    }
    return out;
  }

  function num(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  async function readStorage(keys) {
    try { return await chrome.storage.local.get(keys); } catch (_) { return {}; }
  }

  function buildPanel(ctx) {
    const { t, fmt, product, analysis, stats } = ctx;
    const verdict = analysis.verdict || 'TRACKING';
    const meta = kit.verdictMeta(verdict);
    const failed = FAILURE_REASONS.has(analysis.reasonKey);
    // A successful visit always records today's observation, so an empty
    // history means the page offered no purchasable price (out of stock).
    const noPrice = !stats && !failed;
    const verdictTitle = failed ? t('widget.failed') : noPrice ? t('widget.unavailable') : t(`verdicts.${verdict}`);
    const chipText = failed || noPrice ? t('widget.unavailableShort') : t(`verdictShort.${verdict}`);
    const site = product.site || kit.siteFromUrl(product.url || location.href);
    const siteMeta = kit.SITES[site];
    const today = stats ? stats.last.price : null;
    const claimed = num(analysis.originalPrice) || num(stats && stats.last.originalPrice);
    ctx.claimed = claimed && today && claimed > today ? claimed : null;

    const root = h('div', { class: 'fd', 'data-tone': meta.tone, 'data-collapsed': String(ctx.collapsed) });
    ctx.root = root;

    // ── Header (doubles as the collapsed summary) ──
    const toggle = h('button', {
      type: 'button', class: 'fd-icon-btn fd-toggle',
      'aria-expanded': String(!ctx.collapsed),
      'aria-label': ctx.collapsed ? t('widget.expand') : t('widget.collapse'),
      title: ctx.collapsed ? t('widget.expand') : t('widget.collapse')
    }, icon('chevronDown', 18));
    ctx.toggle = toggle;
    const header = h('header', { class: 'fd-head' },
      h('div', { class: 'fd-brand' },
        h('img', { class: 'fd-logo', src: extensionUrl('icons/icon32.png') || null, alt: '', width: 20, height: 20 }),
        h('span', { class: 'fd-brand-name' }, t('brand.name'))
      ),
      siteMeta && h('span', { class: 'fd-store' }, kit.storeMono(site), siteMeta.domain),
      h('span', { class: 'fd-spacer' }),
      h('span', { class: 'fd-summary' },
        h('span', { class: 'fd-chip' }, icon(failed || noPrice ? 'info' : meta.icon, 14), chipText),
        today != null && h('span', { class: 'fd-summary-price' }, fmt.price(today))
      ),
      toggle
    );
    header.addEventListener('click', (e) => {
      if (e.target.closest('.fd-toggle') || ctx.collapsed) ctx.setCollapsed(!ctx.collapsed);
    });
    root.appendChild(header);

    const body = h('div', { class: 'fd-body' });
    const bodyWrap = h('div', { class: 'fd-body-wrap' }, body);
    if (ctx.collapsed) bodyWrap.setAttribute('inert', '');
    ctx.bodyWrap = bodyWrap;
    root.appendChild(bodyWrap);

    // ── Verdict ──
    let reason = null;
    if (noPrice) {
      reason = t('widget.unavailableReason');
    } else if (analysis.reasonKey) {
      const text = t(`reasons.${analysis.reasonKey}`, formatReasonParams(analysis.reasonParams, fmt));
      if (text !== `reasons.${analysis.reasonKey}`) reason = text;
    }
    let progress = null;
    if (stats && verdict === 'TRACKING' && analysis.reasonKey === 'insufficientData') {
      const current = Number(analysis.reasonParams?.current) || 0;
      const needed = Number(analysis.reasonParams?.needed) || 7;
      const bar = h('span', { class: 'fd-progress-fill' });
      bar.style.width = `${Math.min(100, (current / needed) * 100)}%`;
      progress = h('div', { class: 'fd-progress' },
        h('span', { class: 'fd-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': needed, 'aria-valuenow': current, 'aria-label': t('widget.progress', { current, needed }) }, bar),
        h('span', { class: 'fd-progress-label' }, t('widget.progress', { current, needed }))
      );
    }
    body.appendChild(h('section', { class: 'fd-verdict' },
      h('span', { class: 'fd-verdict-icon' }, icon(failed || noPrice ? 'info' : meta.icon, 20)),
      h('div', { class: 'fd-verdict-body' },
        h('h3', { class: 'fd-verdict-title' }, verdictTitle),
        reason && h('p', { class: 'fd-verdict-reason' }, reason),
        progress
      )
    ));

    if (stats) {
      // ── Key numbers ──
      const avgDelta = stats.average > 0 ? (today - stats.average) / stats.average : 0;
      const todaySub = ctx.claimed
        ? h('span', { class: 'fd-stat-sub fd-claimed', title: t('widget.claimedHint') },
          t('widget.claimedShort'), ' ', h('s', null, fmt.price(ctx.claimed)), ' ',
          h('b', null, fmt.signedPercent((today - ctx.claimed) / ctx.claimed)))
        : h('span', { class: 'fd-stat-sub' + (Math.abs(avgDelta) >= 0.005 ? (avgDelta < 0 ? ' is-down' : ' is-up') : '') },
          Math.abs(avgDelta) >= 0.005 ? t('widget.vsAverage', { percent: fmt.signedPercent(avgDelta) }) : t('widget.atAverage'));
      const stat = (cls, label, value, sub) => h('div', { class: 'fd-stat ' + cls },
        h('span', { class: 'fd-stat-label' }, label),
        h('span', { class: 'fd-stat-value' }, value),
        sub
      );
      body.appendChild(h('section', { class: 'fd-stats' },
        stat('fd-stat--today', t('widget.today'), fmt.price(today), todaySub),
        stat('fd-stat--low', t('widget.lowest'), fmt.price(stats.low.price), h('span', { class: 'fd-stat-sub' }, t('widget.onDate', { date: fmt.day(stats.low.date) }))),
        stat('fd-stat--avg', t('widget.average'), fmt.price(stats.average), h('span', { class: 'fd-stat-sub' }, kit.tPlural(t, fmt, 'widget.observations', stats.count))),
        stat('fd-stat--high', t('widget.highest'), fmt.price(stats.high.price), h('span', { class: 'fd-stat-sub' }, t('widget.onDate', { date: fmt.day(stats.high.date) })))
      ));

      // ── Chart ──
      const span = kit.daysBetween(stats.rows[0].date, stats.last.date);
      const ranges = RANGES.filter(([, days]) => span > days);
      ctx.range = 'all';
      let seg = null;
      if (ranges.length) {
        seg = h('div', { class: 'fd-seg', role: 'group', 'aria-label': t('widget.rangeLabel') });
        for (const [key] of [...ranges, ['all']]) {
          const btn = h('button', { type: 'button', 'aria-pressed': String(key === 'all'), 'data-range': key }, t(`widget.range.${key}`));
          btn.addEventListener('click', () => {
            ctx.range = key;
            seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            ctx.renderChart();
          });
          seg.appendChild(btn);
        }
      }
      ctx.chartEl = h('div', { class: 'fd-chart' });
      ctx.legend = h('ul', { class: 'fd-legend' });
      body.appendChild(h('section', { class: 'fd-chart-block' },
        h('div', { class: 'fd-chart-head' }, h('h4', { class: 'fd-section-title' }, t('widget.history')), seg),
        ctx.chartEl,
        ctx.legend
      ));
    }

    // ── Footer: target + last change ──
    const foot = h('footer', { class: 'fd-foot' });
    if (product.id) foot.appendChild(buildTarget(ctx));
    if (stats) {
      foot.appendChild(h('span', { class: 'fd-lastchange' },
        stats.lastChange ? t('widget.lastChange', { date: fmt.dayLong(stats.lastChange.date) }) : t('widget.noChanges')));
    }
    body.appendChild(foot);
    body.appendChild(h('p', { class: 'fd-note' }, icon('shield', 13), t('widget.disclaimer')));
    return root;
  }

  function buildTarget(ctx) {
    const { t } = ctx;
    ctx.input = h('input', {
      id: 'fd-target', class: 'fd-target-input', type: 'text', inputmode: 'decimal',
      autocomplete: 'off', spellcheck: 'false', placeholder: t('target.placeholder'),
      'aria-describedby': 'fd-target-status'
    });
    ctx.saveBtn = h('button', { type: 'button', class: 'fd-btn fd-btn--primary fd-target-save' }, t('target.set'));
    ctx.clearBtn = h('button', { type: 'button', class: 'fd-btn fd-btn--ghost fd-target-clear', hidden: true }, t('target.clear'));
    ctx.status = h('span', { id: 'fd-target-status', class: 'fd-target-status', 'aria-live': 'polite' });
    return h('div', { class: 'fd-target' },
      h('label', { class: 'fd-target-label', for: 'fd-target' }, icon('target', 15), t('target.label')),
      h('span', { class: 'fd-field' }, ctx.input, h('span', { class: 'fd-field-suffix', 'aria-hidden': 'true' }, t('currencySymbol'))),
      ctx.saveBtn,
      ctx.clearBtn,
      ctx.status
    );
  }

  function wire(ctx) {
    const { t, fmt, product, stats } = ctx;

    ctx.setCollapsed = (collapsed) => {
      ctx.collapsed = collapsed;
      ctx.root.setAttribute('data-collapsed', String(collapsed));
      ctx.toggle.setAttribute('aria-expanded', String(!collapsed));
      const label = collapsed ? t('widget.expand') : t('widget.collapse');
      ctx.toggle.setAttribute('aria-label', label);
      ctx.toggle.setAttribute('title', label);
      if (collapsed) ctx.bodyWrap.setAttribute('inert', '');
      else ctx.bodyWrap.removeAttribute('inert');
      try { chrome.storage.local.set({ widgetCollapsed: collapsed }); } catch (_) {}
    };

    ctx.renderChart = () => {
      if (!ctx.chartEl || !window.AdvancedChart) return;
      let rows = stats.rows;
      const days = (RANGES.find(([key]) => key === ctx.range) || [])[1];
      if (days) {
        const cutoff = stats.last.date;
        rows = rows.filter(r => kit.daysBetween(r.date, cutoff) <= days);
      }
      const options = {
        data: rows,
        average: stats.count > 1 ? stats.average : null,
        target: ctx.target,
        claimed: ctx.claimed,
        targetLabel: t('chart.target'),
        claimedLabel: t('chart.claimed'),
        ariaLabel: t('widget.chartLabel', {
          count: fmt.number(rows.length), from: fmt.dayLong(rows[0].date), to: fmt.dayLong(rows[rows.length - 1].date),
          low: fmt.price(stats.low.price), high: fmt.price(stats.high.price)
        })
      };
      try {
        if (ctx.chart) ctx.chart.update(options);
        else {
          const width = ctx.chartEl.clientWidth;
          ctx.chart = new window.AdvancedChart(ctx.chartEl, {
            ...options, width: width || 600, height: width && width < 520 ? 190 : 230,
            format: fmt, t, responsive: true
          });
        }
      } catch (e) {
        console.error('[Fake Discount] Chart error:', e);
        while (ctx.chartEl.firstChild) ctx.chartEl.removeChild(ctx.chartEl.firstChild);
        ctx.chartEl.appendChild(h('p', { class: 'fd-chart-error' }, t('errors.chartRenderFailed')));
      }
      renderLegend(ctx);
    };

    if (!ctx.input) return;

    // Target storage key: the stable productId, not the browser URL (the
    // same product reached via `?ref=…` or `#section` must resolve to the
    // same target). Targets saved before v3.15.11 were keyed by URL and are
    // migrated through the service worker on first revisit.
    const productKey = product.id || product.url || '';
    const save = async (value) => {
      const response = await chrome.runtime.sendMessage({ action: 'setPriceTarget', productId: productKey, value });
      if (!response?.success) throw new Error('Target save failed');
    };

    const renderStatus = (state) => {
      const status = ctx.status;
      status.className = 'fd-target-status';
      while (status.firstChild) status.removeChild(status.firstChild);
      ctx.input.removeAttribute('aria-invalid');
      ctx.clearBtn.hidden = ctx.target == null;
      if (state === 'invalid') {
        status.classList.add('is-error');
        status.textContent = t('target.invalid');
        ctx.input.setAttribute('aria-invalid', 'true');
        return;
      }
      if (state === 'failed') {
        status.classList.add('is-error');
        status.textContent = t('target.saveFailed');
        return;
      }
      if (ctx.target == null) return;
      const today = stats ? stats.last.price : null;
      if (today != null && today <= ctx.target) {
        status.classList.add('is-reached');
        status.appendChild(icon('check', 13));
        status.appendChild(document.createTextNode(t('target.reached')));
      } else if (today != null) {
        const gap = today - ctx.target;
        status.textContent = t('target.above', { amount: fmt.price(gap), percent: fmt.percent(gap / today) });
      }
    };

    const flash = () => {
      const btn = ctx.saveBtn;
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.appendChild(icon('check', 15));
      btn.appendChild(document.createTextNode(t('target.saved')));
      btn.classList.add('is-saved');
      clearTimeout(ctx.flashTimer);
      ctx.flashTimer = setTimeout(() => {
        btn.textContent = t('target.set');
        btn.classList.remove('is-saved');
      }, 1400);
    };

    const commit = async (value) => {
      try {
        await save(value);
        ctx.target = value;
        ctx.input.value = value == null ? '' : fmt.decimal(value);
        renderStatus();
        if (value != null) flash();
        ctx.renderChart();
      } catch (e) {
        console.error('[Fake Discount] Error saving price target:', e);
        renderStatus('failed');
      }
    };

    ctx.saveBtn.addEventListener('click', () => {
      const raw = ctx.input.value.trim();
      if (!raw) {
        if (ctx.target != null) commit(null);
        else renderStatus('invalid');
        return;
      }
      const value = kit.parsePriceInput(raw);
      if (!(value > 0 && value <= 1000000)) return renderStatus('invalid');
      commit(value);
    });
    ctx.clearBtn.addEventListener('click', () => commit(null));
    ctx.input.addEventListener('input', () => {
      if (ctx.input.getAttribute('aria-invalid')) renderStatus();
    });
    // Enter sets the target. preventDefault keeps it from ever acting as an
    // implicit form submission; the shared loader also keeps the widget
    // outside retailer forms.
    ctx.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        ctx.saveBtn.click();
      }
    });

    ctx.loadTarget = async () => {
      const legacyUrlKey = product.url || '';
      const targets = (await readStorage(['priceTargets'])).priceTargets || {};
      let existing = targets[productKey];
      if (existing == null && legacyUrlKey && legacyUrlKey !== productKey && targets[legacyUrlKey] != null) {
        existing = targets[legacyUrlKey];
        try { await save(existing); } catch (_) {}
      }
      if (typeof existing === 'number' && existing > 0) {
        ctx.target = existing;
        ctx.input.value = fmt.decimal(existing);
      }
      renderStatus();
    };
  }

  function renderLegend(ctx) {
    const { t, legend } = ctx;
    if (!legend) return;
    while (legend.firstChild) legend.removeChild(legend.firstChild);
    const item = (kind, label) => legend.appendChild(h('li', null, h('span', { class: `fd-key fd-key--${kind}` }), label));
    item('price', t('widget.legend.price'));
    if (ctx.stats.count > 1) item('avg', t('widget.legend.average'));
    if (ctx.target != null) item('target', t('widget.legend.target'));
    if (ctx.claimed != null) item('claimed', t('widget.legend.claimed'));
  }

  const globalObj = (typeof window !== 'undefined') ? window : self;

  globalObj.FakeDiscountWidget = {
    async init(container, product, analysis) {
      if (!container || !container.parentNode) return;
      const i18n = await loadI18n();
      const t = (key, params) => i18n.t(key, params);
      const fmt = kit.format(i18n.getCurrentLanguage ? i18n.getCurrentLanguage() : 'bg');
      isolate(container);
      const { stage, ready } = mount(container);
      try {
        const prefs = await readStorage(['widgetCollapsed']);
        const ctx = {
          t, fmt, product: product || {}, analysis: analysis || {},
          stats: kit.historyStats(product && product.history),
          collapsed: prefs.widgetCollapsed === true,
          target: null
        };
        stage.appendChild(buildPanel(ctx));
        wire(ctx);
        container.setAttribute('data-widget-status', 'initialized');
        container.style.minHeight = '';
        if (ctx.loadTarget) await ctx.loadTarget();
        await ready;
        if (ctx.stats) ctx.renderChart();
      } catch (e) {
        console.error('[Fake Discount] Widget error:', e);
        this.renderError(container, t('errorLoadingWidget'));
      }
    },

    renderError(container, message) {
      if (!container) return;
      const { stage } = mount(container);
      stage.appendChild(h('div', { class: 'fd fd--error', role: 'alert' }, icon('alert', 18), h('span', null, message)));
    }
  };
})();
