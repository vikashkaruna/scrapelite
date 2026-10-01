#!/usr/bin/env bash
# deployment/scripts/gcp/proxy-studio.sh — serve the PRIVATE Cloud Run Studio on
# localhost for operators. The heavy lifting (audience-scoped impersonated ID
# token + refresh + forwarding) lives in studio-proxy.mjs — see its header for
# why `gcloud run services proxy` cannot do this with operator credentials
# (both its plain and --impersonate modes fail against Cloud Run IAM; verified
# live 2026-10-01).
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
require_vars CLOUD_RUN_STUDIO SA_DEPLOY_EMAIL

exec node "$DEPLOY_DIR/scripts/studio-proxy.mjs" \
  --service "$CLOUD_RUN_STUDIO" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --sa "$SA_DEPLOY_EMAIL" \
  --port "$PORT"
