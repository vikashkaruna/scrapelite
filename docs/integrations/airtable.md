# Airtable Integration

> Push extraction rows straight into an Airtable base. Field mapping
> handles contacts, links, and headings automatically.

## Two paths, one outcome

| Path | Where the secret lives | Best for |
|---|---|---|
| **Browser adapter** (`src/lib/airtable.js`) | In the browser (user pastes the PAT) | Solo users, quick one-off pushes. |
| **Server-side proxy** (this branch) | In Supabase (`integration_connections.config.api_key`) | Teams sharing an Airtable base; users who don't want a secret in the browser. |

Both paths use the same `pushToAirtable` helper which chunks records
into 10-per-request batches (Airtable's hard cap).

## Set up

### 1. Create a Personal Access Token

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens).
2. Click **Create token**, name it `DatIQ`, set the scopes:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
3. Under **Access**, pick the base you want DatIQ to write to.
4. Copy the token (starts with `pat…`).

### 2. Get the Base ID and Table ID

- **Base ID**: open the base, look at the URL —
  `https://airtable.com/{BASE_ID}/...`. It starts with `app`.
- **Table ID**: in the URL of a specific table view, the segment after
  the base ID is the table ID. It starts with `tbl` (or `viw` for a
  view). You can also get it from the API docs page for the base.

### 3. Connect in DatIQ

1. **Account → Integrations → Airtable**.
2. Paste the token, base ID, table ID. Click **Connect**.
3. DatIQ probes Airtable (`GET /v0/meta/bases`) to confirm the token
   works, then stores everything server-side.

## Field mapping

Default mapping (override per column in the UI):

| Airtable column | DatIQ source |
|---|---|
| `URL` | `url` |
| `Title` | `page_title` |
| `Host` | `host` |
| `Summary` | `ai_summary` |
| `Created at` | `created_at` |
| `Headings` | `headings` (joined with `, `) |
| `Links` | `links` (joined with `, `) |

**Heads up:** the columns must exist in your Airtable table. If a
column doesn't exist, Airtable's API will reject the record. Use the
`typecast: true` flag (already on by default) to allow Airtable to
auto-convert values where possible.

## API

```
# Internal (Supabase JWT required)
GET    /api/integrations/airtable/status
POST   /api/integrations/airtable/connect   { apiKey, baseId, tableId }
DELETE /api/integrations/airtable/connect
POST   /api/integrations/airtable/push      { items, baseId?, tableId? }
```

## Limits and behaviour

- **Per-request cap**: 10 records (Airtable's hard limit). DatIQ
  chunks larger pushes automatically.
- **Per-push cap**: 100 records (10 chunks). Larger pushes return
  `ok: false, errors: ["100 record(s) failed"]`. Split the push
  yourself.
- **No dedup**: the push always creates new records. Re-pushing the
  same URL produces duplicates. v1.1 will add dedup by URL.
- **String-only columns**: complex values (arrays, objects) are
  joined or JSON-stringified. The adapter tries to keep the data
  human-readable; if you need a true relation, add a follow-up Zap.

## Operator notes

- Airtable PATs are scoped to specific bases. The token is stored in
  `integration_connections.config.api_key` in plaintext for v1. v1.1
  will wrap it in a pgcrypto envelope.
- For high-volume pushes (>1000 rows), use the Airtable batch
  endpoint directly via a one-off script — the v1 SPA path is
  optimised for tens of rows, not thousands.
