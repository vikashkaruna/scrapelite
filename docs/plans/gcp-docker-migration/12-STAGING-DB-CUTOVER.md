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
# Option A — one window (Netlify freeze already done):
NETLIFY_CRONS_FROZEN=1 bash deployment/scripts/gcp/cutover-staging-db.sh \
  staging "$SOURCE_DB_URL"

# Option B — split window (script default): the cutover completes steps 0–4
# + smoke with GCP jobs left PAUSED; after the Netlify freeze, finish the
# cron handoff without re-running the destructive steps:
bash deployment/scripts/gcp/cutover-staging-db.sh staging finish-crons
```

The script does, in order (all steps individually re-runnable):
0. fresh JWT secret + minted anon/service pair pushed to **Secret Manager
   only** — `.env.staging` is deliberately NOT touched here. Step 2's
   pre-flight must still see the ORIGINAL hosted-project env (URL ↔ key
   project match), and an interrupted run must leave a working env. (The
   2026-10-01 revision fixed exactly this: minting used to write the env at
   step 0 and the migration pre-flight then failed with a PROJECT MISMATCH.)
1. `crons.sh staging pause` (GCP freeze; idempotent).
2. `migrate-staging-db.sh` (dump schema+data+auth users → Cloud SQL; FK
   restore fatal-on-error; row-count + FK verification). `SKIP_MIGRATE=1`
   reuses a previously migrated instance.
3. `JWT_SECRET` persisted to `.env.staging` (first env write) +
   `deploy-run.sh staging auth rest` — this deploy is the moment existing
   sessions actually invalidate.
4. `DATA_MODE=cloud-sql` + `SUPABASE_URL=$APP_BASE_URL` + the minted
   `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` persisted **together** (the
   keys land only alongside the URL they were minted for), GoTrue
   allowlist extended with `datiq-vsp-fhs-stg.web.app/**` +
   `stg.datiq.app/**`, runtime-config.js patched (staging pair → same-origin
   + minted anon key) **for this hosting deploy only**, then
   `deploy-run.sh staging api jobs` + `deploy-hosting.sh staging` (emits the
   /auth/v1+/rest/v1 rewrites).
5. Cron handoff — **gated on `NETLIFY_CRONS_FROZEN=1`** (attestation that the
   Netlify staging TOML schedules are commented + redeployed; never both cron
   owners). Without it: `OPS_JOBS_DISABLED` stays 1, GCP jobs stay PAUSED,
   and the handoff is completed later with `staging finish-crons`.
6. `smoke.sh staging`.

## Post-window verification (manual)

- Sign in fresh on `https://stg.datiq.app` — auth round-trip against self-hosted GoTrue.
- Create a schedule + run one extraction — api → `/rest/v1` → Cloud SQL.
- Watch Mailpit-independent transactional email (welcome email fires once).
- `fk-restore.err` has 0 ERRORs; `data-restore.err` empty
  (`deployment/generated/db/`).

## Executed 2026-10-01 — what it actually took (all scripted now)

The cutover ran for real; each blocker below is fixed in the scripts, and the
fix is what a future prod execution inherits:

1. **Step 0 wrote the env too early.** Minting flipped `SUPABASE_ANON_KEY` in
   `.env.staging` before step 2's migration pre-flight, which validates the key
   against `SUPABASE_URL`'s project → `PROJECT MISMATCH`, and an interrupt left
   the env half-flipped. Minting now touches **Secret Manager only**; the env
   flips at steps 3–4 (the deploys that consume each value).
2. **Re-run had to be re-runnable.** FK drops are now `DROP CONSTRAINT IF
   EXISTS`; the truncate covers `public` **and `auth`/`storage`** (the dump
   carries auth rows — a public-only truncate left `auth.flow_state` populated
   and the COPY died on duplicate keys). On the full cutover path the schema
   restore drops + recreates the three data schemas (a stale auth schema from
   an earlier rehearsal made the restore die on a column the dump's
   `one_time_tokens` had and the target lacked). The data import filters out
   non-product schemas (`vault`, `realtime`) and psql-17 `\restrict` markers.
3. **GoTrue could not boot** (`no schema has been selected to create in` /
   `must be owner of table users`) — the restore leaves the auth schema owned
   by `postgres`; hosted Supabase (and the local compose stack) give it to
   `supabase_auth_admin`. The migration now transfers schema + all auth
   relations/sequences/functions and grants. Same class: `anon`/`authenticated`
   had **no table grants** (dumps carry no GRANTs; hosted grants them and RLS
   gates rows) → PostgREST `42501` until the migration re-grants
   select/insert/update/delete + sequence + function privileges.
4. **`/auth/v1` + `/rest/v1` prefixes.** Firebase Hosting passes the full path;
   GoTrue/PostgREST serve at the root (Kong/local-gateway strip the prefix, and
   Hosting has no rewrite-transform). The rewrites now target the **api**
   service, whose adapter strips the prefix and proxies to auth/rest
   (`AUTH_PROXY_URL`/`REST_PROXY_URL`, resolved from the live services at
   deploy; `X-Serverless-Authorization` carries the OIDC token so the user's
   Authorization JWT is untouched).
5. **Env-only flips ride the serving image.** Steps 4–5 use `update-env.sh`,
   not `deploy-run.sh` — HEAD can move past the last build (a docs-only commit
   made step 4 die on `image not found`). An interrupted cutover resumes with
   `CUTOVER_RESUME=1` (skips migration, re-runs steps 3–6 idempotently).
6. **Verified end-to-end**: smoke 13/13; anon REST 200; signup → insert → read
   own row through `stg.datiq.app`; `/api/credits` with a fresh user JWT
   returns the ledger shape from Cloud SQL.

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
