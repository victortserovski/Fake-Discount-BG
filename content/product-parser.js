// Shared product data extraction utilities
class ProductParser {
  // Extract product ID from URL
  static extractProductId(url) {
    try {
      const urlObj = new URL(url);

      // Ozone: check first since Ozone also uses /product/ which would match the Emag regex
      const ozoneMatch = url.match(/ozone\.bg.*?\/(?:product|p)\/([^\/\?]+)/);
      if (ozoneMatch) {
        return `ozone_${ozoneMatch[1]}`;
      }

      // Emag: /p/PRODUCT_ID/ or /pd/PRODUCT_ID/
      const emagMatch = url.match(/\/(?:p|pd|product)\/([^\/]+)/);
      if (emagMatch) {
        return `emag_${emagMatch[1]}`;
      }

      // Fallback: use full URL path as ID
      return urlObj.hostname.replace('.', '_') + '_' + urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_');
    } catch (error) {
      console.error('Error extracting product ID:', error);
      return `product_${Date.now()}`;
    }
  }

  // Parse price from text
  // Handles formats: "999,00 лв.", "1 199.00 лв.", "510,78 €", "1 199,00 лв."
  static parsePrice(priceText) {
    if (!priceText) return null;

    let cleaned = priceText.trim();

    // Remove currency symbols and text, keep numbers, spaces, commas, dots
    // Use [\s\u00A0] to also match non-breaking spaces common in Bulgarian price formatting
    cleaned = cleaned.replace(/[^\d,\s\u00A0.]+/g, '').trim();

    // Detect format: if it has both comma and dot, dot is decimal, comma is thousand separator
    // If only comma, it's decimal separator
    // If only dot, it's decimal separator
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
      // Format like "1 199,00" or "1.199,00" - comma is decimal
      // Remove dots (they're thousand separators), replace comma with dot
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
      // Format like "999,00" - comma is decimal
      cleaned = cleaned.replace(',', '.');
    } else if (!hasComma && hasDot) {
      // Format like "1 199.00" - dot is decimal, keep it
      // Just remove spaces
      cleaned = cleaned.replace(/[\s\u00A0]+/g, '');
    } else {
      // No decimal separator, just remove spaces
      cleaned = cleaned.replace(/[\s\u00A0]+/g, '');
    }

    // Remove any remaining spaces and non-breaking spaces (thousand separators)
    cleaned = cleaned.replace(/[\s\u00A0]+/g, '');

    const price = parseFloat(cleaned);

    // Validate price range (0.01 to 1,000,000)
    if (isNaN(price) || price < 0.01 || price > 1000000) {
      return null;
    }

    return Math.round(price * 100) / 100;
  }

  // Calculate discount percentage
  static calculateDiscount(originalPrice, currentPrice) {
    if (!originalPrice || !currentPrice || originalPrice <= currentPrice) {
      return null;
    }
    return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  // Wait for element to appear in DOM
  static async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }
}
