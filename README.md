# ScrapeLite

> Extract a webpage's **headings** and **links** into clean, structured data — with an instant **AI summary**. No code required.

ScrapeLite is a single-page React app for non-technical researchers and content marketers. Paste a URL, preview the extracted structure + AI summary, and save it to your dashboard.

Built from a Claude Design handoff: **React + Vite + Tailwind + React Router + Lucide**, with a hand-crafted Slate + Indigo design system (light/dark).

---

## Quick start

```bash
npm install
cp .env.example .env   # optional — works fully without it
npm run dev
```

Open http://localhost:5173.

**Zero-config demo mode:** with no `.env`, ScrapeLite runs entirely on mock data — extraction and AI summaries are simulated, and saved history lives in your browser's `localStorage`. The whole flow is interactive out of the box.

---

## How the backend works

Every integration is **optional** and flips on automatically when its env var is present. You can enable them one at a time.

| Capability              | Env var(s)                                   | Without it                                  |
| ----------------------- | -------------------------------------------- | ------------------------------------------- |
| Database (history)      | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Falls back to `localStorage`                |
| Real page extraction    | `VITE_FIRECRAWL_API_KEY`                      | Mocked (2s delay + dummy structure)         |
| Real AI summary         | `VITE_AI_API_KEY` (+ optional `VITE_AI_MODEL`) | Mocked (short generated summary)            |
| Webhook on save         | `VITE_WEBHOOK_URL`                            | No-op                                       |

The service layer is split exactly as specified so engineering can swap mocks for real calls cleanly:

```
src/lib/
  config.js            # reads env, exposes hasSupabase / hasFirecrawl / hasAI / hasWebhook
  firecrawlService.js  # extractStructure(url) → { page_title, headings, links }
  aiService.js         # summarize(extraction) → string
  supabaseClient.js    # supabase client (null when not configured)
  extractionsRepo.js   # listExtractions / saveExtraction / deleteExtraction (Supabase ↔ localStorage)
  webhook.js           # notifyWebhook(extraction) — fire-and-forget POST
  utils.js             # url/host helpers, CSV export, validation
```

> ⚠️ **Security:** `VITE_*` vars are bundled into the browser. The anon key is safe **only** with Row Level Security enabled. The AI key is **not** safe to ship to a browser — the real `aiService` path is provided for local use; for production, proxy it through a backend / edge function.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the **Project URL** and **anon public key** into `.env`.
3. Run this in the SQL editor:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.extractions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  url               text not null,
  page_title        text,
  headings          jsonb not null default '[]'::jsonb,
  links             jsonb not null default '[]'::jsonb,
  ai_summary        text,
  -- v2.0 columns:
  custom_extraction jsonb,   -- structured output from Custom Schema / Contacts extraction
  domain_map        jsonb,   -- array of URLs from the "Map entire domain" feature
  enrichments       jsonb    -- map of Quick Enrichment results (one per capability), shown as tabs
);

alter table public.extractions enable row level security;

-- DEMO policy: anonymous read/write. Tighten (e.g. per-user) before production.
create policy "anon full access" on public.extractions
  for all using (true) with check (true);
```

### Upgrading an existing (v1) database to v2.0

If you already ran the v1 SQL, just add the two new columns — this is idempotent
and safe to run against a live table (existing rows get `null`):

```sql
alter table public.extractions
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;
```

> The app is resilient to a missing migration: if these columns don't exist yet,
> `saveExtraction` automatically retries with the v1 columns only (and keeps a full
> copy — including the v2 fields — in `localStorage`). Run the `alter table` above to
> persist `custom_extraction` / `domain_map` / `enrichments` in Supabase. The
> `enrichments` column stores the full Quick-Enrichment tab map so saved tabs sync
> across devices; live edits (running/refreshing a capability on a saved row) are
> patched into it automatically via `updateEnrichments`.

---

## Screens

- **`/` Home** — hero, URL input with validation + example chips, and a stepped “Parsing webpage…” loader.
- **`/preview` Preview** — page identity + counts, AI-summary card, nested H1–H6 outline, and a filterable (all / internal / external) link list. **Save to Dashboard** persists + redirects; **Discard** returns home.
- **`/dashboard` Dashboard** — table or card layout of saved extractions, each with **Export CSV**, View, and Delete. Layout choice persists.

## Scripts

```bash
npm run dev       # start dev server
npm run build     # production build → dist/
npm run preview   # preview the production build
```
