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

  // Detect "Open in full tab" mode (popup.html opened as a normal Chrome
  // tab via the ↗ link). Drops the fixed popup width so the layout flows.
  const isFullView = new URLSearchParams(window.location.search).get('fullview') === '1';
  if (isFullView) {
    document.body.classList.add('fullview');
  }

  // Single source of truth for the current version. Read once at popup load
  // from the manifest so every visible mention (About line, mailto subject,
  // mailto body) updates automatically the next time manifest.json is bumped.
  const VERSION = chrome.runtime.getManifest().version;
  const CONTACT_EMAIL = 'fakediscountbg@gmail.com';

  // Detect platform for the keyboard-shortcut hint. Chrome's `commands`
  // entry serves Cmd+Shift+F to Mac and Ctrl+Shift+F to everything else;
  // the displayed text needs to match what the user actually presses.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || '');
  const SHORTCUT_KEYS = isMac ? '⌘+Shift+F' : 'Ctrl+Shift+F';

  // ── Filter / sort state ─────────────────────────────────────────────
  // Multi-select site chips: a Set of enabled site keys. Default = all.
  // Site filters and sort mode persist across popup reopens (saved to
  // chrome.storage.local under `popupFilters`). The search query is
  // intentionally NOT persisted — a stale typed query on reopen would
  // hide most products and confuse the user.
  const ALL_SITES = ['emag', 'ozone', 'notino', 'technopolis', 'technomarket', 'zora', 'ardes', 'plesio', 'aboutyou', 'answear', 'decathlon', 'dm', 'fashiondays', 'lilly', 'bricolage', 'obuvki', 'praktiker', 'sopharmacy', 'sportdepot', 'ebag'];

  // Hosts we'll navigate to from the popup. Mirrors the SUPPORTED_HOSTS
  // set in background/service-worker.js — kept in sync because the popup
  // re-validates `product.url` before `chrome.tabs.create` (defense in
  // depth against a corrupt or pre-validation storage entry).
  const SUPPORTED_HOSTS = new Set([
    'emag.bg', 'www.emag.bg',
    'ozone.bg', 'www.ozone.bg',
    'notino.bg', 'www.notino.bg',
    'technopolis.bg', 'www.technopolis.bg',
    'technomarket.bg', 'www.technomarket.bg',
    'zora.bg', 'www.zora.bg',
    'ardes.bg', 'www.ardes.bg',
    'plesio.bg', 'www.plesio.bg',
    'aboutyou.bg', 'www.aboutyou.bg',
    'answear.bg', 'www.answear.bg',
    'decathlon.bg', 'www.decathlon.bg',
    'dm-drogeriemarkt.bg', 'www.dm-drogeriemarkt.bg',
    'fashiondays.bg', 'www.fashiondays.bg',
    'lillydrogerie.bg', 'www.lillydrogerie.bg',
    'mr-bricolage.bg', 'www.mr-bricolage.bg',
    'obuvki.bg', 'www.obuvki.bg',
    'praktiker.bg', 'www.praktiker.bg',
    'sopharmacy.bg', 'www.sopharmacy.bg',
    'sportdepot.bg', 'www.sportdepot.bg',
    'ebag.bg', 'www.ebag.bg'
  ]);
  function isSupportedProductUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      return SUPPORTED_HOSTS.has(u.hostname.toLowerCase());
    } catch (_) {
      return false;
    }
  }
  const activeSites = new Set(ALL_SITES);
  let searchQuery = '';
  let sortMode = 'recent';
  let cachedProducts = []; // full normalized list
  let cachedTargets = {};  // { url: targetPrice }

  async function loadFilterState() {
    try {
      const { popupFilters } = await chrome.storage.local.get(['popupFilters']);
      if (!popupFilters) return;
      // Restore site filter chips (must keep at least one site enabled).
      if (Array.isArray(popupFilters.activeSites) && popupFilters.activeSites.length > 0) {
        const valid = popupFilters.activeSites.filter(s => ALL_SITES.includes(s));
        if (valid.length > 0) {
          activeSites.clear();
          valid.forEach(s => activeSites.add(s));
          document.querySelectorAll('#site-filter-chips .chip').forEach(chip => {
            chip.classList.toggle('active', activeSites.has(chip.dataset.site));
          });
        }
      }
      // Restore sort mode.
      const validSorts = ['recent', 'price-asc', 'price-desc', 'targets'];
      if (validSorts.includes(popupFilters.sortMode)) {
        sortMode = popupFilters.sortMode;
        document.getElementById('sort-select').value = sortMode;
      }
    } catch (_) { /* missing or malformed — fall back to defaults */ }
  }

  function saveFilterState() {
    chrome.storage.local.set({
      popupFilters: {
        activeSites: Array.from(activeSites),
        sortMode
      }
    });
  }

  // ── Tab switching ───────────────────────────────────────────────────
  function activateTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      const isActive = panel.dataset.tabPanel === tabName;
      panel.hidden = !isActive;
      panel.classList.toggle('active', isActive);
    });
  }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // ── Open in full tab ────────────────────────────────────────────────
  document.getElementById('open-fullview').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: chrome.runtime.getURL('popup/popup.html?fullview=1')
    });
    window.close();
  });

  // ── Load settings ───────────────────────────────────────────────────
  async function loadSettings() {
    const settings = await chrome.storage.local.get([
      'language',
      'enableEmag',
      'enableOzone',
      'enableNotino',
      'enableTechnopolis',
      'enableTechnomarket',
      'enableZora',
      'enableArdes',
      'enablePlesio',
      'enableAboutyou',
      'enableAnswear',
      'enableDecathlon',
      'enableDm',
      'enableFashiondays',
      'enableLilly',
      'enableBricolage',
      'enableObuvki',
      'enablePraktiker',
      'enableSopharmacy',
      'enableSportdepot',
      'enableEbag',
      'showWidget'
    ]);

    document.getElementById('language-select').value = settings.language || 'bg';
    document.getElementById('enable-emag').checked = settings.enableEmag !== false;
    document.getElementById('enable-ozone').checked = settings.enableOzone !== false;
    document.getElementById('enable-notino').checked = settings.enableNotino !== false;
    document.getElementById('enable-technopolis').checked = settings.enableTechnopolis !== false;
    document.getElementById('enable-technomarket').checked = settings.enableTechnomarket !== false;
    document.getElementById('enable-zora').checked = settings.enableZora !== false;
    document.getElementById('enable-ardes').checked = settings.enableArdes !== false;
    document.getElementById('enable-plesio').checked = settings.enablePlesio !== false;
    document.getElementById('enable-aboutyou').checked = settings.enableAboutyou !== false;
    document.getElementById('enable-answear').checked = settings.enableAnswear !== false;
    document.getElementById('enable-decathlon').checked = settings.enableDecathlon !== false;
    document.getElementById('enable-dm').checked = settings.enableDm !== false;
    document.getElementById('enable-fashiondays').checked = settings.enableFashiondays !== false;
    document.getElementById('enable-lilly').checked = settings.enableLilly !== false;
    document.getElementById('enable-bricolage').checked = settings.enableBricolage !== false;
    document.getElementById('enable-obuvki').checked = settings.enableObuvki !== false;
    document.getElementById('enable-praktiker').checked = settings.enablePraktiker !== false;
    document.getElementById('enable-sopharmacy').checked = settings.enableSopharmacy !== false;
    document.getElementById('enable-sportdepot').checked = settings.enableSportdepot !== false;
    document.getElementById('enable-ebag').checked = settings.enableEbag !== false;
    document.getElementById('show-widget').checked = settings.showWidget !== false;

    updateUI();
  }

  // ── Translate UI labels ─────────────────────────────────────────────
  function updateUI() {
    // Tabs
    document.getElementById('tab-products').textContent = t('tabs.products');
    document.getElementById('tab-settings').textContent = t('tabs.settings');
    document.getElementById('tab-data').textContent = t('tabs.data');

    // Filter bar
    document.getElementById('search-input').placeholder = t('search.placeholder');
    document.getElementById('sort-label').textContent = t('sort.label');
    const sortSelect = document.getElementById('sort-select');
    sortSelect.options[0].textContent = t('sort.recent');
    sortSelect.options[1].textContent = t('sort.priceAsc');
    sortSelect.options[2].textContent = t('sort.priceDesc');
    sortSelect.options[3].textContent = t('sort.targetsFirst');

    // Settings tab
    document.getElementById('language-label').textContent = t('settings.language');
    document.getElementById('enable-emag-label').textContent = t('settings.enableEmag');
    document.getElementById('enable-ozone-label').textContent = t('settings.enableOzone');
    document.getElementById('enable-notino-label').textContent = t('settings.enableNotino');
    document.getElementById('enable-technopolis-label').textContent = t('settings.enableTechnopolis');
    document.getElementById('enable-technomarket-label').textContent = t('settings.enableTechnomarket');
    document.getElementById('enable-zora-label').textContent = t('settings.enableZora');
    document.getElementById('enable-ardes-label').textContent = t('settings.enableArdes');
    document.getElementById('enable-plesio-label').textContent = t('settings.enablePlesio');
    document.getElementById('enable-aboutyou-label').textContent = t('settings.enableAboutyou');
    document.getElementById('enable-answear-label').textContent = t('settings.enableAnswear');
    document.getElementById('enable-decathlon-label').textContent = t('settings.enableDecathlon');
    document.getElementById('enable-dm-label').textContent = t('settings.enableDm');
    document.getElementById('enable-fashiondays-label').textContent = t('settings.enableFashiondays');
    document.getElementById('enable-lilly-label').textContent = t('settings.enableLilly');
    document.getElementById('enable-bricolage-label').textContent = t('settings.enableBricolage');
    document.getElementById('enable-obuvki-label').textContent = t('settings.enableObuvki');
    document.getElementById('enable-praktiker-label').textContent = t('settings.enablePraktiker');
    document.getElementById('enable-sopharmacy-label').textContent = t('settings.enableSopharmacy');
    document.getElementById('enable-sportdepot-label').textContent = t('settings.enableSportdepot');
    document.getElementById('enable-ebag-label').textContent = t('settings.enableEbag');
    document.getElementById('show-widget-label').textContent = t('settings.showWidget');
    document.getElementById('enable-emag-desc').textContent = t('settings.enableEmagDesc');
    document.getElementById('enable-ozone-desc').textContent = t('settings.enableOzoneDesc');
    document.getElementById('enable-notino-desc').textContent = t('settings.enableNotinoDesc');
    document.getElementById('enable-technopolis-desc').textContent = t('settings.enableTechnopolisDesc');
    document.getElementById('enable-technomarket-desc').textContent = t('settings.enableTechnomarketDesc');
    document.getElementById('enable-zora-desc').textContent = t('settings.enableZoraDesc');
    document.getElementById('enable-ardes-desc').textContent = t('settings.enableArdesDesc');
    document.getElementById('enable-plesio-desc').textContent = t('settings.enablePlesioDesc');
    document.getElementById('enable-aboutyou-desc').textContent = t('settings.enableAboutyouDesc');
    document.getElementById('enable-answear-desc').textContent = t('settings.enableAnswearDesc');
    document.getElementById('enable-decathlon-desc').textContent = t('settings.enableDecathlonDesc');
    document.getElementById('enable-dm-desc').textContent = t('settings.enableDmDesc');
    document.getElementById('enable-fashiondays-desc').textContent = t('settings.enableFashiondaysDesc');
    document.getElementById('enable-lilly-desc').textContent = t('settings.enableLillyDesc');
    document.getElementById('enable-bricolage-desc').textContent = t('settings.enableBricolageDesc');
    document.getElementById('enable-obuvki-desc').textContent = t('settings.enableObuvkiDesc');
    document.getElementById('enable-praktiker-desc').textContent = t('settings.enablePraktikerDesc');
    document.getElementById('enable-sopharmacy-desc').textContent = t('settings.enableSopharmacyDesc');
    document.getElementById('enable-sportdepot-desc').textContent = t('settings.enableSportdepotDesc');
    document.getElementById('enable-ebag-desc').textContent = t('settings.enableEbagDesc');
    document.getElementById('show-widget-desc').textContent = t('settings.showWidgetDesc');

    // Data tab
    document.getElementById('storage-title').textContent = t('storage');
    document.getElementById('storage-used-label').textContent = t('settings.storageUsed');
    document.getElementById('tracked-products-label').textContent = t('settings.trackedProducts');
    document.getElementById('cleanup-old').textContent = t('settings.cleanupOld');
    document.getElementById('clear-history').textContent = t('settings.clearHistory');
    document.getElementById('data-title').textContent = t('settings.data') || 'Data';
    document.getElementById('export-data').textContent = t('settings.exportData');
    document.getElementById('import-data').textContent = t('settings.importData');

    // Empty-state message in Products tab
    document.getElementById('no-products-message').textContent = t('settings.noProducts');

    // Open-in-tab tooltip
    document.getElementById('open-fullview').title = t('openFullView') || 'Open in full tab';

    updateAboutSection();
  }

  // Render the About block (version + contact email + keyboard shortcut hint).
  // Built with createElement instead of innerHTML so the strings can never
  // be tainted by translation values.
  function updateAboutSection() {
    document.getElementById('about-title').textContent = t('about.title');

    document.getElementById('about-version').textContent = `Fake Discount Bulgaria · v${VERSION}`;

    // Contact line: plain-text email styled with user-select:all so a
    // single click selects the whole address. No mailto link — on systems
    // without a configured mail client (most casual users) the link just
    // opens a blank Chrome window, which is worse than no link at all.
    const contactEl = document.getElementById('about-contact');
    while (contactEl.firstChild) contactEl.removeChild(contactEl.firstChild);
    contactEl.appendChild(document.createTextNode(t('about.contact') + ' '));
    const emailSpan = document.createElement('span');
    emailSpan.className = 'email-text';
    emailSpan.textContent = CONTACT_EMAIL;
    contactEl.appendChild(emailSpan);

    // Shortcut line: "<intro> <kbd>Ctrl+Shift+F</kbd>"
    const shortcutEl = document.getElementById('about-shortcut');
    while (shortcutEl.firstChild) shortcutEl.removeChild(shortcutEl.firstChild);
    shortcutEl.appendChild(document.createTextNode(t('about.shortcut') + ' '));
    const kbd = document.createElement('kbd');
    kbd.textContent = SHORTCUT_KEYS;
    shortcutEl.appendChild(kbd);

    // Customize-shortcut line: link opens chrome://extensions/shortcuts.
    // chrome:// URLs cannot be opened from a regular <a href>, so use
    // chrome.tabs.create on click.
    const customizeEl = document.getElementById('about-shortcut-customize');
    while (customizeEl.firstChild) customizeEl.removeChild(customizeEl.firstChild);
    const customizeLink = document.createElement('a');
    customizeLink.href = '#';
    customizeLink.textContent = t('about.shortcutCustomize');
    customizeLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
    customizeEl.appendChild(customizeLink);
  }

  // ── Site filter chips (multi-select toggle) ─────────────────────────
  document.querySelectorAll('#site-filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const site = chip.dataset.site;
      if (activeSites.has(site)) {
        // Don't allow turning off ALL sites — at least one must remain on.
        if (activeSites.size > 1) {
          activeSites.delete(site);
          chip.classList.remove('active');
        }
      } else {
        activeSites.add(site);
        chip.classList.add('active');
      }
      saveFilterState();
      renderProducts();
    });
  });

  // ── Search input (debounced re-render) ──────────────────────────────
  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderProducts();
    }, 150);
  });

  // ── Sort dropdown ───────────────────────────────────────────────────
  document.getElementById('sort-select').addEventListener('change', (e) => {
    sortMode = e.target.value;
    saveFilterState();
    renderProducts();
  });

  // ── Fetch products + targets, then render ───────────────────────────
  async function loadFollowedProducts() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getAllProducts' }, (response) => {
          resolve(response);
        });
      });

      try {
        const result = await chrome.storage.local.get(['priceTargets']);
        cachedTargets = result.priceTargets || {};
      } catch (_) {
        cachedTargets = {};
      }

      const products = response?.products || {};
      cachedProducts = Object.entries(products)
        .filter(([id, product]) => product.isActive)
        .map(([id, product]) => ({ id, ...product }));

      renderProducts();
    } catch (error) {
      console.error('Error loading followed products:', error);
    }
  }

  // ── "Last seen" formatter (today / yesterday / N days ago) ──────────
  function formatLastSeen(lastUpdated) {
    if (!lastUpdated) return '';
    const last = new Date(lastUpdated);
    if (isNaN(last.getTime())) return '';
    const now = new Date();
    // Compare at midnight to get whole-day deltas regardless of time of day.
    const lastMid = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((nowMid - lastMid) / (1000 * 60 * 60 * 24));
    if (days <= 0) return t('lastSeen.today') || 'today';
    if (days === 1) return t('lastSeen.yesterday') || 'yesterday';
    return t('lastSeen.daysAgo', { n: days }) || `${days} days ago`;
  }

  // ── Apply filter + sort + render ────────────────────────────────────
  function renderProducts() {
    const productList = document.getElementById('followed-products-list');
    const noProductsMsg = document.getElementById('no-products-message');

    while (productList.firstChild) {
      productList.removeChild(productList.firstChild);
    }

    // Filter
    let filtered = cachedProducts.filter(product => {
      const site = product.site || 'emag';
      if (!activeSites.has(site)) return false;
      if (searchQuery) {
        const haystack = `${product.title || ''} ${product.ean || ''}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });

    // Sort
    const latestPrice = (p) => p.history && p.history.length > 0
      ? p.history[p.history.length - 1].price
      : 0;

    if (sortMode === 'recent') {
      filtered.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    } else if (sortMode === 'price-asc') {
      filtered.sort((a, b) => latestPrice(a) - latestPrice(b));
    } else if (sortMode === 'price-desc') {
      filtered.sort((a, b) => latestPrice(b) - latestPrice(a));
    } else if (sortMode === 'targets') {
      filtered.sort((a, b) => {
        // Look up by productId (canonical since v3.15.11), fall back to URL
        // key for legacy targets the widget hasn't migrated yet.
        const aT = (a.id && cachedTargets[a.id]) || (a.url && cachedTargets[a.url]) || 0;
        const bT = (b.id && cachedTargets[b.id]) || (b.url && cachedTargets[b.url]) || 0;
        const aHasTarget = aT > 0 ? 1 : 0;
        const bHasTarget = bT > 0 ? 1 : 0;
        if (aHasTarget !== bHasTarget) return bHasTarget - aHasTarget;
        return new Date(b.lastUpdated) - new Date(a.lastUpdated);
      });
    }

    if (filtered.length === 0) {
      productList.style.display = 'none';
      noProductsMsg.style.display = 'block';
      // Customize empty message if filters are active vs truly empty
      if (cachedProducts.length > 0 && (searchQuery || activeSites.size < 3)) {
        noProductsMsg.textContent = t('search.noResults') || 'No matches';
      } else {
        noProductsMsg.textContent = t('settings.noProducts');
      }
      updateFooter();
      return;
    }

    productList.style.display = 'block';
    noProductsMsg.style.display = 'none';

    const currency = t('currency') || t('lev') || 'EUR';

    filtered.forEach(product => {
      const latest = latestPrice(product);
      // Only show a trend when we actually have a prior price to compare
      // against. With a single recorded price the old "→ stable" was
      // misleading — there was no comparison being made.
      const hasComparison = product.history && product.history.length > 1;
      const previous = hasComparison
        ? product.history[product.history.length - 2].price
        : latest;

      const trend = !hasComparison ? null :
        (latest > previous ? 'up' :
         latest < previous ? 'down' : 'stable');
      const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'stable' ? '→' : '';
      const trendLabel  = trend === 'up' ? t('trend.higher') :
                          trend === 'down' ? t('trend.lower') :
                          trend === 'stable' ? t('trend.same') : '';

      const site = product.site || 'emag';
      const SITE_LABELS = { emag: 'EMAG', ozone: 'OZONE', notino: 'NOTINO', technopolis: 'TECHNOPOLIS', technomarket: 'TECHNOMARKET', zora: 'ZORA', ardes: 'ARDES', plesio: 'PLESIO', aboutyou: 'ABOUT YOU', answear: 'ANSWEAR', decathlon: 'DECATHLON', dm: 'DM', fashiondays: 'FASHION DAYS', lilly: 'LILLY', bricolage: 'MR.BRICOLAGE', obuvki: 'OBUVKI', praktiker: 'PRAKTIKER', sopharmacy: 'SOPHARMACY', sportdepot: 'SPORT DEPOT', ebag: 'EBAG' };
      const siteLabel = SITE_LABELS[site] || 'EMAG';

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

      if (typeof product.ean === 'string' && product.ean) {
        const eanDiv = document.createElement('div');
        eanDiv.className = 'product-ean';
        eanDiv.textContent = `EAN: ${product.ean}`;
        eanDiv.title = t('ean.copyHint') || 'Click to copy';
        // Copy on click + brief green-flash confirmation. stopPropagation
        // prevents the click from bubbling to the card-level "open URL" handler.
        eanDiv.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(product.ean);
            const original = eanDiv.textContent;
            eanDiv.textContent = `EAN: ${product.ean} ✓ ${t('ean.copied') || 'Copied!'}`;
            eanDiv.classList.add('copied');
            setTimeout(() => {
              eanDiv.textContent = original;
              eanDiv.classList.remove('copied');
            }, 1200);
          } catch (err) {
            console.error('Copy failed:', err);
          }
        });
        productInfo.appendChild(eanDiv);
      }

      // "Last seen X days ago" — small italic muted line right after EAN
      // (or right after title when no EAN). Helps spot stale data.
      const lastSeenStr = formatLastSeen(product.lastUpdated);
      if (lastSeenStr) {
        const lastSeenDiv = document.createElement('div');
        lastSeenDiv.className = 'product-lastseen';
        lastSeenDiv.textContent = lastSeenStr;
        productInfo.appendChild(lastSeenDiv);
      }

      // Meta row: price + trend + site badge (price-range row removed
      // per the compact-card decision; the target indicator below still
      // appears on its own row when a target is set for this product).
      const metaDiv = document.createElement('div');
      metaDiv.className = 'product-meta';

      const priceSpan = document.createElement('span');
      priceSpan.className = 'product-price';
      priceSpan.textContent = `${latest.toFixed(2)} ${currency}`;
      metaDiv.appendChild(priceSpan);

      // Trend block: arrow + small text label. Only rendered when there's
      // a previous price to compare against (skipped on first-visit cards).
      if (trend) {
        const trendSpan = document.createElement('span');
        trendSpan.className = `product-trend ${trend}`;
        trendSpan.textContent = trendSymbol;
        metaDiv.appendChild(trendSpan);

        const trendLabelSpan = document.createElement('span');
        trendLabelSpan.className = 'product-trend-label';
        trendLabelSpan.textContent = trendLabel;
        metaDiv.appendChild(trendLabelSpan);
      }

      const badgeSpan = document.createElement('span');
      badgeSpan.className = `site-badge ${site}`;
      badgeSpan.textContent = siteLabel;
      metaDiv.appendChild(badgeSpan);

      // Price-target row (only when set). Independent of the price-range
      // row that was removed — this still shows on its own line.
      // Look up by productId (canonical since v3.15.11), fall back to
      // URL key for legacy targets the widget hasn't migrated yet.
      const targetValue = (product.id && cachedTargets[product.id])
        || (product.url && cachedTargets[product.url])
        || null;
      if (typeof targetValue === 'number' && targetValue > 0) {
        const targetDiv = document.createElement('div');
        targetDiv.className = 'product-price-target';
        const reached = latest <= targetValue;
        if (reached) targetDiv.classList.add('reached');
        const labelText = t('priceTarget.label') || 'Target:';
        const reachedSuffix = reached ? ` ✓ ${t('priceTarget.reached') || 'Target reached!'}` : '';
        targetDiv.textContent = `🎯 ${labelText} ${targetValue.toFixed(2)} ${currency}${reachedSuffix}`;
        productInfo.appendChild(targetDiv);
      }

      productInfo.appendChild(metaDiv);
      productItem.appendChild(productInfo);

      // Click anywhere on the card (except delete) to open the URL.
      // Defense-in-depth: re-validate the URL is from a supported store
      // before navigating. The service worker's import sanitizer already
      // rejects off-domain URLs, but storage written by a previous
      // version, a future bypass, or a corrupted entry could still
      // surface a bad URL here. Refuse to open anything that isn't an
      // https:// link to one of the 20 supported stores.
      if (product.url && isSupportedProductUrl(product.url)) {
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
              // Remove from cache so re-render reflects immediately
              cachedProducts = cachedProducts.filter(p => p.id !== productId);
              renderProducts();
              updateStorageInfo();
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

    updateFooter();
  }

  // ── Storage info (Data tab + footer summary) ────────────────────────
  async function updateStorageInfo() {
    try {
      const bytesUsed = await chrome.storage.local.getBytesInUse(null);
      const storageLimit = 10 * 1024 * 1024; // 10MB
      const rawPct = (bytesUsed / storageLimit) * 100;

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
      fillElement.style.width = `${Math.min(rawPct, 100)}%`;
      fillElement.className = 'storage-fill';

      if (rawPct < 50) {
        fillElement.classList.add('green');
      } else if (rawPct < 80) {
        fillElement.classList.add('yellow');
      } else {
        fillElement.classList.add('red');
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getProductCount' }, (response) => {
          resolve(response);
        });
      });
      const productCount = response?.count || 0;
      document.getElementById('tracked-products-count').textContent = productCount;

      // Persistent footer summary on every tab.
      document.getElementById('footer-summary').textContent =
        t('footer.summary', { count: productCount, percentage: displayPct }) ||
        `${productCount} · ${displayPct}`;
    } catch (error) {
      console.error('Error updating storage info:', error);
    }
  }

  function updateFooter() {
    // Light update of the count when products change without full reload.
    const el = document.getElementById('footer-summary');
    if (!el) return;
    // If we've never populated it, do the heavier path.
    if (el.textContent === '…') updateStorageInfo();
  }

  // ── Settings event listeners ────────────────────────────────────────
  document.getElementById('language-select').addEventListener('change', async (e) => {
    const lang = e.target.value;
    await chrome.storage.local.set({ language: lang });
    await i18n.setLanguage(lang);
    updateUI();
    renderProducts(); // currency/labels in product cards may shift
  });

  document.getElementById('enable-emag').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableEmag: e.target.checked });
  });

  document.getElementById('enable-ozone').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableOzone: e.target.checked });
  });

  document.getElementById('enable-notino').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableNotino: e.target.checked });
  });

  document.getElementById('enable-technopolis').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableTechnopolis: e.target.checked });
  });

  document.getElementById('enable-technomarket').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableTechnomarket: e.target.checked });
  });

  document.getElementById('enable-zora').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableZora: e.target.checked });
  });

  document.getElementById('enable-ardes').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableArdes: e.target.checked });
  });

  document.getElementById('enable-plesio').addEventListener('change', (e) => {
    chrome.storage.local.set({ enablePlesio: e.target.checked });
  });

  document.getElementById('enable-aboutyou').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableAboutyou: e.target.checked });
  });

  document.getElementById('enable-answear').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableAnswear: e.target.checked });
  });

  document.getElementById('enable-decathlon').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableDecathlon: e.target.checked });
  });

  document.getElementById('enable-dm').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableDm: e.target.checked });
  });

  document.getElementById('enable-fashiondays').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableFashiondays: e.target.checked });
  });

  document.getElementById('enable-lilly').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableLilly: e.target.checked });
  });

  document.getElementById('enable-bricolage').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableBricolage: e.target.checked });
  });

  document.getElementById('enable-obuvki').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableObuvki: e.target.checked });
  });

  document.getElementById('enable-praktiker').addEventListener('change', (e) => {
    chrome.storage.local.set({ enablePraktiker: e.target.checked });
  });

  document.getElementById('enable-sopharmacy').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableSopharmacy: e.target.checked });
  });

  document.getElementById('enable-sportdepot').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableSportdepot: e.target.checked });
  });

  document.getElementById('enable-ebag').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableEbag: e.target.checked });
  });

  document.getElementById('show-widget').addEventListener('change', (e) => {
    chrome.storage.local.set({ showWidget: e.target.checked });
  });

  // Cleanup old products
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

  // Clear all history
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

  // Export data
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

  // Import data
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

  // ── Initialize ──────────────────────────────────────────────────────
  loadSettings();
  updateStorageInfo();
  // Restore persisted filter/sort state BEFORE the first product render
  // so the chips and dropdown reflect the saved selection on open.
  loadFilterState().then(loadFollowedProducts);

  // Refresh when storage changes (e.g. user opened a product page in another tab)
  let refreshTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
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
