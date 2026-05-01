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
  const thirtyDayAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;

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
      reasonParams: { percentage },
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
      reasonParams: { percentage },
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
      reasonParams: { percentage: Math.max(0, percentage) },
      currentPrice,
      originalPrice,
      discount: originalPrice ? ((originalPrice - currentPrice) / originalPrice) * 100 : null,
      stats
    };
  }

  // VERDICT 3: STABLE PRICE (YELLOW)
  // Condition: currentPrice is within 10% of 30-day average AND no significant discount
  if (recentHistory.length >= 7) {
    const priceDiff = Math.abs(currentPrice - thirtyDayAvg) / thirtyDayAvg;
    if (priceDiff <= 0.1 && (!originalPrice || (originalPrice - currentPrice) / originalPrice < 0.15)) {
      return {
        result: 'stable',
        verdict: 'STABLE_PRICE',
        confidence: 70,
        reasonKey: 'stablePrice',
        reasonParams: {},
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
          percentage: Math.round(((averagePrice - currentPrice) / averagePrice) * 100)
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
