# Fake Discount BG — Chrome Extension

A Chrome/Edge extension that detects fake discounts on Bulgarian e-commerce sites (Emag.bg and Ozone.bg) by automatically tracking price history and displaying integrated price graphs on product pages.

**Repository:** https://github.com/reversebite/Fake-Discount-BG
**Privacy policy:** [PRIVACY.md](PRIVACY.md)

## Features

- **Automatic Tracking**: All products you visit are automatically tracked (no manual watchlist needed)
- **Integrated Display**: Price graph and discount analysis displayed directly on product pages
- **Verdict System**: Shows "Fake discount", "Real deal", "Stable price", or "Tracking" (when there isn't enough data yet) with reason text
- **Extension Badge**: Per-tab icon badge — "!" for fake discounts, "✓" for real deals, 🎯 when a price target is hit
- **Price Targets**: Set a target on any product; the chart shows a purple horizontal line at your target, the popup marks products with active targets, and a green pulsing pill appears when the target is reached
- **Clickable Product List**: Click any product in the popup to open its page; price range (low-high) shown per product
- **Bilingual Support**: Bulgarian (default) and English, with localized date formatting in the chart
- **Export/Import**: Back up and restore your price history data as JSON (validated and sanitized on import)

## Installation

1. Download or clone this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory

## How It Works

1. When you visit a product page on Emag.bg or Ozone.bg, the extension automatically:
   - Extracts product information (ID, price, title)
   - Stores price history in local storage
   - Analyzes price patterns to detect fake discounts
   - Displays a price graph widget on the product page

2. The extension tracks:
   - Current price vs. historical prices
   - Claimed "original price" vs. actual historical maximum
   - Price trends over 30-day windows
   - Overall pricing stability/volatility

3. Verdict System:
   - **FAKE DISCOUNT** (red): High confidence the discount is fake (original price inflated, or price raised before "sale")
   - **REAL DEAL** (green): Legitimate discount — price is near or at all-time low
   - **STABLE PRICE** (yellow): Price has been confirmed stable over 7+ tracked days
   - **TRACKING** (gray): Fewer than 7 tracked days — not enough data for a confident verdict yet

## Storage

- Uses Chrome local storage (limit ~10MB)
- Per-product keys for O(1) read/write performance
- Per-product write queue prevents races on rapid page reloads
- **Full daily price history is kept indefinitely** (no compression) so the
  fake-discount detector always has accurate original-price comparisons
- Storage usage shown with adaptive precision (e.g. "0.03%") in the popup
- Auto-cleanup is disabled — only the manual "Cleanup old" button removes products

## Settings

Click the extension icon to access settings:
- Change language (Bulgarian/English)
- **Track prices on Emag.bg / Ozone.bg** — master switch per site. When off,
  no tracking and no widget for that site.
- **Show chart on product pages** — visibility toggle. When off, prices are
  still tracked silently in the background; the chart just doesn't appear.
- View storage usage and tracked product count
- Export/import data as JSON (imports are validated; malformed entries are skipped)
- Clean up old entries (90+ days) or clear all history

## Architecture

- **Manifest V3** with content scripts and background service worker
- `content/` - Site-specific content scripts (emag.js, ozone.js) with shared base (content-base.js)
- `background/` - Service worker for message handling, storage, and price analysis
- `ui/` - SVG-based chart rendering (advanced-chart.js) and widget UI (price-graph-widget.js)
- `i18n/` - Bulgarian and English translation files
- `popup/` - Extension popup with settings and product list
- `utils/` - PriceStorageManager with per-product keys and migration support
- `test/` - Manual test suite (run in browser console)

## Development

The widget UI scripts run in the content script isolated world (not injected into the host page). This ensures they work on sites with strict Content Security Policies like Ozone.bg. SPA navigation is detected via `chrome.tabs.onUpdated` messages from the background service worker.

## Notes

- Price history starts accumulating from the first time you visit a product
- More data = better fake discount detection accuracy (TRACKING verdict transitions to a confident verdict at 7+ days)
- The extension only tracks products you actually visit (not all products on the site)
- Product identification uses URL path as primary key
- All prices are displayed in EUR regardless of language setting

## For developers / AI agents

See [CLAUDE.md](CLAUDE.md) for general behavioral guidelines plus this project's
specific rules (version-bump policy, conventions, where things live).

## Packaging for distribution

When zipping the extension for the Chrome Web Store or sideloading, exclude
these files so they don't ship to users:

- `test/` — manual test suite, not used at runtime
- `Emag.bg html.txt`, `Ozone.bg html.txt` — saved page samples used as
  reference while writing the content scripts
- `promo-small-440x280.png` — Chrome Web Store promo asset, uploaded
  separately via the Developer Dashboard (not part of the extension)
- `CLAUDE.md` — internal AI-agent rules
- `README.md` — optional, the Web Store listing already describes the extension

The required files in the .zip are: `manifest.json`, `background/`,
`content/`, `popup/`, `ui/`, `utils/`, `i18n/`, and `icons/`.

### Chrome Web Store assets (uploaded via Developer Dashboard, not bundled)

- **Store icon** `128×128` — taken from `icons/icon128.png`
- **Small promo tile** `440×280` — `promo-small-440x280.png`
- Optional larger promo / marquee tiles can be added later

These are configured under **Store listing → Graphic assets** in the
Chrome Web Store Developer Dashboard.

## License

MIT — see [LICENSE](LICENSE).

## Privacy

This extension stores all data locally in your browser. Nothing is transmitted
to any server. See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
