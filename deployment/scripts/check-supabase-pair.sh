#!/usr/bin/env bash
# deployment/scripts/check-supabase-pair.sh — verify that SUPABASE_URL and
# SUPABASE_ANON_KEY in .env.<env> are the SAME project, and that the project
# ACCEPTS the key right now.
#
#   check-supabase-pair.sh staging            # offline ref match + live probe
#   check-supabase-pair.sh staging --offline  # skip the network probe
#   SKIP_SUPABASE_CHECK=1 …                   # escape hatch (deploys print it)
#
# Two independent faults, two checks:
#   1. OFFLINE — the anon key is a JWT whose payload names its project; compare
#      that ref to the URL's subdomain. Catches "copied from the other
#      project" without any network.
#   2. LIVE — GET <SUPABASE_URL>/auth/v1/health with the key. Catches a key
#      that looks perfectly consistent offline but was ROTATED/REVOKED in the
#      Supabase dashboard — the 2026-09-29 staging incident: the deployed
#      207-char key decoded to the right project and still answered
#      "Invalid API key" everywhere. Only this probe sees it.
#
# Wired into deploy-run.sh and bootstrap-secrets.sh: a dead key must fail the
# deploy BEFORE it ships, not surface as user-facing 503s afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/env-loader.sh"

OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    -*) echo "usage: check-supabase-pair.sh <env-name> [--offline]"; exit 1 ;;
    *) ENV_NAME="$arg" ;;
  esac
done
ENV_NAME="${ENV_NAME:-staging}"

if [ "${SKIP_SUPABASE_CHECK:-0}" = "1" ]; then
  echo "SKIP supabase-pair check (SKIP_SUPABASE_CHECK=1)"
  exit 0
fi

load_env "$ENV_NAME"

URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_ANON_KEY:-}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "✗ .env.$ENV_NAME: SUPABASE_URL and/or SUPABASE_ANON_KEY empty — nothing to verify"; exit 1
fi

# ── 1. offline: key's embedded project ref vs the URL's subdomain ────────────
read -r URL_REF KEY_REF KEY_ROLE <<EOF
$(node -e '
  const [url, key] = process.argv.slice(1);
  let urlRef = null;
  try {
    const host = new URL(url).hostname;
    if (/\.supabase\.(co|in|red)$/.test(host)) urlRef = host.split(".")[0];
  } catch {}
  let keyRef = null, role = null;
  const parts = String(key).split(".");
  if (parts.length === 3) {
    try {
      const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      keyRef = typeof p.ref === "string" ? p.ref : null;
      role = typeof p.role === "string" ? p.role : null;
    } catch {}
  }
  console.log(urlRef || "-", keyRef || "-", role || "-");
' "$URL" "$KEY")
EOF

mask() { # mask <value> → first3…last4 (len); never enough to use
  local v="$1"
  [ ${#v} -gt 8 ] && printf '%s…%s (%s chars)' "$(printf '%s' "$v" | cut -c1-3)" "$(printf '%s' "$v" | rev | cut -c1-4 | rev)" "${#v}" || printf '(short value)'
}

if [ "$URL_REF" != "-" ] && [ "$KEY_REF" != "-" ] && [ "$URL_REF" != "$KEY_REF" ]; then
  echo "✗ .env.$ENV_NAME PROJECT MISMATCH: SUPABASE_URL points at project '$URL_REF'"
  echo "  but SUPABASE_ANON_KEY is issued for project '$KEY_REF' ($(mask "$KEY"))."
  echo "  Copy the anon key from Supabase → project $URL_REF → Settings → API."
  exit 1
fi
if [ "$KEY_ROLE" != "-" ] && [ "$KEY_ROLE" != "anon" ]; then
  echo "✗ .env.$ENV_NAME: SUPABASE_ANON_KEY carries role '$KEY_ROLE' — that is a"
  echo "  service key. It bypasses RLS and must never sit in the anon slot."
  exit 1
fi
echo "✓ offline: key ref matches URL ref${KEY_REF:+ ($KEY_REF)}"

# ── 2. live: the project must accept the key RIGHT NOW ───────────────────────
if [ "$OFFLINE" = "1" ]; then
  echo "→ live probe skipped (--offline)"
  exit 0
fi
case "$URL" in
  https://*.supabase.co|https://*.supabase.in|https://*.supabase.red) ;;
  *)
    echo "→ live probe skipped: $URL is not a *.supabase.co project URL (custom domain or local stack)"
    exit 0
    ;;
esac

code="$(curl -s -o /tmp/sb-pair-health.json -w '%{http_code}' -m 15 "$URL/auth/v1/health" -H "apikey: $KEY" || echo 000)"
case "$code" in
  200)
    echo "✓ live: $URL accepted this key (/auth/v1/health 200)"
    ;;
  401)
    echo "✗ .env.$ENV_NAME: Supabase REJECTED this key (/auth/v1/health 401, $(mask "$KEY"))."
    echo "  The key decodes to project '$KEY_REF' but the project no longer accepts it —"
    echo "  it was rotated or revoked in the Supabase dashboard (Settings → API)."
    echo "  This exact fault served 503s to every signed-in stg user on 2026-09-29."
    echo "  Fix: copy the CURRENT anon key into .env.$ENV_NAME and re-run"
    echo "  update-env.sh $ENV_NAME (env-only redeploy, no rebuild)."
    rm -f /tmp/sb-pair-health.json
    exit 1
    ;;
  000)
    echo "✗ live probe could not reach $URL (network/timeout). Fix connectivity or run with --offline."
    rm -f /tmp/sb-pair-health.json
    exit 1
    ;;
  *)
    echo "✗ live probe got HTTP $code from $URL/auth/v1/health — unexpected; investigate before deploying."
    head -c 200 /tmp/sb-pair-health.json 2>/dev/null; echo
    rm -f /tmp/sb-pair-health.json
    exit 1
    ;;
esac
rm -f /tmp/sb-pair-health.json

# ── 3. best-effort: OAuth redirect allowlist must contain this env's origin ──
# GoTrue enforces the allowlist at /auth/v1/callback — AFTER the user consents
# — so a missing entry looks like "sign-in bounces to the wrong site", never
# like a config error. Needs a valid SUPABASE_ACCESS_TOKEN (management API);
# absent/stale token ⇒ printed WARN, never a failure.
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${APP_BASE_URL:-}" ] && [ "$URL_REF" != "-" ]; then
  mgmt="$(curl -s -m 20 "https://api.supabase.com/v1/projects/${URL_REF}/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" || true)"
  case "$mgmt" in
    *redirect_url_paths*|*site_url*)
      origin="${APP_BASE_URL%/}"
      found="$(printf '%s' "$mgmt" | node -e '
        let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
          try {
            const cfg = JSON.parse(d);
            const origin = process.argv[1];
            const paths = cfg.redirect_url_paths || [];
            const ok = paths.some(u => u === origin || u === origin + "/**" || (u.endsWith("/**") && origin.startsWith(u.slice(0, -2))));
            console.log(ok ? "yes" : "no:" + paths.join(" "));
          } catch { console.log("unreadable"); }
        })' "$origin")"
      case "$found" in
        yes) echo "✓ allowlist: $origin is in project $URL_REF redirect URLs" ;;
        no:*) echo "⚠ allowlist: $origin NOT in project $URL_REF redirect URLs (${found#no:})."
              echo "  Add it: Supabase dashboard → Auth → URL Configuration → Redirect URLs."
              echo "  Until then OAuth completes at Google but bounces at the callback (doc 08 §3.1)." ;;
        *)   echo "⚠ allowlist: could not parse management API response — check manually (doc 08 §3.1)" ;;
      esac
    ;;
    *JWT\ failed*|*"Invalid API key"*|*"Unauthorized"*)
      echo "⚠ allowlist: SUPABASE_ACCESS_TOKEN rejected by the management API — rotate it"
      echo "  (supabase projects api-key create / dashboard → Access Tokens) to enable this check"
    ;;
    "")
      echo "⚠ allowlist: management API unreachable — check redirect URLs manually (doc 08 §3.1)"
    ;;
    *)
      echo "⚠ allowlist: unexpected management API response — check redirect URLs manually (doc 08 §3.1)"
    ;;
  esac
fi
