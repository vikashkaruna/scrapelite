# Session Handoff — 2026-07-18 (DatIQ — clean state, ready for v2.0)

> **Context for the next Claude session.** All v1.0+ Quick Wins have landed,
> been pushed, merged to `main`, and synced. The repo is in a fully clean
> state with a known-good baseline. Pick the next direction from the
> "Suggested next steps" section below.

## TL;DR

- **Working tree:** clean (only 10 untracked research PDFs/xlsx/.pages/.txt in
  workspace root — these are Vikash's research inputs, intentionally
  untracked; do NOT add them).
- **Branches (all in sync with origin):**
  | branch | tip | status |
  |---|---|---|
  | `main` | `0333e19` | up to date |
  | `feat/v1-quickwins` | `75a451c` | up to date (same logical state as main; merged via PR #14) |
- **Tests:** `npm test` → **1029/1029 pass** across 124 files (~12s)
- **Build:** `npm run build` → clean in 1.74s
- **No open PRs.** PR #14 (Cloud BI Q1–Q11 + alternate Q1/Q3/Q4/Q5/Q11) is MERGED + closed.
- **Netlify production auto-deployed** from main on push.

## What's in the box (shipped in v1.0+ drop)

### Cloud BI Quick Wins (Q1–Q11) — `8cf8dbd` and `f5cd590`
| # | Feature | Where |
|---|---|---|
| Q1 | Smart multi-input composer — auto-classifies single URL / multi-URL / CSV / raw text | `src/components/HeroComposer.jsx`, `src/lib/utils.js` `classifyInput` |
| Q2 | Pre-flight credit estimator (disables Run when over) | `src/components/CreditEstimator.jsx`, `src/lib/creditEstimator.js` |
| Q3 | 6 outcome tiles above the hero (multi-select; first seeds example URL) | `src/components/OutcomeTiles.jsx`, `src/lib/outcomeTiles.js` |
| Q4 | `/workspace` logged-in command center (guarded; teaser for guests) | `src/pages/Workspace.jsx`, `src/components/WorkspaceRedirect.jsx` |
| Q5 | 12-template library (YC, SaaS pricing, jobs, contacts, products, …) | `src/lib/extractionTemplates.js`, `src/components/TemplateGallery.jsx` |
| Q7 | UrlReviewTable (comparable grid; default expanded) in Batch paste | `src/components/UrlReviewTable.jsx` |
| Q8 | Shareable public reports + `/gallery` + `/p/:slug` (Supabase `public_reports` + localStorage fallback) | `src/lib/shareService.js`, `src/pages/PublicReport.jsx`, `src/pages/Gallery.jsx`, `scripts/public-reports.sql` |
| Q9 | Full per-field provenance (source_url + confidence + last_checked_at + retrieval hint) | `src/lib/provenanceService.js`, `src/components/ProvenanceBadge.jsx`, `scripts/provenance.sql` |
| Q10 | Annual-billing default (R4) — regression test in `Pricing.integration.test.jsx:126` | — |
| Q11 | Custom Supabase analytics (`analytics_events` + `track/flush/computeFunnel`) | `src/lib/analyticsService.js`, `scripts/analytics.sql` |
| 1 e2e | `e2e/smoke/claims-verification.spec.js` — 11 Playwright tests asserting marketing claims | — |

### Alternate-model drop — `f5cd590` and `3e28ce6`
| # | Feature | Where |
|---|---|---|
| Q1 alt | TryExampleDemo — 5-step auto-playing walkthrough; respects `prefers-reduced-motion` | `src/components/TryExampleDemo.jsx` |
| Q3 | SavedSearches cap (free=10, paid=Infinity) | `src/lib/savedSearches.js` |
| Q4 | In-app OnboardingTour (6 steps, spotlight + popover, 5 placements, `g t` to replay) | `src/lib/onboardingTour.js`, `src/components/OnboardingTour.jsx` |
| Q5 | AI summary feedback widget (thumbs + comment, `summary_feedback` table) | `src/lib/feedbackService.js`, `src/components/FeedbackWidget.jsx`, `scripts/summary-feedback.sql` |
| Q11 | Keyboard shortcuts (`useHotkeys` chord-aware, HotkeyHelp modal) | `src/hooks/useHotkeys.js`, `src/components/HotkeyHelp.jsx` |

### Bugs fixed during the drop
- **Q8 cross-browser shareable URL (CRITICAL):** previous share was
  localStorage-only — the URL only worked in the originator's browser. Now
  persisted to Supabase `public_reports` (anon-read, owner-only
  update/delete) with localStorage fallback. The cross-browser repro test
  in `shareService.test.js` now passes.
- **Q3 outcome tiles multi-select:** clicking 2+ tiles appends prompts
  (joined by `\n\n`) and auto-switches intent to "custom". 5 new
  integration tests.
- **Removed the duplicate "Add multiple URLs" reveal on Home** — the Q1
  smart composer auto-detects multi-URL input and routes to `/batch`. The
  5 obsolete MultiUrlReveal tests were deleted.

## Architecture rules in force

(unchanged from prior session — pinned in `CLAUDE.md`)

- Never convert `design-system.css` / `screens.css` tokens to Tailwind.
- All Supabase / Firecrawl / AI calls go through `apiClient.js` → Netlify
  Functions, not direct from the browser.
- Supabase fallback to localStorage on 401/403/404/503/500. Never
  hard-fail a save.
- Pricing: always use `getEffectivePlans()` / `getEffectivePlanById()` —
  never import `PLAN_BY_ID` from `pricingConfig` directly in UI code.
- All paid-tier payments: `paymentService.js` → `/api/create-checkout` →
  Razorpay (INR) or Stripe (USD; deferred per
  `docs/STRIPE-DEFERRAL.md`).
- TopBar brand: `layers` icon + "DatIQ" + tagline; never change.
- Every new public route must add a `<li>` to `public/sitemap.xml` and a
  corresponding doc page (if user-facing) to `docs/DatIQ-User-Guide.md`.
- Icon names added to `src/components/Icon.jsx` only. **Watch out:**
  that file has pre-existing duplicate lucide-react imports (Tag/Hash/
  RotateCw). New icon additions are fine; if you need to deduplicate, do
  it in its own commit and re-run the build.

## Manual setup steps still owed to production

These are listed in `CLAUDE.md` "Outstanding tasks" — the Netlify
production env is already set for most things. SQL tables must be
created in the Supabase SQL Editor:

```sql
-- Run in Supabase → SQL Editor (idempotent)
-- 1. Cloud BI Q11 analytics
\i scripts/analytics.sql

-- 2. Cloud BI Q9 provenance (adds `provenance jsonb` to extractions + 2 indexes)
\i scripts/provenance.sql

-- 3. Cloud BI Q8 shareable reports
\i scripts/public-reports.sql

-- 4. Alternate-model Q5 summary feedback
\i scripts/summary-feedback.sql
```

After SQL, the live app at https://datiq.app will start recording
analytics, allowing shareable cross-browser reports, surfacing
provenance, and accepting feedback — **no rebuild needed** (Netlify
Functions read the schema on each call).

## Suggested next steps (v2.0 candidates)

> Vikash's per-message instructions are still the single source of truth.
> The list below is the catalogue of v2.0 work, **not** a commit to do
> any of it now.

### v2.0 (high-impact, in-scope)
- **Recurring subscription billing** (Razorpay Subscriptions + Stripe
  Subscriptions, dunning, customer portal). Runbook:
  `docs/RECURRING-BILLING-DEFERRAL.md`. v1.0 ships one-time Orders only.
- **Stripe Checkout re-enable.** 6-step runbook:
  `docs/STRIPE-DEFERRAL.md`. Code is preserved (25 contract tests cover
  the full path); flip with `DATIQ_ENABLE_STRIPE=1` + the 6 steps.
- **Browser extension** (Chrome + Firefox + Edge, Manifest v3, OAuth,
  store submission). Multi-week project; plan is in
  `docs/EXTENSION-PLAN.md` (if it exists — check first).
- **Cross-device Supabase session sync** — replace localStorage persona
  + session for users signed in.
- **Referral/affiliate program backend** — teaser UI is live on /pricing.

### v2.0 (UX polish — in repo, not yet shipped)
- **Bulk-tag UI on Dashboard** — currently single-tag-only via TagChips
- **Sidebar folders** (Collections col-1 variant)
- **Smart collections** (Collections col-3 — saved filter expressions)
- **Batch templates** (ba-2) — reuse Q5's TemplateGallery inside /batch
- **Batch share** (ba-3) — share a whole batch run, not just one
- **PNG export of extractions** — for blog/social sharing
- **`/blog/:slug` SEO routing** — currently all in-page modal only

### v2.0 (smaller, well-scoped)
- Update Agency plan Razorpay/Stripe price IDs to match new ₹14,999 / $299
- Wire `datiq.analytics` through to `/admin/revenue` and
  `/admin/users` for richer cohort views
- Bulk CSV paste on the Home composer (Q1 smart input handles URLs/text
  but CSV files still need drop-to-Batch; UX could surface that better)
- A11y: confirm new components (Workspace, Gallery, PublicReport,
  OnboardingTour) pass M7 axe scans; add to the matrix if not.

## Next session entry point

```
cd /Users/vikash/Extracta
git checkout main
git pull origin main

# 1. Read this handoff + the older 2026-07-17 handoff for full history
cat docs/SESSION-HANDOFF-2026-07-18.md     # you are here
cat docs/SESSION-HANDOFF-2026-07-17.md     # the feature drop

# 2. Skim project state
cat AGENTS.md | head -80                   # minimal pointer
grep -E "## R" CLAUDE.md | tail -30        # which releases are merged

# 3. Sanity check the baseline
npm test                                   # 1029 pass
npm run build                              # clean

# 4. Branch from main for the next effort
git checkout -b feat/v2-<feature>

# 5. (Optional) run the four outstanding SQL files in Supabase to
#    activate the new tables on production
```

## Things to remember

- **Don't re-merge PR #14.** It is closed.
- **Don't second-guess scope.** When Vikash says "implement them all" he
  means literally — no triage, no "do you want X", just implement.
- **Don't hand-wave "Done".** Every feature must work end-to-end across
  browsers, not just "the function returns something". When in doubt, run
  the actual user flow in a fresh browser tab.
- **Watch for the Icon.jsx duplicates** (Tag/Hash/RotateCw). vite:esbuild
  will fail the build if you re-add them.
- **Vitest + Supabase mocks:** when a module has a `if (!supabase)
  return null` short-circuit, the mock must use a getter for
  `isSupabaseEnabled` (not a constant). See
  `~/.mavis/agents/mavis/memory/MEMORY.md` for the full pattern library.
- **Visual snapshots** are committed. Re-run with
  `npx playwright test <spec> --update-snapshots` when making UI changes.
- **Research artifacts** (10 untracked files in workspace root) are
  Vikash's research inputs. Leave them alone unless asked to move them.

## Summary numbers

- **Session start state:** v1.0 closeout (`0ae395b`, 800 tests)
- **Session end state:** v1.0+ drop merged (`ea3658a`), docs committed
  (`0333e19`), `1029` tests
- **Net delta:** +229 tests, +24 test files, +14 new source files
- **New routes:** `/workspace`, `/p/:slug`, `/gallery`
- **New SQL scripts:** 4 (analytics, provenance, public-reports,
  summary-feedback)
- **New localStorage keys:** `datiq.publicGallery`,
  `datiq.sharedExtractions`, `datiq.summaryFeedback`,
  `datiq.analytics`, `datiq.onboardingTour.v1`
- **New hotkeys:** `?` (help), `Esc` (close overlays), `/` (focus
  composer), `g d` (Dashboard), `g b` (Batch), `g s` (Schedules),
  `g p` (Pricing), `g w` (Workspace), `g t` (replay tour),
  `mod+k` (open command bar)

— End of session handoff
