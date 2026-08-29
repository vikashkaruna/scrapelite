# SESSION-HANDOFF-2026-07-19-BUILD-FIXES.md

> **Session date:** 2026-07-19 01:27 → 02:37 IST (early Sun)
> **Branch at end of session:** `main` (everything merged + pushed)
> **Status at handoff:** `main` at `074abfe`, fully in sync with `origin/main`, working tree clean
> **Next session entry point:** Read `AGENTS.md` → `CLAUDE.md` → `git log --oneline -10` → `git status`

---

## TL;DR

Four small bug fixes in one night, all merged to `main` and auto-deployed to datiq.app. No source-code behavior changes beyond a UX simplification. The session went from a broken Netlify build to a fully green pipeline.

| # | Commit | What |
|---|---|---|
| 1 | `b8b1e53` | **fix(netlify):** remove duplicate `VITE_SUPABASE_ANON_KEY` in production env (TOML parse error) |
| 2 | `71a2586` | **fix(netlify):** add `netlify.toml` + `NETLIFY-ENVIRONMENTS.md` to `SECRETS_SCAN_OMIT_PATHS` (16 false-positive secret detections) |
| 3 | `92b3af9` | **fix(ci):** add the missing `scripts/smoke-prod.mjs` that the phase-gate workflow depends on |
| 4 | `074abfe` | **fix(topbar):** collapse Sign in + Sign up to a single primary CTA; drop Sign in from the trial banner |

All four were committed + pushed; Netlify auto-deploys triggered for each. The final test run is **1314/1314 vitest green** and `vite build` clean in 1.89s.

---

## Detailed session log

### 1. `netlify.toml` duplicate key (commit `b8b1e53`)

Build failed with `Can't redefine existing key at row 95, col 43`. The `[context.production.environment]` block had `VITE_SUPABASE_ANON_KEY = "PROD_ANON_KEY"` declared twice — once at the top (paired with `VITE_SUPABASE_URL`) and once at the bottom with a "duplicate of above for clarity" comment. TOML rejects duplicate keys, so the second declaration was removed. One-line diff.

### 2. Netlify secrets scanner false positives (commit `71a2586`)

After fixing the TOML parse error, the next build failed with `Secrets scanning found secrets in build` listing 16 false positives — `RAZORPAY_KEY_SECRET`'s value detected, `FIRECRAWL_API_KEY`'s value detected, etc. The "values" are intentional placeholders like `"PROD_RAZORPAY_SECRET"` that contain the env-var NAME as a substring; Netlify's scanner does substring matching on values against known env-var names and flags them.

The fix: add `netlify.toml` and `NETLIFY-ENVIRONMENTS.md` to the existing `SECRETS_SCAN_OMIT_PATHS` list. The scanner still watches actual source code; it just stops barking at the operator-facing template files. **NOT** `SECRETS_SCAN_ENABLED=false` (nukes the safety net) and **NOT** rewriting the placeholders to `"REPLACE_ME"` (loses the descriptive intent).

**Pattern (reusable):** any project with operator-overridable deploy config + descriptive placeholders in the config file can hit this. Add the config file and any operator doc that mirrors the placeholders to `SECRETS_SCAN_OMIT_PATHS`. Saved to agent memory.

### 3. Missing `scripts/smoke-prod.mjs` (commit `92b3af9`)

The phase-gate production deploy workflow (`.github/workflows/phase-gate.yml`) was calling `node scripts/smoke-prod.mjs https://staging.datiq.app` and `node scripts/smoke-prod.mjs https://datiq.app` in both the `smoke-staging` and `smoke-production` jobs, but the file had never been written. Every run since the workflow was added has failed at this step with "Cannot find module".

Created `scripts/smoke-prod.mjs` — 10 lightweight HTTP probes + 2 admin probes (opt-in), zero deps, 15s per-probe timeout via `AbortController`. Verified live against `datiq.app` (10/10 ✓).

**What it probes (default 10):**
1. `GET /` — 200 + body contains "DatIQ" or "Extract" (rules out generic 502/404 from SPA fallback)
2. `GET /dashboard`, `/pricing`, `/batch` — SPA fallback returns 200
3. `GET /favicon.svg`, `/robots.txt`, `/sitemap.xml`, `/llms.txt` — GEO/SEO assets
4. `GET /help/index.html` — static help site
5. `GET /api/stats` — 200 OR 503 acceptable (Supabase may be unconfigured; we just need it to answer, not hang)

**Admin probes (only when `SMOKE_ADMIN_PIN` is set, 12 total):**
- `GET /admin` — 200
- `POST /.netlify/functions/admin-auth` — 200 with `token` in response

**Testability:** `runSmoke(baseUrl, { fetcher, logger, adminPin, timeoutMs })` is exported. Tests inject a mocked `fetch` (in-memory handler map) so no real network in CI. 15-test suite covers happy path, every failure mode (4xx/5xx/missing favicon/wrong PIN/no-token response), and multi-failure counting.

**npm scripts added:** `smoke`, `smoke:prod`, `smoke:staging`.

### 4. TopBar single CTA (commit `074abfe`)

User-reported UX nit: the header had two buttons "Sign in" (ghost) + "Sign up" (primary) that both opened the same auth modal. The GuestTrialBanner also had "Sign up free →" + "Sign in" as two adjacent actions.

**Changes:**
- **TopBar desktop** — collapsed to a single `<Button variant="primary" icon="log-in">Sign in</Button>`. Label "Sign in" is more discoverable for returning users; new users land on the "Create account" tab inside the same modal.
- **TopBar mobile nav** — single "Sign in" row, styled with a new `.mobile-nav-item-primary` class (accent-soft background + accent-tinted icon chip + bold weight) so it still reads as the primary CTA inside the hamburger panel.
- **GuestTrialBanner** — dropped the "Sign in" text link; keeps the "Sign up free →" CTA. Returning trial users can use the in-page Sign in button.
- **screens.css** — added `.mobile-nav-item-primary`; removed the now-unused `.gtb-signin` rules.
- **TopBar.integration.test.jsx** — updated I-23 to assert a single primary "Sign in" button and explicitly check that "Sign up" is *not* present.

---

## Files touched

```
netlify.toml                                     | 1 line removed, 7 added
scripts/smoke-prod.mjs                           | 206 lines (NEW)
scripts/smoke-prod.test.mjs                      | 228 lines (NEW)
package.json                                     | 3 lines added (smoke scripts)
src/components/TopBar.jsx                        | -19 +11 lines
src/components/GuestTrialBanner.jsx              | -3 lines
src/styles/screens.css                           | -11 +6 lines
src/components/TopBar.integration.test.jsx       | -3 +7 lines
```

## Test counts

- vitest: **1314/1314** (147 files, ~14s) — +15 net (the smoke-prod test file)
- vite build: clean in 1.89s
- live smoke against datiq.app: 10/10 ✓

---

## Outstanding items from this session

1. **Phase-gate workflow still has a double-deploy issue** (flagged but not fixed). The workflow's `deploy-production` job calls `netlify-cli deploy --prod`, but Netlify is also auto-deploying on every push to `main` via the GitHub integration. Prod gets published twice; auto-rollback at the end might roll back the wrong deploy. **Recommend** (a) turning OFF auto-publish for the production context in Netlify and let phase-gate own the deploy, or (b) simplifying the workflow to smoke-only (no manual deploy step) and let Netlify's auto-publish stand.

2. **GitHub secrets for end-to-end phase-gate runs** still need to be set: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `STAGING_ADMIN_PIN`, plus production `VITE_*` keys. Without these, the workflow will fail with a different error than the missing-script one.

3. **staging.datiq.app** may not be configured yet. The `smoke-staging` job polls for a staging deploy matching `$GITHUB_SHA` and will time out after 5 min if the staging branch isn't wired to a Netlify site.

4. **The untracked `scripts/env/` directory** (with `production.env` and `staging.env`) was created on 2026-07-18 but never committed. It's gitignored. If the user wants them tracked (e.g. as templates with placeholders), they'd need a separate effort. Not blocking anything.

---

## Next session entry point

1. Read `AGENTS.md` → `CLAUDE.md` → `git log --oneline -10` → `git status`
2. Confirm `main` is at `074abfe` (latest commit: `Merge branch 'fix/topbar-single-cta' into main`)
3. If the user wants to address the phase-gate double-deploy issue, that's the natural next thread. Otherwise: continue with the v2.0 backlog per `docs/SESSION-HANDOFF-2026-07-19.md`.
