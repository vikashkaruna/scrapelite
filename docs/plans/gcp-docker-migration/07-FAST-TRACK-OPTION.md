# 07 — Fast-Track Option ("no real users" scenario)

**Date:** 2026-09-28 · **Status:** option for owner confirmation · **Prerequisite reading:** docs 02, 05, 06

## 1. Why the full plan is sized the way it is — and why that sizing no longer applies

The 10–17 working-day estimate in doc 02 buys **protection for live users**. Four of its biggest chunks
exist only for that:

| Full-plan chunk | What it protects | Cost | Needed with 0 users? |
|---|---|---|---|
| Full Phase-0 fidelity (offline `local-db` stack qualification + exhaustive local parity tests) | Local-first confidence without touching any cloud | 2–3 d | Trimmed — the **local Docker Desktop deployment stays** (§2 step 2); only offline-DB qualification and exhaustive local parity testing are deferred to GCP staging, which validates routing more cheaply |
| Parallel prod-twin + soak window (shadow URL on real data) | Live users from a broken cutover | 1–3 d + calendar soak | No — there is nobody to break |
| Cloud SQL + GoTrue + PostgREST + dump/restore rehearsals (the DB/users migration) | Zero-downtime migration of real accounts/data | 1 d + rehearsals | **Deferred** — the owner already scoped this as "later"; with no users it carries zero urgency |
| Compatibility-release ceremony through the Netlify prod gate (unlock/relock) | Keeping Netlify prod current as the live fallback | 0.5–1 d | Reduced — Netlify prod becomes a stale rollback artifact; nothing needs to ship to it |

## 2. The fast track (recommended): ~6–8 focused working days, local Docker Desktop included

**Phase 0 — local Docker Desktop — is kept.** It is the dress rehearsal: the exact images and the adapter
that run locally are the ones deployed to GCP (retag + push, no rebuild). What's trimmed versus the full plan
is only *fidelity*: the optional offline `local-db` profile ships but isn't exhaustively qualified, and
exhaustive local routing-parity testing is done against GCP staging instead (via `PW_BASE_URL`).

| Step | Work | Days |
|---|---|---|
| 0 | **Compat changes straight to `main`** (the 6-file list, doc 02 §2). No Netlify-first ceremony: with no users, Netlify prod may lag; it is rollback-only now. GCP deploys from the same `main`. | 0.5 |
| 1 | **HTTP adapter** for the 75 function handlers + run the existing 150 contract tests against it. This is the one irreducible build — and the contract-test suite makes it fast (mechanical, no guesswork). | 1.5–2 |
| 2 | **Phase 0 — Local Docker Desktop:** all 10 Dockerfiles (gateway, web, admin, trackers, api, jobs, db, auth, rest, migrator) + compose profiles. Core stack on `http://localhost:8080`: gateway → web, admin, trackers (static), api (adapter), jobs + local cron simulator (13 jobs) + mailpit, running against the hosted **dev** Supabase (`DATA_MODE=shared-db`). Optional `local-db` profile adds Postgres + GoTrue + PostgREST + migrator for a fully offline stack. Acceptance: public pages, prerendered routes, app flows, admin PIN, login, one webhook signature check — all green locally. | 1–1.5 |
| 3 | **GCP infra, env-driven scripts or lean single-root Terraform** (doc 06 contract unchanged): Artifact Registry `datiq-vsp-ar-images-stg`, Cloud Run `datiq-vsp-run-api-stg` + `datiq-vsp-run-jobs-stg` (no public ingress), 13 Cloud Scheduler jobs with OIDC, secrets bootstrap. Same images as local — no rebuild, only retag/push. | 1–1.5 |
| 4 | **Firebase Hosting** `datiq-vsp-fhs-stg`: `firebase.json` (46 redirects, 28 header blocks, forced `/` → `/home/index.html`, SPA fallback) **generated from `scripts/site-routes.mjs`**; `runtime-config.js` rendered from `.env.staging`. | 0.5–1 |
| 5 | **Validate on GCP**: existing suites against the staging URL via `PW_BASE_URL`, `check-parameterisation` gate, routing-parity spot check, one manual pass over app flows, cron firing test. | 0.5–1 |
| 6 | **Cutover** (§4) — DNS flip + URL checklist. | 0.5 |
| | **Total** | **6–8** |

**Ultra-minimal variant (~3–4 days, no local Docker Desktop phase):** gcloud scripts only (no Terraform yet —
codify later), deploy the adapter + images straight to GCP without the local compose step, no admin/trackers
Cloud Run services (hosting serves their files from the same payload), validation cut to smoke + critical
flows. All naming/env conventions (doc 06) still apply. Choose this only if the local stack has no near-term
value — it forfeits the offline dev loop and the dress-rehearsal benefit.

## 3. Why this is safe even though it's fast

- **The adapter is tested, not trusted:** 150 contract tests (payment raw-body, entitlements, OpenAPI, n8n
  signatures) run against it before anything deploys.
- **Routing parity is generated + checked:** one source (`site-routes.mjs`) produces the firebase.json rules;
  the existing redirect tests can be pointed at the live GCP URL.
- **Cron safety is preserved:** jobs service has no public ingress; Scheduler OIDC required;
  `PURGE_ENABLED=0` until prod; Netlify keeps cron ownership until DNS flip (never double-running is
  irrelevant with no users, but the flag still prevents surprises).
- **Rollback remains trivial:** Netlify stays deployed; rollback = DNS revert (auth caveat below).

## 4. Cutover checklist (compressed, ~half a day)

1. Update OAuth provider redirect allow-lists (Google/Microsoft/GitHub) to include the GCP staging domain —
   do this *before* validation so login flows are testable there; the final `datiq.app` values are unchanged.
2. DNS flip `datiq.app` + `www` → Firebase Hosting site. TLS via managed certs.
3. **`api.datiq.app` needs care:** today it is both (a) the public developer API on Netlify and (b) the
   Supabase custom **auth domain**. Flip it to GCP for (a), and in the Supabase dashboard move the custom
   auth domain (e.g. to `auth.datiq.app` or the plain `*.supabase.co` URL), updating `runtime-config.js`
   accordingly — one env change + one dashboard change, but it must not be forgotten.
4. Update external webhook URLs (Stripe/Razorpay/Resend — test-mode today; n8n callback) to the new origin.
5. Verify: login, extract, admin PIN, one cron firing, webhook 200s, extension `api.datiq.app/v1` OK.
6. Leave Netlify deployed (rollback = DNS revert); disable its crons post-flip.

## 5. Explicitly deferred (with revisit triggers)

| Deferred | Revisit when |
|---|---|
| DB → Cloud SQL + self-hosted GoTrue/PostgREST (the "migrate db, users" step) | Real users exist, or Supabase pricing/limits demand it — the code is env-driven, so this stays a pure config+data-move exercise |
| Offline local-DB fidelity (qualifying the `local-db` profile — Postgres+GoTrue+PostgREST — as a first-class test target) | The team wants a fully offline dev loop / Cloud Run iteration feels slow — the profile itself ships in step 2; only its exhaustive qualification is deferred |
| Modular Terraform, shadow/soak phases, second GCP environment | Real users return; then re-derive from docs 05+06 — the naming/env contract already supports the `-stg` → `-prod` second environment (rerun scripts with `.env.prod`) |
| Netlify decommission | Rollback window closes (days, not weeks — nothing to protect) |

## 6. Estimate summary

| Track | Hands-on | Calendar |
|---|---|---|
| Full (docs 05+06 unchanged) | 11–17 d | multi-week |
| **Fast track (recommended)** | **6–8 d** | **~1.5 weeks** |
| Ultra-minimal (no local Docker Desktop phase) | 3–4 d | a few days |
