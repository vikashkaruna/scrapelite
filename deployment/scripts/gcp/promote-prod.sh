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
  # Ride the override channel, NOT IMG_API: the env file is sourced with set -a
  # inside deploy-run.sh → load_gcp_env, which recomposes IMG_API from IMG_TAG
  # and would silently DISCARD a plain IMG_API export (the digests never
  # reached the deploy before this channel existed).
  export DATIQ_IMG_API_OVERRIDE="$1" DATIQ_IMG_ADMIN_OVERRIDE="$2" DATIQ_IMG_TRACKERS_OVERRIDE="$3"
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
    pkg="${staging_base}/datiq-${DATIQ_PROJECT_CODE}-ctr-${kind}"
    # `images list --include-tags` needs only Artifact Registry read. `images
    # describe` ALSO calls Container Analysis, which the CI service account does
    # not hold — it reported a present image as missing (2026-10-03), and the
    # old `2>/dev/null || true` hid why. stderr is kept so the cause is visible.
    err_file="$(mktemp)"
    version="$(gcloud artifacts docker images list "$pkg" --include-tags \
      --filter="tags:${staging_tag}" --format='value(version)' \
      --project="$staging_project" 2>"$err_file" | head -n1 || true)"
    if [ -z "$version" ]; then
      echo "✗ no staging digest for ctr-${kind}:${staging_tag} in ${staging_base} — run build-images.sh staging first"
      echo "  gcloud said: $(tail -3 "$err_file" | tr '\n' ' ' | cut -c1-400)"
      rm -f "$err_file"; exit 1
    fi
    rm -f "$err_file"
    digest="${pkg}@${version}"
    export "DATIQ_IMG_${var#IMG_}_OVERRIDE=$digest"
  done
else
  echo "usage: promote-prod.sh prod [digest digest digest] (or DIGESTS_FROM=staging)"; exit 1
fi

echo "→ deploying the prod twin (OPS_JOBS_DISABLED=${OPS_JOBS_DISABLED:-1} — shadow)"
"$HERE/deploy-run.sh" "$ENV_NAME" api jobs admin trackers studio
[ -n "${SKIP_SCHEDULER:-}" ] || "$HERE/deploy-scheduler.sh" "$ENV_NAME"
[ -n "${SKIP_HOSTING:-}" ] || "$HERE/deploy-hosting.sh" "$ENV_NAME"
"$HERE/smoke.sh" "$ENV_NAME"
