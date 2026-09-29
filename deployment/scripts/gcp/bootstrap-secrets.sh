#!/usr/bin/env bash
# deployment/scripts/gcp/bootstrap-secrets.sh — push runtime secret VALUES from
# the operator env file (scripts/env/<env>.env, gitignored) into Secret Manager.
# Idempotent: a new version is added only when the value changed. No secret
# value is ever printed or written anywhere.
#
#   bootstrap-secrets.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: bootstrap-secrets.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-$REPO_DIR/scripts/env/$ENV_NAME.env}"
[ -f "$RUNTIME_ENV_FILE" ] || { echo "✗ operator env file not found: $RUNTIME_ENV_FILE"; exit 1; }
MANIFEST="$DEPLOY_DIR/gcp/secrets.manifest"
[ -f "$MANIFEST" ] || { echo "✗ manifest not found: $MANIFEST"; exit 1; }

# get_val <KEY> — read a value from the operator file in a throwaway shell
# (unset -u/-e so sparse files source cleanly); falls back to the deploy env.
get_val() {
  local v
  v="$( { set +euo pipefail; . "$RUNTIME_ENV_FILE" >/dev/null 2>&1 || true; printf '%s' "${!1:-}"; } )"
  [ -z "$v" ] && v="${!1:-}"
  printf '%s' "$v"
}

pushed=0; unchanged=0; skipped=0
while read -r runtime_var source_key services; do
  case "$runtime_var" in ''|\#*) continue;; esac
  secret_name="$(sm_name "$runtime_var")"
  value="$(get_val "$source_key")"
  if [ -z "$value" ]; then
    echo "  skip ${secret_name} (no value for ${source_key})"
    skipped=$((skipped+1)); continue
  fi
  if ! gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --project="$GCP_PROJECT_ID" \
      --replication-policy=automatic --quiet >/dev/null
  fi
  existing="$(gcloud secrets versions access latest --secret="$secret_name" \
    --project="$GCP_PROJECT_ID" 2>/dev/null || true)"
  if [ "$existing" = "$value" ]; then
    echo "  ok   ${secret_name} (unchanged)"; unchanged=$((unchanged+1)); continue
  fi
  printf '%s' "$value" | gcloud secrets versions add "$secret_name" \
    --project="$GCP_PROJECT_ID" --data-file=- --quiet >/dev/null
  echo "  push ${secret_name} → ${services}"
  pushed=$((pushed+1))
done < "$MANIFEST"

echo "✓ secrets: $pushed pushed, $unchanged unchanged, $skipped skipped (empty source) — project $GCP_PROJECT_ID"
