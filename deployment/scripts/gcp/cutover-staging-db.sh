#!/usr/bin/env bash
# deployment/scripts/gcp/cutover-staging-db.sh — flip STAGING from the hosted
# dev Supabase project to the self-hosted trio on Cloud SQL
# (doc 12-STAGING-DB-CUTOVER.md). The staging twin of cutover-db.sh (which is
# prod-only by design), with the two owner decisions of 2026-09-30 applied:
#
#   1. FRESH JWT SECRET: every user session AND every existing anon/service key
#      invalidates — users re-login. A fresh anon + service key pair is minted
#      from the new secret and shipped in the same window. The env file is
#      written ONLY at the repoint steps (3–4) that consume each value — never
#      at mint time: step 2's migration pre-flight must still see the ORIGINAL
#      hosted-project env, and an interrupted run must leave a working env.
#   2. CRON HANDOFF IS GATED, NOT AUTOMATIC: GCP staging owns crons only when
#      NETLIFY_CRONS_FROZEN=1 attests the Netlify TOML schedules are commented
#      out + Netlify staging redeployed. Without it the cutover completes with
#      GCP jobs PAUSED and the handoff is finished later via
#      `cutover-staging-db.sh staging finish-crons` (never both cron owners).
#
#   cutover-staging-db.sh staging "<session-pooler URI>"   # dashboard → Connect
#   cutover-staging-db.sh staging finish-crons             # complete ONLY step 5
#                                   # (cron handoff) after the Netlify freeze —
#                                   # for when the main run deferred it
#   SKIP_MIGRATE=1 …   # reuse a previously migrated Cloud SQL (step 2 skipped)
#   DRY_RUN=1 …        # print every command + env edit, touch nothing
#   NETLIFY_CRONS_FROZEN=1   # attestation that the Netlify staging TOML
#                            # schedules are commented out + redeployed —
#                            # REQUIRED for the cron handoff to actually resume
#
# DANGEROUS BY DESIGN: truncates Cloud SQL tables, invalidates all staging
# sessions, repoints auth/rest/api/jobs/hosting, hands cron ownership to GCP.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: cutover-staging-db.sh staging SOURCE_DB_URL | cutover-staging-db.sh staging finish-crons}"
MODE="${2:-cutover}"
# `staging finish-crons` completes ONLY the deferred cron handoff (step 5);
# any other second argument is the migration source URI.
if [ "$MODE" = "finish-crons" ]; then SOURCE_DB_URL=""; else SOURCE_DB_URL="$MODE"; fi
[ "$ENV_NAME" = "staging" ] || { echo "✗ staging cutover only (prod has its own cutover-db.sh)"; exit 1; }
load_gcp_env "$ENV_NAME"
if [ "$MODE" = "finish-crons" ]; then
  : # DATA_MODE is already cloud-sql after the main cutover — the twin-guard
    # below must not refuse this completion path.
elif [ "${DATA_MODE:-}" = "cloud-sql" ]; then
  # CUTOVER_RESUME=1 resumes a cutover that flipped .env.staging (step 4) but
  # died before the service repoint landed — e.g. `image not found` because
  # HEAD had moved past the last build. Migration (step 2) is skipped by
  # definition (there is nothing new to load); steps 3–6 re-run idempotently.
  if [ "${CUTOVER_RESUME:-0}" = "1" ]; then
    echo "→ CUTOVER_RESUME=1: env already flipped to cloud-sql — resuming at the repoint steps"
    SKIP_MIGRATE=1
  else
    echo "✗ DATA_MODE=${DATA_MODE:-} — staging is already on cloud-sql; refusing to run twice."
    echo "  (interrupted after the env flip? re-run with CUTOVER_RESUME=1 SKIP_MIGRATE=1)"
    exit 1
  fi
elif [ "${DATA_MODE:-}" != "hosted-supabase" ]; then
  echo "✗ DATA_MODE=${DATA_MODE:-} — expected hosted-supabase for a cutover source."
  exit 1
fi
if [ "$MODE" = "finish-crons" ]; then
  : # no migration source needed
elif [ -n "$SOURCE_DB_URL" ] || [ "${SKIP_MIGRATE:-0}" = "1" ]; then :; else
  echo "✗ SOURCE_DB_URL required (Supabase dashboard → Connect → Session pooler URI), or SKIP_MIGRATE=1"
  exit 1
fi
require_vars SQL_INSTANCE CLOUD_RUN_AUTH CLOUD_RUN_REST CLOUD_RUN_API

DRY_RUN="${DRY_RUN:-0}"
run() { if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

if [ "$MODE" != "finish-crons" ]; then
  echo "⚠ CUTOVER EFFECTS — read all four before confirming:"
  echo "   1. Cloud SQL ${SQL_INSTANCE} public tables are TRUNCATED and reloaded."
  echo "   2. Fresh JWT secret: EVERY staging session dies and old keys stop working"
  echo "      (owner decision) — all staging users must log in again."
  echo "   3. Routing flips: browser + api + jobs → self-hosted GoTrue/PostgREST."
  echo "   4. Cron ownership hands to GCP staging ONLY with NETLIFY_CRONS_FROZEN=1;"
  echo "      otherwise the cutover completes with GCP jobs left PAUSED."
fi
if [ "$DRY_RUN" != "1" ] && [ "${CUTOVER_CONFIRM:-0}" != "1" ] && [ "$MODE" != "finish-crons" ]; then
  printf 'Type "staging" to proceed: '
  read -r ans
  [ "$ans" = "staging" ] || { echo "aborted"; exit 1; }
fi

# Rollback record for the env file (also made by migrate-staging-db.sh — this
# one covers the SKIP_MIGRATE=1 path and timestamps the flip itself).
# finish-crons skips this: it touches one env key and resumes jobs — no flip.
TS="$(date -u +%Y%m%d-%H%M%S)"
PREFLIP="$DEPLOY_DIR/env/.env.$ENV_NAME.preflip.$TS"
if [ "$MODE" = "finish-crons" ]; then
  echo "→ finish-crons: completing the deferred cron handoff only"
elif [ "$DRY_RUN" = "1" ]; then
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

# ── THE CRON HANDOFF (step 5 of the full cutover; the whole of finish-crons) ──
# 🔴 INTERLOCK, NOT A WARNING. The earlier revision printed a reminder and
# resumed the jobs regardless — resuming GCP crons while the Netlify staging
# schedules are still live means TWO owners firing at once: Netlify's
# scheduled functions keep working against the (now orphaned) hosted Supabase
# and would send alerts/emails from stale data while GCP's jobs work the new
# one. So the handoff requires an explicit attestation that the Netlify half
# of the freeze is DONE (schedules commented out + Netlify staging
# redeployed). Without it the jobs stay PAUSED — a safe, resumable state —
# and the operator is told exactly what remains.
hand_crons_to_gcp() {
  echo "── 5/6 HAND CRON OWNERSHIP TO GCP (Netlify TOML must be commented FIRST)"
  if [ "${NETLIFY_CRONS_FROZEN:-0}" = "1" ]; then
    update_env OPS_JOBS_DISABLED 0
    run "$HERE/update-env.sh" "$ENV_NAME" jobs
    run "$HERE/crons.sh" "$ENV_NAME" resume
    return 0
  fi
  echo "   ⏸ DEFERRED: GCP jobs stay PAUSED — cron ownership has NOT moved yet."
  echo "     Netlify staging schedules are presumably still live, and resuming"
  echo "     now would put both owners to work at once."
  echo
  echo "     When the Netlify half of the freeze is done (netlify.toml staging"
  echo "     schedule blocks commented out + Netlify staging redeployed), finish"
  echo "     the handoff with:"
  echo "       NETLIFY_CRONS_FROZEN=1 $HERE/cutover-staging-db.sh $ENV_NAME finish-crons"
  echo "     (or manually: flip OPS_JOBS_DISABLED=0 in .env.staging,"
  echo "      $HERE/update-env.sh $ENV_NAME jobs, $HERE/crons.sh $ENV_NAME resume)"
  return 1   # deferred ≠ failed, but the caller must know the window is open
}

if [ "$MODE" = "finish-crons" ]; then
  if hand_crons_to_gcp; then
    echo "── POST-HANDOFF SMOKE"
    run "$HERE/smoke.sh" "$ENV_NAME"
    echo
    echo "✓ cron ownership now fully with GCP staging. Watch one scheduler tick"
    echo "  (gcloud scheduler jobs list --location=$GCP_REGION) and one alert path."
  else
    echo "✗ cron handoff still deferred — nothing changed. See the message above."
  fi
  exit 0
fi

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
# ⚠️ THE ENV FILE IS NOT TOUCHED HERE. Step 2's migration pre-flight reads
# .env.staging and validates that SUPABASE_ANON_KEY matches SUPABASE_URL's
# project (offline ref match + live probe against the HOSTED project). Writing
# the minted keys now — as an earlier revision did — failed that pre-flight
# with a PROJECT MISMATCH before the migration could run, and left the env
# file flipped-forward if the script died anywhere below. The writes are
# therefore DEFERRED to the repoint steps that actually consume each value:
#   step 3  JWT_SECRET          → GoTrue (auth rest) is redeployed with it
#   step 4  SUPABASE_ANON_KEY /
#           SUPABASE_SERVICE_KEY → api/jobs redeploys + runtime-config patch
# Until those steps run, every staging deploy keeps working exactly as before.
if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would mint anon + service keys from a fresh 64-char JWT secret"
  echo "  [dry-run] would push the fresh JWT secret to $(sm_name JWT_SECRET)"
  echo "  [dry-run] would push the minted service key to $(sm_name SUPABASE_SERVICE_KEY)"
  ANON_KEY="<minted-anon-key>"
  SERVICE_KEY="<minted-service-key>"
else
  # eval the mint output (ANON_KEY=… / SERVICE_KEY=…) into this shell.
  eval "$(JWT_SECRET="$FRESH_SECRET" node "$HERE/../mint-supabase-keys.mjs" --ref "$SQL_INSTANCE")"
  run push_secret "$(sm_name JWT_SECRET)" "$FRESH_SECRET"
  run push_secret "$(sm_name SUPABASE_SERVICE_KEY)" "$SERVICE_KEY"
fi
echo "   (Secret Manager updated; the env file flips at steps 3–4 — no staging"
echo "    deploy is broken by an interrupted cutover before the repoint.)"

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
# First env write of the cutover: GoTrue is redeployed with the fresh secret
# below, which is the moment existing sessions actually invalidate. Nothing
# above this line changed what any deployed service reads.
update_env JWT_SECRET "$FRESH_SECRET"
# studio rides the same step (pg-meta → Cloud SQL via PG_META_DB_URL; its
# SUPABASE_URL links flip with the env write below).
run "$HERE/deploy-run.sh" "$ENV_NAME" auth rest studio

# ── 4. REPOINT api/jobs + Hosting ─────────────────────────────────────────────
echo "── 4/6 REPOINT api/jobs env + Hosting rewrites"
update_env DATA_MODE cloud-sql
update_env SUPABASE_URL "$APP_BASE_URL"
# The minted pair lands here, together with the URL that matches it — writing
# them any earlier is how step 2's pre-flight saw a key "issued for project
# datiq-vsp-sql-datiq-stg" while SUPABASE_URL still named the hosted project.
update_env SUPABASE_ANON_KEY "$ANON_KEY"
update_env SUPABASE_SERVICE_KEY "$SERVICE_KEY"
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
# update-env, NOT deploy-run: this is an ENV-ONLY flip, so it must ride the
# image staging has already been validating — not "whatever tag the checkout
# happens to sit on", which is how step 4 died on `image not found:
# ...ctr-api:<sha>` after a docs-only commit moved HEAD past the last build
# (2026-10-01). update-env.sh resolves the serving revision's own tag.
run "$HERE/update-env.sh" "$ENV_NAME" api jobs
run "$HERE/deploy-hosting.sh" "$ENV_NAME"

# ── 5. HAND CRONS TO GCP ──────────────────────────────────────────────────────
CRONS_HANDED=0
if hand_crons_to_gcp; then CRONS_HANDED=1; fi

# ── 6. SMOKE ──────────────────────────────────────────────────────────────────
echo "── 6/6 POST-FLIP SMOKE"
run "$HERE/smoke.sh" "$ENV_NAME"

echo
if [ "$CRONS_HANDED" = "1" ]; then
  echo "✓ staging cutover steps 0–6 done — cron ownership now with GCP staging."
else
  echo "✓ staging cutover steps 0–4 + smoke done — routing and data now fully on"
  echo "  the self-hosted trio + Cloud SQL. CRON HANDOFF DEFERRED (step 5): GCP"
  echo "  jobs are PAUSED and Netlify staging schedules still own the legacy crons."
  echo "  Freeze the Netlify half, then run:"
  echo "    NETLIFY_CRONS_FROZEN=1 $HERE/cutover-staging-db.sh staging finish-crons"
fi
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
