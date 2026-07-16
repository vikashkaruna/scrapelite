# 05 — Implementation Plan

> This is the work plan, the dependency graph, the milestone releases, and the effort estimate.
> It is the input to `06-review-request.md` — your answers there adjust the milestones below.

## 1. Sequencing principles

1. **Fastest failures first** — unit + contract tests fail in seconds. Putting them on PRs first means R-numbered features land with safety rails.
2. **Production code is locked** — no production code changes outside the five FR-Z fixes until tests for the existing surface land.
3. **Coverage thresholds rise gradually** — start at 70 % (no change), raise to 80 % after each layer lands and the suite stabilises.
4. **Each milestone ends in a green CI** — no half-implemented milestones.
5. **Each milestone produces a working artifact** — usually a test file that runs in CI.

## 2. Dependency graph

```
            ┌──────────────┐
            │  M0: Setup   │  ←──  Day 1
            └──────┬───────┘
                   │
       ┌───────────┼───────────┬──────────────┐
       ▼           ▼           ▼              ▼
   ┌────────┐ ┌────────┐ ┌────────┐    ┌──────────┐
   │ M1: U  │ │ M2: C  │ │ M3: I  │    │ M4: K    │  ←── Days 2-5 (parallel)
   └────┬───┘ └────┬───┘ └────┬───┘    └────┬─────┘
        │          │          │             │
        └──────────┴──────────┴─────────────┤
                                            ▼
                                  ┌──────────────────┐
                                  │  M5: Z + F + S   │  ←── Day 6-8
                                  └────────┬─────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  M6: J + X       │  ←── Day 9-10
                                  └────────┬─────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  M7: A + V       │  ←── Day 11-12
                                  └────────┬─────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  M8: CI polish   │  ←── Day 13
                                  └────────┬─────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  M9: Docs + retro│  ←── Day 14
                                  └──────────────────┘
```

## 3. Milestones

> Each milestone is a single PR (or a tight pair). Day count is the solo-engineer estimate (Vikash's pace, no holidays). All milestones assume full focus.

### M0 — Setup (Day 1, ~4 h)

**Goal:** make the suite wiring exist before any test is written.

- [ ] Add new `npm` scripts to `package.json`: `test:contract`, `test:integration`, `test:system`, `test:e2e:smoke`, `test:e2e:smoke:all-browsers`, `test:e2e:journeys`, `test:e2e:a11y`, `test:e2e:visual`. Update `test:all` to chain them.
- [ ] Create the `test/fixtures/` directory with `buildSubscription.js`, `buildExtraction.js`, `resetLocalStorage.js`.
- [ ] Create the `src/__tests__/harness/AppProviders.jsx` shared mount.
- [ ] Update `test/setup.js` to add the `vitest-axe` matchers (file: `test/a11y-setup.js`, import in `vite.config.js`).
- [ ] Verify `npm run test:unit` still passes (no behaviour change).
- [ ] Add the `notFound` page + route (FR-Z-03, FR-Z-07). Wire `App.jsx` to add `<Route path="*" element={<NotFound />} />`. Smoke-test manually.
- [ ] Configure `playwright.config.js` with `projects: [chromium, firefox, webkit]` and `webServer` per-project if needed (FR-CB-01).
- [ ] Add `e2e/cb-projects.test.js` to assert the projects config + the new npm scripts exist (FR-CB-01, FR-CB-02).
- [ ] Add `e2e/smoke/deeplink-preview.spec.js`, `deeplink-dashboard.spec.js`, `url-params.spec.js` (FR-BH-02..04).

**Exit criteria:** `npm run test:all` is wired but only runs the existing tests. `npm run test:e2e:smoke` exists and runs the existing 2 specs. `npm run test:e2e:smoke:all-browsers` exists. NotFound page renders at `/totally-bogus`. CB-01 and CB-02 pass.

### M1 — Unit (Days 2-3, ~14 h)

**Goal:** every uncovered `src/lib/*.js` has a unit test.

**Tasks:**

- [ ] U-01..06 (utils extensions)
- [ ] U-07..08 (pricingMath)
- [ ] U-09..11 (currencyService)
- [ ] U-12..14 (pricingConfig schema)
- [ ] U-15..17 (pricingOverrides)
- [ ] U-18..25 (usageService — biggest)
- [ ] U-26..29 (batchService)
- [ ] U-30..32 (batchRunsService)
- [ ] U-33..37 (schedulerService)
- [ ] U-38 (personaConfig)
- [ ] U-39..41 (emailService)
- [ ] U-42 (webhook)
- [ ] U-43..44 (migrationService)
- [ ] U-45..46 (authService)
- [ ] U-47..48 (emailCaptureService)
- [ ] U-49..52 (guestTrialService)
- [ ] U-53..55 (globalSettingsService)
- [ ] U-56..58 (extractionsRepo)
- [ ] U-59..62 (paymentService)
- [ ] U-63..65 (adminService)
- [ ] U-66..67 (adminConfigService)
- [ ] U-68..69 (statsService)
- [ ] U-70..71 (supabaseClient)

**PR title:** `test(unit): full coverage for src/lib/*.js (Phase 1)`.

**Exit criteria:** all unit tests pass. Coverage on `src/lib/*.js` is ≥ 70 % (current threshold). No regressions in the existing 7 unit files.

### M2 — Contract (Days 3-4, ~14 h, parallel with M1)

**Goal:** every `netlify/functions/*.js` and `lib helper` has a contract test.

**Tasks:**

- [ ] C-01..04 (extract)
- [ ] C-05..07 (ai)
- [ ] C-08..11 (extractions)
- [ ] C-12..16 (create-checkout — biggest)
- [ ] C-17..19 (verify-payment)
- [ ] C-20..22 (payment-webhook)
- [ ] C-23..24 (admin-auth)
- [ ] C-25 (admin-ai-config)
- [ ] C-26 (admin-general-config)
- [ ] C-27 (admin-revenue)
- [ ] C-28 (admin-users)
- [ ] C-29 (stats)
- [ ] C-30 (og-preview)
- [ ] C-31 (schedules)
- [ ] C-32 (scheduled-runner — biggest)
- [ ] C-33 (aiProviders)
- [ ] C-34 (scrapeProviders)
- [ ] C-35 (pricingSource)
- [ ] C-36 (adminToken)

**PR title:** `test(contract): coverage for netlify/functions/* and lib helpers`.

**Exit criteria:** all contract tests pass. `npm run test:contract` is fast (< 30 s). Security test IDs (X-01..07) included in the relevant contract files.

### M3 — Integration (Days 4-5, ~14 h, parallel with M1/M2)

**Goal:** every non-trivial component + page has an integration test.

**Tasks:**

- [ ] I-01..04 (HeroComposer extensions)
- [ ] I-05..07 (BillingProvider / retryPayment)
- [ ] I-08..10 (GuestTrialProvider)
- [ ] I-11 (ExtractionProvider)
- [ ] I-12..14 (Toast / ErrorModal / AuthProvider)
- [ ] I-15..18 (TopupBundleModal)
- [ ] I-19..21 (PaymentConfirmModal — includes FR-Z-01 fix)
- [ ] I-22 (DemoPaymentModal)
- [ ] I-23..25 (TopBar)
- [ ] I-26..28 (Batch)
- [ ] I-29..30 (Home)
- [ ] I-31..34 (Dashboard)
- [ ] I-35 (Preview)
- [ ] I-36..37 (Schedules)
- [ ] I-38 (Account)
- [ ] I-39 (Pricing)
- [ ] I-40 (Onboarding)
- [ ] I-41 (Contact)
- [ ] I-42 (AuthModal)
- [ ] I-43 (AdminLayout)
- [ ] I-44 (AdminRevenue)
- [ ] I-45 (AdminPricing)
- [ ] I-46 (AdminUsers)
- [ ] I-47 (AdminCoupons)
- [ ] I-48 (NotFound)
- [ ] **I-49 (TopBar "Switch persona" label, FR-Q8-01, Q8)** — production text change in `src/components/TopBar.jsx` (Q8 is now in-scope, 2026-07-15); test asserts "Switch persona" label and the click behaviour

**PR title:** `test(integration): coverage for components and pages`.

**Exit criteria:** all integration tests pass. `npm run test:integration` is < 60 s. TopBar shows "Switch persona" (not "Switch Role").

### M4 — Smoke (Day 5, ~8 h, parallel with M1-M3)

**Goal:** port the 89 legacy checks into Playwright smoke specs.

**Tasks:**

- [ ] K-01..23 (one spec file per page group)
- [ ] Verify offline-mock boundary (`e2e/support.js`) is intact.
- [ ] Add `--grep @smoke` tag to the smoke specs (for the CI matrix).

**PR title:** `test(smoke): port e2e-test.mjs checks to Playwright`.

**Exit criteria:** all 23 smoke specs pass. `npm run test:e2e:smoke` completes in < 60 s. Total assertions ≈ 80.

### M5 — Functional + System + Implementation fixes (Days 6-8, ~22 h)

**Goal:** every route renders in isolation; the 5 FR-Z fixes are wired and tested.

**Tasks:**

- [ ] F-01..18 (functional page tests)
- [ ] **F-19 ("Switch persona" → onboarding re-open, FR-Q8-02, Q8)** — Onboarding test asserts the new label triggers persona change persistence
- [ ] S-01..07 (system tests)
- [ ] **RC-01 (race condition: simultaneous signOut)**
- [ ] **I18N-04 (no string concatenation in user-facing copy)**
- [ ] Z-01: PaymentConfirmModal "Confirm & Pay" wires to `initiatePayment`
- [ ] **Z-02: trial credit grant (Q2, 2026-07-15)** — `usageService.applyTrialCredit(planId)` reads `getEffectivePlanById(planId).trialCredit ?? 0`; only Free plan currently defines 25; one-time grant persisted in `datiq.subscription.trialCreditAppliedAt` + `bonusExtractions += credit`; `AuthProvider` calls on signup; `BillingProvider` calls on first extraction as fallback; logged-out state preserved
- [ ] Z-03: NotFound page (already done in M0)
- [ ] Z-04: `validateCoupon` returns specific error for manual-only
- [ ] Z-05: `useToast()` JSDoc
- [ ] **Z-08: TopBar "Switch persona" label (Q8, already in M3 I-49; this is the doc + help sync)**
- [ ] Z-06: smoke port (already done in M4)
- [ ] Z-07: routing regression test (already done in M0)

**PR titles:**

- `feat(payment): wire PaymentConfirmModal to initiatePayment end-to-end (FR-Z-01)`
- `feat(trial): grant once-only 25-extraction credit on signup (FR-Z-02)`
- `fix(validate-coupon): return "admin assignment only" for manual-only coupons (FR-Z-04)`
- `docs(toast): document useToast() return shape (FR-Z-05)`
- `test(functional+system): route renders + cross-cutting behaviour`

**Exit criteria:** all functional and system tests pass. Five FR-Z fixes are in. New behaviour is gated by tests.

### M6 — Journeys + Security + Cross-cutting (Days 9-10, ~16 h)

**Goal:** multi-step user flows are covered; security tests beyond the secret-pattern script are in; race conditions, time-zones, network resilience, i18n are covered.

**Tasks:**

- [ ] J-01..10 (journey specs)
- [ ] X-01..12 (security tests, mostly combined with existing contract / unit files)
- [ ] **RC-02, RC-03 (race conditions in `usageService` and `extractionsRepo`)** — TZ-01..05 spread across M1/M2/M7
- [ ] **TZ-01..05 (time-zone / cron boundaries)** — covered in M1 (schedulerService) and M2 (scheduled-runner)
- [ ] **NR-01..03 (network resilience)** — covered in M1 (batchService) and M1 (extractionsRepo)
- [ ] **I18N-01..03 (locale formatting)** — covered in M1 (currencyService, utils)
- [ ] **I18N-04 (no string concatenation) — system test, M5**
- [ ] **WR-01..03 (webhook delivery) — covered in M2 (scheduled-runner)**
- [ ] **BH-01 (back/forward preserves filter state) — Playwright journey, this milestone**
- [ ] Run the security tests against the staging deploy.

**PR titles:**

- `test(journey): multi-step user flows via Playwright`
- `test(security): bypass / tampering / XSS coverage`
- `test(race): simultaneous signOut and rapid plan upgrade`
- `test(tz): DST / month-rollover / Feb 29 / UTC-anchored cron`
- `test(i18n): locale-aware currency / date / number formatting`

**Tasks:**

- [ ] J-01..10 (journey specs)
- [ ] X-01..12 (security tests, mostly combined with existing contract / unit files)
- [ ] Run the security tests against the staging deploy.

**PR titles:**

- `test(journey): multi-step user flows via Playwright`
- `test(security): bypass / tampering / XSS coverage`

**Exit criteria:** all journey specs pass on `main` branch only. Security tests are part of `npm run test:contract` or `npm run test:unit` (per file).

### M7 — Accessibility + Visual regression (Days 11-12, ~12 h)

**Goal:** axe-core covers every audited component + page; Playwright snapshots baseline the 8 stable pages.

**Tasks:**

- [ ] A-01..06 (vitest-axe for 6 components)
- [ ] A-07..09 (Playwright a11y for 6 pages + keyboard + contrast)
- [ ] V-01..08 (Playwright `toHaveScreenshot` for 8 pages)
- [ ] Configure `playwright.config.js` to pin Chromium version, add `--update-snapshots` flag.

**PR titles:**

- `test(a11y): vitest-axe for components + @axe-core/playwright for pages`
- `test(visual): Playwright toHaveScreenshot baseline for 8 pages`

**Exit criteria:** all a11y tests pass with zero serious/critical violations. All visual snapshots baseline on first run. `npm run test:e2e:a11y` < 60 s. `npm run test:e2e:visual` < 90 s.

### M8 — CI polish (Day 13, ~6 h)

**Goal:** the workflow is clean, fast, and produces the right artifacts.

**Tasks:**

- [ ] CI-01..05 (update `.github/workflows/quality-gate.yml`)
- [ ] **CI-06 (FR-CB-03)**: add a nightly `quality-gate-cross-browser.yml` workflow (manual trigger or cron schedule) that runs `npm run test:e2e:smoke:all-browsers` and uploads the report
- [ ] **CI-07**: add a step to `quality-gate.yml` that validates `playwright.config.js` declares the three projects (CB-01)
- [ ] Raise the coverage threshold to 80 % on `src/lib/*.js` (CI-03)
- [ ] Add a coverage report upload (CI-05)
- [ ] Add a Playwright HTML report upload on every failure (CI-04, already partial)
- [ ] Verify total CI runtime < 8 min on PR, < 10 min on main (CI-02)

**PR title:** `ci(quality-gate): split smoke / journeys / a11y / visual, raise coverage, upload artifacts`.

**Exit criteria:** CI green on a real PR. Runtime measured at < 8 min.

### M9 — Documentation + Help rebuild + retro (Days 14-15, ~10 h)

**Goal:** the next person (or future you) understands the suite. The Help site is regenerated from markdown source and a CI drift check guarantees it stays in sync.

**Tasks:**

- [ ] Update `AGENTS.md` testing section.
- [ ] Update `docs/testing.md` with the new commands and file layout.
- [ ] Update `docs/internal/DatIQ-Product-Documentation-Internal.md` testing section.
- [ ] Write `docs/quality-gate.md` (new file) — the operator guide.
- [ ] **Q3 rebuild**: add a new `build-help-md` target to `docs/build-help.mjs` that produces `docs/HELP.md` (root-level) from the same source. Update `docs/HELP.md` and `HELP.md` (currently stale).
- [ ] **Q3 rebuild**: add a `docs:check` npm script + CI step that fails the build when `public/help/*` is out of date relative to the markdown sources (i.e. `node docs/build-help.mjs --check`). This prevents the drift from recurring.
- [ ] **Q3 rebuild**: regenerate `public/help/index.html` so the internal/external section labels stay consistent with the latest R-numbered release.
- [ ] Schedule the retro (M10 below) for 7-14 days post-merge.

**PR title:** `docs(quality-gate): testing section + operator guide + help rebuild`.

**Exit criteria:** docs match the code. `npm run docs:check` is green. `public/help/*` is regenerated. Retro is scheduled.

### M10 — Post-merge retro (Day 21-28, ~2 h)

**Goal:** close the loop. What did we learn? What do we wish we had known?

- [ ] `retrospective.md` per the SDLC template.
- [ ] Update the SDLC prompt (`sdlc-prompt.md`) with anything unclear.
- [ ] File follow-up tickets for any "out of scope" item that turned out to be in scope.

## 4. Effort estimate (updated 2026-07-15 with Q3 +1 day)

| Milestone | Days | Hours | New files | New assertions |
|---|---|---|---|---|
| M0 | 1 | 5 | 7 (+ cb-projects, deeplink specs) | 8 |
| M1 | 2 | 16 | 25 (+ TZ/NR/I18N/RC extensions) | ~270 |
| M2 | 2 | 16 | 18 (+ TZ/WR extensions) | ~170 |
| M3 | 2 | 16 | 26 (+ I-49 TopBar label) | ~170 |
| M4 | 1 | 9 | 26 (+ K-24 topbar-label) | ~90 |
| M5 | 3 | 24 | 21 (+ RC-01, I18N-04, Z-02 trial credit, Z-08 doc sync) | ~170 |
| M6 | 2 | 16 | 14 (+ BH-01, TZ/RC/RC/NR/I18N/WR system tests) | ~100 |
| M7 | 2 | 13 | 7 | ~30 |
| M8 | 1 | 7 | 0 (CI only + nightly workflow) | 0 |
| M9 | 2 | 10 | 4 (docs + operator guide + help rebuild + drift check) | 0 |
| **Total** | **~18 days** | **~132 h** | **~150** | **~940** |

Solo-engineer pace, no holidays, 6-8 productive hours/day. **About 2.5 weeks** end to end if uninterrupted.

## 5. Risk-adjusted plan

| Risk | Mitigation in the plan |
|---|---|
| R-1 Real services required | All contract tests `vi.mock("node:fetch")`; smoke tests use the offline-mock boundary |
| R-2 Coverage threshold fails on day 1 | M0 starts at 70 %; M1 raises to 80 % once unit suite is green |
| R-3 Visual snapshot flake | M7 pins Chromium version; first run uses `--update-snapshots`; CI uses prebuilt containers |
| R-4 CI runtime exceeds 8 min | Smoke is the only Playwright target on PR; journeys/a11y/visual run on main only |
| R-5 Test depends on real API | Hard rule enforced by M0 setup: any test file that imports `apiClient` MUST mock fetch; lint rule proposed for follow-up |
| R-6 Test env drift | M0 sets all `VITE_*` to empty strings in the CI env; precheck added |
| R-7 PaymentConfirmModal fix regression | Wrap in feature flag `VITE_PAYMENT_CONFIRM_REVIEW` (1 release) |
| R-8 TopBar label change | Deferred (Q8) |

## 6. Backlog items not in this plan (intentionally deferred)

- ESLint config (I-1) — separate PR after this initiative lands.
- Cross-browser matrix (D.2 II-9) — Q7 deferred.
- Lighthouse CI (D.2 II-4) — separate initiative.
- Bundle-size budget (D.2 II-5) — separate initiative.
- Storybook (D.2 II-2) — separate initiative.
- MSW migration (D.2 II-8) — separate initiative.
- TypeScript adoption (D.2 II-1) — multi-week; out of scope.
- PWA / mobile-app shell (D.2 II-10) — out of product scope.
- Real-provider integration tests (D.2 II-3) — out of scope.
- Pre-commit hook running vitest on changed files (D.2 II-6) — follow-up.
- The "Help.md" deletion (C.2, C.3) — Q3 deferred.

## 7. Coordination with the live site

- All milestones land in a single branch: `claude/quality-gate` (or a similar name).
- Each milestone is a commit (or a small set of commits) on the branch.
- The branch is merged to `main` after M9.
- Netlify auto-deploys on `main` push; no manual deploy.
- The "R-numbered" release discipline continues — this initiative is one big R: "R20: quality gate".

## 8. What success looks like

- `npm run test:all` is green on every PR.
- A future R-number release adds a feature; the new test file lands in the same PR.
- A regression in the GuestTrialProvider hard-block (the kind that took two iterations to fix in R16/R17) is caught by `S-02` before it ships.
- A regression in the PaymentConfirmModal flow (the kind that is currently incomplete) is caught by `I-20` and `J-05` before it ships.
- A new contributor reads `docs/quality-gate.md`, runs `npm run test:all`, and gets green in < 10 min.
- The CI artifact (Playwright HTML + coverage) tells you which file and which line broke, not just "1 test failed".

## 9. What success does NOT look like

- "100 % coverage." This initiative is not chasing that number. It is chasing "the right tests at the right layer for the right risk."
- "Replace Playwright with Cypress." Out of scope.
- "Switch from Vitest to Jest." Out of scope.
- "Real integration with Stripe / Razorpay." Out of scope; mocked.
- "Cross-browser." Deferred (Q7).
- "TypeScript." Out of scope.

— End of plan. See `06-review-request.md` for the decisions.
