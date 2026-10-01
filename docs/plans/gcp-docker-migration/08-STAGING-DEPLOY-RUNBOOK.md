# 08 — GCP Staging Deploy Runbook (Phase 1a executed) + Operator Checklist

**Date:** 2026-09-29 · **Branch:** `docker-desktop-build` · **Status:** Phase 1a **EXECUTED END-TO-END, ALL GREEN** — smoke 13/13, DB migrated, 13 scheduler jobs live, deploy artifacts for every later phase committed.

This document is (1) the as-built record of the GCP staging deploy, (2) the
**operator checklist** — everything only you (the owner) can do, and (3) the
how-to for every remaining phase, including production, which is **deliberately
not executed** until you finish testing local + staging.

---

## 1. What is live right now (as built 2026-09-29)

| Piece | Resource | Notes |
|---|---|---|
| **Staging site** | https://datiq-vsp-fhs-staging.web.app (custom domain https://stg.datiq.app) | Firebase Hosting site `datiq-vsp-fhs-staging`, project `vikash-saas-project`. ⚠️ Renamed from `datiq-vsp-fhs-stg` on 2026-10-01 — that id was burned by a pre-fix teardown (Firebase site ids can never be recreated); `stg.datiq.app` CNAME re-pointed and verified |
| Static payload | entire `dist/` | SPA shell, prerendered home + all pages, help site, sitemap/robots, admin+tracker assets |
| Dynamic API | Cloud Run `datiq-vsp-run-api-stg` | `https://datiq-vsp-fhs-staging.web.app/api/**` rewrite; **public** (Netlify parity) |
| Admin surface | Cloud Run `datiq-vsp-run-admin-stg` | `/admin`, `/admin/**` rewrites; **public** (Netlify parity) |
| Tracker layer | Cloud Run `datiq-vsp-run-trackers-stg` | **public** (Netlify parity) |
| Jobs | Cloud Run `datiq-vsp-run-jobs-stg` | **NOT public** — Scheduler OIDC only |
| GoTrue (proof) | Cloud Run `datiq-vsp-run-auth-stg` | IAM-gated; wired via `/auth/v1/**` rewrite only in cloud-sql mode |
| PostgREST (proof) | Cloud Run `datiq-vsp-run-rest-stg` | IAM-gated; same phase rule |
| Supabase Studio | Cloud Run `datiq-vsp-run-studio-stg` | **NOT public** — IAM-gated; multi-container (`studio` on 3000 + `pg-meta` on 8080); accessed via `./deployment/scripts/gcp/proxy-studio.sh staging` |
| Database | Cloud SQL `datiq-vsp-sql-datiq-stg` | POSTGRES_16, ENTERPRISE `db-custom-1-3840` (1 vCPU / 3.75 GB), SSD, asia-south1 |
| DB contents | migrated from dev Supabase `aubwooslkkrprdxuiyvj` | 127 tables, 127 RLS-enabled, 29 extractions, extensions in `extensions` schema, GoTrue migrated 23 auth tables from zero. **2026-09-29 re-restore (FK-safe path): audit tables now fully populated** (16 audits / 8 subjects / 25 events / 114 recommendations — the first restore silently dropped those rows; see §7). 37 FK constraints referencing `auth.users` stay DROPPED on the rehearsal path by design (auth rows absent in the public-only dump) and are reported, not silent |
| Scheduler | 13 jobs `datiq-vsp-sch-*-stg` | 1:1 with `netlify.toml` schedules; OIDC SA + `x-datiq-cron-token`; **App Engine app in asia-south1** |
| Secrets | 19 `datiq-vsp-sm-*-stg` | incl. runtime keys, `jwt-secret` (STAGING-ONLY, see §3.5), `pgrst-db-uri`, `gotrue-db-database-url`, `postgres-password`, `pg-meta-db-url` |
| Images | AR `datiq-vsp-ar-images-stg` | api/admin/trackers built by Cloud Build (`build-images.yaml`, tag = git sha `ad655d1b`); GoTrue/PostgREST/Studio/pg-meta mirrored by `stage-third-party.yaml` / `stage-studio.sh` |
| CI | `.github/workflows/gcp-staging.yml` | workflow_dispatch + push to `staging` branch — **needs the GitHub secrets in §3.4 before first run** |

Supabase Auth/DB for the site itself: still the **hosted dev Supabase project**
(`DATA_MODE=hosted-supabase`) — the browser talks to `aubwooslkkrprdxuiyvj.supabase.co`
directly. Cloud SQL + the auth/rest proof services are the rehearsal for the
cutover phase, not the live path yet. Netlify staging stays up and **owns all
crons** during the parallel run.

**Deploy verification gates, all green:**
- `deployment/scripts/gcp/smoke.sh staging` → **13/13** (prerendered home, page
  parity, 301s, SPA fallback, security headers, API auth gate + tokened ping)
- `bash deployment/scripts/check-parameterisation.sh` → green (zero hardcoded
  project/region/key literals) — note: it is a BASH script; the runbook's
  earlier `node …` invocation was wrong and would throw a SyntaxError
- `npx vitest run deployment/tests/firebase-config.test.mjs` → 11/11
- full `npm run test:all` suite → green (see session handoff for the run log)

---

## 2. Redeploy / operate commands (staging)

All from the repo root. `.env.staging` (gitignored) is the single source of truth.

```bash
# images (only when src/ or netlify/functions/ changed)
gcloud builds submit --project vikash-saas-project \
  --config deployment/gcp/cloudbuild/build-images.yaml \
  --substitutions _IMG_API=asia-south1-docker.pkg.dev/vikash-saas-project/datiq-vsp-ar-images-stg/api:$(git rev-parse --short HEAD),_IMG_ADMIN=…,_IMG_TRACKERS=…,_VITE_RAZORPAY_KEY_ID=rzp_test_…

# hosting (static + config; SKIP_BUILD=1 reuses an existing dist/)
SKIP_BUILD=1 ./deployment/scripts/gcp/deploy-hosting.sh staging

# Cloud Run services
./deployment/scripts/gcp/deploy-run.sh staging              # api jobs admin trackers
./deployment/scripts/gcp/deploy-run.sh staging auth rest    # the proof trio

# scheduler (idempotent create-or-update)
./deployment/scripts/gcp/deploy-scheduler.sh staging

# verify
./deployment/scripts/gcp/smoke.sh staging
```

Env/secret changes: edit `deployment/env/.env.staging` (plain vars) — secrets go
through `deployment/gcp/secrets.manifest` + `bootstrap-secrets.sh`. Then redeploy
the affected services (`--env-vars-file`/`--set-secrets` are applied at deploy).

```bash
# env-only change, no rebuild (the 2026-09-29 rotated-key fix path):
./deployment/scripts/gcp/update-env.sh staging                # api + jobs
./deployment/scripts/gcp/update-env.sh staging --with-secrets # also re-push secrets

# verify the SUPABASE_URL/anon-key pair BEFORE any deploy (offline + live):
npm run verify:supabase -- staging        # ← also runs automatically inside
                                          #   deploy-run.sh / bootstrap-secrets.sh

# cron ownership control (doc 05 §3b):
./deployment/scripts/gcp/crons.sh staging status    # table: job | state | schedule
./deployment/scripts/gcp/crons.sh staging pause     # freeze (GCP half)
./deployment/scripts/gcp/crons.sh staging resume    # guarded: refuses while OPS_JOBS_DISABLED=1

# whole-stack up / down:
./deployment/scripts/gcp/up.sh staging      # full deploy (SKIP_* passthrough)
./deployment/scripts/gcp/down.sh staging --yes   # guarded teardown — DATA-SAFE:
                                                 # Cloud SQL + its 5 access secrets + the
                                                 # hosting site are KEPT; --delete-data
                                                 # destroys them (instance-name confirm
                                                 # runs BEFORE the first delete).
DRY_RUN=1 ./deployment/scripts/gcp/down.sh staging --yes   # rehearse, touch nothing
```

`deploy-run.sh` fails fast with the remedy when nothing was built at the current
git sha (build-images.sh / update-env.sh / DATIQ_IMG_TAG_OVERRIDE). Image builds
accept unit args: `build-images.sh staging api` builds only the api image.

DB re-migration: `migrate-db.sh` is now a **repeatable rehearsal**: on re-run it
parks FK constraints, TRUNCATES public tables and reloads the dump with
`ON_ERROR_STOP=1` (no silently swallowed row failures). Treat it as a rehearsal
tool, not a sync mechanism — re-running it discards Cloud SQL data created after
the last dump.

### 2.1 Incident note — 2026-09-29 rotated anon key (resolved)

`stg.datiq.app` served 503s ("Supabase rejected this server's API key… 207
chars") on every authenticated call: the api/jobs services carried a REVOKED
anon key. The offline ref check passed (the dead key still decoded to the right
project), which is why the old diagnostics were blind — only a LIVE
`/auth/v1/health` probe sees rotation. That probe is now `verify:supabase` and
runs inside `deploy-run.sh`/`bootstrap-secrets.sh` (skip with
`SKIP_SUPABASE_CHECK=1`); the env-only fix path is `update-env.sh staging`.
Two UI lies it exposed were also fixed: `workflow-graph.js` no longer turns a
503 fault into "Sign in to view your workflow", and the team tab no longer
claims "Your plan doesn't include a workspace" when the list failed to load.

---

## 3. OPERATOR CHECKLIST — things only you can do

### 3.1 Supabase dev project — allow the Firebase staging host (OAuth) ⚠️ required for sign-in testing
Dashboard → `aubwooslkkrprdxuiyvj` → Authentication → URL Configuration →
**Add `https://datiq-vsp-fhs-staging.web.app` to "Additional Redirect URLs"** (and
optionally `https://datiq-vsp-fhs-staging.firebaseapp.com`). Without it, Google/
Microsoft OAuth on the Firebase staging site fails the redirect allowlist.
Leave **Site URL** as-is (Netlify staging) while both serve traffic.
Reference: `docs/SUPABASE-AUTH-REDIRECT-URLS.md` is the master list — add the
Firebase hosts there too.

### 3.2 n8n — allowlist the staging host
If you test workflow callbacks from the GCP staging origin, add
`https://datiq-vsp-fhs-staging.web.app` (and `https://stg.datiq.app`) wherever n8n validates origins/callbacks
(the `N8N_BASE_URL` secret stays the same). n8n cloud webhook URLs are
origin-agnostic; only your own header/origin checks, if any, need updating.

### 3.3 Netlify Edge Access bypass (carried over)
`/api/*` on the branch-preview still needs the Netlify Edge Access bypass
(~2 min UI walkthrough in the late-night handoffs) — unrelated to GCP but still
on your list.

### 3.4 GitHub → CI for staging deploys
Create a GitHub **Environment** named `gcp-staging` with at minimum:
- `GCP_SA_KEY` — a service-account JSON key for `datiq-vsp-sa-deploy@vikash-saas-project.iam.gserviceaccount.com` (workload-identity federation is the better long-term shape; a key is the fast path)
- the runtime env secrets the workflow writes into `.env.staging` (the workflow's `.env.example` section lists them)
After that, pushing to the `staging` branch (or dispatching
`.github/workflows/gcp-staging.yml`) deploys hosting + Cloud Run + smoke from CI.
Until then, deploys stay local-run (as done in this session).

### 3.5 JWT_SECRET is STAGING-ONLY
`datiq-vsp-sm-jwt-secret-stg` holds a generated value. **At the real cutover**
(Phase 2/3) it MUST be replaced with the production Supabase project's JWT
secret, or GoTrue/PostgREST-issued tokens won't validate against anything the
hosted project recognizes during any transition window. `migrate-db.sh` prints
this warning when it generates one.

### 3.6 Cron ownership rules (parallel-run window)
- GCP staging runs with `OPS_JOBS_DISABLED=1` → scheduler jobs exist and fire,
  but the services no-op. **Netlify staging owns the crons.**
- The GCP scheduler jobs are LIVE (they will invoke the jobs service; the
  adapter drops the work). If the invocations bother you, pause them:
  `gcloud scheduler jobs pause <job> --location asia-south1 --project vikash-saas-project`
- Flip ownership ONLY at cutover: set `OPS_JOBS_DISABLED=0` on GCP and pause the
  Netlify scheduled functions in the same window (never both enabled).

### 3.7 Cost & quota watch
- Cloud SQL `db-custom-1-3840` + SSD runs ~24/7 — the biggest line item of the
  staging stack. `gcloud sql instances patch datiq-vsp-sql-datiq-stg --activation-policy=NEVER` if you want to park it between test windows.
- Cloud Run is min-instances=0 everywhere; cost tracks usage only.
- App Engine app exists (Scheduler requirement) — no services deployed, no cost.

### 3.8 Documented deviation — public `*.run.app` URLs
api/admin/trackers are `--allow-unauthenticated` (Netlify functions are equally
public), so their direct `…run.app` URLs are open too. Route-level auth still
applies (admin token, JOBS_TOKEN for jobs). If you later want them invisible,
put a Load Balancer + IAP in front — noted as out of scope for parity.

### 3.9 Firebase console access
`vikash-saas-project` needs Firebase enabled on your Google account (it is) —
the Hosting site, the web app (`firebase apps:create web` ran during bootstrap)
and future prod site all live in that console.

---

## 4. URL-behaviour differences you will notice (all deliberate)

| Behaviour | Netlify | Firebase staging | Why |
|---|---|---|---|
| `/pricing` (extensionless) | 200 | **200** (rewrite) | per-route rewrites from `scripts/site-routes.mjs` |
| `/pricing/` (slashed) | 200 | **301 → `/pricing`** | `trailingSlash:false` — one canonical form per page (Firebase's default would have done the OPPOSITE: forced the slash form) |
| `/` | prerendered home | **prerendered home** | deploy swaps `dist/index.html` = prerendered home; SPA shell moved to `/__shell/index.html` |
| unknown path | SPA shell | SPA shell (`/__shell/index.html`) | same |
| retired URLs | 301 | 301 | netlify.toml redirects mapped 1:1 |
| `/help` vs `/help/` | both 200 | **`/help` 200, `/help/` 301** | canonical form under trailingSlash:false |

SEO impact: strictly an improvement (single canonical form; sitemap already
lists extensionless URLs).

---

## 5. Remaining phases — artifacts ready, NOT executed

### Phase 2 — production shadow (when you're ready after testing)
```bash
cp deployment/env/.env.staging deployment/env/.env.prod   # then edit: -prod names, PROD Supabase URL/keys, APP_BASE_URL=https://datiq-vsp-fhs-prod.web.app
firebase hosting:sites:create datiq-vsp-fhs-prod --project vikash-saas-project
./deployment/scripts/gcp/bootstrap.sh prod && ./deployment/scripts/gcp/bootstrap-secrets.sh prod
# build+push prod-tagged images, deploy-run.sh prod, deploy-hosting.sh prod
```
`public/runtime-config.js` already routes `datiq-vsp-fhs-prod.web.app` to the
PRODUCTION Supabase project + `isProduction` (see `_GCP_PROD_HOSTS`).
For real production, prefer the actual `build-images.yaml` run with prod
substitutions rather than digest promotion.

### Phase 3 — DB/users/domain cutover
- `deployment/scripts/gcp/cutover-db.sh` — freeze Netlify crons → dump/restore
  prod DB → repoint auth/rest → repoint api → smoke. rehearsed, not run.
- **JWT_SECRET from prod Supabase** (§3.5) and **users migration** (auth schema
  dump) are inside that script's flow.
- **DNS flip is MANUAL and last**: datiq.app → Firebase Hosting custom domain
  (console: Hosting → Add custom domain) only after staging-validated smoke on
  the prod site. Netlify stays intact for instant rollback.
- Post-cutover: set `DATA_MODE=cloud-sql` in `.env.prod` and redeploy hosting —
  the generator then emits the `/auth/v1/**` + `/rest/v1/**` Cloud Run rewrites
  (unit-tested), retiring the hosted-Supabase dependency.

### Phase 3a — STAGING DB cutover (added 2026-09-30; prepared, NOT executed)
The staging twin of Phase 3: migrate the hosted dev Supabase project
(`aubwooslkkrprdxuiyvj`, staging's DB today) into `datiq-vsp-sql-datiq-stg`
**including users**, then repoint staging at the self-hosted trio. Owner
decisions: **fresh JWT secret** (sessions + old keys invalidate — users
re-login) and **cron handoff to GCP in the same window**. Tools:
`migrate-staging-db.sh staging <SOURCE_DB_URL>` (safe half — migrates only,
verifies users/identities/extractions counts + FK restore) and
`cutover-staging-db.sh staging <SOURCE_DB_URL>` (the flip; `DRY_RUN=1` prints
everything). Full procedure, rollback and caveats (Storage objects not
migrated; social OAuth needs GoTrue provider env):
**`docs/plans/gcp-docker-migration/12-STAGING-DB-CUTOVER.md`**.

---

## 6. Troubleshooting quick reference

| Symptom | Likely cause / fix |
|---|---|
| OAuth redirect error on staging | §3.1 redirect allowlist missing the host |
| 401 from `/api/workflow-orchestrator/ping` | expected — POST + `Authorization: Bearer $ADMIN_TOKEN_SECRET` (smoke does this) |
| API route returns `supabase not configured` | api service deployed without env file — rerun `deploy-run.sh staging api jobs` (the env-vars file collision bug is fixed) |
| `/pricing` returns 301 to `/pricing/` | old firebase.json cached — redeploy hosting; `trailingSlash:false` is in the generator |
| Scheduler jobs error | App Engine app must exist in the same region as `deploy-scheduler.sh` ran; check OIDC SA invoker on the jobs service |
| GoTrue 500 on boot | check `datiq-vsp-sm-gotrue-db-database-url-stg` (unix-socket form) and that `--add-cloudsql-instances` is on the service |

---

## 7. Code-review remediation (2026-09-29) — what changed after the initial green

A full review of the deployment tree (5 review passes + confidence scoring)
landed these fixes, all committed on `docker-desktop-build`:

- **Silent data loss in the DB restore (worst finding).** The first staging
  restore ran with `ON_ERROR_STOP=0 … || true` and swallowed 29 errors — audit
  rows never loaded and the green smoke never knew. `migrate-db.sh` now parks FK
  constraints, loads with `ON_ERROR_STOP=1`, re-adds FKs, and fails loudly on the
  production (SOURCE_DB_URL) path. Staging was re-restored: data complete.
- **CI workflow could never run.** `RUNTIME_ENV_FILE: ""` fell back to a
  gitignored operator file and aborted at the secrets step; the push trigger
  always failed at the DB step (no Supabase CLI on runners). Both fixed; the
  parameterisation gate is now wired into CI.
- **Smoke SIGPIPE false negative** (piping the 80KB prerendered home into
  `grep -q`) — fixed with a temp-file grep, same as the local stack-smoke.
- **`promote-prod.sh` digest promotion** referenced a `:staging` tag nothing
  pushes — now uses `STAGING_*` coordinates from the prod env file.
- **Local fixes**: `down.sh -v` actually works now; shared-db mode no longer
  fails the smoke (auth/rest checks skipped in that mode); `/compare/*` 301
  parity restored in the local gateway; `MIGRATE_EXCLUDE_TABLES` is implemented;
  jobs-mode token gate is fail-closed; `.env.<env>.example` files fully
  documented (purpose · obtain · DO/DON'T) and inline comments removed (they
  poisoned parsed values).
- **New doc**: `09-CUTOVER-RUNBOOK.md` (the runbook `cutover-db.sh` references).
- **New skill**: `.agents/skills/datiq-deployment-standards/SKILL.md` encodes
  the env-file/naming/parameterisation conventions for future sessions.
