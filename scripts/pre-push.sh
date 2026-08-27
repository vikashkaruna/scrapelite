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
#   8. npm run check:prerender
#   9. npm run test:security
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

# ── Is the INSTALLED hook the current one? ─────────────────────────────
# .git/hooks/pre-push is a COPY of this file, made by `npm run
# ci:install-hook`. Nothing re-copies it when this script changes, so the
# installed hook silently rots — and a rotted hook does not announce
# itself, it just stops running whichever gates were added after it was
# installed.
#
# That is not hypothetical. On 2026-08-27 the installed hook predated the
# prerender staleness gate entirely, so that gate had never run on this
# machine — which is the most likely reason the prerendered pages went
# stale twice in a week while every push reported green.
#
# Warn, never block: a stale hook is a maintenance problem, not a reason
# to refuse someone's push.
if [ -n "${GIT_DIR:-}" ] || [ -d .git ] || git rev-parse --git-common-dir >/dev/null 2>&1; then
  _hook_installed="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/hooks/pre-push"
  _hook_source="$(git rev-parse --show-toplevel 2>/dev/null || echo .)/scripts/pre-push.sh"
  if [ -f "$_hook_installed" ] && [ -f "$_hook_source" ] \
     && ! cmp -s "$_hook_installed" "$_hook_source"; then
    printf '\033[33m! pre-push:\033[0m the installed hook differs from scripts/pre-push.sh.\n'
    printf '  Gates added since it was installed are NOT running.\n'
    printf '  Refresh it with:  \033[1mnpm run ci:install-hook\033[0m\n\n'
  fi
fi

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

# ── What this push changes ─────────────────────────────────────────────
# Computed unconditionally: both gates below read it, and the prerender
# gate must still see it when PREPUSH_FORCE=1 has skipped the docs-only
# early exit.
CHANGED_FILES=""
if [ -n "${UPSTREAM:-}" ]; then
  # Fetch the upstream ref into a temp rev so we can diff even if it's
  # not local. `git fetch` is silent on no-op.
  git fetch --quiet "$REMOTE" "$UPSTREAM" 2>/dev/null || true
  DIFF_BASE="$(git merge-base HEAD "$REMOTE/$UPSTREAM" 2>/dev/null || echo HEAD~1)"
  CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" HEAD 2>/dev/null || true)"
fi

# ── Smart skip: docs-only diff ─────────────────────────────────────────
# If every changed file is in a docs/help/markdown path, the test suites
# cannot have changed. This mirrors the workflow's `paths-ignore` and
# keeps push latency to <1s for `git commit + git push` on doc edits.
if [ "${PREPUSH_FORCE:-0}" != "1" ] && [ -n "${UPSTREAM:-}" ]; then
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

# ── Prerender staleness gate ───────────────────────────────────────────
# The static HTML under public/<route>/index.html is GENERATED from the
# React pages by scripts/prerender.mjs and committed (it is deliberately
# not built on Netlify, so a deploy can never fail on a Chromium
# download). That trade means the committed output can go stale, and a
# stale prerender is the worst failure mode available here: the site
# keeps serving crawlers an older version of every marketing page while
# everything looks green.
#
# ⚠️ THIS IS DELIBERATELY OUTSIDE THE PREPUSH_FORCE BLOCK.
# It used to live inside it, which meant PREPUSH_FORCE=1 — a flag whose
# entire purpose is to make MORE checks run, by skipping the docs-only
# early exit — silently switched this gate OFF. Exactly backwards. The
# only ways past it are now `git push --no-verify` or the explicit
# PREPUSH_SKIP_PRERENDER=1, both of which say what they are doing.
#
# It is a cheap string check — no browser, no build — so it can only see
# "sources moved, output didn't" within THIS diff. It cannot see content
# drift a merge brought in, which is the case that got past it twice
# (see c4330e8 and the CLAUDE.md entry above it). `npm run prerender --
# --check` is the real answer and now runs as a gate below.
if [ "${PREPUSH_SKIP_PRERENDER:-0}" != "1" ] && [ -n "${CHANGED_FILES:-}" ]; then
  PRERENDER_SRC="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^(src/(pages|components|styles|lib|hooks)/|index\.html$|scripts/site-routes\.mjs$)' || true)"
  PRERENDER_OUT="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^public/.*/index\.html$' || true)"
  if [ -n "$PRERENDER_SRC" ] && [ -z "$PRERENDER_OUT" ]; then
    printf '\033[31m✗ pre-push:\033[0m prerendered pages are stale.\n'
    printf '  These changed but no generated page did:\n'
    printf '%s\n' "$PRERENDER_SRC" | head -8 | sed 's/^/    /'
    printf '\n  Run:  \033[1mnpm run prerender\033[0m   then commit the result.\n'
    printf '  (skip with PREPUSH_SKIP_PRERENDER=1 git push … — only if you are\n'
    printf '   certain the change cannot affect any prerendered page)\n'
    exit 1
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
# Immediately after build, while dist/ is fresh: do the committed static
# pages still point at assets this build produces? Catches the merge-
# induced drift the cheap string gate above structurally cannot see.
run_step "check:prerender"   npm run --silent check:prerender
run_step "test:security"     npm run --silent test:security

total=$(( $(date +%s) - start_ts ))
printf '\n%s✓ pre-push: all gates green in %ds. Pushing to %s/%s.%s\n' \
  "$C_OK" "$total" "$REMOTE" "$UPSTREAM" "$C_RST"
