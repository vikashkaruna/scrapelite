#!/usr/bin/env bash
# deployment/scripts/gcp/bootstrap.sh — one-time project bootstrap (idempotent).
# Enables APIs, creates the Artifact Registry repo, service accounts + bindings,
# the artifacts bucket, the Firebase Hosting site and web app, and the App Engine
# app Cloud Scheduler needs. Every name/value comes from .env.<env> (doc 06).
#
#   bootstrap.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
load_gcp_env "${1:?usage: bootstrap.sh <staging|prod>}"
require_vars GCP_BILLING_ACCOUNT_ID FB_WEB_APP_DISPLAY

have gcloud || { echo "✗ gcloud not installed"; exit 1; }
gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q . || { echo "✗ not authenticated — run: gcloud auth login"; exit 1; }

echo "→ APIs (idempotent)"
ensure_apis \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com appengine.googleapis.com \
  iamcredentials.googleapis.com servicemanagement.googleapis.com serviceusage.googleapis.com

echo "→ Artifact Registry ${AR_REPO}"
gcloud artifacts repositories describe "$AR_REPO" --project="$GCP_PROJECT_ID" \
  --location="$GCP_REGION" --format="value(name)" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$AR_REPO" --project="$GCP_PROJECT_ID" \
    --location="$GCP_REGION" --repository-format=docker \
    --description="DatIQ ${DATIQ_ENV} images" --quiet

echo "→ Cloud Build can push images"
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${CLOUD_BUILD_SA}" --role=roles/artifactregistry.writer --quiet >/dev/null

echo "→ Service accounts"
for sa in "$SA_DEPLOY" "$SA_API" "$SA_JOBS" "$SA_SCHEDULER"; do
  gcloud iam service-accounts describe "${sa}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --project="$GCP_PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$sa" --project="$GCP_PROJECT_ID" \
    --display-name="DatIQ-${DATIQ_PROJECT_CODE}-${sa}-${DATIQ_ENV_SUFFIX#-}" --quiet
done

echo "→ Runtime/deploy role bindings"
bind() { gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="$1" --role="$2" --quiet >/dev/null; }
for sa_email in "$SA_API_EMAIL" "$SA_JOBS_EMAIL"; do
  bind "serviceAccount:${sa_email}" roles/secretmanager.secretAccessor
done
# The deploy identity reads ADMIN_TOKEN_SECRET during smoke (authed-pong check)
# — without this the check silently degrades to a skip for CI.
bind "serviceAccount:${SA_DEPLOY_EMAIL}" roles/secretmanager.secretAccessor
bind "serviceAccount:${SA_SCHEDULER_EMAIL}" roles/cloudscheduler.jobRunner
bind "serviceAccount:${SA_SCHEDULER_EMAIL}" roles/iam.serviceAccountTokenCreator
bind "serviceAccount:${SA_DEPLOY_EMAIL}" roles/run.admin
bind "serviceAccount:${SA_DEPLOY_EMAIL}" roles/artifactregistry.writer
bind "serviceAccount:${SA_DEPLOY_EMAIL}" roles/firebasehosting.admin
bind "serviceAccount:${SA_DEPLOY_EMAIL}" roles/iam.serviceAccountUser

echo "→ App Engine app (Cloud Scheduler prerequisite, idempotent)"
if ! gcloud app describe --project="$GCP_PROJECT_ID" --format="value(id)" >/dev/null 2>&1; then
  gcloud app create --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --quiet
fi

echo "→ Firebase web app + Hosting site"
# firebase CLI must be authenticated: `firebase login` (or use --token in CI).
if have firebase; then
  firebase apps:list --project="$GCP_PROJECT_ID" 2>/dev/null | grep -qF "$FB_WEB_APP_DISPLAY" || \
    firebase apps:create --project="$GCP_PROJECT_ID" web "$FB_WEB_APP_DISPLAY" >/dev/null
  firebase hosting:sites:list --project="$GCP_PROJECT_ID" 2>/dev/null | grep -qF "$FHS_SITE_ID" || \
    firebase hosting:sites:create "$FHS_SITE_ID" --project="$GCP_PROJECT_ID"
else
  echo "  (firebase CLI not found — run: firebase hosting:sites:create ${FHS_SITE_ID} --project ${GCP_PROJECT_ID})"
fi

echo "→ Artifacts bucket ${ARTIFACTS_BUCKET:-skip}"
if [ -n "${ARTIFACTS_BUCKET:-}" ]; then
  gcloud storage buckets describe "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 || \
    gcloud storage buckets create "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" \
      --location="$GCP_REGION" --uniform-bucket-level-access --quiet
fi

echo "✓ bootstrap complete for ${GCP_PROJECT_ID} (${DATIQ_ENV})"
