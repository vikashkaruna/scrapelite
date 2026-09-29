#!/usr/bin/env bash
# deployment/scripts/gcp/deploy-scheduler.sh — create/update the 13 Cloud
# Scheduler jobs (1:1 with netlify.toml, doc 05 §3c), each POSTing to the jobs
# service with an OIDC ID token (SA_SCHEDULER) + the adapter's cron token.
#
#   deploy-scheduler.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: deploy-scheduler.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"
require_vars CLOUD_RUN_JOBS SA_SCHEDULER_EMAIL JOBS_TOKEN

node "$DEPLOY_DIR/scripts/gen-scheduler-jobs.mjs" \
  --toml "$REPO_DIR/netlify.toml" \
  --out  "$DEPLOY_DIR/generated/gcp/scheduler.json"

JOBS_URL="$(run_url "$CLOUD_RUN_JOBS")"
[ -n "$JOBS_URL" ] || { echo "✗ jobs service ${CLOUD_RUN_JOBS} has no URL — deploy it first"; exit 1; }

created=0
while IFS='|' read -r name cron; do
  [ -n "$name" ] || continue
  job_id="datiq-${DATIQ_PROJECT_CODE}-sch-${name}-${SM_ENV_SUFFIX}"
  target="${JOBS_URL}/run/${name}"
  echo "→ scheduler ${job_id} (${cron} → ${target})"
  if gcloud scheduler jobs describe "$job_id" --location="$GCP_REGION" \
      --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$job_id" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
      --schedule="$cron" --uri="$target" --http-method=POST \
      --oidc-service-account-email="$SA_SCHEDULER_EMAIL" \
      --oidc-token-audience="$JOBS_URL" \
      --headers="x-datiq-cron-token=${JOBS_TOKEN}" \
      --time-zone="Etc/UTC" --quiet >/dev/null
  else
    gcloud scheduler jobs create http "$job_id" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
      --schedule="$cron" --uri="$target" --http-method=POST \
      --oidc-service-account-email="$SA_SCHEDULER_EMAIL" \
      --oidc-token-audience="$JOBS_URL" \
      --headers="x-datiq-cron-token=${JOBS_TOKEN}" \
      --time-zone="Etc/UTC" --quiet >/dev/null
  fi
  created=$((created+1))
done < <(node -e '
  const { jobs } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const j of jobs) console.log(`${j.name}|${j.cron}`);
' "$DEPLOY_DIR/generated/gcp/scheduler.json")

echo "✓ scheduler: ${created} jobs → ${CLOUD_RUN_JOBS}"
echo "  ⚠ cron ownership: Netlify still owns schedules while OPS_JOBS_DISABLED=1"
echo "    on this service (parallel-run rule, doc 05 §3b). Flip deliberately."
