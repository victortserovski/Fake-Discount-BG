# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project-specific rules

The sections above are general behavioral guidelines. The rules below are specific to this project (Fake Discount BG Chrome extension for 19 Bulgarian e-commerce sites: Emag, Ozone, Notino, Technopolis, Technomarket, Zora, Ardes, Plesio, Aboutyou, Answear, Decathlon, dm-drogeriemarkt, Fashiondays, Lillydrogerie, Mr-bricolage, Obuvki, Praktiker, Sopharmacy, Sportdepot).

## 5. Version bumping (mandatory)

**Always bump `manifest.json:version` after making changes**, before reporting the
work as done. Chrome decides whether an update has shipped by comparing version
strings — if the version stays the same, a reloaded extension won't reflect new code
in some surfaces (icons, popups served from cache, etc.).

Use semver `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.0.1` → `1.0.2`) — small / "minor" changes: bug fixes, copy
  edits, CSS tweaks, refactors. No new user-visible functionality.
- **MINOR** (`1.0.x` → `1.1.0`) — medium changes: new features, new settings,
  noticeable UI additions. Backward-compatible.
- **MAJOR** (`1.x.x` → `2.0.0`) — large changes: breaking storage-shape changes,
  removal of settings, restructured architecture, anything that requires the
  user to re-onboard or re-import data.

When unsure, prefer the smaller bump. If a change set bundles fixes AND a feature,
take the higher bump (one MINOR absorbs any number of patches inside it).

## 6. Project conventions

- **Manifest V3.** Service worker, not background page.
- **i18n is mandatory.** Every user-visible string goes in BOTH `i18n/bg.json`
  AND `i18n/en.json`. Default language is Bulgarian (`bg`). Never hardcode
  user-facing text in JS, HTML, or CSS.
- **No silent destructive operations.** Don't auto-delete user data; only the
  manual "Cleanup old" button in the popup removes products. Storage may grow
  unbounded — that's an explicit trade-off for accurate price history.
- **No history compression.** Full daily price history is preserved indefinitely.
  Don't reintroduce weekly-average compression.
- **Per-product storage keys** (`p_<productId>`) with a separate `product_index`
  array. Don't switch back to a monolithic `priceHistory` blob.
- **DOM-only construction in popup and widget.** Use `createElement` /
  `appendChild`. Never `innerHTML` with product data — XSS risk.
- **Widget event isolation: bubble phase only.** The widget container stops
  propagation of click / mousedown / etc. in the **bubble phase only**. Adding
  a capture-phase listener will swallow events before they reach the widget's
  own input/button — this bug has been here before, don't reintroduce it. See
  the comment around the listener loop in `ui/price-graph-widget.js`.
- **Per-product write queue.** `PriceStorageManager.saveProduct` serializes
  writes per key via `_writeQueue`. Don't bypass it — concurrent saves to the
  same product can race.
- **Notino price source: visible DOM, not JSON-LD.** Notino's `application/
  ld+json` Product block frequently contains the *promo-code-applied* price
  (e.g. with the "COMBI" code), not what a regular visitor pays. Always read
  the displayed price from `[data-testid="pd-dual-price"]` (parse the first
  EUR amount). JSON-LD is fine for title, brand, image, sku — just not price.
- **Ozone `.old-price` is ПЦД (RRP), NOT a "was-price" — skip it for
  `originalPrice`.** Ozone wraps the manufacturer's recommended retail price
  inside `<p class="old-price"><span class="price-label">ПЦД:</span>…</p>`.
  The user never paid that amount; it's the manufacturer's reference. Reading
  it as `originalPrice` triggered spurious FAKE_DISCOUNT verdicts on products
  that had never sold above the displayed price (the verdict compared against
  a manufacturer claim, not seller history). `content/ozone.js` rejects any
  `.old-price` wrapper whose `textContent` contains the literal "ПЦД" before
  parsing the price — see the loop guard around `oldPriceSelectors`. If Ozone
  ever ships a genuine struck-through previous price WITHOUT the ПЦД label,
  the loop will still capture it. Do not "simplify" by removing the guard.
- **Out-of-stock products: return `price: null` from `extractProductData`.**
  When a page indicates the product is unavailable, the adapter must set
  `price = null` so `ContentScriptBase.trackAndDisplay` short-circuits into
  the empty-history branch instead of recording a phantom datapoint at a
  price no one can actually buy at. Why this matters: a stale "last list
  price" recorded as today's value understates `thirtyDayLow` and inflates
  the verdict's apparent maximum, which then misfires REAL_DEAL or
  FAKE_DISCOUNT verdicts the moment the product is back in stock. Adapters
  detect OOS via the cheapest reliable signal per site:
    - **Notino** — JSON-LD `offers.availability === "OutOfStock"` (matched
      to the variant URL when offers is an array).
    - **Ozone** — DOM `<p class="availability out-of-stock">` (the visible
      "Изчерпан" indicator). JSON-LD `availability: "OutOfStock"` is also
      present and could be a fallback if the DOM marker ever changes.
    - **Emag** — DOM `<span class="label label-out_of_stock">Изчерпана
      наличност</span>`. JSON-LD `availability: "http://schema.org/
      OutOfStock"` is also present (fallback if Emag retires the label
      class).
    - **Technopolis** — TWO guards, both required:
      1. JSON-LD `offers.availability === "OutOfStock"` (catches "no
         stock anywhere" case).
      2. DOM `<span class="status not-available">` ("Продуктът е изчерпан
         онлайн" — catches "online OOS but available in physical stores"
         case where JSON-LD still says `InStock` because the product IS
         stocked somewhere). From the extension's perspective the user
         still can't online-purchase at the displayed price, so we treat
         online-only OOS the same as full OOS.
  Existing history is preserved (we just skip today's entry); the widget
  renders empty stats per `trackAndDisplay`'s no-price branch.
- **EAN/GTIN extraction is generic, not per-site.** `ProductParser.extractEAN`
  in `content/product-parser.js` runs four tiers (JSON-LD → meta → microdata
  → visible-text scan) and works for every site. New site integrations should
  call it as-is; do not duplicate the logic. Every candidate is run through
  `ProductParser.validateGTIN` (check-digit verifier) so phone numbers and
  internal product IDs that look like barcodes are rejected.
- **No `mailto:` links.** On systems without a configured desktop mail client
  the link opens an empty Chrome tab — worse UX than no link. The contact
  email in the popup About section is plain text inside a `<span class=
  "email-text">` styled with `user-select: all`, so a single click selects
  the whole address for manual copy. Don't reintroduce the mailto link.
- **Imported URLs are validated against `SUPPORTED_HOSTS`.** Both
  `background/service-worker.js` (`isSupportedProductUrl` /
  `isSafeThumbnailUrl` in the import sanitizer) and `popup/popup.js`
  (re-check before `chrome.tabs.create`) gate navigation/thumbnail-load
  to the 20 store domains and https://-only schemes. A crafted backup
  file with `product.url: "javascript:..."` or
  `product.url: "https://evil.com/phishing"` would otherwise navigate
  the user there on a popup card click. Both copies of the host list
  must stay in sync when sites are added/removed — there's no shared
  module between the background script and the popup.
- **Single source of truth for the version.** Read `chrome.runtime.getManifest()
  .version` once at popup load (constant `VERSION` in `popup/popup.js`) and
  inject it into every visible mention. Don't hard-code version strings in
  HTML, CSS, or JS — bumping `manifest.json:version` must be the only change
  needed to update the displayed version everywhere.
- **Popup filter persistence: chips + sort, NOT search.** Site-filter chips
  and sort mode are saved to `chrome.storage.local.popupFilters` and restored
  on popup open. The search query is intentionally transient — restoring a
  stale typed query would hide most products on reopen and confuse the user.
- **Price selectors must be scoped to the main product container AND the
  cascade must reject upsell-rail matches at every step.** Magento storefronts
  (Ozone, Technopolis) render upsell rails after the main product in DOM
  order, so an unscoped `[id^="product-price-"]` / `.price-box .price` /
  `.special-price .price` can return the FIRST upsell's price when the
  scoped selectors miss (A/B variant, partial render, layout change).
  Always lead with `.product-essential` / `#product_addtocart_form` /
  `.product-info-main` / `.product-view-main` scoped variants before
  falling through to generic ones, AND iterate `querySelectorAll` per
  selector while skipping any element where `el.closest('.upsell-products,
  .upsell, .related-products, .crosssell, .cross-sell, [id*="upsell"]')`
  is truthy. See `content/ozone.js` (search "UPSELL_BLOCK_SELECTOR") and
  `content/technopolis.js:55-75` for the pattern. Bug history:
  `/product/ps5-reanimal/` recorded 30.00 EUR (first upsell's whole-unit
  id-based price) while the page showed 29.99 EUR — fixed by adding
  scoped selectors. THEN `/product/xtrike-gm-515/` recorded 99.99 EUR
  (first upsell's `.special-price .price`) on 2026-05-08/09 even with
  scoped selectors in place, because Ozone temporarily rendered without
  `.product-essential` on the main product wrapper, causing the cascade
  to fall through to unscoped phase-2 selectors that picked up the
  upsell. Don't remove the upsell-`closest` guard — it's the last line
  of defence when scope classes change underfoot.
- **Date keys use LOCAL time, not UTC.** `PriceStorageManager.getTodayDate()`
  builds the YYYY-MM-DD key from `Date.getFullYear/getMonth/getDate`, NOT
  `toISOString().split('T')[0]`. The UTC version silently overwrote yesterday's
  price entry for users in UTC+N timezones (e.g. Sofia +03 EEST) during visits
  between local midnight and 02:59, because UTC was still on the previous day.
  Don't reintroduce the UTC version.
- **Supabase cloud sync is ENABLED in the public build.** `utils/supabase-sync.js`
  ships with populated `SUPABASE_URL` and `SUPABASE_ANON_KEY` constants — every
  recorded observation is uploaded to a developer-controlled Postgres
  `price_history` table. This is a deliberate product decision: the dataset
  powers cross-install price aggregation. PRIVACY.md and the README privacy
  section disclose exactly what is uploaded (product URL, title, thumbnail,
  EAN, price, original_price, discount, observed_date, ext_version,
  user_agent, plus a random pseudonymous `device_id`). When updating these
  fields, keep PRIVACY.md in sync — that file is linked from the Chrome
  Web Store listing and must describe what the build actually does. Local
  `chrome.storage` remains the source of truth; network errors must NEVER
  block the local save or the widget render. The push is fire-and-forget
  from `background/service-worker.js` `handleProductTracking`. Forks that
  want a local-only build should blank both constants AND remove the
  Supabase host from `manifest.json` `host_permissions`.
- **Supabase upsert needs BOTH the `?on_conflict=...` query param AND the
  `Prefer: resolution=merge-duplicates` header.** The header alone defaults
  the conflict target to the primary key (`id`, a bigserial that never
  conflicts), which makes PostgREST do a plain INSERT that then bounces off
  the real unique index with HTTP 409 / `23505`. Always pair the header with
  `?on_conflict=device_id,product_id,observed_date` in the URL — see the
  fetch in `utils/supabase-sync.js` for the canonical form. Related trap:
  Supabase's "violates row-level security policy" error (42501) covers BOTH
  "policy denied" and "no policy exists for this operation type at all" —
  during upsert setup you need INSERT, UPDATE, *and* SELECT policies +
  grants for `anon`, even though the operation looks INSERT-only on the
  surface. Tables created via the SQL Editor (vs the Table Editor UI) do
  NOT auto-grant privileges to `anon`/`authenticated` — explicit `grant`
  statements are required.
- **Verdict reason strings include `{observations}` and `{days}` placeholders.**
  `background/price-tracker.js` computes both from `history` (count and
  span-from-first-observation in days) and passes them in `reasonParams` for
  every verdict that makes a window-relative claim (`priceHigherThanMax`,
  `priceHigherThan30DayLow`, `atAllTimeLow`, `belowAverage`, `stablePrice`,
  `volatilePrice`). This exists because saying "above the all-time historical
  maximum" lied about how much data we actually had — a 22-day flat history
  with one inflated ПЦД would still trigger FAKE_DISCOUNT and read like an
  authoritative claim. Keeping these placeholders in the i18n strings keeps
  the verdict honest about its evidence base. New reasons that compare
  against history-derived stats SHOULD include both placeholders; reasons
  that don't (`insufficientData`, `legitimateDiscount`) don't need them.
- **Verdict cascade in `detectFakeDiscount` is order-sensitive — don't
  reorder casually.** The order is: FAKE_DISCOUNT (claimed-original > 1.2×
  all-time-high) → FAKE_DISCOUNT (current > 1.1× 30-day-low) → REAL_DEAL
  (current ≤ 1.05× all-time-low) → VOLATILE_PRICE (30-day range ≥ 8% of avg)
  → STABLE_PRICE (current within 10% of avg AND range < 8%) → REAL_DEAL
  (current < 0.9× avg, only when no claimed-original) → TRACKING (default).
  REAL_DEAL beats VOLATILE intentionally — "near all-time low" is a more
  actionable buy-now signal than "prices bounce around." VOLATILE beats
  STABLE intentionally — STABLE used to fire on wide-range histories whose
  current price happened to be near the mean, which read as a lie. New
  verdicts MUST slot in carefully; check both what they preempt and what
  they get preempted by.
- **Technopolis is JSON-LD-driven, not Magento DOM.** Despite the URL pattern
  looking Magento-ish (`/p/<sku>`), Technopolis is an Angular SPA with
  `_ngcontent-*` attribute scoping and a clean `schema.org` Product JSON-LD
  block. The adapter (`content/technopolis.js`) reads price/title/image/sku
  from JSON-LD, with `.product-pdp__prices .price-value` (visible DOM) as
  a fallback before the JSON-LD is hydrated. Don't try to copy ozone.js's
  Magento selector list — `.price-box`, `[data-price-type="finalPrice"]`,
  `.product-essential` etc. don't exist on Technopolis pages. Same Notino
  pattern (visible-DOM-trumps-JSON-LD) does NOT apply: Technopolis's
  `offers.price` matches the displayed price exactly, no promo-code
  inflation, so JSON-LD is the trusted primary source.
- **Technomarket JSON-LD price is BGN, NOT EUR — read EUR from visible DOM.**
  Technomarket's JSON-LD Product block has `"priceCurrency":"BGN"` (the
  whole-leva BGN amount), so it is unsuitable as the price source. Read EUR
  from `.price-wrapper > .price > tm-price > span.bgn.eu` — yes, the EUR
  span has class **"bgn eu"** (`bgn` is a generic price-block class on this
  site, `eu` is the modifier flagging it as the euro variant). The integer
  / fractional / currency parts are split into child `.primary` /
  `.secondary` / `.currency` spans; just read the wrapper's `textContent`
  and pass it to `ProductParser.parsePrice`. JSON-LD is still the right
  source for title / image / brand / sku / description on this site.
- **Technomarket `.old-price` is ПЦ (manufacturer RRP), NOT a "was-price" —
  skip it for `originalPrice`.** Same trap as Ozone's ПЦД. Technomarket
  wraps the manufacturer-recommended price inside
  `<span class="old-price"><tm-tooltip data-tooltip="ПЦ - Препоръчителна цена…">ПЦ:…</tm-tooltip></span>`.
  `content/technomarket.js` rejects any `.old-price` whose `textContent`
  contains the literal "ПЦ" before parsing the price. The user has confirmed
  Technomarket has no real crossed-out / discount-labelled prices today; if
  one ever ships WITHOUT the ПЦ label, the guard will still capture it. Do
  not "simplify" by removing the guard.
- **Ardes has TWO pricing tiers; only `.common-price` is the online price.**
  Inside `#buying-info`, Ardes renders `.real-price` (in-store reference,
  prefixed by a `<span class="in-store">цена в магазин:</span>` label) and
  `.common-price` (the actual online price the user pays — what we want).
  Always read `.common-price .eur-price .price-tag` plus its
  `.after-decimal` sibling and concat → `parsePrice`. The was-price for
  discounted items is the same `.real-price` slot reused, but flagged with
  `.strike-horizontal.original-price` and an empty `.in-store` label. So:
  `originalPrice` source is `.real-price .strike-horizontal.original-price`
  ONLY — the strike class is the proof it's a real previous selling price,
  not the in-store reference. (The in-store reference uses
  `.full-price.original-price` WITHOUT the strike class.) Never accept the
  in-store reference as `originalPrice` — see `content/ardes.js`.
- **Ardes "По заявка" availability is treated as OOS, per user.** It's
  technically "by special order" (~60-day lead time, possibly requires a
  deposit), not literal out-of-stock, but the user can't actually purchase
  at the displayed price right now. The adapter sets `price = null` when
  `.availability-check strong` text contains `По заявка`, so
  `trackAndDisplay` short-circuits to the empty-history branch and we don't
  record a phantom datapoint.
- **Plesio has TWO pricing rows on "WEB ONLY" products; use only
  `.productPricingRow.productPrices`.** That row is the online ("Интернет
  Цена") price — always present, always what we want. The companion row
  `.productPricingRow.storesPrice` (only shown when in-store and online
  prices differ, marked by a `.badgesWrap.IsWebOffer` "web only" badge) is
  the in-store ("Цена в магазина") reference; the user can't pay this
  online. Within the productPrices row, the EUR amount is the first
  `€`-suffixed token (BGN follows after a `/` or `|` separator). Read it
  via a regex on `textContent`, not a child selector — both observed
  layouts (`.productPriceElement` divs vs single `.price-container-element row`)
  put the value in plain text.
- **Plesio OOS via the hidden `.ptto-availability` tracker div.** Plesio
  emits a hidden SEO/feed-export tracking div whose content is `1` when
  the product is purchasable online and `0` otherwise. The HTML literally
  documents this with a `<!-- 1 if available, 0 if unavailable -->`
  comment. The adapter checks `.ptto-availability` textContent === `0` and
  sets `price = null` accordingly. Don't replace it with the visible
  add-to-cart absence check — Plesio renders a "Notify me" button in the
  same slot and we'd misread that as in-stock.
- **Plesio `og:image` has a server-side concat bug.** It produces strings
  like `http://www.plesio.bghttps://plesioimages.fra1.cdn.digitaloceanspaces.com/…`.
  The adapter strips the bogus `http://www.plesio.bg` prefix when followed
  by another `http(s)://`. Prefer the in-page gallery `<img>` src first;
  fall back to the cleaned `og:image` only if no gallery image is present.
- **Zora price is `<meta itemprop="price">` (server-rendered EUR), NOT the
  visible `.price-new-js` spans.** Zora runs on CloudCart; the visible
  price spans are empty until a jQuery `load`-handler hydrates them. The
  microdata `<meta itemprop="price">` + `<meta itemprop="priceCurrency"
  content="EUR">` ARE server-rendered and reliable — that's the primary
  price source. Read the visible-DOM `.price-old-js` only AFTER hydration
  for the optional was-price; the placeholder is `<i>0.00</i>` on
  full-price products, so accept only when value > 0 AND > current price.
  OOS is signalled by `<link itemprop="availability" href=".../OutOfStock">`
  microdata ONLY — `<span class="_product-out-of-stock">` is a hidden
  template present on every product page (parent `out-of-stock-js hide`)
  and JS toggles `hide` per variant; treating its mere DOM presence as
  OOS made every Zora product return `price=null`.
- **Sopharmacy JSON-LD price is BGN, NOT EUR — read EUR from
  `.price--euro` family.** Same currency trap as Technomarket. Sopharmacy
  is a pharmacy storefront on Hybris/SAP Commerce; the JSON-LD `offers.price`
  is the BGN amount with `priceCurrency: BGN`. Read EUR via
  `.price.price--discount.price--euro` (sale variant) → `.price.price--euro`
  (regular variant). Old/struck price uses `.price--old.price--euro`.
- **Praktiker JSON-LD `availability` is unreliable for OOS — also check
  the visible "Провери наличност" CTA.** Praktiker reports
  `availability: InStock` even on online-OOS items where the buy button
  has been swapped for a "check in stores" link. The adapter walks
  buttons/links looking for visible text matching `^Провери\s*наличност`
  and treats that as OOS (sets `price=null`).
- **Ardes "Marketplace seller" = JSON-LD InStock + buy button hidden,
  same as Praktiker.** Same DOM-text-check pattern applies if the
  built-in OOS guard ever fails.
- **About You and Answear are React SPAs — wait long, prefer data-testid
  hooks over hashed CSS classes.** Both ship with Webpack-hashed class
  names (e.g., `ProductCardStylesProvider__priceRegularMinimalLabel__Ta4Ri`)
  that change between builds. Prefer stable hooks: About You uses
  `[data-testid="finalPrice"]` / `[data-testid="originalPrice"]`;
  Answear uses `[data-test*="priceSale"]` / `[data-test*="priceRegular"]`
  but several pages have only the hashed classes — fall back to a
  textContent EUR scan within `[class*="ProductCardStyles"]`. Both need
  ~1500-2000ms post-load hydration delay.
- **dm-drogeriemarkt is a heavy SPA — saved-page samples are 10KB
  empty shells.** All product data renders client-side. The adapter
  waits 2.5s for hydration, prefers `meta[itemprop="price"]` (often
  emitted post-mount), then falls back to scanning visible "X,XX €"
  tokens inside `[data-dmid="product-detail"]` / `[class*="ProductDetail"]`.
  This is a best-effort adapter; if it breaks on a real product page,
  capture the live HTML and tighten the selectors.
- **Obuvki EAN comes from the URL slug.** Product URLs always end in
  the trailing 13-digit GTIN-13, e.g.
  `/p/snikrsi-guess-jeans-cwbeo-deland-02-we-ekriu-5906751997154`.
  The adapter extracts and validates it via `ProductParser.validateGTIN`
  before falling back to the generic `extractEAN()`. Don't strip the
  EAN-13 from the productId — it's also the canonical ID for the listing.
- **Fashion Days `.cmmp30-price` is the EU 30-day reference, NOT a
  was-price.** Same trap as Ozone's ПЦД and Technomarket's ПЦ. Read
  the actual struck-through previous selling price from `.rrp-price`
  / `.old-price__value` instead. The 30-day reference is a regulatory
  display required by the Omnibus Directive — useful for users to
  see, useless as a "was X" comparison.

## 7. Before declaring work done

1. Bump `manifest.json:version` per the rules above.
2. Sanity-check syntax on every modified file:
   - `node --check <path>` for `.js` files
   - `python -m json.tool <path> > /dev/null` for `.json` files
3. If content scripts were modified, the user must reload the extension at
   `chrome://extensions/` to see changes — mention it in the summary.
4. **Cross-check the docs.** After every code change ask: did this change
   anything that `CLAUDE.md` or `README.md` describes? Specifically:
   - Was a user-facing feature added, removed, or renamed? → README *Features*
     section + relevant subsection (Popup / Settings / Storage / etc.)
   - Was a new project-wide convention established, or did a non-obvious
     gotcha bite us that a future agent would also hit? → CLAUDE.md §6
     *Project conventions* (add a new bullet)
   - Was a file added/removed under `content/`, `popup/`, `ui/`, etc.? →
     CLAUDE.md §8 *Where things live*
   - Was a new permission, command, or manifest section added? → README
     *Settings* / *Popup* and CLAUDE.md if it implies a new convention
   Surgical edits only — touch the affected lines, nothing else. Docs
   drift silently otherwise; this checklist exists because it has happened
   multiple times.

## 8. Where things live

- `manifest.json` — extension config, permissions, version
- `background/service-worker.js` — message router, badge management
- `background/price-tracker.js` — `detectFakeDiscount()` verdict logic
- `utils/storage.js` — `PriceStorageManager` (per-product keys, write queue)
- `utils/supabase-sync.js` — opt-in best-effort cloud sync (disabled until
  `SUPABASE_URL` + `SUPABASE_ANON_KEY` are filled in; see §6 convention)
- `content/{emag,ozone,notino,technopolis,technomarket,zora,ardes,plesio,aboutyou,answear,decathlon,dm,fashiondays,lilly,bricolage,obuvki,praktiker,sopharmacy,sportdepot}.js` — site-specific price extraction + widget injection
- `content/content-base.js` — shared SPA navigation listener, widget loader
- `content/product-parser.js` — `ProductParser` (URL → ID, price text → number)
- `ui/price-graph-widget.js` — `FakeDiscountWidget.init()` and target-price logic
- `ui/advanced-chart.js` — SVG chart with avg + target lines
- `popup/` — tabbed UI (Products / Settings / Data) with search, multi-site
  filter chips, sort dropdown, persistent footer, and a "↗" link that
  re-opens the popup as a full Chrome tab via `?fullview=1`
- `i18n/{bg,en}.json` — translations (keep keys in sync between files)
