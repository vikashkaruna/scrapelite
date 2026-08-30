# DatIQ — Feature Architecture, Impact Analysis & n8n Workflow Implementation Plan

> **Document Type:** Master Feature Architecture, Impact Analysis & Orchestration Reference  
> **Target Branch:** `workflow-implementation-and-optimization`  
> **Status:** Implemented & Verified on `workflow-implementation-and-optimization`  
> **Guiding Principle:** Enhance and decouple without altering or regressing existing, fully-functional features.

---

## Table of Contents
1. [Executive Summary & Impact Matrix](#1-executive-summary--impact-matrix)
2. [Deep Architectural Analysis & Strategic Recommendations](#2-deep-architectural-analysis--strategic-recommendations)
   - 2.1 [Fallback Mechanisms for All Modified Features (Zero Downtime / Zero Dropped Events)](#21-fallback-mechanisms-for-all-modified-features-zero-downtime--zero-dropped-events)
   - 2.2 [Decoupling n8n from Supabase: The "Server Callback API" Architecture](#22-decoupling-n8n-from-supabase-the-server-callback-api-architecture)
   - 2.3 [Environment Separation Strategy: Dev/Staging vs Production n8n Instances](#23-environment-separation-strategy-devstaging-vs-production-n8n-instances)
   - 2.4 [Step-by-Step UI Guide: Creating & Binding Credentials in n8n Dashboard](#24-step-by-step-ui-guide-creating--binding-credentials-in-n8n-dashboard)
   - 2.5 [Third-Party Integration Mapping & Strict Multi-Tenant Isolation](#25-third-party-integration-mapping--strict-multi-tenant-isolation)
   - 2.6 [Platform-Agnostic Self-Hosted n8n Deployment Architectures](#26-platform-agnostic-self-hosted-n8n-deployment-architectures)
   - 2.7 [Consolidated Master Operations Guide (Deploy, Backups, Upgrades, Secrets)](#27-consolidated-master-operations-guide-deploy-backups-upgrades-secrets)
   - 2.8 [Zero-Hardcoding 3-Tier Parameter Abstraction Model](#28-zero-hardcoding-3-tier-parameter-abstraction-model)
3. [Comprehensive Feature Catalog: Existing vs Modified vs New](#3-comprehensive-feature-catalog-existing-vs-modified-vs-new)
   - 3.1 [Existing Untouched Functional Areas](#31-existing-untouched-functional-areas)
   - 3.2 [Modified & Enhanced Features](#32-modified--enhanced-features)
   - 3.3 [Newly Built Functionalities](#33-newly-built-functionalities)
4. [End-to-End Logical Flows & Sequence Diagrams](#4-end-to-end-logical-flows--sequence-diagrams)
5. [Cross-Reference Directory to Subordinate Documentation](#5-cross-reference-directory-to-subordinate-documentation)

---

## 1. Executive Summary & Impact Matrix

The `workflow-implementation-and-optimization` branch introduces an asynchronous orchestration pipeline while strictly preserving all existing, fully-tested customer features:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DATIQ PLATFORM SCOPE                                      │
├──────────────────────────────┬──────────────────────────────┬───────────────────────────────┤
│    EXISTING & PRESERVED      │     MODIFIED & ENHANCED      │          NEWLY BUILT          │
│   (No Functional Changes)    │   (Additive / Backwards-OK)  │      (Enterprise Engine)      │
├──────────────────────────────┼──────────────────────────────┼───────────────────────────────┤
│ • Single-URL & Map Scraping  │ • Scheduled Alert Delivery   │ • Asynchronous Event Bus      │
│ • Custom Schema Extraction   │   (Queue + Direct Fallback)  │   (`workflow_events` queue)   │
│ • 5 Quick Enrichment Tabs    │ • Account Settings UI        │ • Orchestrator Polling Daemon │
│ • Batch Extraction & Retry   │   (Added Integrations Tab)   │ • HMAC Replay Protection      │
│ • Dashboard & Visualizations │ • Push Integrations Menu     │ • 17 Environment n8n Flows    │
│ • CSV/PDF/MD/JSON Exports    │   (Direct 1-click Push)      │ • 11 MCP Operations Tools     │
│ • Discoverability GEO/AEO    │ • Integrations Directory     │ • Admin Automation Portal     │
│ • Auth, Billing & Lifecycle  │   (Honest Status Badges)     │   (`/admin/automation`)       │
│ • Team Workspaces & Seats    │ • Admin Navigation           │ • Platform-Agnostic Docker/K8s│
└──────────────────────────────┴──────────────────────────────┴───────────────────────────────┘
```

---

## 2. Deep Architectural Analysis & Strategic Recommendations

### 2.1 Fallback Mechanisms for All Modified Features (Zero Downtime / Zero Dropped Events)

> [!IMPORTANT]
> **Safety Guarantee: Immediate Fallback + Strict Duplicate Suppression.**  
> If n8n or the event orchestrator is unconfigured, unreachable, or experiencing downtime, every modified component will automatically execute its direct native fallback.

```
              SCHEDULED RUNNER DETECTION & DEDUPLICATION FLOW

               [ scheduled-runner.js (Hourly Cron) ]
                                 │
                                 ▼
                     [ Scrape & Fingerprint ]
                                 │
                     ┌───────────┴───────────┐
                     │ Content Changed?      │
                     └───────────┬───────────┘
                                 │ Yes
                                 ▼
                 [ Check `lastHash !== newHash` ]
                                 │
                     ┌───────────┴───────────┐
                     │ Is N8N Pipeline Live? │
                     └───────────┬───────────┘
                    Yes ┌────────┴────────┐ No (Fallback)
                        ▼                 ▼
          ┌───────────────────┐     ┌──────────────────────┐
          │ Enqueue into      │     │ Send Direct via      │
          │ `workflow_events` │     │ Resend Email / Slack │
          └─────────┬─────────┘     └──────────┬───────────┘
                    │                          │
                    └────────────┬─────────────┘
                                 ▼
                 [ Update DB State in Transaction ]
                 • `lastHash = newHash`
                 • `lastStatus = 'changed'`
                 • `lastChangeAt = now()`
                 • `lastRunAt = now()`
                                 │
                                 ▼
                 [ Next Run: Hashes Match → UNCHANGED ]
                 (Guarantees Zero Duplicate Notifications)
```

#### Feature-by-Feature Fallback Verification:
1. **Scheduled Task Change Alerts (`scheduled-runner.js`)**:
   - **Primary Route**: `enqueue({ kind: "schedule.changed", payload, _ctx })` writes to `workflow_events`.
   - **Fallback Route**: If `!process.env.N8N_BASE_URL` or if `enqueue()` fails, the runner calls `sendDirectEmail()` (Resend) and `postToSlack()` directly.
   - **Deduplication Locking**: In both primary and fallback paths, `lastHash = newHash` is immediately committed to `scheduled_tasks.data`. On the next hourly run, the comparison `newHash === schedule.lastHash` evaluates to `unchanged`, guaranteeing zero duplicate alerts.
2. **Contact Form Inquiries (`contact-email.js`)**:
   - **Primary Route**: Directly sends email via Resend API.
   - **Queue Enhancements**: Can enqueue to `workflow_events` with an automatic fallback to immediate direct send if the queue is unavailable.
3. **Interactive Third-Party CRM Pushes (`integrations-*.js`)**:
   - Executed **100% directly** by Netlify Serverless Functions without routing through n8n, ensuring instant interactive feedback and zero external dependency.

---

### 2.2 Decoupling n8n from Supabase: The "Server Callback API" Architecture

> [!TIP]
> **Decoupling Guarantee: Zero Database Credentials in n8n via the Server Callback API.**

#### The Architecture:
Instead of n8n writing directly to Supabase PostgREST with a master `service_role` key, n8n simply calls back to the dedicated DatIQ endpoint (`POST /api/workflow-callback`):

```
               SERVER CALLBACK ARCHITECTURE

 ┌───────────────────────────┐                 ┌───────────────────────────┐
 │       DATIQ SERVER        │                 │        n8n INSTANCE       │
 │   (Netlify Functions)     │                 │   (Orchestration Engine)  │
 └─────────────┬─────────────┘                 └─────────────┬─────────────┘
               │                                             │
               │ 1. Dispatch Event                           │
               │    Payload includes:                        │
               │    `_ctx.callback_url` & `event_id`         │
               ├────────────────────────────────────────────►│
               │    (Signed with HMAC-SHA256)                │
               │                                             │ 2. Execute Automation
               │                                             │    (Format Resend Email,
               │                                             │     Post to Slack, etc.)
               │                                             │
               │ 3. POST /api/workflow-callback              │
               │    Body: { event_id, state: "done" }        │
               │    Header: X-DatIQ-Signature                │
               │◄────────────────────────────────────────────┤
               │                                             │
 ┌─────────────┴─────────────┐                               │
 │ 4. Update Database:       │                               │
 │    Netlify uses ITS OWN   │                               │
 │    environment-scoped     │                               │
 │    SUPABASE_SERVICE_KEY   │                               │
 │    to update `events` row │                               │
 └───────────────────────────┘                               └─────────────────────────────┘
```

#### Why This Is the Recommended Approach:
1. **Zero Database Keys in n8n**: n8n **never** needs a Supabase `service_role` key (`datiq-supabase-service` is not required). It only uses the shared webhook HMAC secret (`N8N_WEBHOOK_SECRET`).
2. **Universal Environment Compatibility**: Because `_ctx.callback_url` points to the originating deployment (e.g. `staging--datiqapp.netlify.app` vs `datiq.app`), each environment handles its own database writes using its own local environment variables.
3. **Total Schema Decoupling**: Database schema alterations or migrations are encapsulated entirely within DatIQ server code.

---

### 2.3 Environment Separation Strategy: Dev/Staging vs Production n8n Instances

When planning post-deployment workflow updates and continuous development, here is the approved 2-phase strategy:

| Phase | Architecture | Key Characteristics |
|---|---|---|
| **Phase 1: Initial Launch (Current)** | Single n8n instance at `https://n8n-dev-692109205619.asia-south1.run.app` with Server Callback API | Lowest cost, zero database credentials in n8n, environment-isolated routing via `_ctx.callback_url`. |
| **Phase 2: Scale & Team** | Dedicated `staging-n8n` + `prod-n8n` | **100% Isolated**. Staging experiments never touch production queues. Workflows are tested on Staging and imported to Production via Git. |

---

### 2.4 Step-by-Step UI Guide: Creating & Binding Credentials in n8n Dashboard

When setting up or verifying credentials in the n8n web dashboard (`https://n8n-dev-692109205619.asia-south1.run.app/`):

#### Step 1: Create `datiq-resend` (For Outbound Notification Emails)
1. In the n8n sidebar, navigate to **Credentials** -> Click **Add Credential** (top right).
2. In the search box, type **Header Auth** (or **HTTP Header Auth**) and select it.
3. Configure the fields:
   - **Credential Name** *(top title field)*: `datiq-resend` *(must match this exact name)*.
   - **Name** *(Header Name)*: `Authorization`
   - **Value** *(Header Value)*: `Bearer re_xxxxxxxxxxxxxxxxxxxx` *(your Resend API Key)*.
4. Click **Save**.

#### Step 2: Create `datiq-slack-monitoring` (For Slack Ops & Change Alerts)
1. In **Credentials**, click **Add Credential**.
2. Select either **Slack OAuth2 API** (recommended) or **Header Auth**:
   - **Option A (Slack OAuth2 API - Recommended)**:
     - Select **Slack OAuth2 API**, name it `datiq-slack-monitoring`, click **Connect with Slack**, and authorize the `#monitoring` channel.
   - **Option B (Header Auth with Bot Token)**:
     - Select **Header Auth**, name it `datiq-slack-monitoring`, set **Name**: `Authorization`, and **Value**: `Bearer xoxb-...` *(Slack Bot Token)*.
3. Click **Save**.

#### Note on `datiq-supabase-service`:
> [!NOTE]
> With the Server Callback API active, **`datiq-supabase-service` is no longer required in n8n**. All database persistence is handled server-side by DatIQ.

---

### 2.5 Third-Party Integration Mapping & Strict Multi-Tenant Isolation

> [!IMPORTANT]
> **Isolation Verdict: 100% User-Isolated and Tenant-Safe.**  
> Third-party integrations (HubSpot, Notion, Airtable, Slack, Zapier) are strictly scoped per `user_id`. One user can never see, access, or push to another user's CRM or database.

```
                     USER-SPECIFIC INTEGRATION ISOLATION FLOW

 [ User A (Browser) ]                        [ User B (Browser) ]
         │                                           │
         │ (JWT: User A)                             │ (JWT: User B)
         ▼                                           ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   NETLIFY FUNCTIONS / API GATEWAY                     │
 │  • Authenticates caller via `authenticateBearer(event)`                │
 │  • Extracts `auth.uid()` from signed JWT token                         │
 └───────────────────┬───────────────────────────────────┬────────────────┘
                     │                                   │
                     ▼                                   ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                 SUPABASE `integration_connections`                     │
 │  • RLS Policy: `auth.uid() = user_id`                                 │
 │  • UNIQUE constraint: `(user_id, provider)`                            │
 ├───────────────────────────────────┬────────────────────────────────────┤
 │ Row A: `user_id_A`                │ Row B: `user_id_B`                 │
 │ • Provider: 'hubspot'             │ • Provider: 'hubspot'              │
 │ • Token: `pat-na1-userA-secret`   │ • Token: `pat-na1-userB-secret`    │
 └───────────────────┬───────────────┴───────────────────┬────────────────┘
                     │                                   │
                     ▼                                   ▼
           [ User A's HubSpot CRM ]            [ User B's HubSpot CRM ]
```

---

### 2.6 Platform-Agnostic Self-Hosted n8n Deployment Architectures

The self-hosted n8n infrastructure runs across any modern deployment target:
1. **Google Cloud Platform (Cloud Run)**: Serverless container deployed at `https://n8n-dev-692109205619.asia-south1.run.app`.
2. **Generic VM / VPS** (Docker Compose + Caddy SSL).
3. **AWS (ECS Fargate + RDS PostgreSQL)**.
4. **Kubernetes (EKS / GKE / AKS)**.

---

### 2.7 Consolidated Master Operations Guide (Deploy, Backups, Upgrades, Secrets)

- **Import Workflows**: `npx n8n import:workflow --input=n8n/workflows/`
- **Daily Backup**: Automated backup script `/opt/datiq-n8n/backup.sh` (retains 14 days).
- **Disaster Restore**: `./restore.sh <tarball-path>`.
- **Upgrades**: Run backup → update container image → restart.

---

### 2.8 Zero-Hardcoding 3-Tier Parameter Abstraction Model

1. **Tier 1: Per-Event Runtime Context (`$json._ctx.*`)**: Injected on every event from Netlify (`supabase_url`, `site_url`, `callback_url`, `env`, `branch`).
2. **Tier 2: Host Environment (`$env.*`)**: `N8N_BASE_URL`, `WEBHOOK_URL`, `GENERIC_TIMEZONE`.
3. **Tier 3: Static Credential Handles (`$credentials.*`)**: `datiq-resend`, `datiq-slack-monitoring`.

---

## 3. Comprehensive Feature Catalog: Existing vs Modified vs New

### 3.1 Existing Untouched Functional Areas
- **Single URL Scrape** (`src/pages/Home.jsx`, `netlify/functions/extract.js`)
- **Custom Schema Extraction** (`src/lib/firecrawlService.js`, `src/lib/aiService.js`)
- **5 Quick Enrichment Tabs** (`src/pages/Preview.jsx`, `src/lib/enrichmentStore.js`)
- **Batch Multi-URL Extraction** (`src/pages/Batch.jsx`, `src/lib/batchService.js`)
- **Dashboard & Export Engine** (`src/pages/Dashboard.jsx`, `src/lib/exportBranding.js`)
- **GEO / AEO Discoverability** (`src/pages/Discoverability.jsx`, `discoverability.js`)
- **Auth, Billing & Danger Zone** (`AuthProvider.jsx`, `BillingProvider.jsx`, `DangerZone.jsx`)
- **Team Workspaces** (`src/pages/Workspaces.jsx`, `workspaceContext.js`)

### 3.2 Modified & Enhanced Features
- **Scheduled Alert Dispatch**: Enqueues to `workflow_events` + maintains direct fallback if n8n absent.
- **Account Settings**: Added 5th tab: **Integrations** (`src/pages/Account.jsx`).
- **Preview & Dashboard Actions**: Added **"Push" dropdown** (`PushIntegrationMenu.jsx`).
- **Integrations Directory**: Honest status badges ("Available (Beta)", "Coming Soon", "Roadmap").
- **Admin Layout**: Added **"Workflows"** tab (`/admin/automation`).

### 3.3 Newly Built Functionalities
- **`workflow_events` Queue**: PostgreSQL event bus (`supabase/migrations/0018_workflow_events.sql`).
- **Server Callback API**: Callback receiver (`netlify/functions/workflow-callback.js`).
- **Workflow Orchestrator**: 5-min polling daemon & `/run-now` HTTP dispatcher (`netlify/functions/workflow-orchestrator.js`).
- **HMAC Signature Engine**: SHA-256 HMAC generator & validator (`netlify/functions/lib/n8nSignature.js`).
- **17 Production Workflows**: Automation routers + MCP Tools (`n8n/workflows/*.json`).
- **Admin Automation UI**: Observability portal (`src/pages/admin/AdminAutomation.jsx`).

---

## 4. Cross-Reference Directory to Subordinate Documentation

1. **Active Session Handoff**: [`docs/sessions/SESSION-HANDOFF-2026-08-30-WORKFLOW-OPTIMIZATION-AND-CALLBACK-API.md`](./sessions/SESSION-HANDOFF-2026-08-30-WORKFLOW-OPTIMIZATION-AND-CALLBACK-API.md)
2. **Master Consolidated History Archive**: [`docs/sessions/SESSIONS-HISTORY.md`](./sessions/SESSIONS-HISTORY.md)
3. **17 n8n Workflows Specification**: [`docs/N8N-WORKFLOWS.md`](./N8N-WORKFLOWS.md)
4. **Model Context Protocol (MCP) Tools Reference**: [`docs/MCP-TOOLS.md`](./MCP-TOOLS.md)
5. **Database Migration Runbook**: [`docs/DB-MIGRATION-RUNBOOK.md`](./DB-MIGRATION-RUNBOOK.md)
