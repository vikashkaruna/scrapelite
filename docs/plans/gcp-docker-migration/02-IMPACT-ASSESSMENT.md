# 02 — Impact Assessment: what changes, where, and how much

**Verdict up front:** the migration is **additive and low-impact**. App-code changes total **~6 files /
<150 lines**, all behaviour-neutral for Netlify and shippable as one small "compat release" first. Every
other artifact (Dockerfiles, compose, adapter, gateway config, GCP infra, CI) is **new code in a new
`deployment/` folder** — the existing `src/`, `netlify/functions/`, `supabase/`, `e2e/`, `test/`, `scripts/`
trees stay untouched. Netlify and GCP can run in parallel on different URLs from day one of Phase 1.

---

## 1. Complete isolation — how the isolation is guaranteed

| Rule | Mechanism |
|---|---|
| No edits to product code paths | All new assets live under `deployment/` (+ 2 new CI workflow files). The only permitted app-code touches are the 6 files in §2. |
| Netlify keeps running untouched | Nothing in the Netlify deploy path changes: same `netlify.toml`, same functions, same build. The compat release (§3) changes no behaviour with default env. |
| GCP is a separate stack from day one | GCP gets its own URLs (Cloud Run / Firebase Hosting), its own env (Secret Manager), and — during the parallel window — points at the **existing hosted Supabase**, so there is no second database and no data divergence. |
| Same code both places | One codebase; Netlify builds `main`/`staging` as today; GCP builds the same commits via Cloud Build. The compat release makes both platforms byte-equivalent in behaviour. |

## 2. App-code changes (the complete list)

| # | File | Change | Size | Needed for | Netlify behaviour change? |
|---|---|---|---|---|---|
| 1 | `src/lib/paymentService.js:13` | `/.netlify/functions` → `/api` (Netlify already maps `/api/*`) | 1 line | Cloud Run (no `/.netlify/functions` there) | No |
| 2 | `src/lib/integrationsClient.js` | same path normalisation | ~2 lines | Cloud Run | No |
| 3 | `src/lib/adminService.js` | `/.netlify/functions/admin-auth` → `/api/admin-auth` | 1 line | Cloud Run | No |
| 4 | `public/runtime-config.js` | add GCP host entries to the hostname branch: GCP staging URL → dev Supabase, GCP shadow/prod URL → prod Supabase (plus a `posthogKey` field so the hardcoded fallback stops leaking to all envs) | ~10 lines | Any GCP URL (otherwise GCP stack silently uses the **dev** Supabase project) | No (Netlify hosts unchanged) |
| 5 | `src/lib/alertService.js:69` | fix stale `https://datiq.netlify.app/pricing` → relative `/pricing` | 1 line | Hygiene | No |
| 6 | *(optional, recommended)* `src/lib/apiClient.js` | allow runtime override of `BASE` from `runtime-config.js` (default stays `/api`) | ~5 lines | Flexibility only — same-origin rewrites make it unnecessary on both hosts | No |

That is the whole app-side delta. Explicitly **not** needed:

- No rewrite of the 75 functions — a thin HTTP adapter (deployment asset) translates request → Netlify
  `event` envelope and back, preserving **raw bodies** (payment-webhook signature verification) and
  path-splat resolution.
- No Netlify-injected-env changes — the adapter supplies `URL`, `SITE_URL`, `DEPLOY_URL`, `CONTEXT`,
  `BRANCH` from Cloud Run env/Secret Manager (19/16/5/2 code refs, container-level env is enough).
- No DB/ORM changes — functions talk to Supabase via URL+keys from env; pointing them at hosted Supabase,
  then later at GoTrue+PostgREST+Cloud SQL, is pure configuration.
- No changes to `netlify.toml`, migrations, tests, or the prerender pipeline.

**"Push to Netlify first?" — yes, do it as Step 0.** Items 1–5 are behaviour-neutral on Netlify (the `/api`
alias already exists; Netlify host entries are untouched). Shipping them through the normal
staging→main gate first means: (a) both platforms run identical code for the whole parallel window,
(b) zero special-casing of "old prod code" during cutover, (c) the change is small enough to review in one PR.
This is the recommended option and matches your instinct.

## 3. Parallel-run model (two URLs, one dataset)

```
                       ┌──────────────────────────────┐
  datiq.app (DNS) ───► │ Netlify (untouched prod)      │ ──┐
                       │  - SPA + prerendered + edge   │   │    same hosted Supabase
                       │  - 75 functions via /api/*    │ ──┤──►  (prod project sikkf…,
                       └──────────────────────────────┘   │     auth via api.datiq.app)
                       ┌──────────────────────────────┐   │
  gcp-staging URL ───► │ GCP Cloud Run + Firebase Host │ ──┘
  gcp-shadow  URL ───► │  - web/admin/trackers images  │
                       │  - api service (adapter)      │ ──► same Supabase (staging env →
                       │  - jobs (Scheduler+OIDC)      │      dev project; shadow → prod project)
                       └──────────────────────────────┘
```

Three GCP environments, in order:

1. **gcp-staging** — own URL, points at the **dev** Supabase project (exactly like Netlify branch deploys do
   today). Full E2E validation (the 50 Playwright specs already accept `PW_BASE_URL`).
2. **gcp-shadow (production twin)** — own URL, points at the **prod** Supabase project. Real data, real auth,
   read-side + write-side validation under real conditions, without touching `datiq.app`. Runs for as many
   days as you want.
3. **cutover** — one window: migrate DB → flip DNS. (§4)

**Why shared-Supabase during parallel run is safe here:** both stacks run the same code and the same schema;
the existing DB is the single source of truth; users/auth/entitlements behave identically on both URLs; and
webhook/reconcile jobs simply must not run twice — the plan keeps the 13 crons **enabled only on the stack
that owns them** (Netlify until cutover; GCP shadow gets them via a flag, verified in staging first).

## 4. DB, users, domain — the cutover sequence (one window, ~2–4 h)

1. **Freeze** (optional, minutes): pause `bulk-runner`/`engagement-dispatcher`-class crons; brief notice banner if desired.
2. **Dump** prod Supabase: full `pg_dump` (schema + data + `auth` schema + roles) from the prod project.
3. **Restore** into Cloud SQL (Postgres 16) with pre-created roles (`anon`, `authenticated`, `service_role`, `supabase_auth_admin` equivalent) — RLS and policies travel with the dump.
4. **Stand up GoTrue + PostgREST** on Cloud Run against Cloud SQL using the **same JWT secret** the Supabase project uses (exported from Supabase settings) so existing sessions/tokens stay valid.
5. **Repoint** the GCP stack env (Secret Manager) from hosted Supabase to the self-hosted trio; smoke-test auth (login, refresh, OAuth), extraction, billing read paths.
6. **Flip DNS**: `datiq.app` (+ `www`, `api.datiq.app`) → Firebase Hosting / GCP LB. TLS via managed certs.
7. **Rollback window (days):** Netlify stays deployed and pointed at the old hosted Supabase — instant rollback is a DNS revert. Caveat to accept: signups/payments made on GCP during the window would not exist on the old stack (keep the window short, or accept the reconciliation).
8. **Decommission** Netlify + hosted Supabase after the window.

Because self-hosted GoTrue *is* the Supabase auth service (same `auth` schema, same bcrypt hashes, same OAuth
identity links), **user migration is a database copy, not an account migration** — no password resets, no
re-verification emails, no OAuth re-consent (provider redirect allow-lists updated in §6 first).

## 5. What gets created (new, additive — the estimate)

| Asset group | Files | Notes |
|---|---|---|
| `deployment/adapter/` (HTTP↔Netlify-event server) | ~6 | Node 24, no new framework deps beyond express-or-equivalent; route manifest from netlify.toml; raw-body + splat handling; unit-tested by reusing the 150 contract tests' harness |
| `deployment/docker/` (one Dockerfile per unit) | 10 | gateway, web, admin, trackers, api, jobs, auth(GoTrue), rest(PostgREST), db(postgres+init), migrator |
| `deployment/gateway/` (routing parity configs) | ~4 | 46 redirects, 28 header blocks, forced `/` rewrite, SPA fallback precedence — generated from/validated against `scripts/site-routes.mjs` so `page-ownership.test.mjs` logic covers both |
| `deployment/compose/` | 4 | base + `local` (full supabase-lite) + `local-shared-db` (use hosted Supabase) + `test` |
| `deployment/gcp/` | ~16 | Cloud Build pipelines (substitutions-only YAML), Terraform modules + staging/prod roots (TF_VAR_*-driven), 13 Cloud Scheduler job definitions with OIDC, `secrets.manifest`, deploy/promote/bootstrap scripts |
| `deployment/scripts/` + `env/` examples | ~14 | up/down/smoke/migrate/promote + `lib/env-loader.sh`, `gen-tfvars.sh`, `gen-firebase-config.mjs`, `check-parameterisation.sh`; `.env.{local,staging,prod}.example` with sample values & notes |
| `deployment/tests/` | ~5 | stack-smoke, adapter contract runner, routing-parity test, scheduler simulation test, parameterisation grep gate |
| CI workflows | 2 new | `gcp-staging.yml` (build→deploy staging on merge), `gcp-prod.yml` (manual-approval promote by image digest); existing Netlify workflows untouched until decommission |
| **Total new** | **~55 files** | zero modifications outside §2 list |

## 6. External parties that hold our URLs (cutover-day checklist)

| Party | Today | Action at cutover |
|---|---|---|
| Stripe | webhook endpoint URL → `datiq.app/api/payment-webhook` | update endpoint URL (or keep domain — DNS flip makes it seamless if backend path parity holds; verify) |
| Razorpay | webhook URL | same |
| Resend (engagement) | delivery/bounce webhook → `/api/engagement-webhook` | same |
| n8n (Cloud Run instance) | calls back to `datiq.app/api/workflow-callback`; orchestrator posts to `N8N_BASE_URL` | DNS flip covers it; verify HMAC flow |
| OAuth providers (Google/Microsoft/GitHub) | redirect URIs → `datiq.app` + Supabase auth domain `api.datiq.app` | update when moving auth to self-hosted GoTrue under `api.datiq.app` |
| Chrome extension | `https://api.datiq.app/v1` | unchanged if `api.datiq.app` DNS flips with the domain |
| Zapier app + docs | endpoint docs referencing `datiq.app/api/v1` | DNS flip covers; verify docs |
| Sitemap/Search Console/llms.txt | same domain | unchanged |

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| GCP stack silently uses dev Supabase (runtime-config host branching) | Compat release item #4 + a stack-smoke assertion ("which project am I pointed at?") |
| Publicly reachable cron endpoints on Cloud Run | Jobs service is `--no-allow-unauthenticated`; Scheduler sends OIDC tokens; staging test proves 401 without token |
| Routing regression (46 redirects / precedence) | Generate gateway rules from `site-routes.mjs` + reuse `page-ownership.test.mjs` against the new edge in CI |
| Raw-body breakage in payment webhooks | Adapter preserves raw body; existing `payment-webhook` contract tests + a live Stripe/Razorpay test-mode webhook in staging |
| Dual-stack divergence (crons running twice) | Cron ownership flag (`OPS_JOBS_DISABLED` already exists in the codebase — use it) |
| Response-size/timeout differences | Cloud Run limits are more generous (32 MB); `responseBudget.js` stays as a no-op; revisit `*_BUDGET_MS` values post-cutover |
| Prod deploy state drift (main vs staging) | Pre-work: confirm `main` prod deploy is current (the 2026-09-25 session log notes prod needs manual unlock for PR #238) so GCP shadows the real prod code |

## 8. Effort estimate (working days, not calendar weeks)

| Chunk | Estimate |
|---|---|
| Step 0 compat release (§2) + ship through staging→main gate | 0.5–1 day |
| Phase 0: adapter + Dockerfiles + compose + gateway parity + local stack green | 3–5 days |
| Phase 0: smoke/parity tests + cron simulation + webhook signature validation locally | 1–2 days |
| Phase 1a: GCP staging (env contract + Terraform, Cloud Build, Cloud Run ×4–6 services, Cloud SQL dev-size, Scheduler, Secret Manager) | 4–5 days |
| Phase 1b: shadow validation against prod Supabase + fixes found | 1–3 days (+ soak time in parallel, not serial) |
| Cutover (DB dump/restore, GoTrue/PostgREST, DNS, external-URL checklist) | 1 day + rollback window |
| **Total hands-on** | **~11–17 working days**, with only Phase 0 blocking Phase 1; Netlify never stops |
