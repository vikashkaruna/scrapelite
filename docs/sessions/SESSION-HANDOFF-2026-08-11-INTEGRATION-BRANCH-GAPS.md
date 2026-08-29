# Gaps & TODOs — `Integration-with-outside-ecosystem`

> **For the next agent (or future-me in a fresh session):**
> this branch is now in sync with `origin/main` (`1cb3b3f`) — clean
> fast-forward, no code changes — and the full test suite is green.
> This doc captures the known gaps and TODOs that were either inherited
> from the previous session or are now visible after the sync.

## 1. Branch state

```
HEAD:         1cb3b3f Merge pull request #65 from vikashkaruna/staging
Base (common): 1cb3b3f with origin/main
vs origin:    10 commits ahead (8 from the fast-forward + 2 local unpushed from prior work: 127ad8a doc sweep, f5afca8 db-verify fix)
Stale local main:    b2a019e (irrelevant; origin/main is the real baseline)
```

```
$ git status
On branch Integration-with-outside-ecosystem
Your branch is ahead of 'origin/Integration-with-outside-ecosystem' by 10 commits.
nothing to commit, working tree clean
```

## 2. What this branch is FOR

The integration work — the third-party OAuth/PAT integrations (HubSpot,
Airtable, Notion, Slack, Zapier) and the Account + ExportIntegrations UI
that wires them into the rest of the app. It was originally built to be
merged into `staging` (which happened in `beacca3`); the next cycle is
re-apply on top of the latest `main` and pick up new work.

## 3. What this branch HAS that `workflow-implementation-and-optimization` does NOT

(Reverse-list of `git log Integration-with-outside-ecosystem..workflow-implementation-and-optimization`
— same baseline + workflow-specific extras. So the differences are what
the workflow branch added on top.)

- The 3 new third-party migrations `0019_api_keys.sql`,
  `0020_integration_connections.sql`, `0021_zapier_events.sql` (came in
  via the `origin/main` fast-forward; were already on main).
- All 5 third-party integration functions under `netlify/functions/integrations-*.js`
  (also came in via the fast-forward).
- `EditIntegrationModal.jsx`, `IntegrationConnectModal.jsx`, `PushIntegrationMenu.jsx`
  and their tests (came in via the fast-forward).
- The `ExportIntegrations` one-click refactor and the Account per-provider
  rich status display (from the prior session's 59 commits — already merged
  into staging, picked up via the fast-forward).
- The 10 help-site screenshot refresh (came in via `07c6703`).
- The Netlify edge-access bypass script + the public gallery seeder
  (came in via `e5de198`).

## 4. What this branch LACKS (relative to `workflow-implementation-and-optimization`)

The workflow branch has 16 commits of net-new work that the integration
branch has never seen. From newest to oldest:

| Commit | What |
|---|---|
| `0e295a4` | `feat(integrations): real per-user webhook setup (was: marked available, no UI)` — the WebhookSetupModal and its tests, plus the per-user webhook URL storage. |
| `0f7bb2b` | `refactor(workflows): make n8n workflows environment-agnostic via _ctx` — the deployment context object that flows with every workflow_event. |
| `d5ab1b8` | `Merge branch 'staging' into workflow-implementation-and-optimization` |
| `afe9931` | `docs: rebase base branch reference from prod-db-migration-commands to staging` |
| `d94c2e3` | `docs: update references to workflow_events migration (0012 -> 0018)` |
| `0282d4c` | `chore(migrations): renumber workflow_events from 0012 to 0018 (collision with billing_identity)` |
| `7f3cfcc` | `docs(guide): V2-IMPLEMENTATION-GUIDE — step-by-step from-scratch runbook` |
| `c69eeaa` | `docs(handoff): save 2026-07-27 v2 workflow session` |
| `eebafcf` | `docs(v2): N8N-WORKFLOWS, N8N-OPERATIONS, MCP-TOOLS + CLAUDE.md update (phase 7)` |
| `707bc8a` | `feat(admin): /admin/automation observability page (phase 6)` |
| `356b727` | `feat(workflows): n8n + MCP server pipeline (phases 1-5)` |
| `c32960f` | `docs(plan): v2 — self-hosted n8n as orchestrator + MCP server` |
| `70b7188` | `docs(plan): n8n + MCP server workflow implementation plan` |

Plus the merged 0022_workflow_events.sql (the workflow_events /
workflow_runs / workflow_subscriptions tables for the v2 queue) — this
IS the table that backs the new n8n orchestrator, so without it the
admin/automation page and the workflow-enqueue refactor have no queue
to write to.

## 5. Known gaps in this branch's scope

These are TODOs the branch has carried for a while (visible in the source
and in deferred items from prior session handoffs):

| Item | Where | Status |
|---|---|---|
| **HubSpot access_token encryption** | `netlify/functions/lib/hubspotService.js:23` — `TODO: pgcrypto envelope; for now store plaintext` | **DEFERRED** to v1.1. Risk: a DB leak exposes tokens. Mitigation: service key only, RLS on `integration_connections`. |
| **Hosted blog** | `src/pages/Blog.jsx:515` — `TODO: Replace with hosted blog (Ghost or Beehiiv)` | **DEFERRED**. Currently the static `/blog` page shows curated posts; full post routing is a Ghost/Beehiiv migration. |
| **Real Supabase promotion of 0019-0021** | The migrations apply cleanly to PGlite (test:db), but the real production Supabase project has not been ALTERed to add `api_keys` / `integration_connections` / `zapier_events` | **OPERATOR ACTION REQUIRED.** See §6. |
| **Recurring subscription billing** (Razorpay/Stripe Subscriptions) | documented in `docs/RECURRING-BILLING-DEFERRAL.md` (v1.0+ backlog) | **DEFERRED** to v1.0+. Not in this branch's scope. |
| **Stripe Checkout re-enable** | `docs/STRIPE-DEFERRAL.md` 6-step runbook | **DEFERRED** to v1.0+. |
| **Browser extension** (Chrome + Firefox + Edge, Manifest v3) | `extensions/datiq-extension/` exists, but is not packaged or submitted | **DEFERRED** — multi-week project. |
| **Netlify Edge Access bypass for `/api/*`** | per the late-night handoffs | **OPERATOR ACTION REQUIRED** (~2 min UI walkthrough on the branch preview). |

## 6. Operator actions required to take this branch to production

These are the only items blocking a production promotion of the
Integration-with-outside-ecosystem work (assuming the staging smoke has
held for at least one business day, per the prior handoff's guidance):

1. **Run the Supabase migrations on the live project** for `0019_api_keys`,
   `0020_integration_connections`, `0021_zapier_events`. The full SQL is
   in `supabase/migrations/run-all.sql` and the individual files; you
   can paste them one at a time into the Supabase SQL editor. Until
   this runs, the app degrades gracefully (saves succeed, the columns
   fall back to v1-only) but the third-party integrations and the
   Developer REST API won't work.

2. **Add `/api/*` to Netlify Edge Access bypass.** The in-browser
   `Connect` / `Push` calls hit the SSO gate on the branch preview
   without this. (~2 min in the Netlify UI: Edge Access → Bypass →
   add path `/api/*`.)

3. **(Optional) Open the corresponding PR.** This branch is now
   in sync with `main` and the test suite is green; if the next
   milestone is "promote the V1.0+ Integrations to production",
   this branch is the natural source branch.

## 7. Recommended next step on this branch

**Push the branch** to publish the 10 local commits, then either:

- **Start a follow-up R-branch** for any integration V1.1 work (e.g.
  HubSpot token encryption, the hosted blog migration, or the
  "Stripe Checkout re-enable" runbook).
- **OR** cherry-pick the v2 workflow pieces (`0022_workflow_events.sql`,
  the WebhookSetupModal, the admin/automation page) from
  `workflow-implementation-and-optimization` if you want the integration
  work to ship with the v2 queue plumbing already in place. The
  WebhookSetupModal is small and self-contained; the admin/automation
  page depends on `0022` and on the orchestrator function (heavier
  cherry-pick, would need a feature branch).
