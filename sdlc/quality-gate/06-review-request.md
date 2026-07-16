# 06 — Review Request: Decisions I Need From You

> This is the only file you **must** act on. Everything else in this package is analysis and plan; this one asks for your input.
>
> Each question is concrete. Each has a recommended default based on the analysis. If you say "go with the recommended", I will proceed; if you want to override, give me a one-line reason and I'll adjust the plan in `05-implementation-plan.md`.

## Decision log (locked 2026-07-15 — all 11 questions resolved)

| # | Question | Decision | Notes |
|---|---|---|---|
| Q1 | ESLint in or out | **Out** (separate PR) | M0 stays as-is |
| Q2 | Free trial credit | **Wire now** | `plan.trialCredit` from `pricingConfig.js`; only Free plan currently defines 25; one-time; U-25 extended |
| Q3 | `HELP.md` / `docs/HELP.md` | **Rebuild from markdown source** | M9 +1 day: `node docs/build-help.mjs` to regenerate `public/help/*`; rebuild `docs/HELP.md` from the same source; add a CI drift check |
| Q4 | NotFound page | **Ship in M0** | 2h additive; tests I-48, K-01 |
| Q5 | Visual regression | **Yes, baseline only** | 32 snapshots; 0.2 % pixel-diff tolerance; chromium day 1 |
| Q6 | TypeScript | **Punt** | Confirmed |
| Q7 | Cross-browser matrix | **Chromium default, cross-browser support enabled** | `projects: [chromium, firefox, webkit]`; CI = chromium; nightly workflow |
| Q8 | TopBar "Switch Role" → "Switch persona" | **Implement now** | Production change in M3; tests I-49, F-19, K-24 |
| Q9 | Add to test list | **Add all relevant** | 24 new tests across 7 categories |
| Q10 | Branch name | **`claude/quality-gate`** | Confirmed |
| Q11 | PR cadence | **1 PR per milestone (10 PRs)** | Delegated; rationale: self-contained reviews, CI gates every step, easy revert |

**Plan status: LOCKED. Ready to start M0.**

## TL;DR — what I am proposing

A **2.5-week solo-engineer push** to add a release-grade test gate to DatIQ:

- **~140 new test files**, **~890 new assertions**, across 5+ layers (Unit, Integration, Contract, Functional, System, Smoke, Journey, Security, Accessibility, Visual regression)
- **5 small production fixes** (NotFound page, PaymentConfirmModal wiring, trial credit grant, manual-coupon error message, useToast JSDoc) — all gated by tests
- **Coverage** raises from 70 % on 6 files to 80 % on all `src/lib/*.js`
- **CI** stays < 8 min on PRs, < 10 min on `main`
- **Zero new dependencies** other than `vitest-axe` and `@axe-core/playwright` (both small, both dev-only)
- **Zero calls to live third-party services** (offline-mock boundary preserved)

Total new dependencies: `vitest-axe` + `@axe-core/playwright` (1 npm line each).

## Recommended approach (the one I would run if you said "go")

Land in 10 milestones over 14 working days, in a single branch `claude/quality-gate` (or your preferred name), merged to `main` as "R20 — quality gate":

```
M0 Setup           Day 1     4h   NotFound + new npm scripts + test harness
M1 Unit            Days 2-3  14h  All src/lib/*.js
M2 Contract        Days 3-4  14h  All netlify/functions/* + lib helpers (parallel with M1)
M3 Integration     Days 4-5  14h  All non-trivial components + pages (parallel with M1/M2)
M4 Smoke           Day 5     8h   23 Playwright specs, port e2e-test.mjs (parallel)
M5 Func + Sys + Z  Days 6-8  22h  18 functional + 7 system + 5 prod fixes
M6 Journeys + X    Days 9-10 14h  10 journeys + 12 security tests
M7 A11y + Visual   Days 11-12 12h  vitest-axe + @axe-core/playwright + snapshots
M8 CI polish       Day 13    6h   workflow + coverage threshold + artifacts
M9 Docs + retro    Day 14    4h   AGENTS.md + docs/quality-gate.md + schedule retro
```

Then a 2-hour retro on Day 21-28.

## Questions

### Q1. ESLint config (I-1) — **in or out of this initiative?**

| | In | Out |
|---|---|---|
| Effort | +1 day in M0 | +1 day as a separate PR after |
| Risk | M0 has more to wire | Two releases to validate |
| Value | Tests + lint + format = one consistent bar | Smaller PR for review |

**Recommended:** Out, as a separate PR (focused scope).

### Q2. Free trial credit (FR-Z-02) — **wire here or split?**

| | Wire here | Split |
|---|---|---|
| Effort | +4 h in M5 | +4 h as a separate PR |
| Risk | Combined PR for the user-visible feature + the test | Smaller PR |
| Value | One fewer "outstanding task" in CLAUDE.md | Easier to review |

**Recommended:** Wire here. It's small, well-bounded, and CLAUDE.md has had it on the outstanding list for several R-numbers.

### Q3. `HELP.md` (root) and `docs/HELP.md` (C.2, C.3) — **delete or rebuild?**

| | Delete | Rebuild from markdown source |
|---|---|---|
| Effort | +15 min in M9 | +1 day in M9 |
| Risk | Some legacy search hits break | Risk of fresh drift |
| Value | One source of truth (`docs/DatIQ-User-Guide.md`) | Preserves any external link |

**Recommended:** Delete. The current `docs/DatIQ-User-Guide.md` is the source of truth; `public/help/` is generated from it; `HELP.md` and `docs/HELP.md` are stale duplicates.

### Q4. `NotFound` page (FR-Z-03) — **ship with this initiative or punt?**

| | Ship | Punt |
|---|---|---|
| Effort | +2 h in M0 | +2 h later |
| Risk | None (additive) | The wrong URL → 200 with Home content remains a user-facing bug |

**Recommended:** Ship. It's a 2-hour additive change with a clear test (I-48, K-01).

### Q5. Visual regression (B.10) — **now or later?**

| | Now (M7) | Later (post-R20) |
|---|---|---|
| Effort | +12 h in M7 | Same total, but later |
| Risk | Snapshot flake on first run | None immediate |
| Value | Catches accidental CSS regressions | Smaller release |

**Recommended:** Now, but only baseline + assert. No strict pixel-diff gating on day 1 — Playwright's default 0.2 % tolerance is enough. Tighten later as the suite stabilises.

### Q6. TypeScript (D.2 II-1) — **adopt incrementally now or punt?**

| | Adopt incrementally (JSDoc + `// @ts-check` on 1 service) | Punt |
|---|---|---|
| Effort | +1 day in M0 (pilot) + ongoing as new files land | Multi-week later |
| Risk | Refactor friction for one service | Future R-numbers keep adding JS debt |
| Value | Catches a class of unit-test gaps | Smaller immediate release |

**Recommended:** Punt. Out of scope for the test-gate initiative. (If you want, I'll add a separate `// @ts-check` pilot as a follow-up PR.)

### Q7. Cross-browser matrix (D.2 II-9) — **chromium-only or add Firefox/Webkit?**

| | Chromium only | Add Firefox + Webkit |
|---|---|---|
| Effort | +0 h | +1 day in M8 + 2-3× CI time |
| Risk | None | Snapshot flake on different engines |
| Value | Faster CI | True cross-browser parity |

**Recommended:** Chromium only. Firefox/Webkit is a separate initiative.

### Q8. TopBar label "Switch Role" → "Switch persona" (C.15) — **defer?**

| | Defer | Ship in M3 |
|---|---|---|
| Effort | +30 min later | +30 min in M3 |
| Risk | None | The label is confusing in 1 place |
| Value | Less scope | More consistency |

**Recommended:** Defer (out of scope for the test-gate initiative). Add a follow-up ticket.

### Q9. Anything to add or cut from the test list?

Open `04-testing-spec.md`. I can:

- **Cut** any test ID you flag (e.g. if you think a11y on `/admin` is overkill).
- **Add** any test ID you think is missing.
- **Re-prioritise** any milestone.

If you say "looks good", I proceed with the recommended approach.

### Q10. Branch name? (default: `claude/quality-gate`)

I propose `claude/quality-gate`. Any preference?

### Q11. PR cadence? (default: 1 PR per milestone = 10 PRs)

I propose **one PR per milestone** (M0..M9 = 10 PRs). Any preference for fewer/larger PRs?

## Implementation updates that fell out of the answers above

| Answer | Where it lands |
|---|---|
| Q2 (trial credit using `plan.trialCredit`) | M5 → Z-02; new test U-25 extension; production code in `src/lib/usageService.js` + `src/components/AuthProvider.jsx` (or first-extraction hook in `BillingProvider`) |
| Q3 (rebuild HELP.md) | M9 → +1 day; new `docs/build-help.mjs` target; CI drift check (`public/help/*` is up to date); updates to `public/help/index.html` so the internal/external labels stay consistent |
| Q7 (chromium default + cross-browser support) | M8 → CI-01 extension; new `playwright.config.js` `projects:` block; new npm scripts; new nightly workflow (manual trigger); new tests CB-01, CB-02 |
| Q8 (TopBar label change) | M3 → I-49; F-19; K-24; production text edit in `src/components/TopBar.jsx`; help docs sync |
| Q9 (24 new tests) | M0..M7 spread; full inventory below in the "Add all relevant" subsection |

## "Add all relevant" — the 24 new test cases

| ID | File | Test | Layer |
|---|---|---|---|
| **BH-01** | `e2e/journeys/history-back-forward.spec.js` | Back/forward preserves Dashboard search filter | Journey |
| **BH-02** | `e2e/smoke/deeplink-preview.spec.js` | `/preview` with no `datiq.current` → redirects to `/` | Smoke |
| **BH-03** | `e2e/smoke/deeplink-dashboard.spec.js` | `/dashboard` works after sign-in; requires `datiq.saved` | Smoke |
| **BH-04** | `e2e/smoke/url-params.spec.js` | `/contact?type=bug` pre-selects the right type | Smoke |
| **RC-01** | `src/__tests__/system/race-signout.test.jsx` | Two `signOut` calls in the same tick → one navigation, one final state | System |
| **RC-02** | `src/lib/usageService.test.js` | Rapid plan upgrade from `free` to `select` does NOT double-increment `datiq.usage` | Unit (extending) |
| **RC-03** | `src/lib/extractionsRepo.test.js` | Two `saveExtraction` calls in the same tick → two unique ids, both stored | Unit (extending) |
| **TZ-01** | `src/lib/schedulerService.test.js` | `buildCron` always returns UTC-anchored cron | Unit (extending) |
| **TZ-02** | `src/lib/usageService.test.js` | Month rollover happens at UTC midnight, not local | Unit (extending) |
| **TZ-03** | `src/lib/usageService.test.js` | DST transition (Mar / Nov) does not break the counter | Unit (extending) |
| **TZ-04** | `src/lib/schedulerService.test.js` | `buildCron({frequency:"monthly", dayOfMonth: 30})` clamps Feb 29 → 28 | Unit (extending) |
| **TZ-05** | `netlify/functions/scheduled-runner.test.js` | Runner uses `Date.now()` UTC for "is this due" check | Contract (extending) |
| **NR-01** | `src/lib/batchService.test.js` | Extraction aborts cleanly on `AbortSignal` | Unit (extending) |
| **NR-02** | `src/lib/extractionsRepo.test.js` | Save to localStorage succeeds even when `fetch` fails | Unit (extending) |
| **NR-03** | `src/lib/batchService.test.js` | Batch continues after a single-URL failure; partial results returned | Unit (extending) |
| **I18N-01** | `src/lib/currencyService.test.js` | `formatPrice(19, "USD", "en-IN")` = `US$19.00`; `(999, "INR", "en-US")` = `₹999` | Unit (extending) |
| **I18N-02** | `src/lib/utils.test.js` | `formatDate` uses `Intl.DateTimeFormat`; en-GB vs en-US differ | Unit (extending) |
| **I18N-03** | `src/lib/utils.test.js` | `formatNumber(1234.5, "de-DE")` = `1.234,5`; `(1234.5, "en-US")` = `1,234.5` | Unit (extending) |
| **I18N-04** | `src/__tests__/system/i18n-concat.test.jsx` | No string concatenation in user-facing copy (grep + assertion) | System |
| **WR-01** | `netlify/functions/scheduled-runner.test.js` | Webhook 5xx → resend with backoff | Contract (extending) |
| **WR-02** | `netlify/functions/scheduled-runner.test.js` | Duplicate `event_id` is not double-fired | Contract (extending) |
| **WR-03** | `netlify/functions/scheduled-runner.test.js` | Webhook failure does not crash the runner | Contract (extending) |
| **CB-01** | `playwright.config.js` (test) | `projects: [chromium, firefox, webkit]` present; default = chromium | Infra |
| **CB-02** | `package.json` (test) | `test:e2e:smoke:all-browsers` script runs all three projects | Infra |
| **I-49** | `src/components/TopBar.test.jsx` | "Switch persona" label renders; clicking re-opens onboarding | Integration |
| **F-19** | `src/pages/Onboarding.test.jsx` | "Switch persona" → onboarding opens → persona change persists | Functional |
| **K-24** | `e2e/smoke/topbar-label.spec.js` | UserDropdown shows "Switch persona" (not "Switch Role") | Smoke |

## What I will do once you sign off

1. Create a worktree on the chosen branch.
2. Start M0. Each PR description will link to the relevant `sdlc/quality-gate/*.md` section.
3. As each PR lands, I will re-run the analysis to confirm the layer is actually complete.
4. After M9 lands, I will write the retro and update this `sdlc/quality-gate/` directory with the actual schedule vs estimate.
5. If the plan needs to change mid-stream (e.g. a milestone surfaces a bug that needs a design change), I will flag it before continuing.

## What I will NOT do

- I will not touch `main` directly.
- I will not call any live third-party service from a test.
- I will not lower a coverage threshold to make a milestone pass.
- I will not merge a milestone that has a failing test.
- I will not silently add a dependency.
- I will not skip the offline-mock boundary.

## Sign-off format

Just reply with one of:

```
go           — proceed with the recommended approach
go, but:     — proceed, with the following overrides
hold         — wait, more discussion needed
```

If `go, but:`, list the overrides inline. I will update the plan, then start M0.
