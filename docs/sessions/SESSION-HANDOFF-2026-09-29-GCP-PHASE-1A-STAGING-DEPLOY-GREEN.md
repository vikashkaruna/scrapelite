# Session Handoff — 2026-09-29 — GCP-PHASE-1A-STAGING-DEPLOY-GREEN

> **Branch:** `docker-desktop-build` @ (pre-commit state; images tagged `ad655d1b`)
> **Target:** `docker-desktop-build` (branch-local; push to staging branch = owner's call)
> **Status:** Phase 1a executed end-to-end, **all gates green**

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | `ad655d1b` was the image build sha; session commits land on top |
| **Status** | Complete & verified — **GCP staging live: https://datiq-vsp-fhs-stg.web.app** |
| **Pre-Push Gates** | edge smoke **13/13**, parameterisation gate green, firebase-config unit tests 11/11, `npm run test:all` green (log: `/tmp/test-all.log` for this machine) |
| **Active Focus** | Phase 1a of the GCP migration (doc 05 §3a): Firebase Hosting + Cloud Run + Cloud SQL staging deploy, executed for real, artifacts kept for ALL later phases |
| **Operator checklist** | **`docs/plans/gcp-docker-migration/08-STAGING-DEPLOY-RUNBOOK.md` §3 — the authoritative "things you must take care of" list** |

---

## 2. What Was Accomplished

### Executed (not just prepared) — the full Phase 1a chain
- **Bootstrap** (`deployment/scripts/gcp/bootstrap.sh` + `bootstrap-secrets.sh`): APIs, AR repo `datiq-vsp-ar-images-stg`, 4 SAs, App Engine app (Scheduler requirement, asia-south1), Firebase web app + Hosting site `datiq-vsp-fhs-stg`, 17 secrets from `secrets.manifest`.
- **Images** (Cloud Build `build-images.yaml`, tag = git sha): api/admin/trackers; GoTrue/PostgREST mirrored to AR via `stage-third-party.yaml` (Cloud Run cannot pull public.ecr.aws).
- **6 Cloud Run services**: `datiq-vsp-run-{api,jobs,admin,trackers,auth,rest}-stg`. api/admin/trackers **public** (`--allow-unauthenticated`, Netlify parity — deliberate deviation from the plan's IAM-only posture, documented in deploy-run.sh header); jobs OIDC-only; auth/rest IAM-gated proof services with Cloud SQL unix-socket URLs.
- **DB migration** (`migrate-db.sh`): Cloud SQL `datiq-vsp-sql-datiq-stg` (POSTGRES_16, db-custom-1-3840) ← dev Supabase dump (schema via supabase CLI fallback to Phase 0 dumps). **127 tables / 127 RLS-enabled / 29 extractions**, extensions in `extensions` schema, role passwords set, **GoTrue migrated 23 auth tables from zero** on a clean `auth` schema.
- **13 Scheduler jobs** (`deploy-scheduler.sh` + `gen-scheduler-jobs.mjs`): 1:1 with netlify.toml schedules, OIDC + `x-datiq-cron-token`. GCP staging runs `OPS_JOBS_DISABLED=1` — **Netlify staging still owns crons** (parallel-run rule).
- **Firebase Hosting** (`deploy-hosting.sh` + `gen-firebase-config.mjs`): static payload + rewrites; **edge smoke 13/13** at https://datiq-vsp-fhs-stg.web.app.
- **Prod artifacts ready, NOT run**: `promote-prod.sh`, `cutover-db.sh`, `.github/workflows/gcp-staging.yml`, prod site naming + runtime-config routing (`_GCP_PROD_HOSTS`) all in place (runbook §5).

### Fixes landed this session (root causes worth remembering)
1. **Firebase 301s extensionless URLs to trailing slash** (`/pricing` → `/pricing/`) and it fires **before rewrites**, so per-route rewrites alone cannot prevent it. Fix: `"trailingSlash": false` in the generated hosting config (one canonical extensionless form, slash form 301s back — stricter than Netlify, SEO-neutral-or-better). Help path emits extensionless source.
2. **`/` served the SPA shell, not the prerendered home.** Fix: `deploy-hosting.sh` payload prep replaces `dist/index.html` with `dist/home/index.html` and ships the SPA shell as `/__shell/index.html` (backs the `/**` fallback). Firebase rewrites never beat real files — the swap must happen in the payload.
3. **`env_vars_file()` collision in `deploy-run.sh`**: every caller wrote the same `env-vars-$ENV.json` path, so rest's PGRST file overwrote the app env file → **api/jobs deployed with only 3 env vars** (`supabase not configured` 503s). Fix: per-caller filenames (`env-vars-$ENV-{app,rest}.json`). Any Cloud Run service showing missing env vars → rerun `deploy-run.sh staging api jobs`.
4. **workflow-orchestrator is POST-only AND token-gated** (Bearer `ADMIN_TOKEN_SECRET` / `WORKFLOW_ORCHESTRATOR_TOKEN`, or `x-datiq-signature`) — even `/ping`. Smoke now asserts unauthenticated → 401 (gate holds) and Bearer-authenticated → `pong` (full path). The 401-on-anon is correct Netlify-identical behaviour, not a regression.
5. **Shebang breaks Vitest transform**: `gen-firebase-config.mjs` started with `#!/usr/bin/env node`; Vite injected `/@vite/client` before it → parse error when imported by tests. Removed (script is only ever run via `node`).
6. bash 3.2 traps (macOS): `export ARR=(...)` destroys arrays; `${var,,}` unsupported (use `tr`). Cloud Build substitutions must all be used in the template. `gcloud services enable` takes no `--region`.

---

## 3. Verification Evidence

- `./deployment/scripts/gcp/smoke.sh staging` → **13 passed, 0 failed** (prerendered home, /pricing, /vs/firecrawl, /faq, /help + canonical 301, retired-URL 301, SPA fallback, security header, admin noindex, runtime-config routing, API auth gate, authed ping → pong)
- `node deployment/scripts/check-parameterisation.sh` → green
- `npx vitest run deployment/tests/firebase-config.test.mjs` → **11/11** (updated for the new rewrite model: no `/` rewrite, `trailingSlash:false`, per-route extensionless rewrites, `/__shell` fallback)
- `npm run test:all` → 10/10 suites green (readiness, unit, contract, integration, system, db, build, prerender integrity, security, Playwright smoke)
- DB: 127 tables / 127 RLS / 29 extractions verified inside `migrate-db.sh` §8
- Staging live check: `curl https://datiq-vsp-fhs-stg.web.app/` → prerendered `<h1`; `/api/workflow-orchestrator/ping` unauth → 401, authed → `{"ok":true,"pong":true}`

---

## 4. Open Items for Next Session / Operator

**Owner (blocking sign-in testing on the new host) — full detail in runbook §3:**
- [ ] Supabase dev project → Auth → URL Configuration → add `https://datiq-vsp-fhs-stg.web.app` to Additional Redirect URLs (§3.1)
- [ ] GitHub Environment `gcp-staging` secrets (`GCP_SA_KEY` + env secrets) if CI deploys are wanted (§3.4)
- [ ] Netlify Edge Access bypass for `/api/*` on branch previews (carried over, §3.3)
- [ ] Decide whether to park Cloud SQL between test windows (`--activation-policy=NEVER`, §3.7)

**Next agent:**
- [ ] Await owner testing of local + staging; production phases (2/3) stay NOT executed
- [ ] At cutover: JWT_SECRET must come from the production Supabase project (§3.5) — staging one is generated
- [ ] Cron ownership flip rules when GCP takes over (§3.6; never both sides enabled)
- [ ] Post-cutover: `DATA_MODE=cloud-sql` in `.env.prod` + hosting redeploy emits `/auth/v1/**` + `/rest/v1/**` rewrites (unit-tested)
- [ ] Push discipline: this branch is `docker-desktop-build`; promoting to the `staging` branch is the owner's call
