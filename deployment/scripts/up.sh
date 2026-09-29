#!/usr/bin/env bash
# deployment/scripts/up.sh — bring the local stack up (Docker Desktop).
#   deployment/scripts/up.sh [env-name]     (default: local)
# Renders config from .env.<env>, builds the images, starts the stack
# (local-db profile when DATA_MODE=local-db), applies migrations, smokes it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # deployment/
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "${1:-local}"
require_vars COMPOSE_PROJECT_NAME DATA_MODE JWT_SECRET POSTGRES_PASSWORD JOBS_TOKEN LOCAL_GATEWAY_PORT PUBLIC_BASE_URL

node "$HERE/scripts/gen-local-config.mjs" --env "${DATIQ_ENV}" --out "$HERE/generated"

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml"
if [ "${DATA_MODE}" = "local-db" ]; then
  COMPOSE="$COMPOSE -f $HERE/compose/compose.local.yaml"
else
  echo "→ DATA_MODE=shared-db: using the hosted dev Supabase (no local db/auth/rest)"
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

echo "→ building + starting stack ($COMPOSE_PROJECT_NAME, mode=$DATA_MODE)"
$COMPOSE up -d --build

if [ "${DATA_MODE}" = "local-db" ]; then
  echo "→ applying repo migrations (idempotent)"
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
