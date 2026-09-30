# 12 — Staging DB Cutover: hosted Supabase → GCP Cloud SQL

**Status: PREPARED, NOT EXECUTED** (tools + docs landed on `docker-desktop-build`;
the flip itself is an operator-run window).

**What this does:** migrates the staging database — schema, data AND users —
from the hosted dev Supabase project (`aubwooslkkrprdxuiyvj.supabase.co`,
which staging uses today in `DATA_MODE=hosted-supabase`) into the GCP staging
Cloud SQL instance (`datiq-vsp-sql-datiq-stg`), then repoints every staging
layer at the self-hosted trio (GoTrue + PostgREST + Cloud SQL) behind the
Firebase Hosting `/auth/v1/**` + `/rest/v1/**` rewrites.

## Owner decisions baked into this runbook (2026-09-30)

1. **Fresh JWT secret.** The cutover generates a new secret and mints a fresh
   anon + service key pair from it (`deployment/scripts/mint-supabase-keys.mjs`).
   Consequence: **every staging session dies and every old key stops working** —
   users log in again; anything holding the old service key is re-pointed by the
   script (Secret Manager + `.env.staging` are updated in-window).
2. **Cron handoff in the same window.** GCP staging takes cron ownership at the
   flip (`OPS_JOBS_DISABLED=0` + `crons.sh staging resume`); the Netlify
   staging TOML schedules must be commented BEFORE step 5. Never both owners
   (doc 05 §3b).

## Preflight (before the window)

```bash
npm run test:all -- --quick
npm run verify:supabase -- staging
bash deployment/scripts/check-parameterisation.sh
# The source connection string (Supabase dashboard → Connect → Session pooler):
SOURCE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Dry-run the whole cutover first (prints every command and env edit, touches
nothing, runs in seconds):

```bash
DRY_RUN=1 bash deployment/scripts/gcp/cutover-staging-db.sh staging "$SOURCE_DB_URL"
```

## Run (cutover window)

```bash
# 1. Comment the staging scheduled-function blocks in netlify.toml
#    (the "Netlify staging" schedule entries) and redeploy Netlify staging.
# 2. Then, in the same window:
bash deployment/scripts/gcp/cutover-staging-db.sh staging "$SOURCE_DB_URL"
```

The script does, in order (all steps individually re-runnable):
0. fresh JWT secret → `.env.staging` + Secret Manager; mints + persists a fresh
   anon/service key pair; prints the session-invalidation consequence.
1. `crons.sh staging pause` (GCP freeze).
2. `migrate-staging-db.sh` (dump schema+data+auth users → Cloud SQL; FK
   restore fatal-on-error; row-count + FK verification). `SKIP_MIGRATE=1`
   reuses a previously migrated instance.
3. `deploy-run.sh staging auth rest` (fresh secret already in Secret Manager).
4. `DATA_MODE=cloud-sql` + `SUPABASE_URL=$APP_BASE_URL` persisted, GoTrue
   allowlist extended with `datiq-vsp-fhs-stg.web.app/**` + `stg.datiq.app/**`,
   runtime-config.js patched (staging pair → same-origin + minted anon key)
   **for this hosting deploy only**, then `deploy-run.sh staging api jobs` +
   `deploy-hosting.sh staging` (emits the /auth/v1+/rest/v1 rewrites).
5. `OPS_JOBS_DISABLED=0` → `deploy-run.sh staging jobs` → `crons.sh staging resume`.
6. `smoke.sh staging`.

## Post-window verification (manual)

- Sign in fresh on `https://stg.datiq.app` — auth round-trip against self-hosted GoTrue.
- Create a schedule + run one extraction — api → `/rest/v1` → Cloud SQL.
- Watch Mailpit-independent transactional email (welcome email fires once).
- `fk-restore.err` has 0 ERRORs; `data-restore.err` empty
  (`deployment/generated/db/`).

## Rollback

Hosted Supabase is never touched — its data stays intact through the window.

```bash
cp deployment/env/.env.staging.preflip.<ts> deployment/env/.env.staging
bash deployment/scripts/gcp/deploy-run.sh staging auth rest api jobs
bash deployment/scripts/gcp/deploy-hosting.sh staging   # runtime-config auto-restored
bash deployment/scripts/gcp/crons.sh staging pause
# un-comment the Netlify staging TOML schedules and redeploy Netlify staging
```

`cutover-staging-db.sh` restores the committed `public/runtime-config.js`
automatically on exit (its EXIT trap), so the committed form always ships the
hosted dev pair — `runtimeConfigIdentity.test.js` fails if a flip is ever
committed.

## Caveats (not silently ignored)

- **Supabase Storage objects are NOT migrated** — pg_dump covers Postgres only;
  files live outside it. Export staging buckets first if they hold anything.
- **Social OAuth** (Google/Microsoft/GitHub) needs `GOTRUE_EXTERNAL_*`
  credentials on the self-hosted GoTrue. Email/password works immediately;
  social buttons will not until configured.
- `check-supabase-pair.sh` skips its live probe for non-`*.supabase.co` URLs —
  after the flip, verification is the smoke + manual signon above.
- Prod is unaffected; its cutover remains `cutover-db.sh prod` (doc 09).
