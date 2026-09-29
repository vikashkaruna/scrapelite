#!/usr/bin/env bash
# deployment/scripts/gcp/proxy-studio.sh — proxy private Cloud Run Studio to localhost.
#   proxy-studio.sh staging [--port <port>]
#   proxy-studio.sh prod    [--port <port>]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: proxy-studio.sh <staging|prod> [--port <port>]}"
load_gcp_env "$ENV_NAME"
shift || true

PORT="${STUDIO_HOST_PORT:-54328}"
if [ "${1:-}" = "--port" ]; then PORT="${2:?--port needs a value}"; fi

echo "→ Proxying private Cloud Run Studio (${CLOUD_RUN_STUDIO}) to http://localhost:${PORT}"
echo "  Press Ctrl+C to stop."
gcloud run services proxy "$CLOUD_RUN_STUDIO" "${GCP_FLAGS[@]}" --port="$PORT"
