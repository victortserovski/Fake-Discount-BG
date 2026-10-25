// Price-history chart (SVG).
// Step-after line — a recorded price holds until the next observation — with
// optional reference lines for the average, the user's target and the store's
// claimed was-price, a crosshair tooltip, keyboard navigation and responsive
// re-rendering. Colours come from CSS classes (fdc-*) owned by the page that
// hosts the chart.
// No url(#id) references anywhere: pages with a <base href> (Zora.bg) make
// Chrome resolve fragment references against the base URL, so gradients /
// clip-paths fail and SVG falls back to solid black fills.
if (typeof window !== 'undefined') {
  window.AdvancedChart = class AdvancedChart {
    constructor(container, options = {}) {
      if (!container) throw new Error('AdvancedChart: container is required');
      this.container = container;
      this.options = options;
      this.data = options.data || [];
      this.height = options.height || 220;
      this.width = Math.round(options.width || container.clientWidth || 640);
      this.fmt = options.format || window.FDKit.format('bg');
      this.t = typeof options.t === 'function' ? options.t : (k => k);
      this._index = -1;
      this.render();
      if (options.responsive && typeof ResizeObserver === 'function') {
        this._observer = new ResizeObserver(() => {
          const width = Math.round(this.container.clientWidth);
          if (width > 0 && Math.abs(width - this.width) > 2) {
            this.width = width;
            this.render();
          }
        });
        this._observer.observe(container);
      }
    }

    update(options) {
      Object.assign(this.options, options);
      if (options.data) this.data = options.data;
      if (options.height) this.height = options.height;
      this.render();
    }

    destroy() {
      if (this._observer) this._observer.disconnect();
      this._observer = null;
    }

    // Widest y-axis label decides the left margin.
    _measure(text) {
      try {
        if (!this._textCtx) {
          this._textCtx = document.createElement('canvas').getContext('2d');
          this._textCtx.font = '500 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        }
        return this._textCtx.measureText(text).width;
      } catch (_) {
        return text.length * 6.4;
      }
    }

    _niceStep(range, count) {
      const raw = range / Math.max(1, count);
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    }

    render() {
      const S = window.FDKit.s;
      const c = this.container;
      while (c.firstChild) c.removeChild(c.firstChild);

      const W = Math.max(200, this.width), H = this.height;
      const svg = S('svg', { class: 'fdc', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
      if (this.options.ariaLabel) svg.setAttribute('aria-label', this.options.ariaLabel);
      c.appendChild(svg);
      this.svg = svg;

      const parse = window.FDKit.parseDay;
      const valid = this.data
        .filter(d => d && Number.isFinite(d.price) && d.price > 0 && parse(d.date))
        .map(d => ({ ...d, time: parse(d.date).getTime() }))
        .sort((a, b) => a.time - b.time);
      this._validData = valid;
      if (!valid.length) return;

      // ── Y domain: data range, widened to include nearby reference lines ──
      const prices = valid.map(d => d.price);
      let low = Math.min(...prices), high = Math.max(...prices);
      const dataLow = low, dataHigh = high;
      const refs = [];
      const addRef = (kind, value, label) => {
        if (!Number.isFinite(value) || value <= 0) return;
        const near = value >= dataLow * 0.5 && value <= dataHigh * 2;
        if (near) { low = Math.min(low, value); high = Math.max(high, value); }
        refs.push({ kind, value, label });
      };
      addRef('avg', this.options.average, null);
      addRef('target', this.options.target, this.options.targetLabel);
      addRef('claimed', this.options.claimed, this.options.claimedLabel);

      // Padded data-fit domain; gridlines sit on round values inside it.
      const span = high - low;
      const pad = span > 0 ? span * 0.12 : Math.max(high * 0.02, 0.5);
      const minPrice = Math.max(0, low - pad);
      const maxPrice = high + pad;
      const priceRange = maxPrice - minPrice || 1;
      const step = this._niceStep(priceRange, 5);
      const ticks = [];
      for (let v = Math.ceil(minPrice / step) * step; v <= maxPrice; v += step) ticks.push(Math.round(v * 100) / 100);
      const tickLabel = step >= 1 ? this.fmt.priceRound : this.fmt.price;

      const margin = {
        top: 12,
        right: 10,
        bottom: 26,
        left: Math.ceil(Math.max(...ticks.map(v => this._measure(tickLabel(v))))) + 14
      };
      const plotW = W - margin.left - margin.right;
      const plotH = H - margin.top - margin.bottom;

      const t0 = valid[0].time, t1 = valid[valid.length - 1].time;
      const timeSpan = t1 - t0;
      const xTime = time => timeSpan > 0 ? ((time - t0) / timeSpan) * plotW : plotW;
      const xScale = index => xTime(valid[index].time);
      const yScale = price => plotH - ((price - minPrice) / priceRange) * plotH;

      Object.assign(this, { _minPrice: minPrice, _maxPrice: maxPrice, _priceRange: priceRange, _chartWidth: plotW, _chartHeight: plotH, _xScale: xScale, _yScale: yScale, _margin: margin });

      const g = S('g', { transform: `translate(${margin.left},${margin.top})` });
      svg.appendChild(g);

      // Grid + y labels
      const grid = S('g', { class: 'fdc-grid' });
      for (const v of ticks) {
        const y = Math.round(yScale(v)) + 0.5;
        if (y < plotH - 3) grid.appendChild(S('line', { x1: 0, x2: plotW, y1: y, y2: y, class: 'fdc-gridline' }));
        grid.appendChild(S('text', { x: -10, y: y + 4, 'text-anchor': 'end', class: 'fdc-axis' }, tickLabel(v)));
      }
      grid.appendChild(S('line', { x1: 0, x2: plotW, y1: plotH + 0.5, y2: plotH + 0.5, class: 'fdc-gridline fdc-baseline' }));
      g.appendChild(grid);

      // X labels: evenly spaced in time, de-duplicated.
      const longSpan = timeSpan > 300 * 86400000;
      const xCount = timeSpan > 0 ? Math.max(2, Math.min(6, Math.floor(plotW / 92))) : 1;
      const seen = new Set();
      for (let i = 0; i < xCount; i++) {
        const time = xCount === 1 ? t1 : t0 + (timeSpan * i) / (xCount - 1);
        const d = new Date(time);
        const label = longSpan ? this.fmt.monthYear(d) : this.fmt.day(d);
        if (seen.has(label)) continue;
        seen.add(label);
        const anchor = xCount === 1 ? 'end' : i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle';
        g.appendChild(S('text', { x: xTime(time), y: plotH + 18, 'text-anchor': anchor, class: 'fdc-axis' }, label));
      }

      // Reference lines (behind the price line)
      const labels = [];
      for (const ref of refs) {
        const raw = yScale(ref.value);
        const y = Math.max(0, Math.min(plotH, raw));
        const off = raw < 0 ? '↑' : raw > plotH ? '↓' : '';
        g.appendChild(S('line', { x1: 0, x2: plotW, y1: y, y2: y, class: `fdc-ref fdc-ref--${ref.kind}` }));
        if (ref.label) labels.push({ ref, y, text: `${ref.label} ${this.fmt.price(ref.value)}${off ? ' ' + off : ''}` });
      }

      // Price area + step line
      let line = '', area = '';
      if (valid.length === 1) {
        const y = yScale(valid[0].price);
        g.appendChild(S('line', { x1: 0, x2: plotW, y1: y, y2: y, class: 'fdc-line fdc-line--single' }));
      } else {
        valid.forEach((p, i) => {
          const x = xScale(i), y = yScale(p.price);
          if (i === 0) { line = `M${x},${y}`; area = `M${x},${plotH}V${y}`; }
          else { line += `H${x}V${y}`; area += `H${x}V${y}`; }
        });
        area += `V${plotH}Z`;
        g.appendChild(S('path', { d: area, class: 'fdc-area' }));
        g.appendChild(S('path', { d: line, class: 'fdc-line' }));
      }

      // Reference labels: left-aligned pills (today's point lives on the
      // right edge), nudged apart vertically.
      labels.sort((a, b) => a.y - b.y);
      let prevBottom = -Infinity;
      for (const item of labels) {
        const pillH = 18;
        let top = item.y - pillH - 3;
        if (top < 0) top = item.y + 3;
        if (top < prevBottom + 2) top = prevBottom + 2;
        if (top + pillH > plotH) top = plotH - pillH;
        prevBottom = top + pillH;
        const w = Math.ceil(this._measure(item.text)) + 14;
        const x = 6;
        const pill = S('g', { class: `fdc-pill fdc-pill--${item.ref.kind}` });
        pill.appendChild(S('rect', { x, y: top, width: w, height: pillH, rx: 9 }));
        pill.appendChild(S('text', { x: x + w / 2, y: top + 12.5, 'text-anchor': 'middle' }, item.text));
        g.appendChild(pill);
      }

      // Today's point (drawn above lines and labels)
      const lastX = xScale(valid.length - 1), lastY = yScale(valid[valid.length - 1].price);
      g.appendChild(S('circle', { cx: lastX, cy: lastY, r: 7, class: 'fdc-halo' }));
      g.appendChild(S('circle', { cx: lastX, cy: lastY, r: 3.5, class: 'fdc-dot' }));

      // Crosshair layer
      const cross = S('g', { class: 'fdc-cross', visibility: 'hidden' });
      const crossLine = S('line', { y1: 0, y2: plotH, class: 'fdc-crossline' });
      const crossDot = S('circle', { r: 4.5, class: 'fdc-crossdot' });
      cross.appendChild(crossLine);
      cross.appendChild(crossDot);
      g.appendChild(cross);
      const hit = S('rect', { x: 0, y: 0, width: plotW, height: plotH, class: 'fdc-hit', fill: 'transparent' });
      g.appendChild(hit);

      const tip = document.createElement('div');
      tip.className = 'fdc-tip';
      tip.hidden = true;
      c.appendChild(tip);

      const show = (index) => {
        this._index = index;
        const p = valid[index];
        const x = xScale(index), y = yScale(p.price);
        crossLine.setAttribute('x1', x); crossLine.setAttribute('x2', x);
        crossDot.setAttribute('cx', x); crossDot.setAttribute('cy', y);
        cross.setAttribute('visibility', 'visible');
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        const row = (cls, text) => { const el = document.createElement('div'); el.className = cls; el.textContent = text; tip.appendChild(el); };
        row('fdc-tip-date', this.fmt.dayLong(p.date));
        row('fdc-tip-price', this.fmt.price(p.price));
        const prev = index > 0 ? valid[index - 1] : null;
        if (prev && prev.price !== p.price) {
          const delta = (p.price - prev.price) / prev.price;
          row('fdc-tip-delta ' + (delta < 0 ? 'is-down' : 'is-up'), this.t('chart.vsPrevious', { delta: this.fmt.signedPercent(delta) }));
        }
        if (Number.isFinite(p.originalPrice) && p.originalPrice > p.price) {
          row('fdc-tip-claimed', this.t('chart.claimedOnDay', { price: this.fmt.price(p.originalPrice) }));
        }
        tip.hidden = false;
        const cw = c.clientWidth || W;
        const tw = tip.offsetWidth || 150;
        const left = Math.min(Math.max(margin.left + x - tw / 2, 4), cw - tw - 4);
        const above = margin.top + y - (tip.offsetHeight || 60) - 12;
        tip.style.left = left + 'px';
        tip.style.top = (above < 0 ? margin.top + y + 14 : above) + 'px';
      };
      const hide = () => {
        this._index = -1;
        cross.setAttribute('visibility', 'hidden');
        tip.hidden = true;
      };
      const nearest = (px) => {
        let lo = 0, hi = valid.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (xScale(mid) < px) lo = mid; else hi = mid;
        }
        return Math.abs(xScale(lo) - px) <= Math.abs(xScale(hi) - px) ? lo : hi;
      };
      hit.addEventListener('pointermove', (e) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width ? W / box.width : 1;
        show(nearest((e.clientX - box.left) * scale - margin.left));
      });
      hit.addEventListener('pointerleave', hide);

      svg.setAttribute('tabindex', '0');
      svg.addEventListener('focus', () => show(this._index >= 0 ? this._index : valid.length - 1));
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', (e) => {
        const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
        if (!(e.key in keys)) return;
        e.preventDefault();
        show(Math.max(0, Math.min(valid.length - 1, (this._index < 0 ? valid.length - 1 : this._index) + keys[e.key])));
      });
    }
  };
}
