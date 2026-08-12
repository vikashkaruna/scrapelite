# CI Local-First

> Run tests locally before pushing. Stop paying for GitHub Actions minutes on
> pushes that would fail the same gate on your laptop in 30 seconds.

This is the developer-machine-first CI strategy for DatIQ. Three small changes
replace ~40% of GitHub Actions minute usage with a local pre-push hook that
catches the same failures in seconds, plus workflow caching that halves the
remaining remote time. The fourth change — a self-hosted runner — is documented
and ready to enable when a dedicated box becomes available.

| | Before | After |
|---|---|---|
| Time to know a push will fail | ~5 min (GH queue + run) | ~30s (local hook) |
| GH Actions minutes per code push | ~5 min | ~3 min (warm cache) |
| GH Actions minutes per docs push | ~5 min | **0** (paths-ignore) |
| First-time setup on new box | n/a | one `npm run ci:install-hook` |

## What changed

### 1. Pre-push hook — `scripts/pre-push.sh` → `.git/hooks/pre-push`

Every `git push` now runs the same gates as the Staging Gate, minus the e2e
step. The hook:

- Fetches the upstream branch and diffs the commit range.
- **If every changed file is in `docs/`, `public/help/`, `.claude/`, or a
  `*.md` file**: prints `docs-only diff, skipping tests` and lets the push
  through in <1 second. This is the local equivalent of the workflow's
  `paths-ignore`.
- Otherwise, runs in order:
  1. `npm run readiness` — admin-leak / email-split / screenshot / pricing
  2. `npm run test:unit` — 88+ test files, ~30s on warm cache
  3. `npm run test:contract` — Netlify functions, ~5s
  4. `npm run test:integration` — cross-module integration, ~5s
  5. `npm run test:system` — full-stack system tests, ~5s
  6. `npm run test:db` — in-process WASM Postgres + all migrations, ~5s
  7. `npm run build` — production Vite build, ~1s
  8. `npm run test:security` — secret scan + dependency review, ~3s
- **Stops on first failure** with the failing step name, elapsed seconds, and
  a hint to bypass with `git push --no-verify`.
- **Bypass**: `git push --no-verify` (git's standard escape hatch).
- **Force run** (skip the docs-only skip): `PREPUSH_FORCE=1 git push`.
- **Color output** when stdout is a TTY, plain text otherwise.

The e2e step is intentionally NOT in the hook — it's the slowest single step
(~3 min) and is the only one whose install path can diverge from CI
(`playwright install --with-deps chromium` runs `apt` on Ubuntu but
`brew install` on macOS). Run `npm run test:all` manually before a release
push if you want the full local belt-and-suspenders.

Install:  `npm run ci:install-hook`  (one-time per machine)

### 2. `paths-ignore` on both workflows

`.github/workflows/staging-gate.yml` and `.github/workflows/phase-gate.yml`
both add `paths-ignore` to `on.push` and `on.pull_request`:

```yaml
paths-ignore:
  - 'docs/**'
  - 'public/help/**'
  - '.claude/**'
  - '*.md'
  - 'CHANGELOG.md'
```

A push or PR that touches ONLY these paths is silently dropped by GitHub —
no run is created, no minutes used. The pre-push hook also handles this
locally (a docs-only commit exits the hook in <1s with a friendly message),
so the only way to hit a docs-only GH run is if you authored the commit on
a machine without the hook installed. The `paths-ignore` is the second line
of defense.

What about `workflow_dispatch`? It stays unfiltered — manual runs always
execute, regardless of path.

### 3. Playwright cache in both workflows

Both workflows add a cache step before `npm ci`:

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      playwright-${{ runner.os }}-
```

`actions/setup-node@v5` already caches `node_modules` via the built-in
`cache: "npm"` option, so we only needed to add the browser cache. The
e2e step (`npx playwright install --with-deps chromium`) sees the cached
binary and skips the download, saving ~90s on warm cache and ~3 min on
cold. The apt step inside `--with-deps` is still cheap (idempotent).

Cache key strategy: keyed on `package-lock.json` hash, so any change to
playwright's version busts the cache correctly. `restore-keys` provides
a partial match fallback — if a `package-lock.json` change broke the
exact match, the most recent Playwright version cache is used (saving
~90s even on the first run after a lockfile change).

## What did NOT change

- **Test commands** — `npm run test:unit`, `test:contract`, etc. are
  unchanged. The hook just sequences them.
- **Workflow jobs** — the 4 jobs in staging-gate (Test Suites,
  Vulnerabilities, Open Defects, Deployed & Smoke Tested) and the 8 jobs
  in phase-gate are unchanged. The cache and paths-ignore are
  add-ons, not replacements.
- **Manual approval gate** — `phase-gate.yml` still pauses for `approved`
  comment before deploying. No local check replaces that.

## Operational notes

### Bypass the hook

```sh
git push --no-verify
```

Use this for:
- WIP commits you're intentionally pushing to a branch nobody else reads.
- A test fix that needs to land before you can re-run the failing test
  (chicken-and-egg). Fix the test on the next push.

Never use this to "just get the green button" — that's how 5-min GH runs
become 30-min debug sessions.

### Skip the docs-only filter

```sh
PREPUSH_FORCE=1 git push
```

Use when you've changed docs but also want to confirm a working tree is
clean (e.g. before tagging a release).

### Run the same gates manually

```sh
npm run test:prepush   # mirrors the hook, minus the e2e step
npm run test:all       # mirrors the full Staging Gate (with e2e)
```

### Hook didn't run on a push

The hook lives at `.git/hooks/pre-push` — that path is per-repo, not
checked into git. If you clone fresh, run `npm run ci:install-hook`.
A `.git/hooks/pre-push` symlink to `scripts/pre-push.sh` would survive
clones (git tracks the symlink content) but means deleting the file
deletes the hook. We chose a copy + chmod approach so the script
source-of-truth is committed.

## Self-hosted runner (option #5)

When you bring up the dedicated box (mini PC, old laptop, home server),
the upgrade path is:

1. **Provision the box**: Ubuntu 22.04+ or macOS 13+, 2 vCPU / 4 GB RAM /
   20 GB disk is enough. Static IP or DNS entry optional.
2. **Set up a `runner` user**, give it sudo for `./svc.sh install` only
   (the script asks for sudo once).
3. **Run the installer**:
   ```sh
   # In GitHub: Settings → Actions → Runners → New self-hosted runner.
   # Copy the --url and --token from the config command it gives you.
   export RUNNER_CFG_URL='https://github.com/vikashkaruna/scrapelite'
   export RUNNER_CFG_TOKEN='AAA...'
   export RUNNER_NAME='datiq-runner-01'  # optional, default shown
   ./scripts/setup-runner.sh
   ```
4. **Switch the workflows**: change `runs-on: ubuntu-latest` to
   `runs-on: self-hosted` in BOTH workflow files. Keep an
   `ubuntu-latest` fallback as a comment for emergency (see "Rollback"
   below). Commit + push.
5. **Verify**: push a test commit and watch the Actions tab — the run
   should land on your box within ~5s. The runner label `self-hosted`
   is in the UI, not `GitHub-hosted 4 CPU`.
6. **Optional — drain to GitHub for a deploy**: in the GH UI,
   mark the runner "Offline" before a risky production deploy so it
   falls back to GitHub-hosted runners (proven env, no surprises).

### What changes when self-hosted is enabled

| | GitHub-hosted | Self-hosted |
|---|---|---|
| GH minutes used | ~5 min/push | **0** (free) |
| Playwright install per run | ~90s (cache miss) | **0** (pre-warmed by the install script) |
| Network access to localhost | Blocked | Allowed (useful for `vite preview` smoke) |
| Uptime | GitHub's problem | Your problem (box must be on) |
| Hardware cost | Pay per minute | Pay per month (electricity) |

### What does NOT change

- The workflows themselves are byte-for-byte identical except for
  `runs-on:`. The same gates, the same caches, the same timeouts.
- The pre-push hook stays — it catches the same failures in 30s
  instead of 5 min even on the self-hosted box.
- The manual-approval gate still works (it runs in the GH UI, not
  on the runner).

### Rollback (if the box dies mid-day)

1. In the GH UI: Settings → Actions → Runners → set `datiq-runner-01` to
   "Offline". New jobs route back to GitHub-hosted runners.
2. (Optional) Revert the `runs-on: self-hosted` → `runs-on: ubuntu-latest`
   in both workflows and push. The pre-push hook still works during
   this revert.

### Cost-benefit (worked example)

If the box is a 10W idle mini PC running 24/7:
- 10W × 24h × 30d = 7.2 kWh/month ≈ $1.50 (US avg) or ₹120 (India avg)
- Current GH Actions usage (rough estimate from 5-min pushes × ~60 pushes/month):
  5 min × 60 = 300 min/month on a private repo Free plan = $0 (Free) or
  $0.008/min on a paid plan (Linux) = $2.40/month
- Break-even: ~$2.40/month of GH minutes OR equivalent availability savings
  when the box also serves other purposes (e.g. self-hosted Supabase,
  a personal dashboard, a backup target). The break-even is usually NOT
  financial — it's "I want faster, predictable CI without depending on
  GH's queue."

## Decision record (2026-08-12)

**Why not `act`?** Docker overhead on macOS is 5–15 min per run. The
pre-push hook gives 80% of the value in 30s.

**Why not stop running e2e in CI?** The 3-min Playwright cost is
worth the insurance: e2e catches the "looks-green-on-Mac, breaks-on-
Netlify" class of bugs (CORS, cookies, redirects). The cache halves
the cost; the self-hosted upgrade takes it to zero.

**Why not move all CI to a self-hosted runner from day one?** No
dedicated box exists yet. The local-first + cache changes pay for
themselves immediately. The self-hosted upgrade is a deliberate second
step once hardware is available.

**Why docs-ignore on the hook AND the workflow?** Belt and suspenders.
The hook handles the common case (your laptop). The workflow handles
the edge case (CI runs from a PR opened by a contributor without the
hook installed).
