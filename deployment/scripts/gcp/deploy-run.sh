#!/usr/bin/env bash
# deployment/scripts/gcp/deploy-run.sh — deploy the Cloud Run services.
#
#   deploy-run.sh staging [api|jobs|admin|trackers|auth|rest]...
#   deploy-run.sh staging                  → all four app surfaces
#   deploy-run.sh staging auth rest        → the self-hosted trio proof services
#                                            (requires migrate-db.sh to have run)
#
# Security posture (doc 05 §3a): api/admin/trackers are PUBLIC
# (--allow-unauthenticated) — Netlify-parity, since Netlify functions have no
# IAM gate and are reachable by anyone with the site URL; the adapter's own
# auth (admin token, JOBS_TOKEN) still applies per-route. jobs stays
# --no-allow-unauthenticated: only Cloud Scheduler may call it, via OIDC +
# x-datiq-cron-token. Note the direct *.run.app URLs of the public three are
# also open (same as Netlify's /.netlify/functions/* URLs) — lock them down
# behind a Load Balancer only if that ever becomes a requirement.
# auth/rest stay IAM-protected: the browser talks to them through the Hosting
# rewrites (/auth/v1/**, /rest/v1/** in cloud-sql mode), never directly.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: deploy-run.sh <staging|prod> [api jobs admin trackers auth rest studio]}"
load_gcp_env "$ENV_NAME"
shift || true
SERVICES="${*:-api jobs admin trackers}"

require_vars APP_BASE_URL APP_CONTEXT GIT_BRANCH
[ -n "${SUPABASE_URL:-}" ] || { echo "✗ SUPABASE_URL missing in .env.$ENV_NAME"; exit 1; }

# The anon key rides as a PLAIN env var on these services (not Secret Manager),
# so a rotated/revoked key in .env.<env> would ship silently and 503 every
# signed-in call. Verify the pair offline AND against the live project first —
# the 2026-09-29 staging incident shipped exactly this way. SKIP_SUPABASE_CHECK=1
# to bypass (prints a SKIP line; smoke still runs after).
"$HERE/../check-supabase-pair.sh" "$ENV_NAME"

# ── compose the --set-secrets flag from deployment/gcp/secrets.manifest ──────
secret_flags() { # → "--set-secrets K1=NAME:latest,K2=…" (existing secrets only)
  local pairs=() row var
  while read -r runtime_var _rest; do
    case "$runtime_var" in ''|\#*) continue;; esac
    # Manifest rows whose source value was empty were never created — skip them
    # (bootstrap-secrets.sh prints them); a later deploy picks them up.
    gcloud secrets describe "$(sm_name "$runtime_var")" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 || continue
    pairs+=("${runtime_var}=$(sm_name "$runtime_var"):latest")
  done < <(sed 's/  */ /g' "$DEPLOY_DIR/gcp/secrets.manifest")
  [ ${#pairs[@]} -eq 0 ] && return 0
  printf -- "--set-secrets=%s" "$(IFS=,; echo "${pairs[*]}")"
}
API_SECRETS="$(secret_flags)"
JOBS_SECRETS="$API_SECRETS"   # scheduler-run jobs share the runtime secret set

# ── env vars via --env-vars-file (JSON avoids gcloud's comma escaping) ───────
env_vars_file() { # env_vars_file <name> K=V... → path of a JSON env-vars file
  # <name> keeps each caller in its own file — a shared path silently let the
  # LAST caller overwrite the first's vars (api/jobs once deployed with only
  # rest's PGRST_* set).
  local out="$DEPLOY_DIR/generated/gcp/env-vars-$ENV_NAME-$1.json"
  shift
  mkdir -p "$(dirname "$out")"
  node -e '
    const [out, ...kv] = process.argv.slice(1);
    const env = {};
    for (const item of kv) {
      const i = item.indexOf("=");
      env[item.slice(0, i)] = item.slice(i + 1);
    }
    require("fs").writeFileSync(out, JSON.stringify(env, null, 2) + "\n");
  ' "$out" "$@"
  printf '%s' "$out"
}
# Platform-env emulation: Netlify injects these into every function; on Cloud
# Run the adapter/functions read them from process.env.
APP_ENV_VARS=(env_vars_file app \
  "NODE_ENV=production" \
  "URL=$APP_BASE_URL" "SITE_URL=$APP_BASE_URL" "DEPLOY_URL=$APP_BASE_URL" \
  "CONTEXT=$APP_CONTEXT" "BRANCH=$GIT_BRANCH" "APP_BASE_URL=$APP_BASE_URL" \
  "SUPABASE_URL=$SUPABASE_URL" "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
  "VITE_SUPABASE_URL=$SUPABASE_URL" "VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
  "VITE_AI_MODEL=${VITE_AI_MODEL:-}" \
  "GEMINI_MODEL_FAST=${GEMINI_MODEL_FAST:-}" \
  "GEMINI_MODEL_DEEP=${GEMINI_MODEL_DEEP:-}" \
  "OPENAI_MODEL_FAST=${OPENAI_MODEL_FAST:-}" \
  "OPENAI_MODEL_DEEP=${OPENAI_MODEL_DEEP:-}" \
  "ANTHROPIC_MODEL_FAST=${ANTHROPIC_MODEL_FAST:-}" \
  "ANTHROPIC_MODEL_DEEP=${ANTHROPIC_MODEL_DEEP:-}" \
  "PERPLEXITY_MODEL_FAST=${PERPLEXITY_MODEL_FAST:-}" \
  "PERPLEXITY_MODEL_DEEP=${PERPLEXITY_MODEL_DEEP:-}" \
  "AI_PROVIDER_ORDER=${AI_PROVIDER_ORDER:-}" \
  "SCRAPE_PROVIDER_ORDER=${SCRAPE_PROVIDER_ORDER:-direct,spider,jina}" \
  "ENGAGEMENT_ENABLED=${ENGAGEMENT_ENABLED:-0}" \
  "OPS_JOBS_DISABLED=${OPS_JOBS_DISABLED:-1}" \
  "PURGE_ENABLED=${PURGE_ENABLED:-0}" \
  "VITE_WEBHOOK_URL=${VITE_WEBHOOK_URL:-}" \
  "N8N_PUBLIC_WEBHOOK_URL=${N8N_PUBLIC_WEBHOOK_URL:-}" \
  "SITE_NAME=${SITE_NAME:-DatIQ}")
ENV_VARS_JSON="$("${APP_ENV_VARS[@]}")"
# PostgREST needs a schemas list containing a comma — env-vars file again.
REST_ENV_JSON="$(env_vars_file rest "PGRST_DB_SCHEMAS=public,storage" "PGRST_DB_ANON_ROLE=anon" "PGRST_DB_POOL=5")"

# require_image <image-ref> — fail FAST with the remedy when nothing was built
# at IMG_TAG. deploy-run.sh rides IMG_TAG (default: current git sha); gcloud's
# own "Image not found" error only appears after a long deploy attempt and
# names no cure. The remedies, in the order they're usually right:
#   build-images.sh $ENV_NAME        — build + push the current tree
#   update-env.sh $ENV_NAME          — env-only change, ride the live image
#   DATIQ_IMG_TAG_OVERRIDE=<tag> …   — redeploy a known earlier build
require_image() {
  local img="$1"
  if gcloud artifacts docker images describe "$img" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    return 0
  fi
  if gcloud artifacts docker images describe "${img%%@*}" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    return 0
  fi
  echo "✗ image not found: $img"
  echo "  Nothing was built at IMG_TAG=$(printf '%s' "$img" | sed 's/.*://'). Pick one:"
  echo "    $HERE/build-images.sh $ENV_NAME          # build + push the current tree"
  echo "    $HERE/update-env.sh $ENV_NAME            # env-only change, no rebuild"
  echo "    DATIQ_IMG_TAG_OVERRIDE=<tag> deploy-run.sh $ENV_NAME <units>   # known build"
  exit 1
}

for svc in $SERVICES; do
  case "$svc" in
    api)
      require_image "$IMG_API"
      echo "→ Cloud Run ${CLOUD_RUN_API} (api — public, Netlify parity)"
      gcloud run deploy "$CLOUD_RUN_API" "${GCP_FLAGS[@]}" \
        --image="$IMG_API" --port=8080 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=4 --concurrency=80 \
        --memory=1Gi --cpu=1 --timeout=300 \
        --service-account="$SA_API_EMAIL" \
        --env-vars-file="$ENV_VARS_JSON" $API_SECRETS --quiet
      grant_run_invoker "$CLOUD_RUN_API" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    jobs)
      require_image "$IMG_API"
      echo "→ Cloud Run ${CLOUD_RUN_JOBS} (jobs — Scheduler OIDC only)"
      # $JOBS_SECRETS deliberately UNQUOTED (like the api branch): secret_flags()
      # returns "" on a fresh project, and a quoted expansion would hand gcloud
      # a literal empty positional argument.
      gcloud run deploy "$CLOUD_RUN_JOBS" "${GCP_FLAGS[@]}" \
        --image="$IMG_API" --port=8080 --no-allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=1Gi --cpu=1 --timeout=900 \
        --command=node --args=adapter/server.mjs --args=jobs \
        --service-account="$SA_JOBS_EMAIL" \
        --env-vars-file="$ENV_VARS_JSON" $JOBS_SECRETS --quiet
      grant_run_invoker "$CLOUD_RUN_JOBS" "serviceAccount:${SA_SCHEDULER_EMAIL}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    admin)
      echo "→ Cloud Run ${CLOUD_RUN_ADMIN} (admin surface — public, Netlify parity)"
      gcloud run deploy "$CLOUD_RUN_ADMIN" "${GCP_FLAGS[@]}" \
        --image="$IMG_ADMIN" --port=80 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=256Mi --cpu=1 --timeout=60 --service-account="$SA_API_EMAIL" --quiet
      grant_run_invoker "$CLOUD_RUN_ADMIN" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    trackers)
      echo "→ Cloud Run ${CLOUD_RUN_TRACKERS} (tracker/config layer — public, Netlify parity)"
      gcloud run deploy "$CLOUD_RUN_TRACKERS" "${GCP_FLAGS[@]}" \
        --image="$IMG_TRACKERS" --port=80 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=256Mi --cpu=1 --timeout=60 --service-account="$SA_API_EMAIL" --quiet
      grant_run_invoker "$CLOUD_RUN_TRACKERS" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    auth)
      require_vars CLOUD_RUN_AUTH AUTH_IMAGE JWT_SECRET
      echo "→ Cloud Run ${CLOUD_RUN_AUTH} (GoTrue proof service → staging Cloud SQL)"
      gcloud run deploy "$CLOUD_RUN_AUTH" "${GCP_FLAGS[@]}" \
        --image="${AUTH_IMAGE:?AUTH_IMAGE missing in .env}" --port=8080 --no-allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=512Mi --cpu=1 --timeout=60 --service-account="$SA_JOBS_EMAIL" \
        --add-cloudsql-instances="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE:?SQL_INSTANCE missing}" \
        --set-env-vars="GOTRUE_DB_DRIVER=postgres,GOTRUE_API_HOST=0.0.0.0,GOTRUE_API_PORT=8080,API_EXTERNAL_URL=${APP_BASE_URL},GOTRUE_SITE_URL=${APP_BASE_URL},GOTRUE_JWT_EXP=3600,GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated,GOTRUE_DISABLE_SIGNUP=false,GOTRUE_EXTERNAL_EMAIL_ENABLED=true,GOTRUE_MAILER_AUTOCONFIRM=${GOTRUE_MAILER_AUTOCONFIRM:-false},GOTRUE_LOG_LEVEL=warn,GOTRUE_URI_ALLOW_LIST=${GOTRUE_URI_ALLOW_LIST:-}" \
        --set-secrets="GOTRUE_DB_DATABASE_URL=$(sm_name GOTRUE_DB_DATABASE_URL):latest,GOTRUE_JWT_SECRET=$(sm_name JWT_SECRET):latest" --quiet
      ;;
    rest)
      require_vars CLOUD_RUN_REST REST_IMAGE
      echo "→ Cloud Run ${CLOUD_RUN_REST} (PostgREST proof service → staging Cloud SQL)"
      gcloud run deploy "$CLOUD_RUN_REST" "${GCP_FLAGS[@]}" \
        --image="${REST_IMAGE:?REST_IMAGE missing in .env}" --port=3000 --no-allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=512Mi --cpu=1 --timeout=60 --service-account="$SA_JOBS_EMAIL" \
        --add-cloudsql-instances="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE:?SQL_INSTANCE missing}" \
        --env-vars-file="$REST_ENV_JSON" \
        --set-secrets="PGRST_DB_URI=$(sm_name PGRST_DB_URI):latest,PGRST_JWT_SECRET=$(sm_name JWT_SECRET):latest" --quiet
      ;;
    studio)
      require_vars CLOUD_RUN_STUDIO SQL_INSTANCE
      studio_img="${STUDIO_IMAGE:-$IMG_STUDIO}"
      pg_meta_img="${PG_META_IMAGE:-$IMG_PG_META}"
      studio_port="${STUDIO_PORT:-3000}"
      echo "→ Cloud Run ${CLOUD_RUN_STUDIO} (Supabase Studio + pg-meta → Cloud SQL)"
      studio_secrets=()
      if gcloud secrets describe "$(sm_name POSTGRES_PASSWORD)" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
        studio_secrets+=("POSTGRES_PASSWORD=$(sm_name POSTGRES_PASSWORD):latest")
      fi
      if gcloud secrets describe "$(sm_name SUPABASE_SERVICE_KEY)" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
        studio_secrets+=("SUPABASE_SERVICE_KEY=$(sm_name SUPABASE_SERVICE_KEY):latest")
      fi
      studio_sec_flag=""
      [ ${#studio_secrets[@]} -gt 0 ] && studio_sec_flag="--set-secrets=$(IFS=,; echo "${studio_secrets[*]}")"

      pg_meta_sec_flag=""
      if gcloud secrets describe "$(sm_name PG_META_DB_URL)" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
        pg_meta_sec_flag="--set-secrets=PG_META_DB_URL=$(sm_name PG_META_DB_URL):latest"
      elif gcloud secrets describe "$(sm_name POSTGRES_PASSWORD)" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
        pg_meta_sec_flag="--set-secrets=PG_META_DB_PASSWORD=$(sm_name POSTGRES_PASSWORD):latest"
      fi

      gcloud run deploy "$CLOUD_RUN_STUDIO" "${GCP_FLAGS[@]}" --quiet \
        --no-allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 \
        --service-account="$SA_JOBS_EMAIL" \
        --add-cloudsql-instances="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE}" \
        --container=studio \
          --image="$studio_img" \
          --port="$studio_port" \
          --memory=1Gi --cpu=1 \
          --depends-on=pg-meta \
          --set-env-vars="STUDIO_PG_META_URL=http://127.0.0.1:8080,SUPABASE_URL=${APP_BASE_URL},SUPABASE_PUBLIC_URL=${APP_BASE_URL},AUTH_JWT_SECRET=${JWT_SECRET:-},SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
          $studio_sec_flag \
        --container=pg-meta \
          --image="$pg_meta_img" \
          --memory=512Mi --cpu=1 \
          --startup-probe="tcpSocket.port=8080,timeoutSeconds=10,failureThreshold=15" \
          --set-env-vars="PG_META_PORT=8080" \
          $pg_meta_sec_flag
      ;;
    *) echo "✗ unknown service: $svc (api|jobs|admin|trackers|auth|rest|studio)"; exit 1;;
  esac
done

echo "✓ Cloud Run deployed: $SERVICES"
