#!/usr/bin/env bash
# deployment/scripts/gcp/down.sh — tear down an environment's ENTIRE GCP stack.
# THE DESTRUCTIVE COUNTERPART OF up.sh. Reads the same .env.<env> contract.
#
#   down.sh staging --yes                       # full staging teardown
#   down.sh staging                             # prints the plan, refuses without --yes
#   down.sh staging --sleep                     # SOFT: pause crons + stop Cloud SQL, delete NOTHING
#   down.sh prod --yes --delete-data            # FULL prod teardown INCLUDING Cloud SQL
#   down.sh prod --yes                          # prod teardown, Cloud SQL PRESERVED
#   DRY_RUN=1 down.sh <env> --yes [--delete-data]   # print every action, touch nothing
#
# ── DATA-SAFE BY DEFAULT (mirrors the LOCAL down.sh, which stops rather than
#    removes, and only touches volumes with -v) ────────────────────────────────
#   * Cloud SQL — the database, users, every row — is deleted ONLY with
#     --delete-data. A plain teardown keeps it.
#   * The five DB-ACCESS SECRETS (JWT_SECRET, PGRST_DB_URI,
#     GOTRUE_DB_DATABASE_URL, PG_META_DB_URL, POSTGRES_PASSWORD) are kept WITH
#     the database. They hold the only copy of generated role passwords (and
#     the session-signing key); deleting them leaves the preserved database
#     answering nobody — indistinguishable from data loss for a rebuild. They
#     are deleted only by --delete-data, i.e. together with the database they
#     belong to.
#   * The HOSTING SITE is kept too. Deleting a Firebase site is PERMANENT —
#     the site ID can never be recreated (firebase-tools: "cannot be
#     reactivated by you or anyone else"), and its custom domain comes off
#     with it. Only --delete-data removes it. (Learned live on staging
#     2026-10-01 — the old staging site id had to be replaced by a new site ID.)
#   * Studio (the Supabase dashboard) is STATELESS — nothing to preserve; its
#     content IS Cloud SQL. `up.sh <env>` recreates the service.
#   * Everything else (scheduler jobs, Cloud Run services, images, artifacts
#     bucket, hosting site, service accounts, the OTHER secrets) is rebuilt by
#     `up.sh <env>` — manifest secrets come back from the operator env file,
#     images from a rebuild, the hosting site from deploy-hosting.
#
# ── GUARDRAILS ───────────────────────────────────────────────────────────────
#   1. The env name "staging"/"prod" must be typed explicitly (no default).
#   2. prod: ALLOW_PROD_TEARDOWN=1 + --yes + type the GCP project id.
#   3. --delete-data: type the Cloud SQL instance name — for BOTH staging and
#      prod — asked BEFORE the first deletion, so a refused confirmation
#      leaves the stack COMPLETELY untouched (the old order deleted the whole
#      stack and only then asked whether to delete the database).
#   4. An 8-second abortable countdown runs before the first destructive call.
#   5. DRY_RUN=1 prints every action without executing any.
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

# ── SOFT SHUTDOWN: `down.sh staging --sleep` ─────────────────────────────────
# Pauses the scheduler and STOPS Cloud SQL (policy flip — data kept). Handled
# FIRST and by exec, so no deletion code below can ever run in this mode.
# Details, wake-up and what is guaranteed never to be deleted: power.sh.
for arg in "$@"; do
  if [ "$arg" = "--sleep" ]; then
    [ "$#" -eq 1 ] || { echo "✗ --sleep is the non-destructive mode and cannot be combined with other flags"; exit 1; }
    exec "$HERE/power.sh" "$ENV_NAME" sleep
  fi
done

YES=0; DELETE_DATA=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --delete-data) DELETE_DATA=1 ;;
    *) echo "✗ unknown flag: $arg (--yes, --delete-data)"; exit 1 ;;
  esac
done
DRY_RUN="${DRY_RUN:-0}"

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
have gcloud || { echo "✗ gcloud not installed"; exit 1; }

if [ "$ENV_NAME" = "prod" ]; then
  printf "Type the GCP project id to tear down (%s): " "$GCP_PROJECT_ID"
  if [ -t 0 ]; then
    read -r typed
  else
    typed="${DOWN_CONFIRM_PROJECT:-}"
    echo "$typed (from DOWN_CONFIRM_PROJECT)"
  fi
  [ "$typed" = "$GCP_PROJECT_ID" ] || { echo "✗ project id does not match — aborting."; exit 1; }
fi

# ── plan ──────────────────────────────────────────────────────────────────────
svc_names="$CLOUD_RUN_API $CLOUD_RUN_JOBS $CLOUD_RUN_ADMIN $CLOUD_RUN_TRACKERS"
[ -n "${CLOUD_RUN_AUTH:-}" ]    && svc_names="$svc_names $CLOUD_RUN_AUTH"
[ -n "${CLOUD_RUN_REST:-}" ]    && svc_names="$svc_names $CLOUD_RUN_REST"
[ -n "${CLOUD_RUN_STUDIO:-}" ]  && svc_names="$svc_names $CLOUD_RUN_STUDIO"

echo "┌ teardown plan — env=$ENV_NAME project=$GCP_PROJECT_ID region=$GCP_REGION"
echo "│  scheduler jobs   : datiq-${DATIQ_PROJECT_CODE}-sch-*"
echo "│  cloud run        :$svc_names"
if [ "$DELETE_DATA" = "1" ]; then
  echo "│  secrets          : datiq-${DATIQ_PROJECT_CODE}-sm-* — ALL deleted (--delete-data)"
else
  echo "│  secrets          : datiq-${DATIQ_PROJECT_CODE}-sm-* — EXCEPT the 5 DB-access"
  echo "│                     secrets KEPT with the database (JWT_SECRET, PGRST_DB_URI,"
  echo "│                     GOTRUE_DB_DATABASE_URL, PG_META_DB_URL, POSTGRES_PASSWORD)"
fi
echo "│  artifact registry: ${AR_REPO} (all images — rebuilt by up.sh)"
echo "│  artifacts bucket : gs://${ARTIFACTS_BUCKET}"
if [ "$DELETE_DATA" = "1" ]; then
  echo "│  hosting site     : ${FHS_SITE_ID}.web.app — DELETED (--delete-data)"
else
  echo "│  hosting site     : ${FHS_SITE_ID}.web.app KEPT (deleting a Firebase site is"
  echo "│                     PERMANENT — the ID can never be recreated; up.sh redeploys)"
fi
echo "│  service accounts : ${SA_DEPLOY} ${SA_API} ${SA_JOBS} ${SA_SCHEDULER} (recreated by bootstrap)"
if [ "$DELETE_DATA" = "1" ]; then
  echo "│  ⚠ cloud sql      : ${SQL_INSTANCE:-<unset>} — DATABASE AND ALL DATA DELETED (--delete-data)"
else
  echo "│  cloud sql        : ${SQL_INSTANCE:-<unset>} PRESERVED (pass --delete-data to delete)"
  echo "│  ⚠ studio note    : Studio is stateless — its content IS Cloud SQL, which is"
  echo "│                     preserved; up.sh recreates the service."
fi
echo "│  app engine app   : NOT deletable without the project — left in place"
echo "└"

if [ "$ENV_NAME" = "staging" ] && [ "$YES" != "1" ]; then
  echo "→ re-run with --yes to execute. (Database + DB-access secrets always survive a"
  echo "  plain teardown; --delete-data deletes them and asks for the instance name first.)"
  exit 0
fi

# ── the DATA confirmation, BEFORE anything is deleted ─────────────────────────
# A refused confirmation must leave the whole stack untouched. This block used
# to live in the Cloud SQL section (after scheduler/Cloud Run/secrets/... had
# already been deleted), so a mistyped instance name still cost the operator
# the entire stack — and the preserved-database credentials were gone by then.
if [ "$DELETE_DATA" = "1" ]; then
  printf "Type the Cloud SQL instance name to confirm DATA DELETION (%s): " "$SQL_INSTANCE"
  if [ -t 0 ]; then read -r typed_sql; else typed_sql="${DOWN_CONFIRM_SQL:-}"; echo "$typed_sql (from DOWN_CONFIRM_SQL)"; fi
  [ "$typed_sql" = "$SQL_INSTANCE" ] || { echo "✗ instance name does not match — NOTHING was deleted."; exit 1; }
fi

if [ "$ENV_NAME" = "prod" ]; then
  echo "Starting in 8s — Ctrl+C to abort."
  [ "$DRY_RUN" = "1" ] || sleep 8
fi

deleted=0; absent=0; kept=0

# del <label> <cmd...> — execute a deletion (or print it under DRY_RUN) and
# count the outcome. DRY_RUN must touch NOTHING: not even the counters' side
# effects matter, but the printed plan does.
del() {
  local label="$1"; shift
  if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] would delete: ${label}"; deleted=$((deleted+1)); return 0; fi
  if "$@" >/dev/null 2>&1; then echo "  ✓ deleted ${label}"; deleted=$((deleted+1));
  else echo "  ⚠ delete failed: ${label}"; fi
}

# ── 1. scheduler ──────────────────────────────────────────────────────────────
echo "→ scheduler jobs"
while IFS= read -r job; do
  [ -n "$job" ] || continue
  job="${job##*/}"
  del "$job" gcloud scheduler jobs delete "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet
done < <(gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
  --filter="name:datiq-${DATIQ_PROJECT_CODE}-sch-" --format='value(name)' 2>/dev/null || true)

# ── 2. cloud run ──────────────────────────────────────────────────────────────
for svc in $svc_names; do
  [ -n "$svc" ] || continue
  if gcloud run services describe "$svc" "${GCP_FLAGS[@]}" >/dev/null 2>&1; then
    del "$svc" gcloud run services delete "$svc" "${GCP_FLAGS[@]}" --quiet
  else
    echo "  (absent) $svc"; absent=$((absent+1))
  fi
done

# ── 3. secrets ────────────────────────────────────────────────────────────────
# The DB-access set travels with the DATABASE, not with the stack. See the
# header: without these five the preserved Cloud SQL is unusable (generated
# role passwords + the session-signing key live nowhere else).
DB_SECRETS=" $(sm_name JWT_SECRET) $(sm_name PGRST_DB_URI) $(sm_name GOTRUE_DB_DATABASE_URL) $(sm_name PG_META_DB_URL) $(sm_name POSTGRES_PASSWORD) "
echo "→ secrets datiq-${DATIQ_PROJECT_CODE}-sm-*"
while IFS= read -r secret; do
  [ -n "$secret" ] || continue
  if [ "$DELETE_DATA" != "1" ]; then
    case "$DB_SECRETS" in
      *" $secret "*)
        echo "  ◆ kept $secret (DB access — belongs to the preserved Cloud SQL)"
        kept=$((kept+1)); continue ;;
    esac
  fi
  del "$secret" gcloud secrets delete "$secret" --project="$GCP_PROJECT_ID" --quiet
done < <(gcloud secrets list --project="$GCP_PROJECT_ID" \
  --filter="name:datiq-${DATIQ_PROJECT_CODE}-sm-" --format='value(name)' 2>/dev/null | sed 's|.*/||' || true)

# ── 4. artifact registry ──────────────────────────────────────────────────────
echo "→ artifact registry ${AR_REPO}"
if gcloud artifacts repositories describe "$AR_REPO" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" >/dev/null 2>&1; then
  del "$AR_REPO (all images)" gcloud artifacts repositories delete "$AR_REPO" --project="$GCP_PROJECT_ID" \
    --location="$GCP_REGION" --quiet
else
  echo "  (absent)"; absent=$((absent+1))
fi

# ── 5. artifacts bucket ───────────────────────────────────────────────────────
echo "→ bucket gs://${ARTIFACTS_BUCKET}"
if gcloud storage buckets describe "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  del "gs://${ARTIFACTS_BUCKET}" gcloud storage rm -r "gs://${ARTIFACTS_BUCKET}" --project="$GCP_PROJECT_ID" --quiet
else
  echo "  (absent)"; absent=$((absent+1))
fi

# ── 6. hosting site (IRREVERSIBLE — deleted only with --delete-data) ─────────
# 🔴 FIREBASE SITE IDs CANNOT BE RECREATED. firebase-tools' own message: "the
# site … cannot be reactivated by you or anyone else" — the ID stays reserved
# forever. A plain teardown therefore KEEPS the site (up.sh redeploys content
# into it); --delete-data — the full-destroy switch — is the only path that
# removes it, alongside the database. Learned the hard way on staging
# 2026-10-01: a plain teardown deleted the old staging site id and the rebuild could
# not recreate it, which also tore off the stg.datiq.app custom domain.
if [ "$DELETE_DATA" != "1" ]; then
  echo "→ hosting site ${FHS_SITE_ID}: kept (site deletion is permanent — only --delete-data removes it)"
  kept=$((kept+1))
else
  echo "→ hosting site ${FHS_SITE_ID}"
  if have firebase; then
    if firebase hosting:sites:list --project="$GCP_PROJECT_ID" 2>/dev/null | grep -qF "$FHS_SITE_ID"; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "  [dry-run] would delete: hosting site ${FHS_SITE_ID} (PERMANENT)"; deleted=$((deleted+1))
      else
        firebase hosting:sites:delete "$FHS_SITE_ID" --project="$GCP_PROJECT_ID" --force >/dev/null 2>&1 \
          && { echo "  ✓ deleted (ID is now permanently burned)"; deleted=$((deleted+1)); } \
          || echo "  ⚠ could not delete (check firebase login) — site left in place"
      fi
    else
      echo "  (absent)"; absent=$((absent+1))
    fi
  else
    echo "  ⚠ firebase CLI not installed — site left in place (delete: firebase hosting:sites:delete $FHS_SITE_ID)"
  fi
fi

# ── 7. service accounts ───────────────────────────────────────────────────────
for sa in "$SA_DEPLOY_EMAIL" "$SA_API_EMAIL" "$SA_JOBS_EMAIL" "$SA_SCHEDULER_EMAIL"; do
  if gcloud iam service-accounts describe "$sa" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    del "$sa" gcloud iam service-accounts delete "$sa" --project="$GCP_PROJECT_ID" --quiet
  else
    echo "  (absent) $sa"; absent=$((absent+1))
  fi
done

# ── 8. cloud sql (only with --delete-data; confirmation happened up front) ───
if [ "$DELETE_DATA" = "1" ]; then
  echo "→ cloud sql ${SQL_INSTANCE} — DELETING DATABASE AND ALL DATA"
  if gcloud sql instances describe "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    del "$SQL_INSTANCE (database + all data)" gcloud sql instances delete "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --quiet
  else
    echo "  (absent)"; absent=$((absent+1))
  fi
fi

echo
if [ "$DRY_RUN" = "1" ]; then
  echo "✓ ${ENV_NAME} DRY RUN complete — ${deleted} action(s) WOULD run, ${absent} already absent, ${kept} secret(s) would be kept."
  echo "  Nothing was touched. Re-run without DRY_RUN=1 to execute."
else
  echo "✓ ${ENV_NAME} stack down: ${deleted} deleted, ${absent} already absent, ${kept} kept (DB-access secrets + hosting site)."
fi
echo "  NOT removed (project-level): enabled APIs, the App Engine app, IAM bindings"
echo "  for the deleted accounts (they die with the accounts), and the PROJECT itself."
if [ "$DELETE_DATA" != "1" ]; then
  echo "  The database and its access secrets survive — \`up.sh ${ENV_NAME}\` rebuilds the stack"
  echo "  around them (migrate-db skips itself in cloud-sql mode; nothing truncates)."
else
  echo "  ⚠ The database is GONE. .env.${ENV_NAME} still says DATA_MODE=cloud-sql, so a"
  echo "    rebuild needs a deliberate DB step FIRST: run migrate-db.sh with the source"
  echo "    (FORCE_DB_RELOAD=1 migrate-db.sh ${ENV_NAME} <SOURCE_DB_URL>) BEFORE up.sh,"
  echo "    or flip DATA_MODE back for a fresh rehearsal path."
fi
