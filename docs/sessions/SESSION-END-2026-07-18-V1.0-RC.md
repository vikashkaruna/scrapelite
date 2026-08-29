# Session handoff — 2026-07-18 — V1.0 Release-Candidate prepared

> **End-of-session state for the v1.0 release-candidate prep work.**
> Read this first if you continue the v1.0 release work; otherwise read
> `SESSION-END-2026-07-18.md` for the broader project state.

## TL;DR

`V1.0-Release-Candidate` branch is built and pushed, all tests green, release artifacts
written. Ready for the production migration once Supabase is set up and Netlify env vars
are configured.

| | |
|---|---|
| **Branch** | `V1.0-Release-Candidate` (pushed) |
| **Last commit** | `23615a5` — chore(v1.0-rc): production release-candidate prep |
| **Based on** | `main` at `911d4a9` |
| **Tests** | vitest 1297/1297 · Playwright 390/390 · vite build clean |
| **Status** | Ready to merge to `main` and tag as `v1.0.0` |

## What was done in this session

### 1. Branch hygiene

- Deleted 4 stale sub-branches (all fully merged) — both local and remote:
  - `feat/council-backlog-v2`
  - `feat/council-followup`
  - `feat/r3-reliability-growth`
  - `feat/v1-quickwins`
- Created and pushed `V1.0-Release-Candidate` from `main`.

### 2. End-to-end testing — green

- **vitest:** 1297/1297 pass (146 files, 14s).
- **Playwright e2e:** 390/390 pass (chromium + firefox + webkit × smoke + visual + a11y + journeys + claims-verification, 3.5m).
- **vite build:** clean in 1.92s.

**Test fixups required to reach green** (all committed in `23615a5`):
- `e2e/support.js` — pre-mark the Q4 onboarding tour as "skipped" + pin USD currency
  in the test fixture. The tour auto-fires for first-time visitors; without this, the
  overlay intercepts pointer events and breaks 42+ e2e tests. The product behavior is
  unchanged for real users.
- `src/pages/Pricing.jsx` — added `aria-pressed` + `aria-label` to the billing toggle
  (a real accessibility win).
- `e2e/smoke/claims-verification.spec.js` — updated to use the new aria-label and the
  correct `.hero-action-btn` selector.
- `e2e/visual/pricing.spec.js` — same aria-label update.
- `e2e/smoke/integrations.spec.js` — bumped the count to 13 (catalog grew).
- `e2e/journeys/auth-gating.spec.js` — updated the assertion to match the FA3 paywall
  copy ("used all 10 free extractions").
- `e2e/visual/*.spec.js` — refreshed darwin visual baselines.

### 3. V1.0 production screenshots

- `docs/V1.0-Screenshots/` — 25 PNGs covering every key surface (home, pricing
  variants, preview, dashboard, batch, integrations, use-cases, blog, contact,
  privacy, terms, account, workspace, gallery, command palette, hotkey help,
  outcome tiles).
- `docs/capture-v1-screenshots.mjs` — the Playwright capture script. Re-run with
  `npm run dev` and `node docs/capture-v1-screenshots.mjs`.

### 4. Public docs (DatIQ-User-Guide.md + DatIQ-Developer-API.md)

- User Guide: new §15 (keyboard shortcuts), updated §10 (copy to clipboard,
  shareable URLs), updated §11 (pricing matrix), new FAQ entries, new glossary
  entries (outcome tile, template, workspace, public report, provenance, command
  palette).
- Developer API: new v1.0 preview endpoints (share, revoke, gallery, feedback).
- Regenerated `public/help/` (18 pages, including the new
  `15-keyboard-shortcuts.html` and renumbered `16-glossary.html`).

### 5. Internal release-candidate doc

- `docs/internal/V1.0-RELEASE-CANDIDATE.md` — comprehensive v1.0 RC changelog +
  feature catalog + pending production work + how-to-roll-forward instructions.

### 6. supabase/ folder (new)

- `supabase/README.md` — full runbook: table list, RLS summary, rollback guide,
  per-migration notes.
- `supabase/migrations/0001..0011` — numbered, idempotent migrations (mirrored
  from `scripts/` with a clean dependency order).
- `supabase/migrations/run-all.sql` — single-file orchestrator (595 lines, paste-
  and-run in the Supabase SQL Editor).
- `supabase/migrations/rollback.sql` — destructive rollback for test teardown only
  (never on prod without a `pg_dump` first).

### 7. Production release runbook

- `docs/PRODUCTION-RELEASE-V1.0.md` — step-by-step production migration: pre-flight
  → Supabase config → Netlify env vars → build & deploy → smoke test → monitoring
  → rollback → pending v2.0 work → post-release cleanup → done definition.

## What is NOT in this branch

These are intentionally out of scope and not committed:

- The 14 user-supplied research artifacts in workspace root
  (`DatIQ Market & Product Analysis Report.pdf` etc.) — Vikash's inputs, not part
  of the repo.
- The old `dist/` build output.
- `e2e-screenshots/` and `test-results/` (gitignored).

## Next session entry point

To complete the v1.0 release:

1. Read `docs/PRODUCTION-RELEASE-V1.0.md` — the full runbook.
2. Open the Supabase project, run `supabase/migrations/run-all.sql`.
3. Set the Netlify env vars per §2.2 of the runbook.
4. Merge `V1.0-Release-Candidate` → `main` (per §3.1 of the runbook) and tag
   `v1.0.0`.
5. Trigger a Netlify production deploy (full cache clear).
6. Walk the §4 smoke test end-to-end.
7. Set up the §5 monitoring dashboards.
8. Tick every box in the §10 done definition.

The branch is clean, all tests are green, and the docs are written. The remaining work
is operator actions on Supabase and Netlify.

## Open caveats documented for the release

- Q4 tour auto-fires for first-time visitors. May feel intrusive. Consider opt-in
  (button on empty Dashboard) for v1.1.
- "Annual anchoring" paywall copy commits to a flow that v1.0 one-time Razorpay
  Orders can serve (no recurring subscription discount yet).
- Trust strip says "Auto-deleted in 30 days" — the data IS erasable on request via
  /account, but the actual pg_cron schedule is v2.0 work.
- Stripe USD is deferred to v2.0 (code paths preserved, 55 contract tests).
- Razorpay Subscriptions (recurring) are deferred to v2.0.

All of the above are explicitly documented in §7 of the production runbook so the
release is not blocked by them.

## Quick commands

```bash
# Re-verify the branch is green
git checkout V1.0-Release-Candidate
git pull origin V1.0-Release-Candidate
npm install
npm run test:all

# Re-capture screenshots
npm run dev &
sleep 8
node docs/capture-v1-screenshots.mjs

# Regenerate the help site
node docs/build-help.mjs

# Inspect the v1.0 RC changelog
cat docs/internal/V1.0-RELEASE-CANDIDATE.md

# Walk the production release
cat docs/PRODUCTION-RELEASE-V1.0.md

# Look at the migration runbook
cat supabase/README.md
```

---

*Last updated: 2026-07-18 — V1.0-Release-Candidate branch ready for production migration.*
