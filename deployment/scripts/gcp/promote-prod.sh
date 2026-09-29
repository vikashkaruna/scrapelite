#!/usr/bin/env bash
# deployment/scripts/gcp/promote-prod.sh — the production twin ("shadow") deploy
# (doc 05 §3b). Same artifacts as staging, promoted by IMAGE DIGEST — no rebuild:
#
#   promote-prod.sh prod <api-digest> <admin-digest> <trackers-digest>
#     or: DIGESTS_FROM=staging promote-prod.sh prod   (resolves staging's latest)
#
# The shadow runs against the PRODUCTION hosted Supabase (prod env file) with
# OPS_JOBS_DISABLED=1 until cron ownership is flipped (never both, doc 05 §3b).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: promote-prod.sh prod [api-digest admin-digest trackers-digest]}"
[ "$ENV_NAME" = "prod" ] || { echo "✗ promote-prod.sh is for the prod env only"; exit 1; }
load_gcp_env "$ENV_NAME"
shift || true

if [ $# -eq 3 ]; then
  export IMG_API="$1" IMG_ADMIN="$2" IMG_TRACKERS="$3"
elif [ "${DIGESTS_FROM:-staging}" = "staging" ]; then
  echo "→ resolving image digests from the staging deploy (digest promotion — no rebuild)"
  staging_project="${STAGING_GCP_PROJECT_ID:-$GCP_PROJECT_ID}"
  staging_repo="${STAGING_AR_REPO:-$(echo "$AR_REPO" | sed "s/-${SM_ENV_SUFFIX}$/-stg/")}"
  for kind in api admin trackers; do
    var="IMG_$(printf '%s' "$kind" | tr '[:lower:]' '[:upper:]')"
    digest="$(gcloud artifacts docker images describe \
      "${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-${kind}:staging" \
      --project="$staging_project" --format='value(fullyQualifiedDigest)' 2>/dev/null || true)"
    [ -n "$digest" ] || { echo "✗ no staging digest for ctr-${kind} — build staging first"; exit 1; }
    export "$var=$digest"
  done
else
  echo "usage: promote-prod.sh prod [digest digest digest] (or DIGESTS_FROM=staging)"; exit 1
fi

echo "→ deploying the prod twin (OPS_JOBS_DISABLED=${OPS_JOBS_DISABLED:-1} — shadow)"
"$HERE/deploy-run.sh" "$ENV_NAME"
[ -n "${SKIP_SCHEDULER:-}" ] || "$HERE/deploy-scheduler.sh" "$ENV_NAME"
[ -n "${SKIP_HOSTING:-}" ] || "$HERE/deploy-hosting.sh" "$ENV_NAME"
"$HERE/smoke.sh" "$ENV_NAME"
