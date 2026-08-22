# DatIQ Node.js 24 and Ecosystem Upgrade Analysis

**Date:** 2026-08-21  
**Scope:** GitHub Actions, local development, Netlify builds and Functions, frontend toolchain, database/runtime tooling, payments, and the MV3 browser extension.  
**Status:** Analysis and plan only; no runtime or dependency changes are included in this document.

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

