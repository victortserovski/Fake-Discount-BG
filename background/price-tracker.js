// Price tracking and fake discount detection logic
// Note: storage.js is already imported by service-worker.js
// This function will be available globally after service-worker.js loads

function detectFakeDiscount(productData) {
  const { currentPrice, originalPrice, history } = productData;
  
  // Need at least some history for meaningful analysis
  if (!history || history.length === 0) {
    return {
      result: 'tracking',
      verdict: 'TRACKING',
      confidence: 0,
      reasonKey: 'insufficientData',
      reasonParams: { current: 0, needed: 7 },
      stats: {
        allTimeLow: null,
        allTimeHigh: null,
        averagePrice: null,
        thirtyDayLow: null,
        thirtyDayAvg: null
      }
    };
  }

  const prices = history.map(h => h.price);
  const allTimeLow = Math.min(...prices);
  const allTimeHigh = Math.max(...prices);
  const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Calculate 30-day stats
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentHistory = history.filter(h => new Date(h.date) >= thirtyDaysAgo);
  const recentPrices = recentHistory.length > 0 ? recentHistory.map(h => h.price) : prices;
  const thirtyDayLow = Math.min(...recentPrices);
  const thirtyDayHigh = Math.max(...recentPrices);
  const thirtyDayAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;

  // 30-day price-range as a fraction of the average. Used by the VOLATILE
  // verdict to catch products whose current price happens to sit near the
  // mean while the recent history bounces wildly — STABLE used to fire on
  // those because it only compared currentPrice to thirtyDayAvg, ignoring
  // how much the prices moved during the window. Range/avg of 0.08 (8%) is
  // the threshold tuned against real tracked products; lower triggers too
  // many borderline cases as volatile, higher misses meaningful bouncing.
  const thirtyDayRangePct = thirtyDayAvg > 0
    ? (thirtyDayHigh - thirtyDayLow) / thirtyDayAvg
    : 0;

  // Data-quality context that gets surfaced in every verdict's reason text.
  // The user needs to know that "highest price we observed" is bounded by how
  // many datapoints we actually have AND how long ago the first one was —
  // otherwise a 22-day-flat product looks like "we have authoritative history"
  // when it's really just "we've only ever seen one price." Pass both values
  // (observations + days) into reasonParams so the i18n strings can render
  // them honestly.
  const observations = history.length;
  const firstDate = new Date(history[0].date);
  const days = isNaN(firstDate.getTime())
    ? 0
    : Math.max(1, Math.round((now - firstDate) / (24 * 60 * 60 * 1000)));
  const recentObservations = recentHistory.length;
  const recentDays = Math.min(days, 30);

  // Format a price as "<value> EUR" so verdict reason strings can inline
  // the actual numbers being compared. Hard-coded EUR because storage and
  // display are EUR across all sites — if currencies become configurable,
  // change here once. The formatter lives in the verdict layer (not in
  // i18n templates) so each language template is just a `{placeholder}`
  // substitution and doesn't need to know about currency suffixes.
  const fmt = (n) => `${Number(n).toFixed(2)} EUR`;

  const stats = {
    allTimeLow,
    allTimeHigh,
    averagePrice,
    thirtyDayLow,
    thirtyDayAvg
  };

  // VERDICT 1: FAKE DISCOUNT (RED)
  // Condition: currentPrice > 30-day minimum * 1.1 OR originalPrice > historicalMax * 1.2
  // NOTE: requires history.length >= 7 — with fewer entries, the "historical
  // maximum" is just the price we observed today and the seller's "original"
  // claim is unverifiable. Without this guard the verdict fires on the very
  // first visit, mislabeling unknown products as fake discounts.
  if (originalPrice && history.length >= 7 && originalPrice > allTimeHigh * 1.2) {
    const percentage = Math.round(((originalPrice - allTimeHigh) / allTimeHigh) * 100);
    return {
      result: 'fake_discount',
      verdict: 'FAKE_DISCOUNT',
      confidence: Math.min(50 + percentage / 2, 100),
      reasonKey: 'priceHigherThanMax',
      reasonParams: {
        percentage,
        observations,
        days,
        originalPrice: fmt(originalPrice),
        maxPrice: fmt(allTimeHigh)
      },
      currentPrice,
      originalPrice,
      discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
      stats
    };
  }

  if (currentPrice > thirtyDayLow * 1.1 && recentHistory.length >= 7) {
    const percentage = Math.round(((currentPrice - thirtyDayLow) / thirtyDayLow) * 100);
    return {
      result: 'fake_discount',
      verdict: 'FAKE_DISCOUNT',
      confidence: Math.min(40 + percentage / 3, 100),
      reasonKey: 'priceHigherThan30DayLow',
      reasonParams: {
        percentage,
        observations: recentObservations,
        days: recentDays,
        currentPrice: fmt(currentPrice),
        minPrice: fmt(thirtyDayLow)
      },
      currentPrice,
      originalPrice,
      discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
      stats
    };
  }

  // VERDICT 2: REAL DEAL (GREEN)
  // Condition: currentPrice <= allTimeLow * 1.05 (within 5% of all-time low)
  if (currentPrice <= allTimeLow * 1.05 && history.length >= 7) {
    const percentage = Math.round(((allTimeLow - currentPrice) / allTimeLow) * 100);
    return {
      result: 'real_deal',
      verdict: 'REAL_DEAL',
      confidence: Math.min(80 + (5 - percentage) * 4, 100),
      reasonKey: 'atAllTimeLow',
      reasonParams: {
        percentage: Math.max(0, percentage),
        observations,
        days,
        currentPrice: fmt(currentPrice),
        minPrice: fmt(allTimeLow)
      },
      currentPrice,
      originalPrice,
      discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
      stats
    };
  }

  // VERDICT 3: VOLATILE PRICE (ORANGE)
  // Condition: 30-day range exceeds 8% of average AND we have ≥7 datapoints.
  // Comes BEFORE STABLE so that a product whose current price happens to be
  // near the average doesn't get mislabeled as steady when the underlying
  // history bounces. Comes AFTER REAL_DEAL so that "near all-time low" still
  // wins for the user — actionable buy-now signal beats descriptive volatility.
  if (recentHistory.length >= 7 && thirtyDayRangePct >= 0.08) {
    const percentage = Math.round(thirtyDayRangePct * 100);
    return {
      result: 'volatile',
      verdict: 'VOLATILE_PRICE',
      confidence: Math.min(60 + Math.round((thirtyDayRangePct - 0.08) * 200), 95),
      reasonKey: 'volatilePrice',
      reasonParams: { percentage, observations: recentObservations, days: recentDays },
      currentPrice,
      originalPrice,
      discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
      stats
    };
  }

  // VERDICT 4: STABLE PRICE (YELLOW)
  // Condition: currentPrice is within 10% of 30-day average AND no significant
  // claimed discount. The earlier VOLATILE branch already filtered out products
  // with wide price ranges, so anything reaching here has rangePct < 8% — the
  // "stable" label is honest.
  if (recentHistory.length >= 7) {
    const priceDiff = Math.abs(currentPrice - thirtyDayAvg) / thirtyDayAvg;
    if (priceDiff <= 0.1 && (!originalPrice || (originalPrice - currentPrice) / originalPrice < 0.15)) {
      return {
        result: 'stable',
        verdict: 'STABLE_PRICE',
        confidence: 70,
        reasonKey: 'stablePrice',
        reasonParams: { observations: recentObservations, days: recentDays },
        currentPrice,
        originalPrice,
        discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
        stats
      };
    }
  }

  // If no discount shown, check if current price is good deal
  if (!originalPrice || originalPrice <= currentPrice) {
    if (history.length >= 7 && currentPrice < averagePrice * 0.9) {
      return {
        result: 'real_deal',
        verdict: 'REAL_DEAL',
        confidence: 70,
        reasonKey: 'belowAverage',
        reasonParams: {
          percentage: Math.round(((averagePrice - currentPrice) / averagePrice) * 100),
          observations,
          days,
          currentPrice: fmt(currentPrice),
          avgPrice: fmt(averagePrice)
        },
        currentPrice,
        originalPrice: null,
        discount: null,
        stats
      };
    }
  }

  // Default: still gathering data — we have <7 entries so confirmed verdicts
  // (FAKE_DISCOUNT / REAL_DEAL / STABLE_PRICE) can't fire. Show a neutral
  // "tracking" state instead of mislabeling the price as stable.
  return {
    result: 'tracking',
    verdict: 'TRACKING',
    confidence: 0,
    reasonKey: 'insufficientData',
    reasonParams: { current: history.length, needed: 7 },
    currentPrice,
    originalPrice,
    discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
    stats
  };
}
