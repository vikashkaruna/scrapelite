# Session Handoff — 2026-09-30 (night) — Staging DB Cutover Tooling (migrate db+users → Cloud SQL, repoint staging)

> ## ⚠ NEW 2026-10-01 (later) — DOWN.sh / UP.sh ROUND TRIP VERIFIED; STAGING SITE RENAMED
>
> A live teardown→rebuild test (prompted by "will the DB and Studio survive
> down.sh / up.sh?") found and fixed a set of data-safety and rebuild-path
> gaps — every one now scripted (docs: deployment/README.md +
> doc 11 §6):
>  * `down.sh` is DATA-SAFE BY DEFAULT: Cloud SQL, its **5 DB-access secrets**
>    and the **hosting site** survive a plain teardown; `--delete-data` (full
>    destroy) is the only path that removes them, and it asks for the
>    instance name BEFORE the first deletion. `DRY_RUN=1` rehearses.
>  * **A deleted Firebase site ID is permanently burned** (firebase-tools:
>    "cannot be reactivated by you or anyone else"). The live test burned
>    `datiq-vsp-fhs-stg` — staging now runs on **`datiq-vsp-fhs-staging`**
>    (`.env.staging` updated; smoke green on the new URL).
>    ✅ **DONE — verified same day**: `stg.datiq.app` CNAMEs to
>    `datiq-vsp-fhs-staging.web.app`, Firebase reports the custom domain
>    OWNERSHIP_ACTIVE + HOST_ACTIVE, and the full chain is live through it —
>    home 200 (fresh build), `/auth/v1/health` → GoTrue v2.196.0,
>    `/rest/v1` → 200, `/api` → 401 (auth gate). No operator action remains.
>  * Rebuild-path gaps fixed: image mirrors now **self-heal** in
>    deploy-staging (new `stage-third-party.sh`; GoTrue/PostgREST/Studio/
>    pg-meta), `bootstrap.sh` re-grants `roles/cloudsql.client` on api/jobs SAs
>    and the operator's `serviceAccountTokenCreator` on the deploy SA (both
>    died with the deleted SAs and broke the rebuild), and the api's
>    `/auth/v1`+`/rest/v1` proxy env re-wires after auth/rest come up
>    (fresh-rebuild ordering).
>  * Verified post-rebuild: DB row counts unchanged (extractions 29, users 3,
>    audits 16 — before AND after teardown/rebuild), auth/rest 200 through the
>    new site, Studio 165 tables via `proxy-studio.sh`, smoke 13/13, 13 GCP
>    jobs re-paused to the cutover-deferred state.
>  * **Secrets clobber fixed**: `bootstrap-secrets.sh` (runs on every `up.sh`)
>    was re-pushing the operator file's PRE-cutover `SUPABASE_SERVICE_KEY` over
>    the cutover-minted one in Secret Manager — the api mounts that key FROM
>    Secret Manager and its PostgREST calls failed auth (`/api/credits` →
>    degraded `read_failed`). The script now keeps that row when
>    `DATA_MODE=cloud-sql` (cutover owns it). Restored the minted key in SM,
>    redeployed api, verified `/api/credits` returns the real DB-backed shape
>    (no `degraded`), rest 200, smoke 13/13.
>
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
> **Studio (2026-10-01, commit `b1ebbe27`)**: Supabase Studio + pg-meta now
> deploy in EVERY flow (deploy-staging "auth/rest + studio", promote-prod,
> up.sh prod --build, both cutovers, update-env). pg-meta reads Cloud SQL via
> the `PG_META_DB_URL` secret which `migrate-db.sh` now refreshes on every
> migration (it must use the `@localhost` host form — postgres-meta's Node URL
> parser rejects the empty-host form GoTrue accepts; the old seeded secret also
> pointed at the wrong database with a stale password). Pre-cutover prod skips
> Studio cleanly (no Cloud SQL yet). Operator access:
> `deployment/scripts/gcp/proxy-studio.sh <env>` — `gcloud run services proxy`
> cannot authenticate against the private service with operator credentials
> (user tokens fail the audience check; --impersonate hard-fails in gcloud
> 584); the new `studio-proxy.mjs` mints an audience-scoped impersonated ID
> token and forwards. Verified live: 165 tables incl. public.extractions +
> auth.users through the proxy; smoke 13/13.
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
