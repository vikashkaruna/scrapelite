#!/usr/bin/env bash
# deployment/scripts/gcp/cutover-db.sh — the PRODUCTION cutover-window DB
# migration (doc 05 §3d steps 1–5, runbook doc 09). DANGEROUS BY DESIGN:
# pauses crons, dumps production Supabase, restores it into production Cloud
# SQL, repoints GoTrue/PostgREST/API/Hosting, hands cron ownership to GCP.
# DO NOT RUN outside the announced window.
#
#   cutover-db.sh prod SOURCE_DB_URL        # full window (steps 1–6)
#   cutover-db.sh prod finish-crons         # complete ONLY the deferred cron
#                                           # handoff (step 5)
#   DRY_RUN=1 cutover-db.sh prod SOURCE_DB_URL
#   CUTOVER_CONFIRM=1 …                     # skip the interactive prompt
#   CUTOVER_RESUME=1 …                      # env already flipped, resume at repoint
#   NETLIFY_CRONS_FROZEN=1 …                # attest Netlify no longer runs crons
#                                           # (the Netlify project is shut down /
#                                           # disabled, or all 13 schedules are
#                                           # off); REQUIRED for the cron handoff
#
# ── PROD DIFFERS FROM STAGING IN TWO WAYS (deliberate, doc 09 §0) ────────────
#   1. SAME JWT SECRET: .env.prod's JWT_SECRET must be the PROD SUPABASE JWT
#      secret so existing sessions AND the existing anon/service keys stay
#      valid across the flip. Nothing is minted here. A preflight verifies the
#      anon key's HS256 signature against that secret — a generated secret
#      would log every user out, and the check catches it BEFORE the window.
#   2. DNS FLIP IS MANUAL AND LAST (doc 09 §5): Netlify + hosted Supabase stay
#      intact through the rollback window; revert = DNS back + this script's
#      printed rollback steps.
#
# Every structural lesson of the 2026-10-01 staging execution is baked in
# (doc 12 §"Executed 2026-10-01"): env writes deferred to the repoint steps,
# re-runnable/clean-slate migration (migrate-db.sh), auth-schema ownership +
# anon grants, /auth/v1+/rest/v1 proxied through the api service, env-only
# flips riding the serving image (update-env.sh), and a GATED cron handoff
# (never two cron owners at once).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: cutover-db.sh prod SOURCE_DB_URL | cutover-db.sh prod finish-crons}"
MODE="${2:-cutover}"
if [ "$MODE" = "finish-crons" ]; then SOURCE_DB_URL=""; else SOURCE_DB_URL="$MODE"; fi
[ "$ENV_NAME" = "prod" ] || { echo "✗ cutover-db.sh runs against prod only (staging: cutover-staging-db.sh)"; exit 1; }
load_gcp_env "$ENV_NAME"
require_vars JWT_SECRET SQL_INSTANCE CLOUD_RUN_AUTH CLOUD_RUN_REST CLOUD_RUN_API DB_NAME

if [ "$MODE" = "finish-crons" ]; then
  : # DATA_MODE is already cloud-sql after the main cutover
elif [ "${DATA_MODE:-}" = "cloud-sql" ]; then
  if [ "${CUTOVER_RESUME:-0}" = "1" ]; then
    echo "→ CUTOVER_RESUME=1: env already flipped to cloud-sql — resuming at the repoint steps"
    SKIP_MIGRATE=1
  else
    echo "✗ DATA_MODE=${DATA_MODE:-} — prod is already on cloud-sql; refusing to run twice."
    echo "  (interrupted after the env flip? re-run with CUTOVER_RESUME=1)"
    exit 1
  fi
elif [ "${DATA_MODE:-}" != "hosted-supabase" ]; then
  echo "✗ DATA_MODE=${DATA_MODE:-} — expected hosted-supabase for a cutover source."
  exit 1
fi
if [ "$MODE" = "finish-crons" ]; then
  : # no migration source needed
elif [ -n "$SOURCE_DB_URL" ] || [ "${SKIP_MIGRATE:-0}" = "1" ]; then :; else
  echo "✗ SOURCE_DB_URL required (prod Supabase dashboard → Connect → Session pooler URI), or SKIP_MIGRATE=1"
  exit 1
fi

DRY_RUN="${DRY_RUN:-0}"
run() { if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

if [ "$MODE" != "finish-crons" ]; then
  echo "⚠ PROD CUTOVER EFFECTS — read all four before confirming:"
  echo "   1. Cloud SQL ${SQL_INSTANCE} public/auth/storage tables are truncated and reloaded."
  echo "   2. Anon/service keys stay valid (JWT_SECRET = prod Supabase secret); signed-in USER sessions do NOT (hosted signs ES256) — everyone signs in again."
  echo "   3. Routing flips: hosted Supabase → self-hosted GoTrue/PostgREST/Cloud SQL."
  echo "   4. Cron ownership hands to GCP prod ONLY with NETLIFY_CRONS_FROZEN=1;"
  echo "      otherwise the cutover completes with GCP jobs left PAUSED."
  echo "   Prerequisites NOT automated (doc 09 §0): external-party change list,"
  echo "   payments test event, rollback rehearsal."
fi
if [ "$DRY_RUN" != "1" ] && [ "${CUTOVER_CONFIRM:-0}" != "1" ] && [ "$MODE" != "finish-crons" ]; then
  printf 'Type "prod" to proceed: '
  read -r ans
  [ "$ans" = "prod" ] || { echo "aborted"; exit 1; }
fi

# Rollback record for the env file. finish-crons skips this: it touches one
# env key and resumes jobs — no flip.
TS="$(date -u +%Y%m%d-%H%M%S)"
PREFLIP="$DEPLOY_DIR/env/.env.$ENV_NAME.preflip.$TS"
if [ "$MODE" = "finish-crons" ]; then
  echo "→ finish-crons: completing the deferred cron handoff only"
elif [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would snapshot env → $(basename "$PREFLIP")"
else
  cp "$DEPLOY_DIR/env/.env.$ENV_NAME" "$PREFLIP"
  echo "→ pre-flip env snapshot: $(basename "$PREFLIP") (rollback record)"
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

# ── Runtime-config PROD pair — the deploy-time flip patch ───────────────────
# The committed public/runtime-config.js carries the HOSTED prod pair in
# _prodSupabaseUrl/_prodSupabaseAnonKey (same patchable shape as the staging
# pair — see its comment). This function swaps those two lines for THIS
# deploy only: url → window.location.origin (same-origin /auth/v1 + /rest/v1
# through the new Firebase rewrites) and the key → SUPABASE_ANON_KEY from
# .env.prod, which predates the flip and keeps working because the JWT secret
# is unchanged. The EXIT trap restores the committed form — the working tree
# must never carry the flipped pair, and a pre-flip hosting deploy always
# ships the hosted pair (runtimeConfigIdentity.test.js asserts the committed
# form).
RUNTIME_CONFIG="$REPO_DIR/public/runtime-config.js"
patch_runtime_config() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] patch ${RUNTIME_CONFIG#*Extracta/} (prod pair → origin + .env.prod anon key), deploy-time only"
    return 0
  fi
  cp "$RUNTIME_CONFIG" "$RUNTIME_CONFIG.precutover.bak"
  sed -e "s|^var _prodSupabaseUrl = .*|var _prodSupabaseUrl = window.location.origin;|" \
      -e "s|^var _prodSupabaseAnonKey = .*|var _prodSupabaseAnonKey = \"${SUPABASE_ANON_KEY}\";|" \
      "$RUNTIME_CONFIG" > "$RUNTIME_CONFIG.tmp" && mv "$RUNTIME_CONFIG.tmp" "$RUNTIME_CONFIG"
  grep -q "_prodSupabaseUrl = window.location.origin" "$RUNTIME_CONFIG" || {
    echo "✗ runtime-config patch did not land — aborting before deploy"; exit 1; }
}
restore_runtime_config() {
  [ -f "$RUNTIME_CONFIG.precutover.bak" ] || return 0
  mv "$RUNTIME_CONFIG.precutover.bak" "$RUNTIME_CONFIG"
  echo "→ runtime-config.js restored to the committed (hosted-pair) form"
}
trap restore_runtime_config EXIT

# ── THE CRON HANDOFF (step 5 of the window; the whole of finish-crons) ───────
# 🔴 INTERLOCK, NOT A WARNING. Resuming GCP prod crons while the Netlify prod
# schedules are still live means TWO owners firing at once: Netlify's
# scheduled functions keep working against hosted Supabase (still intact for
# rollback) and would double-send alerts/emails while GCP's jobs work Cloud
# SQL. The handoff requires an explicit attestation that the Netlify half of
# the freeze is DONE: the Netlify project is shut down/disabled (owner decision
# 2026-10-02, doc 09 §1.0a) or all 13 of its scheduled functions are off.
# Without it the jobs stay PAUSED — a safe, resumable state.
hand_crons_to_gcp() {
  echo "── 5/6 HAND CRON OWNERSHIP TO GCP PROD (Netlify must no longer run crons FIRST)"
  if [ "${NETLIFY_CRONS_FROZEN:-0}" = "1" ]; then
    update_env OPS_JOBS_DISABLED 0
    run "$HERE/update-env.sh" "$ENV_NAME" jobs
    run "$HERE/crons.sh" "$ENV_NAME" resume
    return 0
  fi
  echo "   ⏸ DEFERRED: GCP prod jobs stay PAUSED — cron ownership has NOT moved yet."
  echo "     Netlify prod schedules are presumably still live, and resuming now"
  echo "     would put both owners to work at once."
  echo
  echo "     When Netlify no longer runs crons (project shut down/disabled — all"
  echo "     13 scheduled functions, not 5), finish the handoff with:"
  echo "       NETLIFY_CRONS_FROZEN=1 $HERE/cutover-db.sh $ENV_NAME finish-crons"
  echo "     (or manually: flip OPS_JOBS_DISABLED=0 in .env.prod,"
  echo "      $HERE/update-env.sh $ENV_NAME jobs, $HERE/crons.sh $ENV_NAME resume)"
  return 1   # deferred ≠ failed, but the caller must know the window is open
}

if [ "$MODE" = "finish-crons" ]; then
  if hand_crons_to_gcp; then
    echo "── POST-HANDOFF SMOKE"
    run "$HERE/smoke.sh" "$ENV_NAME"
    echo
    echo "✓ cron ownership now fully with GCP prod. Watch one scheduler tick"
    echo "  (gcloud scheduler jobs list --location=$GCP_REGION) and one alert path."
  else
    echo "✗ cron handoff still deferred — nothing changed. See the message above."
  fi
  exit 0
fi

# ── PREFLIGHT: the anon key must be signed by JWT_SECRET ─────────────────────
# The one prod-specific catastrophe this script can prevent: .env.prod's
# JWT_SECRET left as a generated value (not the prod Supabase secret) — the
# flip would then silently log EVERY user out. HS256-verify the anon key's
# signature against the secret before touching anything.
# ⚠️ New-format keys (sb_publishable_…) are NOT JWTs and carry no signature to
# check — they are recognised as valid by shape and skipped, with a note (the
# operator still owns the "same secret" rule; doc 09 §0).
if [ "$DRY_RUN" != "1" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  case "$SUPABASE_ANON_KEY" in
    sb_publishable_*|sb_secret_*)
      echo "→ preflight: publishable-format anon key — signature check not applicable (verify JWT_SECRET = prod Supabase secret manually, doc 09 §0)"
      ;;
    *)
      node -e '
        const crypto = require("crypto");
        const [, secret, token] = process.argv;
        const [h, p, sig] = String(token).split(".");
        if (!h || !p || !sig) { console.error("✗ SUPABASE_ANON_KEY is neither a JWT nor a publishable-format key — cannot verify"); process.exit(1); }
        const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
        const a = Buffer.from(expected); const b = Buffer.from(sig);
        const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!ok) {
          console.error("✗ PREFLIGHT: SUPABASE_ANON_KEY is NOT signed by .env.prod JWT_SECRET.");
          console.error("  The flip would invalidate every session. Set JWT_SECRET to the");
          console.error("  PROD Supabase JWT secret (dashboard → Settings → API), then re-run.");
          process.exit(1);
        }
        console.log("✓ preflight: anon key signature matches .env.prod JWT_SECRET (anon/service keys stay valid; NOTE user sessions do NOT survive — hosted prod signs user tokens ES256, GoTrue validates HS256 — users sign in again)");
      ' "$JWT_SECRET" "$SUPABASE_ANON_KEY"
      ;;
  esac
fi

# ── 1. FREEZE ─────────────────────────────────────────────────────────────────
echo "── 1/6 FREEZE GCP prod crons (Netlify crons keep running until the Netlify project is shut down)"
run "$HERE/crons.sh" "$ENV_NAME" pause
echo "   ⚠ NETLIFY PROD SIDE (manual, BEFORE step 5): Netlify must stop running its"
echo "     13 scheduled functions — shut down/disable the Netlify project (owner plan)."
echo "     Two cron owners at once double-sends; step 5 stays deferred until then."

# ── 2. MIGRATE ────────────────────────────────────────────────────────────────
echo "── 2/6 MIGRATE prod Supabase → Cloud SQL (schema + data + users)"
if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  echo "   SKIP_MIGRATE=1 — reusing the Cloud SQL data migrated earlier"
else
  run "$HERE/migrate-db.sh" "$ENV_NAME" "$SOURCE_DB_URL"
  # Source-vs-target verification BEFORE any repoint: a count mismatch must
  # abort the window while hosted Supabase is still the serving database.
  if [ "$DRY_RUN" != "1" ]; then
    echo "── post-migration verification (source counts vs Cloud SQL counts)"
    PROXY_BIN="$DEPLOY_DIR/generated/bin/cloud-sql-proxy"
    PROXY_PORT="${CLOUD_SQL_PROXY_PORT:-15432}"
    if have cloud-sql-proxy; then PROXY_RESOLVED="$(command -v cloud-sql-proxy)"; else PROXY_RESOLVED="$PROXY_BIN"; fi
    [ -x "$PROXY_RESOLVED" ] || { echo "✗ cloud-sql-proxy not found (PATH or ${PROXY_BIN})"; exit 1; }
    "$PROXY_RESOLVED" "${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE}" --port="$PROXY_PORT" --quiet >/dev/null 2>&1 &
    PROXY_PID=$!
    trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
    for i in $(seq 1 30); do nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null && break; sleep 1; done
    # migrate-db.sh GENERATES DB_ADMIN_PASSWORD on the first run for an env and
    # appends it to the env FILE from a child process, so this shell never saw it
    # ("DB_ADMIN_PASSWORD: unbound variable", first prod cutover 2026-10-02).
    if [ -z "${DB_ADMIN_PASSWORD:-}" ]; then
      DB_ADMIN_PASSWORD="$(grep -E '^DB_ADMIN_PASSWORD=' "$DEPLOY_DIR/env/.env.$ENV_NAME" | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')"
      [ -n "$DB_ADMIN_PASSWORD" ] || { echo "✗ DB_ADMIN_PASSWORD not found in .env.$ENV_NAME after migration"; exit 1; }
    fi
    ADMIN_URL="postgresql://postgres:${DB_ADMIN_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"
    MISMATCH=0
    for t in "auth.users" "auth.identities" "public.extractions" "public.watchlists" "public.audits"; do
      src=$(psql "$SOURCE_DB_URL" -tAc "select count(*) from ${t}" 2>/dev/null || echo "n/a")
      dst=$(psql "$ADMIN_URL" -tAc "select count(*) from ${t}" 2>/dev/null || echo "n/a")
      echo "   ${t}: source=${src} target=${dst}"
      [ "$src" = "n/a" ] && continue   # table may not exist on every plan; absence is not a mismatch
      [ "$src" = "$dst" ] || MISMATCH=1
    done
    fk_err="$(grep -c 'ERROR' "$DEPLOY_DIR/generated/db/fk-restore.err" 2>/dev/null || true)"
    [ -z "$fk_err" ] && fk_err=0
    echo "   FK restore errors: ${fk_err} (must be 0 on the full path)"
    [ "$fk_err" = "0" ] || MISMATCH=1
    if [ "$MISMATCH" = "1" ]; then
      echo "✗ row-count/FK mismatch between source and Cloud SQL — DO NOT cut over."
      echo "  Hosted Supabase is untouched and still serving. Re-run after fixing."
      exit 1
    fi
    kill "$PROXY_PID" 2>/dev/null || true
    trap - EXIT
  fi
fi

# ── 3. REPOINT auth + rest ────────────────────────────────────────────────────
echo "── 3/6 REPOINT auth+rest at prod Cloud SQL (same JWT secret — existing"
echo "   sessions stay valid; verify sign-in immediately after)"
# The GoTrue allowlist must carry every origin that will call it BEFORE the
# auth service redeploys below — the staging run shipped this write one step
# late and the first auth deploy had a stale allowlist for one window. The
# pre-flip prod origins (datiq.app etc.) are already in .env.prod; this adds
# the Firebase twin exactly once.
ALLOW="${GOTRUE_URI_ALLOW_LIST:-}"
case "$ALLOW" in *"${FHS_SITE_ID}.web.app"*) ;; *) ALLOW="${ALLOW:+$ALLOW,}https://${FHS_SITE_ID}.web.app/**";; esac
[ "$ALLOW" = "${GOTRUE_URI_ALLOW_LIST:-}" ] || update_env GOTRUE_URI_ALLOW_LIST "$ALLOW"
# studio rides the same step: its pg-meta reads Cloud SQL through the refreshed
# PG_META_DB_URL secret, and its SUPABASE_URL links flip with the env below.
run "$HERE/deploy-run.sh" "$ENV_NAME" auth rest studio

# ── 4. REPOINT api/jobs env + Hosting ─────────────────────────────────────────
echo "── 4/6 REPOINT api/jobs env + Hosting rewrites"
update_env DATA_MODE cloud-sql
update_env SUPABASE_URL "$APP_BASE_URL"
# update-env, NOT deploy-run: an ENV-ONLY flip must ride the images prod is
# already serving (promote-prod digests) — not "whatever tag the checkout
# sits on", which is how the staging run died on `image not found` after a
# docs-only commit moved HEAD past the last build (2026-10-01).
run "$HERE/update-env.sh" "$ENV_NAME" api jobs
patch_runtime_config
run "$HERE/deploy-hosting.sh" "$ENV_NAME"

# ── 5. HAND CRONS TO GCP ──────────────────────────────────────────────────────
CRONS_HANDED=0
if hand_crons_to_gcp; then CRONS_HANDED=1; fi

# ── 6. SMOKE ──────────────────────────────────────────────────────────────────
echo "── 6/6 POST-FLIP SMOKE (payments test event + n8n round-trip are MANUAL —"
echo "   doc 09 §2/§4)"
run "$HERE/smoke.sh" "$ENV_NAME"

echo
if [ "$CRONS_HANDED" = "1" ]; then
  echo "✓ prod cutover steps 1–6 done — cron ownership now with GCP prod."
else
  echo "✓ prod cutover steps 1–4 + smoke done — routing and data now on the"
  echo "  self-hosted trio + Cloud SQL. CRON HANDOFF DEFERRED (step 5): GCP prod"
  echo "  jobs are PAUSED and Netlify still owns the legacy crons (13 of them)."
  echo "  After the Netlify project is shut down, run:"
  echo "    NETLIFY_CRONS_FROZEN=1 $HERE/cutover-db.sh prod finish-crons"
fi
echo "  MANUAL, in order (doc 09): payments test event → n8n round-trip →"
echo "  external-party URLs (Stripe/Razorpay/Resend/OAuth/n8n) → DNS flip (LAST)."
echo
echo "ROLLBACK (hosted Supabase + Netlify stay intact through the window):"
echo "  1. revert DNS at the registrar (TTL-permitting)"
echo "  2. cp ${PREFLIP} ${DEPLOY_DIR}/env/.env.prod"
echo "  3. ${HERE}/deploy-run.sh prod auth rest api jobs"
echo "  4. ${HERE}/deploy-hosting.sh prod"
echo "  5. ${HERE}/crons.sh prod pause   # GCP stops owning crons"
echo "  6. re-enable the Netlify project (its crons return with it) — only possible if it was not deleted"
