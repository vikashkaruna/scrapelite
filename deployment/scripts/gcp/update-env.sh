#!/usr/bin/env bash
# deployment/scripts/gcp/update-env.sh — apply ENV-ONLY changes to the Cloud Run
# services: re-read .env.<env>, optionally re-push the runtime secrets, and
# redeploy the services ON THE IMAGE THEY ARE ALREADY SERVING. No rebuild, no
# new tag.
#
#   update-env.sh staging                  # api + jobs (the surfaces that read env)
#   update-env.sh staging api jobs admin trackers
#   update-env.sh staging --with-secrets   # also re-run bootstrap-secrets.sh first
#
# WHY THIS EXISTS: deploy-run.sh composes the image reference from IMG_TAG
# (default: current git sha). An env edit followed by deploy-run.sh from a
# moved checkout therefore fails on a missing image — or worse, silently
# deploys a DIFFERENT build than the one staging validated. Env-only changes
# must ride the exact image that is already live. This is the incremental
# counterpart of build-images.sh + deploy-run.sh, and the tool that fixes the
# 2026-09-29 staging incident class: .env.staging was corrected to the rotated
# anon key but the services kept the revoked one until this redeploy existed.
#
# HOW THE TAG RIDES: the env file is sourced with `set -a` AFTER the caller's
# environment is inherited, so the file's `IMG_TAG=REPLACE_ME_git_sha` (plus
# the composed IMG_* lines) would clobber any plain IMG_TAG export. The live
# tag therefore travels through DATIQ_IMG_TAG_OVERRIDE, which load_gcp_env
# honors and no env file defines (see lib-gcp.sh).
#
# The tag is read from the LATEST READY revision (never spec.template, which a
# failed deploy leaves pointing at a not-found image), and a digest-only
# reference is resolved back to a tag via Artifact Registry so the composed
# name lands on the same bytes.
#
# NOTE: admin/trackers serve static nginx configs and read no runtime env —
# they are accepted as units for completeness but redeploying them changes
# nothing unless their image itself changed (use build-images.sh for that).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib-gcp.sh"
ENV_NAME="${1:?usage: update-env.sh <staging|prod> [api jobs admin trackers] [--with-secrets]}"
shift || true

WITH_SECRETS=0
UNITS=""
for arg in "$@"; do
  case "$arg" in
    --with-secrets) WITH_SECRETS=1 ;;
    *) UNITS="$UNITS $arg" ;;
  esac
done
[ -n "$UNITS" ] || UNITS="api jobs"

load_gcp_env "$ENV_NAME"

if [ "$WITH_SECRETS" = "1" ]; then
  echo "→ refreshing Secret Manager values (bootstrap-secrets.sh — new version only on change)"
  "$HERE/bootstrap-secrets.sh" "$ENV_NAME"
fi

# unit → the service whose image it runs (jobs reuses the api image, exactly
# like deploy-run.sh and compose do).
image_source_service() { # image_source_service <unit> → service name or ""
  case "$1" in
    api|jobs)    printf '%s' "$CLOUD_RUN_API" ;;
    admin)       printf '%s' "$CLOUD_RUN_ADMIN" ;;
    trackers)    printf '%s' "$CLOUD_RUN_TRACKERS" ;;
    studio)      printf '%s' "$CLOUD_RUN_STUDIO" ;;
    *)           printf '' ;;
  esac
}

# serving_image_of <service-name> → the image of the revision actually taking
# traffic (status.latestReadyRevisionName), or "" when the service is absent.
serving_image_of() {
  local ready img
  ready="$(gcloud run services describe "$1" "${GCP_FLAGS[@]}" \
    --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"
  [ -n "$ready" ] || return 0
  img="$(gcloud run revisions describe "$ready" "${GCP_FLAGS[@]}" \
    --format='value(spec.containers[0].image)' 2>/dev/null || true)"
  printf '%s' "$img"
}

# tag_for_serving_image <service-name> → a tag that resolves to the bytes the
# service is serving. Prefers the tag embedded in the reference; falls back to
# resolving a digest-only reference against Artifact Registry's tag list.
tag_for_serving_image() {
  local svc="$1" img path ref digest candidate
  img="$(serving_image_of "$svc")"
  [ -n "$img" ] || return 0
  case "$img" in
    *@*) digest="${img##*@}" ; ref="${img%%@*}" ;;
    *)   digest="" ; ref="$img" ;;
  esac
  case "$ref" in
    *:*) printf '%s' "${ref##*:}" ; return 0 ;;   # tagged reference — done
  esac
  # Digest-only (Cloud Run resolves tags to immutable digests on deploy).
  [ -n "$digest" ] || { echo "✗ $svc serves an untagged, digest-less image reference" >&2; return 1; }
  path="${ref%/*}/$(printf '%s' "${ref##*/}")"
  for candidate in $(gcloud artifacts docker images list "$path" --project="$GCP_PROJECT_ID" \
        --include-tags --format='value(tags)' 2>/dev/null || true); do
    [ -n "$candidate" ] || continue
    if [ "$(gcloud artifacts docker images describe "$path:$candidate" \
          --project="$GCP_PROJECT_ID" --format='value(image_summary.fullyQualifiedDigest)' 2>/dev/null)" \
          = "$path@$digest" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  echo "✗ no AR tag resolves to the digest $svc is serving ($digest)" >&2
  return 1
}

# ── masked before/after fingerprint of the anon key, so the operator SEES the
# change direction. Same style as supabaseServerClient.maskKey(): enough to
# tell two keys apart, never enough to use one.
fingerprint() { # fingerprint <value>
  local v="$1"
  case ${#v} in
    0) echo "(unset)" ;;
    *) echo "$(printf '%s' "$v" | cut -c1-3)…$(printf '%s' "$v" | rev | cut -c1-4 | rev) (${#v} chars)" ;;
  esac
}

for unit in $UNITS; do
  src_svc="$(image_source_service "$unit")"
  [ -n "$src_svc" ] || { echo "✗ unknown unit: $unit (api|jobs|admin|trackers)"; exit 1; }

  if [ "$unit" = "api" ] || [ "$unit" = "jobs" ]; then
    old_key="$(gcloud run services describe "$CLOUD_RUN_API" "${GCP_FLAGS[@]}" \
      --format='json(spec.template.spec.containers[0].env)' 2>/dev/null |
      node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const e=JSON.parse(d).spec.template.spec.containers[0].env||[];const hit=e.find(x=>x.name==="SUPABASE_ANON_KEY");console.log(hit?hit.value:"")}catch{}})' || true)"
    old_fp="$(fingerprint "$old_key")"
    new_fp="$(fingerprint "${SUPABASE_ANON_KEY:-}")"
    if [ "$old_key" = "${SUPABASE_ANON_KEY:-}" ]; then
      echo "→ SUPABASE_ANON_KEY unchanged (${old_fp})"
    else
      echo "→ SUPABASE_ANON_KEY will change: ${old_fp} → ${new_fp}"
    fi
  fi

  live_tag="$(tag_for_serving_image "$src_svc")"
  if [ -z "$live_tag" ]; then
    echo "✗ service ${src_svc} not found — nothing live to update; run build-images.sh + deploy-run.sh first"
    exit 1
  fi

  echo "→ ${unit}: redeploying on ${src_svc}'s serving image (tag ${live_tag}) with the current .env.${ENV_NAME}"
  DATIQ_IMG_TAG_OVERRIDE="$live_tag" "$HERE/deploy-run.sh" "$ENV_NAME" "$unit"
done

echo "✓ env-only redeploy complete:$UNITS"
echo "  follow-ups: changed VITE_/runtime values also need deploy-hosting.sh (static payload)"
