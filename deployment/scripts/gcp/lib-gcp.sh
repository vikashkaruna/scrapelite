#!/usr/bin/env bash
# deployment/scripts/gcp/lib-gcp.sh — shared helpers for every GCP deploy script.
# Same contract as the local scripts: the .env.<env> file is the single source
# of truth (doc 06). No resource names, regions or project ids below — only
# derived names composed from env values.

set -euo pipefail

GCP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$GCP_LIB_DIR/../lib/env-loader.sh"

# load_gcp_env <staging|prod> — load the env file, then fail fast on everything
# the GCP scripts need, then derive the composed names other scripts reference.
load_gcp_env() {
  load_env "${1:?usage: load_gcp_env <staging|prod>}"
  require_vars \
    GCP_PROJECT_ID GCP_REGION DATIQ_PROJECT_CODE DATIQ_ENV_SUFFIX \
    CLOUD_RUN_API CLOUD_RUN_JOBS CLOUD_RUN_ADMIN CLOUD_RUN_TRACKERS \
    AR_REPO SA_DEPLOY SA_API SA_JOBS SA_SCHEDULER FHS_SITE_ID \
    APP_BASE_URL DATA_MODE APP_CONTEXT GIT_BRANCH

  export DATIQ_ENV_SUFFIX="${DATIQ_ENV_SUFFIX:--stg}"
  local img_tag="${IMG_TAG:-}"
  if [ -z "$img_tag" ] || [ "$img_tag" = "REPLACE_ME_git_sha" ]; then
    img_tag="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
    export IMG_TAG="$img_tag"
  fi
  # Derived names are ALWAYS recomposed here (never trusted from the env file,
  # where ${IMG_TAG} may have been empty at source time).
  export IMG_BASE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}"
  export IMG_API="${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-api:${IMG_TAG}"
  export IMG_ADMIN="${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-admin:${IMG_TAG}"
  export IMG_TRACKERS="${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-trackers:${IMG_TAG}"
  export IMG_STUDIO="${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-studio:staged"
  export IMG_PG_META="${IMG_BASE}/datiq-${DATIQ_PROJECT_CODE}-ctr-pg-meta:staged"
  export SA_API_EMAIL="${SA_API_EMAIL:-${SA_API}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"
  export SA_JOBS_EMAIL="${SA_JOBS_EMAIL:-${SA_JOBS}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"
  export SA_SCHEDULER_EMAIL="${SA_SCHEDULER_EMAIL:-${SA_SCHEDULER}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"
  export SA_DEPLOY_EMAIL="${SA_DEPLOY_EMAIL:-${SA_DEPLOY}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"
  # The Firebase Hosting service agent that invokes Cloud Run on behalf of
  # rewrites (project-number derived — never a literal).
  local project_number
  project_number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
  export FIREBASE_RUN_INVOKER_SA="service-${project_number}@gcp-sa-firebase.iam.gserviceaccount.com"
  export CLOUD_BUILD_SA="${project_number}@cloudbuild.gserviceaccount.com"
  # Secret resource names follow doc 06: datiq-<code>-sm-<lowercased-key-dashed>-<suffix>
  export SM_PREFIX="datiq-${DATIQ_PROJECT_CODE}-sm-"
  export SM_ENV_SUFFIX="${DATIQ_ENV_SUFFIX#-}"
  # NOTE: bash-3.2 safe (no ${var,,}) and NOT exported — bash 3.2 destroys an
  # array on export, and the env loader runs everything in one shell anyway.
  sm_name() { # sm_name <RUNTIME_VAR> → datiq-<code>-sm-<key-dashed>-<suffix>
    local lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    printf '%s%s-%s' "$SM_PREFIX" "$(printf '%s' "$lower" | tr '_' '-')" "$SM_ENV_SUFFIX"
  }
  GCP_FLAGS=(--project "$GCP_PROJECT_ID" --region "$GCP_REGION")
  # Some surfaces (services.enable, IAM bindings) are project-scoped only.
  GCP_PROJECT_ONLY=(--project "$GCP_PROJECT_ID")
  echo "▸ env=$1 project=$GCP_PROJECT_ID region=$GCP_REGION image-tag=$IMG_TAG"
}

have() { command -v "$1" >/dev/null 2>&1; }

gen_token() { node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))"; }

# ensure_apis <api...> — idempotent enable.
ensure_apis() {
  local missing=() api
  for api in "$@"; do
    gcloud services list --enabled "${GCP_PROJECT_ONLY[@]}" --filter="config.name=$api" --format="value(config.name)" 2>/dev/null | grep -q . || missing+=("$api")
  done
  [ ${#missing[@]} -eq 0 ] || gcloud services enable "${missing[@]}" "${GCP_PROJECT_ONLY[@]}"
}

# grant_run_invoker <service> <member...> — let a caller invoke a Cloud Run service.
grant_run_invoker() {
  local svc="$1"; shift
  local member
  for member in "$@"; do
    gcloud run services add-iam-policy-binding "$svc" "${GCP_FLAGS[@]}" \
      --member="$member" --role=roles/run.invoker --quiet
  done
}

# wait_for_run_url <service> — print the service's https URL.
run_url() {
  gcloud run services describe "$1" "${GCP_FLAGS[@]}" --format='value(status.url)'
}
