# DatIQ — Master Manual Verification, End-to-End Testing & Two-Way Integration Runbook

> **Document Purpose:** Comprehensive operational guide for manual verification, end-to-end testing, preparing external environments (HubSpot, Notion, Airtable, Zapier, n8n), and executing two-way integration verification for the DatIQ Platform.  
> **Target Branch:** `workflow-implementation-and-optimization`  
> **Deployed Preview URL:** `https://workflow-optimization.datiq.app`  
> **Deployed n8n Target:** `https://n8n-dev-692109205619.asia-south1.run.app`  
> **Audience:** Operators, QA engineers, developers, and future maintainers.

---

## Table of Contents
1. [Operator Setup Checklist: Required Configurations](#1-operator-setup-checklist-required-configurations)
2. [Step-by-Step Guide: Preparing Environments & Configuring Two-Way Integrations](#2-step-by-step-guide-preparing-environments--configuring-two-way-integrations)
   - 2.1 [HubSpot CRM — Two-Way Integration (Schema Introspection + Push)](#21-hubspot-crm--two-way-integration-schema-introspection--push)
   - 2.2 [Notion Databases — Two-Way Integration (Schema Discovery + Page Creation)](#22-notion-databases--two-way-integration-schema-discovery--page-creation)
   - 2.3 [Airtable — Two-Way Integration (Base Schema Introspection + Record Push)](#23-airtable--two-way-integration-base-schema-introspection--record-push)
   - 2.4 [Zapier — Two-Way Integration (Inbound Actions + Outbound Triggers & Push)](#24-zapier--two-way-integration-inbound-actions--outbound-triggers--push)
   - 2.5 [n8n Automation Engine — Two-Way Pipeline (HMAC Dispatch + Server Callback)](#25-n8n-automation-engine--two-way-pipeline-hmac-dispatch--server-callback)
   - 2.6 [Slack Notifications & Monitoring](#26-slack-notifications--monitoring)
   - 2.7 [Google Sheets Export](#27-google-sheets-export)
3. [End-to-End Verification Test Catalog (Every Flow & Scenario)](#3-end-to-end-verification-test-catalog-every-flow--scenario)
   - 3.1 [Scenario 1: Scheduled Monitoring — Primary n8n Route](#31-scenario-1-scheduled-monitoring--primary-n8n-route)
   - 3.2 [Scenario 2: Scheduled Monitoring — Direct Fallback & Deduplication](#32-scenario-2-scheduled-monitoring--direct-fallback--deduplication)
   - 3.3 [Scenario 3: Orchestrator On-Demand Run (`/api/workflow-orchestrator/run-now`)](#33-scenario-3-orchestrator-on-demand-run-apiworkflow-orchestratorrun-now)
   - 3.4 [Scenario 4: Server Callback API (`/api/workflow-callback`)](#34-scenario-4-server-callback-api-apiworkflow-callback)
   - 3.5 [Scenario 5: Interactive 1-Click CRM & Database Pushes](#35-scenario-5-interactive-1-click-crm--database-pushes)
   - 3.6 [Scenario 6: Third-Party Plan Gating Enforcement (Free/Go vs Select/Pro)](#36-scenario-6-third-party-plan-gating-enforcement-freego-vs-selectpro)
   - 3.7 [Scenario 7: Admin Automation Portal & Mode Controls (`/admin/automation`)](#37-scenario-7-admin-automation-portal--mode-controls-adminautomation)
   - 3.8 [Scenario 8: MCP Operations Tools Execution](#38-scenario-8-mcp-operations-tools-execution)
   - 3.9 [Scenario 9: Automated Pipeline Test Runner (`npm run test:workflow`)](#39-scenario-9-automated-pipeline-test-runner-npm-run-testworkflow)
4. [Diagnostic SQL Queries & Verification Matrix](#4-diagnostic-sql-queries--verification-matrix)
5. [Troubleshooting & Known Edge Cases](#5-troubleshooting--known-edge-cases)

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

### 1.2 n8n Instance Environment Variables (GCP Cloud Run)
Set these variables on your GCP Cloud Run service:

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

## 2. Step-by-Step Guide: Preparing Environments & Configuring Two-Way Integrations

---

### 2.1 HubSpot CRM — Two-Way Integration (Schema Introspection + Push)

#### A. Architecture Overview
- **Inbound Leg (HubSpot → DatIQ):** `GET /api/integrations/hubspot/schema` calls HubSpot API (`/crm/v3/properties/contacts` and `/crm/v3/properties/companies`) to dynamically introspect available fields and custom properties.
- **Outbound Leg (DatIQ → HubSpot):** `POST /api/integrations/hubspot/push` creates or updates Company records (domain, name, summary) and Contact records (first name, last name, email, job title) linked to the company.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        HUBSPOT TWO-WAY INTEGRATION                         │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Inbound Schema Discovery          │ 2. Outbound Record Push             │
│   DatIQ reads available CRM fields   │   DatIQ creates company + contacts  │
│   and custom properties dynamically  │   and links them in your CRM        │
└──────────────────────────────────────┴─────────────────────────────────────┘
```

#### B. Step-by-Step Environment Preparation (HubSpot Side)
1. **Log in or create a HubSpot account** at [app.hubspot.com](https://app.hubspot.com) (a free developer/test portal or production portal).
2. Navigate to **Settings** (gear icon in the top navigation bar).
3. In the left sidebar, expand **Integrations** → click **Private Apps**.
4. Click **Create a private app**.
5. In the **Basic Info** tab:
   - **Name:** `DatIQ Two-Way Connector`
   - **Description:** `Two-way integration for DatIQ web extraction and contact discovery.`
6. In the **Scopes** tab, search for and check the following **4 mandatory scopes**:
   - `crm.objects.contacts.read` *(Reads contact schema and properties)*
   - `crm.objects.contacts.write` *(Creates contacts in HubSpot)*
   - `crm.objects.companies.read` *(Reads company schema and properties)*
   - `crm.objects.companies.write` *(Creates companies in HubSpot)*
7. Click **Create app** (top right) → Click **Continue creating**.
8. Click **Show token** and copy the Private App Access Token (`pat-na1-...` or `pat-eu1-...`).

#### C. Step-by-Step Configuration in DatIQ
1. Open DatIQ in your browser and sign in.
2. Navigate to **Account** (`/account#integrations`) or click your profile avatar → **Integrations**.
3. In the **Integrations** section, locate **HubSpot** and click **Connect**.
4. Paste your **HubSpot Private App Token** into the input field.
5. *(Optional)* Provide an **Account label** (e.g. `Acme Production Hub`).
6. Click **Connect HubSpot**. The toast confirms: `✓ Connected. HubSpot is now wired up.`

#### D. Two-Way Testing Procedure

##### Test 1: Inbound Schema Verification (DatIQ reads HubSpot)
Open DevTools Network tab or execute via `curl` with your user JWT:
```bash
curl -X GET "https://workflow-optimization.datiq.app/api/integrations/hubspot/schema" \
  -H "Authorization: Bearer <YOUR_SUPABASE_USER_JWT>"
```
- **Expected Response:** `200 OK` with JSON payload containing:
  ```json
  {
    "ok": true,
    "contacts": [ { "name": "firstname", "type": "string" }, { "name": "email", "type": "string" }, ... ],
    "companies": [ { "name": "name", "type": "string" }, { "name": "domain", "type": "string" }, ... ]
  }
  ```

##### Test 2: Outbound CRM Push Verification (DatIQ writes to HubSpot)
1. In DatIQ, go to **Extract** (`/`) and run an extraction on a domain with leadership info (e.g. `https://stripe.com` or `https://lumio.ai`).
2. On `/preview` or on `/dashboard` (select the row):
3. Click the **Push** dropdown menu → Select **Push to HubSpot**.
4. **Expected Result in DatIQ:** A green toast appears: `✓ Pushed company & contacts to HubSpot`.
5. **Verification in HubSpot CRM:**
   - In HubSpot, navigate to **CRM → Companies**: Look for the newly extracted domain/company name with website and AI summary.
   - Navigate to **CRM → Contacts**: Look for the extracted contacts with job titles and email addresses associated with the company.

---

### 2.2 Notion Databases — Two-Way Integration (Schema Discovery + Page Creation)

#### A. Architecture Overview
- **Inbound Leg (Notion → DatIQ):** `GET /api/integrations/notion/schema` calls Notion API (`/v1/databases/{database_id}`) to introspect table columns (`title`, `url`, `rich_text`, `date`, `number`, `select`, etc.).
- **Outbound Leg (DatIQ → Notion):** `POST /api/integrations/notion/push` inserts structured pages into the Notion database, formatting properties and embedding markdown blocks.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         NOTION TWO-WAY INTEGRATION                         │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Inbound Schema Introspection      │ 2. Outbound Page Creation           │
│   DatIQ inspects your database schema│   DatIQ creates structured Notion   │
│   and maps column types automatically│   pages with rich blocks & content  │
└──────────────────────────────────────┴─────────────────────────────────────┘
```

#### B. Step-by-Step Environment Preparation (Notion Side)
1. **Create an Internal Integration in Notion:**
   - Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and sign in.
   - Click **+ New integration**.
   - **Name:** `DatIQ Notion Two-Way Sync`
   - **Associated workspace:** Select your target Notion workspace.
   - **Capabilities:** Ensure **Read content**, **Update content**, and **Insert content** are checked.
   - Click **Save** and copy the **Internal Integration Secret** (`ntn_...` or `secret_...`).
2. **Create a Target Database in Notion:**
   - In your Notion workspace, create a new **Page** and add a **Table database** (Full page or Inline table).
   - Name the table: `DatIQ Extractions`.
   - Set up the table columns (Properties):
     - `Title` (Type: **Title** — default first column)
     - `URL` (Type: **URL**)
     - `Summary` (Type: **Text** / Rich Text)
     - `Extracted At` (Type: **Date**)
     - `Headings Count` (Type: **Number**)
     - `Links Count` (Type: **Number**)
3. **CRITICAL: Connect the Integration to Your Database:**
   - Open your `DatIQ Extractions` database page in Notion.
   - Click the **`...`** menu in the top-right corner.
   - Scroll down to **Connections** (or **Add connections**).
   - Search for `DatIQ Notion Two-Way Sync` and click to grant access.
   *(Without this step, Notion's API returns `404 Object Not Found`).*
4. **Copy Your Database ID:**
   - Look at your Notion database page URL:
     `https://www.notion.so/myworkspace/a1b2c3d4e5f678901234567890abcdef?v=...`
   - The **Database ID** is the 32-character alphanumeric string `a1b2c3d4e5f678901234567890abcdef` (between the workspace slug and `?v=`).

#### C. Step-by-Step Configuration in DatIQ
1. In DatIQ, navigate to `/account#integrations` → **Notion** → Click **Connect**.
2. Paste the **Notion Integration Secret** (`ntn_...`).
3. Paste the **Database ID** (32 characters).
4. Click **Connect Notion**. Toast confirms: `✓ Connected. Notion is now wired up.`

#### D. Two-Way Testing Procedure

##### Test 1: Inbound Schema Verification (DatIQ reads Notion)
Run via `curl` with your user JWT:
```bash
curl -X GET "https://workflow-optimization.datiq.app/api/integrations/notion/schema" \
  -H "Authorization: Bearer <YOUR_SUPABASE_USER_JWT>"
```
- **Expected Response:** `200 OK` with JSON describing the column properties:
  ```json
  {
    "ok": true,
    "title": "DatIQ Extractions",
    "properties": {
      "Title": { "id": "title", "type": "title" },
      "URL": { "id": "abc", "type": "url" },
      "Summary": { "id": "def", "type": "rich_text" }
    }
  }
  ```

##### Test 2: Outbound Page Creation Verification (DatIQ writes to Notion)
1. On `/dashboard` or `/preview`, select 1 or more extractions.
2. Click **Push → Push to Notion**.
3. **Expected in DatIQ:** Toast shows `✓ Pushed 1 extraction to Notion`.
4. **Verification in Notion:**
   - Open your `DatIQ Extractions` database in Notion.
   - Verify that a new row appears with Title, URL link, Summary, and Date.
   - Click to open the page: The page body contains rich structured markdown blocks (H1–H3 headings, links list, key insights).

---

### 2.3 Airtable — Two-Way Integration (Base Schema Introspection + Record Push)

#### A. Architecture Overview
- **Inbound Leg (Airtable → DatIQ):** `GET /api/integrations/airtable/schema` calls Airtable Meta API (`/v0/meta/bases/{baseId}/tables`) to validate base and table columns.
- **Outbound Leg (DatIQ → Airtable):** `POST /api/integrations/airtable/push` creates batch records in Airtable with deep-flattened JSON properties.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        AIRTABLE TWO-WAY INTEGRATION                        │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Inbound Base & Table Introspection│ 2. Outbound Batch Record Push       │
│   DatIQ verifies base schema and     │   DatIQ creates records with links, │
│   column mappings against Airtable   │   headings, and enrichment outputs  │
└──────────────────────────────────────┴─────────────────────────────────────┘
```

#### B. Step-by-Step Environment Preparation (Airtable Side)
1. **Generate a Personal Access Token (PAT):**
   - Go to [airtable.com/create/tokens](https://airtable.com/create/tokens).
   - Click **+ Create token**.
   - **Name:** `DatIQ Airtable Two-Way Sync`
   - **Scopes (Add all 3):**
     - `data.records:read`
     - `data.records:write`
     - `schema.bases:read`
   - **Access:** Under **Access**, click **+ Add a base** → Select the base you wish to use (or **All current and future bases**).
   - Click **Create token** and copy the PAT (`patXXXXXXXXXXXXX.YYYYYYYYYYYYYYYYYYYYYY`).
2. **Prepare the Base & Table:**
   - In Airtable, open or create a Base (e.g. `DatIQ Extraction Base`).
   - Create or rename a table to: `Extractions`.
   - Ensure the table has fields:
     - `Page Title` (Single line text)
     - `URL` (URL)
     - `AI Summary` (Long text)
     - `Extracted Date` (Single line text or Date)
3. **Copy Base ID and Table ID / Name:**
   - From the Airtable URL: `https://airtable.com/appXXXXXXXXXXXXXX/tblYYYYYYYYYYYYYY/viwZZZZZZZZZZZZZZ`
   - **Base ID:** `appXXXXXXXXXXXXXX` (starts with `app`)
   - **Table ID:** `tblYYYYYYYYYYYYYY` (starts with `tbl`) or use table name `Extractions`.

#### C. Step-by-Step Configuration in DatIQ
1. In DatIQ, navigate to `/account#integrations` → **Airtable** → Click **Connect**.
2. Enter your **Airtable PAT** (`pat...`).
3. Enter your **Base ID** (`app...`).
4. Enter your **Table ID** (`tbl...` or `Extractions`).
5. Click **Connect Airtable**. Toast confirms: `✓ Connected. Airtable is now wired up.`

#### D. Two-Way Testing Procedure

##### Test 1: Inbound Schema Verification (DatIQ reads Airtable)
Execute via `curl` with your user JWT:
```bash
curl -X GET "https://workflow-optimization.datiq.app/api/integrations/airtable/schema" \
  -H "Authorization: Bearer <YOUR_SUPABASE_USER_JWT>"
```
- **Expected Response:** `200 OK` listing tables and field types.

##### Test 2: Outbound Record Push Verification (DatIQ writes to Airtable)
1. On `/dashboard`, select extractions → Click **Push → Push to Airtable**.
2. **Expected in DatIQ:** Toast shows `✓ Pushed extractions to Airtable`.
3. **Verification in Airtable:** Open the `Extractions` table in Airtable and verify the new rows and data.

---

### 2.4 Zapier — Two-Way Integration (Inbound Actions + Outbound Triggers & Push)

#### A. Architecture Overview
- **Inbound Leg (Zapier → DatIQ / Actions):** Zapier executes DatIQ actions via `POST /api/integrations/zapier/action` using `X-Zapier-Token` (`extract_url`, `create_schedule`, `enrich_extraction`).
- **Outbound Leg (DatIQ → Zapier / Triggers & Push):** 
  - DatIQ emits `new_extraction`, `new_enrichment`, and `monitoring_alert` events to `zapier_events`.
  - DatIQ directly pushes to Zapier Catch Hooks via `POST /api/integrations/zapier/push`.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         ZAPIER TWO-WAY INTEGRATION                         │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Inbound Actions (Zapier → DatIQ)  │ 2. Outbound Triggers (DatIQ → Zapier)│
│   • extract_url                      │   • new_extraction poll / push      │
│   • create_schedule                  │   • new_enrichment poll             │
│   • enrich_extraction                │   • monitoring_alert poll           │
└──────────────────────────────────────┴─────────────────────────────────────┘
```

#### B. Step-by-Step Configuration in DatIQ & Zapier
1. **Minting DatIQ Zapier Token:**
   - In DatIQ, go to `/account#integrations` → **Zapier** → Click **Connect**.
   - DatIQ mints and displays a fresh token: `zap_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
   - Click **Copy** to save the plaintext token.
2. **Setting up Zapier Catch Hook (for Real-Time Instant Push):**
   - In Zapier ([zapier.com](https://zapier.com)), click **Create Zap**.
   - **Trigger:** Choose **Webhooks by Zapier** → Event: **Catch Hook**.
   - Copy the Webhook URL: `https://hooks.zapier.com/hooks/catch/123456/abcdef/`.
   - In DatIQ `/account#integrations`, you can store this webhook URL for instant push routing.
3. **Setting up DatIQ Private App in Zapier (for Actions & Triggers):**
   - Import `docs/integrations/zapier-app.json` in [developer.zapier.com](https://developer.zapier.com).
   - In Zapier authentication step, paste your `zap_...` token.

#### C. Two-Way Testing Procedure

##### Test 1: Inbound Action Execution (Zapier calls DatIQ to extract a URL)
Execute via `curl` to simulate Zapier calling DatIQ:
```bash
curl -X POST "https://workflow-optimization.datiq.app/api/integrations/zapier/action" \
  -H "X-Zapier-Token: <YOUR_ZAP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "extract_url",
    "params": { "url": "https://example.com", "intent": "summary" }
  }'
```
- **Expected Response:** `200 OK` with extracted title, headings, links, and markdown content.

##### Test 2: Outbound Push to Zapier (DatIQ sends extraction to Zapier)
1. On `/preview` or `/dashboard`, select an extraction.
2. Click **Push → Push to Zapier**.
3. **Expected in DatIQ:** Toast shows `✓ Pushed 1 extraction to Zapier`.
4. **Verification in Zapier:** Check your Zapier test history / Zap execution log to see the payload received and processed.

---

### 2.5 n8n Automation Engine — Two-Way Pipeline (HMAC Dispatch + Server Callback)

#### A. Architecture Overview
- **Outbound Leg (DatIQ → n8n):** DatIQ signs event payloads with HMAC-SHA256 (`X-DatIQ-Signature`) and pushes to n8n webhook (`/webhook/datiq/...`).
- **Inbound Leg (n8n → DatIQ):** n8n processes the payload and calls back to `POST /api/workflow-callback` with HMAC authorization to update status to `done` and record execution metrics.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          n8n TWO-WAY INTEGRATION                           │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Outbound Dispatch (DatIQ → n8n)   │ 2. Inbound Callback (n8n → DatIQ)   │
│   • HMAC-signed HTTP webhook push    │   • POST /api/workflow-callback     │
│   • Event types: schedule.changed,   │   • Updates workflow_events state   │
│     contact.received, op.alert       │   • Logs metrics to workflow_runs   │
└──────────────────────────────────────┴─────────────────────────────────────┘
```

#### B. Step-by-Step Configuration & Verification
1. Ensure `N8N_BASE_URL` and `N8N_WEBHOOK_SECRET` are set in Netlify.
2. Open `/admin/automation` in DatIQ.
3. Verify that **Pipeline Mode** is set to **⚡ Event-Driven (Real-Time Push — Recommended)**.
4. Run the end-to-end simulation runner:
   ```bash
   npm run test:workflow
   ```
5. **Expected Output:**
   ```
   ✓ [1/5] Enqueued event (id: evt_..., kind: schedule.changed)
   ✓ [2/5] DB verification passed (state: pending, attempts: 0)
   ✓ [3/5] HMAC signature generated and dispatched
   ✓ [4/5] Simulated n8n callback received (POST /api/workflow-callback)
   ✓ [5/5] State committed to 'done' and logged in workflow_runs
   ```

---

### 2.6 Slack Notifications & Monitoring

1. Create a Slack Incoming Webhook at [api.slack.com/apps](https://api.slack.com/apps) for your channel (e.g. `#monitoring` or `#leads`).
2. In DatIQ, go to `/account#integrations` → **Slack** → Paste Webhook URL → Click **Save**.
3. **How to test:** On `/preview` or `/dashboard`, click **Push → Push to Slack**. A formatted Block Kit message with page title, link, and AI summary appears in your Slack channel.

---

### 2.7 Google Sheets Export

1. On `/dashboard` or `/preview`, click **Export → Open in Google Sheets**.
2. DatIQ generates a deep-flattened CSV and automatically opens a new Google Spreadsheet in your browser with the data imported.

---

## 3. End-to-End Verification Test Catalog (Every Flow & Scenario)

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
  3. **Duplicate Prevention Test:** Run `scheduled-runner` a second time: Output: `unchanged` (0 duplicate emails sent).

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
  { "ok": true, "claimed": 1, "dispatched": 1, "failed": 0, "duration_ms": 320 }
  ```

---

### 3.4 Scenario 4: Server Callback API (`/api/workflow-callback`)
- **Goal:** Verify that n8n can call back to DatIQ without database credentials, and DatIQ successfully updates event state.
- **Trigger Execution:**
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
  `state` is `'done'`, and a `workflow_runs` row exists with `channel = 'n8n'` and `response_status = 200`.

---

### 3.5 Scenario 5: Interactive 1-Click CRM & Database Pushes
- **Goal:** Verify that 1-click pushes to HubSpot, Notion, Airtable, Zapier, and Slack execute reliably from the UI.
- **Test:** Log in as a paid user (`Select` or above), select extractions on `/dashboard` or `/preview`, and click each option in the **Push** menu. Verify the green success toasts and check records in the destination apps.

---

### 3.6 Scenario 6: Third-Party Plan Gating Enforcement (Free/Go vs Select/Pro)
- **Goal:** Ensure Free and Go tier users cannot push to third-party integrations, while Select, Pro, Business, Agency, and Developer users have full access.
- **Test:**
  - As a Free tier user: Attempt to push or connect an integration.
  - Expected: UI displays plan upgrade modal/toast: `Integrations are available on the Select plan and above.`
  - Direct API call returns `403 Forbidden` (`plan_not_entitled`).

---

### 3.7 Scenario 7: Admin Automation Portal & Mode Controls (`/admin/automation`)
- **Goal:** Verify administrative observability and dynamic pipeline mode controls.
- **Steps:**
  1. Navigate to `/admin/automation` in your browser.
  2. In the **Pipeline Execution & Cloud Run Scheduler** card:
     - Toggle between **Event-Driven**, **Scheduled Polling (1h, 6h, 12h, 24h)**, and **Paused**.
     - Click **Save Configuration** and verify the live status badge.
  3. Click **"Run now"** in the top header to manually flush pending queues.
  4. Inspect the **Recent events** table, click any row to open the inspector drawer, and test **Retry** / **Dispatch now** / **Cancel**.

---

### 3.8 Scenario 8: MCP Operations Tools Execution
- **Goal:** Verify that AI assistants (Claude Desktop / Cursor) can manage workflows via Model Context Protocol.
- **Verification Command:**
  ```bash
  curl -X POST "https://n8n-dev-692109205619.asia-south1.run.app/mcp/datiq_list_pending_workflows" \
    -H "Authorization: Bearer $DATIQ_N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{ "state": "pending", "limit": 10 }'
  ```

---

### 3.9 Scenario 9: Automated Pipeline Test Runner (`npm run test:workflow`)
- **Goal:** Execute the complete 5-stage lifecycle simulation locally or against live Supabase.
- **Command:**
  ```bash
  npm run test:workflow
  ```

---

## 4. Diagnostic SQL Queries & Verification Matrix

Run these queries in the **Supabase Dashboard → SQL Editor**:

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
  r.attempt_n, 
  r.channel, 
  r.response_status, 
  r.duration_ms, 
  r.started_at, 
  r.finished_at, 
  r.error 
FROM workflow_runs r 
ORDER BY r.started_at DESC 
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

---

## 5. Troubleshooting & Known Edge Cases

### 5.1 Netlify Edge Access SSO Redirect (`<title>Login Redirect</title>`)
- **Symptom:** Running `curl` against draft/preview endpoints returns an HTML page containing `<title>Login Redirect</title>`.
- **Cause:** Netlify branch previews and draft deploys enable Edge Access (Team SSO) by default.
- **Remedy:** Add `/.netlify/functions/*` and `/api/*` to your Netlify Edge Access bypass rules or run tests against the custom domain.

### 5.2 Admin Automation Unauthorized (`401 Unauthorized`)
- **Symptom:** Admin page `/admin/automation` displays an error banner saying "unauthorized".
- **Cause:** Admin session token expired (8h TTL).
- **Remedy:** Click **"Re-enter PIN"** inside the red error banner or click **"Exit admin"** to log in with your Admin PIN (`ADMIN123`).

### 5.3 Notion 404 Object Not Found
- **Symptom:** Pushing to Notion returns `Could not find database with ID: ...`.
- **Cause:** The Notion database was not shared with your internal integration.
- **Remedy:** Open the database in Notion → Click `...` in top right → **Connections** → Add your `DatIQ Notion Two-Way Sync` integration.

### 5.4 Double-Protocol URL in n8n (`getaddrinfo EAI_AGAIN https`)
- **Symptom:** n8n logs `getaddrinfo EAI_AGAIN https`.
- **Cause:** `$env.SITE_URL` contains `https://` and the HTTP node URL expression prepended `https://` again.
- **Remedy:** Use sanitized URL expression:
  ```javascript
  {{ (($env.SITE_URL ? ($env.SITE_URL.startsWith('http') ? $env.SITE_URL : 'https://' + $env.SITE_URL) : 'https://datiq.app').replace(/\/+$/, '')) + '/api/workflow-orchestrator/ping' }}
  ```
