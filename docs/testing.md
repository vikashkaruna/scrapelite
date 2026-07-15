# Testing and release checks

The test suite is designed to run without production credentials or live third-party services.
Unit and integration tests use local fixtures; browser tests disable all `VITE_*` integration flags and intercept the `/api/*` boundary.

| Command | Purpose |
| --- | --- |
| `npm run test` | All Vitest unit and integration tests. |
| `npm run test:unit` | Unit-test subset while developing. |
| `npm run test:coverage` | Vitest suite with coverage enforcement. |
| `npm run test:e2e` | Chromium end-to-end tests against deterministic browser mocks. |
| `npm run test:smoke` | Fast browser smoke test for the core SPA routes. |
| `npm run test:security` | Secret-pattern scan and production dependency audit. |
| `npm run test:all` | Release-candidate gate: tests, production build, browser tests, and security checks. |

Run `npx playwright install chromium` once after `npm ci` on a new local machine. CI installs Chromium automatically.

## Security policy

`test:security` only scans tracked, text-like project files. It always skips `.env` files and never prints matching values; a failure names only the file and the credential pattern type. Keep credentials in ignored environment files or the deployment secret store.

The dependency audit evaluates production dependencies only (`npm audit --omit=dev`). Critical and high findings block a release whether they are direct or transitive. Low and moderate findings are reported for triage. A documented exception, when genuinely unavoidable, belongs in `security-audit-allowlist.json` and must specify the package, GitHub advisory ID, rationale, and an expiry date; expired or incomplete exceptions do not apply.

## CI behavior

The GitHub Actions quality gate runs on pull requests to `main` and pushes to `main`. It uses `npm ci`, runs the complete release command, and uploads Playwright diagnostics only if the browser suite fails.
