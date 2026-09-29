#!/usr/bin/env bash
# deployment/scripts/gcp/build-images.sh — build + push the api/admin/trackers
# images via Cloud Build, tagged with IMG_TAG (default: current git sha).
#   build-images.sh staging [--tag <tag>]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: build-images.sh <staging|prod> [--tag <tag>]}"
load_gcp_env "$ENV_NAME"
if [ "${2:-}" = "--tag" ]; then export IMG_TAG="${3:?--tag needs a value}"; fi

echo "→ Cloud Build: api/admin/trackers (tag ${IMG_TAG})"
gcloud builds submit "$REPO_DIR" \
  --project="$GCP_PROJECT_ID" \
  --config="$DEPLOY_DIR/gcp/cloudbuild/build-images.yaml" \
  --substitutions="_IMG_API=${IMG_API},_IMG_ADMIN=${IMG_ADMIN},_IMG_TRACKERS=${IMG_TRACKERS},_VITE_RAZORPAY_KEY_ID=${VITE_RAZORPAY_KEY_ID:-}" \
  --timeout=30m

echo "✓ images in ${IMG_BASE}"
