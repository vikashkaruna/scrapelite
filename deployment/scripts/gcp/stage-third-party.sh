#!/usr/bin/env bash
# deployment/scripts/gcp/stage-third-party.sh — mirror the upstream auth (GoTrue)
# and REST (PostgREST) images into Artifact Registry so Cloud Run can deploy
# them (Cloud Run cannot pull public.ecr.aws directly). Studio + pg-meta have
# their own wrapper (stage-studio.sh).
#
#   stage-third-party.sh staging
#   stage-third-party.sh prod
#
# Why this exists as a SCRIPT (2026-10-01): the two images were mirrored once
# by hand when the environment was first stood up. down.sh deletes the Artifact
# Registry repo with the rest of the stack — leaving the rebuild path without
# any way to re-create these images, so `up.sh` could not actually rebuild the
# environment it tears down. This wrapper + the self-heal step in
# deploy-staging.sh close that loop.
#
# SRC refs default to the versions the LOCAL stack pins and verifies
# (deployment/env/.env.local: gotrue v2.196.0, postgrest v14.14). Bump
# deliberately, only after the local stack has run the new version.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: stage-third-party.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"
require_vars IMG_GOTRUE IMG_POSTGREST

GOTRUE_SRC="${GOTRUE_SRC:-public.ecr.aws/supabase/gotrue:v2.196.0}"
POSTGREST_SRC="${POSTGREST_SRC:-public.ecr.aws/supabase/postgrest:v14.14}"

echo "→ Cloud Build: mirroring GoTrue + PostgREST into ${IMG_BASE}"
gcloud builds submit "$REPO_DIR" \
  --project="$GCP_PROJECT_ID" \
  --config="$DEPLOY_DIR/gcp/cloudbuild/stage-third-party.yaml" \
  --substitutions="_AUTH_SRC=${GOTRUE_SRC},_REST_SRC=${POSTGREST_SRC},_IMG_GOTRUE=${IMG_GOTRUE},_IMG_POSTGREST=${IMG_POSTGREST}" \
  --timeout=20m

echo "✓ GoTrue & PostgREST mirrored to ${IMG_BASE}"
