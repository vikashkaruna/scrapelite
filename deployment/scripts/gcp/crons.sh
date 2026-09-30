#!/usr/bin/env bash
# deployment/scripts/gcp/crons.sh — control the DatIQ Cloud Scheduler jobs
# (doc 05 §3c: 13 jobs, 1:1 with netlify.toml).
#
#   crons.sh staging status            # job | schedule | state table
#   crons.sh staging pause             # pause every DatIQ job (cutover freeze)
#   crons.sh staging resume            # resume every paused DatIQ job
#   crons.sh staging list              # bare job ids (for scripting)
#
# THE CRON-OWNERSHIP RULE (doc 05 §3b): during the parallel-run window GCP and
# Netlify must never own schedules simultaneously. `pause` is the GCP half of
# the freeze step (doc 09 §1); the Netlify TOML schedules are commented out by
# hand in the same window. `resume` re-arms GCP AFTER Netlify's schedules are
# commented and OPS_JOBS_DISABLED has been flipped to 0 on the jobs service —
# resume verifies nothing else; the ownership flip is deliberate and manual.
#
# Only jobs matching datiq-<code>-sch-*-<suffix> are touched — never the whole
# project's scheduler inventory.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: crons.sh <staging|prod> <status|pause|resume|list>}"
ACTION="${2:?usage: crons.sh <staging|prod> <status|pause|resume|list>}"
load_gcp_env "$ENV_NAME"

# list_datiq_jobs → "<full-job-name> <state> <schedule>" per line, DatIQ-owned
# jobs only (composed filter — no literal names). The name arrives as the full
# path (projects/…/jobs/<id>); consumers strip it with ${job##*/}.
list_datiq_jobs() {
  gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
    --filter="name:datiq-${DATIQ_PROJECT_CODE}-sch-" \
    --format='value(name,state,schedule)' 2>/dev/null | tr '\t' ' ' || true
}

case "$ACTION" in
  list)
    list_datiq_jobs | while IFS=' ' read -r job _rest; do
      [ -n "$job" ] && printf '%s\n' "${job##*/}"
    done
    ;;

  status)
    echo "Cloud Scheduler in ${GCP_PROJECT_ID}/${GCP_REGION} owned by DatIQ (${DATIQ_ENV_SUFFIX}):"
    jobs="$(list_datiq_jobs)"
    if [ -z "$jobs" ]; then
      echo "  (none — run deploy-scheduler.sh $ENV_NAME to create them)"
      exit 0
    fi
    printf '  %-42s %-9s %s\n' "JOB" "STATE" "SCHEDULE"
    printf '  %-42s %-9s %s\n' "──────────────────────────────────────────" "─────────" "──────────────"
    printf '  %s\n' "$jobs" | while IFS=' ' read -r job state rest; do
      [ -n "$job" ] || continue
      printf '  %-42s %-9s %s\n' "${job##*/}" "$state" "$rest"
    done
    total="$(printf '%s\n' "$jobs" | grep -c . || true)"
    paused="$(printf '%s\n' "$jobs" | awk '$2=="PAUSED"' | wc -l | tr -d ' ')"
    echo
    echo "  ${total} jobs, ${paused} paused. Ownership: while OPS_JOBS_DISABLED=1 on the"
    echo "  jobs service these jobs fire but the adapter no-ops (Netlify owns crons)."
    ;;

  pause)
    echo "→ pausing DatIQ scheduler jobs (${GCP_PROJECT_ID}/${GCP_REGION})"
    n=0
    while IFS=' ' read -r job state rest; do
      [ -n "$job" ] || continue
      job="${job##*/}"
      if [ "$state" = "PAUSED" ]; then
        echo "  = $job (already paused)"; continue
      fi
      gcloud scheduler jobs pause "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet >/dev/null
      echo "  ⏸ $job ($rest)"
      n=$((n+1))
    done < <(list_datiq_jobs)
    echo "✓ paused ${n} jobs — GCP crons frozen (remember the Netlify TOML half of the freeze, doc 09 §1)"
    ;;

  resume)
    echo "→ resuming DatIQ scheduler jobs (${GCP_PROJECT_ID}/${GCP_REGION})"
    echo "  ⚠ OWNERSHIP CHECK: resume ONLY after (a) Netlify schedules are commented"
    echo "    out and (b) OPS_JOBS_DISABLED=0 is deployed on ${CLOUD_RUN_JOBS}."
    echo "    Both owners live at once = double sends / double billing runs."
    if [ "${OPS_JOBS_DISABLED:-1}" != "0" ]; then
      echo "✗ .env.$ENV_NAME still has OPS_JOBS_DISABLED=${OPS_JOBS_DISABLED:-1} — flip it to 0,"
      echo "  run update-env.sh $ENV_NAME jobs, and comment the Netlify TOML schedules first."
      exit 1
    fi
    n=0
    while IFS=' ' read -r job state rest; do
      [ -n "$job" ] || continue
      job="${job##*/}"
      if [ "$state" != "PAUSED" ]; then
        echo "  = $job (already enabled)"; continue
      fi
      gcloud scheduler jobs resume "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet >/dev/null
      echo "  ▶ $job ($rest)"
      n=$((n+1))
    done < <(list_datiq_jobs)
    echo "✓ resumed ${n} jobs — GCP owns crons for ${ENV_NAME}"
    ;;

  *)
    echo "✗ unknown action: $ACTION (status|pause|resume|list)"; exit 1
    ;;
esac
