# 05 — Implementation Plan (v2, two phases)

**Date:** 2026-09-28 · **Branch:** `docker-desktop-build` · **Status:** Phase 0 **IMPLEMENTED & VERIFIED locally (2026-09-28, `d14dff1d`)** — smoke 16/16, signon E2E green, staging→local migration rehearsed. Step 0 compat release **shipped to production** (PRs #241/#242). Phase 1a not started.

**Implementation deviations from this plan (all deliberate, see session handoff):**
- `db`/`auth`/`rest` use upstream images directly (`supabase/postgres:17.6.1.165`, `supabase/auth`, `postgrest/postgrest`) instead of custom Dockerfiles — better provenance, nothing to maintain.
- `jobs` and `scheduler` reuse the **api image** with different commands/entrypoints — exactly how Cloud Run will reuse the one Artifact Registry image.
- Added a `db-passwords`/schema-init one-shot (supabase/postgres role-password + `auth.users.role` quirks — see session handoff root causes).
- Phase 0 checklist status: all boxes verified except the optional contract-test-runner profile (handler contract tests already cover the 75 functions; adapter is validated live by stack-smoke) and the full `local-db` qualification (deferred per doc 07).

**Date:** 2026-09-28 · **Branch:** `docker-desktop-build` · **Status:** draft — **do not implement until owner confirms**

Two phases only, per owner decision: **Phase 0 = local Docker Desktop run & test**, **Phase 1 = GCP deploy &
test → parallel run → migrate DB, users, domain**. No week slicing; effort estimates in working days are in
the impact assessment (§8).

---

## 0. Proposed `deployment/` folder structure (replaces the prior plan's sketch)

```
deployment/
├── README.md                          # how to run local, how deploys work
├── adapter/                           # Netlify-event ⇄ HTTP compatibility layer
│   ├── server.mjs                     # Node 24 HTTP server mounting all 75 handlers
│   ├── event-adapter.mjs              # req → Netlify event (raw body, splats, query)
│   ├── response-adapter.mjs           # Netlify response → HTTP (headers, status, body)
│   └── routes.manifest.json           # /api/* mapping (mirrors netlify.toml API redirects)
├── docker/
│   ├── gateway/{Dockerfile,nginx.conf}
│   ├── web/Dockerfile
│   ├── admin/Dockerfile
│   ├── trackers/Dockerfile
│   ├── api/Dockerfile
│   ├── jobs/Dockerfile
│   ├── auth/Dockerfile                # GoTrue
│   ├── rest/Dockerfile                # PostgREST
│   ├── db/{Dockerfile,init/*.sql}     # postgres:16 + roles/pgcrypto init
│   └── migrator/Dockerfile
├── gateway/                           # shared parity configs (redirects/headers/precedence),
│   │                                  #   included by gateway/web/admin/trackers images
│   └── parity.mjs                     # generates rules from scripts/site-routes.mjs
├── compose/
│   ├── compose.yaml                   # base services
│   ├── compose.local.yaml             # full supabase-lite profile (db+auth+rest+mailpit)
│   ├── compose.shared-db.yaml         # use hosted Supabase instead of local db/auth/rest
│   └── compose.test.yaml              # test-runner profile (existing suites vs stack)
├── env/
│   ├── .env.local.example             # sample values + instruction notes → copy to .env.local
│   ├── .env.staging.example           # → .env.staging
│   ├── .env.prod.example              # → .env.prod
│   └── README.md                      # the env-file contract (doc 06)
├── gcp/
│   ├── cloudbuild/{api,web,admin,trackers}.yaml   # substitutions (_VARS) only — values from .env
│   ├── run/services.md                # service → image → env → ingress matrix (names per doc 06)
│   ├── scheduler/jobs.yaml            # 13 Cloud Scheduler jobs (OIDC)
│   ├── secrets.manifest               # runtime var ↔ secret resource name map (names only, no values)
│   ├── firebase.json + firebaserc.template        # rendered by gen-firebase-config.mjs from .env
│   └── scripts/{deploy-staging.sh,promote-prod.sh,bootstrap-secrets.sh}
├── terraform/
│   ├── modules/{project-services,artifact-registry,cloud-run,cloud-sql,secrets,service-accounts,scheduler,firebase,monitoring}
│   └── envs/{staging,production}/     # roots — every value via TF_VAR_* from env-loader (doc 06)
├── scripts/
│   ├── lib/env-loader.sh              # sources .env.<env>, validates, derives names, exports TF_VAR_*
│   ├── gen-tfvars.sh / gen-firebase-config.mjs / gen-runtime-config.mjs
│   ├── check-parameterisation.sh      # grep gate: zero literals outside env/*.example (doc 06 §9)
│   └── up.sh / down.sh / smoke.sh / migrate.sh / parity-check.sh
└── tests/
    ├── stack-smoke.spec.mjs           # end-to-end against localhost:8080
    ├── routing-parity.spec.mjs        # reuses page-ownership expectations
    ├── adapter.contract.spec.mjs      # runs netlify/__tests__ harness against adapter
    └── scheduler.spec.mjs             # 13 jobs fire locally, auth enforced
```

Plus two new CI files (`.github/workflows/gcp-staging.yml`, `gcp-prod.yml`). **Nothing outside `deployment/`
changes except the compat list below.**

## 1. Step 0 — Compat release to Netlify (first PR, ~6 files, behaviour-neutral)

1. `src/lib/paymentService.js` — `/.netlify/functions` → `/api`.
2. `src/lib/integrationsClient.js` — same normalisation.
3. `src/lib/adminService.js` — `/.netlify/functions/admin-auth` → `/api/admin-auth`.
4. `public/runtime-config.js` — add GCP host entries (staging URL → dev Supabase; shadow/prod URL → prod
   Supabase), add `posthogKey` so the hardcoded fallback key stops applying everywhere.
5. `src/lib/alertService.js` — fix stale absolute pricing URL → relative.
6. *(optional)* `src/lib/apiClient.js` — runtime-overridable `BASE` (default `/api`).

Ship through the normal staging → main gate. Netlify behaviour is unchanged (the `/api` alias already
exists; Netlify hostnames are untouched). From this point both platforms run identical code.

**Pre-work housekeeping (same window):** confirm the production deploy is current — the 2026-09-25 session
log records that PR #238 (Lambda 6 MB fix) is merged to staging but prod requires the manual unlock/relock
dance. The GCP shadow must shadow *real* prod code.

## 2. Phase 0 — Local Docker Desktop run & test

### Deliverables
1. `deployment/` skeleton + all 10 Dockerfiles.
2. Env-file contract: `.env.local.example` (sample values + notes), `scripts/lib/env-loader.sh`, and the
   parameterisation grep gate — every script sources the loader; no other file holds values (doc 06).
3. Adapter server + routes manifest; contract tests run against it (reuse `netlify/__tests__` harness).
4. Compose base + `local` (supabase-lite: db+auth+rest+mailpit) + `shared-db` + `test` profiles, fully
   `${VAR}`-interpolated and run with `--env-file deployment/env/.env.local`.
5. Gateway parity configs generated from `scripts/site-routes.mjs` + `netlify.toml`
   (46 redirects, 28 header rules, forced `/` rewrite, precedence).
6. Migrator container applying `supabase/migrations/` from zero (guarded rerun).
7. Jobs container + local scheduler simulator firing all 13 schedules with token auth.
8. Payment webhook validation locally: Stripe/Razorpay test-mode webhooks → adapter (raw body) →
   `payment-webhook.js` (existing contract tests + one live test-mode event).
9. Stack smoke + routing parity + scheduler + parameterisation tests in `deployment/tests/`.

### Phase 0 acceptance checklist
- [ ] Clean checkout → `deployment/scripts/up.sh` → full stack on `http://localhost:8080`.
- [ ] All 85 migrations apply from zero; rerun is safe.
- [ ] Signup / login / OAuth / reset / refresh work against local GoTrue.
- [ ] Public pages, prerendered pages, help site, 46 redirects identical to Netlify (parity test green).
- [ ] App flows (extract, preview, dashboard, schedules, watchlists) work; admin PIN flow works.
- [ ] `shared-db` profile validated against the **dev** Supabase project (the Phase 1 mode).
- [ ] Existing suites green: unit, contract (against adapter), integration, system, Playwright smoke.
- [ ] 13 cron jobs fire locally; unauthenticated calls rejected; `OPS_JOBS_DISABLED` ownership flag proven.
- [ ] Payment webhooks verify signatures with raw bodies.
- [ ] No real secrets in images or compose files.
- [ ] `.env.local` alone drives the stack: changing `DATIQ_PROJECT_CODE` / `COMPOSE_PROJECT_NAME` in it
      renames every container and image (parameterisation proof, doc 06 §9).

## 3. Phase 1 — GCP deploy, test, parallel run, cutover

### 3a. Staging infrastructure & deploy

All values come from `deployment/env/.env.staging` (doc 06); the names below are the shipped defaults for
project `vikash-saas-project`, region `asia-south1` (Mumbai). Operators edit only the env file; Terraform
and scripts read `TF_VAR_*`/env vars from the loader.

| Item | Choice (default names per doc 06) |
|---|---|
| Edge | **Firebase Hosting** site `datiq-vsp-fhs-stg` (redirects + rewrites to Cloud Run + headers) — default; Cloud Run gateway behind a Global LB is the documented alternative |
| API | Cloud Run `datiq-vsp-run-api-stg` (api image, min-instances 0, concurrency 80, ingress: internal+hosting) |
| Jobs | Cloud Run `datiq-vsp-run-jobs-stg` (**no public ingress**, Scheduler OIDC only) |
| Auth/Rest | Cloud Run `datiq-vsp-run-auth-stg` (GoTrue), `datiq-vsp-run-rest-stg` (PostgREST) — proves the target model against staging data |
| Admin/Trackers | Cloud Run `datiq-vsp-run-admin-stg` + `datiq-vsp-run-trackers-stg` (small nginx images behind hosting rewrites) — keeps the per-surface separation on GCP |
| DB | Cloud SQL `datiq-vsp-sql-datiq-stg` (Postgres 16; loaded from **dev** Supabase dump to prove dump/restore mechanics early) |
| Scheduler | 13 jobs `datiq-vsp-sch-<fn>-stg`, OIDC ID tokens |
| Secrets | Secret Manager `datiq-vsp-sm-<key>-stg`, bootstrapped from `secrets.manifest` (names only) by `bootstrap-secrets.sh` |
| Images | Artifact Registry `datiq-vsp-ar-images-stg`, built by Cloud Build triggers `datiq-vsp-cb-<unit>-stg` (substitutions from .env) |
| CI | `gcp-staging.yml` → Cloud Build (4 images) → deploy → parity + Playwright via `PW_BASE_URL` |

### 3b. Parallel run (the two-URL window)
- **gcp-shadow** URL = production-twin: web/admin/trackers/api/jobs pointing at the **prod** hosted Supabase.
- Cron ownership stays with Netlify (`OPS_JOBS_DISABLED=1` on shadow) until shadow is validated; then flip
  ownership to GCP while Netlify's TOML schedules are commented — **never both**.
- Soak checklist on shadow: auth incl. OAuth round-trips, extraction provider chain, payments (test-mode keys
  per env), email via Resend test domain, n8n orchestrator round-trip, admin screens, monitoring screens.
- Fix-forward on shadow; Netlify prod untouched throughout.

### 3c. Cron mapping (13 jobs, 1:1)
| Function | Netlify schedule | Cloud Scheduler |
|---|---|---|
| `scheduled-runner` | hourly | hourly, OIDC |
| `health-monitor` | hourly | hourly, OIDC |
| `watchlist-monitor` | hourly | hourly, OIDC |
| `bulk-runner` | */5 min | */5, OIDC |
| `engagement-dispatcher` | */5 min | */5, OIDC |
| `signal-retry` | */5 min | */5, OIDC |
| `workflow-orchestrator-cron` | */5 min | */5, OIDC |
| `sxo-analytics-import-worker` | */5 min | */5, OIDC |
| `reengagement` | daily | daily, OIDC |
| `billing-lifecycle` | daily | daily, OIDC |
| `billing-purge` | daily | daily, OIDC |
| `discoverability-monitor` | daily | daily, OIDC |
| `prompt-monitor` | daily | daily, OIDC |

### 3d. Cutover window (DB + users + domain, ~2–4 h)
1. Announce + pause write-heavy crons (freeze).
2. `pg_dump` prod Supabase (schema + data + `auth` schema) → restore into production Cloud SQL (roles pre-created; RLS travels).
3. Repoint `datiq-auth` (GoTrue) + `datiq-rest` (PostgREST) at production Cloud SQL using the **same JWT secret** → existing sessions stay valid; smoke auth immediately.
4. Repoint `datiq-api` env to the self-hosted trio (Secret Manager update + revision deploy).
5. Full smoke on the shadow URL, now on Cloud SQL (`smoke.sh` + payment test events + one n8n round-trip).
6. Update external parties per impact doc §6 (Stripe/Razorpay/Resend webhook URLs, OAuth redirect allow-lists for `api.datiq.app` under GoTrue, n8n callback).
7. **Flip DNS**: `datiq.app`, `www`, `api.datiq.app` → Firebase Hosting / GCP. Verify TLS.
8. Keep Netlify deployed + old Supabase intact = instant DNS-revert rollback. Accept the documented caveat (accounts/payments created post-flip don't exist on the old stack).
9. After the rollback window: decommission Netlify deploys + hosted Supabase; retire the Netlify-coupled CI jobs.

### Phase 1 acceptance checklist
- [ ] Staging deploys fully from CI; all suites pass against its URL with `PW_BASE_URL`.
- [ ] Terraform plan/apply works against a fresh project using only `.env` values (bootstrap rehearsal);
      parameterisation grep gate green (doc 06 §9).
- [ ] Shadow soaks against prod Supabase with cron ownership proven in both directions.
- [ ] Image-digest promotion (no rebuild) used for prod.
- [ ] Dump/restore rehearsed twice (staging first) before prod cutover.
- [ ] Cutover executed: zero password resets, zero user-visible errors beyond the window.
- [ ] Post-flip: payments verified live, webhooks 200, n8n callbacks HMAC-verified, extension calls `api.datiq.app` OK.
- [ ] Rollback path (DNS revert) documented and rehearsed.
- [ ] Netlify decommission checklist executed after the window.

## 4. Explicitly NOT done in this initiative
- No refactor of `src/`, `netlify/functions/`, migrations, tests, prerender pipeline.
- No Vite multi-entry admin bundle split (optional later: 1–2 days).
- No hard-coded resource identifiers: Terraform **is** in scope (env-driven via `TF_VAR_*` from the .env
  contract, doc 06), and no script, compose file, Cloud Build YAML or `.tf` file embeds a literal.
- No docs/ reorganisation or AGENTS.md regeneration (separate docs-only change).
- No Supabase Storage/Realtime adoption (none exists today — keeps Cloud SQL portable).
