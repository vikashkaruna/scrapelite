#!/usr/bin/env bash
# deployment/scripts/lib/docker-power.sh — start/quit Docker Desktop itself.
#
# Stopping containers (down.sh / stack.sh stop) frees what they use, but the
# Docker Desktop VM keeps its reserved RAM until the app quits. These helpers
# let `down.sh --sleep` release it and `up.sh` / `stack.sh start` bring it back.
# Neither removes a container, image, network or volume — quitting Docker
# Desktop only stops the VM; everything is intact on the next start.
#
# Source it; both functions are no-ops where they do not apply (Linux, CI).

docker_running() { docker info >/dev/null 2>&1; }

# ensure_docker_running — start Docker Desktop (macOS) if the daemon is down,
# then wait for it. Silent when it is already up.
ensure_docker_running() {
  docker_running && return 0
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "✗ the Docker daemon is not running — start it and retry" >&2; return 1
  fi
  echo "→ Docker Desktop is not running — starting it"
  open -a Docker
  local waited=0
  until docker_running; do
    [ "$waited" -lt "${DOCKER_START_TIMEOUT:-180}" ] || { echo "✗ Docker did not come up within ${DOCKER_START_TIMEOUT:-180}s" >&2; return 1; }
    sleep 3; waited=$((waited+3))
  done
  echo "  ✓ Docker is up (${waited}s)"
}

# quit_docker_desktop — release the VM's memory. macOS only; best effort.
quit_docker_desktop() {
  [ "$(uname -s)" = "Darwin" ] || { echo "  (not macOS — leaving the Docker daemon alone)"; return 0; }
  docker_running || { echo "  = Docker Desktop already stopped"; return 0; }
  echo "→ quitting Docker Desktop to release its VM memory"
  osascript -e 'quit app "Docker"' >/dev/null 2>&1 || docker desktop stop >/dev/null 2>&1 || {
    echo "  ⚠ could not quit Docker Desktop automatically — quit it from the menu bar"; return 0; }
  echo "  ✓ Docker Desktop quitting (containers/volumes are intact; start it again with up.sh or stack.sh start)"
}
