#!/usr/bin/env bash
# deployment/scripts/gcp/cutover-db.sh — the cutover-window DB migration
# (doc 05 §3d steps 1–5). DANGEROUS BY DESIGN: pauses crons, dumps the
# production Supabase, restores it into the production Cloud SQL, repoints the
# GoTrue/PostgREST/API services. DO NOT RUN outside the announced window.
#
#   cutover-db.sh prod SOURCE_DB_URL
#
# Prerequisites (operator, doc 05 §3d step 6 + impact doc §6):
#   - SOURCE_DB_URL = prod Supabase connection string (session pooler or direct)
#   - JWT_SECRET in .env.prod = the PROD Supabase JWT secret (same secret keeps
#     sessions valid across the flip)
#   - external webhook/redirect updates rehearsed (Stripe/Razorpay/Resend/n8n/OAuth)
# Rollback: DNS revert (Netlify + hosted Supabase stay intact through the window).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: cutover-db.sh prod SOURCE_DB_URL}"
[ "$ENV_NAME" = "prod" ] || { echo "✗ cutover runs against prod only"; exit 1; }
load_gcp_env "$ENV_NAME"
SOURCE_DB_URL="${2:?usage: cutover-db.sh prod SOURCE_DB_URL}"
require_vars JWT_SECRET SQL_INSTANCE CLOUD_RUN_AUTH CLOUD_RUN_REST CLOUD_RUN_API

echo "── 1/5 FREEZE: pause write-heavy crons (Scheduler jobs disabled; Netlify TOML"
echo "   schedules must ALREADY be commented — never both, doc 05 §3b)"
gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
  --filter="targetId~${CLOUD_RUN_JOBS}" --format="value(name)" | while read -r j; do
  gcloud scheduler jobs pause "${j##*/}" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet
done

echo "── 2/5 DUMP + RESTORE prod Supabase → ${SQL_INSTANCE}"
"$HERE/migrate-db.sh" "$ENV_NAME" "$SOURCE_DB_URL"

echo "── 3/5 REPOINT auth + rest at production Cloud SQL (same JWT secret —"
echo "   existing sessions stay valid; smoke auth immediately)"
"$HERE/deploy-run.sh" "$ENV_NAME" auth rest

echo "── 4/5 REPOINT api/jobs env to the self-hosted trio. api/jobs read"
echo "   SUPABASE_URL as a plain env var from the env file (deploy-run.sh) —"
echo "   NOT from a secret — so the repoint is: DATA_MODE=cloud-sql and"
echo "   SUPABASE_URL=<app base> persisted into .env.prod, then redeploy api/jobs"
echo "   (their Supabase calls now flow through the /rest/v1 Hosting rewrites)"
echo "   and Hosting (gen-firebase-config emits /auth/v1+/rest/v1 rewrites only"
echo "   in cloud-sql mode)."
update_env() { # update_env KEY VALUE — replace/add a line in deployment/env/.env.<env>
  local k="$1" v="$2" tmp touched=0 line
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "${k}="*) printf '%s=%s\n' "$k" "$v"; touched=1;; *) printf '%s\n' "$line";; esac
  done < "$DEPLOY_DIR/env/.env.$ENV_NAME" > "$tmp"
  [ "$touched" = "1" ] || printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$DEPLOY_DIR/env/.env.$ENV_NAME"
}
update_env DATA_MODE cloud-sql
update_env SUPABASE_URL "$APP_BASE_URL"
"$HERE/deploy-run.sh" "$ENV_NAME" api jobs
"$HERE/deploy-hosting.sh" "$ENV_NAME"

echo "── 5/5 POST-FLIP SMOKE (payments test event + n8n round-trip are MANUAL —"
echo "   see docs/plans/gcp-docker-migration/09-CUTOVER-RUNBOOK.md)"
"$HERE/smoke.sh" "$ENV_NAME"
echo
echo "✓ cutover steps 1–5 done. Next (manual): DNS flip → Firebase Hosting, then"
echo "  external-party updates, then keep Netlify deployed for the rollback window."
