# 11 — Production Deploy Runbook (GCP prod twin → cutover → steady state)

**Scope:** the `prod` environment (`deployment/env/.env.prod`, gitignored;
`.env.prod.example` documents every key). Covers the production **shadow**
(doc 05 §3b), the **cutover window** (doc 05 §3d — the DB/user/domain steps
live in `09-CUTOVER-RUNBOOK.md`), and steady-state operations.
**Status:** shadow artifacts ready; cutover NOT executed (see doc 09).

---

## 0. First production deploy — ordered procedure (added 2026-10-02)

Prod is **greenfield in GCP** (no secrets, Cloud Run, Cloud SQL, registry, scheduler or hosting site exist yet). The first deploy builds the **shadow**: a full prod twin on `https://<FHS_SITE_ID>.web.app` that talks to the **hosted prod Supabase** and owns **no crons**, while `datiq.app` stays on Netlify. Nothing a user sees changes until the cutover (§5, doc 09).

Every stage ends in a verification gate. Do not start a stage until the previous gate is green.

### Stage A — Preflight (read-only, changes nothing)

```bash
deployment/scripts/gcp/prod-preflight.sh            # shadow readiness; must exit 0
deployment/scripts/gcp/prod-preflight.sh --cutover  # run now to see what the CUTOVER still needs
```
Gate: `✓ prod preflight passed`. It checks `.env.prod` shape (`APP_CONTEXT=production`, `GIT_BRANCH=main`, `DATA_MODE=hosted-supabase`, `OPS_JOBS_DISABLED=1`, `PURGE_ENABLED=0`, shadow `APP_BASE_URL`), the hosted prod Supabase pair (service key role + project, live probe), a live (non-test) Razorpay build key, that the staging images to promote exist, config parity with Netlify, and that no prod Cloud Run exists yet. `⚠` lines are non-blocking.

**Manual, before Stage B:** in the hosted prod Supabase dashboard → Authentication → URL Configuration, add `https://<FHS_SITE_ID>.web.app/**` to the redirect allow-list (otherwise OAuth/email links from the shadow bounce to the Site URL).

### Stage B — Bring up the shadow

```bash
deployment/scripts/gcp/up.sh prod        # bootstrap -> secrets -> promote staging digests -> scheduler -> hosting -> smoke
```
What it does, in order (each is also runnable alone): `bootstrap.sh prod` (APIs, Artifact Registry, service accounts, Firebase site — **a Firebase site id is burned for ever once deleted**), `bootstrap-secrets.sh prod` (Secret Manager; refuses a `REPLACE_ME` value), `promote-prod.sh prod` (resolves the staging `STAGING_IMG_TAG` digests and deploys api, jobs, admin, trackers — no rebuild), `deploy-scheduler.sh prod` (13 jobs), `deploy-hosting.sh prod`, `smoke.sh prod`.

Gate (all must hold):
```bash
deployment/scripts/gcp/smoke.sh prod                       # 13/13
deployment/scripts/gcp/crons.sh prod status                # jobs exist; GCP owns none (OPS_JOBS_DISABLED=1)
node deployment/scripts/gcp/env-parity.mjs prod            # exit 0
curl -s https://<FHS_SITE_ID>.web.app/runtime-config.js | grep "_prodSupabaseUrl"   # still the HOSTED prod URL (correct pre-cutover)
gcloud run services list --project <GCP_PROJECT_ID> --region <GCP_REGION> | grep -- -prod   # api jobs admin trackers
```

### Stage C — Shadow soak (days, not minutes)

- Manual on the shadow URL: sign in (each provider), extract → save → enrich, a Razorpay **live** order only with a refundable amount, `/admin` PIN gate, `/admin/health`, `/admin/monitoring`.
- Confirm the two cron owners never overlap: Netlify prod TOML schedules **active**, GCP jobs **no-op/paused**.
- Compare behaviour against `datiq.app` for the same actions. Anything different is a config gap: re-run `env-parity.mjs prod`.

### Stage D — Prepare the cutover (no user impact yet)

```bash
deployment/scripts/gcp/prod-preflight.sh --cutover   # must exit 0: JWT_SECRET (PROD Supabase's), OAuth ids+secrets, a SEPARATE prod GitHub app, SMTP, engagement secrets, GUEST_ID_SALT
DRY_RUN=1 deployment/scripts/gcp/cutover-db.sh prod "<SOURCE_DB_URL>"   # prints every command/env edit, touches nothing
```
Then follow **doc 09**: §0/§0.1 preflight, §1/§1.1 the window (what each script step changes), §2/§2.1 validation, §2.2 first seven days, §4 external parties (webhooks, OAuth callbacks), §5 DNS flip (incl. `api.datiq.app`), §7 rollback.

### Where the first deploy usually breaks

| Symptom | Cause | Fix |
|---|---|---|
| `✗ no staging digest for ctr-api:<tag>` | `STAGING_IMG_TAG` wrong, or an older `promote-prod.sh` asked gcloud for `fullyQualifiedDigest` (empty); fixed to `image_summary.fully_qualified_digest` | `gcloud artifacts docker images list …-stg/datiq-<code>-ctr-api --include-tags` |
| `✗ … is still a placeholder` from bootstrap-secrets | a `REPLACE_ME` left in `.env.prod` | fill it or empty it |
| Shadow behaves like staging (demo admin etc.) | `APP_CONTEXT=branch-deploy` copied from staging | must be `production`, `GIT_BRANCH=main` (preflight checks) |
| Shadow OAuth bounces to the Site URL | shadow host missing from the hosted Supabase redirect allow-list | Stage A manual step |
| Prod hosting build refused | `VITE_RAZORPAY_KEY_ID` empty or a test key | live key id in `.env.prod` |

## 1. Pre-validations (before ANY prod deploy)

```bash
npm run test:all                          # full local gate must be green
npm run verify:supabase -- prod           # URL/key pair: offline ref match
                                          # + LIVE probe against prod Supabase
bash deployment/scripts/check-parameterisation.sh
node deployment/scripts/gcp/env-parity.mjs prod   # config parity vs Netlify: must exit 0 (doc 06 §11)
```

Operator checks that cannot be scripted:

- [ ] Staging is green (doc 08) and the soak checklist passed (doc 08 §3b).
- [ ] `.env.prod` is filled — including the **prod** Supabase trio
      (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY`) and, for
      cutover, `JWT_SECRET` = the **production** Supabase JWT secret (doc 09
      preflight). A generated JWT_SECRET logs every user out.
- [ ] `OPS_JOBS_DISABLED=1` still set (cron ownership stays with Netlify until
      the flip — doc 09 §1).
- [ ] Doc 09 §0.1 (configuration & mapping preflight) complete: secrets filled,
      engagement secrets, kill-switch decision, live Razorpay key, Resend domains
      verified. `deploy-hosting.sh prod` refuses a non-live Razorpay key.

## 2. Bring prod up (the shadow)

```bash
bash deployment/scripts/gcp/up.sh prod               # bootstrap → secrets →
                                                     # DIGEST-PROMOTE from
                                                     # staging → hosting → smoke
bash deployment/scripts/gcp/up.sh prod --build       # build fresh images in the
                                                     # prod project instead
bash deployment/scripts/gcp/up.sh prod --with-db     # ALSO create/restore prod
                                                     # Cloud SQL — cutover-
                                                     # adjacent; default OFF
```

The shadow runs against the PROD hosted Supabase with
`OPS_JOBS_DISABLED=1` — it serves traffic at
`https://<FHS_SITE_ID>.web.app` while datiq.app stays on Netlify.

## 3. Incremental deploy variants (no full up)

| Change | Command |
|---|---|
| Functions/API code | `bash deployment/scripts/gcp/build-images.sh prod api` then `bash deployment/scripts/gcp/deploy-run.sh prod api jobs` |
| Static site only | `bash deployment/scripts/gcp/deploy-hosting.sh prod` |
| Env vars / secrets only | edit `.env.prod` → `bash deployment/scripts/gcp/update-env.sh prod` (redeploys on the live image; `--with-secrets` re-pushes changed secrets) |
| Admin or trackers image only | `build-images.sh prod admin` → `deploy-run.sh prod admin` |
| Cron schedules | edit `netlify.toml` → `deploy-scheduler.sh prod` (respects the ownership rule) |

Rules of thumb:

- `update-env.sh` NEVER rebuilds — env-only changes ride the image that is
  already serving. This is also the tool for the rotated-key class of incident
  (2026-09-29 staging).
- `deploy-run.sh` fails fast with the remedy if nothing was built at the
  current `IMG_TAG`.
- Deploying a specific earlier build: `DATIQ_IMG_TAG_OVERRIDE=<tag>
  deploy-run.sh prod api`.

## 4. Post-validations (after any prod deploy)

```bash
bash deployment/scripts/gcp/smoke.sh prod       # parity smoke; FAILS the deploy
curl -s https://<FHS_SITE_ID>.web.app/api/healthz
bash deployment/scripts/gcp/crons.sh prod status  # jobs exist, all ENABLED but
                                                  # owned by Netlify (adapter
                                                  # no-ops while OPS_JOBS_DISABLED=1)
```

Config checks (added 2026-10-02): `node deployment/scripts/gcp/env-parity.mjs prod`
→ exit 0; while `DATA_MODE=hosted-supabase` the shadow's `runtime-config.js` keeps
the committed hosted prod pair (correct — only the cutover flips it).

Manual: sign-in round-trip on the shadow URL, extract → save → enrich, admin
(`/admin` — noindex, no trackers), Razorpay test checkout, Resend test mail.

## 5. Cutover (DB + users + domain)

**Do not improvise this.** Follow `09-CUTOVER-RUNBOOK.md` end-to-end —
it was updated 2026-10-01 with everything the staging execution taught
(doc 12 §"Executed 2026-10-01"):

```bash
# rehearse first — prints every command/env edit, touches nothing:
DRY_RUN=1 deployment/scripts/gcp/cutover-db.sh prod "<SOURCE_DB_URL>"
# the window (add NETLIFY_CRONS_FROZEN=1 if the Netlify prod freeze is already
# done; otherwise crons stay deferred and finish later with):
deployment/scripts/gcp/cutover-db.sh prod "<SOURCE_DB_URL>"
NETLIFY_CRONS_FROZEN=1 deployment/scripts/gcp/cutover-db.sh prod finish-crons
```

What the script now guarantees (all of it learned the hard way on staging):

- **Preflight**: `JWT_SECRET` in `.env.prod` must be the prod Supabase secret —
  HS256-verified against `SUPABASE_ANON_KEY` BEFORE the window. ⚠️ it is unset
  today; set it first (doc 09 §0).
- **Count-verified migration** before any repoint: any source↔target mismatch
  or FK error ABORTS while hosted Supabase still serves.
- **Env-only flips ride the serving images** (`update-env.sh`), so a moved HEAD
  cannot strand the window on `image not found`.
- **Browser repoint**: `runtime-config.js`'s prod pair (`_prodSupabaseUrl`/
  `_prodSupabaseAnonKey`) is patched for ONE hosting deploy → same-origin
  `/auth/v1` + `/rest/v1`; the EXIT trap restores the committed hosted pair.
- **Cron handoff is GATED** on `NETLIFY_CRONS_FROZEN=1` — never two owners.
- **Interrupted windows resume**: `CUTOVER_RESUME=1 … cutover-db.sh prod`.
- Then the manual tail: payments test event → n8n round-trip → external-party
  URLs → DNS flip (LAST) → keep Netlify up for the rollback window.

**Not covered by the script, by design**: the DNS flip, external-party URL
updates, and the payments/n8n verifications — all in doc 09 §2/§4/§5.

### Studio (prod)

Supabase Studio + pg-meta deploy WITH the cutover — `cutover-db.sh` step 3
deploys the `studio` unit alongside auth/rest, and `promote-prod.sh` carries it
in the shadow flow. Pre-cutover prod deploys skip it cleanly (no Cloud SQL yet;
`deploy-run.sh` prints `SKIP studio`). It runs **private** (`--no-allow-
unauthenticated`) against the prod Cloud SQL; operator access is
`deployment/scripts/gcp/proxy-studio.sh prod` (localhost:54328) — see
`deployment/README.md` "Operational notes" for why the standard
`gcloud run services proxy` does not work here. Its DB credentials come from
the `PG_META_DB_URL` / `POSTGRES_PASSWORD` secrets, refreshed by
`migrate-db.sh` on every migration run (including the cutover's).

## 6. Tear prod down (GUARDED — read before running)

`down.sh prod` destroys live infrastructure. Guardrails, all required:

1. `prod` must be typed explicitly (no default, no alias).
2. `ALLOW_PROD_TEARDOWN=1` must be exported.
3. `--yes` must be passed.
4. The GCP **project id** must be typed to confirm.
5. **Data-safe by default** (hardened 2026-10-01 after a live staging
   round-trip): Cloud SQL, its **five DB-access secrets** (JWT_SECRET,
   PGRST_DB_URI, GOTRUE_DB_DATABASE_URL, PG_META_DB_URL, POSTGRES_PASSWORD —
   they hold the only copies of the generated role passwords) and the
   **Firebase hosting site** all SURVIVE a plain teardown. The site survives
   because a deleted site ID can never be recreated (firebase-tools: "cannot
   be reactivated by you or anyone else") — it goes only with `--delete-data`.
6. `--delete-data` destroys the database + its secrets + the site, and asks
   you to type the Cloud SQL instance name **BEFORE the first deletion** — a
   refused confirmation leaves the whole stack untouched.
7. An 8-second abortable countdown runs first.
8. `DRY_RUN=1` prints every action without executing any.

```bash
# plan only — prints what WOULD be deleted, changes nothing:
bash deployment/scripts/gcp/down.sh prod

# rehearse the full action list, touching nothing:
DRY_RUN=1 bash deployment/scripts/gcp/down.sh prod --yes

# execute WITHOUT touching the database, its secrets or the site:
ALLOW_PROD_TEARDOWN=1 bash deployment/scripts/gcp/down.sh prod --yes

# FULL teardown including Cloud SQL + site (owner present, rollback window closed):
ALLOW_PROD_TEARDOWN=1 bash deployment/scripts/gcp/down.sh prod --yes --delete-data
```

**Rebuild path**: `up.sh prod` recreates what a plain teardown removed —
bootstrap re-grants the Cloud SQL + operator-token bindings and re-creates the
AR repo, `build-images.sh`/the mirror scripts refill the images (self-healed
when missing), `bootstrap-secrets.sh` restores the rebuildable secrets from the
operator env file, and hosting redeploys into the kept site. The database and
its five secrets are simply reused; nothing truncates them.

Expected uses before cutover: shadow iteration (the shadow is stateless —
`up.sh prod` recreates it; keep `--delete-data` OFF while the DB matters).

## 7. Deploying to prod from GitHub (the direction)

`/.github/workflows/gcp-prod.yml` exists and is **dormant until you configure
it** — it is `workflow_dispatch`-only (never on push):

1. GitHub → Settings → Environments → create **`gcp-prod`**; add the prod
   secrets (+ `STAGING_*` variables for digest promotion) and turn on
   **Required reviewers** — the review IS the gate.
2. Run workflow → type `confirm_env: prod` → choose
   `promote_from_staging` (default true = digest promotion, no rebuild).
3. The workflow runs the SAME scripts you run locally (`up.sh prod` +
   `smoke.sh prod`) against the same env contract, with the prod DB
   unreachable by design.

Recommended rhythm: staging merge → `gcp-staging.yml` green → soak checklist →
dispatch `gcp-prod`. For the cutover window itself, run the scripts locally
(the window needs `SOURCE_DB_URL` pasted interactively anyway).

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `deploy-run.sh`: "image not found … pick one" | nothing built at this git sha — `build-images.sh prod`, `update-env.sh prod`, or `DATIQ_IMG_TAG_OVERRIDE` |
| `update-env.sh` refuses ("no tag resolves to the serving digest") | the running revision is digest-only and untagged — deploy once via `build-images.sh prod` |
| Smoke fails on `/pricing` 301 | stale generated firebase.json — re-run `deploy-hosting.sh prod` |
| Scheduler jobs fire but nothing happens | expected pre-cutover: adapter no-ops while `OPS_JOBS_DISABLED=1` |
| GoTrue 500 | check `datiq-vsp-sm-gotrue-db-database-url-prod` (unix-socket form) + `--add-cloudsql-instances` on the service |
