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
