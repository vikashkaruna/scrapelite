#!/usr/bin/env bash
# deployment/scripts/up.sh — bring the local stack up (Docker Desktop).
#   deployment/scripts/up.sh [env-name] [unit...]     (default env: local)
#   deployment/scripts/up.sh local web gateway        # INCREMENTAL: only these
#                                                     # units build + restart
#   SKIP_BUILD=1 deployment/scripts/up.sh local       # no rebuilds at all
# Renders config from .env.<env> (fresh every run — an env edit + a targeted
# `up.sh local <unit>` is the incremental env-update path locally), builds the
# images (all or the named units), starts the stack (local-db profile when
# DATA_MODE=local-db), applies migrations (full up only), smokes it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # deployment/
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
ENV_NAME="local"; UNITS=""
for arg in "$@"; do
  case "$arg" in
    local|staging|prod) ENV_NAME="$arg" ;;
    gateway|web|admin|trackers|api|jobs|scheduler|db|auth|rest|mailpit|pg-meta|studio) UNITS="$UNITS $arg" ;;
    *) echo "✗ unknown arg: $arg (compose service name or env name)"; exit 1 ;;
  esac
done
# shellcheck disable=SC1091
source "$HERE/scripts/lib/docker-power.sh"
ensure_docker_running   # wakes Docker Desktop after `down.sh --sleep`
load_env "$ENV_NAME"
require_vars COMPOSE_PROJECT_NAME DATA_MODE JWT_SECRET POSTGRES_PASSWORD JOBS_TOKEN LOCAL_GATEWAY_PORT PUBLIC_BASE_URL

node "$HERE/scripts/gen-local-config.mjs" --env "${DATIQ_ENV}" --out "$HERE/generated"

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml"
if [ "${DATA_MODE}" = "local-db" ]; then
  COMPOSE="$COMPOSE -f $HERE/compose/compose.local.yaml"
else
  echo "→ DATA_MODE=shared-db: using the hosted dev Supabase (no local db/auth/rest)"
fi

# ── Ensure project dependencies are installed ─────────────────────────────────
# The web build (build-docker-web.mjs) needs the project-local vite binary and
# all its plugins. A fresh clone, a git worktree, or a post-`down.sh -v` run
# may have an empty or missing node_modules.
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# ⚠️ Checking for the vite binary alone is NOT enough: a node_modules installed
# from an OLDER package.json still has vite, and the build then dies deep inside
# PostCSS ("Cannot find module '@tailwindcss/postcss'") — the Tailwind 3→4 bump
# is exactly how this bit. So verify EVERY declared dependency is present.
MISSING_DEPS="$(node -e '
  const fs = require("fs"), path = require("path");
  const root = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const missing = names.filter((n) => !fs.existsSync(path.join(root, "node_modules", n, "package.json")));
  process.stdout.write(missing.join(" "));
' "$REPO_ROOT" 2>/dev/null || echo "?")"
if [ ! -x "$REPO_ROOT/node_modules/.bin/vite" ] || [ -n "$MISSING_DEPS" ]; then
  echo "→ node_modules out of date${MISSING_DEPS:+ (missing: $MISSING_DEPS)} — running npm install"
  # A scratch --cache sidesteps root-owned ~/.npm/_cacache entries (EACCES).
  npm install --prefix "$REPO_ROOT" --cache "${TMPDIR:-/tmp}/datiq-npm-cache"
fi

# ⚠️ THE WEB IMAGE IS nginx + A PREBUILT dist/ — THE DOCKERFILE COPIES dist/ AND
# BUILDS NOTHING. So `docker compose up --build` was serving whatever dist/
# happened to be on disk, which on a developer machine is the output of a
# `npm run build` that read the REPO-ROOT .env: a public bundle pointed at the
# hosted dev Supabase project while every container here talked to the local one.
# Building it here, from the env this stack is actually configured with, is what
# makes the two halves agree.
echo "→ building the web payload from .env.${DATIQ_ENV}"
node "$HERE/../scripts/build-docker-web.mjs"

echo "→ building + starting stack ($COMPOSE_PROJECT_NAME, mode=$DATA_MODE${UNITS:+, units:$UNITS})"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "→ SKIP_BUILD=1 — no image rebuilds"
  $COMPOSE up -d $UNITS
elif [ -n "$UNITS" ]; then
  # Incremental: rebuild + restart only the named units. compose still brings
  # up their dependencies with --build limited to these services.
  $COMPOSE up -d --build $UNITS
else
  $COMPOSE up -d --build
fi

if [ "${DATA_MODE}" = "local-db" ] && [ -z "$UNITS" ]; then
  echo "→ applying repo migrations (idempotent; skipped in incremental unit mode)"
  $COMPOSE --profile migrate run --rm migrator
fi

echo "→ smoke"
"$HERE/tests/stack-smoke.sh"

echo
echo "✓ DatIQ local stack is up"
echo "    app:        ${PUBLIC_BASE_URL}"
echo "    admin:      ${PUBLIC_BASE_URL}/admin/  (PIN from .env)"
echo "    mailpit:    http://127.0.0.1:${MAILPIT_UI_PORT:-8025}"
if [ "${DATA_MODE}" = "local-db" ]; then
  echo "    postgres:   127.0.0.1:${DB_HOST_PORT:-54329} (postgres / \$POSTGRES_PASSWORD)"
  echo "    studio:     http://localhost:${STUDIO_HOST_PORT:-54328}"
fi
