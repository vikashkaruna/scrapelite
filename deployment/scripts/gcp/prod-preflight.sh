#!/usr/bin/env bash
# deployment/scripts/gcp/prod-preflight.sh — READ-ONLY readiness gate for the first
# prod deploy. Changes nothing anywhere. Exit 0 = safe to run up.sh prod.
#
#   deployment/scripts/gcp/prod-preflight.sh [--cutover]
#
# --cutover adds the checks that only matter for the DB/auth cutover (JWT_SECRET,
# OAuth ids/secrets, SMTP, engagement). Doc: docs/plans/gcp-docker-migration/11 §1.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUTOVER=0; [ "${1:-}" = "--cutover" ] && CUTOVER=1
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
load_gcp_env prod >/dev/null 2>&1 || { echo "✗ cannot load deployment/env/.env.prod"; exit 1; }
fail=0; warn=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
note() { echo "  ⚠ $1"; warn=$((warn+1)); }
val()  { printf '%s' "${!1:-}"; }
need() { # need <VAR> <why>: set, non-empty, not a REPLACE_ME placeholder
  local v; v="$(val "$1")"
  if [ -z "$v" ]; then bad "$1 is empty — $2"
  else case "$v" in REPLACE_ME*) bad "$1 is a placeholder — $2";; *) ok "$1 set";; esac; fi
}
claim() { # claim <jwt> <field> -> decoded payload field
  node -e 'const p=process.argv[1].split(".")[1]||"";try{console.log(JSON.parse(Buffer.from(p,"base64url").toString())[process.argv[2]]??"")}catch{console.log("")}' "$1" "$2"
}

echo "── 1. shape of .env.prod (shadow = prod behaviour, still on hosted Supabase)"
[ "$(val APP_CONTEXT)" = "production" ] && ok "APP_CONTEXT=production" || bad "APP_CONTEXT must be 'production' (is '$(val APP_CONTEXT)') — branch-deploy turns on staging behaviour"
[ "$(val GIT_BRANCH)" = "main" ]        && ok "GIT_BRANCH=main"        || bad "GIT_BRANCH must be 'main' (is '$(val GIT_BRANCH)')"
[ "$(val DATA_MODE)" = "hosted-supabase" ] && ok "DATA_MODE=hosted-supabase (pre-cutover)" || bad "DATA_MODE must be hosted-supabase before the cutover (is '$(val DATA_MODE)')"
[ "$(val OPS_JOBS_DISABLED)" = "1" ]    && ok "OPS_JOBS_DISABLED=1 (Netlify still owns crons)" || bad "OPS_JOBS_DISABLED must be 1 until the cron handoff"
[ "$(val PURGE_ENABLED)" = "0" ]        && ok "PURGE_ENABLED=0" || bad "PURGE_ENABLED must be 0"
[ "$(val APP_BASE_URL)" = "https://$(val FHS_SITE_ID).web.app" ] && ok "APP_BASE_URL is the shadow host" || bad "APP_BASE_URL should be the shadow https://$(val FHS_SITE_ID).web.app until the DNS flip (is '$(val APP_BASE_URL)')"
[ "$(val DATIQ_ENV_SUFFIX)" = "-prod" ] && ok "resource suffix -prod" || bad "DATIQ_ENV_SUFFIX must be -prod"
[ "$(val FHS_SITE_ID)" != "$(grep -E '^FHS_SITE_ID=' "$DEPLOY_DIR/env/.env.staging" 2>/dev/null | cut -d= -f2-)" ] && ok "hosting site differs from staging" || bad "FHS_SITE_ID equals staging's"

echo "── 2. prod hosted Supabase (what the shadow talks to)"
need SUPABASE_URL "prod project URL"
need SUPABASE_ANON_KEY "prod anon key"
need SUPABASE_SERVICE_KEY "prod service_role key (Supabase dashboard → Settings → API)"
case "$(val SUPABASE_URL)" in https://*.supabase.co) ok "SUPABASE_URL is a hosted Supabase project URL";; *) bad "SUPABASE_URL must be the hosted prod project URL (https://<ref>.supabase.co) while DATA_MODE=hosted-supabase";; esac
sk="$(val SUPABASE_SERVICE_KEY)"
if [ "${sk#eyJ}" != "$sk" ]; then
  [ "$(claim "$sk" role)" = "service_role" ] && ok "service key role=service_role" || bad "SUPABASE_SERVICE_KEY is not a service_role JWT"
  su="$(val SUPABASE_URL)"; su="${su#https://}"; su="${su%%.*}"
  [ "$(claim "$sk" ref)" = "$su" ] && ok "service key belongs to the SUPABASE_URL project" || bad "SUPABASE_SERVICE_KEY ref does not match SUPABASE_URL's project"
fi
npm run -s verify:supabase -- prod >/tmp/prodpre.vs 2>&1 && ok "verify:supabase prod (ref match + live probe)" || { bad "verify:supabase prod failed:"; sed 's/^/      /' /tmp/prodpre.vs | tail -4; }

echo "── 3. build/deploy inputs"
case "$(val VITE_RAZORPAY_KEY_ID)" in ""|*_test_*) bad "VITE_RAZORPAY_KEY_ID is empty or a TEST key (prod hosting build refuses it)";; *) ok "VITE_RAZORPAY_KEY_ID is a live key id";; esac
need RAZORPAY_KEY_ID "server-side Razorpay key id"; need RAZORPAY_KEY_SECRET "Razorpay secret"; need RAZORPAY_WEBHOOK_SECRET "prod webhook secret"
need RESEND_API_KEY "transactional mail"
need STAGING_IMG_TAG "the staging image tag to promote (doc 11 §2)"
st_tag="$(val STAGING_IMG_TAG)"
for k in api admin trackers; do
  d="$(gcloud artifacts docker images describe "${STAGING_GCP_REGION:-$GCP_REGION}-docker.pkg.dev/$(val STAGING_GCP_PROJECT_ID)/$(val STAGING_AR_REPO)/datiq-${DATIQ_PROJECT_CODE}-ctr-$k:$st_tag" --project="$(val STAGING_GCP_PROJECT_ID)" --format='value(image_summary.fully_qualified_digest)' 2>/dev/null)"
  [ -n "$d" ] && ok "staging image ctr-$k:$st_tag exists" || bad "no staging image ctr-$k:$st_tag — run build-images.sh staging, or fix STAGING_IMG_TAG"
done
gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q . && ok "gcloud authenticated" || bad "gcloud not authenticated"
gcloud billing projects describe "$GCP_PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null | grep -qi true && ok "billing enabled on $GCP_PROJECT_ID" || note "could not confirm billing on $GCP_PROJECT_ID"
node "$HERE/env-parity.mjs" prod >/tmp/prodpre.par 2>&1 && ok "env-parity (Netlify → GCP) clean" || { bad "env-parity found gaps:"; grep -E "^   x" /tmp/prodpre.par | sed 's/^/      /'; }
bash "$DEPLOY_DIR/scripts/check-parameterisation.sh" >/tmp/prodpre.pg 2>&1 && ok "parameterisation gate" || note "parameterisation gate: $(tail -1 /tmp/prodpre.pg) (pre-existing comment literals; not blocking)"

echo "── 4. nothing for prod exists yet? (first deploy expectation)"
n="$(gcloud run services list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format='value(metadata.name)' 2>/dev/null | grep -c -e "$(val DATIQ_ENV_SUFFIX)\$" || true)"
[ "${n:-0}" = "0" ] && ok "no prod Cloud Run services yet (clean first deploy)" || note "$n prod Cloud Run service(s) already exist — this is a re-deploy, not a first deploy"

if [ "$CUTOVER" = "1" ]; then
  echo "── 5. cutover-only inputs"
  need JWT_SECRET "the PROD Supabase JWT secret (dashboard → Settings → API); a generated one logs every user out"
  jwt="$(val JWT_SECRET)"; ak="$(val SUPABASE_ANON_KEY)"
  if [ -n "$jwt" ] && [ "${ak#eyJ}" != "$ak" ]; then
    node -e 'const c=require("crypto");const[,s,t]=process.argv;const[h,p,g]=t.split(".");process.exit(c.createHmac("sha256",s).update(h+"."+p).digest("base64url")===g?0:1)' "$jwt" "$ak" \
      && ok "anon key is signed by JWT_SECRET (sessions survive the flip)" || bad "anon key is NOT signed by JWT_SECRET — wrong secret"
  fi
  for P in GOOGLE AZURE GITHUB; do
    [ "$(val GOTRUE_EXTERNAL_${P}_ENABLED)" = "true" ] || { note "$P sign-in disabled"; continue; }
    need GOTRUE_EXTERNAL_${P}_CLIENT_ID "$P OAuth client id"; need ${P}_OAUTH_CLIENT_SECRET "$P client secret VALUE (not the secret id)"
  done
  sg="$(grep -E '^GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=' "$DEPLOY_DIR/env/.env.staging" | cut -d= -f2-)"
  [ -n "$sg" ] && [ "$(val GOTRUE_EXTERNAL_GITHUB_CLIENT_ID)" = "$sg" ] && bad "GitHub client id equals STAGING's — a GitHub OAuth app allows ONE callback URL; create a separate prod app"
  need GOTRUE_SMTP_HOST "SMTP for confirmation/reset mail"; [ -n "$(val GOTRUE_SMTP_PASS)$(val RESEND_API_KEY)" ] && ok "SMTP password source present" || bad "GOTRUE_SMTP_PASS / RESEND_API_KEY empty"
  need ENGAGEMENT_UNSUBSCRIBE_SECRET "must equal Netlify's value or sent unsubscribe links break"
  need ENGAGEMENT_RESEND_API_KEY "outreach key"; need ENGAGEMENT_RESEND_WEBHOOK_SECRET "Resend webhook secret"
  need GUEST_ID_SALT "guest-trial identity salt"
fi

echo
if [ "$fail" -eq 0 ]; then echo "✓ prod preflight passed ($warn warning(s)) — next: deployment/scripts/gcp/up.sh prod"; exit 0
else echo "✗ prod preflight: $fail blocker(s), $warn warning(s) — fix, re-run"; exit 1; fi
