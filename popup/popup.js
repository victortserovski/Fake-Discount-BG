// Popup / full-tab UI: tracked products, settings and data tools.
// DOM-only construction via FDKit.h (createElement + text nodes) — product
// data never passes through innerHTML.
(async function () {
  const kit = window.FDKit;
  const { h, icon, SITES, SITE_KEYS } = kit;

  const i18n = new I18n();
  await i18n.loadTranslations();
  const savedLanguage = (await chrome.storage.local.get(['language'])).language || 'bg';
  if (i18n.getCurrentLanguage() !== savedLanguage) await i18n.setLanguage(savedLanguage);
  const t = (key, params) => i18n.t(key, params);
  let fmt = kit.format(i18n.getCurrentLanguage());

  // Single source of truth for the version: read once from the manifest so
  // bumping manifest.json updates every visible mention.
  const VERSION = chrome.runtime.getManifest().version;
  const CONTACT_EMAIL = 'fakediscountbg@gmail.com';
  // Chrome's `commands` entry serves Cmd+Shift+F on Mac, Ctrl+Shift+F elsewhere.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || '');
  const SHORTCUT_KEYS = isMac ? '⌘+Shift+F' : 'Ctrl+Shift+F';
  const STORAGE_LIMIT = 10 * 1024 * 1024;
  const SORTS = ['recent', 'price-asc', 'price-desc', 'targets'];
  const TAGGED_TONES = new Set(['check', 'low', 'volatile', 'stable']);
  const LANGUAGES = [['bg', 'Български'], ['en', 'English']];

  // "Open in a tab" mode: the same page opened as a normal Chrome tab.
  const isFullView = new URLSearchParams(window.location.search).get('fullview') === '1';
  if (isFullView) document.body.classList.add('fullview');

  // Hosts the popup will navigate to. Derived from the shared store list,
  // which mirrors SUPPORTED_HOSTS in background/service-worker.js. Product
  // URLs are re-validated before chrome.tabs.create as defense in depth
  // against a corrupt or pre-validation storage entry.
  const SUPPORTED_HOSTS = new Set(SITE_KEYS.flatMap(key => [SITES[key].domain, 'www.' + SITES[key].domain]));
  function isSupportedProductUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && SUPPORTED_HOSTS.has(u.hostname.toLowerCase());
    } catch (_) {
      return false;
    }
  }
  // Thumbnails may point at store CDNs — only enforce the https:// scheme.
  function isSafeThumbnailUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
      return new URL(url).protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  const $ = id => document.getElementById(id);
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const send = (action, payload = {}) => new Promise(resolve => {
    chrome.runtime.sendMessage({ action, ...payload }, response => resolve(response));
  });

  const state = {
    loaded: false,
    products: [],
    targets: {},
    settings: {},
    activeSites: new Set(SITE_KEYS),
    search: '',
    sort: 'recent',
    bytes: 0
  };
  const allSitesActive = () => state.activeSites.size === SITE_KEYS.length;

  // ── Toasts + confirm dialog ─────────────────────────────────────────
  function toast(message, tone = 'info') {
    const el = h('div', { class: 'toast', 'data-tone': tone },
      icon(tone === 'error' ? 'alert' : 'check', 15), h('span', null, message));
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  function confirmDialog({ title, text, confirm }) {
    const dialog = $('confirm-dialog');
    clear($('confirm-icon')).appendChild(icon('alert', 20));
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = confirm;
    $('confirm-cancel').textContent = t('data.cancel');
    if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(text));
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.returnValue = '';
      dialog.showModal();
      $('confirm-cancel').focus();
    });
  }

  // ── Filter / sort persistence ───────────────────────────────────────
  // Site chips and sort mode are saved to chrome.storage.local.popupFilters.
  // The search query is intentionally NOT persisted — a stale typed query on
  // reopen would hide most products and confuse the user.
  async function loadFilterState() {
    try {
      const { popupFilters } = await chrome.storage.local.get(['popupFilters']);
      if (!popupFilters) return;
      const valid = Array.isArray(popupFilters.activeSites) ? popupFilters.activeSites.filter(s => SITES[s]) : [];
      if (valid.length) state.activeSites = new Set(valid);
      if (SORTS.includes(popupFilters.sortMode)) state.sort = popupFilters.sortMode;
    } catch (_) { /* missing or malformed — keep defaults */ }
  }

  function saveFilterState() {
    chrome.storage.local.set({ popupFilters: { activeSites: Array.from(state.activeSites), sortMode: state.sort } });
  }

  // ── Data loading ────────────────────────────────────────────────────
  function toViewModel(id, raw) {
    const stats = kit.historyStats(raw.history);
    const site = SITES[raw.site] ? raw.site : (kit.siteFromUrl(raw.url) || raw.site || '');
    let verdict = 'TRACKING';
    if (stats && typeof detectFakeDiscount === 'function') {
      try {
        verdict = detectFakeDiscount({ currentPrice: stats.last.price, originalPrice: stats.last.originalPrice, history: stats.rows }).verdict;
      } catch (_) { /* keep TRACKING */ }
    }
    const title = typeof raw.title === 'string' ? raw.title : '';
    const ean = typeof raw.ean === 'string' && raw.ean ? raw.ean : '';
    return {
      id, site, title, ean, url: raw.url, thumbnail: raw.thumbnail, stats, verdict,
      tone: kit.verdictMeta(verdict).tone,
      price: stats ? stats.last.price : null,
      lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : (stats ? stats.last.date : ''),
      haystack: `${title} ${ean}`.toLowerCase()
    };
  }

  async function loadProducts() {
    const response = await send('getAllProducts');
    try {
      state.targets = (await chrome.storage.local.get(['priceTargets'])).priceTargets || {};
    } catch (_) {
      state.targets = {};
    }
    if (!response || response.success === false) toast(t('errors.loadFailed'), 'error');
    const products = response?.products || {};
    state.products = Object.entries(products)
      .filter(([, product]) => product && product.isActive)
      .map(([id, product]) => toViewModel(id, product));
    state.loaded = true;
    renderProducts();
    renderData();
  }

  async function loadStorage() {
    try {
      state.bytes = await chrome.storage.local.getBytesInUse(null);
    } catch (_) {
      state.bytes = 0;
    }
    renderFooter();
    renderData();
  }

  // Targets are keyed by productId since v3.15.11; older ones by URL.
  const targetFor = p => {
    const value = (p.id && state.targets[p.id]) || (p.url && state.targets[p.url]);
    return typeof value === 'number' && value > 0 ? value : null;
  };

  // ── Formatting helpers ──────────────────────────────────────────────
  function storagePercent(fraction) {
    const pct = fraction * 100;
    const digits = pct === 0 ? 0 : pct < 0.1 ? 3 : pct < 1 ? 2 : pct < 10 ? 1 : 0;
    return new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(pct) + '%';
  }

  function bytesLabel(bytes) {
    const mb = bytes >= 1024 * 1024;
    return new Intl.NumberFormat(fmt.locale, {
      style: 'unit', unit: mb ? 'megabyte' : 'kilobyte', maximumFractionDigits: mb ? 1 : 0
    }).format(bytes / (mb ? 1024 * 1024 : 1024));
  }

  // ── Static labels (re-run on language change) ───────────────────────
  function renderStatic() {
    document.documentElement.lang = fmt.lang;
    document.title = t('brand.name');
    $('brand-name').textContent = t('brand.name');
    $('brand-subtitle').textContent = t('brand.subtitle');
    const full = $('open-fullview');
    full.hidden = isFullView;
    full.setAttribute('aria-label', t('openFullView'));
    full.title = t('openFullView');
    clear(full).appendChild(icon('expand', 16));
    for (const tab of ['products', 'settings', 'data']) {
      $('tab-' + tab).querySelector('.tab-label').textContent = t('tabs.' + tab);
    }
    clear($('search-icon')).appendChild(icon('search', 16));
    const search = $('search-input');
    search.placeholder = t('products.search');
    search.setAttribute('aria-label', t('products.search'));
    const clearBtn = $('search-clear');
    clearBtn.setAttribute('aria-label', t('products.clearSearch'));
    clearBtn.title = t('products.clearSearch');
    clear(clearBtn).appendChild(icon('x', 14));
    $('sort-label').textContent = t('products.sortLabel');
    const sortSelect = $('sort-select');
    const sortKeys = { recent: 'recent', 'price-asc': 'priceAsc', 'price-desc': 'priceDesc', targets: 'targets' };
    Array.from(sortSelect.options).forEach(option => { option.textContent = t('products.sort.' + sortKeys[option.value]); });
    sortSelect.value = state.sort;
  }

  // ── Products ────────────────────────────────────────────────────────
  function visibleProducts() {
    const q = state.search;
    const list = state.products.filter(p => {
      const siteOk = SITES[p.site] ? state.activeSites.has(p.site) : allSitesActive();
      return siteOk && (!q || p.haystack.includes(q));
    });
    const byRecent = (a, b) => b.lastUpdated.localeCompare(a.lastUpdated) || a.title.localeCompare(b.title);
    const byPrice = dir => (a, b) => {
      if (a.price == null || b.price == null) return (a.price == null) - (b.price == null);
      return dir * (a.price - b.price) || byRecent(a, b);
    };
    if (state.sort === 'price-asc') list.sort(byPrice(1));
    else if (state.sort === 'price-desc') list.sort(byPrice(-1));
    else if (state.sort === 'targets') list.sort((a, b) => (targetFor(b) != null) - (targetFor(a) != null) || byRecent(a, b));
    else list.sort(byRecent);
    return list;
  }

  function renderChips() {
    const el = clear($('site-filter-chips'));
    el.setAttribute('aria-label', t('products.storeFilter'));
    const counts = new Map();
    for (const p of state.products) if (SITES[p.site]) counts.set(p.site, (counts.get(p.site) || 0) + 1);
    const sites = Array.from(counts.keys())
      .sort((a, b) => counts.get(b) - counts.get(a) || SITES[a].name.localeCompare(SITES[b].name));
    el.hidden = !state.loaded || (sites.length < 2 && allSitesActive());
    if (el.hidden) return;
    const chip = (key, label, count, pressed) => {
      const btn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), 'data-site': key },
        key !== 'all' && kit.storeMono(key, 'mono--chip'), h('span', null, label), h('span', { class: 'chip-count' }, fmt.number(count)));
      btn.addEventListener('click', () => toggleSite(key));
      return btn;
    };
    el.appendChild(chip('all', t('products.allStores'), state.products.length, allSitesActive()));
    for (const site of sites) el.appendChild(chip(site, SITES[site].name, counts.get(site), !allSitesActive() && state.activeSites.has(site)));
  }

  // "All" → everything. From "All", a store chip narrows to that store;
  // further chips add/remove stores, and removing the last one returns to All.
  function toggleSite(site) {
    if (site === 'all') state.activeSites = new Set(SITE_KEYS);
    else if (allSitesActive()) state.activeSites = new Set([site]);
    else if (state.activeSites.has(site)) {
      state.activeSites.delete(site);
      if (!state.activeSites.size) state.activeSites = new Set(SITE_KEYS);
    } else state.activeSites.add(site);
    saveFilterState();
    renderProducts();
  }

  function sparkline(p) {
    const rows = p.stats ? p.stats.rows.slice(-60) : [];
    if (rows.length < 2) return null;
    const W = 64, H = 22, pad = 2.5;
    const prices = rows.map(r => r.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const t0 = kit.parseDay(rows[0].date).getTime();
    const span = kit.parseDay(rows[rows.length - 1].date).getTime() - t0 || 1;
    const x = r => (pad + ((kit.parseDay(r.date).getTime() - t0) / span) * (W - pad * 2)).toFixed(1);
    const y = v => (hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2)).toFixed(1);
    let d = '';
    rows.forEach((r, i) => { d += i ? `H${x(r)}V${y(r.price)}` : `M${x(r)},${y(r.price)}`; });
    const last = rows[rows.length - 1];
    return kit.s('svg', { class: 'spark', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
      kit.s('path', { d }), kit.s('circle', { cx: x(last), cy: y(last.price), r: 2.4 }));
  }

  function productCard(p) {
    const meta = SITES[p.site];
    const target = targetFor(p);
    const reached = target != null && p.price != null && p.price <= target;
    const card = h('article', { class: 'card', 'data-tone': p.tone });

    const media = h('div', { class: 'card-media' });
    const placeholder = () => h('span', { class: 'card-placeholder' }, icon('box', 20));
    if (isSafeThumbnailUrl(p.thumbnail)) {
      const img = h('img', { src: p.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
      media.appendChild(img);
    } else {
      media.appendChild(placeholder());
    }

    // Defense in depth: only https links to supported stores are opened.
    const canOpen = isSupportedProductUrl(p.url);
    const title = canOpen
      ? h('button', { type: 'button', class: 'card-title card-open', title: p.title || p.url }, p.title || p.url)
      : h('span', { class: 'card-title', title: p.title }, p.title);
    if (canOpen) title.addEventListener('click', () => chrome.tabs.create({ url: p.url }));

    let delta = null;
    const prev = p.stats && p.stats.prev;
    if (prev && prev.price !== p.price) {
      const change = (p.price - prev.price) / prev.price;
      delta = h('span', { class: 'delta ' + (change < 0 ? 'is-down' : 'is-up'), title: t('products.vsPrevious') },
        icon(change < 0 ? 'arrowDown' : 'arrowUp', 12), fmt.percent(Math.abs(change)));
    }

    const meta2 = [];
    if (target != null) {
      const text = reached
        ? `${t('products.targetReached')} · ${fmt.price(target)}`
        : t('products.target', { price: fmt.price(target) }) + (p.price != null ? ` · ${t('products.targetGap', { amount: fmt.price(p.price - target) })}` : '');
      meta2.push(h('span', { class: 'target-chip' + (reached ? ' is-reached' : '') }, icon(reached ? 'check' : 'target', 12), text));
    }
    if (p.ean) {
      const ean = h('button', { type: 'button', class: 'ean', title: t('products.copyEan'), 'aria-label': `${t('products.copyEan')} ${p.ean}` }, icon('copy', 12), p.ean);
      ean.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(p.ean);
          ean.classList.add('is-copied');
          setTimeout(() => ean.classList.remove('is-copied'), 1200);
          toast(t('products.eanCopied'));
        } catch (_) {
          toast(t('errors.copyFailed'), 'error');
        }
      });
      meta2.push(ean);
    }

    const del = h('button', { type: 'button', class: 'card-delete', title: t('products.delete'), 'aria-label': t('products.delete') }, icon('trash', 15));
    let disarmTimer = null;
    const disarm = () => {
      clearTimeout(disarmTimer);
      del.classList.remove('is-armed');
      del.setAttribute('aria-label', t('products.delete'));
      del.querySelector('.card-delete-label')?.remove();
    };
    // Two-step delete: first click arms, second click (within 4s) deletes.
    del.addEventListener('click', () => {
      if (del.classList.contains('is-armed')) {
        disarm();
        deleteProduct(p);
        return;
      }
      del.classList.add('is-armed');
      del.setAttribute('aria-label', t('products.confirmDelete'));
      del.appendChild(h('span', { class: 'card-delete-label' }, t('products.confirmDelete')));
      disarmTimer = setTimeout(disarm, 4000);
    });
    del.addEventListener('blur', disarm);

    card.appendChild(media);
    card.appendChild(h('div', { class: 'card-body' },
      h('div', { class: 'card-top' },
        meta && kit.storeMono(p.site),
        h('span', { class: 'card-store' }, meta ? meta.name : p.site),
        p.lastUpdated && h('span', { class: 'card-updated', title: t('products.updated', { when: fmt.ago(p.lastUpdated) }) }, fmt.ago(p.lastUpdated)),
        TAGGED_TONES.has(p.tone) && h('span', { class: 'tag', 'data-tone': p.tone }, t(`verdictShort.${p.verdict}`))
      ),
      title,
      h('div', { class: 'card-price-row' },
        h('span', { class: 'card-price' + (p.price == null ? ' is-empty' : '') }, p.price == null ? t('products.noPrice') : fmt.price(p.price)),
        delta,
        sparkline(p)
      ),
      meta2.length ? h('div', { class: 'card-meta' }, meta2) : null
    ));
    card.appendChild(del);
    return card;
  }

  async function deleteProduct(p) {
    const response = await send('deleteProduct', { productId: p.id });
    if (response?.success) {
      state.products = state.products.filter(x => x.id !== p.id);
      renderProducts();
      renderData();
      loadStorage();
      toast(t('products.deleted'));
    } else {
      toast(t('errors.deleteFailed'), 'error');
    }
  }

  function renderSkeleton(list) {
    for (let i = 0; i < 4; i++) list.appendChild(h('div', { class: 'card card--skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')));
  }

  function renderProducts() {
    const list = clear($('product-list'));
    const empty = clear($('products-empty'));
    const countEl = $('tab-products-count');
    countEl.textContent = state.loaded && state.products.length ? fmt.number(state.products.length) : '';
    renderChips();
    if (!state.loaded) {
      renderSkeleton(list);
      empty.hidden = true;
      return;
    }

    const visible = visibleProducts();
    $('result-count').textContent = kit.tPlural(t, fmt, 'products.count', visible.length);
    const toolbar = document.querySelector('#panel-products .toolbar');
    toolbar.hidden = state.products.length === 0;

    if (!visible.length) {
      list.hidden = true;
      empty.hidden = false;
      if (state.products.length) {
        empty.appendChild(h('span', { class: 'empty-art' }, icon('search', 22)));
        empty.appendChild(h('h2', null, t('products.noResultsTitle')));
        empty.appendChild(h('p', null, t('products.noResultsBody')));
        const reset = h('button', { type: 'button', class: 'btn btn-secondary' }, t('products.resetFilters'));
        reset.addEventListener('click', () => {
          state.search = '';
          $('search-input').value = '';
          $('search-clear').hidden = true;
          state.activeSites = new Set(SITE_KEYS);
          saveFilterState();
          renderProducts();
        });
        empty.appendChild(reset);
      } else {
        empty.appendChild(h('span', { class: 'empty-art' }, icon('chart', 22)));
        empty.appendChild(h('h2', null, t('products.emptyTitle')));
        empty.appendChild(h('p', null, t('products.emptyBody')));
        empty.appendChild(h('h3', null, t('products.supportedStores')));
        empty.appendChild(h('ul', { class: 'store-cloud' },
          SITE_KEYS.map(key => h('li', null, kit.storeMono(key), SITES[key].name))));
      }
      return;
    }
    list.hidden = false;
    empty.hidden = true;
    for (const p of visible) list.appendChild(productCard(p));
  }

  // ── Settings ────────────────────────────────────────────────────────
  function group(title, aside, ...content) {
    return h('section', { class: 'group' },
      h('div', { class: 'group-head' }, h('h2', null, title), aside),
      ...content);
  }

  function switchControl(id, checked, label, onChange) {
    const input = h('input', { type: 'checkbox', role: 'switch', id, class: 'switch-input', 'aria-label': label });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('span', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }));
  }

  async function loadSettings() {
    const keys = ['showWidget', ...SITE_KEYS.map(key => SITES[key].enableKey)];
    try {
      state.settings = await chrome.storage.local.get(keys);
    } catch (_) {
      state.settings = {};
    }
    renderSettings();
  }

  function renderSettings() {
    const panel = clear($('panel-settings'));
    const current = fmt.lang;

    const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.language') },
      LANGUAGES.map(([code, name]) => {
        const btn = h('button', { type: 'button', lang: code, 'data-lang': code, 'aria-pressed': String(code === current) }, name);
        btn.addEventListener('click', () => changeLanguage(code));
        return btn;
      }));
    panel.appendChild(group(t('settings.language'), null, segmented));

    panel.appendChild(group(t('settings.pageSection'), null,
      h('label', { class: 'row' },
        h('span', { class: 'row-icon' }, icon('eye', 16)),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, t('settings.showWidget')),
          h('span', { class: 'row-desc' }, t('settings.showWidgetDesc'))),
        switchControl('show-widget', state.settings.showWidget !== false, t('settings.showWidget'),
          checked => chrome.storage.local.set({ showWidget: checked })))));

    const enabledCount = () => SITE_KEYS.filter(key => state.settings[SITES[key].enableKey] !== false).length;
    const aside = h('span', { class: 'group-aside' }, t('settings.storesEnabled', { n: enabledCount(), total: SITE_KEYS.length }));
    const rows = SITE_KEYS.map(key => {
      const { enableKey, name, domain } = SITES[key];
      return h('label', { class: 'row row--store' },
        kit.storeMono(key),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-desc' }, domain)),
        switchControl('enable-' + key, state.settings[enableKey] !== false, t('settings.storeToggle', { store: name }), checked => {
          state.settings[enableKey] = checked;
          chrome.storage.local.set({ [enableKey]: checked });
          aside.textContent = t('settings.storesEnabled', { n: enabledCount(), total: SITE_KEYS.length });
        }));
    });
    panel.appendChild(group(t('settings.storesSection'), aside,
      h('p', { class: 'group-desc' }, t('settings.storesDesc')),
      h('div', { class: 'store-list' }, rows)));

    // Shortcut link: chrome:// URLs can't be opened from a regular <a href>.
    const change = h('button', { type: 'button', class: 'link-btn' }, t('settings.shortcutChange'));
    change.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
    // Contact: plain text with user-select:all — no mailto link (it opens an
    // empty tab on systems without a configured mail client).
    panel.appendChild(group(t('settings.aboutSection'), null,
      h('dl', { class: 'about' },
        h('div', null, h('dt', null, t('brand.name')), h('dd', null, t('settings.version', { version: VERSION }))),
        h('div', null, h('dt', null, t('settings.shortcut')), h('dd', null, h('kbd', null, SHORTCUT_KEYS), change)),
        h('div', null, h('dt', null, t('settings.contact')), h('dd', null, h('span', { class: 'email-text', title: t('settings.contactHint') }, CONTACT_EMAIL))))));
  }

  async function changeLanguage(lang) {
    if (lang === fmt.lang) return;
    await i18n.setLanguage(lang);
    fmt = kit.format(lang);
    renderAll();
  }

  // ── Data ────────────────────────────────────────────────────────────
  function renderData() {
    const panel = clear($('panel-data'));
    const fraction = Math.min(1, state.bytes / STORAGE_LIMIT);
    const fill = h('span', { class: 'meter-fill' });
    fill.style.width = (fraction > 0 ? Math.max(fraction * 100, 1.5) : 0) + '%';
    const level = fraction < 0.5 ? 'ok' : fraction < 0.8 ? 'warn' : 'bad';
    panel.appendChild(group(t('data.storageSection'), null,
      h('div', { class: 'storage' },
        h('div', { class: 'storage-figure' },
          h('strong', { id: 'storage-percentage' }, storagePercent(fraction)),
          h('span', null, t('data.storageUsed', { used: bytesLabel(state.bytes), total: bytesLabel(STORAGE_LIMIT) }))),
        h('div', { class: 'meter', 'data-level': level, role: 'meter', 'aria-label': t('data.storageSection'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': (fraction * 100).toFixed(2) }, fill),
        h('div', { class: 'storage-row' },
          h('span', null, t('data.trackedProducts')),
          h('strong', { id: 'tracked-products-count' }, fmt.number(state.products.length))))));

    const exportBtn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'export-data' }, icon('download', 15), t('data.export'));
    exportBtn.addEventListener('click', exportData);
    const importBtn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'import-data' }, icon('upload', 15), t('data.import'));
    importBtn.addEventListener('click', startImport);
    panel.appendChild(group(t('data.backupSection'), null,
      h('p', { class: 'group-desc' }, t('data.backupDesc')),
      h('div', { class: 'btn-row' }, exportBtn, importBtn),
      !isFullView && h('p', { class: 'group-note' }, icon('info', 13), t('data.importInTab'))));

    // Mirrors the service worker's 90-day rule so the count matches what
    // "Remove" will actually delete.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const stale = state.products.filter(p => new Date(p.lastUpdated) < cutoff).length;
    const cleanupBtn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'cleanup-old', disabled: state.loaded && !stale }, t('data.cleanupRun'));
    cleanupBtn.addEventListener('click', cleanupOld);
    const clearBtn = h('button', { type: 'button', class: 'btn btn-danger-quiet', id: 'clear-history', disabled: state.loaded && !state.products.length }, t('data.clearAllRun'));
    clearBtn.addEventListener('click', clearAll);
    panel.appendChild(group(t('data.cleanupSection'), null,
      h('div', { class: 'row row--action' },
        h('span', { class: 'row-icon' }, icon('broom', 16)),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, t('data.cleanupOld')),
          h('span', { class: 'row-desc' }, kit.tPlural(t, fmt, 'data.cleanupOld', stale))),
        cleanupBtn),
      h('div', { class: 'row row--action row--danger' },
        h('span', { class: 'row-icon' }, icon('trash', 16)),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, t('data.clearAll')),
          h('span', { class: 'row-desc' }, t('data.clearAllDesc'))),
        clearBtn)));
  }

  function localDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function exportData() {
    const response = await send('exportData');
    if (!response?.success || !response.data) return toast(t('errors.exportFailed'), 'error');
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `fake-discount-data-${localDateKey()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('data.exported'), 'success');
  }

  // A file picker opened from the toolbar popup can close the popup (and
  // with it the change handler) on some platforms, so import runs in a tab.
  function startImport() {
    if (!isFullView) {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?fullview=1#data') });
      window.close();
      return;
    }
    $('import-file').click();
  }

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('importTooLarge');
      const data = JSON.parse(await file.text());
      if (!data || !data.priceHistory) return toast(t('errors.invalidFile'), 'error');
      const response = await send('importData', { data });
      if (!response?.success) return toast(t('errors.importFailed'), 'error');
      const imported = response.imported || 0;
      const skipped = response.skipped || 0;
      toast(skipped > 0
        ? t('data.importSummary', { imported: fmt.number(imported), skipped: fmt.number(skipped) })
        : kit.tPlural(t, fmt, 'data.imported', imported), 'success');
      loadProducts();
      loadStorage();
    } catch (error) {
      console.error('Error importing data:', error);
      toast(t('errors.importFailed'), 'error');
    }
  });

  async function cleanupOld() {
    const response = await send('cleanupOldProducts');
    if (!response?.success) return toast(t('errors.cleanupFailed'), 'error');
    const cleaned = response.cleaned || 0;
    toast(cleaned ? kit.tPlural(t, fmt, 'data.cleanupDone', cleaned) : t('data.cleanupNone'), 'success');
    loadProducts();
    loadStorage();
  }

  async function clearAll() {
    const ok = await confirmDialog({ title: t('data.clearConfirmTitle'), text: t('data.clearConfirmBody'), confirm: t('data.clearConfirm') });
    if (!ok) return;
    const response = await send('clearAllProducts');
    if (!response?.success) return toast(t('errors.clearFailed'), 'error');
    toast(t('data.cleared'), 'success');
    loadProducts();
    loadStorage();
  }

  // ── Footer ──────────────────────────────────────────────────────────
  function renderFooter() {
    $('footer-summary').textContent = t('footer.summary', {
      count: kit.tPlural(t, fmt, 'products.count', state.products.length),
      percentage: storagePercent(Math.min(1, state.bytes / STORAGE_LIMIT))
    });
    $('footer-version').textContent = `v${VERSION}`;
  }

  // ── Tabs ────────────────────────────────────────────────────────────
  const TABS = ['products', 'settings', 'data'];
  function activateTab(name, focus) {
    for (const tab of TABS) {
      const btn = $('tab-' + tab);
      const active = tab === name;
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
      $('panel-' + tab).hidden = !active;
      if (active && focus) btn.focus();
    }
    document.querySelector('.panels').scrollTop = 0;
  }
  for (const tab of TABS) $('tab-' + tab).addEventListener('click', () => activateTab(tab));
  $('tabs').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const current = TABS.findIndex(tab => $('tab-' + tab).getAttribute('aria-selected') === 'true');
    activateTab(TABS[(current + step + TABS.length) % TABS.length], true);
  });

  // ── Toolbar events ──────────────────────────────────────────────────
  $('open-fullview').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?fullview=1') });
    window.close();
  });

  let searchTimer = null;
  $('search-input').addEventListener('input', (e) => {
    $('search-clear').hidden = !e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim().toLowerCase();
      renderProducts();
    }, 120);
  });
  $('search-clear').addEventListener('click', () => {
    const input = $('search-input');
    input.value = '';
    $('search-clear').hidden = true;
    state.search = '';
    renderProducts();
    input.focus();
  });
  $('sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    saveFilterState();
    renderProducts();
  });
  // "/" jumps to search from anywhere on the Products tab.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.target.closest('input, textarea, select') || $('panel-products').hidden) return;
    e.preventDefault();
    $('search-input').focus();
  });

  function renderAll() {
    renderStatic();
    renderProducts();
    renderSettings();
    renderData();
    renderFooter();
  }

  // ── Initialize ──────────────────────────────────────────────────────
  // Restore persisted filter/sort state BEFORE the first product render so
  // the chips and dropdown reflect the saved selection on open.
  await loadFilterState();
  renderAll();
  if (isFullView && window.location.hash === '#data') activateTab('data');
  loadSettings();
  loadStorage();
  await loadProducts();
  renderFooter();

  // Refresh when storage changes (e.g. a product page open in another tab).
  let refreshTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const relevant = Object.keys(changes).some(k => k.startsWith('p_') || k === 'product_index' || k === 'priceTargets');
    if (!relevant) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      loadStorage();
      loadProducts();
    }, 800);
  });
})();
