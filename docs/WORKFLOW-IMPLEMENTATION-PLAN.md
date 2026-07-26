# DatIQ — n8n + MCP Workflow Implementation Plan (v2)

> **Branch:** `workflow-implementation-and-optimization` (from `main` @ `f56306d`)
> **Status:** Plan only. No code, no n8n flows, no MCP server yet — review and approve before any implementation.
> **Author:** Mavis (Vikash's coding agent)
> **Goal:** Replace the silently-dropped `SCHEDULE_ALERT_WEBHOOK` with a real, observable, debuggable automation pipeline. Expose DatIQ's automation surface as MCP tools so any MCP client (Claude Desktop, Claude Code, Cursor, etc.) can read state, queue work, and process it.

---

## 0. v2 — what changed from v1 (and why)

| | v1 (superseded) | v2 (this plan) |
|---|---|---|
| **n8n hosting** | n8n Cloud ($20/mo, zero ops) | **Self-hosted n8n on Fly.io** (~$15-25/mo, ops = me) |
| **MCP server** | Separate TypeScript package (`mcp-server/`, 15 tools, HMAC auth) | **n8n itself acts as the MCP server** — workflows with an `MCP Server Trigger` node become callable tools |
| **Auth on MCP** | Custom HMAC admin token scheme | **n8n's built-in user auth + MCP API key** (one less secret to manage) |
| **Runtimes to operate** | 2 (n8n cloud + Node MCP server) | **1** (self-hosted n8n) |
| **Languages** | TypeScript + JSON | **JSON + a few n8n `Code` nodes** (still optional) |
| **Tools in v1** | 15 typed tools | **~11 n8n workflow-tools** (some V1 tools folded together) |
| **Phases** | 8 | **7** (Phase 3 now = "stand up n8n" instead of "stand up MCP server") |
| **Cost / month** | $25-50 | **$15-25** (self-hosted n8n + Supabase, no cloud n8n fee) |
| **Ops burden / month** | Low | **Medium** (backups, upgrades, monitoring for n8n) |

### Why self-host n8n

1. **One runtime, not two.** n8n as MCP server means the orchestrator and the tool surface are the same process. One backup story, one upgrade path, one set of credentials.
2. **No vendor lock-in on a tool that's still maturing.** n8n Cloud's MCP support is recent; self-hosting gives us the same features without depending on Cloud's roadmap. If n8n the company disappears, the workflow JSON in git is still portable.
3. **Cost is comparable at our scale.** $15-25/mo on Fly.io vs $20/mo on n8n Cloud; we save money AND own the data.
4. **Existing operator files in the repo show you've already opted into self-host discipline** (HASHED-PIN/, scripts/env/ patterns). Self-hosted n8n fits the same posture.

### Why n8n-as-MCP-server instead of a TypeScript MCP server

1. **The tools ARE the workflows.** "List pending workflows" is a workflow that queries Supabase. "Process pending workflow" is a workflow that calls the dispatch webhook. Same code path, same retry semantics, same observability — just shaped as an MCP-callable tool instead of a function.
2. **No new language to maintain.** V1's `mcp-server/` is ~2000 lines of TypeScript that has to be kept in lockstep with the workflows. v2 deletes that whole package and ships JSON instead.
3. **Visual editing.** You (Vikash) can open n8n, change the email template, save, redeploy — no PR cycle. Same DX as the existing automation story.
4. **The MCP trigger is built-in.** n8n's `MCP Server Trigger` node is purpose-built for this — it derives the tool schema from the workflow's input fields, handles SSE transport, and surfaces errors as tool-call failures. Re-implementing that in TypeScript would be ~500 LOC of MCP protocol plumbing for zero functional gain.

### What v1 had that v2 keeps verbatim

- The **3 Supabase tables** (`workflow_events`, `workflow_runs`, `workflow_subscriptions`) — unchanged
- The **`workflow-orchestrator.js` Netlify Function** (poll + claim + dispatch) — unchanged
- The **`scheduled-runner.js` rewire** (replace `fireAlert()` with `enqueueEvent()`) — unchanged
- The **6 workflow concepts** (schedule.changed, contact, user lifecycle, payment, failure, daily digest) — same WHAT, different WHERE (now self-hosted instead of cloud)
- The **8 critical bugs/follow-ups in CLAUDE.md** that are blocking production (`TODO(SCHEDULE_ALERT_WEBHOOK)`, the env file, the staging deploy) — still the primary motivation

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

The new architecture: a small `workflow_events` queue, a `workflow-orchestrator` function that dispatches to self-hosted n8n, and n8n itself acting as the MCP server for any agent that wants to inspect or trigger the queue. **`scheduled-runner.js` stays** — it just stops trying to be an orchestrator and starts enqueuing.

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
│      Netlify Functions       │         │   Self-hosted n8n           │
│  (datiqapp.netlify.app)      │         │   (n8n.datiq.app)           │
│                              │         │                             │
│  /api/extract · /api/ai      │         │  ┌──────────────────────┐   │
│  /api/schedules              │         │  │ MCP Server endpoint  │   │
│  /api/contact-email          │         │  │ /mcp (SSE transport) │   │
│  /api/extractions            │         │  └────────┬─────────────┘   │
│  /api/admin-*                │         │           │                 │
│                              │         │  ┌────────▼─────────────┐   │
│  ┌────────────────────────┐  │         │  │  11 MCP-tool         │   │
│  │  scheduled-runner.js   │  │         │  │  workflows           │   │
│  │  (hourly @hourly)      │  │         │  │  (MCP Server Trigger │   │
│  │                        │  │         │  │   node as entry)     │   │
│  │  scrape + diff +       │  │         │  └────────┬─────────────┘   │
│  │  enqueue → workflow_   │──┼─────────┼──────────┘                 │
│  │  events table          │  │         │           │                 │
│  └────────────────────────┘  │         │  ┌────────▼─────────────┐   │
│                              │         │  │  6 automation        │   │
│  ┌────────────────────────┐  │  HTTP   │  │  workflows           │   │
│  │  workflow-orchestrator │──┼────────▶│  │  (Webhook trigger    │   │
│  │  (every 5 min)         │  │  POST  │  │   as entry)          │   │
│  │                        │  │         │  │                      │   │
│  │  • polls workflow_     │  │         │  │  ① schedule.changed  │   │
│  │    events for pending  │  │         │  │  ② contact.received  │   │
│  │  • claims a row        │  │         │  │  ③ user.lifecycle    │   │
│  │  • POSTs to n8n        │  │         │  │  ④ payment.lifecycle │   │
│  │  • marks processing    │  │         │  │  ⑤ failure.alert     │   │
│  │  • applies backoff     │  │         │  │  ⑥ daily.digest      │   │
│  └────────────────────────┘  │         │  │  ⑦ channel.router    │   │
│                              │         │  │     (sub-workflow)   │   │
└──────────────┬───────────────┘         │  └──────────────────────┘   │
               │                         │           │                 │
               │                         │  ┌────────▼─────────────┐   │
               │                         │  │  Built-in nodes      │   │
               │                         │  │  HTTP Request        │   │
               │                         │  │  Resend              │   │
               │                         │  │  Slack               │   │
               │                         │  │  Supabase (Postgres) │   │
               │                         │  │  Schedule (cron)     │   │
               │                         │  │  Code (JS)           │   │
               │                         │  │  Wait                │   │
               │                         │  └──────────────────────┘   │
               │                         │                             │
               │                         │  Postgres: workflow runs,    │
               │                         │  credentials, executions     │
               │                         │                             │
               │                         │  Volume: n8n data dir,      │
               │                         │  encrypted at rest, backed   │
               │                         │  up daily to Tigris (S3)    │
               │                         │                             │
               │                         └────────────┬────────────────┘
               │                                      │
               ▼                                      │  MCP (SSE)
┌──────────────────────────────────┐                  │  (HTTPS)
│       Supabase (Postgres)        │                  │
│                                  │                  ▼
│  public.scheduled_tasks          │       ┌─────────────────────────────┐
│      (R19, exists)               │       │   Claude Desktop / Code     │
│  public.extractions              │       │   (any MCP client)          │
│      (R19, exists)               │       │                             │
│  public.workflow_events          │       │   Connects to:              │
│      (NEW — queue)               │       │   n8n.datiq.app/mcp         │
│  public.workflow_runs            │       │   with API key              │
│      (NEW — per-attempt log)     │       │                             │
│  public.workflow_subscriptions   │       │   Sees 11 tools:            │
│      (NEW — user channel prefs)  │       │   datiq_list_pending_…      │
│                                  │       │   datiq_process_pending_…   │
│  RLS-locked; service-key only    │       │   datiq_list_schedules      │
│                                  │       │   datiq_create_schedule     │
└──────────────────────────────────┘       │   datiq_pause_schedule      │
                                            │   datiq_resume_schedule     │
                                            │   datiq_delete_schedule     │
                                            │   datiq_get_workflow_event  │
                                            │   datiq_retry_workflow_…    │
                                            │   datiq_cancel_workflow_…   │
                                            │   datiq_diagnose_pending_…  │
                                            └─────────────────────────────┘
```

Key idea: **n8n is the orchestrator AND the MCP server.** No TypeScript package, no separate runtime, no protocol implementation.

---

## 3. The pending state — one queue, four buckets

All automation events funnel into one table: `public.workflow_events`. Shape:

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
    { "type": "n8n",    "workflow_id": "datiq_schedule_changed_router", "webhook_path": "/webhook/sched" }
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

The four bucket kinds:

| Bucket | Source | Example | Default channel |
|---|---|---|---|
| **Scheduled change detected** | `scheduled-runner.js` hourly | `lumio.io/pricing` changed since last run | email to `schedule.alertEmail` + Slack to ops channel |
| **Contact form routed** | `contact-email.js` | /contact form submitted with type=enterprise | email to `admin@` + CRM webhook |
| **Payment / lifecycle event** | `payment-webhook.js` | Razorpay `payment.captured` | email receipt + Slack #sales |
| **Operational** | n8n self-alert | scrape failed 3x in a row | Slack #datiq-alerts |

The `workflow-orchestrator` Netlify Function polls this table every 5 minutes (separate from the hourly schedule runner) and dispatches each `pending` row to n8n, marks it `processing`, and on response marks it `done` or bumps `attempts` and applies exponential backoff (1m, 5m, 30m, 2h, 12h, then `failed`).

---

## 4. Self-hosted n8n — the runtime

### 4.1 Hosting
- **Platform:** Fly.io single-app, 1 shared CPU / 1 GB RAM (~$10-15/mo). n8n is mostly idle except when workflows run, so over-provisioning is wasteful.
- **Region:** `sin` (Singapore) — closest to DatIQ's primary user base (India), and Fly.io's fastest region for that geography.
- **Process model:** `main` mode for V1 (single process runs both UI and workers). Switch to `main + worker` only if execution queue depth starts growing.
- **Docker image:** `n8nio/n8n:latest` (or pin to a specific minor like `1.95.x` — see §10 for the version strategy).
- **Volume:** `n8n_data` 1 GB, mounted at `/home/node/.n8n`. Stores encrypted credentials, workflow run history, and execution cache.
- **Custom domain:** `n8n.datiq.app` (subdomain). TLS via Fly.io's auto-cert. DNS: CNAME to the Fly app.

### 4.2 Database
- **For V1:** SQLite (file inside the volume). Single instance, single user (you), no concurrent writers, backup = copy the file. Simplest possible.
- **For V2 (when we outgrow V1):** Postgres on Fly.io (or Supabase's existing instance, separate database). Migration is `n8n export` → re-import. Triggered by: queue depth > 50 sustained, or daily volume > 1k executions.

### 4.3 Backups
- **Daily snapshot** of the n8n data volume to **Tigris** (Fly.io's S3-compatible object store, free 5 GB tier). Cron: `0 3 * * * *` — Fly's `fly machine snapshot` is too heavyweight, so use `flyctl ssh C -- tar czf - /home/node/.n8n | flyctl ssh s3 put` pattern, or use a small `backup-machine` that runs nightly and pushes to Tigris. **Retain 14 days.**
- **Weekly full export** of all workflow JSON to git (`n8n/workflows/*.json`). n8n has `n8n export:workflow --all` which produces importable JSON. This is the disaster-recovery path: if the volume dies, we lose execution history but not the workflows themselves.
- **CI guard:** GitHub Action runs `n8n import:workflow --input=n8n/workflows/` against a throwaway n8n container on every PR. Catches malformed JSON before it lands.

### 4.4 Auth & security
- **UI access (the n8n web editor):** Single user, basic auth via Fly's edge auth (`fly auth` adds HTTP basic to the app). Username + password as Fly secrets. Alternative: Cloudflare Access in front of `n8n.datiq.app` — gives you per-user auth, audit log, and free for up to 50 users. **Recommendation: Cloudflare Access** — same posture as your other DatIQ infrastructure.
- **MCP endpoint:** API key per client. n8n's `MCP Server Trigger` node supports an `authentication` setting; we use a static API key stored in Fly secrets. Clients send `Authorization: Bearer <key>`. One key for you + one for "Mavis" (this agent).
- **Webhook endpoint (for Netlify orchestrator):** Same API key as MCP, but routed to a different workflow entry.
- **Encryption at rest:** n8n's built-in `N8N_ENCRYPTION_KEY` (random 32 bytes) encrypts credentials before they're stored. Key is a Fly secret.
- **Outbound network:** n8n makes HTTPS calls to Supabase, Slack, Resend, DatIQ API. No firewall needed for V1 (Fly apps have public egress by default). If abuse becomes a concern, add Fly's outbound allowlist.

### 4.5 Monitoring
- **Health check:** `GET /healthz` on n8n's UI port — Fly's health check auto-restarts on 3 consecutive failures.
- **Logs:** `fly logs` (stdout/stderr) — n8n logs every workflow execution. Forward to a log drain later (Fly → Logtail or similar) but not blocking for V1.
- **Queue depth alert:** n8n's internal queue depth is exposed via `GET /api/v1/executions?status=waiting` (admin auth). A tiny `scripts/check-n8n-health.mjs` runs in CI nightly and posts to a Slack channel if `waiting > 50`.
- **Disk space:** n8n's data volume can fill up if execution history grows. Fly volume metrics will surface this; alert at > 70% usage.

### 4.6 Upgrade strategy
- **Cadence:** Check n8n releases weekly (they ship every Tuesday). Read the changelog.
- **Process:** `fly deploy` with a new image tag. If the n8n release notes mention a migration step, do it on a staging n8n first.
- **Rollback:** Fly's `fly releases` lets you roll back to a previous image. n8n is forward-only on its database schema, so a rollback may need a DB restore from backup. Keep at least 2 weeks of backups.
- **Pin to a minor version** for the first 3 months. After that, once we've survived 3 upgrades cleanly, we can ride `latest`.

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

Why a function and not just "let n8n poll" — because the MCP server is the *interface*; the orchestrator is the *worker*. They are two different things. The MCP tool `datiq_process_pending_workflow` ultimately calls this function (via n8n workflow → HTTP request to the orchestrator's `/api/workflow-orchestrator/run-now`).

Responsibilities:
1. **Poll loop** — every 5 minutes (Netlify Scheduled Function `config.schedule = "*/5 * * * *"`). Reads up to 50 `state = pending AND next_attempt_at <= now()` rows.
2. **Mark `processing`** — uses `UPDATE … WHERE state = 'pending' RETURNING` to atomically claim a row (no double-dispatch across container invocations).
3. **Post to n8n** — POSTs the event payload to the workflow's webhook URL with HMAC signature header `X-DatIQ-Signature` (so n8n can verify it really came from us).
4. **Wait briefly** for n8n's ack (max 10s, with a 5s timeout). If ack: leave as `processing`; n8n will mark `done` itself when it finishes. If timeout / 5xx: bump `attempts`, set `next_attempt_at = now() + backoff(attempts)`, return to `pending`.
5. **Retry cron** — for `state = processing AND started_at < now() - 5m`, mark `failed_attempt` and re-queue.
6. **Manual trigger** — exposes `POST /api/workflow-orchestrator/run-now` (admin-token gated) so the MCP tool `datiq_process_pending_workflow` (running inside n8n) can force a sweep.

Total: ~250 LOC. Pure logic, no UI, fully testable. Mirror the `scheduled-runner.js` test style: 30+ contract tests covering the polling, claiming, retry, and ack semantics. Already exists in `netlify/__tests__/scheduled-runner.test.js:18-22` — follow the same pattern.

---

## 7. The n8n workflows — 11 tools + 7 automation flows

All stored as versioned JSON in `n8n/workflows/*.json` so the repo is the source of truth. n8n is the runtime; the JSON is the deployable artifact. CI runs `n8n import:workflow --input=n8n/workflows/` against a throwaway container on every PR to catch malformed JSON.

### 7.1 MCP-tool workflows (callable by Claude Desktop / Code)

Each of these has an **MCP Server Trigger** node as the entry point. The trigger derives the tool's input schema from the workflow's input fields. The tool name comes from the workflow name (prefixed `datiq_` to avoid collisions with any future DatIQ MCP tools).

| Tool (workflow name) | Purpose | Flow shape |
|---|---|---|
| `datiq_list_pending_workflows` | List events in queue | MCP Trigger → Supabase query → Respond |
| `datiq_get_workflow_event` | Get one event with all attempts | MCP Trigger → Supabase query (event + runs) → Respond |
| `datiq_process_pending_workflow` | Force-dispatch a pending event now | MCP Trigger → Supabase UPDATE (set next_attempt_at=now) → HTTP POST to `/api/workflow-orchestrator/run-now` → Respond |
| `datiq_retry_workflow_event` | Reset attempts and re-queue | MCP Trigger → Supabase UPDATE (attempts=0, state=pending) → Respond |
| `datiq_cancel_workflow_event` | Mark as cancelled (no re-queue) | MCP Trigger → Supabase UPDATE (state=cancelled) → Respond |
| `datiq_list_schedules` | List user's schedules (read from DatIQ API) | MCP Trigger → HTTP GET `/api/schedules?user_id=…` with auth → Respond |
| `datiq_create_schedule` | Create a new schedule | MCP Trigger → HTTP POST `/api/schedules` with auth → Respond |
| `datiq_pause_schedule` | Pause a schedule | MCP Trigger → HTTP PATCH `/api/schedules/{id}` with `{status:"paused"}` → Respond |
| `datiq_resume_schedule` | Resume a paused schedule | MCP Trigger → HTTP PATCH `/api/schedules/{id}` with `{status:"active"}` → Respond |
| `datiq_delete_schedule` | Delete a schedule | MCP Trigger → HTTP DELETE `/api/schedules/{id}` → Respond |
| `datiq_diagnose_pending_workflow` | Diagnostic prompt — given an event id, reads the event + attempts + target schedule + user, returns a structured diagnostic. This is the "I'm an agent and an alert fired weirdly, what happened?" tool. | MCP Trigger → Supabase query (event + runs + schedule + user) → Code node (format diagnostic) → Respond |

That's 11 tools — fewer than v1's 15 because:
- `get_user_subscription` and `get_recent_extractions` are folded into `datiq_diagnose_pending_workflow` (you can call it with a user_id)
- `trigger_n8n_workflow` and `send_email_via_datiq` are operator-internal — exposed only as admin-gated tools, not to MCP clients. If you need them later, they're 5 minutes to add.

**Auth on each tool:** the MCP Server Trigger has an `Authentication: API Key` setting. Key is `DATIQ_MCP_API_KEY` (Fly secret), passed by the client as `Authorization: Bearer <key>`. One key per client. n8n logs every MCP call to its execution history, so we have an audit trail of who-called-what-when.

**Tool descriptions (in JSON):** each workflow's `description` field is what MCP clients show to the model. Be explicit. Example for `datiq_list_pending_workflows`:
> "Lists workflow events in the DatIQ automation queue. Use this to answer 'what's pending?', 'what's failed?', 'what changed in the last hour?'. Filter by `state` (pending/processing/done/failed/cancelled), `kind` (schedule.changed/contact.received/payment.captured), or `user_id`. Returns up to 50 events sorted by `next_attempt_at` ascending."

### 7.2 Automation workflows (called by the orchestrator or by DatIQ itself)

These are the "what happens when a workflow event fires" flows. They have **Webhook** triggers (or **Schedule** triggers for the daily digest) instead of MCP Server Triggers.

#### ① `datiq_schedule_changed_router` — **highest priority, replaces today's dead `SCHEDULE_ALERT_WEBHOOK`**
- **Trigger:** Webhook (POST `/webhook/datiq/schedule-changed`)
- **Inputs:** `{schedule, diff, emailSent, alertEmail, type, intent, target}`
- **Steps:**
  1. Switch on `intent` (summary / contacts / pricing / map / custom) — different copy per intent
  2. Always: post to Slack `#monitoring` with Block Kit (reuse `netlify/functions/lib/slackFormatter.js` logic by inlining the same builder — or move that file into `n8n/lib/slackFormatter.js` so both runtimes can use it)
  3. If `alertEmail` set and `emailSent` is false: send via Resend
  4. If `workflow_subscriptions` has `discord` / `telegram` / `webhook` channels for this user: fan out
  5. If schedule is `batch`: aggregate per-URL diffs into one summary, send one email
  6. **Update DB** via Supabase node: `workflow_events.state = "done"`, `done_at = now()`, `delivered_channels = [...]`
  7. **Error branch** → update DB: `state = "failed"`, `last_error`, bump `attempts`

#### ② `datiq_contact_router` — extends the existing `contact-email.js` Resend path
- **Trigger:** Webhook (POST `/webhook/datiq/contact-received`)
- **Steps:**
  1. Slack notification to `#datiq-support` with type + first 200 chars
  2. If `type in [enterprise, legal, privacy]`: also Slack `#sales` or `#legal`
  3. CRM webhook (configurable, optional) — currently `VITE_CONTACT_WEBHOOK_URL` path; this is where it moves
  4. Update `workflow_events.state = "done"`

#### ③ `datiq_user_lifecycle` — drip + re-engagement
- **Trigger:** Webhook (POST `/webhook/datiq/user-event`) + n8n Schedule trigger (daily 09:00 UTC)
- **Steps:** branches per event, sends email via Resend using the templates that today live inline in `welcome-email.js` / `reengagement.js`. Moves the copy into n8n templates so non-engineers can edit. **No behavior change to the user** — same emails, same timing, just centralized.

#### ④ `datiq_payment_lifecycle` — replaces per-event Slack + email scattered across `payment-webhook.js`
- **Trigger:** Webhook (POST `/webhook/datiq/payment-event`)
- **Steps:** route to `#sales` on `captured` + receipt email; route to `#datiq-alerts` on `failed`; cancel-confirmation email on `subscription.cancelled`.

#### ⑤ `datiq_failure_alert` — operational bucket
- **Trigger:** Webhook (POST `/webhook/datiq/op-event`) from `scheduled-runner.js` on a schedule's scrape failing 3+ times
- **Steps:** Slack `#datiq-alerts` with a "this schedule is broken" card; auto-pause the schedule if the user opted into that; offer one-click "delete schedule" link back into the app.

#### ⑥ `datiq_daily_digest` — already exists in spirit (DAILY_DIGEST_HOUR_UTC); moves to n8n
- **Trigger:** n8n Schedule (cron `0 21 * * *`, configurable)
- **Steps:** query Supabase for "schedules that ran today" → compose a single digest email per user who has ≥1 schedule → send via Resend.

#### ⑦ `datiq_channel_router` — DRY sub-workflow
- **Trigger:** Called by ①, ②, ④, ⑤ (executed via "Execute Workflow" node)
- **Purpose:** Switch on `channel.type` (email / slack / discord / telegram / webhook) and dispatch. Each branch is small (one HTTP request or one Resend call) but the branching lives in one place.

### 7.3 Where each workflow lives

- **In n8n (deployed):** all 11 + 7 workflows, imported from `n8n/workflows/*.json`
- **In git (source of truth):** `n8n/workflows/*.json` — one file per workflow, exported from n8n UI
- **CI:** GitHub Action on every PR runs `n8n import:workflow --input=n8n/workflows/ --force` against a throwaway n8n container, then runs the workflow's test webhook with a mock payload, asserts the expected state transition in the response. ~10 min of CI per PR; worth it.

---

## 8. Integration points with existing code

The principle: **add, don't replace**. Every existing behavior keeps working. The only behavior change is `scheduled-runner.js` stops talking to Resend/Slack/webhook directly and instead enqueues.

| File | Change | Risk |
|---|---|---|
| `netlify/functions/scheduled-runner.js` | Replace `fireAlert()` body (lines 208-220) with a single `enqueueEvent({kind:"schedule.changed", ...})` call that writes to `workflow_events`. Remove the `sendAlertEmail` + `postAlertWebhook` + Slack code path. Keep the scrape + diff + hash logic untouched. | Low — change is well-scoped; existing 16 tests still pass; new tests cover the enqueue call. |
| `netlify/functions/lib/slackFormatter.js` | Stays. Called from n8n workflow ① via a `Code` node that requires the same module (Node's `require` doesn't work in n8n's Code node by default — see §10 for the workaround). | None — pure formatter, no behavior change. |
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

### Phase 0 — Plan v2 (this commit, ~now)
- ✅ Branch `workflow-implementation-and-optimization` from `main`
- ✅ `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` v2 (this file)
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

### Phase 3 — Self-hosted n8n on Fly.io
- New `fly.toml` for the n8n app, `Dockerfile` (or use n8n's official image), Tigris volume
- `n8n.datiq.app` DNS + TLS
- Cloudflare Access (or basic auth) in front of the UI
- Encryption key set
- Daily backup script to Tigris
- Health check + smoke test workflow ("hello world" workflow that posts to Slack on a 5-min schedule)
- **Exit criterion:** open `https://n8n.datiq.app`, log in, see the "hello world" workflow running, verify a Slack message lands

### Phase 4 — Workflow ① + first MCP tools
- `n8n/workflows/01-datiq-schedule-changed-router.json` — replaces `SCHEDULE_ALERT_WEBHOOK`
- `n8n/workflows/datiq-list-pending-workflows.json` — first MCP tool
- `n8n/workflows/datiq-get-workflow-event.json`
- `n8n/workflows/datiq-process-pending-workflow.json`
- `n8n/workflows/datiq-retry-workflow-event.json`
- `n8n/workflows/datiq-cancel-workflow-event.json`
- Wire `SCHEDULE_ALERT_WEBHOOK` to `https://n8n.datiq.app/webhook/datiq/schedule-changed`
- Remove the `TODO(SCHEDULE_ALERT_WEBHOOK)` comment
- **Exit criterion:** end-to-end test: create a test schedule → wait for runner → see Slack message in `#monitoring` → see email arrive → Claude Desktop connects to `https://n8n.datiq.app/mcp`, calls `datiq_list_pending_workflows`, sees the event as `done`

### Phase 5 — Remaining automation workflows + schedule MCP tools
- Workflows ② through ⑦ (the automation flows + channel router)
- MCP tools 6–11 (`datiq_list_schedules`, `datiq_create_schedule`, pause/resume/delete, `datiq_diagnose_pending_workflow`)
- CI workflow runs `n8n import:workflow` + a smoke test against each on every PR
- **Exit criterion:** each workflow has a test trigger + a manual run that updates a `workflow_events` row; each MCP tool returns the expected shape in a manual test

### Phase 6 — /admin/automation observability page
- New `/admin/automation` page (or add to `/admin/revenue`): "Pending events", "Failed events (24h)", "Events by kind", "Avg time-to-done"
- **Exit criterion:** page shows the queue, clickable into the event detail; "Retry" button calls `datiq_retry_workflow_event` via MCP

### Phase 7 — Docs + handoff + merge
- `docs/N8N-WORKFLOWS.md` — how to import, edit, redeploy
- `docs/N8N-OPERATIONS.md` — backups, upgrades, monitoring, rollback
- `docs/MCP-TOOLS.md` — list of tools, examples, how to connect Claude Desktop
- Update `CLAUDE.md` "Outstanding tasks" — close `TODO(SCHEDULE_ALERT_WEBHOOK)`, add new "Automation pipeline" section
- Update `public/help/13-automations.html` (or equivalent) with the new flow
- PR to main, you approve, merge

---

## 10. Costs

| Item | Per month | Why |
|---|---|---|
| Fly.io n8n app (1 CPU / 1 GB) | $10-15 | shared CPU, minimal RAM, 24/7 |
| Fly.io volume (1 GB) | $0.15 | n8n's data dir |
| Tigris object storage | $0 (free 5 GB tier) | daily backups |
| Cloudflare Access | $0 (free for ≤50 users) | UI auth |
| Supabase (no change) | $0-25 | three new tables, low row count |
| Resend (no change) | $0-20 | emails still go through Resend |
| Slack incoming webhook | $0 | free |
| **Total** | **$10-15** | down from v1's $25-50 |

vs. engineering time saved when "why didn't the alert fire?" becomes "open /admin/automation, see the failed row, click retry".

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| n8n instance goes down | medium | orchestrator has a "fail to pending" path; for the most critical kind (`schedule.changed`), the orchestrator can call Resend directly from a fallback branch in `workflow-orchestrator.js` itself, so emails still go out even if n8n is down. **Critical-kind fallback is Phase 1, before n8n is even deployed.** |
| Volume fills up (execution history grows) | medium | Fly volume metrics alert at > 70%; n8n's "Prune executions" setting caps execution history to 7 days; weekly `n8n export:workflow` to git |
| n8n upgrade breaks a workflow | medium | Pin to a minor version for 3 months; always upgrade staging first; CI runs `n8n import:workflow` + smoke tests on every PR |
| MCP API key leaks | low | Rotate via `fly secrets set DATIQ_MCP_API_KEY=<new>`; old key invalidates on next request; rotate quarterly |
| Pending queue grows unbounded | low | `attempts >= max_attempts` → `state = "failed"`; failed events paginated in /admin; old done events archived to `workflow_events_archive` after 30d |
| Slack formatting code (currently a Node module) doesn't run in n8n's Code node | medium | n8n's Code node supports JS but not Node `require`. Two options: (a) inline the Slack Block Kit builder into the workflow as a Code node, (b) expose a tiny Netlify function `/api/slack-format` that takes a payload and returns Block Kit JSON, call it from n8n. **Recommendation: (b)** — keeps `slackFormatter.js` as the single source of truth. |
| Backwards compat — old `SCHEDULE_ALERT_WEBHOOK` URLs stop working | low | if old URL is set, keep calling it; only the new code path uses n8n |
| Guest schedules never reach the queue (RLS) | known | per CLAUDE.md, guest schedules are localStorage-only; the orchestrator reads from `scheduled_tasks` (RLS-bypassed by service key) but guest rows aren't there, so this is unchanged |
| n8n's MCP Server Trigger is a recent feature; bugs likely | medium | Wrap each MCP tool with an outer `try/catch` Code node that returns a structured error instead of failing the whole call. n8n releases weekly; pin to a minor version. |
| Cloudflare Access denies you in a network outage | low | Fallback: Tailscale or Wireguard into the Fly private network; or set a Fly SSH tunnel to the n8n container's port 5678 directly. Document the break-glass in `N8N-OPERATIONS.md`. |
| Backup snapshot grows over time (Tigris free tier = 5 GB) | low | 1 GB n8n volume + 14 daily snapshots at < 100 MB each = ~1.5 GB. Plenty of headroom. If it ever gets close, snapshot every 2 days instead of daily. |

---

## 12. What I will NOT do

- Replace `scheduled-runner.js` — it stays. It just stops being an orchestrator.
- Move Resend config to n8n — the `CONTACT_EMAIL_FROM` / `ALERT_EMAIL_FROM` / `FORM_EMAIL_FROM` rule (per CLAUDE.md "Email sender rule") still holds. n8n calls DatIQ's `/api/contact-email` / `/api/welcome-email` endpoints (or uses the same `RESEND_API_KEY` directly — see §10 risk #1 for the fallback path).
- Add a UI for the workflow queue in V1 — that's Phase 6 and the user can see everything via the MCP server from day one.
- Wire the Telegram / Discord channels until Phase 5 — Phase 4 ships with Slack + email only, which matches what the production app does today.
- Add per-user MCP keys in V1 — single shared `DATIQ_MCP_API_KEY` is fine for V1. Multi-tenant keys are a V2 problem (when we have other operators).
- Set up n8n's `main + worker` mode for V1 — single process handles our volume. Split when queue depth > 50 sustained.

---

## 13. Open questions for you

1. **n8n storage:** SQLite (single file, simplest) or Postgres from day one (more robust, more ops)? **My recommendation:** SQLite for V1, Postgres when we hit the migration triggers in §4.2.
2. **n8n UI auth:** Cloudflare Access (recommended) or Fly's built-in basic auth? Cloudflare gives you per-user, audit log, integrates with whatever SSO you have. Basic auth is 5 minutes to set up but uglier.
3. **Backup retention:** 14 days of daily Tigris snapshots, or 7? Or 30? Storage is cheap; longer retention is safer. **My recommendation:** 14.
4. **MCP client support:** Which MCP clients do you actually use day-to-day? Claude Desktop, Claude Code, Cursor, something else? This affects the MCP transport (n8n uses SSE; some clients only do stdio). **My recommendation:** Claude Code + Claude Desktop at minimum. If you need stdio for some client, we add a tiny bridge.
5. **Daily digest email** — keep the existing inline copy, or rewrite during the move? The current copy is decent but lives in a Netlify function. Moving to n8n is a chance to edit it without a redeploy. **My recommendation:** keep the copy in V1, expose a "edit" affordance in Phase 6.
6. **Guest user scheduled tasks** — should the orchestrator pick them up from localStorage somehow? Probably no (RLS, no server-side user_id), but worth flagging. **My recommendation:** leave as-is. Guest schedules are local-only by design.
7. **Razorpay payment → n8n workflow in V1, or wait for V2?** I have it in the plan as ④. If you want to defer to V2 to keep this PR focused, say so. **My recommendation:** keep it in V1 — it's small, and the current scattered code is exactly the kind of thing this refactor cleans up.
8. **Single MCP API key vs per-user:** V1 ships with one shared `DATIQ_MCP_API_KEY`. OK for now, or do you want per-user keys from day one? **My recommendation:** single key for V1.
9. **Should the MCP server be reachable publicly, or only via Cloudflare Access?** n8n's MCP endpoint at `/mcp` should NOT be public if it triggers writes. **My recommendation:** put the whole `n8n.datiq.app` behind Cloudflare Access; the MCP endpoint is on the same hostname, so it's covered.
10. **Version pin for n8n:** pin to `1.95.x` (current stable as of plan date) or ride `latest`? **My recommendation:** pin to a minor for the first 3 months.

---

## 14. Definition of done for this branch

- [ ] Phase 1 — schema + orchestrator merged
- [ ] Phase 2 — scheduled-runner rewired
- [ ] Phase 3 — self-hosted n8n live on `n8n.datiq.app`, healthy
- [ ] Phase 4 — workflow ① replacing the dead webhook + 5 MCP tools live
- [ ] Phase 5 — remaining workflows + 6 schedule MCP tools live
- [ ] Phase 6 — /admin/automation page
- [ ] Phase 7 — docs + handoff
- [ ] All existing tests still pass (1029+ vitest + contract tests)
- [ ] Manual end-to-end test: create schedule → change detected → Slack message + email delivered within 5 min
- [ ] Claude Desktop connects to `https://n8n.datiq.app/mcp`, sees 11 tools, can call each one
- [ ] PR opened, you approve, merge to main

---

*Ready for review. Nothing is built yet. Once you say "go" on the plan, I'll start Phase 1.*
