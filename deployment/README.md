# DatIQ — deployment/ (Phase 0: local Docker Desktop; same pattern as staging)

The application code is untouched. Everything here is additive deployment
assets driven entirely by `deployment/env/.env.<env>` (doc 06 — zero hard-coded
values). **The local stack mirrors the staging/GCP topology 1:1:**

| Local | Staging/GCP equivalent |
|---|---|
| `gateway` (nginx edge: 301s + headers + routing) | Firebase Hosting edge (redirects/headers/rewrites) |
| `web` / `admin` / `trackers` (nginx images) | static payload + small Cloud Run services |
| `api` (adapter mounting all 75 functions) | Cloud Run `datiq-vsp-run-api-stg` |
| `jobs` (same image, scheduled-only, token-gated) | Cloud Run `datiq-vsp-run-jobs-stg` (no public ingress) |
| `scheduler` (cron simulator, 13 jobs) | Cloud Scheduler + OIDC |
| `db` + `auth` (GoTrue) + `rest` (PostgREST) | Cloud SQL + self-hosted auth (at cutover) |
| `mailpit` | Resend (captured locally, nothing sent) |

## Quickstart

```bash
cp deployment/env/.env.local.example deployment/env/.env.local   # fill values
deployment/scripts/up.sh          # build + start + migrate + smoke
deployment/scripts/down.sh        # stop; containers + data RETAINED (test data safe)
deployment/scripts/down.sh -v     # only if you mean it: remove containers AND
                                  #   wipe the local database volumes
```

Every `.env.<env>.example` file documents each variable with its purpose,
how to obtain the value, and DO/DON'T notes (doc 06). Comments belong on their
own lines above values — inline trailing comments are NOT parsed away.

Data modes (`.env.local` `DATA_MODE=`):
- **local-db** — full supabase-lite in Docker (db + GoTrue + PostgREST + Mailpit). Rehearse the migration here.
- **shared-db** — API + auth point at the hosted **dev** Supabase project (no local DB). Signon works instantly with existing dev accounts; the smoke skips the gateway auth/rest checks in this mode (they only exist in local-db).

## Environment quick commands (local / staging / prod)

Runbooks with pre/post validations: `docs/plans/gcp-docker-migration/10-LOCAL-DEPLOY-RUNBOOK.md`
(local), `08-STAGING-DEPLOY-RUNBOOK.md` (staging), `11-PROD-DEPLOY-RUNBOOK.md` (prod).

```bash
# ── all environments ────────────────────────────────────────────────────────
npm run test:all                          # the full gate (readiness, unit/
                                          # contract/integration/system, deploy
                                          # config, db, vuln+defects, build,
                                          # prerender, security, PW smoke)
npm run test:all -- --quick               # pre-push subset
npm run verify:supabase -- <env>          # SUPABASE_URL/anon-key pair: offline
                                          # ref match + LIVE rotation probe

# ── local (Docker Desktop) ──────────────────────────────────────────────────
deployment/scripts/up.sh                  # full up (gen-config, build, migrate, smoke)
deployment/scripts/up.sh local web api    # INCREMENTAL: only these units
SKIP_BUILD=1 deployment/scripts/up.sh local
deployment/scripts/down.sh                # stop; containers + data retained
deployment/scripts/down.sh -r             # remove containers (volumes kept)
deployment/scripts/down.sh -v             # remove containers AND the local DB data
deployment/scripts/stack.sh status        # containers incl. stopped ones
deployment/scripts/stack.sh start|stop|pause|unpause|restart [unit...]

# ── staging / prod (GCP; every script reads .env.<env>) ─────────────────────
deployment/scripts/gcp/up.sh staging      # whole stack up (SKIP_* passthrough)
deployment/scripts/gcp/up.sh prod         # shadow up: digest-promote from staging
deployment/scripts/gcp/up.sh prod --build # ...or build fresh prod images
bash deployment/scripts/gcp/update-env.sh staging        # env-ONLY redeploy,
                                                         # no rebuild
bash deployment/scripts/gcp/deploy-hosting.sh staging    # static payload only
bash deployment/scripts/gcp/build-images.sh staging api  # one image only
bash deployment/scripts/gcp/deploy-run.sh staging api jobs  # chosen services
bash deployment/scripts/gcp/deploy-scheduler.sh staging  # 13 cron jobs (1:1 netlify.toml)
bash deployment/scripts/gcp/crons.sh staging status|pause|resume  # ownership control
bash deployment/scripts/gcp/migrate-staging-db.sh staging "<SOURCE_DB_URL>"   # migrate
                                            # staging Supabase → Cloud SQL (db+users;
                                            # verifies counts + FKs; doc 12)
DRY_RUN=1 bash deployment/scripts/gcp/cutover-staging-db.sh staging "<SOURCE_DB_URL>"
                                            # staging DB cutover dry-run (doc 12)
bash deployment/scripts/gcp/smoke.sh staging             # parity smoke (fails the deploy)
deployment/scripts/gcp/down.sh staging --yes             # guarded teardown
deployment/scripts/gcp/down.sh prod                      # plan only; see runbook 11 §6
                                                         # for the prod guardrails
```

Prod deploys from GitHub: `workflow_dispatch`-only via `.github/workflows/gcp-prod.yml`
(dormant until the `gcp-prod` GitHub Environment + required reviewers are
configured — runbook 11 §7). Prod CI never runs on push and never touches the DB.

## DB migration rehearsal (staging Supabase → local)

```bash
# 1. put the staging connection string in .env.local (SOURCE_DB_URL=)
#    Supabase dashboard → Project Settings → Database → Connection string (URI, session pooler)
deployment/scripts/migrate-from-supabase.sh
# 2. restart nothing — the api talks to the local DB via the gateway:
deployment/scripts/up.sh            # (idempotent; also re-smokes)
deployment/tests/signon-e2e.sh      # signup → token → /api/extractions → PostgREST
```

Migrated accounts sign in with their **staging email + password** (bcrypt
hashes travel with `auth.users`). OAuth buttons won't complete locally — the
providers redirect to the hosted auth domain. Email flows are autoconfirm
locally; Mailpit captures anything the app tries to send.

## Layout

```
deployment/
├── adapter/            server.mjs (Netlify-event ⇄ HTTP), jobs-cron-sim.mjs
├── docker/             one Dockerfile per surface (web/admin/trackers/gateway/api)
├── gcp/                cloudbuild YAMLs, secrets.manifest (names only)
├── gateway/            gen-gateway-conf.mjs (netlify.toml → nginx conf at build)
├── compose/            compose.yaml (app) + compose.local.yaml (supabase-lite)
├── env/                .env.<env>.example — THE only files operators edit
├── migrator/           apply-migrations.sh (idempotent ledger)
├── scripts/            up/down/stack (local lifecycle: down stops by
│                       default, -r/-v opt in to removal), check-parameterisation.sh,
│                       check-supabase-pair.sh, gen-local-config,
│                       gen-routes-manifest, migrate-from-supabase,
│                       mint-supabase-keys.mjs (anon/service pair from JWT_SECRET),
│                       gcp/ (bootstrap, secrets, build-images [unit filter],
│                       deploy-run, deploy-hosting, deploy-scheduler, update-env,
│                       up, down [prod-guarded], crons, migrate-db,
│                       migrate-staging-db, cutover-staging-db [doc 12],
│                       promote-prod, cutover-db, smoke, stage-studio,
│                       proxy-studio), lib/env-loader.sh
└── tests/              stack-smoke.sh, signon-e2e.sh, firebase-config.test.mjs,
                        compose-policy.test.mjs (restart policies + lifecycle scripts)
```

## Operational notes

- **Config flow:** `.env.local` → `gen-local-config.mjs` mints anon/service API
  keys from `JWT_SECRET` and renders `generated/runtime-config.js` (served by
  the `trackers` container) + `generated/api-keys.env` (the api/jobs env_file —
  listed last so it wins). Change `.env.local` → re-run `up.sh`.
- **Cron:** the `scheduler` container fires the 13 jobs on their netlify.toml
  schedules with the `JOBS_TOKEN` (local stand-in for Cloud Scheduler OIDC).
  Watch: `docker compose logs -f scheduler`. Manual fire:
  `docker compose exec scheduler node -e "fetch('http://jobs:8080/run/health-monitor',{method:'POST',headers:{'x-datiq-cron-token':process.env.JOBS_TOKEN},body:'{}'}).then(r=>r.text()).then(console.log)"`.
- **Scheduled functions are not public:** `POST /api/billing-purge` → 404 by
  design (parity with Netlify's schedule-blocked HTTP).
- **Images pinned in `.env.local`** (`DB_IMAGE`, `AUTH_IMAGE`, `REST_IMAGE`,
  `MAILPIT_IMAGE`) — bump deliberately.
- **Parameterisation gate:** no project identifiers/URLs/keys may appear as
  literals outside `deployment/env/*.example` — keep it that way.
- **Image-override channel:** env files are sourced with `set -a`, so the file's
  `IMG_TAG` would clobber a caller's export. To pin an image, use
  `DATIQ_IMG_TAG_OVERRIDE=<tag>` (a tag) or `DATIQ_IMG_API_OVERRIDE` /
  `DATIQ_IMG_ADMIN_OVERRIDE` / `DATIQ_IMG_TRACKERS_OVERRIDE` (full refs — how
  `promote-prod.sh` rides digests). `update-env.sh` resolves the serving tag
  for you.
- **Supabase-pair guard:** `deploy-run.sh` and `bootstrap-secrets.sh` verify the
  URL/anon-key pair (offline ref match + live `/auth/v1/health` probe) before
  touching anything. A rotated-out key fails the deploy instead of shipping 503s.
  Standalone: `npm run verify:supabase -- <env>`; bypass with `SKIP_SUPABASE_CHECK=1`.
