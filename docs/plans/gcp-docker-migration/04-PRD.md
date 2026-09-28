# 04 — Product Requirements Document (PRD v2)

**Date:** 2026-09-28 · **Status:** draft for owner confirmation · **Companion:** BRD v2, Implementation Plan v2

## 1. Product goal

Deliver a deployment architecture where every DatIQ concern is a separately built, separately run container,
the application code is untouched, and the same commit deploys identically to Netlify (today) and GCP
(parallel), with a single final cutover of database, users and domain.

## 2. Design principles

1. **Additive only** — new assets under `deployment/`; product code untouched (except the 6-file compat list).
2. **Adapt, don't rewrite** — the 75 function handlers keep their Netlify `event` envelope via a thin adapter.
3. **One image per concern** — owner requirement: admin, web, trackers, api, jobs each get their own Dockerfile.
4. **Same code, two edges** — env/config determine platform; no fork of the app for GCP.
5. **Routing parity is tested, not hoped for** — gateway rules are generated from/validated against
   `scripts/site-routes.mjs` (the existing routing source of truth).
6. **Two phases only** — Phase 0 local; Phase 1 GCP → parallel → cutover.

## 3. Deployable units & their Dockerfiles (FR-0)

| Unit | Dockerfile | Image contents | Serves |
|---|---|---|---|
| **gateway** | `deployment/docker/gateway/Dockerfile` | nginx + parity configs (redirects, headers, precedence) | local edge on `:8080`; routes to web/admin/trackers/api/auth/rest |
| **web** | `deployment/docker/web/Dockerfile` | nginx serving `dist/` (SPA + prerendered + help + SEO assets + sitemap/robots/llms.txt) | public site & app |
| **admin** | `deployment/docker/admin/Dockerfile` | nginx serving the `/admin/*` slice from the same build output | admin console — independently deployable/restrictable; zero source change (bundle split via Vite multi-entry is a *later optional* optimisation, est. 1–2 days) |
| **trackers** | `deployment/docker/trackers/Dockerfile` | nginx serving `analytics.js`, `runtime-config.js`, consent assets | the tracker/config layer, independent of web releases |
| **api** | `deployment/docker/api/Dockerfile` | Node 24 + adapter server mounting all 75 handlers | `/api/*` (incl. `api-v1`, `pql`, `discoverability`, `integrations` splats) |
| **jobs** | `deployment/docker/jobs/Dockerfile` | same handler code, jobs entrypoint (cron simulator locally; Scheduler target on GCP) | 13 scheduled functions, auth-enforced |
| **auth** | `deployment/docker/auth/Dockerfile` | GoTrue (Supabase auth) | `/auth/v1/*` |
| **rest** | `deployment/docker/rest/Dockerfile` | PostgREST | `/rest/v1/*` |
| **db** | `deployment/docker/db/Dockerfile` | postgres:16 + init SQL (roles, pgcrypto) | local database |
| **migrator** | `deployment/docker/migrator/Dockerfile` | applies `supabase/migrations/` via existing scripts | one-shot job |

> Extension and n8n are not containerised here: the extension ships via its store build; n8n already runs in
> its own container (repo `n8n/docker-compose.yml`, live on Cloud Run).

## 4. Functional requirements

### FR-1 Local runtime (Phase 0)
- `docker compose up` starts: gateway, web, admin, trackers, api, jobs, db, auth, rest, migrator, mailpit
  (email capture); optional profiles: `n8n`, `test` (runs the existing suites against the stack).
- Single entry `http://localhost:8080`; behaviour identical to Netlify (redirects, headers, prerendered
  pages winning over the SPA fallback, forced `/` → `/home/index.html`).
- Two data modes via compose profile:
  - `local-db` (default): db + auth + rest containers, migrations applied by migrator;
  - `shared-db`: point at hosted Supabase (dev or prod project) — same mode the GCP stack uses in Phase 1.

### FR-2 Netlify-compatibility adapter (api)
- Maps `POST/GET/... /api/<name>[/<splat>]` → handler `<name>` with the Netlify event envelope
  (`headers`, `queryStringParameters`, raw `body` string, resolved `path`); returns Netlify-style
  `{statusCode, headers, body}` responses as HTTP.
- **Preserves raw bodies** (Stripe/Razorpay signature verification) and multi-value query semantics.
- Supplies Netlify-injected env equivalents: `URL`/`SITE_URL`/`DEPLOY_URL` → public base URL of the service,
  `CONTEXT` (production/branch-deploy mapping), `BRANCH`, per environment.
- Route manifest mirrors the API redirects in `netlify.toml`; covered by the existing 150 contract tests
  (run against the adapter in the `test` profile).

### FR-3 Database compatibility
- All 85 migrations apply unchanged (vanilla Postgres + pgcrypto only — verified: no Supabase Storage,
  no Realtime anywhere).
- RLS roles (`anon`, `authenticated`, `service_role`) recreated at init; RLS policies travel with dumps.

### FR-4 Auth
- **Parallel window:** hosted Supabase GoTrue as-is (URL/key via env) — no user migration, no divergence.
- **Cutover:** self-hosted GoTrue on Cloud Run against Cloud SQL, same JWT secret, same `auth` schema
  (users, hashes, OAuth identities migrate via dump). PKCE flow and `authReturnUrl` semantics preserved
  (`runtime-config.js` drives it per host).

### FR-5 Edge parity (web/gateway, and Firebase Hosting on GCP)
- Reproduce exactly: 46 redirects (incl. 24 help 301s), 28 header blocks (CSP, `/admin` noindex+no-store+DENY,
  24 noindex blocks), forced `/` rewrite, SPA catch-all ordering (static file → prerender → redirects → SPA),
  `/api/*` and `/auth/v1/*` and `/rest/v1/*` proxying.
- On GCP: Firebase Hosting `firebase.json` (redirects + rewrites + headers) or a Cloud Run gateway —
  Firebase Hosting is the default choice (matches `FIREBASE-MIGRATION.md` direction, supports 301s, rewrites
  to Cloud Run, headers, custom domains).

### FR-6 Jobs & scheduler
- 13 schedules ported 1:1 (hourly ×3, */5 ×5, daily ×5 → see implementation plan table).
- Cloud Scheduler → jobs service with **OIDC ID tokens**; jobs service denies unauthenticated requests.
- Cron ownership flag (`OPS_JOBS_DISABLED`) guarantees single-runner semantics during parallel run.

### FR-7 Environment & config contract (full spec: doc 06)
- Three operator-facing example files — `deployment/env/.env.local.example`, `.env.staging.example`,
  `.env.prod.example` — ship with sample values and instruction notes. Operators copy them to
  `.env.local` / `.env.staging` / `.env.prod` (gitignored) and edit **only these** to change any deploy.
- Every deploy script, compose file, Cloud Build YAML and Terraform root loads values via
  `deployment/scripts/lib/env-loader.sh` (validates required vars, derives resource names, exports
  `TF_VAR_*`). No script embeds a literal project ID, region, name, URL or secret — enforced by a grep gate.
- GCP: Secret Manager holds all ~70 runtime secrets under convention names (`datiq-vsp-sm-<key>-<env>`),
  mapped to the code's unchanged runtime env-var names via `secrets.manifest` (names only, never values);
  frontend values (`VITE_*`, runtime-config entries) are rendered per environment at deploy time.
- `public/runtime-config.js` gains GCP host entries (compat release) — staging/shadow/prod mapped to the
  correct Supabase project, `authReturnUrl`, `gaMeasurementId`, `posthogKey` (fixing today's hardcoded
  fallback), `consentPolicyVersion` — rendered from env by `gen-runtime-config.mjs`.

### FR-8 CI/CD
- `gcp-staging.yml`: on merge to staging → Cloud Build all images → deploy staging → parity + smoke tests.
- `gcp-prod.yml`: manual approval → **promote the exact staging-validated image digests** (no rebuild) →
  deploy → `smoke-prod.mjs` against the GCP URL → automatic rollback on failure.
- Existing Netlify workflows remain untouched until decommission.

### FR-9 Observability
- Cloud Run request/error metrics + Cloud SQL insights replace Netlify analytics; `health-monitor` cron and
  `/admin/monitoring` + `/admin/health` screens work unchanged (they probe via the same API surface).

### FR-10 Naming convention & parameterisation
- Every GCP resource is named `datiq-<project-code>-<type-abbrev>-<name>[-<env-suffix>]` per the doc 06
  abbreviation table (lowercase-normalised where GCP requires it; display names may keep `DatIQ-` casing).
- Defaults ship for project `vikash-saas-project`, region `asia-south1` (Mumbai), with the Firebase web apps
  (`DatIQ-vsp-fb-staging-web`, `DatIQ-vsp-fb-production-web`) and Hosting sites (`datiq-vsp-fhs-stg` /
  `-prod`) registered in that same project; staging and prod share the project and are distinguished by the
  mandatory `-stg` / `-prod` suffix.
- Strictly zero hard-coded values in deployment assets (scripts, compose, Cloud Build YAML, Terraform);
  the one-variable rebrand test (change `DATIQ_PROJECT_CODE` → every planned resource name changes) must pass.

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | No secrets in images; OIDC-only jobs; admin demo-mode inactive outside dev (adapter maps `CONTEXT` correctly); CSP/header parity at the new edge |
| Reliability | Repeatable local startup from clean checkout; guarded migration reruns; image-digest promotion; DNS-level rollback; Cloud SQL automated backups + PITR from day one |
| Performance | Cloud Run concurrency ~80/service; Cloud SQL connection pooling (pgbouncer-sidecar or Cloud SQL connectors) if needed; 32 MB response ceiling replaces the Lambda 6 MB workaround; revisit `*_BUDGET_MS` knobs post-cutover |
| Maintainability | All deployment assets under `deployment/`; compose split by function; every parity rule validated by a test, not by hand |
| Compliance with existing gates | Pre-push suite (9 stages) and GitHub rulesets (CodeQL) keep working unchanged |

## 6. Acceptance summary

Phase 0 and Phase 1 acceptance checklists live in the Implementation Plan (§4 and §6). Summary gate: a clean
machine runs the full product locally; staging deploys from CI and passes every existing test suite against
its URL; the shadow soaks against production data; cutover moves DB + users + domain in one window with a
rehearsed, DNS-level rollback.
