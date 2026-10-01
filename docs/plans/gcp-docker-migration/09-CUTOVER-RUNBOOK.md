# 09 — GCP Production Cutover Runbook (Phase 1c / Phase 3)

**Date:** 2026-09-29 · **Updated:** 2026-10-01 (staging executed — learnings fold into the prod script) · **Branch:** `docker-desktop-build` · **Status:** NOT EXECUTED — artifacts + scripts ready, awaiting owner sign-off after local + staging testing.

> ## 2026-10-01 UPDATE — THE PROD SCRIPT NOW CARRIES THE EXECUTED-STAGING LEARNINGS
>
> The staging cutover ran for real on 2026-10-01 (doc 12 §"Executed
> 2026-10-01"). Every structural fix landed in the **shared** scripts
> (`migrate-db.sh`, `deploy-run.sh`, `gen-firebase-config.mjs`,
> `deployment/adapter/server.mjs`) and in **`cutover-db.sh`** itself, so this
> runbook's window executes the corrected flow:
>
> - **`cutover-db.sh` is now 6 steps with a gated cron handoff** — it pauses
>   crons, migrates, verifies source-vs-target counts BEFORE any repoint,
>   repoints auth/rest (allowlist written first), repoints api/jobs via
>   `update-env.sh` (rides the promoted prod images), patches `runtime-config.js`
>   for ONE hosting deploy (the prod pair gained `_prodSupabaseUrl`/
>   `_prodSupabaseAnonKey` seams for exactly this), smokes — and moves cron
>   ownership to GCP **only with `NETLIFY_CRONS_FROZEN=1`**, otherwise jobs stay
>   PAUSED and `cutover-db.sh prod finish-crons` completes it later.
> - **PREFLIGHT — JWT_SECRET must be the prod Supabase secret.** `.env.prod`
>   currently has NO `JWT_SECRET`; the script refuses to run without one and
>   HS256-verifies that `SUPABASE_ANON_KEY` is signed by it. A generated secret
>   would log every user out at the flip — this check catches it BEFORE the
>   window (doc 09 §0 preflight item).
> - **Interrupted windows resume**: `CUTOVER_RESUME=1 cutover-db.sh prod …`
>   re-runs steps 3–6 idempotently after a death past the env flip.
> - **Fully rehearsable**: `DRY_RUN=1` prints every command/env edit.
> - **DB-side facts the script now enforces** (they broke staging until fixed):
>   clean-slate schema restore, auth schema + relations owned by
>   `supabase_auth_admin`, `anon`/`authenticated` hosted-baseline table grants,
>   non-product rows (vault/realtime) filtered from the data import.
> - **Browser routing**: `/auth/v1` + `/rest/v1` now route through the **api
>   service**, whose adapter strips the prefix and proxies to GoTrue/PostgREST
>   (Firebase Hosting has no rewrite-transform). The prod hosting rewrites
>   target the api service for the same reason.
>
> **Left the same on purpose:** the SAME-JWT-SECRET rule (no re-mint at prod),
> the manual DNS flip LAST, and the keep-Netlify-up rollback window.

This is the runbook `deployment/scripts/gcp/cutover-db.sh` references. It covers
doc 05 §3d steps 1–9 end-to-end: the freeze, the DB dump/restore, the repoint,
the smoke, the external-party updates, the DNS flip, and the rollback.

> ⚠ DANGER: this window touches production. Do not begin without the owner
> present, the preflight checklist below completed, and the rollback path
> (step 7) rehearsed in advance.

---

## 0. Preflight (complete ALL before the window)

- [ ] Staging fully tested (local + GCP staging green; owner sign-off) — staging
      itself cut over 2026-10-01; its cron handoff completes via
      `cutover-staging-db.sh staging finish-crons` once the Netlify staging TOML
      freeze is done (doc 12).
- [ ] `.env.prod` filled — **including `JWT_SECRET` = the production Supabase
      JWT secret** (Supabase dashboard → Settings → API → JWT Secret). ⚠️ It is
      NOT set today; `cutover-db.sh` refuses to run without it and verifies the
      anon key's signature against it. A generated secret logs every user out.
- [ ] `SOURCE_DB_URL` = prod Supabase connection string (session pooler URI from
      the dashboard) available to paste at run time.
- [ ] `bootstrap.sh prod` + `bootstrap-secrets.sh prod` already run; the prod
      shadow (Phase 1b / `promote-prod.sh`) validated against the prod hosted
      Supabase with cron ownership proven in both directions.
- [ ] External-party change list prepared (step 4 below): Stripe webhook URL,
      Razorpay webhook URL, Resend webhook URL, OAuth provider redirect
      allow-lists, n8n callback URL.
- [ ] Rollback rehearsal done (step 7) — DNS revert path documented to the
      minute.
- [ ] Rehearse the window itself: `DRY_RUN=1 deployment/scripts/gcp/cutover-db.sh
      prod "<SOURCE_DB_URL>"` prints every command and env edit, touches nothing.

## 1. Freeze (doc 05 §3d step 1)

```bash
# The script pauses the GCP side (crons.sh prod pause). COMMENT the Netlify
# PROD TOML schedules before step 5 of the script (never both owners live);
# the script's cron handoff REFUSES to resume without NETLIFY_CRONS_FROZEN=1.
CUTOVER_CONFIRM=1 deployment/scripts/gcp/cutover-db.sh prod "<SOURCE_DB_URL>"
# One-window variant (Netlify freeze already done):
#   NETLIFY_CRONS_FROZEN=1 CUTOVER_CONFIRM=1 … cutover-db.sh prod "<SOURCE_DB_URL>"
# Completed the window but deferred crons? Then, after the Netlify freeze:
#   NETLIFY_CRONS_FROZEN=1 deployment/scripts/gcp/cutover-db.sh prod finish-crons
# Interrupted after the env flip (image not found, Ctrl-C past step 4)?
#   CUTOVER_RESUME=1 CUTOVER_CONFIRM=1 … cutover-db.sh prod    # re-runs steps 3–6
```

The script runs, in order:
0. preflight (JWT_SECRET ↔ anon-key signature), pre-flip env snapshot;
1. `crons.sh prod pause` (GCP freeze);
2. `migrate-db.sh prod` (dump schema+data+auth users → Cloud SQL, FK-restore
   fatal-on-error) + **source-vs-target count verification + FK-error check —
   any mismatch aborts the window while hosted Supabase is still serving**;
3. GoTrue allowlist extended (Firebase prod twin) → `deploy-run.sh prod auth rest`;
4. `DATA_MODE=cloud-sql` + `SUPABASE_URL=$APP_BASE_URL` persisted,
   `update-env.sh prod api jobs` (rides the promoted prod images — never a
   fresh tag), `runtime-config.js` prod pair patched for THIS hosting deploy
   only (EXIT trap restores), `deploy-hosting.sh prod` (emits the
   `/auth/v1`+`/rest/v1` rewrites → api proxy);
5. cron handoff — **gated on `NETLIFY_CRONS_FROZEN=1`**; otherwise deferred
   (`jobs` PAUSED, `OPS_JOBS_DISABLED=1` stays);
6. `smoke.sh prod`.

What it does NOT automate (manual, in this order):
1. payments test event (Stripe + Razorpay test-mode webhooks) — verify 200
2. one n8n round-trip (HMAC-verified callback)
3. external-party updates (step 4 below)

## 2. Post-flip smoke (script step 5 + manual)

```bash
./deployment/scripts/gcp/smoke.sh prod        # edge parity + API gate
# manual: sign in (OAuth round-trip), extract, payments, admin, monitoring
```

## 3. Verify the DB restore was complete (post-review hardening)

The FK-safe restore fails loudly on the production path, and `cutover-db.sh`
now runs the count check itself (step 2) — a mismatch ABORTS the window before
anything repoints. After the run, double-check:
- `deployment/generated/db/fk-restore.err` must contain **0** ERROR lines (the
  full path restores the auth schema, so every `user_id → auth.users` FK
  re-adds — any failure aborts the script with the violation list).
- `deployment/generated/db/data-restore.err` must be empty.
- The row-count report printed at the end matches the source counts
  (auth.users/identities, extractions, watchlists, audits).
- **Auth actually works through the new stack**: `GET /auth/v1/health` returns
  GoTrue's JSON (not a 403 — the api proxy path must be live), and a fresh
  sign-in succeeds. On staging these were the two failure modes that the fixed
  scripts now prevent (auth-schema ownership + anon grants; see doc 12).

## 4. External parties (doc 05 §3d step 6; impact doc §6)

| Party | Change |
|---|---|
| Stripe | webhook endpoint URL → `https://datiq.app/api/payment-webhook` (or the shadow URL first) |
| Razorpay | same webhook URL change in the Razorpay dashboard |
| Resend | webhook URL update |
| Google/Microsoft OAuth | add `https://api.datiq.app` (GoTrue) + `https://datiq.app` to the redirect allow-lists |
| n8n | callback base URL → production origin |

## 5. DNS flip (doc 05 §3d step 7) — MANUAL and LAST

1. Firebase Hosting console → Hosting → Add custom domain for
   `datiq.app`, `www.datiq.app`, and `api.datiq.app` (custom domain → Cloud Run
   rewrites for `/api/**`).
2. Verify TLS (SSL cert provisioning completes; test `https://datiq.app`).
3. Only then update the DNS records at the registrar.
4. Verify: `curl -I https://datiq.app` + full smoke against the custom domain.

## 6. Keep Netlify deployed (doc 05 §3d step 8)

Netlify + hosted Supabase stay intact through the rollback window — instant
DNS-revert is the rollback. Document the caveat: accounts/payments created
post-flip do not exist on the old stack if you revert.

## 7. Rollback (rehearse BEFORE the window)

```bash
# revert DNS to Netlify at the registrar (TTL-permitting), then the script's
# printed rollback block, which is now:
#   cp deployment/env/.env.prod.preflip.<ts> deployment/env/.env.prod
#   deployment/scripts/gcp/deploy-run.sh prod auth rest api jobs
#   deployment/scripts/gcp/deploy-hosting.sh prod   # runtime-config already restored by the EXIT trap
#   deployment/scripts/gcp/crons.sh prod pause      # GCP stops owning crons
#   un-comment the Netlify prod TOML schedules + redeploy Netlify prod
```

⚠️ Post-flip data caveat (unchanged): accounts/payments created after the flip
do not exist on the hosted project — a rollback loses them. That is why the
DNS flip is LAST and the Netlify + hosted Supabase stack stays intact and
receives no new writes during the window (crons frozen on BOTH sides; the
Netlify functions still serve any traffic that bypassed DNS).

## 8. Decommission (after the rollback window; doc 05 §3d step 9)

- [ ] Netlify deploys retired; GitHub Actions Netlify-coupled jobs disabled.
- [ ] Hosted Supabase project retired (keep exports archived).
- [ ] `DATA_MODE=cloud-sql` confirmed in `.env.prod` (persisted by the script).
