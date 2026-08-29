# Session Handoff — Home Screen Extraction, Custom Extraction & Quick Enrichment End-to-End Fix

**Date:** 2026-08-29  
**Branch:** `main` (in sync with `staging` and `origin/main` / `origin/staging`)  
**Commit:** `459b717`  
**Status:** All test suites green (4,487 vitest tests passed, 130 Playwright smoke tests passed, DB migrations verified, build + prerender synced).

---

## 1. Problem Addressed
When a user on the Home screen selected a Quick Enrichment (preset chip like Pricing, Contacts, Mission, Social), custom prompt, or AI Content generation format:
1. `ExtractionProvider.extract()` was ignoring `options.generateContent` during single URL extractions.
2. `HeroComposer.jsx` resolved preset chips to generic `{ key: "custom", label: "Custom extraction", icon: "code" }` metadata instead of preserving capability-specific keys (`contacts`, `pricing`, `social`, `mission`, `leadership`), causing buttons on `/preview` not to match and tabs to mislabel.
3. Raw text extractions with a `customPrompt` were not receiving `custom_extraction` output from `buildStructureFromText()`.
4. `Preview.jsx` initialized `activeTab` strictly to `"overview"`, hiding the extracted custom data / enrichment / content behind the default headings/links tab on first load.
5. Opening saved extractions from Dashboard did not default to the active/first enrichment tab.

---

## 2. Changes Made

### `src/lib/extractionPresets.js` & `src/lib/extractionPresets.test.js`
- Exported `enrichMetaForIntent(intent, customPrompt)` to map intent and prompt text/label to corresponding `QUICK_ACTIONS` capability metadata (`contacts`, `pricing`, `social`, `mission`, `leadership`, `custom`).
- Added comprehensive unit test suite covering prompt matching, label matching, intent fallback, and custom prompt fallbacks.

### `src/components/HeroComposer.jsx` & `src/components/HeroComposer.integration.test.jsx`
- Updated `runAction()` to resolve `enrichMetaForIntent(intent, prompt)` and pass `opts.enrichMeta` and `opts.generateContent` for both single URLs and raw text paste extractions.
- Added integration tests verifying prompt and `enrichMeta` forwarding.

### `src/lib/firecrawlService.js`
- Added `mockCustomExtraction(pseudoUrl, options.customPrompt)` in `buildStructureFromText` and forwarded `options.customPrompt` from `extractStructure(url, options)`.

### `src/components/ExtractionProvider.jsx` & `src/components/ExtractionProvider.integration.test.jsx`
- In `extract()`, concurrently ran `generateContent()` when `options.generateContent` was requested.
- Attached generated content into `result.enrichments[format.key]` with `{ kind: "content", data: { text } }` and saved to `localStorage` + Supabase.
- Set `result.activeTab = options.enrichMeta?.key || options.generateContent?.key`.
- In `view(item)`, set `activeTab` to `item.activeTab` or the first enrichment key if enrichments exist.
- Added integration tests verifying `extract()` with `enrichMeta` and `generateContent`.

### `src/pages/Preview.jsx`
- Initialized and synchronized `activeTab` state to `current.activeTab` or matching intent/enrichment key upon arrival so that custom extractions, quick enrichments, and content tabs are immediately visible.

---

## 3. Verification & Test Results
- **Unit & System Tests:** `npm run test:unit` (146 files, 2,450 passed).
- **Contract Tests:** `npm run test:contract` (91 files, 1,651 passed).
- **Integration Tests:** `npm run test:integration` (45 files, 378 passed).
- **System Tests:** `npm run test:system` (5 files, 8 passed).
- **Database & Referral Verification:** `npm run test:db` (35 migrations, 288 assertions passed).
- **Build & Prerender:** `npm run build` and `npm run check:prerender` (23 pages, 69 assets valid).
- **E2E Smoke Tests:** `npm run test:e2e:smoke` (130 passed, 1 skipped).
- **Prepush Suite:** `npm run test:prepush` all green.
- **Git State:** Committed to `fix/home-enrichment-custom-extraction`, merged into `staging`, pushed to `origin/staging`, merged into `main`, pushed to `origin/main`.
