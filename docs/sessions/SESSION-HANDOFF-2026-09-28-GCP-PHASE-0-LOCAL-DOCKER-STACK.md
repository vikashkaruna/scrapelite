# Session Handoff — 2026-09-28 — Phase 0: local Docker Desktop stack live + staging→local migration

> **Branch:** `docker-desktop-build` @ `d14dff1d` (local Docker work) on top of the GCP compat release (`444ef241` … `f7040610` merged to `main` and **deployed to production** the same day)
> **Target:** feature branch — pushed to origin, **NOT merged to staging/main** (owner is testing locally first)
> **Verification:** pre-push gate green on the compat release (9/9 incl. 164 Playwright smoke); local stack `stack-smoke.sh` **16/16**; `signon-e2e.sh` **green**; scripted staging→local migration restored **127 tables / 29 extractions / RLS intact**

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-28 |
| **Branch** | `docker-desktop-build` (byte-identical to `staging` when cut; now carries compat release + `deployment/`) |
| **HEAD SHA** | `d14dff1d` |
| **Status** | Phase 0 complete & verified locally; awaiting owner local testing; Phase 1a (GCP staging) not started |
| **Pre-Push Gates** | Compat release went through the full staging→main gates with issue approval (#243); Docker work committed locally |
| **Active Focus** | Netlify→GCP migration, Phase 0: local Docker Desktop runtime mirroring the staging topology 1:1 |
| **Plan of record** | `docs/plans/gcp-docker-migration/` (01 analysis · 02 impact · 03 BRD · 04 PRD · 05 plan · 06 naming/env · 07 fast-track) |

## 2. What Was Accomplished

### 2a. GCP compat release (Step 0) — LIVE on datiq.app
- `paymentService` / `adminService`: last hardcoded `/.netlify/functions/*` → `/api/*`; Razorpay-SDK probe literal too.
- `public/runtime-config.js`: `_GCP_PROD_HOSTS` (prod Supabase branch), `_isPrimary` (auth return), `posthogKey`/`posthogHost` (PostHog now prod-only instead of hardcoded-everywhere). `supabaseUrl`/`AnonKey` keep the `_isMain ? :` shape pinned by `runtimeConfigIdentity.test.js`.
- alertService dead link fix; prerender regenerated (35 pages); plan docs 01–07 committed.
- Deployed through the standing gates: PR #241 → staging (all green), PR #242 → main (all green), phase-gate → owner approved on issue #243 → **production deploy + smoke + re-lock all green**.

### 2b. Phase 0 — `deployment/` (26 files, additive; zero product-code changes)
- **`adapter/server.mjs`** (zero-dep Node 24): Netlify-event ⇄ HTTP. `api` mode mounts all 75 non-scheduled handlers on `/api/*` (Netlify-shaped `event.path`, raw body for payment-webhook signatures, splat routers from a manifest generated from `netlify.toml`); `jobs` mode mounts only the 13 scheduled functions behind `x-datiq-cron-token` with `POST /run/<name>`; supports the one v2-style handler (`razorpay-sdk`, `export default (req)`); `jobs-cron-sim.mjs` fires the 13 crons on their toml schedules.
- **Docker images** (all `datiq-local-ctr-*:local`): `gateway` (nginx edge — 301s + CSP/headers + routing generated from netlify.toml/site-routes.mjs at build; strips `/auth/v1` + `/rest/v1`; docker-DNS resolver), `web` (prerendered-wins + SPA fallback + forced `/`→`/home/index.html`, 404s `/admin`), `admin` (serves `/admin*` shell), `trackers` (analytics.js + env-rendered runtime-config.js), `api` (npm ci + functions + `src/lib`; **same image reused by `jobs` and `scheduler`** with different commands — the GCP pattern).
- **Compose**: `compose.yaml` (app services) + `compose.local.yaml` (supabase-lite profile: `supabase/postgres:17.6.1.165`, `supabase/auth` GoTrue v2.196, PostgREST v14.14, Mailpit, on-demand migrator, `db-passwords`+schema init one-shot). `DATA_MODE=local-db` (everything local) or `shared-db` (hosted dev project).
- **Env contract (doc 06)**: `deployment/env/.env.local` (gitignored, generated from `.env.local.example` + repo-root `.env` runtime keys + fresh secrets) → `gen-local-config.mjs` mints anon/service API keys from `JWT_SECRET` and renders `generated/runtime-config.js`; `gen-routes-manifest.mjs`; `gen-gateway-conf.mjs`. `up.sh` / `down.sh` orchestrate; `stack-smoke.sh` (16 checks) + `signon-e2e.sh` verify.
- **Migration**: `migrate-from-supabase.sh` — CLI path (supabase db dump via CLI login, no DB password → wipe volume → restore schema + **public-only** data with `session_replication_role=replica` FK bypass → mark ledger) and `SOURCE_DB_URL` path (full pg_dump incl. auth schema — the production-cutover recipe). `migrator/apply-migrations.sh` idempotent ledger (`deployment.migrations`).

### 2c. Migration rehearsal actually run
Staging (`aubwooslkkrprdxuiyvj`) → local: 127 public tables restored, **29 extractions**, all 127 RLS-enabled, ledger marked (85). `auth.users` rows intentionally skipped in CLI mode (see Root Causes #3) — local signon is fresh signup.

## 3. Root Cause Analysis (bugs hit and fixed during bring-up)

1. **PostgREST `role "" does not exist` on every authenticated call.** supabase/postgres ships `auth.users.role` **without** the `authenticated` default, AND newer GoTrue explicitly inserts `role=''` (a column default never fires). Fix: `db-passwords` init sets the column default, backfills, and adds trigger `auth.stamp_role_on_users` stamping `authenticated` on insert/update.
2. **GoTrue/PostgREST "password authentication failed".** The image does NOT seed `supabase_auth_admin`/`authenticator` passwords from `POSTGRES_PASSWORD`, and `supabase_auth_admin` is a supautils-protected role (only `supabase_admin` can ALTER). Fix: init runs `alter role … password …` as `supabase_admin` over TCP (its password IS `POSTGRES_PASSWORD`).
3. **auth data restore errors (`custom_oauth_providers`, `flow_state`, `ip_address` missing).** Hosted auth schema is newer than the local image's bundled auth schema. Resolution: CLI path restores **public-only** data locally; auth rows migrate via the `SOURCE_DB_URL` path at production cutover (same-major target). Staging users are Google-OAuth-only anyway — no password login possible locally.
4. **Gateway 502 / nginx exit "host not found in upstream".** Static `proxy_pass` resolves at startup; restarting siblings break it. Fix: docker-DNS `resolver 127.0.0.11` + variable `proxy_pass` (runtime resolution).
5. **`/` returned 301 to `/home/index.html`.** netlify.toml writes `status = 200` unquoted; the TOML regex only matched quoted values, defaulting everything to 301. Fix: accept bare integers.
6. **api crash `ERR_MODULE_NOT_FOUND`.** The image lacked npm deps (Netlify's esbuild resolves them at deploy) and `src/lib` (several functions import shared client modules). Fix: `npm ci --omit=dev` + `COPY src/lib`.
7. **Smoke false-negatives (exit 141).** `grep -q` on a 80 KB single-line HTML via an `echo` pipe → SIGPIPE. Fix: grep a temp file.
8. **zsh footguns during ops:** unquoted `$COMPOSE` doesn't word-split in zsh (use explicit commands in scripts; scripts are bash).

## 4. Verification Evidence

- Compat release: PR #241 staging gate green (Test Suites 15m47s incl. Netlify staging-deploy verification); PR #242 → main gate green; production smoke green; live `runtime-config.js` serves `_GCP_PROD_HOSTS`.
- Local: `stack-smoke.sh` 16/16 (prerender precedence, SPA fallback, admin, trackers, GoTrue health, PostgREST OpenAPI, api 401s, scheduled-function blocking, 301 parity, sitemap/robots, jobs token run); `signon-e2e.sh` green; scripted migration verification (127 tables / 29 extractions / 127 RLS / ledger 85).
- Container states at handoff: all healthy (`api`, `jobs`, `auth`, `rest`, `db`, `gateway`, `web`, `admin`, `trackers`, `mailpit`, `scheduler`).

## 5. Operator Tasks & Open Items for Next Session

- [ ] **Owner: local testing** — `http://localhost:8080` (app), `/admin/` (real PIN), `:8025` Mailpit, `:54329` Postgres. Sign up fresh; extract; test flows. Staging users are OAuth-only → cannot password-login locally.
- [ ] **Push state**: compat release is on `main`/prod; Docker work is on `docker-desktop-build` (pushed to origin, no PRs) — merge to staging/main only after owner testing.
- [ ] **Phase 1a (next session)**: `.env.staging.example` / `.env.prod.example` scaffolding exists — fill real values; Cloud Build ×4 images, Cloud Run (`datiq-vsp-run-api-stg`, `datiq-vsp-run-jobs-stg`, optional admin/trackers), Firebase Hosting site `datiq-vsp-fhs-stg` (firebase.json generated from netlify.toml/site-routes), 13 Cloud Scheduler jobs with OIDC, Secret Manager bootstrap from `.env`.
- [ ] **Cutover prerequisites** (later): move Supabase custom auth domain off `api.datiq.app` when flipping DNS; update Stripe/Razorpay/Resend webhook URLs; OAuth provider redirect allow-lists.
- [ ] **Deferred**: Vite multi-entry admin bundle split; Terraform modularisation; local `local-db` profile exhaustive qualification; PostHog key governance (now env-driven, prod-only).
- [ ] **Root `.env` note**: `SUPABASE_SERVICE_KEY` is empty there — irrelevant for `local-db` (keys are minted), but required for `shared-db` mode against the dev project.
