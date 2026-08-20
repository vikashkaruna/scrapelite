# Plan — Branch sync + Integration-with-outside-ecosystem implementation roadmap

> **Date:** 2026-08-20
> **Status:** Plan only — **no code, no commits, no pushes** until you approve.
> **Why this exists:** You asked to (1) compare main vs staging, (2) merge main into staging, (3) E2E test staging green, (4) propagate to `workflow-implementation-and-optimization` and `Integration-with-outside-ecosystem`, (5) test each independently, (6) investigate + plan + prioritize what's pending in `Integration-with-outside-ecosystem`. Below is the plan, grounded in actual `git` and repo state — not the handoff doc, which is 2 days stale.

---

## 0. Premise correction (important — your assumption is inverted)

You said: *"I think staging should have all what's there in main, so merge them in staging."*

**The actual divergence (verified `2026-08-20 22:17 IST` against `origin/`):**

| Branch | Tip | Tip date | Ahead of staging? | Ancestor of main? |
|---|---|---|---|---|
| `main` | `c6178f4` Merge PR #96 | 2026-08-19 01:08 | **+3 PR merges** ahead of staging | n/a |
| `staging` | `0df81a7` Correct PLpgSQL foreach array syntax | 2026-08-19 00:53 | 0 | **YES** (ancestor) |
| `workflow-implementation-and-optimization` | `478a307` docs: save session | 2026-08-18 09:56 | 0 | **YES** (ancestor) |
| `Integration-with-outside-ecosystem` | `5472ec7` Merge branch 'staging' | 2026-08-18 09:57 | 0 | **NO** |

**`main` is AHEAD of staging**, not behind. The 3 PR-merge commits on main (#92, #94, #96) all merged `staging → main`. Since then main gained 4 net-new code commits that no other branch has:

- `a17fa9a` Add guarded user account deletion helper — `supabase/helpersql/delete-user-account.sql` (+118 lines, new file)
- `394d866` Fix session-keyed cleanup in deletion helper — same file (+9 lines)
- `60fe833` Fix deletion helper array syntax — same file (2 lines)
- `0df81a7` Correct PLpgSQL foreach array syntax — same file (2 lines)

These 4 commits ship a **new Supabase helper for deleting user accounts** (called from your `deleteUser()` admin function, presumably). The deletion helper is a security-sensitive, destructive operation, so it's the kind of thing that needs to land on every branch before it goes to production — and right now it's only on main, which means staging/wkfl/int all have the old code that doesn't know about it.

**So the proper action is the *opposite direction* of your wording**: fast-forward `staging` to `main` (since staging is already an ancestor). The code state ends up identical to a merge, but the history stays linear and you don't pick up a no-op merge commit. If you want a merge commit anyway, add `--no-ff`; both produce the same tree.

---

## 1. The plan — exact steps + commands

### Step 1 — Fast-forward `staging` to `main` (≈10 s + the test run)

```bash
cd /Users/vikash/Extracta
git fetch --all --prune
git checkout staging
# Option A (recommended): clean fast-forward, no merge commit
git merge --ff-only origin/main
# Option B (matches your "merge them" wording literally): explicit merge commit
# git merge --no-ff origin/main -m "merge: bring main into staging (PR #96 fast-forward round-trip)"
```

After this, `staging` and `main` point at the same commit `c6178f4`. Tree is identical to `main`.

### Step 2 — E2E test on staging (≈5–8 min wall clock)

```bash
npm run test:all
# = readiness + unit + contract + integration + system + db + build + e2e:smoke + security
```

**Expected baseline from the 2026-08-18 handoff:**
- Readiness: 6 pass / 1 warn / 0 fail (the "stale-screenshot" warn is now cleared; the "gallery/persona coverage" warn is unconditional in `audit.mjs` and unprovable from source — 1 warn is the ceiling)
- Unit: ~1975
- Contract: ~1333
- Integration: 300
- System: 8
- DB: 124 assertions / 25 migrations
- Build: clean (verified above)
- E2E smoke: 115 passed / 1 skipped / 0 failed
- Security: clean

**If anything goes red**, fix forward, commit on `staging`, re-run. Do not touch `main` — the standing rule is merges to main are a deliberate separate step.

### Step 3 — Propagate to `workflow-implementation-and-optimization` (≈1 min + tests)

`workflow-impl` is already an ancestor of `main`. So this is the same kind of fast-forward as staging.

```bash
git checkout workflow-implementation-and-optimization
git merge --ff-only origin/main
# if you want the no-ff form for symmetry with staging:
# git merge --no-ff origin/main -m "merge: bring main into workflow-impl (3 PR merges + 4 deletion-helper commits)"
npm run test:all
```

### Step 4 — Propagate to `Integration-with-outside-ecosystem` (≈5 min, may need conflict resolution)

Integration is the one branch that's **not** an ancestor of main. It has 6 stale "Merge branch 'staging' into Integration-with-outside-ecosystem" merge commits (`5472ec7`, `8c4686c`, `f18f1a8`, `4a8e60b`, `c6e21fe`, `7431e32`) plus the `ded1c37` docs handoff. It is **missing** the 4 deletion-helper commits on main.

The merge *will* be a fast-forwardable clean-merge IF the deletion-helper file (`supabase/helpersql/delete-user-account.sql`) doesn't conflict with anything on the Integration branch. Since the file is brand new on main and Integration's only divergence from staging is more staging-merge commits, the fast-forward should be clean. If `git merge --ff-only` rejects, fall back to:

```bash
git merge --no-ff origin/main -m "merge: bring main into Integration-with-outside-ecosystem (3 PR merges + 4 deletion-helper commits)"
# resolve any conflict manually
```

Then run the test suite.

### Step 5 — Test both branches independently

Already covered by the `npm run test:all` at the end of Step 3 and Step 4. No need for a third run unless one of them went red.

### Step 6 — Save a session handoff

`docs/SESSION-HANDOFF-2026-08-20-BRANCH-SYNC.md` — captures what was merged, what was found, what was deferred. Same shape as the previous handoffs.

### Total wall time estimate

| Step | Time | Risk |
|---|---|---|
| 1. FF staging → main | ~10 s | zero — staging is an ancestor |
| 2. Test staging | ~6 min | low — baseline is green; the 4 new commits only touch a SQL file |
| 3. FF workflow-impl → main + test | ~6 min | zero — workflow-impl is an ancestor |
| 4. FF Integration → main + test | ~7 min (FF may need a conflict) | low — the only net-new file on main is one SQL file |
| 5. Test both branches | (covered in 3 & 4) | n/a |
| 6. Write handoff | ~5 min | zero |
| **Total** | **~25 min** | |

If any step goes red, add 5–15 min per fix and a re-run.

---

## 2. What's pending for `Integration-with-outside-ecosystem`

Sources reviewed (the previous planning documents you asked me to consolidate):

1. `docs/SESSION-HANDOFF-2026-08-10-INTEGRATION-WORK.md` — the master 67 KB integration session doc, §8 "Open / deferred work"
2. `docs/SESSION-HANDOFF-2026-08-11-LATE-NIGHT-INTEGRATION-FIXES.md` — 7-fix late-night session
3. `docs/SESSION-HANDOFF-2026-08-11-LATE-NIGHT-PART-2.md` / `-PART-3.md` — follow-on late-night sessions
4. `docs/SESSION-HANDOFF-2026-08-11-STAGING-INTEGRATION-MERGE.md` — staging promotion
5. `docs/SESSION-HANDOFF-2026-08-11-INTEGRATION-BRANCH-GAPS.md` — what's still missing vs. workflow branch (committed on Integration branch as `ded1c37`)
6. `docs/SESSION-HANDOFF-2026-08-11-WORKFLOW-BRANCH-GAPS.md` — workflow branch's symmetric gap doc
7. `docs/SESSION-HANDOFF-2026-08-13-INTEGRATION-ENV-FIXES.md` — 6 mobile bugs fixed on a side branch `claude/integration-environment-fixes-17e6se @ eb6bc4f` that **was never merged** anywhere
8. `Analysis-1/DatIQ - Prioritised Features Release Roadmap.pdf` and `.xlsx` (in worktree, not on any branch)

All pending items, in one place, grouped by category:

### A. Source-code TODOs in the Integration branch's scope (real `TODO` comments, still on the branch)

| # | Item | Where | Effort | Risk if deferred |
|---|---|---|---|---|
| A1 | **HubSpot access_token encryption** (pgcrypto envelope on `integration_connections.access_token`) | `netlify/functions/lib/hubspotService.js:23` | 1 day | **Medium** — plaintext tokens in a DB leak; RLS-only mitigation; flagged on every prior handoff |
| A2 | **Hosted blog** | `src/pages/Blog.jsx:515` | 1–2 weeks (Ghost or Beehiiv) | **Low** — static `/blog` page suffices; SEO-wise AEO/GEO sweep covers discoverability |
| A3 | **Delete the unused `ContentModal.jsx`** (zero callers since the in-page Generate Content refactor on 2026-08-11) | `src/components/ContentModal.jsx` | 5 min | **None** — pure dead-code cleanup |

### B. Operator actions (NOT code — block production promotion only)

| # | Item | Where | Effort |
|---|---|---|---|
| B1 | Run migrations `0019_api_keys`, `0020_integration_connections`, `0021_zapier_events` on live Supabase | Supabase SQL editor (paste from `supabase/migrations/run-all.sql`) | ~5 min |
| B2 | Add `/api/*` to Netlify Edge Access bypass | Netlify UI → Security → Edge Access → Add bypass → Path `/api/*` | ~2 min |
| B3 | (Optional) publish the browser extension to Chrome Web Store (Firefox + Edge too) | `extensions/datiq-extension/` — source ready, just $5 + review | ~1 day operator + Google review time |
| B4 | Provision self-hosted n8n (Hostinger VPS) + wire env vars | `docs/N8N-OPERATIONS.md` | ~2 hours operator |
| B5 | Enable the `workflow-orchestrator` cron in `netlify.toml` | add `[functions."workflow-orchestrator"]` block | ~5 min |
| B6 | Seed `workflow_subscriptions` for existing users | migration script in `docs/V2-IMPLEMENTATION-GUIDE.md` §5 | ~10 min |

### C. Deferred backlog from `SESSION-HANDOFF-2026-08-10-INTEGRATION-WORK.md` §8 (the user-value-prioritized list)

| # | Item | Why deferred | Effort | User value |
|---|---|---|---|---|
| C1 | **Cross-port `WebhookSetupModal` from workflow branch** — the per-user generic webhook setup modal lives only on `workflow-impl`; Integration's `/integrations` "Webhook / n8n" card still points to `/` | needs merge from workflow | 30 min | **Medium** — completes the integrations catalog card promised as "available" |
| C2 | **Connect-from-Preview/Dashboard "Push to HubSpot / Notion" buttons** — currently the only path is via `/account#integrations` modal | nice UX win | 2 hours | **Medium** — saves 1 click for the 80% case |
| C3 | **Notion + Airtable dedup by URL** — both push endpoints always create new records | v1.1 plan | 2 hours | **Medium** — pushes to the same URL don't accumulate duplicates |
| C4 | **Zapier webhook upgrade** — real webhooks (sub-minute latency) instead of polling | v1.1 plan | 4 hours | **Low** — current polling is good enough |
| C5 | **Stripe Checkout re-enable** | v1.0+ backlog; `docs/STRIPE-DEFERRAL.md` 6-step runbook | 4 hours | **High** if you want US customers, **Low** if Razorpay-first |
| C6 | **Recurring billing (Razorpay Subscriptions)** | v1.0+ backlog | 8 hours | **High** — every paid plan needs this for retention |
| C7 | Add custom auth domain to staging (`api-staging.datiq.app`) | operator work, not code | 30 min operator | **Low** — current setup works |

### D. The 6 mobile bugs from `claude/integration-environment-fixes-17e6se` (NEVER MERGED to staging or main)

Per `docs/SESSION-HANDOFF-2026-08-13-INTEGRATION-ENV-FIXES.md`, the following were fixed on a side branch and never propagated. **None of these are on staging today.**

| # | Bug | Impact | Effort |
|---|---|---|---|
| D1 | **Batch results table not responsive** at <760px (`Batch.jsx` / `screens.css`) — title/summary cells hard-truncated | Mobile users can't read batch results | 30 min |
| D2 | **Export dropdown clipped off-screen left** on Batch page (CSS bug) | Mobile users can't see the Export menu | 15 min |
| D3 | **"Send to Destination" not a peer of Export** on Batch | Mobile users need an extra click to push | 1 hour |
| D4 | **Custom extraction / Quick Enrichment "doesn't work"** — `HeroComposer.runAction()` never set `opts.intent`; Home/Batch/Preview all had silent failures | Users see empty tabs with no explanation | 30 min |
| D5 | **Preview structured-data table overflow** — `.sd-row` children default to `min-width: auto` | Mobile users see clipped structured data | 15 min |
| D6 | **Generic (non-persona) AI summaries** — `buildSummaryPrompt()` was identical for every persona/intent | Users get generic summaries, not persona-tailored | 30 min |
| D7 | **`Button.jsx loading` prop not implemented** — React unknown-attribute warning at 15+ call sites | Cosmetic warning; could mask real double-clicks | 2 hours (touches every button) |

D1–D6 are ~3.5 hours total and **all are real user-reported mobile issues** (screenshots in the handoff). D7 is a real defect but a clean isolated follow-up.

### E. Other items called out in prior handoffs but not categorized above

| # | Item | Source | Notes |
|---|---|---|---|
| E1 | **Two 401s in staging's browser console on load** | `SESSION-HANDOFF-2026-08-18-PARALLEL-RUN-CONSOLIDATION.md` "Open" §2 | Likely the Edge Access basic-auth handshake (resolves with B2). Worth 10 min to verify. |
| E2 | **Netlify — AI provider key** (GEMINI/OPENAI/AI_API_KEY) | same source, §3 | If unset, Quick enrichment returns null. Check Netlify dashboard before re-diagnosing as code. |
| E3 | **TODO — Gallery curation** | same source, §4 | Deferred: live Supabase has no curated persona reports yet; requires real report creation/review and an authenticated admin session. |
| E4 | **Guest gate is still `localStorage`-backed** | same source, §5 | Needs server-side guest identity; a real architectural change, not cleanup |

---

## 3. Recommended prioritization for the Integration backlog

You said "prioritise them for implementation". My ranking, by user-value-per-hour, considering that **none of these are user-reported blockers today** (the system is in production, the most painful items are already shipped):

### Tier 1 — Do this session (~4 hours total, all on the Integration branch)

These are the **6 never-merged mobile bugs** (D1–D6) plus the dead-code cleanup (A3). Real, user-reported, unblock the mobile experience, isolated, no architectural risk.

| # | What | Effort | Why now |
|---|---|---|---|
| 1 | Open the side branch (`claude/integration-environment-fixes-17e6se @ eb6bc4f`) and verify it still applies cleanly to current Integration tip | 15 min | It's 8 days old; verify before re-using |
| 2 | Cherry-pick D1–D6 onto Integration branch | ~3 hours | These are proven fixes that survived the original session's test suite |
| 3 | A3: delete `ContentModal.jsx` (zero callers) | 5 min | Trivial cleanup; do it in the same commit |
| 4 | Verify `npm run test:all` green on Integration | ~6 min | |
| 5 | Push to `Integration-with-outside-ecosystem`, document in a fresh handoff | ~5 min | |

If the cherry-pick doesn't apply cleanly (likely — the side branch predates the staging merges), do the equivalent changes on a fresh `feat/integration-mobile-fixes` R-branch from `Integration-with-outside-ecosystem`. Slightly more work, cleaner history.

### Tier 2 — Next session, single day (~1 day)

| # | What | Effort | Why |
|---|---|---|---|
| 6 | C1: cross-port `WebhookSetupModal` from workflow branch | 30 min | Closes the gap where /integrations Webhook card points to `/` instead of a setup modal |
| 7 | C2: Push buttons on Preview + Dashboard | 2 hours | UX win; the most-clicked user path |
| 8 | A1: HubSpot token encryption (pgcrypto envelope) | 1 day | Security v1.1 — flagged on every prior handoff; unblocks enterprise audit signoff |
| 9 | Operator actions B1, B2, B5, B6 | ~30 min total | Unblocks production promotion; B3 is longer (Google review) |

### Tier 3 — After Tier 1 + 2, in priority order

| # | What | Effort | Notes |
|---|---|---|---|
| 10 | C3: Notion + Airtable dedup by URL | 2 hours | |
| 11 | D7: `Button.jsx loading` prop (touches 15+ call sites) | 2 hours | Real defect; isolated follow-up; un-uglify the console |
| 12 | C4: Zapier webhook upgrade | 4 hours | |
| 13 | E1: Diagnose the two staging 401s | 10 min | Likely Edge Access; resolves with B2 |
| 14 | E2: Verify Netlify AI provider key is set | 5 min | |
| 15 | C5 / C6: Stripe Checkout re-enable / Razorpay Subscriptions | 4 / 8 hours | **C6 first** if retention is a concern; C5 only if you want US cards |
| 16 | B3: Chrome Web Store publish | $5 + review time | Source is ready |
| 17 | A2: Hosted blog (Ghost / Beehiiv) | 1–2 weeks | Big project, low urgency — static `/blog` works for now |
| 18 | **TODO — E3: Gallery curation per the runbook** | 1 hour | Deferred until real reports and authenticated admin access are available |
| 19 | B4: Self-hosted n8n on Hostinger VPS | 2 hours operator | Required for v2 workflow pipeline to actually fire |
| 20 | E4: Server-side guest identity (architectural) | 1+ week | True fix for "guest gate is localStorage-backed" |
| 21 | C7: Custom auth domain on staging | 30 min operator | Cosmetic |

### What I'm NOT recommending (and why)

- **Don't do everything in one go.** Tier 1 alone is the highest-value 4 hours of work on the Integration branch. Tier 2 is a full day. Tier 3 is multi-week and many items are operator work or large refactors.
- **Don't do A2 (hosted blog) now.** Static `/blog` is fine; the SEO/AEO work is done; this is a content-strategy decision, not a code fix.
- **Don't do E4 (server-side guest identity) now.** It's a real architectural change. Worth it eventually; the localStorage gate is a known limitation, not a security hole.
- **Don't merge Integration to staging or main as part of this work.** The integration branch has been on the "deploy the branch, merge is a separate decision" plan since 2026-08-10. Until you've validated the work on a branch deploy, the standing rule holds.

---

## 4. The one decision you need to make

The plan above is otherwise complete and ready to execute. One choice:

**Merge style for the propagation** (Step 1 of §1, repeated in Steps 3 + 4):
- **Option A (recommended):** `git merge --ff-only origin/main` on staging, workflow-impl, and Integration. Linear history, no merge commits, identical tree.
- **Option B (matches your literal "merge them in staging" wording):** `git merge --no-ff origin/main` on all three, producing merge commits. Same tree, but with 3 extra merge commits in the history.

I'll ask via `ask_user` after you read this.

---

## 5. After approval — execution order (preview)

Assuming "Option A" merge style and "Tier 1 only" prioritization:

1. **Phase A — sync** (~25 min)
   1. FF staging → main
   2. Test staging
   3. FF workflow-impl → main
   4. Test workflow-impl
   5. FF Integration → main (with conflict resolution if needed)
   6. Test Integration
   7. Write `SESSION-HANDOFF-2026-08-20-BRANCH-SYNC.md`

2. **Phase B — Tier 1 on Integration** (~4 hours)
   1. Verify `claude/integration-environment-fixes-17e6se` still applies to current Integration tip
   2. If yes: cherry-pick D1–D6 + delete ContentModal
   3. If no: do them by hand on a fresh R-branch
   4. Test Integration
   5. Write `SESSION-HANDOFF-2026-08-20-INTEGRATION-MOBILE-FIXES.md`

3. **Phase C — Tier 1 + Tier 2 follow-ups** (next session, separate doc)

That's the plan. Awaiting your approval.
