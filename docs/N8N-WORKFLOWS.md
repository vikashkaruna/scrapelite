# n8n Workflows — DatIQ

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4, §7
> **Workflow JSONs:** `n8n/workflows/*.json`
> **Generator:** `scripts/generate-n8n-workflows.mjs`

The DatIQ v2 workflow pipeline uses **17 n8n workflows** total: **11 MCP tool workflows** (callable by Claude Desktop / Claude Code via the n8n MCP server endpoint) and **5 automation workflows** (called by the Netlify orchestrator when events fire) plus **1 smoke test**. Every workflow's source JSON lives in the repo; the generator produces the bulk of them from a compact spec.

---

## File map

| File | Trigger | Purpose |
|---|---|---|
| `00-datiq-smoke-test.json` | Schedule (every 5 min) | Hello-world. Pings the orchestrator. Use to confirm n8n → DatIQ connectivity. |
| `datiq_list_pending_workflows.json` | MCP Trigger | List events in the queue (filter by state/kind/user_id). |
| `datiq_get_workflow_event.json` | MCP Trigger | Get one event with all attempts. |
| `datiq_process_pending_workflow.json` | MCP Trigger | Force-dispatch a pending event now. |
| `datiq_retry_workflow_event.json` | MCP Trigger | Reset a failed event's attempts and re-queue. |
| `datiq_cancel_workflow_event.json` | MCP Trigger | Mark an event as cancelled. |
| `datiq_list_schedules.json` | MCP Trigger | List monitoring schedules. |
| `datiq_create_schedule.json` | MCP Trigger | Create a new monitoring schedule. |
| `datiq_pause_schedule.json` | MCP Trigger | Pause a schedule. |
| `datiq_resume_schedule.json` | MCP Trigger | Resume a paused schedule. |
| `datiq_delete_schedule.json` | MCP Trigger | Delete a schedule. |
| `datiq_diagnose_pending_workflow.json` | MCP Trigger | Read an event + its runs + the target schedule + the user and return a structured diagnostic. |
| `datiq_schedule_changed_router.json` | Webhook | The killer workflow. Replaces the dropped `SCHEDULE_ALERT_WEBHOOK`. Routes `schedule.changed` events to Slack + Resend. |
| `datiq_contact_router.json` | Webhook | Routes `contact.received` events to Slack + CRM webhook. |
| `datiq_user_lifecycle.json` | Webhook | Welcome / reengagement drip. Sends Resend emails for `user.lifecycle` events. |
| `datiq_failure_alert.json` | Webhook | Posts operational alerts to `#datiq-alerts` Slack channel. |
| `datiq_daily_digest.json` | Schedule (cron `0 21 * * *`) | Daily digest — emails each user a summary of their schedule activity from the past 24h. |

---

## How to import / re-import

### First-time setup

1. Log in to your n8n instance at `https://n8n-dev-692109205619.asia-south1.run.app/`
2. Go to **Settings → API** and create an API Key (name: "DatIQ MCP")
3. Copy the key and set it in Netlify:
   ```bash
   N8N_WEBHOOK_SECRET=<your-api-key>
   N8N_BASE_URL=https://n8n-dev-692109205619.asia-south1.run.app
   ```
4. Configure n8n's `.env` (one-time, on the n8n host):

   ```bash
   # This n8n's own URL — the workflows POST back to it via $env.N8N_BASE_URL
   N8N_BASE_URL=https://n8n-dev-692109205619.asia-south1.run.app
   # Schedule-triggered workflows (no event body) need this for the ping URL
   SITE_URL=https://datiq.app
   ```

   See `n8n/ops/SECRETS.md` for the full list and what each variable does.
5. For each workflow, open in n8n UI and:
   - Create the credentials it needs (`datiq-resend`, `datiq-slack-monitoring`, `datiq-supabase-service`, `datiq-orchestrator`)
   - Bind the credentials to the relevant nodes
   - Activate the workflow (toggle in the top-right)

### Why the workflows don't need per-environment editing

Every URL/host in the generated workflow JSONs is an n8n expression that reads from the per-event `_ctx` field (set by the DatIQ orchestrator at dispatch time) or from `$env.*` (n8n's own `.env`). The mapping:

| What | Lives in | Example n8n expression |
|---|---|---|
| Supabase project host | `_ctx.supabase_url` (per event) | `"={{ 'https://' + $json._ctx.supabase_url + '/rest/v1/workflow_events' }}"` |
| DatIQ site host | `_ctx.site_url` (per event) or `$env.SITE_URL` (per instance) | `"={{ 'https://' + $json._ctx.site_url + '/api/workflow-orchestrator/dispatch' }}"` |
| n8n's own host (for internal webhook URLs) | `$env.N8N_BASE_URL` (per instance) | `"={{ $env.N8N_BASE_URL + '/webhook/datiq/schedule-changed' }}"` |
| Supabase service key | n8n credential `datiq-supabase-service` | `"=Bearer {{ $credentials['datiq-supabase-service'].value }}"` |

So the SAME `n8n/workflows/*.json` works in production, staging, and every branch deploy. The DatIQ orchestrator reads `process.env` (Netlify-set per context) at enqueue time, builds `_ctx`, and carries it in the event payload. n8n reads `_ctx` from `$json` per event.

### Bulk import (existing instance)

From your local machine:

```bash
# (optional) install the n8n CLI
npm install -g n8n

# Import all workflows in one go
npx n8n import:workflow --input=n8n/workflows/
```

This works for the Webhook and Schedule triggered workflows. The MCP tool workflows need the MCP server trigger node, which requires a slightly different import (see n8n docs for "MCP Server Trigger").

### After editing

When you change a workflow in the n8n UI, export it back to JSON and commit:

```bash
npx n8n export:workflow --all --output=./n8n-backup.json
# diff against git, update n8n/workflows/*.json
```

The CI in `.github/workflows/` (Phase 5) re-validates the JSON on every PR to catch malformed exports.

---

## Authentication

The DatIQ orchestrator signs every dispatch with HMAC-SHA256:

```
X-DatIQ-Signature: t=<epoch_ms>,v1=<hex_sha256_hmac>
```

The webhook workflows verify this signature in the Webhook trigger node's authentication settings (set to "Header Auth" with the shared secret). Reject unsigned or expired requests (5-min replay window).

For the MCP server endpoint, n8n's MCP Server Trigger node has its own API key auth (the same `DATIQ_N8N_API_KEY` value). Set in n8n Settings → API.

---

## The killer workflow — `datiq_schedule_changed_router`

This is the one that replaces the dead `SCHEDULE_ALERT_WEBHOOK`. Triggered by the orchestrator every time a `schedule.changed` event is dispatched. Steps:

1. **Resolve channels** (Code node) — reads user preferences from `workflow_subscriptions`; falls back to the channels in the event payload.
2. **Post to Slack** (`#monitoring`) — Block Kit message with the schedule label, target, intent, hash diff, and detected timestamp.
3. **Send Resend email** — only if `alertEmail` is set; uses `ALERT_EMAIL_FROM` env var.
4. **Mark done** — PATCHes the `workflow_events` row to `state: "done"`.

If any step fails, the workflow's "Error" branch fires → the orchestrator applies backoff and retries (1m, 5m, 30m, 2h, 12h). After 5 attempts, the event is marked `failed` permanently and surfaces in `/admin/automation` for human attention.

---

## Editing workflow JSONs

Most edits go through the n8n UI; the JSON is the export. For pure data changes (e.g., updating the Slack channel name), edit the JSON directly and re-import.

For new workflows, prefer the generator:

```bash
# Edit scripts/generate-n8n-workflows.mjs and add your workflow to one of the arrays
node scripts/generate-n8n-workflows.mjs
```

The generator produces 14 of the 17 workflows from compact specs. The 1 hand-written workflow (`00-datiq-smoke-test.json`) is the only one not generated, because it has unusual shape (schedule + http request chain).

---

## Testing the workflows

### Without a real n8n instance

The CI validates JSON shape via `netlify/__tests__/n8n-workflow-json.test.js` (122 tests):
- every JSON parses
- every workflow has a `name`, `nodes`, `connections`, `active`, `id`
- every workflow's name starts with `datiq_` or `00_datiq_`
- node IDs are unique
- triggers have no incoming connections
- non-trigger nodes have at least one incoming connection
- MCP workflows' tool name matches the workflow name
- MCP workflows' tool description is > 20 chars

### With a real n8n instance

1. Open the workflow in the n8n UI
2. Click "Test workflow" or "Execute node"
3. Verify the output (Slack message arrived, email sent, etc.)
4. Check the "Executions" tab for the history

For the smoke test workflow, just wait — it runs every 5 min automatically. Verify the ping shows up in n8n → Executions and in your DatIQ orchestrator logs.

---

## Common edits

| What you want to change | Where |
|---|---|
| Slack channel for change alerts | `datiq_schedule_changed_router.json` → "Post to Slack" node → `channel` field |
| Email template for change alerts | `datiq_schedule_changed_router.json` → "Send Resend email" node → `jsonBody` field |
| Daily digest cron time | `datiq_daily_digest.json` → "Daily 21:00 UTC" node → `expression` field |
| Add a new automation flow | Add to `scripts/generate-n8n-workflows.mjs` → `AUTOMATION_WORKFLOWS` array |
| Add a new MCP tool | Add to `MCP_TOOLS` array in the generator |
| Change the MCP tool schema (input shape) | `toolInputSchema` in the spec, then re-run the generator |

After any change, run:
```bash
node scripts/generate-n8n-workflows.mjs
npx vitest run --dir . --exclude '.claude/**' netlify/__tests__/n8n-workflow-json.test.js
```

Then commit the updated JSON and re-import into n8n.
