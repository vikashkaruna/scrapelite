#!/usr/bin/env bash
# deployment/scripts/gcp/migrate-staging-db.sh — migrate the CURRENT staging
# database (hosted dev Supabase project) — schema, data AND users — into the
# GCP staging Cloud SQL instance. The SAFE half of the staging DB cutover:
# this script changes NO routing; the staging site keeps reading hosted
# Supabase until cutover-staging-db.sh flips it (doc 12-STAGING-DB-CUTOVER.md).
#
#   migrate-staging-db.sh staging \
#     "<session-pooler URI>"          # dashboard → Connect → Session pooler
#
# SOURCE_DB_URL = the Supabase session-pooler URI (dashboard → Connect).
# The full pg_dump path used here carries auth.users / auth.identities /
# refresh_tokens, so users survive the migration. FK-restore failures are
# FATAL by design (migrate-db.sh's SOURCE_DB_URL path) — a referential
# violation must never ship silently into a database users log into.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: migrate-staging-db.sh staging SOURCE_DB_URL}"
SOURCE_DB_URL="${2:-${SOURCE_DB_URL:-}}"
load_gcp_env "$ENV_NAME"

[ "$ENV_NAME" = "staging" ] || { echo "✗ this script migrates the STAGING database"; exit 1; }
[ "${DATA_MODE:-}" = "hosted-supabase" ] || {
  echo "✗ DATA_MODE=${DATA_MODE:-} — the migration source is the hosted Supabase project."
  echo "  If staging already runs on cloud-sql this migration is the wrong direction."
  exit 1
}
[ -n "$SOURCE_DB_URL" ] || {
  echo "✗ SOURCE_DB_URL required: Supabase dashboard → project ${SOURCE_PROJECT_REF:-<ref>}"
  echo "  → Connect → Session pooler → URI (includes the postgres password)."
  exit 1
}

echo "→ pre-flight"
echo "   current staging DB: SUPABASE_URL=${SUPABASE_URL} (DATA_MODE=${DATA_MODE})"
echo "   target: Cloud SQL ${SQL_INSTANCE} (db ${DB_NAME}, region ${GCP_REGION})"

# The SOURCE project must accept its key right now (offline ref match + live
# probe) — the 2026-09-29 incident class was a rotated key shipping silently.
"$HERE/../check-supabase-pair.sh" "$ENV_NAME"

# Rollback record: the exact env values the flip will rewrite, timestamped.
TS="$(date -u +%Y%m%d-%H%M%S)"
PREFLIP="$DEPLOY_DIR/env/.env.$ENV_NAME.preflip.$TS"
cp "$DEPLOY_DIR/env/.env.$ENV_NAME" "$PREFLIP"
echo "→ pre-flip env snapshot: $(basename "$PREFLIP") (rollback record)"

echo "── migrate (schema + data + auth users) hosted Supabase → ${SQL_INSTANCE}"
"$HERE/migrate-db.sh" "$ENV_NAME" "$SOURCE_DB_URL"

echo "── post-migration verification (source counts vs Cloud SQL counts)"
# migrate-db.sh already provisioned + used the proxy and killed it on exit;
# bring a short-lived one back up for the comparison queries.
PROXY_BIN="$DEPLOY_DIR/generated/bin/cloud-sql-proxy"
PROXY_PORT="${CLOUD_SQL_PROXY_PORT:-15432}"
if have cloud-sql-proxy; then PROXY_RESOLVED="$(command -v cloud-sql-proxy)"; else PROXY_RESOLVED="$PROXY_BIN"; fi
[ -x "$PROXY_RESOLVED" ] || { echo "✗ cloud-sql-proxy not found (PATH or ${PROXY_BIN})"; exit 1; }
"$PROXY_RESOLVED" "${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE}" --port="$PROXY_PORT" --quiet >/dev/null 2>&1 &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null && break; sleep 1; done
ADMIN_URL="postgresql://postgres:${DB_ADMIN_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"

MISMATCH=0
for t in "auth.users" "auth.identities" "public.extractions"; do
  src=$(psql "$SOURCE_DB_URL" -tAc "select count(*) from ${t}" 2>/dev/null || echo "n/a")
  dst=$(psql "$ADMIN_URL" -tAc "select count(*) from ${t}" 2>/dev/null || echo "n/a")
  echo "   ${t}: source=${src} target=${dst}"
  [ "$src" = "$dst" ] || MISMATCH=1
done
if [ "$MISMATCH" = "1" ]; then
  echo "✗ row-count mismatch between source and Cloud SQL — do NOT cut over;"
  echo "   re-run this script (migrate-db truncates + reloads public tables)."
  exit 1
fi

# Belt-and-braces: the FULL path must restore every FK. migrate-db.sh already
# exits fatally on FK errors for SOURCE_DB_URL; state it in the summary too.
fk_err="$(grep -c 'ERROR' "$GEN_DIR/db/fk-restore.err" 2>/dev/null || echo 0)"
echo "   FK restore errors: ${fk_err} (must be 0 on the full path)"
[ "$fk_err" = "0" ] || { echo "✗ FK restore errors present — abort"; exit 1; }

echo "✓ migration verified: users, identities and extractions match; every FK restored."
echo
echo "Next: cutover-staging-db.sh staging \"$SOURCE_DB_URL\" — the routing flip."
echo "⚠ Storage objects are NOT migrated by pg_dump (files live outside Postgres)."
echo "  If staging uses Supabase Storage buckets, export them before the flip."
