#!/usr/bin/env bash
# deployment/scripts/gcp/up.sh — bring an environment's ENTIRE GCP stack up,
# in dependency order, from just the env file. The counterpart of down.sh.
#
#   up.sh staging                    # bootstrap → secrets → build → deploy →
#                                    # (db) → scheduler → hosting → smoke
#   SKIP_* vars pass through to deploy-staging.sh verbatim:
#   SKIP_BUILD=1 SKIP_DB=1 SKIP_SCHEDULER=1 SKIP_HOSTING=1 SKIP_BOOTSTRAP=1 SKIP_SECRETS=1 up.sh staging
#
#   up.sh prod                       # prod shadow: bootstrap → secrets →
#                                    # digest-promote (staging artifacts) → hosting → smoke
#   up.sh prod --build               # build fresh prod images instead of promoting
#   up.sh prod --with-db             # ALSO create/restore prod Cloud SQL (cutover-adjacent;
#                                    # default OFF — prod DB changes belong to the cutover window)
#
# What "up" does NOT do: it never touches cron ownership (deploy-scheduler.sh
# creates jobs but OPS_JOBS_DISABLED=1 in the env keeps Netlify owning crons —
# flip deliberately via crons.sh resume, doc 05 §3b).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="${1:?usage: up.sh <staging|prod> [--build] [--with-db]}"
shift || true

BUILD=0; WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --with-db) WITH_DB=1 ;;
    *) echo "✗ unknown flag: $arg"; exit 1 ;;
  esac
done

step() { echo; echo "━━━ $1 ━━━"; }

if [ "$ENV_NAME" = "staging" ]; then
  if [ "$WITH_DB" = "1" ]; then
    echo "→ staging up includes the DB step by default (--with-db is staging's default; nothing to do)"
  fi
  exec "$HERE/deploy-staging.sh" staging
fi

if [ "$ENV_NAME" = "prod" ]; then
  step "bootstrap";       [ -n "${SKIP_BOOTSTRAP:-}" ] || "$HERE/bootstrap.sh" prod
  step "secrets";         [ -n "${SKIP_SECRETS:-}" ]   || "$HERE/bootstrap-secrets.sh" prod
  if [ "$BUILD" = "1" ]; then
    step "images (Cloud Build, prod project)"
    "$HERE/build-images.sh" prod
    step "cloud run"
    "$HERE/deploy-run.sh" prod
  else
    echo "→ digest promotion from staging (default — no rebuild; pass --build to build in prod)"
    step "promote (cloud run from staging digests)"
    "$HERE/promote-prod.sh" prod
  fi
  if [ "$WITH_DB" = "1" ] && [ -z "${SKIP_DB:-}" ]; then
    step "cloud sql + restore (CUTOVER-ADJACENT — doc 09 preflight must be done)"
    "$HERE/migrate-db.sh" prod
  else
    echo "→ prod Cloud SQL untouched (pass --with-db to include; default off on purpose)"
  fi
  step "smoke"
  "$HERE/smoke.sh" prod
  exit 0
fi

echo "✗ unknown env: $ENV_NAME (staging|prod)"; exit 1
