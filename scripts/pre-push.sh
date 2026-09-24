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

# Ensure Node 24 is used if nvm is present
if [ -s "${HOME:-}/.nvm/nvm.sh" ]; then
  export NVM_DIR="${HOME}/.nvm"
  . "${NVM_DIR}/nvm.sh" 2>/dev/null || true
  nvm use 24.17.0 >/dev/null 2>&1 || nvm use 24 >/dev/null 2>&1 || true
fi
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
PUSHING_CONTENT=0
while read -r local_ref local_sha remote_ref remote_sha; do
  : "${remote_ref:=}"
  if [ -z "${remote_ref:-}" ]; then continue; fi
  # ── A DELETION PUSHES NO CONTENT ───────────────────────────────────────
  # `git push --delete` (and `git push origin :branch`) sends an all-zero
  # local_sha. There is no tree to test, so running the suites proves nothing
  # about the operation — it just makes deleting a merged branch take 30
  # seconds and, worse, lets an unrelated flake block a cleanup. Skip it, and
  # say why, rather than leaving people reaching for --no-verify: a habit of
  # bypassing this hook is how a real gate gets bypassed later.
  case "$local_sha" in
    *[!0]*) PUSHING_CONTENT=1 ;;
    *)      : ;;   # all zeros → this ref is being deleted
  esac
  # Convert refs/heads/staging → staging
  UPSTREAM="${remote_ref#refs/heads/}"
  break
done

if [ "${PREPUSH_SAW_REFS:-1}" = "1" ] && [ -n "${UPSTREAM:-}" ] && [ "$PUSHING_CONTENT" = "0" ]; then
  printf '\033[32m✓ pre-push:\033[0m deleting %s — no content to test.\n' "$UPSTREAM"
  exit 0
fi

# When run outside a `git push` (e.g. executed directly for testing) the
# read loop yields nothing — fall back to the configured upstream.
if [ -z "${UPSTREAM:-}" ]; then
  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null | sed "s|.*/||" || echo "")"
fi
UPSTREAM="${UPSTREAM:-staging}"
# The integration branch a new feature branch is measured against.
PREPUSH_BASE_BRANCH="${PREPUSH_BASE_BRANCH:-staging}"

# ── What this push changes ─────────────────────────────────────────────
# Computed unconditionally: both gates below read it, and the prerender
# gate must still see it when PREPUSH_FORCE=1 has skipped the docs-only
# early exit.
CHANGED_FILES=""
if [ -n "${UPSTREAM:-}" ]; then
  # Fetch the upstream ref into a temp rev so we can diff even if it's
  # not local. `git fetch` is silent on no-op.
  git fetch --quiet "$REMOTE" "$UPSTREAM" 2>/dev/null || true

  # ⚠️ ON A BRANCH'S FIRST PUSH, `$REMOTE/$UPSTREAM` DOES NOT EXIST YET.
  #
  # This used to fall back to HEAD~1, so a brand-new branch was diffed against
  # its own last commit. If that commit happened to touch only docs — which,
  # for a branch ending in a CLAUDE.md or handoff update, it usually does — the
  # docs-only skip fired and the ENTIRE branch was pushed with no gate run at
  # all, under a green "✓ pre-push" line. That is worse than no hook: it reads
  # as evidence the suites passed.
  #
  # So: when the upstream ref is missing, diff against the INTEGRATION BRANCH
  # instead. A new branch's real diff is everything it adds on top of staging,
  # which is exactly what is about to be reviewed and merged.
  if git rev-parse --verify --quiet "$REMOTE/$UPSTREAM" >/dev/null; then
    DIFF_BASE="$(git merge-base HEAD "$REMOTE/$UPSTREAM" 2>/dev/null || echo "")"
  else
    git fetch --quiet "$REMOTE" "$PREPUSH_BASE_BRANCH" 2>/dev/null || true
    DIFF_BASE="$(git merge-base HEAD "$REMOTE/$PREPUSH_BASE_BRANCH" 2>/dev/null || echo "")"
    if [ -n "$DIFF_BASE" ]; then
      printf '\033[2m  pre-push: %s/%s does not exist yet — diffing against %s/%s\033[0m\n' \
        "$REMOTE" "$UPSTREAM" "$REMOTE" "$PREPUSH_BASE_BRANCH"
    fi
  fi
  # Still nothing to compare against (a fresh clone with no remote branches at
  # all): run everything rather than skip on a diff we could not compute.
  if [ -z "$DIFF_BASE" ]; then
    CHANGED_FILES="$(git ls-files)"
  else
    CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" HEAD 2>/dev/null || git ls-files)"
  fi
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
  # Test files live beside the sources but are never rendered, so a test-only
  # change cannot stale a page. Counting them made a commit that only touched
  # a *.test.jsx unpushable without a skip flag, because `npm run prerender`
  # correctly writes nothing and so there is nothing to commit.
  PRERENDER_SRC="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^(src/(pages|components|styles|lib|hooks)/|index\.html$|scripts/site-routes\.mjs$)' | grep -vE '(\.test\.[cm]?[jt]sx?$|/__tests__/)' || true)"
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
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && tput setaf 2 >/dev/null 2>&1; then
  C_OK="$(tput setaf 2 2>/dev/null || echo '\033[32m')"
  C_ERR="$(tput setaf 1 2>/dev/null || echo '\033[31m')"
  C_DIM="$(tput dim 2>/dev/null || echo '\033[2m')"
  C_RST="$(tput sgr0 2>/dev/null || echo '\033[0m')"
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

# ── Conditional e2e smoke ─────────────────────────────────────────────
# WHY THIS EXISTS, measured rather than assumed: of the last 25 Staging
# Gate runs, 5 failed — and 4 of those 5 failed on the SAME step, "End-to-
# end smoke tests (Playwright)". Every one of them had passed this hook
# first, because `test-all.mjs --prepush` deliberately skips the e2e
# suite. So the single most common way to get a red gate was to change a
# UI file, watch nine local gates go green in ~30s, push, and find out ten
# minutes later in CI.
#
# The e2e smoke specs are CONTRACT tests over rendered structure — nav
# order, which controls exist, what a page says. That is exactly the class
# a component edit breaks, and exactly the class no unit test here covers.
#
# It runs ONLY when the diff touches UI or the specs themselves, so a
# docs, netlify/, or lib-only push still finishes in ~30s and the fast
# hook people actually tolerate stays fast. That conditionality is the
# whole design: a gate that adds 90s to EVERY push is a gate that gets
# `--no-verify`'d, and this repo already has an incident about exactly
# that habit.
#
# Escape hatch is explicit and says what it does, matching
# PREPUSH_SKIP_PRERENDER above.
if [ "${PREPUSH_SKIP_E2E:-0}" != "1" ] && [ -n "${CHANGED_FILES:-}" ]; then
  # Same source set the prerender gate above uses, plus the specs themselves.
  # Deliberately matched to it rather than narrowed to pages/components: if a
  # change can make a prerendered page stale it can break a rendered-structure
  # contract, and pricingConfig.js -> PricingMatrix -> pricing.spec.js is a real
  # path with no component file in it. One notion of "can affect what renders",
  # not two that drift.
  E2E_TRIGGER="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^(src/(pages|components|styles|lib|hooks)/|e2e/|index\.html$|scripts/site-routes\.mjs$)' || true)"
  if [ -n "$E2E_TRIGGER" ]; then
    printf '\n%s  UI or spec files changed — running the e2e smoke contracts.%s\n' "$C_DIM" "$C_RST"
    printf '%s  (skip with PREPUSH_SKIP_E2E=1 git push …)%s\n' "$C_DIM" "$C_RST"
    run_step "test:e2e:smoke"  npm run --silent test:e2e:smoke
  fi
fi

total=$(( $(date +%s) - start_ts ))
printf '\n%s✓ pre-push: all gates green in %ds. Pushing to %s/%s.%s\n' \
  "$C_OK" "$total" "$REMOTE" "$UPSTREAM" "$C_RST"
