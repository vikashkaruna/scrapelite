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


### 0.1 Configuration & mapping preflight (added 2026-10-02)

Full mapping and rationale: [doc 06 §11](06-NAMING-AND-ENV-CONVENTIONS.md). Complete before the window:

- [ ] `node deployment/scripts/gcp/env-parity.mjs prod` → **exit 0** (no variable the code reads or Netlify holds is missing on GCP). Review its section 3 (blank-but-carried) and fill what you intend to use.
- [ ] `.env.prod` secrets filled: `JWT_SECRET` (**prod Supabase's**), `GOTRUE_SMTP_PASS` or `RESEND_API_KEY`, `GUEST_ID_SALT`, `PAGESPEED_API_KEY`, `PERPLEXITY_API_KEY`, and the three OAuth client secrets (secret **value**, one **separate GitHub OAuth app** for prod).
- [ ] Engagement: `ENGAGEMENT_RESEND_API_KEY`, `ENGAGEMENT_RESEND_WEBHOOK_SECRET`, and `ENGAGEMENT_UNSUBSCRIBE_SECRET` **= Netlify's current value** (rotating it breaks unsubscribe links already sent). `ENGAGEMENT_ALLOWLIST` is already copied.
- [ ] `bootstrap-secrets.sh prod` shows every intended secret `ok/push` and **no** `⚠ … does not exist` line.
- [ ] Kill switches reviewed: `DISABLE_AUDIT_AI`, `DISABLE_AI_CITATION_SAMPLING`, `DISABLE_PAGESPEED` are `1` on Netlify prod and mirrored `1` in `.env.prod` — decide whether to keep them off after the flip.
- [ ] `VITE_RAZORPAY_KEY_ID` in `.env.prod` is the LIVE key id (the prod hosting build refuses an empty or test key).
- [ ] Mail: `hello@datiq.app` (SMTP sender) and `datiq.app` (engagement sender domain) are **verified in Resend**.
- [ ] Provider consoles prepared (done at the moment the host goes live, not before): Google/Microsoft/GitHub callback `https://datiq.app/auth/v1/callback`; **keep** the old `https://api.datiq.app/auth/v1/callback` registered until the flip is verified (instant rollback).
- [ ] `https://api.datiq.app` and `https://datiq.app` listed in `GOTRUE_URI_ALLOW_LIST`.

### 1.0a DECISION (owner, 2026-10-02): no Netlify freeze — shut Netlify down instead

Neither mechanism below is used. The owner will disable/shut down the Netlify
project after the full migration and cutover, so nothing runs there afterwards.
Consequences for the order of operations:

1. Run `cutover-db.sh prod` steps 1–4 as usual. GCP prod crons stay **PAUSED**
   (`OPS_JOBS_DISABLED=1`, step 5 deferred). Netlify's thirteen crons keep
   running against hosted Supabase meanwhile — a single owner, so no double
   sends, but on stale data: keep this window short.
2. Payments test event, n8n round-trip, external-party URLs, then the DNS flip.
3. Disable/shut down the Netlify project (after the rollback window you choose —
   doc §6/§7: Netlify is the rollback, so shutting it down ends rollback).
4. Only THEN run `NETLIFY_CRONS_FROZEN=1 deployment/scripts/gcp/cutover-db.sh
   prod finish-crons` — the variable now means "Netlify is shut down / no longer
   runs crons", not "TOML edited". Never run it while the Netlify project is live.

The two freeze mechanisms below are kept as the fallback if Netlify must stay
up with crons off.

### 1.0 Freezing the Netlify crons — what, how, and WHEN (added 2026-10-02)

**When: BEFORE `cutover-db.sh prod` (before step 2), not merely before step 5.**
The script only *requires* it before the cron handoff (step 5), but Netlify
keeps serving users and running crons against hosted Supabase until the DNS
flip, so anything a Netlify cron writes after the step-2 copy never reaches
Cloud SQL. With no customers the loss is theoretical; freezing first is still
the cleanest ("never both owners") and costs one Netlify redeploy.

**What: THIRTEEN scheduled functions, not five.** `netlify.toml` declares
`scheduled-runner, reengagement, billing-lifecycle, billing-purge,
health-monitor, discoverability-monitor, watchlist-monitor, bulk-runner,
engagement-dispatcher, signal-retry, workflow-orchestrator-cron,
sxo-analytics-import-worker, prompt-monitor`. Freezing only the original five
leaves eight crons running (the engagement dispatcher among them).

**How — two mechanisms, pick one:**

| | A. `OPS_JOBS_DISABLED` env on Netlify prod | B. Comment the `[functions."…"] schedule` blocks in `netlify.toml` |
|---|---|---|
| Code change / PR | none | yes — must travel branch → staging → main → phase-gate |
| Tests | unaffected | `monitoringModel`/cron-registry parity + `netlify-toml.test.mjs` assert the registry and toml agree; they must be updated in the same change |
| Reversible | delete the env var + redeploy | revert the commit + full pipeline |
| Risk | ⚠ **4KB Lambda env cap** (2026-09-25 incident): the value is ~220 bytes on a site already near the cap, and the var needs Functions scope | none of that |
| Failure mode | read from `process.env`, so it cannot fail open | a removed block silently un-schedules, by design here |

Either way the Netlify change only takes effect on a **production deploy**, and
production is LOCKED by design: unlock in the Netlify UI, then comment
`approved` on the phase-gate issue (doc: CLAUDE.md "Netlify deploy"). Never
force it with `--prod-if-unlocked`. Env vars are injected into functions **at
deploy time**, so setting the variable alone changes nothing until that deploy.
Value for A (all thirteen ids, from `AUTOMATION_JOBS`):
`OPS_JOBS_DISABLED=scheduled-runner,reengagement,billing-lifecycle,billing-purge,health-monitor,discoverability-monitor,watchlist-monitor,bulk-runner,engagement-dispatcher,signal-retry,workflow-orchestrator-cron,sxo-analytics-import-worker,prompt-monitor`.
Verify after the deploy in `/admin/monitoring` (each job shows Stopped, source
`env`) — a stopped job cannot be restarted from the UI by design.
Rollback = remove the variable (or restore the blocks) and redeploy.

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


### 1.1 During the window — what the script does and what changes (added 2026-10-02)

| Step | Action | Config effect |
|---|---|---|
| 0 | Mint anon/service keys from `JWT_SECRET` (env file untouched) | none yet |
| 1 | Freeze GCP crons; Netlify prod TOML schedules commented (manual) | one cron owner at a time |
| 2 | Restore DB into Cloud SQL, **count-verify before any repoint** | `DATA_MODE` still `hosted-supabase` |
| 3 | Push secrets; `.env.prod` flipped: `DATA_MODE=cloud-sql`, `SUPABASE_URL=${APP_BASE_URL}`, anon/service keys; `deploy-run.sh prod auth rest api jobs` | GoTrue now serves the prod users; SMTP/OAuth/engagement env applied |
| 4 | `deploy-hosting.sh prod` | **`dist/runtime-config.js` `_prodSupabase*` patched to same-origin + anon key** (§ doc 06 11.3); browser leaves hosted Supabase |
| 5 | Smoke | edge parity, API gate, `/auth/v1/health` |
| 6 | Cron handoff (`finish-crons`, needs `NETLIFY_CRONS_FROZEN=1`) | GCP owns all 13 jobs |

Edit `APP_BASE_URL` (and `ENGAGEMENT_PUBLIC_URL` if set) from the shadow host to `https://datiq.app` at the DNS flip, then `deploy-run.sh prod auth` + `update-env.sh prod`: the OAuth callback, email links and unsubscribe links follow `APP_BASE_URL` automatically.

## 2. Post-flip smoke (script step 5 + manual)

```bash
./deployment/scripts/gcp/smoke.sh prod        # edge parity + API gate
# manual: sign in (OAuth round-trip), extract, payments, admin, monitoring
```

### 2.1 Validation checklist (added 2026-10-02)

Run in this order after the flip; every line is a pass/fail:

- [ ] `node deployment/scripts/gcp/env-parity.mjs prod` → exit 0.
- [ ] `curl -s https://datiq.app/runtime-config.js | grep '_prodSupabaseUrl'` → `window.location.origin`; the bundle's baked `VITE_SUPABASE_URL` is `https://datiq.app` (not a `*.supabase.co` host).
- [ ] `curl -s https://api.datiq.app/auth/v1/health` → 200 (after the `api` CNAME moved).
- [ ] Sign-in round trip for **each** of Google, Microsoft, GitHub → lands signed in (a silent return to home = check the auth service logs for `AADSTS…`/`invalid_client`). New email signup → confirmation mail arrives from `hello@datiq.app`; password reset mail arrives.
- [ ] `/auth/v1/authorize?provider=<p>` redirects carry `redirect_uri=https://datiq.app/auth/v1/callback` for all three.
- [ ] Engagement: `POST /api/engagement-webhook?provider=resend` unsigned → **401** (503 = secret not mounted); `POST /api/engagement-unsubscribe?t=x` → 400; a real test message's unsubscribe link verifies.
- [ ] Payments: Razorpay live webhook delivered 200 at `https://datiq.app/api/payment-webhook?provider=razorpay`; one test invoice issued with the right `SUPPLIER_*` identity and number.
- [ ] Crons: `crons.sh prod status` → ENABLED, and the Netlify prod schedules are commented out (never both).
- [ ] `/admin/monitoring` and `/admin/health` read healthy; purge still `PURGE_ENABLED=0`.
- [ ] Developer API reachable at `https://datiq.app/api/v1/…` (the docs/extension base URL — fixed 2026-10-02).

## 2.2 Post-cutover (first 7 days)

- Watch `gcloud logging read` for the auth service: `invalid_client`, `redirect_uri`, `smtp`, `bad_oauth_state`.
- Keep Netlify + hosted Supabase intact through the rollback window (§6); do **not** remove the old `api.datiq.app` OAuth callback registrations until the window closes.
- Re-run the parity audit after any env edit. Rotate nothing that signs links (`ENGAGEMENT_UNSUBSCRIBE_SECRET`) during the window.
- After the window: remove `SUPABASE_ACCESS_TOKEN` from the Netlify site (no function reads it), then proceed to §8 decommission.

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
| Google/Microsoft/GitHub OAuth | register `https://<APP_BASE_URL>/auth/v1/callback` for prod (`https://datiq.app/auth/v1/callback` after the flip). The callback registered today is the Supabase custom auth domain `https://api.datiq.app/auth/v1/callback`; keep it registered until the flip is verified so a rollback needs no console change |
| Resend (engagement) | new webhook endpoint `https://datiq.app/api/engagement-webhook?provider=resend` is the SAME URL as today's, so the existing `whsec_` secret stays valid after the flip. Before the flip, GCP prod must carry Netlify's `ENGAGEMENT_UNSUBSCRIBE_SECRET`, or unsubscribe links in mail already sent stop verifying |
| n8n | callback base URL → production origin |

## 5. DNS flip (doc 05 §3d step 7) — MANUAL and LAST

1. Firebase Hosting console → Hosting → Add custom domain for
   `datiq.app`, `www.datiq.app`, and `api.datiq.app`.
   ⚠️ `api.datiq.app` today is a CNAME to the prod Supabase project (its custom
   auth domain: confirmation/reset-email links and the OAuth callback live at
   `https://api.datiq.app/auth/v1/…`). After the flip it must answer
   `/auth/v1/**` and `/rest/v1/**` from the SAME Hosting site — those rewrites
   are path-based and host-agnostic, so adding the domain is enough; no separate
   rewrite is needed. Verify BEFORE changing the registrar record:
   `curl --resolve api.datiq.app:443:<hosting-IP> https://api.datiq.app/auth/v1/health`
   → 200. Re-point the `api` CNAME LAST, after `datiq.app` is verified.
   ℹ️ `https://api.datiq.app/v1/…` (the base URL in the developer docs and the
   browser extension) returns 404 today: the real public API is
   `https://datiq.app/api/v1/…`. Fix the docs/extension or add a `/v1/**` rewrite;
   it is a pre-existing mismatch, not caused by the migration.
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
