# Session Handoff — 2026-08-23 — Node 24 Phase 5 (ecosystem upgrades)

## Fresh-session entry point

```bash
cd /Users/vikash/Extracta
git fetch origin --prune
git log --oneline -5 claude/node-24-upgrade-phase-5-5d22d9
```

Plan: [`docs/NODE-24-UPGRADE-ANALYSIS.md`](NODE-24-UPGRADE-ANALYSIS.md) — its **Execution record** section, appended this session, is the authoritative status. Read that before trusting anything above it in that file.

## What this session did

Took the Phase 1–4 handoff, **verified** it rather than assuming it, then executed Phase 5.

Branch: **`claude/node-24-upgrade-phase-5-5d22d9`**, cut from `origin/staging` (= `origin/main` = `3f863ad`). Two commits:

| Commit | Scope |
|---|---|
| `af18096` | Phase 5A — toolchain refresh inside the plan's sanctioned ranges |
| `1f3ee9c` | Phase 5B — React 19 + react-router 8, plus the a11y regression it exposed |

Later in the same session, plus `d1ddea1` / `cc69aa0` (docs), validated through [PR #106](https://github.com/vikashkaruna/scrapelite/pull/106) and **fast-forwarded into `staging`** (`3f863ad..cc69aa0`).

**`main` is untouched.** Merging `staging` → `main` remains a separate, explicitly-approved step.

### CI evidence (PR #106)

| Check | Result |
|---|---|
| Staging Gate: Test Suites | pass (8m41s) — every step, incl. e2e smoke and security suite |
| Staging Gate: Vulnerabilities | pass — **with `bypasses: []`** |
| Staging Gate: Open Issues/Defects | pass |
| netlify deploy-preview | pass — 41/41 functions `nodejs24.x` |

`Deployed & Smoke Tested` was skipped on the PR by design — it only runs on a push to `staging`, so the merge is what triggers it.

### Staging gate after the merge (run `32622936519`, commit `cc69aa0`) — **all four green**

| Check | Result |
|---|---|
| Staging Gate: Test Suites | success |
| Staging Gate: Vulnerabilities | success — **`bypasses: []`** |
| Staging Gate: Open Issues/Defects | success |
| Staging Gate: Deployed & Smoke Tested | **success** |

That last job is the one that matters for the runtime migration: it waited for the Netlify staging deploy to converge, **verified the Functions manifest**, rebuilt the artifact identical to what Netlify published for the commit, and smoke-tested it.

Independently verified against the Netlify API for the staging deploy (`6a8a929c98e4c300086693af`):

- **41/41 functions on `nodejs24.x`**
- **all five crons still scheduled** — `scheduled-runner` `@hourly`, `billing-lifecycle` `@daily`, `billing-purge` `@daily`, `reengagement` `@daily`, `health-monitor` `@hourly`

The cron check is not a formality. This repo has a documented history of scheduled functions silently un-scheduling with no build error and no runtime error (all four sat unscheduled from R19 until 2026-07-27), so a runtime migration is exactly the kind of change that could drop them.

**`staging.datiq.app` returns 401 and that is correct.** Branch deploys sit behind Netlify's visitor-access gate by design — see `scripts/netlify-edge-access-bypass.mjs`. It is why the gate smoke-tests the build artifact locally instead of probing the URL over the network, and why the bundle-hash comparison in `CLAUDE.md` cannot be run against staging without an SSO bypass. Production (`datiq.app`) returns 200 and is unaffected.

Note on the pre-push hook: on the **first** push of a new branch it reported *"docs-only diff — skipping tests"*, because `origin/<branch>` did not exist yet to diff against. **It validated nothing on that push.** It ran properly (8 gates, 25s, green) on the push to `staging`, where `origin/staging` existed to diff against. **A green hook line on a brand-new branch is not evidence that the gates ran** — read the line, not just its colour.

## First: Phases 1–4 were verified, not assumed

The prior handoff said Phases 1–4 were done. Phases 1–2 are repo commits and were easy to confirm (`75d0cf4`/`bc79f58` are on `origin/main` and `origin/staging`). **Phases 3–4 are Netlify platform state, and a merged commit is zero evidence about that** — so they were checked against the live Netlify API:

| Context | `NODE_VERSION` | `AWS_LAMBDA_JS_RUNTIME` | Deployed functions |
|---|---|---|---|
| production | `24` | `nodejs24.x` | 41/41 `nodejs24.x` |
| staging (branch context) | `24` | `nodejs24.x` | 41/41 `nodejs24.x` |
| deploy-preview | was empty → **now `24`** | was empty → **now `nodejs24.x`** | 41/41 `nodejs24.x` |
| branch-deploy (generic) | was empty → **now `24`** | was empty → **now `nodejs24.x`** | 41/41 `nodejs24.x` |

The last two were getting `nodejs24.x` from Netlify's own platform default, not from configuration. They are now pinned explicitly (approved by the user), so preview builds validate on the runtime they will ship to rather than tracking a default that can move. This was an env-var write only — **no deploy was triggered**.

Prior scoping is recorded in the execution record if it ever needs reverting; the two contexts previously held empty strings.

## The finding that changed Phase 5's rationale

The plan's headline Phase 5 item is a "React Router **security** migration". That premise had expired before this session started.

- `.github/gate-bypass/vulnerabilities.json` claimed *"No patched version exists for React 18."*
- **GHSA-qwww-vcr4-c8h2 was amended.** Affected: `>=7.12.0 <7.18.2` and `>=8.0.0 <8.3.0`. **7.18.2 is the 7.x patch** — and the repo was already pinned to exactly 7.18.2.
- `npm audit` returned **0 vulnerabilities** before any Phase 5 work ran.
- The advisory is RSC-only in any case; this is a client-rendered `BrowserRouter` SPA.

The migration went ahead anyway, on the user's decision and the standing maintenance argument (`react-router-dom@7.18.2` is that package's final release). But **do not cite it as remediating an advisory.** The bypass entries were removed as *obsolete*, and the security gate now passes with `bypasses: []` — which is what actually demonstrates the advisory is resolved rather than suppressed.

The generalisable lesson is written into the bypass file itself: a bypass records a judgement about the world on a given day, and advisories get re-scoped. Re-read the advisory before renewing one.

## 🔴 The bug the migration hid — read this one

`TopBar.jsx` guarded the closed mobile nav with:

```jsx
inert={!isOpen ? "" : undefined}
```

That only ever worked because React 18 didn't recognise `inert` and forwarded the empty string as a bare attribute, which HTML reads as **true**. React 19 recognises `inert` as a boolean prop, so `""` coerces to **false** and the attribute is dropped entirely — silently restoring the exact bug that line's own comment says it exists to prevent: **Tab walking into the offscreen mobile menu**.

React only *warns* about this. **Nothing failed.** All 3,640 tests stayed green while the app carried a real keyboard-accessibility regression, because no test asserted inertness.

It was caught by diffing new warnings in the e2e log against a baseline captured before any dependency moved — which is the reason to capture that baseline at all.

Fixed to `inert={!isOpen}`. Covered by a regression test in `TopBar.integration.test.jsx` that asserts the **rendered DOM attribute**, not the prop, and that was **confirmed to fail against the old code** before being accepted. A sweep of every other boolean HTML attribute for the same empty-string pattern found no further instances.

## What changed, by stage

### 5A — toolchain (`af18096`)

```
vite                        8.1.5   -> 8.2.2
@vitejs/plugin-react        5.2.0   -> 6.1.0     (only major; clean here)
vitest / coverage-v8        4.1.10  -> 4.1.11
playwright                  1.60.0  -> 1.62.1
@supabase/supabase-js       2.108.0 -> 2.112.3
@electric-sql/pglite        0.5.4   -> 0.5.6
razorpay                    2.9.6   -> 2.9.8
@testing-library/user-event 14.6.1  -> 14.6.6
pg                          8.22.0  -> 8.23.0
```

`plugin-react` 6 dropped Babel (hence −654 lockfile lines); its three new peers are all **optional** and the plugin is called as a bare `react()`, so there was nothing to migrate. **But it also stopped adding react/react-dom to `resolve.dedupe` implicitly** — that is now stated explicitly in `vite.config.js`. Inert today (one React resolves), and there to make a duplicate from a transitive dep fail visibly rather than as an "invalid hook call" far from its cause.

### 5B — React 19 + Router 8 (`1f3ee9c`)

- `react` / `react-dom` 18.3.1 → **19.2.8**
- `react-router-dom` **removed**; `react-router` **8.3.0** added
- 107 files: pure `"react-router-dom"` → `"react-router"` specifier swaps. Every API in use (`BrowserRouter`, `MemoryRouter`, `Routes`, `Route`, `Navigate`, `Outlet`, `Link`, `useNavigate`, `useLocation`, `useParams`, `useSearchParams`) exports from the `react-router` root in v8 — verified against the published package — so **nothing needed `react-router/dom`**. The diff was audited to confirm those 107 files changed on the import line only.
- `main.jsx`: `future={{ v7_startTransition, v7_relativeSplatPath }}` removed. **The obvious translation is wrong and the file says why:** v8 replaced the flag with a `useTransitions` prop, but the router only skips `startTransition` on an explicit `useTransitions={false}` — so leaving it **undefined** is the exact behavioural match, while `useTransitions={true}` opts into a further `startTransition` + `useOptimistic` mode that has **not** been evaluated. Verified by reading v8's `BrowserRouter` source, not the docs.
- The same dead prop was stripped from the 31 test files passing it to `MemoryRouter`.
- `CLAUDE.md` / `AGENTS.md` tech-stack line corrected — it still said *"Vite 5 + React 18 + React Router 6"*, stale on all three counts.

## Validation

Node `v24.16.0`. Baseline captured **before** any dependency moved, on the same machine; final figures re-confirmed after a `rm -rf node_modules && npm ci` so the lockfile is proven to reproduce the way CI installs it.

| Gate | Baseline | After Phase 5 |
|---|---|---|
| Readiness | 5 pass · 2 warn · 0 fail | 5 pass · 2 warn · 0 fail |
| Unit | 1,985 / 124 files | 1,985 / 124 files |
| Contract | 1,346 + 14 skipped / 72 | 1,346 + 14 skipped / 72 |
| Integration | 300 / 41 | **301** / 41 (+1 regression test) |
| System | 8 / 5 | 8 / 5 |
| Database | 27 migrations · 137 assertions | 27 migrations · 137 assertions |
| e2e smoke | 118 passed · 1 skipped | 118 passed · 1 skipped · **0 `inert` warnings** |
| Build | clean | clean |
| Extension build | clean | clean |
| Security / `npm audit` | clean · 0 vulns | clean · 0 vulns, **`bypasses: []`** |

Both readiness warnings are pre-existing and unrelated: stale `public/help` screenshots, and gallery/persona coverage that is runtime-populated and unprovable from source.

## Deferred, deliberately

| Item | Why |
|---|---|
| Stripe 17 → 22 | Needs a payment/webhook contract migration. Stripe is **disabled in v1.0** behind `DATIQ_ENABLE_STRIPE` — a major bump buys real risk against no shipped behaviour. Do it alongside re-enabling Stripe, per `docs/STRIPE-DEFERRAL.md`. |
| Tailwind 3 → 4 | A workflow/config migration, not a version bump, and it works against the locked CSS-token design system. Tailwind is utilities-only here. |
| jsdom 25 → 30 | The plan itself says keep and evaluate separately; test behaviour may change. |
| lucide-react 0.460 → 1.33 | Outside plan scope. 0.x → 1.x risks icon renames across `Icon.jsx`. Its peer range already admits React 19. |
| `@testing-library/jest-dom` 6 → 7 | Major, outside plan scope, and the installed version works against React 19. |

## Next steps

1. **Push the branch** and let the staging gate run it in CI. Local gates are green, but CI is the first run on `actions/cache@v5` + `slack-github-action@v3.0.3` under a real runner.
2. **Merge to `staging`** once CI is green — the user's stated sequence is: green tests → approval → staging.
3. **Watch the staging deploy** and confirm 41/41 functions still report `nodejs24.x` and that `/admin/health` shows the expected runtime.
4. **Only then**, with explicit approval, merge `staging` → `main`. `main` has deliberately not been touched.
5. Decide what to do about the stale visual baselines — see the next section. Not a Phase 5 blocker.

## 🟡 Pre-existing: the visual baselines are stale (NOT caused by this work)

`npm run test:e2e:visual` was run because Playwright moved 1.60 → 1.62 and those baselines are committed per-browser PNGs. **All 11 chromium visual specs fail.** They also fail on the unmodified base commit, so this is pre-existing.

That was confirmed by experiment, not assumed: a detached worktree at `3f863ad` with its own `npm ci` (React 18, react-router-dom 7.18.2, Playwright 1.60.0 — none of this session's changes) was run against the same specs.

| | Baseline PNG | Actually rendered | Diff ratio |
|---|---|---|---|
| Base `3f863ad` | 1280×2678 | 1280×**2747** | 0.04 |
| This branch | 1280×2678 | 1280×**2747** | 0.04 |

**Identical rendering and identical drift on both sides** — the page renders the same before and after React 19 / Router 8. The committed baseline is simply ~69px shorter than what the app now produces, and `maxDiffPixelRatio` is 0.02, so 0.04 fails.

The two runs differ only in *how* they fail: base captured a stable screenshot and failed the pixel comparison, this branch timed out at 5s trying for two consecutive stable frames. That is flakiness in an already-failing test — the page has a late layout shift around the intermediate heights 2683 → 2747 — not a rendering change.

**Baselines were deliberately NOT regenerated.** Doing so inside a runtime migration would bundle an unreviewed visual change into it, and the 69px growth needs a human to confirm the *current* rendering is correct before it is blessed as the new truth. Whoever picks this up should:

1. Look at what grew — the layout shift to 2747px is real and worth understanding before accepting it.
2. Regenerate with `npx playwright test --update-snapshots` for all three browsers, on macOS (the baselines are `-darwin` suffixed).
3. Consider fixing the late layout shift, or adding a wait for it, so the specs stop being flaky at the 5s stability window.
4. Consider whether visual specs should be in a CI gate at all — **they are in none today**, which is exactly why this drifted unnoticed.

## ⚠️ Local environment issue (not a repo problem)

`~/.npm/_cacache` contains **root-owned entries** on this machine, so `npm install` and `npm outdated` fail with `EACCES`/`EEXIST`. This session worked around it with `npm install --cache <scratch dir>` and changed nothing system-wide. The permanent fix needs the user's password:

```bash
sudo chown -R "$(id -u):$(id -g)" ~/.npm
```

## Branch-naming note

The user referred to the branch as `node-24-upgrade`. That branch exists at `75d0cf4` but is an **ancestor of `origin/staging`** — its work is already merged, and it is ~20 commits behind. Phase 5 was therefore done on `claude/node-24-upgrade-phase-5-5d22d9`, cut from current `origin/staging`, which is the correct base. `node-24-upgrade` was left untouched and can be deleted once Phase 5 lands.

---

# ✅ RELEASED TO PRODUCTION — 2026-08-23

Phase-gate run [`32623540502`](https://github.com/vikashkaruna/scrapelite/actions/runs/32623540502) completed **success** end to end on `main` = `79fdfc4`, via approval issue [#107](https://github.com/vikashkaruna/scrapelite/issues/107).

| Gate job | Result |
|---|---|
| Production Gate: Test Suites | success |
| Production Gate: Vulnerabilities | success — **`bypasses: []`** |
| Production Gate: Open Issues/Defects | success |
| Staging Released & Tested | success |
| Await Manual Approval | success (approved on #107) |
| Deploy to Production | success |
| Smoke Test — Production | success |
| Re-lock Production | success |

**Production re-locked automatically**, so the next release needs a fresh unlock — that is the design, not a leftover.

## Verified live, not just reported by the workflow

The gate saying "deployed" is not the same as production running the new code — this repo has been bitten before by a run that claimed a release which never shipped. So it was checked directly:

- `https://datiq.app` → **HTTP 200**
- Production deploy `6a8a95dec87af70007076c32` (commit `79fdfc4`) → **41/41 functions `nodejs24.x`**, **all 5 crons scheduled**
- The final live artifact is a CLI deploy (`6a8a9873f946cc748bbf2b1a`, no `commit_ref` — that is normal for `netlify deploy --prod`), also 41/41 `nodejs24.x` with 5 crons
- **The live bundle itself was inspected** (`/assets/index-BGxPffpS.js`):
  - contains `react-router`, and **no `react-router-dom`** → the v8 migration is genuinely live
  - contains **`inert:!e`** — the minified form of `inert={!isOpen}`, a boolean negation. The pre-fix code would have minified to `inert:e?void 0:""`. **The accessibility fix is live in production.**

Reading the shipped bundle is the only check that distinguishes "the pipeline reported success" from "the fix is actually running", and it is cheap. Do it.

## Still outstanding after this release

1. **The 11 stale visual baselines.** Pre-existing, shipped as-is, proven at the base commit. Worth its own PR — and decide whether the visual specs should gate anything, because today **no CI gate runs them**, which is why they drifted unnoticed.
2. The `node-24-upgrade` branch (`75d0cf4`) is fully merged and ~20 commits behind; safe to delete.
3. `~/.npm/_cacache` root-owned entries on the dev machine — the user's `sudo chown` to run.
