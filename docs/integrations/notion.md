# Notion Integration

> Export structured extraction data to a Notion database. Field mapping
> handles contacts, links, headings automatically.

## Two paths, one outcome

| Path | Where the secret lives | Best for |
|---|---|---|
| **Browser adapter** (`src/lib/notion.js`) | In the browser (user pastes the Notion secret) | Solo users, quick one-off pushes. The secret is kept in `localStorage` only for the duration of the session. |
| **Server-side proxy** (this branch) | In Supabase (`integration_connections.config.api_key`) | Teams sharing a Notion workspace; users who don't want a secret in the browser. |

Both paths use the same underlying adapter — `pushToNotion` chunks the
items, builds the property payloads, and POSTs to the Notion API.

## Set up

### 1. Create a Notion Internal Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Click **New integration**, name it `DatIQ`, set the workspace.
3. Under **Capabilities**, enable **Read content** + **Update content**
   + **Insert content**.
4. Copy the **Internal Integration Secret** (starts with `secret_` or
   `ntn_`).

### 2. Share the database with DatIQ

1. In Notion, open the database you want DatIQ to write to.
2. Click **...** → **Connections** → add `DatIQ`.

The integration can only see databases it's been explicitly shared with.

### 3. Get the Database ID

The Database ID is in the URL when you have the database open:

```
https://www.notion.so/{workspace}/{DATABASE_ID}?v={view}
                                       ▲
                          32-char UUID (dashes optional)
```

### 4. Connect in DatIQ

1. **Account → Integrations → Notion**.
2. Paste the integration secret + database ID.
3. DatIQ fetches the database schema and shows you the column → DatIQ
   field mapping. Adjust if needed, then click **Save**.

## Field mapping

Default schema (override per column in the UI):

| Notion column | Type | DatIQ source |
|---|---|---|
| `Title` | `title` | `page_title` |
| `URL` | `url` | `url` |
| `Host` | `rich_text` | `host` (falls back to URL hostname) |
| `Summary` | `rich_text` | `ai_summary` |
| `Headings` | `rich_text` | `headings` (joined with `, `) |
| `Created` | `date` | `created_at` |

## API

```
# Internal (Supabase JWT required)
GET    /api/integrations/notion/status
POST   /api/integrations/notion/connect   { apiKey, databaseId }
DELETE /api/integrations/notion/connect
POST   /api/integrations/notion/schema    { apiKey?, databaseId? } → properties, titleColumn
POST   /api/integrations/notion/push      { items: [...], databaseId?, schema? }
```

The push endpoint is rate-limited to 25 pages per request by the
adapter (Notion's API has a 3 req/sec cap; 25 sequential calls ≈ 8
seconds — well within the SPA's perceived latency).

## Property types we know how to set

`title`, `rich_text`, `url`, `number`, `checkbox`, `select`,
`multi_select`, `date`, `email`, `phone_number`. Unknown types fall
back to `rich_text`. The schema endpoint returns the database's
declared property types so the UI can render the right editor.

## Operator notes

- The API secret is stored in `integration_connections.config` in
  plaintext for v1. v1.1 will wrap it in a pgcrypto envelope.
- Notion's API requires a database ID; pages can only be created in
  pre-existing databases, not on-the-fly.
- The push is one-way: DatIQ creates new pages; it does NOT update
  existing ones. If you re-push the same URL you'll get a duplicate
  row. v1.1 will add dedup by URL.
