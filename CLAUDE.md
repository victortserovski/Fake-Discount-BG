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

The sections above are general behavioral guidelines. The rules below are specific to this project (Fake Discount BG Chrome extension for Emag.bg / Ozone.bg).

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

## 7. Before declaring work done

1. Bump `manifest.json:version` per the rules above.
2. Sanity-check syntax on every modified file:
   - `node --check <path>` for `.js` files
   - `python -m json.tool <path> > /dev/null` for `.json` files
3. If content scripts were modified, the user must reload the extension at
   `chrome://extensions/` to see changes — mention it in the summary.

## 8. Where things live

- `manifest.json` — extension config, permissions, version
- `background/service-worker.js` — message router, badge management
- `background/price-tracker.js` — `detectFakeDiscount()` verdict logic
- `utils/storage.js` — `PriceStorageManager` (per-product keys, write queue)
- `content/{emag,ozone}.js` — site-specific price extraction + widget injection
- `content/content-base.js` — shared SPA navigation listener, widget loader
- `content/product-parser.js` — `ProductParser` (URL → ID, price text → number)
- `ui/price-graph-widget.js` — `FakeDiscountWidget.init()` and target-price logic
- `ui/advanced-chart.js` — SVG chart with avg + target lines
- `popup/` — settings UI, followed-products list
- `i18n/{bg,en}.json` — translations (keep keys in sync between files)
