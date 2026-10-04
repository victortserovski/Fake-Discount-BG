# Privacy Policy — Fake Discount Bulgaria

**Last updated:** 6 September 2026

## Summary

Fake Discount Bulgaria is a browser extension that shows history-based price
signals on 20 Bulgarian e-commerce sites by recording the prices of products you
visit. Local history remains the source used by the extension, and **a
pseudonymous copy of each recorded daily product observation is uploaded to a developer-controlled
Postgres database (Supabase)** so the extension can build a shared
price-history dataset across all installs.

This page describes exactly what is stored locally, what is uploaded,
and what is **not** collected.

## Supported sites

The extension only runs on these 20 Bulgarian e-commerce domains:

`Emag.bg`, `Ozone.bg`, `Notino.bg`, `Technopolis.bg`, `Technomarket.bg`,
`Zora.bg`, `Ardes.bg`, `Plesio.bg`, `Aboutyou.bg`, `Answear.bg`,
`Decathlon.bg`, `dm-drogeriemarkt.bg`, `Fashiondays.bg`,
`Lillydrogerie.bg`, `Mr-bricolage.bg`, `Obuvki.bg`, `Praktiker.bg`,
`Sopharmacy.bg`, `Sportdepot.bg`, `eBag.bg`.

It does not run on any other site and does not read any other site's page
content. Because the extension uses Chrome's `tabs` permission for
single-page-app navigation refreshes, the service worker may receive URL
change events for open tabs, but it does not store or upload URLs outside
the supported domains.

## What is stored locally (in your browser)

When you visit a product page on one of the supported sites, the
extension stores the following in your browser's local extension storage
(`chrome.storage.local`). This data stays on your computer:

- The product URL and an extension-internal product ID
- The product title
- The thumbnail image URL
- The product's EAN/GTIN barcode when the page exposes one
- The current price (and the seller's claimed "original price", if shown)
- The date of each visit (one observation per day, per product)
- Optional: a price target you set manually
- Your settings (language, per-site toggles, chart visibility,
  popup filter chips, sort preference)
- A pseudonymous device ID derived from a random installation secret, used to
  authenticate and deduplicate uploads from that installation. The secret stays
  in extension storage and is sent over HTTPS to the ingestion endpoint; it is
  not stored in the price-history table

Hiding the on-page chart (Settings → "Show chart on product pages") does
**not** stop local price tracking or Supabase uploads — it only controls
whether the widget is drawn on the product page.

Turning off **Track prices on** a specific store stops tracking, widget
injection, and cloud uploads for that store only. Other enabled stores
continue to record and upload as usual. The change takes effect on the
**next page load or in-page navigation** for that store (Manifest V3
content scripts are injected once per document lifecycle), not instantly
on tabs that are already open when you flip the toggle.

This local data is used to build a price history for each product, to
calculate heuristic deal signals, and to render the
price-graph widget on product pages.

## What is uploaded to Supabase

In addition to the local copy, the extension attempts a best-effort upload of
each recorded daily price snapshot to a Postgres database hosted on Supabase,
operated by the developer of this extension. Network requests never block the
local save or widget render. Pending snapshots are stored locally per product/day
and retried every five minutes, including after the worker restarts. A newer visit
replaces that day's pending snapshot. Acknowledged queue entries are removed;
price history is preserved. Storage failure or termination before enqueue can
still leave an observation missing remotely. Each upload contains:

| Field | Example | Purpose |
|---|---|---|
| `device_id` | UUID derived from an installation secret | Deduplicate observations from the same install. Not linked to your identity. |
| `product_id` | `emag_DKFWLW3BM` | Extension-internal identifier derived from the URL. |
| `site` | `emag` | Which store the observation comes from. |
| `url` | `https://www.emag.bg/...` | The product URL with query parameters and fragments removed. Earlier uploads may contain the full visited URL. |
| `title` | `Smartphone Samsung Galaxy S25 FE` | The product name. |
| `thumbnail` | `https://cdn.emag.bg/...jpg` | The product image URL. |
| `ean` | `8806097540519` | The EAN/GTIN barcode when the page exposes one. |
| `price` | `499.00` | Current displayed EUR price. |
| `original_price` | `599.00` | Seller's claimed "was" price, when shown. |
| `discount` | `17` | Percentage difference between the two. |
| `observed_date` | `2026-05-14` | Date of the observation (local time). |
| `observed_at` | server timestamp | Supabase/Postgres timestamp for when the upload was received. |
| `client_observed_at` | observation timestamp | Prevents an older request replacing a newer same-day value. |
| `ext_version` | current manifest version | Extension version that recorded the observation. |
| `user_agent` | full browser UA string | Browser/OS identification, for debugging extraction issues. |

The upload is keyed by `(device_id, product_id, observed_date)` — only
one record per product per device per day is kept, so repeated visits
within the same day don't bloat the dataset.

## How the uploaded data is used

The dataset is used by the developer to:

- Verify that the extension's verdict logic produces consistent results
  across the user base.
- Detect store-side changes (new HTML layouts, removed price markup,
  currency mix-ups) that break extraction on individual installs.
- Aggregate observed prices for future features such as cross-install
  price-history sharing or community-wide fake-discount detection.

The developer does not sell the dataset, provide it to advertising networks,
or use it for targeted advertising. The client uses a write-only ingestion RPC.
Its server setup revokes direct table access and derives each device ID from
the installation secret, preventing callers from choosing another device ID.

Direct public table access is revoked on the configured server. Anonymous REST
reads are denied; the ingestion function accepts validated observations only
under the installation identity derived from the supplied secret. New deployments
must apply `supabase/ingestion.sql` and verify the resulting permissions.
Earlier uploads may have been publicly accessible; access restrictions cannot
undo any prior disclosure.

Uploaded rows currently have no automatic expiration and are retained until
the developer removes them or the database policy changes.

There is **no in-extension toggle** to disable cloud uploads in the
public build. Forks can blank the Supabase constants in
`utils/supabase-sync.js` for a local-only build.

## What the extension does NOT collect

- **Personally identifiable information** — no name, email, address,
  phone number, account ID, or social media handle is written by the
  extension. Supabase receives normal request metadata such as IP address
  as part of hosting the upload endpoint, but the extension does not store
  IP addresses in the `price_history` table.
- **Payment or financial information** — no card numbers, bank details,
  invoices, or transaction records.
- **Retailer authentication data** — no retailer passwords, cookies, session
  tokens, or login state. The extension uses its own installation secret for
  upload authorization, as described above.
- **Browsing history outside the supported sites** — product observations
  are recorded and uploaded only for supported store pages. URL-change
  events outside the supported domains may be visible to the service worker
  through the `tabs` permission, but they are discarded and never stored or
  uploaded.
- **Page content beyond product details** — no reviews, comments,
  account dashboards, cart contents, or order history.
- **Advertising trackers or active fingerprinting** — there is no analytics
  SDK or third-party advertising tag. However, the same random pseudonymous
  device ID is used for observations across all enabled supported stores, so
  those retailer visits are linkable to one extension installation. Uploaded
  rows also include the full user-agent string listed above.

## How to delete your data

**Local data:**

- Open the popup → **Data** tab → **"Clear all history"** to remove all local
  product records, including orphaned keys. Other preferences and the upload
  identity remain. Supported pages visited afterward can record new history.
- **"Cleanup old"** removes whole products not seen for at least 90 days.
- Uninstalling the extension from `chrome://extensions/` removes all
  local data.

**Uploaded data:**

Because the upload is keyed only by a random `device_id` that the
extension generates locally, the developer cannot identify which rows
belong to you without you sending the device ID first. To request
removal of uploaded observations from your install, email the contact
address below and include your device ID (find it in your browser's
DevTools under `chrome.storage.local` → `supabase_identity.deviceId`).
For observations made by older builds, also include `supabase_device_id` when
present. Never share `supabase_identity.secret`. Concurrent initialization is
serialized in this build. Old uploads made under an ID lost by a previous build
cannot be reconstructed from the retained ID alone.

## Export and import

The extension lets you export locally stored price-history product records as
a JSON file (a manual local backup) and import them later. Settings, price
targets, popup filters, and the Supabase device ID are not included. These backup files are
created and read only on your computer, by your own action; they are
never uploaded anywhere by the extension.

On import, the extension validates that every product URL belongs to one of
the 20 supported store domains. Imported thumbnail URLs are discarded to prevent
untrusted backups from triggering image tracking requests. Images refresh on the
next retailer visit. Products with invalid store URLs or without any valid history
row are skipped. Imports are limited to 10 MB. IDs must match the product URL (with an
explicit allowance for legacy SportDepot keys). Valid daily rows are sorted
and duplicate days use the last supplied value. All accepted records and their
index are written in one batch; a rejected quota write leaves existing records
intact. Settings, targets, and upload credentials are not changed.

## Permissions explained

- `storage` — to save the price history locally
- `alarms` — to retry locally queued uploads every five minutes; it does not poll retailer pages
- `tabs` — to detect when you navigate between product pages on
  single-page-app sites (so the chart updates without a hard reload)
- Host access to the 20 supported store domains — to read product
  prices from those pages and inject the price-history chart
- Host access to `gdfsqujcjqktjhhgkxbs.supabase.co` — to upload each
  price observation to the developer's database

## Changes to this policy

If the extension changes what is collected, what is uploaded, or how
either is used, this policy will be updated and the new version will be
linked from the Chrome Web Store listing before the change ships.

## Contact

Questions, complaints, or data-removal requests:
**fakediscountbg@gmail.com**
