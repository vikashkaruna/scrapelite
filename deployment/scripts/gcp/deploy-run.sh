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
# AI_BUDGET_MS / EXTRACT_BUDGET_MS: the 8000 defaults are tuned for Netlify's
# 10s function cap; Cloud Run runs --timeout=300, so .env.<env> may raise them
# for heavy template runs (deep synthesis, subpage gathering).
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
  "AI_BUDGET_MS=${AI_BUDGET_MS:-8000}" \
  "EXTRACT_BUDGET_MS=${EXTRACT_BUDGET_MS:-8000}" \
  "SCRAPE_PROVIDER_ORDER=${SCRAPE_PROVIDER_ORDER:-direct,spider,jina}" \
  "ENGAGEMENT_ENABLED=${ENGAGEMENT_ENABLED:-0}" \
  "ENGAGEMENT_MOCK_SEND=${ENGAGEMENT_MOCK_SEND:-}" \
  "ENGAGEMENT_PUBLIC_URL=${ENGAGEMENT_PUBLIC_URL:-$APP_BASE_URL}" \
  "ENGAGEMENT_SENDER_DOMAINS=${ENGAGEMENT_SENDER_DOMAINS:-}" \
  "ENGAGEMENT_ALLOWLIST=${ENGAGEMENT_ALLOWLIST:-}" \
  "ENGAGEMENT_SEND_BUDGET_MS=${ENGAGEMENT_SEND_BUDGET_MS:-}" \
  "ENGAGEMENT_DISPATCH_BUDGET_MS=${ENGAGEMENT_DISPATCH_BUDGET_MS:-}" \
  "OPS_JOBS_DISABLED=${OPS_JOBS_DISABLED:-1}" \
  "PURGE_ENABLED=${PURGE_ENABLED:-0}" \
  "VITE_WEBHOOK_URL=${VITE_WEBHOOK_URL:-}" \
  "N8N_PUBLIC_WEBHOOK_URL=${N8N_PUBLIC_WEBHOOK_URL:-}" \
  "SITE_NAME=${SITE_NAME:-DatIQ}")
# Optional runtime knobs that exist on Netlify today and are read by the functions.
# Added ONLY when set in .env.<env>: an empty value is OMITTED so the code's own
# default applies (several read `Number(env.X)` or `env.X ?? default`, where an
# empty string is not "unset"). Parity audit: docs/plans/gcp-docker-migration/06 §7.
#   mail senders · audit/job budgets · kill switches · purge safety · invoice
#   supplier identity · ops alert recipients · host allow-list
for _opt in ALERT_EMAIL_FROM BILLING_EMAIL_FROM CONTACT_EMAIL_FROM EXPORT_EMAIL_FROM \
            FORM_EMAIL_FROM REPORT_EMAIL_FROM \
            AUDIT_BUDGET_MS AI_MAX_TOKENS WATCHLIST_BUDGET_MS WATCHLIST_NOW_BUDGET_MS \
            BULK_RUNNER_BUDGET_MS SIGNAL_RETRY_BUDGET_MS \
            DISABLE_AI_CITATION_SAMPLING DISABLE_AUDIT_AI DISABLE_PAGESPEED \
            PURGE_DRY_RUN PURGE_MAX_USERS_PER_RUN CREDITS_ENFORCEMENT_DISABLED \
            SUPPLIER_LEGAL_NAME SUPPLIER_TRADE_NAME SUPPLIER_GSTIN SUPPLIER_ADDRESS \
            SUPPLIER_STATE SUPPLIER_COUNTRY SUPPLIER_EMAIL SUPPLIER_PAN \
            PERPLEXITY_MODEL OPS_ALERT_EMAIL PERMITTED_HOSTS; do
  [ -n "${!_opt:-}" ] && APP_ENV_VARS+=("${_opt}=${!_opt}")
done
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
  local img="$1" attempt err=""
  # A tag pushed seconds ago can lag in Artifact Registry's index, and CI runs
  # deploy-run.sh immediately after Cloud Build — so retry before concluding
  # the image is missing. The old check threw gcloud's stderr away, so a CI
  # failure said "image not found" about an image that was in fact present
  # (2026-10-03, first gate-driven staging deploy) with no way to see why.
  # `images describe` ALSO calls Container Analysis (containeranalysis.occurrences.list),
  # which the CI service account does not (and should not) hold — it reported a
  # present image as missing (2026-10-03). `images list --include-tags` needs only
  # Artifact Registry read, which artifactregistry.writer already carries.
  # A digest ref (repo@sha256:…, what promote-prod.sh hands us) has no tag: the
  # old split on the last ':' turned it into repo "…@sha256" + tag "<hex>", which
  # can never match, so every digest promotion would fail here AFTER resolving.
  local repo tag filter found=""
  case "$img" in
    *@sha256:*) repo="${img%@*}"; tag="${img##*@}"; filter="version=${tag}" ;;
    *)          repo="${img%:*}"; tag="${img##*:}"; filter="tags:${tag}" ;;
  esac
  for attempt in 1 2 3 4 5; do
    if found="$(gcloud artifacts docker images list "$repo" --include-tags --filter="${filter}" --format='value(package)' --project="$GCP_PROJECT_ID" 2>"${TMPDIR:-/tmp}/require_image.err")" && [ -n "$found" ]; then
      return 0
    fi
    err="$(tail -3 "${TMPDIR:-/tmp}/require_image.err" 2>/dev/null)"
    [ "$attempt" = "5" ] || { echo "  … image not visible yet (attempt $attempt/5), retrying in 10s"; sleep 10; }
  done
  echo "✗ image not found: $img"
  echo "  gcloud said: $(printf '%s' "$err" | tail -3 | tr '\n' ' ' | cut -c1-400)"
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
      # /auth/v1 + /rest/v1 are proxied THROUGH this service (prefix strip —
      # see gen-firebase-config.mjs + deployment/adapter/server.mjs). Wired
      # only in cloud-sql mode; pre-cutover deploys are untouched. URLs come
      # from the services themselves (run_url), never hand-composed.
      api_env="$ENV_VARS_JSON"
      if [ "${DATA_MODE:-}" = "cloud-sql" ] && [ -n "${CLOUD_RUN_AUTH:-}" ] && [ -n "${CLOUD_RUN_REST:-}" ]; then
        auth_url="$(run_url "$CLOUD_RUN_AUTH" 2>/dev/null || true)"
        rest_url="$(run_url "$CLOUD_RUN_REST" 2>/dev/null || true)"
        if [ -n "$auth_url" ] && [ -n "$rest_url" ]; then
          api_env="$DEPLOY_DIR/generated/gcp/env-vars-$ENV_NAME-api.json"
          node -e '
            const fs = require("fs");
            const [base, out, ...kv] = process.argv.slice(1);
            const env = JSON.parse(fs.readFileSync(base, "utf8"));
            for (const item of kv) { const i = item.indexOf("="); env[item.slice(0, i)] = item.slice(i + 1); }
            fs.writeFileSync(out, JSON.stringify(env));
          ' "$ENV_VARS_JSON" "$api_env" "AUTH_PROXY_URL=$auth_url" "REST_PROXY_URL=$rest_url"
          echo "   (auth/rest proxied via this service: $auth_url , $rest_url)"
        else
          echo "   ⚠ DATA_MODE=cloud-sql but auth/rest URLs unresolved — proxy left UNWIRED"
        fi
      fi
      echo "→ Cloud Run ${CLOUD_RUN_API} (api — public, Netlify parity)"
      gcloud run deploy "$CLOUD_RUN_API" "${GCP_FLAGS[@]}" \
        --image="$IMG_API" --port=8080 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=4 --concurrency=80 \
        --memory=1Gi --cpu=1 --timeout=300 \
        --service-account="$SA_API_EMAIL" \
        --env-vars-file="$api_env" $API_SECRETS --quiet
      grant_run_invoker "$CLOUD_RUN_API" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      # The proxy's OIDC minting rides SA_API; grant it invoker on the targets
      # so a future switch to private services does not silently 403.
      if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
        if [ -n "${CLOUD_RUN_AUTH:-}" ]; then grant_run_invoker "$CLOUD_RUN_AUTH" "serviceAccount:${SA_API_EMAIL}" >/dev/null 2>&1 || true; fi
        if [ -n "${CLOUD_RUN_REST:-}" ]; then grant_run_invoker "$CLOUD_RUN_REST" "serviceAccount:${SA_API_EMAIL}" >/dev/null 2>&1 || true; fi
      fi
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
      # --allow-unauthenticated: Netlify/Hosted-Supabase parity, the same rule
      # api/admin/trackers follow. /auth/v1 is a PUBLIC signup/login surface by
      # design (the hosted Supabase endpoint it replaces is public too) and the
      # Firebase-Hosting edge did not carry the run.invoker identity through to
      # this service — the documented service-<num>@gcp-sa-firebase grant was
      # applied and still answered 403 after propagation (2026-10-01). GoTrue
      # enforces auth itself; the IAM wall must not be the gate a user's first
      # sign-in dies on.
      # ── Social sign-in (Google / Microsoft / GitHub) ─────────────────────────
      # Self-hosted GoTrue takes providers from env vars only (Studio's
      # Auth → Providers panel is read-only here). Per provider, in .env.<env>:
      #   GOTRUE_EXTERNAL_<P>_ENABLED=true  GOTRUE_EXTERNAL_<P>_CLIENT_ID=…
      # and the client SECRET in Secret Manager (bootstrap-secrets.sh pushes it
      # from <P>_OAUTH_CLIENT_SECRET). A provider is wired ONLY when enabled, so
      # a half-configured one can never break auth for everyone. The callback is
      # always ${APP_BASE_URL}/auth/v1/callback (APP_BASE_URL from .env.<env>) —
      # register exactly that in the provider console. APP_BASE_URL must be the
      # host users actually sign in on, or the provider answers redirect_uri_mismatch.
      OAUTH_CB="${APP_BASE_URL%/}"
      OAUTH_ENV=""; OAUTH_SECRETS=""
      for spec in GOOGLE:google AZURE:azure GITHUB:github; do
        P="${spec%%:*}"; sm_key="${spec#*:}"
        en_var="GOTRUE_EXTERNAL_${P}_ENABLED"; id_var="GOTRUE_EXTERNAL_${P}_CLIENT_ID"
        if [ "${!en_var:-false}" != "true" ]; then
          echo "  · oauth ${sm_key}: disabled"; continue
        fi
        [ -n "${!id_var:-}" ] || { echo "✗ ${en_var}=true but ${id_var} is empty in .env.$ENV_NAME"; exit 1; }
        sec="$(sm_name "${P}_OAUTH_CLIENT_SECRET")"
        gcloud secrets describe "$sec" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 \
          || { echo "✗ ${en_var}=true but secret ${sec} does not exist — set ${P}_OAUTH_CLIENT_SECRET in .env.$ENV_NAME and run bootstrap-secrets.sh $ENV_NAME"; exit 1; }
        OAUTH_ENV="${OAUTH_ENV};${en_var}=true;${id_var}=${!id_var};GOTRUE_EXTERNAL_${P}_REDIRECT_URI=${OAUTH_CB}/auth/v1/callback"
        [ "$P" = "AZURE" ] && OAUTH_ENV="${OAUTH_ENV};GOTRUE_EXTERNAL_AZURE_URL=${GOTRUE_EXTERNAL_AZURE_URL:-https://login.microsoftonline.com/common}"
        OAUTH_SECRETS="${OAUTH_SECRETS},GOTRUE_EXTERNAL_${P}_SECRET=${sec}:latest"
        echo "  ✓ oauth ${sm_key}: enabled (callback ${OAUTH_CB}/auth/v1/callback)"
      done
      # ── Transactional email (signup confirm / recovery / magic link / email change) ─
      # Hosted Supabase sent these itself; self-hosted GoTrue has NO mail service and
      # only sends when GOTRUE_SMTP_* is set (Resend SMTP: smtp.resend.com:465, user
      # "resend", password = a Resend API key). The password is a Secret Manager
      # secret (bootstrap-secrets.sh pushes it from GOTRUE_SMTP_PASS, falling back
      # to RESEND_API_KEY). With no SMTP, only autoconfirm keeps signup working —
      # so AUTOCONFIRM=false without SMTP is refused here: it would deploy an auth
      # service where every email signup and password reset 500s.
      SMTP_ENV=""; SMTP_SECRETS=""
      if [ -n "${GOTRUE_SMTP_HOST:-}" ]; then
        for v in GOTRUE_SMTP_PORT GOTRUE_SMTP_USER GOTRUE_SMTP_ADMIN_EMAIL; do
          [ -n "${!v:-}" ] || { echo "✗ GOTRUE_SMTP_HOST is set but ${v} is empty in .env.$ENV_NAME"; exit 1; }
        done
        smtp_sec="$(sm_name GOTRUE_SMTP_PASS)"
        gcloud secrets describe "$smtp_sec" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 \
          || { echo "✗ GOTRUE_SMTP_HOST is set but secret ${smtp_sec} does not exist — set GOTRUE_SMTP_PASS (or RESEND_API_KEY) in .env.$ENV_NAME and run bootstrap-secrets.sh $ENV_NAME"; exit 1; }
        SMTP_ENV=";GOTRUE_SMTP_HOST=${GOTRUE_SMTP_HOST};GOTRUE_SMTP_PORT=${GOTRUE_SMTP_PORT};GOTRUE_SMTP_USER=${GOTRUE_SMTP_USER};GOTRUE_SMTP_ADMIN_EMAIL=${GOTRUE_SMTP_ADMIN_EMAIL};GOTRUE_SMTP_SENDER_NAME=${GOTRUE_SMTP_SENDER_NAME:-DatIQ}"
        SMTP_SECRETS=",GOTRUE_SMTP_PASS=${smtp_sec}:latest"
        echo "  ✓ smtp: ${GOTRUE_SMTP_HOST}:${GOTRUE_SMTP_PORT} as ${GOTRUE_SMTP_ADMIN_EMAIL}"
      elif [ "${GOTRUE_MAILER_AUTOCONFIRM:-false}" != "true" ]; then
        echo "✗ GOTRUE_MAILER_AUTOCONFIRM is not true and GOTRUE_SMTP_HOST is empty in .env.$ENV_NAME —"
        echo "  GoTrue could not send any confirmation/recovery email. Set the GOTRUE_SMTP_* block."
        exit 1
      else
        echo "  · smtp: not configured (autoconfirm=true — signups confirm instantly, no email is sent)"
      fi
      gcloud run deploy "$CLOUD_RUN_AUTH" "${GCP_FLAGS[@]}" \
        --image="${AUTH_IMAGE:?AUTH_IMAGE missing in .env}" --port=8080 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=512Mi --cpu=1 --timeout=60 --service-account="$SA_JOBS_EMAIL" \
        --add-cloudsql-instances="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE:?SQL_INSTANCE missing}" \
        --set-env-vars="^;^GOTRUE_DB_DRIVER=postgres;GOTRUE_DB_NAMESPACE=auth;GOTRUE_API_HOST=0.0.0.0;GOTRUE_API_PORT=8080;API_EXTERNAL_URL=${APP_BASE_URL};GOTRUE_SITE_URL=${APP_BASE_URL};GOTRUE_JWT_EXP=3600;GOTRUE_JWT_AUD=authenticated;GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated;GOTRUE_DISABLE_SIGNUP=false;GOTRUE_EXTERNAL_EMAIL_ENABLED=true;GOTRUE_MAILER_AUTOCONFIRM=${GOTRUE_MAILER_AUTOCONFIRM:-false};GOTRUE_LOG_LEVEL=warn;GOTRUE_URI_ALLOW_LIST=${GOTRUE_URI_ALLOW_LIST:-}${OAUTH_ENV}${SMTP_ENV}" \
        --set-secrets="GOTRUE_DB_DATABASE_URL=$(sm_name GOTRUE_DB_DATABASE_URL):latest,GOTRUE_JWT_SECRET=$(sm_name JWT_SECRET):latest${OAUTH_SECRETS}${SMTP_SECRETS}" --quiet
      # Kept for a future switch back to a private service; moot while allUsers
      # can invoke (the --allow-unauthenticated above).
      grant_run_invoker "$CLOUD_RUN_AUTH" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    rest)
      require_vars CLOUD_RUN_REST REST_IMAGE
      echo "→ Cloud Run ${CLOUD_RUN_REST} (PostgREST proof service → staging Cloud SQL)"
      # Public for the same reason as auth — PostgREST is the hosted-REST
      # replacement and enforces authorization via JWT + RLS, exactly as
      # hosted Supabase does.
      gcloud run deploy "$CLOUD_RUN_REST" "${GCP_FLAGS[@]}" \
        --image="${REST_IMAGE:?REST_IMAGE missing in .env}" --port=3000 --allow-unauthenticated \
        --ingress=all --min-instances=0 --max-instances=2 --concurrency=80 \
        --memory=512Mi --cpu=1 --timeout=60 --service-account="$SA_JOBS_EMAIL" \
        --add-cloudsql-instances="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE:?SQL_INSTANCE missing}" \
        --env-vars-file="$REST_ENV_JSON" \
        --set-secrets="PGRST_DB_URI=$(sm_name PGRST_DB_URI):latest,PGRST_JWT_SECRET=$(sm_name JWT_SECRET):latest" --quiet
      # Same edge as auth (kept for completeness — see the note there).
      grant_run_invoker "$CLOUD_RUN_REST" "serviceAccount:${FIREBASE_RUN_INVOKER_SA}" "serviceAccount:${SA_DEPLOY_EMAIL}"
      ;;
    studio)
      require_vars CLOUD_RUN_STUDIO SQL_INSTANCE
      # Pre-cutover prod has no Cloud SQL instance yet (created at the cutover /
      # `up.sh prod --with-db`). Deploying Studio then would fail the WHOLE
      # deploy on --add-cloudsql-instances and leave a pg-meta pointed at
      # nothing. Skip cleanly instead — Studio is a post-cutover surface.
      if ! gcloud sql instances describe "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
        echo "SKIP studio: Cloud SQL ${SQL_INSTANCE} does not exist yet (pre-cutover) — Studio deploys with the DB"
        continue
      fi
      # ── WHAT THIS WIRES (both containers ride the SAME Cloud SQL socket) ────
      # pg-meta  → Cloud SQL via the PG_META_DB_URL secret (full unix-socket
      #            URI, refreshed by migrate-db.sh: postgres@/${DB_NAME}
      #            ?host=/cloudsql/<conn>); it answers Studio's metadata +
      #            SQL-editor calls on localhost:8080.
      # Studio   → pg-meta on 127.0.0.1:8080; its auth/REST links use
      #            ${SUPABASE_URL}, which the CUTOVER ITSELF flips from the
      #            hosted project URL to the self-hosted origin (APP_BASE_URL
      #            + /auth/v1,/rest/v1 rewrites → api proxy → GoTrue/PostgREST).
      #            AUTH_JWT_SECRET is the same JWT secret GoTrue verifies with.
      #            So the same deploy is correct pre-cutover (hosted project)
      #            AND post-cutover (self-hosted trio) with no code change.
      # Access    → private service (`--no-allow-unauthenticated`); operator
      #            entry is `proxy-studio.sh <env>` (gcloud run services proxy).
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
          --set-env-vars="STUDIO_PG_META_URL=http://127.0.0.1:8080,SUPABASE_URL=${STUDIO_SUPABASE_URL:-$SUPABASE_URL},SUPABASE_PUBLIC_URL=${STUDIO_SUPABASE_URL:-$SUPABASE_URL},AUTH_JWT_SECRET=${JWT_SECRET:-},SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
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
