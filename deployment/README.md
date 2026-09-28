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
deployment/scripts/down.sh        # stop (add -v to wipe the local database)
```

Data modes (`.env.local` `DATA_MODE=`):
- **local-db** — full supabase-lite in Docker (db + GoTrue + PostgREST + Mailpit). Rehearse the migration here.
- **shared-db** — API + auth point at the hosted **dev** Supabase project (no local DB). Signon works instantly with existing dev accounts.

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
├── gateway/            gen-gateway-conf.mjs (netlify.toml → nginx conf at build)
├── compose/            compose.yaml (app) + compose.local.yaml (supabase-lite)
├── env/                .env.<env>.example — THE only files operators edit
├── migrator/           apply-migrations.sh (idempotent ledger)
├── scripts/            up/down, gen-local-config, gen-routes-manifest,
│                       migrate-from-supabase, lib/env-loader.sh
└── tests/              stack-smoke.sh, signon-e2e.sh
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
