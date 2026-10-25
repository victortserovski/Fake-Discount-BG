// Shared UI primitives for the popup and the in-page price panel:
// DOM builders, icons, store + verdict metadata and locale-aware formatting.
// DOM-only construction (createElement / createElementNS + text nodes) —
// never innerHTML, so product data can't become markup.
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function append(parent, children) {
    for (const child of children) {
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(parent, child);
      else parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return parent;
  }

  // h('div', { class: 'x', onclick: fn, 'aria-label': '…' }, child, 'text', …)
  // `text` sets textContent; `on*` functions become listeners; everything
  // else is an attribute (true → present, false/null → omitted).
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    return append(el, children);
  }

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [key, value] of Object.entries(attrs)) {
      if (value != null && value !== false) el.setAttribute(key, String(value));
    }
    return append(el, children);
  }

  // 24×24 stroke icons. Strings are path data; objects are circles/rects.
  const ICONS = {
    alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
    checkCircle: [{ c: [12, 12, 10] }, 'm8 12.5 2.7 2.7L16.5 9.5'],
    activity: ['M22 12h-4l-3 8-6-16-3 8H2'],
    equal: ['M5 9h14', 'M5 15h14'],
    clock: [{ c: [12, 12, 10] }, 'M12 7v5l3 2'],
    chevronDown: ['m6 9 6 6 6-6'],
    target: [{ c: [12, 12, 9] }, { c: [12, 12, 5] }, { c: [12, 12, 1.2] }],
    x: ['M18 6 6 18', 'm6 6 12 12'],
    search: [{ c: [11, 11, 7] }, 'm20 20-3.8-3.8'],
    trash: ['M3 6h18', 'M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6', 'M18.5 6l-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6', 'M10 11v6', 'M14 11v6'],
    expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
    upload: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'],
    copy: [{ r: [9, 9, 12, 12, 2] }, 'M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5'],
    check: ['M20 6 9 17l-5-5'],
    box: ['M21 8 12 3 3 8v8l9 5 9-5Z', 'm3 8 9 5 9-5', 'M12 13v8'],
    broom: ['M19 3 9.5 12.5', 'M13 16c-1.5 3-4.5 5-9 5 0-4.5 2-7.5 5-9l4 4Z', 'm8 12 4 4'],
    shield: ['M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z'],
    store: ['M3.5 9 5 4h14l1.5 5', 'M4.5 9v11h15V9', 'M3.5 9a2.8 2.8 0 0 0 5.5 0 2.8 2.8 0 0 0 5.5 0 2.8 2.8 0 0 0 5.5 0', 'M10 20v-5h4v5'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', { c: [12, 12, 3] }],
    info: [{ c: [12, 12, 10] }, 'M12 16v-4.5', 'M12 8h.01'],
    chart: ['M3 3v18h18', 'm7 15 4-4 3 3 6-7'],
    arrowDown: ['M12 5v14', 'm18 13-6 6-6-6'],
    arrowUp: ['M12 19V5', 'm6 11 6-6 6 6']
  };

  function icon(name, size = 16, extraClass) {
    const svg = s('svg', {
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false', class: extraClass ? 'ico ' + extraClass : 'ico'
    });
    for (const part of ICONS[name] || []) {
      if (typeof part === 'string') svg.appendChild(s('path', { d: part }));
      else if (part.c) svg.appendChild(s('circle', { cx: part.c[0], cy: part.c[1], r: part.c[2] }));
      else if (part.r) svg.appendChild(s('rect', { x: part.r[0], y: part.r[1], width: part.r[2], height: part.r[3], rx: part.r[4] }));
    }
    return svg;
  }

  // Store metadata. Names are brand names (not translated). `color` is the
  // store's brand hue, used only for the small monogram tile; `light` marks
  // brand colours that need dark text.
  const SITES = {
    emag: { name: 'eMAG', domain: 'emag.bg', mono: 'e', color: '#2962FF' },
    ozone: { name: 'Ozone', domain: 'ozone.bg', mono: 'O', color: '#FF6600' },
    notino: { name: 'Notino', domain: 'notino.bg', mono: 'N', color: '#DC0069' },
    technopolis: { name: 'Technopolis', domain: 'technopolis.bg', mono: 'T', color: '#E30613' },
    technomarket: { name: 'Technomarket', domain: 'technomarket.bg', mono: 'TM', color: '#FFC700', light: true },
    zora: { name: 'Zora', domain: 'zora.bg', mono: 'Z', color: '#009688' },
    ardes: { name: 'Ardes', domain: 'ardes.bg', mono: 'A', color: '#003DA5' },
    plesio: { name: 'Plesio', domain: 'plesio.bg', mono: 'P', color: '#E60012' },
    aboutyou: { name: 'About You', domain: 'aboutyou.bg', mono: 'AY', color: '#1F1F1F' },
    answear: { name: 'Answear', domain: 'answear.bg', mono: 'An', color: '#3D2B5A' },
    decathlon: { name: 'Decathlon', domain: 'decathlon.bg', mono: 'D', color: '#0082C3' },
    dm: { name: 'dm', domain: 'dm-drogeriemarkt.bg', mono: 'dm', color: '#FEC700', light: true },
    fashiondays: { name: 'Fashion Days', domain: 'fashiondays.bg', mono: 'FD', color: '#111111' },
    lilly: { name: 'Lilly', domain: 'lillydrogerie.bg', mono: 'L', color: '#E91E63' },
    bricolage: { name: 'Mr.Bricolage', domain: 'mr-bricolage.bg', mono: 'MB', color: '#B7042A' },
    obuvki: { name: 'Obuvki', domain: 'obuvki.bg', mono: 'Ob', color: '#2B2B2B' },
    praktiker: { name: 'Praktiker', domain: 'praktiker.bg', mono: 'Pr', color: '#FFD700', light: true },
    sopharmacy: { name: 'SOpharmacy', domain: 'sopharmacy.bg', mono: 'SO', color: '#00A896' },
    sportdepot: { name: 'Sport Depot', domain: 'sportdepot.bg', mono: 'SD', color: '#003B71' },
    ebag: { name: 'eBag', domain: 'ebag.bg', mono: 'eB', color: '#FF8800' }
  };
  const SITE_KEYS = Object.keys(SITES);
  for (const key of SITE_KEYS) SITES[key].enableKey = 'enable' + key[0].toUpperCase() + key.slice(1);

  function siteFromUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return SITE_KEYS.find(key => SITES[key].domain === host) || null;
    } catch (_) {
      return null;
    }
  }

  function storeMono(site, extraClass) {
    const meta = SITES[site] || { mono: '?', color: '#6B7189' };
    const tile = h('span', { class: 'mono' + (meta.light ? ' mono--light' : '') + (extraClass ? ' ' + extraClass : ''), 'aria-hidden': 'true' }, meta.mono);
    tile.style.setProperty('--mono', meta.color);
    return tile;
  }

  // Verdict → visual tone + icon. Colours live in CSS (data-tone).
  const VERDICTS = {
    FAKE_DISCOUNT: { tone: 'check', icon: 'alert' },
    REAL_DEAL: { tone: 'low', icon: 'checkCircle' },
    VOLATILE_PRICE: { tone: 'volatile', icon: 'activity' },
    STABLE_PRICE: { tone: 'stable', icon: 'equal' },
    TRACKING: { tone: 'tracking', icon: 'clock' }
  };
  const verdictMeta = verdict => VERDICTS[verdict] || VERDICTS.TRACKING;

  // History dates are local YYYY-MM-DD keys — parse them as local midnight,
  // not UTC, so labels never shift by a day.
  function parseDay(value) {
    const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  function daysBetween(a, b) {
    const da = parseDay(a), db = parseDay(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / DAY_MS);
  }

  const LOCALES = { bg: 'bg-BG', en: 'en-GB' };
  function format(lang) {
    const locale = LOCALES[lang] || LOCALES.bg;
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
    const moneyRound = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    const signed = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    const dayShort = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const dayLong = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    // Bulgarian CLDR "short" months are numeric ("08"), so axis months are
    // the first three letters of the long name: "авг ’25" / "Aug ’25".
    const monthName = new Intl.DateTimeFormat(locale, { month: 'long' });
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const plural = new Intl.PluralRules(locale);
    const ok = n => typeof n === 'number' && Number.isFinite(n);
    return {
      locale,
      lang: LOCALES[lang] ? lang : 'bg',
      price: n => ok(n) ? money.format(n) : '—',
      priceRound: n => ok(n) ? moneyRound.format(n) : '—',
      percent: n => ok(n) ? percent.format(n) : '—',
      signedPercent: n => ok(n) ? signed.format(n).replace('-', '−') : '—',
      number: n => ok(n) ? number.format(n) : '—',
      // Editable amount for inputs: "89,50" / "89.50" (no currency, no grouping).
      decimal: n => ok(n) ? decimal.format(n) : '',
      day: d => { const v = parseDay(d); return v ? dayShort.format(v) : ''; },
      dayLong: d => { const v = parseDay(d); return v ? dayLong.format(v) : ''; },
      monthYear: d => {
        const v = parseDay(d);
        return v ? `${monthName.format(v).slice(0, 3)} ’${String(v.getFullYear()).slice(2)}` : '';
      },
      // "today" / "yesterday" / "5 days ago" relative to the local date.
      ago: d => {
        const v = parseDay(d);
        if (!v) return '';
        const now = new Date();
        const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(v.getFullYear(), v.getMonth(), v.getDate())) / DAY_MS);
        return relative.format(-Math.max(0, days), 'day');
      },
      plural: n => plural.select(n)
    };
  }

  // Translate a pluralised key: `<key>One` / `<key>Other` with {n}.
  function tPlural(t, fmt, key, n, params = {}) {
    const form = fmt.plural(n) === 'one' ? 'One' : 'Other';
    return t(key + form, { n: fmt.number(n), ...params });
  }

  // Parse a user-typed price: accepts "79,99", "79.99", "1 299,50", "€79".
  function parsePriceInput(raw) {
    if (typeof raw !== 'string') return NaN;
    let v = raw.replace(/[\s €]|eur|лв\.?/gi, '');
    if (!v) return NaN;
    if (v.includes(',') && v.includes('.')) {
      v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
    } else {
      v = v.replace(',', '.');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
    return Number(v);
  }

  // Price statistics straight from a history array.
  function historyStats(history) {
    const rows = (history || []).filter(r => r && typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0);
    if (!rows.length) return null;
    let low = rows[0], high = rows[0], sum = 0;
    for (const r of rows) {
      if (r.price <= low.price) low = r;   // most recent occurrence wins
      if (r.price >= high.price) high = r;
      sum += r.price;
    }
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    let lastChange = null;
    for (let i = rows.length - 1; i > 0; i--) {
      if (rows[i].price !== rows[i - 1].price) { lastChange = rows[i]; break; }
    }
    return { rows, low, high, average: sum / rows.length, last, prev, lastChange, count: rows.length };
  }

  const kit = {
    h, s, icon, append, SITES, SITE_KEYS, siteFromUrl, storeMono,
    verdictMeta, parseDay, daysBetween, format, tPlural, parsePriceInput, historyStats
  };

  if (typeof window !== 'undefined') window.FDKit = kit;
  else if (typeof self !== 'undefined') self.FDKit = kit;
})();
