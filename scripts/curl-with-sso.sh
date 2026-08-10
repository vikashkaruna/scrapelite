#!/usr/bin/env bash
# scripts/curl-with-sso.sh — wrapper that auto-injects the nf_jwt cookie.
#
# Reads the SSO cookie from ~/.netlify-sso-cookie (preferred) OR from the
# $NF_JWT env var (fallback), then runs curl with the right header.
#
# Usage:
#   scripts/curl-with-sso.sh /api/integrations/hubspot/status
#   scripts/curl-with-sso.sh -X POST -H 'Content-Type: application/json' \
#     -d '{"webhookUrl":"https://hooks.slack.com/..."}' \
#     /api/integrations/slack/connect
#
# Same auth contract as the bare curl commands in
# docs/CURL-TEST-RECIPE-INTEGRATIONS.md, just no need to remember the
# cookie header or the variable name.

set -e

# 1. Resolve the cookie value
COOKIE=""
if [ -r "$HOME/.netlify-sso-cookie" ]; then
  COOKIE=$(cat "$HOME/.netlify-sso-cookie")
elif [ -n "$NF_JWT" ]; then
  COOKIE="$NF_JWT"
fi

# 2. Validate
if [ -z "$COOKIE" ]; then
  echo "✗ No nf_jwt cookie set." >&2
  echo "" >&2
  echo "  Either:" >&2
  echo "    a) Save the cookie from DevTools → Application → Cookies → nf_jwt," >&2
  echo "       then run:" >&2
  echo "         echo 'PASTE_VALUE_HERE' > ~/.netlify-sso-cookie" >&2
  echo "         chmod 600 ~/.netlify-sso-cookie" >&2
  echo "    b) Or export it for this shell:" >&2
  echo "         export NF_JWT=PASTE_VALUE_HERE" >&2
  echo "" >&2
  echo "  See docs/CURL-TEST-RECIPE-INTEGRATIONS.md §2b for the full flow." >&2
  exit 2
fi

# 3. Sanity-check the cookie shape (JWT = 3 base64url segments separated by .)
DOTS=$(echo "$COOKIE" | tr -cd '.' | wc -c | tr -d ' ')
LEN=${#COOKIE}
if [ "$DOTS" -ne 2 ]; then
  echo "✗ Cookie value doesn't look like a JWT (expected 2 dots, got $DOTS)." >&2
  echo "  Length: $LEN chars" >&2
  echo "  First 30 chars: ${COOKIE:0:30}..." >&2
  echo "  Last 30 chars: ...${COOKIE: -30}" >&2
  echo "" >&2
  if [ "$DOTS" = "0" ] && [ "$LEN" -lt 50 ]; then
    echo "  Looks like only the JWT HEADER was copied (~36 chars = {\"typ\":\"JWT\"...})." >&2
    echo "  The full nf_jwt is 200-500 chars and has 2 dots in it." >&2
    echo "  In DevTools, double-click the cookie Value cell and select ALL of it," >&2
    echo "  or right-click → 'Show in Application panel' to see the full string." >&2
  else
    echo "  Re-export from DevTools → Application → Cookies → nf_jwt." >&2
  fi
  exit 3
fi

# 3b. Sanity-check length — a real Netlify nf_jwt is 200-500+ chars. Anything
#     under 100 is almost certainly a truncated copy.
if [ "$LEN" -lt 100 ]; then
  echo "✗ Cookie value is suspiciously short ($LEN chars)." >&2
  echo "  A real Netlify nf_jwt is 200-500 chars. You likely copied only part of it." >&2
  echo "  First 30 chars: ${COOKIE:0:30}..." >&2
  echo "" >&2
  echo "  In DevTools → Application → Cookies → nf_jwt, double-click the Value" >&2
  echo "  cell to edit it, then Ctrl/Cmd+A to select ALL of it before copying." >&2
  exit 3
fi

# 4. Default base URL = branch deploy
BASE="${DATICQ_BASE:-https://integration-with-outside-ecosystem--datiqapp.netlify.app}"

# 5. Compose the curl command. The first arg we don't recognise is the
#    path; everything else is passed through.
PATH_ARG=""
PASSTHROUGH=()
for arg in "$@"; do
  if [ -z "$PATH_ARG" ] && [[ "$arg" == /* ]]; then
    PATH_ARG="$arg"
  else
    PASSTHROUGH+=("$arg")
  fi
done

if [ -z "$PATH_ARG" ]; then
  echo "✗ No path given. Usage: $0 /api/integrations/hubspot/status" >&2
  exit 4
fi

# 6. Run curl with the cookie + path
exec curl -sS \
  -H "Cookie: nf_jwt=$COOKIE" \
  "${PASSTHROUGH[@]}" \
  "$BASE$PATH_ARG"
