#!/usr/bin/env bash
# deployment/scripts/stack.sh — lifecycle verbs for a stack that is already
# built (complements up.sh / down.sh; touches no images, no volumes):
#
#   deployment/scripts/stack.sh [env-name] start|stop|pause|unpause|restart|status [unit...]
#
#   stack.sh status              # one row per container, stopped ones included
#   stack.sh stop                # same as down.sh default — containers retained
#   stack.sh start               # resume a stopped stack (after down.sh / stop)
#   stack.sh pause               # freeze processes — state stays in memory
#   stack.sh unpause             # resume after pause
#   stack.sh restart web api     # bounce named units (or the whole stack)
#
# Together with every long-running service's `restart: unless-stopped` policy
# this is what makes stop/pause durable: a container YOU stopped or paused
# stays that way across Docker Desktop restarts — the policy only revives
# containers that were still RUNNING when the daemon went away.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"

VERB=""; ENV_NAME="local"; UNITS=""
for arg in "$@"; do
  case "$arg" in
    start|stop|pause|unpause|restart|status|ps) VERB="$arg" ;;
    local|staging|prod) ENV_NAME="$arg" ;;
    gateway|web|admin|trackers|api|jobs|scheduler|db|auth|rest|mailpit|pg-meta|studio) UNITS="$UNITS $arg" ;;
    *) echo "✗ unknown arg: $arg (expected a verb: start|stop|pause|unpause|restart|status, an env name, or a unit name)"; exit 1 ;;
  esac
done
[ -n "$VERB" ] || { echo "✗ no verb given. usage: stack.sh [env-name] start|stop|pause|unpause|restart|status [unit...]"; exit 1; }

load_env "$ENV_NAME"

# shellcheck disable=SC1091
source "$HERE/scripts/lib/docker-power.sh"
case "$VERB" in start|restart|unpause) ensure_docker_running ;; esac

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml"
if [ "${DATA_MODE:-local-db}" = "local-db" ]; then COMPOSE="$COMPOSE -f $HERE/compose/compose.local.yaml"; fi

case "$VERB" in
  status|ps)
    $COMPOSE ps -a $UNITS
    ;;
  stop)
    $COMPOSE stop $UNITS
    echo "✓ stopped — containers retained (resume: stack.sh start)"
    ;;
  start)
    # `start` can only resume containers that still EXIST. After down.sh -r
    # they are gone; say so instead of letting compose's bare error mislead.
    if ! $COMPOSE start $UNITS; then
      echo "✗ could not start — containers may have been removed by 'down.sh -r'. Recreate with: up.sh" >&2
      exit 1
    fi
    echo "✓ started (existing containers resumed — nothing was recreated)"
    ;;
  pause)
    $COMPOSE pause $UNITS
    echo "✓ paused — processes frozen, memory state kept (resume: stack.sh unpause)"
    ;;
  unpause)
    $COMPOSE unpause $UNITS
    echo "✓ unpaused"
    ;;
  restart)
    $COMPOSE restart $UNITS
    echo "✓ restarted"
    ;;
esac
