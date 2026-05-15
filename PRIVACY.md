# Privacy Policy — Fake Discount Bulgaria

**Last updated:** 14 May 2026

## Summary

Fake Discount Bulgaria is a browser extension that detects fake discounts
on 20 Bulgarian e-commerce sites by recording the prices of products you
visit. Most data stays in your browser. **A short, anonymous record of
each product observation is also uploaded to a developer-controlled
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

It does not run on any other site, does not see any other site's content,
and does not have access to your browsing history outside these domains.

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
- A random pseudonymous device ID (UUID v4) used to deduplicate uploads
  from the same installation

This local data is used to build a price history for each product, to
detect whether a displayed discount is genuine, and to render the
price-graph widget on product pages.

## What is uploaded to Supabase

In addition to the local copy, every recorded price observation is sent
to a Postgres database hosted on Supabase, operated by the developer of
this extension. The upload is fire-and-forget and never blocks the local
save or widget render. Each upload contains:

| Field | Example | Purpose |
|---|---|---|
| `device_id` | random UUID v4 | Deduplicate observations from the same install. Not linked to your identity. |
| `product_id` | `emag_DKFWLW3BM` | Extension-internal stable identifier derived from the URL. |
| `site` | `emag` | Which store the observation comes from. |
| `url` | `https://www.emag.bg/...` | The product page URL you visited. |
| `title` | `Smartphone Samsung Galaxy S25 FE` | The product name. |
| `thumbnail` | `https://cdn.emag.bg/...jpg` | The product image URL. |
| `ean` | `8806097540519` | The EAN/GTIN barcode when the page exposes one. |
| `price` | `499.00` | Current displayed EUR price. |
| `original_price` | `599.00` | Seller's claimed "was" price, when shown. |
| `discount` | `17` | Percentage difference between the two. |
| `observed_date` | `2026-05-14` | Date of the observation (local time). |
| `ext_version` | `3.15.2` | Extension version that recorded the observation. |
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

The dataset is not sold, not shared with advertising networks, and not
used for targeted advertising. The developer has access to it for
maintenance and feature development.

## What the extension does NOT collect

- **Personally identifiable information** — no name, email, address,
  phone number, account ID, IP address (beyond what your browser
  unavoidably sends with the upload itself), or social media handle.
- **Payment or financial information** — no card numbers, bank details,
  invoices, or transaction records.
- **Authentication data** — no passwords, cookies, session tokens, or
  login state.
- **Browsing history outside the supported sites** — the extension has
  zero access to URLs or content on any other domain.
- **Page content beyond product details** — no reviews, comments,
  account dashboards, cart contents, or order history.
- **Cross-site tracking** — no analytics SDK, no third-party tags, no
  fingerprinting beyond the random pseudonymous device ID.

## How to delete your data

**Local data:**

- Open the popup → **Data** tab → **"Clear all history"** to wipe every
  product stored on your computer.
- **"Cleanup old"** removes entries older than 90 days.
- Uninstalling the extension from `chrome://extensions/` removes all
  local data.

**Uploaded data:**

Because the upload is keyed only by a random `device_id` that the
extension generates locally, the developer cannot identify which rows
belong to you without you sending the device ID first. To request
removal of uploaded observations from your install, email the contact
address below and include your device ID (find it in your browser's
DevTools console under `chrome.storage.local` → `supabase_device_id`).

## Export and import

The extension lets you export your locally stored data as a JSON file
(a manual local backup) and import it later. These backup files are
created and read only on your computer, by your own action; they are
never uploaded anywhere by the extension.

On import, the extension validates that every product URL belongs to
one of the 20 supported store domains and that thumbnail URLs use
`https://`. Entries that fail these checks are silently dropped to
prevent malicious or corrupted backup files from injecting unsafe
navigation targets or remote-content loads into the popup.

## Permissions explained

- `storage` — to save the price history locally
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
