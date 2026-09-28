# 01 — Refreshed Codebase Analysis (as of 2026-09-28)

**Branch audited:** `docker-desktop-build` @ `07e88c72` — byte-identical to `staging`/`origin/staging`;
`main` is ahead only by staging→main merge commits. Working tree clean.
**Method:** full-repo sweep by three parallel research passes (build/config, frontend surfaces, backend/data).

> ⚠️ The root `AGENTS.md` still describes the June-2026 v2.0 app (3 routes, ~10 functions). It is stale and
> should be regenerated in a later docs-only cleanup. This document is the current source of truth.

---

## 1. What DatIQ is today (one paragraph)

A single Vite 8 + React 19 SPA (one bundle, 76 routes in `src/App.jsx`) served from Netlify with 35
committed prerendered HTML routes, a 30-page generated help site, and static SEO pages. The backend is
**75 Netlify Functions** (v1 `export const handler` style, Node 24, esbuild bundler) sharing ~60 modules in
`netlify/functions/lib/`, with **13 scheduled functions** declared in `netlify.toml`. Persistence is hosted
Supabase (GoTrue auth + Postgres, **85 migrations, ~126 tables**, RLS in places but authorization mostly
enforced in function code). Payments are Stripe + Razorpay (raw-body webhook signature verification), email
is Resend, workflow automation is n8n (already self-hosted on Cloud Run `asia-south1`), and there is a public
developer REST API (`api.datiq.app/v1`, api-key auth) used by a Chrome extension. Admin is a **PIN-gated
surface inside the same SPA bundle** (`/admin/*`, 11 screens, 14 server functions).

## 2. Refreshed top-level folder structure

```
Extracta/
├── index.html                    ← the ONLY build entry (single SPA bundle)
├── vite.config.js                ← build + embedded vitest config + 2 custom "netlify-like" dev/preview plugins
├── netlify.toml                  ← 714 lines: 46 redirects, 28 header blocks, 13 cron schedules, CSP
├── netlify.backup.toml           ← pre-cutover backup (gitignored)
├── playwright.config.js / vite.config.test.js
├── src/                          ← ~708 files: React app + client libs + 310 vitest files
│   ├── App.jsx                   ← router; /admin/* gets its own <Routes> branch inside the same bundle
│   ├── pages/ (49) + pages/admin/ (11 screens)
│   └── lib/                      ← apiClient.js (BASE="/api"), config.js, supabaseClient.js, paymentService.js …
├── netlify/
│   ├── functions/                ← 75 function .js + lib/ (~60 shared modules)
│   └── __tests__/                ← 150 contract-test files
├── public/                       ← dist source: 42 committed prerendered index.html, 28 help .html,
│   │                                static /faq /vs/* /dmca, sitemap.xml, robots.txt, llms.txt
│   ├── runtime-config.js         ← ⚠ hostname-keyed env branching + committed anon keys (see §6)
│   └── analytics.js              ← shared GA4/PostHog/Plausible loader + consent bar (see §7)
├── scripts/                      ← 77 files: prerender.mjs, site-routes.mjs (routing source of truth),
│   │                                build-sitemap.mjs, migrate-prod.mjs, db-verify.mjs, smoke-prod.mjs …
├── supabase/migrations/          ← 85 numbered SQL migrations (0001…0085) + rollback.sql + run-all.sql
├── e2e/                          ← 50 Playwright specs (smoke/journeys/a11y/visual)
├── test/                         ← vitest setup (jsdom + a11y + pglite fixtures)
├── n8n/                          ← self-hosted n8n: docker-compose.yml, Caddyfile, 18 workflow JSONs, ops/
├── extensions/datiq-extension/   ← MV3 browser extension (own build → dist-extension/)
├── tools/netlify-cli/            ← committed Netlify CLI used by the prod deploy workflow
├── .github/workflows/            ← staging-gate.yml, phase-gate.yml (Netlify-coupled), codeql.yml
├── docs/                         ← runbooks + sessions (SESSION-LOG.md is the active log)
└── sdlc/quality-gate/            ← gate scripts
```

**Docker status: zero containerization exists for the app.** The only Docker artifact in the repo is
`n8n/docker-compose.yml` (the n8n engine itself, which already runs on Cloud Run).

## 3. Deployable surfaces (the units that get their own Dockerfile)

| # | Surface | Where it lives today | Notes |
|---|---|---|---|
| 1 | **web (public SPA + prerendered + help + SEO assets)** | `dist/` = `index.html` bundle + `public/**` prerendered/static | 76 routes; needs exact Netlify edge semantics (see §5) |
| 2 | **admin** | Same SPA bundle, branch in `App.jsx`; 11 screens + 14 `admin-*` functions | PIN/HMAC token auth (`admin-auth.js` + `lib/adminToken.js`), noindex + no-store headers today |
| 3 | **trackers/config layer** | `public/analytics.js` + `public/runtime-config.js` | Loaded by every page incl. static ones; consent-gated; ~5 KB files but deploy-coupled |
| 4 | **api (75 functions + lib)** | `netlify/functions/` | Invoked same-origin via `/api/*` → `/.netlify/functions/*` redirect |
| 5 | **jobs (13 crons)** | Same functions, triggered by netlify.toml schedules | On Netlify the schedule blocks public HTTP — see §8 security note |
| 6 | **auth (GoTrue) + rest (PostgREST) + db (Postgres)** | Hosted Supabase today | Only `pgcrypto` used — no Storage, no Realtime → fully portable to vanilla PG |
| 7 | **extension** | `extensions/datiq-extension/` → `dist-extension/` | Calls `https://api.datiq.app/v1`; independent of hosting choice |
| — | **n8n** | `n8n/`, live on Cloud Run | Unchanged by this migration; already containerized |

## 4. Backend inventory

- **Style:** all 75 handlers are v1 `export const handler = async (event) => {...}` taking the Netlify event
  envelope (`event.headers`, `event.queryStringParameters`, `event.body` string, path-based splats).
  **No `@netlify/functions` import, no Netlify Blobs, no Netlify Identity, no Edge functions, no
  `clientContext` usage anywhere.** Auth is a plain `Authorization: Bearer <supabase-jwt>` header.
- **Function groups:** extraction core (`extract`, `extractions`, `ai`, `og-preview`, `resolve-company`,
  `guest-usage`, `templates`, `pql`, `api-v1` public API), feature CRUD (schedules, credits, stats, reports,
  watchlists, signal-rules, discoverability, bulk-enrichment, workspaces, workflow-graph, engagement-engine,
  analytics, consent, referral…), 14 admin functions, payments (create-checkout, verify-payment,
  payment-webhook, razorpay-sdk, coupons), 6 integrations functions (HubSpot/Notion/Airtable/Slack/Zapier +
  router), 6 email functions, n8n workflow trio (orchestrator, orchestrator-cron, callback).
- **Netlify-injected env read by functions** (must be supplied by the adapter on Cloud Run):
  `URL` (19 refs), `SITE_URL` (16), `DEPLOY_URL`, `CONTEXT` (5, incl. `isProductionContext()`), `BRANCH` (2),
  `NETLIFY_DEV`. Also two `looksStrippedByNetlify()` secret-scanner-redaction detectors (harmless elsewhere).
- **Lambda-isms:** `lib/responseBudget.js` exists purely for Lambda's 6,291,556-byte sync response cap
  (the 2026-09-25 "502" incident); it becomes a harmless no-op on Cloud Run (32 MB). Timeout budget knobs
  (`WATCHLIST_BUDGET_MS`, `ENGAGEMENT_SEND_BUDGET_MS`, `SIGNAL_RETRY_BUDGET_MS`) are Lambda-tuned — revisit
  values, not code.
- **Cron mapping (13):** hourly: `scheduled-runner`, `health-monitor`, `watchlist-monitor`;
  every 5 min: `bulk-runner`, `engagement-dispatcher`, `signal-retry`, `workflow-orchestrator-cron`,
  `sxo-analytics-import-worker`; daily: `reengagement`, `billing-lifecycle`, `billing-purge`,
  `discoverability-monitor`, `prompt-monitor`.

## 5. Edge/routing model (the most duplicated concern)

Routing behaviour lives in three places and is asserted by tests — a GCP port must reproduce all of them:

1. `netlify.toml` — 46 redirects (24 help-centre 301s, API rewrites `/api/*`→`/.netlify/functions/*` +
   splat rules for `/api/v1|pql|discoverability|integrations/*`, retired-URL 301s, forced `/`→`/home/index.html`
   rewrite, SPA catch-all `/*`→`/index.html` deliberately NOT forced) + 28 header blocks (baseline CSP
   allowing Razorpay/Stripe/GA4/Plausible/PostHog; `/admin` noindex+no-store+DENY; 24 noindex blocks for
   signed-in routes) + 13 cron schedules.
2. `scripts/site-routes.mjs` — `REACT_OWNED (35)`, `STATIC_OWNED (7)`, `HELP_INDEX`, `REDIRECTS (33)`,
   `PRIVATE_PREFIXES (17)`; consumed by prerender + sitemap generators; asserted by
   `scripts/page-ownership.test.mjs`.
3. `vite.config.js` dev/preview plugins replaying the same rules locally.

**Prerender pipeline is host-agnostic:** `scripts/prerender.mjs` (system Chrome via Playwright) writes
committed HTML into `public/<route>/index.html`; `npm run build` runs `sync-prerender-assets.mjs`; CI checks
freshness (`check:prerender`) and a pre-push hook enforces regeneration. No Chromium at deploy time.

## 6. Configuration model (the single most migration-sensitive file)

- **Frontend API access is fully same-origin relative:** `src/lib/apiClient.js` `BASE = "/api"`. Three modules
  bypass it with hardcoded `/.netlify/functions` paths: `src/lib/paymentService.js:13`,
  `src/lib/integrationsClient.js`, `src/lib/adminService.js` (admin-auth only). No absolute API URLs.
- **`public/runtime-config.js`** (committed, runtime-loaded, wins over Vite env for Supabase URL/key) branches
  **on hostname**: `datiq.app | www.datiq.app | main--datiqapp.netlify.app` → prod Supabase
  (`sikkfxysjhirmtwkumpt`, auth domain `api.datiq.app`); `staging--datiqapp` and every other
  `*--datiqapp.netlify.app` branch host → dev Supabase (`aubwooslkkrprdxuiyvj`); **anything else (i.e. any
  future GCP hostname) currently falls into the dev-project bucket.** It also sets `authReturnUrl`
  (prod → `https://datiq.app`, else `location.origin`), `webhookUrl` (n8n cloud), `gaMeasurementId`,
  `consentPolicyVersion`, `isProduction`/`isStaging`.
- **~70 server-side env vars** (functions + scripts): Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SUPABASE_ANON_KEY`), AI providers (`AI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `AI_PROVIDER_ORDER`), scrape chain (`FIRECRAWL_API_KEY`, `SCRAPE_PROVIDER_ORDER`, `JINA_API_KEY`,
  `PERMITTED_HOSTS`), email (`RESEND_API_KEY`, `ENGAGEMENT_RESEND_API_KEY`, 6× `*_EMAIL_FROM`), payments
  (Stripe/Razorpay key+webhook secrets), `INTEGRATION_SECRETS_KEY` (envelope-encrypted provider credentials),
  admin (`ADMIN_TOKEN_SECRET`, `ADMIN_PIN_HASH`, `GUEST_ID_SALT`), n8n (`N8N_BASE_URL`,
  `N8N_WEBHOOK_SECRET`, …), ops knobs (`ENGAGEMENT_ENABLED`, `PURGE_*`, `OPS_ALERT_EMAIL`, `*_BUDGET_MS`).
  All are set per-context in the Netlify UI (no `[context.*]` blocks in the TOML, deliberately).
- Historical hazard worth remembering: the Netlify secret scanner twice redacted the JWT-shaped anon key in
  production; the codebase carries redaction-detection + `SECRETS_SCAN_OMIT_*` mitigations. GCP Secret
  Manager removes this failure mode entirely.

## 7. Trackers & first-party analytics

| Tracker | Gate | Notes |
|---|---|---|
| GA4 (gtag) | Consent Mode v2 (localStorage `datiq.consent`), skipped on `/admin` + localhost + blank `gaMeasurementId` | Loaded via shared `public/analytics.js`; static pages send own `page_view`, SPA via `src/hooks/usePageView.js` |
| PostHog | Same consent gate | **Hardcoded fallback key + `us.i.posthog.com` applies on every env** (no `posthogKey` in runtime-config) — flagged for cleanup |
| Plausible | **None** — not consent-gated; baked into 39 committed static/prerendered HTML files | Fires everywhere incl. `/admin` if landed on directly |

First-party sinks (all part of the API surface, not separate services): product events → `POST /api/analytics`
(`analytics_events` table), activation/PQL → `POST /api/pql/events` (`activation_events`), consent audit →
`/api/consent*`. No email-open pixels. CSP in netlify.toml allow-lists the three third-party origins.

## 8. Security-relevant facts the plan must preserve

1. **Cron endpoints are protected only by Netlify's schedule declaration** (it blocks public HTTP). On Cloud
   Run, all 13 become reachable URLs unless ingress/auth is added — notably `billing-purge` (destructive).
   Plan: Cloud Scheduler with **OIDC ID tokens** + Cloud Run `--no-allow-unauthenticated` for the jobs service.
2. **Raw-body preservation is mandatory** for `payment-webhook.js` (Stripe `constructEvent` on
  `event.body`; Razorpay HMAC over raw body). The HTTP adapter must hand handlers the unparsed body.
3. **Admin demo-mode gates** check `CONTEXT=dev` / `NETLIFY_DEV` — the adapter must map these correctly per
   environment so demo admin never activates in staging/prod.
4. Headers parity (CSP, X-Frame-Options, noindex set) must be reproduced at the new edge.

## 9. CI/CD & tests (current state)

- `staging-gate.yml` (push/PR → staging): readiness, unit, contract, integration, system, build,
  `check:prerender`, Playwright chromium smoke, security suite, then **Netlify-API deploy-convergence
  polling** + artifact verification.
- `phase-gate.yml` (push → main = prod): same suites + "staging released" check + **manual approval via a
  GitHub issue comment** + `netlify deploy --prod` using committed CLI (`tools/netlify-cli/`) +
  `smoke-prod.mjs` with automatic Netlify REST rollback + relock. Netlify auto-publish for main is OFF.
- `codeql.yml`: required by GitHub rulesets.
- **Tests: 477 vitest files** (310 src incl. 52 integration + 9 system; 150 functions contract tests;
  17 scripts) + **50 Playwright specs** (3 browsers; CI runs chromium smoke only). `smoke:prod` /
  `smoke:staging` scripts hit the deployed URLs with `PW_BASE_URL` retargeting — **already usable against any
  GCP URL unchanged.** Contract tests cover cron-registry parity, entitlement enforcement, OpenAPI, n8n
  signatures, payment webhooks.

## 10. Portability scorecard

| Concern | Portability | Why |
|---|---|---|
| Frontend build & SPA | 🟢 trivial | Fully relative `/api`, env-driven Supabase, host-agnostic prerender |
| 75 functions | 🟢 easy with adapter | No Netlify SDK/Blobs/Identity; only the `event` envelope + injected env vars need emulation |
| Database | 🟢 trivial | Vanilla Postgres + pgcrypto only; no Storage/Realtime; RLS travels with the dump |
| Auth users | 🟢 easy at cutover | Self-hosted GoTrue = same `auth` schema; `pg_dump` preserves hashes/OAuth identities |
| Edge/routing/headers | 🟡 porting work | 46 redirects + 28 header rules + forced `/` rewrite + precedence, ×3 implementations to keep in sync |
| Crons | 🟡 porting work + security | 13 schedules → Cloud Scheduler; must add OIDC auth that Netlify gave for free |
| CI/CD | 🟡 rebuild | Both deploy gates are Netlify-API-coupled (convergence polling, unlock/relock, REST rollback) |
| Config/runtime-config.js | 🟠 one real code change | Hostname branching has no GCP entries today |
| Payment/email/n8n webhooks | 🟠 cutover-day checklist | External parties hold our URLs (see impact doc §6) |
