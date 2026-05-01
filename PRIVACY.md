# Privacy Policy — Fake Discount BG

**Last updated:** 2 May 2026

## Summary

Fake Discount BG is a browser extension that detects fake discounts on
Emag.bg and Ozone.bg by recording the prices of products you visit.
**All data stays on your computer.** Nothing is sent to any server,
no analytics are collected, and no third parties receive any information.

## What the extension stores

When you visit a product page on Emag.bg or Ozone.bg, the extension stores
the following in your browser's local extension storage
(`chrome.storage.local`):

- The product URL and product ID
- The product title
- The current price (and the seller's claimed "original price", if shown)
- The date and time of the visit
- Optional: a price target you set manually
- Your settings (language, per-site toggles, chart visibility)

This data is used solely to build a price history for each product and to
detect whether a displayed discount is genuine.

## What the extension does NOT do

- It does **not** transmit any data to the developer or any third party
- It does **not** use analytics, tracking pixels, or telemetry
- It does **not** create a user account or require a login
- It does **not** read pages outside Emag.bg and Ozone.bg
- It does **not** access cookies, passwords, browsing history, or any
  data from other websites

## How to delete your data

Open the extension popup and click **"Clear all history"** to erase
every stored product. You can also use **"Cleanup old"** to remove
entries older than 90 days, or remove the extension entirely from
`chrome://extensions/` — uninstalling deletes all stored data.

## Export and import

The extension lets you export your stored data as a JSON file (a manual
local backup) and import it later. These files are created and read only
on your computer, by your own action; they are never uploaded anywhere
by the extension.

## Permissions explained

- `storage` — to save the price history locally
- `activeTab` — to set the toolbar badge for the page you are viewing
- `tabs` — to detect when you navigate between product pages on
  single-page-app sites
- Host access to `emag.bg` and `ozone.bg` — to read product prices from
  those pages and display the price-history chart

## Changes to this policy

If the extension ever starts collecting or transmitting data differently
(for example, optional cloud sync), this policy will be updated and the
new version will be linked from the Chrome Web Store listing before the
change ships.

## Contact

Questions or concerns: **fakediscountbg@gmail.com**
