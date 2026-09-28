#!/usr/bin/env bash
# deployment/scripts/down.sh — stop the stack. Pass -v to also delete volumes
# (the local database!). Default keeps data.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "${1:-local}"

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml"
if [ "${DATA_MODE:-local-db}" = "local-db" ]; then COMPOSE="$COMPOSE -f $HERE/compose/compose.local.yaml"; fi

if [ "${2:-}" = "-v" ] || [ "${1:-}" = "-v" ]; then
  $COMPOSE down -v --remove-orphans
  echo "✓ stack down, volumes deleted"
else
  $COMPOSE down --remove-orphans
  echo "✓ stack down (data kept — run with -v to delete the local database)"
fi
