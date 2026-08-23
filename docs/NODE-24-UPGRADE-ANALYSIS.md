# DatIQ Node.js 24 and Ecosystem Upgrade Analysis

**Date:** 2026-08-21  
**Scope:** GitHub Actions, local development, Netlify builds and Functions, frontend toolchain, database/runtime tooling, payments, and the MV3 browser extension.  
**Status:** **Executed. Phases 1–5 complete as of 2026-08-23.** This document was written as analysis only; the execution record and the two places where reality diverged from the plan are appended at the end, under "Execution record". Read that section before treating any statement above it as current — in particular, the React Router section below is preserved as written but its security premise has since expired.

## Executive recommendation

Standardize on **Node.js 24 LTS** for CI, local development, Netlify builds, and Netlify Functions.

Node 20 is EOL. Node 24 is an LTS release line supported through April 2028. Node 26 is currently a Current release and should not be the production baseline yet.

Sources:

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Node.js 22-to-24 migration guide](https://nodejs.org/en/blog/migrations/v22-to-v24)

## GitHub Actions warning analysis

The workflows contain ten explicit `node-version: "20"` entries:

- `.github/workflows/staging-gate.yml`
- `.github/workflows/phase-gate.yml`

Those entries select the Node version used by workflow commands such as `npm ci`, tests, builds, and smoke scripts. They should be moved to Node 24.

There is also a separate GitHub Action runtime issue:

| Current action | Finding | Recommendation |
|---|---|---|
| `actions/checkout@v5` | Already uses Node 24 internally | Keep initially |
| `actions/setup-node@v5` | Already uses Node 24 internally | Keep initially |
| `actions/cache@v4` | Uses Node 20 internally | Upgrade to `actions/cache@v5` |
| `slackapi/slack-github-action@v1.27.0` | Uses Node 20 internally | Upgrade to `v3.0.3`, then test failure notification |
| `trstringer/manual-approval@v1` | Docker-based action; not the primary Node warning source | Keep unless a maintained replacement is required |

GitHub's migration guidance requires Node 24-compatible Action releases during the transition. `actions/cache@v5` requires Actions Runner `v2.327.1+`.

Sources:

- [GitHub Node 20 deprecation notice](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)
- [actions/setup-node documentation](https://github.com/actions/setup-node/blob/main/README.md)
- [actions/cache documentation](https://github.com/actions/cache)
- [Slack Action v3 release notes](https://github.com/slackapi/slack-github-action/releases/tag/v3.0.0)

The first-party `checkout` and `setup-node` actions should not be upgraded further merely to resolve this warning: their current versions already use Node 24 internally. Newer major versions can be reviewed separately for action-maintenance reasons.

## Application compatibility findings

The application is already compatible with Node 24 at the code and dependency-engine level:

- Vite 8 requires Node `20.19+` or `22.12+`.
- Vitest 4 supports Node 24.
- Playwright supports Node 24.
- Supabase JS supports Node 24.
- Netlify Functions support Node 24.
- The MV3 browser extension has no separate Node runtime dependency.

Node 24 includes stable native WebSocket support. The existing Supabase `NoRealtimeTransport` workaround should remain as defensive compatibility because the server code does not use Realtime and the regression test intentionally verifies behavior in an environment without global WebSocket.

Sources:

- [Vite compatibility](https://vite.dev/guide/)
- [Node.js WebSocket documentation](https://nodejs.org/api/globals.html)

## Validation already performed

The repository was tested locally under Node `v24.16.0` without tracked source changes:

- Production build: passed.
- Unit tests: `1,979 passed` across `124` files.
- Netlify contract tests: `1,342 passed`, `14 skipped`.
- Database verification: `26` migrations and `129` assertions passed.
- Security checks: passed.
- MV3 browser-extension build: passed.

The build still emits existing non-blocking Vite warnings about large chunks and ineffective dynamic imports. The unit run also emits existing jsdom canvas warnings.

The local `node_modules` tree is stale: it contains `react-router-dom@6.30.4` while the lockfile requires `7.18.2`. `npm ci --dry-run` confirms the lockfile is consistent. A clean install is required before using local results as the final migration baseline.

## Netlify platform changes required

Netlify has two relevant settings:

1. Build version: `NODE_VERSION=24`.
2. Functions runtime: `AWS_LAMBDA_JS_RUNTIME=nodejs24.x`.

The second setting must be configured through Netlify UI, CLI, or API; it should not be added to `netlify.toml`.

Update staging first, then production:

1. Set both values in the staging context.
2. Redeploy staging.
3. Verify the Functions manifest.
4. Run API, auth, Supabase, integration, scheduler, payment-webhook, and admin smoke checks.
5. Verify `/admin/health` reports the expected runtime.
6. Repeat for production only after staging passes.

Sources:

- [Netlify dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/)
- [Netlify Functions runtime configuration](https://docs.netlify.com/build/functions/configuration/?fn-language=js)

## Repository consistency work

The following files contain Node 20 references and should be updated during implementation:

- `scripts/setup-runner.sh`
- `NETLIFY-ENVIRONMENTS.md`
- `docs/PRODUCTION-RELEASE-V1.0.md`
- `netlify/functions/lib/supabaseServerClient.js`
- `netlify/__tests__/lib/supabaseServerClient.test.js`
- Any workflow examples in documentation that still use old Action versions

Add one version source of truth, preferably `.node-version` containing `24`, and have CI use `node-version-file`. Add a Node engine declaration to `package.json`; optionally pin npm 11 through `packageManager` for reproducible local and Netlify installs.

If self-hosted runners are enabled later, they must use Actions Runner `v2.327.1+`. Node 24 also requires macOS 13.5+ and does not support ARM32.

## Dependency refresh assessment

These updates are appropriate as separate, low-risk refreshes after the runtime migration:

| Surface | Current lock baseline | Recommended treatment |
|---|---:|---|
| Vite | 8.1.5 | Update within Vite 8 to the latest validated patch/minor |
| `@vitejs/plugin-react` | 5.2.0 | Review upgrade to the Vite 8-compatible 6.x line |
| Vitest | 4.1.10 | Update within Vitest 4 |
| Playwright | 1.60.0 | Update within 1.x; review browser/snapshot changes |
| Supabase JS | 2.108.0 | Update within 2.x after Node 24 rollout |
| PGlite | 0.5.4 | Update within 0.5.x |
| Razorpay | 2.9.6 | Patch update only |
| Stripe | 17.7.0 | Do not blindly upgrade to 22.x; perform a payment/webhook contract migration separately |
| Tailwind CSS | 3.4.19 | Keep 3.x; Tailwind 4 is a separate CSS/config migration |
| jsdom | 25.0.1 | Keep initially; evaluate 30.x separately because test behavior may change |
| React | 18.3.1 | Keep for the Node migration; upgrade separately with Router |
| React Router | 7.18.2 | Security/major migration required separately |

Tailwind 4 is a workflow change rather than a routine version bump. The current CSS-token design system should not be rewritten as part of this runtime work.

Source: [Tailwind compatibility guidance](https://tailwindcss.com/docs/compatibility)

## Separate high-priority React Router security migration

> ⚠️ **Superseded — read this first.** The premise below ("cannot be cleanly resolved while remaining on React 18") was true when written and is no longer true. GHSA-qwww-vcr4-c8h2 was subsequently amended; its affected ranges are `>=7.12.0 <7.18.2` and `>=8.0.0 <8.3.0`, so **react-router 7.18.2 — the version this repo was already pinned to — is the 7.x patch**. `npm audit` reported 0 vulnerabilities before the migration ran. The migration was still carried out (see "Execution record"), but as planned modernization, **not** as a security fix, and it should not be cited as one.

The repository's vulnerability bypass records a React Router advisory that cannot be cleanly resolved while remaining on React 18.

React Router v8 requires:

- `react@19.2.7+`
- `react-dom@19.2.7+`
- Node `22.22+`

React Router v8 also removes the `react-router-dom` re-export package. This repository currently imports `react-router-dom` from approximately 107 source/test files, so this should be an independently staged migration rather than being bundled into the Node change.

Recommended sequence:

1. Update to the latest React Router 7.x.
2. Adopt the available v8 future flags and remove deprecation warnings.
3. Upgrade React 18.3 to React 19.2.
4. Replace `react-router-dom` imports with `react-router` and `react-router/dom` as appropriate.
5. Remove the vulnerability bypass only after security checks pass.

Sources:

- [React Router v7-to-v8 guide](https://reactrouter.com/upgrading/v7)
- [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19)

## Recommended implementation phases

### Phase 1 — Runtime source of truth

- Add `.node-version` with Node 24.
- Add Node/npm engine metadata.
- Change both workflows to use the version file.
- Change `scripts/setup-runner.sh` default from Node 20 to Node 24.
- Perform a clean `npm ci`.

### Phase 2 — GitHub Actions warning cleanup

- Upgrade `actions/cache@v4` to `@v5`.
- Upgrade Slack Action to `v3.0.3`.
- Run the production failure-notification path in a controlled test.
- Keep `checkout@v5`, `setup-node@v5`, and manual approval unchanged initially.

### Phase 3 — Netlify staging rollout

- Set `NODE_VERSION=24`.
- Set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x`.
- Deploy staging.
- Verify Functions, auth, Supabase, integrations, scheduled jobs, payments, and admin health.

### Phase 4 — Production rollout

- Apply the same Netlify settings to production.
- Use the existing phase gate and manual approval.
- Run production smoke tests.
- Confirm rollback remains available.

### Phase 5 — Independent ecosystem upgrades

- React 19 + React Router 8 security migration.
- Vite/plugin, Vitest, Playwright, Supabase, PGlite, and patch-level package refresh.
- Separate Stripe major-version contract review.
- Separate Tailwind 4 evaluation.

## Final decision

Use Node 24 LTS as the stable platform baseline. Resolve the GitHub warning first by updating the Node 20-based Actions (`cache` and Slack), then align Netlify build and Functions runtimes. Keep the React Router security migration and major dependency refreshes separate for safer rollback and diagnosis.


---

# Execution record

**Executed:** 2026-08-23, on branch `claude/node-24-upgrade-phase-5-5d22d9` (cut from `origin/staging` = `origin/main` = `3f863ad`).

## Phase status

| Phase | State | Evidence |
|---|---|---|
| 1 — Runtime source of truth | Complete | `75d0cf4` / `bc79f58`, on `origin/main` and `origin/staging`. `.node-version`=24, `engines.node >=24 <25`, `engines.npm >=11 <12`, `packageManager npm@11.15.0`, both workflows on `node-version-file`. |
| 2 — Actions warning cleanup | Complete | `actions/cache@v5`, `slackapi/slack-github-action@v3.0.3`. `checkout@v5` / `setup-node@v5` / `manual-approval@v1` unchanged, as planned. |
| 3 — Netlify staging rollout | Complete, verified | `NODE_VERSION=24` + `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` on the `staging` branch context. |
| 4 — Production rollout | Complete, verified | Same two values on `production`. All 41 deployed functions report runtime `nodejs24.x` on production, on the staging branch-deploy, and on deploy-previews. |
| 5 — Ecosystem upgrades | Complete for the sanctioned scope; Stripe and Tailwind deliberately deferred (see below). | Commits `af18096` (5A) and the 5B commit that follows it. |

Phases 3 and 4 were verified against the live Netlify API rather than inferred from the merge history — a merged commit is no evidence at all about platform state, and this is exactly the seam where a phased migration loses work between sessions.

## Deviations from the plan

### 1. The React Router migration was NOT a security fix

The plan, and the vulnerability bypass it cited, both rest on "no patched version exists for React 18." That has since stopped being true. GHSA-qwww-vcr4-c8h2 was amended; its affected ranges are `>=7.12.0 <7.18.2` and `>=8.0.0 <8.3.0`, which makes **react-router 7.18.2 — already the pinned version — the 7.x patch**. `npm audit` reported 0 vulnerabilities before any Phase 5 work began.

The migration was still performed, on the standing maintenance argument (`react-router-dom@7.18.2` is that package's final release; v8 drops it). But it must not be described as remediating an advisory, and the bypass entries were removed because they were obsolete, not because the upgrade earned their removal.

The general lesson is recorded in `.github/gate-bypass/vulnerabilities.json`: a bypass captures a judgement about the world on the day it was written, and advisories get re-scoped. Re-read the advisory before renewing one.

### 2. React 19 silently broke the mobile nav's focus containment

`TopBar.jsx` guarded the closed mobile menu with `inert={!isOpen ? "" : undefined}`. That only ever worked because React 18 did not recognise `inert` and forwarded the empty string as a bare attribute, which HTML reads as true. React 19 recognises `inert` as a boolean prop, so `""` coerces to **false** and the attribute is dropped — restoring the precise bug that line's own comment says it exists to prevent: Tab walking into the offscreen menu.

React only warns about this. **Nothing failed.** The entire suite — 3,640 tests — stayed green while the app shipped a real keyboard-accessibility regression, because no test asserted inertness. It was caught by reading new warnings in the e2e log against the pre-change baseline, not by a red test.

Fixed to `inert={!isOpen}`, and covered by a regression test in `TopBar.integration.test.jsx` that asserts the rendered DOM attribute (not the prop) and was confirmed to fail against the old code before being accepted. A sweep for the same empty-string-as-boolean pattern across every other boolean HTML attribute found no further instances.

### 3. `resolve.dedupe` had to be restated by hand

`@vitejs/plugin-react` 6 stopped adding react and react-dom to `resolve.dedupe` implicitly. `vite.config.js` now says it explicitly. This is inert today (one React resolves in the tree) and exists so a duplicate arriving through a transitive dependency fails visibly rather than as an "invalid hook call" far from its cause.

### 4. `deploy-preview` and generic `branch-deploy` were never pinned

Only `production` and the `staging` branch context carried the runtime variables; the other contexts held empty strings and were getting `nodejs24.x` from Netlify's own default rather than from configuration. Both are now pinned explicitly, so preview builds validate on the same runtime they will ship to instead of tracking a platform default that can move.

## Deferred, with reasons

| Item | Decision |
|---|---|
| Stripe 17 → 22 | Deferred. Requires a payment/webhook contract migration, and Stripe is disabled in v1.0 behind `DATIQ_ENABLE_STRIPE` — a major bump buys real risk against no shipped behaviour. Revisit alongside re-enabling Stripe, per `docs/STRIPE-DEFERRAL.md`. |
| Tailwind 3 → 4 | Deferred. A workflow and config migration, not a version bump, and it works against the locked CSS-token design system. Tailwind is used here for utilities only. |
| jsdom 25 → 30 | Deferred, as the plan itself advises: test behaviour may change, and it should be evaluated on its own. |
| lucide-react 0.460 → 1.33 | Not attempted. Outside the plan's scope; a 0.x → 1.x jump risks icon renames across `Icon.jsx`. Its peer range already admits React 19. |
| `@testing-library/jest-dom` 6 → 7 | Not attempted. Major, outside the plan's scope, and the installed version works against React 19. |

## Validation

Every figure below was measured on Node `v24.16.0` after a clean `npm ci`, and compared against a pre-change baseline captured on the same machine before any dependency moved.

| Gate | Baseline | After Phase 5 |
|---|---|---|
| Readiness | 5 pass · 2 warn · 0 fail | 5 pass · 2 warn · 0 fail |
| Unit | 1,985 / 124 files | 1,985 / 124 files |
| Contract | 1,346 + 14 skipped / 72 files | 1,346 + 14 skipped / 72 files |
| Integration | 300 / 41 files | **301** / 41 files (+1 `inert` regression test) |
| System | 8 / 5 files | 8 / 5 files |
| Database | 27 migrations · 137 assertions | 27 migrations · 137 assertions |
| e2e smoke | 118 passed · 1 skipped | 118 passed · 1 skipped |
| Build | clean | clean |
| Security / `npm audit` | clean · 0 vulnerabilities | clean · 0 vulnerabilities, **with the bypass list emptied** |

Both readiness warnings are pre-existing and unrelated: stale `public/help` screenshots, and gallery/persona coverage that is runtime-populated and unprovable from source.

The security gate passing with `bypasses: []` is the load-bearing result — it shows the advisory is genuinely resolved rather than suppressed.

## Known local-environment issue (not a repo problem)

`~/.npm/_cacache` contains root-owned entries, so `npm install` and `npm outdated` fail with `EACCES`/`EEXIST` on this machine. Phase 5 worked around it with `npm install --cache <scratch dir>` rather than changing anything system-wide. The permanent fix is the user's to run, because it needs their password:

```bash
sudo chown -R "$(id -u):$(id -g)" ~/.npm
```

## Pre-existing issue found while validating (not caused by Phase 5)

All 11 chromium visual specs (`npm run test:e2e:visual`) fail. They were run because Playwright moved 1.60 → 1.62 and the baselines are committed per-browser PNGs.

**They fail identically on the unmodified base commit.** Verified by running the same specs in a detached worktree at `3f863ad` with its own `npm ci` — React 18, react-router-dom 7.18.2, Playwright 1.60.0. Both sides expect a 1280×2678 baseline and render 1280×**2747**, at the same 0.04 diff ratio against a 0.02 threshold. Rendering is unchanged by React 19 / Router 8; the baseline is simply ~69px stale.

Baselines were deliberately not regenerated here — that would fold an unreviewed visual change into a runtime migration, and the growth should be understood and accepted by a human first. Details and next steps: [`SESSION-HANDOFF-2026-08-23-NODE24-PHASE5.md`](SESSION-HANDOFF-2026-08-23-NODE24-PHASE5.md).

Worth noting for its own sake: **no CI gate runs the visual specs**, which is why this drifted unnoticed.
