# Session Record — Staging Gate E2E Tour & Vitest Storage Fixes

**Date:** 2026-08-29  
**Branch:** `fix_staging_gate_errors` → `staging`  
**Target:** `staging`  

---

## 1. Context & Motivation

Staging Gate CI workflow runs #207 and #208 encountered build / test failures:
- **Run #207 (Test Suites)**: Failed due to Node 24+ built-in `localStorage` shadowing JSDOM storage instances in Vitest setup (`TypeError: Cannot read properties of undefined (reading 'clear')`).
- **Run #208 (Test Suites / E2E)**: Failed with 2 Playwright smoke errors:
  - `[chromium] › e2e/smoke/discoverability.spec.js:30:1 › advanced options expose the profile lens and say it does not rescore`
  - `[chromium] › e2e/smoke/discoverability.spec.js:39:1 › refuses an empty URL without navigating away`

---

## 2. Root Cause Analysis

1. **Discoverability Tour Overlay Pointer Interception**:
   - `src/lib/onboardingTour.js` defines multiple tours in `TOURS`: `home` (`datiq.onboardingTour.v1`) and `discoverability` (`datiq.discoverabilityTour.v1`).
   - In `e2e/support.js`, `installOfflineMocks` pre-seeded `datiq.onboardingTour.v1` as skipped, but omitted `datiq.discoverabilityTour.v1`.
   - On visiting `/discoverability`, `shouldAutoStart("discoverability")` returned `true`, rendering the full-screen tour backdrop `<div class="tour-backdrop-centre"></div>`. Playwright's click actions on `/discoverability` were intercepted by the backdrop and timed out after 30s.

2. **Node 24+ `globalThis.localStorage` / `Storage` Prototype Collision in JSDOM**:
   - In Node 24+, Node defines an experimental built-in global `localStorage` on `globalThis` which evaluates to `undefined` unless `--localstorage-file` is supplied.
   - When Vitest runs with `environment: "jsdom"`, this built-in global shadows JSDOM's `window.localStorage`.
   - Additionally, `globalThis.Storage` resolves to Node's built-in `Storage` rather than JSDOM's `window.Storage`, breaking spy assertions like `vi.spyOn(Storage.prototype, "setItem")`.

---

## 3. Changes Applied

1. **E2E & Script Tour Pre-Seeding**:
   - `e2e/support.js`: Added `datiq.discoverabilityTour.v1` to `addInitScript` and the post-`localStorage.clear()` re-seeding block.
   - `scripts/prerender.mjs`: Added `datiq.discoverabilityTour.v1` to `addInitScript` to prevent tour modal overlays during static site prerendering.
   - `docs/capture-screenshots.mjs`: Added `datiq.discoverabilityTour.v1` to `addInitScript` so screenshot capture runs cleanly without modal backdrops.

2. **Test Setup Storage Bridging**:
   - `test/setup.js`:
     - Overrides `globalThis.Storage` with JSDOM's `window.Storage` prototype constructor so prototype spies (`vi.spyOn(Storage.prototype, ...)`) target the exact prototype backing JSDOM storage instances.
     - Bridges `window.localStorage`, `window.sessionStorage`, `globalThis.localStorage`, and `globalThis.sessionStorage` with custom fallback handling for Node 24+.

---

## 4. Verification Results

All suites executed and passed with 0 failures:
- **Unit tests**: 146 files / 2,444 passed
- **Contract tests**: 91 files / 1,651 passed (14 skipped)
- **Integration tests**: 45 files / 376 passed
- **System tests**: 5 files / 8 passed
- **Database & Referral verification**: 35 migrations / 271 assertions passed + 17 referral assertions passed
- **Build & Prerender check**: `npm run build && npm run check:prerender` (23 generated static pages, 69 asset references, 0 stale)
- **Security audit**: `npm run test:security` clean
- **E2E smoke suite**: `npm run test:e2e:smoke` (130 passed, 0 failed, 1 skipped)
- **Prepush suite**: `npm run test:prepush` clean (exit code 0)
