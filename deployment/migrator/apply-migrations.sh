#!/bin/sh
# deployment/migrator/apply-migrations.sh — applies supabase/migrations in order.
# Idempotent via the deployment.migrations ledger; on a DB restored from a
# Supabase dump (tables exist, ledger empty) it marks everything applied so a
# restored database is never re-migrated. MARK_ALL_IF_POPULATED=0 forces apply.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
MARK_ALL_IF_POPULATED="${MARK_ALL_IF_POPULATED:-1}"

psql_q() { psql "$DATABASE_URL" -tAc "$1"; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  create schema if not exists deployment;
  create table if not exists deployment.migrations(
    version text primary key,
    applied_at timestamptz not null default now()
  );"

POPULATED=$(psql_q "select to_regclass('public.extractions') is not null")
APPLIED=$(psql_q "select count(*) from deployment.migrations")

if [ "$POPULATED" = "t" ] && [ "$APPLIED" = "0" ] && [ "$MARK_ALL_IF_POPULATED" = "1" ]; then
  echo "→ DB already holds tables (restored dump): marking all repo migrations applied"
  for f in /migrations/[0-9]*.sql; do
    v=$(basename "$f" .sql)
    psql "$DATABASE_URL" -q -c "insert into deployment.migrations(version) values ('$v') on conflict do nothing"
  done
  echo "✓ marked $(psql_q "select count(*) from deployment.migrations") migrations as applied"
  exit 0
fi

FAILED=0
for f in /migrations/[0-9]*.sql; do
  v=$(basename "$f" .sql)
  [ "$(psql_q "select count(*) from deployment.migrations where version='$v'")" = "0" ] || continue
  echo "→ applying $v"
  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; then
    echo "✗ migration failed: $v (ledger NOT updated — fix and re-run; the rest were not attempted)"
    FAILED=1
    break
  fi
  psql "$DATABASE_URL" -q -c "insert into deployment.migrations(version) values ('$v')"
done

[ "$FAILED" = "0" ] && echo "✓ migrations: up to date ($(psql_q "select count(*) from deployment.migrations") applied)"
exit $FAILED
