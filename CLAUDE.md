# DatIQ — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-07-27 (late) — INVOICING + SUBSCRIPTION LIFECYCLE IS EXECUTED, GREEN, AND MERGED TO `staging` (`origin/staging` = `0b207cf`). `main` IS UNTOUCHED AT `f56306d` — PRODUCTION IS A SEPARATE, DELIBERATELY-GATED DECISION. STILL NOT APPLIED TO ANY REAL SUPABASE PROJECT.** Merged from `claude/prod-db-migration-commands-8ea1bc` (same 4 invoicing commits as `claude/datiq-invoicing-model-e16ea3`, plus the release-readiness work below); `git diff` between that branch and `staging` is empty. Next session starts at [docs/SESSION-HANDOFF-2026-07-27-MIGRATIONS-EXECUTED-AND-STAGING.md](docs/SESSION-HANDOFF-2026-07-27-MIGRATIONS-EXECUTED-AND-STAGING.md). **Two traps before production: (a) Netlify production is LOCKED by design — releasing needs a manual UI unlock plus an `approved` comment, and never "fix" a lock error with `--prod-if-unlocked` (that makes a DRAFT deploy, the smoke job then passes against OLD production, and the run claims a release that never shipped); (b) **`staging.datiq.app` was serving PRODUCTION — now FIXED in Netlify, but ALWAYS verify it by BUNDLE HASH, never by a 200.** It had been added as a plain DOMAIN ALIAS on the production site, and an alias always serves the site's PUBLISHED deploy — so it returned `index-BFw7HNTs.js` (identical to `datiq.app`) instead of the staging build, and lacked every artifact of the release that had just deployed. TLS worked, which is why it failed SILENTLY. **Two wrong fixes were tried first — DO NOT repeat either:** (i) repointing the CNAME to `staging--datiqapp.netlify.app` changed NOTHING, because that host and `datiqapp.netlify.app` share the same edge IPs and Netlify routes by **`Host` header**, not by IP or CNAME target; (ii) `branch_deploy_custom_domain = staging.datiq.app` is wrong because that field is a **BASE** domain — Netlify serves `<branch>.<base>`, which produced `staging.staging.datiq.app` (proven: it served the staging build, while `main.staging.datiq.app` served main). **Correct config, applied: `branch_deploy_custom_domain = datiq.app`, `domain_aliases = []`, zone = `datiq.app` + `www.datiq.app` + wildcard `*.datiq.app`.** Two in-repo bugs also fixed: `smoke:staging` pointed at that hostname (now `${STAGING_URL:-https://staging--datiqapp.netlify.app}`), and both workflows advised setting `STAGING_URL` to it once aliased — a condition later met, which would have made the phase-gate smoke PRODUCTION while gating a production release. Verify with `curl -s https://staging.datiq.app/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'`. **(c) 🔴 NONE OF THE FOUR CRON FUNCTIONS WAS EVER SCHEDULED — fixed 2026-07-27, still UNVERIFIED in production.** `scheduled-runner` had NOT run hourly since R19, and `billing-lifecycle` (the entire lifecycle + dunning engine) would never have fired at all. Cause: each declares `export const config = { schedule: … }` beside `export const handler`, and that export is honoured **only for v2 functions** (`export default`) — ours are v1, and `@netlify/functions` is not a dependency so the v1 `schedule()` wrapper is not in use either; `netlify.toml` declared no schedules. Confirmed three ways: `searchSiteFunctions` reported `schedule: null` for EVERY function, `GET /.netlify/functions/reengagement` returned **200 and RAN the handler**, and deploys report `runtimeAPIVersion: 1`. Fixed by declaring all four schedules in `netlify.toml`. This also closed an exposure: **`billing-purge`, the only destructive job in the system, was a publicly reachable HTTP endpoint.** ⚠️ Netlify runs scheduled functions for the PRODUCTION deploy ONLY, so this can only be verified after it reaches `main` — expect a non-null `schedule` from `searchSiteFunctions` and a **404** on `/.netlify/functions/reengagement`. Until then treat the lifecycle/dunning system as NOT RUNNING. **The headline change since the earlier entry: migrations 0001–0017 have now actually been RUN — all 17 apply cleanly, and all 9 database functions, both triggers and the RLS ownership policies are exercised by 89 assertions via `npm run test:db`** ([scripts/db-verify.mjs](scripts/db-verify.mjs), in-process WASM Postgres, no Docker/psql/network). Zero defects were found in the migrations themselves. That closes the single biggest open risk in the previous entry, but it is **not** the same as applying to a real Supabase project — PGlite has no GoTrue, no PostgREST and no Supabase roles (they are shimmed), so the manual scratch-project apply is still required before production. Full command reference: [docs/DB-MIGRATION-RUNBOOK.md](docs/DB-MIGRATION-RUNBOOK.md). Pre-merge issue register: [docs/RELEASE-READINESS-2026-07-27-INVOICING.md](docs/RELEASE-READINESS-2026-07-27-INVOICING.md).
>
> Prior (same day, before execution): Branch `claude/datiq-invoicing-model-e16ea3`, 4 commits off `main` @ `f56306d`, 69 files, +10,326/−166. DatIQ previously had no invoicing model at all and no notion of a subscription ending; it now issues a numbered, itemized, GST-capable document per payment, emails it, exposes view/download/resend in Account, and runs active → suspended (30d) → deactivated (60d more) → purge at day 90, with automation pausing and resuming with the subscription. Tests: unit 1005→**1436**, contract 382→**496**, integration 180→**205**; build clean; readiness 5 pass/2 warn/0 fail. **THREE THINGS TO KNOW BEFORE TOUCHING IT: (1) ~~migrations 0012–0017 have NEVER been executed~~ — SUPERSEDED: they now execute cleanly under `npm run test:db`, but that is WASM Postgres with shimmed Supabase roles, so a scratch-project apply is still required before production; (2) migration ORDER IS LOAD-BEARING — 0012 (neutral) → ship dual-write for one release → 0013 backfill → 0014 RLS flip, and after 0014 guest/unclaimed payment history stops showing in-app by design; (3) the purge ships DISARMED (`PURGE_ENABLED` unset) and cannot delete anyone who has not received the `delete_d90` notice.** Entitlements are now server-authoritative and keyed to `auth.users.id`; the old `anon full access` RLS on `subscriptions`/`payment_events` (world-readable, world-writable) is replaced in 0014. Security fixes en route: `verify-payment.js` trusted `planId` from the request body and echoed it back unchecked (a free-upgrade path once the server grants access), and `schedules.js` let the client dictate `status`. Still pending: the `/admin/billing` React page (API + 34 tests exist, no UI), billing-details capture UI, proration wired into checkout, e2e specs. Session detail: `docs/SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md`.
>
> Prior: 2026-07-26 — `main` and `staging` in sync with origin, still only two branches. THE WHOLE PIPELINE IS GREEN AND PRODUCTION SHIPPED: the full Phase-Gate ran end to end on `5201cd4` at 06:43Z (all gates → approval → deploy → production smoke → re-lock), closing the ~7-day gap where `datiq.app` was frozen on `527a8ee` from 2026-07-19. Staging Gate's `Deployed & Smoke Tested` is 12/12, up from a long-red 11/12. The blocker had been that Netlify production deploys are LOCKED — that is what "Stop auto publishing" does, and it is the protection that stops pushes to `main` bypassing the gate — and a lock blocks EVERY publish path including `netlify deploy --prod`, so every approved release since 2026-07-19 died at that one step. RELEASING PRODUCTION NOW TAKES TWO HUMAN ACTS, by design: (a) unlock production in the Netlify UI, then (b) comment `approved` on the approval issue. The workflow deliberately does NOT unlock for you; `deploy-production` only verifies the unlock and fails fast with instructions, and `relock-production` re-locks at the end so every release needs a fresh unlock. DO NOT "fix" a lock error with `--prod-if-unlocked`: while locked that makes a DRAFT deploy, the smoke job then tests old production and passes, and the run claims a release that never shipped. Admin PINs: `ADMIN123` is dead on staging and previews ✅, but all three non-production contexts still SHARE one `ADMIN_PIN_HASH` — separating them is the top open item. Session detail: `docs/SESSION-HANDOFF-2026-07-26-CI-GATE-UNBLOCK.md`.**
>
> Prior: 2026-07-25 (late) — `main` and `staging` at the same commit. Six already-merged branches deleted locally and on origin (SHAs in that handoff if one ever needs restoring). `Test Suites` went from a 25-minute timeout to 10m51s after the e2e smoke was corrected to run chromium only (it had been silently running all three browsers — 294 tests instead of 98). `staging.datiq.app` is NOT provisioned (CNAME points at the wrong site slug, and no cert covers it), so the gate smoke-tests `staging--datiqapp.netlify.app` via the `STAGING_URL` repo variable. Session detail: `docs/SESSION-HANDOFF-2026-07-25-BRANCH-CLEANUP-AND-GATE.md`.
>
> Prior: 2026-07-25 — main was at `dc71fe5`, staging at `4ea6883`. Contact-form rework shipped: two customer inboxes (`hello@` / `admin@`), delivery moved to Resend via `POST /api/contact-email` with server-authoritative routing, and mail senders split one env var per sender. Session detail: `docs/SESSION-HANDOFF-2026-07-25-CONTACT-RESEND.md`.
>
> Prior: 2026-07-19 — main was at `074abfe`.  4 small build/CI/UX fixes since the pre-cutover drop: TOML duplicate key, secrets scanner false positives, missing `scripts/smoke-prod.mjs`, TopBar single CTA. v1.0+ live on datiq.app. Pre-cutover for 3-tier Netlify + isolated prod Supabase. See `NETLIFY-ENVIRONMENTS.md` (recommended) or `FIREBASE-MIGRATION.md` (alternative). Session detail: `docs/SESSION-HANDOFF-2026-07-19-BUILD-FIXES.md`.**
>
> Recent: R19 (Scheduler + unified Home composer, `980ac21`); SEO URL fix `scrapelite.netlify.app`→`datiq.app` (`f535e75`); R20 docs/help overhaul (`762d2e6`); **v1.0 closeout + M0–M7 quality-gate** (vitest 800 + playwright 363, `0ae395b`); **Cloud BI Q1–Q11 + alternate Q1/Q3/Q4/Q5/Q11 quick wins** (vitest 800 → **1029**, 24 new test files, 4 new SQL scripts, 4 new routes — `/workspace`, `/p/:slug`, `/gallery`, on-demand tour replay via `g t`). PR #14 closed; feat/v1-quickwins fast-forwarded to `ea3658a`. **2026-07-19: Pre-cutover production isolation** — `NETLIFY-ENVIRONMENTS.md` (recommended) + `FIREBASE-MIGRATION.md` (alternative) plans merged; 3 prod-isolation fixes (psql→pg, 0001 self-contained, phase-gate workflow); per-context env blocks in `netlify.toml`. See "Outstanding tasks → Pre-cutover: Production isolation" below. **2026-07-19 (late): 4 small fixes** — TOML duplicate `VITE_SUPABASE_ANON_KEY` (`b8b1e53`); secrets scanner omits (`71a2586`); missing `scripts/smoke-prod.mjs` (`92b3af9`); TopBar single primary CTA (`074abfe`).
>
> Next session entry point: read `AGENTS.md` → `CLAUDE.md` (this file) → `git log --oneline -10` → `git status`. If starting a v2.0 effort, branch from `main`.

---

## Quick orientation

| Property | Value |
|---|---|
| **Project** | DatIQ — zero-code web-extraction + enrichment platform |
| **Working dir** | `/home/user/scrapelite` (remote) or `/Users/vikash/Extracta` (local) |
| **Live site** | https://datiq.app (Netlify project `datiqapp`; also https://datiqapp.netlify.app — the old `scrapelite.netlify.app` host now 404s) |
| **GitHub** | https://github.com/vikashkaruna/scrapelite |
| **Netlify site ID** | `0ac65a7e-bd3f-4cde-a8d3-66c23899c473` |
| **Netlify** | https://app.netlify.com/projects/scrapelite |
| **Run locally** | `npm run dev` → http://localhost:5173 |
| **Branches** | `main` @ `f56306d` and `staging` @ `ac82be0` — **staging is now 7 commits AHEAD of main** (the invoicing release + 5 Netlify/CI fixes). Also live: `claude/prod-db-migration-commands-8ea1bc` (the original release branch, 1 commit behind staging) and `claude/datiq-invoicing-model-e16ea3` (its 4-commit ancestor). Plus `workflow-implementation-and-optimization` @ `d94c2e3` (9 commits ahead of staging — the v2 n8n + MCP pipeline, NOT yet merged to staging or main). Branch from `staging` to build on the release, from `main` for anything that must ship independently of it. |
| **Latest commit** | Run `git log --oneline -5` — the last drop was three CI fixes (`0676ed1`, `372c29a`, `af4dc5c`) merged via PRs #16 and #17 |
| **Verify the schema locally** | `npm run test:db` — applies all 17 migrations to in-process WASM Postgres and asserts every function, trigger and RLS policy. ~5s, no Docker, no network, no credentials. Run it after ANY migration change. |

---

## R19 — Scheduler & unified Home composer (MERGED to main — PR #12)

> Built 2026-06-18, **merged to main 2026-06-20** (`980ac21`; PR #12). Netlify production auto-deployed. **The only remaining step to make recurring runs live is running `scripts/scheduler.sql` in Supabase** (creates `scheduled_tasks` + base `extractions`) — all required Netlify env vars are already set (verified 2026-06-20: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `SCHEDULE_ALERT_WEBHOOK`, scraping + AI keys). Until the SQL is run, the hourly runner errors on a missing table; schedules persist in localStorage and "Run now" works regardless.

**Feature summary**
1. **Unified Home composer** (`src/components/HeroComposer.jsx`) replaces the old single-line URL field. One textarea + bottom toolbar: `+` (Import CSV / paste multiple URLs), **Batch** toggle, **Schedule** preset dropdown, and a compact in-box action button whose icon changes by mode (single → `arrow-up`, batch → `layers-2`, scheduled → `calendar-clock`; scheduled button tinted purple). Drag-drop CSV anywhere on the box. Home is popup-free.
2. **Paste-anything** — non-URL input is extracted as raw text/HTML locally (`extractStructure({ rawText })` → `buildStructureFromText` in `firecrawlService.js`; summary prompt reads `raw_text`). Pseudo-URL `text://pasted-…`.
3. **Smart dispatch** (HeroComposer.runAction): single→inline extract; raw text→paste-anything; ≥2 URLs (or Batch on)→`/batch` with `{urls,intent,autorun:true}` (Batch.jsx auto-runs on `location.state.autorun`); preset armed→creates a schedule and routes to `/schedules`.
4. **Scheduling** — Home only arms a **preset cadence** (works for single URL OR batch). "Custom schedule…" item in the dropdown routes to `/schedules` with the input prefilled (`location.state.draftSchedule` + `openEditor`). All real config lives on `/schedules`.
5. **/schedules page** (`src/pages/Schedules.jsx`) — inline `ScheduleEditor` (create/edit, no modal), custom cadence builder (frequency · weekday/day-of-month · time → cron), **"Run until" end date**, alert email, name, intent. List cards: **expandable detail** (all params + cron + lifecycle), Run now (single, with change detection), Edit, Pause/Resume, Delete.
6. **Dashboard** (`src/pages/Dashboard.jsx`) — new **Type column** + chip (Single / Batch / Scheduled), **category filter** (All/Single/Batch/Scheduled segmented control), and **collapsible job grouping**: batch runs and scheduled runs render as collapsible parent rows; single extractions standalone. Pagination is over *blocks* so grouping never breaks the pager.
7. **Persistence** — schedules: `schedulerService.js` (localStorage `datiq.schedules` + `/api/schedules` sync). Scheduled run-now saves a tagged extraction to the dashboard (`saveScheduledExtraction` in extractionsRepo + `recordScheduledItem` in batchRunsService, group id `schrun_<scheduleId>`, `kind:"schedule"`). Batch runs now carry `kind:"batch"`.
8. **Server execution** — `netlify/functions/scheduled-runner.js` (Netlify Scheduled Function, `config.schedule = "@hourly"`) reads active+due schedules (cron matcher, skips expired), re-scrapes, fingerprints, detects change, fires alert webhook. `netlify/functions/schedules.js` = per-user CRUD proxy (auth-gated, localStorage fallback).

**Files added:** `src/components/HeroComposer.jsx`, `src/components/ScheduleEditor.jsx`, `src/lib/schedulerService.js`, `src/pages/Schedules.jsx`, `netlify/functions/schedules.js`, `netlify/functions/scheduled-runner.js`.
**Files changed:** `App.jsx` (route `/schedules`), `TopBar.jsx` (nav link), `Icon.jsx` (+arrow-up, pause, bell, calendar-clock), `utils.js` (classifyInput/extractUrls/looksLikeUrl/looksLikeHtml/hashContent), `firecrawlService.js` + `aiService.js` (paste-anything), `apiClient.js` (schedules CRUD), `extractionsRepo.js` (saveScheduledExtraction), `batchRunsService.js` (recordScheduledItem + kind), `Batch.jsx` (autorun + kind), `Home.jsx` (uses HeroComposer), `Dashboard.jsx` (category/filter/grouping), `screens.css`. **Deleted:** `src/components/ScheduleModal.jsx` (replaced by inline ScheduleEditor).
**New localStorage key:** `datiq.schedules`. **New routes:** `/schedules`.

### R19 Supabase setup (THE one remaining step — run the SQL)
**Run `scripts/scheduler.sql` in the Supabase SQL Editor** (idempotent; creates `public.scheduled_tasks` + base `public.extractions` with per-user RLS). That's it — the Netlify env below is **already set** (verified 2026-06-20). Without the table, the hourly runner errors on each run; schedules still persist in localStorage and "Run now" works.

Netlify env needed by the runner (✅ all already set): `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service key bypasses RLS to read/update all users' schedules). The scheduled function auto-registers on deploy (no toml change). After running the SQL, confirm Netlify → Functions shows `scheduled-runner`, and that the `ALERT_EMAIL_FROM` domain is verified in Resend.

**Alert email delivery (wired):** on a detected change, `fireAlert()` sends a real HTML email **directly via Resend** and also posts a `schedule.changed` event to the automation webhook. Email env (optional — both paths degrade gracefully):
- `RESEND_API_KEY` — from resend.com; required to actually send email. Without it, no email is sent (webhook still fires).
- `ALERT_EMAIL_FROM` — sender, e.g. `DatIQ Alerts <alerts@datiq.app>` (the domain must be verified in Resend). Defaults to that.
- `SCHEDULE_ALERT_WEBHOOK` (else `VITE_WEBHOOK_URL`) — optional n8n/Zapier/Make webhook; receives the change event (`emailSent` flag included) for automations.
- `URL`/`SITE_URL` — used for the "View in DatIQ" link (Netlify sets `URL` automatically).
The manual "Run now" on /schedules is client-side and only toasts the change; automated (hourly) runs send the email.

---

## v2 Plan — n8n + MCP Workflow Pipeline (branch `workflow-implementation-and-optimization`)

> **Status:** All 7 phases shipped on the branch (4 commits). 262 new tests (1308 total). Razorpay workflow deferred to V2 per user decision.
> **Plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md`
> **Reference deployment:** Hostinger VPS at `https://n8n-k8q6.srv1738397.hstgr.cloud/` (self-hosted n8n, SQLite, n8n built-in user accounts)

### Architecture

`scheduled-runner.js` (hourly) → `enqueueEvent()` → `workflow_events` table → `workflow-orchestrator.js` (every 5 min) → self-hosted n8n → Slack + Resend + ...  Self-hosted n8n ALSO acts as the MCP server (via n8n's MCP Server Trigger node) so any MCP client (Claude Desktop, Claude Code, mavis) can call 11 tools to read state, manage schedules, and process the queue.

### What's new

| Component | What it does |
|---|---|
| `supabase/migrations/0018_workflow_events.sql` | 3 new tables: `workflow_events` (queue), `workflow_runs` (per-attempt log), `workflow_subscriptions` (per-user channel prefs). All RLS-locked; service-key only. |
| `netlify/functions/lib/workflowEnqueue.js` | Build + enqueue. Backoff schedule (1m, 5m, 30m, 2h, 12h). Kind whitelist. |
| `netlify/functions/lib/workflowOrchestrator.js` | Poll + claim (optimistic concurrency) + dispatch + state transitions. All pure, testable. |
| `netlify/functions/lib/n8nSignature.js` | HMAC-SHA256 + 5-min replay window + constant-time compare. |
| `netlify/functions/workflow-orchestrator.js` | Netlify Scheduled Function (every 5 min) + HTTP endpoint for manual `/dispatch` and `/run-now`. |
| `netlify/functions/scheduled-runner.js` (modified) | Replaced direct Resend/Slack/webhook with `enqueueEvent()`. The TODO(SCHEDULE_ALERT_WEBHOOK) is done. |
| `netlify/functions/admin-automation.js` | GET (stats + events) + POST (retry/cancel/dispatch/run-now). Token-gated. |
| `n8n/workflows/*.json` (17 files) | 11 MCP tool workflows + 5 automation flows + 1 smoke test. Generated by `scripts/generate-n8n-workflows.mjs`. |
| `n8n/{docker-compose.yml,.env.example,Caddyfile,backup.sh,restore.sh}` | Self-hosted n8n on Hostinger VPS, SQLite, 14-day backup retention. |
| `n8n/ops/{DEPLOY,BACKUPS,UPGRADES,SECRETS}.md` | Operator runbook. |
| `src/pages/admin/AdminAutomation.jsx` | `/admin/automation` — KPI grid, by-kind chips, filterable event table, detail panel with retry/dispatch/cancel. |
| `docs/{N8N-WORKFLOWS,N8N-OPERATIONS,MCP-TOOLS}.md` | User-facing docs. |

### How to deploy the v2 changes (operator checklist)

1. **Apply the Supabase migration:**
   ```bash
   PROD_SUPABASE_DB_URL=... npm run migrate:prod
   # (or paste supabase/migrations/0018_workflow_events.sql in the SQL editor)
   ```
2. **Set the new Netlify env vars per context (see `NETLIFY-ENVIRONMENTS.md`):**
   - `N8N_BASE_URL` = `https://n8n-k8q6.srv1738397.hstgr.cloud`
   - `N8N_WEBHOOK_SECRET` = same value as `DATIQ_N8N_API_KEY` on the n8n side
   - `WORKFLOW_ORCHESTRATOR_TOKEN` = `openssl rand -hex 32` (separate, for the HTTP trigger)
3. **Import the workflows into n8n** (one-time):
   ```bash
   npx n8n import:workflow --input=n8n/workflows/
   ```
4. **Create the 3 credentials in n8n** (one-time): `datiq-resend`, `datiq-slack-monitoring`, `datiq-supabase-service`. See `n8n/ops/DEPLOY.md` §8.
5. **Smoke test:**
   ```bash
   curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
     -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
   ```

### Razorpay V2 followup (deferred)

The Razorpay payment-lifecycle workflow (plan §④) was deferred to V2 per user decision 2026-07-26. The current code path (per-event Slack/email scattered across `payment-webhook.js`) is unchanged. When we come back to it, follow the same pattern as `datiq_user_lifecycle.json` — webhook trigger + Resend/Slack + update `workflow_events.state`.

---

## Branch merge history (completed 2026-06-09 → 2026-06-15)

All branches have been merged to main and pushed. Do NOT re-merge them.

| Branch | What it added | Merged |
|---|---|---|
| `Version-2.0-Docs` | Public help site at `/help/index.html` (16 pages) | ✅ |
| `v2-build-api-layer` | Netlify Functions API proxy (`/api/*`), `apiClient.js`, `authService.js` | ✅ |
| `v3-supabase-auth` | Supabase email+OAuth auth, `AuthProvider`, `AuthModal` | ✅ |
| `claude/v4-persona-onboard-lEZ1g` | 7-persona onboarding, `PersonaProvider`, `Footer`, Privacy/Terms pages | ✅ |
| `claude/v5-pricing-billing-7xoRQ` | Stripe/Razorpay/UPI payments, `BillingProvider`, admin console, usage metering | ✅ |
| `claude/v6-datiq-rebrand-82s24f` | DatIQ rebrand — localStorage keys → `datiq.*`, console logs → `[DatIQ]` | ✅ |
| `claude/r0-check-merged-fix-ui-4o44k2` | R0 UI polish + SEO/GEO + 7 new marketing pages + dropdown + email capture | ✅ merged to main |
| `claude/r0-polish-fix-ui-issues-mmrjql` | R1 UI polish: responsive nav, hamburger, geo-currency, persona chips, tooltips, favicon, footer slim | ✅ merged to main |
| `claude/r0-polish-ui-issues-fqbogg` | R2+R3: onboarding in Shell, nav routing, topbar alignment, auth-gated menus, padding override, collapsible admin sidebar | ✅ merged to main |
| `claude/r0-polish-ui-fixes-11ikut` | R4: pricing overhaul (USD+INR, annual, new tiers), /contact, /use-cases, founder block, DPDP, Indian arbitration, usage banner, blog modal, branding fixes | ✅ merged to main |
| `claude/batch-mode-export-formats-fkjkxx` | R5–R7: /batch page, CSV import, MD/JSON export, batch limits; R6: inline batch on Home, feature tags, Dashboard empty state; R7: batch_max_urls admin, Batch Pack payment, stable AI model | ✅ merged to main |
| `R0-polish-feature-ui-enhancement` | R6: batch inline on Home, feature card tags fixed, Dashboard no-demo; **R12**: plan card hover/selection states, TopupBundleModal qty selector, payment-gated activation | ✅ merged to main |
| `claude/r0-polish-feature-ui-fgj5yo` | R8: grouped Export dropdown (Dashboard), floating AI selection bar (bottom), auto-save on extraction, Preview → View Dashboard + Delete, Generate content in Preview QA card, Home removes Batch toggle + Try examples, Batch result View button, emailService webhook→mailto fallback; R9: Batch nav before Dashboard, batch auto-save fix (strip _status/_error), Netlify fn strips _status/_error, Dashboard localStorage-first loading + Refresh button + inline Generate/Email selection buttons + dropdown z-index fix, Preview Download ▾ dropdown; R10: Explore menu Contact Us + Submit Bug, Contact page bug type + query-param pre-fill | ✅ merged to main |
| `claude/razorpay-payment-integration-76uecb` | R11: complete Razorpay end-to-end integration — `PAYMENT_STAGE` state machine, `PaymentProcessingModal` step-by-step UX, `onStageChange` threading, billingPeriod wiring, INR annual fix, `retryPayment` callback with `lastPaymentArgs` ref, `create-checkout.js` rewrite (agency $299, bundles), `verify-payment.js` timing-safe HMAC, `payment-webhook.js` Supabase sync, audit fixes (account-stats CSS, unused providerMeta) | ✅ merged to main |
| `claude/pricing-batch-help-polish-dwwlj7` | R13: GST breakdown `PaymentConfirmModal`, bundle base prices (pre-GST display), TopupBundleModal INR upsell prices, Enterprise plan card restored, Apify+PhantomBuster comparison pages, compare.html multi-page links, batch table full-width, usage banner container-constrained, Account batch/content generation stats, `batchRuns`+`contentGenerations` in usageService, TopBar Explore restructure (remove Browse.ai/Clay from Compare, remove Submit Bug, About DatIQ last), help/index.html External/Internal labels removed, 09-exports-and-sharing.html full rewrite (all 5 formats) | ✅ merged to main |
| `claude/firecrawl-fallback-analysis-qyksr4` | R14a: Firecrawl → Spider.cloud → Jina AI → Direct fetch fallback chain; `scrapeProviders.js` provider registry + chain runners; `extract.js` rewritten to use chain; `config.js` `hasFirecrawl` covers all providers + `VITE_ENABLE_EXTRACT` flag | ✅ merged to main |
| `home-screen-enhancement` | R14b: Home intent chips (5: summary/contacts/pricing/map/custom) replace 4 toggles; OG preview card (800ms debounce); clickable feature cards map to intent chips; FAB (layers-2) beside Extract navigates to /batch; `BulkUploadModal` component created but now only reachable from /batch; Batch page unified intent chips + run history via `batchRunsService.js`; Dashboard `BatchRunsDropdown` filter + `batch-item-tag` chips | ✅ merged to main |
| `claude/enrich-batch-mall-3tkc1s` | **R16**: Batch mode parity — Map site intent chip (5th), per-URL content generation toggle (SEO/competitor/social), enrichMeta tab persistence for contacts/pricing/custom; Guest trial gate — `GuestTrialProvider`, `GuestTrialBanner`, `GuestTrialModal`, `guestTrialService`; soft gate (TRIAL_LIMIT=3, re-prompts every 2); sign-in/out bypass prevention (count never cleared on login) | ✅ merged to main |
| `claude/enrich-batch-mall-3tkc1s` (R17) | **R17**: Logout clears sensitive data (7 localStorage keys + navigate to /); guest hard limits (10 single-URL / 5 batch runs, configurable); non-dismissible hard block modal; pre-flight checks in ExtractionProvider + Batch; Admin General Settings page (`/admin/general`) + Netlify fn `admin-general-config.js` + `globalSettingsService.js` | ✅ merged to main |
| `main` (R18 — direct commits) | **R18**: Admin dashboard upgrades — AdminPricing INR inputs + GST preview (`indian-rupee` icon); AdminUsers real Supabase data (plan period, coupon column, assign coupon action); AdminRevenue live data from Supabase (`admin-revenue.js` Netlify fn); coupon assign modal redesigned (picker from manual-only coupons, discount % override, persistence via `coupon_redemptions`); `planId='manual'` coupon type (admin-assign only, blocked in `validateCoupon`) | ✅ merged to main |
| `claude/quality-gate` | **SDLC M0+M1+M2**: Vitest + Playwright + jsdom harness, NotFound page, cross-browser projects, 278 unit tests (src/lib), 251 contract tests (netlify/functions — C-01..36 + C-37 publicUrl), 2 integration, 1 system, 21 Playwright smoke, security stub. Two production bug fixes gated by M2: `extract.js` SSRF guard via `isPublicHttpUrl` (rejects private IPs / file:// before any provider HTTP call); `extractions.js` preserves `id` on POST (was destructured to `_clientId` and dropped, breaking client-generated id roundtrip). | 🚧 in progress — M2 ready to push |

---

## Tech stack (locked — do NOT change these choices)

- **Vite 5 + React 18 + React Router 6** (v7 future flags set in `main.jsx`)
- **Tailwind CSS** for utilities only — design system tokens live in CSS custom properties
- **Design system** — `src/styles/design-system.css` + `src/styles/screens.css`. **NEVER convert to Tailwind classes.**
- **lucide-react** icons via `src/components/Icon.jsx`. Add new icons there only.
- **Supabase** (`@supabase/supabase-js`) — auth + DB. localStorage fallback when not configured.
- **jsPDF 4.2.1** — lazy-loaded only on PDF export click via `await import()`
- **stripe ^17.7.0** and **razorpay ^2.9.4** — in root `package.json` for Netlify Functions ONLY (never imported in Vite frontend)
- No test framework, no ESLint config (scripts: `dev`, `build`, `preview` only)

---

## Complete route map

| Route | Description | Access |
|---|---|---|
| `/` | Home / Extract | Public (no forced onboarding) |
| `/preview` | Review & Save extraction | Public |
| `/dashboard` | Saved extractions | Public |
| `/batch` | Batch multi-URL extraction (10–500 URLs); CSV-import; progress; combined export | Public (plan-gated) |
| `/pricing` | Pricing plans, annual/monthly toggle, USD+INR, top-up bundles | Public |
| `/account` | Billing & usage, metering alerts, coupon input, payment history | Public |
| `/payment/success` | Post-payment confirmation (Stripe redirect / Razorpay success) | Public |
| `/payment/cancel` | Checkout cancelled screen | Public |
| `/onboarding` | 2-step persona selection | Public (in Shell with TopBar+Footer; opt-in) |
| `/contact` | Support contact form (5 enquiry types + sidebar info) | Public |
| `/privacy` | Privacy Policy (includes DPDP Act 2023 section) | Public |
| `/terms` | Terms of Service (Indian arbitration governing law) | Public |
| `/about` | About DatIQ — mission, values, how-it-works, founder block, personas | Public |
| `/blog` | Blog listing — featured + grid + email capture; click card → in-page modal | Public |
| `/integrations` | Integration catalog — 4 live, 6 coming-soon, 1 agency, 1 roadmap | Public |
| `/use-cases` | Use-cases hub — 4 cards linking to detail pages | Public |
| `/use-cases/lead-generation` | Lead gen use-case landing page | Public |
| `/use-cases/competitor-research` | Competitor research landing page | Public |
| `/use-cases/seo-audit` | SEO audit use-case landing page | Public |
| `/use-cases/market-research` | Market research use-case landing page | Public |
| `/vs/browse-ai` | DatIQ vs Browse.ai comparison page | Public |
| `/vs/clay` | DatIQ vs Clay comparison page | Public |
| `/docs` | Redirect → `/help/index.html` (window.location.href, not SPA nav) | Public |
| `/compare` | Redirect → `/vs/browse-ai` (React Router Navigate) | Public |
| `/compare/*` | Redirect → `/vs/browse-ai` | Public |
| `/admin` | Admin shell (PIN gated, demo PIN: `ADMIN123`) | Standalone |
| `/admin/revenue` | Revenue dashboard | Admin |
| `/admin/pricing` | Configurable plan pricing & limits | Admin |
| `/admin/coupons` | Coupon CRUD | Admin |
| `/admin/users` | User management | Admin |
| `/admin/ai` | AI provider chain editor (model, order, enable toggles, max tokens) | Admin |
| `/admin/general` | Global application settings (guest limits, reprompt interval) | Admin |
| `/help/index.html` | Static help site (R20: overview + 15 user-guide sections + `developers.html` API ref; generated, plain `<a>` — bypasses SPA router) | Public |

---

## Complete file map (current main state)

```
src/
├── App.jsx                           Provider tree + routes + Shell guard
│                                     ★ R4: added /contact, /use-cases, /docs redirect, /compare redirect
│                                     UsageUpsellBanner placed between TopBar and <main>
├── main.jsx
├── index.css
├── styles/
│   ├── design-system.css             CSS tokens + @keyframes spin + .btn-full + brand tagline
│   └── screens.css                   All screen/component CSS (~4300+ lines)
│                                     Includes: .uc-*, .vs-*, .int-*, .skip-link, .nav-dropdown*,
│                                     .home-social-proof, .blog-*, .about-*, .contact-*, .billing-toggle-*,
│                                     .enterprise-card, .plan-coming-soon, .referral-teaser, .usage-upsell-banner
├── data/
│   └── mockData.js
├── lib/
│   ├── batchService.js               ★ R5: runBatch() — parallel multi-URL extraction (CONCURRENCY=3); parseUrlsFromCsv()
│   ├── config.js                     VITE_* env + runtime override; feature flags
│   │                                 ★ R4: removed AI_API_KEY export; hasAI = true (key server-side only)
│   ├── utils.js                      hostOf, pathOf, uid, flattenJson, extractionsToCsv, etc.
│   ├── supabaseClient.js             createClient when configured; null otherwise
│   ├── apiClient.js                  ★ V2: /api/* proxy — extract, ai, listExtractions, CRUD, setAuthToken
│   ├── authService.js                ★ V3: signUpWithEmail, signInWithEmail, signInWithOAuth, signOut
│   ├── firecrawlService.js           extractStructure, mapDomain — mock OR real via apiClient
│   ├── aiService.js                  summarize, categorizeLinks, generateContent, CONTENT_FORMATS
│   ├── linkCategorizer.js            categoryOf heuristic, CATEGORY_META, categoryCounts
│   ├── extractionPresets.js          CONTACTS_PROMPT, QUICK_ACTIONS (5), resolveCustomPrompt
│   ├── enrichmentStore.js            localStorage: readEnrichments, saveEnrichment, saveCurrent, readCurrent
│   ├── extractionsRepo.js            listExtractions, saveExtraction, updateEnrichments, deleteExtraction
│   │                                 Uses apiClient → localStorage fallback; LS_KEY = "datiq.saved"
│   ├── personaConfig.js              PERSONAS (7), PERSONA_BY_ID
│   ├── pricingConfig.js              ★ R4: 7 plan tiers + ENTERPRISE_PLAN export + TOPUP_BUNDLES
│   │                                 Plans: Free/Select/Pro/Business/Agency/Developer(comingSoon)/Enterprise
│   │                                 Fields: price_usd, price_usd_annual, price_inr_annual, trialCredit
│   │                                 CURRENCIES = ["USD", "INR"] (EUR/GBP/SGD/AED removed)
│   ├── pricingOverrides.js           ★ V5: getEffectivePlans(), getEffectivePlanById(), getGlobalDiscount()
│   ├── currencyService.js            ★ R4: USD+INR only; DEFAULT_RATES = { USD:1, INR:83.5 }
│   │                                 detectCurrency() returns "USD" or "INR" only
│   ├── migrationService.js           ★ R1: runMigrations() — copies scrapelite.* → datiq.* keys on first load
│   ├── usageService.js               ★ V5: canExtract/canEnrich/canExport — uses effective plan map
│   ├── usageRepo.js                  ★ V5: Supabase sync for usage_records + usage_alerts
│   ├── alertService.js               ★ V5: getAlertConfig, saveAlertConfig, checkAndFireAlerts
│   ├── adminService.js               ★ V5: coupon CRUD, user management, revenue metrics
│   │                                 ★ R18: validateCoupon blocks planId='manual' coupons (admin-assign only)
│   │                                 planId='manual' coupons shown ONLY in admin user coupon picker
│   ├── paymentConfig.js              ★ V5c: getPaymentProvider(currency), hasPayment, PROVIDER_META
│   │                                 INR → Razorpay; USD → Stripe
│   ├── paymentService.js             ★ V5c: initiateCheckout (Stripe/Razorpay/demo), pending payment
│   ├── paymentRepo.js                ★ V5c: Supabase subscriptions + payment_events sync
│   ├── pdfExport.js                  Lazy-loaded jsPDF report (never static-imported)
│   │                                 ★ R5: utils.js also exports extractionsToMarkdown/markdownDownload/extractionsToJson/jsonDownload
│   ├── webhook.js                    notifyWebhook (fire-and-forget)
│   ├── emailService.js               sendExtractionsEmail; webhook → email API → mailto fallback
│   ├── errorMessages.js              classifyError; 10 categories
│   ├── statsService.js               ★ R0: getStats() → /api/stats (Supabase aggregate), fmtStat()
│   │                                 Caches in datiq.stats localStorage (5-min TTL)
│   ├── emailCaptureService.js        ★ R0: captureEmail(email, source) → datiq.subscribers LS + n8n webhook
│   ├── batchRunsService.js           ★ R14b: saveBatchRun/listBatchRuns/deleteBatchRun + recordBatchItems/readBatchMap
│   │                                 localStorage keys: datiq.batchRuns (run summaries) + datiq.batchMap (id→runId map)
│   ├── guestTrialService.js          ★ R16: guest trial counters (count + batchCount) in datiq.guestTrial
│   │                                 getGuestCount/incrementGuestCount, getGuestBatchCount/incrementGuestBatchCount
│   │                                 shouldShowTrialPrompt, isTrialLimitReached, isSingleHardLimitReached, isBatchHardLimitReached
│   │                                 TRIAL_LIMIT=3, SINGLE_HARD_LIMIT=10, BATCH_HARD_LIMIT=5 (overridden by globalSettings)
│   └── globalSettingsService.js      ★ R17: fetches /api/admin-general-config with 5-min TTL cache (datiq.globalSettings)
│                                     getSettings() synchronous (immediate cache read + DEFAULTS fallback)
│                                     loadSettings() async (fetch → cache → return merged)
│                                     updateCachedSettings(settings) called by AdminGeneral after save
├── components/
│   ├── ThemeProvider.jsx             light/dark; persists to datiq.theme
│   ├── Toast.jsx                     ToastProvider + useToast(); 2.6s auto-dismiss
│   │                                 IMPORTANT: useToast() returns the fn directly, not {showToast}
│   ├── ErrorModal.jsx                ErrorModalProvider + useErrorModal()
│   ├── AuthProvider.jsx              ★ V3: Supabase auth state, openAuth/closeAuth, authError
│   ├── AuthModal.jsx                 ★ V3: sign-up/sign-in modal with authError display
│   ├── PersonaProvider.jsx           ★ V4: personaId, userName, onboarded, resetOnboarding
│   ├── BillingProvider.jsx           ★ V5c: planId, usage, initiatePayment, confirmPayment, applyCoupon
│   ├── ExtractionProvider.jsx        current, loading, extract, enrich, save — checks billing limits
│   ├── UsageUpsellBanner.jsx         ★ R4: shows at ≥80% extraction usage; dismiss stores month in LS
│   │                                 Key: datiq.upsellDismissedMonth; re-shows next month
│   ├── TopBar.jsx                    Brand (DatIQ layers icon + tagline), main nav (Extract/Dashboard/Pricing),
│   │                                 ExploreDropdown (Use Cases/Compare/Resources sections with icons),
│   │                                 UserDropdown (persona dot+name, account/billing/role/sign-out),
│   │                                 MobileNav (hamburger panel <600px, Explore accordion, user actions)
│   ├── Footer.jsx                    Slim single-row: socials (LinkedIn/Twitter) | copyright | legal links
│   ├── Button.jsx                    variant: primary/secondary/ghost/danger; size sm; fullWidth
│   ├── Toggle.jsx                    Reusable toggle switch; accepts `tooltip` prop → hover popover
│   ├── Icon.jsx                      lucide-react name-map (77 icons registered)
│   │                                 ★ R18: added IndianRupee → "indian-rupee"
│   ├── StructuredData.jsx            Renders arbitrary JSON (enrichment data)
│   ├── ContentModal.jsx              Generate content modal; 3 formats; copy button; ★ R13: calls incrementContentGenerations()
│   ├── EmailModal.jsx                Send email modal; multi-recipient
│   ├── PaymentConfirmModal.jsx       ★ R13: pre-payment GST breakdown modal (base + 18% GST + total)
│   ├── BrandLoader.jsx               Animated loader
│   ├── FaviconDot.jsx                Deterministic hue monogram per domain
│   ├── LoadingScreen.jsx             Full-screen 4-step animated progress
│   ├── BulkUploadModal.jsx           ★ R14b: paste URLs + CSV upload modal; currently NOT used by Home (FAB → /batch)
│   │                                 Still exists for potential future use on /batch or other pages
│   ├── GuestTrialProvider.jsx        ★ R16: Context provider for guest trial tracking
│   │                                 SENSITIVE_KEYS cleared on logout (never includes datiq.guestTrial)
│   │                                 checkCanExtractSingle/checkCanExtractBatch pre-flight checks
│   │                                 trackGuestExtraction/trackGuestBatchRun post-completion tracking
│   │                                 Mount useEffect restores hard-block state on page reload
│   │                                 Auth-transition useEffect: login→clear prompts; logout→clear sensitive keys + navigate("/")
│   │                                 Settings loaded via useState(getSettings) + async loadSettings() on mount
│   ├── GuestTrialBanner.jsx          ★ R16: Top banner showing remaining trial credits (single + batch)
│   └── GuestTrialModal.jsx           ★ R16: Soft prompt (dismissible) + Hard block (non-dismissible) modal
│                                     Hard block: no backdrop click, no Escape, no "Continue as guest" button
│                                     Hard block: overlay itself provides dark background (no backdrop div)
└── pages/
    ├── Home.jsx                      URL input + Extract button + FAB (Bulk import → /batch), 5 intent chips,
    │                                 OG preview card, 8 clickable capability cards, social proof
    │                                 ★ R14b: intent chips replace toggles; FAB navigates to /batch (no inline multi-URL)
    │                                 ★ R4: testimonials permanently hidden until real backend data
    ├── Preview.jsx                   Quick enrichment, enrichment tabs, save/discard
    ├── Dashboard.jsx                 Table/cards, search, pagination, CSV/PDF/MD/JSON/Generate/Email
    │                                 ★ R6: no demo data — shows real extractions; proper empty state when none
    ├── Onboarding.jsx                2-step persona selection (in Shell with TopBar+Footer; opt-in)
    ├── Pricing.jsx                   ★ R4: annual/monthly toggle (default: annual), USD+INR only,
    │                                 BillingToggle component, EnterpriseCard, Developer comingSoon card
    │                                 resolvePrice() uses plan.price_inr_annual / price_usd_annual
    ├── Account.jsx                   ★ V5c: billing, usage, alerts, coupon, payment history
    ├── PaymentSuccess.jsx            ★ V5c: Stripe verify + Razorpay activate; 3 states
    ├── PaymentCancel.jsx             ★ V5c: clears pending payment, "No charge made"
    ├── Contact.jsx                   ★ R4: /contact — support form (5 types) + sidebar info cards
    ├── Privacy.jsx                   ★ R4: full DPDP Act 2023 section added; URL → datiq.app
    ├── Terms.jsx                     ★ R4: governing law → Indian arbitration (A&C Act 1996, Bengaluru)
    ├── About.jsx                     ★ R4: founder block (Vikash Karuna, LinkedIn); fixed copy bug
    ├── Blog.jsx                      ★ R4: all 7 posts have fullContent; PostModal overlay on card click
    ├── Integrations.jsx              ★ R0: 12-card catalog; "Notify me" shows toast
    ├── UseCases.jsx                  ★ R4: /use-cases hub — 4 cards linking to detail pages
    ├── UseCaseLead.jsx               ★ R0: /use-cases/lead-generation
    ├── UseCaseCompetitor.jsx         ★ R0: /use-cases/competitor-research
    ├── UseCaseSEO.jsx                ★ R0: /use-cases/seo-audit
    ├── UseCaseResearch.jsx           ★ R0: /use-cases/market-research
    ├── VsBrowseAI.jsx                ★ R4: pricing updated to $0–$299/mo; API access → Business plan
    ├── VsClay.jsx                    ★ R4: pricing updated; CTA → "from $19/month"
    ├── Batch.jsx                     ★ R5: /batch — paste URLs / import CSV → progress → results → export
    │                                 ★ R14b: intent chips; batch run history (batchRunsService.js)
    │                                 ★ R15: textarea draft persisted to datiq.batchDraft in localStorage; unified Export ▾ dropdown
    │                                 ★ R16: pre-flight batch hard limit check (checkCanExtractBatch) before run
    │                                 ★ R16: trackGuestBatchRun() called after batch completes (not trackGuestExtraction)
    └── admin/
        ├── AdminLayout.jsx           PIN gate (server-verified via admin-auth fn; async login,
        │                             token session, 5→60s lockout), collapsible sidebar (chevron + pin)
        │                             ★ R17: NAV includes General Settings (/admin/general)
        ├── AdminRevenue.jsx          ★ R18: Live KPIs + revenue trend from Supabase (admin-revenue.js)
        │                             Parallel fetch: auth users, subscriptions, payment_events, coupon_redemptions
        │                             MRR from active subs × plan prices; trend from captured payment_events
        │                             Loading/error/warning states; Refresh button; zero state when Supabase unconfigured
        ├── AdminPricing.jsx          ★ R18: Editable plan prices + limits + global discount + bundles
        │                             USD Pricing section ($-prefix inputs) + INR Pricing section (₹-prefix, GST hints)
        │                             Collapsed header shows ₹X/mo alongside $X/mo when INR set
        │                             BundleEditor also has ₹-prefix + GST hint
        ├── AdminCoupons.jsx          ★ R18: Coupon CRUD (% or bonus extractions)
        │                             Added planId='manual' option "Manually Assigned To User(s)"
        │                             Manual coupons show purple "Manual assign" pill in Plan column
        │                             Hint note when manual selected: "users cannot self-apply it"
        ├── AdminUsers.jsx            ★ R18: Real Supabase data — plan period, coupon, extractions columns
        │                             New columns: Coupon (with discount % pill), Plan period (start→end)
        │                             Extractions/mo shows 0 explicitly; both Extend and Assign Coupon action icons
        │                             CouponModal: picker of planId='manual' active coupons only; discount % override;
        │                             preview row; persistence via coupon_redemptions upsert on backend
        ├── AdminAI.jsx               ★ AI provider chain editor — reorder providers, model per
        │                             provider, enable toggles, max tokens (via adminConfigService)
        └── AdminGeneral.jsx          ★ R17: Global application settings editor
                                      4 fields: soft_limit, reprompt_interval, single_hard_limit, batch_hard_limit
                                      Calls getGeneralConfig/saveGeneralConfig (adminConfigService.js)
                                      updateCachedSettings() after save so changes take effect immediately

netlify/
└── functions/
    ├── ai.js                         ★ POST /api/ai — MULTI-PROVIDER proxy w/ ordered fallback
    │                                 (Gemini→Claude→OpenAI default); normalizes to Anthropic shape
    ├── admin-ai-config.js            ★ GET=config+key presence; POST=upsert app_config 'ai' (token-gated)
    ├── admin-general-config.js       ★ R17: GET=merge app_config 'general' + DEFAULTS; POST=sanitize+upsert (token-gated)
    │                                 Sanitizes 4 integer fields with min/max bounds; localStorage fallback when no Supabase
    ├── admin-revenue.js              ★ R18: GET /api/admin-revenue — live revenue KPIs + 6-month trend (token-gated)
    │                                 Parallel fetch: auth users (total/new), subscriptions (active plan dist, MRR),
    │                                 payment_events (captured→monthly USD revenue), coupon_redemptions (count)
    │                                 INR paise→USD at 83.5; zero-state + warning when Supabase unconfigured
    ├── admin-users.js                ★ R18: GET fetches subscriptions.current_period_start/end + coupon_redemptions
    │                                 Returns planStart, planEnd, couponAvailed, couponDiscount per user
    │                                 PATCH action='assign_coupon': writes coupon_availed+coupon_discount to auth
    │                                 metadata AND upserts to coupon_redemptions (session_id=userId) for persistence
    ├── lib/aiProviders.js            ★ provider adapters + loadAiConfig() + runChain() fallback
    ├── lib/adminToken.js             ★ verifyAdminToken() — HMAC check of admin-auth session token
    ├── extract.js                    POST /api/extract — multi-provider scraping proxy (Firecrawl→Spider→Jina→Direct)
    ├── extractions.js                GET/POST/PATCH/DELETE /api/extractions — Supabase proxy
    ├── create-checkout.js            ★ V5c: POST — Stripe Checkout session or Razorpay order
    │                                 ★ now sources prices/coupons/global via lib/pricingSource.js
    ├── verify-payment.js             ★ V5c: GET=Stripe verify, POST=Razorpay HMAC verify
    ├── payment-webhook.js            ★ V5c: Stripe + Razorpay webhook handler
    ├── admin-auth.js                 ★ POST — server-side admin PIN verify (ADMIN_PIN_HASH);
    │                                 returns HMAC-signed session token; demo mode = ADMIN123
    ├── lib/pricingSource.js          ★ shared server source of truth — loadPricing() merges
    │                                 Supabase pricing_config over static tables; resolveDiscountFraction()
    ├── stats.js                      ★ R0: GET /api/stats — aggregate teams/extractions from Supabase
    │                                 Direct REST (no SDK); 5-min CDN cache header
    ├── og-preview.js                 ★ R14b: GET /api/og-preview?url= — server-side OG metadata fetch
    │                                 Reads first 15KB, parses og:title/description/<title>/meta; 5-min CDN cache
    └── lib/scrapeProviders.js        ★ R14a: 4-provider scraping chain — Firecrawl/Spider/Jina/Direct
                                      SCRAPE_PROVIDERS registry; runScrapeChain(); runMapChain(); scrapeProviderStatus()

### Invoicing & lifecycle files (branch `claude/datiq-invoicing-model-e16ea3`)

```
src/lib/
├── entitlementModel.js       PURE. can() + computeLifecycle(). Imported by React AND netlify/.
│                             The single authorization contract — read this first.
├── entitlementClient.js      60s cache of the entitlement row. UX ONLY, never authorization.
├── billingRepo.js            claimBillingSession(), fetchEntitlement/Invoices/InvoiceLines
├── chargeMath.js             PURE. computeChargeMinor() — the money contract. Read this second.
├── prorationMath.js          PURE. prorate() + describePlanChange() (loss list from plan limits)
├── billingNotices.js         PURE. pickDueNotice() + noticeCopy() — the dunning schedule
├── invoiceModel.js           PURE. buildInvoiceDoc() — drives PDF, email AND on-screen view
├── invoicePdf.js             renderInvoicePdf(); toPdfSafe(); runs in browser AND Node
└── pricingMath.js            now a thin ADAPTER over chargeMath (displayed == charged)

src/components/
├── SuspendedBanner.jsx       non-dismissible lapsed-subscription notice (mounted in Shell)
├── InvoiceModal.jsx          view one invoice -> download / email
└── PlanChangeWarning.jsx     downgrade loss list; warns, NEVER blocks (NOT YET MOUNTED)

netlify/functions/
├── invoice-pdf.js            GET /api/invoice-pdf?id= — auth.uid() only; 404 not 403
├── invoice-email.js          POST /api/invoice-email — id only; recipient from the session
├── billing-lifecycle.js      @daily — transitions, dunning, pause/resume. Deletes NOTHING.
├── billing-purge.js          @daily — THE ONLY DESTRUCTIVE JOB. 5 interlocks; ships disarmed.
├── admin-billing.js          suspend/reactivate/comp/offline_payment/resend/refund (NO UI YET)
└── lib/
    ├── requireEntitlement.js server guard; fails OPEN on infra, CLOSED on status
    ├── invoiceConfig.js      SUPPLIER_GSTIN switch -> Tax Invoice vs Payment Receipt
    ├── invoiceDraft.js       the price snapshot written at order creation
    ├── invoiceService.js     finalizeInvoice() — idempotent across verify + webhook
    └── invoiceEmail.js       Resend WITH attachment (first use in this codebase)

supabase/migrations/          0012 identity · 0013 backfill · 0014 RLS · 0015 scheduler
                              0016 invoices+numbering · 0017 lifecycle. ORDER MATTERS.
scripts/build-run-all.mjs     regenerates run-all.sql (npm run build:sql)
```

public/
├── favicon.svg
├── runtime-config.js                 window.__DATIQ_RUNTIME__ override (no rebuild needed)
├── llms.txt                          ★ R4: updated all URLs → datiq.app; new pricing tiers; /contact added
├── robots.txt                        ★ R4: Sitemap URL → https://datiq.app/sitemap.xml
├── sitemap.xml                       ★ R4: all URLs → datiq.app; added /contact, /use-cases
├── vs/
│   ├── compare.html                  ★ R13: hero quick-links + all 4 comparison pages listed
│   ├── apify.html                    ★ R13: DatIQ vs Apify comparison page (new)
│   └── phantombuster.html            ★ R13: DatIQ vs PhantomBuster comparison page (new)
└── help/                            ★ R20: GENERATED — do NOT hand-edit. Run `node docs/build-help.mjs`.
    ├── index.html                    Overview + section cards + "For developers" card
    ├── 01..15-*.html                 15 EXTERNAL user-guide sections (sanitized: no code/DB/internals)
    ├── developers.html               Public Developer API reference (forward-looking spec)
    ├── help.css
    └── assets/screenshots/*.png      9 fresh R19 screenshots (home/dark/preview/batch/schedules/dashboard×2/pricing/map)
```

### Documentation & help sources (R20 — split into external vs internal)

> Help/docs are **generated from markdown**. Edit the markdown, then regenerate. Never hand-edit `public/help/*.html`.

```
docs/
├── DatIQ-User-Guide.md              EXTERNAL, public. Source → public/help/01..15 + index. Sanitized: NO code, DB, env, internals.
├── DatIQ-Developer-API.md           EXTERNAL, public. Source → public/help/developers.html. Public HTTP API spec only (no internals).
├── build-help.mjs                   Generator: reads the two .md above → public/help/. Rebranded DatIQ; copies screenshots.
├── build-docx.mjs                   Generator: internal .md → internal .docx (needs docx@7 at DOCX_LIB=/tmp/docxlib).
├── capture-screenshots.mjs          Playwright (system Chrome) → docs/assets/screenshots/*.png. Run with dev server up.
├── assets/screenshots/*.png         Canonical screenshots (copied into public/help by build-help).
└── internal/                        NOT published. Full technical record (stack, data model, env, persistence).
    ├── DatIQ-Product-Documentation-Internal.md   Internal master doc (R19-current).
    ├── DatIQ-Product-Documentation-Internal.docx Generated Word version.
    └── e2e-test-report-2026-06-16.md
```

**Rule:** anything code-, database-, infrastructure-, or env-specific goes ONLY in `docs/internal/` (and CLAUDE.md).
The two public `.md` sources and everything under `public/help/` must stay free of internals.

---

## Provider tree (App.jsx)

```
ThemeProvider
  ToastProvider
    ErrorModalProvider
      AuthProvider
        GuestTrialProvider
          PersonaProvider
            BillingProvider
              ExtractionProvider
                <Shell />   ← skip-link + TopBar + GuestTrialBanner + <main id="main-content"> + routes + GuestTrialModal + Footer + AuthModal
```

---

## Architecture rules (LOCKED)

| Rule | Detail |
|---|---|
| CSS | Keep `design-system.css` + `screens.css` tokens. Never convert to Tailwind. |
| Pricing | Always use `getEffectivePlans()` / `getEffectivePlanById()` — never import `PLAN_BY_ID` from `pricingConfig` directly in UI code |
| API calls | All Supabase/Firecrawl/AI calls go through `apiClient.js` → Netlify Functions, not direct from browser |
| Supabase fallback | localStorage fallback on 401/403/404/503 or no `err.status`. Never hard-fail a save. |
| Dashboard seed | NONE — starts empty. Do not re-add mock data. |
| Table layout | `table-layout:fixed`, fixed px widths on narrow cols |
| TopBar "+ New" | Only shown on `/preview` |
| TopBar brand icon | Uses `layers` icon — do NOT change |
| TopBar tagline | `.brand-tagline` "Intelligence from every URL" — hidden on mobile (≤640px) |
| TopBar nav | Main links: Extract / Batch / Dashboard + ExploreDropdown + UserDropdown (logged in) OR Sign in + Sign up (logged out) |
| TopBar alignment | `.topbar-inner` (max-width: 1080px, auto margins) wraps all content — aligns with `.container` |
| TopBar responsive | Desktop >820px: full text+icons; Tablet 600–820px: compressed; Mobile <600px: hamburger |
| TopBar MobileNav | Slide-down panel (position:fixed top:68px), Explore accordion, user persona + actions |
| Footer | Slim single-row: `.site-footer-slim` — socials left, copyright center, legal right |
| Page structure | All route pages return a plain `<div className="page">` — Shell provides `<main id="main-content">` |
| Page class padding | When a page class (`.uc-page`, `.vs-page`, etc.) is combined with `.container`, use `padding-top`/`padding-bottom` only — never `padding: Xpx 0 Ypx` shorthand (zeroes horizontal padding, overrides `.container`) |
| Onboarding | `/onboarding` inside Shell with TopBar+Footer — not standalone. No forced redirect. |
| Auth nav gating | UserDropdown only when `user` (logged in). Sign in + Sign up when `!user`. |
| PDF | Lazy-loaded via `await import()`. Never static-import jsPDF. |
| Exports | CSV: `csvDownload()`; PDF: lazy `extractionsToPdf()`; Markdown: `markdownDownload()`; JSON: `jsonDownload()` — all in `utils.js` |
| Batch mode | `runBatch()` in `batchService.js` — CONCURRENCY=3; each URL increments extraction counter via `billing.trackExtraction(1)` |
| Batch gating | `checkCanBatch(urlCount)` and `checkCanExtractBatch(urlCount)` on BillingProvider; Business≤200, Agency≤500; Batch Pack top-up adds 50 slots |
| Background enrichment | `enrich()` must never show the full-screen loader. |
| Admin | `/admin` is standalone (no TopBar/Footer). **PIN verified server-side** via `netlify/functions/admin-auth.js` (env `ADMIN_PIN_HASH`); demo PIN `ADMIN123` only when no PIN env is set or the function is unreachable (`npm run dev`). `adminLogin()` is async → token in `scrapelite.adminAuth` (+ exp); 5-attempt → 60s lockout (`datiq.adminLock`). Sidebar is collapsible — toggle (chevron) + pin button. State in `datiq.adminSidebarCollapsed` / `datiq.adminSidebarPinned`. |
| Payment secrets | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env ONLY. Never VITE_ prefix. |
| Netlify Functions | ESM (`export const handler`), in `netlify/functions/`. `stripe`/`razorpay` dynamic-imported only. |
| Scheduled functions | **`netlify.toml` is the ONLY thing that registers a cron. It is authoritative.** `export const config = { schedule }` inside a function is **IGNORED** for our functions — it is a v2 (`export default`) feature, and every function here is v1 (`export const handler`) with `@netlify/functions` not installed, so the v1 `schedule()` wrapper is not in play either. All four crons (`scheduled-runner` `@hourly`, `reengagement` `@daily`, `billing-lifecycle` `@daily`, `billing-purge` `@daily`) are declared under `[functions."<name>"] schedule = …`. Deleting a block there silently un-schedules that function — **no build error, no runtime error, it just never fires again**, which is exactly how all four sat unscheduled from R19 until 2026-07-27. A declared schedule also makes Netlify BLOCK public HTTP access, which is the only thing keeping `billing-purge` off the open internet. Netlify runs scheduled functions for the **production deploy only**, so a branch deploy returning 200 on a cron endpoint proves nothing — verify on `main`. |
| localStorage keys | All use `datiq.*` prefix (except `scrapelite.*` internal keys — NOT rebranded to avoid breaking sessions) |
| Help site | `/help/index.html` linked from TopBar as plain `<a>` (not React Router) — bypasses SPA router |
| Contact emails | **Exactly two customer-facing inboxes.** `hello@datiq.app` — product support, bug reports, feature requests, billing, anything general. `admin@datiq.app` — enterprise/agency, legal & terms, privacy & DPDP (incl. the DPDP grievance officer). `support@` / `legal@` / `privacy@` are retired; the readiness audit fails the build if they reappear. Source of truth: `src/lib/contactRouting.js`. |
| Contact form delivery | `/contact` → `apiClient.sendContactEmail` → **POST `/api/contact-email`** ([netlify/functions/contact-email.js](netlify/functions/contact-email.js)) → **Resend**, the same provider used for welcome / re-engagement / schedule-alert mail. **Routing is server-authoritative**: the browser sends an enquiry *type*, never a recipient, and the function resolves the destination from `src/lib/contactRouting.js` — so the endpoint can't be used as an open relay and exactly ONE inbox receives each message (no duplicate delivery). `RESEND_API_KEY` stays server-side. Honeypot (`botcheck`) returns 200 and drops. On failure the UI shows a pre-filled `mailto:` fallback. The CRM webhook ([contactWebhook.js](src/lib/contactWebhook.js)) and subscriber capture fire in parallel and can never fail or delay a submission. Orchestrated in [contactService.js](src/lib/contactService.js). |
| Email sender rule | **One env var per sender — no fallback chains between them.** Three senders, split by who reads the mail: `CONTACT_EMAIL_FROM` → **`hello@datiq.app`** for outbound human mail (welcome, re-engagement); `ALERT_EMAIL_FROM` → **`alerts@datiq.app`** for machine-generated schedule alerts; `FORM_EMAIL_FROM` → **`noreply@datiq.app`** for the inbound /contact form. Each function reads exactly one and never falls back to another, so repointing one sender can't silently move the others — in particular, setting the outbound sender to `hello@` must never make the inbound form mail `hello@` from `hello@`. Regression tests in `netlify/__tests__/{contact-email,welcome-email}.test.js` assert the isolation in both directions. Every outbound address is one a human can reply to; only the inbound form uses `noreply@`, because the submitter's address is unverified and `reply_to` carries them instead. |
| Entitlements | **Server-authoritative.** One pure `can()` in `src/lib/entitlementModel.js`, imported by BOTH React and the Netlify functions so they can never disagree. `plan_id` (what they bought) and `status` (lifecycle) are SEPARATE axes — never model suspension as a pseudo-plan, because `getEffectivePlanById` falls back to Free for unknown ids and would GRANT access instead of denying. Use `getPlanByIdStrict` for anything that gates. |
| Entitlement failure mode | **Fail OPEN on infrastructure, CLOSED only on an explicitly-read non-active status.** A Supabase blip must never take extraction down. Same asymmetry as `reserveCoupon` in `pricingSource.js`. Do not "harden" it. |
| Money | `src/lib/chargeMath.js` is the single implementation; `pricingMath.computeCharge` is an adapter over it, so displayed == charged. `totalMinor` keeps the ORIGINAL one-step rounding; `tax = total − taxable` is DERIVED, never independently rounded. A legacy-parity table gates any change. |
| Invoice immutability | An issued invoice is immutable at the DB level (BEFORE UPDATE trigger). Only `status`, `refunded_minor`, `pdf_path`, `pdf_sha256`, and `user_id` NULL→set may change. Corrections are CREDIT NOTES (series `DTQC`), never edits. |
| Invoice numbering | A row-locked COUNTER TABLE, never a Postgres sequence — sequences are non-transactional and gap on rollback, and gaps in a GST series are what auditors ask about. FY boundary is **1 April IST**, not UTC. |
| Invoice idempotency | A partial unique index on `(provider, provider_payment_id)` + `issue_invoice` catching `unique_violation`. Do NOT copy the read-then-write dedup in `payment-webhook.js:49-59` — it races. Only `created:true` may render a PDF or send mail. |
| Invoice ownership | Downloads gate on `auth.uid()` ONLY, never `session_id` (client-writable localStorage). Return **404, not 403**, for another user's invoice so ids cannot be enumerated. |
| PDF text | jsPDF's helvetica is WinAnsi; a character outside it corrupts the whole text run's METRICS, not just the glyph. Every string routes through `toPdfSafe()`. Amounts are ASCII `INR 1,23,456.00`, never `₹`. |
| Scheduler pausing | `status` = the USER's intent (active/paused); `system_paused` = the PLATFORM's, protected by a column-level REVOKE the client cannot write. Resume is scoped by `system_pause_reason`, so a schedule the user paused stays paused. |
| Dunning idempotency | `billing_notice_log` keys on `user_id` (emails change) and `window_key` anchors on the CYCLE, never on today. `reengagement.js` anchors on today and would email an inactive user daily forever. Claim the log row BEFORE sending. |
| Purge | `billing-purge.js` is the ONLY destructive job. Five interlocks, any one of which stops it; ships disarmed. It can never delete anyone whose `last_notice_kind` is not `delete_d90`. Invoices/payment_events/account always survive. |
| Admin billing | Every mutation in `admin-billing.js` requires a `reason` and writes `billing_audit_log`. `reason` is NOT NULL in the schema and validated in the handler — a blank reason is a rejected request, not an empty log entry. |
| run-all.sql | **GENERATED.** `npm run build:sql` (`--check` in CI). Never hand-edit — it silently drifted from the numbered migrations before. |
| Naming | App brand is "DatIQ" everywhere in UI. Live site is `https://datiq.app` (Netlify project renamed to `datiqapp`; old `scrapelite.netlify.app` host now 404s). |
| Currencies | USD and INR only (EUR/GBP/SGD/AED removed in R4). INR → Razorpay; USD → Stripe. |
| Pricing billing | Default billing period on /pricing is `"annual"` (20% off). Toggle to monthly available. |
| AI key | `hasAI = true` always; `AI_API_KEY` (no VITE_ prefix) lives in Netlify env only. Never export from config.js. |
| Guest trial soft gate | `GuestTrialProvider` tracks `count` (single-URL extractions). Soft prompt after `guest_trial_soft_limit` (default 3), re-prompts every `guest_trial_reprompt_interval` (default 2). Soft prompt is dismissible. |
| Guest trial hard block | Hard block after `guest_single_hard_limit` (default 10) single-URL extractions OR `guest_batch_hard_limit` (default 5) batch runs. Hard block is **non-dismissible** — no Escape, no backdrop click, no "Continue as guest". Modal overlay provides its own dark background. |
| Guest trial counter | `datiq.guestTrial` localStorage key is **NEVER cleared** (not in SENSITIVE_KEYS). Prevents bypass via sign-in/out cycling. Count persists even after logout and login. |
| Guest logout cleanup | On logout: 7 SENSITIVE_KEYS cleared from localStorage + `navigate("/")` called to flush in-memory React state (Dashboard items, etc.). Guest trial key preserved. |
| Global settings service | `globalSettingsService.js` caches `guest_*` limits from `/api/admin-general-config` in `datiq.globalSettings` (5-min TTL). Synchronous `getSettings()` for immediate use. `GuestTrialProvider` uses both `useState(getSettings)` on mount and async `loadSettings()` refresh. |
| Admin general config | `admin-general-config.js` Netlify fn: GET merges `app_config key='general'` + DEFAULTS; POST is token-gated, sanitizes integer ranges, upserts to Supabase. `AdminGeneral.jsx` page calls `updateCachedSettings()` after save so changes propagate immediately in same tab. |
| ExtractionProvider pre-flight | `extract()` checks `checkCanExtractSingle()` before starting. If blocked → sets `showHardBlock(true)` and returns early without extraction. |
| Batch pre-flight | `handleRun()` in `Batch.jsx` checks `checkCanExtractBatch()` before starting. If blocked → sets `showHardBlock(true)` and returns early. |

---

## Key localStorage keys

| Key | Used by |
|---|---|
| `datiq.saved` | extractionsRepo.js — saved extractions cache |
| `datiq.current` | enrichmentStore.js — current extraction |
| `datiq.enrichments` | enrichmentStore.js — enrichment data per URL |
| `datiq.theme` | ThemeProvider — light/dark preference |
| `datiq.dashLayout` | Dashboard.jsx — table/cards toggle |
| `datiq.tip.*` | Home.jsx — per-persona guide tip (shown once) |
| `datiq.stats` | statsService.js — cached aggregate stats (5-min TTL) |
| `datiq.subscribers` | emailCaptureService.js — newsletter email list |
| `scrapelite.adminAuth` | adminService.js — admin session **token** from `admin-auth` fn (NOT rebranded) |
| `scrapelite.adminAuthExp` | adminService.js — admin token expiry (ms epoch) |
| `datiq.adminLock` | adminService.js — failed-PIN-attempt lockout state (`{attempts, until}`) |
| `scrapelite.*` | Internal keys (persona, usage, currency, pricing overrides etc.) — NOT rebranded |
| `datiq.plan` | BillingProvider — active plan ID |
| `datiq.pendingPayment` | paymentService.js — pending Stripe redirect state |
| `datiq.migrated` | migrationService.js — flag: scrapelite.* → datiq.* migration done |
| `datiq.adminSidebarCollapsed` | AdminLayout.jsx — sidebar collapsed state ("1" = collapsed) |
| `datiq.adminSidebarPinned` | AdminLayout.jsx — sidebar pin state ("0" = unpinned) |
| `datiq.upsellDismissedMonth` | UsageUpsellBanner.jsx — month string (e.g. "2026-06") when banner was dismissed |
| `datiq.batchRuns` | batchRunsService.js — array of past batch run summaries (max 50) |
| `datiq.batchMap` | batchRunsService.js — map of `{ extractionId: batchRunId }` for Dashboard tagging |
| `datiq.batchDraft` | Batch.jsx — persisted textarea content; survives refresh + back-navigation; cleared on "New batch" |
| `datiq.guestTrial` | guestTrialService.js — guest trial counts `{ count, batchCount, sid }`. **NEVER cleared on login or logout** — intentional bypass-prevention. |
| `datiq.entitlement` | entitlementClient.js — cached server entitlement row (60s TTL). **UX ONLY, never authorization** — every mutating endpoint re-resolves server-side with the service key. Cleared on sign-in, sign-out and after payment. |
| `datiq.globalSettings` | globalSettingsService.js — cached guest limit settings from server (5-min TTL). Falls back to DEFAULTS when uncached or fetch fails. |

---

## V5 / R4 — Pricing & Billing

### Plans (R4 revised tiers)

| Plan | USD/mo | USD/yr | INR/yr | Notes |
|---|---|---|---|---|
| Free | $0 | — | — | 10 ext/mo + 25 trial credit |
| Select | $19 | $15/mo | ₹999/mo | |
| Pro | $29 | $23/mo | ₹1,499/mo | badge: Recommended |
| Business | $79 | $63/mo | ₹3,999/mo | API access |
| Agency | $299 | $239/mo | ₹14,999/mo | 5 workspaces |
| Developer | $49 | $39/mo | ₹2,499/mo | comingSoon — H2 2026 |
| Enterprise | Custom (≥$1,000/mo) | — | — | Contact sales |

- Defaults in `src/lib/pricingConfig.js` — also exports `ENTERPRISE_PLAN`
- Admin overrides via `src/lib/pricingOverrides.js` (localStorage-backed, no rebuild)
- **Always** call `getEffectivePlanById(id)` — never use raw `PLAN_BY_ID`
- Annual billing is default on `/pricing` (20% off monthly); toggle to monthly available
- INR annual prices are fixed promotional amounts — NOT converted from USD at runtime
- Free tier: 10 extractions/month + full-feature access (except API/white-label) + 1 workspace + once-only 25-extraction trial credit at signup (`trialCredit: 25` in config; UI shows it; actual grant wired in usageService/AuthProvider is a future task)

### Payment provider routing
| Currency | Provider (v1.0) | Provider (v2.0) |
|---|---|---|
| INR | Razorpay (one-time Orders) | Razorpay Subscriptions (recurring) |
| USD | **Razorpay (international card)** — see [STRIPE-DEFERRAL.md](docs/STRIPE-DEFERRAL.md) | Stripe Checkout (recurring) |
| Override | `VITE_PAYMENT_PROVIDER=stripe\|razorpay\|auto` |

**v1.0 ships all 4 paid tiers (Free / Select / Pro / Business / Agency) +
Batch Pack bundles** with one-time Order payments. Recurring subscription
billing (Razorpay Subscriptions, Stripe Subscriptions) is deferred to
v2.0 — see [`docs/RECURRING-BILLING-DEFERRAL.md`](docs/RECURRING-BILLING-DEFERRAL.md).

**Demo mode** (no keys): `initiateCheckout` → `{status:"demo_mode"}` → upgrades plan locally, no real charge.

**Stripe flow**: `create-checkout` → Stripe hosted URL → `/payment/success?session_id=&plan=&provider=stripe` → `verify-payment` GET

**Razorpay flow**: `create-checkout` → `{orderId,amount,currency}` → paymentService lazy-loads CDN SDK → modal → `verify-payment` POST HMAC

---

## R0 — SEO/GEO & Marketing (2026-06-09)

### GEO & Agentic SEO
- `index.html` — 3 JSON-LD schemas: Organization (sameAs LinkedIn/Twitter/GitHub), WebSite+SearchAction, SoftwareApplication
- `public/llms.txt` — AI agent discovery (like robots.txt for LLMs)
- `public/robots.txt` — allows GPTBot/ClaudeBot/PerplexityBot, blocks /api/ /admin
- `public/sitemap.xml` — all 20 public routes

### Live stats pipeline
- `netlify/functions/stats.js` → `/api/stats` queries Supabase `usage_records` (teams = distinct session_ids, extractions = SUM)
- `src/lib/statsService.js` → fetches + caches in `datiq.stats` (5-min TTL)
- Home.jsx social proof is **hidden** until `stats.teams >= 10 OR stats.extractions >= 100`
- Testimonials section is permanently hidden (`{false && …}`) until real backend data is wired; no placeholder names/photos shown
- When Supabase is not configured, `getStats()` returns null → social proof section is not rendered

### Email capture
- `src/lib/emailCaptureService.js` → `captureEmail(email, source)`:
  - Saves to `datiq.subscribers` in localStorage (deduped)
  - POSTs to `VITE_WEBHOOK_URL` (n8n) as fire-and-forget
- Blog.jsx newsletter has real form with idle/loading/success/already/error states
- Integrations.jsx "Notify me" buttons show a toast with Blog redirect suggestion

---

## Auth (Supabase + AuthProvider)

- `AuthProvider` manages Supabase session, exposes: `user`, `openAuth(mode)`, `closeAuth`, `showAuthModal`, `authMode`, `authError`
- `openAuth('signin')` opens modal on Sign in tab; `openAuth('signup')` opens on Create account tab
- On mount: detects `window.location.hash` with `error=` → sets `authError`, opens modal, cleans URL
- `signUpWithEmail` passes `emailRedirectTo: window.location.origin` (prevents localhost:3000 redirect)
- `apiClient.setAuthToken(token)` called on sign-in to include `Authorization` header on API requests

### OAuth — requires Supabase dashboard setup
1. Authentication → URL Configuration → Site URL + redirect URLs
2. Providers → Enable Google / Microsoft (Azure) / GitHub
3. Callback URL: `https://[project].supabase.co/auth/v1/callback`

---

## Supabase schema — run if not yet applied

```sql
-- V2 columns
ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS custom_extraction jsonb,
  ADD COLUMN IF NOT EXISTS domain_map        jsonb,
  ADD COLUMN IF NOT EXISTS enrichments       jsonb;

-- V5: Usage tracking
CREATE TABLE IF NOT EXISTS public.usage_records (
  id uuid primary key default gen_random_uuid(),
  session_id text not null, month text not null,
  extractions integer not null default 0, enrichments integer not null default 0,
  plan_id text not null default 'free', updated_at timestamptz not null default now(),
  unique(session_id, month)
);
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.usage_records;
CREATE POLICY "anon full access" ON public.usage_records FOR ALL USING (true) WITH CHECK (true);

-- V5: Alert preferences
CREATE TABLE IF NOT EXISTS public.usage_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique, email text not null,
  thresholds integer[] not null default '{80,95}', enabled boolean not null default true,
  last_notified_at timestamptz
);
ALTER TABLE public.usage_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.usage_alerts;
CREATE POLICY "anon full access" ON public.usage_alerts FOR ALL USING (true) WITH CHECK (true);

-- V5c: Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique, plan_id text, status text, provider text,
  provider_subscription_id text, provider_customer_id text,
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.subscriptions;
CREATE POLICY "anon full access" ON public.subscriptions FOR ALL USING (true) WITH CHECK (true);

-- V5c: Payment events
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid primary key default gen_random_uuid(),
  session_id text, event_type text, provider text, provider_event_id text,
  plan_id text, amount_cents integer, currency text, status text,
  created_at timestamptz default now()
);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.payment_events;
CREATE POLICY "anon full access" ON public.payment_events FOR ALL USING (true) WITH CHECK (true);

-- Server-authoritative pricing/coupon overrides (read by create-checkout.js via
-- pricingSource.loadPricing). Operator-managed: edited directly (SQL/dashboard) or
-- via the "Generate SQL" panel in /admin/pricing. RLS is enabled with NO anon policy
-- on purpose — only the service key (which bypasses RLS) may read/write, because
-- these values set real charge amounts. If the table is empty, the server uses its
-- static fallback tables. Keys: 'plans' | 'bundles' | 'coupons' | 'global'.
CREATE TABLE IF NOT EXISTS public.pricing_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
-- (Intentionally no anon policy. Service key bypasses RLS.)

-- Coupon redemption tracking — server-enforced maxUses + one-redemption-per-user.
-- Written by create-checkout.js via the redeem_coupon RPC (service key only).
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null,
  session_id  text not null,
  order_ref   text,
  created_at  timestamptz default now(),
  unique (coupon_code, session_id)   -- per-user one-time use
);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY; -- no anon policy

CREATE TABLE IF NOT EXISTS public.coupon_counters (
  coupon_code text primary key,
  uses integer not null default 0
);
ALTER TABLE public.coupon_counters ENABLE ROW LEVEL SECURITY;    -- no anon policy

-- Atomic redeem: (1) claim the per-user slot via the unique constraint, then
-- (2) conditionally increment the per-coupon counter ONLY while under the cap (the
-- UPDATE...WHERE uses < p_max is row-locked, so the cap can't be exceeded under
-- concurrency). Returns 'ok' | 'already_redeemed' | 'cap_reached'. p_max<=0 = no cap.
CREATE OR REPLACE FUNCTION public.redeem_coupon(
  p_code text, p_session text, p_max integer, p_order text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE new_uses integer;
BEGIN
  BEGIN
    INSERT INTO public.coupon_redemptions (coupon_code, session_id, order_ref)
    VALUES (p_code, p_session, p_order);
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_redeemed';
  END;
  IF p_max IS NULL OR p_max <= 0 THEN
    RETURN 'ok';
  END IF;
  INSERT INTO public.coupon_counters (coupon_code, uses) VALUES (p_code, 0)
    ON CONFLICT (coupon_code) DO NOTHING;
  UPDATE public.coupon_counters SET uses = uses + 1
   WHERE coupon_code = p_code AND uses < p_max
  RETURNING uses INTO new_uses;
  IF new_uses IS NULL THEN
    DELETE FROM public.coupon_redemptions WHERE coupon_code = p_code AND session_id = p_session;
    RETURN 'cap_reached';
  END IF;
  RETURN 'ok';
END; $$;
```

---

## Environment variables

File: `.env` — **has real values (do NOT overwrite)**

```
# Browser-safe (VITE_ prefix)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_FIRECRAWL_API_KEY=        # fc-...
VITE_AI_API_KEY=               # sk-ant-... (browser-side demo only)
VITE_AI_MODEL=claude-haiku-4-5-20251001
VITE_WEBHOOK_URL=              # n8n webhook (also used for email capture)
# ── Contact form (/contact) ──
# Delivery is server-side via Resend — there is deliberately NO browser-side mail
# key. See CONTACT_EMAIL_FROM in the server-only block below.
VITE_CONTACT_WEBHOOK_URL=        # optional CRM endpoint; falls back to VITE_WEBHOOK_URL
VITE_PAYMENT_PROVIDER=auto     # auto | stripe | razorpay
VITE_STRIPE_PUBLISHABLE_KEY=   # pk_live_...
VITE_RAZORPAY_KEY_ID=          # rzp_live_...
VITE_STRIPE_PRICE_SELECT=      # recurring Stripe price IDs
VITE_STRIPE_PRICE_PRO=
VITE_STRIPE_PRICE_BUSINESS=
VITE_STRIPE_PRICE_AGENCY=
VITE_RAZORPAY_PLAN_SELECT=     # Razorpay subscription plan IDs
VITE_RAZORPAY_PLAN_PRO=
VITE_RAZORPAY_PLAN_BUSINESS=
VITE_RAZORPAY_PLAN_AGENCY=
VITE_LINK_CHANGELOG=           # optional footer links
VITE_LINK_ABOUT=
VITE_LINK_BLOG=

# Server-only — Netlify env ONLY, never VITE_ prefix
# ── AI providers (multi-provider fallback chain; keys server-only) ──
AI_API_KEY=                    # Anthropic Claude (sk-ant-...)
GEMINI_API_KEY=                # Google Gemini (AIza...) — default PRIMARY provider
OPENAI_API_KEY=                # OpenAI (sk-...)
AI_PROVIDER_ORDER=gemini,anthropic,openai   # optional; overrides default chain order
GEMINI_MODEL=gemini-2.5-flash               # optional per-provider model overrides
AI_MODEL=claude-3-5-haiku-20241022          # (Anthropic) optional
OPENAI_MODEL=gpt-4o-mini                     # optional
AI_MAX_TOKENS=1024                           # optional default per-request budget
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
SUPABASE_URL=                  # used by stats.js + pricingSource.js (no VITE_ prefix)
SUPABASE_SERVICE_KEY=          # service key — stats.js aggregates + pricing_config reads
ADMIN_PIN_HASH=                # SHA-256 hex of a STRONG admin PIN (preferred). Generate:
                               #   printf '%s' 'your-strong-pin' | shasum -a 256
ADMIN_PIN=                     # plaintext admin PIN (fallback if you can't pre-hash)
ADMIN_TOKEN_SECRET=            # optional HMAC key for the admin session token
RESEND_API_KEY=                # Resend — sends contact-form mail AND welcome/re-engagement/alerts
# Three senders, one env var each — see the "Email sender rule" above. No function
# falls back from one to another. All defaults work unset; set them per Netlify
# context only when a context needs a different sender (e.g. staging).
CONTACT_EMAIL_FROM=            # OUTBOUND, human      → "DatIQ <hello@datiq.app>"
                               #   welcome-email.js, reengagement.js
ALERT_EMAIL_FROM=              # OUTBOUND, machine    → "DatIQ Alerts <alerts@datiq.app>"
                               #   scheduled-runner.js (change alerts)
FORM_EMAIL_FROM=               # INBOUND              → "DatIQ Contact <noreply@datiq.app>"
                               #   contact-email.js. Recipients are resolved server-side
                               #   from contactRouting.js, never from env.
BILLING_EMAIL_FROM=            # OUTBOUND, billing    → "DatIQ Billing <billing@datiq.app>"
                               #   invoiceEmail.js + billing-lifecycle.js. SEND-ONLY:
                               #   reply_to is hello@datiq.app, so this is NOT a third
                               #   customer inbox and the two-inbox policy still holds.

# ── Invoicing / lifecycle (branch claude/datiq-invoicing-model-e16ea3) ────────
# All optional; every one defaults safely. Unset means "Payment Receipts, no purge".
#
# SUPPLIER_GSTIN is THE switch: set → "Tax Invoice" (SAC 998314, place of supply,
# CGST/SGST vs IGST split). Unset → "Payment Receipt" that states it is NOT a tax
# invoice and emits no tax fields anywhere. Safe to ship before registration.
# ⚠️ Note before setting it: checkout ALREADY adds 18% labelled GST to every INR
# charge (create-checkout.js). If no registration sits behind that, review it.
SUPPLIER_GSTIN=                # e.g. 29ABCDE1234F1Z5 — leave unset until registered
SUPPLIER_LEGAL_NAME=           # snapshotted onto every document at issue time
SUPPLIER_TRADE_NAME=
SUPPLIER_ADDRESS=
SUPPLIER_STATE=                # decides intra- vs inter-state supply
SUPPLIER_COUNTRY=              # default "India"
SUPPLIER_EMAIL=                # default hello@datiq.app
SUPPLIER_PAN=

# ── Purge cron (THE ONLY DESTRUCTIVE JOB — ships disarmed) ──
PURGE_ENABLED=                 # must be exactly "1" to arm. Default OFF.
PURGE_DRY_RUN=                 # "1" → report what WOULD be deleted, delete nothing
PURGE_MAX_USERS_PER_RUN=       # default 50; caps the blast radius of any bug
```

> **Admin PIN is verified server-side** by `netlify/functions/admin-auth.js` — the secret
> never ships in the browser bundle. If neither `ADMIN_PIN_HASH` nor `ADMIN_PIN` is set,
> the function runs in DEMO mode (accepts `ADMIN123`, returns `demo:true`). Set
> `ADMIN_PIN_HASH` to a strong value to disable demo mode. `admin-auth.js` is plain Node
> `crypto` (no external deps), so it works in `npm run dev` only via the dev fallback
> (accepts `ADMIN123` when the function is unreachable); production must set the env var.

---

## Netlify deploy

- **Site ID**: `0ac65a7e-bd3f-4cde-a8d3-66c23899c473`
- **Build**: `npm run build` → publishes `dist/`
- **Functions**: `netlify/functions/` (esbuild bundler)
- **API redirect**: `/api/*` → `/.netlify/functions/:splat`
- **SPA fallback**: `/*` → `/index.html`
- Auto-deploys from `main` on push

To trigger manually: Netlify dashboard → Deploys → Trigger deploy

---

## Critical bugs fixed (do NOT regress)

1. **Coupon use count** — `incrementCouponUses()` in `applyCoupon()`
2. **Admin auth boolean** — `ls(ADMIN_AUTH_KEY) === true || v === "true"`
3. **Currency dropdown click-outside** — `useEffect` + `mousedown` on `document`
4. **AbortSignal.timeout** — replaced with `AbortController + setTimeout`
5. **Effective plan map** — `usageService.js` + `BillingProvider` use `getEffectivePlanMap()`
6. **Email confirmation redirect** — `signUpWithEmail` passes `emailRedirectTo: window.location.origin`
7. **Hash error on auth redirect** — `AuthProvider` detects `#error=`, sets `authError`, opens modal, cleans URL
8. **netlify.toml duplicate [functions]** — removed; was causing Netlify CLI parse error + broken Functions deploy
9. **V5c: `initiatePayment` returns result** — `return result` in try, `throw e` in catch
10. **V5c: loading spinner** — `loading={loadingPlan}` is plan ID string, not boolean
11. **V5c: Account paymentError banner** — close button calls `setPaymentError("")`
12. **V5c: Account `handleUpgrade` nav** — demo_mode/success → `/account` (not `/pricing`)
13. **R0: nested `<main>` in agent pages** — UseCaseLead/Competitor/SEO/Research, VsBrowseAI/Clay, Integrations all returned `<main id="main-content">` inside Shell's existing `<main>`. Fixed to return `<div className="page">` directly.
14. **R0: scrapelite.tip.* localStorage key** — Home.jsx guide tip key updated to `datiq.tip.*`
15. **R0: contact emails** — `hello@scrapelite.io` → `support@datiq.app`, `legal@scrapelite.io` → `legal@datiq.app`, `privacy@scrapelite.io` → `privacy@datiq.app`
16. **R0: TopBar unused `plan` var** — removed from `useBilling()` destructuring
17. **R1: paymentService Razorpay `name`** — `"ScrapeLite"` → `"DatIQ"` in Razorpay modal options
18. **R1: alertService email subject** — `"ScrapeLite — Usage Alert"` → `"DatIQ — Usage Alert"`
19. **R1: localStorage migration** — `migrationService.js` + `runMigrations()` in `main.jsx` copies all `scrapelite.*` keys → `datiq.*` on first load (preserves existing user sessions)
20. **R1: TopBar restructure** — merged Blog/Help/About/Use Cases into single ExploreDropdown (3 sections: Use Cases, Compare, Resources); UserDropdown replaces separate PersonaBadge + UserChip
21. **R1: Footer simplified** — replaced 4-col layout with slim single-row `.site-footer-slim` (socials + copyright + legal only)
22. **R1: Responsive nav text** — nav labels visible at all breakpoints down to 600px; below 600px hamburger `MobileNav` panel shown
23. **R1: Geo-currency detection** — `detectCurrency()` in `currencyService.js`; `BillingProvider` auto-applies on first visit (timezone-first, language fallback)
24. **R1: Toggle tooltip prop** — `tooltip` prop on Toggle renders `.opt-tooltip` hover popover; all Home.jsx toggles updated
25. **R1: Persona quick-chips** — `.persona-contexts` above URL input on Home; persona-specific context chips populate search box
26. **R1: Scrape opts 2-col** — `.scrape-opts-grid` (2-column) replaces single-column layout; collapses to 1 col on mobile
27. **R1: AuthModal persona step** — post-signup persona selection step with skip; `usePersona.completeOnboarding()` called before closing
28. **R1: favicon layered-diamond** — SVG updated to 3-layer diamond matching in-app brand mark (indigo #4f46e5 bg)
29. **R1: PlanBadge removed** — plan name badge (e.g. "Select") in TopBar was redundant with "Account & Usage" in UserDropdown; removed `PlanBadge` component and its render call
30. **R2: Onboarding in Shell** — Onboarding page now renders inside main Shell (with TopBar + Footer); removed standalone rendering block; deleted duplicate brand mark and footer links from page; `.ob-page` CSS class added
31. **R2: No forced onboarding redirect** — removed `if (!onboarded && !isPublic) return <Navigate to="/onboarding" replace />` from Shell; all routes accessible without onboarding; onboarding is opt-in
32. **R2: TopBar content alignment** — wrapped TopBar content in `.topbar-inner` (max-width: 1080px, margin: 0 auto) so brand/nav aligns with page `.container` content at all viewport widths
33. **R2: Auth-gated nav** — TopBar UserDropdown (Account & Usage, Switch Role, Sign out) only shown when user is logged in; not-logged-in state shows Sign in + Sign up buttons opening AuthModal on correct tab; `authMode` state added to AuthProvider; `openAuth(mode)` accepts 'signin'/'signup'
34. **R2: Page padding override fix** — `.about-page`, `.blog-page`, `.pricing-page`, `.account-page`, `.uc-page`, `.vs-page`, `.int-page` used `padding: Xpx 0 Ypx` shorthand which zeroed out `.container`'s horizontal padding (screens.css loads after design-system.css). Fixed to `padding-top`/`padding-bottom` only.
35. **R3: Admin sidebar collapsible** — `AdminLayout` converted from CSS Grid to Flexbox layout. Sidebar has collapse/expand toggle (chevron), pin button (locks state), and hover-expand when unpinned+collapsed. State persisted to `datiq.adminSidebarCollapsed` + `datiq.adminSidebarPinned`. Mobile (≤700px) stays horizontal bar with controls hidden.
36. **R4: AI_API_KEY moved server-side** — Removed `export const AI_API_KEY` from `config.js`; `hasAI` is now always `true` (key lives in Netlify Function env as `AI_API_KEY`, no VITE_ prefix). Browser never sees the key.
37. **R4: "DatIQ (powered by DatIQ)" copy bug** — About.jsx hero paragraph fixed to "DatIQ is a zero-code…"
38. **R4: Social proof threshold gate** — Home.jsx stats section only renders when `stats && (stats.teams >= 10 || stats.extractions >= 100)`; testimonials permanently hidden with `{false && …}` until real backend data is wired.
39. **R4: scrapelite.netlify.app → datiq.app** — Fixed in Privacy.jsx intro, help/index.html metadata table, public/robots.txt Sitemap header, public/llms.txt, public/sitemap.xml.
40. **R4: /vs/clay CTA** — "from $9/month" → "from $19/month"; pricing row "$0–$199/mo" → "$0–$299/mo"; API access row updated to "Business plan ($79/mo)".
41. **R4: Blog post expansion** — Clicking any blog card opens an in-page `PostModal` overlay with full article text. `selectedPost` state in Blog.jsx; minimal markdown rendering (##/\*\*/\`code\`).
42. **R4: useToast() usage** — `useToast()` returns the `showToast` function directly (not `{showToast}`). Contact.jsx and any new components must use `const showToast = useToast()`.
43. **R4: /docs redirect** — `DocsRedirect` component uses `window.location.href = "/help/index.html"` (not React Router) to ensure the static HTML file is served, bypassing the SPA.
44. **R4: DPDP Act 2023** — Full compliance section added to Privacy.jsx covering applicability, lawful basis, data principal rights, grievance officer (privacy@datiq.app), cross-border transfers, retention.
45. **R4: Indian arbitration** — Terms.jsx "Governing Law and Dispute Resolution" updated to Indian law, Arbitration and Conciliation Act 1996, seat Bengaluru, English language, sole arbitrator.
46. **R6: Home batch mode** — `batchMode` toggle added to scrape-opts-grid (first position). When active: multi-URL textarea replaces single URL field, progress bar + cancel during run, inline `BatchResultsPanel` after completion with CSV/PDF/MD/JSON export buttons. Dead `submitBatch` function removed; single `handleBatchExtract` used.
47. **R6: Feature card tag layout** — `.feature-body` + `.feature-title-row` wrapper added so Popular and Recommended tags sit inline next to the title. CSS: `.feature-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }` + `.feature-title-row .feature-tag { margin-left: 0; }`.
48. **R6: Dashboard no-demo** — `DEMO_EXTRACTIONS` import removed; `showingDemo` always `false`; demo banner removed. Empty state when `items.length === 0` shows bookmark icon + "Nothing saved yet" + "Extract a page" CTA button.
49. **R6: Batch inline CSS** — Added `.batch-field-wrap`, `.batch-field-header`, `.batch-field-label`, `.batch-field-count`, `.batch-field-textarea`, `.batch-field-footer`, `.batch-field-progress`, `.batch-field-progress-label`, `.batch-cancel-btn`, `.batch-inline-results`, `.batch-inline-header`, `.batch-inline-badge`, `.batch-inline-fail`, `.batch-inline-exports`, `.batch-inline-btn`, `.batch-inline-rows`, `.batch-inline-row`, `.batch-inline-dot`, `.batch-inline-url`, `.batch-inline-errmsg`, `.batch-inline-meta` to screens.css.
50. **R6b: AI step non-fatal** — `realSummary()` and `realContent()` in `aiService.js` now wrap `callAI()` in try/catch; if AI returns 400/503/any error, they silently fall back to `mockSummary()`/`mockContent()` so the extraction still succeeds. This fixes "AI request failed (400)" causing all extractions to fail when the Anthropic model returns 400.
51. **R6b: ai.js model fallback** — `netlify/functions/ai.js` now retries once with `claude-3-5-haiku-20241022` when the primary model (`claude-haiku-4-5-20251001`) returns HTTP 400. Uses a nested `callAnthropic(modelId)` helper. The `FALLBACK_MODEL` const is separate from `DEFAULT_MODEL` for easy maintenance.
52. **R6c: Batch auto-save** — After `runBatch` completes, all successful results are automatically saved to the database via `Promise.allSettled(successItems.map(saveExtraction))`. A "N pages saved to Dashboard" toast fires when done. Applies to both `/batch` page and Home inline batch mode. `saveExtraction` imported in `Batch.jsx` and `Home.jsx`.
53. **R6c: PDF stale-chunk error** — `Failed to fetch dynamically imported module` (stale Vite chunk after deploy) was misclassified as a network error. Fixed: (a) new category in `errorMessages.js` for dynamic import failures → "App update available, please refresh"; (b) all PDF export handlers (`Dashboard.jsx`, `Batch.jsx`, `Home.jsx`) detect the error and show a toast "App updated — please refresh the page and try again." instead of the confusing error modal.
54. **R7: AdminPricing `batch_max_urls` field** — Added numeric input "Batch URL limit (0 = disabled)" to `PlanEditor` form (step=50). Included in `save()` → `limits.batch_max_urls` via `setPlanOverride`. Defaults to `plan.limits.batch_max_urls ?? 0`.
55. **R7: Batch Pack payment wiring** — `BillingProvider.purchaseBatchPack(bundleId)` added. Demo mode: immediately increments `subscription.bonusBatchUrls` by `bundle.bonusBatchUrls` (50). Real payment: calls `initiateTopupCheckout` → on success/demo_mode grants bonus URLs. Pricing.jsx `handleBundleBuy` replaced mailto stub with `purchaseBatchPack(bundleId)` → navigates to `/account` on success.
56. **R7: Stable AI model default** — `netlify/functions/ai.js` `DEFAULT_MODEL` changed to `claude-3-5-haiku-20241022` (stable). `FALLBACK_MODEL` is now `claude-haiku-4-5-20251001` (newer, used only as fallback if stable returns 400). Set `AI_MODEL` env var in Netlify to override.
57. **R8: Grouped Export dropdown** — Dashboard: 4 individual CSV/PDF/MD/JSON buttons → single "Export ▾" dropdown showing plan hints. Same dropdown in floating selection bar.
58. **R8: Floating selection action bar** — `SelectionBar` component fixed at bottom of Dashboard when ≥1 rows selected. Generate (→ContentModal) / Email (→EmailModal) / Export dropdown. Animated slide-up.
59. **R8: Auto-save on extraction** — `ExtractionProvider.extract()` calls `saveExtraction(result)` fire-and-forget after navigate to `/preview`. Sets `result._saved = true` on success.
60. **R8: Preview action bar redesign** — "Save to Dashboard" + "Discard" replaced with "View Dashboard" (primary) + "Generate" (→ContentModal) + "Delete" (ghost). `deleteExtraction` statically imported.
61. **R8: Generate content on Preview** — ContentModal accessible from Quick Enrichment card header ("Generate content" button) and action bar.
62. **R8: Home cleanup** — Batch mode toggle and inline batch UI removed. "Use Batch mode →" hint link added. "Try" example chips removed; only validation error shown.
63. **R8: Batch result View button** — Each success row in `/batch` results table has "View" → `view(item)` → `/preview`. AI summary snippet shown in results.
64. **R8: Email webhook fallback** — `emailService` catches network-level `fetch` failures (CORS / server down) and falls through to mailto instead of showing raw "Failed to fetch".
65. **R9: TopBar Batch order** — `mainLinks` reordered to Extract → Batch → Dashboard (was Extract → Dashboard → Batch).
66. **R9: Batch auto-save `_status`/`_error` fields** — `Batch.jsx` strips `_status` and `_error` before calling `saveExtraction()`. `netlify/functions/extractions.js` also destructures and discards these fields before the Supabase insert to prevent 500 errors from unknown columns.
67. **R9: Dashboard dropdown z-index** — `.dash-header` and `.preview-bar` given `position: relative; z-index: 10` so their Export/Download dropdowns paint above sibling cards (which inherit `z-index: 1` from `.container > *`).
68. **R9: Dashboard localStorage-first loading** — `items` state initialized via `useState(readLocalItems)` (lazy init from `datiq.saved`); `loading` spinner only shown when localStorage has no data; API sync runs in background and updates items silently.
69. **R9: Dashboard Refresh button** — "Refresh" ghost button added to header; calls `listExtractions()` and updates state; shows "Refreshed" toast on success.
70. **R9: Dashboard inline selection actions** — When rows are selected, `dash-toolbar-right` shows Generate + Email + Clear buttons inline (in addition to the floating selection bar at the bottom).
71. **R9: Preview Download dropdown** — Action bar "Generate" button replaced with "Download ▾" dropdown (CSV / PDF / Markdown / JSON). "Generate content" button remains in the Quick Enrichment card header.
72. **R9: Footer alignment** — `.site-footer-slim { padding: 18px 0 }` changed to `padding-top/bottom` only so `.container`'s horizontal `clamp(20px, 4vw, 44px)` padding is no longer overridden. Footer left/right edges now align with TopBar and page content.
73. **R9: Dashboard Generate/Email guard** — `setContentItem(selectedItems[0])` and `setEmailOpen(true)` now guarded by `selectedItems.length > 0` in both inline toolbar and floating SelectionBar, preventing crash when stale selection IDs don't exist in current items list.
74. **R9: Batch export strips `_status`/`_error`** — `successResults` mapped to remove `_status` and `_error` before CSV/PDF/Markdown/JSON exports, so users don't see internal batch fields in their downloaded data.
75. **R9: extractionsRepo `shouldFallback` covers 500** — Added `err.status === 500` to the fallback condition so unexpected Supabase/function errors degrade to localStorage instead of surfacing a hard error modal to the user.
76. **R9: Dashboard loading init single-read** — `loading` now initialised as `!localStorage.getItem("datiq.saved")` (key existence check only) to avoid double JSON-parse. The `useEffect` cleanup simplified: `setLoading(false)` moved back to `.finally()` only.
77. **R10: Explore menu Contact Us + Submit Bug** — `EXPLORE_SECTIONS` Resources section now has: About DatIQ (top), Contact Us (/contact), Submit Bug (/contact?type=bug), Blog, Help Center. `/contact` added to `EXPLORE_ACTIVE_PATHS`.
78. **R10: Contact page bug report pre-fill** — New "Bug report" enquiry type added to `CONTACT_TYPES`. `useLocation` reads `?type=` query param on mount; matching type is pre-selected (fallback "support"). When `type=bug`, subject is pre-filled with "Bug report: ". Icon for "other" type corrected from unregistered "message-circle" to "message-square".
79. **R10: Explore restructure — Company + Contact sections** — `EXPLORE_SECTIONS` now has 6 sections: Company (About DatIQ at top), Pricing, Use Cases, Compare, Resources (Blog + Help Center), Contact (Contact Us + Submit Bug at bottom). Mobile nav accordion auto-propagates the new structure.
80. **R10: AdminUsers PLAN_BY_ID fix** — `AdminUsers.jsx` `PlanPill` component was importing `PLAN_BY_ID` directly from `pricingConfig.js` (violating arch rule). Fixed to use `getEffectivePlanById()` from `pricingOverrides.js` so admin price overrides apply consistently.
81. **R11: Razorpay `PAYMENT_STAGE` state machine** — Added `PAYMENT_STAGE` / `PAYMENT_STAGE_LABELS` exports to `paymentService.js`. `initiateRazorpayCheckout` threads `onStageChange(stage, msg)` through all steps: `PREPARING → PORTAL_OPEN → VERIFYING → ACTIVATING`. Error patterns in `rzp.on("payment.failed")` map to user-friendly messages.
82. **R11: `PaymentProcessingModal`** — New global overlay component mounted in `BillingProvider`. Shows 3-step progress indicator during Razorpay flow. Hidden during `IDLE` and `PORTAL_OPEN` (Razorpay's own modal covers screen). Error state has "Try again" + "Contact support". Cancelled state has "Back to pricing".
83. **R11: `retryPayment` callback** — `BillingProvider` stores `lastPaymentArgs` ref (planId + billingPeriod). `retryPayment()` re-calls `initiatePayment` with stored args on error, so "Try again" in modal actually re-initiates the payment flow without user re-clicking.
84. **R11: INR annual amount fix** — `initiateRazorpayCheckout` now uses `plan.price_inr_annual × 12 × 100` (paise) for annual INR billing instead of USD→INR live conversion — matches the fixed promotional price shown on Pricing page.
85. **R11: `create-checkout.js` rewrite** — Added `billingPeriod` server-side price tables; fixed Agency plan `$199 → $299`; added `batch-pack` / `workspace-addon` bundle support; input validation with specific error codes (`INVALID_PROVIDER`, `UNKNOWN_PLAN`, `AMOUNT_TOO_SMALL`, `RAZORPAY_NOT_CONFIGURED`).
86. **R11: `verify-payment.js` timing-safe HMAC** — Replaced `generated === signature` string comparison with `timingSafeEqual` from Node.js `crypto` module to prevent timing side-channel attacks.
87. **R11: `payment-webhook.js` Supabase sync** — Complete rewrite: lightweight `getDb()` REST client (no SDK); handles Razorpay events (`payment.captured`, `payment.failed`, `subscription.*`); Stripe events (`checkout.session.completed`, `invoice.payment_failed`); returns HTTP 200 even on DB errors to prevent gateway retries.
88. **R11: `billingPeriod` threading** — `billingPeriod` now flows end-to-end: `Pricing.jsx handleSelect(planId, billingPeriod) → BillingProvider.initiatePayment(planId, billingPeriod) → initiateCheckout({billingPeriod}) → initiateRazorpayCheckout/initiateStripeCheckout → server`.
89. **R11: `account-stats` CSS** — Missing `.account-stats { display: flex; flex-direction: column; }` class added to `screens.css` (referenced in Account.jsx quick-stats card).
90. **R11: unused `providerMeta` removed** — `providerMeta` removed from `useBilling()` destructuring in `Account.jsx` (component uses `PROVIDER_META` directly from import). Prop also removed from `PaymentHistorySection` call site and function signature.
91. **R12: Plan card hover states** — `.plan-card:hover` scoped with `:not(.plan-current):not(.plan-coming-soon):not(.plan-selecting)` guards — lifts 3px, accent border, subtle tint. Active/disabled cards never lift.
92. **R12: Plan card current/selecting states** — `.plan-card.plan-current` green ring + `.plan-current-badge` pill overlay ("Your plan"). `.plan-card.plan-selecting` pulsing accent ring via `@keyframes plan-select-pulse` (runs while payment modal is open).
93. **R12: TopupBundleModal** — New component `src/components/TopupBundleModal.jsx`: quantity selector 1–10 with live cumulative pricing, bonus URL count scaled by qty, upsell section showing up to 2 higher plans, CTA "Add N bundle(s) — {total}". Opens from every "Add to plan" button on Pricing page. Missing CSS classes `.tbm-summary-per` and `.tbm-upsell-divider` added to `screens.css`.
94. **R12: Payment-gated plan activation** — `upgradePlan()` only fires on `status === "demo_mode"` or `status === "success"`. Cancelled, error, and exception paths leave plan unchanged. Default planId for new/unpaid users is `"free"` (set in `readSubscription()` default). `purchaseBatchPack` qty param: `bonusUrls = (bundle.bonusBatchUrls || 50) * qty`; server receives qty and computes `unitAmount × qty` authoritatively.
95. **R12 hotfix: DemoPaymentModal** — Clicking "Get Plan" with no payment keys configured (`hasPayment=false`) previously silently upgraded the plan with zero UI. Fixed: `initiatePayment` now `await`s a `new Promise` whose resolve is stored in `demoResolveRef`. Setting `demoTarget` state mounts `DemoPaymentModal` (plan name + price + greyed-out mock card fields + "Demo mode" badge + confirm/cancel). `confirmDemoPayment` resolves `true` → `upgradePlan` → returns `"demo_mode"` to caller. `cancelDemoPayment` resolves `false` → returns `"cancelled"`, plan unchanged. Real payment flow (Razorpay/Stripe) is completely unaffected — only the `!hasPayment` code path changed. To enable real payments: set `VITE_RAZORPAY_KEY_ID` + `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (or Stripe equivalents) in Netlify env vars and redeploy.
96. **Razorpay env-var diagnostic notices** — Pricing page demo-mode banner now lists exact variable names needed. `DemoPaymentModal` body replaced generic text with numbered setup instructions (`VITE_RAZORPAY_KEY_ID` browser/build-time, `RAZORPAY_KEY_ID` server-side, `RAZORPAY_KEY_SECRET` server-side). `RAZORPAY_NOT_CONFIGURED` server error message now names the exact Netlify env vars and rebuild requirement. `screens.css`: `payment-demo-notice` upgraded to multi-line with `code` monospace styling; new `.dpm-env-list` rule.
97. **R13: `PaymentConfirmModal`** — New modal (`src/components/PaymentConfirmModal.jsx`) shown before initiating payment. Displays itemized price breakdown: base price, 18% GST amount, total amount in INR/USD. Has "Confirm & Pay" → calls `initiatePayment`, and "Cancel" / "Upgrade to X" upsell option. `BillingProvider` now sets `confirmTarget` state before opening payment, mounts `<PaymentConfirmModal>` in provider tree.
98. **R13: Bundle display prices are pre-GST** — `TopupBundleModal` and bundle cards on `/pricing` now show base price (pre-GST). GST breakdown (18%) and total shown only in `PaymentConfirmModal` at confirm step. This matches how plan prices are displayed throughout the UI.
99. **R13: TopupBundleModal upsell INR prices** — Previously hardcoded `formatPrice(plan.price_usd_annual, "USD")`. Now checks `isINR` flag: shows `₹{plan.price_inr_annual}` when currency is INR, falls back to USD otherwise. E2E verified: shows ₹999/mo and ₹1,499/mo when INR is active.
100. **R13: Enterprise plan card missing** — `ENTERPRISE_PLAN` was defined in `pricingConfig.js` and `EnterpriseCard` component existed in `Pricing.jsx` but neither the import nor the `<EnterpriseCard>` render call was present. Both added. E2E verified: 7 plan cards (Free/Select/Pro/Business/Agency/Developer/Enterprise) all visible.
101. **R13: Batch results table full width** — `.batch-page { max-width: 860px }` in `screens.css` was constraining the results table. Changed to `width: 100%` so table uses full container width, matching other pages.
102. **R13: Usage upsell banner page-width constraint** — `.usage-upsell-banner` previously spanned full viewport with its background. Refactored: outer `.usage-upsell-banner-wrap` takes full width with the background colour; inner `.usage-upsell-banner` is `max-width: 1080px; margin: 0 auto` with clamp padding, aligning to page container. `isOver` class moved to outer wrap.
103. **R13: Account quick stats — batch + content counts** — Added two new rows in Account.jsx quick stats: "Batch executions" (`usage?.batchRuns`) and "Content generations" (`usage?.contentGenerations`). Both default to 0.
104. **R13: `usageService.js` new counters** — Added `batchRuns: 0` and `contentGenerations: 0` to default usage object in `readUsage()`. Added `incrementBatchRuns(count)` and `incrementContentGenerations(count)` exports. `Batch.jsx` calls `incrementBatchRuns(1)` after each batch completes. `ContentModal.jsx` calls `incrementContentGenerations(1)` after each successful generation.
105. **R13: TopBar Explore restructure** — `EXPLORE_SECTIONS` updated: Browse.ai and Clay removed from Compare section (only "Compare Tools" → `/vs/compare.html` remains). "Submit Bug" removed from Contact section. "About DatIQ" moved to the last section ("Company") at the bottom of the dropdown. All external links open in the same window (`target="_blank"` removed).
106. **R13: Comparison pages — Apify + PhantomBuster** — Created `public/vs/apify.html` (DatIQ vs Apify) and `public/vs/phantombuster.html` (DatIQ vs PhantomBuster). Both are full comparison pages with feature tables, verdict cards, and cross-links to all 4 comparison pages. `public/vs/compare.html` updated: hero quick-links section at top lists all 4 pages; bottom "Detailed comparisons" section updated to list all 4.
107. **R13: Help file cleanup** — `public/help/index.html`: removed "(External)" labels from User Guide and Developer Reference sections; removed entire "Internal Reference" sidebar section (I1–I5 links) since those are internal developer docs not relevant to end users. `public/help/09-exports-and-sharing.html`: complete rewrite — fixed brand name, all 5 export formats (CSV/PDF/Markdown/JSON/Email) with plan requirements and descriptions, "Where to export from" section, "Email export" step-by-step, "Tips" section; removed all code/DB/architecture references.
108. **R14a: Firecrawl fallback chain** — `netlify/functions/extract.js` rewritten to use `runScrapeChain` / `runMapChain` from new `netlify/functions/lib/scrapeProviders.js`. Default chain: Firecrawl → Spider.cloud → Jina AI → Direct fetch. Each adapter normalizes to `{ data: { html, metadata: { title }, json } }` shape — `firecrawlService.js` needs no changes. Jina converts markdown to basic HTML (heading + link tags) so browser `parseHtml()` works. Direct fetch is always available (no key). Chain order overrideable via `SCRAPE_PROVIDER_ORDER` env var. `config.js` `hasFirecrawl` is now true when any provider key is set or `VITE_ENABLE_EXTRACT=true`.
109. **R14b: Home intent chips** — 5 intent chips (AI summary / Find contacts / Scrape pricing / Map site / Custom) replace 4 Toggle components. `INTENTS` array + `CARD_TO_INTENT` map; `handleCardClick` scrolls to and selects the matching chip when a feature card is clicked. Active chip applies `var(--chip-accent)` border.
110. **R14b: Smart multi-URL input** — Progressive disclosure: "Need multiple URLs?" reveal below URL field expands a `<textarea>`. For 2–10 URLs, `handleBatchExtract()` runs inline (maps to `/batch` with pre-populated state); for >10, navigates to `/batch` with `{ state: { urls, intent } }`. FAB button (layers-2 icon) opens `BulkUploadModal` (paste list + CSV upload). `parseUrlsFromText()` deduplicates and normalizes bare domains. `MULTI_INLINE_MAX = 10`.
111. **R14b: OG preview card** — 800ms debounce on `url`/`valid` state; calls `/api/og-preview?url=...` (new `netlify/functions/og-preview.js`); fetches first 15KB of target page, parses og:title/og:description/`<title>`/meta-description, returns `{ url, hostname, favicon, title, description }`; favicon from `https://www.google.com/s2/favicons?domain=X&sz=32`. Preview card hidden when loading or no data.
112. **R14b: Batch intent chips + history** — `/batch` page uses same `BATCH_INTENTS` chip pattern (4 chips: summary/contacts/pricing/custom). After each batch run: `uid()` generates `batchRunId`, `recordBatchItems(batchRunId, savedIds)` writes `datiq.batchMap`, `saveBatchRun({id, label, intent, createdAt, totalUrls, successCount, failedCount})` writes `datiq.batchRuns` (max 50). "View in Dashboard →" CTA appears after completion.
113. **R14b: Dashboard batch history filter** — `BatchRunsDropdown` component in `dash-header-actions`: shows run count badge, dropdown lists past runs (label + meta + delete ×), click-to-filter sets `batchFilter` state. `filtered` memo gates on `batchMap.current[it.id] === batchFilter`. Active filter shown as dismissable `batch-filter-banner`. Table rows and `DashCard` get `batch-item-tag` chip when `isBatchItem(id)` is true. localStorage keys: `datiq.batchRuns` + `datiq.batchMap`.
114. **R15: Home FAB navigates to /batch** — Bottom "Need multiple URLs?" section removed from Home entirely. FAB button (layers-2 icon) beside the Extract button now shows icon + "Bulk import" label and navigates directly to `/batch` instead of opening `BulkUploadModal`. `BulkUploadModal` import and `bulkOpen` state removed from `Home.jsx`. `handleBulkUrls` removed.
115. **R15: Batch textarea localStorage draft** — `Batch.jsx` `pasteText` state initialized from: (1) `location.state.urls` (nav from Home FAB), (2) `localStorage.getItem("datiq.batchDraft")` fallback, (3) empty string. `useEffect` persists every `pasteText` change to `datiq.batchDraft`. "New batch" button clears the draft (`localStorage.removeItem`). Textarea content now survives page refresh and back-navigation.
116. **R15: Batch Export ▾ unified dropdown** — Replaced 4 individual CSV/PDF/MD/JSON export buttons in `/batch` results with single `ExportDropdown` component (same pattern as Dashboard). Results actions bar: `[Export ▾] [New batch] [View in Dashboard →]`.
117. **R15: Dashboard BatchRunsDropdown alignment** — `.batch-runs-menu` changed from `right: 0` to `left: 0`. The 300px dropdown was overflowing left off-screen because the button is on the far left of the toolbar. Now opens rightward from the button's left edge, within the page layout.
118. **R17: Hard block not shown on page reload** — If count ≥ hardLimit and user refreshes, `GuestTrialProvider` mounted with `showHardBlock=false` (default). Fixed: mount `useEffect` with `[]` deps reads localStorage counts + `getSettings()` synchronously; calls `setShowHardBlock(true)` if either limit already reached. Ensures hard block appears immediately on page load without requiring an extraction attempt.
119. **R17: Missing `setShowHardBlock(false)` in logout soft-prompt path** — Logout if/else chain set `showHardBlock(true)` for hard cases but never explicitly set it `false` for the soft-prompt or clean-slate branches. If `showHardBlock` was previously `true`, it could persist into the wrong gate. Fixed: explicit `setShowHardBlock(false)` added in both the soft-prompt branch and the else (clean-slate) branch.
120. **R17: Hard block overlay transparent** — Hard block removes the backdrop `<div>`, so `.guest-trial-overlay` had no background. Clicks could reach page elements behind. Fixed: `.guest-trial-overlay.gtm-hard { background: rgba(0,0,0,.60); }` — overlay provides its own dark background. Also added `.gtm-icon-warn` CSS class for warning-coloured icon variant.

### Razorpay live payment — required Netlify env vars (INR only; Stripe/USD on hold)

| Variable | Prefix | Value | Purpose |
|---|---|---|---|
| `VITE_RAZORPAY_KEY_ID` | `VITE_` (browser, **build-time**) | `rzp_test_...` or `rzp_live_...` | Unlocks real payment flow (`hasPayment=true`); opens Razorpay modal |
| `RAZORPAY_KEY_ID` | none (server, runtime) | same value as above | Netlify Function creates Razorpay order |
| `RAZORPAY_KEY_SECRET` | none (server, runtime) | your key secret | Order creation + HMAC signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | none (server, optional) | webhook secret | Verifies incoming Razorpay webhook events |

**NOT needed:** `VITE_RAZORPAY_PLAN_*` — current code uses Razorpay Orders (one-time), not Subscriptions.
**CRITICAL:** After setting `VITE_RAZORPAY_KEY_ID`, trigger a **full rebuild** in Netlify (Deploys → Trigger deploy) — it is baked into the JS bundle at build time.

---

## Multi-provider AI (enrichment) — fallback chain + admin config

> The enrichment AI (summaries, link categorization, content generation) is now
> provider-agnostic. **Scraping uses its own separate fallback chain** (Firecrawl → Spider → Jina → Direct)
> via `scrapeProviders.js` — this section only covers the enrichment/AI layer.
> Frontend is unchanged: `aiService.js` → `apiClient.ai` → `/api/ai`; every adapter
> normalizes its reply to the Anthropic `content[].text` shape so the browser never
> knows which provider answered.

| Piece | Detail |
|---|---|
| Default chain | **Gemini → Anthropic Claude → OpenAI** (cost-first). Override via `AI_PROVIDER_ORDER` env or `/admin/ai`. |
| Adapters | `netlify/functions/lib/aiProviders.js` — `callGemini` / `callAnthropic` / `callOpenAI`; `runChain()` tries each **enabled** provider **with a key**, returns first success; else 502 → `aiService.js` mock fallback. |
| Proxy | `netlify/functions/ai.js` — rewritten; **ignores client `model`** (per-provider model from config), honors client `max_tokens`. 503 when no provider key is set. |
| Config source | `loadAiConfig()` merges Supabase `app_config` row `key='ai'` over env/static defaults (60s cache) — same pattern as `pricingSource.loadPricing()`. Operator config PREVAILS; static is fallback. |
| Admin screen | `/admin/ai` (`AdminAI.jsx`) — reorder providers, edit model id per provider, enable toggles, default max tokens. Shows per-provider key presence (no secrets) + a not-persisted warning when Supabase is unconfigured. |
| Write path | `netlify/functions/admin-ai-config.js` — GET (public-ish: config + key presence, no keys); POST gated by `verifyAdminToken()` (`lib/adminToken.js`, HMAC of the `admin-auth` session token), upserts `app_config`. |
| Keys | `GEMINI_API_KEY` / `AI_API_KEY` / `OPENAI_API_KEY` — **server env only, never VITE_**. Stored config holds only non-secret model ids/order. |
| DB | Run `scripts/ai-config.sql` (creates `public.app_config`, RLS-locked to service key). Empty table → built-in defaults. |
| Rule | Never re-introduce a single hardcoded provider in `ai.js`. Add new providers in `aiProviders.js` `ADAPTERS` + `PROVIDER_META` + `DEFAULT_MODELS`. |

| `datiq.analytics` | analyticsService.js — pending event buffer (writes-through to Supabase `analytics_events`; falls back to localStorage on failure) |
| `datiq.summaryFeedback` | feedbackService.js — map: extractionId → { rating, comment, updatedAt } (Q5 thumbs up/down) |
| `datiq.publicGallery` | shareService.js — gallery index (slug, title, url, created_at, intent), capped at 500 |
| `datiq.sharedExtractions` | shareService.js — full public projections (mirror of `public_reports` table) |
| `datiq.onboardingTour.v1` | onboardingTour.js — `{ completedAt?, skippedAt? }` for Q4 tour |


---

## Outstanding tasks

### Invoicing & subscription lifecycle (2026-07-27 — ON A BRANCH, NOT MERGED)

Branch `claude/datiq-invoicing-model-e16ea3`, 4 commits. Full detail:
`docs/SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md`.

**Before anything else — the SQL has never run.** Migrations `0012`–`0017` were
only checked for structure; there is no local Postgres. Apply to a scratch
Supabase project and confirm the new objects exist.
**Commands, staged-apply path, verification queries and failure modes:
[`docs/DB-MIGRATION-RUNBOOK.md`](docs/DB-MIGRATION-RUNBOOK.md).**

- [ ] **Apply + verify migrations 0012–0017** on a scratch project. `npm run migrate:prod -- --dry-run` first
      (it connects, prints `current_database`, and aborts on the wrong target without writing).
      Full apply = **26 tables / 9 functions / 2 triggers**; all 9 DB functions come from the
      migrations themselves — there is no separate "create functions" step.
- [ ] **Respect the ordering** — it is load-bearing and documented in `0012`'s header:
      `0012` (additive, neutral) → ship the dual-write release for one cycle →
      `0013` backfill (note the orphan count) → `0014` RLS flip → `0015`–`0017`.
      ⚠️ After `0014`, guest/unclaimed payment history stops showing in-app. Intended, but know it.
      ⚠️ **`npm run migrate:prod` has no stop-at-N flag** — a bare run applies `0001`→`0017` in one
      pass, `0014` included. Fine on a scratch project, wrong on a database with real users; use the
      subset one-liner in the runbook §4 for the staged path.
      ⚠️ `0013`'s orphan count is emitted via `raise notice` and is **swallowed** by the runner —
      query it directly (runbook §6.2), and only after `0012` has added `user_id`.
      There is no `schema_migrations` table; runbook §6.0 probes which migrations a DB already has.
- [ ] **Drive one real Razorpay test-mode payment end to end.** Confirm: one invoice row,
      one number, one email with a `%PDF-` attachment, and `taxable + tax === total`.
- [ ] **Build the `/admin/billing` React page.** `netlify/functions/admin-billing.js` and its
      34 contract tests are done; **no UI consumes them yet.** Goes in the standalone `AdminLayout` shell.
- [ ] **Build the billing-details capture UI** (Account card + optional `PaymentConfirmModal` expander).
      `buyer_snapshot` / `placeOfSupply` are plumbed end to end and accepted by `create-checkout`,
      but nothing collects them — so invoices carry email + name only and place of supply
      defaults to intra-state.
- [ ] **Wire proration into the upgrade path.** `src/lib/prorationMath.js` is complete and tested,
      and `chargeMath` applies `prorationCreditMinor`, but nothing yet COMPUTES it at upgrade
      time from the prior invoice's `taxable_minor`.
- [ ] **Mount `PlanChangeWarning`** in `Pricing.jsx`'s plan-select flow (component + CSS exist, tested via `describePlanChange`).
- [ ] **Scheduled-downgrade UI** — `scheduled_plan_id`/`scheduled_at` are honoured by the cron; nothing sets or cancels one.
- [ ] **Arm the purge, slowly.** Leave `PURGE_ENABLED` unset until `billing-lifecycle` has run
      cleanly for a full cycle, then `PURGE_DRY_RUN=1`, read the logs, and only then arm it.
- [ ] **CA review one rendered invoice** before setting `SUPPLIER_GSTIN`.
- [ ] **Stripe branch writes no invoice draft** — only Razorpay does. Must be added when Stripe is re-enabled.
- [ ] e2e specs: `e2e/journeys/billing-suspended.spec.js`, `invoice-download.spec.js` (planned, not written).
- [ ] `usage_records` / `usage_alerts` keep `anon full access` — a privacy leak, NOT an entitlement
      escalation. Locking them breaks guest usage sync; move guest writes behind a function first.
- [ ] ⚠️ **`reengagement.js:182` selects a `user_email` column that `0004_scheduler.sql` never creates.**
      The query 400s and the error is swallowed, so **that cron is a silent no-op in production**,
      whatever the older handoffs claim. Documented, not fixed. The new billing crons deliberately
      avoid the pattern.

**Known semantic gap:** v1.0 uses one-time Razorpay Orders, so there is **no auto-renewal**.
A "scheduled downgrade" cannot silently charge the cheaper plan — it records intent for the
next purchase, and the account lapses to `suspended` in the same sweep. Razorpay
Subscriptions / UPI Autopay remains the highest-value follow-up; the webhook handlers for
`subscription.charged` / `.cancelled` already exist and are unused.


### Pre-cutover: Production isolation (2026-07-19, MERGED to main)

Two pre-cutover migration plans + 3 production-isolation fixes merged to main in one drop. All work on `fix/migrate-prod-fresh-db` branch (now merged + deleted). See `docs/SESSION-HANDOFF-2026-07-19.md` for the full session log.

**Shipped (6 commits, 0 source-code behavior changes — infra/env/CI only):**

| Commit | What |
|---|---|
| `af9904c` | `docs:` add `FIREBASE-MIGRATION.md` + `NETLIFY-ENVIRONMENTS.md` (two pre-cutover plans; 1,228 + 1,436 lines) |
| `a57cde5` | `fix(scripts):` use `node pg` instead of `psql` for `migrate-prod` (works on any macOS without Homebrew libpq) |
| `35ed90a` | `fix(migrations):` add missing `CREATE TABLE public.extractions` to `0001_core_tables_and_billing.sql` + `run-all.sql` (was failing on fresh DBs) |
| `47631dc` | `ci:` add `.github/workflows/phase-gate.yml` — 4-job gated deploy (test → smoke-staging → manual-approve → deploy-prod → smoke-prod + auto-rollback) |
| `82ee415` | `ci:` phase-gate end-to-end test (trivial commit) |
| `5ca1345` | `chore(netlify):` add `[context.production|staging|deploy-preview.environment]` blocks to `netlify.toml` (placeholders only; real values go in Netlify UI); add `env.*` to `.gitignore`; add `TODO(SCHEDULE_ALERT_WEBHOOK)` in `scheduled-runner.js` |

**New env var support:**
- `scripts/migrate-prod.mjs` — Node-based migration runner. `npm run migrate:prod -- --list` to discover; `--dry-run` to test connection; auto-discovers `00*.sql` in lexical order. Each file in its own transaction. Idempotent (every migration uses `IF NOT EXISTS` / `OR REPLACE`). Needs the **Direct** connection string (port 5432, not the pooler) with special characters in the password URL-encoded. Its only flags are `--list` / `--dry-run` / `--include=` — **there is no stop-at-N**, so it always applies every numbered file. Full operational runbook: [`docs/DB-MIGRATION-RUNBOOK.md`](docs/DB-MIGRATION-RUNBOOK.md).

**Next steps (per `NETLIFY-ENVIRONMENTS.md` §17, 20-step sequencing):**

- [ ] **Phase 1 — Supabase:** create `datiq-prod` project in `ap-south-1`. Get the **Direct** connection string (port 5432). Run `PROD_SUPABASE_DB_URL=... npm run migrate:prod`. Verify schema (**26 tables / 9 functions / 2 triggers** with `0012`–`0017` applied; was 16 tables when only `0001`–`0011` existed), RLS (`rowsecurity = t` on every table), and empty data (`SELECT COUNT(*)` should be 0 on all user-data tables). Queries: [`docs/DB-MIGRATION-RUNBOOK.md`](docs/DB-MIGRATION-RUNBOOK.md) §6.
- [ ] **Phase 2 — Netlify:** set env vars per context (production/staging/deploy-preview) using the table in `NETLIFY-ENVIRONMENTS.md` §5.2. The toml has placeholders; the UI has the real values. Add `staging.datiq.app` custom subdomain (Cloudflare users: DNS-only / grey cloud, NOT orange). Wire to `staging` branch. Turn OFF Netlify's "Auto publishing" for production.
- [ ] **Phase 3 — Razorpay:** register **test** webhook for `https://staging.datiq.app/api/payment-webhook?provider=razorpay`; register **live** webhook for `https://datiq.app/api/payment-webhook?provider=razorpay` (after prod goes live). Different secrets per env.
- [ ] **Phase 4 — GitHub:** create `production` environment (Settings → Environments → New → production) with yourself as required reviewer, restrict to `main` branch. Create `staging` env (no reviewers). Add repo secrets: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `SLACK_WEBHOOK_URL` (optional). Add `production` env secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RAZORPAY_KEY_ID`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_WEBHOOK_URL`, `PRODUCTION_ADMIN_PIN`. Add `staging` env secret: `STAGING_ADMIN_PIN`. Add branch protection on `main`: require PR + 1 approval + `test` + `smoke-staging` checks; do not allow bypassing.
- [ ] **Phase 5 — Verify:** push trivial change to `staging` → auto-deploys to `staging.datiq.app` → `node scripts/smoke-prod.mjs https://staging.datiq.app` should be all green. Open PR from `staging` to `main` → watch phase-gate pause at "manual approval" → click Approve → verify `https://datiq.app` shows new version → smoke test passes. Test auto-rollback by pushing a broken change.

### Build / CI / UX fixes (2026-07-19 late — MERGED to main)

Four small fixes shipped on top of the pre-cutover drop. Detail in `docs/SESSION-HANDOFF-2026-07-19-BUILD-FIXES.md`.

| Commit | What | Why |
|---|---|---|
| `b8b1e53` | `fix(netlify):` remove duplicate `VITE_SUPABASE_ANON_KEY` in production env | TOML parse error blocked deploy (`Can't redefine existing key`) |
| `71a2586` | `fix(netlify):` add `netlify.toml` + `NETLIFY-ENVIRONMENTS.md` to `SECRETS_SCAN_OMIT_PATHS` | 16 false-positive secret detections (placeholders contain env-var name as substring) |
| `92b3af9` | `fix(ci):` add the missing `scripts/smoke-prod.mjs` that phase-gate depends on | Phase-gate had been failing on every run with "Cannot find module"; 10 lightweight HTTP probes + 2 admin probes (opt-in) + 15 unit tests |
| `074abfe` | `fix(topbar):` collapse Sign in + Sign up to a single primary CTA | Both buttons opened the same auth modal; one button is enough. Drop Sign in from the trial banner for the same reason |

**Outstanding follow-ups (flagged in the handoff doc, not blocking):**
- Phase-gate's `deploy-production` job does `netlify-cli deploy --prod` while Netlify ALSO auto-deploys on push to `main` — double deploy, ambiguous auto-rollback. Recommend: turn off auto-publish for production in Netlify and let phase-gate own the deploy.
- GitHub secrets for end-to-end phase-gate runs: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `STAGING_ADMIN_PIN`, plus production `VITE_*` keys.
- `staging.datiq.app` may not be configured yet — `smoke-staging` will time out if the staging branch isn't wired to a Netlify site.
- [x] ✅ **TODO(SCHEDULE_ALERT_WEBHOOK) DONE** — v2 plan shipped on branch `workflow-implementation-and-optimization`. Replaced with: a `workflow_events` queue (Supabase), an orchestrator Netlify Function (every 5 min), and a self-hosted n8n instance (Hostinger VPS at `n8n-k8q6.srv1738397.hstgr.cloud`) that doubles as the MCP server. See `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §6, `docs/N8N-WORKFLOWS.md`, `docs/MCP-TOOLS.md`.

**Cost estimate at current scale (~$45-90/mo):**
- Netlify Pro: $19/mo (unchanged)
- Supabase dev: Free → Pro $25/mo (existing)
- Supabase prod: Pro $25/mo (new — this is the main cost increase)
- Razorpay: 2% per transaction (unchanged)
- Resend: Free → $20/mo at scale (unchanged)

---

### R18 — Merged to main (2026-06-17)

**Files added/changed:**
- `netlify/functions/admin-revenue.js` (NEW) — GET /api/admin-revenue; token-gated; parallel Supabase fetch for live MRR, trend, user counts, coupon usage; INR paise→USD at 83.5; falls back to seed data with warning when Supabase unconfigured
- `netlify/functions/admin-users.js` (NEW) — GET/PATCH/POST /api/admin-users; Supabase Auth Admin API; returns planStart/planEnd/couponAvailed/couponDiscount/extractionsThisMonth per user; PATCH action='assign_coupon' writes to auth metadata + upserts coupon_redemptions (session_id=userId); POST = Supabase invite
- `src/components/Icon.jsx` — added `IndianRupee` → `"indian-rupee"` (77 icons total)
- `src/lib/adminService.js` — `validateCoupon` blocks `planId='manual'` coupons (admin-assign only, cannot self-apply)
- `src/lib/adminConfigService.js` — added `getRevenueData()`, `fetchRealUsers()`, `extendUserBonus()`, `assignUserCoupon()`, `inviteUserByEmail()` exports
- `src/pages/admin/AdminPricing.jsx` — INR Pricing section (₹-prefix inputs, `inrGst()` GST hint below each field); `price-input-wrap`/`price-prefix` wrappers for both USD and INR; BundleEditor ₹-prefix + GST hint; collapsed header shows ₹X/mo
- `src/pages/admin/AdminCoupons.jsx` — `planId='manual'` option "Manually Assigned To User(s)"; purple "Manual assign" pill in Plan column; hint when selected: "users cannot self-apply it"
- `src/pages/admin/AdminUsers.jsx` (rewrite) — real Supabase data via `fetchRealUsers()`; new columns: Coupon (amber pill + discount %), Plan period (start→end dates); Extractions/mo (shows 0 explicitly); assign coupon action icon (CouponModal: planId='manual' coupons only, discount % override, preview row, persistence via backend)
- `src/pages/admin/AdminRevenue.jsx` (rewrite) — live KPIs + 6-month trend from `getRevenueData()`; loading/error/warning/fromSeed states; Refresh button; "Revenue collected" bar chart from actual payment_events
- `src/styles/screens.css` — `.price-input-wrap`, `.price-prefix`, `.admin-price-section-label/hint`, `.plan-editor-price-inr`, `.user-coupon-pill/pct`, `.user-period-cell/date/sep/none`, `.user-extractions`, `.user-actions-cell`, `.coupon-detail-row/badge/meta`, `.coupon-preview-row`, `.cf-label-hint`, `.coupon-plan-manual`

**Status:** All R18 code committed ✅ — pushed to `main` ✅ — Netlify auto-deploy triggered ✅

- [x] ~~AdminPricing INR inputs + GST preview~~ — done (`76bc06f`)
- [x] ~~AdminUsers real Supabase data~~ — done (`95de7c9`)
- [x] ~~AdminUsers extractions, plan period, coupon columns~~ — done (`365aa4b`)
- [x] ~~AdminRevenue live data from Supabase~~ — done (`1b01650`)
- [x] ~~AdminUsers coupon assign modal: manual-only picker, discount %, persistence~~ — done (`fe1d2ba`)
- [x] ~~AdminCoupons 'Manually Assigned To User(s)' planId='manual'~~ — done (`df9e4ad`)
- [ ] Supabase `app_config` table needs the `general` key row — auto-created on first POST save via AdminGeneral page (upsert)

---

## v1.0+ Quick Wins (2026-07-17, MERGED to main — PR #14 closed)

Three rounds of quick-wins landed on `feat/v1-quickwins` and merged to main at `ea3658a`. Net **+229 vitest tests** (800 → **1029**) across 24 new test files. Build clean (1.87 s). No regressions. v1.0+ live on `datiq.app`.

### Round 1 — Cloud BI (3 commits, 11 features)

| # | Item | Files added | Tests |
|---|---|---|---|
| **Q2** | Pre-flight credit estimator (Home + Batch, disables Run when over) | `creditEstimator.js`, `CreditEstimator.jsx` | 8 + 7 = **15** |
| **Q3** | 6 outcome tiles above the hero, pre-wired URL + intent + prompt | `outcomeTiles.js`, `OutcomeTiles.jsx` | 5 + 4 = **9** |
| **Q4** | `/workspace` route — logged-in command center, teaser for guests | `Workspace.jsx`, `WorkspaceRedirect.jsx` | **4** |
| **Q5** | 12-template library (YC, SaaS pricing, jobs, contacts, products…) | `extractionTemplates.js` (12 templates), `TemplateGallery.jsx` | 8 + 6 = **14** |
| **Q7** | UrlReviewTable — comparable grid (default expanded) in Batch paste | `UrlReviewTable.jsx` | **8** |
| **Q10** | Annual-billing default (R4) — regression test in `Pricing.integration.test.jsx:126` | — | 0 (pre-existing) |

### Round 2 — Intelligence (1 commit, 3 features)

| # | Item | Files added | Tests |
|---|---|---|---|
| **Q1** | Smart multi-input — `classifyInput` returns `kind:"csv"`; composer dispatches single / multi / csv / text | `smartInput.test.js`, `HeroComposer.jsx` (updated) | **15** |
| **Q8** | `e2e/smoke/claims-verification.spec.js` — 11 Playwright tests asserting marketing claims | `claims-verification.spec.js` | 0 (e2e) |
| **Q11** | Custom Supabase analytics — `analytics_events` table + `track/flush/computeFunnel`; wired into ExtractionProvider, Dashboard, SchedulerService | `analyticsService.js`, `analytics.sql` | **14** |

### Round 3 — Sharing + provenance (1 commit, 2 features)

| # | Item | Files added | Tests |
|---|---|---|---|
| **Q6** | Shareable report links + `/gallery` — `shareService` (8-char slug), `/p/:slug` public report, `/gallery` listing, OG/Twitter meta, sitemap, Share button on Preview, TopBar Explore | `shareService.js`, `seoMeta.js`, `PublicReport.jsx`, `Gallery.jsx` | 11 + 6 + 4 + 4 = **25** |
| **Q9** | Full per-field provenance — `provenanceService` wraps every field; `ProvenanceBadge` on Preview; `provenance.jsonb` column + 2 indexes | `provenanceService.js`, `ProvenanceBadge.jsx`, `provenance.sql` | 19 + 9 = **28** |

### Defects found and fixed during the Cloud BI drop
- `OutcomeTiles` test using `getByRole("listitem", { name })` failed — switched to `getByText(title).closest("button")`.
- `TemplateGallery` test same issue — same fix.
- `vi.mock(authService)` + `importActual` short-circuited on null supabase — full module mock + correct `getSession()` return shape.
- `computeFunnel` ACTIVATION stage named `"activation"` but real events are `"extraction_success"` — renamed to `"extraction"` with a `firstInsight` prefix match.
- `avgTimeToFirstInsightMs` returned 0 when first event was the insight itself — restructured to track non-insight "session start".
- `getByRole("listitem", { name })` couldn't read text from a button with `role="listitem"` — switched to `getByText().closest("button")`.
- Home integration test matched "Scrape pricing" / "leads" in both outcome tiles and templates — scoped to `.outcome-tile` / `.template-card`.

---

## v1.0+ Quick Wins — alternate model (2026-07-17, MERGED to main)

After the Cloud BI drop, the user reviewed an alternate-model list and found two UX gaps plus five missing features. All five landed. **+74 vitest tests** (955 → 1029).

### Fixes from the alternate-model review
1. **Q8 shareable URL — cross-browser fix (CRITICAL)**: the previous share was localStorage-only — the URL only worked in the originator's browser. Now persisted to `public_reports` (Supabase, anon-read, owner-only update/delete). Cross-browser repro test added (`shareService.test.js`).
2. **Q3 outcome tiles — multi-select**: clicking 2+ tiles now appends prompts (joined by `\n\n`) and auto-switches intent to "custom". A "Clear (N)" button removes all active tiles. 5 new integration tests.
3. **Removed the duplicate "Add multiple URLs" reveal on Home** — the Q1 smart composer auto-detects multi-URL input and routes to `/batch`. The 5 obsolete MultiUrlReveal tests were deleted.

### New features
| # | Item | Files added | Tests |
|---|---|---|---|
| **Q11** | Keyboard shortcuts (power-user mode) — `useHotkeys` hook (chord-aware), HotkeyHelp modal, 11 shortcuts (`?`, `Esc`, `/`, `g d/b/s/p/w/t`, `mod+k`) | `hooks/useHotkeys.js`, `components/HotkeyHelp.jsx` | **15** unit |
| **Q5** | AI Summary thumbs up/down feedback — `feedbackService` + `FeedbackWidget` (thumbs + comment), `summary_feedback` table | `lib/feedbackService.js`, `components/FeedbackWidget.jsx`, `scripts/summary-feedback.sql` | 14 + 8 = **22** |
| **Q3** | Plan-aware saved-searches cap (free = 10, paid = unlimited) | `lib/savedSearches.js` | 10 + 2 = **12** |
| **Q1 (alt)** | Interactive Try-an-Example demo — 5-step auto-playing walkthrough that types `lumio.io`, picks an intent, runs the mock extraction, reveals the summary. Pause / Replay. Respects `prefers-reduced-motion`. | `components/TryExampleDemo.jsx` | **5** component |
| **Q4** | In-App Onboarding Tour overlay — 6 steps (intro / composer / outcomes / templates / batch / done), spotlight + popover with 5 placements, Esc to close, `g t` to replay | `lib/onboardingTour.js`, `components/OnboardingTour.jsx` | 9 + 7 = **16** |

### Defects found and fixed during the alternate-model drop
- `buildKey` separator was always space — switched to `+` for modifier+key combos.
- Chord prefix detection was inside the match-truthy branch — restructured to detect chord prefixes regardless of match.
- `isSupabaseEnabled` was mocked as a constant, not a getter — fixed in both `feedbackService.test.js` and `shareService.test.js`.
- Recursive spread in feedbackService Supabase mock caused "Maximum call stack size exceeded" — refactored to a plain non-recursive object literal.
- `vi.useFakeTimers()` was leaking between tests in the keyboard-shortcut test file — added `vi.useRealTimers()` to `beforeEach`.

---

## Council feature followup (2026-07-18, MERGED to main)

> 11 council-prioritised features audited. 5 already shipped, 4 had real gaps, 2 polish extras. All 4 gaps closed + 4 polish items landed in one drop. `main` at `06a5b96` (merge commit), `feat/council-followup` synced. **+53 net new tests (1029 → 1082), build clean in 1.88s, 0 regressions.**

| # | Item | Files added | Tests |
|---|---|---|---|
| **F01** | "Copy to clipboard" in Export ▾ dropdowns (Dashboard/Batch/Preview) — CSV/MD/JSON, plan-gated same as file download | `src/lib/utils.js` (new `copyToClipboard` + `buildClipboardPayload`) | 11 in `utils.clipboard.test.js` |
| **F13** | Tier × feature comparison matrix on `/pricing` (15 rows under Usage/Exports/Power/Team/Data, sticky first col, current-plan highlight, CTA footer) | `PricingMatrix.jsx` | 10 |
| **F14** | 3-pill trust strip on Home (Encrypted in transit / Auto-deleted in 30 days / Never used to train AI), each linked to `/privacy` | `TrustStrip.jsx` | 4 |
| **FA3** | Task-aware paywall + annual anchoring — `paywallCopy.js` recommends the plan that completes the current task; wired into `UsageUpsellBanner` (Shell ≥80%) and `GuestTrialModal` (hard block); CTA defaults to annual | `paywallCopy.js` | 13 |
| **F07 rename** | `ScrapeSimilarCard` → `ExtractSimilarCard` (file + CSS class + label) to match the council wording | (rename) | 0 (existing tests) |
| **F10** | Real mod+K command palette (7 actions, fuzzy filter, ↑↓ Enter Esc) — replaces the misleading "mod+k (future)" line in HotkeyHelp | `CommandPalette.jsx` | 13 |
| **F15** | "12 extraction modes" tour step (new step 3 enumerating 6 outcome tiles + 5 quick actions + 1 custom). Tour is now 7 steps | `onboardingTour.js` | (count-update tweaks) |

**Files added (8):** `TrustStrip.{jsx,test.jsx}`, `PricingMatrix.{jsx,test.jsx}`, `CommandPalette.{jsx,test.jsx}`, `paywallCopy.{js,test.js}`, `utils.clipboard.test.js` (1 util). **Modified (15):** `App.jsx`, `Home.jsx`, `Pricing.jsx`, `Dashboard/Batch/Preview.jsx`, `UsageUpsellBanner/GuestTrialModal.jsx`, `HotkeyHelp.jsx`, `onboardingTour.js`, `Icon.jsx` (4 new icons), `utils.js`, `screens.css`. **Renamed (2):** `ScrapeSimilarCard*` → `ExtractSimilarCard*`. **New doc:** `docs/SESSION-HANDOFF-2026-07-18-COUNCIL-FEATURES.md`.

**Architectural patterns added:**
- `paywallCopy.js` is the single source of truth for paywall messaging. Two helpers: `pickRecommendedPlan(ctx)` and `buildPaywallCopy({route, usage, currentPlan, ctx, currency})`. Always show `$X/mo, billed annually` in the CTA, never `$X/mo` alone. Annual anchoring is a v1.0 behavior change that v1.0's one-time Razorpay Orders can still honor (recurring billing is deferred to v2.0).
- For mod+K palettes: keep `fuzzyScore(query, text)` and `filterActions(actions, query)` as separate pure functions exported from the component file. Keyboard nav through a single `useEffect` with the right deps so highlight resets when filter changes.
- For Export-style dropdowns with section dividers: use `.export-dropdown-section` + `.export-dropdown-section-label` (added to screens.css). Cleaner than separate menus when actions are tightly related.
- For PricingMatrix-style tables: sticky first column (`position: sticky; left: 0`) + sticky header + `min-width: 720px` on a horizontal-scroll wrapper.

**Caveats documented in the handoff:**
- The trust strip says "Auto-deleted in 30 days" — the message is honest but the actual Supabase cron is v2.0 work.
- "Annual anchoring" commits to a flow that v1.0 one-time Razorpay Orders can still serve — the discount stack just doesn't kick in for v1.0.

---

### R14 — Merged to main (2026-06-15)

#### Firecrawl fallback chain (`claude/firecrawl-fallback-analysis-qyksr4` — merged)
- [x] ~~Merge to main~~ — done
- [ ] **Optional Netlify env vars** to activate fallback providers (no redeploy needed for server-only vars):
  - `SPIDER_API_KEY` — Spider.cloud API key (scrape + crawl/map)
  - `JINA_API_KEY` — Jina AI Reader API key (higher rate limits; works without key too)
  - `SCRAPE_PROVIDER_ORDER` — optional override, e.g. `spider,jina,direct` (default: firecrawl,spider,jina,direct)
  - `VITE_ENABLE_EXTRACT=true` — **build-time** flag; set in Netlify env + trigger redeploy to enable real extraction in browser without a Firecrawl key (e.g. when only using Jina/Direct)
  - `VITE_SPIDER_API_KEY` — **build-time** flag (tells browser real extraction is available); same value as `SPIDER_API_KEY`
  - `VITE_JINA_API_KEY` — **build-time** flag; same value as `JINA_API_KEY`

**Files changed:**
- `netlify/functions/lib/scrapeProviders.js` (NEW) — 4-provider chain: Firecrawl → Spider.cloud → Jina AI → Direct fetch
- `netlify/functions/extract.js` — rewritten to use `runScrapeChain` / `runMapChain`; response shape unchanged (backward-compatible with `firecrawlService.js`)
- `src/lib/config.js` — `hasFirecrawl` now true when any provider key is set or `VITE_ENABLE_EXTRACT=true`

**Architecture rules added:**
- Never add a second hardcoded scrape provider to `extract.js` — add it to `scrapeProviders.js` `SCRAPE_PROVIDERS` registry instead
- Chain order is runtime-configurable via `SCRAPE_PROVIDER_ORDER` env var — no code change needed to reorder or disable providers
- `_providerAttempts` field in all extract responses shows which providers were tried and why each failed (diagnostic; not displayed in UI)
- Jina AI and Direct fetch require no paid API key — extraction always works in production even without Firecrawl/Spider keys

#### Home UX + batch history (`home-screen-enhancement` — merged)
- [x] ~~Merge to main~~ — done
- [x] ~~New Netlify Function `og-preview.js`~~ — merged (`netlify/functions/og-preview.js`; GET `/api/og-preview?url=`; no env vars needed)

**Files changed (R14b + R15):**
- `netlify/functions/og-preview.js` (NEW) — server-side OG metadata fetcher (avoids CORS), reads first 15KB only, 5-min CDN cache
- `src/pages/Home.jsx` — 5 intent chips replace 4 toggles; 800ms OG preview card; clickable feature cards; FAB "Bulk import" navigates to /batch (no inline textarea, no BulkUploadModal on Home)
- `src/pages/Batch.jsx` — intent chips; batch run history via `batchRunsService.js`; textarea draft persisted to `datiq.batchDraft`; unified Export ▾ dropdown replacing 4 buttons
- `src/pages/Dashboard.jsx` — `BatchRunsDropdown` filter (left-aligned dropdown), `batch-item-tag` chips, `batchFilter` state
- `src/components/BulkUploadModal.jsx` (NEW, exists in codebase but NOT used on Home) — paste URLs + CSV upload modal
- `src/lib/batchRunsService.js` (NEW) — localStorage batch run history (`datiq.batchRuns` + `datiq.batchMap`)
- `src/styles/screens.css` — new CSS for all new components; `.batch-runs-menu` left-aligned; `.home-input-fab` with label styling

---

### Supabase (manual — Supabase dashboard)
- [ ] Run SQL migration above in SQL Editor
- [ ] Run `scripts/ai-config.sql` (creates `app_config` for the AI provider chain)
- [ ] Add at least one AI provider key to Netlify env: `GEMINI_API_KEY` (primary), `AI_API_KEY` (Claude), and/or `OPENAI_API_KEY` — no VITE_ prefix; redeploy
- [ ] Enable Google / Microsoft (Azure) / GitHub OAuth providers
- [ ] Set Site URL → `https://datiq.app`; add redirect URLs including `https://datiq.app/**`
- [ ] Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` to Netlify env for stats.js

### Netlify (manual — Netlify dashboard)
- [ ] **Set a strong admin PIN**: add `ADMIN_PIN_HASH` (server, no VITE_ prefix) = `printf '%s' 'your-strong-pin' | shasum -a 256` → redeploy. Until set, `/admin` accepts the demo PIN `ADMIN123`.
- [ ] (optional) Add `ADMIN_TOKEN_SECRET` (server) — random string to sign admin session tokens; defaults to the PIN hash if unset.
- [ ] Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (server) — also enables operator `pricing_config` overrides for live charges (else server uses static price table).
- [ ] Add `VITE_RAZORPAY_KEY_ID` (browser/build-time) — from Razorpay Dashboard → Settings → API Keys
- [ ] Add `RAZORPAY_KEY_ID` (server, no VITE_ prefix) — same value as above
- [ ] Add `RAZORPAY_KEY_SECRET` (server, no VITE_ prefix) — from same Razorpay API Keys page
- [ ] **Trigger a full redeploy** after adding the above — `VITE_RAZORPAY_KEY_ID` is baked at build time
- [ ] Register Razorpay webhook → `https://datiq.app/.netlify/functions/payment-webhook?provider=razorpay` → copy secret → add as `RAZORPAY_WEBHOOK_SECRET` → redeploy
- [ ] **Enable auto-capture** in Razorpay Dashboard → Settings → Payment Capture (belt-and-suspenders; `verify-payment.js` also explicitly captures any `authorized` payment so uncaptured payments are never auto-refunded)
- [ ] Register Stripe webhook (when USD/Stripe is enabled) → same base URL without `?provider` → `STRIPE_WEBHOOK_SECRET`
- [ ] Add remaining env vars when ready (see env section above)

### Razorpay hardening (Razorpay-Integration-Enhancement branch)
> Per Razorpay Standard Checkout guide. One-time Orders model (no Subscriptions). Razorpay/INR only.
- **Server shared source of truth** (`netlify/functions/lib/pricingSource.js`): prices, coupons, and the global discount all resolve through `loadPricing()`. Resolution order — **operator overrides PREVAIL, static is the fallback**: (1) static tables in `pricingSource.js` (mirror `pricingConfig.js` + `adminService.js` seeds); (2) operator overrides in the Supabase `pricing_config` table (rows keyed `plans` / `bundles` / `coupons` / `global`, each a jsonb value). Merge is per-field. Result cached 60s per warm container. If Supabase is unconfigured/unreachable → static tables (so "static as start" always holds). **No public write endpoint** (operator-managed by design — these values drive real charges); `pricing_config` is RLS-locked to the service key. `verify-payment.js` does NOT recompute (compares against the Razorpay order), so `create-checkout.js` is the only consumer.
- **Server-authoritative amounts**: `create-checkout.js` recomputes base + 18% GST (INR) from `loadPricing()` and IGNORES any client `amount` — prevents amount tampering. Admin price edits (incl. new INR + annual fields) now reach live charges via `pricing_config`.
- **Server-authoritative discounts** (closes the prior coupon leak): the client sends a `couponCode` (not a `discountPercent`). `create-checkout.js` resolves the discount via `resolveDiscountFraction(pricing, couponCode, planId)` = **max(coupon, global sale)** — the two never stack, and the result is always ≤ the UI's displayed (global-only) price, so a customer is never charged MORE than shown. Coupon checks: active/expiry/plan-match; unknown/expired/mismatched → 0. A tampered client can't dictate its own discount. Threaded through `paymentService.js` (Stripe + Razorpay) and `BillingProvider.jsx` (sends `subscription.coupon?.code`); `subscription.discountPercent` survives only as a client-side display hint.
- **Admin pricing UI** (`AdminPricing.jsx`): plan editor now has USD-monthly, USD-annual, INR-monthly, INR-annual fields (+ bundle INR); `pricingOverrides.js` merges all of them. A **"Generate SQL"** panel emits the exact `insert … on conflict … do update` for `pricing_config` so the operator applies admin edits to live charges with one paste (the operator-managed write path — no insecure endpoint).
- **Coupon `maxUses` + one-per-user are server-enforced** (atomic): `create-checkout.js` calls `reserveCoupon()` → Supabase `redeem_coupon` RPC, which claims a per-user slot (unique `coupon_code,session_id`) and increments a row-locked `coupon_counters` cap. `ok` applies the coupon; `already_redeemed`/`cap_reached` drops it (global sale still applies, never an over-discount); `null` (no Supabase / RPC error) falls back to applying the coupon unenforced so payments never hard-fail. Reservation happens at order-creation, so the discount + redemption are atomic. **Trade-off:** an abandoned discounted checkout consumes a slot — cleanup of stale unpaid reservations (e.g. set `order_ref`, reconcile against captured payments / TTL-expire) is a follow-up.
- Caveats (documented): display modals (`PaymentConfirmModal`/`pricingMath.computeCharge`) don't subtract the discount (server charges ≤ displayed); the `pricing_config`/`coupons` config is operator-edited (admin UI edits localStorage for display + emits SQL — they don't auto-propagate to the server).
- **Capture + status verification**: after the mandatory HMAC signature check (§1.5), `verify-payment.js` fetches the payment + order, confirms `order_id` + amount/currency match, captures if `authorized`, and only returns `verified:true` on `captured` (§1.6/§3.2).
- **Persistence (§1.4)**: `razorpay_payment_id` → `payment_events.provider_event_id`; `razorpay_order_id` → `subscriptions.provider_subscription_id` (synchronous path + webhook). Signature is verified then discarded (not persisted — acceptable).
- **Webhook idempotency**: `payment_events` deduped on `provider_event_id`.
- **Shared GST math**: `src/lib/pricingMath.js` (`computeCharge`) used by `PaymentConfirmModal` for display; server mirrors the same one-step rounding (no drift).
- `PaymentSuccess.jsx` Razorpay branch is display-only — never grants a plan (verification/activation happen in the modal handler).

### Payment provider (before going live)
- [ ] **Recurring subscription billing DEFERRED to v2.0** — see [`docs/RECURRING-BILLING-DEFERRAL.md`](docs/RECURRING-BILLING-DEFERRAL.md). DatIQ v1.0 ships the 4 paid tiers (Select / Pro / Business / Agency) + Batch Pack bundles with **Razorpay one-time Orders** only. Recurring billing (Razorpay Subscriptions, Stripe Subscriptions) is deferred to v2.0. All subscription webhook handlers and `billingPeriod` plumbing are preserved.
- [ ] **Stripe: DEFERRED to v2.0** — see [`docs/STRIPE-DEFERRAL.md`](docs/STRIPE-DEFERRAL.md). DatIQ v1.0 ships Razorpay/INR only; Stripe code is preserved (25 contract tests cover the full path) but disabled. Re-enable by setting `DATIQ_ENABLE_STRIPE=1` in `.env` and running `scripts/setup-providers.sh`.

### Future development
- [x] ~~Full DatIQ rename: migrate `scrapelite.*` localStorage keys to `datiq.*`~~ — DONE via migrationService.js
- [x] ~~Full DatIQ rename: update Terms/Privacy legal text~~ — DONE (all ScrapeLite refs removed)
- [x] ~~Move `VITE_AI_API_KEY` to server-only via Netlify Function~~ — DONE (R4: `hasAI = true`, key is `AI_API_KEY` in Netlify env only)
- [x] ~~Add /contact page~~ — DONE (R4)
- [x] ~~Add /use-cases hub~~ — DONE (R4)
- [x] ~~Fix dead URLs (/docs, /compare)~~ — DONE (R4: /docs → window.location redirect, /compare → Navigate)
- [ ] **Stripe**: DEFERRED to v2.0 — see [`docs/STRIPE-DEFERRAL.md`](docs/STRIPE-DEFERRAL.md). All Stripe code paths are contract-tested (55 tests in `netlify/__tests__/{create-checkout,verify-payment,payment-webhook}.test.js`); flip the switch in v2.0 with `DATIQ_ENABLE_STRIPE=1` + the 6-step re-enable runbook in `docs/STRIPE-DEFERRAL.md`. When reactivated: update Agency plan Price IDs (plan changed $199 → $299); set `VITE_STRIPE_PRICE_AGENCY`.
- [ ] **Razorpay**: update Agency plan Plan IDs to match new ₹14,999/mo price
- [ ] Add `NETLIFY_AUTH_TOKEN` to session env for programmatic deploys from Claude (branch deploys auto-trigger via GitHub integration when not set)
- [x] ~~Implement once-only 25-extraction trial credit at signup~~ — DONE (FR-Z-02, M5): `applyTrialCredit("free")` called from `AuthProvider.jsx:51` on `SIGNED_IN`; idempotent; covered by `usageService.test.js` "FR-Z-02" suite (Free → grants 25 once, no-ops on re-run, no-op on non-Free plans, concurrent-call race)
- [ ] Referral/affiliate program — teaser UI is live on /pricing; backend not implemented
- [ ] Supabase real auth → replace localStorage persona/session for cross-device sync
- [ ] Switch webhook to production n8n URL
- [ ] Add "Use cases" links to Footer Explore column
- [x] ~~AdminPricing.jsx: add UI fields for `price_usd_annual` and `price_inr_annual`~~ — DONE (R18, `76bc06f`): both fields in plan editor with $-prefix + ₹-prefix + GST hint; collapsed header shows both USD and INR monthly
- [ ] `/blog/:slug` routing for SEO-indexed posts (currently all content is in-page modal only)
- [x] ~~`PaymentConfirmModal` — wire actual `initiatePayment` call through the confirm step in `BillingProvider`~~ — DONE (R11+R13): `BillingProvider.jsx:125` `initiatePayment()` opens the confirm modal first via `confirmResolveRef`; on confirm → reads `confirmedPlanId` + `confirmedCoupon` and proceeds to real payment; on cancel → returns `{status:"cancelled"}`
- [x] ~~Batch/multi-URL mode (10–500 URLs)~~ — DONE (R5: /batch page, batchService.js, plan limits, Batch Pack bundle)
- [x] ~~CSV-import enrichment~~ — DONE (R5: Batch page "Import CSV" tab, parseUrlsFromCsv in batchService.js)
- [x] ~~Markdown export~~ — DONE (R5: markdownDownload(), extractionsToMarkdown() in utils.js; Select+ plan)
- [x] ~~JSON export~~ — DONE (R5: jsonDownload(), extractionsToJson() in utils.js; Pro+ plan)
- [x] ~~Batch mode integrated on Home Extract screen~~ — DONE (R6: batch toggle, multi-URL textarea, inline progress+results, CSV/PDF/MD/JSON export)
- [x] ~~Remove demo data from Dashboard~~ — DONE (R6: showingDemo always false; proper empty state with "Extract a page" CTA)
- [x] ~~Feature card Popular/Recommended tags not visible~~ — DONE (R6: restructured .feature-cell with .feature-body + .feature-title-row)
- [x] ~~`/batch` page: save successful batch results to Dashboard~~ — DONE (R6c: Promise.allSettled saveExtraction after runBatch)
- [x] ~~Home batch mode: save batch results to Dashboard on completion~~ — DONE (R6c: same pattern in handleBatchExtract)
- [x] ~~AdminPricing.jsx: add UI field for `batch_max_urls` per plan~~ — DONE (R7: numeric input step=50, saved to limits.batch_max_urls)
- [x] ~~Batch Pack top-up: wire purchase flow through payment~~ — DONE (R7: purchaseBatchPack() in BillingProvider; Pricing.jsx handleBundleBuy wired; demo_mode grants bonusBatchUrls locally)
- [x] ~~Set `AI_MODEL=claude-3-5-haiku-20241022` in Netlify env vars~~ — DONE in code (R7: DEFAULT_MODEL in ai.js is now the stable model; still set env var in Netlify dashboard for explicit override)

---

## How to continue developing

```bash
cd /home/user/scrapelite
git checkout main
git pull origin main
npm run dev   # http://localhost:5173
```

**Quick smoke tests:**
- `/` → accessible without onboarding (no redirect to /onboarding)
- `/dashboard` → accessible without onboarding
- `/onboarding` → shows TopBar + Footer (part of Shell); pick a persona → lands on `/`
- TopBar (not logged in) → shows "Sign in" (ghost) + "Sign up" (primary) buttons
- TopBar "Sign in" → opens modal on Sign in tab; "Sign up" → opens modal on Create account tab
- TopBar (logged in) → shows UserDropdown with Account & Usage, Switch Role, Sign out
- `/pricing` → default shows **Annual** billing toggle selected; "Save 20%" badge visible
- `/pricing` → switch to Monthly; prices update; Annual toggle reverts to lower prices
- `/pricing` → currency auto-detected (INR for India timezone, USD default)
- `/pricing` → INR annual note below plans: "Promotional INR price. Billed annually…"
- `/pricing` → Developer card shows "Coming soon" badge + disabled "Notify me" button
- `/pricing` → Enterprise card has dashed border; "Contact sales" → mailto link
- `/pricing` → select paid plan → spinner → demo_mode → `/account` shows upgraded plan
- `/payment/success?plan=pro&provider=razorpay` → success state
- `/payment/cancel?plan=pro` → "No charge was made"
- `/contact` → form with 5 type buttons; email + message required; on submit → mailto opens + success state
- `/contact` → sidebar shows 3 info cards: Email us, Response times, Self-service resources
- `/use-cases` → 4 cards (Lead Gen, Competitor Research, SEO Audit, Market Research) with highlights
- `/use-cases` → clicking "Explore X" navigates to the correct `/use-cases/slug` page
- `/docs` → browser navigates to `/help/index.html` (full page load, not SPA nav)
- `/compare` → redirects to `/vs/browse-ai`
- `/admin` → PIN (server-verified; `ADMIN123` in demo/dev) → Revenue / Pricing / Coupons / Users
- `/admin` → 5 wrong PINs → "Locked for 60s" countdown disables the form; auto-unlocks after 60s
- `/admin` → with `ADMIN_PIN_HASH` set in Netlify, `ADMIN123` is rejected (only the configured PIN works)
- Admin sidebar → chevron button collapses sidebar to 64px icon-only strip; chevron expands it back
- Admin sidebar → pin button (pin/pin-off icon) locks state; when unpinned+collapsed, hovering sidebar temporarily expands it
- Admin sidebar → state persists across page reloads (localStorage)
- `/account` → enter coupon `LAUNCH20` → Apply; then × to remove
- TopBar → Sign in → create account → persona step appears → select persona → lands on `/`
- TopBar brand → shows `layers` icon + "DatIQ" + "Intelligence from every URL" tagline
- TopBar nav (desktop >820px) → Extract, Batch, Dashboard all show text+icon; Explore dropdown shows
- TopBar Explore dropdown → 6 sections: Company (About DatIQ), Pricing (Plans & Pricing + Integrations), Use Cases (4), Compare (2), Resources (Blog + Help Center), Contact (Contact Us + Submit Bug)
- TopBar Explore → Contact section (bottom) → "Contact Us" navigates to /contact; "Submit Bug" navigates to /contact?type=bug
- `/contact?type=bug` → Contact page opens with "Bug report" type pre-selected and subject pre-filled "Bug report: "
- `/admin/users` → Plan pill displays correct plan name using effective plan overrides
- TopBar UserDropdown → persona colour dot + name; hover shows profile card + Account/Switch Role/Sign out
- TopBar (mobile <600px) → hamburger button visible; tap to open slide-down nav panel
- Mobile nav → Extract/Dashboard/Pricing links; Explore accordion expands; persona info shown
- `/about` → founder block visible (Vikash Karuna, role, bio, LinkedIn link)
- `/about` → hero text does NOT say "DatIQ (powered by DatIQ)" — should read "DatIQ is a zero-code…"
- `/blog` → clicking any article card opens in-page PostModal overlay with full content
- `/blog` → PostModal has close button + "Back to blog" footer link
- `/blog` newsletter → enter email → "You're subscribed!" (localStorage + n8n webhook)
- `/integrations` → 12 cards; "Notify me" on coming-soon shows toast
- `/privacy` → page URL reads `https://datiq.app` (not scrapelite.netlify.app)
- `/privacy` → DPDP Act 2023 section present with Grievance Officer contact details
- `/terms` → governing law section says "India" + "Arbitration and Conciliation Act, 1996" + "Bengaluru"
- `/use-cases/lead-generation` → content left/right edges align with TopBar and Footer
- `/vs/clay` → CTA says "from $19/month"; Agency row removed; API access → "Business plan ($79/mo)"
- Home social proof → section hidden when stats are null OR both teams<10 AND extractions<100
- Home social proof → visible when Supabase returns real numbers above thresholds
- Footer → slim single row: LinkedIn + Twitter socials | copyright | Privacy · Terms links
- Home → persona chips above URL input (click to populate search box)
- Home → scrape toggles in 2-column grid; each toggle has hover tooltip
- favicon → layered-diamond indigo SVG visible in browser tab
- Usage upsell banner → appears between TopBar and page content when extraction usage ≥80%
- Usage upsell banner → dismiss button hides it; re-appears next calendar month
- Home → URL input + Extract button + FAB "Bulk import" button; NO inline multi-URL toggle or textarea
- Home → no "Try lumio.io / stripe.com..." chips below URL input; only validation error shown
- TopBar nav order: Extract → Batch → Dashboard (Batch is before Dashboard)
- Home → extract URL → auto-saves to DB → /preview shows "View Dashboard" (primary) + "Download ▾" + "Delete"
- `/preview` → "Download ▾" dropdown in action bar → shows CSV / PDF / Markdown / JSON options
- `/preview` → "Generate content" button in Quick Enrichment card header → opens ContentModal with 3 format options
- `/preview` → "View Dashboard" navigates to /dashboard; "Delete" removes extraction and goes home
- `/batch` → paste 2+ URLs → Run → progress → results table with "View" button per row
- `/batch` → click "View" on a result → navigates to /preview showing that extraction
- `/batch` → batch complete → toast "N pages saved to Dashboard" fires automatically (items saved with _status stripped)
- `/dashboard` → loads instantly from localStorage cache (no spinner if local data exists); API sync happens in background
- `/dashboard` → "Refresh" ghost button in header → re-fetches from DB, shows "Refreshed" toast
- `/dashboard` → export buttons: single "Export ▾" dropdown shows CSV / PDF / MD / JSON; dropdown appears above table (z-index fix)
- `/dashboard` → check any row → toolbar shows: count + Generate + Email + Clear inline; floating bar also appears at bottom
- `/dashboard` → toolbar "Generate" (inline) → ContentModal with SEO Blog Outline / Competitor Summary / Social Posts
- `/dashboard` → toolbar "Email" (inline) → EmailModal (no "Failed to fetch" error; falls back to mailto if webhook down)
- `/dashboard` → floating bar "Export ▾" → dropdown with CSV/PDF/MD/JSON options
- `/dashboard` → empty state shows bookmark icon + "Nothing saved yet" + "Extract a page" CTA (no demo data)
- `/dashboard` → after extraction: saved pages appear in table/card view
- `/dashboard` → PDF export → if app was updated since page loaded, toast "App updated — refresh and try again"
- Home feature cards → Popular tag visible next to title (inline, not pushed off); Recommended tag visible when persona matched
- `/admin/pricing` → open any plan card → "Batch URL limit" field visible; enter 100 → Save → value persists across refresh
- `/pricing` → Top-up bundles section → "Add to plan" on Batch Pack → opens TopupBundleModal (not direct purchase)
- TopupBundleModal → qty 1 shows unit price; qty 2+ shows total + per-bundle note; CTA "Add N bundle(s) — ₹/$ X"
- TopupBundleModal → "−" button disabled when qty=1; "+" button disabled when qty=10
- TopupBundleModal → upsell section shows plans with higher price_usd than current plan
- TopupBundleModal → click upsell plan → modal closes → payment flow starts for that plan
- TopupBundleModal → backdrop click (outside card) → modal closes
- TopupBundleModal → in demo mode: modal closes, navigates to /account, bonusBatchUrls += 50 × qty
- `/pricing` → click "Get Pro" (no payment keys): DemoPaymentModal appears with plan name, price, greyed-out card fields, "Demo mode" badge
- DemoPaymentModal → "Confirm — activate Pro (Demo)": plan upgrades, navigates to /account
- DemoPaymentModal → "Cancel, keep current plan" or backdrop click: modal closes, plan unchanged
- `/pricing` → plan cards: hovering non-current plans shows lift+border+tint effect
- `/pricing` → current plan card: green ring border + "Your plan" badge pill at top
- `/pricing` → click "Get Pro" (or any paid plan): button shows "Processing…" + card pulses with accent ring during payment
- `/pricing` → cancel Razorpay/Stripe payment: plan stays at previous value (NOT upgraded)
- `/pricing` → new user with no plan: only Free plan has "Current plan" badge; all paid plans show "Get X"
- `/account` → after buying Batch Pack: bonusBatchUrls shows on subscription state
- `/account` quick stats → "Batch executions" row visible; "Content generations" row visible (both default 0)
- `/batch` → run batch → completion increments "Batch executions" counter in account stats
- `/preview` or `/dashboard` → Generate content → completion increments "Content generations" counter
- TopBar Explore dropdown → Compare section has only "Compare Tools" (no Browse.ai / Clay separate links)
- TopBar Explore dropdown → Contact section has only "Contact Us" (no "Submit Bug")
- TopBar Explore dropdown → last section is "Company" containing "About DatIQ"
- `/vs/compare.html` → hero quick-links shows all 4 comparison pages at top
- `/vs/compare.html` → bottom section lists all 4 detailed pages (Browse.ai, Clay, Apify, PhantomBuster)
- `/vs/apify.html` → loads DatIQ vs Apify comparison page with feature table
- `/vs/phantombuster.html` → loads DatIQ vs PhantomBuster comparison page
- `/pricing` → all 7 plan cards visible: Free, Select, Pro, Business, Agency, Developer (coming soon), Enterprise
- `/pricing` → Enterprise card has dashed border and "Contact sales" CTA
- `/pricing` → TopupBundleModal upsell plans show INR prices (₹999/mo, ₹1,499/mo) when INR currency selected
- `/batch` results → table uses full container width (not capped at 860px)
- Usage upsell banner (when ≥80% used) → content aligns to 1080px page width, not full browser width
- `/help/index.html` → User Guide section has no "(External)" label
- `/help/index.html` → no "Internal Reference" sidebar section
- `/help/09-exports-and-sharing.html` → lists all 5 formats: CSV, PDF, Markdown, JSON, Email
- Home → 5 intent chips row visible below URL input: AI summary / Find contacts / Scrape pricing / Map site / Custom
- Home → clicking an intent chip selects it (active border); switching away from Custom clears custom prompt
- Home → clicking a feature card scrolls to and selects the matching intent chip
- Home → FAB button ("Bulk import" label + layers-2 icon) beside Extract button → navigates to /batch page
- Home → NO inline multi-URL textarea on Home; no BulkUploadModal on Home; multi-URL entry is handled entirely on /batch
- Home → single URL with valid domain → after 800ms, OG preview card appears below URL input with favicon + title + description
- Home → OG preview card disappears when URL is cleared or invalid
- `/batch` → intent chips visible (AI summary / Find contacts / Scrape pricing / Custom ← no Map Site)
- `/batch` → paste URLs → navigate away → navigate back → textarea retains the URLs (localStorage draft)
- `/batch` → "New batch" button clears the textarea and the localStorage draft
- `/batch` results → single "Export ▾" dropdown (CSV / PDF / Markdown / JSON) — not 4 separate buttons
- `/batch` → run batch → "View in Dashboard →" button appears after results
- `/dashboard` → batch run dropdown button visible in header (shows count badge when runs exist)
- `/dashboard` → click batch runs dropdown → menu opens LEFT-aligned (not overflowing off left side of screen)
- `/dashboard` → click dropdown → shows past batch runs with label + date + URL count; click to filter; × to delete
- `/dashboard` → filtered state shows `batch-filter-banner` with run label + "Clear filter" button
- `/dashboard` → items from a batch run show "Batch" tag chip in table row and card view
- Extraction on any provider fallback → `_providerAttempts` present in response (visible in network tab)
- Home → extract as guest → after 3 extractions, GuestTrialModal soft prompt appears with "Sign up free" CTA
- Home → soft prompt → "Continue as guest" dismisses it; attempting 2 more extractions re-shows it
- Home → extract as guest → after 10 extractions, hard block modal appears — no dismiss button, no backdrop click, no Escape
- Home → hard block → only "Sign up free" or "Sign in" buttons work; page behind not clickable
- `/batch` → run batch as guest → after 5 batch runs, hard block modal appears (reason: "batch")
- GuestTrialBanner → shows between TopBar and page content for guest users
- GuestTrialBanner → correctly shows remaining single-URL credits AND batch credits
- GuestTrialBanner → disappears when user is logged in
- Guest extraction → sign in → GuestTrialBanner disappears; soft/hard prompt clears
- Sign out (previously had extractions) → localStorage cleared (dashboard shows nothing); navigates to "/"
- Sign out → re-open app on same machine → guest trial count is preserved (not cleared); banner shows remaining credits
- `/admin/general` → accessible after admin PIN; shows 4 configurable fields with current values
- `/admin/general` → change soft limit to 5, save → toast "General settings saved" → limit takes effect within 5 min
- `/admin/general` → "Reset to defaults" → fields reset to 3 / 2 / 10 / 5
- `/admin/general` → "Reload" button → re-fetches from server and updates form
- `/admin/general` → without Supabase configured: shows warning banner; fields still load with defaults; changes are not persisted server-side
- `/admin/pricing` → USD Pricing section: $-prefix inputs for monthly + annual prices; INR Pricing section: ₹-prefix inputs + GST hint below each (e.g. "≈ ₹1,180 incl. GST")
- `/admin/pricing` → collapsed plan card header shows both $X/mo and ₹Y/mo when INR price is set
- `/admin/revenue` → shows live KPI cards (MRR, ARR, total/paying/free/new users, coupon usage) — NOT dummy data
- `/admin/revenue` → 6-month revenue chart shows actual captured payment amounts (from payment_events table)
- `/admin/revenue` → "from seed data" warning banner shown when Supabase not configured
- `/admin/revenue` → Refresh button re-fetches live data from Supabase
- `/admin/users` → table shows real users from Supabase Auth (not dummy seed names)
- `/admin/users` → "Plan period" column shows subscription start → end dates (or "—" when no paid plan)
- `/admin/users` → "Coupon" column shows amber pill with code + optional "−X%" discount badge
- `/admin/users` → "Extractions/mo" column shows current month extractions (0 shown explicitly, not "—")
- `/admin/users` → tag icon per row opens CouponModal: dropdown shows only `planId='manual'` active coupons
- `/admin/users` CouponModal → selecting a coupon shows detail strip (type, value, expiry); for % type: discount % override field; preview row shows how it appears
- `/admin/users` CouponModal → "Assign" saves to auth metadata + persists in coupon_redemptions; navigating away and back still shows the coupon in the table row
- `/admin/coupons` → "Restrict to plan" dropdown has "Manually Assigned To User(s)" option at bottom
- `/admin/coupons` → saving a coupon with planId='manual' shows purple "Manual assign" pill in Plan column
- `/admin/coupons` → coupon with planId='manual': users cannot self-apply it (Account page Apply Coupon returns error "This coupon is for admin assignment only")

---

## Git log (recent)

```
e1fa0e0  Merge branch 'fix/migrate-prod-fresh-db' into main
5ca1345  chore(netlify): add per-context env blocks + protect env files
82ee415  ci: phase-gate end-to-end test
47631dc  ci: add phase-gate production deploy workflow
35ed90a  fix(migrations): make 0001 self-contained for fresh DBs
a57cde5  fix(scripts): use node pg instead of psql for migrate-prod
af9904c  docs: add Firebase and Netlify multi-environment migration plans
06a5b96  Merge branch 'feat/council-followup' into main
6b46cfc  feat(council-followup): F01 clipboard, F13 pricing matrix, F14 trust strip, FA3 task-aware paywall + mod+K palette
405e401  docs(handoff): save session-2026-07-18 — clean v1.0+ state, v2.0 entry point
0333e19  docs: session handoff 2026-07-17 - v1.0+ quick wins merged to main
ea3658a  Merge feat/v1-quickwins: Cloud BI Q1–Q11 + alternate Q1/Q3/Q4/Q5/Q11 — 11 quick wins, 229 new tests, 1029 green
f5cd590  feat(v1-quickwins): Q1/Q3/Q4/Q5/Q11 — tour, demo, feedback, cap, shortcuts
3e28ce6  fix(v1-quickwins): Q8 cross-browser shareable URLs + Q3 multi-select + UX dedup
8cf8dbd  feat(v1-quickwins): Cloud BI Q1-Q11 - 11 quick wins, 139 new tests, 939 green
5eedb74  docs(handoff): save session-2026-07-17 state for next session (3 rounds of Quick Wins)
72dc612  feat(v1-quickwins): Groke AI quick wins — tags, collections, batch retry
067059f  feat(v1-quickwins): MetaAI + DeepSeq quick wins with full test coverage
0ae395b  test(v1.0): regenerate pricing visual snapshots + establish firefox/webkit baselines
```

### Recent build/CI/UX fixes (2026-07-19 late)

```
074abfe  Merge branch 'fix/topbar-single-cta' into main
dc4289d  fix(topbar): collapse Sign in + Sign up to a single primary CTA
92b3af9  Merge branch 'fix/phase-gate-smoke-script' into main
424cea5  fix(ci): add scripts/smoke-prod.mjs that phase-gate depends on
71a2586  Merge branch 'fix/netlify-secrets-scan-omit' into main
abc590c  fix(netlify): add netlify.toml + docs to secrets scan omit list
b8b1e53  Merge branch 'fix/netlify-toml-duplicate-key' into main
bda448e  fix(netlify): remove duplicate VITE_SUPABASE_ANON_KEY in production env
```
