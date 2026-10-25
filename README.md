# Fake Discount Bulgaria — Catch Faked Sales

> Chrome / Edge extension

A Manifest V3 Chrome/Edge extension with adapters for 20 Bulgarian e-commerce sites (Emag.bg, Ozone.bg, Notino.bg, Technopolis.bg, Technomarket.bg, Zora.bg, Ardes.bg, Plesio.bg, Aboutyou.bg, Answear.bg, Decathlon.bg, dm-drogeriemarkt.bg, Fashiondays.bg, Lillydrogerie.bg, Mr-bricolage.bg, Obuvki.bg, Praktiker.bg, Sopharmacy.bg, Sportdepot.bg, eBag.bg). It records a daily EUR price snapshot when you visit a supported, enabled product page and renders local price-history charts plus heuristic deal signals directly on the page.

The configured Supabase project uses the restricted ingestion function in
[supabase/ingestion.sql](supabase/ingestion.sql). New deployments must apply it
and run [supabase/verify-ingestion.sql](supabase/verify-ingestion.sql).

**Repository:** https://github.com/victortserovski/Fake-Discount-BG
**Privacy policy:** [PRIVACY.md](PRIVACY.md)

## Features

- **Visit-triggered Tracking**: A valid purchasable price is recorded automatically when you visit an enabled, supported product page (no manual watchlist needed; one local snapshot per product per day)
- **Integrated Display**: A price panel on product pages, rendered in a shadow root so store CSS can't restyle it. It shows the verdict with its evidence, today / lowest / average / highest prices, and a step chart with the store's claimed "was" price, your target and the average as reference lines. Time-range tabs appear for long histories, and the chart has hover and keyboard tooltips. The panel collapses to a one-line summary, and that choice is remembered. Out-of-stock pages say so instead of showing an empty chart
- **Verdict System**: Shows the heuristic states "Check the discount", "Low observed price", "Volatile price", "Stable price", or "Tracking" with the observations behind the result
- **Extension Badge**: Per-tab icon badge — "!" for discounts needing review, "✓" for favorable observed prices, 🎯 when a price target is hit (target badge overrides the verdict badge on that tab)
- **Price Targets**: Set a target on any product (comma or dot decimals both work); the chart shows a horizontal target line, the panel shows how far the price is from it, the popup marks active targets, and the current tab badge/pill changes when a visited price reaches the target. There is no background polling or browser notification.
- **Clickable Product List**: Click any product in the popup to open its page. Each card shows the product's current verdict tag, a price sparkline and the change since the previous observation
- **Bilingual Support**: Bulgarian (default) and English, with localized currency and date formatting
- **Dark mode**: The popup and full-tab view follow the operating system's light/dark setting
- **Export/Import**: Export and import price-history product records as JSON with field-level validation (settings and price targets are not included; valid records and their index are committed in one storage batch). Imported image URLs are discarded; images refresh on the next retailer visit.
- **EAN/GTIN tracking**: Validated barcodes can be searched or copied in the popup. The generic extractor checks JSON-LD, meta, microdata, custom EAN attributes (including Technomarket), and labelled text. Cross-store matching is a future feature.
- **Last-seen indicator**: Each product card shows when it was last refreshed ("today / yesterday / N days ago") so stale entries are easy to spot
- **Keyboard shortcut**: Press `Ctrl+Shift+F` (or `⌘+Shift+F` on Mac) to open the popup. Customisable at `chrome://extensions/shortcuts`
- **Persisted filters**: Store-filter chips and sort selection survive popup close/reopen (the search box is intentionally cleared each time)

## Installation

1. Download or clone this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory

## How It Works

1. When you visit a product page on any supported site (Emag, Ozone, Notino, Technopolis, Technomarket, Zora, Ardes, Plesio, Aboutyou, Answear, Decathlon, dm-drogeriemarkt, Fashiondays, Lillydrogerie, Mr-bricolage, Obuvki, Praktiker, Sopharmacy, Sportdepot, eBag), the extension automatically:
   - Extracts product information (ID, price, title)
   - Stores or updates one local price snapshot for that product and local day
   - Analyzes local price history for potentially misleading or favorable pricing signals
   - Displays a price graph widget on the product page

2. The extension tracks:
   - Current price vs. historical prices
   - Claimed "original price" vs. actual historical maximum
   - Price trends over 30-day windows
   - Overall pricing stability/volatility

3. Verdict System:
   - **CHECK THE DISCOUNT** (red): A claimed discount conflicts with observed history. Requires a seller was-price greater than the current price and enough observations; this is a reason to check, not proof of deception.
   - **NEAR OBSERVED LOW** (green): A favorable observed price — near the tracked low, or (when no seller "was" price is shown) materially below the historical average. A flat history is classified as stable
   - **VOLATILE PRICE** (orange): Price has fluctuated by 8%+ across the last 30 days — wait for a low point
   - **STABLE PRICE** (blue): Price has been confirmed stable over 7+ price observations AND the 30-day range is tight (< 8% of average)
   - **TRACKING** (gray): Still gathering data — fewer than 7 price observations (`insufficientData` reason), or 7+ observations with no rule matched yet (`noPatternMatch` reason)

   History-based verdict reasons report the relevant observation count and
   tracked span. The insufficient-data state instead reports progress toward
   the seven-observation threshold.

## Storage

- Uses Chrome local storage (limit ~10MB)
- Per-product keys for O(1) read/write performance
- Per-product write queues share a mutation queue with migration, bulk import, deletion, and target edits. Startup reconciles orphaned product keys without deleting their history
- **Recorded daily snapshots are not compressed or automatically evicted.**
  They remain until manual deletion, extension removal, or Chrome's local
  storage quota is reached.
- Storage usage shown with adaptive precision (e.g. "0.03%") in the popup
- No automatic deletion — products can be removed individually, by the manual
  90-day cleanup, or with Clear all history

## Popup

Click the extension icon. The popup is organised into three tabs plus an
expand button in the header that re-opens the same UI as a full Chrome tab
(a responsive grid — handy when you have many tracked products).

**Products tab** — search by name or EAN (press `/` to jump to the search box),
filter by store with chips that list only the stores you have products from
(with counts; "All" resets), and sort by recently updated / price / targets-first.
Each card shows the thumbnail, title, store, "last seen" (today / yesterday /
N days ago), current price, change since the previous observation, a price
sparkline, a verdict tag (Check / Low price / Volatile / Stable), the price
target and how far away it is (when set), and the EAN (when known, click to
copy). Click a card to open the product. Delete is two-step: the first click
arms the button and the second confirms it.

**Settings tab**
- Change language (Bulgarian/English)
- **Show the price panel** — visibility toggle. When off, prices are
  still tracked silently in the background and uploaded to the shared dataset;
  the panel just doesn't appear.
- **Stores** — a master toggle per store (Emag, Ozone, Notino, Technopolis,
  Technomarket, Zora, Ardes, Plesio, Aboutyou, Answear, Decathlon, dm,
  Fashiondays, Lilly, Mr-bricolage, Obuvki, Praktiker, Sopharmacy, Sportdepot,
  eBag). When off, no tracking, no panel, and no Supabase uploads for that site.
- **About** — current version (read live from `manifest.json`), keyboard
  shortcut with a link to customise it, and the contact email

**Data tab**
- Storage usage meter + tracked-product count
- Export/import price-history product records as JSON (settings and price targets are not included; malformed product rows are skipped). Import always runs in the full-tab view, because a file picker opened from the toolbar popup can close the popup on some platforms
- Delete products not seen for 90+ days (the tab shows how many match first), or clear all product history behind a confirmation dialog, including previously orphaned records

Results and errors appear as short in-page notifications instead of browser
alert boxes. A persistent footer shows total tracked count, storage usage and
the version.

## Architecture

- **Manifest V3** with content scripts and background service worker
- `content/` - Site-specific content scripts (emag.js, ozone.js, notino.js, technopolis.js, technomarket.js, zora.js, ardes.js, plesio.js, aboutyou.js, answear.js, decathlon.js, dm.js, fashiondays.js, lilly.js, bricolage.js, obuvki.js, praktiker.js, sopharmacy.js, sportdepot.js, ebag.js) with shared base (content-base.js)
- `background/` - Service worker for message handling, storage, and price analysis
- `ui/` - Shared UI kit (ui-kit.js: DOM builders, icons, store metadata, formatting), SVG chart (advanced-chart.js) and the in-page price panel (price-graph-widget.js + its shadow-root stylesheet)
- `i18n/` - Bulgarian and English translation files
- `popup/` - Extension popup with settings and product list
- `utils/` - PriceStorageManager with per-product keys and migration support; Supabase best-effort, one-way upload utility (see [PRIVACY.md](PRIVACY.md))

## Development

The widget UI scripts run in the content script isolated world (not injected into the host page). This ensures they work on sites with strict Content Security Policies like Ozone.bg. The panel renders inside an open shadow root on the `#fake-discount-widget` host, so retailer CSS and the panel's own styles stay apart. SPA navigation is detected via `chrome.tabs.onUpdated` messages from the background service worker.

### Cloud sync (enabled in the public build)

`utils/supabase-sync.js` ships with populated `SUPABASE_URL` and
`SUPABASE_ANON_KEY` constants pointing at a developer-controlled
Supabase project. Each recorded daily snapshot is submitted best-effort,
one-way to a `price_history` Postgres table — see
[PRIVACY.md](PRIVACY.md) for the exact field list and how the data is
used. The extension does not download that pooled dataset: verdicts and
charts use local history only. Local `chrome.storage` remains the source
of truth; the network push never blocks the widget render. Upload is deduplicated per
`(device_id, product_id, observed_date)` so repeated visits within the
same day don't bloat the dataset.

Pending uploads are stored per product/day and retried by a five-minute Chrome
alarm, including after a worker restart. A newer visit replaces that day's pending
snapshot; acknowledgement removes only the matching queued version. Network
failures retain the queue. Local storage failure or termination before enqueue
can still prevent an upload; cloud ingestion does not replace local backups.
The `alarms` permission is used only for upload retries, not retailer polling.

The client calls only the write-only `ingest_price_observation` RPC. Deploy
`supabase/ingestion.sql` to revoke direct anonymous/authenticated table access.
The RPC derives the device ID from a random installation secret and accepts
updates only within that identity; timestamps prevent older requests overwriting
newer observations. The secret is retained locally and sent over HTTPS only to
this endpoint. The client never falls back to direct table writes. Until the
SQL is deployed, uploads remain queued while local tracking continues. The RPC bounds and validates
input; it is not a substitute for deployment-level anti-abuse/rate controls.

Developers cloning this repo for their own fork can blank both constants
to disable the upload (it then becomes a silent no-op). Do not copy the
legacy allow-all anon table policies for a production dataset.

## Notes

- Price history starts accumulating from the first time you visit a product
- More data gives the heuristic stronger context (`TRACKING` transitions to a
  history-based state or `noPatternMatch` at 7+ price observations)
- The extension only tracks products you actually visit (not all products on the site)
- Product identification uses site-specific URL-derived keys; EAN/GTIN is
  captured separately when available
- All prices are displayed in EUR regardless of language setting
- Historical SportDepot keys that could combine multiple models remain separate. New observations use full model/colour IDs; ambiguous old data is not guessed, merged, or deleted.

## Not implemented yet

- Cloud history is not read back into verdicts or charts.
- EAN/GTIN values are searchable and copyable, but products are not yet
  matched or compared across stores.
- Price targets are checked when a product is visited; there are no proactive
  background or operating-system alerts.

## For developers / AI agents

See [AGENTS.md](AGENTS.md) for general behavioral guidelines plus this project's
specific rules (version-bump policy, conventions, where things live).

Run `npm install` then `npm test` for the maintained deterministic regression suite.
Saved retailer HTML and supporting assets are included in `HTML pages and links/`
for code analysis and fixture regressions. Synthetic regressions also run without them.
Each store folder holds rendered-DOM captures named `regular price - …`,
`discounted price - …` (`discounted price (RRP) - …` when the only struck price is a
manufacturer reference), `out of stock - …`, plus a few edge cases (removed or
delisted products). `Links.txt` lists every capture's source URL. All 20 stores were
recaptured on 2026-10-25; Zora's pages were saved by hand in Chrome ("Webpage, Complete",
asset folders dropped) because its Cloudflare check blocks automated browsers. Decathlon, Lilly, Mr. Bricolage, SOpharmacy, Sport Depot and eBag had no
out-of-stock product page to capture (Decathlon redirects unavailable products),
and Praktiker and dm had no discounted product (dm runs no discounts).
Embedded Mapbox and Google API tokens, session CSRF tokens and subscriber IDs are
redacted from the reference captures.
For the optional Chrome form test, install Playwright or set `PLAYWRIGHT_MODULE`
to an existing installation, then run `node --test tests/widget-browser.cjs`.
`node --test tests/cloud-access.cjs` checks the configured live server without
creating observations; SQL verification uses a rollback-only transaction.
Saved-page tests do not certify live hydration and every variant across all 20 stores.

## Packaging for distribution

When zipping the extension for the Chrome Web Store or sideloading, exclude
these files so they don't ship to users:

- `tests/`, `supabase/`, `node_modules/`, `package*.json` — development and deployment files
- `HTML pages and links/` — saved reference HTML samples used while writing
  the content scripts (tracked development fixtures, not extension runtime assets)
- `AGENTS.md` — development rules
- `icons/promo-small-440x280.png` — Chrome Web Store promo asset, uploaded
  separately via the Developer Dashboard (not part of the extension)
- `CLAUDE.md` — pointer to the shared development rules
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
attempts a best-effort upload of each recorded daily snapshot (product URL, title, EUR price, EAN,
observation date, plus a random pseudonymous device ID) to a Postgres
database hosted on Supabase. The current database-access issue and exact
field list are disclosed in [PRIVACY.md](PRIVACY.md).

No personally identifiable information, payment data, authentication
state, or browsing history outside the 20 supported stores is collected.

See [PRIVACY.md](PRIVACY.md) for the full disclosure, the complete
list of uploaded fields, and how to request data removal.
