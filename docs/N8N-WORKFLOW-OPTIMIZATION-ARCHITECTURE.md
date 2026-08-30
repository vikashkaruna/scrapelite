# DatIQ — n8n Workflow Optimization & Event-Driven Architecture Guide

> **Status:** Production & Staging Architecture Reference  
> **Target Environment:** GCP Cloud Run (Serverless n8n) + Netlify Functions (DatIQ Core) + Supabase  
> **Key Architecture Milestone:** Event-Driven Webhooks with Scale-to-Zero & Admin Dynamic Scheduler Control (Option 1)

---

## 1. Executive Summary & Principles

DatIQ employs a hybrid serverless architecture:
1. **DatIQ Core (Netlify Functions + Static SPA):** Edge-deployed React frontend and serverless API endpoints.
2. **Automation & Orchestration Layer (GCP Cloud Run):** Containerized n8n workflow execution engine.
3. **Persistence Layer (Supabase PostgreSQL):** Storage for `workflow_events`, `workflow_runs`, `scheduled_tasks`, and `app_config`.

### Core Architectural Axiom: **Zero-Waste Serverless & Scale-to-Zero**
- **No Continuous Background Pinging:** Idle 5-minute polling loops across services are eliminated.
- **Event-Driven Push:** DatIQ directly triggers n8n webhooks (`POST /webhook/datiq/...`) *only* when a business event occurs (e.g. page extraction finished, contact discovered, notification triggered).
- **Scale-to-Zero ($0.00 Idle Cost):** When no customer actions or automations are executing, GCP Cloud Run scales the n8n container down to **0 active instances**.
- **Admin Master Gating:** Administrators have real-time control from `/admin/automation` to toggle between **Event-Driven**, **Periodic Scheduled**, or **Paused (Manual Only)** modes.

---

## 2. The 3 Pipeline Operational Modes

Configuration is stored in Supabase table `app_config` under key `automation_pipeline` and managed live via the `/admin/automation` portal.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PIPELINE OPERATIONAL MODES                                  │
├──────────────────────────┬────────────────────────────┬─────────────────────────────────────┤
│ Mode 1: Event-Driven     │ Mode 2: Scheduled Polling  │ Mode 3: Paused                      │
│ (RECOMMENDED / DEFAULT)  │                            │ (Manual / Non-Prod Isolation)       │
├──────────────────────────┼────────────────────────────┼─────────────────────────────────────┤
│ • Dispatches webhooks on │ • Evaluates queue on       │ • Suspends all scheduled runs       │
│   live customer actions  │   configured cadence       │ • Events queue safely in DB         │
│ • No background polling  │ • 1h / 6h / 12h / 24h      │ • Processed only when Admin clicks  │
│ • Cloud Run scales to 0  │ • Ideal for high-volume    │   "Run now" or "Dispatch now"       │
│ • $0 compute while idle  │   bulk processing          │ • Maximum non-prod isolation        │
└──────────────────────────┴────────────────────────────┴─────────────────────────────────────┘
```

### Mode Comparison Matrix

| Property | Event-Driven (Mode 1) | Scheduled Polling (Mode 2) | Paused (Mode 3) |
|---|---|---|---|
| **Dispatch Mechanism** | Direct HTTP Webhook Push | Cron Queue Evaluation | Manual UI Trigger |
| **Idle Cloud Run State** | 0 instances (Scale to Zero) | 0 instances between runs | 0 instances (Always asleep) |
| **Delivery Latency** | ~1.5s – 2.5s (Cold Start) | 0 to N minutes (Batch window) | On-Demand |
| **Estimated Idle Cost** | $0.00 / month | < $0.50 / month | $0.00 / month |
| **Use Case** | Production & Staging standard | High-throughput batching | Maintenance, Debugging, Dev |

---

## 3. n8n Workflow Catalog & Trigger Taxonomy (17 Workflows)

All 17 workflows in `n8n/workflows/` are structured according to their trigger role:

### Category A: Automation Workflows (5 Workflows — Event-Driven)
These workflows start with a **Webhook Trigger Node** and run exclusively when DatIQ emits an event:
1. `datiq_schedule_changed_router.json` → `/webhook/datiq/schedule-changed`
2. `datiq_contact_router.json` → `/webhook/datiq/contact-received`
3. `datiq_user_lifecycle.json` → `/webhook/datiq/user-event`
4. `datiq_failure_alert.json` → `/webhook/datiq/op-event`
5. `datiq_process_pending_workflow.json` → `/webhook/datiq/process-pending`

### Category B: On-Demand MCP Tools (10 Workflows)
Triggered on-demand by AI / MCP clients:
- `datiq_list_pending_workflows.json`, `datiq_retry_workflow.json`, `datiq_cancel_workflow.json`, `datiq_diagnose_pending_workflow.json`, `datiq_list_schedules.json`, `datiq_get_schedule.json`, `datiq_create_schedule.json`, `datiq_update_schedule.json`, `datiq_pause_schedule.json`, `datiq_delete_schedule.json`.

### Category C: Diagnostic & Batch Utilities (2 Workflows)
- `00-datiq-smoke-test.json`: Kept with `active: false`. Manual-only on-demand connectivity test for engineers.
- `datiq_daily_digest.json`: Kept with `active: false` (or scheduled daily if digest emails are desired).

---

## 4. GCP Cloud Run Configuration for Scale-to-Zero

To ensure your GCP Cloud Run service scales down to 0 instances and never incurs idle charges:

```bash
gcloud run services update n8n-dev \
  --region=asia-south1 \
  --min-instances=0 \
  --max-instances=2 \
  --cpu-throttling \
  --concurrency=80 \
  --memory=1Gi \
  --cpu=1
```

### Key Parameters:
- `--min-instances=0`: Instructs Cloud Run to shut down all instances when no incoming HTTP requests arrive for ~15 minutes.
- `--cpu-throttling`: Allocates CPU only during request processing.
- `--max-instances=2`: Caps compute spend to prevent runaways.

---

## 5. Admin Control Runbook (`/admin/automation`)

### 1. Changing the Pipeline Execution Mode
1. Log in to `/admin` using your Admin PIN.
2. Navigate to **Automation** in the sidebar.
3. In the **Pipeline Execution & Cloud Run Scheduler** card:
   - Select **Event-Driven (Real-Time Push)** for standard zero-cost operation.
   - Or select **Scheduled Polling** and pick a cadence (e.g. Every 6 Hours).
   - Or select **Paused** during database migrations or maintenance.
4. Click **Save Configuration**. The banner will confirm: `"Pipeline mode updated to Event-Driven (Scale-to-Zero)."`.

### 2. Manually Triggering Queue Processing ("Run Now")
- Click **"Run now"** in the top-right header of `/admin/automation`.
- The Netlify orchestrator will execute a single pass over `workflow_events`, claim pending items, push them to n8n, and refresh the dashboard.

### 3. Retrying or Cancelling Specific Failed Events
1. In the **Recent events** table, click on any failed event row.
2. The **Event Detail** drawer will open on the right.
3. Click:
   - **Retry:** Resets attempt counter to 0 and marks status `pending`.
   - **Dispatch now:** Immediately claims and pushes the event to n8n synchronously.
   - **Cancel:** Aborts the event and marks status `cancelled`.

---

## 6. Troubleshooting & Common Pitfalls

### Issue 1: `getaddrinfo EAI_AGAIN https`
- **Cause:** Double protocol prefix in n8n HTTP node URL (e.g. `https://https://datiq.app/...`). Node.js interprets `https` as the hostname.
- **Fix:** In n8n node URL, use:
  ```javascript
  {{ (($env.SITE_URL ? ($env.SITE_URL.startsWith('http') ? $env.SITE_URL : 'https://' + $env.SITE_URL) : 'https://datiq.app').replace(/\/+$/, '')) + '/api/workflow-orchestrator/ping' }}
  ```

### Issue 2: Netlify Edge Access SSO Redirect (302 Login Page) in Preview
- **Cause:** Netlify branch deploy previews (e.g. `6a94059...--datiqapp.netlify.app`) protect all routes with Netlify Edge Access SSO by default.
- **Fix:** In Netlify Dashboard › Site settings › Edge Access, add `/api/*` and `/.netlify/functions/*` to the **Bypass Paths** list, or test against the custom domain / production deployment.

### Issue 3: Cold Start Delay on Cloud Run
- **Observation:** The first event after 30+ minutes of idle takes ~2 seconds to complete.
- **Normal Behavior:** Cloud Run is provisioning a container from 0. Subsequent requests within the next 15 minutes execute in < 150ms.
