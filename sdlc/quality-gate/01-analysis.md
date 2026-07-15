# 01 — Analysis: Existing State, Gaps, BRD Conflicts, Improvements

> Source: walk-through of `src/`, `netlify/functions/`, `docs/`, `AGENTS.md`, `HELP.md`, `README.md`, `docs/DatIQ-User-Guide.md`, `docs/DatIQ-Developer-API.md`, `docs/internal/DatIQ-Product-Documentation-Internal.md`, the existing test files, the security check, the Playwright config, and the legacy `e2e-test.mjs` + `docs/internal/e2e-test-report-2026-06-16.md`.
>
> Three sections: (A) what's there, (B) what's missing, (C) what should change.

---

## A. What's there today

### A.1 Test surface (existing)

| Layer | Files | Lines | What it covers |
|---|---|---|---|
| **Unit (Vitest, jsdom)** | `src/lib/utils.test.js` | 110 | URL normalization, input classification, URL extraction, email parsing, content fingerprinting, snippet truncation, CSV export, deep JSON flatten |
| | `src/lib/enrichmentStore.test.js` | 60 | Enrichment persistence per URL/capability, merge logic, current-extraction lifecycle, JSON-parse fallback |
| | `src/lib/errorMessages.test.js` | 30 | Friendly error classification across 11 known patterns, fallback behaviour, formatDetail helper |
| | `src/lib/linkCategorizer.test.js` | 30 | Category priority order (email > social > document > media > internal > external), invalid-value handling, CATEGORY_KEYS contract |
| | `src/lib/extractionPresets.test.js` | 30 | 5 quick-action uniqueness, enrichMeta lookup, custom-prompt resolution with whitespace + modes |
| | `src/lib/config.test.js` | 50 | Runtime config flags (Supabase / Firecrawl / webhook / email), build-time vs runtime precedence, provider flag detection |
| | `src/components/StructuredData.test.jsx` | 25 | XSS-safe rendering of arbitrary data, mailto + noopener links |
| **Integration (Vitest, jsdom + mocks)** | `src/components/HeroComposer.integration.test.jsx` | 70 | URL normalization → single extract dispatch; multi-URL → batch route; map intent → `mapMode:true` |
| **Server (Vitest, Node)** | `netlify/functions/lib/publicUrl.test.js` | 35 | SSRF guard: accepts public http(s), rejects localhost / RFC1918 / link-local / IPv6 ULA / cloud metadata IPs / `file:` / `ftp:` / userinfo |
| **Smoke (Playwright, chromium, mocked APIs)** | `e2e/smoke.spec.js` | 25 | Core SPA routes (`/`, `/dashboard`, `/preview` redirect) load without configured integrations |
| **End-to-end (Playwright)** | `e2e/extraction-flow.spec.js` | 50 | Mock extraction → enrich → reload → re-activate tab → view dashboard → search |
| **Security** | `scripts/security-check.mjs` | 170 | Scans tracked files for AWS / GitHub / Stripe / Anthropic / PEM / JWT-shaped secrets; runs `npm audit --omit=dev`; blocks high/critical |
| **CI** | `.github/workflows/quality-gate.yml` | 60 | `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:all` → upload Playwright artifacts on failure |
| **Coverage gate** | `vite.config.js` | — | 70 % lines / functions / statements / branches, scoped to 6 hand-picked `src/lib/*.js` files; 0 % threshold on everything else |
| **Legacy E2E (retired, kept for history)** | `e2e-test.mjs` | 590 | 89 passing checks across Home / Batch / Dashboard / Pricing / Account / Contact / About / Blog / Privacy / Terms / Use cases / VS / Integrations / Onboarding / Payment cancel / TopBar / Auth / Mobile / Theme / Footer / Admin — replaced by Playwright port that has not yet been finished |
| **Coverage snapshot (last run)** | `coverage/coverage-summary.json` | — | Total: 740 lines / 573 covered = **77.4 %** on the 6 included files only |

### A.2 Documentation surface (the "BRD")

| Doc | Audience | Coverage |
|---|---|---|
| `docs/DatIQ-User-Guide.md` (15 sections, 232 lines) | End users, public | WHAT users can do; sanitized of code/DB |
| `docs/DatIQ-Developer-API.md` (9 sections, 174 lines) | Integrators, public | HTTP API spec (extract, ai, extractions CRUD, schedules CRUD, webhooks, exports) |
| `docs/internal/DatIQ-Product-Documentation-Internal.md` (15 sections, 1500+ lines) | Internal / sales / support | Full product + architecture record including data model, env vars, persistence, FAQ |
| `docs/HELP.md` (743 lines) | Stale legacy user guide | Still references "ScrapeLite" branding, old 4-toggle UX (Home v1), and lacks R5–R19 changes. Conflicts with current UI. |
| `AGENTS.md` (356 lines) | AI agents | Code conventions, smoke-test checklist, env, deploy, links to source files |
| `README.md` (962 lines) | Engineers / new contributors | Stack, env, scripts, file map, BRD-derived smoke checklist, outstanding tasks |
| `docs/internal/e2e-test-report-2026-06-16.md` | Internal | Last full E2E run (89 passed, 0 failed) — but the script that produced it (`e2e-test.mjs`) has been replaced by Playwright specs that only cover 2 of those 89 paths |

### A.3 Source surface (what tests must cover)

| Area | Files | LOC | Tested today |
|---|---|---|---|
| `src/lib/` (services) | 29 .js files | ~5,500 | 7 unit / 1 integration = 8 files covered; 21 files at 0 % |
| `src/components/` (UI) | 26 .jsx files | ~4,800 | 2 covered; 24 at 0 % |
| `src/pages/` (routes) | 24 .jsx files | ~3,500 | 0 covered |
| `src/data/` (fixtures) | 1 file | ~400 | 0 covered (used by mocks) |
| `netlify/functions/` (server) | 13 files | ~1,800 | 1 covered; 12 at 0 % |
| `scripts/` (ops) | 8 files | ~700 | security-check.mjs exercised manually |

### A.4 Test infra (existing)

- **Vitest 2.1.9** + `@testing-library/react 16.3.2` + `jsdom 25.0.1`
- **Playwright 1.60.0** + chromium only; `webServer` runs `npm run dev` on port 4173
- **Mock boundary** (`e2e/support.js`): intercepts `/api/*`, `runtime-config.js`; never reaches real Firecrawl/Supabase/AI/webhook/email
- **Coverage provider:** v8, scoped to 6 `src/lib/*.js` files
- **Pre-merge gate:** `npm run test:all` (vitest + build + playwright + security)

---

## B. Gaps — what's missing (test-by-layer)

For each layer I list: current state → gap → testable surface I propose to add. The full inventory is in `04-testing-spec.md`; this is the executive view.

### B.1 Unit (Vitest)

| Surface | Today | Gap | What I'll add |
|---|---|---|---|
| `src/lib/utils.js` | 54 % lines / 60 % fns | `extractionsToMarkdown`, `extractionsToJson`, `markdownDownload`, `jsonDownload`, `parseUrlsFromCsv`, `parseUrlsFromText`, `extractionsToPdf` (lazy import — needs `vi.mock` of `jspdf`) | Full unit coverage on every export |
| `src/lib/pricingMath.js` | not tested | `computeCharge` (base, GST, coupon, global-discount) | Pure-function test on all branches (INR w/ GST, USD no-GST, monthly, annual, bundle) |
| `src/lib/currencyService.js` | not tested | `detectCurrency` timezone-first, `convertPrice` rates, `formatPrice` Intl.NumberFormat output | Tests for IN timezone → INR, US → USD, GB → USD (per current rules), symbol prefix, no-conversion for INR-fixed prices |
| `src/lib/pricingConfig.js` | not tested | `PLANS`, `ENTERPRISE_PLAN`, `TOPUP_BUNDLES` structural integrity | Schema test: every plan has required fields, every limit is a non-negative integer, exports list is subset of `["csv","pdf","markdown","json"]`, `email_export` boolean |
| `src/lib/pricingOverrides.js` | not tested | `getEffectivePlans` / `getEffectivePlanById` / `getGlobalDiscount` / `applyGlobalDiscount` / `setPlanOverride` / `resetOverrides` | Override-applied vs base tests; idempotence; corrupt localStorage recovery |
| `src/lib/usageService.js` | not tested | `canExtract`, `canEnrich`, `canExport`, `canEmailExport`, `canBatch`, `canExtractBatch`, `incrementExtractions`, `incrementEnrichments`, `incrementBatchRuns`, `incrementContentGenerations`, `readUsage`, `readSubscription` | Boundary tests at 0 / 1 / limit / limit+1; Infinity plan; bonus URL addition; month rollover |
| `src/lib/batchService.js` | not tested | `parseUrlsFromCsv` (newline, quoted fields, embedded commas), `parseUrlsFromText`, `runBatch` (concurrency, partial failure, _status/_error injection) | CSV-parser cases; concurrency=3 verified via timing mock; partial-failure shape |
| `src/lib/batchRunsService.js` | not tested | `saveBatchRun`, `listBatchRuns`, `deleteBatchRun`, `recordBatchItems`, `readBatchMap`; 50-run cap | Cap enforcement; ordered by createdAt desc; stale map cleanup |
| `src/lib/schedulerService.js` | not tested | `SCHEDULE_PRESETS`, `buildCron` (hourly/daily/weekday/weekly/monthly), `presetByKey`, localStorage CRUD, Supabase sync fallback | Cron-string snapshots; 50-schedule cap; corruption recovery |
| `src/lib/personaConfig.js` | not tested | `PERSONAS` (7), `PERSONA_BY_ID`, `getPersonaById` | 7 personas have required fields, ids unique, fallback returns sensible default |
| `src/lib/emailService.js` | not tested | `sendExtractionsEmail` (webhook → email API → mailto chain) | Each path; webhook down → mailto; recipient parse error |
| `src/lib/webhook.js` | not tested | `notifyWebhook` (fire-and-forget) | Payload shape, fetch called with right method/headers/body |
| `src/lib/migrationService.js` | not tested | `runMigrations` scrapelite.* → datiq.* copy | Idempotence; missing-key skip; corruption skip |
| `src/lib/authService.js` | not tested | `signUpWithEmail` (redirectTo), `signInWithEmail`, `signInWithOAuth`, `signOut` | All paths via mocked supabaseClient |
| `src/lib/emailCaptureService.js` | not tested | `captureEmail` dedupe + webhook fire-and-forget | localStorage dedupe; webhook 200/non-200/throw all handled |
| `src/lib/guestTrialService.js` | not tested | `getGuestCount`, `incrementGuestCount`, `shouldShowTrialPrompt`, `isTrialLimitReached`, `isSingleHardLimitReached`, `isBatchHardLimitReached` (with overridden settings) | Counter advance; soft-prompt re-prompt interval; hard-limit hit from cold start |
| `src/lib/globalSettingsService.js` | not tested | `getSettings` (sync), `loadSettings` (async, 5-min TTL cache), `updateCachedSettings` | TTL expiry; merged DEFAULTS; API failure → cache fallback |
| `src/lib/extractionsRepo.js` | not tested | `listExtractions`, `saveExtraction`, `updateEnrichments`, `deleteExtraction`; localStorage fallback on 401/403/404/500 | API path mocked; fallback on each status code; `_status`/`_error` stripped before send |
| `src/lib/paymentService.js` | not tested | `initiateCheckout` Stripe / Razorpay / demo; `verifyPayment`; pending-payment TTL; `PAYMENT_STAGE` transitions | Status-machine transitions; demo_mode path; pending TTL expired |
| `src/lib/paymentRepo.js` | not tested | Supabase subscription + payment_events sync; idempotent on retry | Upsert idempotence; missing-table fallback |
| `src/lib/paymentConfig.js` | not tested | `hasPayment`, `getPaymentProvider`, `PROVIDER_META` | Auto / override / no-keys paths |
| `src/lib/adminService.js` | not tested | `adminLogin`, `adminLogout`, `isAdminAuthed`, `applyCoupon`, `redeemCoupon`, `validateCoupon` (blocks manual-only) | Legacy boolean token rejection; expiry eviction; manual-only coupon blocked from self-apply |
| `src/lib/adminConfigService.js` | not tested | `getAiConfig`, `saveAiConfig`, `getRevenueData`, `fetchRealUsers`, `assignUserCoupon` | Auth-gate path; response normalisation |
| `src/lib/statsService.js` | not tested | `getStats` (5-min cache); null on fetch failure; refresh | TTL hit; TTL miss; null on 5xx; null on missing keys |
| `src/lib/supabaseClient.js` | not tested | Returns `null` when env unset; `createClient` when set | Both branches |

**Total new unit-test files planned: 24** (one per uncovered lib).

### B.2 Integration (Vitest + mocks)

| Surface | Today | Gap |
|---|---|---|
| `HeroComposer` | 3 specs | Add: paste-anything (raw text), schedule preset, Batch toggle on/off, "Custom" intent shows prompt |
| `BillingProvider` | 0 | `initiatePayment` → confirm modal → DemoPaymentModal (no keys) → upgrade; cancel → no change; Razorpay error → `retryPayment()` works |
| `GuestTrialProvider` | 0 | First 3 extractions → soft prompt; dismiss → 2 more → re-prompt; 10th → hard block; reload on hard-block state → block re-mounts; logout → SENSITIVE_KEYS cleared, `datiq.guestTrial` preserved |
| `ExtractionProvider` | 0 | `extract()` success → saved; 401/404/500 → localStorage fallback; pre-flight `checkCanExtractSingle` blocks guest hard-limit without dispatching extract |
| `Toast` / `ErrorModal` / `AuthProvider` | 0 | `useToast()` returns function (R4 fix); error modal opened by `useErrorModal.show()`; auth hash-error cleanup on `?error=` |
| `TopupBundleModal` | 0 | qty 1→10; per-bundle price; total price; CTA label; upsell plans (price_usd > current); INR pricing per `isINR`; backdrop click closes |
| `PaymentConfirmModal` | 0 | Base + 18 % GST + total breakdown; INR and USD; "Confirm & Pay" → `initiatePayment`; "Cancel" → no-op |
| `DemoPaymentModal` | 0 | `confirmDemoPayment` → plan upgrades + `datiq.usage` increments; `cancelDemoPayment` → no change; `Esc`/backdrop → no change |
| `TopBar` | 0 | Auth-gated UserDropdown (R2); Explore dropdown opens on click; mobile `<600 px` → hamburger; persona dot color matches persona |
| `Batch.jsx` (page) | 0 | `pasteText` initialised from `location.state.urls` || `datiq.batchDraft`; "New batch" clears draft; `trackGuestBatchRun` only after completion; pre-flight `checkCanExtractBatch` |
| `Home.jsx` (page) | 0 | OG-preview debounce 800 ms; OG success → card visible; OG failure → no card; "Custom" intent → textarea appears; FAB → `/batch`; empty URL → validation error; guest trial prompt fires at 4th attempt |
| `Dashboard.jsx` | 0 | localStorage-first load (no spinner when `datiq.saved` present); empty state with "Extract a page" CTA; Refresh fetches API; batch-filter narrows to `batchMap.current[it.id]`; group-by collapse (Batch / Schedule); Export ▾ dropdown opens above table |
| `Preview.jsx` | 0 | Download ▾ shows CSV/PDF/MD/JSON; "View Dashboard" primary; "Delete" removes extraction and returns home; "Generate content" tab opens ContentModal |
| `Schedules.jsx` | 0 | Editor shows all presets; custom cadence builder produces expected cron; "Run now" creates a tagged extraction; Pause/Resume toggle persists |
| `Schedules.jsx` `ScheduleEditor` | 0 | cadence builder inputs emit the right `cron`; "Run until" optional date; alert email validation |
| `Account.jsx` | 0 | Plan name; usage stats (extractions, enrichments, batchRuns, contentGenerations); coupon input; `LAUNCH20` apply → reflected in plan; payment history table |
| `Pricing.jsx` | 0 | Annual default; toggle changes prices; INR prices (₹999 / ₹1,499 / …) when currency INR; Developer card disabled; Enterprise card "Contact sales" mailto; current plan = green ring + "Your plan" badge; hover state on non-current plans |
| `Onboarding.jsx` | 0 | Persona selection persists; skip → still navigates home |
| `Contact.jsx` | 0 | `?type=bug` pre-selects "Bug report" + pre-fills subject; mailto opens on submit |
| `AuthModal.jsx` | 0 | "Sign in" tab default; "Create account" tab default; error display; OAuth buttons |
| `AdminLayout.jsx` | 0 | PIN gate server-side via `admin-auth`; lockout after 5 fails; sidebar collapse + pin; mobile horizontal bar |
| `AdminRevenue.jsx` | 0 | Loading state; live KPIs from `getRevenueData`; Refresh button; warning when from seed |
| `AdminPricing.jsx` | 0 | Plan edit form; USD + INR fields; GST hint; bundle editor; "Generate SQL" panel emits correct SQL |
| `AdminUsers.jsx` | 0 | Real Supabase users; assign-coupon modal opens; preview row; Assign persists in `coupon_redemptions` |
| `AdminCoupons.jsx` | 0 | `planId="manual"` shows purple "Manual assign" pill; manual-only coupons blocked in self-apply |

**Total new integration test files planned: 25.**

### B.3 Contract (Netlify Function — server side, Vitest Node)

There is **no contract test for any `/api/*` function today.** This is the most acute gap, because the API surface is what the rest of the app integrates against, and the security of the payment functions in particular depends on it.

For each function I will add: (1) auth-gate test (if gated), (2) happy-path response-shape test, (3) error-shape test, (4) input-validation test (where the function accepts user input), (5) RBAC / RLS test where relevant.

| Function | Test scope |
|---|---|
| `extract.js` | Public. URL passed to `validatePublicHttpUrl`; provider chain called; success response shape; provider-error response shape; SSRF rejected (via publicUrl) |
| `ai.js` | Public but token-bound. Multi-provider chain; per-provider model from `loadAiConfig`; `max_tokens` honoured; 503 when no key; Anthropic shape normalization |
| `extractions.js` GET | Auth-bound. RLS-aware: with service key returns all rows; with anon key returns only session's rows; 401 when no auth; 503 fallback-friendly (note: client must already handle this) |
| `extractions.js` POST | Required fields; unknown columns stripped; `_status`/`_error` removed; `custom_extraction` / `domain_map` / `enrichments` accepted |
| `extractions.js` PATCH | Only allowed fields merged; bad id → 404 |
| `extractions.js` DELETE | Idempotent; 404 for missing |
| `create-checkout.js` | Plan + currency + billing period resolution; `INVALID_PROVIDER`, `UNKNOWN_PLAN`, `AMOUNT_TOO_SMALL`, `RAZORPAY_NOT_CONFIGURED`, `STRIPE_NOT_CONFIGURED` error codes; coupon `cap_reached` / `already_redeemed` drop to global; `pricing_config` overrides used; 18 % GST added on INR |
| `verify-payment.js` | Stripe: signature verified; success path; bad signature → 400. Razorpay: HMAC verified with `timingSafeEqual`; bad sig → 400; `authorized` → captured; `captured` → `verified:true`; order_id mismatch → reject |
| `payment-webhook.js` | Both providers; duplicate `provider_event_id` ignored; `payment.failed` does not activate; DB write failure → still 200 (prevent gateway retry) |
| `admin-auth.js` | Correct PIN (hash match) → token; wrong PIN → 401; demo mode flag returned; rate-limit 5/min/IP (when env set) |
| `admin-ai-config.js` | GET → config + key presence (no secrets); POST → token-gated; `loadAiConfig` reads merged value |
| `admin-general-config.js` | GET merges DEFAULTS + saved; POST sanitises integer ranges; token-gated; localStorage fallback path |
| `admin-revenue.js` | Live KPIs; INR paise→USD at 83.5; warning when Supabase unconfigured |
| `admin-users.js` | GET planStart/planEnd/couponAvailed; PATCH `assign_coupon` writes both `auth.users.user_metadata` and `coupon_redemptions`; service key required |
| `stats.js` | Public, 5-min CDN cache. Distinct sessions; sum extractions; 0 when empty; null when Supabase missing |
| `og-preview.js` | Public, 5-min CDN cache. First 15 KB; og:title / og:description / `<title>` / meta description parsed; hostname normalisation; favicon URL |
| `schedules.js` GET | Auth-bound. Per-user session_id scope; 503 fallback-friendly |
| `schedules.js` POST | Required fields; cron validated (5-field) |
| `schedules.js` DELETE | Idempotent |
| `scheduled-runner.js` | Netlify Scheduled Function. Reads active+due schedules; skips expired; re-runs extraction; change detection via `hashContent`; alert webhook fires on change; never throws 5xx |
| `lib/aiProviders.js` | `runChain` tries providers in order; skips disabled; skips missing-key; 502 when all fail |
| `lib/scrapeProviders.js` | `runScrapeChain` order respected; provider-ok short-circuits; provider-error continues; `runMapChain` shape |
| `lib/pricingSource.js` | `loadPricing` static-then-operator merge; 60-s cache; missing config row → static |
| `lib/adminToken.js` | `verifyAdminToken` accepts valid token; rejects tampered; rejects expired; rejects missing |

**Total new contract-test files planned: 21** (one per function + per lib helper).

### B.4 Functional (Vitest + jsdom for pages, + node for functions)

Functional tests verify "the page delivers the user-visible outcome", as a step above unit. Today we have 0. I'll add a "page functional" suite for each route that exercises the user-facing happy path with mocked services and `MemoryRouter` (no real network).

| Route | Functional test |
|---|---|
| `/` (Home) | Empty input → submit disabled / error; valid URL → extract → /preview; batch list → /batch; custom prompt → AI route |
| `/preview` | Loads extraction from `datiq.current`; no extraction → redirect `/`; enrichment tabs click → load tab data; "Delete" → removes and returns `/` |
| `/dashboard` | Empty → "Nothing saved yet" + CTA; non-empty → table or cards; search filter; "Refresh" |
| `/batch` | Empty textarea → run disabled; ≥1 URL → run enabled; intent chip selected; "New batch" clears |
| `/schedules` | List empty state; create flow; edit flow; "Run now" creates an extraction; delete |
| `/pricing` | Annual default; 7 plan cards; 4 monthly/annual toggle; INR when currency INR; "Contact sales" on Enterprise |
| `/account` | Plan name; usage stats; coupon apply; payment history |
| `/onboarding` | Persona selection persists; skip |
| `/contact` | 5 enquiry types; required fields; submit → mailto |
| `/about`, `/blog`, `/privacy`, `/terms`, `/use-cases`, `/use-cases/:slug`, `/vs/browse-ai`, `/vs/clay`, `/integrations` | Renders without throwing; key content present (DPDP, founder block, comparison table, etc.) |
| `/admin` (and 5 sub-routes) | PIN gate; success → admin shell; each sub-route loads; sidebar collapse |

**Total new functional-test files planned: 18.**

### B.5 System (Vitest + jsdom + MemoryRouter + Provider tree)

System tests mount the **real provider tree** (Theme → Toast → ErrorModal → Auth → GuestTrial → Persona → Billing → Extraction → Router) and verify cross-cutting behaviour that no single component owns.

| System test | What it verifies |
|---|---|
| Logout flow | After `useAuth.signOut()`, all 7 SENSITIVE_KEYS are removed, `datiq.guestTrial` is preserved, app navigates to `/` |
| Hard-block on page reload | Visit `/` with `datiq.guestTrial.count >= SINGLE_HARD_LIMIT` in localStorage → hard-block modal mounts on first render |
| Sign-in bypass prevention | `useAuth.signIn` does NOT clear `datiq.guestTrial`; soft/hard prompt re-evaluates with current counts |
| Plan upgrade → usage reset? | After upgrading from `free` to `select`, `datiq.usage` is NOT reset (counts carry over) |
| Cross-tab localStorage sync | `storage` event on `datiq.saved` re-fetches dashboard |
| Currency detection (timezone) | `Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata"` → `detectCurrency() === "INR"`; `America/New_York` → `USD` |
| `paymentService` demo mode | `initiateCheckout` with no keys → `{status:"demo_mode"}`; `BillingProvider` upgrades plan; `datiq.usage` not auto-incremented |
| `paymentService` cancel | User dismisses Razorpay → `status:"cancelled"`; plan unchanged; `PaymentProcessingModal` shows "Back to pricing" |

**Total system test files planned: 6.**

### B.6 Smoke (Playwright)

Today's `e2e/smoke.spec.js` has **one test** (3 route checks). The previous `e2e-test.mjs` had **89 checks** (full happy path). I will port the 89 checks into Playwright specs organised by page, keeping the offline-mock boundary.

| New smoke spec | Checks (≈) |
|---|---|
| `e2e/smoke/routes.spec.js` | `/`, `/dashboard`, `/preview` redirect, `/pricing`, `/account`, `/onboarding`, `/contact`, `/about`, `/blog`, `/privacy`, `/terms`, `/use-cases`, `/vs/browse-ai`, `/vs/clay`, `/integrations`, `/help/index.html` HTTP 200 (10) |
| `e2e/smoke/home.spec.js` | H1, URL input, Extract button, FAB "Bulk import", 5 intent chips, 8 feature cards, no inline multi-URL, TopBar nav order, brand text, tagline, footer slim (12) |
| `e2e/smoke/batch.spec.js` | Heading, 4 intent chips, URL textarea, count badge, CSV import tab, draft persistence (6) |
| `e2e/smoke/dashboard.spec.js` | Heading, layout toggle, Export dropdown hidden when empty, batch-runs dropdown left-aligned, Refresh, New extraction, empty state, search hidden when empty (8) |
| `e2e/smoke/pricing.spec.js` | 7 plan cards, annual default, Enterprise dashed, Developer "Coming soon" (4) |
| `e2e/smoke/account.spec.js` | Heading, batch executions row, content generations row (3) |
| `e2e/smoke/contact.spec.js` | 5 enquiry type buttons, `?type=bug` pre-fills subject (2) |
| `e2e/smoke/about.spec.js` | Founder block visible, hero text does not contain "powered by DatIQ" (2) |
| `e2e/smoke/blog.spec.js` | Cards visible, click opens PostModal overlay (2) |
| `e2e/smoke/privacy.spec.js` | DPDP section present, URL is `datiq.app` (2) |
| `e2e/smoke/terms.spec.js` | Arbitration Act + Bengaluru mention (2) |
| `e2e/smoke/use-cases.spec.js` | 4 cards; subpage renders (2) |
| `e2e/smoke/vs.spec.js` | browse-ai and clay render (2) |
| `e2e/smoke/integrations.spec.js` | 12 cards visible (1) |
| `e2e/smoke/onboarding.spec.js` | Renders inside Shell (TopBar present) (1) |
| `e2e/smoke/payment-cancel.spec.js` | "No charge was made" (1) |
| `e2e/smoke/topbar.spec.js` | Explore dropdown opens; contains "About DatIQ" / "Contact Us" / "Compare Tools" (3) |
| `e2e/smoke/auth.spec.js` | Sign in opens modal in sign-in mode (1) |
| `e2e/smoke/mobile.spec.js` | Hamburger visible at 375 px; nav panel slides down (2) |
| `e2e/smoke/theme.spec.js` | Toggle present; light/dark persisted via `data-theme` (2) |
| `e2e/smoke/footer.spec.js` | Slim single row; Privacy + Terms links (2) |
| `e2e/smoke/redirects.spec.js` | `/help/index.html` 200, `/compare` → `/vs/browse-ai` (2) |
| `e2e/smoke/admin.spec.js` | PIN input, `ADMIN123` dev fallback, `/admin/*` sub-routes load (4) |

**Total smoke test files planned: 23** (≈80 assertions; the previous 89 minus the 9 checks that were Playwright-impossible like "rate-limit backoff").

### B.7 End-to-end (Playwright with mocked `/api/*`)

Today: 1 happy-path spec. I will add per-user-journey specs that exercise multi-step flows.

| Journey spec | Steps |
|---|---|
| `e2e/journeys/single-extract-enrich-export.spec.js` | `/` → extract → /preview → enrich (contacts) → reload (tab persists) → re-activate tab → "View Dashboard" → search → select row → Export ▾ → CSV download captured |
| `e2e/journeys/batch-extract-export.spec.js` | `/` → FAB → /batch → paste 5 URLs → Run → progress → results → Export ▾ → JSON download captured |
| `e2e/journeys/schedule-create-run.spec.js` | `/` → paste URL → preset "Daily" → /schedules → "Run now" → /dashboard shows the scheduled extraction with `kind:"schedule"` |
| `e2e/journeys/auth-gating.spec.js` | Guest → 4th extraction → soft prompt appears; "Continue as guest" → 2 more → re-prompt; 10th → hard block; Sign in (mocked) → block clears; Sign out → SENSITIVE_KEYS cleared, guest count preserved |
| `e2e/journeys/plan-upgrade-demo.spec.js` | /pricing → click "Get Pro" → DemoPaymentModal → confirm → /account → plan = "pro" |
| `e2e/journeys/admin-pin-lifecycle.spec.js` | /admin → 5 wrong PINs → "Locked for 60 s" countdown; reload → still locked until expiry; correct PIN → admin shell; admin/users → assign coupon (mocked) → row shows coupon pill |
| `e2e/journeys/dashboard-batch-filter.spec.js` | Run a batch (mocked) → /dashboard → batch-runs dropdown → click run → filter banner appears → only batch items visible → "Clear filter" |
| `e2e/journeys/export-format-roundtrip.spec.js` | /preview → Download ▾ → CSV; parse CSV → has 4 expected rows; Download ▾ → Markdown; contains "# Title" and "## Pricing"; Download ▾ → JSON; parses back to same shape |
| `e2e/journeys/dark-mode-persistence.spec.js` | /pricing → toggle dark → /dashboard (still dark) → reload (still dark) → /pricing (still dark) |
| `e2e/journeys/empty-state-cta.spec.js` | Clear localStorage → /dashboard → "Nothing saved yet" + "Extract a page" button → click → / |

**Total journey spec files planned: 10** (≈60 assertions).

### B.8 Security (functional, beyond `scripts/security-check.mjs`)

`security-check.mjs` covers: secret patterns in tracked files, `npm audit --omit=dev` high/critical blocking. It does **not** test:

| Test | Source of test |
|---|---|
| SSRF via `validatePublicHttpUrl` (already covered) | ✅ existing |
| SQL/PostgREST injection in extraction lookup | new unit test against `extractions.js` handlers |
| `Authorization` header bypass (R3 privacy note: anon key should not read other users' rows) | new contract test |
| Coupon tampering — client sending `discountPercent` directly | new contract test on `create-checkout.js` (R11 R12) |
| Stripe webhook signature bypass | new contract test on `payment-webhook.js` |
| Razorpay HMAC bypass (timing attack) | new contract test on `verify-payment.js` |
| Admin auth bypass via header injection | new contract test on `admin-auth.js` |
| Pricing-amount tampering — client-sent `amount` ignored | new contract test on `create-checkout.js` |
| XSS in user-supplied page data (e.g. extracted `<title>`) | new unit test on `StructuredData.jsx` (already partial) + `parseHtml` |
| HTML injection in contact form | new unit test on `Contact.jsx` |

**Total security test files planned: 4.**

### B.9 Accessibility (Vitest + jest-axe + Playwright axe)

**There are zero accessibility tests today.** This is a real gap for a public product that takes DPDP seriously and serves B2B.

| Test type | Tooling | Targets |
|---|---|---|
| Component a11y (Vitest) | `@testing-library/jest-dom` + `axe-core` via `vitest-axe` | TopBar, TopupBundleModal, DemoPaymentModal, PaymentConfirmModal, AuthModal, GuestTrialModal, ScheduleEditor, Tabs (enrichment), Pricing cards, Account forms, Contact form, Footer |
| Page a11y (Playwright) | `@axe-core/playwright` on representative routes | `/`, `/preview`, `/dashboard`, `/pricing`, `/account`, `/admin` |
| Keyboard nav | Manual script + Playwright keyboard API | Tab order on Home composer; Enter to submit; ArrowDown for chips; Escape closes modals; focus return after modal close |
| Color contrast | axe-core rules | Light + dark themes |
| Screen reader labels | axe-core rules + role assertions | `aria-label`, `aria-expanded`, `aria-haspopup`, `aria-selected`, `role="listbox"` / `"option"` / `"tab"` / `"tablist"` |

**Total a11y test files planned: 7** (3 component a11y, 3 page a11y, 1 keyboard-nav).

### B.10 Visual regression (Playwright `toHaveScreenshot`)

**No visual regression today.** A handful of stable pages deserve snapshot coverage because they are the public face of the brand.

| Page | Viewports | Snapshots |
|---|---|---|
| `/` (Home) | 1280×800, 375×812 | light + dark, intent chip variations |
| `/preview` | 1280×800 | with 3 enrichments |
| `/dashboard` | 1280×800 | empty, with 5 items, batch-filtered |
| `/pricing` | 1280×800 | annual default, monthly, INR currency |
| `/account` | 1280×800 | free, pro, agency |
| `/contact?type=bug` | 1280×800 | pre-filled |
| `/admin` | 1280×800 | after PIN |
| `/admin/users` | 1280×800 | with data |

**Total visual-snapshot files planned: 8** (≈32 snapshots, all baseline-on-first-run).

---

## C. BRD-vs-implementation conflicts and confusing behaviour

This is the "from a user's point of view" audit. For each, I name the file, the line, what the user expects, what the code does, and the proposed fix. None of these are test cases; they are findings that need a confirmation + a test.

### C.1 Help docs drift (R5–R19 not documented in public help)

- **What `docs/DatIQ-User-Guide.md` says:** 15 sections covering Extract / Preview / Dashboard / Enrichment / Export / Plans / Accounts / Privacy / FAQ.
- **What the implementation does since R5:** added Batch (`/batch`), Schedules (`/schedules`), TopupBundleModal, PaymentConfirmModal, DemoPaymentModal, GuestTrialBanner + GuestTrialModal.
- **What the user sees:** 15 sections but no mention of Batch, Schedules, Trial gate, Demo payment, Bundle top-up.
- **Fix:** regenerate `public/help/` (already automated by `node docs/build-help.mjs`). Add sections 8 (Scheduling & change monitoring) and update section 7 (Batch extraction). Verified by Playwright smoke that the static help page contains the new section titles.

### C.2 Stale `HELP.md` (root-level)

- `HELP.md` still references "ScrapeLite" branding in some places, the old 4-toggle UX (Home v1), and lacks R5–R19 changes.
- **Fix:** either delete `HELP.md` and link the public help from the README, or rebuild it from the same source as `docs/DatIQ-User-Guide.md`. I recommend delete + README link (less drift). Flagged in `06-review-request.md`.

### C.3 `docs/HELP.md` versus `docs/DatIQ-User-Guide.md`

- Two near-duplicate user guides with different content. The newer one (`DatIQ-User-Guide.md`) is correct.
- **Fix:** same as C.2.

### C.4 `useToast()` return shape ambiguity (R4 fix)

- `useToast()` returns the function directly, not `{ showToast }`. The R4 commit (CLAUDE.md item 42) calls this out as a recurring footgun.
- **What's in the code today:** `Contact.jsx` uses `const showToast = useToast()`. Some new components may not.
- **Fix:** add a contract test on `Toast.jsx` that asserts the return shape; add a JSDoc `@returns`; add a runtime `if (typeof useToast !== 'function') throw` for safety.

### C.5 `PaymentConfirmModal` confirm step doesn't actually call `initiatePayment` (CLAUDE.md outstanding)

- The modals exist but the wiring is partial — `PaymentConfirmModal`'s "Confirm & Pay" doesn't call `initiatePayment` end-to-end.
- **What's in the code today:** the parent CTA click still triggers the actual call.
- **Fix:** wire it (with a flag) and add a system test for the wired-up path. Flagged in `06-review-request.md`.

### C.6 `AdminUsers` plan pill via `PLAN_BY_ID` (R10 fix)

- Already fixed in R10. ✓ No action.

### C.7 `e2e-test.mjs` retired but no Playwright equivalent

- The 89-check legacy script is the de-facto E2E coverage; the new Playwright suite has 2 specs. 87 of those checks are not in CI.
- **Fix:** port them as Playwright specs in this initiative (B.6 above).

### C.8 Free-tier "trial credit" config exists but grant is not wired

- `pricingConfig.js` declares `trialCredit: 25` on Free. The user-facing message shows the credit. The actual grant to `usageService` is not wired (CLAUDE.md "Outstanding tasks").
- **Fix:** wire in `AuthProvider` (post-signup) or `BillingProvider` (first extraction). Add a unit test. Flagged in `06-review-request.md`.

### C.9 `Blog` posts have no SEO-indexable URLs

- `Blog.jsx` opens an in-page `PostModal` on card click; no `/blog/:slug` route. CLAUDE.md "Outstanding tasks" lists this.
- **Fix:** add a route + content source, link from cards. Smoke test that `/blog/:slug` returns 200 with title and content. Flagged in `06-review-request.md`.

### C.10 `e2e-test.mjs` references `e2e-screenshots/` write path that doesn't exist in the new layout

- The legacy script writes to `/home/user/scrapelite/e2e-screenshots`. The new directory `e2e-screenshots/` exists at the project root and is empty.
- **Fix:** use the new path in all new Playwright specs (B.6, B.10).

### C.11 `pricingConfig.js` `CURRENCIES = ["USD", "INR"]` — but `convertPrice` still supports legacy

- `currencyService.js` has `DEFAULT_RATES = { USD:1, INR:83.5 }`. No other currencies remain. The `convertPrice` function still accepts other codes via `getRateFor`. This is dead code.
- **Fix:** trim `currencyService.js` to USD + INR only and add a unit test that confirms unknown currencies fall back to USD.

### C.12 `useToast` vs `useErrorModal` asymmetry

- Toast is a fire-and-forget notification; `ErrorModal` is a blocking modal. There is no clear rule in code for when to use which. `errorMessages.classifyError` produces a `{ title, body, canRetry }` shape; some call sites render it as a toast, some as a modal.
- **Fix:** standardize in the design doc; add tests for both paths.

### C.13 No 404 page for unknown routes

- `App.jsx` does not declare a catch-all `<Route path="*" />`. Unknown URLs are handled by Vite's SPA fallback to `index.html`, which then renders Home (since `/` matches the wildcard). The user gets a 200 with Home content, not a 404.
- **Fix:** add a `NotFound` page + route; smoke test that `/totally-bogus` renders it. Flagged in `06-review-request.md`.

### C.14 `useToast()` declared but never imported in some pages

- A few pages import `Toast` for the provider but never call `useToast`. Functionally fine but dead.
- **Fix:** remove the unused import (cosmetic); add a small linter rule via ESLint later (out of scope for this initiative).

### C.15 `PersonaProvider` "Switch Role" is in the TopBar UserDropdown but the persona list is fixed at 7

- There is no "edit personas" admin screen. The user can re-pick from the same 7. Fine as-is, but the label "Switch Role" suggests there are roles to switch between that aren't personas.
- **Fix:** rename to "Switch persona" or "Re-take onboarding" (proposed). Flagged in `06-review-request.md`.

### C.16 Stripe is "on hold" but `paymentConfig.js` still has Stripe fields

- `paymentConfig.js` exposes `STRIPE_PRICE_IDS` constants. `create-checkout.js` supports both providers. `Razorpay` is the live path; `Stripe` is wired but not used.
- **Fix:** add a test that `getPaymentProvider` returns `"razorpay"` for INR and `"stripe"` for USD; add a test that with no keys, `initiateCheckout` returns `{status:"demo_mode"}`. No production change required.

### C.17 `pricing_config` table changes are operator-managed, not via API

- Server has no public write endpoint. Admin UI edits localStorage for display; SQL must be applied manually. CLAUDE.md "Razorpay hardening" calls this out.
- **Fix:** this is by design; no code change. The "Generate SQL" panel in `AdminPricing.jsx` already exists. Add a test that the emitted SQL is valid (parses) and matches the form state.

### C.18 Coupon with `planId="manual"` is admin-assign only but the doc does not say so

- `adminService.validateCoupon` blocks self-apply with a generic error. CLAUDE.md items 29/55 call this out.
- **Fix:** add a user-facing error message: "This coupon is for admin assignment only." (one line in `validateCoupon`). Add a unit test. Flagged in `06-review-request.md`.

---

## D. Improvement list (best-practice audit, user-perspective)

Improvements are split into **(I)** "should ship as part of this initiative" (a few hours each) and **(II)** "backlog, separate work".

### D.1 Ship as part of this initiative

| # | Improvement | Why | Effort |
|---|---|---|---|
| I-1 | ESLint config (none today; `package.json` has no `lint` script) | Lint catches the common patterns that tests miss (unused imports, `==` vs `===`, missing `key` prop) | 1 day |
| I-2 | Per-test-file Vitest config (timeout, environment) where helpful | The current `vite.config.js` is project-wide; some server tests want `environment: "node"` and shorter timeout | 2 hours |
| I-3 | Replace `// eslint-disable` absence with explicit allowlist | Many `any` casts in services | 2 hours |
| I-4 | Add `// @ts-check` JSDoc to one service (e.g. `utils.js`) to type-check untyped JS without adopting TS | Catches unit-test gaps that pure tests don't | 1 day |
| I-5 | Add a "release notes" generator from the changelog | R-numbered releases deserve auto-generated release notes | 4 hours |
| I-6 | Standardize the toast-vs-modal decision (C.12) | Reduces on-call confusion | 2 hours |
| I-7 | Add `NotFound` route + page (C.13) | Better UX on bad links | 2 hours |
| I-8 | Wire `PaymentConfirmModal` confirm step (C.5) | Real bug, currently misleading | 4 hours |
| I-9 | User-friendly message for manual-only coupon (C.18) | One-line fix + test | 30 min |
| I-10 | Document the `useToast()` return shape (C.4) | JSDoc + runtime guard | 1 hour |
| I-11 | Add `validateCoupon` error message standard | Consistency with `classifyError` pattern | 1 hour |
| I-12 | Refresh expired `databases` / `extractions` cache docs in `AGENTS.md` | The "Local-first" pattern is implicit in code, not in docs | 2 hours |

### D.2 Backlog (separate work)

| # | Improvement | Why | Effort |
|---|---|---|---|
| II-1 | Adopt TypeScript (incremental, JSDoc-first as a stepping stone) | Type safety for the next 10 R-releases | Multi-week |
| II-2 | Storybook for `src/components/` | Visual review without full app context | Multi-day |
| II-3 | Real provider integration tests in a separate "staging" environment | Today the offline-mock boundary prevents accidental real-API calls but also prevents testing the real chain | Multi-week |
| II-4 | Lighthouse CI in the quality gate | Performance + a11y score trend | 1 day |
| II-5 | Bundle-size budget (e.g. `dist/` < 500 kB) | R-numbered feature growth can bloat the bundle | 1 day |
| II-6 | Pre-commit hook running vitest on changed files only | Faster feedback for solo dev | 2 hours |
| II-7 | Adopt `@axe-core/playwright` for the full page suite (already in B.9) | a11y coverage at every route, not just sampled | 1 day |
| II-8 | Adopt `playwright-msw` for real network mocking | Currently `e2e/support.js` fakes at the network layer; could move to API contract mocking | 2 days |
| II-9 | Cross-browser matrix (Firefox, Webkit) | Currently chromium-only | 1 day |
| II-10 | Mobile-app shell (PWA) | Out of scope for this initiative, but the code structure supports it | Multi-week |

---

## E. Summary

| | Existing | After this initiative |
|---|---|---|
| Unit tests | 7 files, 740 lines covered | 31 files, ~3 000 lines covered |
| Integration tests | 1 file | 26 files |
| Contract tests | 0 | 21 files |
| Functional tests | 0 | 18 files |
| System tests | 0 | 6 files |
| Smoke (Playwright) | 1 spec, 1 test | 23 specs, ~80 assertions |
| E2E (Playwright) | 1 spec, 1 test | 11 specs, ~70 assertions |
| Security | 1 script, ~170 lines | 1 script + 4 test files |
| Accessibility | 0 | 7 test files |
| Visual regression | 0 | 8 files, ~32 snapshots |
| **Total new files** | — | **~150** |
| **Total new assertions** | — | **~940** (revised down after audit; was ~1 200) |
| Coverage (target) | 70 % on 6 files | 80 % on all `src/lib/*.js`, 60 % on `src/components/*.jsx` (covered subset) |
| CI runtime target | ~5 min | ~8 min on PR (chromium only); ~10 min on main; nightly all-browsers workflow |

### Implementation fixes still to land

- **FR-Z-01**: PaymentConfirmModal "Confirm & Pay" → `initiatePayment` end-to-end
- **FR-Z-02** (refined 2026-07-15, Q2): trial credit grant using `plan.trialCredit` from `pricingConfig.js`. Free plan defines 25; all other plans define `null`/`undefined` → 0. One-time per session/user, persisted in `datiq.subscription.trialCreditAppliedAt` + `bonusExtractions += credit`. `AuthProvider` calls on signup; `BillingProvider` calls on first successful extraction as a fallback. Survives logout (in `datiq.subscription`, not the SENSITIVE_KEYS list). Test: U-25 extension + Z-02-EXT-01.
- **FR-Z-03**: NotFound page + `path="*"` route
- **FR-Z-04**: `validateCoupon` returns "This coupon is for admin assignment only." for `planId="manual"`
- **FR-Z-05**: `useToast()` JSDoc on the return shape
- **FR-Z-08** (new 2026-07-15, Q8): TopBar "Switch Role" → "Switch persona" — production text change in `src/components/TopBar.jsx`; tests I-49, F-19, K-24

### Browser support (Q7, 2026-07-15)

- `playwright.config.js` declares `projects: [chromium, firefox, webkit]`
- Default CI on every PR: `--project=chromium` (fast feedback)
- New nightly workflow (manual trigger or cron) runs all three
- New npm script: `test:e2e:smoke:all-browsers`
- Visual regression stays chromium-only day 1; revisit when the suite stabilises

— End of analysis. See `02-requirements.md` for the FRs / ACs, `04-testing-spec.md` for the full test list, `05-implementation-plan.md` for the schedule, and `06-review-request.md` for what I need from you.
