#!/usr/bin/env bash
# deployment/scripts/gcp/power.sh — SOFT shutdown / wake of a GCP environment's
# cost-bearing parts. Nothing is ever deleted.
#
#   power.sh staging sleep      # pause scheduler jobs, then stop Cloud SQL
#   power.sh staging wake       # start Cloud SQL, then resume ONLY the jobs sleep paused
#   power.sh staging status     # SQL state + policy, scheduler states, recorded state
#   DRY_RUN=1 power.sh staging sleep|wake     # print every action, change nothing
#
# WHAT "SLEEP" MEANS HERE
#   * Cloud SQL: `--activation-policy=NEVER`. The instance stops; the data disk,
#     users, databases and every row are KEPT (only storage is billed while
#     stopped). `wake` sets ALWAYS again. This is a policy flip, not a delete.
#   * Cloud Scheduler: the jobs that were ENABLED are paused (they would wake
#     Cloud Run and hit a stopped database with errors) and remembered.
#   * Cloud Run needs nothing: every service already runs min-instances=0, so it
#     costs nothing between requests.
#
# WHAT IT NEVER DOES (guarded by deployment/tests/power-safety.test.mjs)
#   * delete, remove, wipe or recreate anything (no `delete`, no `rm`, no
#     `--delete-data`). The only gcloud verbs used are describe/list, `sql
#     instances patch --activation-policy`, `scheduler jobs pause|resume`, and
#     `storage cp` for its own bookkeeping file.
#   * touch prod — refused outright. (Prod has real customers' sessions and a
#     DB that must stay up.)
#
# STATE. The Cloud SQL activation policy IS the source of truth for "asleep".
# The only extra thing to remember is WHICH scheduler jobs were enabled, so that
# wake restores exactly that set instead of resuming a job somebody paused on
# purpose. That list lives in gs://$ARTIFACTS_BUCKET/power/state.json and is
# OVERWRITTEN (never deleted) on wake. It is written BEFORE the database is
# stopped, so an interrupted sleep is still recoverable by `wake`.
#
# Idempotent: sleeping a sleeping environment, or waking an awake one, is a
# no-op that says so.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"

ENV_NAME="${1:-}"
ACTION="${2:-}"
DRY_RUN="${DRY_RUN:-0}"
USAGE="usage: power.sh staging <sleep|wake|status>"

[ "$ENV_NAME" = "staging" ] || {
  echo "✗ power.sh only manages staging (got '${ENV_NAME:-}'). Prod is never put to sleep. $USAGE"; exit 1; }
case "$ACTION" in sleep|wake|status) ;; *) echo "✗ $USAGE"; exit 1 ;; esac

load_gcp_env "$ENV_NAME"
have gcloud || { echo "✗ gcloud not installed"; exit 1; }
: "${SQL_INSTANCE:?SQL_INSTANCE missing from .env.$ENV_NAME}"
: "${ARTIFACTS_BUCKET:?ARTIFACTS_BUCKET missing from .env.$ENV_NAME}"
STATE_URI="gs://${ARTIFACTS_BUCKET}/power/state.json"
WAKE_TIMEOUT="${WAKE_TIMEOUT_SECONDS:-600}"

run() { if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] $*"; else "$@"; fi; }

sql_field() { # sql_field <gcloud --format value expression>
  # stderr is shown (not swallowed): an unreadable instance must be diagnosable.
  gcloud sql instances describe "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --format="value($1)" || true
}
sql_policy() { sql_field "settings.activationPolicy"; }
sql_state()  { sql_field "state"; }

# "<job-id> <state>" for DatIQ-owned jobs of THIS env only (composed filter).
list_jobs() {
  gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
    --filter="name~datiq-${DATIQ_PROJECT_CODE}-sch-.*${DATIQ_ENV_SUFFIX}\$" \
    --format='value(name,state)' 2>/dev/null | tr '\t' ' ' | sed 's#projects/[^ ]*/jobs/##' || true
}

read_state_jobs() { # prints one job id per line (empty if no state / no jobs)
  gcloud storage cat "$STATE_URI" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).jobs||[]).forEach(j=>console.log(j))}catch{}})' || true
}

write_state() { # write_state <space-separated job ids> <sleptAt|"">
  local jobs="$1" at="$2"
  [ "$DRY_RUN" = "1" ] && { echo "  [dry-run] write $STATE_URI jobs=[$jobs] sleptAt=$at"; return 0; }
  JOBS="$jobs" AT="$at" node -e '
    const jobs=(process.env.JOBS||"").split(" ").filter(Boolean);
    console.log(JSON.stringify({sleptAt:process.env.AT||null,jobs}))' \
    | gcloud storage cp - "$STATE_URI" --quiet >/dev/null
}

case "$ACTION" in
  status)
    echo "env=$ENV_NAME project=$GCP_PROJECT_ID instance=$SQL_INSTANCE"
    echo "  cloud sql : state=$(sql_state) activationPolicy=$(sql_policy)"
    echo "  scheduler :"
    list_jobs | awk '{printf "    %-44s %s\n",$1,$2}'
    echo "  remembered (jobs to resume on wake): $(read_state_jobs | tr '\n' ' ')"
    ;;

  sleep)
    policy="$(sql_policy)"
    [ -n "$policy" ] || { echo "✗ cannot read Cloud SQL $SQL_INSTANCE (describe failed above) — refusing to change it"; exit 1; }
    echo "→ sleeping $ENV_NAME (nothing is deleted)"
    # 1) remember + pause the jobs that are currently ENABLED
    enabled="$(list_jobs | awk '$2=="ENABLED"{print $1}' | tr '\n' ' ')"
    # keep any set already remembered from an earlier, interrupted sleep
    prior="$(read_state_jobs | tr '\n' ' ')"
    remember="$(printf '%s %s' "$prior" "$enabled" | tr ' ' '\n' | awk 'NF' | sort -u | tr '\n' ' ')"
    write_state "$remember" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for job in $enabled; do
      run gcloud scheduler jobs pause "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet >/dev/null
      echo "  ⏸ paused $job"
    done
    [ -n "$enabled" ] || echo "  = no enabled scheduler jobs to pause"
    # 2) stop Cloud SQL (policy flip; data kept)
    if [ "$policy" = "NEVER" ]; then
      echo "  = Cloud SQL already stopped (activationPolicy=NEVER)"
    else
      echo "  ⏹ stopping Cloud SQL $SQL_INSTANCE (disk + data kept; wake restores it)"
      run gcloud sql instances patch "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --activation-policy=NEVER --quiet >/dev/null
    fi
    echo "✓ $ENV_NAME asleep. Wake: deployment/scripts/gcp/power.sh $ENV_NAME wake (≈1–3 min; CI wakes it automatically)"
    ;;

  wake)
    policy="$(sql_policy)"; state="$(sql_state)"
    echo "→ waking $ENV_NAME"
    # Never patch an instance we could not read: an empty policy means describe failed.
    [ -n "$policy" ] || { echo "✗ cannot read Cloud SQL $SQL_INSTANCE (describe failed above) — refusing to change it"; exit 1; }
    if [ "$policy" = "ALWAYS" ] && [ "$state" = "RUNNABLE" ]; then
      echo "  = Cloud SQL already running"
    else
      echo "  ▶ starting Cloud SQL $SQL_INSTANCE (policy=$policy state=$state)"
      run gcloud sql instances patch "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --activation-policy=ALWAYS --quiet >/dev/null
      if [ "$DRY_RUN" != "1" ]; then
        waited=0
        until [ "$(sql_state)" = "RUNNABLE" ]; do
          [ "$waited" -lt "$WAKE_TIMEOUT" ] || { echo "✗ Cloud SQL not RUNNABLE after ${WAKE_TIMEOUT}s (state=$(sql_state))"; exit 1; }
          sleep 10; waited=$((waited+10)); echo "    …waiting for RUNNABLE (${waited}s)"
        done
      fi
      echo "  ✓ Cloud SQL RUNNABLE"
    fi
    # Resume exactly what sleep paused — never a job somebody paused on purpose.
    resumed=0
    for job in $(read_state_jobs); do
      cur="$(list_jobs | awk -v j="$job" '$1==j{print $2}')"
      [ "$cur" = "PAUSED" ] || continue
      run gcloud scheduler jobs resume "$job" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --quiet >/dev/null
      echo "  ▶ resumed $job"; resumed=$((resumed+1))
    done
    write_state "" ""   # overwrite — bookkeeping only, nothing is removed
    echo "✓ $ENV_NAME awake (${resumed} scheduler job(s) resumed)"
    ;;
esac
