# DatIQ — n8n + MCP Workflow Implementation Plan

> **Branch:** `workflow-implementation-and-optimization` (from `main` @ `f56306d`)
> **Status:** Plan only. No code, no n8n flows, no MCP server yet — review and approve before any implementation.
> **Author:** Mavis (Vikash's coding agent)
> **Goal:** Replace the silently-dropped `SCHEDULE_ALERT_WEBHOOK` with a real, observable, debuggable automation pipeline. Add a programmatic MCP surface so any MCP client (Claude Desktop, Claude Code, Cursor, etc.) can read DatIQ's automation state, queue work, and process it.

---

## 1. Why this exists — the gap on `main`

The R19 scheduler is shipped but has a known soft spot, flagged in `netlify/functions/scheduled-runner.js:170`:

```js
// TODO(SCHEDULE_ALERT_WEBHOOK): wire up a real automation endpoint ...
// Until this is set, change alerts are silently dropped ...
async function postAlertWebhook(schedule, changedSummary, detectedAt, emailed) {
  const hook = process.env.SCHEDULE_ALERT_WEBHOOK || process.env.VITE_WEBHOOK_URL || "";
  if (!hook) return;  // ← drops the event entirely
  ...
}
```

Today the only things that fire on a detected schedule change are:
- A real email via Resend (if `RESEND_API_KEY` is set, sent to `schedule.alertEmail`).
- A Slack Block Kit message (if `SLACK_WEBHOOK_URL` is set, posted to that one channel).
- A JSON webhook (if `SCHEDULE_ALERT_WEBHOOK` is set, posted once with no retry, no signing, no observability — and right now it's unset in production, so this path is dead).

What's missing:
- **No queue** — a Resend 5xx or a Slack 429 means the alert is gone. No retry, no DLQ.
- **No routing** — every alert goes to one inbox and one Slack channel. No per-user / per-team rules.
- **No observability** — there's no "what fired, when, did it deliver?" dashboard.
- **No programmatic access** — there's no way for me (or any agent) to ask "what's queued right now?" or "re-run the failed email for schedule X". The `scheduled_tasks` table has the schedule, but no `pending_workflow_events` table tracks the actions derived from it.
- **No multi-channel expansion** — users can't say "also DM me on Telegram when this changes" or "also push to Notion" without code.

`n8n` solves the routing + multi-channel part. `MCP` solves the observability + programmatic-access part. A small `pending_workflow_events` queue ties them together with retries.

This plan does **not** replace `scheduled-runner.js` — that function stays. It just stops trying to be an orchestrator. The new `workflow-orchestrator` function becomes the one place that enqueues work; `scheduled-runner.js` becomes a "scrape + diff + enqueue change event" function and stops talking to email/Slack/webhook directly. That's the only behavior change to existing code.

---

## 2. Target architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER  (DatIQ UI)                        │
│                                                                     │
│  /schedules · /account · /admin · HeroComposer …                    │
│        │            │           │                                    │
│        ▼            ▼           ▼                                    │
│  apiClient.* (extractions, schedules, contact-email)                 │
└──────────────┬─────────────────────────────────────────┬─────────────┘
               │ HTTPS                                   │ HTTPS
               ▼                                         ▼
┌──────────────────────────────┐         ┌─────────────────────────────┐
│      Netlify Functions       │         │        n8n (cloud or        │
│                              │         │        self-hosted)         │
│  /api/extract                │         │                             │
│  /api/ai                     │         │  • Workflows in /n8n/*.json │
│  /api/schedules              │         │  • Visual editor at host    │
│  /api/contact-email          │         │  • Credentials encrypted    │
│  /api/extractions            │         │  • Postgres for run history │
│  /api/admin-*                │         │                             │
│                              │         │  Workflows:                 │
│  ┌────────────────────────┐  │         │  ① schedule.changed         │
│  │  scheduled-runner.js   │──┼──POST──▶│  ② contact.received         │
│  │  (hourly cron trigger) │  │  events │  ③ user.signed_up           │
│  │  scrape + diff +       │  │         │  ④ payment.captured         │
│  │  enqueue (no longer    │  │         │  ⑤ extraction.completed     │
│  │   talks to Resend      │  │         │                             │
│  │   directly)            │  │         │  Each workflow:             │
│  └────────────────────────┘  │         │  - branches on type/intent  │
│                              │         │  - posts to Slack / Discord │
│  ┌────────────────────────┐  │         │  - sends via Resend / SMTP  │
│  │ workflow-orchestrator  │◀─┼─poll────│  - updates DatIQ DB         │
│  │  (Netlify Scheduled    │  │         │  - writes workflow_events   │
│  │   Function, every 5m)  │  │         │    .state = done / failed   │
│  │                        │  │         │                             │
│  │  • polls workflow_     │  │         └──────────┬──────────────────┘
│  │    events table for    │  │                    │
│  │    pending rows        │  │                    │
│  │  • posts each event    │  │                    │
│  │    to n8n webhook      │  │                    │
│  │  • marks processing    │  │                    │
│  │  • applies backoff     │  │                    │
│  └────────────────────────┘  │                    │
│                              │                    │
└──────────────┬───────────────┘                    │
               │                                    │
               ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Supabase (Postgres)                            │
│                                                                     │
│  public.scheduled_tasks        (R19, exists)                        │
│  public.extractions             (R19, exists)                        │
│  public.workflow_events         (NEW)  ← queue, see §5               │
│  public.workflow_runs           (NEW)  ← per-attempt log             │
│  public.workflow_subscriptions  (NEW)  ← user-channel prefs          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                ▲                                          ▲
                │                                          │
                │  mcp-server (Node/TS, stdio + HTTP)      │
                │  ───────────────────────────────────    │
                │  Tools:                                  │
                │    list_pending_workflows                │
                │    get_workflow_event                    │
                │    process_pending_workflow              │
                │    retry_workflow_event                  │
                │    cancel_workflow_event                 │
                │    send_email_via_datiq                 │
                │    trigger_n8n_workflow                 │
                │    list_schedules                        │
                │    get_schedule                          │
                │    create_schedule                       │
                │    pause_schedule / resume_schedule      │
                │    delete_schedule                       │
                │    get_user_subscription                 │
                │    get_recent_extractions                │
                │  Resources:                              │
                │    datiq://workflow-events               │
                │    datiq://schedules                      │
                │    datiq://extractions/{id}              │
                │    datiq://users/{id}                    │
                │  Prompts:                                │
                │    diagnose-pending-workflow             │
                │    summarize-runs-for-schedule           │
                │    write-change-alert-copy               │
                │                                          │
                │  Connects to:                            │
                │    • Supabase REST (service key)         │
                │    • DatIQ /api/* (apiClient)            │
                │    • n8n REST API (workflow triggers)    │
                │    • Resend (delegated through DatIQ)    │
                │                                          │
                │  Hosted on: Fly.io / Render / Railway    │
                │  Auth: DatIQ admin token (HMAC, same    │
                │  scheme as /admin/*)                    │
                │                                          │
                │  Consumed by:                            │
                │    • Claude Desktop                      │
                │    • Claude Code (mavis session)         │
                │    • Cursor / Windsurf / etc.            │
                │    • Custom scripts (HTTP)               │
                └──────────────────────────────────────────┘
```

---

## 3. What's "pending state" — the concrete queue

The user said *"wherever the workflow implementation is in the pending state"*. Concretely that means four buckets, all funneling into one table:

| Bucket | Source | Example | Default channel |
|---|---|---|---|
| **Scheduled change detected** | `scheduled-runner.js` hourly | `lumio.io/pricing` changed since last run | email to `schedule.alertEmail` + Slack to ops channel |
| **User notification preference** | new — user opts in via /account | "also DM me on Telegram when this fires" | Telegram |
| **Contact form routed** | `contact-email.js` | /contact form submitted with type=enterprise | email to `admin@` + CRM webhook |
| **Payment / lifecycle event** | `payment-webhook.js` | Razorpay `payment.captured` | email receipt + Slack #sales |
| **Operational** | new — fires on runner error | scrape failed 3x in a row | Slack #datiq-alerts |

All five produce a row in `public.workflow_events` with a stable shape:

```json
{
  "id": "wfe_01H...",
  "kind": "schedule.changed",
  "ref_id": "sch_abc123",
  "user_id": "uuid",
  "payload": { "schedule": {...}, "diff": {...} },
  "channels": [
    { "type": "email",  "to": "vikash@...", "template": "schedule.changed" },
    { "type": "slack",  "channel": "#monitoring", "template": "schedule.changed" },
    { "type": "n8n",    "workflow_id": "schedule-changed-router", "webhook_path": "/webhook/sched" }
  ],
  "state": "pending",          // pending → processing → done | failed | cancelled
  "attempts": 0,
  "max_attempts": 5,
  "next_attempt_at": "2026-07-26T16:05:00Z",
  "last_error": null,
  "created_at": "...",
  "updated_at": "..."
}
```

The `workflow-orchestrator` Netlify Function polls this table every 5 minutes (separate from the hourly schedule runner) and dispatches each `pending` row to the first channel that's ready, marks it `processing`, and on response marks it `done` or bumps `attempts` and applies exponential backoff (1m, 5m, 30m, 2h, 12h, then `failed`).

---

## 4. n8n workflows to ship (concrete list)

All stored as versioned JSON in `n8n/workflows/*.json` so the repo is the source of truth. The n8n instance is the runtime; the JSON is the deployable artifact.

### ① `01-schedule-changed-router.json` — **highest priority, replaces today's dead `SCHEDULE_ALERT_WEBHOOK`**
- **Trigger:** Webhook (POST `/webhook/datiq/schedule-changed`)
- **Inputs:** `{schedule, diff, emailSent, alertEmail, type, intent, target}`
- **Steps:**
  1. Switch on `intent` (summary / contacts / pricing / map / custom) — different copy per intent
  2. Always: post to Slack `#monitoring` with Block Kit (rich summary)
  3. If `alertEmail` set and `emailSent` is false: send via Resend
  4. If `user.workflow_subscriptions` has `discord` / `telegram` / `webhook` channels: fan out
  5. If schedule is `batch`: aggregate per-URL diffs into one summary, send one email
  6. **Update DB** via Supabase node: `workflow_events.state = "done"`, `done_at = now()`, `delivered_channels = [...]`
  7. **Error branch** → update DB: `state = "failed"`, `last_error`, bump `attempts`

### ② `02-contact-routed.json` — extends the existing `contact-email.js` Resend path
- **Trigger:** Webhook (POST `/webhook/datiq/contact-received`)
- **Inputs:** `{type, from, subject, body, source}` (already a server-side decision; this just gets observability + extra channels)
- **Steps:**
  1. Slack notification to `#datiq-support` with type + first 200 chars
  2. If `type in [enterprise, legal, privacy]`: also Slack `#sales` or `#legal`
  3. CRM webhook (configurable, optional) — currently `VITE_CONTACT_WEBHOOK_URL` path; this is where it moves
  4. Update `workflow_events.state = "done"`

### ③ `03-user-lifecycle.json` — drip + re-engagement
- **Trigger:** Webhook (POST `/webhook/datiq/user-event`) + n8n Schedule trigger (daily 09:00 UTC)
- **Inputs:** `{event: "signed_up" | "first_extraction" | "5th_extraction" | "d7_inactive" | "d30_inactive", user}`
- **Steps:** branches per event, sends email via Resend using the templates that today live inline in `welcome-email.js` / `reengagement.js`. Moves the copy into n8n templates so non-engineers can edit. **No behavior change to the user** — same emails, same timing, just centralized.

### ④ `04-payment-lifecycle.json` — replaces per-event Slack + email scattered across `payment-webhook.js`
- **Trigger:** Webhook (POST `/webhook/datiq/payment-event`)
- **Inputs:** `{event: "captured" | "failed" | "subscription.activated" | "subscription.cancelled", payment, user, plan}`
- **Steps:** route to `#sales` on `captured` + receipt email; route to `#datiq-alerts` on `failed`; cancel-confirmation email on `subscription.cancelled`.

### ⑤ `05-failure-alert.json` — for the operational bucket
- **Trigger:** Webhook (POST `/webhook/datiq/op-event`) from `scheduled-runner.js` on a schedule's scrape failing 3+ times
- **Steps:** Slack `#datiq-alerts` with a "this schedule is broken" card; auto-pause the schedule if the user opted into that; offer one-click "delete schedule" link back into the app.

### ⑥ `06-daily-digest.json` — already exists in spirit (DAILY_DIGEST_HOUR_UTC); moves to n8n
- **Trigger:** n8n Schedule (cron `0 21 * * *`, configurable)
- **Steps:** query Supabase for "schedules that ran today" → compose a single digest email per user who has ≥1 schedule → send via Resend.

### Helper sub-workflow `00-channel-router.json` — DRY
- Switch on `channel.type` (email / slack / discord / telegram / webhook) and dispatch. Each branch is small (one HTTP request or one Resend call) but the branching lives in one place. The five workflows above all call into this.

---

## 5. New Supabase tables

Run as a new idempotent migration `scripts/migrations/0002_workflow_events.sql`. Three tables, all RLS-locked, all service-key readable/writable.

### `public.workflow_events`
The queue. See §3 for shape. Indexes on `(state, next_attempt_at)` for the orchestrator's poll query, and on `(ref_id)` so you can look up "all events for schedule X".

### `public.workflow_runs`
One row per *attempt* of a workflow_event. So an event that has `attempts: 3` has 3 rows here. Lets you answer "what happened on attempt 2 of event wfe_xyz?". Columns: `id`, `event_id`, `attempt_n`, `channel`, `request`, `response_status`, `response_body`, `started_at`, `finished_at`, `duration_ms`, `error`.

### `public.workflow_subscriptions`
Per-user channel preferences. Today the only implicit subscription is "this user wants email for schedule X". Going forward: `{user_id, kind, ref_id, channels: [{type, target, enabled}]}`. Powers the "also DM me on Telegram" idea. Read by n8n workflow ① step 4.

---

## 6. New Netlify Function: `workflow-orchestrator.js`

Why a function and not just "let n8n poll" — because the user said *"MCP server which process the user's automated scheduled implementation by sending email and other stuff wherever the workflow implementation is in the pending state"*. The MCP server is the *interface*; the orchestrator is the *worker*. They are two different things.

Responsibilities:
1. **Poll loop** — every 5 minutes (Netlify Scheduled Function `config.schedule = "*/5 * * * *"`). Reads up to 50 `state = pending AND next_attempt_at <= now()` rows.
2. **Mark `processing`** — uses `UPDATE … WHERE state = 'pending' RETURNING` to atomically claim a row (no double-dispatch across container invocations).
3. **Post to n8n** — POSTs the event payload to the workflow's webhook URL with HMAC signature header `X-DatIQ-Signature` (so n8n can verify it really came from us).
4. **Wait briefly** for n8n's ack (max 10s, with a 5s timeout). If ack: leave as `processing`; n8n will mark `done` itself when it finishes. If timeout / 5xx: bump `attempts`, set `next_attempt_at = now() + backoff(attempts)`, return to `pending`.
5. **Retry cron** — for `state = processing AND started_at < now() - 5m`, mark `failed_attempt` and re-queue.
6. **Manual trigger** — exposes `POST /api/workflow-orchestrator/run-now` (admin-token gated) so the MCP server (or me) can force a sweep.

Total: ~250 LOC. Pure logic, no UI, fully testable. Mirror the `scheduled-runner.js` test style: 30+ contract tests covering the polling, claiming, retry, and ack semantics. Already exists in `netlify/__tests__/scheduled-runner.test.js:18-22` — follow the same pattern.

---

## 7. The MCP server

`mcp-server/` directory at the repo root. New package, standalone, deployable on its own.

### Tech choice
- **Language:** TypeScript (Node 20+)
- **Framework:** `@modelcontextprotocol/sdk` official SDK, transport = **stdio** (Claude Desktop, Claude Code) + **streamable HTTP** (network clients, custom scripts)
- **HTTP server:** `hono` (lightweight, fits the function-first vibe DatIQ already has)
- **Validation:** `zod` for tool input schemas
- **DB / API client:** reuse the patterns from `netlify/functions/lib/*` where possible — `getDb()` REST helper, `verifyAdminToken()`

### Structure
```
mcp-server/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts            # stdio entry (Claude Desktop)
│   ├── http.ts             # streamable HTTP entry (Claude Code, custom)
│   ├── server.ts           # builds the McpServer with tools/resources/prompts
│   ├── tools/
│   │   ├── pending.ts      # list_pending_workflows, get_workflow_event
│   │   ├── process.ts      # process_pending_workflow, retry, cancel
│   │   ├── notify.ts       # send_email_via_datiq, trigger_n8n_workflow
│   │   ├── schedules.ts    # list_schedules, get, create, pause, resume, delete
│   │   ├── account.ts      # get_user_subscription, get_recent_extractions
│   ├── resources/
│   │   ├── workflow-events.ts
│   │   ├── schedules.ts
│   │   ├── extractions.ts
│   │   ├── users.ts
│   ├── prompts/
│   │   ├── diagnose-pending-workflow.ts
│   │   ├── summarize-runs-for-schedule.ts
│   │   ├── write-change-alert-copy.ts
│   ├── lib/
│   │   ├── auth.ts         # admin-token verification (HMAC)
│   │   ├── supabase.ts     # service-key REST client (mirrors netlify/functions)
│   │   ├── datiq-api.ts    # thin wrapper over /api/* (uses fetch directly)
│   │   ├── n8n.ts          # n8n REST API client (list workflows, trigger, get execution)
│   │   ├── logger.ts
│   ├── __tests__/          # vitest, mirrors the DatIQ test style
└── .env.example            # DATIQ_API_URL, DATIQ_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, N8N_API_URL, N8N_API_KEY
```

### Tool list (full set, with one-line semantics)

| Tool | Input | Returns | Used for |
|---|---|---|---|
| `list_pending_workflows` | `{state?, kind?, user_id?, limit?}` | array of event summaries | "what's queued right now?" |
| `get_workflow_event` | `{event_id}` | full event + attempts | "why did this fail?" |
| `process_pending_workflow` | `{event_id, force?}` | `{ok, dispatched_to}` | "re-run this now" |
| `retry_workflow_event` | `{event_id, reset_attempts?}` | updated event | "clear the failure and try again" |
| `cancel_workflow_event` | `{event_id, reason?}` | updated event | "give up on this" |
| `send_email_via_datiq` | `{to, from_kind, subject, html, reply_to?}` | `{id}` (Resend) | "send an ad-hoc email through the same sender" |
| `trigger_n8n_workflow` | `{workflow_id, payload}` | `{execution_id}` | "kick off a specific n8n flow on demand" |
| `list_schedules` | `{user_id?}` | array of schedules | "what's this user monitoring?" |
| `get_schedule` | `{schedule_id}` | full schedule | "drill into one" |
| `create_schedule` | `{type, target, cron, alert_email, intent, label?}` | schedule | "set up a new monitor" |
| `pause_schedule` | `{schedule_id}` | updated | "stop the alerts" |
| `resume_schedule` | `{schedule_id}` | updated | "start the alerts" |
| `delete_schedule` | `{schedule_id}` | `{ok}` | "remove it" |
| `get_user_subscription` | `{user_id}` | subscription + plan | "what plan are they on?" |
| `get_recent_extractions` | `{user_id, limit?}` | array of extraction summaries | "what have they been doing?" |

### Resource list (read-only snapshots Claude can browse)
- `datiq://workflow-events?state=pending&limit=20` — JSON list
- `datiq://workflow-events/{id}` — single event
- `datiq://schedules` / `datiq://schedules/{id}`
- `datiq://extractions/{id}`
- `datiq://users/{id}/subscription`

### Prompt list (templates the model can invoke)
- `diagnose-pending-workflow` — given an event id, walks the model through: read the event → read its attempts → read the target schedule → read the user → suggest a fix or re-run
- `summarize-runs-for-schedule` — given a schedule id, produces a one-paragraph plain-English summary of the last 30 days
- `write-change-alert-copy` — given a schedule and its diff, drafts the alert email body. Useful for the "humanize the bot" workflow later

### Auth
The MCP server holds the same admin token DatIQ's `/admin/*` already uses. Each request includes `Authorization: Bearer <admin-token>` and a per-request HMAC. Tools that read user data (`get_user_subscription`, `get_recent_extractions`) additionally require the user to have given consent via a new env-scoped setting — defaults to "admin only".

### Hosting
Fly.io is the cheapest persistent host (~$5-10/mo for the always-on container, free TLS). Alternatively Render's free tier with a cron ping (but the MCP server is long-lived for stdio, not cron). Decision in Phase 1.

---

## 8. Integration points with existing code

The principle: **add, don't replace**. Every existing behavior keeps working. The only behavior change is `scheduled-runner.js` stops talking to Resend/Slack/webhook directly and instead enqueues.

| File | Change | Risk |
|---|---|---|
| `netlify/functions/scheduled-runner.js` | Replace `fireAlert()` body (lines 208-220) with a single `enqueueEvent({kind:"schedule.changed", ...})` call that writes to `workflow_events`. Remove the `sendAlertEmail` + `postAlertWebhook` + Slack code path. Keep the scrape + diff + hash logic untouched. | Low — change is well-scoped; existing 16 tests still pass; new tests cover the enqueue call. |
| `netlify/functions/lib/slackFormatter.js` | Stays. Called from n8n workflow ① instead of from `scheduled-runner.js`. | None — pure formatter, no behavior change. |
| `src/lib/schedulerService.js` | Add `enqueueEvent()` for client-side enqueue (e.g. when a user clicks "Run now" on /schedules and the run finds a change, the same path is used). | Low — additive. |
| `netlify/functions/schedules.js` | No change. | None. |
| `netlify/functions/contact-email.js` | Add a single `enqueueEvent({kind:"contact.received", ...})` call after the Resend send succeeds. CRM webhook now goes through n8n workflow ②, not `VITE_CONTACT_WEBHOOK_URL`. | Low — observability gain, no user-visible change. |
| `netlify/functions/payment-webhook.js` | Add `enqueueEvent({kind:"payment.captured", ...})` after the DB write. | Low. |
| `netlify/functions/welcome-email.js`, `reengagement.js` | Same: enqueue instead of direct Resend call. | Low. |
| `public/help/`, `docs/` | Update to describe the new pipeline. The "Change alert" section needs a diagram. | None. |
| `CLAUDE.md` | New "Automation pipeline" section. Update the `TODO(SCHEDULE_ALERT_WEBHOOK)` line to "DONE — see `WORKFLOW-IMPLEMENTATION-PLAN.md`". | None. |

---

## 9. Phasing — what ships in what order

Each phase is a separate commit (or PR) on the `workflow-implementation-and-optimization` branch, so review is easy and rollback is clean. Each phase is independently testable.

### Phase 0 — Plan & branch (this commit, ~now)
- ✅ Branch `workflow-implementation-and-optimization` from `main`
- ✅ `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` (this file)
- **Exit criterion:** you read this and say "go"

### Phase 1 — Schema + orchestrator function (no n8n yet)
- `scripts/migrations/0002_workflow_events.sql` — three tables
- `netlify/functions/workflow-orchestrator.js` — poll + claim + post to a stub URL
- `netlify/functions/lib/workflowEnqueue.js` — `enqueueEvent()` helper, used by everything below
- 20+ vitest tests for the orchestrator
- **Exit criterion:** orchestrator polls a real test row and posts to a Netlify echo function; CI green

### Phase 2 — scheduled-runner rewires
- `scheduled-runner.js` swaps `fireAlert()` for `enqueueEvent()`
- New tests for the enqueue call
- **Exit criterion:** existing 16 scheduled-runner tests still green; new enqueue path tested; manual verification with a one-off schedule

### Phase 3 — MCP server skeleton
- `mcp-server/` package, stdio transport, 5 core tools (`list_pending_workflows`, `get_workflow_event`, `process_pending_workflow`, `retry_workflow_event`, `cancel_workflow_event`)
- 30+ vitest tests
- **Exit criterion:** Claude Desktop connects; "list pending workflows" returns the rows from Phase 1; "process this one" marks it dispatched

### Phase 4 — n8n instance + workflow ① (the killer one)
- Stand up n8n (cloud $20/mo starter, or self-host on the same Fly.io app)
- Import `n8n/workflows/01-schedule-changed-router.json`
- Wire `SCHEDULE_ALERT_WEBHOOK` (the existing env var) to the n8n webhook URL
- Remove the `TODO(SCHEDULE_ALERT_WEBHOOK)` comment
- **Exit criterion:** end-to-end test: create a test schedule → wait for runner → see Slack message in `#monitoring` → see email arrive → MCP server shows the event as `done`

### Phase 5 — Other n8n workflows
- Workflows ② through ⑥, each a small PR
- **Exit criterion:** each has a test trigger + a manual run that updates a workflow_event row

### Phase 6 — MCP server: schedules + account tools
- Add the schedule-CRUD tools + account tools
- Add resources + prompts
- **Exit criterion:** Claude Code can `list_schedules` for a test user, `pause_schedule` it, see the change reflected in the UI

### Phase 7 — Observability surface in /admin
- New `/admin/automation` page (or add to `/admin/revenue`): "Pending events", "Failed events (24h)", "Events by kind", "Avg time-to-done"
- **Exit criterion:** page shows the queue, clickable into the event detail; "Retry" button calls `retry_workflow_event` via MCP

### Phase 8 — Docs + handoff
- `docs/N8N-WORKFLOWS.md` — how to import, edit, redeploy
- `docs/MCP-SERVER.md` — how to add a tool, how to test locally
- Update `CLAUDE.md` "Outstanding tasks" — close `TODO(SCHEDULE_ALERT_WEBHOOK)`, add new section
- Update `public/help/13-automations.html` (currently a placeholder?) with the new flow
- Merge to main via PR

---

## 10. Costs

| Item | Per month | Why |
|---|---|---|
| n8n cloud (Starter) | $20 | 1 concurrent workflow, 2,500 executions — plenty for DatIQ at current scale |
| n8n cloud (Pro) | $50 | if we exceed 2,500 executions/mo — currently 0, so likely fine |
| Fly.io MCP server | $5-10 | always-on 256MB container |
| Supabase (no change) | $0-25 | three new tables, low row count, no extra bandwidth |
| Resend (no change) | $0-20 | emails still go through Resend, just from n8n instead of Netlify |
| Slack incoming webhook | $0 | free |
| **Total** | **$25-50** | up from current $0 (because n8n + Fly.io are new) |

Compare to engineering time saved when "why didn't the alert fire?" becomes "open /admin/automation, see the failed row, click retry".

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| n8n cloud goes down | low | orchestrator has a "fail to pending" path; Resend is called from a fallback branch in `workflow-orchestrator.js` itself for the most critical kind (`schedule.changed`) so emails still go out even if n8n is down |
| MCP server has no auth | medium | HMAC admin token required for every request, same scheme as `/admin/*`; rate-limited at the edge |
| Pending queue grows unbounded | low | `attempts >= max_attempts` → `state = "failed"`; failed events paginated in /admin; old done events archived to `workflow_events_archive` after 30d |
| Secret leak in n8n workflow JSON | medium | all credentials referenced by ID from n8n's encrypted store, never inlined in JSON; CI grep for `Bearer ` / `sk-` in `n8n/workflows/*.json` |
| Netlify function cold start on orchestrator | medium | first poll of the day runs 30s after deploy hook; subsequent polls are warm; sub-5s end-to-end typical |
| Backwards compat — old `SCHEDULE_ALERT_WEBHOOK` URLs stop working | low | if old URL is set, keep calling it; only the new code path uses n8n |
| Guest schedules never reach the queue (RLS) | known | per CLAUDE.md, guest schedules are localStorage-only; the orchestrator reads from `scheduled_tasks` (RLS-bypassed by service key) but guest rows aren't there, so this is unchanged |

---

## 12. What I will NOT do

- Replace `scheduled-runner.js` — it stays. It just stops being an orchestrator.
- Move Resend config to n8n — the `CONTACT_EMAIL_FROM` / `ALERT_EMAIL_FROM` / `FORM_EMAIL_FROM` rule (per CLAUDE.md "Email sender rule") still holds. n8n reads those from the DatIQ `/api/contact-email` endpoint, not from its own SMTP config.
- Add a UI for the workflow queue in V1 — that's Phase 7 and the user can see everything via the MCP server today.
- Wire the Telegram / Discord channels until Phase 5 — Phase 4 ships with Slack + email only, which matches what the production app does today.
- Self-host n8n on the same Fly.io app — they have different lifecycles (n8n is a long-lived stateful service, the MCP server is mostly stateless). They get separate apps.

---

## 13. Open questions for you

1. **n8n cloud vs self-host?** Cloud is $20/mo and zero ops. Self-host is $5-10/mo on Fly.io but I have to maintain it. **My recommendation:** cloud for V1, evaluate self-host at 1k workflows/mo.
2. **MCP server auth scope?** Should the MCP token be the same admin token as `/admin/*`, or a separate `mcp_token` with narrower scope? **My recommendation:** separate token, scope = `read:*` by default; `write:*` requires an explicit `MCP_WRITE_TOKEN` env var. Lets you hand the read token to a contractor without giving them admin.
3. **Slack channel split?** Today everything goes to one `#monitoring` channel. Want me to split into `#monitoring` (scheduled changes) + `#datiq-alerts` (operational) + `#support` (contact forms)? **My recommendation:** yes, but only if you already have those channels. If not, one `#datiq` channel is fine.
4. **Daily digest email — keep the existing inline copy, or rewrite?** The current copy is decent but lives in a Netlify function. Moving to n8n is a chance to edit it without a redeploy. **My recommendation:** keep the copy in V1, expose a "edit" affordance in Phase 7.
5. **Guest user scheduled tasks** — should the orchestrator pick them up from localStorage somehow? Probably no (RLS, no server-side user_id), but worth flagging. **My recommendation:** leave as-is. Guest schedules are local-only by design.
6. **Should I include a `Razorpay` payment → n8n workflow in V1, or wait for V2?** I have it in the plan as ④. If you want to defer to V2 to keep this PR focused, say so.

---

## 14. Definition of done for this branch

- [ ] Phase 1 — schema + orchestrator merged
- [ ] Phase 2 — scheduled-runner rewired
- [ ] Phase 3 — MCP server skeleton in Claude Desktop
- [ ] Phase 4 — n8n workflow ① replacing the dead webhook
- [ ] Phase 5 — remaining n8n workflows
- [ ] Phase 6 — MCP server schedule/account tools
- [ ] Phase 7 — /admin/automation page
- [ ] Phase 8 — docs + handoff
- [ ] All existing tests still pass (1029+ vitest + contract tests)
- [ ] Manual end-to-end test: create schedule → change detected → Slack message + email delivered within 5 min
- [ ] PR opened, you approve, merge to main

---

*Ready for review. Nothing is built yet. Once you say "go" on the plan, I'll start Phase 1.*
