#!/usr/bin/env bash
# deployment/scripts/migrate-from-supabase.sh — migrate a hosted Supabase
# database (staging today; prod at cutover) INTO the local stack, rehearsing
# the production cutover mechanics end-to-end.
#
# TWO source modes:
#   1. CLI path (default, no DB password needed — uses the supabase CLI's own
#      login or SUPABASE_ACCESS_TOKEN): dump schema (public) + data (public)
#      from SOURCE_PROJECT_REF, wipe the local db volume, restore, mark ledger.
#      Auth-schema rows are NOT restored here: hosted auth is newer than the
#      local supabase/postgres image and staging users are OAuth-only (no
#      password hashes to log in with). Signon locally = fresh signup.
#   2. SOURCE_DB_URL path (needs the DB password): full pg_dump -Fc (including
#      the auth schema) → pg_restore --clean. This is the production-cutover
#      recipe — target Postgres must be >= source major (Cloud SQL 17 ✓).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # deployment/
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "${DATIQ_ENV:-local}"

[ "${DATA_MODE:-local-db}" = "local-db" ] || die "DATA_MODE must be local-db for a local migration target"
require_vars COMPOSE_PROJECT_NAME POSTGRES_PASSWORD

COMPOSE="docker compose --env-file $HERE/env/.env.${DATIQ_ENV} -f $HERE/compose/compose.yaml -f $HERE/compose/compose.local.yaml"
DB_CONTAINER="${COMPOSE_PROJECT_NAME}-db-1"
mkdir -p "$HERE/generated"

SOURCE="${1:-${SOURCE_DB_URL:-}}"
CLI_MODE=0

if [ -z "$SOURCE" ] && [ -n "${SOURCE_PROJECT_REF:-}" ]; then
  command -v supabase >/dev/null || die "supabase CLI not on PATH (brew install supabase) — needed for the CLI path"
  echo "→ CLI dump from project $SOURCE_PROJECT_REF (schema + data)"
  supabase db dump --project-ref "$SOURCE_PROJECT_REF" -f "$HERE/generated/staging-full.sql" 2>&1 | grep -v "new version" | tail -1
  supabase db dump --project-ref "$SOURCE_PROJECT_REF" --data-only --use-copy -f "$HERE/generated/staging-data.sql" 2>&1 | grep -v "new version" | tail -1
  [ -s "$HERE/generated/staging-full.sql" ] || die "CLI dump produced no schema file — run 'supabase login' and retry"
  CLI_MODE=1
fi

if [ "${CLI_MODE}" = "1" ]; then
  echo "→ fresh target: recreating the db volume"
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  $COMPOSE up -d db 2>&1 | tail -1
  until [ "$(docker inspect --format '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null)" = "healthy" ]; do sleep 2; done
  $COMPOSE run --rm db-passwords >/dev/null 2>&1 || true

  echo "→ restoring schema (public) as supabase_admin"
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q \
    < "$HERE/generated/staging-full.sql" 2>&1 | grep -iE "error" | head -5 || true

echo "→ restoring PUBLIC data only (auth/storage rows skipped — schema drift;"
echo "   staging users are OAuth-only, signon locally is fresh signup)"
# The extracted COPY blocks lose the dump's header SETs — re-add the
# superuser-only FK bypass or rows referencing auth.users fail to load.
# MIGRATE_EXCLUDE_TABLES: comma-separated public tables to skip entirely
# (e.g. huge audit tables for a faster local rehearsal) — each excluded COPY
# block AND its terminator are dropped from the stream.
AWK_PROG="$HERE/generated/data-filter.awk"
{
  echo 'BEGIN { skip = 0 }'
  echo '/^COPY "public"\./ { p = 1 }'
  if [ -n "${MIGRATE_EXCLUDE_TABLES:-}" ]; then
    IFS=',' read -ra EXCL_TABLES <<< "$MIGRATE_EXCLUDE_TABLES"
    for t in "${EXCL_TABLES[@]}"; do
      t="$(printf '%s' "$t" | tr -d ' ')"
      [ -n "$t" ] || continue
      echo "/^COPY \"public\"\\.\"${t}\"\$/ { skip = 1 }"
    done
  fi
  echo 'p && !skip { print }'
  echo 'skip && /^\\.$/ { skip = 0; p = 0; next }'
  echo 'p && /^\\.$/ { p = 0 }'
} > "$AWK_PROG"
{ echo "SET session_replication_role = replica;"
  awk -f "$AWK_PROG" "$HERE/generated/staging-data.sql"
} > "$HERE/generated/staging-public-data.sql"
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q \
    < "$HERE/generated/staging-public-data.sql" 2>&1 | grep -iE "error" | head -5 || true
else
  [ -n "$SOURCE" ] || {
    echo "✗ no source: pass SOURCE_DB_URL, or set SOURCE_PROJECT_REF in .env.${DATIQ_ENV} (CLI path)."
    exit 1
  }
  command -v pg_dump >/dev/null || die "pg_dump not on PATH (brew install libpq)"
  command -v pg_restore >/dev/null || die "pg_restore not on PATH"

  echo "→ preflight: source connectivity"
  psql "$SOURCE" -tAc "select version();" | head -1 || die "cannot reach SOURCE_DB_URL"
  echo "→ dumping (full, incl. auth schema — the production-cutover recipe)"
  pg_dump -Fc --no-owner --no-privileges "$SOURCE" -f "$HERE/generated/local-import.dump"
  ls -lh "$HERE/generated/local-import.dump" | awk '{print "   dump size:", $5}'
  echo "→ restoring (--clean --if-exists as supabase_admin)"
  $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    pg_restore --clean --if-exists --no-owner --no-privileges -U supabase_admin -d postgres \
    < "$HERE/generated/local-import.dump" 2>&1 | grep -iE "error" | head -5 || true
fi

echo "→ marking repo migrations applied (restored schema already contains them)"
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db psql -U supabase_admin -d postgres -q -c "
  create schema if not exists deployment;
  create table if not exists deployment.migrations(version text primary key, applied_at timestamptz not null default now());"
MARKS=""
for f in "$REPO_DIR"/supabase/migrations/[0-9]*.sql; do
  v=$(basename "$f" .sql)
  MARKS+="insert into deployment.migrations(version) values ('$v') on conflict do nothing;"
done
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db psql -U supabase_admin -d postgres -q -c "$MARKS"

echo "→ verification"
psql_local() { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db psql -U supabase_admin -d postgres -tAc "$1"; }
echo "   public tables            : $(psql_local "select count(*) from pg_class c join pg_namespace n on n.oid=relnamespace where relkind='r' and n.nspname='public'")"
echo "   public.extractions       : $(psql_local 'select count(*) from public.extractions')"
echo "   RLS-enabled public tables: $(psql_local "select count(*) from pg_class c join pg_namespace n on n.oid=relnamespace where relkind='r' and n.nspname='public' and relrowsecurity")"
echo "   migrations marked        : $(psql_local 'select count(*) from deployment.migrations')"

echo
echo "✓ migration complete. Signon locally = fresh signup (autoconfirm); staged"
echo "  app data is served through the local stack. Production cutover uses the"
echo "  SOURCE_DB_URL path (full auth schema restore into same-major Postgres)."
