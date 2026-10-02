# 12 — Sleep / wake: soft shutdown to save cloud cost and laptop resources

Status: implemented 2026-10-03. Staging and local only. **Nothing is ever deleted.**

## Why
- **Cloud Run is already free at idle.** Every service deploys with
  `--min-instances=0` (see `deploy-run.sh`), so there is nothing to switch off.
- **Cloud SQL is the fixed cost.** The staging instance (`db-f1-micro`) runs
  `ALWAYS`; CPU/RAM are billed every hour whether or not anything uses it.
- **Cloud Scheduler wakes things.** 13 jobs would call Cloud Run (which would
  connect to a stopped database and error), so they are paused with the database.
- **Locally,** stopping containers frees what they use; the Docker Desktop VM
  keeps its reserved RAM until the app itself quits (opt-in `--quit-docker`).

## Commands

| Where | Sleep | Wake |
|---|---|---|
| GCP staging | `deployment/scripts/gcp/down.sh staging --sleep` or `gcp/power.sh staging sleep` | `gcp/power.sh staging wake` (also automatic at the start of every deploy) |
| Local | `deployment/scripts/down.sh --sleep` (containers only; Docker Desktop stays running) · add `--quit-docker` to also free the VM's RAM | `deployment/scripts/up.sh` or `stack.sh start` (they start Docker Desktop if it was quit) |
| Inspect | `gcp/power.sh staging status` | |
| Rehearse | `DRY_RUN=1 gcp/power.sh staging sleep` (prints every action, changes nothing) | `DRY_RUN=1 … wake` |

Wake takes about 1–3 minutes (Cloud SQL start). **Nothing wakes staging on a
visit**: someone testing `stg.datiq.app` runs `power.sh staging wake` first.
CI wakes it automatically (see below).

## What each step does
**Staging sleep** (`gcp/power.sh`)
1. Reads which DatIQ scheduler jobs are `ENABLED` and writes that list to
   `gs://<artifacts-bucket>/power/state.json` — *before* anything is stopped, so an
   interrupted sleep is still recoverable.
2. Pauses those jobs.
3. `gcloud sql instances patch --activation-policy=NEVER`. The instance stops;
   disk, databases, users and rows stay. Only storage is billed while stopped.

**Staging wake**
1. `--activation-policy=ALWAYS`, then waits until the instance is `RUNNABLE`
   (default timeout 600 s, `WAKE_TIMEOUT_SECONDS`).
2. Resumes **only** the jobs recorded in `state.json`. A job somebody paused on
   purpose is never resumed behind their back.
3. Overwrites `state.json` with an empty list (bookkeeping is overwritten, never
   deleted).

Both are idempotent: sleeping a sleeping environment or waking an awake one is a
no-op that says so.

**Local sleep** (`down.sh --sleep`): `docker compose stop` only — containers, images,
networks and volumes all kept, and **Docker Desktop is left running**. Quitting the
app (to free the VM's reserved RAM) is a separate opt-in: `--sleep --quit-docker`,
which cannot target single units. `--sleep` cannot be combined with `-r`/`-v`.

## CI integration
- `deploy-staging.sh` runs `power.sh staging wake` first (skip with `SKIP_WAKE=1`),
  so a deploy to a sleeping staging works without a human. The gate-triggered
  deploy and manual runs both go through it.
- `gcp-staging.yml` has an opt-in input **`sleep_after`** (default **false**): after a
  *green* smoke it puts staging back to sleep. Default off on purpose, so a push
  deploy does not switch staging off while you are testing. A failed deploy never
  sleeps (it stays up for debugging).
- Prod is untouched: `power.sh` refuses anything but staging, and no prod
  workflow references it.

## One-time IAM for CI (APPLIED 2026-10-03 to the staging CI service account only)
The CI service account needs a **narrow** custom role, not `cloudsql.admin`
(which can delete instances). Scheduler pause/resume and the bucket write are
already covered by `cloudscheduler.admin` and `storage.admin`.
```bash
P=<gcp-project>
gcloud iam roles create datiqSqlPower --project=$P \
  --title="DatIQ Cloud SQL power (get/list/update only)" \
  --permissions=cloudsql.instances.get,cloudsql.instances.list,cloudsql.instances.update
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:<staging-ci-sa>@$P.iam.gserviceaccount.com" \
  --role="projects/$P/roles/datiqSqlPower" --condition=None
```
Without this the wake step in CI fails at the first Cloud SQL call. Prod's CI
account deliberately does NOT get it (`power.sh` refuses prod).

## Guarantees (pinned by `scripts/power-safety.test.mjs`, run in `test:unit`)
- No deletion verb anywhere in the sleep/wake code paths (`delete`, `rm`, `--wipe`,
  `--delete-data`, `down -v`, …).
- Cloud SQL is only ever stopped by the activation-policy flip.
- `power.sh` refuses everything except staging.
- `down.sh --sleep` is handled by `exec` **before** any teardown code can run and
  cannot be combined with other flags.
- The resume list is written before the database is stopped.
- A deploy wakes first; `sleep_after` only fires after a green smoke.

## Trade-offs and what this does not do
- **Saving is modest** for `db-f1-micro` (a few dollars a month); it pays off if
  staging sits idle most days. Cloud Run, Hosting, Secret Manager and Artifact
  Registry have no meaningful idle cost to switch off.
- **No auto-wake on traffic** and **no nightly auto-sleep yet.** A nightly
  sleep would be a Cloud Scheduler job calling the Cloud SQL Admin API (or a
  scheduled workflow, which GitHub only runs from the default branch). Not built;
  `sleep_after` and the manual command cover it for now.
- **Image cleanup policies** in Artifact Registry would save storage but they
  *delete* images, so they are deliberately out of scope here.
- **Stopped Cloud SQL still pays for storage**, and automated backups do not run
  while it is stopped.
- Other always-on instances in the project (e.g. an unrelated `n8n` DB) are not
  managed by this feature.
