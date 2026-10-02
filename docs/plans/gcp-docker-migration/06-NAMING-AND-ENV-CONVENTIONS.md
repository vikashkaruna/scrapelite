# 06 — Naming, Environment Files & Parameterisation Conventions

**Date:** 2026-09-28 · **Status:** draft for owner confirmation
**Applies to:** every script, compose file, Dockerfile build-arg, Cloud Build YAML and Terraform file under `deployment/`

## 1. Golden rules

1. **The `.env.<env>` file is the single source of truth.** Operators edit only `.env.local`, `.env.staging`
   or `.env.prod` (created by copying the shipped `.example` files). Changing a deployment never touches a
   script — only the env file.
2. **Zero hard-coded values.** No project IDs, regions, resource names, URLs, ports or secrets are embedded
   in scripts, compose files, Dockerfiles, Cloud Build YAML or `.tf` files. Everything is read dynamically
   from the env file; a CI grep gate enforces this (§9).
3. **Sensible defaults ship pre-filled.** The examples ship with project `vikash-saas-project`, region
   `asia-south1` (Mumbai) and the full default resource-name map, so a staging deploy works after only the
   `REPLACE_ME` secret placeholders are filled.
4. **Fail fast, never guess.** The env loader validates required variables and aborts with the exact
   missing-key list; unset optional variables fall back to derived defaults (themselves composed from other
   variables, never literals).

## 2. Resource naming convention

**Pattern:** `datiq-<project-code>-<type-abbrev>-<name>[-<env-suffix>]`

- `DatIQ-` casing is kept only for resources that allow mixed-case **display names** (Firebase web-app
  display names, monitoring alert policies, Cloud Build trigger display names). All other resources
  normalize to lowercase `datiq-…` because GCP restricts Cloud Run, Cloud SQL, buckets, Artifact Registry,
  Secret Manager, service accounts and Hosting site IDs to lowercase.
- `<project-code>` = `DATIQ_PROJECT_CODE` (default `vsp` = vikash-saas-project). Set it **before** the first
  deploy; changing it later renames every resource (the rebrand is a variable change, §9).
- `<env-suffix>` is mandatory (`-stg`, `-prod`) because staging and prod live in the **same GCP project** by
  default. Local Docker containers use `-local` via compose.

### Type abbreviations

| Abbrev | Resource | Case rule |
|---|---|---|
| `run` | Cloud Run service | lowercase |
| `sql` | Cloud SQL instance | lowercase |
| `ar` | Artifact Registry repository | lowercase |
| `ctr` | Container image name (inside AR) | lowercase |
| `sm` | Secret Manager secret | lowercase |
| `sa` | Service account | lowercase |
| `sch` | Cloud Scheduler job | lowercase |
| `gcs` | Cloud Storage bucket | lowercase |
| `cb` | Cloud Build trigger | lowercase (display name may read `DatIQ-…`) |
| `fb` | Firebase web app (display name) | `DatIQ-` allowed |
| `fhs` | Firebase Hosting site ID | lowercase (globally unique) |
| `vpc` | VPC network / connector (private-IP Cloud SQL mode) | lowercase |
| `mon` | Monitoring dashboard / alert policy (display) | `DatIQ-` allowed |

### Default resource map (shipped as sample values in the .env examples)

| Variable | Staging default | Production default |
|---|---|---|
| `CLOUD_RUN_API` | `datiq-vsp-run-api-stg` | `datiq-vsp-run-api-prod` |
| `CLOUD_RUN_JOBS` | `datiq-vsp-run-jobs-stg` | `datiq-vsp-run-jobs-prod` |
| `CLOUD_RUN_AUTH` | `datiq-vsp-run-auth-stg` | `datiq-vsp-run-auth-prod` |
| `CLOUD_RUN_REST` | `datiq-vsp-run-rest-stg` | `datiq-vsp-run-rest-prod` |
| `CLOUD_RUN_ADMIN` | `datiq-vsp-run-admin-stg` | `datiq-vsp-run-admin-prod` |
| `CLOUD_RUN_TRACKERS` | `datiq-vsp-run-trackers-stg` | `datiq-vsp-run-trackers-prod` |
| `AR_REPO` | `datiq-vsp-ar-images-stg` | `datiq-vsp-ar-images-prod` |
| `IMG_API` (and 5 siblings) | `${IMG_BASE}/datiq-vsp-ctr-api:${IMG_TAG}` | same, `-prod` repo |
| `SQL_INSTANCE` | `datiq-vsp-sql-datiq-stg` | `datiq-vsp-sql-datiq-prod` |
| `SA_API` / `SA_JOBS` / `SA_SCHEDULER` | `datiq-vsp-sa-api-stg` / `-jobs-stg` / `-scheduler-stg` | `-prod` |
| `SA_DEPLOY` (env-agnostic) | `datiq-vsp-sa-deploy` | same |
| `SM_*` secrets | `datiq-vsp-sm-<key>-stg` (e.g. `datiq-vsp-sm-supabase-service-key-stg`) | `-prod` |
| `SCH_*` (13 jobs) | `datiq-vsp-sch-bulk-runner-stg` … | `-prod` |
| `TFSTATE_BUCKET` | `datiq-vsp-gcs-tfstate` (one bucket, per-env state prefixes) | same |
| `ARTIFACTS_BUCKET` | `datiq-vsp-gcs-artifacts-stg` | `datiq-vsp-gcs-artifacts-prod` |
| `CB_TRIGGER_*` (4) | `datiq-vsp-cb-api-stg` … | `-prod` |
| `FB_WEB_APP_DISPLAY` | `DatIQ-vsp-fb-staging-web` | `DatIQ-vsp-fb-production-web` |
| `FHS_SITE_ID` | `datiq-vsp-fhs-staging` (renamed 2026-10-01 — see note below) | `datiq-vsp-fhs-prod` |
| `VPC_CONNECTOR` (optional) | `datiq-vsp-vpc-connector-stg` | `-prod` |

Notes: (a) the `web` static surface deploys to Firebase Hosting directly (no Cloud Run web service); the
`gateway` container is local-only. (b) Bucket and Hosting-site IDs are **globally unique** on GCP — if a
default is taken, override the variable in `.env`; never rename a resource after first deploy. (c) The 13
scheduler job names map 1:1 to the cron table in the implementation plan §3c. (d) The runtime env-var names
inside containers (`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, …) are **unchanged** — they are the code's
contract; only the Secret Manager resource names follow the convention.

### Labels (applied to every created resource)
`app=datiq`, `project-code=${DATIQ_PROJECT_CODE}`, `env=${DATIQ_ENV}`, `managed-by=terraform|script`,
`owner=${DATIQ_OWNER_LABEL}` — all from variables.

## 3. Firebase

- The Firebase project **is** the GCP project `vikash-saas-project` (enable the Firebase APIs once; there is
  no second project).
- Two web apps registered, one per environment, display names per convention:
  `DatIQ-vsp-fb-staging-web`, `DatIQ-vsp-fb-production-web`.
- Each web app gets a Hosting **site** (lowercase IDs per the table above). `.firebaserc` and the
  project/site references in `firebase.json` are **rendered from `.env`** by
  `deployment/scripts/gen-firebase-config.mjs` — nothing site-specific is committed to the repo.
- Hosting deploys authenticate as `datiq-vsp-sa-deploy` (key supplied via the env var
  `FIREBASE_SERVICE_ACCOUNT_KEY_PATH` locally / GitHub Environment secrets in CI).

## 4. Environment matrix

| Env | Env file | Purpose | Edge | Data mode | Public URL (var) |
|---|---|---|---|---|---|
| local | `.env.local` | Phase 0 — full stack in Docker Desktop | gateway container on `:8080` | `local-db` (db+auth+rest containers) or `shared-db` (dev Supabase) | `APP_BASE_URL=http://localhost:8080` |
| staging | `.env.staging` | GCP staging — proves the target model, runs CI E2E | Firebase Hosting site `-stg`/`-staging` + Cloud Run `-stg` services | dev hosted Supabase → later staging Cloud SQL | `APP_BASE_URL=https://datiq-vsp-fhs-staging.web.app` |
| prod | `.env.prod` | GCP production twin ("shadow") → cutover target | Firebase Hosting site `-prod` + Cloud Run `-prod` | prod hosted Supabase (shadow) → prod Cloud SQL (cutover) | `SHADOW_BASE_URL=…web.app`; `APP_BASE_URL=https://datiq.app` post-cutover |

## 5. Env-file system and loader mechanics

Files (all in `deployment/env/`):

```
.env.local.example        # sample values + instruction notes — copy to .env.local and edit
.env.staging.example      # copy to .env.staging
.env.prod.example         # copy to .env.prod
.env.local|.staging|.prod # gitignored — the ONLY files operators edit
README.md                 # how the contract works
```

`deployment/scripts/lib/env-loader.sh` (sketch):

```bash
load_env() {                       # usage: load_env staging
  local file="${DEPLOYMENT_ENV_DIR:-$ROOT/deployment/env}/.env.$1"
  [[ -f $file ]] || die ".env.$1 not found. Copy .env.$1.example → .env.$1 and fill values."
  set -a; source "$file"; set +a   # export everything defined
  require_vars "$REQUIRED_VARS"    # fail fast with the missing-key list
  derive_defaults                  # compose unset name vars via ${VAR:-…} chains
  export_tf_vars                    # ⚠ NOT IMPLEMENTED — Terraform is deferred (see plan doc 05 deviations):
                                  #   GCP resources are created by bootstrap.sh + deploy-*.sh via gcloud.
                                  #   All Terraform examples in this doc are the CONTRACT for a future
                                  #   terraform/ tree; TFSTATE_BUCKET is reserved for it. No .tf files exist.                   # GCP_PROJECT_ID→TF_VAR_gcp_project_id, SQL_*→TF_VAR_*, …
}
```

Rules:

- **Every** entry-point script starts with `source lib/env-loader.sh && load_env <env>` and references
  `${VAR}` only afterwards.
- Compose runs with `--env-file deployment/env/.env.local` plus `${VAR}` interpolation; no literals in any
  `compose*.yaml`.
- Cloud Build YAML contains only `_`-prefixed substitutions; wrapper scripts pass them from the env:
  `gcloud builds submit --substitutions="_PROJECT_ID=${GCP_PROJECT_ID},_REGION=${GCP_REGION},_IMAGE=${IMG_API},…"`.
- Terraform: modules expose `variable` blocks with **no defaults** for env-provided values (required = made
  explicit by plan failure); roots wire modules via `var.*`; values arrive as `TF_VAR_*` exported by the
  loader (or `gen-tfvars.sh` renders `terraform.tfvars` for laptop runs). State lives in
  `datiq-vsp-gcs-tfstate` with per-env prefixes.
- CI: GitHub Environments `gcp-staging` / `gcp-prod` mirror the **same variable names** (repo variables +
  secrets); workflows inject them and then run the same scripts. The `.env` files remain the source for
  operator-run deploys.
- The tracker/config layer for static surfaces (`runtime-config.js`, analytics keys) is rendered at deploy
  time by `gen-runtime-config.mjs` from env vars (`GA_MEASUREMENT_ID`, `POSTHOG_KEY`, `POSTHOG_HOST`,
  `APP_BASE_URL`, Supabase host entries) — keys stop being committed in the repo.

## 6. `.env.staging.example` — shipped skeleton (sample values + notes; full file materialised at implementation)

```bash
# ══ DatIQ staging env — copy to deployment/env/.env.staging and fill ═════════
# Only THIS file is edited to change a deploy. Nothing else is touched.

# ── 1. GCP core ──────────────────────────────────────────────────────────────
GCP_PROJECT_ID=vikash-saas-project        # gcloud projects list — owns ALL resources
GCP_REGION=asia-south1                    # Mumbai; supported by Cloud Run/SQL/AR/Scheduler
DATIQ_PROJECT_CODE=vsp                    # short code in every resource name; set BEFORE first deploy
DATIQ_ENV=staging
DATIQ_ENV_SUFFIX=-stg
DATIQ_OWNER_LABEL=vikash
GCP_BILLING_ACCOUNT_ID=REPLACE_ME         # needed once to enable APIs

# ── 2. Resource names (defaults per doc 06; override only on collision) ──────
CLOUD_RUN_API=datiq-vsp-run-api-stg
CLOUD_RUN_JOBS=datiq-vsp-run-jobs-stg
CLOUD_RUN_AUTH=datiq-vsp-run-auth-stg
CLOUD_RUN_REST=datiq-vsp-run-rest-stg
CLOUD_RUN_ADMIN=datiq-vsp-run-admin-stg
CLOUD_RUN_TRACKERS=datiq-vsp-run-trackers-stg
AR_REPO=datiq-vsp-ar-images-stg
SQL_INSTANCE=datiq-vsp-sql-datiq-stg
SA_DEPLOY=datiq-vsp-sa-deploy
SA_API=datiq-vsp-sa-api-stg
SA_JOBS=datiq-vsp-sa-jobs-stg
SA_SCHEDULER=datiq-vsp-sa-scheduler-stg
TFSTATE_BUCKET=datiq-vsp-gcs-tfstate      # globally unique; override if taken
ARTIFACTS_BUCKET=datiq-vsp-gcs-artifacts-stg
FHS_SITE_ID=datiq-vsp-fhs-staging         # globally unique; override if taken
                                          # ⚠️ renamed from datiq-vsp-fhs-stg 2026-10-01:
                                          # Firebase site ids can NEVER be recreated once
                                          # deleted (down.sh keeps the site by default
                                          # for exactly this reason)
FB_WEB_APP_DISPLAY=DatIQ-vsp-fb-staging-web

# ── 3. URLs ──────────────────────────────────────────────────────────────────
APP_BASE_URL=https://datiq-vsp-fhs-staging.web.app   # custom domain goes here post-cutover
API_BASE_URL=${APP_BASE_URL}                     # same-origin via hosting rewrites
SHADOW_BASE_URL=                                 # set once the prod twin exists

# ── 4. Images (constructed from variables, never literal) ────────────────────
IMG_BASE=${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}
IMG_TAG=main-REPLACE_WITH_SHA                     # CI passes the real git sha
IMG_API=${IMG_BASE}/datiq-vsp-ctr-api:${IMG_TAG}
# IMG_JOBS / IMG_AUTH / IMG_REST / IMG_ADMIN / IMG_TRACKERS — same pattern

# ── 5. Database ──────────────────────────────────────────────────────────────
DB_NAME=datiq
DB_APP_USER=datiq_app
DB_APP_PASSWORD=REPLACE_ME                 # pushed to Secret Manager by bootstrap-secrets.sh
CLOUD_SQL_TIER=db-custom-1-3840            # staging size
CLOUD_SQL_CONNECTIVITY=public-ssl          # public-ssl (fast start) | private (VPC connector)
PURGE_ENABLED=0                            # destructive cron OFF outside prod

# ── 6. Data mode for this environment ────────────────────────────────────────
DATA_MODE=hosted-supabase                  # hosted-supabase (parallel window) | cloud-sql (post-cutover)
SUPABASE_URL=REPLACE_ME_DEV_PROJECT_URL    # dev project while validating (runtime-config branching)
SUPABASE_ANON_KEY=REPLACE_ME
SUPABASE_SERVICE_KEY=REPLACE_ME
# JWT_SECRET=                              # needed ONLY at the GoTrue/Cloud SQL cutover; export from
#                                          # Supabase then; never commit; goes to Secret Manager

# ── 7. Runtime secrets → Secret Manager name map (sample; full list lives in
#      deployment/gcp/secrets.manifest — the manifest holds NAMES, never values)
#      runtime env var        →  secret resource name
#      SUPABASE_SERVICE_KEY   →  datiq-vsp-sm-supabase-service-key-stg
#      STRIPE_SECRET_KEY      →  datiq-vsp-sm-stripe-secret-key-stg
#      RAZORPAY_KEY_SECRET    →  datiq-vsp-sm-razorpay-key-secret-stg
#      RESEND_API_KEY         →  datiq-vsp-sm-resend-api-key-stg
#      (…~70 runtime vars total; runtime names match the code exactly — unchanged)

# ── 8. Platform-env emulation (adapter maps to URL/SITE_URL/DEPLOY_URL/CONTEXT/BRANCH)
APP_CONTEXT=branch-deploy                  # staging behaves like a Netlify branch deploy
GIT_BRANCH=staging

# ── 9. Frontend / tracker layer (rendered into runtime-config.js at deploy) ──
GA_MEASUREMENT_ID=                         # blank → tracker loader skips GA4
POSTHOG_KEY=REPLACE_ME_OR_LEAVE_BLANK      # fixes today's hardcoded-fallback key leak
POSTHOG_HOST=https://us.i.posthog.com
CONSENT_POLICY_VERSION=2026-09-28
N8N_PUBLIC_WEBHOOK_URL=https://vkaruna.app.n8n.cloud/webhook/datiq

# ── 10. Deploy/test hooks ────────────────────────────────────────────────────
PW_BASE_URL=${APP_BASE_URL}                # Playwright retarget — no test edits needed
SMOKE_TARGET=${APP_BASE_URL}
```

## 7. `.env.prod.example` — differences from staging (sample values likewise)

- Suffixes `-prod`; `DATIQ_ENV=production`; `APP_CONTEXT=production`.
- `APP_BASE_URL=https://datiq.app` (post-cutover) + `SHADOW_BASE_URL=https://datiq-vsp-fhs-prod.web.app`.
- `CLOUD_SQL_TIER` sized up; `CLOUD_SQL_HA=REGIONAL`; `CLOUD_SQL_BACKUP_PITR=1`.
- `PURGE_ENABLED` / `ENGAGEMENT_ENABLED` explicit operator decisions; min-instances and the Lambda-tuned
  `*_BUDGET_MS` knobs get prod overrides.

## 8. `.env.local.example` — differences from staging

- No GCP billing needed; `COMPOSE_PROJECT_NAME=datiq-local`, `LOCAL_GATEWAY_PORT=8080` — container names
  become `datiq-local-web`, `datiq-local-api`, … via compose interpolation.
- `DATA_MODE=local-db` default (db/auth/rest containers with safe local creds), plus a commented
  `shared-db` block pointing at the dev Supabase project for the Phase 1 rehearsal mode.
- `FUNCTIONS_DEV_PORT`, Mailpit URL, `ENGAGEMENT_MOCK_SEND=1`, mock-safe provider keys — all with notes.

## 9. Parameterisation acceptance criteria (enforced, not aspirational)

- [ ] `scripts/check-parameterisation.sh` greps `deployment/{scripts,compose,gcp,docker}   # (terraform/ does not exist yet — added back when it lands)` for
      forbidden literals (`vikash-saas-project`, `asia-south1`, `datiq.app`, resource names, emails, keys) —
      hits are allowed **only** in `env/*.example`, docs and test fixtures. Wired into CI and the pre-push gate.
- [ ] Loader fails fast listing every missing required variable; unset optional variables derive the
      documented defaults.
- [ ] Terraform plan/apply succeeds against a **scratch project** with only `.env` values changed (proves
      nothing is baked in).
- [ ] Renaming `DATIQ_PROJECT_CODE` in `.env.staging` changes every name in `terraform plan` output
      (one-variable rebrand test).
- [ ] No secret value ever appears in a script, `.tf` file or Cloud Build YAML — only in `.env.<env>`
      (gitignored) and Secret Manager.

## 10. Where this lands in the phases

- **Phase 0:** `.env.local.example` + env-loader + compose wiring; parameterisation test runs locally.
- **Phase 1a:** `.env.staging.example` / `.env.prod.example`, `secrets.manifest`, Terraform modules + roots,
  `bootstrap-secrets.sh`, `gen-tfvars.sh`, `gen-firebase-config.mjs`, grep gate wired into `gcp-staging.yml`.
- **Cutover:** only `.env.prod` values change (Supabase→Cloud SQL block, JWT secret, base URLs) — scripts
  untouched.

## 11. Configuration & mapping report card (audited 2026-10-02)

What every kind of configuration used to be on **Netlify + hosted Supabase**, where it lives on **GCP**, and what changed. Audited three independent ways (code → deploy, live Netlify site → deploy, `.env.<env>` completeness) by the repeatable script `deployment/scripts/gcp/env-parity.mjs` (§11.6).

### 11.1 Where each class of configuration went

| Class | Was (Netlify / hosted Supabase) | Now (GCP) | Mechanism | Status |
|---|---|---|---|---|
| Server secrets (service key, AI/scrape keys, Razorpay/Stripe, Resend, n8n, engagement, PageSpeed, Perplexity, admin PIN) | Netlify env (Functions scope) | Secret Manager `datiq-vsp-sm-<name>-<suffix>`, mounted on **api + jobs** | `deployment/gcp/secrets.manifest` → `bootstrap-secrets.sh` (values from `.env.<env>`) | **Changed:** +`ENGAGEMENT_RESEND_API_KEY`, `ENGAGEMENT_UNSUBSCRIBE_SECRET`, `PAGESPEED_API_KEY`, `PERPLEXITY_API_KEY` (were missing) |
| Non-secret runtime env (budgets, mail senders, kill switches, purge interlocks, invoice supplier, engagement settings) | Netlify env | Cloud Run env-vars on **api + jobs** | `deploy-run.sh` `APP_ENV_VARS` + an optional block forwarded only when non-empty | **Changed:** ~30 variables added (§11.2) |
| Platform emulation (`URL`, `SITE_URL`, `DEPLOY_URL`, `CONTEXT`, `BRANCH`) | Injected by Netlify | Set from `APP_BASE_URL`, `APP_CONTEXT`, `GIT_BRANCH` | `deploy-run.sh` | Unchanged mapping |
| Browser Supabase pair (URL + anon key) | `public/runtime-config.js` hosted pair | `dist/runtime-config.js` patched to **same-origin** + `.env` anon key when `DATA_MODE=cloud-sql` | `deploy-hosting.sh` `patch_dist_runtime_config` | **Changed** — see §11.3 |
| Build-time `VITE_*` | Netlify build env | `.env.<env>`, exported for `npm run build` | `deploy-hosting.sh` | **Changed:** supabase pair pinned, prod refuses an empty or test (`*_test_*`) Razorpay key, missing keys added |
| Auth settings (providers, SMTP, site URL, redirect allow-list, JWT expiry, autoconfirm) | Supabase dashboard | `GOTRUE_*` env on the **auth** Cloud Run service | `deploy-run.sh … auth` | **Changed:** see §11.5 |
| OAuth client secrets | Supabase dashboard | Secret Manager `…-<google\|azure\|github>-oauth-client-secret-…` (auth service only) | `bootstrap-secrets.sh` | New |
| SMTP password | Supabase-managed mail | Secret Manager `…-gotrue-smtp-pass-…` (auth only) | `bootstrap-secrets.sh` (`GOTRUE_SMTP_PASS`, else `RESEND_API_KEY`) | New |
| Database | Hosted Postgres | Cloud SQL `datiq-vsp-sql-datiq-<env>` | `cutover-*db.sh` | Staging done; prod pending |
| PostgREST / REST API | Hosted PostgREST behind Kong | PostgREST Cloud Run, proxied at `/rest/v1` | `deploy-run.sh … rest` | Staging done |
| Crons | `netlify.toml` schedules | Cloud Scheduler (13 jobs, OIDC) | `crons.sh` | Staging **paused** until `finish-crons`; prod pending |
| Webhooks in (Razorpay, Stripe, Resend/engagement, n8n) | Pointed at Netlify host | Must point at the GCP host | Provider consoles (manual) | Prod pending (doc 09 §4) |
| Domains | `datiq.app`→Netlify; `api.datiq.app`→Supabase custom auth domain | Firebase Hosting custom domains | Firebase console + registrar | Staging `stg.datiq.app` done; prod pending |

### 11.2 Variables that were missing and are now carried

All exist on the Netlify site today (identical in the `production` and `staging` contexts) and were **not** reaching Cloud Run before 2026-10-02:

| Variable(s) | Netlify value | Why it mattered |
|---|---|---|
| `DISABLE_AUDIT_AI`, `DISABLE_AI_CITATION_SAMPLING`, `DISABLE_PAGESPEED` | all `1` | **Behaviour change risk:** these are kill switches that are ON in production. Omitted on GCP they would silently turn three paid features on. Now carried as `1`. |
| `PURGE_DRY_RUN`, `PURGE_MAX_USERS_PER_RUN` | `1`, `1` | Safety interlocks for the only destructive job. `PURGE_ENABLED` stays `0`; if ever armed, dry-run and a cap of 1 apply. |
| `SUPPLIER_LEGAL_NAME`, `SUPPLIER_GSTIN`, `SUPPLIER_ADDRESS`, `SUPPLIER_STATE` (+ optional `…_TRADE_NAME`, `…_COUNTRY`, `…_EMAIL`, `…_PAN`) | name set; GSTIN/address/state blank | Decides invoice type: GSTIN set → "Tax Invoice"; unset → "Payment Receipt". Legal name was missing from every GCP invoice. |
| `AUDIT_BUDGET_MS` | `20000` | Discoverability audits ran with the 8 s default (thinner evidence) on GCP. |
| `ALERT_/BILLING_/CONTACT_/EXPORT_/FORM_EMAIL_FROM` | the code defaults | Equal to the in-code defaults today, but a future sender change would have been ignored on GCP. |
| `PERPLEXITY_MODEL`, secrets `PERPLEXITY_API_KEY`, `PAGESPEED_API_KEY` | `sonar`, masked | Citation sampling and Core Web Vitals had no key on GCP. (Both features are switched off by the kill switches above; the keys are staged for when they are re-enabled.) |
| `OPS_ALERT_EMAIL`, `PERMITTED_HOSTS`, `*_BUDGET_MS` tuning | optional | Forwarded when set. |
| `ENGAGEMENT_*` (public URL, sender domains, allow-list, mock-send, budgets; secrets API key, webhook secret, unsubscribe secret) | set on Netlify | Engagement is **enabled** on GCP staging and prod. Webhook secret and API key still need values (§11.5). |
| `VITE_PAYMENT_PROVIDER`, `VITE_LINK_ABOUT/BLOG/PRICING`, `VITE_RAZORPAY_PLAN_*` | `auto`, `https://datiq.app/…`, plan ids | Build-time; previously fell back to a developer's local `.env`. |

### 11.3 Two mapping fixes worth understanding

1. **The browser must call the self-hosted auth, not hosted Supabase.** `public/runtime-config.js` is committed with the hosted pair (a test forbids committing the flip). The cutover scripts patched it for *one* deploy, so every later `deploy-hosting.sh` put the browser back on hosted Supabase — OAuth then used the hosted project's callback and Google/Microsoft/GitHub answered `redirect_uri_mismatch`. `deploy-hosting.sh` now patches `dist/runtime-config.js` (never the committed file) whenever `DATA_MODE=cloud-sql`: staging → `_stagingSupabase*`, prod → `_prodSupabase*`, URL = `window.location.origin`, key = `SUPABASE_ANON_KEY`, signature-checked against `JWT_SECRET`. Prod stays `hosted-supabase` (untouched) until `cutover-db.sh` flips `DATA_MODE`, which it does *before* it calls `deploy-hosting.sh`.
2. **Build-time fallbacks.** `VITE_SUPABASE_URL/ANON_KEY` are now pinned from `SUPABASE_URL/ANON_KEY`, and a prod build is refused if `VITE_RAZORPAY_KEY_ID` is empty or a test key.

### 11.4 Deliberately NOT carried (retired / Netlify-only)

`AWS_LAMBDA_JS_RUNTIME`, `NODE_VERSION`, `SECRETS_SCAN_OMIT_KEYS`, `SECRETS_SCAN_OMIT_PATHS` (Netlify build/runtime plumbing) · `SCHEDULE_ALERT_WEBHOOK` (retired by the v2 workflow pipeline) · `SCRAPE_PROVIDER_ORDER1` (typo duplicate, read by nothing) · `SUPABASE_PROJECT_NAME` (label) · **`SUPABASE_ACCESS_TOKEN`** (Management API token; no function reads it — it should also be removed from the Netlify site) · `DEPLOY_PRIME_URL`. Each is listed with its reason in `env-parity.mjs`.

### 11.5 Authentication & email — what changed and what is still open

| Item | State |
|---|---|
| OAuth callback | Always `${APP_BASE_URL}/auth/v1/callback` (staging `https://stg.datiq.app/…`; prod = shadow host until the flip, then `https://datiq.app/…`). One GitHub OAuth app per environment (GitHub allows one callback). |
| OAuth client secrets | Must be the secret **value**, not the secret ID (Azure rejects the ID with `AADSTS7000215`). |
| SMTP | Resend SMTP (`smtp.resend.com:465`, user `resend`, sender `hello@datiq.app`). `deploy-run.sh` refuses `GOTRUE_MAILER_AUTOCONFIRM≠true` without SMTP. Hosted dashboard email templates were **not** migrated (GoTrue defaults apply). |
| Engagement webhook | Resend `whsec_…` is per endpoint host: staging needs a **new** Resend webhook for `https://stg.datiq.app/api/engagement-webhook?provider=resend`; prod keeps the existing endpoint (same URL after the flip). |
| Engagement unsubscribe | Signed with `ENGAGEMENT_UNSUBSCRIBE_SECRET`; prod must reuse Netlify's value or links already sent stop verifying. |
| `api.datiq.app` | Today a CNAME to the prod Supabase project (custom auth domain). After the flip it must be a Firebase Hosting custom domain answering `/auth/v1/**` + `/rest/v1/**` (doc 09 §5). The public REST API was always `https://datiq.app/api/v1` — the docs, operator playbook and browser extension said `api.datiq.app/v1`, which 404s; corrected 2026-10-02. |

**Owner to-do before enabling the related features:** engagement webhook secret + `ENGAGEMENT_RESEND_API_KEY` (staging and prod) · prod `ENGAGEMENT_UNSUBSCRIBE_SECRET` (= Netlify's) · `PAGESPEED_API_KEY`, `PERPLEXITY_API_KEY` · `GUEST_ID_SALT` (empty in `.env.prod`) · `SUPPLIER_GSTIN/ADDRESS/STATE` once registered · replace the Azure secret ID with its value · GitHub client secret for staging.

### 11.6 Re-run the audit

```bash
node deployment/scripts/gcp/env-parity.mjs prod      # or: staging
# 1. code reads  vs what GCP supplies      2. live Netlify site vs GCP (+ VITE_*)      3. blank-but-carried
# exit 1 = a parity gap; run it before AND after the prod cutover
```
