#!/usr/bin/env bash
# deployment/scripts/gcp/build-images.sh — build + push the api/admin/trackers
# images via Cloud Build, tagged with IMG_TAG (default: current git sha).
#   build-images.sh staging [--tag <tag>] [api|admin|trackers...]
#
# Unit args are the INCREMENTAL variant: only the named images are built and
# pushed (the web dist/ step still runs — deploy-hosting.sh consumes it).
#   build-images.sh staging api          # api only (jobs shares the api image)
#   build-images.sh staging admin trackers
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: build-images.sh <staging|prod> [--tag <tag>] [api|admin|trackers...]}"
load_gcp_env "$ENV_NAME"
shift
UNITS="api,admin,trackers"
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) export IMG_TAG="${2:?--tag needs a value}"; shift 2 ;;
    api|admin|trackers) SELECTED="${SELECTED:-}$1,"; shift ;;
    *) echo "✗ unknown arg: $1 (units: api|admin|trackers)"; exit 1 ;;
  esac
done
[ -n "${SELECTED:-}" ] && UNITS="$(printf '%s' "${SELECTED%,}" | tr ' ' ',')"

echo "→ Cloud Build: units=[$UNITS] (tag ${IMG_TAG})"
gcloud builds submit "$REPO_DIR" \
  --project="$GCP_PROJECT_ID" \
  --config="$DEPLOY_DIR/gcp/cloudbuild/build-images.yaml" \
  --substitutions="_IMG_API=${IMG_API},_IMG_ADMIN=${IMG_ADMIN},_IMG_TRACKERS=${IMG_TRACKERS},_VITE_RAZORPAY_KEY_ID=${VITE_RAZORPAY_KEY_ID:-},_UNITS=${UNITS}" \
  --timeout=30m

echo "✓ images in ${IMG_BASE}"
