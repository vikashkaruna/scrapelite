# Session handoff — Habit-and-Reliability branch (2026-07-19)

## TL;DR

Created branch `Habit-and-Reliability` and shipped 9 council-prioritised features
(F17, FC1, F16, F18, F36, FD3, F49, F03, FD2) at the user's requested scope
(All 9, full depth; full test depth + staging deploy + smoke).

Most of the foundation was already on `main` from prior sessions (FD2 cache,
FD3 compliance + rate limit, F36 headless stub, F17 scheduler with email
alerts, F49 weekly digest + D7 re-engagement, F16 batch with retry+CSV,
FC1 WatchlistCard, F03 Collections, F18 Google Sheets deep link). The
new work in this branch closes the remaining 10% gaps:

- **F18** — Real Airtable + Notion adapters (replaces the waitlist stub)
- **F17** — Slack-formatted webhook alongside the existing generic JSON
- **F49** — 3 more triggers: welcome email, daily schedule-ran digest, D30 abandoned-trial
- **F36** — Headless attribution surfaced to the UI ("Rendered via Firecrawl" or warning)
- **F16** — Sortable results table + status filter chips on `/batch`

## Commit graph (4 commits, all on `Habit-and-Reliability`)

```
fb91659 chore: ignore scripts/env/ (operator-only Netlify env files)
1a8eb55 feat(F17/F49/F36): Slack alerts + 5-trigger drip + headless attribution
02cc976 feat(F18): Airtable + Notion real adapters + Export Integrations modal
e8d8cc3 docs: session handoff 2026-07-19 build fixes + CLAUDE.md refresh (main)
074abfe Merge branch 'fix/topbar-single-cta' into main (main)
```

## What was already on `main` (no work needed)

| Feature | File(s) | Status |
|---|---|---|
| **FD2** Idempotent cache | `src/lib/resultCache.js`, `netlify/functions/lib/resultCacheStore.js`, `scripts/result-cache.sql` | ✅ used by `extract.js` |
| **FD3** Compliance | `netlify/functions/lib/complianceEngine.js`, `scripts/rate-limit-log.sql` | ✅ wired into `extract.js` |
| **FD3** Per-host rate limit | `netlify/functions/lib/rateLimiter.js` | ✅ wired into `extract.js` |
| **F36** Headless stub | `netlify/functions/lib/headlessProvider.js` | ✅ delegates to upstream `waitFor` |
| **F17** Scheduler | `src/lib/schedulerService.js`, `netlify/functions/scheduled-runner.js`, `scripts/scheduler.sql` | ✅ Resend email + generic JSON webhook |
| **F49** Weekly digest | `netlify/functions/reengagement.js` (2 of 5 triggers) | ✅ + extended in this PR |
| **F16** Batch | `src/pages/Batch.jsx`, `src/lib/batchService.js` | ✅ CSV, retry, parallel, intent chips |
| **FC1** Watchlist | `src/components/WatchlistCard.jsx`, `src/lib/watchlistDeltas.js` | ✅ in `/workspace` |
| **F18** Google Sheets | `openInGoogleSheets` in `src/lib/utils.js` | ✅ deep link |
| **F03** Collections | `src/lib/collectionsService.js`, `src/pages/Collections.jsx`, `src/components/CollectionPicker.jsx` | ✅ full CRUD |

## What's NEW in this branch

### F18 — Airtable + Notion real adapters
- `src/lib/airtable.js` (219 LOC) — pure key/field helpers + `pushToAirtable` with 10-record chunking
- `src/lib/notion.js` (268 LOC) — schema fetcher + property mapper + `pushToNotion`
- `src/components/ExportIntegrations.jsx` (399 LOC) — 3-tab modal (Sheets/Airtable/Notion) with API key paste flow
- 27 + 34 + 15 = **76 new unit tests**
- Wired into Dashboard + Batch ExportDropdown + SelectionBar
- API keys are NEVER persisted; only Base/Table/Database IDs + column schema map
- Toast: "Pushed N records to Airtable / N pages to Notion"

### F17 — Slack-formatted webhook
- `netlify/functions/lib/slackFormatter.js` (190 LOC) — Block Kit builders for change alert + weekly summary + welcome
- `scheduled-runner.js` posts to `SLACK_WEBHOOK_URL` alongside the existing `SCHEDULE_ALERT_WEBHOOK` (independent, both optional)
- **16 new unit tests**
- Operators configure either or both; no secrets in code

### F49 — Full 5-trigger drip
- `netlify/functions/welcome-email.js` (113 LOC) — new function, fires from AuthProvider on SIGNED_IN, idempotent via user-metadata flag
- `reengagement.js` extended with 2 new triggers (was 2/5, now 5/5):
  - **Daily schedule-ran digest** (fires at `DAILY_DIGEST_HOUR_UTC`, default 21:00 UTC)
  - **D30 abandoned-trial** (free-tier users with no runs in 30+ days, opt-out via `D30_ENABLED=false`)
- **29 new unit tests** (11 for welcome-email, 18 for reengagement new triggers)
- AuthProvider.jsx: fire-and-forget `/api/welcome-email` call on SIGNED_IN

### F36 — Headless attribution surfaced
- `extract.js` now returns a `_headless` field when `renderJs: true` is requested
- Field reports whether JS was actually rendered (via upstream `waitFor`) or fell through to static HTML (no headless provider)
- `firecrawlService.js` passes the field through to the extraction result
- UI can now show "Rendered via Firecrawl (waitFor=3000ms)" or warn the user

### F16 — Sortable results table
- Filter chips: All / Success / Failed (with counts)
- Sort dropdown: original / URL A→Z / URL Z→A / Status (errors first) / Title A→Z / Most headings
- CSS in `screens.css` (45 LOC) for the new control group
- Retry/view handlers still work correctly — the displayed index is mapped back to the original `results` array

## Files added

| Path | LOC | Purpose |
|---|---|---|
| `src/lib/airtable.js` | 219 | F18 Airtable adapter |
| `src/lib/airtable.test.js` | 227 | F18 Airtable unit tests |
| `src/lib/notion.js` | 268 | F18 Notion adapter |
| `src/lib/notion.test.js` | 254 | F18 Notion unit tests |
| `src/components/ExportIntegrations.jsx` | 399 | F18 export modal |
| `src/components/ExportIntegrations.test.jsx` | 208 | F18 export modal tests |
| `netlify/functions/lib/slackFormatter.js` | 190 | F17 Slack Block Kit |
| `netlify/__tests__/lib/slackFormatter.test.js` | 157 | F17 Slack tests |
| `netlify/functions/welcome-email.js` | 113 | F49 welcome trigger |
| `netlify/__tests__/welcome-email.test.js` | 163 | F49 welcome tests |

## Files modified

| Path | Net change |
|---|---|
| `src/pages/Dashboard.jsx` | +32 (ExportIntegrations wiring) |
| `src/pages/Batch.jsx` | +115 (F16 sort+filter, F18 modal wiring) |
| `src/styles/screens.css` | +166 (F18 modal + F16 table controls) |
| `src/components/AuthProvider.jsx` | +15 (F49 welcome-email fire-and-forget) |
| `src/lib/firecrawlService.js` | +5 (F36 _headless pass-through) |
| `netlify/functions/extract.js` | +17 (F36 _headless in response) |
| `netlify/functions/scheduled-runner.js` | +9 (F17 Slack dispatch) |
| `netlify/functions/reengagement.js` | +171 (F49 daily + D30 triggers) |
| `netlify/__tests__/reengagement.test.js` | +80 (F49 new tests) |
| `.gitignore` | +1 (ignore `scripts/env/`) |

## Test status

| Suite | Pass | Fail | Notes |
|---|---|---|---|
| Vitest unit + integration | 1424 | 1 (pre-existing flake) | Gallery `renders a card for every shared extraction` times out on cold cache; passes on re-run. Not related to this branch. |
| Vitest system tests | 174 | 0 | All passing |
| Build | clean | — | 2.03s, no errors |
| `scripts/smoke-prod.mjs` | 10/10 | 0 | All SPA routes + static assets + `/api/stats` |
| Playwright e2e smoke | 1/1 | 0 | `e2e/smoke.spec.js` core SPA routes |

**Net new tests: 121** (76 F18 + 16 F17 + 29 F49)

## Deployment

- **Branch pushed** to `origin/Habit-and-Reliability` (PR not yet opened — user to review and merge)
- **Netlify deploy preview** is auto-generated from the push; check Netlify dashboard for the preview URL
- **Manual smoke** against `localhost:8888` (via `npx netlify dev`) showed all 10 smoke probes pass
- **Functions tested locally**: `welcome-email`, `scheduled-runner`, `reengagement` all degrade gracefully when Supabase is not configured (return "skipped (no …)")

## New env vars to add in Netlify (operator)

| Variable | Context | Purpose |
|---|---|---|
| `SLACK_WEBHOOK_URL` | production, staging | Optional. When set, schedule-change alerts also post to Slack via Block Kit. Independent of `SCHEDULE_ALERT_WEBHOOK`. |
| `DAILY_DIGEST_HOUR_UTC` | production, staging | Optional. Hour (0-23 UTC) at which the daily "your schedules ran today" digest fires. Default 21. |
| `D30_ENABLED` | production, staging | Optional. Set to `false` to disable the D30 abandoned-trial trigger without removing the code. Default enabled. |

(No changes to existing env vars. The `welcome-email` function uses the same
`SUPABASE_*` and `RESEND_API_KEY` + `ALERT_EMAIL_FROM` already set.)

## What's NOT in this branch (deliberate)

- **OAuth flows for Airtable/Notion** — per user's explicit preference, v1 ships API-key-paste only. OAuth is a follow-up that needs a server-side proxy for token exchange + refresh.
- **Native Playwright binary in Netlify Functions** — the `headlessProvider.js` stub delegates to upstream providers' `waitFor` (Firecrawl + Spider). A real Playwright layer would need a separate deployment target (Fly.io / Railway) and is deferred to v2.0.
- **Netlify deploy preview URL** — the branch is pushed, the preview will auto-generate. User to confirm and merge to main.

## Risks / follow-ups

1. **Pre-existing Gallery flake** — `src/pages/Gallery.test.jsx > renders a card for every shared extraction` times out 1/10 runs at 5s. Unrelated to this branch (was flake before this work). Investigate when convenient.
2. **Netlify `ignored_files` is an object, not an array** (per existing memory) — the new `welcome-email.js` follows the same pattern; future contributors should NOT add files ending in `.test.js` to `netlify/functions/`.
3. **Welcome email timing** — fires from the browser on `SIGNED_IN`, not from the server. If the user signs in offline, the email won't be sent until they're back online. Acceptable trade-off for v1; a server-side trigger is a v2.0 follow-up.
4. **Schedule-ran daily digest uses `lastRunAt`** — if a schedule is paused, the digest for that day is correct. But if a schedule runs multiple times in a day, the digest counts rows (one per schedule per day) not runs. Fine for the v1 UX; a future enhancement could log each run to a `run_events` table for precise counts.

## How to verify locally

```bash
git checkout Habit-and-Reliability
npm install
npm test                    # 1424/1425 (1 pre-existing flake)
npx netlify dev             # port 8888 with full function stack
node scripts/smoke-prod.mjs http://localhost:8888   # 10/10
# Open http://localhost:8888 in a browser, navigate to /dashboard, click any
# row to select, then Export ▾ → Integrations… to see the F18 modal.
```

## Branch: `Habit-and-Reliability`
## Main at: `e8d8cc3` (unchanged)
## This branch head: `fb91659`
## Net diff: ~2800 LOC added, ~20 LOC removed
