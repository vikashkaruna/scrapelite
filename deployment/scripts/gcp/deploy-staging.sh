#!/usr/bin/env bash
# deployment/scripts/gcp/deploy-staging.sh — orchestrates the full GCP staging
# deploy (doc 05 §3a). Every step is idempotent and individually skippable:
#
#   deploy-staging.sh staging                  # everything, in order
#   SKIP_BUILD=1 deploy-staging.sh staging     # reuse existing images
#   SKIP_DB=1 deploy-staging.sh staging        # skip Cloud SQL migration
#   SKIP_SCHEDULER=1 …  SKIP_HOSTING=1 …
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: deploy-staging.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

step() { echo; echo "━━━ $1 ━━━"; }

step "bootstrap";   [ -n "${SKIP_BOOTSTRAP:-}" ]   || "$HERE/bootstrap.sh" "$ENV_NAME"
step "secrets";     [ -n "${SKIP_SECRETS:-}" ]     || "$HERE/bootstrap-secrets.sh" "$ENV_NAME"
if [ -z "${SKIP_BUILD:-}" ]; then
  step "images (Cloud Build)"; "$HERE/build-images.sh" "$ENV_NAME"
else
  echo "→ images skipped (SKIP_BUILD=1, using IMG_TAG=${IMG_TAG:-from env})"
fi
step "cloud run (api/jobs/admin/trackers)"; "$HERE/deploy-run.sh" "$ENV_NAME"
if [ -z "${SKIP_DB:-}" ]; then
  if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
    # POST-CUTOVER: Cloud SQL is the LIVE database. The rehearsal truncates
    # and reloads it — migrate-db.sh itself refuses (see its guard); skipping
    # here keeps the deploy log honest about why.
    step "cloud sql (skipped — DATA_MODE=cloud-sql: Cloud SQL is live, nothing to rehearse)"
  else
    step "cloud sql + supabase dump/restore rehearsal"; "$HERE/migrate-db.sh" "$ENV_NAME"
  fi
  step "auth/rest + studio services"
  if ! "$HERE/deploy-run.sh" "$ENV_NAME" auth rest studio; then
    if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
      # POST-CUTOVER these ARE the serving auth/data path (/auth/v1 +
      # /rest/v1 rewrites) — a failed deploy here breaks sign-in. Never
      # "non-blocking" again.
      echo "✗ auth/rest redeploy FAILED and they are ON THE SERVING PATH (DATA_MODE=cloud-sql)"; exit 1
    fi
    echo "⚠ auth/rest proof services failed (non-blocking pre-cutover — staging still reads hosted Supabase)"
  fi
fi
if [ -z "${SKIP_SCHEDULER:-}" ]; then
  step "cloud scheduler (13 jobs)"; "$HERE/deploy-scheduler.sh" "$ENV_NAME"
fi
if [ -z "${SKIP_HOSTING:-}" ]; then
  step "firebase hosting (static payload)"; "$HERE/deploy-hosting.sh" "$ENV_NAME"
fi

step "smoke"
# NOT `|| true`: a failed parity smoke must fail the deploy (CI re-runs it
# unguarded, but the operator path is the primary gate). Genuinely
# environment-specific smoke degradations print their own SKIP line.
"$HERE/smoke.sh" "$ENV_NAME"
