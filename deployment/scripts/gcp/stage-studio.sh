#!/usr/bin/env bash
# deployment/scripts/gcp/stage-studio.sh — mirror upstream Supabase Studio and
# pg-meta images into Artifact Registry so Cloud Run can deploy them.
#   stage-studio.sh staging
#   stage-studio.sh prod
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: stage-studio.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

STUDIO_SRC="${STUDIO_SRC:-public.ecr.aws/supabase/studio:2026.07.06-sha-66cf431}"
PG_META_SRC="${PG_META_SRC:-public.ecr.aws/supabase/postgres-meta:v0.96.6}"

echo "→ Cloud Build: staging Studio + pg-meta into ${IMG_BASE}"
gcloud builds submit "$REPO_DIR" \
  --project="$GCP_PROJECT_ID" \
  --config="$DEPLOY_DIR/gcp/cloudbuild/stage-studio.yaml" \
  --substitutions="_STUDIO_SRC=${STUDIO_SRC},_PG_META_SRC=${PG_META_SRC},_IMG_STUDIO=${IMG_STUDIO},_IMG_PG_META=${IMG_PG_META}" \
  --timeout=20m

echo "✓ Studio & pg-meta mirrored to ${IMG_BASE}"
