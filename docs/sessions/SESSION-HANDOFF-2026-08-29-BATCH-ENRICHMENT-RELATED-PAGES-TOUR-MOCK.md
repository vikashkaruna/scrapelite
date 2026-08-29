# Session Handoff — 2026-08-29 — Batch enrichment population, related-page scanning, tour e2e mock fix

**Branch:** `claude/discoverability-tour-enrichment-fixes-474ae3`, merged fast-forward to `staging` (`f9b197c`→`f05b30f`) and `main` (`9ba3ca9`→`f05b30f`). Both remotes now identical.

**Trigger:** the user reported a staging-deploy CI failure (`e2e/smoke/discoverability-tour.spec.js`) and, separately, that enrichment/content blocks (pricing, competitive intelligence, leadership, contacts) still didn't populate reliably despite several prior fix attempts on this exact symptom (see `SESSION-HANDOFF-2026-08-29-ENRICHMENT-AI-FIXES.md` and `SESSION-HANDOFF-2026-08-29-HOME-ENRICHMENT-EXTRACTION-FIXES.md`).

## 1. Staging CI failure — root cause and fix

`e2e/support.js`'s `installOfflineMocks(page, options)` never read `options.tours`. It unconditionally force-marked **both** `datiq.onboardingTour.v1` and `datiq.discoverabilityTour.v1` as already-skipped, in both the `addInitScript` and the post-`localStorage.clear()` re-seed block. `discoverability-tour.spec.js` calls `installOfflineMocks(page, { tours: "show" })` specifically to see the first-visit tour — the option existed at the call site but the helper silently ignored it, so the one spec that opted into seeing the tour always suppressed it instead.

This interacted with a **concurrent, independently-landed fix** (`SESSION-HANDOFF-2026-08-29-STAGING-GATE-TOUR-STORAGE-FIXES.md`, branch `fix_staging_gate_errors`, already on `staging` before this session merged): that session added the `datiq.discoverabilityTour.v1` suppression to fix a *different* regression (the discoverability tour's backdrop was blocking `discoverability.spec.js`'s unrelated tests, which need the tour suppressed like everything else). That fix was correct for what it targeted, but it's exactly what made the dedicated tour-visibility spec permanently broken — there was no way to opt out of the suppression it added.

**Fix:** `installOfflineMocks` now threads `options.tours === "show"` through to both storage-seeding blocks (passed as an argument, since `addInitScript`/`page.evaluate` run in browser context and can't close over Node variables). Verified both directions: `discoverability-tour.spec.js` now passes (dialog visible, 5-step tour walks through), and `discoverability.spec.js`'s regression assertion (`toHaveCount(0)` under default mocks) still passes.

## 2. Batch enrichment population — the real, previously-unfixed gap

Every prior fix on this symptom touched the **single-URL** path (`ExtractionProvider.extract()`/`enrich()`, `netlify/functions/extract.js`'s AI-extraction fallback) — which was already correct. The actual gap was the **batch path** (`src/lib/batchService.js`), used whenever Home routes 2+ URLs to `/batch`, or `/batch` is used directly:

- `runBatch`'s worker and `extractOne` captured `custom_extraction` (pricing/contacts/leadership/custom prompts) and `generated_content` (Competitor Summary, SEO outline, etc.) as raw fields on the result, but **never built the `{ [capabilityKey]: entry }` enrichments map** that `Preview.jsx` actually renders as tabs. Only `ExtractionProvider.extract()` built that map.
- `BatchRunProvider.jsx`'s save step reconstructed only the customPrompt half locally (`getEnrichMetaForIntent`, hardcoded to contacts/pricing/custom only — never matched the QUICK_ACTIONS presets like "leadership", so those always showed as generically-labeled "Custom extraction"), and **dropped `generated_content` entirely** — it never became a tab anywhere, on any device.
- Worse: `generated_content` isn't a real Supabase column. Sending it in the `POST /api/extractions` body made the insert fail with a "could not find column" error — and the missing-column retry in `netlify/functions/extractions.js` only strips the known v2 columns (`custom_extraction`/`domain_map`/`enrichments`), not `generated_content`, so the retry failed identically. The client's `shouldFallback` treats any 500 as "degrade gracefully," so the row silently saved to **localStorage only** — a toast said "N pages saved to Dashboard" while the actual row (and its content) never reached Supabase or any other device.
- `Batch.jsx`'s per-row **Retry** button dropped `intent`/`generateContent` from its `extractOne` call entirely, and never called `saveExtraction` on success at all, despite a comment claiming "the auto-save / persistence happens via the standard runBatch → success path."

**Fixed:**
- `batchService.js` — new `buildBatchEnrichments()` (mirrors `ExtractionProvider.extract()`'s logic exactly, via `enrichMetaForIntent`) builds the enrichments map for both `runBatch`'s worker and `extractOne`, covering custom-prompt AND generated-content results identically.
- `BatchRunProvider.jsx` — uses that map directly (mirrors each entry into the local `enrichmentStore` cache, then saves the row with `.enrichments` attached); strips the now-redundant `generated_content` scratch field before saving.
- `Batch.jsx` — `handleRetry` now passes `intent`/`generateContent` through, and persists a successful retry's result + enrichments (strips `generated_content` the same way).

## 3. Related-page scanning — new capability, requested mid-session

The user's follow-up ask: "even with single or multiple URLs, if enrichment selected, those should also run in scanning the related pages from the base URL to extract those enrichments" — i.e. selecting "Pricing & Plans" against a homepage that has no pricing on it (plans live on `/pricing`) should not just report "no data returned."

**Implementation** (`netlify/functions/extract.js`):
- New `src/lib/extractionPresets.js` export `RELATED_PAGE_HINTS` — a `{ [capabilityKey]: [keyword, ...] }` map (pricing→pricing/plans/price, leadership→team/about/board/management, contacts→contact/support, mission→about/mission/company), shared between client (for a prompt-text guess, `guessRelatedPageHintsKey`) and server (for scanning), so labeling and scanning agree.
- `firecrawlService.js`'s `extractStructure()` — the ONE choke point every customPrompt-driven caller funnels through — now attaches `options.enrichKey` (explicit from the caller when known: `enrichMeta.key`/`preset.key`/batch's `enrichMetaForIntent`, else guessed from the prompt text) before the request goes out. This means Home's pricing/contacts/custom intents, Preview's Quick Enrichment buttons, and every Batch run/retry all get related-page scanning for free, no per-call-site plumbing beyond this.
- `extract.js` — when the base page's own AI extraction comes back empty AND `options.enrichKey` is present (sanitized server-side against the known `RELATED_PAGE_HINTS` keys — never an arbitrary client string), `scanRelatedPages()` scores the base page's own `<a href>` links against the capability's hints (same-domain only), fetches up to 2 matches through the existing SSRF-safe `fetchPublicUrl`, and retries the AI extraction against the combined (base + related) text. Response carries `_relatedPagesScanned` when this is what produced the answer.
- New tests: `netlify/__tests__/extract.test.js` — "related-page scanning (enrichKey)" describe block, 4 tests (finds pricing on a linked page; does nothing without an enrichKey; reports no_match when no link matches; rejects an unwhitelisted enrichKey).

## 4. Environment note

This worktree's own `node_modules` was effectively empty/broken (`npm ci` hit the documented root-owned `~/.npm/_cacache` EACCES issue), so Vitest was silently falling back to the shared main checkout's `node_modules` (`/Users/vikash/Extracta/node_modules`), which has `@vitejs/plugin-react` 5.2.0 against this project's declared `^6.1.0` — the same pre-existing flake documented several times before in this file, breaking `TopBar.integration.test.jsx`'s `inert` regression test. Fixed locally with `npm install --no-save "@vitejs/plugin-react@^6.1.0" --cache /tmp/npm-cache-datiq` from inside this worktree.

## Verified

- Unit + contract + integration + system: **290 files / 4527 tests passed / 14 skipped / 0 failed**.
- `npm run test:db`: 35 migrations / 271 assertions + 17 referral assertions, 0 failed.
- `npm run build` clean, `npm run check:prerender` clean (23 pages / 69 refs, all present).
- `npm run test:security` clean.
- Full Playwright smoke suite (`test:e2e:smoke`): **131 passed / 1 skipped / 0 failed** — the previously-failing `discoverability-tour.spec.js` now passes; every other spec unaffected.
- Pre-push hook green end to end on the feature-branch push, the `staging` push, and the `main` push — nothing bypassed.

## Merge mechanics

`staging` had diverged from `main` with unrelated concurrent work (workspace-pause/member-context wiring, export-email rework — see `SESSION-HANDOFF-2026-08-29-BRANCH-CLEANUP-AND-WORKSPACE-PAUSE.md` and `-INTEGRATIONS-PRICING-EXPORT-EMAIL.md`) that this session's branch (cut from `main`) didn't have. Merged `origin/staging` into the feature branch (`git merge --no-edit origin/staging`); the only real conflict was `src/components/ExtractionProvider.jsx` (this session's `enrichKey` injection vs. the concurrent session's `workspaceId` injection at the same `extractStructure()` call site) — resolved by combining both into one options object. The 23 prerendered `public/` pages conflicted trivially (both sides regenerated them with different asset hashes) — resolved by taking either side and re-running `npm run prerender`. Pushed the merged branch to both `staging` and `main` via explicit refspec (`git push origin HEAD:staging` / `HEAD:main`) since `staging` was checked out in a sibling worktree and `main` in the primary checkout — the documented pattern for this repo. Both remotes are now at the same commit, `f05b30f`.

## Open for next session

- The related-page scanning is capped at 2 candidate pages and a fixed 8s fetch timeout per candidate, best-effort only — never blocks or fails the base extraction. No admin control over the candidate count/timeout yet; not needed unless it proves too aggressive or too timid in practice.
- `RELATED_PAGE_HINTS` has no `social`/`custom` entries (deliberately — social links are almost always on the page itself, and free-text custom prompts have no reliable subpage signal), so those two capabilities never trigger a related-page scan. If users report the same "not on this page" symptom for a custom prompt with an obvious subpage pattern, consider widening `guessRelatedPageHintsKey`.
