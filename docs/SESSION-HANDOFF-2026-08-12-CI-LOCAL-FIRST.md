# Session Handoff — 2026-08-12 — CI Local-First

> **Read first next session.** Working tree clean, `origin/staging` and
> `origin/main` are in sync at merge `ba4ce6b` (PR #72). One thing
> in flight: phase-gate run **31628841444** is mid-Test-Suites; the
> `phase-gate-72-check` cron is polling it every 3 min and will report
> when it hits the manual-approval step.

## What shipped this session (in order)

### 1. The integrations fix (commit `75d4f4c`, merged to `main` via PR #70)

**Bug**: every integration connect modal (Notion, Airtable, HubSpot,
Slack, Zapier) returned `{"error":"Invalid or expired session"}` on
staging.

**Root cause**: `supabase-js@2.108` (resolved from `^2.45.4`) added a
`hasCustomAuthorizationHeader` flag on `GoTrueClient`. When the
server-side supabase client has no session and that flag is unset,
`supabase.auth.getUser()` (no args) short-circuits with
`AuthSessionMissingError` — even though the global `Authorization`
header IS set and the request *would* send the bearer.

The check is in `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`:
```js
if (!data.session?.access_token && !this.hasCustomAuthorizationHeader) {
  return { data: { user: null }, error: new AuthSessionMissingError() };
}
```

**Fix**: extract the JWT from the request and pass it directly to
`getUser(jwt)`. The `jwt` parameter bypasses the flag check entirely.

**Files**:
- `netlify/functions/integrations-{airtable,hubspot,notion,slack,zapier}.js` (5 files)
- `netlify/__tests__/integrations-{airtable,hubspot,notion,slack,zapier}.test.js` (5 files, regression test)

**Same bug, NOT YET FIXED** (5 more files, will 401 every request on
the current `staging` deploy):
- `netlify/functions/extractions.js`
- `netlify/functions/schedules.js`
- `netlify/functions/invoice-email.js`
- `netlify/functions/invoice-pdf.js`
- `netlify/functions/lib/requireEntitlement.js`

These are the next commit when the user hits them. Regression test
pattern is in `netlify/__tests__/integrations-notion.test.js` describe
block "auth passes JWT explicitly to getUser (2026-08-12 fix)".

### 2. CI local-first (commit `4fae5e3`, merged to `main` via PR #72)

**Goal**: cut ~40% of GH Actions minutes, put fast feedback on the
laptop instead of in the GH queue.

**Three changes, all live**:

1. **Pre-push hook** (`scripts/pre-push.sh` → `.git/hooks/pre-push`)
   - 8 local gates before every push: readiness, unit, contract,
     integration, system, db, build, security. ~25s on warm cache.
   - Smart docs-only skip: `docs/`, `public/help/`, `.claude/`, `*.md`
     → <1s exit
   - Bypass: `git push --no-verify`. Force: `PREPUSH_FORCE=1 git push`.
   - Install on new machine: `npm run ci:install-hook`

2. **`paths-ignore` on both workflows** (`staging-gate.yml` +
   `phase-gate.yml`)
   - Docs-only pushes cost 0 GH minutes
   - Workflows also filter `pull_request` triggers the same way

3. **Playwright + node_modules cache** (both workflows)
   - `actions/cache@v4` with key `playwright-{os}-{package-lock-hash}`
   - `node_modules` was already cached by `setup-node@5`'s built-in
     `cache: "npm"`; this adds the browser binary cache
   - Saves ~90s on warm cache, ~3min on cold

**Self-hosted runner setup ready, NOT enabled**:
- `scripts/setup-runner.sh` — one-shot installer for the dedicated
  box (handles macOS + Linux, SHA-256 verify, launchd/systemd service
  install, pre-warm Node + Playwright)
- `docs/CI-LOCAL-FIRST.md` — full design doc + decision record +
  rollout plan

**To enable when the dedicated box arrives**:
1. GH UI → Settings → Actions → Runners → New self-hosted runner
2. Export `RUNNER_CFG_URL` + `RUNNER_CFG_TOKEN` from the config command
3. `./scripts/setup-runner.sh`
4. Change `runs-on: ubuntu-latest` to `runs-on: self-hosted` in both
   workflow files (one line each)
5. Rollback: GH UI → set runner to "Offline" → jobs fall back to
   GitHub-hosted

## Current state (verbatim)

| | SHA | Commit |
|---|---|---|
| `HEAD` (local) | `4fae5e3` | ci(local-first) — same as `origin/staging` |
| `origin/staging` | `4fae5e3` | ci(local-first) |
| `origin/main` | `ba4ce6b` | Merge pull request #72 from vikashkaruna/staging |
| Working tree | clean | nothing to commit |
| GitHub Actions | run **31628841444** in progress | Phase-Gate Production Deploy |

**In flight**: GH Actions run 31628841444 triggered by the PR #72
merge to main. As of last poll (00:15 IST):
- ✓ Production Gate: Open Issues/Defects (success)
- ⏳ Production Gate: Test Suites (in progress — cold cache on first
  run after the cache config change, expect ~3 min)
- ✓ Production Gate: Vulnerabilities (success)
- ⏳ Staging Released & Tested (queued, needs 1–3)
- ⏳ Await Manual Approval (queued, needs 4)
- ⏳ Deploy to Production (queued, needs 5)
- ⏳ Smoke Test — Production (queued, needs 6)
- ⏳ Re-lock Production (queued, needs 7)

**What to do when the run reaches "Await Manual Approval"**:
- The cron (`phase-gate-72-check`) will surface the approval issue link
- Comment `approved` on the issue to release the production deploy
- **Do NOT** unlock production in Netlify UI until you're ready to
  release — Netlify's "Stop auto publishing" lock is the safety net

## Verified this session

- `npm test` — 3317/3317 pass, 14 skipped
- `npm run build` — clean (~1s)
- `npm run readiness` — 5 pass / 2 warn / 0 fail (warns pre-existing)
- Pre-push hook end-to-end — 25s for 8-gate run, all green
- Pre-push docs-only skip — <1s, friendly message
- `setup-runner.sh` no-args — clear instructions
- YAML valid for both workflow files
- All 4 staging-gate checks on PR #72 — green
- PR #72 merged, phase-gate triggered

## Files added/modified this session

**Added** (3):
- `scripts/pre-push.sh` (5306 bytes, executable)
- `scripts/setup-runner.sh` (11131 bytes, executable)
- `docs/CI-LOCAL-FIRST.md` (10143 bytes, design doc)

**Modified** (8):
- `netlify/functions/integrations-{airtable,hubspot,notion,slack,zapier}.js` (5 functions)
- `netlify/__tests__/integrations-{airtable,hubspot,notion,slack,zapier}.test.js` (5 test files)
- `.github/workflows/phase-gate.yml` (paths-ignore + Playwright cache)
- `.github/workflows/staging-gate.yml` (paths-ignore + Playwright cache)
- `package.json` (added `test:prepush` + `ci:install-hook` scripts)

**Installed (not committed)**:
- `.git/hooks/pre-push` — copy of `scripts/pre-push.sh`. Re-install
  with `npm run ci:install-hook` on a new machine or after `rm`.

## Next session — recommended entry point

```sh
# 1. Check on the in-flight phase-gate
gh run view 31628841444 --json status,conclusion,jobs

# 2. If it's at "Await Manual Approval" — comment 'approved' on the issue

# 3. If it's done — verify production smoke passed, then check the
#    auto-deploy (the workflow re-locks production at the end, so
#    datiq.app should be on a fresh deploy + locked again)

# 4. The 5 still-broken files (extractions, schedules, invoice-email,
#    invoice-pdf, lib/requireEntitlement) — fix them in the same
#    pattern as the integrations fix. Memory entry has the full
#    template; regression test pattern in integrations-notion.test.js.
```

## Memory entries added this session

- `supabase-js v2.108+ getUser() AuthSessionMissingError on server` —
  full root cause analysis + fix template + list of affected files
- The 5 already-fixed files + the 5 still-broken files (so the next
  session doesn't miss them)

## Cron active

- `phase-gate-72-check` (every 3 min) — polls GH run 31628841444.
  Reports only on state change (approval, failure, success). Auto-
  deletes on success.
