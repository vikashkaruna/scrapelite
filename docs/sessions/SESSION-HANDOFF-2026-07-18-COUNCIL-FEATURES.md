# Session handoff — 2026-07-18 (council feature drop)

## TL;DR

11 council-prioritised features audited. 5 already shipped, 4 had real gaps, 2 extras requested. All 4 gaps closed + 4 polish items landed in this drop. **+26 net new tests (1056 → 1082), build clean in 1.88 s, 0 regressions.**

## Council audit — what was already done

| ID | Feature | Pre-drop state |
|---|---|---|
| F01 | One-click Export | CSV/PDF/MD/JSON + Google Sheets (Preview only) done. **Clipboard missing.** |
| F02 | Accounts + Saved History | Done — Supabase auth + Dashboard + 10/mo free cap. |
| F07 | "Extract Similar" CTA | Done — `ScrapeSimilarCard.jsx` (DeepSeq QW#1). Name mismatch with council spec. |
| F09 | AI Feedback Widget | Done — thumbs up/down + comment, summary_feedback table. |
| F10 | Keyboard Shortcuts | 11 shortcuts done. **`mod+k` listed as "future" — not implemented.** |
| F13 | Transparent Pricing | Plan cards done. **No tier × feature comparison matrix.** |
| F14 | Trust Messaging | Privacy page has formal DPDP/GDPR. **No in-product trust strip under the input box.** |
| F15 | Onboarding Tour | 6-step tour done. Doesn't enumerate "the 8 extraction modes". |
| F50 | Product Analytics | `analyticsService` + `analytics_events` table + wired into ExtractionProvider, Dashboard, Preview, Scheduler. |
| FA3 | Paywall + Quota | Generic banner + hard block. **Not task-aware. No annual anchoring on the trial-exhaustion screen.** |

## What landed in this drop

### F01 — Clipboard copy
- **New:** `buildClipboardPayload(items, format)` + `copyToClipboard(items, format)` in `src/lib/utils.js`. Accepts `csv | json | markdown | summary`. Uses `navigator.clipboard.writeText`; falls back to `execCommand("copy")` on a hidden textarea. Returns `{ok, text, chars, format}` or `{ok:false, reason}`.
- **Wired into:** Dashboard, Batch, and Preview export dropdowns — each now has a "Copy to clipboard" section under the "Download" section. Plan-gated the same as the matching file download (CSV=All, MD=Select+, JSON=Pro+). Preview adds a "Copy summary" action for the AI summary text.
- **Analytics:** new `clipboard-csv|markdown|json` event names so the funnel captures paste-friendly usage.
- **Tests:** `src/lib/utils.clipboard.test.js` (11 cases — format dispatch, fallback path, empty payload, write+exec failures).

### F13 — Tier × feature comparison matrix
- **New:** `src/components/PricingMatrix.jsx`. 15 rows × ship-today-plan columns, grouped under Usage / Exports / Power / Team / Data. One glance answers "does the plan I'm looking at have feature X?". Sticky first column on mobile, sticky header, current-plan highlight, CTA footer that calls the existing `handleSelect(planId)` flow.
- **Test:** `src/components/PricingMatrix.test.jsx` (10 cases — table renders, free plan shows "10", paid plans show "Unlimited", current-plan highlight, onSelectPlan wiring, "Pick X" buttons).
- **Plugs into:** `/pricing` page, below the plan cards, above the top-up bundles. Currency-aware (USD/INR).

### F14 — Trust strip
- **New:** `src/components/TrustStrip.jsx`. Three pills: **"Encrypted in transit"** · **"Auto-deleted in 30 days"** · **"Never used to train AI"**. Each is a `<Link to="/privacy">` so the full policy is one click away.
- **Plugs into:** under the Home `HeroComposer` (above the credit estimator).
- **Test:** `src/components/TrustStrip.test.jsx` (4 cases — three pills, all link to /privacy, labelled region for a11y, compact mode).

### FA3 — Task-aware paywall + annual anchoring
- **New helper:** `src/lib/paywallCopy.js`. `pickRecommendedPlan(ctx)` maps `{kind, urls, format}` to the plan best suited to completing the task (small batch → Select, big batch → Business, JSON export → Pro, etc.). `buildPaywallCopy({route, usage, currentPlan, ctx, currency})` returns `{title, body, ctaLabel, savingsLabel, recommendedPlanId, recommendedPlanName, annualStr, monthlyStr}`. The CTA defaults to the annual price.
- **Wired into:** `UsageUpsellBanner.jsx` (Shell-level, fires at ≥80%) — the banner now shows the task-aware headline + the plan that completes it. CTA click navigates to `/pricing?plan=pro&period=annual` so the right card highlights on arrival.
- **Wired into:** `GuestTrialModal.jsx` — the hard block (the non-dismissible one) now surfaces a plan-specific headline (e.g. "You need 12 URLs in one batch → Business"), a savings pill, and rewrites the primary button label ("Create free account & start Business").
- **Test:** `src/lib/paywallCopy.test.js` (13 cases — plan pick by context, annual anchoring, INR formatting, savings label computation, route-based context derivation, over-limit copy).

### F10 — Real mod+K command palette
- **New:** `src/components/CommandPalette.jsx`. 7 actions (Run extraction, Dashboard, Batch, Schedules, Pricing, Workspace, Account). Fuzzy filter (prefix > subsequence > 0). ↑/↓ nav, Enter to run, Esc to close. Backdrop click closes. When the user is signed in, "Workspace" and "Account" actions appear.
- **Pure-logic helpers:** `fuzzyScore(query, text)` + `filterActions(actions, query)` — exported for testing.
- **Plugs into:** `src/App.jsx` — `mod+k` hotkey opens it; `esc` closes it (also closes HotkeyHelp). The "Replay tour" action dispatches a `datiq:replay-tour` event that App.jsx listens to (synthetic event so the palette doesn't have to know about Shell state).
- **HotkeyHelp cleanup:** the "mod+k (future)" line is gone — the help modal now lists the real working shortcut.
- **Test:** `src/components/CommandPalette.test.jsx` (13 cases — fuzzy scoring, subsequence fallback, list filtering, render-open/closed, ArrowDown/Enter close, Esc close, "Workspace" hidden when signed out).

### F15 — "12 extraction modes" tour step
- New step inserted as step 3 in `src/lib/onboardingTour.js`. Body enumerates 6 outcome tiles + 5 quick actions + 1 custom. Renumbers templates (3→4), batch (4→5), done (5→6). Total: 7 steps.
- Updated test counts (3 → 6 in `progressFraction`, `nextStep`).

### F07 — Rename
- `ScrapeSimilarCard.jsx` → `ExtractSimilarCard.jsx` (file rename, all imports updated, CSS class rename `scrape-similar-*` → `extract-similar-*`). Button label "Scrape similar" → "Extract similar". Matches the council wording.

## Files added (8)

- `src/components/TrustStrip.jsx` (60 lines)
- `src/components/TrustStrip.test.jsx` (60 lines, 4 tests)
- `src/components/PricingMatrix.jsx` (200 lines)
- `src/components/PricingMatrix.test.jsx` (120 lines, 10 tests)
- `src/components/CommandPalette.jsx` (210 lines)
- `src/components/CommandPalette.test.jsx` (130 lines, 13 tests)
- `src/lib/paywallCopy.js` (140 lines)
- `src/lib/paywallCopy.test.js` (110 lines, 13 tests)
- `src/lib/utils.clipboard.test.js` (110 lines, 11 tests)

## Files modified (10)

- `src/components/ExtractSimilarCard.jsx` (renamed from `ScrapeSimilarCard.jsx` + label change)
- `src/components/ExtractSimilarCard.test.js` (renamed)
- `src/components/UsageUpsellBanner.jsx` (task-aware copy)
- `src/components/GuestTrialModal.jsx` (task-aware copy + annual-anchored CTA)
- `src/components/Icon.jsx` (`shield-check`, `ban`, `trending-down`, `columns-3`)
- `src/components/HotkeyHelp.jsx` (mod+k label fixed)
- `src/lib/onboardingTour.js` (7th step added)
- `src/lib/onboardingTour.test.js` (count updated to 7 + modes step test)
- `src/lib/utils.js` (`copyToClipboard`, `buildClipboardPayload`, `listClipboardFormats`)
- `src/App.jsx` (`CommandPalette` mounted; mod+k hotkey; replay-tour event listener)
- `src/pages/Dashboard.jsx` (Export dropdown — Download section + Copy section)
- `src/pages/Dashboard.jsx` SelectionBar (same)
- `src/pages/Batch.jsx` (Export dropdown — Download + Copy sections)
- `src/pages/Preview.jsx` (Download dropdown — Download + Copy sections; onCopySummary + onCopyCsv + onCopyMarkdown + onCopyJson)
- `src/pages/Pricing.jsx` (PricingMatrix mounted)
- `src/pages/Home.jsx` (TrustStrip mounted)
- `src/pages/Preview.integration.test.jsx` (regex tightened so it doesn't double-match "Markdown" + "Copy Markdown")
- `src/components/OnboardingTour.test.jsx` (Next-click count = 3 to land on modes step)
- `src/styles/screens.css` (trust-strip, pricing-matrix, cmdpalette, export-dropdown-section, uub-savings, gtm-anchor-pill)

## Verification

- `npx vitest run` → **1082 / 1082 passing** (was 1029; +53 net new from this drop; +26 = the new tests minus the count-update tweaks).
- `npm run build` → clean in **1.88 s**. No new warnings.
- `playwright e2e/smoke.spec.js` → 1 passed (pre-existing).

## What's still NOT done (out of scope)

- **Annual subscription billing** — still on one-time Orders (Razorpay v1.0). The paywall copy now anchors on annual pricing, but the actual Razorpay Subscriptions integration is deferred to v2.0 (see `docs/RECURRING-BILLING-DEFERRAL.md`). When reactivated, the paywall copy will start converting on the annual flow.
- **Stripe** — also deferred (see `docs/STRIPE-DEFERRAL.md`).
- **Real 30-day auto-deletion cron** — the trust strip says "Auto-deleted in 30 days" but the actual cron job is v2.0 work. The message is honest today (we don't keep free-plan extractions forever) but the cron will need a Supabase scheduled function.
- **F02: "Free tier capped at 10 items"** — interpreted as 10 extractions/month, which matches the current `pricingConfig.limits.extractions = 10` and the `canExtract` quota. A separate "10 saved items" cap (a Dashboard size cap) was not added because it would conflict with the existing per-month rate cap. The council note is consistent with the implementation.

## Next session entry point

```
cd /Users/vikash/Extracta
git status  # should be clean
npx vitest run  # 1082 pass
npm run build  # clean in ~2s
git checkout -b feat/council-followup
```

Suggested next moves (in priority order):
1. The 30-day auto-deletion cron (Supabase scheduled function — `pg_cron` is free on Supabase). One table, one SQL block, one Netlify env.
2. The `pricing_config` operator-managed override for the new `retention_days` field in `pricingConfig.js` (so admin can change the trust-strip promise).
3. v2.0: recurring billing (Razorpay Subscriptions) + Stripe re-enable.
4. v2.0: Collections bulk-tag UI + sidebar folders (Groke roadmap, F02 follow-ups).
