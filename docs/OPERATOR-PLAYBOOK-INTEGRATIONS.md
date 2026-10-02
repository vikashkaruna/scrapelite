# Operator Playbook — DatIQ Integrations

> **Audience:** the solo operator deploying the `Integration-with-outside-ecosystem`
> branch to staging/production. **Goal:** set up, test, and ship the 6
> integrations (HubSpot, Notion, Airtable, Zapier, Slack, browser extension)
> end-to-end without guesswork.
>
> **Stack summary:** each integration follows the same 4-piece pattern —
> per-user connection record in `integration_connections`, a Netlify Function
> pair (`integrations-{provider}.js` + `lib/{provider}Service.js`), a
> `set-api-key`-style connect flow in the Account UI, and a polling / push
> / notify endpoint that the rest of DatIQ can call.
>
> **Read this end-to-end before touching production.** It includes both
> *offline* testing (curl-only, no DatIQ UI) and *online* testing (with the
> real DatIQ dashboard).

---

## Table of contents

1. [Architecture primer](#1-architecture-primer)
2. [Pre-flight: Supabase migrations + env vars](#2-pre-flight-supabase-migrations--env-vars)
3. [HubSpot — push contacts + companies to CRM](#3-hubspot)
4. [Notion — push pages to a database](#4-notion)
5. [Airtable — push rows to a base](#5-airtable)
6. [Zapier — register a private app + test polling](#6-zapier)
7. [Slack — change alerts + new-extraction notifications](#7-slack)
8. [Browser extension — MV3 build + Chrome Web Store](#8-browser-extension)
9. [Cross-integration smoke test plan](#9-cross-integration-smoke-test-plan)
10. [Production checklist](#10-production-checklist)
11. [Troubleshooting matrix](#11-troubleshooting-matrix)

---

## 1. Architecture primer

### 1.1 The shared store: `integration_connections`

Every per-user OAuth/PAT/secret lives in one Supabase table:

```sql
-- supabase/migrations/0020_integration_connections.sql
create table public.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in
                  ('hubspot','notion','airtable','slack','zapier','google_sheets')),
  access_token  text,
  refresh_token text,
  scopes        text,
  account_id    text,
  account_label text,
  expires_at    timestamptz,
  config        jsonb,                -- provider-specific (Base ID, DB ID, webhook URL, etc.)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);
```

- **One row per user per provider.** A user can have a HubSpot connection AND a Notion connection at the same time.
- **`access_token` is plaintext in v1.** RLS restricts row visibility to the SERVICE key only. v1.1 will wrap in pgcrypto. Don't expose the service key.
- **`config` is a flexible jsonb** for provider-specific extras: Notion `database_id`, Airtable `base_id` + `table_id`, Slack `webhook_url`, Zapier `token_hash` + `token_hint`.

The store helpers (`netlify/functions/lib/integrationConnectionStore.js`) expose:
- `getConnection({ userId, provider, includeSecrets })` — read; `includeSecrets: true` returns the token.
- `upsertConnection({ userId, provider, fields })` — PATCH first, INSERT if no row; idempotent.
- `deleteConnection({ userId, provider })` — disconnect.

### 1.2 The routing layer

Every `/api/integrations/*` and `/api/v1/*` call lands on `netlify/functions/integrations-router.js` (for integrations) or `netlify/functions/api-v1.js` (for the public REST API). The router uses Netlify's splat mechanism:

```toml
# netlify.toml
[[redirects]]
  from = "/api/integrations/*"
  to   = "/.netlify/functions/integrations-router?splat=:splat"
```

`integrations-router.js` dynamically imports the right handler (`integrations-hubspot.js`, `integrations-notion.js`, etc.) based on the first URL segment. The handler then dispatches on `subPath` (e.g. `status`, `connect`, `push`).

### 1.3 The auth model

| Endpoint class | Auth | Notes |
|---|---|---|
| `/api/v1/*` (public REST) | `Authorization: Bearer dq_live_...` | Per-user API key from `0019_api_keys.sql`. Token bucket rate limit per key. |
| `/api/integrations/*` internal | Supabase JWT (`Authorization: Bearer <user_session_jwt>`) | Used by the Account UI. |
| `/api/integrations/zapier/*` public | `X-Zapier-Token: zap_...` | Per-Zap secret, SHA-256 hashed in store. Used by Zapier's polling triggers. |
| `/api/integrations/slack/notify` | Supabase JWT | Internal call from `notify.js` (not a public webhook). |

The browser extension uses a **separate** API path: `https://datiq.app/api/v1/extractions` (the public REST API) with a `dq_live_` key. It does NOT use the Netlify Functions router.

---

## 2. Pre-flight: Supabase migrations + env vars

Before anything else, the operator must:

### 2.1 Apply 3 new Supabase migrations

```
supabase/migrations/0019_api_keys.sql                 -- public REST API keys
supabase/migrations/0020_integration_connections.sql  -- shared per-user integration store
supabase/migrations/0021_zapier_events.sql            -- Zapier event log
```

**How to apply:**

1. Open Supabase Dashboard → SQL Editor → New query.
2. For each migration in numerical order:
   - Open `supabase/migrations/0019_api_keys.sql` from the repo.
   - Paste the entire file. Click **Run**.
   - Verify: `select * from public.api_keys limit 0;` (should return empty, no error).
3. Repeat for `0020_integration_connections.sql` and `0021_zapier_events.sql`.
4. **Or** use the auto-generated `supabase/migrations/run-all.sql` (kept in sync by `npm run build:sql`):
   - Paste the full file once. All migrations are idempotent (`IF NOT EXISTS` / `OR REPLACE`).

**Verify all 3 tables exist:**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in
  ('api_keys', 'integration_connections', 'zapier_events');
```

Expected: 3 rows.

### 2.2 Set Netlify env vars

Add to the Netlify site's environment (Site settings → Environment variables):

| Variable | Used by | Example value |
|---|---|---|
| `SUPABASE_URL` | All server-side code (Netlify Functions) | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Server-side DB writes | `eyJ...` (service_role JWT) |
| `SUPABASE_ANON_KEY` | Browser-side fallback | `eyJ...` (anon JWT) |
| `VITE_SUPABASE_URL` | Browser bundle | same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Browser bundle | same as `SUPABASE_ANON_KEY` |
| `URL` | Netlify auto-set per context | `https://datiq.app` or `https://staging--datiqapp.netlify.app` |
| `SITE_URL` | Optional override | `https://datiq.app` |
| `SLACK_WEBHOOK_URL` | Global Slack fallback (optional) | `https://hooks.slack.com/services/...` |

`SUPABASE_SERVICE_KEY` is the most sensitive — anyone with this can write to the DB. It's the same key the system uses for service-role operations.

For local dev, set these in `.env` (already wired via `VITE_*` in `src/lib/config.js`).

### 2.3 Verify the Netlify Functions deploy

After deploy:

```bash
curl https://datiq.app/api/integrations/hubspot/status
# Expected: 401 with { error: "Authentication required" }
# (no JWT means unauthorized — proves the function is up and the auth middleware runs)
```

A 401 here is the **success** signal for pre-flight. If you get 404, the function didn't deploy; check the Netlify deploy log.

---

## 3. HubSpot

### 3.1 What it does

DatIQ pushes the **company** (extraction target) and **contacts** (people from
the `contacts` / `leadership` enrichment) to a HubSpot CRM. The push is
server-side; the user just pastes their HubSpot Private App token once.

### 3.2 End-to-end flow

```
1. USER: In DatIQ → Preview page, clicks "Push to HubSpot"
2. SPA: POST /api/integrations/hubspot/push  { extraction: {...} }
         Authorization: Bearer <user JWT>
3. Function: integrations-hubspot.js
   - reads the user's stored HubSpot access_token from integration_connections
   - calls hubspotService.pushExtractionToHubSpot()
4. hubspotService:
   a. Pushes the COMPANY (by domain):
      - Search HubSpot for an existing company with this domain
      - If found → PATCH (update fields). If not → POST (create).
   b. Pushes each CONTACT (by email):
      - Walks extraction.enrichments.{contacts,leadership}.data.people[]
      - For each person with an email:
        Search HubSpot for an existing contact by email
        If found → PATCH. If not → POST.
5. Response: { ok: true, company: {...}, contacts: [{...}], counts: {...} }
6. SPA: shows toast "Pushed to HubSpot" with the count summary
```

### 3.3 Setup (operator, one-time per HubSpot account)

**Step 1 — Create the Private App:**

1. In HubSpot, **Settings** (gear icon) → **Integrations** → **Private Apps**.
2. Click **Create a private app**, name it `DatIQ`.
3. Go to the **Scopes** tab. Enable exactly these:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
4. Click **Create app**, then **Show token**. Copy the token — it starts with `pat-na1-…`.
5. **Save the token** in your password manager. You can't re-view it after closing the dialog.

**Step 2 — Connect in DatIQ:**

1. Sign in to DatIQ (use a Business or Enterprise plan account; the free tier doesn't include integrations).
2. **Account → Integrations → HubSpot**.
3. Paste the `pat-na1-…` token, optional `accountLabel` (e.g. "ACME Hub"), click **Connect**.
4. DatIQ probes the token by calling `GET https://api.hubapi.com/crm/v3/objects/contacts?limit=1` and stores the result. The token is never returned to the browser again.

### 3.4 Field mapping (defaults)

| HubSpot contact property | DatIQ source | Notes |
|---|---|---|
| `email` | `person.email` | Required for dedup |
| `firstname` | `person.first_name` | |
| `lastname` | `person.last_name` | |
| `phone` | `person.phone` | |
| `company` | `person.company` | |
| `jobtitle` | `person.role` | |
| `website` | `person.website` | |
| `datiq_source_url` | `person.source_url` | Custom property |
| `datiq_extraction_id` | `person.extraction_id` | Custom property |

| HubSpot company property | DatIQ source |
|---|---|
| `name` | `extraction.page_title` |
| `domain` | `extraction.host` |
| `description` | `extraction.ai_summary` |
| `website` | `extraction.url` |

Custom properties (`datiq_*`) must exist in the HubSpot portal. If they don't, the API will return `400 property "datiq_source_url" does not exist`. Either create them in HubSpot or remove them from the mapping.

### 3.5 Testing

**Offline (no DatIQ UI, just curl):**

```bash
# 1. Mint a Supabase user session JWT (use the DatIQ UI to copy one from
#    localStorage after signing in, or use the supabase-js test helper).

# 2. Connect (probe the token):
curl -X POST https://datiq.app/api/integrations/hubspot/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "pat-na1-XXXXX", "accountLabel": "Test Hub"}'
# Expected: { ok: true, connected: true }

# 3. Push a synthetic extraction (use a known company domain + a contact with email):
curl -X POST https://datiq.app/api/integrations/hubspot/push \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "extraction": {
      "id": "test-extraction-1",
      "url": "https://stripe.com/pricing",
      "host": "stripe.com",
      "page_title": "Stripe — Pricing",
      "ai_summary": "Stripe pricing page covers Standard and Enterprise plans.",
      "enrichments": {
        "contacts": { "data": { "people": [{
          "name": "Patrick Collison",
          "email": "patrick@stripe.com",
          "role": "CEO",
          "company": "Stripe"
        }] } }
      }
    }
  }'
# Expected: { ok: true, company: { id, created: true|false }, contacts: [{...}], counts: {...} }

# 4. Check HubSpot UI: a new "Stripe" company should appear, plus a contact.
#    Re-running the same call should PATCH (created: false), not POST again.
```

**Online (with DatIQ UI):**

1. **Account → Integrations → HubSpot**. Paste token. Click **Connect**. Toast should say "Connected".
2. Open a Preview page for any URL that has a `contacts` or `leadership` enrichment with at least one contact that has an email (try `https://stripe.com/about` for the executive team).
3. Click **Push to HubSpot**. Toast should say "Pushed 1 company + 3 contacts to HubSpot".
4. Go to HubSpot → Contacts → search for one of the pushed emails. Confirm the contact is there with the correct `firstname`/`lastname`/`jobtitle`/`company`.
5. Go to HubSpot → Companies → search for the host. Confirm the company record.

### 3.6 Common failures

| Error | Cause | Fix |
|---|---|---|
| `hubspot_400: property "datiq_*" does not exist` | Custom property missing in HubSpot | Create the property in HubSpot or remove it from the mapping |
| `hubspot_401: Bad token` | PAT revoked or wrong portal | Re-create the Private App token in the right HubSpot account |
| `hubspot_403: scopes` | Missing CRM scope on the PAT | Re-create the token with all 4 CRM scopes |
| DatIQ returns `no_such_token` for the connect probe | Netlify function can't reach HubSpot | Check `hubapi.com` is reachable from the Netlify region; check CSP allows outbound |

---

## 4. Notion

### 4.1 What it does

DatIQ pushes extraction data to a Notion **database** as new pages. One page
per extraction, with the default schema (Title, URL, Host, Summary,
Headings, Created) pre-filled. Users can override the column → DatIQ
mapping per column in the Account UI.

### 4.2 End-to-end flow

```
1. USER: Account → Integrations → Notion
2. USER: Pastes the Notion internal-integration secret + a Database ID
3. SPA: POST /api/integrations/notion/connect
         { apiKey: "secret_...", databaseId: "abc123..." }
4. Function: integrations-notion.js
   - calls fetchNotionSchema(apiKey, databaseId) to read the database's
     declared properties from Notion's API
   - stores { api_key, database_id, schema } in integration_connections.config
5. LATER: USER: clicks "Push to Notion" on a Preview / Batch / Dashboard row
6. SPA: POST /api/integrations/notion/push
         { items: [extraction1, extraction2, ...] }
7. Function: pushToNotion(items, { apiKey, databaseId, schema })
   - chunks into batches of 25 (Notion's API has a 3 req/sec cap; 25
     sequential calls = ~8 sec)
   - for each item: buildNotionPageBody builds a `pages.create` payload
   - POST /v1/pages to Notion's API
8. Response: { ok, results: [{page_id, ...}], errors: [...] }
```

### 4.3 Setup

**Step 1 — Create the Notion Internal Integration:**

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Click **New integration**, name it `DatIQ`, pick the workspace.
3. **Capabilities** tab: enable **Read content** + **Update content** + **Insert content**. (Read is needed for the schema probe; Update is needed for v1.1 dedup.)
4. **Submit**. Copy the **Internal Integration Secret** — it starts with `secret_` (older) or `ntn_` (newer).

**Step 2 — Share the database:**

1. In Notion, open the database you want DatIQ to write to.
2. Top-right **•••** menu → **Connections** → search for `DatIQ` → click to add.
3. The integration can only see databases it's been explicitly shared with. This is Notion's security model; sharing is per-database.

**Step 3 — Get the Database ID:**

1. Open the database in Notion. Look at the URL:
   ```
   https://www.notion.so/{workspace}/{DATABASE_ID}?v={view}
   ```
2. The DATABASE_ID is the 32-char UUID (with or without dashes). Example: `2a8c4e1f-7b3d-4c9a-8e2f-1d5b6c7a8b9c`.

**Step 4 — Connect in DatIQ:**

1. **Account → Integrations → Notion**.
2. Paste the secret + database ID. Click **Connect**.
3. DatIQ calls `GET /v1/databases/{id}` to confirm both work, fetches the property schema, and shows the column → DatIQ field mapping. Adjust if needed, then **Save**.

### 4.4 Default field mapping

| Notion property type | DatIQ source |
|---|---|
| `title` (the page title) | `extraction.page_title` |
| `url` | `extraction.url` |
| `rich_text` "Host" | `extraction.host` (or hostname of URL) |
| `rich_text` "Summary" | `extraction.ai_summary` |
| `rich_text` "Headings" | joined headings (`h1, h2, h3, ...`) |
| `date` "Created" | `extraction.created_at` |

Notion properties we know how to set: `title`, `rich_text`, `url`, `number`, `checkbox`, `select`, `multi_select`, `date`, `email`, `phone_number`. Unknown types fall back to `rich_text` (auto-stringify).

### 4.5 Testing

**Offline (curl-only):**

```bash
# 1. Connect (probes the token + DB, returns the schema):
curl -X POST https://datiq.app/api/integrations/notion/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "secret_XXXXX", "databaseId": "2a8c4e1f-7b3d-4c9a-8e2f-1d5b6c7a8b9c"}'
# Expected: { ok: true, connected: true, schema: { Title: {...}, URL: {...}, ... }, titleColumn: "Title" }

# 2. Push one extraction:
curl -X POST https://datiq.app/api/integrations/notion/push \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{
      "id": "test-1",
      "url": "https://stripe.com/pricing",
      "page_title": "Stripe — Pricing",
      "host": "stripe.com",
      "ai_summary": "Stripe pricing page.",
      "headings": ["Pricing", "Standard", "Enterprise"],
      "created_at": "2026-08-09T10:00:00Z"
    }]
  }'
# Expected: { ok: true, results: [{ page_id: "..." }], errors: [] }
```

**Online (with DatIQ UI):**

1. Create a fresh Notion database with the columns DatIQ expects (or use the default schema).
2. **Account → Integrations → Notion**. Paste secret + database ID. Click **Connect**. The UI should show the Notion schema with auto-mapped columns. Review the mapping.
3. Save an extraction in DatIQ. Go to **Dashboard**, click on it, then **Push to Notion** (button in the row actions).
4. Switch to the Notion tab. A new page should appear with the extracted data populated.

### 4.6 Common failures

| Error | Cause | Fix |
|---|---|---|
| `unauthorized` from Notion | Secret wrong / integration deleted | Re-create the integration at notion.so/my-integrations |
| `object_not_found: Could not find database` | Database ID wrong OR integration not shared with that database | Verify the ID; re-share the database with `DatIQ` in Notion's `••• → Connections` |
| `validation_error: body failed validation` | A property has the wrong type (e.g. trying to set a `select` with a value not in the options) | Either create the option in Notion, or remove that column from the mapping |
| Push succeeds but pages don't appear | Integration has Read but not Insert content | Re-edit the integration at notion.so/my-integrations, enable **Insert content** |

### 4.7 Gotcha: no dedup

The push **always creates new pages**. Re-pushing the same URL will create a duplicate. v1.1 will add dedup by URL. If you need dedup now, do it on the Notion side (Notion's database view + formula + filtered views).

---

## 5. Airtable

### 5.1 What it does

DatIQ pushes extraction rows into an Airtable base as new records. Like
Notion, but the field types are simpler (single-line text, multi-line text,
URL, date) and the per-request cap is 10 records.

### 5.2 End-to-end flow

```
1. USER: Account → Integrations → Airtable
2. USER: Pastes PAT + Base ID + Table ID
3. SPA: POST /api/integrations/airtable/connect
         { apiKey, baseId, tableId }
4. Function: integrations-airtable.js
   - calls GET https://api.airtable.com/v0/meta/bases to probe the PAT
   - stores { api_key, base_id, table_id } in integration_connections.config
5. LATER: USER: clicks "Push to Airtable" on a row
6. SPA: POST /api/integrations/airtable/push  { items: [...] }
7. Function: pushToAirtable(items, { apiKey, baseId, tableId })
   - chunks into 10-record batches (Airtable's hard cap per request)
   - for each batch: POST /v0/{baseId}/{tableId} with the records
8. Response: { ok, results, errors }
```

### 5.3 Setup

**Step 1 — Create a Personal Access Token (PAT):**

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens).
2. Click **Create token**, name it `DatIQ`.
3. **Scopes:** enable exactly:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
4. **Access:** pick the specific base you want DatIQ to write to. The PAT is base-scoped — you can't grant access to all bases; pick the one you need.
5. Click **Create token**. Copy it — it starts with `pat…` and is shown ONCE.

**Step 2 — Get the Base ID and Table ID:**

- **Base ID:** open the base, look at the URL: `https://airtable.com/{BASE_ID}/...`. Starts with `app`.
- **Table ID:** navigate to a specific table, look at the URL: `https://airtable.com/{BASE_ID}/{TABLE_ID}/...`. Starts with `tbl` (table) or `viw` (view). The API expects a table ID, so make sure you copy the `tbl…` one.

**Step 3 — Connect in DatIQ:**

1. **Account → Integrations → Airtable**.
2. Paste the PAT + Base ID + Table ID. Click **Connect**.
3. DatIQ calls `GET /v0/meta/bases` to confirm the token works, then stores the configuration.

### 5.4 Field mapping

Default columns (you create these in Airtable ahead of time):

| Airtable column | Type | DatIQ source |
|---|---|---|
| `URL` | URL | `extraction.url` |
| `Title` | Single line text | `extraction.page_title` |
| `Host` | Single line text | `extraction.host` |
| `Summary` | Long text | `extraction.ai_summary` |
| `Created at` | Date (with time) | `extraction.created_at` |
| `Headings` | Long text | joined headings |
| `Links` | Long text | joined link URLs |

The columns **must exist** in your Airtable table. If a column doesn't exist, Airtable's API will reject the record. The adapter uses `typecast: true` to allow Airtable to auto-convert values where possible (e.g. string → date if the format matches).

### 5.5 Testing

**Offline (curl):**

```bash
# 1. Connect:
curl -X POST https://datiq.app/api/integrations/airtable/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "patXXXXX...", "baseId": "appXXXXX", "tableId": "tblXXXXX"}'
# Expected: { ok: true, connected: true }

# 2. Push one record:
curl -X POST https://datiq.app/api/integrations/airtable/push \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{
      "url": "https://stripe.com/pricing",
      "page_title": "Stripe — Pricing",
      "host": "stripe.com",
      "ai_summary": "Stripe pricing page.",
      "headings": ["Pricing", "Standard", "Enterprise"],
      "links": ["https://stripe.com/standard", "https://stripe.com/enterprise"],
      "created_at": "2026-08-09T10:00:00Z"
    }]
  }'
# Expected: { ok: true, results: [{ id: "rec..." }], errors: [] }
```

**Online (DatIQ UI):**

1. Create an Airtable base with the columns above (or your own schema — typecast will coerce).
2. **Account → Integrations → Airtable**. Paste PAT + base + table IDs. Click **Connect**.
3. Save an extraction in DatIQ. From the Dashboard row, click **Push to Airtable**.
4. Switch to Airtable. A new record should appear.

### 5.6 Common failures

| Error | Cause | Fix |
|---|---|---|
| `INVALID_PERMISSIONS` | PAT missing a scope OR not granted to this base | Re-create the PAT with all 3 scopes; re-pick the base in **Access** |
| `INVALID_REQUEST_UNKNOWN_FIELD_NAME` | A column in the mapping doesn't exist in the table | Either create the column or remove it from the mapping |
| `422 Unprocessable Entity` | Wrong field type (e.g. trying to write a number to a date column) | Check the typecast or use a different column type |
| Push returns `100 record(s) failed` | Push was over 100 records | Split into multiple pushes (DatIQ caps per-push at 100, Airtable caps per-request at 10) |

### 5.7 Gotchas

- **No dedup.** Same as Notion. Re-pushing creates duplicates.
- **Per-request cap is 10 records.** DatIQ chunks automatically.
- **Per-push cap is 100 records.** If you push more, the rest get rejected. Split manually.

---

## 6. Zapier

### 6.1 What it does

Zapier integration has two directions:

- **Triggers (DatIQ → Zapier):** When a new extraction, enrichment, or monitoring alert happens in DatIQ, an event is written to a Supabase table. Zapier polls DatIQ every 1-15 min and runs the user's downstream Zaps.
- **Actions (Zapier → DatIQ):** A Zap can call DatIQ to extract a URL, create a schedule, or enrich an existing extraction.

The architecture is **polling-based**, not webhook-based. Reasons: no need for DatIQ to maintain a stable, public, certificate-renewed webhook endpoint; 80% of small Zapier apps do this; simpler v1.

### 6.2 End-to-end flow (trigger example)

```
1. USER: Creates a Zapier Zap with "DatIQ: New Extraction" as the trigger
         and "Google Sheets: Create Row" as the action
2. USER: Connects their DatIQ account by pasting a zap_ token (generated in
         Account → Integrations → Zapier)
3. USER: Saves the Zap
4. (5 min later) Zapier: GET https://datiq.app/api/integrations/zapier/poll
                       ?event_type=new_extraction
                       &since=2026-08-09T10:00:00Z
         Header: X-Zapier-Token: zap_XXXXX
5. Function: integrations-zapier.js
   - verifyZapierToken() hashes the token, looks up the user_id via
     integration_connections
   - pollEvents({ userId, eventType: "new_extraction", since })
6. lib/zapierEventStore.js: SELECT * FROM zapier_events
                            WHERE user_id = ... AND event_type = ...
                              AND created_at > since
                            ORDER BY created_at ASC
                            LIMIT 25
7. Response: { events: [{ id, event_type, payload, created_at }, ...] }
8. Zapier: For each event, run the downstream action (e.g. append a row
   to Google Sheets with the event's payload)
9. Zapier: stores the latest created_at as its cursor for the next poll
```

### 6.3 Setup

**Step 1 — User generates a DatIQ Zapier token:**

1. **Account → Integrations → Zapier**.
2. Click **Generate token**. The plaintext is shown ONCE — copy it. It's prefixed `zap_` and is 43 base64url chars (256 bits of entropy).
3. DatIQ stores only the SHA-256 hash + a 4-char hint for the UI.

**Step 2 — Register the DatIQ app in Zapier (operator, one-time):**

1. Go to [developer.zapier.com](https://developer.zapier.com).
2. Sign in (a Zapier account is required).
3. Click **Start a Zapier Integration**.
4. Choose **Build a Private App** (or upload `docs/integrations/zapier-app.json` directly if Zapier's UI supports it).
5. Fill in:
   - **Name:** DatIQ
   - **Description:** "Zero-code web extraction + enrichment. Extract pages, enrich with contacts / leadership / social, run scheduled monitoring, push to 5,000+ apps via Zapier."
   - **Homepage URL:** https://datiq.app
   - **Logo URL:** https://datiq.app/favicon.svg
   - **Brand color:** #7C3AED
6. **Authentication:** choose "Custom" or "API Key". Field: `token` (DatIQ Zapier Token, type `string`, required).
7. **Triggers (3):**
   - `new_extraction` — perform GET `/api/integrations/zapier/poll?event_type=new_extraction`
   - `new_enrichment` — perform GET `/api/integrations/zapier/poll?event_type=new_enrichment`
   - `monitoring_alert` — perform GET `/api/integrations/zapier/poll?event_type=monitoring_alert`
8. **Actions (3):**
   - `extract_url` — perform POST `/api/integrations/zapier/action` with `{ action: "extract_url", params: { url, intent } }`
   - `create_schedule` — perform POST `/api/integrations/zapier/action` with `{ action: "create_schedule", params: { url, cadence, intent } }`
   - `enrich_extraction` — perform POST `/api/integrations/zapier/action` with `{ action: "enrich_extraction", params: { extraction_id, focus } }`
9. Save. Zapier generates a private invite URL like `https://zapier.com/platform/invite/12345/abcde/`.
10. Share that invite URL with users (or embed it in the DatIQ `/integrations` page).

**Step 3 — User installs the app:**

1. User clicks the invite link. Zapier prompts to "Accept Invite & Install".
2. User picks a trigger (e.g. "New Extraction"). Zapier prompts for the DatIQ Zapier token. User pastes the `zap_…` token.
3. Zapier calls `GET /api/integrations/zapier/test` to verify. If 200 OK, the auth field is set.
4. User finishes the Zap (add an action like "Google Sheets: Create Row", map the fields, test, turn on).

### 6.4 Testing

**Offline (curl, simulating Zapier's poll):**

```bash
# 1. Connect (mint a token):
curl -X POST https://datiq.app/api/integrations/zapier/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"regenerate": true}'
# Expected: { ok: true, connected: true, token: "zap_..." }
# (the plaintext is returned ONCE)

# 2. Capture the token from the response, then test the auth:
curl https://datiq.app/api/integrations/zapier/test \
  -H "X-Zapier-Token: zap_XXXXX"
# Expected: { ok: true }

# 3. Trigger an event: save an extraction in DatIQ (UI or API), then poll:
curl "https://datiq.app/api/integrations/zapier/poll?event_type=new_extraction&limit=5" \
  -H "X-Zapier-Token: zap_XXXXX"
# Expected: { events: [{ id, event_type, payload: { id, url, title, summary, created_at }, created_at }] }
# (empty if no new extractions since the cursor; pass since=ISO to scope)

# 4. Test an action (extract_url):
curl -X POST https://datiq.app/api/integrations/zapier/action \
  -H "X-Zapier-Token: zap_XXXXX" \
  -H "Content-Type: application/json" \
  -d '{"action": "extract_url", "params": {"url": "https://stripe.com/pricing", "intent": "summary"}}'
# Expected: full extraction object (id, title, headings, links, summary, ...)
```

**Online (real Zap):**

1. Save an extraction in DatIQ. **Account → Integrations → Zapier**, generate a token, copy it.
2. In a new browser tab, open the private invite URL.
3. Install DatIQ. Create a Zap with **DatIQ: New Extraction** as the trigger.
4. When prompted for the DatIQ Zapier token, paste the `zap_…` token. Zapier tests the auth.
5. Add an action like **Webhooks by Zapier: POST** (or any other) to see the event payload.
6. Test the Zap. It will fire immediately, but there are no events yet.
7. Go back to DatIQ, save another extraction.
8. Wait 1-15 min for the poll. Check the Zap history — should show the new event.
9. Verify the event payload has `{ id, url, title, summary, created_at }`.

### 6.5 Common failures

| Error | Cause | Fix |
|---|---|---|
| `401 invalid_token` | Token wrong, revoked, or user disconnected | Re-generate in Account → Integrations → Zapier |
| Poll returns empty events | Either no events have been emitted, OR the cursor (`since`) is past them | Save a fresh extraction; try without `since` to get all events |
| `502 extract_<status>` from action | The underlying `/extract` function failed (rate limit, scrape error) | Check the Netlify function logs for the actual `extract.js` error |
| Zap shows the trigger but no events | The event_type in the trigger config doesn't match what DatIQ emits | The 3 valid event_types are exactly: `new_extraction`, `new_enrichment`, `monitoring_alert` |

### 6.6 Operator follow-ups

- **Poll interval**: Zapier free = 15 min, paid = 1 min. v1.1 can add webhook-based pushes for sub-minute latency.
- **Token revocation**: v1 caps at 1 token per user. To support multiple Zaps per user, the `verifyZapierToken()` function would need a per-token index on `integration_connections.config.token_hash` (currently a full-table scan).
- **The `x-zapier-user-id` shortcut**: when an action calls back into the extract function, it passes the user_id in a header. The v1.1 cutover should swap this for a per-user API key.

---

## 7. Slack

### 7.1 What it does

Slack notifications fire in two scenarios:
1. **New extraction saved** — fires from `notify.js` after every successful extraction.
2. **Tracked URL changed** — fires from `scheduled-runner.js` (hourly cron) when the content fingerprint of a tracked URL differs from the previous one.

Both use Slack's [Block Kit](https://api.slack.com/block-kit) format for rich formatting (header, fields, action button).

### 7.2 Two ways to wire it

| Mode | Where the URL is | Best for |
|---|---|---|
| **Global env var** (`SLACK_WEBHOOK_URL`) | Netlify env | Self-hosted operators; one channel for the whole deployment |
| **Per-user connection** | `integration_connections.config.webhook_url` | Multi-tenant SaaS; each user picks their own channel |

v1 supports **both**. The resolver in `notify.js` checks: (1) per-user override, (2) global env, (3) nothing. The first one that exists wins.

### 7.3 End-to-end flow (new extraction example)

```
1. USER: completes an extraction in DatIQ (or via API)
2. extractionsRepo.saveExtraction() → notifyExtractionComplete()
3. notify.js: resolveSlackWebhook({ userId, overrideUrl: undefined })
   - queries integration_connections for provider='slack' WHERE user_id=...
   - if connection.config.webhook_url exists, use it
   - else if process.env.SLACK_WEBHOOK_URL exists, use that
   - else return null (skip Slack)
4. notify.js: postToSlack(buildSlackNewExtraction(extraction), { webhookUrl })
5. POST https://hooks.slack.com/services/T.../B.../XXX with the Block Kit payload
6. Slack: shows the message in the configured channel
```

### 7.4 Setup

**Step 1 — Create an Incoming Webhook:**

1. In Slack, go to **Apps** → search for "Incoming Webhooks" → add to your workspace.
   - Or, if you have a custom Slack app: **Features → Incoming Webhooks → Activate → Add New Webhook to Workspace**.
2. Pick the channel. Click **Allow**.
3. Copy the **Webhook URL** — looks like:
   ```
   https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
   ```

**Step 2a — Global env (for self-hosted operators):**

Add to Netlify env:
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

All change alerts + new-extraction events will go to this channel.

**Step 2b — Per-user (in DatIQ Account UI):**

1. **Account → Integrations → Slack**.
2. Paste the webhook URL. Click **Connect**.
3. DatIQ posts a test message to confirm the URL works. If Slack accepts, the connection is saved.
4. From now on, all change alerts + new-extraction events for that user go to that channel.

### 7.5 What the messages look like

**Tracked URL change:**

```
🔔 Tracked page changed
─────────────────────
Schedule:   Stripe pricing
Intent:     summary
Detected:   Aug 9, 2026 at 10:00
Type:       Single URL

Targets
• <https://stripe.com/pricing|stripe.com/pricing>

Content fingerprint changed: `a1b2c3` → `d4e5f6`

[View in DatIQ →]
```

**New extraction:**

```
✅ New extraction: Acme — Product analytics
─────────────────────────────────────────
URL:   <https://acme.com|acme.com>
Host:  acme.com

Summary:
Acme is a product-analytics platform aimed at fast-moving teams…

[View in DatIQ →]
```

### 7.6 Testing

**Offline (curl):**

```bash
# 1. Test a single message (verify the webhook is reachable):
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text": "DatIQ test message"}'
# Expected: Slack channel shows the test message

# 2. Connect in DatIQ (per-user):
curl -X POST https://datiq.app/api/integrations/slack/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"webhookUrl\": \"$SLACK_WEBHOOK_URL\"}"
# Expected: { ok: true, connected: true }
# Side effect: a test "Welcome to DatIQ" message lands in the channel.

# 3. Trigger a new extraction (via API or UI), then check Slack for the notification.

# 4. Test the scheduled-runner change alert: create a schedule for any URL,
#    wait an hour, then change the URL's content, then wait another hour.
#    (Faster: manually invoke scheduled-runner with a forced-change scenario.)
```

**Online (DatIQ UI):**

1. **Account → Integrations → Slack**. Paste the webhook URL. Click **Connect**. The channel should show a welcome message immediately.
2. Save an extraction. The channel should show a "New extraction" message within 1-2 seconds.
3. Create a schedule, then change the tracked page's content, then wait for the cron to fire. Channel should show a "Tracked page changed" message.

### 7.7 Common failures

| Error | Cause | Fix |
|---|---|---|
| `400 channel_not_found` | Webhook was deleted on the Slack side | Re-create the webhook, re-paste in DatIQ |
| `403 action_blocked` | Workspace policy blocks incoming webhooks | Ask the workspace admin to allow DatIQ's webhook |
| `403 invalid_token` | The webhook URL was corrupted in transit (some characters got URL-encoded) | Re-paste the URL; DatIQ validates it starts with `https://hooks.slack.com/` |
| Notifications never fire | `notify.js` couldn't resolve a webhook (no per-user, no env) | Set `SLACK_WEBHOOK_URL` in env, OR connect per-user |
| Notifications fire but with old format | You're on a version before the Block Kit upgrade | Update to the latest `notify.js` + `slackFormatter.js` |

### 7.8 WebhookSetupModal (per-user webhook for outbound fire-and-forget)

The `WebhookSetupModal` (from the `workflow-implementation-and-optimization` branch, but the Slack webhook URL is a different feature) is for **outbound** webhooks — a generic URL the user pastes to receive any DatIQ event. The Slack integration is **inbound-to-Slack** (DatIQ posts to Slack). They are different concepts.

If you want to wire the WebhookSetupModal to support Slack, see the `v1.1` plan: the modal would let the user pick a per-event target (Slack webhook, generic webhook, email, etc.). For v1, the two are independent.

---

## 8. Browser extension

### 8.1 What it does

A Manifest V3 browser extension for Chrome, Edge, Firefox, and Brave. Adds a right-click "Extract this page with DatIQ" item. With a saved API key, the right-click fires the extraction immediately and shows a notification. Without one, it opens the DatIQ dashboard.

### 8.2 End-to-end flow (right-click extraction)

```
1. USER: right-clicks any page
2. Browser: shows context menu with "Extract this page with DatIQ"
3. USER: clicks it
4. background.js (service worker):
   - chrome.storage.local.get("datiq_api_key") → returns the saved dq_live_ key
   - if no key: opens https://datiq.app/preview?url=... in a new tab
   - if key: POSTs to https://datiq.app/api/v1/extractions
5. DatIQ API: validates the API key, runs the extraction, saves to Supabase
6. Response: { id, title, url, ... }
7. background.js: chrome.notifications.create({ type: "basic", title, message })
8. Browser: shows a system notification "DatIQ: extraction saved"
```

### 8.3 Setup

**Step 1 — Build the extension:**

```bash
npm run build:extension
# Reads extensions/datiq-extension/, validates manifest.json, copies tree to dist-extension/
```

Output: `dist-extension/` directory (9 files: `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.css`, `popup.js`, `options.html`, `package.json`, `icons/icon.svg`).

If `sharp` is installed (optional dev dep), the build also rasterizes the SVG icon to PNG sizes 16/32/48/128. Without sharp, the committed PNGs are used (must be present in the repo; if missing, the manifest will still load but icons will be blank).

**Step 2 — Load in Chrome (development):**

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist-extension/` directory.
5. The extension appears as "DatIQ — Extract & Enrich" v1.0.0. Click the puzzle-piece icon in the toolbar to pin it.

**Step 3 — Connect the user's API key:**

1. Sign in to DatIQ on a **Business** or **Enterprise** plan (the public API is gated to those plans).
2. **Account → API keys → Create key**. Give it a label (e.g. "Browser extension — work laptop"). Copy the `dq_live_…` value (shown ONCE).
3. Click the DatIQ icon in the browser toolbar.
4. Paste the key, click **Save & connect**. The key is stored in `chrome.storage.local` (browser-local, never sent to a 3rd party).
5. Now right-click any page. The "Extract this page with DatIQ" item should be there. Click it. A notification should appear within 1-2 seconds.

### 8.4 Permissions, explained

| Permission | Why |
|---|---|
| `contextMenus` | Register the right-click menu item |
| `storage` | Persist the API key across browser restarts |
| `activeTab` | Read the current tab's URL when you right-click |
| `tabs` | Open the DatIQ preview/dashboard after an extraction |
| `notifications` | Show the "Saved!" toast |
| `host_permissions: datiq.app, staging--datiqapp.netlify.app` | Talk to the DatIQ API + dashboard |

The extension does **not** read browsing history, log keystrokes, or touch any page's DOM. The content script (`content.js`) is a no-op reserved for future page-aware features (e.g. "extract this link's preview metadata").

### 8.5 Testing

**Offline (manual load + curl-driven API check):**

```bash
# 1. Build the extension:
npm run build:extension
# Output: dist-extension/

# 2. Validate the manifest:
node -e "console.log(JSON.parse(require('fs').readFileSync('dist-extension/manifest.json')))"
# Verify:
#   manifest_version === 3
#   background.service_worker === "background.js"
#   permissions includes the 5 listed above
#   host_permissions includes the 2 datiq.app URLs
#   content_scripts[0].matches === ["<all_urls>"]

# 3. Test the API call manually (the extension makes the same call):
curl -X POST https://datiq.app/api/v1/extractions \
  -H "Authorization: Bearer dq_live_XXXXX" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://stripe.com/pricing", "intent": "summary"}'
# Expected: 200 with { id, title, url, ... }
# 401 → key wrong
# 403 → not on Business/Enterprise plan
# 429 → rate limit hit
```

**Online (with the extension):**

1. Load the extension (steps above).
2. Pin it to the toolbar.
3. Click the icon. Paste the `dq_live_…` key. Click **Save & connect**. UI should switch to "Signed in as dq_live_…xxxx".
4. Right-click any non-DatIQ page (e.g. `https://news.ycombinator.com`). The "Extract this page with DatIQ" item should appear. Click it.
5. Within 1-2 seconds, a Chrome notification should appear: "DatIQ: extraction saved — Extracted Hacker News. Open the DatIQ dashboard to view."
6. Open the DatIQ dashboard. The new extraction should be at the top of the table.
7. Test the keyboard shortcut: `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+E` (Mac). The popup should open. Click "Extract this page" — should also work.
8. Test the link context menu: right-click any link on a page. "Extract this link with DatIQ" should appear. Click it. The extraction should fire against the link's URL (not the current page's).
9. Test disconnect: click the icon, click "Disconnect". The popup should switch back to the connect form. Right-clicking should now open the DatIQ preview page in a tab (no key, so it can't fire the extraction directly).

### 8.6 Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Right-click shows no DatIQ item | Extension not loaded OR context-menu registration didn't run | Reload the page; check `chrome://extensions` → "Service worker" → console for errors |
| "No API key" toast | Key not set OR cleared | Open popup, paste key |
| 401 from API | Key revoked OR not Business/Enterprise | Re-mint the key; check plan |
| 403 "API not enabled on your plan" | Free plan | Upgrade to Business or Enterprise |
| "Service worker (inactive)" | MV3 service workers can be suspended after 30s of inactivity | Expected behavior. The next right-click wakes it. |
| Build fails: "manifest_version must be 3" | You edited the manifest to v2 by accident | Revert the manifest to v3 |
| Icons are blank in the toolbar | PNGs missing, sharp not installed | Either `npm install sharp` and rebuild, OR commit the PNGs to `extensions/datiq-extension/icons/` |

### 8.7 Publishing to the Chrome Web Store

This branch ships the **source** and **build script**. Publishing is a one-time operator task:

1. **Register** at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) ($5 one-time fee).
2. **Build the production zip:**
   ```bash
   npm run build:extension
   cd dist-extension && zip -r ../datiq-extension-v1.0.0.zip . && cd ..
   ```
3. **Upload** the zip to the Chrome Web Store developer dashboard.
4. **Fill in the listing** (icon, screenshots, description, privacy disclosures).
5. **Submit for review.** Google typically takes 1-3 days for the first submission.
6. Same process for Firefox Add-ons ([addons.mozilla.org](https://addons.mozilla.org)) and Edge Add-ons.

**Privacy disclosures required:**
- The extension does not collect user data.
- It does not read browsing history or page content.
- It only sends the URL the user explicitly right-clicks to DatIQ's API.
- The API key is stored in `chrome.storage.local` (browser-local, never transmitted except to datiq.app).

---

## 9. Cross-integration smoke test plan

Once all 6 integrations are set up, run this end-to-end smoke test from a single DatIQ account. Capture the output for the production-readiness audit.

### 9.1 One-account, one-URL, every integration

```bash
# Pre-req: a DatIQ account on Business/Enterprise plan with API access
# Pre-req: the 5 connection rows set up in integration_connections
# Pre-req: a Zapier Zap with DatIQ: New Extraction trigger and an
#          "Email by Zapier" action (or any action that surfaces the payload)

# 1. Save a single extraction in DatIQ
#    (use a URL with a known company + contacts, e.g. https://stripe.com/about)
#    - Verify: extraction appears in Dashboard
#    - Verify: Slack channel shows "New extraction" message
#    - Verify: zapier_events has 1 new_extraction row
#    - Wait 1-15 min: Zapier poll fires, downstream action runs

# 2. Push to HubSpot
#    - Verify: HubSpot has the company (by domain) and contacts (by email)

# 3. Push to Notion
#    - Verify: Notion database has a new page with the fields populated

# 4. Push to Airtable
#    - Verify: Airtable base has a new record

# 5. From the browser extension, right-click any other page
#    - Verify: Chrome notification "DatIQ: extraction saved"
#    - Verify: the new extraction appears in Dashboard

# 6. From the Schedule editor, create a daily schedule for any URL
#    - Wait an hour (or manually invoke scheduled-runner)
#    - Verify: Slack channel shows "Tracked page changed" if content changed
#    - Verify: zapier_events has 1 monitoring_alert row
```

### 9.2 Failure mode drill

For each integration, force a failure and verify the system degrades gracefully:

| Test | Expected behavior |
|---|---|
| Revoke the HubSpot PAT, then push | Toast: "HubSpot rejected the token (status 401)". Other integrations still work. |
| Delete the Slack webhook, then save an extraction | No Slack message, but the extraction still saves. No crash. |
| Revoke the API key in DatIQ, then use the extension | Notification: "DatIQ: extraction failed — HTTP 401". No crash. |
| Submit an invalid Notion database ID | Connect probe returns 400 with the Notion error. Connection not saved. |
| Zapier poll during Supabase outage | Returns 500 with a clear error. Zapier retries next cycle. |

The integration tests in `netlify/__tests__/integrations-*.test.js` cover the happy paths. These manual drills cover the failure paths that are hard to unit-test.

### 9.3 Performance benchmarks

| Operation | Expected latency | Threshold |
|---|---|---|
| HubSpot push (1 company, 5 contacts) | < 5 sec | < 10 sec |
| Notion push (25 pages) | < 12 sec | < 20 sec |
| Airtable push (10 records) | < 3 sec | < 6 sec |
| Zapier poll → action roundtrip | 1-15 min (poll interval) | < 15 min |
| Slack notification | < 1 sec | < 3 sec |
| Browser extension right-click → notification | < 2 sec | < 5 sec |

---

## 10. Production checklist

Before flipping the integration branch to `main` (and from there to production), verify:

- [ ] All 3 Supabase migrations applied to production
- [ ] `SUPABASE_SERVICE_KEY` set in production Netlify env (NOT committed)
- [ ] `SLACK_WEBHOOK_URL` set if you want a global Slack channel
- [ ] `URL` set to `https://datiq.app` (Netlify auto-sets this)
- [ ] At least 1 user has set up each integration (HubSpot, Notion, Airtable, Zapier, Slack)
- [ ] Each integration smoke-tested end-to-end with a real 3rd-party account
- [ ] The browser extension `dist-extension/` builds cleanly with `npm run build:extension`
- [ ] The browser extension manifest passes MV3 validation
- [ ] The Zapier app is registered in Zapier's developer portal as a private app
- [ ] The Zapier private invite URL is documented in `/integrations` page (or the Account UI)
- [ ] Integration tests pass: `npm run test:contract` runs all `netlify/__tests__/integrations-*.test.js`
- [ ] Phase gate: the staging rebuild+retest script runs green with the integration branch merged
- [ ] Privacy policy updated to mention the 3rd-party services DatIQ integrates with
- [ ] `docs/ENABLEMENTS.md` and `docs/INTEGRATIONS.md` are accurate (no stale links or commands)
- [ ] Slack `Welcome` message template (`buildSlackWelcomeMessage`) is reviewed
- [ ] Per-user rate limit on `/api/integrations/*` is in place (5 req/sec per user, see `apiRateLimiter.js`)

---

## 11. Troubleshooting matrix

| Symptom | Likely cause | Where to look | Fix |
|---|---|---|---|
| All integrations return 503 "Supabase not configured" | Missing env vars in Netlify | Netlify env vars | Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` |
| Auth check returns 401 but the user is signed in | Frontend sent the wrong header (e.g. lowercase `authorization` not picked up) | Browser dev tools → Network → request headers | Use the `Authorization` (capital A) header; or check the SPA's `authHeaders()` helper |
| HubSpot push returns 0 contacts even though the extraction has people | `person.email` is missing OR the enrichment shape is wrong | Netlify function logs → look for `contacts_attempted` in the response | HubSpot requires email for dedup. Confirm the enrichment produced `data.people[i].email`. |
| Notion connect returns 401 from Notion | Secret wrong OR integration deleted | Notion's integration page | Re-create the secret |
| Notion push returns 400 "validation_error" | Property type mismatch (e.g. trying to set a select with a value not in the options) | Notion's API error in the response body | Either create the option in Notion or skip that property |
| Airtable push returns "INVALID_PERMISSIONS" | PAT doesn't have the required scope OR doesn't cover the base | Airtable's token page | Re-create the token with all 3 scopes + the right base |
| Zapier app shows triggers but no events appear | `event_type` mismatch OR the user is querying a different event type | Netlify function logs → check the poll request | The 3 valid event_types are exactly: `new_extraction`, `new_enrichment`, `monitoring_alert` |
| Slack notifications stop after the first one | Webhook URL was revoked on the Slack side | Slack → Manage apps | Re-create the webhook, re-paste in DatIQ |
| Browser extension: right-click shows no item | Service worker died or extension was disabled | `chrome://extensions` → "Service worker" | Click "Inspect" to see errors; reload the extension |
| Browser extension: HTTP 401 from API | Key revoked | Account → API keys | Re-mint a new key, paste in the popup |
| `npm run build:extension` fails: "manifest_version must be 3" | Someone edited the manifest to v2 | `extensions/datiq-extension/manifest.json` | Revert to v3 |
| Browser extension: icons are blank | PNGs missing AND sharp not installed | `dist-extension/icons/` | Either `npm install sharp` and rebuild, or commit the PNGs to the source tree |

---

## Appendix A — File map

| Layer | File | What it does |
|---|---|---|
| Migrations | `supabase/migrations/0019_api_keys.sql` | Public REST API key store |
| Migrations | `supabase/migrations/0020_integration_connections.sql` | Shared per-user integration store |
| Migrations | `supabase/migrations/0021_zapier_events.sql` | Zapier event log |
| Function | `netlify/functions/integrations-router.js` | Dynamic dispatch to per-provider handlers |
| Function | `netlify/functions/integrations-hubspot.js` | HubSpot connect/status/push |
| Function | `netlify/functions/integrations-notion.js` | Notion connect/schema/push |
| Function | `netlify/functions/integrations-airtable.js` | Airtable connect/push |
| Function | `netlify/functions/integrations-zapier.js` | Zapier test/poll/action + connect/regenerate |
| Function | `netlify/functions/integrations-slack.js` | Slack connect/test/notify |
| Function | `netlify/functions/lib/integrationConnectionStore.js` | Shared get/upsert/delete for the connections table |
| Function | `netlify/functions/lib/hubspotService.js` | HubSpot field mappers + push functions |
| Function | `netlify/functions/lib/notify.js` | Centralized notification dispatcher (Slack, email, Zapier) |
| Function | `netlify/functions/lib/slackFormatter.js` | Slack Block Kit message builders |
| Function | `netlify/functions/lib/zapierEmitter.js` | Fire-and-forget Zapier event append |
| Function | `netlify/functions/lib/zapierEventStore.js` | Append + poll events to/from the `zapier_events` table |
| App | `src/lib/notion.js` | Browser + server Notion adapter (push, schema, build body) |
| App | `src/lib/airtable.js` | Browser + server Airtable adapter (push, validate) |
| App | `src/components/Account.jsx` | The "Account" page that hosts the per-integration connect UI |
| App | `src/pages/Integrations.jsx` | The catalog page at `/integrations` (the "Set up" modal trigger) |
| Extension | `extensions/datiq-extension/manifest.json` | MV3 manifest |
| Extension | `extensions/datiq-extension/background.js` | Service worker (context menu + API calls) |
| Extension | `extensions/datiq-extension/popup.{html,js,css}` | The toolbar popup (connect / extract / disconnect) |
| Extension | `extensions/datiq-extension/options.html` | The full options page |
| Extension | `extensions/datiq-extension/content.js` | No-op content script (reserved for future use) |
| Build | `scripts/build-extension.mjs` | Validates manifest, copies tree, optionally renders icons |
| Tests | `netlify/__tests__/integrations-*.test.js` | One per provider; covers happy paths + common failures |
| Tests | `netlify/__tests__/lib/integrationConnectionStore.test.js` | Store CRUD + masking |
| Tests | `netlify/__tests__/lib/hubspotService.test.js` | Field mappers + push functions |
| Tests | `netlify/__tests__/lib/zapierEventStore.test.js` | Append + poll with dedup |
| Tests | `netlify/__tests__/lib/notify.test.js` | Fan-out to Slack + Zapier + email |
| Tests | `netlify/__tests__/lib/slackFormatter.test.js` | Block Kit shape |
| Tests | `scripts/__tests__/build-extension.test.js` | Extension build script (manifest validation, tree copy) |
| Docs | `docs/INTEGRATIONS.md` | Top-level integration overview |
| Docs | `docs/ENABLEMENTS.md` | Operator setup checklist (legacy, see this doc for the full version) |
| Docs | `docs/integrations/hubspot.md` | Per-integration setup (HubSpot) |
| Docs | `docs/integrations/notion.md` | Per-integration setup (Notion) |
| Docs | `docs/integrations/airtable.md` | Per-integration setup (Airtable) |
| Docs | `docs/integrations/zapier.md` | Per-integration setup (Zapier) |
| Docs | `docs/integrations/slack.md` | Per-integration setup (Slack) |
| Docs | `docs/integrations/browser-extension.md` | Per-extension setup |
| Docs | `docs/integrations/zapier-app.json` | The Zapier app definition (upload to developer.zapier.com) |

---

## Appendix B — One-page reference

| Integration | User does | Operator does | First test |
|---|---|---|---|
| **HubSpot** | Paste PAT in Account → Integrations | Create Private App with 4 CRM scopes | Push a known extraction; check HubSpot for company + contacts |
| **Notion** | Paste secret + DB ID in Account → Integrations | Create Internal Integration, share DB | Push an extraction; check Notion for a new page |
| **Airtable** | Paste PAT + base + table IDs | Create PAT with 3 scopes, grant to base | Push an extraction; check Airtable for a new record |
| **Zapier** | Generate `zap_` token, paste in Zapier | Register private app at developer.zapier.com, share invite link | Save an extraction; wait for poll; check Zap history |
| **Slack** | Paste webhook URL in Account → Integrations | Create Incoming Webhook in Slack | Save an extraction; check the channel for the notification |
| **Browser extension** | `npm run build:extension`, load unpacked, paste `dq_live_` key | (none; user-side) | Right-click any page; check the notification |

---

**Last updated:** 2026-08-09
**Branch:** `Integration-with-outside-ecosystem` (after staging merge)
**Verified against:** the integration code as of merge commit `ec469fb`
