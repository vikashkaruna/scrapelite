# 03 — Business Requirements Document (BRD v2)

**Date:** 2026-09-28 · **Supersedes:** the two-phase draft in `DatIQ - Docker and GCP/` and the
`FIREBASE-MIGRATION.md` draft (2026-07-18) · **Status:** draft for owner confirmation

## 1. Business objective

Establish a fully containerised runtime for DatIQ — first locally in Docker Desktop, then on GCP — while the
existing Netlify production deployment keeps serving `datiq.app` **without interruption**. End state: GCP
runs the platform (app, API, jobs, database, auth), Netlify is retired after a rollback window, and the
only user-visible change is nothing at all (same domain, same accounts, same data).

## 2. Business drivers

1. **Infrastructure independence** — day-to-day testing and iteration must not require a Netlify deploy.
2. **Vendor risk reduction** — containers + standard PostgreSQL (self-hosted GoTrue/PostgREST) remove the
   platform coupling while keeping every integration (Stripe, Razorpay, Resend, Firecrawl, n8n) unchanged.
3. **Cost & operational control** — Cloud Run scale-to-zero + Cloud SQL matches the current traffic profile;
   n8n already proves the pattern (live on Cloud Run `asia-south1` today).
4. **Zero-downtime migration** — parallel deploys on different URLs, shared database during the parallel
   window, single cutover for DB + users + domain, instant DNS rollback.
5. **Separation of concerns in deployment** — admin, public web, trackers, API and jobs each get their own
   image so they can be built, released, restricted and scaled independently (explicit owner requirement).

## 3. What changed vs the prior plan (improvement log)

| Prior plan | v2 change | Why |
|---|---|---|
| One `api` container behind one gateway; surfaces not separated | **One Dockerfile per deployable unit** (web, admin, trackers, api, jobs, auth, rest, db, migrator, gateway) | Owner requirement; enables independent release and edge-level restriction of `/admin` |
| Single `deployment/` folder sketch with generic subfolders | Concrete structure keyed to the **audited codebase** (75 functions, 46 redirects, 28 header rules, 13 crons, runtime-config host branching) | The prior plan predated the codebase audit; several assumptions were wrong (e.g. functions need an `event`-envelope adapter, cron endpoints need auth Netlify gave for free) |
| Self-hosted GoTrue + Cloud SQL from the first GCP deploy | GCP stack points at **existing hosted Supabase** during the parallel window; DB/users migrate in the final cutover window | Two auth systems or two databases during parallel run would create divergence the owner explicitly wants to avoid ("later just want to migrate db, users and domain") |
| Firebase rewrite implied via `FIREBASE-MIGRATION.md` (rewrite functions to Cloud Functions 2nd gen) | **Adapter keeps all 75 handlers unchanged** on one Cloud Run service | Rewriting 75 functions × 150 contract tests is the highest-risk path; the adapter path touches ~0 lines of function code |
| No security treatment of scheduled functions | Cloud Scheduler + OIDC + `--no-allow-unauthenticated` jobs service; `OPS_JOBS_DISABLED` flag prevents double-cron during parallel run | Netlify currently blocks public HTTP to scheduled functions; losing that silently would expose `billing-purge` etc. |
| No compat-release concept | Explicit **Step 0**: ~6-file behaviour-neutral release to Netlify first | Guarantees both platforms run identical code for the whole parallel window |

## 4. Scope

**In scope**
- `deployment/` folder: adapter, Dockerfiles (one per unit), compose profiles, gateway parity configs, GCP
  deploy assets (Cloud Build + Cloud Run + Cloud SQL + Scheduler + Secret Manager), env examples, stack tests.
- Two new CI workflows for GCP (staging auto, prod manual-approval promote by image digest).
- One behaviour-neutral compat release to Netlify (see impact doc §2).
- Cutover runbook: DB dump/restore to Cloud SQL, GoTrue/PostgREST cutover, DNS flip, external-URL checklist,
  rollback procedure, Netlify decommission.

**Out of scope (unchanged from prior plan, confirmed)**
- No rewrite of `src/`, `netlify/functions/`, migrations, tests, prerender pipeline.
- No functional redesign, no product refactors, no documentation reorganisation (separate docs-only change later,
  including regenerating the stale root `AGENTS.md`).
- n8n stays as-is (already containerised, already on Cloud Run).
- Browser extension distribution unchanged (build only; `api.datiq.app` moves with the domain).

## 5. Constraints (non-negotiable)

1. `datiq.app` serves from Netlify, unchanged, until the DNS cutover — no brownouts.
2. Product code paths (`src/`, `netlify/`, `supabase/`, `e2e/`, `test/`, `scripts/`, `public/` prerendered
   content) are untouched except the compat-release list (impact doc §2).
3. Raw-body preservation for Stripe/Razorpay webhook signature verification — verified by existing contract
   tests plus a live test-mode webhook in staging.
4. The 13 cron jobs must never run concurrently from two stacks against the same database
   (`OPS_JOBS_DISABLED` gates ownership).
5. No secrets baked into images; all server env via Secret Manager (GCP) / local `.env` (Docker).
6. Exactly two execution phases: **Phase 0 = local Docker run & test**, **Phase 1 = GCP deploy & test →
   parallel run → migrate DB, users, domain**. No week-by-week slicing.

## 6. Success criteria

**Phase 0 (local)**
- `docker compose up` from a clean checkout brings up the full stack on `http://localhost:8080` (gateway).
- All 85 migrations apply from zero via the migrator container; rerun is safe/guarded.
- Signup / login / OAuth / password-reset / token refresh work against the local auth stack.
- Public pages, app flows, and `/admin` (PIN) work with no source changes; prerendered pages and the 46
  redirects behave identically to Netlify (parity test green).
- Existing suites (477 vitest files, contract tests incl. payment-webhook raw-body, Playwright smoke) pass
  against the local stack.
- Cron simulation fires all 13 jobs locally with auth enforced.

**Phase 1 (GCP)**
- Staging deploys end-to-end from CI; the 50 Playwright specs + smoke scripts pass against the staging URL
  using `PW_BASE_URL` (no test edits).
- A production-twin "shadow" URL runs against the live Supabase for a soak period with cron ownership on
  Netlify only, then (post-validation) on GCP only — never both.
- Cutover completes with: zero password resets, zero data loss, payments + webhooks verified post-flip,
  documented rollback executed once in rehearsal.
- Netlify decommissioned only after the rollback window closes with no incidents.
