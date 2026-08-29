# DatIQ — staging rebuild + full retest, Go plan help-docs fix, design-sync re-sync

**Date:** 2026-08-08
**Branch:** `staging` (merge commit `1da3203`, from `claude/staging-rebuild-retest-fa77a5`)
**Status:** Verification pass only — no application code changed. Two small doc fixes shipped. Design system re-synced to claude.ai/design.

---

## 1. What this session was

A ground-up rebuild and full retest of `staging`, requested as a health check before further work lands on top of it. No feature work. Three outcomes:

1. Clean install → build → full test suite, all green (§2).
2. Two small doc-only fixes surfaced by the readiness audit (§3).
3. A `/design-sync` re-sync to the "DatIQ Design System" claude.ai/design project (§4).

---

## 2. Rebuild + retest results — all green

Worktree was one commit behind `origin/staging` (`.design-sync/` tooling only, no app code) — merged up first. Then:

| Stage | Result |
|---|---|
| `npm ci` | 324 packages, clean |
| `npm run build` | clean, 921ms (pre-existing chunk-size/dynamic-import warnings only, no errors) |
| Readiness audit (`npm run readiness`) | 4 pass · 3 warn · 0 fail → **5 pass · 2 warn · 0 fail** after §3 |
| Unit (`test:unit`) | **1621/1621 passed**, 101 files |
| Contract (`test:contract`) | **677 passed, 14 skipped**, 0 failed, 42 files |
| Integration (`test:integration`) | **276/276 passed**, 41 files |
| System (`test:system`) | **7/7 passed** |
| DB migration verify (`test:db`) | **18 migrations applied, 102/102 assertions passed** |
| E2E smoke (`test:e2e:smoke`, chromium) | **114 passed, 1 skipped**, 115 specs |
| Security (`test:security`) | passed |

The 1 skipped e2e spec (`home.spec.js:45`, "Pillar 0 banner") is expected — that banner is deliberately CSS-hidden per the existing TODO in `Home.jsx` (see the two most recent commits before this session).

**Two pre-existing, non-blocking items surfaced, not fixed this session:**
- `npm audit`: 4 vulnerabilities (dompurify, nanoid, react-router) — all transitive; `react-router-dom` is version-locked per the architecture rules in `CLAUDE.md`, so bumping it is a deliberate call for a future session, not a rebuild fix.
- Readiness "Screenshot integrity" warn: UI source has changed since the newest `public/help` screenshots. Regenerate with `node docs/capture-screenshots.mjs` when next shipping a customer-facing visual change.

---

## 3. Doc fixes (commit `82f3ad6`, folded into the staging merge)

The readiness audit flagged: *"Plan(s) not mentioned on the help billing page: Go"* — `src/lib/pricingConfig.js` has a `Go` plan ($4.80/mo·$4/mo annual) that isn't in `CLAUDE.md`'s pricing table (that table is stale relative to code; not fixed here, out of scope) and wasn't mentioned in the public help site's billing page.

Fix: added "Go" to the paid-plans list in `docs/DatIQ-User-Guide.md` §11, then regenerated `public/help/` via `node docs/build-help.mjs` per the documented rule (**never hand-edit `public/help/*.html`**).

Regenerating surfaced a second, unrelated pre-existing bug: the pillars table in `docs/DatIQ-User-Guide.md` §1 had `&amp;` pre-escaped in the markdown source (e.g. `Enrichment &amp; Insight`), which `build-help.mjs` escapes *again* on generation, producing literal `&amp;amp;` in the shipped HTML. This bug had been sitting invisible in the source because `public/help` hadn't been regenerated since it was introduced. Fixed by using plain `&` in the markdown (the generator's own escaping is what should produce `&amp;` in the HTML).

Readiness re-run after: **5 pass · 2 warn · 0 fail**, "Pricing coherence" now passes.

**Files touched:** `docs/DatIQ-User-Guide.md`, `public/help/01-what-datiq-is.html`, `public/help/11-plans-usage-and-billing.html`, `public/help/index.html`.

---

## 4. `/design-sync` re-sync — DatIQ Design System project

Target: `https://claude.ai/design/p/2d66b0d6-ac59-4bb2-b9ce-835afc3d8329` (pinned in `.design-sync/config.json`, unchanged this session).

This was a **re-sync**, not a first-time import — `.design-sync/config.json` already had `projectId` + `pkg` from a prior session (see `[[datiq-design-sync-project]]` in memory). Driver run (`resync.mjs`) result:

- **Verification partition:** all 50 components' `sourceKeys` matched the previous anchor exactly (`0 changed, 0 new, 0 removed`) — none of §3's edits touched `src/components/*`, so nothing needed re-authoring or re-grading. Render check: 50/50 clean (2 floor cards, unauthored by design, not failures).
- **Upload partition:** `bundle: true, styling: true` — the compiled `_ds_bundle.js`/`_ds_bundle.css` differ from the anchor because real `src/` changes have landed on `staging` since the design system was last synced (admin monitoring, invoicing UI, etc.), even though none of those changes touched a *synced* component's own source file.
- Uploaded: sentinel fence → 230 component/preview/vendor files + 4 top-level files (`_ds_bundle.js`, `_ds_bundle.css`, `styles.css`, `README.md`) → sentinel re-arm → `_ds_sync.json` last. `list_files` post-upload confirms all 234 in place; 0 deletes (diff's `deletePaths` was empty).

No `.design-sync/config.json`, `NOTES.md`, `conventions.md`, or `previews/` changes were needed — nothing new to commit on the design-sync side this session. See `[[ops-monitoring-branch-status]]`-style memory conventions: durable design-sync state (component fixes, NOTES) only needs committing when a re-sync actually changes it.

**Playwright note for next session:** chromium build `1223` was already cached locally and matched the repo's own pinned `playwright@^1.60.0` — no browser install needed. Repo's `playwright` dep lives in `package.json` `devDependencies`, not visible via `grep` if you accidentally run it from inside `.ds-sync/` (its own scratch `package.json` shadows the real one — cd back to repo root first).

---

## 5. Nothing else changed

No Netlify function code, no SQL migrations, no new dependencies, no `src/` application code. This was a verification + two doc fixes + a design-system re-sync. Next session can pick up wherever the roadmap in `CLAUDE.md` → "Outstanding tasks" left off.
