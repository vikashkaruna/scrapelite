# DatIQ Phase-Gate — staging + production release policy

> Last updated: 2026-07-20 (branch `phase-gate-production-and-staging`)

Two gated pipelines protect releases:

| Pipeline | Workflow | Trigger | Deploys to |
|---|---|---|---|
| **Staging Gate** | `.github/workflows/staging-gate.yml` | push to `staging`, PRs into `staging`/`main` | `staging.datiq.app` (Netlify branch deploy) |
| **Phase-Gate Production Deploy** | `.github/workflows/phase-gate.yml` | push to `main`, manual dispatch | `datiq.app` (Netlify prod, via CI CLI deploy) |

## Staging release conditions (branch `staging`)

1. **Whatever is pushed for feature testing** lands on `staging` (direct push or PR).
2. **`Staging Gate: Test Suites`** — unit (functional + regression), contract,
   integration, system, production build, Playwright end-to-end smoke, security suite.
3. **`Staging Gate: Vulnerabilities`** — `npm audit`; high/critical advisories block
   unless bypassed in `.github/gate-bypass/vulnerabilities.json` **with a TODO + expiry**.
4. **`Staging Gate: Open Issues/Defects`** — open issues labeled
   `bug`/`defect`/`vulnerability`/`regression` block unless the issue carries the
   `gate-bypass` label **and** a `TODO:` note in its body.
5. **`Staging Gate: Deployed & Smoke Tested`** — after the three checks pass on a push,
   waits for the Netlify staging branch deploy to converge on the pushed commit and
   runs `scripts/smoke-prod.mjs https://staging.datiq.app`. Uses the `staging-release`
   GitHub environment (no reviewers — staging is self-serve).

## Production release conditions (branch `main`)

1. **`Production Gate: Test Suites`** — same full suite as staging.
2. **`Production Gate: Vulnerabilities`** — same audit + bypass policy.
3. **`Production Gate: Open Issues/Defects`** — same defect policy.
4. **`Staging Released & Tested`** — the live staging deploy must be **ready and
   healthy** (smoke-tested), and its commit must be an **ancestor of the main commit**
   being released. This proves everything shipped to staging first. Hotfix escape
   hatch: `workflow_dispatch` with `bypass_staging_check: true` (leave a TODO in the
   release notes).
5. **Manual approval** — the `Await Manual Approval` job pauses the run, opens a
   GitHub **approval issue**, and blocks until an authorized approver comments
   `approved` (or `denied` to cancel). This uses
   [`trstringer/manual-approval`](https://github.com/trstringer/manual-approval) and
   works on a **private repo on the GitHub Free plan** — see the free-plan section
   below. `deploy-production` runs only after this passes.
6. **Post-deploy smoke + auto-rollback** — `scripts/smoke-prod.mjs https://datiq.app`;
   any failure triggers `netlify-cli rollback` to the last good deploy and a Slack alert.

## Bypass policy (both gates)

No silent bypasses. See [.github/gate-bypass/README.md](../.github/gate-bypass/README.md):

- **Vulnerability** bypass = allowlist entry with `todo` + unexpired `expires`.
- **Defect** bypass = `gate-bypass` label + `TODO:` in the issue body.
- Expired or TODO-less bypasses are rejected and the gate goes red again.

## Required GitHub settings (manual, one-time)

> ⚠️ **Plan limitation (verified 2026-07-20):** this repo is **private on the GitHub
> Free plan**. Branch protection rules / rulesets and environment *required reviewers*
> return `403: Upgrade to GitHub Pro or make this repository public`. Until the repo
> is public or the account is on Pro, these settings CANNOT be enforced by GitHub.
> **The free-plan alternative below is implemented and does not need any of them.**

Once on Pro (or public) you *may* additionally lock things at merge-time:

1. **Branch protection — `staging`**: require status checks
   `Staging Gate: Test Suites`, `Staging Gate: Vulnerabilities`,
   `Staging Gate: Open Issues/Defects`.
2. **Branch protection — `main`**: require PR + at least
   `Staging Gate: Test Suites` (the PR-into-main run), plus the production gate
   runs on push.
3. **Environment `production-release`**: required reviewer(s) = release approvers.
   (Additive — the in-workflow approval already enforces this on Free.)
4. **Environment `staging-release`**: no reviewers; deployment branches restricted
   to `staging`.

## Free plan alternative (implemented — no Pro, no public repo)

Merge-time locks are Pro-only, so enforcement is moved to **deploy-time**, which is
free. Bad code can land on `main`, but it can never *ship* unless the gate is green
**and** a human approves.

1. **Manual approval without Environment reviewers** — `phase-gate.yml` has an
   `Await Manual Approval` job using `trstringer/manual-approval`. It opens an issue
   and blocks the deploy until an approver in the `approvers:` list comments
   `approved`. Uses Issues (`issues: write`), not the Pro-only reviewers feature.
   Update the `approvers:` list in `.github/workflows/phase-gate.yml` to your release
   owners.
2. **Required checks without branch protection** — the deploy chain is
   `test-suites → vulnerabilities → open-defects → staging-released → approve →
   deploy-production`. Any red gate skips the deploy. The same checks also run on PRs
   into `main`/`staging`, so a failing gate shows a red ✗ on the PR (merge by
   discipline instead of by lock).
3. **⚠️ REQUIRED: turn OFF Netlify auto-publish for production.** This is the one
   real hole — Netlify auto-deploys every push to `main`, bypassing this workflow
   entirely. In Netlify → **Site → Build & deploy → Continuous deployment →
   Production branch → Stop auto publishing**. After this, production changes only
   via the gated `netlify deploy --prod` step (post-approval). Keep **staging** on
   auto-publish so feature testing stays fast.
4. *(Optional first line)* add a local pre-push hook (husky) running
   `npm run test:unit` so most breakage never reaches `main`.

## Secrets used

| Secret | Scope | Used by |
|---|---|---|
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | repo | staging converge check, prod deploy, rollback |
| `STAGING_ADMIN_PIN` | repo or `staging-release` env | staging smoke admin probes |
| `PRODUCTION_ADMIN_PIN` | `production-release` env | production smoke admin probes |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RAZORPAY_KEY_ID`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_WEBHOOK_URL` | `production-release` env | production build |
| `SLACK_WEBHOOK_URL` | repo (optional) | failure notification |

## Known operational notes

- **Netlify auto-publish for production MUST be OFF** (see "Free plan alternative"
  above) — otherwise the site updates on every `main` push before the manual
  approval and the whole gate is bypassed. This is the single most important
  operational step on the Free plan.
- `staging.datiq.app` must be wired as a Netlify branch deploy for the staging gate's
  deploy-verified job and the production gate's staging check to pass.
- The old production smoke step swallowed its own exit code (`set +e` + output capture),
  so the auto-rollback never fired; fixed on 2026-07-20 — the step now fails naturally
  and `if: failure()` triggers the rollback.
