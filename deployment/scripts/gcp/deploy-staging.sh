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
ENV_NAME="${1:?usage: deploy-staging.sh <staging|prod>}"

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
  step "cloud sql + supabase dump/restore rehearsal"; "$HERE/migrate-db.sh" "$ENV_NAME"
  step "auth/rest proof services"; "$HERE/deploy-run.sh" "$ENV_NAME" auth rest || \
    echo "⚠ auth/rest proof services failed (non-blocking on staging)"
fi
if [ -z "${SKIP_SCHEDULER:-}" ]; then
  step "cloud scheduler (13 jobs)"; "$HERE/deploy-scheduler.sh" "$ENV_NAME"
fi
if [ -z "${SKIP_HOSTING:-}" ]; then
  step "firebase hosting (static payload)"; "$HERE/deploy-hosting.sh" "$ENV_NAME"
fi

step "smoke"
"$HERE/smoke.sh" "$ENV_NAME" || true
