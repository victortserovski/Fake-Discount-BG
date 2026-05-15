# Fake Discount Bulgaria — Catch Faked Sales

> Chrome / Edge extension

A Chrome/Edge extension that detects fake discounts on 20 Bulgarian e-commerce sites (Emag.bg, Ozone.bg, Notino.bg, Technopolis.bg, Technomarket.bg, Zora.bg, Ardes.bg, Plesio.bg, Aboutyou.bg, Answear.bg, Decathlon.bg, dm-drogeriemarkt.bg, Fashiondays.bg, Lillydrogerie.bg, Mr-bricolage.bg, Obuvki.bg, Praktiker.bg, Sopharmacy.bg, Sportdepot.bg, eBag.bg) by automatically tracking price history and displaying integrated price graphs on product pages.

**Repository:** https://github.com/victortserovski/Fake-Discount-BG
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
- **EAN/GTIN tracking**: When a product's barcode is exposed it's stored alongside the price history for future cross-site price matching. Click an EAN in the popup to copy it to the clipboard. Coverage by site (based on a full audit of saved samples): consistent — **Notino, Obuvki, Zora, dm-drogeriemarkt**; occasional — **Praktiker, Mr.Bricolage** (barcode appears in the product description text on some products); none exposed in saved samples — Emag, Ozone, Ardes, Plesio, Technopolis, Technomarket, Aboutyou, Answear, Decathlon, Fashion Days, Lillydrogerie, Sopharmacy, Sportdepot, eBag.
- **Last-seen indicator**: Each product card shows when it was last refreshed ("updated today / yesterday / N days ago") so stale entries are easy to spot
- **Keyboard shortcut**: Press `Ctrl+Shift+F` (or `⌘+Shift+F` on Mac) to open the popup. Customisable at `chrome://extensions/shortcuts`
- **Persisted filters**: Site-filter chips and sort selection survive popup close/reopen (the search box is intentionally cleared each time)

## Installation

1. Download or clone this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory

## How It Works

1. When you visit a product page on any supported site (Emag, Ozone, Notino, Technopolis, Technomarket, Zora, Ardes, Plesio, Aboutyou, Answear, Decathlon, dm-drogeriemarkt, Fashiondays, Lillydrogerie, Mr-bricolage, Obuvki, Praktiker, Sopharmacy, Sportdepot), the extension automatically:
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
   - **VOLATILE PRICE** (orange): Price has fluctuated by 8%+ across the last 30 days — wait for a low point
   - **STABLE PRICE** (yellow): Price has been confirmed stable over 7+ tracked days AND the 30-day range is tight (< 8% of average)
   - **TRACKING** (gray): Fewer than 7 tracked days — not enough data for a confident verdict yet

   Each verdict's reason text reports how many observations (datapoints) and
   days of tracking it's based on, so the reader can judge how strong the
   evidence is. A "fake discount" verdict on a 22-day flat history with a
   single ПЦД comparison reads differently from a "fake discount" verdict
   on 90 days of recorded ups and downs — both messages name their evidence.

## Storage

- Uses Chrome local storage (limit ~10MB)
- Per-product keys for O(1) read/write performance
- Per-product write queue prevents races on rapid page reloads
- **Full daily price history is kept indefinitely** (no compression) so the
  fake-discount detector always has accurate original-price comparisons
- Storage usage shown with adaptive precision (e.g. "0.03%") in the popup
- Auto-cleanup is disabled — only the manual "Cleanup old" button removes products

## Popup

Click the extension icon. The popup is organised into three tabs plus a "↗"
link in the header that re-opens the same UI as a full Chrome tab (handy when
you have many tracked products).

**Products tab** — search by name or EAN, filter by site (multi-select chips
for all 19 supported stores: EMAG, OZONE, NOTINO, TECHNOPOLIS, TECHNOMARKET,
ZORA, ARDES, PLESIO, ABOUT YOU, ANSWEAR, DECATHLON, DM, FASHION DAYS, LILLY,
MR.BRICOLAGE, OBUVKI, PRAKTIKER, SOPHARMACY, SPORT DEPOT), sort by recently
visited / price / targets-first. Each card
shows thumbnail, title, EAN (when known, click to copy), "last seen" line,
price, trend (↑ higher / ↓ lower / → same — only shown once there's a
prior price to compare against), site badge, and a 🎯 row when a price
target is set.

**Settings tab**
- Change language (Bulgarian/English)
- **Track prices on each supported site** — a master toggle per store
  (Emag, Ozone, Notino, Technopolis, Technomarket, Zora, Ardes, Plesio,
  Aboutyou, Answear, Decathlon, dm, Fashiondays, Lilly, Mr-bricolage,
  Obuvki, Praktiker, Sopharmacy, Sportdepot). When off, no tracking and
  no widget for that site.
- **Show chart on product pages** — visibility toggle. When off, prices are
  still tracked silently in the background; the chart just doesn't appear.
- **About** subsection — current version (read live from `manifest.json`),
  contact email, keyboard-shortcut hint and link to customise it

**Data tab**
- Storage usage bar + tracked-product count
- Export/import data as JSON (imports are validated; malformed entries are skipped)
- Clean up old entries (90+ days) or clear all history

A persistent footer at the bottom of every tab shows total tracked count and
storage usage at a glance.

## Architecture

- **Manifest V3** with content scripts and background service worker
- `content/` - Site-specific content scripts (emag.js, ozone.js, notino.js, technopolis.js, technomarket.js, zora.js, ardes.js, plesio.js, aboutyou.js, answear.js, decathlon.js, dm.js, fashiondays.js, lilly.js, bricolage.js, obuvki.js, praktiker.js, sopharmacy.js, sportdepot.js) with shared base (content-base.js)
- `background/` - Service worker for message handling, storage, and price analysis
- `ui/` - SVG-based chart rendering (advanced-chart.js) and widget UI (price-graph-widget.js)
- `i18n/` - Bulgarian and English translation files
- `popup/` - Extension popup with settings and product list
- `utils/` - PriceStorageManager with per-product keys and migration support; Supabase cloud-sync utility (enabled in the public build — every recorded observation is uploaded; see [PRIVACY.md](PRIVACY.md))
- `test/` - Manual test suite (run in browser console)

## Development

The widget UI scripts run in the content script isolated world (not injected into the host page). This ensures they work on sites with strict Content Security Policies like Ozone.bg. SPA navigation is detected via `chrome.tabs.onUpdated` messages from the background service worker.

### Cloud sync (enabled in the public build)

`utils/supabase-sync.js` ships with populated `SUPABASE_URL` and
`SUPABASE_ANON_KEY` constants pointing at a developer-controlled
Supabase project. Every price observation recorded by the extension is
uploaded fire-and-forget to a `price_history` Postgres table — see
[PRIVACY.md](PRIVACY.md) for the exact field list and how the data is
used. Local `chrome.storage` remains the source of truth; the network
push never blocks the widget render. Upload is deduplicated per
`(device_id, product_id, observed_date)` so repeated visits within the
same day don't bloat the dataset.

Developers cloning this repo for their own fork can blank both constants
to disable the upload (it then becomes a silent no-op) and follow the
SQL setup block at the top of the file to wire up a separate project.

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
- `HTML pages and links/` — saved reference HTML samples used while writing
  the content scripts (32 MB of dev-only material, gitignored)
- `Emag.bg html.txt`, `Ozone.bg html.txt` — early saved-page reference dumps
- `GPT 5.5 audit.md`, `AGENTS.md` — internal AI-agent / audit notes
- `promo-small-440x280.png` — Chrome Web Store promo asset, uploaded
  separately via the Developer Dashboard (not part of the extension)
- `CLAUDE.md` — internal AI-agent rules
- `PRIVACY.md` — keep in the repo for the Web Store listing link, but the
  zip itself doesn't need to ship it
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

This extension stores your local price history in your browser, AND
uploads each recorded observation (product URL, title, EUR price, EAN,
observation date, plus a random pseudonymous device ID) to a Postgres
database hosted on Supabase, operated by the developer, so the
extension can build a shared price-history dataset across installs.

No personally identifiable information, payment data, authentication
state, or browsing history outside the 20 supported stores is collected.

See [PRIVACY.md](PRIVACY.md) for the full disclosure, the complete
list of uploaded fields, and how to request data removal.
