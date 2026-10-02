#!/usr/bin/env bash
# deployment/scripts/gcp/deploy-hosting.sh — deploy the STATIC payload
# (the entire dist/: SPA shell, prerendered pages incl. home, /vs/*, /faq,
# help site, sitemap/robots/llms.txt, admin+tracker files) to Firebase Hosting.
# Only /api/** is dynamic (Cloud Run rewrite — see deploy-run.sh).
#
#   deploy-hosting.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: deploy-hosting.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

have firebase || { echo "✗ firebase CLI not installed — npm i -g firebase-tools"; exit 1; }

# ── build-time VITE_* come from .env.<env>, never from a developer's local .env ─
# Vite gives process env priority over .env/.env.local, but only for variables
# that are SET. Anything .env.<env> leaves unset falls back to the developer's
# local .env — which baked the old hosted DEV Supabase URL into the staging
# bundle as its fallback. Pin the pair to this env's own values, and refuse a
# prod build that would ship a test payment key.
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$SUPABASE_URL}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}"
if [ "$ENV_NAME" = "prod" ]; then
  case "${VITE_RAZORPAY_KEY_ID:-}" in
    rzp_live_*) ;;
    *) echo "✗ prod build: VITE_RAZORPAY_KEY_ID must be a rzp_live_ key in .env.prod (got '${VITE_RAZORPAY_KEY_ID:0:9}…') — refusing to bake a test/empty payment key"; exit 1;;
  esac
fi

echo "→ build dist/ (SKIP_BUILD=1 reuses an existing dist/; otherwise always rebuilt)"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  [ -f "$REPO_DIR/dist/index.html" ] || { echo "✗ SKIP_BUILD=1 but dist/ is missing — run npm run build first"; exit 1; }
else
  (cd "$REPO_DIR" && npm ci --no-audit --no-fund && npm run build)
fi

echo "→ payload prep: dist/index.html becomes the PRERENDERED home (so '/' is a"
echo "   real file, like Netlify's prerendered root); the SPA shell ships as"
echo "   /__shell/index.html and the /** fallback rewrite serves it (Firebase"
echo "   rewrites never beat real files)"
mkdir -p "$REPO_DIR/dist/__shell"
cp "$REPO_DIR/dist/index.html" "$REPO_DIR/dist/__shell/index.html"
if [ -f "$REPO_DIR/dist/home/index.html" ]; then
  cp "$REPO_DIR/dist/home/index.html" "$REPO_DIR/dist/index.html"
else
  echo "✗ dist/home/index.html missing — refusing to ship the SPA shell for '/'"
  echo "   (Netlify parity: the forced / → /home/index.html rewrite never serves"
  echo "   the shell; an empty home would break the prerendered-home smoke check)"
  exit 1
fi

# ── runtime-config: point the browser at THIS env's self-hosted auth/rest ────
# public/runtime-config.js is committed with the HOSTED Supabase pair (a
# committed flip is forbidden by runtimeConfigIdentity.test.js). So a plain
# hosting deploy ships a browser that signs in through the hosted project —
# GoTrue then sends OAuth providers the hosted project's callback, never the
# self-hosted one (the stg.datiq.app redirect_uri_mismatch). The cutover scripts
# only patched ONE deploy; every later deploy silently undid it. So whenever
# .env says the env's data lives in Cloud SQL (DATA_MODE=cloud-sql), the
# deployed dist/runtime-config.js — never the committed file — gets the
# self-hosted pair: URL = window.location.origin (same-origin /auth/v1 +
# /rest/v1 through the Hosting rewrites) and SUPABASE_ANON_KEY from .env.
#   staging → _stagingSupabase*    prod → _prodSupabase*
# prod stays DATA_MODE=hosted-supabase until its cutover, so it is untouched.
# Idempotent: a pair already flipped by a cutover script is left alone (the
# cutover mints the key before .env learns it).
patch_dist_runtime_config() {
  local rc="$REPO_DIR/dist/runtime-config.js" pfx
  [ "${DATA_MODE:-}" = "cloud-sql" ] || {
    echo "→ runtime-config: DATA_MODE=${DATA_MODE:-unset} — browser keeps the committed hosted Supabase pair"; return 0; }
  [ -f "$rc" ] || { echo "✗ dist/runtime-config.js missing"; exit 1; }
  case "$ENV_NAME" in staging) pfx=_staging;; prod) pfx=_prod;; *) echo "✗ unknown env $ENV_NAME"; exit 1;; esac
  if grep -q "^var ${pfx}SupabaseUrl = window.location.origin;" "$rc"; then
    echo "→ runtime-config: ${pfx}Supabase pair already self-hosted — leaving as is"; return 0
  fi
  local key="${SUPABASE_ANON_KEY:-}"
  [ -n "$key" ] || { echo "✗ DATA_MODE=cloud-sql but SUPABASE_ANON_KEY is empty in .env.$ENV_NAME"; exit 1; }
  # A key not signed by this env's JWT_SECRET would 401 every call and log
  # everyone out; refuse before shipping it (publishable-format keys carry no
  # signature to check).
  case "$key" in
    sb_publishable_*) ;;
    *) node -e '
         const c=require("crypto"); const [,secret,tok]=process.argv; const [h,p,sig]=String(tok).split(".");
         if(!h||!p||!sig||!secret){console.error("✗ anon key / JWT_SECRET missing or malformed");process.exit(1)}
         const e=c.createHmac("sha256",secret).update(h+"."+p).digest("base64url");
         if(e!==sig){console.error("✗ SUPABASE_ANON_KEY is not signed by this env JWT_SECRET — refusing to ship it");process.exit(1)}
       ' "${JWT_SECRET:-}" "$key" ;;
  esac
  sed -e "s|^var ${pfx}SupabaseUrl = .*|var ${pfx}SupabaseUrl = window.location.origin;|" \
      -e "s|^var ${pfx}SupabaseAnonKey = .*|var ${pfx}SupabaseAnonKey = \"${key}\";|" \
      "$rc" > "$rc.tmp" && mv "$rc.tmp" "$rc"
  grep -q "^var ${pfx}SupabaseUrl = window.location.origin;" "$rc" \
    && grep -q "^var ${pfx}SupabaseAnonKey = \"${key}\";" "$rc" \
    || { echo "✗ runtime-config patch did not land — aborting before deploy"; exit 1; }
  echo "→ runtime-config: ${pfx}Supabase pair → origin + .env anon key (dist only; committed file untouched)"
}
patch_dist_runtime_config

echo "→ render firebase.json + .firebaserc from netlify.toml + .env.$ENV_NAME"
# firebase.json must sit at the repo root: Firebase requires the public dir
# to live INSIDE the project directory. Both files are generated (gitignored).
GEN_DIR="$REPO_DIR"
node "$DEPLOY_DIR/scripts/gen-firebase-config.mjs" \
  --toml "$REPO_DIR/netlify.toml" \
  --env  "$DEPLOY_DIR/env/.env.$ENV_NAME" \
  --dist "$REPO_DIR/dist" \
  --out  "$GEN_DIR"
# The site must EXIST before deploy. It is kept by every teardown short of
# down.sh --delete-data, and an ID deleted that way is gone for good (firebase
# reserves it forever), so a missing site is an operator problem to state
# plainly — never auto-create. If it was deleted, set FHS_SITE_ID in
# .env.<env> to a NEW id, redeploy, and re-point the custom domain.
if ! firebase hosting:sites:list --project="$GCP_PROJECT_ID" 2>/dev/null | grep -qF "$FHS_SITE_ID"; then
  echo "✗ hosting site ${FHS_SITE_ID} does not exist for ${GCP_PROJECT_ID}."
  echo "  It was either never created (run bootstrap.sh ${ENV_NAME}) or was deleted"
  echo "  by down.sh --delete-data — a deleted site ID cannot be recreated."
  echo "  Remedy: choose a NEW site id, set FHS_SITE_ID in .env.${ENV_NAME}, update"
  echo "  APP_BASE_URL + GOTRUE_URI_ALLOW_LIST to match, run bootstrap.sh, then"
  echo "  re-point the custom domain (Firebase console → Hosting → Add custom domain)."
  exit 1
fi
echo "→ firebase deploy → site ${FHS_SITE_ID}"
(cd "$GEN_DIR" && firebase deploy --only hosting \
  --config "$GEN_DIR/firebase.json" \
  --project "$GCP_PROJECT_ID" --non-interactive)

echo "✓ Hosting live: https://${FHS_SITE_ID}.web.app"
