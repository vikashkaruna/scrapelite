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
5. **Manual approval** — the `Deploy to Production` job runs in the
   **`production-release`** GitHub environment. With required reviewers configured,
   GitHub pauses the run until a reviewer clicks **Approve** in the Actions UI.
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
> is public or the account is on Pro, the settings below CANNOT be enforced by GitHub —
> the workflows still run and report red/green, but nothing physically blocks a merge
> or auto-approves the pause. Options: (a) upgrade to GitHub Pro (~$4/mo),
> (b) make the repo public, or (c) rely on the workflow gates + discipline.

Once on Pro (or public):

1. **Branch protection — `staging`**: require status checks
   `Staging Gate: Test Suites`, `Staging Gate: Vulnerabilities`,
   `Staging Gate: Open Issues/Defects`.
2. **Branch protection — `main`**: require PR + at least
   `Staging Gate: Test Suites` (the PR-into-main run), plus the production gate
   runs on push.
3. **Environment `production-release`**: required reviewer(s) = release approvers;
   deployment branches restricted to `main`.
4. **Environment `staging-release`**: no reviewers; deployment branches restricted
   to `staging`.

## Secrets used

| Secret | Scope | Used by |
|---|---|---|
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | repo | staging converge check, prod deploy, rollback |
| `STAGING_ADMIN_PIN` | repo or `staging-release` env | staging smoke admin probes |
| `PRODUCTION_ADMIN_PIN` | `production-release` env | production smoke admin probes |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RAZORPAY_KEY_ID`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_WEBHOOK_URL` | `production-release` env | production build |
| `SLACK_WEBHOOK_URL` | repo (optional) | failure notification |

## Known operational notes

- Netlify also auto-publishes `main` pushes unless **auto-publish is turned OFF** for
  production in Netlify — otherwise the site updates before the manual approval.
  Turn it off so the phase-gate owns the production deploy (flagged in
  `NETLIFY-ENVIRONMENTS.md` and the 2026-07-19 handoff).
- `staging.datiq.app` must be wired as a Netlify branch deploy for the staging gate's
  deploy-verified job and the production gate's staging check to pass.
- The old production smoke step swallowed its own exit code (`set +e` + output capture),
  so the auto-rollback never fired; fixed on 2026-07-20 — the step now fails naturally
  and `if: failure()` triggers the rollback.
