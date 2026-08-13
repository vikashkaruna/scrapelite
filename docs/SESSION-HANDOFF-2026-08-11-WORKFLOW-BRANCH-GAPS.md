# Gaps & TODOs — `workflow-implementation-and-optimization`

> **For the next agent (or future-me in a fresh session):**
> this branch is now in sync with `origin/main` (`1cb3b3f`) and all test
> suites are green (after 6 small fixes applied in commit `c51dd01`).
> The v2 workflow pipeline (n8n + self-hosted orchestrator + MCP server)
> is built; this doc captures what is shipped, what is in-progress, and
> what is still deferred.

## 1. Branch state

```
HEAD:         c51dd01 fix(merge): resolve origin/main → workflow-implementation-and-optimization test failures
Parent:       c19482b merge: bring origin/main into workflow-implementation-and-optimization (...)
Common base:  1cb3b3f Merge pull request #65 from vikashkaruna/staging (== origin/main)
vs origin:    68 commits ahead
```

```
$ git status
On branch workflow-implementation-and-optimization
Your branch is ahead of 'origin/workflow-implementation-and-optimization' by 68 commits.
nothing to commit, working tree clean
```

## 2. What this branch is FOR

The v2 automation pipeline: replace the old direct Resend / Slack / webhook
delivery with a durable queue + an external orchestrator (self-hosted
n8n on a Hostinger VPS) that fans out per-channel. The migration plan
is in `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` and the runbook is in
`docs/V2-IMPLEMENTATION-GUIDE.md`.

The 6 phase commits (from `356b727`) ship phases 1-7 of the plan;
the AdminAutomation observability page ships phase 6; the docs/CLAUDE.md
update + N8N-WORKFLOWS + N8N-OPERATIONS + MCP-TOOLS ship phase 7.

## 3. What this branch HAS that `Integration-with-outside-ecosystem` does NOT

Everything the integration branch has (after the origin/main fast-forward)
PLUS the 16 workflow-specific commits listed in
`docs/SESSION-HANDOFF-2026-08-11-INTEGRATION-BRANCH-GAPS.md` §4. In summary:

### Code

- **Webhook setup is real now.** `WebhookSetupModal.jsx` + per-user webhook
  URL storage in `localStorage` (key `datiq.webhookUrl`). The Integrations
  catalog card is marked `available` (was `coming-soon` before this session's
  merge fix).
- **Admin sidebar split.** Old single `Automation` → `Workflows` + `Monitoring`.
  `/admin/automation` is the n8n pipeline observability page; `/admin/monitoring`
  is the ops + scheduled-runner dashboard.
- **AdminAutomation observability page** (`src/pages/admin/AdminAutomation.jsx`)
  with its own integration test (5 files, 7 tests).
- **v2 enqueue helper** (`netlify/functions/lib/workflowEnqueue.js`) — every
  function that wants to push an event into the queue calls `enqueue({...})`.
- **Workflow orchestrator function** (`netlify/functions/workflow-orchestrator.js`)
  — polls `workflow_events` every 5 min, dispatches to n8n.
- **`0022_workflow_events.sql`** — the 3 backing tables (`workflow_events`,
  `workflow_runs`, `workflow_subscriptions`) + the `workflow_set_updated_at`
  trigger function + 2 triggers.

### Docs

- `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` — the migration plan.
- `docs/V2-IMPLEMENTATION-GUIDE.md` — step-by-step from-scratch runbook.
- `docs/N8N-WORKFLOWS.md`, `docs/N8N-OPERATIONS.md`, `docs/MCP-TOOLS.md` —
  per-piece deep dives.
- `docs/CLAUDE.md` update (phase 7).

## 4. What this branch needs to be production-ready

The v2 pipeline code is done. The remaining work is **deployment + ops**:

| # | Item | Owner | Where |
|---|---|---|---|
| 1 | **Run the new migrations on production Supabase**: `0019_api_keys`, `0020_integration_connections`, `0021_zapier_events`, `0022_workflow_events`. The PGlite `test:db` confirms they apply cleanly. The current production DB does NOT have these tables yet. | **operator (you)** | `supabase/migrations/run-all.sql` and the individual `0019..0022_*.sql` files |
| 2 | **Provision the self-hosted n8n** (Hostinger VPS). Wire its webhook URLs + service key into the Netlify function env (`N8N_WEBHOOK_URL_*`, `N8N_API_KEY`, `HOSTINGER_N8N_BASE_URL`). The env-driven `_ctx` plumbing is already in place. | **operator (you)** | per `docs/N8N-OPERATIONS.md` |
| 3 | **Enable the orchestrator cron.** `netlify/functions/workflow-orchestrator.js` exports a `config.schedule` (every 5 min). The Netlify `netlify.toml` `[functions."workflow-orchestrator"]` block needs to be added (see §11 of the implementation plan). Until enabled, events sit in `pending` forever. | **operator (you)** | `netlify.toml` + `docs/V2-IMPLEMENTATION-GUIDE.md` |
| 4 | **Seed `workflow_subscriptions` for existing users.** Every user with a current `scheduled_tasks` row should get a corresponding `workflow_subscriptions` row so the orchestrator can fan out the way the v1 direct dispatcher used to. (Migration script in the guide §5.) | **operator (you)** | `docs/V2-IMPLEMENTATION-GUIDE.md` §5 |
| 5 | **Add `/api/*` to Netlify Edge Access bypass** on the branch preview so the in-browser `Connect` / `Push` calls don't hit the SSO gate. | **operator (you)** | Netlify UI, ~2 min |
| 6 | **Optional: encrypt HubSpot tokens** (`pgcrypto` envelope on `integration_connections.access_token`). Carried as v1.1 TODO; not blocking. | **dev (next iteration)** | `netlify/functions/lib/hubspotService.js:23` |

## 5. Known gaps in this branch's scope

| Item | Where | Status |
|---|---|---|
| **PGP-encrypted HubSpot tokens** | `netlify/functions/lib/hubspotService.js:23` — `TODO: pgcrypto envelope; for now store plaintext` | **DEFERRED** to v1.1. Same risk as on the integration branch. |
| **Hosted blog** | `src/pages/Blog.jsx:515` — `TODO: Replace with hosted blog (Ghost or Beehiiv)` | **DEFERRED**. Static `/blog` page suffices for now. |
| **Browser extension packaging** | `extensions/datiq-extension/` is committed but not packaged for the Chrome / Firefox stores. | **DEFERRED** — multi-week project. |
| **AEO/GEO/SEO P0 + P1 not re-applied** | The integration branch (and main) carry the AEO/GEO/SEO P0 sweep (og-card, BreadcrumbList, llms-full.txt, 4 use-case pages, gallery samples) and the P1 sweep (allow OAI-SearchBot, Googlebot, Claude-User in robots.txt). The workflow branch has these too — they came in via the `origin/main` merge. | **DONE** (inherited via main). |
| **No retry hardening on the orchestrator** | `workflow-orchestrator.js` handles `attempts` / `next_attempt_at` / `state` correctly, but the error classification for "n8n is up but returned 500" vs "n8n is down" is naive (any non-2xx → retry). Acceptable for v2, but worth tightening when traffic warrants. | **FOLLOW-UP**. |

## 6. Recommended next step on this branch

**Push the branch** to publish the 68 local commits, then:

1. **Take the operator action items in §4** in order. The biggest blocker
   is #1 (run the migrations on production) — the orchestrator (#3) is
   useless without the workflow_events table.
2. **Resume v2 work in a follow-up R-branch.** Candidates, in order of
   impact:
   - `pgcrypto envelope` for HubSpot tokens (security v1.1, blocks audit
     signoff in some enterprise contracts).
   - **Tighten orchestrator retry classification** (per §5 last row).
   - **Wire `webhook_url` into the v2 queue**: today the v1 `notifyWebhook`
     fires on the integration branch, but the workflow branch's
     `enqueue({ channels: [{ type: 'webhook' }] })` doesn't yet have a
     webhook channel handler. The orchestrator hands it to n8n, which
     does the HTTP POST — but the local n8n workflow for it isn't
     written yet.
3. **OR** open a PR back to `main` / `staging` to promote the v2
   pipeline. After §4 #1-3 are done, this is the natural next
   release.

## 7. What this session's merge verification surfaced (for posterity)

The 6 fixes shipped in `c51dd01` are documented in
`docs/SESSION-HANDOFF-2026-08-11-SYNC-MAIN-INTO-SUB-BRANCHES.md` §2.3.
The most subtle one was #3 (`schedule.userId` vs `schedule.user_id`) —
that bug would have silently broken per-user Slack + Zapier fan-out
for every schedule change in production. Worth keeping the pattern
("use the snake_case the runner built, not a camelCase guess") in
mind for future refactors of the runner.

The other 5 were straightforward test/code drift after the Webhook
feature went from "coming-soon, no UI" to "available with full UI"
(`0e295a4`), and after the admin sidebar split ("Automation" →
"Workflows" + "Monitoring"). The drift was expected and caught cleanly
by the existing test suite — no production incident, no customer
impact.
