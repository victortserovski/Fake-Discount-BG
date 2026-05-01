// Advanced Area Chart with Gradient
// Make available globally
if (typeof window !== 'undefined') {
  window.AdvancedChart = class AdvancedChart {
    constructor(container, options = {}) {
      try {
        if (!container) {
          throw new Error('AdvancedChart: Container is required');
        }
        
        this.container = container;
        this.width = options.width || container.clientWidth || 800;
        this.height = options.height || 300;
        this.data = options.data || [];
        this.options = options;
        // Left margin scales with the actual longest Y-axis label so prices
        // with 5+ digits (or longer currency strings) don't get clipped.
        this.margin = {
          top: 20,
          right: 30,
          bottom: 40,
          left: this._computeLeftMargin()
        };
        
        this.svg = null;
        this.render();
      } catch (error) {
        console.error('AdvancedChart constructor error:', error);
        console.error('AdvancedChart stack:', error.stack);
        // Try to create minimal SVG to show error state
        try {
          if (container && container.parentNode) {
            while (container.firstChild) {
              container.removeChild(container.firstChild);
            }
            const errorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            errorSvg.setAttribute('width', this.width || 800);
            errorSvg.setAttribute('height', this.height || 300);
            errorSvg.style.display = 'block';
            container.appendChild(errorSvg);
          }
        } catch (e) {
          console.error('AdvancedChart: Failed to create error SVG:', e);
        }
        throw error; // Re-throw to allow caller to handle
      }
    }

    // Compute the left margin needed to fit the longest Y-axis label.
    // Uses the canvas 2D measureText API for accurate sizing across fonts.
    _computeLeftMargin() {
      const MIN_MARGIN = 60;
      const PADDING = 16; // gap between label end and Y-axis line
      const FONT = '11px sans-serif';

      const tFunc = this.options.t;
      const currency = (typeof tFunc === 'function')
        ? (tFunc('currency') || tFunc('lev') || 'EUR')
        : 'EUR';

      const validPrices = (this.data || [])
        .map(d => d && d.price)
        .filter(p => typeof p === 'number' && isFinite(p));
      if (validPrices.length === 0) return MIN_MARGIN;

      const maxPrice = Math.max(...validPrices);
      const sample = `${maxPrice.toFixed(2)} ${currency}`;

      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = FONT;
        const w = ctx.measureText(sample).width;
        return Math.max(MIN_MARGIN, Math.ceil(w) + PADDING);
      } catch (e) {
        // Fallback: estimate ~7px per char at 11px sans-serif
        return Math.max(MIN_MARGIN, sample.length * 7 + PADDING);
      }
    }

    render() {
      try {
        // Clear container safely (XML/XHTML compatible)
        while (this.container.firstChild) {
          this.container.removeChild(this.container.firstChild);
        }
        
        // Create SVG - always create it, even with empty data
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', this.width);
        this.svg.setAttribute('height', this.height);
        this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        this.svg.style.display = 'block';
        
        // Append SVG to container
        this.container.appendChild(this.svg);
        
        // Verify SVG was appended
        if (!this.container.contains(this.svg)) {
          console.error('AdvancedChart: Failed to append SVG to container');
          throw new Error('Failed to append SVG to container');
        }

        if (this.data.length === 0) {
          return;
        }

        const chartWidth = this.width - this.margin.left - this.margin.right;
        const chartHeight = this.height - this.margin.top - this.margin.bottom;

        // Create chart group
        const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chartGroup.setAttribute('transform', `translate(${this.margin.left},${this.margin.top})`);
        this.svg.appendChild(chartGroup);

        // Filter valid data points
        const validData = this.data.filter(d => d && typeof d.price === 'number' && !isNaN(d.price) && d.date);
        if (validData.length === 0) {
          // Still create empty chart structure for consistency
          console.warn('AdvancedChart: No valid data points, creating empty chart');
          return;
        }
        
        // Note: Even with just 1 data point, we can still show something (single point, axes, grid)
        // Minimum 2 points needed for line/area, but we can show a single point

        const prices = validData.map(d => d.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;

        // Scale functions
        const dataLength = validData.length;
        const xScale = (index) => dataLength > 1 ? (index / (dataLength - 1)) * chartWidth : 0;
        const yScale = (price) => chartHeight - ((price - minPrice) / priceRange) * chartHeight;

        this._validData = validData;
        this._minPrice = minPrice;
        this._maxPrice = maxPrice;
        this._priceRange = priceRange;
        this._chartWidth = chartWidth;
        this._chartHeight = chartHeight;
        this._xScale = xScale;
        this._yScale = yScale;

        // Draw grid and axes
        this.drawGrid(chartGroup, chartWidth, chartHeight, minPrice, maxPrice, priceRange);
        this.drawAxes(chartGroup, chartWidth, chartHeight, minPrice, maxPrice);

        // Draw area (gradient fill)
        this.drawArea(chartGroup, xScale, yScale, chartWidth, chartHeight);

        // Draw average line (dotted)
        if (this.options.averagePrice) {
          this.drawAverageLine(chartGroup, chartWidth, chartHeight, minPrice, maxPrice, priceRange);
        }

        // Draw target price line (if user set a target for this product)
        if (typeof this.options.targetPrice === 'number' && isFinite(this.options.targetPrice) && this.options.targetPrice > 0) {
          this.drawTargetLine(chartGroup, chartWidth, chartHeight, minPrice, maxPrice, priceRange);
        }

        // Draw line
        this.drawLine(chartGroup, xScale, yScale);

        // Draw points
        this.drawPoints(chartGroup, xScale, yScale);
      } catch (error) {
        console.error('AdvancedChart render error:', error);
        console.error('AdvancedChart render stack:', error.stack);
        // SVG should already be created and appended, so at least there's something
        if (!this.svg || !this.container.contains(this.svg)) {
          // If SVG wasn't created, try to create minimal error SVG
          try {
            while (this.container.firstChild) {
              this.container.removeChild(this.container.firstChild);
            }
            this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            this.svg.setAttribute('width', this.width);
            this.svg.setAttribute('height', this.height);
            this.svg.style.display = 'block';
            this.container.appendChild(this.svg);
          } catch (e) {
            console.error('AdvancedChart: Failed to create error SVG:', e);
          }
        }
        throw error; // Re-throw to allow caller to handle
      }
    }

    drawGrid(group, width, height, minPrice, maxPrice, priceRange) {
      const steps = 5;
      for (let i = 1; i < steps; i++) {
        const y = (i / steps) * height;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y);
        line.setAttribute('x2', width);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', '#e8e8e8');
        line.setAttribute('stroke-width', '1');
        group.appendChild(line);
      }
    }

    drawAxes(group, width, height, minPrice, maxPrice) {
      // Y-axis
      const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      yAxis.setAttribute('x1', 0);
      yAxis.setAttribute('y1', 0);
      yAxis.setAttribute('x2', 0);
      yAxis.setAttribute('y2', height);
      yAxis.setAttribute('stroke', '#999');
      yAxis.setAttribute('stroke-width', '1');
      group.appendChild(yAxis);

      // X-axis
      const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      xAxis.setAttribute('x1', 0);
      xAxis.setAttribute('y1', height);
      xAxis.setAttribute('x2', width);
      xAxis.setAttribute('y2', height);
      xAxis.setAttribute('stroke', '#999');
      xAxis.setAttribute('stroke-width', '1');
      group.appendChild(xAxis);

      // Y-axis labels
      const steps = 5;
      const tFunc = this.options.t;
      const currency = (tFunc && typeof tFunc === 'function') ? tFunc('currency') || tFunc('lev') : 'EUR';
      
      for (let i = 0; i <= steps; i++) {
        const price = minPrice + (maxPrice - minPrice) * (i / steps);
        const y = height - (i / steps) * height;
        
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', -10);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'sans-serif');
        label.setAttribute('fill', '#666');
        label.textContent = price.toFixed(2) + ' ' + currency;
        group.appendChild(label);
      }

      // X-axis labels (dates). Format: D/M/YY (e.g. "30/4/26") — keeps the
      // existing day/month style but adds a 2-digit year so labels stay
      // disambiguated when history spans multiple years.
      const data = this._validData || this.data || [];
      const dateSteps = Math.min(5, data.length);
      for (let i = 0; i < dateSteps; i++) {
        const index = Math.floor((i / (dateSteps - 1)) * (data.length - 1));
        if (index >= data.length || !data[index] || !data[index].date) continue;
        const x = (index / (data.length - 1)) * width;
        const date = new Date(data[index].date);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', height + 20);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '10');
        label.setAttribute('font-family', 'sans-serif');
        label.setAttribute('fill', '#666');
        const yy = String(date.getFullYear() % 100).padStart(2, '0');
        label.textContent = `${date.getDate()}/${date.getMonth() + 1}/${yy}`;
        group.appendChild(label);
      }
    }

    drawArea(group, xScale, yScale, width, height) {
      const data = this._validData || this.data || [];
      if (data.length < 2) return;

      // Create or get defs element (should be at the top of SVG for proper structure)
      let defs = this.svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        // Insert defs as first child (before chart group) for proper SVG structure
        if (this.svg.firstChild) {
          this.svg.insertBefore(defs, this.svg.firstChild);
        } else {
          this.svg.appendChild(defs);
        }
      }
      
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      const gradientId = `areaGradient-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      gradient.setAttribute('id', gradientId);
      gradient.setAttribute('x1', '0%');
      gradient.setAttribute('y1', '0%');
      gradient.setAttribute('x2', '0%');
      gradient.setAttribute('y2', '100%');
      
      const lineColor = this.options.lineColor || '#3498db';
      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', lineColor);
      stop1.setAttribute('stop-opacity', '0.3');
      gradient.appendChild(stop1);
      
      const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', lineColor);
      stop2.setAttribute('stop-opacity', '0.05');
      gradient.appendChild(stop2);
      
      defs.appendChild(gradient);

      // Build area path
      let areaPath = '';
      data.forEach((point, index) => {
        if (!point || typeof point.price !== 'number' || isNaN(point.price)) return;
        const x = xScale(index);
        const y = yScale(point.price);
        if (index === 0) {
          areaPath += `M ${x} ${height} L ${x} ${y}`;
        } else {
          areaPath += ` L ${x} ${y}`;
        }
      });
      
      // Close area path
      if (data.length > 0) {
        const lastX = xScale(data.length - 1);
        areaPath += ` L ${lastX} ${height} Z`;
      }

      const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      area.setAttribute('d', areaPath);
      area.setAttribute('fill', `url(#${gradientId})`);
      group.appendChild(area);
    }

    drawLine(group, xScale, yScale) {
      const data = this._validData || this.data || [];
      if (data.length < 2) return;

      let pathData = '';
      data.forEach((point, index) => {
        if (!point || typeof point.price !== 'number' || isNaN(point.price)) return;
        const x = xScale(index);
        const y = yScale(point.price);
        if (index === 0) {
          pathData += `M ${x} ${y}`;
        } else {
          pathData += ` L ${x} ${y}`;
        }
      });

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', this.options.lineColor || '#3498db');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      group.appendChild(path);
    }

    drawTargetLine(group, width, height, minPrice, maxPrice, priceRange) {
      const targetPrice = this.options.targetPrice;
      const tFunc = this.options.t;
      const currency = (typeof tFunc === 'function') ? (tFunc('currency') || tFunc('lev') || 'EUR') : 'EUR';
      const labelPrefix = (typeof tFunc === 'function') ? (tFunc('priceTarget.label') || 'Target:') : 'Target:';

      // Y position. If target is outside the visible range, clamp to the edge
      // so users still see the line, with an arrow indicating which way it goes.
      const rawY = height - ((targetPrice - minPrice) / priceRange) * height;
      const targetY = Math.max(0, Math.min(height, rawY));
      const arrow = rawY < 0 ? ' ↑' : (rawY > height ? ' ↓' : '');

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', targetY);
      line.setAttribute('x2', width);
      line.setAttribute('y2', targetY);
      line.setAttribute('stroke', '#8B5CF6'); // purple, distinct from blue avg + price line
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '4,3');
      line.setAttribute('opacity', '0.85');
      group.appendChild(line);

      // Label sits on the LEFT so it doesn't collide with the average label on the right.
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', 5);
      // Nudge label below the line if it's at the very top so it stays visible.
      label.setAttribute('y', targetY < 14 ? targetY + 12 : targetY - 5);
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'sans-serif');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', '#8B5CF6');
      label.textContent = `${labelPrefix} ${targetPrice.toFixed(2)} ${currency}${arrow}`;
      group.appendChild(label);
    }

    drawAverageLine(group, width, height, minPrice, maxPrice, priceRange) {
      const avgY = height - ((this.options.averagePrice - minPrice) / priceRange) * height;
      
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', avgY);
      line.setAttribute('x2', width);
      line.setAttribute('y2', avgY);
      line.setAttribute('stroke', '#3498db');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('opacity', '0.7');
      group.appendChild(line);
      
      // Label
      const tFunc = this.options.t;
      const avgLabel = (tFunc && typeof tFunc === 'function') 
        ? tFunc('stats.averagePrice') || tFunc('averagePrice') 
        : 'Average';
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', width - 5);
      label.setAttribute('y', avgY - 5);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', '#3498db');
      label.setAttribute('font-weight', '600');
      label.textContent = avgLabel;
      group.appendChild(label);
    }

    drawPoints(group, xScale, yScale) {
      const data = this._validData || this.data || [];
      const tFunc = this.options.t;
      const currency = (tFunc && typeof tFunc === 'function') ? tFunc('currency') || tFunc('lev') : 'EUR';
      
      data.forEach((point, index) => {
        if (!point || typeof point.price !== 'number' || isNaN(point.price)) return;
        const x = xScale(index);
        const y = yScale(point.price);
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', this.options.lineColor || '#3498db');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        circle.style.cursor = 'pointer';
        
        // Add tooltip
        circle.addEventListener('mouseenter', (e) => {
          const tooltip = document.createElement('div');
          tooltip.className = 'chart-tooltip';
          tooltip.style.position = 'absolute';
          tooltip.style.background = '#333';
          tooltip.style.color = '#fff';
          tooltip.style.padding = '8px 12px';
          tooltip.style.borderRadius = '6px';
          tooltip.style.fontSize = '12px';
          tooltip.style.pointerEvents = 'none';
          tooltip.style.zIndex = '10000';
          tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
          
          const date = new Date(point.date);
          // Format date using the user's chosen locale (passed from the widget).
          const locale = this.options.locale || 'bg-BG';
          const dateStr = date.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          tooltip.textContent = `${dateStr}: ${point.price.toFixed(2)} ${currency}`;
          document.body.appendChild(tooltip);
          
          const rect = circle.getBoundingClientRect();
          tooltip.style.left = (rect.left + window.scrollX - tooltip.offsetWidth / 2 + 5) + 'px';
          tooltip.style.top = (rect.top + window.scrollY - 35) + 'px';
          
          circle._tooltip = tooltip;
        });
        
        circle.addEventListener('mouseleave', () => {
          if (circle._tooltip) {
            circle._tooltip.remove();
            circle._tooltip = null;
          }
        });
        
        group.appendChild(circle);
      });
    }

    updateData(newData) {
      this.data = newData;
      this.render();
    }
  };
}

