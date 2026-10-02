#!/usr/bin/env bash
# deployment/scripts/gcp/bootstrap-secrets.sh — push runtime secret VALUES from
# deployment/env/.env.<env> (gitignored) into Secret Manager.
# Idempotent: a new version is added only when the value changed. No secret
# value is ever printed or written anywhere.
#
#   bootstrap-secrets.sh staging
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: bootstrap-secrets.sh <staging|prod>}"
load_gcp_env "$ENV_NAME"

# SINGLE SOURCE OF TRUTH: deployment/env/.env.<env>, already loaded by
# load_gcp_env above. The legacy scripts/env/<env>.env used to take precedence
# and silently pushed stale values (staging Razorpay test keys, found
# 2026-10-02: Secret Manager held a different Razorpay account than the browser
# bundle, so checkout died with "Something went wrong"). It is now IGNORED
# unless you opt in explicitly with RUNTIME_ENV_FILE=<path>.
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-}"
if [ -n "$RUNTIME_ENV_FILE" ] && [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "✗ RUNTIME_ENV_FILE not found: $RUNTIME_ENV_FILE"; exit 1
fi
if [ -f "$REPO_DIR/scripts/env/$ENV_NAME.env" ] && [ -z "$RUNTIME_ENV_FILE" ]; then
  echo "  ⚠ ignoring legacy scripts/env/$ENV_NAME.env — secrets come from deployment/env/.env.$ENV_NAME only"
fi
MANIFEST="$DEPLOY_DIR/gcp/secrets.manifest"
[ -f "$MANIFEST" ] || { echo "✗ manifest not found: $MANIFEST"; exit 1; }

# Pushing a rotated-out key into Secret Manager is how dead credentials
# outlive their rotation. Verify the URL/anon pair first (offline ref match +
# live probe) — SKIP_SUPABASE_CHECK=1 to bypass deliberately.
"$HERE/../check-supabase-pair.sh" "$ENV_NAME"

# get_val <KEY> — read a value from the operator file in a throwaway shell
# (unset -u/-e so sparse files source cleanly); falls back to the deploy env.
get_val() {
  local v=""
  if [ -n "$RUNTIME_ENV_FILE" ] && [ -f "$RUNTIME_ENV_FILE" ]; then
    v="$( { set +euo pipefail; . "$RUNTIME_ENV_FILE" >/dev/null 2>&1 || true; printf '%s' "${!1:-}"; } )"
  fi
  [ -z "$v" ] && v="${!1:-}"
  printf '%s' "$v"
}

pushed=0; unchanged=0; skipped=0
while read -r runtime_var source_key services; do
  case "$runtime_var" in ''|\#*) continue;; esac
  secret_name="$(sm_name "$runtime_var")"
  value="$(get_val "$source_key")"
  if [ -z "$value" ]; then
    echo "  skip ${secret_name} (no value for ${source_key})"
    skipped=$((skipped+1)); continue
  fi
  # A template placeholder is not a value: pushing it would store the literal
  # text as the secret (e.g. a prod SUPABASE_SERVICE_KEY of "REPLACE_ME") and
  # fail later, far from the cause.
  case "$value" in REPLACE_ME*)
    echo "✗ ${source_key} is still a placeholder (${value:0:24}…) in .env.$ENV_NAME — fill it or leave it empty to skip"; exit 1;;
  esac
  # ── POST-CUTOVER: SUPABASE_SERVICE_KEY is CUTOVER-OWNED ────────────────────
  # At the staging cutover the fresh JWT secret is minted together with a new
  # anon+service pair, and those ARE the keys the self-hosted GoTrue/PostgREST
  # validate against — the cutover pushes the service key to Secret Manager as
  # part of the flip. The operator file still holds the PRE-cutover hosted key,
  # so re-pushing it here (every `up.sh` runs this script) silently clobbers
  # the minted one and the api's REST calls start failing auth
  # (`/api/credits` → degraded "read_failed"; found live 2026-10-01). Once
  # DATA_MODE=cloud-sql the cutover owns this row — never overwrite it.
  if [ "${DATA_MODE:-}" = "cloud-sql" ] && [ "$runtime_var" = "SUPABASE_SERVICE_KEY" ]; then
    echo "  keep ${secret_name} (cutover-owned — DATA_MODE=cloud-sql)"
    skipped=$((skipped+1)); continue
  fi
  if ! gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --project="$GCP_PROJECT_ID" \
      --replication-policy=automatic --quiet >/dev/null
  fi
  existing="$(gcloud secrets versions access latest --secret="$secret_name" \
    --project="$GCP_PROJECT_ID" 2>/dev/null || true)"
  if [ "$existing" = "$value" ]; then
    echo "  ok   ${secret_name} (unchanged)"; unchanged=$((unchanged+1)); continue
  fi
  printf '%s' "$value" | gcloud secrets versions add "$secret_name" \
    --project="$GCP_PROJECT_ID" --data-file=- --quiet >/dev/null
  echo "  push ${secret_name} → ${services}"
  pushed=$((pushed+1))
done < "$MANIFEST"

# ── OAuth client secrets (GoTrue only) ───────────────────────────────────────
# Deliberately NOT in secrets.manifest: manifest rows are mounted on api AND
# jobs, and only the auth service needs these. Resource names:
#   datiq-<code>-sm-<google|azure|github>-oauth-client-secret-<suffix>
for P in GOOGLE AZURE GITHUB; do
  value="$(get_val "${P}_OAUTH_CLIENT_SECRET")"
  secret_name="$(sm_name "${P}_OAUTH_CLIENT_SECRET")"
  if [ -z "$value" ]; then
    echo "  skip ${secret_name} (no value for ${P}_OAUTH_CLIENT_SECRET)"; skipped=$((skipped+1))
    # Enabled with no secret anywhere = deploy-run.sh will refuse. Say so now,
    # not at deploy time. (A secret already in Secret Manager is fine.)
    en_var="GOTRUE_EXTERNAL_${P}_ENABLED"
    if [ "$(get_val "$en_var")" = "true" ] \
       && ! gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
      echo "  ⚠ ${en_var}=true but ${secret_name} does not exist: set ${P}_OAUTH_CLIENT_SECRET in .env.$ENV_NAME and re-run"
    fi
    continue
  fi
  if ! gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --project="$GCP_PROJECT_ID" --replication-policy=automatic --quiet >/dev/null
  fi
  existing="$(gcloud secrets versions access latest --secret="$secret_name" --project="$GCP_PROJECT_ID" 2>/dev/null || true)"
  if [ "$existing" = "$value" ]; then
    echo "  ok   ${secret_name} (unchanged)"; unchanged=$((unchanged+1)); continue
  fi
  printf '%s' "$value" | gcloud secrets versions add "$secret_name" --project="$GCP_PROJECT_ID" --data-file=- --quiet >/dev/null
  echo "  push ${secret_name} → auth"; pushed=$((pushed+1))
done

# ── GoTrue SMTP password (auth service only) ─────────────────────────────────
# datiq-<code>-sm-gotrue-smtp-pass-<suffix>. Source: GOTRUE_SMTP_PASS, else
# RESEND_API_KEY (Resend SMTP authenticates with an API key as the password).
if [ -n "$(get_val GOTRUE_SMTP_HOST)" ]; then
  value="$(get_val GOTRUE_SMTP_PASS)"; [ -n "$value" ] || value="$(get_val RESEND_API_KEY)"
  secret_name="$(sm_name GOTRUE_SMTP_PASS)"
  if [ -z "$value" ]; then
    echo "  skip ${secret_name} (no GOTRUE_SMTP_PASS / RESEND_API_KEY)"; skipped=$((skipped+1))
    gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 \
      || echo "  ⚠ GOTRUE_SMTP_HOST is set but ${secret_name} does not exist: set GOTRUE_SMTP_PASS or RESEND_API_KEY in .env.$ENV_NAME and re-run"
  else
    gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 \
      || gcloud secrets create "$secret_name" --project="$GCP_PROJECT_ID" --replication-policy=automatic --quiet >/dev/null
    existing="$(gcloud secrets versions access latest --secret="$secret_name" --project="$GCP_PROJECT_ID" 2>/dev/null || true)"
    if [ "$existing" = "$value" ]; then
      echo "  ok   ${secret_name} (unchanged)"; unchanged=$((unchanged+1))
    else
      printf '%s' "$value" | gcloud secrets versions add "$secret_name" --project="$GCP_PROJECT_ID" --data-file=- --quiet >/dev/null
      echo "  push ${secret_name} → auth"; pushed=$((pushed+1))
    fi
  fi
fi

echo "✓ secrets: $pushed pushed, $unchanged unchanged, $skipped skipped (empty source) — project $GCP_PROJECT_ID"
