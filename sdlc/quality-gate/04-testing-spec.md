# 04 — Testing Spec (full inventory of every test that will be added)

> The complete list of test cases, organised by layer, with file paths, test names, type tag, and the requirement they satisfy.
> Numbers in the "ID" column are stable — they are the canonical test IDs in CI reports.
> When a test fails in CI, the failure log should name the ID and the file.

## Legend

- **Type** — `U` unit, `I` integration, `C` contract, `F` functional, `S` system, `K` smoke, `J` journey, `X` security, `A` a11y, `V` visual
- **P** — Priority: `M` must, `S` should, `L` low
- **S** — Size: `S` < 1 h, `M` 1-4 h, `L` 4+ h
- **Status** — `NEW` not yet written, `EXT` extending an existing file, `KEEP` already covered

## A. Unit tests (FR-U-*) — Vitest, jsdom or Node

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| U-01 | `src/lib/utils.test.js` | `extractionsToMarkdown` produces a heading, links, enrichment sections | U | M | S | EXT | FR-U-01 |
| U-02 | `src/lib/utils.test.js` | `extractionsToJson` matches the documented schema; `jsonDownload` triggers a download with the right MIME | U | M | S | EXT | FR-U-01 |
| U-03 | `src/lib/utils.test.js` | `markdownDownload` triggers a download with `text/markdown` | U | M | S | EXT | FR-U-01 |
| U-04 | `src/lib/utils.test.js` | `parseUrlsFromCsv` handles quoted fields, embedded commas, leading/trailing whitespace, dedupe, blank lines | U | M | S | EXT | FR-U-01 |
| U-05 | `src/lib/utils.test.js` | `parseUrlsFromText` extracts URLs from prose; ignores bare words | U | M | S | EXT | FR-U-01 |
| U-06 | `src/lib/utils.test.js` | `extractionsToPdf` (lazy import) calls `jspdf` correctly with each extraction (mocked) | U | M | S | EXT | FR-U-01 |
| U-07 | `src/lib/pricingMath.test.js` | `computeCharge` — INR monthly, INR annual, USD monthly, USD annual, with coupon, with global discount, with both, with bundle | U | M | M | NEW | FR-U-02 |
| U-08 | `src/lib/pricingMath.test.js` | `computeCharge` rounds consistently (no drift between client + server) | U | M | S | NEW | FR-U-02 |
| U-09 | `src/lib/currencyService.test.js` | `detectCurrency("Asia/Kolkata")` → INR; `America/New_York` → USD; `Europe/London` → USD; missing Intl → USD | U | M | S | NEW | FR-U-03 |
| U-10 | `src/lib/currencyService.test.js` | `convertPrice` is a no-op for INR (fixed prices); USD→INR uses `DEFAULT_RATES.INR` | U | M | S | NEW | FR-U-03 |
| U-11 | `src/lib/currencyService.test.js` | `formatPrice` outputs `$19.00` for USD, `₹999` for INR, uses correct locale | U | M | S | NEW | FR-U-03 |
| U-12 | `src/lib/pricingConfig.test.js` | Every plan has the required fields; every limit is a non-negative integer or `Infinity`; `exports` are subset of allowed formats; `email_export` is boolean | U | M | S | NEW | FR-U-04 |
| U-13 | `src/lib/pricingConfig.test.js` | `ENTERPRISE_PLAN` has price = "Custom"; 7 plans in `PLANS` (Free / Select / Pro / Business / Agency / Developer / Enterprise) | U | M | S | NEW | FR-U-04 |
| U-14 | `src/lib/pricingConfig.test.js` | `TOPUP_BUNDLES` is non-empty, every bundle has `id`, `name`, `price_usd`, `price_inr`, `bonusBatchUrls` | U | M | S | NEW | FR-U-04 |
| U-15 | `src/lib/pricingOverrides.test.js` | `getEffectivePlanById("pro")` returns base plan when no override; override when present | U | M | S | NEW | FR-U-05 |
| U-16 | `src/lib/pricingOverrides.test.js` | `setPlanOverride` persists to localStorage; `resetOverrides` clears; corrupt JSON → reset to base | U | M | S | NEW | FR-U-05 |
| U-17 | `src/lib/pricingOverrides.test.js` | `getGlobalDiscount` returns 0 when none; `applyGlobalDiscount(price, 20)` returns 80 % of price | U | M | S | NEW | FR-U-05 |
| U-18 | `src/lib/usageService.test.js` | `canExtract("select")` at counts 0 / 1 / 99 / 100 / 101; with `bonusExtractions: 50` extends the limit | U | M | M | NEW | FR-U-06 |
| U-19 | `src/lib/usageService.test.js` | `canExtract` for an Agency plan with `Infinity` limit returns `remaining: Infinity` | U | M | S | NEW | FR-U-06 |
| U-20 | `src/lib/usageService.test.js` | `canExtract` across month rollover (use `vi.useFakeTimers`) starts the new month at 0 | U | M | S | NEW | FR-U-06 |
| U-21 | `src/lib/usageService.test.js` | `canEnrich("free", url, 0)` returns `allowed: true, remaining: Infinity`; `canEnrich` for plans with explicit limits | U | M | S | NEW | FR-U-06 |
| U-22 | `src/lib/usageService.test.js` | `canExport("free", "pdf")` returns `false`; `canExport("select", "markdown")` returns `true`; `canEmailExport("free")` returns `false` | U | M | S | NEW | FR-U-06 |
| U-23 | `src/lib/usageService.test.js` | `canBatch("free", 6, 0)` blocks with reason; `canBatch("select", 10, 50)` allows; `canBatch("agency", 500, 0)` allows | U | M | S | NEW | FR-U-07 |
| U-24 | `src/lib/usageService.test.js` | `canExtractBatch("free", 5, 0)` when `extractions: 6` blocks with reason | U | M | S | NEW | FR-U-07 |
| U-25 | `src/lib/usageService.test.js` | `incrementExtractions(3)` adds 3; `incrementBatchRuns(1)` adds 1; `incrementContentGenerations(1)` adds 1 | U | M | S | NEW | FR-U-06 |
| U-26 | `src/lib/batchService.test.js` | `parseUrlsFromCsv("a.com,b.com\na.com\nnot-a-url\n  spaced.com  ")` → 3 valid (with dedupe), 1 invalid, trimmed | U | M | S | NEW | FR-U-08 |
| U-27 | `src/lib/batchService.test.js` | `parseUrlsFromCsv('"a, b.com",b.com')` → 2 (comma inside quotes does not split) | U | M | S | NEW | FR-U-08 |
| U-28 | `src/lib/batchService.test.js` | `runBatch([...5 URLs], concurrency: 3)` — partial failure of 1 URL → 4 success + 1 fail; each result has `_status: "ok" \| "error"` | U | L | M | NEW | FR-U-09 |
| U-29 | `src/lib/batchService.test.js` | `runBatch` strips `_status` / `_error` from successful results before returning | U | M | S | NEW | FR-U-09 |
| U-30 | `src/lib/batchRunsService.test.js` | `saveBatchRun` + `listBatchRuns` returns in reverse-chronological order | U | M | S | NEW | FR-U-10 |
| U-31 | `src/lib/batchRunsService.test.js` | Cap at 50: the 51st run evicts the oldest | U | M | S | NEW | FR-U-10 |
| U-32 | `src/lib/batchRunsService.test.js` | `recordBatchItems` populates `datiq.batchMap` keyed by extraction id | U | M | S | NEW | FR-U-10 |
| U-33 | `src/lib/schedulerService.test.js` | `buildCron({frequency:"hourly", everyHours:6})` → `"0 */6 * * *"` | U | M | S | NEW | FR-U-11 |
| U-34 | `src/lib/schedulerService.test.js` | `buildCron` for `daily` / `weekday` / `weekly` / `monthly` (snapshots) | U | M | S | NEW | FR-U-11 |
| U-35 | `src/lib/schedulerService.test.js` | 51st schedule is rejected | U | M | S | NEW | FR-U-11 |
| U-36 | `src/lib/schedulerService.test.js` | `presetByKey("daily")` returns the daily preset; unknown key falls back to default | U | M | S | NEW | FR-U-11 |
| U-37 | `src/lib/schedulerService.test.js` | Corrupt localStorage → `listSchedules()` returns `[]` | U | M | S | NEW | FR-U-11 |
| U-38 | `src/lib/personaConfig.test.js` | `PERSONAS` has 7 entries; ids are unique; each persona has `id`, `name`, `icon`, `tagline` | U | M | S | NEW | FR-U-12 |
| U-39 | `src/lib/emailService.test.js` | Webhook path: 200 → returns `{ok:true}` | U | M | S | NEW | FR-U-13 |
| U-40 | `src/lib/emailService.test.js` | Webhook 5xx → email API path; email API 200 → returns `{ok:true}` | U | M | S | NEW | FR-U-13 |
| U-41 | `src/lib/emailService.test.js` | Both down → mailto fallback; recipients parsed from CSV | U | M | S | NEW | FR-U-13 |
| U-42 | `src/lib/webhook.test.js` | `notifyWebhook(url, payload)` posts JSON to url; fetch failure is swallowed (fire-and-forget) | U | M | S | NEW | FR-U-14 |
| U-43 | `src/lib/migrationService.test.js` | `runMigrations` copies all `scrapelite.*` keys to `datiq.*`; sets `datiq.migrated = true` | U | M | S | NEW | FR-U-15 |
| U-44 | `src/lib/migrationService.test.js` | Idempotent: second run is a no-op | U | M | S | NEW | FR-U-15 |
| U-45 | `src/lib/authService.test.js` | `signUpWithEmail` passes `emailRedirectTo: window.location.origin` (mocked supabase) | U | M | S | NEW | FR-U-16 |
| U-46 | `src/lib/authService.test.js` | `signInWithOAuth("google")` calls `signInWithOAuth` with provider | U | M | S | NEW | FR-U-16 |
| U-47 | `src/lib/emailCaptureService.test.js` | `captureEmail("a@b.com", "home")` adds to `datiq.subscribers`; second call is a no-op | U | M | S | NEW | FR-U-17 |
| U-48 | `src/lib/emailCaptureService.test.js` | Webhook fire-and-forget: fetch 200/non-200/throw all handled | U | M | S | NEW | FR-U-17 |
| U-49 | `src/lib/guestTrialService.test.js` | `incrementGuestCount(1)` advances; `getGuestCount()` returns the new value | U | M | S | NEW | FR-U-18 |
| U-50 | `src/lib/guestTrialService.test.js` | `shouldShowTrialPrompt(0)` false; `(3)` true; `(5)` false (re-prompt interval = 2); `(7)` true | U | M | M | NEW | FR-U-18 |
| U-51 | `src/lib/guestTrialService.test.js` | `isSingleHardLimitReached(10)` true; `isBatchHardLimitReached(5)` true | U | M | S | NEW | FR-U-18 |
| U-52 | `src/lib/guestTrialService.test.js` | Settings override: with `soft_limit: 5` and `count: 5`, `shouldShowTrialPrompt(5)` is true | U | M | S | NEW | FR-U-18 |
| U-53 | `src/lib/globalSettingsService.test.js` | `getSettings()` (sync) returns DEFAULTS when cache is empty | U | M | S | NEW | FR-U-19 |
| U-54 | `src/lib/globalSettingsService.test.js` | `loadSettings()` fetches and caches; second call within TTL returns cached value (no fetch) | U | M | S | NEW | FR-U-19 |
| U-55 | `src/lib/globalSettingsService.test.js` | `loadSettings()` failure → DEFAULTS returned; `updateCachedSettings` is reflected on next `getSettings()` | U | M | S | NEW | FR-U-19 |
| U-56 | `src/lib/extractionsRepo.test.js` | `listExtractions` API path (mocked) returns server rows; 401 → localStorage fallback | U | M | M | NEW | FR-U-20 |
| U-57 | `src/lib/extractionsRepo.test.js` | `saveExtraction` strips `_status` and `_error` before sending | U | M | S | NEW | FR-U-20 |
| U-58 | `src/lib/extractionsRepo.test.js` | 500 → fallback to localStorage; no exception thrown | U | M | S | NEW | FR-U-20 |
| U-59 | `src/lib/paymentService.test.js` | Demo mode: `initiateCheckout` with no keys returns `{status:"demo_mode"}` | U | M | S | NEW | FR-U-21 |
| U-60 | `src/lib/paymentService.test.js` | Razorpay path: `initiateRazorpayCheckout` advances `PAYMENT_STAGE` through PREPARING → PORTAL_OPEN | U | L | M | NEW | FR-U-21 |
| U-61 | `src/lib/paymentService.test.js` | Pending payment TTL: `readPendingPayment` returns null after 30 min | U | M | S | NEW | FR-U-21 |
| U-62 | `src/lib/paymentService.test.js` | `verifyPayment` happy path returns `{verified:true}` | U | M | S | NEW | FR-U-21 |
| U-63 | `src/lib/adminService.test.js` | Legacy boolean token (`"true"`) in `scrapelite.adminAuth` is rejected by `isAdminAuthed` | U | M | S | NEW | FR-U-22 |
| U-64 | `src/lib/adminService.test.js` | Expired token triggers `adminLogout` and returns false | U | M | S | NEW | FR-U-22 |
| U-65 | `src/lib/adminService.test.js` | `validateCoupon` with `planId="manual"` returns `{ok:false, reason:"This coupon is for admin assignment only."}` (FR-Z-04) | U | M | S | NEW | FR-Z-04 / FR-U-22 |
| U-66 | `src/lib/adminConfigService.test.js` | Token-gated paths throw without a token; non-gated paths work | U | M | S | NEW | FR-U-23 |
| U-67 | `src/lib/adminConfigService.test.js` | `getRevenueData` returns `{fromSeed: true, ...}` when Supabase is unconfigured | U | M | S | NEW | FR-U-23 |
| U-68 | `src/lib/statsService.test.js` | `getStats` first call → fetch; second call within 5 min → cached (no fetch) | U | M | S | NEW | FR-U-24 |
| U-69 | `src/lib/statsService.test.js` | `getStats` fetch 5xx → returns `null`; missing keys → returns `null` | U | M | S | NEW | FR-U-24 |
| U-70 | `src/lib/supabaseClient.test.js` | `supabaseClient` is `null` when env unset | U | M | S | NEW | FR-U-25 |
| U-71 | `src/lib/supabaseClient.test.js` | `createClient` is called with the right URL and key when env set | U | M | S | NEW | FR-U-25 |
| U-72 | `src/lib/utils.test.js` | `parseEmails` returns deduped valid list and invalid list | U | S | S | KEEP | (existing) |
| U-73 | `src/lib/errorMessages.test.js` | All 11 classifyError mappings + fallback (already covered) | U | M | S | KEEP | (existing) |
| U-74 | `src/lib/enrichmentStore.test.js` | Already covered | U | M | S | KEEP | (existing) |
| U-75 | `src/lib/linkCategorizer.test.js` | Already covered | U | M | S | KEEP | (existing) |
| U-76 | `src/lib/extractionPresets.test.js` | Already covered | U | M | S | KEEP | (existing) |
| U-77 | `src/lib/config.test.js` | Already covered | U | M | S | KEEP | (existing) |

## B. Integration tests (FR-I-*) — Vitest + jsdom + @testing-library/react

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| I-01 | `src/components/HeroComposer.integration.test.jsx` | Paste-anything: raw text → `extract` is called with `raw_text`-shaped payload | I | M | M | EXT | FR-I-01 |
| I-02 | `src/components/HeroComposer.integration.test.jsx` | Schedule preset armed: clicking Extract → `/schedules` with `location.state.draftSchedule` | I | M | S | EXT | FR-I-01 |
| I-03 | `src/components/HeroComposer.integration.test.jsx` | Batch toggle: on → multi-URL textarea; off → single URL | I | M | S | EXT | FR-I-01 |
| I-04 | `src/components/HeroComposer.integration.test.jsx` | "Custom" intent: textarea appears; submit passes `customPrompt` to extract | I | M | S | EXT | FR-I-01 |
| I-05 | `src/__tests__/system/billing.test.jsx` | `initiatePayment("pro", "annual")` with no keys → `confirmTarget` set → DemoPaymentModal mounts → "Confirm — activate Pro (Demo)" → plan upgrades; `datiq.usage` not auto-incremented | I | L | M | NEW | FR-I-02 |
| I-06 | `src/__tests__/system/billing.test.jsx` | "Cancel" in DemoPaymentModal → no change | I | M | S | NEW | FR-I-02 |
| I-07 | `src/__tests__/system/billing.test.jsx` | `retryPayment()` re-initiates with the same `planId` + `billingPeriod` | I | M | S | NEW | FR-I-02 |
| I-08 | `src/__tests__/system/guest-trial.test.jsx` | count 0→3: no prompt; 4th: soft prompt appears; dismiss; 6th: re-prompt | I | L | M | NEW | FR-I-03 |
| I-09 | `src/__tests__/system/guest-trial.test.jsx` | count 10 → hard block; reload → block re-mounts; sign in → block clears; sign out → SENSITIVE_KEYS cleared, `datiq.guestTrial` preserved | I | L | M | NEW | FR-I-03 |
| I-10 | `src/__tests__/system/guest-trial.test.jsx` | batchCount 5 → hard block with reason "batch" | I | M | S | NEW | FR-I-03 |
| I-11 | `src/components/ExtractionProvider.test.jsx` | Pre-flight `checkCanExtractSingle` blocks the extract; `showHardBlock(true)` set; no extract dispatched | I | M | S | NEW | FR-I-04 |
| I-12 | `src/components/Toast.test.jsx` | `useToast()` returns a function (not an object); calling it shows the toast | I | M | S | NEW | FR-I-05 |
| I-13 | `src/components/ErrorModal.test.jsx` | `useErrorModal().show({title, body, canRetry})` opens the modal | I | M | S | NEW | FR-I-05 |
| I-14 | `src/components/AuthProvider.test.jsx` | Mount with `#error=access_denied` in URL → `authError` set, modal opened, URL hash cleaned | I | M | S | NEW | FR-I-05 |
| I-15 | `src/components/TopupBundleModal.test.jsx` | qty 1 → CTA "Add 1 bundle — ₹X"; qty 2 → "Add 2 bundles — ₹2X"; "+" disabled at qty 10; "−" disabled at qty 1 | I | M | M | NEW | FR-I-06 |
| I-16 | `src/components/TopupBundleModal.test.jsx` | Upsell section shows plans with `price_usd > current`; click closes modal and triggers flow | I | M | S | NEW | FR-I-06 |
| I-17 | `src/components/TopupBundleModal.test.jsx` | INR currency: prices in `₹` (per the R13 fix) | I | M | S | NEW | FR-I-06 |
| I-18 | `src/components/TopupBundleModal.test.jsx` | Backdrop click → close | I | S | S | NEW | FR-I-06 |
| I-19 | `src/components/PaymentConfirmModal.test.jsx` | INR: base + 18 % GST + total breakdown rendered | I | M | S | NEW | FR-I-07 |
| I-20 | `src/components/PaymentConfirmModal.test.jsx` | "Confirm & Pay" → `initiatePayment` called once (FR-Z-01 fix wires this) | I | M | S | NEW | FR-Z-01 / FR-I-07 |
| I-21 | `src/components/PaymentConfirmModal.test.jsx` | "Cancel" / "Upgrade to X" → no-op | I | M | S | NEW | FR-I-07 |
| I-22 | `src/components/DemoPaymentModal.test.jsx` | confirm → plan upgrades; cancel → no change; Esc/backdrop → no change | I | M | S | NEW | FR-I-08 |
| I-23 | `src/components/TopBar.test.jsx` | Logged out: shows "Sign in" + "Sign up"; logged in: shows UserDropdown | I | M | S | NEW | FR-I-09 |
| I-24 | `src/components/TopBar.test.jsx` | Explore dropdown opens; shows 6 sections in the right order; "About DatIQ" is in the last section | I | M | S | NEW | FR-I-09 |
| I-25 | `src/components/TopBar.test.jsx` | Mobile viewport (<600 px) → hamburger button visible | I | M | S | NEW | FR-I-09 |
| I-26 | `src/pages/Batch.integration.test.jsx` | `pasteText` initialised from `location.state.urls`; falls back to `datiq.batchDraft`; "New batch" clears | I | M | S | NEW | FR-I-10 |
| I-27 | `src/pages/Batch.integration.test.jsx` | Pre-flight `checkCanExtractBatch` → `showHardBlock(true)` and no run | I | M | S | NEW | FR-I-10 |
| I-28 | `src/pages/Batch.integration.test.jsx` | `trackGuestBatchRun` only fires after a successful run | I | M | S | NEW | FR-I-10 |
| I-29 | `src/pages/Home.integration.test.jsx` | OG preview debounce: 800 ms after typing → fetch; 200 → card visible; non-200 → no card | I | M | M | NEW | FR-I-11 |
| I-30 | `src/pages/Home.integration.test.jsx` | "Custom" intent → textarea; FAB → `/batch`; empty URL → validation error; 4th guest extract → soft prompt | I | M | M | NEW | FR-I-11 |
| I-31 | `src/pages/Dashboard.integration.test.jsx` | localStorage-first: with `datiq.saved` present, no spinner; Refresh triggers fetch; empty → "Nothing saved yet" + "Extract a page" CTA | I | L | L | NEW | FR-I-12 |
| I-32 | `src/pages/Dashboard.integration.test.jsx` | Batch filter: `batchFilter` set → only matching rows; clear filter | I | M | M | NEW | FR-I-12 |
| I-33 | `src/pages/Dashboard.integration.test.jsx` | Group-by: batch runs and scheduled runs are collapsible; single extractions are not | I | M | M | NEW | FR-I-12 |
| I-34 | `src/pages/Dashboard.integration.test.jsx` | Export ▾ opens above table (z-index) | I | M | S | NEW | FR-I-12 |
| I-35 | `src/pages/Preview.integration.test.jsx` | Download ▾ shows CSV / PDF / MD / JSON; "View Dashboard" is primary; "Delete" removes and returns `/` | I | M | M | NEW | FR-I-13 |
| I-36 | `src/pages/Schedules.integration.test.jsx` | Editor: cadence builder inputs emit the right `cron`; "Run until" optional date; alert email validation | I | L | M | NEW | FR-I-14 |
| I-37 | `src/pages/Schedules.integration.test.jsx` | "Run now" creates a tagged extraction; Pause/Resume persists | I | M | M | NEW | FR-I-14 |
| I-38 | `src/pages/Account.integration.test.jsx` | Plan name; usage stats (4 counters); coupon apply / remove; payment history | I | M | M | NEW | FR-I-15 |
| I-39 | `src/pages/Pricing.integration.test.jsx` | Annual default; 7 cards; INR currency shows ₹-prefix prices; Developer card "Coming soon"; Enterprise card "Contact sales" mailto; current-plan badge | I | M | M | NEW | FR-I-16 |
| I-40 | `src/pages/Onboarding.integration.test.jsx` | Persona selection persists; skip navigates home | I | S | S | NEW | FR-I-17 |
| I-41 | `src/pages/Contact.integration.test.jsx` | `?type=bug` → "Bug report" pre-selected, subject pre-filled "Bug report: "; submit opens mailto | I | S | S | NEW | FR-I-18 |
| I-42 | `src/components/AuthModal.test.jsx` | "Sign in" tab default when opened from sign-in; "Create account" tab default from sign-up; error display; OAuth buttons | I | M | S | NEW | FR-I-19 |
| I-43 | `src/pages/admin/AdminLayout.integration.test.jsx` | PIN gate; 5 wrong attempts → 60 s lockout; correct PIN (mocked) → admin shell; sidebar collapse + pin; mobile horizontal bar | I | L | M | NEW | FR-I-20 |
| I-44 | `src/pages/admin/AdminRevenue.integration.test.jsx` | Loading → live KPIs (mocked); Refresh; warning when fromSeed | I | M | M | NEW | FR-I-21 |
| I-45 | `src/pages/admin/AdminPricing.integration.test.jsx` | Edit form, USD + INR, GST hint, bundle editor, "Generate SQL" panel emits valid SQL | I | L | M | NEW | FR-I-22 |
| I-46 | `src/pages/admin/AdminUsers.integration.test.jsx` | Real Supabase users (mocked); assign-coupon modal opens; preview row; persistence | I | L | M | NEW | FR-I-23 |
| I-47 | `src/pages/admin/AdminCoupons.integration.test.jsx` | `planId="manual"` shows purple pill; manual-only self-apply blocked | I | M | S | NEW | FR-I-24 |
| I-48 | `src/pages/NotFound.test.jsx` | Renders at unknown routes; brand-consistent 404 copy | I | S | S | NEW | FR-I-25 |

## C. Contract tests (FR-C-*) — Vitest Node + vi.mock(fetch)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| C-01 | `netlify/functions/extract.test.js` | SSRF guard rejects private IPs (already covered by publicUrl.test.js; this test verifies the function uses it) | C | L | S | NEW | FR-C-01 |
| C-02 | `netlify/functions/extract.test.js` | Provider chain called in order; first success short-circuits; provider-error continues | C | L | M | NEW | FR-C-01 |
| C-03 | `netlify/functions/extract.test.js` | Response shape matches the documented contract (used by `firecrawlService.extractStructure`) | C | M | S | NEW | FR-C-01 |
| C-04 | `netlify/functions/extract.test.js` | Map mode: returns `{mapLinks: [...]}` | C | M | S | NEW | FR-C-01 |
| C-05 | `netlify/functions/ai.test.js` | Multi-provider chain: gemini → anthropic → openai; first success short-circuits | C | M | M | NEW | FR-C-02 |
| C-06 | `netlify/functions/ai.test.js` | Per-provider model from `loadAiConfig()`; client `model` is ignored | C | M | S | NEW | FR-C-02 |
| C-07 | `netlify/functions/ai.test.js` | 503 when no key is set | C | M | S | NEW | FR-C-02 |
| C-08 | `netlify/functions/extractions.test.js` | GET with service key returns all rows; GET with anon key returns only own session | C | L | M | NEW | FR-C-03 |
| C-09 | `netlify/functions/extractions.test.js` | POST strips unknown columns; `_status` / `_error` removed | C | M | S | NEW | FR-C-03 |
| C-10 | `netlify/functions/extractions.test.js` | DELETE is idempotent; 404 for missing | C | M | S | NEW | FR-C-03 |
| C-11 | `netlify/functions/extractions.test.js` | 401/403 → graceful JSON error (useLocalStorage: true) | C | M | S | NEW | FR-C-21 |
| C-12 | `netlify/functions/create-checkout.test.js` | Plan + currency + billingPeriod resolution | C | L | M | NEW | FR-C-04 |
| C-13 | `netlify/functions/create-checkout.test.js` | Server ignores client-sent `amount`; client-sent `discountPercent` ignored (FR-X-03, FR-X-07) | C | L | M | NEW | FR-X-03 / FR-X-07 / FR-C-04 |
| C-14 | `netlify/functions/create-checkout.test.js` | INR adds 18 % GST; USD does not | C | L | M | NEW | FR-C-04 |
| C-15 | `netlify/functions/create-checkout.test.js` | `max(coupon, global)` discount; `cap_reached` / `already_redeemed` drop to global | C | L | M | NEW | FR-C-04 |
| C-16 | `netlify/functions/create-checkout.test.js` | Error codes: `INVALID_PROVIDER`, `UNKNOWN_PLAN`, `AMOUNT_TOO_SMALL`, `RAZORPAY_NOT_CONFIGURED`, `STRIPE_NOT_CONFIGURED` | C | M | S | NEW | FR-C-04 |
| C-17 | `netlify/functions/verify-payment.test.js` | Razorpay HMAC verified with `timingSafeEqual` (FR-X-05); bad sig → 400 | C | L | M | NEW | FR-X-05 / FR-C-05 |
| C-18 | `netlify/functions/verify-payment.test.js` | `authorized` → captured; `captured` → `verified:true`; order_id mismatch → reject | C | L | M | NEW | FR-C-05 |
| C-19 | `netlify/functions/verify-payment.test.js` | Stripe: signature verified; success path; bad signature → 400 | C | M | M | NEW | FR-C-05 |
| C-20 | `netlify/functions/payment-webhook.test.js` | Idempotent on `provider_event_id`; DB write failure → 200 (prevent gateway retry) | C | L | M | NEW | FR-C-06 |
| C-21 | `netlify/functions/payment-webhook.test.js` | `payment.failed` does NOT activate plan | C | M | S | NEW | FR-C-06 |
| C-22 | `netlify/functions/payment-webhook.test.js` | Stripe webhook signature bypass rejected (FR-X-04) | C | L | S | NEW | FR-X-04 / FR-C-06 |
| C-23 | `netlify/functions/admin-auth.test.js` | Correct PIN (hash match) → token; wrong PIN → 401; demo flag returned; rate-limit 5/min/IP (when env set) | C | L | M | NEW | FR-C-07 |
| C-24 | `netlify/functions/admin-auth.test.js` | Admin bypass via header injection rejected (FR-X-06) | C | L | S | NEW | FR-X-06 / FR-C-07 |
| C-25 | `netlify/functions/admin-ai-config.test.js` | GET returns config + key presence (no secrets); POST token-gated | C | M | S | NEW | FR-C-08 |
| C-26 | `netlify/functions/admin-general-config.test.js` | GET merges DEFAULTS + saved; POST sanitises integer ranges; token-gated | C | M | S | NEW | FR-C-09 |
| C-27 | `netlify/functions/admin-revenue.test.js` | Live KPIs; INR paise→USD at 83.5; warning when Supabase unconfigured | C | M | M | NEW | FR-C-10 |
| C-28 | `netlify/functions/admin-users.test.js` | GET returns planStart/planEnd/couponAvailed; PATCH `assign_coupon` writes both `auth.users.user_metadata` AND `coupon_redemptions` | C | L | M | NEW | FR-C-11 |
| C-29 | `netlify/functions/stats.test.js` | Distinct sessions; sum extractions; 0 when empty; null on fetch error | C | M | S | NEW | FR-C-12 |
| C-30 | `netlify/functions/og-preview.test.js` | Reads first 15 KB; parses og:title/og:description/`<title>`/meta-description; favicon URL; 5-min CDN cache header | C | M | S | NEW | FR-C-13 |
| C-31 | `netlify/functions/schedules.test.js` | GET scoped to per-user session_id; cron validation on POST; idempotent DELETE | C | M | M | NEW | FR-C-14 |
| C-32 | `netlify/functions/scheduled-runner.test.js` | Reads active+due schedules; skips expired; re-runs extraction; change detection via `hashContent`; alert webhook fires; never throws 5xx | C | L | L | NEW | FR-C-15 |
| C-33 | `netlify/functions/lib/aiProviders.test.js` | `runChain` tries providers in order; skips disabled; skips missing-key; 502 when all fail | C | M | M | NEW | FR-C-16 |
| C-34 | `netlify/functions/lib/scrapeProviders.test.js` | `runScrapeChain` order respected; first success short-circuits; `runMapChain` shape | C | M | M | NEW | FR-C-17 |
| C-35 | `netlify/functions/lib/pricingSource.test.js` | Static-then-operator merge; 60-s cache; missing config row → static | C | M | M | NEW | FR-C-18 |
| C-36 | `netlify/functions/lib/adminToken.test.js` | `verifyAdminToken` accepts valid; rejects tampered; rejects expired; rejects missing | C | M | S | NEW | FR-C-19 |
| C-37 | `netlify/functions/lib/publicUrl.test.js` | 100 % branch coverage maintained | C | M | S | KEEP | (existing) |

## D. Functional tests (FR-F-*) — Vitest + jsdom + MemoryRouter + Provider tree

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| F-01 | `src/pages/Home.test.jsx` | Empty input → submit disabled; valid URL → extract → /preview | F | M | S | NEW | FR-F-02 |
| F-02 | `src/pages/Home.test.jsx` | Multi-URL → navigate to /batch; custom prompt → AI route | F | M | S | NEW | FR-F-02 |
| F-03 | `src/pages/Preview.test.jsx` | Loads from `datiq.current`; redirects to `/` when none | F | M | S | NEW | FR-F-03 |
| F-04 | `src/pages/Dashboard.test.jsx` | Empty state CTA; non-empty table/cards; search; Refresh | F | M | S | NEW | FR-F-04 |
| F-05 | `src/pages/Batch.test.jsx` | Run disabled when textarea empty; ≥1 URL → enabled; intent chip selected | F | M | S | NEW | FR-F-05 |
| F-06 | `src/pages/Schedules.test.jsx` | Empty state; create flow; "Run now" creates extraction; delete | F | M | M | NEW | FR-F-06 |
| F-07 | `src/pages/Pricing.test.jsx` | 7 plan cards; annual default | F | M | S | NEW | FR-F-07 |
| F-08 | `src/pages/Account.test.jsx` | Plan + usage | F | M | S | NEW | FR-F-08 |
| F-09 | `src/pages/Onboarding.test.jsx` | Persona selection persists; skip | F | S | S | NEW | FR-F-09 |
| F-10 | `src/pages/Contact.test.jsx` | Required email + message; mailto on submit | F | S | S | NEW | FR-F-10 |
| F-11 | `src/pages/About.test.jsx` | Founder block visible; hero text does NOT contain "powered by DatIQ" | F | S | S | NEW | FR-F-11 |
| F-12 | `src/pages/Blog.test.jsx` | Cards visible; click opens PostModal | F | S | S | NEW | FR-F-12 |
| F-13 | `src/pages/Privacy.test.jsx` | DPDP section present; `datiq.app` URL | F | S | S | NEW | FR-F-13 |
| F-14 | `src/pages/Terms.test.jsx` | Arbitration Act + Bengaluru | F | S | S | NEW | FR-F-14 |
| F-15 | `src/pages/UseCases.test.jsx` | 4 hub cards; subpage renders | F | S | S | NEW | FR-F-15 |
| F-16 | `src/pages/VsBrowseAI.test.jsx` + `src/pages/VsClay.test.jsx` | Comparison tables render | F | S | S | NEW | FR-F-16 |
| F-17 | `src/pages/Integrations.test.jsx` | 12 cards visible | F | S | S | NEW | FR-F-17 |
| F-18 | `src/pages/admin/AdminLayout.test.jsx` | PIN gate; sub-routes load; sidebar collapse | F | M | M | NEW | FR-F-18 |

## E. System tests (FR-S-*) — Vitest + jsdom + full provider tree

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| S-01 | `src/__tests__/system/logout.test.jsx` | Sign-out clears 7 SENSITIVE_KEYS, preserves `datiq.guestTrial`, navigates to `/` | S | L | M | NEW | FR-S-01 |
| S-02 | `src/__tests__/system/hard-block-reload.test.jsx` | count ≥ SINGLE_HARD_LIMIT in localStorage → hard block mounts on first render | S | L | M | NEW | FR-S-02 |
| S-03 | `src/__tests__/system/signin-bypass.test.jsx` | Sign-in does NOT clear `datiq.guestTrial` | S | M | S | NEW | FR-S-03 |
| S-04 | `src/__tests__/system/plan-upgrade.test.jsx` | Upgrade from `free` to `select` does NOT reset `datiq.usage` | S | M | S | NEW | FR-S-04 |
| S-05 | `src/__tests__/system/cross-tab.test.jsx` | `storage` event on `datiq.saved` triggers dashboard re-fetch | S | M | S | NEW | FR-S-05 |
| S-06 | `src/__tests__/system/payment-cancel.test.jsx` | Razorpay cancel leaves plan unchanged; `PaymentProcessingModal` shows "Back to pricing" | S | M | S | NEW | FR-S-07 |
| S-07 | `src/__tests__/system/demo-mode.test.jsx` | `initiateCheckout` no keys → `{status:"demo_mode"}`; plan upgrades; `datiq.usage` not auto-incremented | S | M | S | NEW | FR-S-06 |

## F. Smoke (Playwright, FR-K-*)

> 23 specs ported from the legacy `e2e-test.mjs`. Each maps to one or more of the 89 historical checks. IDs in the file follow `K-<route>-<nn>`.

| ID | File | Spec | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| K-01 | `e2e/smoke/routes.spec.js` | All 18 routes return 200 (10 checks) | K | M | S | NEW | FR-K-01 |
| K-02 | `e2e/smoke/home.spec.js` | H1, URL input, Extract button, FAB, 5 intent chips, 8 feature cards, no inline multi-URL, TopBar nav, brand text, tagline, footer (12) | K | M | M | NEW | FR-K-01 |
| K-03 | `e2e/smoke/batch.spec.js` | Heading, 4 intent chips, URL textarea, count badge, CSV import, draft persistence (6) | K | M | M | NEW | FR-K-01 |
| K-04 | `e2e/smoke/dashboard.spec.js` | Heading, layout toggle, Export dropdown hidden when empty, batch-runs dropdown left-aligned, Refresh, New extraction, empty state, search hidden (8) | K | M | M | NEW | FR-K-01 |
| K-05 | `e2e/smoke/pricing.spec.js` | 7 plan cards, annual default, Enterprise dashed, Developer "Coming soon" (4) | K | M | S | NEW | FR-K-01 |
| K-06 | `e2e/smoke/account.spec.js` | Heading, batch executions row, content generations row (3) | K | M | S | NEW | FR-K-01 |
| K-07 | `e2e/smoke/contact.spec.js` | 5 enquiry type buttons; `?type=bug` pre-fills subject (2) | K | M | S | NEW | FR-K-01 |
| K-08 | `e2e/smoke/about.spec.js` | Founder block; hero text does not contain "powered by DatIQ" (2) | K | S | S | NEW | FR-K-01 |
| K-09 | `e2e/smoke/blog.spec.js` | Cards visible; click opens PostModal (2) | K | S | S | NEW | FR-K-01 |
| K-10 | `e2e/smoke/privacy.spec.js` | DPDP section; `datiq.app` URL (2) | K | S | S | NEW | FR-K-01 |
| K-11 | `e2e/smoke/terms.spec.js` | Arbitration Act + Bengaluru (2) | K | S | S | NEW | FR-K-01 |
| K-12 | `e2e/smoke/use-cases.spec.js` | 4 cards; subpage renders (2) | K | S | S | NEW | FR-K-01 |
| K-13 | `e2e/smoke/vs.spec.js` | browse-ai + clay render (2) | K | S | S | NEW | FR-K-01 |
| K-14 | `e2e/smoke/integrations.spec.js` | 12 cards (1) | K | S | S | NEW | FR-K-01 |
| K-15 | `e2e/smoke/onboarding.spec.js` | Renders inside Shell (TopBar) (1) | K | S | S | NEW | FR-K-01 |
| K-16 | `e2e/smoke/payment-cancel.spec.js` | "No charge was made" (1) | K | S | S | NEW | FR-K-01 |
| K-17 | `e2e/smoke/topbar.spec.js` | Explore opens; contains 3 sections (3) | K | M | S | NEW | FR-K-01 |
| K-18 | `e2e/smoke/auth.spec.js` | Sign in opens modal in sign-in mode (1) | K | M | S | NEW | FR-K-01 |
| K-19 | `e2e/smoke/mobile.spec.js` | Hamburger at 375 px; nav panel slides down (2) | K | S | S | NEW | FR-K-01 |
| K-20 | `e2e/smoke/theme.spec.js` | Toggle present; light/dark persisted (2) | K | S | S | NEW | FR-K-01 |
| K-21 | `e2e/smoke/footer.spec.js` | Slim single row; Privacy + Terms links (2) | K | S | S | NEW | FR-K-01 |
| K-22 | `e2e/smoke/redirects.spec.js` | `/help/index.html` 200; `/compare` → `/vs/browse-ai` (2) | K | S | S | NEW | FR-K-01 |
| K-23 | `e2e/smoke/admin.spec.js` | PIN input; `ADMIN123` dev fallback; sub-routes load (4) | K | M | S | NEW | FR-K-01 |

## G. Journeys (Playwright, FR-J-*)

| ID | File | Spec | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| J-01 | `e2e/journeys/single-extract-enrich-export.spec.js` | URL → extract → /preview → enrich → reload → tab persists → "View Dashboard" → search → Export ▾ → CSV | J | L | L | NEW | FR-J-01 |
| J-02 | `e2e/journeys/batch-extract-export.spec.js` | FAB → /batch → 5 URLs → Run → results → Export ▾ → JSON | J | L | L | NEW | FR-J-02 |
| J-03 | `e2e/journeys/schedule-create-run.spec.js` | URL → preset "Daily" → /schedules → "Run now" → dashboard shows `kind:"schedule"` | J | L | M | NEW | FR-J-03 |
| J-04 | `e2e/journeys/auth-gating.spec.js` | Guest 3 → soft prompt; 10 → hard block; sign in clears; sign out preserves count | J | L | M | NEW | FR-J-04 |
| J-05 | `e2e/journeys/plan-upgrade-demo.spec.js` | /pricing → "Get Pro" → DemoPaymentModal → confirm → /account shows plan = "pro" | J | M | S | NEW | FR-J-05 |
| J-06 | `e2e/journeys/admin-pin-lifecycle.spec.js` | 5 fails → 60 s lockout; correct PIN unlocks; admin/users → assign coupon | J | M | M | NEW | FR-J-06 |
| J-07 | `e2e/journeys/dashboard-batch-filter.spec.js` | Run a batch → filter → only batch items → clear | J | M | M | NEW | FR-J-07 |
| J-08 | `e2e/journeys/export-format-roundtrip.spec.js` | CSV / MD / JSON parse back to expected shape | J | M | M | NEW | FR-J-08 |
| J-09 | `e2e/journeys/dark-mode-persistence.spec.js` | Toggle dark; across routes; across reload | J | S | S | NEW | FR-J-09 |
| J-10 | `e2e/journeys/empty-state-cta.spec.js` | Clear storage → "Nothing saved yet" → "Extract a page" → / | J | S | S | NEW | FR-J-10 |

## H. Security tests (FR-X-*) — beyond the secret-pattern script

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| X-01 | `src/lib/extractionsRepo.test.js` | PostgREST injection in extraction lookup is rejected (combined with U-56..58) | X | L | S | NEW | FR-X-01 |
| X-02 | `netlify/functions/extractions.test.js` | Authorization-header bypass rejected (combined with C-08) | X | L | S | NEW | FR-X-02 |
| X-03 | `netlify/functions/create-checkout.test.js` | Client-sent `discountPercent` ignored (combined with C-13) | X | L | S | NEW | FR-X-03 |
| X-04 | `netlify/functions/payment-webhook.test.js` | Stripe signature bypass rejected (combined with C-22) | X | L | S | NEW | FR-X-04 |
| X-05 | `netlify/functions/verify-payment.test.js` | Razorpay HMAC bypass rejected (combined with C-17) | X | L | S | NEW | FR-X-05 |
| X-06 | `netlify/functions/admin-auth.test.js` | Admin auth bypass via header injection rejected (combined with C-24) | X | L | S | NEW | FR-X-06 |
| X-07 | `netlify/functions/create-checkout.test.js` | Client-sent `amount` ignored (combined with C-13) | X | L | S | NEW | FR-X-07 |
| X-08 | `src/components/StructuredData.test.jsx` | XSS in user-supplied page data is neutralised (extending existing test) | X | M | S | EXT | FR-X-08 |
| X-09 | `src/pages/Contact.test.jsx` | HTML injection in contact form is escaped | X | S | S | NEW | FR-X-09 |
| X-10 | `src/lib/schedulerService.test.js` | Cron injection in `buildCron({everyHours: -1})` clamped to 1 | X | S | S | NEW | FR-X-10 |
| X-11 | `src/lib/apiClient.test.js` | URL-encoding-safe: no SSRF via path-injected `?url=...` (new) | X | M | S | NEW | FR-X-11 |
| X-12 | `src/lib/webhook.test.js` | URL allowlist check on `notifyWebhook` (only http(s); rejects `file:`, `javascript:`, `data:`) | X | M | S | NEW | FR-X-12 |

## I. Accessibility tests (FR-A-*) — vitest-axe + @axe-core/playwright

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| A-01 | `src/components/TopBar.test.jsx` | vitest-axe: no serious/critical | A | M | S | NEW | FR-A-01 |
| A-02 | `src/components/TopupBundleModal.test.jsx` | vitest-axe | A | M | S | NEW | FR-A-02 |
| A-03 | `src/components/DemoPaymentModal.test.jsx` | vitest-axe | A | M | S | NEW | FR-A-03 |
| A-04 | `src/components/PaymentConfirmModal.test.jsx` | vitest-axe | A | M | S | NEW | FR-A-04 |
| A-05 | `src/components/AuthModal.test.jsx` | vitest-axe | A | M | S | NEW | FR-A-05 |
| A-06 | `src/components/GuestTrialModal.test.jsx` | vitest-axe | A | M | S | NEW | FR-A-06 |
| A-07 | `e2e/a11y/pages.spec.js` | @axe-core/playwright: `/`, `/preview`, `/dashboard`, `/pricing`, `/account`, `/admin` | A | M | M | NEW | FR-A-07 |
| A-08 | `e2e/a11y/keyboard.spec.js` | Tab order on `/`; Enter submits; ArrowDown cycles chips; Esc closes modals; focus return | A | M | S | NEW | FR-A-08 |
| A-09 | `e2e/a11y/contrast.spec.js` | Color contrast passes axe in light and dark | A | M | S | NEW | FR-A-09 |

## J. Visual regression (FR-V-*) — Playwright `toHaveSnapshot`

| ID | File | Snapshot | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| V-01 | `e2e/visual/home.spec.js` | 1280×800 light, dark; 375×812 light | V | S | M | NEW | FR-V-01 / FR-V-02 |
| V-02 | `e2e/visual/preview.spec.js` | 1280×800 with 3 enrichments | V | S | S | NEW | FR-V-03 |
| V-03 | `e2e/visual/dashboard.spec.js` | empty, 5-item, batch-filtered | V | S | M | NEW | FR-V-04 |
| V-04 | `e2e/visual/pricing.spec.js` | annual, monthly, INR | V | S | S | NEW | FR-V-05 |
| V-05 | `e2e/visual/account.spec.js` | free, pro, agency | V | S | S | NEW | FR-V-06 |
| V-06 | `e2e/visual/contact.spec.js` | `?type=bug` pre-filled | V | S | S | NEW | FR-V-07 |
| V-07 | `e2e/visual/admin.spec.js` | after PIN | V | S | S | NEW | FR-V-08 |
| V-08 | `e2e/visual/admin-users.spec.js` | with data | V | S | S | NEW | FR-V-09 |

## K. CI / infra (FR-I-CI-*)

| ID | Where | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| CI-01 | `.github/workflows/quality-gate.yml` | New jobs: `test:contract`, `test:integration`, `test:system`, `test:e2e:smoke`; on `main` only: journeys, a11y, visual | CI | M | S | NEW | FR-I-CI-01 |
| CI-02 | `.github/workflows/quality-gate.yml` | Total CI runtime < 8 min on PR; < 10 min on main | CI | M | S | NEW | FR-I-CI-02 |
| CI-03 | `vite.config.js` | Coverage threshold 80 % on all `src/lib/*.js` (raise from 70 %) | CI | M | S | NEW | FR-I-CI-03 |
| CI-04 | `.github/workflows/quality-gate.yml` | Playwright HTML report + coverage uploaded on every failure | CI | S | S | EXT | FR-I-CI-04 |
| CI-05 | `package.json` | New scripts: `test:contract`, `test:integration`, `test:system`, `test:e2e:smoke`, `test:e2e:journeys`, `test:e2e:a11y`, `test:e2e:visual` | CI | M | S | NEW | FR-I-CI-05 |

## L. Implementation fixes (FR-Z-*)

| ID | Where | Change | Test | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| Z-01 | `src/components/PaymentConfirmModal.jsx` | "Confirm & Pay" calls `initiatePayment` end-to-end (was: parent CTA only) | I-20 | L | S | NEW | FR-Z-01 |
| Z-02 | `src/components/AuthProvider.jsx` + `src/lib/usageService.js` | Once-only 25-extraction trial credit on first signup | U-25 (extension) | L | M | NEW | FR-Z-02 |
| Z-03 | `src/App.jsx` + `src/pages/NotFound.jsx` (new) | `path="*"` catch-all + NotFound page | I-48, K-01 | M | S | NEW | FR-Z-03 |
| Z-04 | `src/lib/adminService.js` | `validateCoupon` returns "This coupon is for admin assignment only." for `planId="manual"` | U-65 | M | S | NEW | FR-Z-04 |
| Z-05 | `src/components/Toast.jsx` | JSDoc for `useToast()` return shape | (doc only) | S | S | NEW | FR-Z-05 |
| Z-06 | `e2e/smoke/*` | Port 89 checks from `e2e-test.mjs` | K-01..23 | L | L | NEW | FR-Z-06 |
| Z-07 | `App.jsx` | New `*` route does not regress existing routing | K-01 | S | S | NEW | FR-Z-07 |

---

## M. New categories (Q9 — "Add all relevant")

> Added 2026-07-15 in response to the user's answer to Q9. Nothing cut from the existing inventory.

### M.1 Browser history / deep-link (BH-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| BH-01 | `e2e/journeys/history-back-forward.spec.js` | Back/forward button preserves Dashboard search filter | J | M | M | NEW | FR-BH-01 |
| BH-02 | `e2e/smoke/deeplink-preview.spec.js` | Direct visit `/preview` with no `datiq.current` → redirects to `/` | K | M | S | NEW | FR-BH-02 |
| BH-03 | `e2e/smoke/deeplink-dashboard.spec.js` | Direct visit `/dashboard` works after sign-in (no demo data; empty state if no saved) | K | M | S | NEW | FR-BH-03 |
| BH-04 | `e2e/smoke/url-params.spec.js` | URL params (e.g. `/contact?type=bug`) are honoured on initial load | K | M | S | NEW | FR-BH-04 |

### M.2 Race conditions (RC-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| RC-01 | `src/__tests__/system/race-signout.test.jsx` | Two `signOut` calls in the same tick → one navigation, one final state | S | M | M | NEW | FR-RC-01 |
| RC-02 | `src/lib/usageService.test.js` (extension) | Rapid plan upgrade from `free` to `select` does NOT double-increment `datiq.usage` | U | M | S | EXT | FR-RC-02 |
| RC-03 | `src/lib/extractionsRepo.test.js` (extension) | Two `saveExtraction` calls in the same tick → two unique ids, both stored | U | M | S | EXT | FR-RC-03 |

### M.3 Time-zone / cron boundaries (TZ-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| TZ-01 | `src/lib/schedulerService.test.js` (extension) | `buildCron` always returns UTC-anchored cron | U | M | S | EXT | FR-TZ-01 |
| TZ-02 | `src/lib/usageService.test.js` (extension) | Month rollover happens at UTC midnight, not local | U | M | S | EXT | FR-TZ-02 |
| TZ-03 | `src/lib/usageService.test.js` (extension) | DST transition (Mar / Nov) does not break the counter | U | M | S | EXT | FR-TZ-03 |
| TZ-04 | `src/lib/schedulerService.test.js` (extension) | `buildCron({frequency:"monthly", dayOfMonth: 30})` clamps Feb 29 → 28 | U | M | S | EXT | FR-TZ-04 |
| TZ-05 | `netlify/functions/scheduled-runner.test.js` (extension) | Runner uses `Date.now()` UTC for "is this due" check | C | M | S | EXT | FR-TZ-05 |

### M.4 Network resilience (NR-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| NR-01 | `src/lib/batchService.test.js` (extension) | Extraction aborts cleanly on `AbortSignal` | U | M | S | EXT | FR-NR-01 |
| NR-02 | `src/lib/extractionsRepo.test.js` (extension) | Save to localStorage succeeds even when `fetch` fails | U | M | S | EXT | FR-NR-02 |
| NR-03 | `src/lib/batchService.test.js` (extension) | Batch continues after a single-URL failure; partial results returned | U | M | S | EXT | FR-NR-03 |

### M.5 i18n / locale (I18N-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| I18N-01 | `src/lib/currencyService.test.js` (extension) | `formatPrice(19, "USD", "en-IN")` = `US$19.00`; `(999, "INR", "en-US")` = `₹999` | U | M | S | EXT | FR-I18N-01 |
| I18N-02 | `src/lib/utils.test.js` (extension) | `formatDate` uses `Intl.DateTimeFormat`; en-GB vs en-US differ | U | M | S | EXT | FR-I18N-02 |
| I18N-03 | `src/lib/utils.test.js` (extension) | `formatNumber(1234.5, "de-DE")` = `1.234,5`; `(1234.5, "en-US")` = `1,234.5` | U | M | S | EXT | FR-I18N-03 |
| I18N-04 | `src/__tests__/system/i18n-concat.test.jsx` | No string concatenation in user-facing copy (grep + assertion) | S | M | S | NEW | FR-I18N-04 |

### M.6 Webhook delivery (WR-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| WR-01 | `netlify/functions/scheduled-runner.test.js` (extension) | Webhook 5xx → resend with backoff | C | M | S | EXT | FR-WR-01 |
| WR-02 | `netlify/functions/scheduled-runner.test.js` (extension) | Duplicate `event_id` is not double-fired | C | M | S | EXT | FR-WR-02 |
| WR-03 | `netlify/functions/scheduled-runner.test.js` (extension) | Webhook failure does not crash the runner | C | M | S | EXT | FR-WR-03 |

### M.7 Cross-browser support (CB-*)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| CB-01 | `playwright.config.js` (test in `e2e/cb-projects.test.js`) | `projects: [chromium, firefox, webkit]` present; default = chromium | Infra | M | S | NEW | FR-CB-01 |
| CB-02 | `package.json` (test in `e2e/cb-projects.test.js`) | `test:e2e:smoke:all-browsers` script exists and runs all three | Infra | M | S | NEW | FR-CB-02 |

### M.8 TopBar label change (Q8)

| ID | File | Test | Type | P | S | Status | Req |
|---|---|---|---|---|---|---|---|
| I-49 | `src/components/TopBar.test.jsx` | "Switch persona" label renders; clicking re-opens onboarding | I | M | S | NEW | FR-Q8-01 |
| F-19 | `src/pages/Onboarding.test.jsx` | "Switch persona" → onboarding opens → persona change persists | F | S | S | NEW | FR-Q8-02 |
| K-24 | `e2e/smoke/topbar-label.spec.js` | UserDropdown shows "Switch persona" (not "Switch Role") | K | S | S | NEW | FR-Q8-03 |

---

## Total counts (updated 2026-07-15)

| Layer | Count |
|---|---|
| Unit (FR-U) | 77 (65 new + 12 extending) |
| Integration (FR-I) | 49 (48 new + 1 extending) |
| Contract (FR-C) | 38 (37 new + 1 kept) |
| Functional (FR-F) | 19 (all new) |
| System (FR-S) | 8 (all new) |
| Smoke (FR-K) | 26 (all new) |
| Journeys (FR-J) | 11 (all new) |
| Security (FR-X) | 12 (5 new + 7 combined) |
| Accessibility (FR-A) | 9 (all new) |
| Visual (FR-V) | 8 (all new) |
| Browser history (FR-BH) | 4 (all new) |
| Race conditions (FR-RC) | 3 (all new) |
| Time-zone / cron (FR-TZ) | 5 (all new) |
| Network resilience (FR-NR) | 3 (all new) |
| i18n (FR-I18N) | 4 (all new) |
| Webhook delivery (FR-WR) | 3 (all new) |
| Cross-browser (FR-CB) | 2 (all new) |
| CI (FR-I-CI) | 5 (all new) |
| Implementation fixes (FR-Z) | 7 (5 new + 2 verification) |
| **Total test IDs** | **277** |
| **Total new test files** | **~150** |
| **Total new code lines (est.)** | **~13 000** |

— End of testing spec. See `05-implementation-plan.md` for the schedule and `06-review-request.md` for the decisions.
