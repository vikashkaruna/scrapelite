# Zapier Integration

> Connect DatIQ to 5,000+ apps via Zapier. Trigger zaps on new
> extractions, enrichments, and monitoring alerts. Run actions: extract
> a URL, create a schedule, enrich an extraction.

## How it works

```
                  DatIQ                            Zapier
            ┌─────────────────┐              ┌─────────────────┐
   User     │                 │              │                 │
   action   │  scheduled-     │  poll        │  5000+ apps     │
 ─────────▶│  runner,        │─────────────▶│  the user's     │
            │  api-v1,        │  GET /poll   │  Zaps subscribe │
            │  notify.js      │  X-Zapier-   │  to events.     │
            │                 │  Token       │                 │
            │                 │◀─────────────│                 │
            │  zapier_events  │  events[]    │                 │
            │  (Supabase)     │              │                 │
            └─────────────────┘              └─────────────────┘
```

The flow is **polling-based**: DatIQ emits events to a `zapier_events`
table; Zapier polls `/api/integrations/zapier/poll` every 1–15 min and
reads any new events since the last cursor.

## Set up

### 1. Get a DatIQ Zapier token

1. In DatIQ, go to **Account → Integrations → Zapier**.
2. Click **Generate token**. The plaintext is shown ONCE — copy it
   into Zapier. DatIQ stores only the SHA-256 hash.

### 2. Create the Zapier integration

> **v1 ships with the integration definition as a JSON file
> (`docs/integrations/zapier-app.json`)** that you can submit to
> Zapier's private app program. Until it's publicly listed, install it
> via **Zapier → My Apps → Add Connection → Paste a Private App URL**.

The JSON defines three triggers and three actions; details below.

## Triggers

| Trigger | When it fires | Payload |
|---|---|---|
| `new_extraction` | A new extraction is saved. | `{ id, url, title, summary, created_at }` |
| `new_enrichment` | An enrichment (contacts / leadership / social / mission / pricing) completes. | `{ extraction_id, focus, data }` |
| `monitoring_alert` | A scheduled run detects a content change. | `{ schedule_id, url, label, previous_hash, new_hash, detected_at }` |

## Actions

| Action | Parameters | Returns |
|---|---|---|
| `extract_url` | `url`, `intent?` | Full extraction object (titles, headings, links, summary) |
| `create_schedule` | `url`, `cadence`, `intent?` | Schedule object |
| `enrich_extraction` | `extraction_id`, `focus` | `{ focus, data }` |

## Auth model

Zapier sends an `X-Zapier-Token` header on every call. The token is the
plaintext the user pasted during setup. DatIQ hashes it (SHA-256),
compares against the stored hash, and if it matches, scopes the
request to that user.

Tokens are prefixed `zap_` so they can't be confused with DatIQ API
keys (`dq_live_`).

## API reference

```
# Public (X-Zapier-Token required)
GET    /api/integrations/zapier/test         → { ok: true }  if token is valid
GET    /api/integrations/zapier/poll?event_type=...&since=ISO
GET    /api/integrations/zapier/actions      → list of available actions
POST   /api/integrations/zapier/action       { action, params }

# Internal (Supabase JWT required)
GET    /api/integrations/zapier/status
POST   /api/integrations/zapier/connect      { token | regenerate: true }
DELETE /api/integrations/zapier/connect
POST   /api/integrations/zapier/events       { event_type, payload, dedupe_key? }  # for internal callers
```

## Sample Zap

**"Save new extractions to Google Sheets"**

1. Trigger: **DatIQ → New Extraction**
2. Filter (optional): `summary contains "pricing"`
3. Action: **Google Sheets → Create Spreadsheet Row**
   - Spreadsheet: `DatIQ extractions`
   - Row: `{ "url": {{url}}, "title": {{title}}, "summary": {{summary}}, "created_at": {{created_at}} }`

That's it. Save the Zap, turn it on, and every new DatIQ extraction
lands as a row in your sheet.

## Operator notes

- The Zapier integration app is **private** until you publish it. The
  JSON file at `docs/integrations/zapier-app.json` is the source of
  truth.
- Polling is the right call here: webhooks from DatIQ would require
  a stable public hostname with a custom certificate, and polling
  is what 80% of small Zapier apps do.
- v1.1 will add OAuth (the user clicks "Connect DatIQ" inside Zapier
  and we redirect to a consent screen).
