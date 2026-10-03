#!/usr/bin/env bash
# deployment/tests/signon-e2e.sh — proves the full auth loop through the gateway:
# signup (autoconfirm) → session token → authenticated /api/* call → PostgREST
# under RLS. Run AFTER the stack is up (up.sh or migrate-from-supabase.sh).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "${DATIQ_ENV:-local}"
BASE="${PUBLIC_BASE_URL:-http://localhost:${LOCAL_GATEWAY_PORT:-8080}}"

EMAIL="e2e-$(date +%s)@local.test"
PASSWORD="Test-Passw0rd!x"
echo "→ signup $EMAIL (autoconfirm, no SMTP locally)"
RESP=$(curl -s -X POST "$BASE/auth/v1/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.access_token||j?.session?.access_token||'')}catch{console.log('')}})")
[ -n "$TOKEN" ] || { echo "✗ signup did not return a session (autoconfirm off?)"; printf '%s\n' "$RESP" | head -5; exit 1; }
echo "  ✓ got access token (${#TOKEN} chars)"

echo "→ authenticated API call: GET /api/extractions with Bearer token"
CODE=$(curl -s -o /tmp/datiq-signon-body -w '%{http_code}' "$BASE/api/extractions" \
  -H "Authorization: Bearer $TOKEN")
BODY=$(head -c 200 /tmp/datiq-signon-body)
if [ "$CODE" = "200" ]; then
  echo "  ✓ /api/extractions → 200 ($BODY)"
  echo "✓ signon loop works: GoTrue → JWT → api adapter → PostgREST (RLS) end-to-end"
else
  echo "  ✗ /api/extractions → $CODE: $BODY"; exit 1
fi
