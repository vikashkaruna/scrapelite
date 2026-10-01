# Session Handoff — 2026-09-30 (night) — Staging DB Cutover Tooling (migrate db+users → Cloud SQL, repoint staging)

> ## ✅ UPDATE 2026-10-01 — THE CUTOVER WAS EXECUTED (steps 0–4 + smoke; cron handoff deferred)
>
> Staging now runs on the **self-hosted trio + Cloud SQL**. Verified live:
> smoke 13/13; anon REST 200; signup → insert → read-own-row through
> `stg.datiq.app`; `/api/credits` with a fresh user JWT served from Cloud SQL.
> `.env.staging`: `DATA_MODE=cloud-sql`, `SUPABASE_URL=https://datiq-vsp-fhs-stg.web.app`,
> `OPS_JOBS_DISABLED=1` (crons deliberately still paused).
>
> Execution surfaced & fixed (all scripted, commit `e12d4c49` + `d32b8ad7`,
> full detail in doc 12 §"Executed 2026-10-01"):
> 1. step 0 wrote the env too early (migration pre-flight saw a key/URL project
>    mismatch) → minting now touches Secret Manager only; env flips at steps 3–4;
> 2. restore needed re-runnability (FK IF EXISTS, auth+storage truncate,
>    clean-slate schema, vault/realtime + `\restrict` stripping);
> 3. GoTrue boot died until the auth schema + relations were owned by
>    `supabase_auth_admin` (3F000 → 42501) and `anon`/`authenticated` got the
>    hosted-baseline table grants (PostgREST 42501);
> 4. Firebase Hosting has no prefix-strip, so `/auth/v1` + `/rest/v1` now route
>    through the **api adapter** (strip + proxy, `AUTH_PROXY_URL`/`REST_PROXY_URL`,
>    OIDC via `X-Serverless-Authorization`);
> 5. env-only flips ride `update-env.sh` (HEAD may be past the last build);
>    `CUTOVER_RESUME=1` resumes an interrupted flip.
>
> **REMAINING (operator, then one command):** comment the staging
> scheduled-function blocks in `netlify.toml` + redeploy Netlify staging, then
> `NETLIFY_CRONS_FROZEN=1 deployment/scripts/gcp/cutover-staging-db.sh staging finish-crons`
> — that flips `OPS_JOBS_DISABLED=0`, redeploys jobs and resumes the 13 GCP
> scheduler jobs (cron ownership moves; never both owners at once).
> Also: sign in fresh on stg.datiq.app (all staging sessions were invalidated by
> the fresh JWT secret — by design), and note Supabase **Storage objects were not
> migrated** (pg_dump covers Postgres only).
>
> ### PROD PARITY (2026-10-01, commit `9cfff3f5`)
>
> All executed-staging learnings are now in the PROD path too:
> `cutover-db.sh` rebuilt (6 steps, JWT_SECRET↔anon-key HS256 preflight that
> currently REFUSES because `.env.prod` has no JWT_SECRET — operator must set
> the prod Supabase secret first, doc 09 §0; count-verified migration before
> any repoint; gated cron handoff + `finish-crons`; `CUTOVER_RESUME=1`;
> `DRY_RUN=1`); `runtime-config.js` gained `_prodSupabaseUrl`/
> `_prodSupabaseAnonKey` patch seams (identity tests cover both branches);
> `migrate-db.sh` now REFUSES when `DATA_MODE=cloud-sql` (post-cutover the
> rehearsal would truncate the live DB — verified live on staging);
> `deploy-staging.sh` skips the DB step post-cutover and treats auth/rest
> failures as blocking once they are on the serving path. Docs 09, 11 and
> `deployment/README.md` updated. Full `up.sh staging` re-run green (smoke
> 13/13, proxy env rewired).
>
> ---
>
> The sections below are the original tooling handoff (2026-09-30) — still
> accurate for the design; superseded by the update above for current state.

> **Branch:** `docker-desktop-build` @ `583a4416`  
> **Target:** feature branch only — **no staging/main changes, no deploys**  
> **Verification:** gate green ✓ · bash -n ✓ · deployment tests 20/20 ✓ · identity test 11/11 ✓ · unit 9408/9408 ✓ · cutover DRY_RUN end-to-end ✓

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-30 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | `583a4416` |
| **Status** | Tooling complete & verified — **the cutover itself is NOT executed** (operator window) |
| **Active Focus** | "Which DB does staging point to?" + migrate staging DB+users to GCP Cloud SQL + repoint staging at it |

## 2. The answer to "which database does staging point to"

Staging — `stg.datiq.app` AND `datiq-vsp-fhs-stg.web.app` — reads/writes the **hosted dev Supabase project `aubwooslkkrprdxuiyvj.supabase.co`** today, in every layer: `deployment/env/.env.staging` (`DATA_MODE=hosted-supabase`, `SUPABASE_URL=https://aubwooslkkrprdxuiyvj.supabase.co`), the deployed GCP api container env, and the browser via `public/runtime-config.js`'s staging branch. The Cloud SQL instance `datiq-vsp-sql-datiq-stg` holds only a rehearsal dump (no auth users; 37 auth-referencing FKs dropped). The auth/rest Cloud Run services exist but are unreachable (no `/auth/v1`+`/rest/v1` hosting rewrites in hosted-supabase mode).

## 3. What Was Built (owner decisions applied)

**Owner decision 1 — FRESH JWT secret:** the cutover generates a new secret and mints a fresh anon + service key pair from it. Consequence (printed loudly by the script): every staging session dies and old keys stop working — users re-login. **Owner decision 2 — cron handoff in the same window:** GCP staging takes cron ownership at the flip; Netlify staging TOML schedules must be commented first.

New artifacts:
- **`deployment/scripts/mint-supabase-keys.mjs`** — mints anon + service_role JWTs from `JWT_SECRET` (same HS256 shape as `gen-local-config.mjs`), `--ref <sql-instance>` + `--exp-years`; prints `ANON_KEY=…` / `SERVICE_KEY=…`.
- **`deployment/scripts/gcp/migrate-staging-db.sh staging <SOURCE_DB_URL>`** — the SAFE half: preflight (DATA_MODE must be hosted-supabase; `verify:supabase`; prints current DB state; env snapshot), runs the existing `migrate-db.sh` full pg_dump path (auth schema + users included, FK-restore fatal-on-error), then verifies `auth.users` / `auth.identities` / `public.extractions` row counts against the source + FK-restore error count. Changes NO routing.
- **`deployment/scripts/gcp/cutover-staging-db.sh staging <SOURCE_DB_URL>`** — the flip: 0 fresh secret + minted keys (env + Secret Manager); 1 `crons.sh pause` + Netlify-TOML-comment reminder; 2 migrate (`SKIP_MIGRATE=1` to reuse); 3 deploy auth/rest; 4 `DATA_MODE=cloud-sql` + `SUPABASE_URL=$APP_BASE_URL` + GoTrue allowlist (FHS site + custom domain composed from env) + runtime-config patched for THIS hosting deploy only (EXIT trap restores), deploy api/jobs + hosting; 5 `OPS_JOBS_DISABLED=0` + jobs + `crons.sh resume`; 6 smoke. `DRY_RUN=1` prints everything, touches nothing. Confirmation prompt; refuses to run twice.
- **`public/runtime-config.js`** — staging pair extracted to `_stagingSupabaseUrl`/`_stagingSupabaseAnonKey` vars; committed form UNCHANGED (hosted dev pair). `runtimeConfigIdentity.test.js` updated for the new shape + a **tripwire test that fails if the self-hosted pair is ever committed** (it would break branch deploys before the rewrites exist).
- **`docs/plans/gcp-docker-migration/12-STAGING-DB-CUTOVER.md`** — preflight, DRY_RUN, run, post-window verification, rollback, caveats. Runbook 08 got a "Phase 3a" pointer; `deployment/README.md` got the commands.

## 4. Caveats (flagged in script + doc, not silently ignored)

- Supabase **Storage objects are NOT migrated** (pg_dump covers Postgres only) — export staging buckets first if they hold anything.
- **Social OAuth** needs `GOTRUE_EXTERNAL_*` credentials on the self-hosted GoTrue; email/password works immediately.
- `check-supabase-pair.sh` skips its live probe for non-`*.supabase.co` URLs — post-flip verification is smoke + manual signon.
- Prod is unaffected; its cutover remains `cutover-db.sh prod` (doc 09).

## 5. Verification Evidence

- `bash -n` both scripts + mint mjs output decoded (ref/role/exp correct)
- `bash deployment/scripts/check-parameterisation.sh` — **green** (caught 5 forbidden literals in the first draft: project ref, `datiq-vsp-` prefix, `supabase.com` hosts — all recomposed from env)
- `npx vitest run deployment` — 20/20 · `runtimeConfigIdentity.test.js` — 11/11 (new shape + tripwire)
- `npm run test:unit` — 540 files / 9408 passed
- `DRY_RUN=1 cutover-staging-db.sh` — full 0–6 step printout verified, including the allowlist accumulation and rollback block
- Pushed through the full pre-push gate (`CI=1`): `c0ed948d..583a4416` on `docker-desktop-build`

## 6. Operator Run (when the window opens)

```bash
DRY_RUN=1 bash deployment/scripts/gcp/cutover-staging-db.sh staging "$SOURCE_DB_URL"   # rehearse
# window: comment Netlify staging TOML schedules + redeploy Netlify staging, then:
bash deployment/scripts/gcp/cutover-staging-db.sh staging "$SOURCE_DB_URL"
```

Follow doc 12 for preflight (incl. `npm run verify:supabase -- staging`), post-window verification (fresh signon, schedule + extraction round-trip), and rollback (env snapshot restore + redeploy; runtime-config auto-restores).

## 7. Open Items

- [ ] Operator: run the cutover in a window per doc 12 (NOT executed this session).
- [ ] Decide on Storage bucket export before the flip.
- [ ] Social OAuth provider env for self-hosted GoTrue (post-flip follow-up).
- [ ] Prod cutover (doc 09) still pending — the staging flip is its rehearsal.
