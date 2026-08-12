#!/usr/bin/env bash
# scripts/pre-push.sh
#
# Pre-push hook for git. Runs the local equivalent of the GitHub Actions
# "Staging Gate: Test Suites" job before any push, so a failing test can
# never leave your machine. Excludes the Playwright e2e step (it takes
# 2–3 min and is the only piece that can't be cached locally the way GH
# caches it) — run `npm run test:all` manually before pushing if you
# also want the e2e gate.
#
# What this runs (mirrors the Staging Gate minus e2e):
#   1. npm run readiness
#   2. npm run test:unit
#   3. npm run test:contract
#   4. npm run test:integration
#   5. npm run test:system
#   6. npm run test:db
#   7. npm run build
#   8. npm run test:security
#
# Smart skip: if the diff vs origin/<remote-branch> only touches docs,
# help, or markdown, the hook prints "docs-only diff, skipping" and lets
# the push through immediately. This is the path-ignore filter that
# runs locally before GitHub sees the commit.
#
# Bypass:  git push --no-verify   (git's standard escape hatch)
# Force run:  PREPUSH_FORCE=1 git push    (skip the docs-only skip)
#
# Install:  cp scripts/pre-push.sh .git/hooks/pre-push
#           chmod +x .git/hooks/pre-push
#
# 2026-08-12: created as part of CI-local-first — see docs/CI-LOCAL-FIRST.md

set -euo pipefail

# Resolve the upstream branch so we can diff against what we're about to
# push to. Falls back to origin/staging for the common case.
REMOTE="${PREPUSH_REMOTE:-origin}"
# Use the first positional arg as the remote name, second as the URL,
# and the rest as refs (git's pre-push contract).
while read -r local_ref local_sha remote_ref remote_sha; do
  : "${remote_ref:=}"
  if [ -z "${remote_ref:-}" ]; then continue; fi
  # Convert refs/heads/staging → staging
  UPSTREAM="${remote_ref#refs/heads/}"
  break
done

# When run outside a `git push` (e.g. executed directly for testing) the
# read loop yields nothing — fall back to the configured upstream.
if [ -z "${UPSTREAM:-}" ]; then
  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null | sed "s|.*/||" || echo "")"
fi
UPSTREAM="${UPSTREAM:-staging}"

# ── Smart skip: docs-only diff ─────────────────────────────────────────
# If every changed file is in a docs/help/markdown path, the test suites
# cannot have changed. This mirrors the workflow's `paths-ignore` and
# keeps push latency to <1s for `git commit + git push` on doc edits.
if [ "${PREPUSH_FORCE:-0}" != "1" ] && [ -n "${UPSTREAM:-}" ]; then
  # Fetch the upstream ref into a temp rev so we can diff even if it's
  # not local. `git fetch` is silent on no-op.
  git fetch --quiet "$REMOTE" "$UPSTREAM" 2>/dev/null || true
  DIFF_BASE="$(git merge-base HEAD "$REMOTE/$UPSTREAM" 2>/dev/null || echo HEAD~1)"
  CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" HEAD 2>/dev/null || true)"

  if [ -n "$CHANGED_FILES" ]; then
    NON_DOCS="$(printf '%s\n' "$CHANGED_FILES" | grep -Ev '^(docs/|public/help/|\.claude/|.*\.md$|.*/SESSION-HANDOFF-.*\.md$|CHANGELOG\.md$)' || true)"
    if [ -z "$NON_DOCS" ]; then
      printf '\033[32m✓ pre-push:\033[0m docs-only diff vs %s/%s (%d file(s)) — skipping tests.\n' \
        "$REMOTE" "$UPSTREAM" "$(printf '%s\n' "$CHANGED_FILES" | wc -l | tr -d ' ')"
      printf '  (force with PREPUSH_FORCE=1 git push …)\n'
      exit 0
    fi
  fi
fi

# ── Run the test suites ───────────────────────────────────────────────
# tput may not exist in non-TTY environments (CI smoke, backgrounded
# shells). Use plain escape codes when it does, otherwise fall back.
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  C_OK="$(tput setaf 2)"; C_ERR="$(tput setaf 1)"; C_DIM="$(tput dim)"
  C_RST="$(tput sgr0)"
else
  C_OK='\033[32m'; C_ERR='\033[31m'; C_DIM='\033[2m'; C_RST='\033[0m'
fi

start_ts="$(date +%s)"
printf '%s▸ pre-push: running local test suites vs %s/%s …%s\n' \
  "$C_DIM" "$REMOTE" "$UPSTREAM" "$C_RST"

run_step() {
  local name="$1"; shift
  local ts; ts="$(date +%s)"
  printf '\n%s── %s ──%s\n' "$C_DIM" "$name" "$C_RST"
  if "$@"; then
    local elapsed=$(( $(date +%s) - ts ))
    printf '%s✓ %s%s (%ds)\n' "$C_OK" "$name" "$C_RST" "$elapsed"
  else
    local rc=$?
    local elapsed=$(( $(date +%s) - ts ))
    printf '%s✗ %s FAILED%s (%ds, exit %d)\n' "$C_ERR" "$name" "$C_RST" "$elapsed" "$rc" >&2
    printf '\n%sPush blocked. Fix the failure, then re-push.%s\n' "$C_ERR" "$C_RST" >&2
    printf '%sSkip with: git push --no-verify%s\n' "$C_DIM" "$C_RST" >&2
    exit "$rc"
  fi
}

run_step "readiness"         npm run --silent readiness
run_step "test:unit"         npm run --silent test:unit
run_step "test:contract"     npm run --silent test:contract
run_step "test:integration"  npm run --silent test:integration
run_step "test:system"       npm run --silent test:system
run_step "test:db"           npm run --silent test:db
run_step "build"             npm run --silent build
run_step "test:security"     npm run --silent test:security

total=$(( $(date +%s) - start_ts ))
printf '\n%s✓ pre-push: all gates green in %ds. Pushing to %s/%s.%s\n' \
  "$C_OK" "$total" "$REMOTE" "$UPSTREAM" "$C_RST"
