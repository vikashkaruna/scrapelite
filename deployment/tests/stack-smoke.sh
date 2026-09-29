#!/usr/bin/env bash
# deployment/tests/stack-smoke.sh — end-to-end smoke of the local stack through
# the gateway. Every check goes through http://localhost:$LOCAL_GATEWAY_PORT so
# the edge (redirects, routing, headers) is exercised exactly as users hit it.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/scripts/lib/env-loader.sh"
load_env "${DATIQ_ENV:-local}"

BASE="${PUBLIC_BASE_URL:-http://localhost:${LOCAL_GATEWAY_PORT:-8080}}"
PASS=0; FAIL=0

check() { # check <name> <expected-code> <curl-args...>
  local name="$1" expected="$2"; shift 2
  local code
  code=$(curl -s -o /tmp/datiq-smoke-body -w '%{http_code}' "$@")
  if [ "$code" = "$expected" ]; then
    echo "  ✓ $name ($code)"; PASS=$((PASS+1))
  else
    echo "  ✗ $name — expected $expected got $code"; sed -n 1,3p /tmp/datiq-smoke-body; FAIL=$((FAIL+1))
  fi
}

body_contains() { # body_contains <name> <url> <pattern>
  local name="$1" url="$2" pattern="$3"
  local code tmp="/tmp/datiq-smoke-body.$$"
  # body goes to a FILE: piping an 80KB single-line page into `grep -q` makes
  # grep close early and the writer die with SIGPIPE (141) — a false negative.
  code=$(curl -s -o "$tmp" -w '%{http_code}' "$url")
  if [ "$code" = "200" ] && grep -qi "$pattern" "$tmp"; then
    echo "  ✓ $name (200 + match)"; PASS=$((PASS+1))
  else
    echo "  ✗ $name — code=$code pattern='${pattern}' not found"; FAIL=$((FAIL+1))
  fi
  rm -f "$tmp"
}

echo "── smoke: $BASE ─────────────────────────────────────────────"
body_contains "web: / serves prerendered home"        "$BASE/"                                  "DatIQ"
body_contains "web: /pricing prerendered"             "$BASE/pricing"                           "DatIQ"
check        "web: SPA fallback for client routes"    200          "$BASE/this-route-does-not-exist"
check        "admin: /admin/ serves shell"            200          "$BASE/admin/"
check        "trackers: runtime-config.js"            200          "$BASE/runtime-config.js"
check        "trackers: analytics.js"                 200          "$BASE/analytics.js"
if [ "${DATA_MODE:-local-db}" = "local-db" ]; then
  check        "auth: GoTrue health via gateway"        200          "$BASE/auth/v1/health"
  check        "rest: PostgREST OpenAPI via gateway"    200          "$BASE/rest/v1/"
else
  # shared-db: the browser talks to the hosted dev Supabase directly
  # (runtime-config.js) — the gateway intentionally has no auth/rest upstreams.
  echo "  ⊘ shared-db mode: gateway auth/rest checks not applicable"
fi
check        "api: templates function"                200          "$BASE/api/templates"
check        "api: v1 router rejects unauthenticated" 401          "$BASE/api/v1/extractions"
check        "api: admin-auth rejects wrong PIN"      401          -X POST "$BASE/api/admin-auth" -H 'content-type: application/json' -d '{"pin":"definitely-wrong"}'
check        "api: scheduled fn blocked on api svc"   404          -X POST "$BASE/api/billing-purge" -d "{}"
check        "edge: retired-URL 301 parity"           301          "$BASE/what-is-datiq"
body_contains "web: sitemap.xml"                      "$BASE/sitemap.xml"                       "urlset"
body_contains "web: robots.txt"                       "$BASE/robots.txt"                        "User-agent"

echo "── smoke: jobs service (internal) ───────────────────────────"
if [ "${DATA_MODE:-local-db}" = "local-db" ]; then
  JOBS_CODE=$(docker compose --env-file "$HERE/env/.env.${DATIQ_ENV}" \
    -f "$HERE/compose/compose.yaml" -f "$HERE/compose/compose.local.yaml" \
    exec -T -e JT="$JOBS_TOKEN" scheduler node -e \
    "fetch('http://jobs:8080/run/health-monitor',{method:'POST',headers:{'x-datiq-cron-token':process.env.JT},body:'{}'}).then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(0)})" 2>/dev/null | tail -1)
  if [ "$JOBS_CODE" = "200" ]; then echo "  ✓ jobs: token-authenticated run works ($JOBS_CODE)"; PASS=$((PASS+1));
  else echo "  ✗ jobs: token run got '$JOBS_CODE'"; FAIL=$((FAIL+1)); fi
else
  echo "  ⊘ shared-db mode: no local scheduler container — jobs check not applicable"
fi

echo "─────────────────────────────────────────────────────────────"
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
