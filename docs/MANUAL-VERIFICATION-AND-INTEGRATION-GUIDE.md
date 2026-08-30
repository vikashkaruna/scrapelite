# DatIQ — Master Manual Verification, End-to-End Testing & Integration Runbook

> **Document Purpose:** Complete operational guide for manual verification, end-to-end test execution, external integration setup, and operator runbooks for the DatIQ Workflow & Orchestration Engine.  
> **Target Branch:** `workflow-implementation-and-optimization`  
> **Deployed n8n Target:** `https://n8n-dev-692109205619.asia-south1.run.app`  
> **Audience:** Operators, QA engineers, developers, and future maintainers.

---

## Table of Contents
1. [Operator Setup Checklist: Required Configurations](#1-operator-setup-checklist-required-configurations)
2. [Step-by-Step Guide: Configuring External Integrations](#2-step-by-step-guide-configuring-external-integrations)
   - 2.1 [Slack Notifications & Monitoring](#21-slack-notifications--monitoring)
   - 2.2 [Resend Email Delivery](#22-resend-email-delivery)
   - 2.3 [HubSpot CRM 1-Click Push](#23-hubspot-crm-1-click-push)
   - 2.4 [Notion Database 1-Click Push](#24-notion-database-1-click-push)
   - 2.5 [Airtable 1-Click Push](#25-airtable-1-click-push)
   - 2.6 [Zapier Custom Webhook](#26-zapier-custom-webhook)
3. [End-to-End Verification Test Catalog (Every Flow & Scenario)](#3-end-to-end-verification-test-catalog-every-flow--scenario)
   - 3.1 [Scenario 1: Scheduled Monitoring — Primary n8n Route](#31-scenario-1-scheduled-monitoring--primary-n8n-route)
   - 3.2 [Scenario 2: Scheduled Monitoring — Direct Fallback & Deduplication](#32-scenario-2-scheduled-monitoring--direct-fallback--deduplication)
   - 3.3 [Scenario 3: Orchestrator On-Demand Run (`/api/workflow-orchestrator/run-now`)](#33-scenario-3-orchestrator-on-demand-run-apiworkflow-orchestratorrun-now)
   - 3.4 [Scenario 4: Server Callback API (`/api/workflow-callback`)](#34-scenario-4-server-callback-api-apiworkflow-callback)
   - 3.5 [Scenario 5: Interactive 1-Click CRM/Database Pushes](#35-scenario-5-interactive-1-click-crmdatabase-pushes)
   - 3.6 [Scenario 6: Third-Party Plan Gating Enforcement (Free/Go vs Select/Pro)](#36-scenario-6-third-party-plan-gating-enforcement-freego-vs-selectpro)
   - 3.7 [Scenario 7: Admin Automation UI Portal (`/admin/automation`)](#37-scenario-7-admin-automation-ui-portal-adminautomation)
   - 3.8 [Scenario 8: MCP Operations Tools Execution](#38-scenario-8-mcp-operations-tools-execution)
4. [Test Execution Matrix & SQL Verification Queries](#4-test-execution-matrix--sql-verification-queries)

---

## 1. Operator Setup Checklist: Required Configurations

### 1.1 Netlify Environment Variables
Set these variables in the Netlify Dashboard (**Site Settings → Environment Variables**) for **Production**, **Staging**, and **Branch Deploys**:

| Variable Name | Required Value / Format | Purpose |
|---|---|---|
| `N8N_BASE_URL` | `https://n8n-dev-692109205619.asia-south1.run.app` | Base endpoint where DatIQ dispatches webhook events. |
| `N8N_WEBHOOK_SECRET` | 32-byte hex string (`openssl rand -hex 32`) | Shared HMAC secret used to sign dispatches and authenticate callbacks. |
| `WORKFLOW_ORCHESTRATOR_TOKEN` | 32-byte hex string (separate value) | Bearer token for authorized on-demand HTTP triggers (`/run-now`). |
| `RESEND_API_KEY` | `re_...` | API key for direct fallback emails and transactional alerts. |

---

### 1.2 n8n Instance Environment Variables (GCP Cloud Run / VPS)
Set these variables on your n8n deployment:

```bash
# General Instance Configuration
N8N_BASE_URL=https://n8n-dev-692109205619.asia-south1.run.app
WEBHOOK_URL=https://n8n-dev-692109205619.asia-south1.run.app
GENERIC_TIMEZONE=Asia/Kolkata
N8N_ENCRYPTION_KEY=<32-byte-hex-string>

# Shared Secret (MUST match Netlify's N8N_WEBHOOK_SECRET)
DATIQ_N8N_API_KEY=<same-value-as-N8N_WEBHOOK_SECRET>
N8N_WEBHOOK_SECRET=<same-value-as-N8N_WEBHOOK_SECRET>

# Pruning (Keeps database lightweight)
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
```

---

### 1.3 n8n Dashboard Credentials Setup
Open `https://n8n-dev-692109205619.asia-south1.run.app/` → **Credentials** → **Add Credential**:

1. **`datiq-resend`**:
   - Type: **Header Auth** (or **HTTP Header Auth**)
   - Name: `datiq-resend`
   - Header Name: `Authorization`
   - Header Value: `Bearer re_xxxxxxxxxxxxxxxxxxxx`
2. **`datiq-slack-monitoring`**:
   - Type: **Slack OAuth2 API** (or **Header Auth** with `Authorization: Bearer xoxb-...`)
   - Name: `datiq-slack-monitoring`
   - Connect channel: `#monitoring`

> [!NOTE]
> **No database keys required in n8n**: `datiq-supabase-service` is **not needed** because n8n uses the Server Callback API (`/api/workflow-callback`) to update event states.

---

### 1.4 Workflows Import
Import all 17 workflows into your n8n instance:
```bash
# Run locally against running n8n or inside the container:
npx n8n import:workflow --input=n8n/workflows/
```

---

## 2. Step-by-Step Guide: Configuring External Integrations

### 2.1 Slack Notifications & Monitoring
1. Create a Slack App in your workspace at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Incoming Webhooks** or **Bot User OAuth Tokens** (`chat:write`, `channels:read`).
3. Add the bot to your channels: `#monitoring` (system events), `#datiq-alerts` (critical ops), and `#datiq-support` (contact requests).
4. For per-user Slack alerts: Users can paste their Slack Incoming Webhook URL in `/account#integrations`.

---

### 2.2 Resend Email Delivery
1. Go to [Resend Dashboard](https://resend.com/api-keys) and generate an API key.
2. Verify your domain `datiq.app` (or testing domain) under **Domains** with standard SPF, DKIM, and MX records.
3. Configure `RESEND_API_KEY` in Netlify and in n8n's `datiq-resend` credential.

---

### 2.3 HubSpot CRM 1-Click Push
1. In HubSpot, go to **Settings → Integrations → Private Apps**.
2. Click **Create private app**, name it `DatIQ Connector`.
3. Under **Scopes**, select:
   - `crm.objects.contacts.write`
   - `crm.objects.companies.write`
4. Click **Create app** and copy the Access Token (`pat-na1-...`).
5. In DatIQ, navigate to `/account#integrations` → **HubSpot** → Paste Access Token → Click **Save Connection**.
6. **How to test:** On `/preview` or `/dashboard`, click **Push → Push to HubSpot**. A contact and company record will be created in HubSpot.

---

### 2.4 Notion Database 1-Click Push
1. In Notion, go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and click **New integration**.
2. Name it `DatIQ Scraper`, select your workspace, and copy the **Internal Integration Secret** (`ntn_...`).
3. Create a Notion Database (table) with columns: `Title` (Title), `URL` (URL), `Summary` (Text), `Extracted` (Date).
4. In the database page in Notion, click `...` → **Connections** → Add `DatIQ Scraper`.
5. Copy the 32-character **Database ID** from the database URL (`notion.so/workspace/{DATABASE_ID}?v=...`).
6. In DatIQ, go to `/account#integrations` → **Notion** → Enter Integration Secret and Database ID → Click **Save Connection**.
7. **How to test:** Click **Push → Push to Notion** on any extraction. A new page is added to your Notion table.

---

### 2.5 Airtable 1-Click Push
1. In Airtable, go to [airtable.com/create/tokens](https://airtable.com/create/tokens) and generate a **Personal Access Token**.
2. Scopes: `data.records:write`, `schema.bases:read`.
3. Access: Grant access to your target base.
4. Copy the Base ID (`appXXXXXXXXXXXXXX`) and Table Name (e.g. `Extractions`).
5. In DatIQ, go to `/account#integrations` → **Airtable** → Enter Token, Base ID, Table Name → Click **Save Connection**.
6. **How to test:** Click **Push → Push to Airtable**. Rows are created with deep-flattened enrichment fields.

---

### 2.6 Zapier Custom Webhook
1. In Zapier, create a new Zap with trigger **Webhooks by Zapier → Catch Hook**.
2. Copy the generated Webhook URL (`https://hooks.zapier.com/hooks/catch/...`).
3. In DatIQ, go to `/account#integrations` → **Zapier** → Paste Webhook URL → Click **Save Connection**.
4. **How to test:** Click **Push → Push to Zapier**. Zapier receives the full structured JSON extraction payload.

---

## 3. End-to-End Verification Test Catalog (Every Flow & Scenario)

```
                              END-TO-END FLOW OVERVIEW

  ┌────────────────────────────────────────────────────────────────────────────────┐
  │ 1. Scheduled Change Detection (scheduled-runner.js)                           │
  │    └─► Primary: Enqueues to `workflow_events` (state: 'pending')              │
  │    └─► Fallback: Sends direct Resend email + Slack alert                      │
  │    └─► Deduplication: Commits `lastHash = newHash` to DB                      │
  ├────────────────────────────────────────────────────────────────────────────────┤
  │ 2. Asynchronous Polling & Dispatch (workflow-orchestrator.js)                  │
  │    └─► Claims events (state: 'processing')                                    │
  │    └─► POSTs to n8n (X-DatIQ-Signature HMAC)                                  │
  ├────────────────────────────────────────────────────────────────────────────────┤
  │ 3. n8n Execution & Server Callback                                            │
  │    └─► Delivers Slack & Resend notifications                                   │
  │    └─► Calls POST /api/workflow-callback with { event_id, state: "done" }      │
  ├────────────────────────────────────────────────────────────────────────────────┤
  │ 4. DatIQ State Commitment                                                     │
  │    └─► Validates callback HMAC signature                                      │
  │    └─► Updates `workflow_events` (state: 'done') & logs to `workflow_runs`   │
  └────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.1 Scenario 1: Scheduled Monitoring — Primary n8n Route
- **Goal:** Verify that a detected website content change is enqueued into `workflow_events` and processed by n8n.
- **Pre-Conditions:** `N8N_BASE_URL` and `N8N_WEBHOOK_SECRET` are set in Netlify.
- **Trigger Execution:**
  ```bash
  curl -X POST "https://datiq.app/.netlify/functions/scheduled-runner"
  ```
- **Expected Results:**
  1. `scheduled-runner` logs: `[DatIQ] scheduled-runner: scanned N schedules, detected changes`.
  2. Supabase SQL Query shows new row:
     ```sql
     SELECT id, kind, state, attempts, created_at FROM workflow_events WHERE kind = 'schedule.changed' ORDER BY created_at DESC LIMIT 1;
     ```
     `state` should be `'pending'` (or `'processing'` / `'done'`).
  3. `scheduled_tasks` row has `lastHash = newHash` and `lastStatus = 'changed'`.

---

### 3.2 Scenario 2: Scheduled Monitoring — Direct Fallback & Deduplication
- **Goal:** Verify that when n8n is offline or unreachable, the system falls back to direct Resend/Slack delivery and prevents duplicate alerts.
- **Pre-Conditions:** Temporarily unset `N8N_BASE_URL` or point it to a non-existent port.
- **Trigger Execution:**
  ```bash
  curl -X POST "https://datiq.app/.netlify/functions/scheduled-runner"
  ```
- **Expected Results:**
  1. `scheduled-runner` catches queue failure and immediately executes direct Resend email (`sendDirectEmail`) and direct Slack notification (`postToSlack`).
  2. Database `scheduled_tasks` commits `lastHash = newHash`.
  3. **Duplicate Prevention Test:** Run `scheduled-runner` a second time:
     - Output: `unchanged` (0 emails sent, 0 webhooks fired).
     - Confirms **zero duplicate alerts**.

---

### 3.3 Scenario 3: Orchestrator On-Demand Run (`/api/workflow-orchestrator/run-now`)
- **Goal:** Verify that the orchestrator claims pending events and dispatches them to n8n.
- **Trigger Execution:**
  ```bash
  curl -X POST "https://datiq.app/api/workflow-orchestrator/run-now" \
    -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN" \
    -H "Content-Type: application/json"
  ```
- **Expected Response:**
  ```json
  {
    "ok": true,
    "claimed": 1,
    "dispatched": 1,
    "failed": 0,
    "duration_ms": 320
  }
  ```
- **Verification:**
  1. Event in `workflow_events` moves to `state = 'processing'` or `state = 'done'`.
  2. Dispatch payload includes HMAC signature header `X-DatIQ-Signature`.

---

### 3.4 Scenario 4: Server Callback API (`/api/workflow-callback`)
- **Goal:** Verify that n8n can call back to DatIQ without database credentials, and DatIQ successfully updates the event state.
- **Trigger Execution (Simulating n8n callback):**
  ```bash
  curl -X POST "https://datiq.app/api/workflow-callback" \
    -H "Authorization: Bearer $N8N_WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -d '{
      "event_id": "<EVENT_ID_FROM_QUEUE>",
      "state": "done",
      "output": { "slack_ts": "1725000000.123", "email_id": "msg_abc123" },
      "duration_ms": 450
    }'
  ```
- **Expected Response:**
  ```json
  {
    "ok": true,
    "event_id": "<EVENT_ID_FROM_QUEUE>",
    "state": "done"
  }
  ```
- **Database Verification:**
  ```sql
  SELECT id, state, finished_at, last_error FROM workflow_events WHERE id = '<EVENT_ID_FROM_QUEUE>';
  SELECT * FROM workflow_runs WHERE event_id = '<EVENT_ID_FROM_QUEUE>';
  ```
  `state` is `'done'`, and a `workflow_runs` row exists with `run_type = 'n8n_callback'`.

---

### 3.5 Scenario 5: Interactive 1-Click CRM/Database Pushes
- **Goal:** Verify that user-specific CRM pushes work independently of n8n.
- **Steps:**
  1. Log in to DatIQ as a paid user (`Select` or above).
  2. Connect HubSpot / Notion / Airtable in `/account#integrations`.
  3. Extract any website (e.g. `https://example.com`).
  4. On `/preview` or `/dashboard`, click the **Push** dropdown and select your integration.
- **Expected Results:**
  - UI displays immediate loading spinner, followed by a green toast: `✓ Pushed company & contacts to HubSpot`.
  - Object is created in the user's personal CRM account with no cross-tenant leakage.

---

### 3.6 Scenario 6: Third-Party Plan Gating Enforcement (Free/Go vs Select/Pro)
- **Goal:** Ensure Free and Go tier users cannot push to third-party integrations, while Select, Pro, Business, Agency, and Developer users have full access.
- **Test:**
  - As a Free tier user: Attempt to push or connect an integration.
  - Expected: UI displays plan upgrade modal/toast: `Integrations are available on the Select plan and above.`
  - Direct API call returns `403 Forbidden` (`plan_not_entitled`).

---

### 3.7 Scenario 7: Admin Automation UI Portal (`/admin/automation`)
- **Goal:** Verify administrative observability and retry controls.
- **Steps:**
  1. Navigate to `/admin/automation` in your browser.
  2. Check KPI Cards: **Pending (5m)**, **Processing**, **Failed (24h)**, **Completed (24h)**.
  3. Check Filter Chips: Filter by event kind (`schedule.changed`, `contact.received`, `op.alert`).
  4. Click on any event row to open the **Event Inspector Drawer**.
  5. Click **"Retry Now"** on any failed event: Row immediately re-queues with `attempts = 0` and `state = 'pending'`.

---

### 3.8 Scenario 8: MCP Operations Tools Execution
- **Goal:** Verify that AI assistants (Claude Desktop / Cursor) can manage workflows via Model Context Protocol.
- **Tools Available:**
  - `datiq_list_pending_workflows`
  - `datiq_get_workflow_event`
  - `datiq_process_pending_workflow`
  - `datiq_retry_workflow_event`
  - `datiq_cancel_workflow_event`
  - `datiq_diagnose_pending_workflow`
- **Verification Command:**
  ```bash
  curl -X POST "https://n8n-dev-692109205619.asia-south1.run.app/mcp/datiq_list_pending_workflows" \
    -H "Authorization: Bearer $DATIQ_N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{ "state": "pending", "limit": 10 }'
  ```

---

## 4. Test Execution Matrix & SQL Verification Queries

### Quick Diagnostic SQL Queries (Run in Supabase SQL Editor):

```sql
-- 1. Check queue health & backlog (last 24 hours)
SELECT 
  state, 
  count(*), 
  min(created_at) as oldest_event, 
  max(created_at) as newest_event 
FROM workflow_events 
WHERE created_at > now() - interval '24 hours' 
GROUP BY state;

-- 2. Inspect failed events with error details
SELECT 
  id, 
  kind, 
  attempts, 
  max_attempts, 
  last_error, 
  next_attempt_at 
FROM workflow_events 
WHERE state = 'failed' 
ORDER BY created_at DESC 
LIMIT 20;

-- 3. Verify execution run logs
SELECT 
  r.id, 
  r.event_id, 
  r.run_type, 
  r.response_status, 
  r.duration_ms, 
  r.created_at 
FROM workflow_runs r 
ORDER BY r.created_at DESC 
LIMIT 25;

-- 4. Check user integration connections
SELECT 
  user_id, 
  provider, 
  created_at, 
  updated_at 
FROM integration_connections 
ORDER BY created_at DESC;
```
