#!/usr/bin/env bash
# scripts/migrate-prod.sh
#
# Production Supabase migration runner — thin wrapper.
# Real logic + SQL execution lives in scripts/migrate-prod.mjs (Node + `pg`).
# This file is kept for backward compat with the original usage:
#   PROD_SUPABASE_DB_URL="..." ./scripts/migrate-prod.sh
#
# Usage (new, preferred):
#   npm run migrate:prod
#   npm run migrate:prod -- --dry-run
#   npm run migrate:prod -- --list
#   npm run migrate:prod -- --include=scripts/extra.sql
#
# Required env:
#   PROD_SUPABASE_DB_URL  — Supabase direct connection string.
#                            (Project Settings → Database → Connection string → "Direct")

set -euo pipefail

if [ -z "${PROD_SUPABASE_DB_URL:-}" ]; then
  echo "✗ PROD_SUPABASE_DB_URL is not set."
  echo "  Get it from: Supabase → Project Settings → Database → Connection string → Direct"
  echo "  Example:     postgresql://postgres:PASSWORD@db.abcdefgh.supabase.co:5432/postgres"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/migrate-prod.mjs" "$@"
