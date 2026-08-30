# MCP Tools — DatIQ

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §7.1, §7.2
> **Endpoint:** `https://n8n-dev-692109205619.asia-south1.run.app/mcp/<workflow-path>`
> **Auth:** `Authorization: Bearer <DATIQ_N8N_API_KEY>`

The DatIQ v2 pipeline exposes 11 MCP tools via the n8n MCP Server Trigger. Claude Desktop, Claude Code, and any other MCP client can call these to read DatIQ state, manage schedules, and process the workflow queue.

---

## Connection setup

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "datiq": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse"],
      "env": {
        "MCP_SERVER_URL": "https://n8n-dev-692109205619.asia-south1.run.app/mcp",
        "MCP_API_KEY": "<DATIQ_N8N_API_KEY>"
      }
    }
  }
}
```

### Claude Code (per-project `.mcp.json`)

```json
{
  "mcpServers": {
    "datiq": {
      "type": "sse",
      "url": "https://n8n-dev-692109205619.asia-south1.run.app/mcp",
      "headers": { "Authorization": "Bearer <DATIQ_N8N_API_KEY>" }
    }
  }
}
```

### mavis session

The Mavis agent in this codebase already has the connection wired (when `DATIQ_MCP_API_KEY` is set in the env). I can call any of the 11 tools directly.

---

## Tool reference (11 tools)

All tools return JSON. The `kind` field discriminates between event types in list responses.

### 1. `datiq_list_pending_workflows`

List events in the automation queue. The default is the pending state, but you can filter by any state.

**Input:**
```json
{
  "state": "pending" | "processing" | "done" | "failed" | "cancelled",  // optional
  "kind": "schedule.changed" | "contact.received" | "user.lifecycle" | "op.alert",  // optional
  "user_id": "uuid",  // optional
  "limit": 50  // optional, max 200
}
```

**Returns:** Array of event summaries, sorted by `next_attempt_at` ascending.

**Use this for:** "What's pending?", "What failed in the last 24h?", "Show me the contact-form events for user X."

---

### 2. `datiq_get_workflow_event`

Get a single event with all its `workflow_runs` (per-attempt logs). Use when you need to debug a specific event.

**Input:**
```json
{ "event_id": "wfe_01H..." }
```

**Returns:** `{ event: {...}, runs: [{ attempt_n, response_status, error, duration_ms, ... }] }`

**Use this for:** "Why did this event fail?" — the runs array shows the HTTP status / error from each attempt.

---

### 3. `datiq_process_pending_workflow`

Force-dispatch a pending event immediately. Bypasses the 5-min orchestrator poll. Synchronous.

**Input:**
```json
{ "event_id": "wfe_01H..." }
```

**Returns:** `{ ok, dispatched_to, ... }` — same shape as the orchestrator's `/dispatch` endpoint.

**Use this for:** "Re-run this now" — typically after fixing the underlying issue (rotated a credential, cleared an upstream outage).

---

### 4. `datiq_retry_workflow_event`

Reset a failed event's `attempts` to 0 and set its state back to `pending`, so the next orchestrator run picks it up.

**Input:**
```json
{
  "event_id": "wfe_01H...",
  "reset_attempts": true  // default true; set false to keep current attempt count
}
```

**Returns:** The updated event row.

**Use this for:** "Try again, but with the current state preserved" vs "Wipe the failure and start fresh."

---

### 5. `datiq_cancel_workflow_event`

Mark an event as `cancelled` so the orchestrator won't retry it. The event stays in the table for audit.

**Input:**
```json
{
  "event_id": "wfe_01H...",
  "reason": "Optional human-readable note for the audit log"
}
```

**Returns:** The updated event row.

**Use this for:** "This event is obsolete, stop trying to deliver it."

---

### 6. `datiq_list_schedules`

List monitoring schedules. Filter by user (admin-only) or status.

**Input:**
```json
{
  "user_id": "uuid",  // optional
  "status": "active" | "paused"  // optional
}
```

**Returns:** Array of schedules, sorted by `updated_at` descending.

**Use this for:** "What is user X currently monitoring?" / "Show me all paused schedules."

---

### 7. `datiq_create_schedule`

Create a new monitoring schedule. The server stores it in `public.scheduled_tasks`; the orchestrator picks it up at the next hourly run.

**Input:**
```json
{
  "user_id": "uuid",                    // required
  "type": "track" | "batch",            // required
  "target": "https://example.com" | ["url1","url2"],  // required
  "cron": "0 9 * * *",                  // required, 5-field UTC cron
  "intent": "summary",                  // optional, default "summary"
  "alert_email": "user@example.com",    // optional
  "label": "Daily check",               // optional, auto-generated if missing
  "render_js": false,                   // optional, default false
  "custom_prompt": "Find the price",    // optional
  "expires_at": "2026-12-31T00:00:00Z"  // optional
}
```

**Returns:** The created schedule row.

**Use this for:** Programmatic schedule creation. Most users do this through the UI; agents might create a schedule on a user's behalf.

---

### 8. `datiq_pause_schedule`

Pause an active schedule. The orchestrator won't fire it while paused.

**Input:** `{ "schedule_id": "sch_..." }`

---

### 9. `datiq_resume_schedule`

Resume a paused schedule. `next_run_at` is recomputed from the cron.

**Input:** `{ "schedule_id": "sch_..." }`

---

### 10. `datiq_delete_schedule`

Permanently delete a schedule and all its history. Cannot be undone.

**Input:** `{ "schedule_id": "sch_..." }`

---

### 11. `datiq_diagnose_pending_workflow`

The diagnostic tool. Given an event ID, fetches the event + recent attempts + the target schedule (if any) + the user (if any) and returns a structured diagnostic. Best used by an agent that needs to "tell me what happened" without manually stitching 4 queries.

**Input:** `{ "event_id": "wfe_01H..." }`

**Returns:** `{ event, runs, schedule?, user? }` — anything not found is `null`.

**Use this for:** "Why did this fail?" answered in one round-trip.

---

## Example session (Mavis, fixing a failed event)

```text
You: "Why is the schedule-changed alert for `lumio.io` failing?"

Mavis: *calls datiq_list_pending_workflows with state=failed, kind=schedule.changed*
       → finds 3 events; one for `sch_lumio` with last_error="n8n 503: upstream timeout"
       *calls datiq_diagnose_pending_workflow with the event id*
       → returns { event, runs: [{ response_status: 503 }], schedule: { id, cron, intent } }
       "The orchestrator tried 5 times. n8n returned 503 each time. Looking at the
        runs, the upstream was the Slack webhook — the channel might have been
        renamed. Want me to retry? Or check the n8n credentials?"

You: "Retry."

Mavis: *calls datiq_retry_workflow_event*
       "Reset to attempts=0, state=pending. Next orchestrator run (within 5 min)
        will pick it up. Want me to force-dispatch now?"

You: "Yes."

Mavis: *calls datiq_process_pending_workflow*
       "Dispatched. The orchestrator reports ok=true, Slack message landed in
        #monitoring."
```

---

## How to add a new tool

1. Open `scripts/generate-n8n-workflows.mjs`
2. Add a new spec to either the `MCP_TOOLS` or `SCHEDULE_MCP_TOOLS` array
3. Run `node scripts/generate-n8n-workflows.mjs`
4. Tests pass via `npx vitest run --dir . --exclude '.claude/**' netlify/__tests__/n8n-workflow-json.test.js`
5. Commit and re-import into n8n
6. Restart Claude Desktop / reconnect to see the new tool

---

## How to remove a tool

1. Delete the entry from the generator
2. Re-run the generator
3. Re-import into n8n (the workflow is gone)
4. Restart the MCP client

The old tool won't appear in the client's tool list after the restart. Other tools are unaffected.
