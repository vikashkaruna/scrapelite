#!/usr/bin/env bash
# deployment/scripts/gcp/down.sh — tear down an environment's ENTIRE GCP stack.
# THE DESTRUCTIVE COUNTERPART OF up.sh. Reads the same .env.<env> contract.
#
#   down.sh staging --yes                       # full staging teardown
#   down.sh staging                             # prints the plan, refuses without --yes
#   down.sh prod --yes --delete-data            # FULL prod teardown INCLUDING Cloud SQL
#   down.sh prod --yes                          # prod teardown, Cloud SQL PRESERVED
#
# PROD GUARDRAILS (all required, by design — this must not survive an accident):
#   1. The env name "prod" must be typed explicitly (no default, no alias).
#   2. ALLOW_PROD_TEARDOWN=1 must be exported in the calling shell.
#   3. --yes must be passed.
#   4. The GCP PROJECT ID must be typed to confirm (or DOWN_CONFIRM_PROJECT
#      must match it for scripted runs).
#   5. Cloud SQL (the database, users, all rows) is only deleted with
#      --delete-data — the default prod down KEEPS the database.
#   6. An 8-second abortable countdown runs before the first destructive call.
#
# Order is reverse-dependency: scheduler → Cloud Run → secrets → registry →
# bucket → hosting site → service accounts → (Cloud SQL with --delete-data).
# The App Engine app (Scheduler requirement) can only be removed by deleting
# the whole project — it is left in place and reported.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:-}"
shift || true

YES=0; DELETE_DATA=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --delete-data) DELETE_DATA=1 ;;
    *) echo "✗ unknown flag: $arg (--yes, --delete-data)"; exit 1 ;;
  esac
done

[ "$ENV_NAME" = "staging" ] || [ "$ENV_NAME" = "prod" ] || {
  echo "✗ env name must be typed explicitly: down.sh <staging|prod> [--yes] [--delete-data]"; exit 1; }

# ── guardrails ────────────────────────────────────────────────────────────────
if [ "$ENV_NAME" = "prod" ]; then
  [ "${ALLOW_PROD_TEARDOWN:-0}" = "1" ] || {
    echo "✗ prod teardown refused: export ALLOW_PROD_TEARDOWN=1 to acknowledge this is intentional."
    echo "  (Unintentional runs must fail here, not after the resources are gone.)"; exit 1; }
  [ "$YES" = "1" ] || { echo "✗ prod teardown refused: pass --yes after reviewing the plan (run without --yes to print it)."; exit 1; }
fi

load_gcp_env "$ENV_NAME"

if [ "$ENV_NAME" = "prod" ]; then
  printf "Type the GCP project id to tear down (%s): " "$GCP_PROJECT_ID"
  if [ -t 0 ]; then
    read -r typed
  else
    typed="${DOWN_CONFIRM_PROJECT:-}"
    echo "$typed (from DOWN_CONFIRM_PROJECT)"
  fi
  [ "$typed" = "$GCP_PROJECT_ID" ] || { echo "✗ project id does not match — aborting."; exit 1; }
else
  [ "$YES" = "1" ] || { echo "→ this would tear down the WHOLE ${ENV_NAME} stack (scheduler, Cloud Run,"
                        echo "  secrets, image registry, artifacts bucket, hosting site, service accounts)."
                        echo "  Re-run with --yes to execute."; exit 0; }
fi

have gcloud || { echo "✗ gcloud not installed"; exit 1; }

# ── plan ──────────────────────────────────────────────────────────────────────
svc_names="$CLOUD_RUN_API $CLOUD_RUN_JOBS $CLOUD_RUN_ADMIN $CLOUD_RUN_TRACKERS"
[ -n "${CLOUD_RUN_AUTH:-}" ]    && svc_names="$svc_names $CLOUD_RUN_AUTH"
[ -n "${CLOUD_RUN_REST:-}" ]    && svc_names="$svc_names $CLOUD_RUN_REST"
[ -n "${CLOUD_RUN_STUDIO:-}" ]  && svc_names="$svc_names $CLOUD_RUN_STUDIO"

echo "┌ teardown plan — env=$ENV_NAME project=$GCP_PROJECT_ID region=$GCP_REGION"
echo "│  scheduler jobs   : datiq-${DATIQ_PROJECT_CODE}-sch-*"
echo "│  cloud run        :$svc_names"
echo "│  secrets          : datiq-${DATIQ_PROJECT_CODE}-sm-*"
echo "│  artifact registry: ${AR_REPO} (all images)"
echo "│  artifacts bucket : gs://${ARTIFACTS_BUCKET}"
echo "│  hosting site     : ${FHS_SITE_ID}.web.app"
echo "│  service accounts : ${SA_DEPLOY} ${SA_API} ${SA_JOBS} ${SA_SCHEDULER}"
if [ "$DELETE_DATA" = "1" ]; then
  echo "│  ⚠ cloud sql      : ${SQL_INSTANCE:-<unset>} — DATABASE AND ALL DATA DELETED (--delete-data)"
else
  echo "│  cloud sql        : ${SQL_INSTANCE:-<unset>} PRESERVED (pass --delete-data to delete)"
fi
echo "│  app engine app   : NOT deletable without the project — left in place"
echo "└"

if [ "$ENV_NAME" = "prod" ]; then
  echo "Starting in 8s — Ctrl+C to abort."
  sleep 8
fi

deleted=0; absent=0

# ── 1. scheduler ──────────────────────────────────────────────────────────────
echo "→ scheduler jobs"
while IFS= read -r job; do
  [ -n "$job" ] || continue
  job="${job##*/}"
  gcloud scheduler jobs delete "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet >/dev/null && {
    echo "  ✓ deleted $job"; deleted=$((deleted+1)); }
done < <(gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
  --filter="name:datiq-${DATIQ_PROJECT_CODE}-sch-" --format='value(name)' 2>/dev/null || true)

# ── 2. cloud run ──────────────────────────────────────────────────────────────
for svc in $svc_names; do
  [ -n "$svc" ] || continue
  echo "→ cloud run $svc"
  if gcloud run services describe "$svc" "${GCP_FLAGS[@]}" >/dev/null 2>&1; then
    gcloud run services delete "$svc" "${GCP_FLAGS[@]}" --quiet >/dev/null
    echo "  ✓ deleted"; deleted=$((deleted+1))
  else
    echo "  (absent)"; absent=$((absent+1))
  fi
done

# ── 3. secrets ────────────────────────────────────────────────────────────────
echo "→ secrets datiq-${DATIQ_PROJECT_CODE}-sm-*"
while IFS= read -r secret; do
  [ -n "$secret" ] || continue
  gcloud secrets delete "$secret" --project="$GCP_PROJECT_ID" --quiet >/dev/null 2>&1 && {
    echo "  ✓ deleted $secret"; deleted=$((deleted+1)); }
done < <(gcloud secrets list --project="$GCP_PROJECT_ID" \
  --filter="name:datiq-${DATIQ_PROJECT_CODE}-sm-" --format='value(name)' 2>/dev/null | sed 's|.*/||' || true)

# ── 4. artifact registry ──────────────────────────────────────────────────────
echo "→ artifact registry ${AR_REPO}"
if gcloud artifacts repositories describe "$AR_REPO" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories delete "$AR_REPO" --project="$GCP_PROJECT_ID" \
    --location="$GCP_REGION" --quiet >/dev/null
  echo "  ✓ deleted (all images)"; deleted=$((deleted+1))
else
  echo "  (absent)"; absent=$((absent+1))
fi

# ── 5. artifacts bucket ───────────────────────────────────────────────────────
echo "→ bucket gs://${ARTIFACTS_BUCKET}"
if gcloud storage buckets describe "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage rm -r "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" --quiet >/dev/null
  echo "  ✓ deleted"; deleted=$((deleted+1))
else
  echo "  (absent)"; absent=$((absent+1))
fi

# ── 6. hosting site (needs the firebase CLI; a missing CLI leaves the site) ──
echo "→ hosting site ${FHS_SITE_ID}"
if have firebase; then
  if firebase hosting:sites:list --project="$GCP_PROJECT_ID" 2>/dev/null | grep -qF "$FHS_SITE_ID"; then
    firebase hosting:sites:delete "$FHS_SITE_ID" --project="$GCP_PROJECT_ID" --force >/dev/null 2>&1 \
      && { echo "  ✓ deleted"; deleted=$((deleted+1)); } \
      || echo "  ⚠ could not delete (check firebase login) — site left in place"
  else
    echo "  (absent)"; absent=$((absent+1))
  fi
else
  echo "  ⚠ firebase CLI not installed — site left in place (delete: firebase hosting:sites:delete $FHS_SITE_ID)"
fi

# ── 7. service accounts ───────────────────────────────────────────────────────
for sa in "$SA_DEPLOY_EMAIL" "$SA_API_EMAIL" "$SA_JOBS_EMAIL" "$SA_SCHEDULER_EMAIL"; do
  echo "→ service account $sa"
  if gcloud iam service-accounts describe "$sa" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts delete "$sa" --project="$GCP_PROJECT_ID" --quiet >/dev/null
    echo "  ✓ deleted"; deleted=$((deleted+1))
  else
    echo "  (absent)"; absent=$((absent+1))
  fi
done

# ── 8. cloud sql (only with --delete-data) ───────────────────────────────────
if [ "$DELETE_DATA" = "1" ]; then
  echo "→ cloud sql ${SQL_INSTANCE} — DELETING DATABASE AND ALL DATA"
  if [ "$ENV_NAME" = "prod" ]; then
    printf "Type the Cloud SQL instance name to confirm data deletion (%s): " "$SQL_INSTANCE"
    if [ -t 0 ]; then read -r typed_sql; else typed_sql="${DOWN_CONFIRM_SQL:-}"; echo "$typed_sql (from DOWN_CONFIRM_SQL)"; fi
    [ "$typed_sql" = "$SQL_INSTANCE" ] || { echo "✗ instance name does not match — Cloud SQL left in place."; exit 1; }
  fi
  if gcloud sql instances describe "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud sql instances delete "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --quiet >/dev/null
    echo "  ✓ deleted"; deleted=$((deleted+1))
  else
    echo "  (absent)"; absent=$((absent+1))
  fi
fi

echo
echo "✓ ${ENV_NAME} stack down: ${deleted} deleted, ${absent} already absent."
echo "  NOT removed (project-level): enabled APIs, the App Engine app, IAM bindings"
echo "  for the deleted accounts (they die with the accounts), and the PROJECT itself."
