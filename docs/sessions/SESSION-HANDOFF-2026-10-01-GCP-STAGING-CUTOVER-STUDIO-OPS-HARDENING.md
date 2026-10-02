# Session Handoff — 2026-10-01 — GCP Staging Cutover Executed + Studio + Credit Calibration + Ops Hardening

> **Branch:** `docker-desktop-build` @ `817d9b5e` (branch only — nothing merged to staging/main)
> **Target:** staging GCP (executed) · prod scripts (parity, not executed)
> **Verification:** unit 9421 ✓ · contract 5570 ✓ · deployment 20/20 ✓ · runtime-config identity 11/11 ✓ · up.sh staging smoke 13/13 (multiple runs) ✓ · live teardown→rebuild round trip with byte-identical DB counts ✓ · every push passed the pre-push gate ✓

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | `817d9b5e` |
| **Status** | Session complete; one operator step outstanding (Netlify cron freeze → `finish-crons`) |
| **Staging state** | `stg.datiq.app` → self-hosted GoTrue v2.196.0 + PostgREST + Cloud SQL + Studio; 13 GCP jobs PAUSED (cutover-deferred) |
| **Active Focus** | Executing the staging DB cutover, then hardening everything the execution exposed |

---

## 2. What Was Accomplished

### 2a. Credit calibration (earlier in the session — own record)
Detailed in `SESSION-HANDOFF-2026-09-30-CREDIT-CALIBRATION.md` + reference doc
`docs/CREDIT-CHARGES-CALCULATION-AND-CALIBRATION.md`:

- **Template runs were DOUBLE-BILLED** (choke-point meters + finish events, ~3–4×
  the quote). Fixed with `meterScope: "template_run"` → suppressed meter context;
  finish events are the one charge.
- Tier-honest pricing (deep-weight synthesis/extraction from the tier that ran),
  estimate rewritten to mirror the runner (`units_extra`, ai_depth-aware).
- Full e2e matrix 535/0; live ledger verified zero choke-point rows during
  template traffic; live staging estimate verified itemised.

### 2b. Staging DB cutover EXECUTED (steps 0–4 + smoke; cron handoff deferred)
Detailed in `SESSION-HANDOFF-2026-09-30-STAGING-DB-CUTOVER-TOOLING.md` + doc 12
§"Executed 2026-10-01". Execution-surfaced script fixes (all scripted):
- step 0 mint no longer touches the env file (migration pre-flight ordering);
- re-runnable/clean-slate restore (FK IF EXISTS, public+auth+storage truncate,
  vault/realtime + `\restrict` stripping);
- auth schema + relations owned by `supabase_auth_admin` (GoTrue 3F000 → 42501);
- `anon`/`authenticated` hosted-baseline table grants (PostgREST 42501);
- `/auth/v1` + `/rest/v1` route via the **api adapter** (prefix strip + proxy —
  Firebase Hosting has no rewrite-transform);
- env-only flips ride `update-env.sh`; `CUTOVER_RESUME=1`; **gated cron handoff**
  (`NETLIFY_CRONS_FROZEN=1`) + `finish-crons` subcommand.

### 2c. Prod cutover parity
`cutover-db.sh` rebuilt on the proven 6-step flow: JWT_SECRET↔anon-key HS256
preflight (REFUSES while `.env.prod` has no JWT_SECRET — operator preflight item
per doc 09 §0); count+FK verification BEFORE any repoint; gated cron handoff;
`CUTOVER_RESUME`; `DRY_RUN`. `runtime-config.js` gained `_prodSupabaseUrl`/
`_prodSupabaseAnonKey` patch seams (identity tests cover both branches). Post-cutover
guards: `migrate-db.sh` refuses when `DATA_MODE=cloud-sql` (live DB); `deploy-staging.sh`
treats auth/rest failures as blocking post-cutover.

### 2d. Supabase Studio deployed (staging live; prod wired for cutover)
Was in no deploy flow; pg-meta wiring broken three ways (wrong database, stale
password, empty-host DSN rejected by Node's URL parser — GoTrue accepts it).
Now: in every flow (deploy-staging/promote-prod/up.sh --build/both cutovers/
update-env), secrets refreshed by migrate-db.sh on every migration, pre-cutover
prod skips cleanly. Operator access: `proxy-studio.sh <env>` → `studio-proxy.mjs`
(audience-scoped impersonated ID token; `gcloud run services proxy` cannot
authenticate here — both modes verified broken).

### 2e. Data-safe teardown + verified round trip
- `down.sh` keeps **Cloud SQL + its 5 DB-access secrets + the hosting site**;
  `--delete-data` is the only destroy path and confirms the instance name
  BEFORE the first deletion; `DRY_RUN=1` rehearses.
- **Firebase site IDs are permanently burned on delete** — the pre-fix live test
  burned `datiq-vsp-fhs-stg`; staging now runs **`datiq-vsp-fhs-staging`**
  (`stg.datiq.app` CNAME re-pointed, custom domain OWNERSHIP_ACTIVE verified).
- Rebuild-path gaps fixed: image mirrors self-heal (`stage-third-party.sh`),
  `roles/cloudsql.client` + operator `serviceAccountTokenCreator` re-granted by
  bootstrap (both were manual bindings that died with deleted SAs), api proxy
  env re-wires after auth/rest exist.
- Round trip verified: DB counts (29 extractions / 3 users / 16 audits)
  byte-identical across teardown+rebuild; smoke 13/13.

### 2f. Post-cutover secrets clobber (found in the docs sweep)
`bootstrap-secrets.sh` (runs on every `up.sh`) re-pushed the operator file's
PRE-cutover `SUPABASE_SERVICE_KEY` over the cutover-minted one in Secret Manager
→ the api's PostgREST calls failed auth (`/api/credits` answered the degraded
`read_failed` shape). Guard added: that row is skipped when `DATA_MODE=cloud-sql`
(the cutover owns it). SM restored, api redeployed, `/api/credits` now returns
the real DB-backed shape.

### 2g. Docs sweep
Runbooks 05/06/08/12, plan README, `.env.staging.example`, `deployment/README.md`,
this handoff — all reflect the rename, the data-safe teardown contract, Studio,
and the cutover-owned-secrets rule. Historical session records left untouched.

---

## 3. Root Cause Analysis (the bug class this session)

**Symptom class:** post-teardown/rebuild failures that each looked unrelated
(GoTrue boot crash, Studio 502, degraded credits, 404 SUPABASE_URL, burned site).

**Root cause pattern:** *manual bindings and implicit orderings were never
encoded in the scripts.* Every fix moved a hand-run step into bootstrap.sh /
deploy-staging.sh / migrate-db.sh so `up.sh <env>` is a true one-command recovery.

**Second pattern:** *silent degradation.* The credits path failed open
(`degraded: true`, HTTP 200) — visible only by knowing the healthy shape has no
`degraded` key. When verifying recovery, always compare against the canonical
success shape, not the status code.

---

## 4. Verification Evidence (all on 2026-10-01)

- unit 9421/9421 · contract 5570/5570 · deployment 20/20 · runtime-config identity 11/11
- `up.sh staging`: smoke **13/13** (run repeatedly; final green after every fix)
- Live self-hosted chain via `stg.datiq.app`: home 200 · `/auth/v1/health` →
  GoTrue v2.196.0 · `/rest/v1` 200 · `/api` 401-gate · `/api/credits` real
  (non-degraded) · Studio 165 tables incl. `public.extractions` + `auth.users`
- Teardown round trip: DB counts identical before/after; 5/5 DB secrets preserved;
  48 deleted items re-created by `up.sh`
- 13 GCP scheduler jobs paused (cutover-deferred state restored)
- Pre-push gate green on every push (commits `c322aa57` → `817d9b5e`)

---

## 5. Operator Tasks & Open Items for Next Session

**THE one remaining cutover step (staging):**
- [ ] Comment the staging scheduled-function blocks in `netlify.toml` + redeploy
      Netlify staging, then:
      `NETLIFY_CRONS_FROZEN=1 deployment/scripts/gcp/cutover-staging-db.sh staging finish-crons`
      (hands cron ownership to GCP: flips `OPS_JOBS_DISABLED=0`, redeploys jobs,
      resumes the 13 paused jobs. Never both cron owners at once.)

**Manual post-cutover verification (staging):**
- [ ] Sign in fresh on `stg.datiq.app` (all pre-cutover sessions invalidated by
      the fresh JWT secret — by design) and click through one extraction.
- [ ] Supabase **Storage objects were NOT migrated** (pg_dump covers Postgres
      only) — export them if staging buckets hold anything wanted.

**Before any PROD window (doc 09 §0):**
- [ ] Set `JWT_SECRET` in `.env.prod` = the **prod Supabase JWT secret** (the
      script refuses without it; it HS256-verifies against the anon key).
- [ ] Rehearse: `DRY_RUN=1 deployment/scripts/gcp/cutover-db.sh prod "<SOURCE_DB_URL>"`.
- [ ] External-party list prepared (Stripe/Razorpay/Resend/OAuth/n8n) + rollback
      rehearsal per doc 09.

**Optional follow-ups:**
- [ ] Home/Batch pre-flight quote could add an AI line (currently pages-only
      floor; underrun direction — see the credit reference doc).
- [ ] Unmetered touch points flagged for a pricing decision in
      `docs/CREDIT-CHARGES-CALCULATION-AND-CALIBRATION.md` §4.2 (signal-rule
      emails, lazy exec summary, map mode, related-page scans).

---

## 6. Detailed Records (this session's trail)

| Record | Covers |
|---|---|
| `SESSION-HANDOFF-2026-09-30-CREDIT-CALIBRATION.md` | 2a + `docs/CREDIT-CHARGES-CALCULATION-AND-CALIBRATION.md` |
| `SESSION-HANDOFF-2026-09-30-STAGING-DB-CUTOVER-TOOLING.md` | 2b, 2e, 2f (execution postscripts) |
| `docs/plans/gcp-docker-migration/12-STAGING-DB-CUTOVER.md` | cutover runbook + executed log |
| `docs/plans/gcp-docker-migration/09-CUTOVER-RUNBOOK.md` | prod runbook (updated) |
| `docs/plans/gcp-docker-migration/11-PROD-DEPLOY-RUNBOOK.md` §5–§6 | prod cutover + teardown contract |
| `deployment/README.md` | Studio ops, round-trip contract, cutover-owned secrets |
