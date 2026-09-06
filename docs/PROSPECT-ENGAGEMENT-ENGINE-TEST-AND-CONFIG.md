# DatIQ Prospect Engagement Engine — Deployment, Configuration & Testing Guide

> **Module**: Prospect Engagement Engine (Autonomous Multi-Channel Outreach, AI Copy Generation, Human-in-the-Loop Review, and Two-Way CRM Sync)  
> **Branch**: `feat/prospect-engagement-engine`  
> **Target Release**: DatIQ v2.0+ Platform  
> **Last Updated**: 2026-09-06  

---

## 1. Executive Summary & Architecture Overview

The **Prospect Engagement Engine** transforms DatIQ from a passive web extraction tool into an active, multi-channel growth engine. It automates outreach workflows across **Email (Resend)**, **WhatsApp (Twilio)**, **SMS (Twilio)**, and **Telegram Bot**, governed by strict **Brand Kit tone controls**, a **Human-in-the-Loop approval queue**, and automated **inbound webhook feedback loops**.

```
                           ┌──────────────────────────────────────────────┐
                           │          DatIQ Web Ingestion Surface         │
                           │  /preview · /dashboard · /engagement · CSV   │
                           └──────────────────────┬───────────────────────┘
                                                  │ (Ingest & Deduplicate)
                                                  ▼
                                ┌───────────────────────────────────┐
                                │     Prospect Engagement Engine    │
                                │   State Machine & Deduplication   │
                                └─────────────────┬─────────────────┘
                                                  │
                ┌─────────────────────────────────┴─────────────────────────────────┐
                ▼                                                                   ▼
┌───────────────────────────────┐                                   ┌───────────────────────────────┐
│     AI Message Generator      │                                   │     Brand Kit & Guardrails    │
│ (Claude Haiku / Persona Copy) │                                   │ (Voice, Tone, Forbidden Words)│
└───────────────┬───────────────┘                                   └───────────────┬───────────────┘
                │                                                                   │
                └─────────────────────────────────┬─────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │     Human-in-the-Loop Queue       │
                                │     (Review, Edit, Approve)       │
                                └─────────────────┬─────────────────┘
                                                  │ (Approved)
                                                  ▼
                                ┌───────────────────────────────────┐
                                │      Multi-Channel Dispatcher     │
                                │ Resend · Twilio · Telegram · CRMs │
                                └─────────────────┬─────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │      Inbound Webhook Engine       │
                                │ Replies · Clicks · STOP / Opt-Out │
                                └───────────────────────────────────┘
```

---

## 2. Infrastructure & Environment Configuration

### 2.1 Database Migration (Supabase)

To enable live persistent storage and multi-seat sync, execute migration `0048_prospect_engagement_engine.sql` in your Supabase SQL editor:

File: [`supabase/migrations/0048_prospect_engagement_engine.sql`](file:///Users/vikash/Extracta/supabase/migrations/0048_prospect_engagement_engine.sql)

#### Tables Created:
1. `public.engagement_brand_kits`: Brand tone, voice guidelines, persona parameters, forbidden words, compliance footers.
2. `public.prospect_engagements`: Master prospect records, channels, lead scores, stages (`new`, `enriched`, `drafted`, `review_pending`, `approved`, `queued`, `sent`, `delivered`, `opened`, `clicked`, `replied`, `converted`, `stale`, `opted_out`).
3. `public.engagement_messages`: Multi-channel copy (Email subject/body, WhatsApp/SMS text, Telegram payload), review status, dispatch logs.
4. `public.engagement_activities`: Immutable audit trail for every stage change, message generation, approval, dispatch, reply, and opt-out.
5. `public.engagement_sync_logs`: Bidirectional synchronization audit logs for Google Sheets, Airtable, and CRMs.

#### Applying the Migration:
```bash
# Option A: Via Supabase Dashboard
# Navigate to: https://app.supabase.com/project/<project-ref>/sql
# Copy and paste the contents of supabase/migrations/0048_prospect_engagement_engine.sql and click Run.

# Option B: Via DatIQ migration script
npm run migrate:prod
```

> **Security Note**: RLS is strictly enforced. Client anonymous keys have zero direct table access. All reads/writes route through Netlify functions (`/api/engagement/engine` and `/api/engagement/webhook`) using the `SUPABASE_SERVICE_ROLE_KEY` with authenticated user context or HMAC signatures.

---

### 2.2 Netlify Environment Variables Configuration

Set the following environment variables in your Netlify site settings (**Site Settings > Environment Variables**):

| Variable Name | Required? | Purpose | Example Value |
|---|---|---|---|
| `SUPABASE_URL` | **Yes** | Supabase Project REST URL | `https://xyzproject.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Service role key for backend DB operations | `eyJhbGciOi...` |
| `RESEND_API_KEY` | Optional | Native email dispatch provider | `re_abc123...` |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account for SMS and WhatsApp | `ACXXXXXXXXXXXXXXXX` |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio auth token | `auth_token_xyz` |
| `TWILIO_PHONE_NUMBER` | Optional | Twilio SMS sender / WhatsApp sandbox number | `+14155238886` |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram Bot API token for direct messaging | `123456789:ABCdef...` |
| `ENGAGEMENT_WEBHOOK_SECRET`| Optional | Secret for verifying inbound webhook payloads | `datiq-engagement-webhook-secret` |
| `VITE_ENGAGEMENT_API_URL` | Optional | Custom proxy endpoint (defaults to `/api/engagement`) | `/api/engagement` |

> **Graceful Degradation**: If third-party credentials (`RESEND_API_KEY`, `TWILIO_*`, `TELEGRAM_*`) are omitted, the engine automatically enters **Dry-Run Simulation Mode**: message logs, state transitions, activities, and payloads are generated and recorded with mock delivery IDs (`mock_resend_...`, `mock_twilio_...`).

---

### 2.3 Netlify Edge Access Bypass

If your Netlify site has Edge Access (SSO / Basic Auth gating) enabled, configure the following path bypass in Netlify:
- **Bypass Path**: `/api/engagement/*`
- **Reason**: Allows inbound webhooks from Resend, Twilio, and n8n background workers to reach the Netlify functions without being stopped by the SSO login gate.

---

### 2.4 n8n Workflow Configuration

The engine includes 5 production-ready n8n workflow templates located in `n8n/workflows/`:

1. [`n8n/workflows/datiq_prospect_engagement_engine.json`](file:///Users/vikash/Extracta/n8n/workflows/datiq_prospect_engagement_engine.json)  
   *Lead Ingest & AI Multi-Channel Router*
2. [`n8n/workflows/datiq_human_in_the_loop_approval.json`](file:///Users/vikash/Extracta/n8n/workflows/datiq_human_in_the_loop_approval.json)  
   *Approval Gate & Review Pipeline*
3. [`n8n/workflows/datiq_multi_channel_dispatcher.json`](file:///Users/vikash/Extracta/n8n/workflows/datiq_multi_channel_dispatcher.json)  
   *Multi-Channel Dispatcher (Email, WhatsApp, SMS, Telegram)*
4. [`n8n/workflows/datiq_inbound_engagement_webhook.json`](file:///Users/vikash/Extracta/n8n/workflows/datiq_inbound_engagement_webhook.json)  
   *Inbound Webhook Receiver (Replies, Clicks, STOP Opt-out)*
5. [`n8n/workflows/datiq_stale_prospect_monitor.json`](file:///Users/vikash/Extracta/n8n/workflows/datiq_stale_prospect_monitor.json)  
   *Scheduled Stale Prospect SLA Monitor (Runs every 6 hours)*

#### Importing Workflows into n8n:
1. In the n8n UI, navigate to **Workflows > Add Workflow > Import from File**.
2. Select each JSON file in `n8n/workflows/`.
3. Configure or assign the credentials:
   - **`datiq-supabase`**: Supabase REST API credentials.
   - **`datiq-resend`**: Resend API Header Auth (`Authorization: Bearer re_...`).
   - **`datiq-twilio`**: Twilio Basic Auth (Account SID + Auth Token).
   - **`datiq-telegram`**: Telegram Bot Token.
4. Set workflow variables:
   - `DATIQ_BASE_URL`: `https://datiq.app` (or your staging/preview domain).
   - `ENGAGEMENT_SECRET`: Must match `ENGAGEMENT_WEBHOOK_SECRET` in Netlify.
5. Activate each workflow toggle to **Active**.

---

## 3. End-to-End Manual Testing Walkthrough

Open your deployed preview or local dev instance (`http://localhost:5173/engagement`). Follow the 8 test scenarios below.

---

### Test Scenario 1: Brand Kit Configuration & Guardrails

**Goal**: Configure tone, voice, and compliance guardrails that govern AI message generation.

1. Navigate to **`/engagement`** and click the **"Brand Kit & Tone"** tab.
2. Enter the following test parameters:
   - **Brand Name**: `DatIQ Growth Labs`
   - **Tone of Voice**: Select `Consultative`
   - **Value Proposition**: `AI-powered intelligence and autonomous data enrichment for modern B2B teams.`
   - **Forbidden Words / Phrases**: `revolutionary, synergy, game-changer, guarantee`
   - **Compliance Footer / Opt-out**: `To unsubscribe from future emails, reply STOP or click here.`
3. Click **"Save Brand Kit"**.
4. **Verification**:
   - A success toast appears: *"Brand kit updated successfully"*.
   - Refresh the page and confirm the brand kit values persist.

---

### Test Scenario 2: Ingesting Prospects & Deduplication

**Goal**: Test prospect ingestion from three entry points with automated deduplication.

#### Test 2A: Direct CSV Ingestion
1. On the **Kanban Board** tab, click **"Import Prospects"**.
2. Upload or paste a CSV with the following test rows:
   ```csv
   name,email,company,title,channel
   Sarah Connor,sarah@cyberdyne.io,Cyberdyne Systems,VP Engineering,email
   John Matrix,john@valverde.gov,Val Verde Logistics,Head of Operations,whatsapp
   Sarah Connor,sarah@cyberdyne.io,Cyberdyne Systems,VP Engineering,email
   ```
3. Click **"Process Ingestion"**.
4. **Verification**:
   - The engine reports: `2 prospects imported, 1 duplicate skipped`.
   - Sarah Connor and John Matrix appear in the **"New"** column on the Kanban board.

#### Test 2B: Ingestion from Scraped Page Preview (`/preview`)
1. Scrape a website containing contact info (or view an existing extraction on `/preview`).
2. Under the **"Contacts & Leadership"** enrichment tab, click **"Engage Prospect"** next to any detected executive.
3. Choose the target channel (`Email` or `LinkedIn/WhatsApp`) and click **"Add to Engagement Pipeline"**.
4. **Verification**:
   - Redirects to `/engagement` with the prospect pre-populated in the pipeline with extraction metadata linked.

#### Test 2C: Ingestion from Saved Dashboard (`/dashboard`)
1. On `/dashboard`, open the row menu `...` for any saved extraction.
2. Select **"Engage Contacts"**.
3. **Verification**:
   - Automatically extracts valid emails and company domains and creates pipeline leads.

---

### Test Scenario 3: AI Message Generation

**Goal**: Generate multi-channel copy honoring brand tone and forbidden word guardrails.

1. On the Kanban board, click the card for **Sarah Connor** (`sarah@cyberdyne.io`).
2. In the drawer, click **"Generate AI Message"**.
3. Select:
   - **Channel**: `Email`
   - **Goal / Context**: `Product Introduction & Pilot Offer`
4. Click **"Run Generation"**.
5. **Verification**:
   - Generated message appears with:
     - Clear subject line (e.g., `Cyberdyne Systems data workflows + DatIQ Growth Labs`).
     - Personalized body citing company and title.
     - Tone matches `Consultative`.
     - None of the forbidden words (`revolutionary`, `synergy`, etc.) are present.
     - Opt-out footer is appended at the bottom.
   - Prospect stage moves from `New` to `Review Pending`.

---

### Test Scenario 4: Human-in-the-Loop Review Queue

**Goal**: Review, edit, approve, or reject generated messages before dispatch.

1. Navigate to the **"Review Queue"** tab.
2. Notice the pending message card for **Sarah Connor**.
3. Test **Inline Editing**:
   - Click **"Edit Copy"**.
   - Modify the subject line to: `Cyberdyne Systems x DatIQ: Quick question for Sarah`.
   - Click **"Save Changes"**.
4. Test **Approval**:
   - Click **"Approve & Queue"**.
5. **Verification**:
   - Item disappears from Review Queue.
   - On the Kanban board, Sarah Connor moves to the **"Queued"** column.
   - Prospect activity timeline records: `Message approved by operator`.

---

### Test Scenario 5: Multi-Channel Dispatch Execution

**Goal**: Dispatch queued messages via Email, WhatsApp, SMS, or Telegram.

1. In the Kanban board, click Sarah Connor's card.
2. In the drawer, click **"Send Now"**.
3. **Verification**:
   - Button shows sending spinner, then confirms: *"Message dispatched via email"*.
   - Prospect status advances to **"Sent"** (or **"Delivered"**).
   - Activity drawer logs delivery ID, timestamp, and payload snippet.
   - Analytics panel counter for **"Sent"** increments by 1.

---

### Test Scenario 6: Inbound Webhook Simulation (Opens, Replies, Opt-Outs)

**Goal**: Simulate third-party webhooks to verify automated stage updates and compliance opt-out handling.

#### Test 6A: Simulate Email Opened Event
```bash
curl -X POST "https://<your-preview-url>/api/engagement/webhook" \
  -H "Content-Type: application/json" \
  -H "x-engagement-secret: datiq-engagement-webhook-secret" \
  -d '{
    "provider": "resend",
    "event": "email.opened",
    "data": {
      "to": "sarah@cyberdyne.io",
      "email_id": "test-resend-msg-123"
    }
  }'
```
**Verification**:
- Response: `{"success":true,"action":"status_updated","stage":"opened"}`
- Sarah Connor's status on the Kanban board updates to **"Opened"**.

#### Test 6B: Simulate Inbound Reply
```bash
curl -X POST "https://<your-preview-url>/api/engagement/webhook" \
  -H "Content-Type: application/json" \
  -H "x-engagement-secret: datiq-engagement-webhook-secret" \
  -d '{
    "provider": "twilio",
    "event": "message.received",
    "data": {
      "From": "+14155550199",
      "To": "+14155238886",
      "Body": "Sounds interesting, can we schedule a demo call tomorrow at 3pm?"
    }
  }'
```
**Verification**:
- Response: `{"success":true,"action":"reply_recorded","stage":"replied"}`
- Prospect moves to the **"Replied"** column with the incoming text displayed in the activity drawer.

#### Test 6C: Simulate Opt-Out / STOP Event (CRITICAL COMPLIANCE)
```bash
curl -X POST "https://<your-preview-url>/api/engagement/webhook" \
  -H "Content-Type: application/json" \
  -H "x-engagement-secret: datiq-engagement-webhook-secret" \
  -d '{
    "provider": "twilio",
    "event": "message.received",
    "data": {
      "From": "+14155550199",
      "To": "+14155238886",
      "Body": "STOP"
    }
  }'
```
**Verification**:
- Response: `{"success":true,"action":"opt_out_enforced","stage":"opted_out"}`
- Prospect is moved immediately to **"Opted Out"**.
- All pending queued messages are automatically cancelled.
- Any future dispatch attempts to this contact are blocked with `OPTED_OUT_CONTACT` error.

---

### Test Scenario 7: Scheduled Stale SLA Monitor

**Goal**: Automatically mark prospects as stale when no response is received within the SLA window (e.g. 7 days).

Simulate the n8n 6-hour cron call:
```bash
curl -X POST "https://<your-preview-url>/api/engagement/engine" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "check_stale_prospects",
    "stale_threshold_days": 7
  }'
```
**Verification**:
- Response: `{"success":true,"stale_count":N}`
- Prospects sent > 7 days ago transition from `sent`/`opened` to `stale`.

---

### Test Scenario 8: Bi-directional CRM & Google Sheets Sync

**Goal**: Export pipeline data to Google Sheets or Airtable, and pull status updates back.

1. Navigate to `/engagement` -> **"Analytics & Connectors"** tab.
2. Under **External Sync**:
   - Click **"Sync to Google Sheets"**.
   - Enter Sheet ID or Webhook URL.
   - Click **"Trigger Sync"**.
3. **Verification**:
   - Sync logs record row count and timestamp.
   - Toast confirms: *"Successfully synchronized pipeline records"*.

---

## 4. Automated Test Suites & Verification Commands

All unit, contract, page-ownership, security, and build checks must pass without errors or warnings.

### 4.1 Run Engagement Engine Unit & Domain Tests
```bash
npx vitest run src/lib/engagement
```
**Tests Covered**:
- `stateMachine.test.js`: All 14 stage transitions, transition guards, invalid transition rejections, and terminal states.
- `aiMessageGenerator.test.js`: Persona copy generation, brand voice injection, forbidden words filter, compliance footer enforcement.
- `channelRouter.test.js`: Multi-channel formatting, character limit enforcement (SMS 160-char warning, WhatsApp template validation, Email HTML formatting).
- `syncConnectors.test.js`: Google Sheets, Airtable, and CRM data transformation mappings.
- `engagementClient.test.js`: API client error handling, fallback to local store, deduplication logic.

### 4.2 Run Netlify Serverless Function Contract Tests
```bash
npx vitest run netlify/__tests__/engagement*
```
**Tests Covered**:
- `engagement-engine.contract.test.js`: API contract testing for lead ingestion, status updates, message approvals, and dispatch triggers.
- `engagement-webhook.contract.test.js`: HMAC signature verification, Resend webhook payload processing, Twilio inbound SMS/WhatsApp parser, and STOP opt-out enforcement.

### 4.3 Run Frontend UI Component Tests
```bash
npx vitest run src/pages/Engagement*
```
**Tests Covered**:
- `Engagement.test.jsx`: Page render, tab navigation, brand kit loading, Kanban drag/move state updates, review queue interactions.

### 4.4 Run Full Pre-Flight Quality Gate
Run the standard DatIQ gate commands prior to production promotion:
```bash
# 1. Route Ownership & SEO Verification
npx vitest run scripts/page-ownership.test.mjs

# 2. Dependency & Code Security Audit
npm run test:security

# 3. Prerender & Static SEO Consistency Check
npm run check:prerender

# 4. Vite Production Build
npm run build
```

---

## 5. Troubleshooting & FAQ

### Q1: Inbound webhooks return 401 Unauthorized
- **Cause**: The `ENGAGEMENT_WEBHOOK_SECRET` environment variable is configured in Netlify, but the calling webhook didn't provide matching `x-engagement-secret` header or HMAC signature.
- **Resolution**: Verify that the n8n webhook node or Twilio/Resend webhook URL configuration includes the identical secret token in the header.

### Q2: Messages fail to send with "MISSING_PROVIDER_KEY"
- **Cause**: Real credentials for Resend or Twilio were not configured.
- **Resolution**: In staging or preview environments, the system defaults to mock simulation. If real sends are desired, add `RESEND_API_KEY` and `TWILIO_*` credentials to Netlify environment variables.

### Q3: Prospects are not saving to Supabase
- **Cause**: Migration `0048_prospect_engagement_engine.sql` has not been applied yet to the active Supabase project.
- **Resolution**: Run the SQL migration in the Supabase SQL editor. In the meantime, the engine will gracefully fall back to browser `localStorage` storage so UI testing is unblocked.

---

## 6. Summary Checklist for Sign-Off

- [ ] Migration `0048_prospect_engagement_engine.sql` executed in Supabase.
- [ ] Netlify environment variables configured (`SUPABASE_*`, `RESEND_*`, `TWILIO_*`).
- [ ] Edge Access bypass set for `/api/engagement/*`.
- [ ] n8n workflows imported and credential mappings confirmed.
- [ ] Brand kit configured with voice, tone, and forbidden words.
- [ ] Prospect ingested from CSV, `/preview`, and `/dashboard`.
- [ ] AI message generated and reviewed in Human-in-the-Loop queue.
- [ ] Dispatch executed and activity logged.
- [ ] Webhook simulated for open, reply, and STOP opt-out.
- [ ] All automated test suites (`vitest`, `test:security`, `check:prerender`, `build`) green.
