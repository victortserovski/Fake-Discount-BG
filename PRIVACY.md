# Privacy Policy — Fake Discount Bulgaria

**Last updated:** 25 October 2026 (version 3.19.0)

## Summary

Fake Discount Bulgaria is a browser extension that shows history-based price
signals on 20 Bulgarian e-commerce sites by recording the prices of products you
visit. **Everything it records stays in your browser's local extension storage.
The extension does not upload, sell or share any data and has no server of its
own.**

Versions 3.15.2 to 3.18.4 also uploaded a pseudonymous copy of each daily product
observation to a developer-controlled database. Version 3.19.0 removed that
upload completely; see [Data uploaded by earlier versions](#data-uploaded-by-earlier-versions).

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
change events for open tabs, but it ignores URLs outside the supported
domains and never stores them.

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

This data is used only to build a price history for each product, to
calculate heuristic deal signals, and to show the price panel on product
pages and the product list in the extension's menu.

Hiding the on-page panel (Settings → "Show the price panel") does **not** stop
local price tracking — it only controls whether the panel is drawn on the
product page.

Turning off a store under **Stores** stops tracking and the panel for that
store only. The change takes effect on the **next page load or in-page
navigation** for that store (Manifest V3 content scripts are injected once per
document lifecycle), not instantly on tabs that are already open.

## Network requests

The extension sends no data anywhere. It has no analytics, no tracking code and
no server. The only network traffic it causes is the browser loading product
thumbnail images, from the stores' own image servers, when you open the
extension's product list — the same images the store pages show.

## What the extension does NOT collect

- **Personally identifiable information** — no name, email, address,
  phone number, account ID or social media handle.
- **Payment or financial information** — no card numbers, bank details,
  invoices or transaction records.
- **Retailer authentication data** — no retailer passwords, cookies, session
  tokens or login state.
- **Browsing history outside the supported sites** — only product pages on the
  20 supported stores are recorded.
- **Page content beyond product details** — no reviews, comments,
  account dashboards, cart contents or order history.
- **Advertising trackers or fingerprinting** — none.

## How to delete your data

- Open the extension's menu → **Data** tab → **"Clear all history"** to remove
  all local product records. Your settings stay.
- **"Cleanup old"** removes products not seen for at least 90 days; any single
  product can also be deleted from its card.
- Uninstalling the extension from `chrome://extensions/` removes all local data.

## Export and import

The extension lets you export locally stored price-history product records as
a JSON file (a manual local backup) and import them later. Settings, price
targets and popup filters are not included. Backup files are created and read
only on your computer, by your own action; the extension never uploads them.

On import, the extension validates that every product URL belongs to one of
the 20 supported store domains. Imported thumbnail URLs are discarded to prevent
untrusted backups from triggering image tracking requests; images refresh on the
next retailer visit. Products with invalid store URLs or without any valid history
row are skipped. Imports are limited to 10 MB. IDs must match the product URL (with an
explicit allowance for legacy SportDepot keys). Valid daily rows are sorted
and duplicate days use the last supplied value. All accepted records and their
index are written in one batch; a rejected quota write leaves existing records
intact. Settings and targets are not changed.

## Permissions explained

- `storage` — to save the price history and your settings locally
- `tabs` — to notice when you move between product pages on stores that
  change pages without reloading (so the panel updates), and to show the
  per-tab badge on the extension icon
- Host access to the 20 supported store domains — to read product prices from
  those pages and show the price panel

## Data uploaded by earlier versions

From version 3.15.2 to 3.18.4 the extension also sent each recorded daily
observation (product URL, title, image URL, EAN, price, claimed original price,
date, extension version, browser user-agent and a random pseudonymous device ID)
to a Postgres database on Supabase operated by the developer. Version 3.19.0
removed this upload. On update it deletes the local upload queue and the
installation secret used to send observations; it keeps only the device ID,
so you can still ask for your earlier observations to be deleted.

To request deletion, email the address below with your device ID. Find it in
Chrome DevTools for the extension under `chrome.storage.local` →
`supabase_identity.deviceId` (and `supabase_device_id`, if present, for very old
versions). Observations cannot be matched to you without that ID.

## Changes to this policy

If the extension changes what it stores or starts sending any data off your
device, this policy will be updated and linked from the Chrome Web Store
listing before the change ships.

## Contact

Questions, complaints or data-removal requests:
**fakediscountbg@gmail.com**
