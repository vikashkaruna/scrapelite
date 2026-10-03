#!/usr/bin/env bash
# deployment/scripts/gcp/deploy-staging.sh — orchestrates the full GCP staging
# deploy (doc 05 §3a). Every step is idempotent and individually skippable:
#
#   deploy-staging.sh staging                  # everything, in order
#   SKIP_BUILD=1 deploy-staging.sh staging     # reuse existing images
#   SKIP_DB=1 deploy-staging.sh staging        # skip Cloud SQL migration
#   SKIP_SCHEDULER=1 …  SKIP_HOSTING=1 …
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: deploy-staging.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

step() { echo; echo "━━━ $1 ━━━"; }

# A sleeping staging (power.sh sleep) has Cloud SQL stopped — auth/rest cannot
# start without it. Wake is idempotent and a no-op when already running.
if [ "$ENV_NAME" = "staging" ] && [ -z "${SKIP_WAKE:-}" ]; then
  # Non-fatal: a failed wake must not block shipping code (Cloud Run needs no
  # DB to deploy). If the DB really is asleep, the smoke step fails loudly.
  step "wake (Cloud SQL + scheduler, if asleep)"
  "$HERE/power.sh" staging wake || echo "::warning::wake step failed (see error above); continuing — smoke will fail if Cloud SQL is actually stopped"
fi
step "bootstrap";   [ -n "${SKIP_BOOTSTRAP:-}" ]   || "$HERE/bootstrap.sh" "$ENV_NAME"
step "secrets";     [ -n "${SKIP_SECRETS:-}" ]     || "$HERE/bootstrap-secrets.sh" "$ENV_NAME"
if [ -z "${SKIP_BUILD:-}" ]; then
  step "images (Cloud Build)"; "$HERE/build-images.sh" "$ENV_NAME"
else
  echo "→ images skipped (SKIP_BUILD=1, using IMG_TAG=${IMG_TAG:-from env})"
fi
step "cloud run (api/jobs/admin/trackers)"; "$HERE/deploy-run.sh" "$ENV_NAME"
if [ -z "${SKIP_DB:-}" ]; then
  if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
    # POST-CUTOVER: Cloud SQL is the LIVE database. The rehearsal truncates
    # and reloads it — migrate-db.sh itself refuses (see its guard); skipping
    # here keeps the deploy log honest about why.
    step "cloud sql (skipped — DATA_MODE=cloud-sql: Cloud SQL is live, nothing to rehearse)"
  else
    step "cloud sql + supabase dump/restore rehearsal"; "$HERE/migrate-db.sh" "$ENV_NAME"
  fi
  # ── SELF-HEAL: the mirrored upstream images ────────────────────────────────
  # The Artifact Registry repo is deleted with the stack (down.sh), and
  # build-images.sh rebuilds only api/admin/trackers — the GoTrue/PostgREST/
  # Studio/pg-meta mirrors come from their own Cloud Build configs. Without
  # this check a teardown→rebuild cycle fails at the auth deploy with
  # `Image ...gotrue:staged not found` (seen live 2026-10-01). Presence is
  # probed cheaply; absence triggers the mirror once.
  auth_img="${AUTH_IMAGE:-}"
  if [ -n "$auth_img" ] && ! gcloud artifacts docker images describe "$auth_img" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    step "mirror upstream images (GoTrue/PostgREST + Studio/pg-meta) — missing after teardown"
    "$HERE/stage-third-party.sh" "$ENV_NAME"
    "$HERE/stage-studio.sh" "$ENV_NAME"
  fi
  step "auth/rest + studio services"
  if ! "$HERE/deploy-run.sh" "$ENV_NAME" auth rest studio; then
    if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
      # POST-CUTOVER these ARE the serving auth/data path (/auth/v1 +
      # /rest/v1 rewrites) — a failed deploy here breaks sign-in. Never
      # "non-blocking" again.
      echo "✗ auth/rest redeploy FAILED and they are ON THE SERVING PATH (DATA_MODE=cloud-sql)"; exit 1
    fi
    echo "⚠ auth/rest proof services failed (non-blocking pre-cutover — staging still reads hosted Supabase)"
  fi
  # ── WIRE-ORDER FIX: the api service carries the /auth/v1 + /rest/v1 proxy
  # (AUTH_PROXY_URL/REST_PROXY_URL, resolved from the LIVE auth/rest URLs at
  # api-deploy time). On a FRESH rebuild the api deploys in the step above —
  # BEFORE auth/rest exist — so the resolver finds nothing and the proxy ships
  # UNWIRED (seen live: "proxy is not configured" 503s after a teardown →
  # rebuild). Once auth/rest are up, refresh the api env so the wiring lands.
  if [ "${DATA_MODE:-}" = "cloud-sql" ]; then
    step "rewire api proxy env (auth/rest now live)"
    "$HERE/update-env.sh" "$ENV_NAME" api || exit 1
  fi
fi
if [ -z "${SKIP_SCHEDULER:-}" ]; then
  step "cloud scheduler (13 jobs)"; "$HERE/deploy-scheduler.sh" "$ENV_NAME"
fi
if [ -z "${SKIP_HOSTING:-}" ]; then
  step "firebase hosting (static payload)"; "$HERE/deploy-hosting.sh" "$ENV_NAME"
fi

step "smoke"
# NOT `|| true`: a failed parity smoke must fail the deploy (CI re-runs it
# unguarded, but the operator path is the primary gate). Genuinely
# environment-specific smoke degradations print their own SKIP line.
"$HERE/smoke.sh" "$ENV_NAME"
