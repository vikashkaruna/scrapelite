#!/usr/bin/env bash
# deployment/scripts/down.sh — take the local stack DOWN, data-safe by default.
#
#   deployment/scripts/down.sh [env-name] [unit...]   # STOP — containers retained
#   deployment/scripts/down.sh local api              # stop only these units
#   deployment/scripts/down.sh -r / --remove          # remove containers+networks,
#                                                     #   volumes (data) KEPT
#   deployment/scripts/down.sh -v / --wipe            # remove containers AND
#                                                     #   volumes — deletes the
#                                                     #   local database data
#
# The default is `docker compose stop`: containers are retained exactly as
# they are — databases included — so local test data survives and
# `stack.sh start` (or `up.sh`) resumes everything. Removing anything is
# always an explicit flag; `-v` is the only path that touches the data.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Usage: down.sh [env-name] [unit...] [-r|--remove] [-v|--wipe] — any order
# (the README has always documented `down.sh -v`).
ENV_NAME="local"; REMOVE=0; WIPE=0; UNITS=""
for arg in "$@"; do
  case "$arg" in
    -r|--remove) REMOVE=1 ;;
    -v|--wipe) WIPE=1 ;;
    local|staging|prod) ENV_NAME="$arg" ;;
    gateway|web|admin|trackers|api|jobs|scheduler|db|auth|rest|mailpit|pg-meta|studio) UNITS="$UNITS $arg" ;;
    *) echo "✗ unknown arg: $arg (env name, unit name, -r|--remove or -v|--wipe)"; exit 1 ;;
  esac
done
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "$ENV_NAME"

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml"
if [ "${DATA_MODE:-local-db}" = "local-db" ]; then COMPOSE="$COMPOSE -f $HERE/compose/compose.local.yaml"; fi

if [ "$WIPE" = "1" ]; then
  echo "⚠  -v: volumes will be deleted — the local database data does not survive this"
  $COMPOSE down -v --remove-orphans
  echo "✓ stack down, containers + volumes deleted"
elif [ "$REMOVE" = "1" ]; then
  $COMPOSE down --remove-orphans
  echo "✓ stack down, containers removed (volumes kept — data safe; add -v to also delete the local database)"
else
  $COMPOSE stop $UNITS
  echo "✓ stack stopped — containers retained, data safe"
  echo "    resume: deployment/scripts/stack.sh start (or up.sh)"
  echo "    remove containers: down.sh -r · remove containers + data: down.sh -v"
fi
