# DatIQ — The Unified Web Intelligence Platform

> **Data + IQ.** DatIQ is the unified web intelligence platform. Its foundation, **Pillar 0 (Web Intelligence Core)**, is the proven single, batch, and scheduled URL-extraction engine that the rest of the product is layered on. **Intelligence from Web.**

DatIQ turns a URL into a clean, machine-readable record: headings, links, an AI summary, and up to five one-click enrichments (contacts, social links, company mission, pricing, leadership). Everything works out of the box in demo mode; connecting real API keys switches each service on independently.

**Website:** datiq.app · **Stack:** React 18 · Vite 5 · Tailwind CSS · React Router 6 · Lucide Icons

---

## Contents

**Product**
1. [What DatIQ Does](#1-what-datiq-does)
2. [Screens & Workflows](#2-screens--workflows)
3. [Extraction Capabilities](#3-extraction-capabilities)
4. [Quick Enrichment Presets](#4-quick-enrichment-presets)
5. [Content Generation](#5-content-generation)
6. [Export Formats](#6-export-formats)
7. [Zero-config Demo Mode](#7-zero-config-demo-mode)

**Developer**

8. [Quick Start](#8-quick-start)
9. [Environment Variables](#9-environment-variables)
10. [Runtime Config Override](#10-runtime-config-override)
11. [Supabase Setup & Schema](#11-supabase-setup--schema)
12. [Architecture & File Map](#12-architecture--file-map)
13. [Services API Reference](#13-services-api-reference)
14. [Data Models](#14-data-models)
15. [Link Categories](#15-link-categories)
16. [Error Handling](#16-error-handling)

---

# PRODUCT

---

## 1. What DatIQ Does

Paste any public URL and DatIQ returns:

- **Heading structure** — the full H1–H6 outline in DOM order
- **Every link** — internal and external, deduplicated, AI-categorised
- **AI summary** — a plain-English paragraph describing the page's intent and structure
- **Enrichments** — one-click deep dives: contacts, leadership, social links, company mission, pricing plans
- **Domain map** — every indexed URL on a site discovered in one shot
- **Custom extraction** — describe any field in plain English; the LLM extracts it as structured JSON

All results are saved to your dashboard and exportable as CSV, PDF, or email.

---

## 2. Screens & Workflows

### Home — Extract

The starting point. Paste a URL, choose your options, hit **Extract**.

**URL input**
- Accepts URLs with or without the `https://` prefix (normalised automatically)
- Three example chips: `lumio.io`, `stripe.com/pricing`, `notion.so/help` — click to pre-fill
- Inline validation with a red error state and friendly message

**Extraction options (four toggles)**

| Toggle | What it does |
|--------|-------------|
| **Render JavaScript** | Waits 3 s for client-side JS before capturing. Use for SPAs and dynamic pages. |
| **Map entire domain** | Discovers all indexed URLs on the site via Firecrawl's `/map` endpoint. Replaces single-page scrape. |
| **Contacts & emails** | Runs a focused extraction for senior leadership, board members, and general contact emails. |
| **Custom extraction** | Reveals a free-text prompt box. Describe any field and the LLM extracts it as JSON. |

**Custom extraction prompt box**
Shown when *Custom extraction* is toggled on. Includes five **Quick Action** preset chips below the textarea:
- Find Contact Info · Leadership & Board · Social Links · Company Mission · Pricing & Plans

Clicking a chip populates the prompt with the preset's instruction. You can edit it freely before submitting.

**Capability cards**
Eight cards below the options describe every feature at a glance — three V1 (heading structure, every link, AI summary) and five V2 additions.

---

### Preview — Review & Enrich

Shown after every extraction. The page stays visible at all times; enrichments load in the background without any full-screen interruption.

**Page header**
Favicon dot, page title, clickable URL, and stats (heading count, link count, or URL count for domain maps).

**AI Summary card**
The generated overview of the page. Always shown, always the first thing to read.

**Quick Enrichment panel**
Five buttons, one per preset. Click any button to run that capability in the background:
- A spinner replaces the icon while running
- A checkmark badge marks it as complete
- The result appears as a new tab, named after the capability

**Tabs**
- **Overview** tab — always first; shows the heading outline and categorised link list (or domain map URL list)
- One **enrichment tab** per executed preset — shows the structured data returned, with a **Refresh** button to re-run

**Heading list (Overview)**
Indented by level, colour-coded by depth, tag pills (H1–H6), word-wrap safe.

**Link list (Overview)**
Filterable by **All / Internal / External**. Each row shows the favicon dot, anchor text, host+path breakdown, and an AI-assigned category badge (Internal, External, Social, Email, Document, Media). Category counts shown in the card subtitle.

**Domain map (Overview, when map mode was used)**
A searchable list of every discovered URL. Inline filter field with instant results.

**Enrichment tab content**
Structured data rendered by the StructuredData component — handles arbitrary JSON depth: arrays of objects, nested objects, plain scalars, email links, and URL links all render cleanly.

**Actions**
- **Save to Dashboard** — persists the extraction (Supabase when configured, localStorage always); navigates to Dashboard on success
- **Discard** — dismisses the extraction and returns to Home
- **Refresh** (on enrichment tabs) — re-runs the capability with the same prompt

---

### Dashboard — Manage & Export

A searchable, paginated record of everything you have saved.

**Header actions**
- Layout toggle: **Table** view or **Card** view (preference saved)
- **CSV** and **PDF** export buttons (export selected rows, or all if none selected)
- **New extraction** button

**Smart search**
Searches across page title, URL, AI summary, all headings, and all link text simultaneously. Multiple words are treated as AND conditions. Results are live-filtered as you type.

**Table view columns**

| Column | Content |
|--------|---------|
| ☐ | Row selection checkbox |
| Page | Favicon dot + page title + URL |
| AI summary | Truncated summary (150 chars) |
| Structure | Heading count + link count |
| Extracted | Date of extraction |
| Actions | View · Delete |

**Card view**
Compact cards with title, URL, summary snippet, heading/link/time meta, and row actions.

**Selection bar**
Appears above the table/grid when one or more rows are checked:
- Selected count
- **Clear** — deselects all
- **Generate** — opens the Content Generation modal for the first selected item
- **Send email** — opens the email modal for all selected items

**Pagination**
Row count adapts to the viewport height automatically (clamped between 4 and 24 rows). Navigation shows page numbers with ellipsis for large ranges and a "Showing X–Y of Z" counter.

**Modals**
- **Email modal** — recipient input (comma/space/semicolon-separated), validates each address, previews the items being sent
- **Content modal** — choose a content format, view and copy the generated markdown

---

## 3. Extraction Capabilities

Eight capabilities in total — three run automatically on every extraction; five are opt-in.

### Always-on

| # | Capability | What it returns |
|---|------------|-----------------|
| 1 | **Heading structure** | Every H1–H6 in DOM order as `{tag, text}` |
| 2 | **Every link** | All `<a href>` elements, deduped, with category tags |
| 3 | **AI summary** | A 3–5 sentence plain-English overview of the page |

### Opt-in

| # | Capability | How to trigger | What it returns |
|---|------------|----------------|-----------------|
| 4 | **Custom extraction** | Toggle on Home → write a prompt | Arbitrary JSON matching your description |
| 5 | **Domain mapping** | Toggle "Map entire domain" on Home | Array of all indexed URLs on the domain |
| 6 | **Contacts & emails** | Toggle "Contacts & emails" on Home | Structured array of contacts with names, titles, emails |
| 7 | **Content generation** | Dashboard → select → Generate | Markdown content in your chosen format |
| 8 | **Quick enrichment** | Preview → click a preset button | Structured capability data saved as a persistent tab |

---

## 4. Quick Enrichment Presets

Five one-click presets available on the Preview screen. Each runs as a background extraction; the page stays visible and a new tab appears with the result. Running the same preset again refreshes its tab.

| Preset | Key | What it extracts |
|--------|-----|-----------------|
| **Find Contact Info** | `contacts` | Names, titles, emails, and phone numbers for key contacts and general company contact details |
| **Leadership & Board** | `leadership` | Full names, job titles, and emails of senior leadership, C-suite, founders, and board members |
| **Social Links** | `social` | All social media profile URLs: LinkedIn, Twitter/X, Facebook, Instagram, YouTube, GitHub, and others |
| **Company Mission** | `mission` | The mission statement, value proposition, and a concise description of what the company does |
| **Pricing & Plans** | `pricing` | Every pricing tier: plan name, price, billing period, and key features included |

Enrichment results persist — they reload as tabs whenever you return to an extraction via Dashboard → View.

---

## 5. Content Generation

Available from the Dashboard after selecting one or more extractions. Click **Generate** to open the modal, choose a format, and copy the output.

| Format | Description | Output |
|--------|-------------|--------|
| **SEO Blog Outline** | An SEO-optimised blog post structure | Working title, meta description (≤155 chars), 4–6 H2 sections with H3 sub-points, and target keywords |
| **Competitor Summary** | A competitive brief for sales/strategy | Sections: what they do, positioning, target customers, strengths, gaps |
| **Social Posts** | Three LinkedIn-tone social posts | Three numbered posts, ≤3 sentences each, with a light hook |

Output is markdown. Copy with one click from the modal.

---

## 6. Export Formats

### CSV

Exports all capabilities in a flat, analysis-ready format.

**When:** Click **CSV** in the Dashboard header. Exports selected rows (if any), otherwise all filtered rows.

**Filename:** `datiq-{host}-{id}.csv` (single) · `datiq-export-{n}-pages.csv` (multiple)

**Columns:** `page, type, name, text, value`

**Row types:**

| type | name | text | value |
|------|------|------|-------|
| `meta` | `url` | the URL | — |
| `meta` | `title` | page title | — |
| `meta` | `summary` | AI summary | — |
| `heading` | H1–H6 tag | heading text | — |
| `link` | category | anchor text | href |
| `mapped-url` | — | — | URL |
| `enrichment` | capability label | JSON path | value |

Enrichment data is fully flattened — nested objects become dotted paths (`contacts[0].name`), arrays are indexed (`contacts[0]`, `contacts[1]`).

### PDF

A readable report, one extraction per page.

**When:** Click **PDF** in the Dashboard header. Same selection logic as CSV.

**Filename:** `datiq-{host}-{id}.pdf` · `datiq-export-{n}-pages.pdf`

**Sections per page:** Title · URL · extraction date · AI summary · domain map (if applicable) · headings · links · enrichment sections (each capability as a named section with flattened fields)

### Email

**When:** Select rows in Dashboard → **Send email** → enter recipients.

Recipients can be entered as a comma, space, or semicolon-separated list. Each address is validated before sending.

**Delivery order:**
1. Webhook (`VITE_WEBHOOK_URL`) — preferred; your backend handles the send
2. Email API (`VITE_EMAIL_API_URL`) — direct API call
3. **Mailto fallback** — opens the user's email client with a pre-filled draft (works with zero configuration)

---

## 7. Zero-config Demo Mode

DatIQ runs fully without any API keys. Every feature is functional with mock data — use it as an interactive demo or for local development before connecting real services.

| Feature | No config | With API keys |
|---------|-----------|---------------|
| URL extraction | ✓ Mock data, 2 s delay | Real Firecrawl extraction |
| Heading structure | ✓ | Same (parsed from real HTML) |
| Every link | ✓ | Same (parsed from real HTML) |
| AI summary | ✓ Synthetic paragraph | Real Claude summary |
| Link categorisation | ✓ Heuristics only | Heuristics + AI refinement |
| Custom extraction | ✓ Shape-aware mock JSON | Real LLM extraction |
| Domain mapping | ✓ ~15–20 synthetic URLs | Real Firecrawl /map |
| Contacts & emails | ✓ 6 synthetic contacts | Real LLM extraction |
| Content generation | ✓ Procedural markdown | Real Claude output |
| Quick enrichment | ✓ All 5 presets, mock data | Real LLM extraction |
| Saved history | ✓ localStorage | Supabase (multi-device) |
| Email | ✓ Mailto fallback | Webhook or email API |

---

---

# DEVELOPER

---

## 8. Quick Start

```bash
# Install dependencies
npm install

# Copy environment template (everything optional)
cp .env.example .env

# Start dev server
npm run dev            # → http://localhost:5173
```

```bash
# Production build
npm run build          # → dist/

# Preview production build locally
npm run preview
```

> **Note:** Vite reads `.env` once at startup. After changing any `VITE_*` variable, restart the dev server.

---

## 9. Environment Variables

All variables are prefixed with `VITE_` (exposed to the browser by Vite at build time). All are optional — the app falls back to demo mode for any missing value.

| Variable | Type | Purpose | Default |
|----------|------|---------|---------|
| `VITE_SUPABASE_URL` | URL | Supabase project endpoint | — (localStorage fallback) |
| `VITE_SUPABASE_ANON_KEY` | string | Supabase public anon key — enable RLS | — (localStorage fallback) |
| `VITE_FIRECRAWL_API_KEY` | string | Firecrawl API key (firecrawl.dev) | — (mock extraction) |
| `VITE_AI_API_KEY` | string | Anthropic Claude API key ⚠️ browser-exposed | — (mock summaries) |
| `VITE_AI_MODEL` | string | Claude model ID | `claude-haiku-4-5-20251001` |
| `VITE_WEBHOOK_URL` | URL | Webhook for `extraction.saved` + `email.send` events | — (no webhook) |
| `VITE_EMAIL_API_URL` | URL | Dedicated email API endpoint | — (mailto fallback) |

> ⚠️ **Security:** `VITE_AI_API_KEY` is bundled into the browser build. Safe for local development and internal demos. For production, proxy Anthropic API calls through a Netlify Function or similar edge runtime.

**Configuration combinations**

| Keys present | Behaviour |
|---|---|
| None | Full demo mode: mocks + localStorage |
| Firecrawl only | Real web scraping; mocked AI |
| Firecrawl + AI | Real extraction + real summaries + AI link categorisation + content generation |
| Firecrawl + AI + Supabase | Full real stack with multi-device sync |
| All keys + Webhook | Full production setup with event notifications |

---

## 10. Runtime Config Override

`public/runtime-config.js` is a static file loaded at browser startup — it is **not** bundled by Vite, so values can be changed without a rebuild or redeploy.

**When to use it:** Switching webhook endpoints between test and production n8n workflows, or overriding any endpoint in a deployed build without a code push.

**How it works:**
1. `runtime-config.js` sets `window.__DATIQ_RUNTIME__`
2. `src/lib/config.js` reads the runtime object at module load
3. A non-empty runtime value overrides the matching `VITE_*` build-time value

**Current defaults (auto-selects by hostname):**
```js
// public/runtime-config.js
var _isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
window.__DATIQ_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://vkaruna.app.n8n.cloud/webhook-test/datiq"   // n8n test webhook
    : "https://vkaruna.app.n8n.cloud/webhook/datiq",        // n8n production webhook
  emailApiUrl: ""   // leave empty to use VITE_EMAIL_API_URL
};
```

**To override an endpoint without rebuilding:**
- Dev: Edit `public/runtime-config.js` → reload the browser tab
- Prod: Replace `public/runtime-config.js` on the server → users see the new value on next page load (no CDN cache invalidation needed for HTML)

**Config resolution order** (highest priority first):
1. `window.__DATIQ_RUNTIME__` (non-empty)
2. `import.meta.env.VITE_*` (baked in at build)
3. Empty string (feature disabled)

Scheme-less values (e.g. `mywebhook.example.com/hook`) are auto-prefixed with `https://`.

---

## 11. Supabase Setup & Schema

### Initial setup

1. Create a project at [supabase.com](https://supabase.com)
2. Copy **Project URL** and **anon public key** into `.env`
3. Run the following SQL in the Supabase SQL editor:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.extractions (
  id                uuid        primary key default gen_random_uuid(),
  created_at        timestamptz not null    default now(),
  url               text        not null,
  page_title        text,
  headings          jsonb       not null    default '[]'::jsonb,
  links             jsonb       not null    default '[]'::jsonb,
  ai_summary        text,
  custom_extraction jsonb,
  domain_map        jsonb,
  enrichments       jsonb
);

alter table public.extractions enable row level security;

-- Demo policy: anonymous full access. Restrict per-user before production.
create policy "anon full access" on public.extractions
  for all using (true) with check (true);
```

### Upgrading a V1 table

If you have a V1 table (without the three V2 columns), run this once. It is idempotent and safe on a live table:

```sql
alter table public.extractions
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;
```

> The app detects missing V2 columns at runtime and saves V1 fields only, logging a warning. No data is lost; V2 fields are preserved in localStorage. Running the migration above enables full cross-device sync.

### Row Level Security

The demo policy grants anonymous full access. For a multi-user production deployment:
- Enable Supabase Auth
- Replace the policy with `auth.uid() = user_id` and add a `user_id uuid` column
- Set the anon key with the minimum required permissions

---

## 12. Architecture & File Map

```
/
├── index.html                  HTML entry point; loads runtime-config.js before the app module
├── vite.config.js              Port 5173
├── tailwind.config.js          Maps CSS var(--*) tokens into Tailwind utilities
├── public/
│   ├── favicon.svg             DatIQ brand icon (data bars + IQ trend arc)
│   └── runtime-config.js       Runtime endpoint overrides — edited without rebuild
└── src/
    ├── main.jsx                ReactDOM.createRoot; BrowserRouter
    ├── App.jsx                 Provider tree: ThemeProvider > ToastProvider >
    │                           ErrorModalProvider > ExtractionProvider > Shell
    ├── index.css               Tailwind @layers import only
    ├── styles/
    │   ├── design-system.css   All CSS custom properties (tokens), global resets,
    │   │                       buttons, topbar, cards, inputs, animations
    │   └── screens.css         Screen-specific and component CSS
    ├── data/
    │   └── mockData.js         Demo fixtures: LUMIO_EXTRACTION, mockContacts,
    │                           mockCustomExtraction, mockDomainMap
    ├── lib/
    │   ├── config.js           Single source of truth for env flags and endpoints
    │   ├── firecrawlService.js extractStructure(url, options) — mock or real Firecrawl
    │   ├── aiService.js        summarize / categorizeLinks / generateContent
    │   ├── supabaseClient.js   Supabase client (null when unconfigured)
    │   ├── extractionsRepo.js  listExtractions / saveExtraction / updateEnrichments / deleteExtraction
    │   ├── enrichmentStore.js  localStorage: readEnrichments / saveEnrichment / saveCurrent / readCurrent
    │   ├── emailService.js     buildEmail / sendExtractionsEmail (webhook → API → mailto)
    │   ├── webhook.js          notifyWebhook — fire-and-forget POST on save
    │   ├── pdfExport.js        extractionsToPdf — jsPDF report, lazy-loaded
    │   ├── utils.js            URL helpers, date helpers, CSV helpers, email validators
    │   ├── linkCategorizer.js  categoryOf / CATEGORY_META / CATEGORY_KEYS / categoryCounts
    │   ├── extractionPresets.js QUICK_ACTIONS / CONTACTS_PROMPT / enrichMeta / resolveCustomPrompt
    │   └── errorMessages.js    classifyError / formatDetail / SAVE_ERROR / LOAD_ERROR / DELETE_ERROR
    ├── components/
    │   ├── ExtractionProvider.jsx Context: extract / enrich / save / view
    │   ├── Icon.jsx            Lucide icon name-map (add new icons here only)
    │   ├── Button.jsx          variant: primary / secondary / ghost / danger; size sm
    │   ├── Toggle.jsx          Labelled toggle switch with icon + hint
    │   ├── TopBar.jsx          Sticky nav: brand + links + theme toggle
    │   ├── BrandLoader.jsx     Animated DatIQ mark for loading states
    │   ├── LoadingScreen.jsx   Full-screen 4-step extraction progress
    │   ├── FaviconDot.jsx      Deterministic-hue monogram dot per domain
    │   ├── StructuredData.jsx  Recursive JSON renderer for enrichment data
    │   ├── ContentModal.jsx    Generate content modal (portal)
    │   ├── EmailModal.jsx      Send email modal (portal)
    │   ├── ThemeProvider.jsx   Light/dark; persists to datiq.theme
    │   ├── Toast.jsx           ToastProvider + useToast(); 2.6 s auto-dismiss
    │   └── ErrorModal.jsx      ErrorModalProvider + useErrorModal(err, override?, retryFn?)
    └── pages/
        ├── Home.jsx            URL input, toggles, feature cards
        ├── Preview.jsx         Tabs, enrichments, save/discard
        └── Dashboard.jsx       Table/cards, search, pagination, exports
```

**Provider tree (App.jsx)**
```
ThemeProvider           → applies data-theme to <html>; exposes useTheme()
  ToastProvider         → global notification bar; exposes useToast()
    ErrorModalProvider  → global error dialog; exposes useErrorModal()
      ExtractionProvider → extraction state machine; exposes useExtraction()
        Shell           → TopBar + <Routes>
```

**State management**
No external state library. State lives in:
- `ExtractionProvider` — current extraction, loading flag, extract/enrich/save/view actions
- Page-local `useState` for UI state (search query, selected rows, active tab, etc.)
- localStorage for persisted UI preferences and cached data

---

## 13. Services API Reference

### `firecrawlService.js`

#### `extractStructure(url, options?)`

Extracts structure from a single page. Routes to `mapDomain()` when `options.mapMode` is true.

```typescript
extractStructure(url: string, options?: {
  renderJs?:    boolean;   // wait 3 s for JS before capture
  customPrompt?: string;   // LLM extraction prompt
  mapMode?:     boolean;   // use /map endpoint instead of /scrape
  enrichMeta?:  object;    // metadata to tag the enrichment entry
}): Promise<Extraction>
```

**Returns** `Extraction` object. When `mapMode` is true, returns `{ domain_map: string[], ... }` instead of headings/links.

**Real path:** `POST https://api.firecrawl.dev/v1/scrape`
- Auth: `Authorization: Bearer {VITE_FIRECRAWL_API_KEY}`
- Body: `{ url, formats: ["html", "json"?], onlyMainContent: false, waitFor?: 3000, jsonOptions?: { prompt } }`

**Mock path:** 2 s delay. Returns Lumio fixture for `lumio.io`, synthetic data otherwise.

---

#### `mapDomain(url)`

Discovers all indexed URLs on a domain.

```typescript
mapDomain(url: string): Promise<{ url, page_title, headings: [], links: [], domain_map: string[] }>
```

**Real path:** `POST https://api.firecrawl.dev/v1/map`
- Body: `{ url }`
- Response: `{ links: Array<string | { url: string }> }`

**Mock path:** 2 s delay. Returns ~15–20 synthetic URLs.

---

### `aiService.js`

#### `summarize(extraction)`

Generates a plain-English page overview.

```typescript
summarize(extraction: Partial<Extraction>): Promise<string>
```

**Real path:** `POST https://api.anthropic.com/v1/messages`
- Model: `VITE_AI_MODEL` (default `claude-haiku-4-5-20251001`)
- Max tokens: 400
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`
- Prompt includes: URL, page title, heading list, link count

**Mock path:** 1.2 s delay. Preserves existing `ai_summary` if present; generates from metadata otherwise.

---

#### `categorizeLinks(links, baseUrl)`

Assigns a category to each link. Always runs the heuristic baseline; uses AI refinement only when `hasAI` is true and the link count is ≤ 60.

```typescript
categorizeLinks(
  links:   Array<{ text: string; href: string }>,
  baseUrl: string
): Promise<Array<{ text: string; href: string; category: string }>>
```

**Categories** (in precedence order): `email` · `social` · `document` · `media` · `internal` · `external`

**AI path:** Sends JSON array to Claude; parses response as a JSON array of category strings. Falls back to heuristics on any error.

---

#### `generateContent(extraction, format)`

Generates marketing content from a saved extraction.

```typescript
generateContent(extraction: Extraction, format: ContentFormat): Promise<string>
```

```typescript
type ContentFormat = {
  key:         "seo-outline" | "competitor-summary" | "social-posts";
  label:       string;
  icon:        string;
  desc:        string;
  instruction: string;
}
```

**Real path:** Claude API, max tokens 1024. Falls back to `mockContent()` on empty response.

**Mock path:** 1.2 s delay, format-specific procedural markdown.

**Export:** `CONTENT_FORMATS` — the array of all three format definitions.

---

### `extractionsRepo.js`

#### `listExtractions()`

Returns all saved extractions, newest first, each tagged `_saved: true`.

```typescript
listExtractions(): Promise<Extraction[]>
```

Reads from Supabase when configured; falls back to localStorage sorted by `created_at` descending.

---

#### `saveExtraction(extraction)`

Persists an extraction. Always writes to localStorage in addition to Supabase (local copy is the backup).

```typescript
saveExtraction(extraction: Extraction): Promise<Extraction & { _saved: true }>
```

- Splits payload into V1 base fields and V2 optional fields
- On Supabase missing-column error: retries with V1 fields only, logs a warning
- Always calls `notifyWebhook()` after a successful save
- Returns the saved row with any V2 fields re-attached (so Preview continues to display them)

---

#### `updateEnrichments(id, enrichments)`

Patches only the `enrichments` column of an already-saved row. Used when a Quick Action completes on a saved extraction.

```typescript
updateEnrichments(id: string, enrichments: Record<string, EnrichmentEntry>): Promise<void>
```

Silently ignores missing-column errors (V1 Supabase schema). Always patches localStorage.

---

#### `deleteExtraction(id)`

Removes an extraction from Supabase and localStorage.

```typescript
deleteExtraction(id: string): Promise<void>
```

---

### `enrichmentStore.js`

localStorage-only; no Supabase calls. Keyed first by URL, then by capability key.

```typescript
readEnrichments(url: string): Record<string, EnrichmentEntry>
saveEnrichment(url: string, entry: EnrichmentEntry): void
saveCurrent(extraction: Extraction | null): void
readCurrent(): Extraction | null
```

**localStorage keys used:**
- `datiq.enrichments` — `{ [url]: { [key]: EnrichmentEntry } }`
- `datiq.current` — last-viewed extraction (survives Preview page reload)

---

### `emailService.js`

#### `buildEmail(items)`

Builds the subject line and plain-text body for an email.

```typescript
buildEmail(items: Extraction[]): { subject: string; body: string }
```

- Subject: `DatIQ — {n} extraction(s)`
- Body: One block per item: title, URL, stats, AI summary snippet (≤ 600 chars)

---

#### `sendExtractionsEmail({ to, items })`

Sends extractions to recipients via the best available delivery method.

```typescript
sendExtractionsEmail(args: {
  to:    string | string[];
  items: Extraction[];
}): Promise<{ via: "webhook" | "api" | "mailto"; count: number }>
```

**Delivery order:**
1. **Webhook** — POSTs `{ event: "email.send", sent_at, to, subject, body, data: items }` to `WEBHOOK_URL`
2. **Email API** — POSTs `{ to, subject, body, items }` to `EMAIL_API_URL`
3. **Mailto** — Opens the user's email client with a pre-filled draft (body capped at 1 800 chars)

---

### `webhook.js`

#### `notifyWebhook(extraction)`

Fire-and-forget POST. Errors are logged, never thrown.

```typescript
notifyWebhook(extraction: Extraction): Promise<void>
```

Payload: `{ event: "extraction.saved", sent_at: ISO, data: extraction }`

Uses `keepalive: true` so the request survives page unloads.

---

### `utils.js`

**URL helpers**

```typescript
hostOf(url: string): string           // hostname without www
pathOf(url: string): string           // pathname + search, "/" if root
isExternal(href: string, base: string): boolean
normalizeUrl(value: string): string   // prepends https:// if missing
isValidUrl(value: string): boolean    // validates format (scheme optional)
```

**Date helpers**

```typescript
fmtDate(iso: string): string          // "Jan 1, 2026"
timeAgo(iso: string): string          // "5m ago" | "2h ago" | "3d ago" | fmtDate
```

**JSON/CSV helpers**

```typescript
flattenJson(value: any, prefix?: string): Array<{ path: string; value: string }>
extractionRows(e: Extraction): Array<[type, name, text, value]>
extractionsToCsv(items: Extraction[]): string
csvDownload(items: Extraction | Extraction[]): void
```

**Email helpers**

```typescript
isValidEmail(value: string): boolean
parseEmails(value: string): { valid: string[]; invalid: string[] }
```

**Misc**

```typescript
hueOf(str: string): number     // 0–359 deterministic hue from string hash
snippet(text: string, n?: number): string  // truncate at word boundary + "…"
uid(): string                  // generates "ex_****_***" short unique ID
```

---

### `linkCategorizer.js`

```typescript
categoryOf(href: string, baseUrl: string): string   // returns one of CATEGORY_KEYS
isCategory(value: any): boolean                      // type guard
categoryCounts(links, baseUrl): Array<{ key, label, icon, count }>
CATEGORY_KEYS: string[]    // ["email","social","document","media","internal","external"]
CATEGORY_META: Record<string, { label: string; icon: string }>
```

**Heuristic precedence** (first match wins):
1. `^mailto:` → `email`
2. Hostname in SOCIAL_HOSTS (~30 domains) → `social`
3. Extension matches `pdf|docx?|xlsx?|…|tar` → `document`
4. Extension matches `png|jpe?g|gif|mp4|…|flac` → `media`
5. Same hostname as baseUrl → `internal`
6. Different hostname → `external`

---

### `extractionPresets.js`

```typescript
QUICK_ACTIONS: QuickActionPreset[]     // all 5 presets (key, label, icon, prompt)
QUICK_ACTION_BY_KEY: Record<string, QuickActionPreset>  // O(1) lookup
CONTACTS_PROMPT: string                // shared prompt for contacts/leadership
enrichMeta(key: string): { key, label, icon }
resolveCustomPrompt(opts: {
  customMode: boolean;
  customPrompt: string;
  contactsMode: boolean;
}): string
```

`resolveCustomPrompt` merge rules:
- `contactsMode && customPrompt` → `CONTACTS_PROMPT + "\n\nAlso: " + customPrompt`
- `contactsMode` only → `CONTACTS_PROMPT`
- `customPrompt` only → `customPrompt`
- Neither → `""` (no custom extraction)

---

## 14. Data Models

### Extraction object

```typescript
type Extraction = {
  // V1 — always present
  url:           string;
  page_title:    string;
  headings:      Array<{ tag: "H1"|"H2"|"H3"|"H4"|"H5"|"H6"; text: string }>;
  links:         Array<{ text: string; href: string; category?: Category }>;
  ai_summary:    string;
  id:            string;           // "ex_****_***" or Supabase UUID
  created_at:    string;           // ISO 8601

  // V2 — present only when applicable
  custom_extraction?: any;         // arbitrary JSON from LLM extraction
  domain_map?:    string[];        // discovered URL list

  // Enrichment map — one entry per executed Quick Action
  enrichments?: Record<string, EnrichmentEntry>;

  // Meta — added by persistence layer
  _saved?:       boolean;          // true when row is persisted to DB/localStorage
};
```

### Enrichment entry

```typescript
type EnrichmentEntry = {
  key:        string;   // preset key or "custom"
  label:      string;   // display name
  icon:        string;  // lucide icon name
  prompt:     string;   // the prompt that generated this data
  data:       any;      // structured JSON returned by LLM or mock
  created_at: string;   // ISO 8601
};
```

### Quick Action preset

```typescript
type QuickActionPreset = {
  key:    string;
  label:  string;
  icon:   string;
  prompt: string;
};
```

### localStorage schema

| Key | Shape | Purpose |
|-----|-------|---------|
| `datiq.saved` | `Extraction[]` | Local backup of all saved extractions |
| `datiq.enrichments` | `{ [url]: { [key]: EnrichmentEntry } }` | Per-URL enrichment cache |
| `datiq.current` | `Extraction \| null` | Last-viewed extraction (Preview reload survival) |
| `datiq.theme` | `"light" \| "dark"` | Theme preference |
| `datiq.dashLayout` | `"table" \| "cards"` | Dashboard layout preference |

### Supabase table: `extractions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `created_at` | `timestamptz` | Auto-set to `now()` |
| `url` | `text` | Required |
| `page_title` | `text` | |
| `headings` | `jsonb` | Default `[]` |
| `links` | `jsonb` | Default `[]` |
| `ai_summary` | `text` | |
| `custom_extraction` | `jsonb` | V2 column — add with migration |
| `domain_map` | `jsonb` | V2 column — add with migration |
| `enrichments` | `jsonb` | V2 column — add with migration |

---

## 15. Link Categories

Six categories assigned to every extracted link. Heuristics run on every extraction; AI refinement runs additionally when `VITE_AI_API_KEY` is set and the link count is ≤ 60.

| Category | Icon | Heuristic rule |
|----------|------|----------------|
| `email` | mail | `href` starts with `mailto:` |
| `social` | share | Hostname in SOCIAL_HOSTS list |
| `document` | file | Extension: pdf, docx, xlsx, pptx, csv, zip, tar, … |
| `media` | image | Extension: png, jpg, gif, mp4, mp3, svg, … |
| `internal` | link | Same hostname as the extracted page |
| `external` | external | Different hostname from the extracted page |

**SOCIAL_HOSTS** includes: facebook.com, instagram.com, linkedin.com, twitter.com, x.com, youtube.com, github.com, gitlab.com, tiktok.com, discord.com, discord.gg, mastodon.social, twitch.tv, medium.com, pinterest.com, reddit.com, snapchat.com, telegram.me, t.me, and others.

---

## 16. Error Handling

### Classifier

`classifyError(error)` matches the error message against 10 patterns in order, returning `{ title, message }` for user display.

| # | Pattern triggers | UI title |
|---|-----------------|----------|
| 1 | `failed to fetch`, `network error`, `net::err` | Couldn't reach the page |
| 2 | `cors`, `blocked by.*policy`, `cross.origin` | This page blocked the request |
| 3 | `401`, `unauthorized`, `authentication required` | Login required |
| 4 | `403`, `forbidden` | Access forbidden |
| 5 | `404`, `not found` | Page not found |
| 6 | `429`, `too many requests`, `rate.?limit` | Slow down a moment |
| 7 | `5xx`, `server error`, `bad gateway` | Service temporarily unavailable |
| 8 | `timeout`, `timed.?out` | Request timed out |
| 9 | `invalid url`, `not a valid url` | Invalid URL |
| 10 | `supabase`, `postgre`, `database`, `relation.*does not exist` | Database error |

### Context-specific overrides

```typescript
SAVE_ERROR:   { title: "Couldn't save your extraction",   message: "..." }
LOAD_ERROR:   { title: "Couldn't load your history",      message: "..." }
DELETE_ERROR: { title: "Couldn't delete this extraction", message: "..." }
```

Pass these as the second argument to `showError(err, SAVE_ERROR, retryFn)` to override the generic classifier output with context-accurate copy.

### Developer detail

`formatDetail(error)` returns a string suitable for a collapsible "Technical details" section: `ErrorName: message\n\nstack trace (first 5 frames)`.

### Error modal API

```typescript
showError(
  error:    Error | string,
  override?: { title?: string; message?: string },
  onRetry?:  () => void
): void
```

The modal always shows the user-friendly copy. Technical details are collapsed by default. If `onRetry` is provided, a "Try again" button re-invokes the callback.
