# Enablements + TODOs

> The code is shipped. This document lists the things that **only you
> (the operator) can do** to make each integration live. The build
> succeeds and all 214 new tests are green; the work below is external
> registration, secrets, and one-time platform approvals.

---

## TL;DR — the operator's checklist

```
[ ]  1.  Run 3 new SQL migrations in Supabase (staging + production).
[ ]  2.  Wire the new /api/integrations/* redirect (already in netlify.toml).
[ ]  3.  Smoke-test /api/v1/_health on staging.
[ ]  4.  Create a HubSpot Private App + paste the token via the API.
[ ]  5.  Create a Notion Internal Integration + share the database.
[ ]  6.  Create an Airtable PAT + share the base.
[ ]  7.  Configure a Slack incoming webhook (or set SLACK_WEBHOOK_URL).
[ ]  8.  (Optional) Submit the Zapier app to Zapier's Private App program.
[ ]  9.  (Optional) Build the browser extension and load it unpacked.
[ ] 10.  (Optional) Publish the browser extension to the Chrome / Firefox stores.
[ ] 11.  (Optional) Add a UI for the integrations on the Account page.
```

Items 1–3 are required for any of the integrations to work end-to-end.
Items 4–10 are platform-specific enablements you do once. Item 11 is
a follow-up (the API surface is fully wired; the Account page UI is
optional — the user can manage everything via the API).

---

## 1. Run the new SQL migrations

Three new files in `supabase/migrations/`:

```
0019_api_keys.sql                ← public REST API key storage
0020_integration_connections.sql ← per-user OAuth/PAT storage
0021_zapier_events.sql           ← Zapier event log
```

**Run them in this order in the Supabase SQL editor** (project dashboard
→ SQL → New query → paste → Run):

```sql
-- Paste each file's contents in order, one at a time.
-- Each is idempotent (uses `create table if not exists`).
```

**Verify:**

```sql
-- Should return 3 rows.
select tablename from pg_tables
  where schemaname = 'public'
    and tablename in ('api_keys', 'integration_connections', 'zapier_events');

-- Should return 1 row.
select proname from pg_proc
  where proname = 'increment_api_key_usage';
```

**Then regenerate the SQL bundle** so the migrations are picked up by
`scripts/migrate-prod.mjs`:

```bash
npm run build:sql
git add supabase/migrations/run-all.sql
git commit -m "chore: regenerate run-all.sql with the three new migrations"
```

---

## 2. /api/integrations/* redirect

Already added to `netlify.toml`:

```toml
[[redirects]]
  from = "/api/integrations/*"
  to = "/.netlify/functions/integrations-router?splat=:splat"
  status = 200
  force = true
```

**No action needed** — it ships with the branch.

---

## 3. Smoke-test the public API

After the deploy to staging:

```bash
# Unauthenticated health check
curl https://staging--datiqapp.netlify.app/api/v1/_health
# → { "ok": true, "version": "v1", "ts": "..." }

# Unauthenticated (must return 401)
curl https://staging--datiqapp.netlify.app/api/v1/extractions
# → { "error": { "code": "unauthorized", "message": "..." } }
```

If the health check returns 200 but the 401 returns a different shape,
check the netlify.toml redirect order — `/api/v1/*` must come BEFORE
`/api/integrations/*` which must come BEFORE `/api/*`.

---

## 4. HubSpot — one-time setup

> Full step-by-step in `docs/integrations/hubspot.md`.

1. HubSpot → **Settings → Integrations → Private Apps → Create**.
2. Name: `DatIQ`. Scopes: `crm.objects.contacts.{read,write}`,
   `crm.objects.companies.{read,write}`.
3. Copy the token (starts with `pat-na1-…`).
4. Connect via the API (the Account page UI is a follow-up):

   ```bash
   curl -X POST https://datiq.app/api/integrations/hubspot/connect \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"accessToken": "pat-na1-…", "accountLabel": "ACME Hub"}'
   ```

5. Push an extraction:

   ```bash
   curl -X POST https://datiq.app/api/integrations/hubspot/push \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"extraction": { "url": "https://acme.com", "page_title": "Acme", "host": "acme.com", "ai_summary": "Acme does X", "enrichments": { "contacts": { "data": { "people": [{ "name": "Jane Doe", "email": "jane@acme.com", "role": "CEO" }] } } } }}'
   ```

   → `{ "ok": true, "company": { "id": "co-1", "created": true }, "contacts": [...], "counts": {...} }`

---

## 5. Notion — one-time setup

> Full step-by-step in `docs/integrations/notion.md`.

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration** → name `DatIQ` → copy secret.
2. Open your database in Notion → **... → Connections → add DatIQ**.
3. Get the database ID from the URL (32-char UUID).
4. Connect via the API:

   ```bash
   curl -X POST https://datiq.app/api/integrations/notion/connect \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"apiKey": "secret_…", "databaseId": "abc123…"}'
   ```

5. Push:

   ```bash
   curl -X POST https://datiq.app/api/integrations/notion/push \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"items": [{ "url": "https://acme.com", "page_title": "Acme", "host": "acme.com", "ai_summary": "Acme does X" }]}'
   ```

---

## 6. Airtable — one-time setup

> Full step-by-step in `docs/integrations/airtable.md`.

1. [airtable.com/create/tokens](https://airtable.com/create/tokens) → **Create token** → name `DatIQ` → scopes: `data.records.{read,write}`, `schema.bases:read` → access: pick your base.
2. Get the **Base ID** (`app…`) and **Table ID** (`tbl…`) from the URL.
3. Connect via the API:

   ```bash
   curl -X POST https://datiq.app/api/integrations/airtable/connect \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"apiKey": "pat…", "baseId": "app…", "tableId": "tbl…"}'
   ```

4. Push:

   ```bash
   curl -X POST https://datiq.app/api/integrations/airtable/push \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"items": [{ "url": "https://acme.com", "page_title": "Acme", "host": "acme.com", "ai_summary": "Acme does X" }]}'
   ```

---

## 7. Slack — one-time setup

> Full step-by-step in `docs/integrations/slack.md`.

### Option A: global (operator; for self-hosted)

```bash
# .env or Netlify env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXX
```

All monitored-URL-change alerts and new-extraction events post to this
webhook. Works today; the existing `scheduled-runner.js` already uses
this.

### Option B: per-user (via API; UI is a follow-up)

```bash
curl -X POST https://datiq.app/api/integrations/slack/connect \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://hooks.slack.com/services/T111/B111/YYY"}'
```

`notify.js` already reads the per-user webhook when one is set (it
falls back to the global env var when not). Test it:

```bash
curl -X POST https://datiq.app/api/integrations/slack/test \
  -H "Authorization: Bearer $USER_JWT"
```

---

## 8. Zapier — one-time setup (optional)

> Full step-by-step in `docs/integrations/zapier.md`.
> The integration is "private" until you publish it.

1. DatIQ → **Account → Integrations → Zapier** → click **Generate
   token**. Copy the `zap_…` plaintext.
2. In Zapier, go to **My Apps → Add Connection → Paste a Private App
   URL** and paste the JSON at
   `https://datiq.app/docs/integrations/zapier-app.json`. (Zapier
   will register the three triggers and three actions.)
3. Test the connection — Zapier's "Test trigger" should call
   `GET /api/integrations/zapier/test` and see `{ ok: true }`.
4. (Optional) Submit the app to Zapier's Private App program for
   listing. v1 ships with the JSON; the public listing is a
   one-time approval.

---

## 9. Browser extension — local install

> Full step-by-step in `docs/integrations/browser-extension.md`.

```bash
npm run build:extension
# Output: dist-extension/

# Chrome / Edge / Brave:
#   1. Open chrome://extensions
#   2. Toggle "Developer mode"
#   3. Click "Load unpacked" → pick the dist-extension/ directory
#   4. Click the DatIQ icon → paste your dq_live_… API key
```

---

## 10. Browser extension — store publication (optional, one-time)

| Store | Cost | Lead time | Notes |
|---|---|---|---|
| Chrome Web Store | $5 one-time | 1–3 days review | Needs a privacy policy URL; see the policy in `docs/PRIVACY.md` (existing). |
| Firefox Add-ons | Free | 1–3 days review | Same MV3 manifest works. |
| Edge Add-ons | Free | 1–3 days review | Reuse the Chrome Web Store build. |

For each store:

1. Zip `dist-extension/` into `datiq-extension-v1.0.0.zip`.
2. Create a developer account.
3. Upload the zip, fill the listing (description, screenshots, category
   → "Productivity").
4. Submit. The reviewer will run through the popup flow; the only
   thing you must demonstrate is that the "Extract" button returns a
   2xx response from the API.

---

## 11. (Optional) Account page UI

The API surface is fully wired. The Account page itself doesn't yet
have UI for these integrations. Two options:

**Option A (recommended for v1.0):** ship as-is. Power users use the
curl examples above; this is consistent with how the existing
`/account` page handles Stripe / Razorpay / Resend / OpenAI key
configuration — many of those are also env-var-only.

**Option B (v1.1):** build the UI. Suggested entry point: a new
`/account/integrations` route (or a tab on the existing `/account`)
that lists the seven integrations as cards. Each card has:
- **HubSpot / Notion / Airtable / Slack** — Connect / Disconnect
  buttons; for HubSpot/Notion/Airtable a "Push current extraction"
  button appears after connect.
- **API Access** — Create key / Revoke key, with the plaintext shown
  once on creation. Documented in the existing
  `DatIQ-Developer-API.md`; only the UI bits are missing.
- **Zapier** — Generate token / Revoke.
- **Browser extension** — link to the install doc.

The handlers are at `netlify/functions/integrations-*.js`; the
client-side wrappers at `src/lib/apiClient.js` need a few new methods
(e.g. `apiClient.hubspotStatus()`, `apiClient.hubspotConnect(...)`,
etc.). I left these as a v1.1 follow-up so the surface is testable
without the UI.

---

## 12. (Optional) v1.1 backlog

These are NOT in this branch but are flagged for the next iteration:

- **Per-user Slack webhooks** — the column is already in the schema;
  the dispatcher in `notify.js` already reads it. Just needs the UI
  in the Account page.
- **HubSpot OAuth** — replace the Private App token flow with a proper
  OAuth handshake (scopes are user-granular instead of app-granular).
- **Notion dedup** — search by URL before creating a new page.
- **Airtable dedup** — same.
- **Zapier OAuth** — public listing requires OAuth instead of a
  per-Zap secret.
- **pgcrypto envelope** for tokens in `integration_connections` —
  adds `pgp_sym_encrypt` to wrap access_token, refresh_token, and
  webhook URLs.
- **v1.1 schema for api_keys** — split `env` into `test` and `live`
  tables; add a `last_ip` audit column.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401` from `/api/v1/extractions` | The bearer header is missing or malformed. Expect `Authorization: Bearer dq_live_…`. |
| `503` from `/api/v1/extractions` | Supabase is unreachable OR the SUPABASE_SERVICE_KEY is missing. Check `netlify env:list`. |
| `403` from `/api/v1/extractions` | The key's plan doesn't include this capability (free / starter / pro don't have API access). |
| `429` from `/api/v1/extractions` | Per-minute rate limit hit. Wait `Retry-After` seconds. |
| `402` from `/api/v1/extractions` | Monthly quota exhausted. Issue a new key or upgrade. |
| HubSpot push returns 4xx | Most often: the user is on a free HubSpot portal that doesn't allow contacts writes. Upgrade the HubSpot portal. |
| Notion push returns 401 | The integration secret is wrong, or the database wasn't shared with the integration. |
| Airtable push returns 422 | A column doesn't exist in the table. Either add it or pass `typecast: true` (already on by default). |
| Slack test fails | The webhook URL is wrong or revoked. Re-create it in Slack. |
| Zapier trigger never fires | Polling is 1–15 min. Wait one cycle, then check `GET /api/integrations/zapier/poll?since=…` to see whether events are being logged. |

---

## What ships with this branch — recap

```
docs/INTEGRATIONS.md                  ← the user's entry point
docs/ENABLEMENTS.md                   ← this file
docs/integrations/hubspot.md
docs/integrations/zapier.md
docs/integrations/slack.md
docs/integrations/notion.md
docs/integrations/airtable.md
docs/integrations/browser-extension.md
docs/integrations/zapier-app.json

netlify/functions/api-v1.js                       ← public REST API
netlify/functions/integrations-router.js          ← /api/integrations/*
netlify/functions/integrations-hubspot.js
netlify/functions/integrations-zapier.js
netlify/functions/integrations-slack.js
netlify/functions/integrations-notion.js
netlify/functions/integrations-airtable.js
netlify/functions/lib/{apiKeyService,apiKeyStore,apiAuth,apiRateLimiter,apiV1Internals,
                       hubspotService,integrationConnectionStore,notify,
                       zapierEventStore,zapierEmitter}.js

supabase/migrations/0019_api_keys.sql
supabase/migrations/0020_integration_connections.sql
supabase/migrations/0021_zapier_events.sql

extensions/datiq-extension/                ← MV3 extension
scripts/build-extension.mjs
```

214 new tests, 16 new test files, 0 pre-existing tests broken. The
PR is ready to open.
