#!/usr/bin/env bash
# gen-admin-pin.sh — generate an admin PIN + its SHA-256 hash for one stage.
#
#   ./gen-admin-pin.sh staging
#   ./gen-admin-pin.sh production
#   ./gen-admin-pin.sh deploy-preview
#
# Prints the plaintext PIN (goes in the GitHub secret) and the SHA-256 hex
# (goes in the Netlify env var for that context). The two are NOT the same
# value — admin-auth.js hashes the submitted PIN and compares digests.
#
# Uses printf, never echo: echo appends a newline, which lands inside the
# hash and produces a digest that will never match the PIN you typed.

set -euo pipefail

STAGE="${1:-}"
case "$STAGE" in
  staging|production|deploy-preview) ;;
  *)
    printf 'usage: %s <staging|production|deploy-preview>\n' "$0" >&2
    exit 2
    ;;
esac

# 24 bytes of CSPRNG → 32 url-safe base64 chars. Strength is set here, at
# generation time; the hash can't add entropy the PIN never had.
PIN=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')
HASH=$(printf '%s' "$PIN" | shasum -a 256 | cut -d' ' -f1)

case "$STAGE" in
  staging)        GH_SECRET="STAGING_ADMIN_PIN" ;;
  production)     GH_SECRET="PRODUCTION_ADMIN_PIN" ;;
  deploy-preview) GH_SECRET="(none — no smoke test runs against previews)" ;;
esac

cat <<EOF

  ── ${STAGE} ────────────────────────────────────────────────

  1. Netlify → Site configuration → Environment variables
     Key:     ADMIN_PIN_HASH
     Scope:   ${STAGE} context ONLY (not "All contexts")
     Value:   ${HASH}

  2. GitHub → Settings → Secrets and variables → Actions
     Name:    ${GH_SECRET}
     Value:   ${PIN}

  Verify (after the next deploy of that context):
     curl -s -X POST <that-context-url>/.netlify/functions/admin-auth \\
       -H 'content-type: application/json' \\
       -d '{"pin":"${PIN}"}'
     → expect {"ok":true,...,"demo":false}

  Store the PIN in your password manager. It is not recoverable from the
  hash — losing it means regenerating both sides.

EOF
