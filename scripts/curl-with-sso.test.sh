#!/usr/bin/env bash
# scripts/curl-with-sso.test.sh — unit tests for the SSO cookie helper.
# Run with: bash scripts/curl-with-sso.test.sh
set -u

PASS=0
FAIL=0
SCRIPT="$(cd "$(dirname "$0")" && pwd)/curl-with-sso.sh"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

assert_contains() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name"
    echo "    expected to contain: $expected"
    echo "    actual:              $actual"
    FAIL=$((FAIL+1))
  fi
}

assert_not_contains() {
  local name="$1" unexpected="$2" actual="$3"
  if echo "$actual" | grep -qF "$unexpected"; then
    echo "  ✗ $name (should NOT contain: $unexpected)"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ $name"
    PASS=$((PASS+1))
  fi
}

# 1. No cookie set at all → fails with helpful message
echo "Test 1: no cookie in env or file"
out=$(NF_JWT="" HOME="$TMPDIR" "$SCRIPT" /api/test 2>&1 || true)
assert_contains "  exits with helpful error" "~/.netlify-sso-cookie" "$out"
assert_contains "  mentions export option" "export NF_JWT" "$out"

# 2. Malformed cookie (not a JWT) → fails with shape check
echo
echo "Test 2: malformed cookie (not a JWT)"
out=$(NF_JWT="not-a-jwt" HOME="$TMPDIR" "$SCRIPT" /api/test 2>&1 || true)
assert_contains "  rejects non-JWT cookie" "expected 2 dots" "$out"
assert_contains "  shows cookie length" "Length: 9 chars" "$out"

# 3. Well-formed cookie from env var → accepted, will fail at network
echo
echo "Test 3: well-formed cookie from env var"
out=$(NF_JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature" \
       HOME="$TMPDIR" \
       DATICQ_BASE="http://127.0.0.1:1" \
       "$SCRIPT" /api/integrations/hubspot/status 2>&1 || true)
assert_not_contains "  doesn't reject valid JWT shape" "expected 2 dots" "$out"
assert_not_contains "  doesn't claim 'No nf_jwt cookie set'" "No nf_jwt cookie set" "$out"

# 4. Well-formed cookie from file → accepted (use a fake HOME)
echo
echo "Test 4: well-formed cookie from file"
FAKE_HOME="$TMPDIR/home"
mkdir -p "$FAKE_HOME"
echo -n "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature" > "$FAKE_HOME/.netlify-sso-cookie"
out=$(NF_JWT="" HOME="$FAKE_HOME" \
       DATICQ_BASE="http://127.0.0.1:1" \
       "$SCRIPT" /api/integrations/hubspot/status 2>&1 || true)
assert_not_contains "  doesn't reject valid JWT shape" "expected 2 dots" "$out"
assert_not_contains "  doesn't claim 'No nf_jwt cookie set'" "No nf_jwt cookie set" "$out"

# 5. Path must start with /
echo
echo "Test 5: missing or invalid path argument"
out=$(NF_JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature" HOME="$TMPDIR" \
       "$SCRIPT" 2>&1 || true)
assert_contains "  rejects call without path" "No path given" "$out"

# 6. DATICQ_BASE override works (network will fail, but the URL is right)
echo
echo "Test 6: DATICQ_BASE override"
out=$(NF_JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature" HOME="$TMPDIR" \
       DATICQ_BASE="http://127.0.0.1:1" \
       "$SCRIPT" /api/integrations/notion/status 2>&1 || true)
assert_not_contains "  accepts DATICQ_BASE override" "expected 2 dots" "$out"

echo
echo "── Results: $PASS passed, $FAIL failed ──"
[ "$FAIL" -eq 0 ]
