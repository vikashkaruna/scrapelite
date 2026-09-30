#!/usr/bin/env bash
# deployment/scripts/gcp/cutover-staging-db.sh — flip STAGING from the hosted
# dev Supabase project to the self-hosted trio on Cloud SQL
# (doc 12-STAGING-DB-CUTOVER.md). The staging twin of cutover-db.sh (which is
# prod-only by design), with the two owner decisions of 2026-09-30 applied:
#
#   1. FRESH JWT SECRET: every user session AND every existing anon/service key
#      invalidates — users re-login. A fresh anon + service key pair is minted
#      from the new secret and shipped in the same window.
#   2. CRON HANDOFF IN THE SAME WINDOW: GCP staging owns crons from this
#      cutover; the Netlify staging TOML schedules must be commented BEFORE
#      step 5 (never both owners — doc 05 §3b).
#
#   cutover-staging-db.sh staging "<session-pooler URI>"   # dashboard → Connect
#   SKIP_MIGRATE=1 …   # reuse a previously migrated Cloud SQL (step 2 skipped)
#   DRY_RUN=1 …        # print every command + env edit, touch nothing
#
# DANGEROUS BY DESIGN: truncates Cloud SQL tables, invalidates all staging
# sessions, repoints auth/rest/api/jobs/hosting, hands cron ownership to GCP.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: cutover-staging-db.sh staging SOURCE_DB_URL}"
SOURCE_DB_URL="${2:-${SOURCE_DB_URL:-}}"
[ "$ENV_NAME" = "staging" ] || { echo "✗ staging cutover only (prod has its own cutover-db.sh)"; exit 1; }
load_gcp_env "$ENV_NAME"
[ "${DATA_MODE:-}" = "hosted-supabase" ] || {
  echo "✗ DATA_MODE=${DATA_MODE:-} — staging is already on cloud-sql; refusing to run twice."
  exit 1
}
if [ -n "$SOURCE_DB_URL" ] || [ "${SKIP_MIGRATE:-0}" = "1" ]; then :; else
  echo "✗ SOURCE_DB_URL required (Supabase dashboard → Connect → Session pooler URI), or SKIP_MIGRATE=1"
  exit 1
fi
require_vars SQL_INSTANCE CLOUD_RUN_AUTH CLOUD_RUN_REST CLOUD_RUN_API

DRY_RUN="${DRY_RUN:-0}"
run() { if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

echo "⚠ CUTOVER EFFECTS — read all four before confirming:"
echo "   1. Cloud SQL ${SQL_INSTANCE} public tables are TRUNCATED and reloaded."
echo "   2. Fresh JWT secret: EVERY staging session dies and old keys stop working"
echo "      (owner decision) — all staging users must log in again."
echo "   3. Routing flips: browser + api + jobs → self-hosted GoTrue/PostgREST."
echo "   4. Cron ownership hands to GCP staging (Netlify TOML must be commented first)."
if [ "$DRY_RUN" != "1" ] && [ "${CUTOVER_CONFIRM:-0}" != "1" ]; then
  printf 'Type "staging" to proceed: '
  read -r ans
  [ "$ans" = "staging" ] || { echo "aborted"; exit 1; }
fi

# Rollback record for the env file (also made by migrate-staging-db.sh — this
# one covers the SKIP_MIGRATE=1 path and timestamps the flip itself).
TS="$(date -u +%Y%m%d-%H%M%S)"
PREFLIP="$DEPLOY_DIR/env/.env.$ENV_NAME.preflip.$TS"
if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would snapshot env → $(basename "$PREFLIP")"
else
  cp "$DEPLOY_DIR/env/.env.$ENV_NAME" "$PREFLIP"
  echo "→ pre-flip env snapshot: $(basename "$PREFLIP")"
fi

update_env() { # update_env KEY VALUE — replace/add a line in .env.<env> (dry-run: print only)
  local k="$1" v="$2"
  if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] update_env %s=%s\n' "$k" "$v"; return 0; fi
  local tmp touched=0 line
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "${k}="*) printf '%s=%s\n' "$k" "$v"; touched=1;; *) printf '%s\n' "$line";; esac
  done < "$DEPLOY_DIR/env/.env.$ENV_NAME" > "$tmp"
  [ "$touched" = "1" ] || printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$DEPLOY_DIR/env/.env.$ENV_NAME"
}

push_secret() { # push_secret <secret-name> <value> — create-if-missing + new version
  if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] push secret %s\n' "$1"; return 0; fi
  gcloud secrets describe "$1" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 || \
    gcloud secrets create "$1" --project="$GCP_PROJECT_ID" --replication-policy=automatic --quiet >/dev/null
  printf '%s' "$2" | gcloud secrets versions add "$1" --project="$GCP_PROJECT_ID" --data-file=- --quiet >/dev/null
}

# ── Runtime-config staging pair — the deploy-time flip patch ─────────────────
# The committed public/runtime-config.js carries the HOSTED dev pair for the
# staging branch. This function swaps those two lines for THIS deploy only
# (origin + minted anon key) and the EXIT trap restores the committed form —
# the minted key must never linger in the working tree, and a pre-flip hosting
# deploy always ships the hosted pair (runtimeConfigIdentity.test.js asserts
# the committed form stays the hosted pair).
RUNTIME_CONFIG="$REPO_DIR/public/runtime-config.js"
patch_runtime_config() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] patch ${RUNTIME_CONFIG#*Extracta/} (staging pair → origin + minted anon key), deploy-time only"
    return 0
  fi
  cp "$RUNTIME_CONFIG" "$RUNTIME_CONFIG.precutover.bak"
  sed -e "s|^var _stagingSupabaseUrl = .*|var _stagingSupabaseUrl = window.location.origin;|" \
      -e "s|^var _stagingSupabaseAnonKey = .*|var _stagingSupabaseAnonKey = \"${ANON_KEY}\";|" \
      "$RUNTIME_CONFIG" > "$RUNTIME_CONFIG.tmp" && mv "$RUNTIME_CONFIG.tmp" "$RUNTIME_CONFIG"
  grep -q "_stagingSupabaseUrl = window.location.origin" "$RUNTIME_CONFIG" || {
    echo "✗ runtime-config patch did not land — aborting before deploy"; exit 1; }
}
restore_runtime_config() {
  [ -f "$RUNTIME_CONFIG.precutover.bak" ] || return 0
  mv "$RUNTIME_CONFIG.precutover.bak" "$RUNTIME_CONFIG"
  echo "→ runtime-config.js restored to the committed (hosted-pair) form"
}
trap restore_runtime_config EXIT

# ── 0. FRESH JWT SECRET + MINTED KEYS ─────────────────────────────────────────
echo "── 0/6 FRESH JWT SECRET + MINTED ANON/SERVICE KEYS (sessions invalidate)"
FRESH_SECRET="$(gen_token)$(gen_token)"
if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would mint anon + service keys from a fresh 64-char JWT secret"
  ANON_KEY="<minted-anon-key>"
  SERVICE_KEY="<minted-service-key>"
else
  update_env JWT_SECRET "$FRESH_SECRET"
  # eval the mint output (ANON_KEY=… / SERVICE_KEY=…) into this shell.
  eval "$(JWT_SECRET="$FRESH_SECRET" node "$HERE/../mint-supabase-keys.mjs" --ref "$SQL_INSTANCE")"
  update_env SUPABASE_ANON_KEY "$ANON_KEY"
  update_env SUPABASE_SERVICE_KEY "$SERVICE_KEY"
fi
run push_secret "$(sm_name JWT_SECRET)" "$FRESH_SECRET"
run push_secret "$(sm_name SUPABASE_SERVICE_KEY)" "$SERVICE_KEY"
echo "   ⚠ CONSEQUENCE (owner decision): every existing staging session AND key is"
echo "     now invalid. Users must log in again; anything holding the old service"
echo "     key must be re-pointed to the new one (Secret Manager is updated here)."

# ── 1. FREEZE ─────────────────────────────────────────────────────────────────
echo "── 1/6 FREEZE GCP crons + comment Netlify TOML schedules (never both)"
run "$HERE/crons.sh" "$ENV_NAME" pause
echo "   ⚠ NETLIFY STAGING SIDE (manual, same window): comment the schedule blocks"
echo "     in netlify.toml (the staging scheduled-function entries) and redeploy"
echo "     Netlify staging BEFORE step 5 — two cron owners at once double-sends."

# ── 2. MIGRATE ────────────────────────────────────────────────────────────────
echo "── 2/6 MIGRATE hosted Supabase → Cloud SQL (schema + data + users)"
if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  echo "   SKIP_MIGRATE=1 — reusing the Cloud SQL data migrated earlier"
else
  run "$HERE/migrate-staging-db.sh" "$ENV_NAME" "$SOURCE_DB_URL"
fi

# ── 3. REPOINT auth + rest ────────────────────────────────────────────────────
echo "── 3/6 REPOINT auth+rest (fresh JWT secret already in Secret Manager)"
run "$HERE/deploy-run.sh" "$ENV_NAME" auth rest

# ── 4. REPOINT api/jobs + Hosting ─────────────────────────────────────────────
echo "── 4/6 REPOINT api/jobs env + Hosting rewrites"
update_env DATA_MODE cloud-sql
update_env SUPABASE_URL "$APP_BASE_URL"
# The self-hosted GoTrue allowlist must include every origin that will call it.
# Accumulate in ONE shell var then write once — two update_env calls in a row
# would each read the pre-edit value and the second write would clobber the
# first append (the shell var is stale after the first file edit).
# Origins are composed from env (doc 06): the Firebase Hosting site id plus
# the staging custom domain held in GOTRUE_URI_ALLOW_LIST's existing entries.
ALLOW="${GOTRUE_URI_ALLOW_LIST:-}"
case "$ALLOW" in *"${FHS_SITE_ID}.web.app"*) ;; *) ALLOW="${ALLOW:+$ALLOW,}https://${FHS_SITE_ID}.web.app/**";; esac
case "$ALLOW" in *stg.datiq.app*) ;; *) ALLOW="${ALLOW:+$ALLOW,}https://stg.datiq.app/**";; esac
[ "$ALLOW" = "${GOTRUE_URI_ALLOW_LIST:-}" ] || update_env GOTRUE_URI_ALLOW_LIST "$ALLOW"
patch_runtime_config
run "$HERE/deploy-run.sh" "$ENV_NAME" api jobs
run "$HERE/deploy-hosting.sh" "$ENV_NAME"

# ── 5. HAND CRONS TO GCP ──────────────────────────────────────────────────────
echo "── 5/6 HAND CRON OWNERSHIP TO GCP (Netlify TOML must be commented FIRST)"
update_env OPS_JOBS_DISABLED 0
run "$HERE/deploy-run.sh" "$ENV_NAME" jobs
run "$HERE/crons.sh" "$ENV_NAME" resume

# ── 6. SMOKE ──────────────────────────────────────────────────────────────────
echo "── 6/6 POST-FLIP SMOKE"
run "$HERE/smoke.sh" "$ENV_NAME"

echo
echo "✓ staging cutover steps 0–6 done."
echo "  MANUAL: sign in on ${APP_BASE_URL} (fresh account session), verify a"
echo "  schedule + one extraction, and test an OAuth provider if social login"
echo "  credentials are configured on the self-hosted GoTrue."
echo "  CAVEATS: Supabase Storage objects were NOT migrated (outside Postgres)."
echo
echo "ROLLBACK (hosted Supabase was never touched — its data is intact):"
echo "  1. cp ${PREFLIP} ${DEPLOY_DIR}/env/.env.staging"
echo "  2. ${HERE}/deploy-run.sh staging auth rest api jobs"
echo "  3. ${HERE}/deploy-hosting.sh staging      # runtime-config already restored"
echo "  4. ${HERE}/crons.sh staging pause"
echo "  5. un-comment the Netlify staging TOML schedules and redeploy Netlify staging"
