# CI/CD route — feature → staging → main → prod

GCP is the only deploy target. Netlify no longer deploys anything (its deploy
toolchain, `tools/netlify-cli/`, was deleted 2026-10-03). The application code
still lives in `netlify/functions/` and `netlify.toml` because the GCP adapter
wraps those handlers; only the *deployment* moved.

## The route

| Step | Trigger | What runs | Gate on the way |
|---|---|---|---|
| 1. Feature branch → PR into `staging` | PR | **Staging Gate** checks only: Test Suites, Vulnerabilities, Open Issues/Defects | all three green |
| 2. Merge to `staging` | push | Same three gates, then **Deployed & Smoke Tested** = `gcp-staging.yml` (Cloud Build → Cloud Run → Hosting → Scheduler → smoke) | deploy needs all three gates; env `gcp-staging` |
| 3. PR `staging` → `main`, merge | push to `main` | **Phase-Gate**: same three gates, then **Staging Released & Tested**, then **Deploy to Production** | see below |
| 4. Production | inside step 3 | `gcp-prod.yml`: digest-promote staging's images → Cloud Run → Hosting → Scheduler → smoke | env `gcp-prod` **required reviewer approves** before any prod step |

### Why prod is "promote", not "rebuild"
`Staging Released & Tested` finds a **successful Staging Gate run** (gates + GCP
deploy + smoke) whose commit has the **identical git tree** as the `main` commit
being released. Equal trees mean prod runs byte-for-byte what staging validated,
and that staging commit's SHA is the image tag `gcp-prod.yml` promotes.
Anything that reached `main` without going through staging fails this job with
the reason. (Merge commits have a different SHA but the same tree, so normal
staging → main merges pass.)

## What CI never does
- **Touch a database.** Cloud SQL changes are an operator action
  (`cutover-db.sh`, `migrate-db.sh`) from a machine with the right logins.
- **Provision infra or IAM** (`SKIP_BOOTSTRAP=1`). APIs, service accounts,
  buckets and the Artifact Registry repo are created once by an operator.
- **Deploy past a red gate.** `gcp-staging.yml` has no push trigger; it is only
  reachable through the gate (or a manual dispatch).

## One-time setup (GitHub → Settings → Environments)
- `gcp-staging`: secrets `GCP_SA_KEY` (deploy service account JSON), `ENV_FILE`
  (whole contents of `deployment/env/.env.staging`).
- `gcp-prod`: same two secrets (separate key, `.env.prod`), **Required reviewers
  on**, optional variables `STAGING_GCP_PROJECT_ID` / `STAGING_AR_REPO` /
  `STAGING_IMG_TAG` (only used by manual runs; the gate passes the exact tag).
- `ENV_FILE` is the single source of truth: change an env value locally, then
  `gh secret set ENV_FILE --env <env> < deployment/env/.env.<env>`.
- CI service account roles: `run.admin`, `artifactregistry.writer`,
  `firebasehosting.admin`, `iam.serviceAccountUser`, `secretmanager.admin`,
  `cloudbuild.builds.editor`, `cloudscheduler.admin`, `storage.admin`.

## Guard tests
`scripts/ci-cd-route.test.mjs` and `scripts/staging-gate.test.mjs` pin every
property above (deploy needs all gates; no ungated route into staging or prod;
tree-equality proof; approval environment; no Netlify). They run in
`npm run test:unit`, so the gates and the pre-push hook enforce them.

## Rollback
Cloud Run keeps previous revisions, and a prod deploy is a promotion of a known
staging commit: re-run `gcp-prod` (Run workflow) with `staging_img_tag` set to
the previous good staging commit SHA.

## Manual runs
- Staging: Actions → `gcp-staging` → Run workflow (same steps, no gate).
- Prod: Actions → `gcp-prod` → Run workflow, type `prod`; reviewer approval still applies.
- Hotfix past the staging proof: Actions → Phase-Gate → Run workflow with
  `bypass_staging_check` — prod images are then **built**, not promoted.
