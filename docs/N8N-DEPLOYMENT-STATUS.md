# n8n / MCP workflow pipeline — deployment status

> Written 2026-08-29, on `workflow-implementation-and-optimization`, during a
> branch-cleanup session. Not a new investigation — this records what could
> and could not be confirmed from the repo alone, so the next session (or the
> operator) doesn't have to re-derive it. Full setup: `n8n/ops/DEPLOY.md`.
> Architecture: `docs/WORKFLOW-IMPLEMENTATION-PLAN.md`, `docs/N8N-WORKFLOWS.md`.

## What's built (code-confirmed, all present in this branch)

- `supabase/migrations/0018_workflow_events.sql` (renumbered from an earlier
  0012, per `docs/SESSION-HANDOFF-2026-08-11-*`) — `workflow_events`,
  `workflow_runs`, `workflow_subscriptions`, RLS-locked to the service key.
- `netlify/functions/lib/workflowEnqueue.js`, `workflowOrchestrator.js`,
  `n8nSignature.js` — the queue, the poll/claim/dispatch loop, HMAC signing.
- `netlify/functions/workflow-orchestrator.js` — scheduled function (every 5
  min) + `/dispatch` and `/run-now` HTTP endpoints.
- `netlify/functions/scheduled-runner.js` already calls `enqueueEvent()`
  instead of hitting Resend/Slack directly.
- `netlify/functions/admin-automation.js` + `/admin/automation` UI.
- `n8n/workflows/*.json` — 17 files (11 MCP tool workflows, 5 automation
  flows, 1 smoke test), environment-agnostic via the `_ctx` pattern
  (`CLAUDE.md`'s "Per-environment config" rule).
- `n8n/{docker-compose.yml,.env.example,Caddyfile,backup.sh,restore.sh}` and
  the operator runbooks in `n8n/ops/`.

## What could NOT be confirmed from the repo (needs the operator or a live check)

1. **The three env vars.** `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`,
   `WORKFLOW_ORCHESTRATOR_TOKEN` were absent from `.env.example` before this
   session (now added, as documentation only — `.env.example` is never
   itself read at runtime). Whether they're actually set in Netlify's
   production/staging/branch-deploy contexts is not something a repo grep
   can answer. **Check `/admin/health`** (or `netlify env:list` if you have
   CLI access) before assuming either way.
2. **Whether the 17 workflows are imported into the running n8n instance**
   (`https://n8n-dev-692109205619.asia-south1.run.app/`, per `n8n/ops/DEPLOY.md`).
   `npx n8n import:workflow --input=n8n/workflows/` is idempotent — safe to
   re-run even if some are already there.
3. **Whether the 3 credentials exist in n8n** (`datiq-resend`,
   `datiq-slack-monitoring`, `datiq-supabase-service`) and are bound to the
   relevant nodes in each imported workflow. A workflow with unbound
   credentials fails silently at dispatch time, not at import time.
4. **Whether anything has ever actually run.** `workflow_events`/
   `workflow_runs` would show real rows if the pipeline has ever fired for a
   real schedule-alert. Query them (or check `/admin/automation`) rather
   than assuming from the code being present.

## Fastest path to find out where it actually stands

```bash
# 1. Is n8n reachable at all?
curl -sf https://n8n-dev-692109205619.asia-south1.run.app/healthz

# 2. Smoke test the orchestrator (needs WORKFLOW_ORCHESTRATOR_TOKEN set)
curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
  -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"

# 3. Has anything ever been queued?
#    SELECT count(*), max(created_at) FROM workflow_events;
#    (via Supabase SQL editor, service role)
```

If (1) fails, the VPS itself needs attention first — nothing else here
matters until n8n is reachable. If (1) succeeds but (2)/(3) show nothing,
the env vars are the missing piece. `n8n/ops/DEPLOY.md`'s TL;DR section is
the complete checklist once you know which of the three gaps above you're
actually closing.

## Not done this session, and deliberately out of scope

Actually reaching the VPS, setting Netlify env vars, or importing workflows
all need operator credentials (SSH access, Netlify dashboard access, the
n8n admin UI) this session does not have. This doc exists so that work is a
short, scoped checklist rather than a re-investigation.
