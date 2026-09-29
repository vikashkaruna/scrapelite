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
  # The staging repo lives in the STAGING project's registry — IMG_BASE here is
  # the PROD base (lib-gcp composes it from the prod env), so the staging
  # coordinates must come from the prod env file (doc 06):
  #   STAGING_GCP_PROJECT_ID, STAGING_AR_REPO, STAGING_IMG_TAG
  # STAGING_IMG_TAG is the staging image tag to promote (the staging git sha
  # that build-images.sh pushed — build-images.sh never tags `:staging`).
  staging_project="${STAGING_GCP_PROJECT_ID:?set STAGING_GCP_PROJECT_ID in .env.prod (staging project id)}"
  staging_repo="${STAGING_AR_REPO:?set STAGING_AR_REPO in .env.prod (staging AR repo name, e.g. the -stg repo)}"
  staging_region="${STAGING_GCP_REGION:-$GCP_REGION}"
  staging_tag="${STAGING_IMG_TAG:?set STAGING_IMG_TAG=<staging git sha> in .env.prod (the tag build-images.sh staging pushed)}"
  staging_base="${staging_region}-docker.pkg.dev/${staging_project}/${staging_repo}"
  for kind in api admin trackers; do
    var="IMG_$(printf '%s' "$kind" | tr '[:lower:]' '[:upper:]')"
    digest="$(gcloud artifacts docker images describe \
      "${staging_base}/datiq-${DATIQ_PROJECT_CODE}-ctr-${kind}:${staging_tag}" \
      --project="$staging_project" --format='value(fullyQualifiedDigest)' 2>/dev/null || true)"
    [ -n "$digest" ] || { echo "✗ no staging digest for ctr-${kind}:${staging_tag} in ${staging_base} — run build-images.sh staging first"; exit 1; }
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
