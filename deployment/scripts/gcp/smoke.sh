#!/usr/bin/env bash
# deployment/scripts/gcp/smoke.sh — post-deploy parity smoke against the
# Firebase Hosting URL. Mirrors the deployment/tests/stack-smoke.sh checks that
# matter at the edge (static payload, redirects, API rewrite, admin headers).
#   smoke.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: smoke.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

BASE="${SMOKE_TARGET:-$APP_BASE_URL}"
pass=0; fail=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1)); else
    echo "  ✗ $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -m 30 -w '%{http_code}' "$1"; }
body() { curl -s -m 30 "$1"; }

echo "→ smoke ${BASE}"
check "home serves the PRERENDERED document (forced rewrite)" \
  "yes" "$(body "$BASE/" | grep -qi '<h1' && echo yes || echo no)"
check "/pricing (prerendered react page)" "200" "$(code "$BASE/pricing")"
check "/vs/firecrawl (static-owned)" "200" "$(code "$BASE/vs/firecrawl")"
check "/faq (static-owned)" "200" "$(code "$BASE/faq")"
check "/help (generated help site — trailingSlash:false makes this the canonical form)" \
  "200" "$(code "$BASE/help")"
check "/help/ canonical 301 (Firebase trailingSlash:false)" "301" "$(code "$BASE/help/")"
check "retired URL 301s (/what-is-datiq → /faq)" "301" "$(code "$BASE/what-is-datiq")"
check "/dashboard (SPA fallback → 200 shell)" "200" "$(code "$BASE/dashboard")"
check "security header on /" \
  "nosniff" "$(curl -s -m 30 -D - -o /dev/null "$BASE/" | grep -i 'x-content-type-options:' | awk '{print $2}' | tr -d '\r')"
check "admin noindex header" \
  "yes" "$(curl -s -m 30 -D - -o /dev/null "$BASE/dashboard" | grep -qi 'x-robots-tag: noindex' && echo yes || echo no)"
check "runtime-config.js ships (branch routing for *.web.app)" \
  "yes" "$(body "$BASE/runtime-config.js" | grep -q '_GCP_PROD_HOSTS' && echo yes || echo no)"

echo "→ API rewrite (through Firebase Hosting → Cloud Run ${CLOUD_RUN_API})"
# workflow-orchestrator is POST-only and token-gated (identical on Netlify):
#   - unauthenticated POST must return 401 (rewrite reaches the fn; gate holds)
#   - Bearer ADMIN_TOKEN_SECRET must return pong (full path incl. Supabase)
check "workflow-orchestrator ping unauthenticated → 401 (auth gate)" \
  "401" "$(curl -s -o /dev/null -m 30 -w '%{http_code}' -X POST "$BASE/api/workflow-orchestrator/ping")"
ADMIN_TOKEN="$(gcloud secrets versions access latest --project="$GCP_PROJECT_ID" --secret="$(sm_name ADMIN_TOKEN_SECRET)" 2>/dev/null || true)"
if [ -n "$ADMIN_TOKEN" ]; then
  check "workflow-orchestrator ping (POST + Bearer admin token)" \
    "pong" "$(curl -s -m 30 -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'content-type: application/json' -d '{}' \
      "$BASE/api/workflow-orchestrator/ping" | head -c 64 | tr -d '\n' | grep -o 'pong' | head -1 || echo none)"
else
  check "workflow-orchestrator ping (POST + Bearer admin token)" \
    "skipped-no-token" "skipped-no-token"
fi

echo
echo "smoke: $pass passed, $fail failed — ${BASE}"
[ "$fail" -eq 0 ]
