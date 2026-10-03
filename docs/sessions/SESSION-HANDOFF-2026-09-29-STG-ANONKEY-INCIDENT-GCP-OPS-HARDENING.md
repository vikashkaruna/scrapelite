# Session Handoff — 2026-09-29/30 — stg anon-key incident, admin analytics suppression, GCP ops hardening

> **Branch:** `docker-desktop-build` (uncommitted working tree — NOT merged to staging/main per owner instruction)
> **Verification:** parameterisation gate green · staging parity smoke **13/13** · full `npm run test:all` green (see §5)

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-29 → 2026-09-30 |
| **Branch** | `docker-desktop-build` (pushes land here ONLY; no staging/main merges unless the owner asks) |
| **HEAD SHA** | `2d15860e` (+ large uncommitted working tree — commit before pushing) |
| **Status** | Incident resolved live on staging; ops tooling landed; docs updated |
| **Active Focus** | 1) stg.datiq.app 503 incident (rotated Supabase anon key) — root-caused, fixed live, guarded against recurrence. 2) /admin tracker+SEO suppression finished. 3) GCP up/down + incremental deploy tooling (plan items 3a–3c). 4) Runbooks + GitHub→prod direction. |

---

## 2. The Incident (read this first)

**Symptoms (owner reports from https://stg.datiq.app):** workspace team tab showed
*"Supabase rejected this server's API key … (key in use: yJh…xcG4 (207 chars))"* then a
false *"Your plan doesn't include a workspace to create yet."* (owner is Agency plan);
`/workflows` said *"Sign in to view your workflow."* while signed in; `/engagement`
showed the same 503 text.

**Root cause:** the Cloud Run staging `api`/`jobs` services carried a **revoked** dev
Supabase anon key (207 chars). `.env.staging` had already been corrected to the rotated
208-char key, but nothing ever re-applied env-only changes — and the revoked key passes
the OFFLINE ref check (it still decodes to the right project), which is why every
existing diagnostic was blind. **Rotation is only visible through a LIVE probe.**

**Fix applied live (2026-09-29):** `update-env.sh staging` redeployed api+jobs on the
image that was already serving with fresh env (revision `…-00010-zdz`, key verified
208 chars). Post-fix probe: garbage bearer gets a clean session-level 401 from GoTrue
(previously the 503 key-rejection). Staging smoke 13/13.

**Guards added so it cannot ship again:** `check-supabase-pair.sh`
(`npm run verify:supabase -- <env>`) does the offline ref match **plus a live
`/auth/v1/health` probe**, and is wired into `deploy-run.sh` +
`bootstrap-secrets.sh` (bypass: `SKIP_SUPABASE_CHECK=1`, prints a SKIP line).
Proven both ways: PASS on the fixed `.env.staging`, FAIL with the rotation
message on a file carrying the dead key.

**Two UI lies the incident exposed (fixed + regression-tested):**
- `netlify/functions/workflow-graph.js` collapsed the 503 deployment fault into
  401 "Sign in to view your workflow." → now forwards 503 verbatim
  (`netlify/__tests__/workflow-graph.test.js` covers it).
- `src/components/workspace/TeamTab.jsx` showed the plan-gate message when the
  workspace list failed to load → now gated on a successful load.

**Follow-up on the owner side:** the failed `deploy-scheduler.sh` run before the
`--update-headers` fix **printed the staging JOBS_TOKEN into the terminal**
(`--headers=x-datiq-cron-token=e4c5…`). Rotate `JOBS_TOKEN` in `.env.staging` +
Secret Manager + `update-env.sh staging` before the parallel-run window matters.

---

## 3. What Was Accomplished (by request item)

1. **/admin tracker & SEO suppression — completed + locked.** The working tree
   already carried most of it (X-Robots-Tag headers on netlify.toml edge /
   admin nginx / local gateway; `index.html` sendBeacon+fetch shield for
   plausible.io/google-analytics/posthog hosts; gtag/dataLayer/PostHog capture
   suppression; per-bot + AI-crawler meta noindex; JSON-LD stripping; consent
   banner hidden on /admin; robots.txt per-bot Disallow). This session added
   the lock-in suite (`scripts/analytics-js.test.mjs` "edge noindex header
   parity" + robots/sitemap assertions, 79 tests in that file). Verified live:
   staging smoke checks "admin noindex header" ✓.

2. **`npm run test:all` — now the full CI bar.** Added Deployment Config Tests
   (`vitest run deployment`), Dependency Vulnerabilities gate, Open Defects
   gate (SKIPs without GH_TOKEN — CI-only), plus `--journeys/--a11y/
   --all-browsers/--release` flags.

3. **Runbooks + README.** New `docs/plans/gcp-docker-migration/10-LOCAL-DEPLOY-RUNBOOK.md`
   and `11-PROD-DEPLOY-RUNBOOK.md` (pre/post validations, incremental matrix,
   guarded teardown, GitHub-trigger direction). Root README got a "Testing &
   deployment quick commands" section; `deployment/README.md` got the full
   per-env command matrix + new operational notes.

4. **Plan pieces through 3c.** 3a was already green (doc 08); this session:
   `.env.prod` created from the example (operator fills REPLACE_ME slots);
   `gcp/crons.sh` (status/pause/resume of the 13 jobs — the doc 09 §1 freeze
   step as a standalone tool; `resume` refuses while `OPS_JOBS_DISABLED=1`);
   `gcp/up.sh` (staging full / prod digest-promote or `--build`, `--with-db`
   opt-in) and `gcp/down.sh` (staging `--yes`; **prod: 6 guardrails** — typed
   env, `ALLOW_PROD_TEARDOWN=1`, `--yes`, typed project id, DB preserved
   without `--delete-data`, 8s countdown).

5. **Incremental deploy variants.** `gcp/update-env.sh` (env-ONLY redeploy on
   the serving image — see incident); `build-images.sh staging api|admin|trackers`
   unit filter (`_UNITS` in build-images.yaml); local `up.sh <units>` +
   `SKIP_BUILD=1`.

6. **Env completion.** `.env.staging.example` / `.env.prod.example` gained §13
   (runtime secret sources from `secrets.manifest` — FIRECRAWL/OPENAI/JINA/
   SPIDER/RESEND/ADMIN_*/N8N_*/… were missing from the shipped skeleton);
   live `.env.staging` populated from the repo `.env` (10 of 15 had sources).

7. **GitHub → prod direction.** `.github/workflows/gcp-prod.yml` — dispatch-only
   (never on push), GitHub Environment `gcp-prod` + Required reviewers as the
   gate, `confirm_env: prod` typed confirmation, digest-promotion default,
   never touches the DB. Dormant until the environment is configured (runbook 11 §7).

8. **Docs.** Doc 05 deviations section (2026-09-30 block), doc 08 §2 (new
   commands + incident note §2.1), deployment/README, root README. Handoff index
   updated.

### Bonus fixes found on the way

- **`promote-prod.sh` latent bug:** its digest exports were silently recomposed
  away by `load_gcp_env` (env files are sourced `set -a` and would clobber
  caller exports). New override channel `DATIQ_IMG_TAG_OVERRIDE` /
  `DATIQ_IMG_{API,ADMIN,TRACKERS}_OVERRIDE` in `lib-gcp.sh`; update-env and
  promote-prod both ride it.
- **`deploy-run.sh` fail-fast:** missing image at the current git sha now
  prints the three remedies instead of gcloud's late "Image not found".
- **`deploy-scheduler.sh`:** UPDATE path used `--headers` (create-only flag) —
  now `--update-headers` with a legacy fallback; verified live against the 13
  staging jobs.
- **`JWT_SECRET` restored to `.env.staging`** (the auth/rest proof services
  failed without it); value verified byte-identical against Secret Manager
  `datiq-vsp-sm-jwt-secret-stg`. (Owner note: `.env.*cp` files are private
  backups — tooling must not source them.)
- **tools/netlify-cli:** new fast-uri advisories (GHSA-qw65-cvwx-89v3 /
  GHSA-58mr-gqgx-xq4g) fixed via `fast-uri: ^3.1.7 || ^4.2.0` override
  (lockfile → 4.2.1, audit clean, CLI verified); the eight EXPIRED toml bypass
  entries removed with a history note (audit had been clean of toml since the
  2026-09-03 override). No bypasses remain active.

---

## 4. The stg Google sign-in report (owner question, answered)

The long `accounts.google.com/v3/signin/accountchooser` URL with a stray
`redirect_to=https://stg.datiq.app` (double-encoded inside `opparams`) is
**cosmetic**: this GoTrue build forwards `redirect_to` verbatim to Google and
validates it only at `/auth/v1/callback` — verified live with a disallowed host
getting the same 302. The account chooser itself is Google-side. The flow that
MATTERS: `https://stg.datiq.app` (+ `/**`) must be in **dev Supabase → Auth →
URL Configuration → Redirect URLs** (doc 08 §3.1 — the checklist item flagged
required but unconfirmed). If missing, OAuth completes at Google and then
bounces to the Site URL — which reads as "sign-in is off / takes long".
`check-supabase-pair.sh` now best-effort probes the allowlist via the
management API when `SUPABASE_ACCESS_TOKEN` is present — **the token in the
operator file is STALE ("JWT failed verification"), rotate it to enable the
check** (root `.env` has none).

---

## 5. Verification Evidence

- Parameterisation gate: green (after a documented ALLOW_GLOBS entry for
  `check-supabase-pair.sh` — generic public host suffix, no project values).
- Staging parity smoke: **13/13** at https://datiq-vsp-fhs-stg.web.app.
- `npm run test:all`: **green across all 13 suites, 368s total** — readiness ✓,
  unit ✓, contract ✓, integration ✓, system ✓, deployment-config ✓ (11 tests),
  db ✓, dependency-vuln ✓ (0 findings after the fast-uri override),
  open-defects ◌ SKIP locally (no GH_TOKEN; CI runs it), build ✓ (1.6s Vite 8,
  35 prerendered pages synced), prerender-integrity ✓, security ✓,
  Playwright chromium smoke ✓ (252s).
- Live incident probe: `POST /api/workspaces` with garbage bearer → 401
  session error (was 503 key rejection pre-fix).
- `verify:supabase staging` → offline ✓ + live ✓; against the stale-key file →
  ✗ with the rotation diagnosis (exit 1).
- `crons.sh staging status` → 13 jobs table; `deploy-scheduler.sh staging` →
  13 jobs updated (post `--update-headers` fix).
- netlify-cli vendored toolchain: `netlify --version` OK, audit 0 findings.

---

## 6. Open Items for the Next Session / Operator

- [ ] **Commit the working tree to `docker-desktop-build`** (large change set:
      src/, netlify/functions/, deployment/, docs/, workflows, lockfile). Owner
      explicitly said: branch only, no staging/main merges.
- [ ] **Rotate staging `JOBS_TOKEN`** (leaked to terminal in the pre-fix
      scheduler run): new value → `.env.staging` + Secret Manager +
      `update-env.sh staging`.
- [ ] **Add `https://stg.datiq.app/**` to dev Supabase → Auth → URL
      Configuration → Redirect URLs** (doc 08 §3.1) so OAuth lands back on stg.
- [ ] **Rotate `SUPABASE_ACCESS_TOKEN`** (management API rejects the stored
      one) to enable the new allowlist probe in `verify:supabase`.
- [ ] Owner: fill `.env.prod` REPLACE_ME slots (prod Supabase trio, JWT_SECRET
      = PROD Supabase JWT secret, OPS_ALERT_EMAIL, payment LIVE keys before
      real cutover) — then runbook 11 §2 brings the prod shadow up.
- [ ] Owner: configure GitHub Environment `gcp-prod` + secrets + required
      reviewers to arm the prod workflow (runbook 11 §7).
- [ ] Optional consistency pass: several `admin-*` functions still answer 401
      with `reason` attached instead of forwarding the 503 status
      (`admin-ai-config.js`, `admin-gallery.js`, …) — same class as the
      workflow-graph fix.
- [ ] `GA_MEASUREMENT_ID` / `POSTHOG_KEY` deliberately empty on staging
      (analytics suppressed); revisit only with a second property per
      runtime-config.js notes.

---

## 7. Addendum — 2026-09-30: integrations `credential_encryption_failed` (fixed)

**Symptoms:** Connect Slack / HubSpot / Notion on stg.datiq.app all returned
`credential_encryption_failed`; Connect Airtable returned "Airtable rejected the
token (status 401)".

**Root cause:** `netlify/functions/lib/integrationSecrets.js` derives its AES-256
key from `INTEGRATION_SECRETS_KEY` and **fails closed** when it is absent. That
variable was in NO deploy contract — not in `secrets.manifest`, not in the env
examples, not in `.env.staging` — so it never reached Cloud Run (absent in old
revision 00006 AND current 00010: integrations were broken on GCP staging from
the first deploy, not a regression). Verified `integration_connections` had
**zero `enc:v1:` rows** (one legacy plaintext hubspot row, readable by design),
so introducing a fresh key breaks nothing.

**Fix:** generated `openssl rand -hex 32` keys (distinct staging/prod), added to
`.env.staging` / `.env.prod`, documented in both examples, added to
`deployment/gcp/secrets.manifest` → `bootstrap-secrets.sh staging` pushed
`datiq-vsp-sm-integration-secrets-key-stg` → `update-env.sh staging` redeployed
api+jobs; revision `…-00012-4g7` (100% traffic) has the secret mounted. Owner
retry of Slack/HubSpot/Notion connect should now succeed.

**Airtable is NOT this bug:** its connect flow probes the pasted token live
against `api.airtable.com/v0/meta/bases` BEFORE saving — the 401 means the
token itself was rejected (wrong value, revoked, or missing scopes). Create a
PAT at airtable.com/create/tokens with `data.records:read`/`write` +
`schema.bases:read` and reconnect. Its row (`access_token: null`) was never
saved, so nothing is stuck.

**Systemic follow-up (same class as the anon-key incident):** a variable read
by server code existed in no deploy contract, and nothing failed until a user
hit the feature. Candidate guard: an audit script that greps
`process.env.X` reads across `netlify/functions/**` and diffs them against
`secrets.manifest` + the deploy-run env list + env examples, failing the gate
on unknowns. Not built this session.
