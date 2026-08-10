# HubSpot Integration

> Push DatIQ extraction data (contacts + companies) into a HubSpot CRM.
> Auto-create contacts from the `contacts` / `leadership` enrichment;
> enrich existing records on dedup.

## How it works

```
            DatIQ SPA                                 HubSpot CRM
        ┌──────────────┐                          ┌──────────────┐
        │ Account →    │ POST /api/integrations/  │  contacts    │
        │ HubSpot tab  │ hubspot/connect         │  companies   │
        │              │ { accessToken }         │              │
        │  paste the   │─────────────────────────▶│  store token │
        │  Private App │                          │  in CRM      │
        │  token       │                          └──────────────┘
        └──────────────┘                                  ▲
              │                                           │
              │ POST /api/integrations/hubspot/push       │  POST /crm/v3/objects/contacts
              │ { extraction: {...} }                     │  POST /crm/v3/objects/companies
              │─────────────────────────────────────────▶│  PATCH /crm/v3/objects/contacts/{id}
                                                        │  PATCH /crm/v3/objects/companies/{id}
```

## Set up

### 1. Create a HubSpot Private App

1. In HubSpot, go to **Settings → Integrations → Private Apps**.
2. Click **Create a private app**, name it `DatIQ`.
3. Grant these scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
4. Click **Create app**, then **Show token**. Copy the token — it starts
   with `pat-na1-…`.

### 2. Connect DatIQ to HubSpot

1. In DatIQ, go to **Account → Integrations → HubSpot**.
2. Paste the Private App token, click **Connect**.
3. DatIQ probes HubSpot to confirm the token works and stores it
   server-side. The token is never returned to the browser again.

### 3. Push an extraction

When you're on the Preview page (or via the API), click **Push to
HubSpot**. DatIQ will:

- **Search** HubSpot for a company whose `domain` matches the
  extraction's host. If found, **PATCH** the record. Otherwise **POST**
  a new company.
- For every contact in the extraction's `contacts` / `leadership`
  enrichment that has an email, **search** by email. If found, **PATCH**.
  Otherwise **POST**.

The response tells you the HubSpot ids of the created/updated records
and a count summary.

## API

```
POST   /api/integrations/hubspot/connect
       Body: { accessToken, accountLabel? }
       Effect: probe + store the token.

GET    /api/integrations/hubspot/status
       Returns: { connected, provider, connection: { ... } }
       (never returns the access_token)

DELETE /api/integrations/hubspot/connect
       Effect: remove the stored token.

POST   /api/integrations/hubspot/push
       Body: { extraction, contactMapping?, companyMapping? }
       Returns: {
         ok, company: { ok, id, created },
         contacts: [{ name, ok, id, created, error? }],
         counts: { contacts_attempted, contacts_created, contacts_updated },
       }
```

## Field mapping

Defaults:

| DatIQ → HubSpot Contact | Source key |
|---|---|
| `email` | `email` |
| `firstname` | `first_name` |
| `lastname` | `last_name` |
| `phone` | `phone` |
| `company` | `company` |
| `jobtitle` | `role` |
| `website` | `website` |
| `datiq_source_url` | `source_url` |
| `datiq_extraction_id` | `extraction_id` |

| DatIQ → HubSpot Company | Source key |
|---|---|
| `name` | `page_title` |
| `domain` | `host` |
| `description` | `ai_summary` |
| `website` | `url` |

Users can override per-field by passing
`{ contactMapping: { email: "email", jobtitle: "title" }, ... }` in the
push body. v1.1 will add a UI editor in the Account page.

## Operator notes

- All HubSpot calls are server-side. The browser never sees the
  access_token after the connect step.
- HubSpot has a 110 req / 10 sec rate limit per portal. DatIQ respects
  it implicitly (a single push is ≤ 1 + N requests for N contacts) but
  for very large pushes consider adding batch chunking — flagged for
  v1.1.
- The token is stored in plaintext in `integration_connections`. v1.1
  will wrap it in a pgcrypto envelope.
