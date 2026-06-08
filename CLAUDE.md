# ScrapeLite — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-08 (after v3-supabase-auth build, all findings fixed, 42/42 tests green)**

---

## Quick orientation

| Property | Value |
|---|---|
| **Project** | ScrapeLite — zero-code web-extraction + enrichment platform |
| **Working dir** | `/Users/vikash/Extracta` |
| **Live site** | https://scrapelite.netlify.app |
| **GitHub** | https://github.com/vikashkaruna/scrapelite |
| **Netlify** | https://app.netlify.com/projects/scrapelite |
| **Run locally** | `npm run dev` → http://localhost:5173 |
| **Current branch** | `v3-supabase-auth` (ready to deploy; not yet merged to main) |
| **Latest commit** | `6147868` — chore: add playwright devDep |
| **Active branches** | `main` (live), `v2-build-api-layer`, `v3-supabase-auth` |

---

## Tech stack (locked — do NOT change these choices)

- **Vite 5 + React 18 + React Router 6** (v7 future flags set in `main.jsx`)
- **Tailwind CSS** for utilities only — the design system tokens live in CSS custom properties, never in Tailwind config
- **Design system** — `src/styles/design-system.css` (CSS vars: `--accent`, `--bg`, `--surface`, `--text-*`, `--r`, `--shadow-*`) + `src/styles/screens.css`. **NEVER rewrite these into Tailwind classes.**
- **lucide-react** icons, all named in `src/components/Icon.jsx`. Add new icons there; don't import lucide directly elsewhere.
- **Supabase** (`@supabase/supabase-js`) — with localStorage fallback when not configured
- **jsPDF 4.2.1** — lazy-loaded (only on PDF export click) via `await import("../lib/pdfExport.js")`
- No test framework, no ESLint config (scripts: `dev`, `build`, `preview` only)

---

## What the app does (v2.0)

Three routes:

### `/` — Home / Extract
- URL input + validation + 3 example chips
- **Four scrape-option toggles** (each with icon + label + hint):
  1. Render JavaScript — Firecrawl `waitFor:3000`
  2. Map entire domain — routes to `/map` endpoint, not `/scrape`
  3. Contacts & emails — auto-populates a leadership/board contact prompt
  4. Custom extraction — reveals a textarea + 5 Quick Action preset chips
- **8 capability cards** below the toggles (3 V1 + 5 V2)
- V2 pill in eyebrow

### `/preview` — Review & Save
- Page identity (title, URL, stats)
- AI summary card
- **Quick enrichment** panel — 5 capability buttons (Find Contact Info, Leadership & Board, Social Links, Company Mission, Pricing & Plans). Each runs **in the background** (no full-screen loader; page stays visible). Executed buttons show a ✓ badge + progress ring while running.
- **Enrichment tabs** — one "Overview" tab + one tab per executed capability. Tabs persist per URL, survive browser reload, and restore when re-opening from Dashboard.
- Each enrichment tab shows structured data + a **Refresh** button
- Overview tab shows: headings (H1–H6), links (filterable, AI-category-tagged), or domain-map URL list

### `/dashboard` — Saved Extractions
- Table/cards layout toggle (persisted to `scrapelite.dashLayout`)
- **Header actions:** CSV | PDF | New extraction
- Smart search (AND logic across title/url/summary/headings/links)
- Viewport-adaptive pagination (`rowsForViewport()`)
- **Selection bar** (appears when rows checked): N selected | Clear | Generate | Send email
- Rows: View | Delete (CSV moved to header)
- Generate = ContentModal (SEO Blog Outline / Competitor Summary / Social Posts)
- Email = EmailModal with recipient input
- CSV export: comprehensive — includes meta, headings, links, domain map, every enrichment capability (deep-flattened JSON paths)
- PDF export: jsPDF report, same complete content, lazy-loaded

---

## Complete file map (v2.0 state)

```
/Users/vikash/Extracta/
├── CLAUDE.md                         ← this file
├── index.html                        Google Fonts (Hanken Grotesk, Plus Jakarta Sans)
├── vite.config.js                    port 5173
├── tailwind.config.js                maps var(--*) tokens into Tailwind
├── postcss.config.js
├── netlify.toml                      build: npm run build, publish: dist, SPA redirect
├── .env.example                      6 VITE_* vars documented
├── .env                              EXISTS — has REAL keys (do not overwrite)
├── .gitignore                        .env gitignored ✓
├── README.md                         setup, full Supabase SQL (v1 + v2), env table
├── public/
│   ├── favicon.svg
│   └── runtime-config.js             window.__SCRAPELITE_RUNTIME__ override (no rebuild needed)
└── src/
    ├── main.jsx                      ReactDOM.createRoot, BrowserRouter
    ├── App.jsx                       ThemeProvider > ToastProvider > ErrorModalProvider > ExtractionProvider > Shell
    ├── index.css                     @tailwind base/components/utilities only
    ├── styles/
    │   ├── design-system.css         CSS tokens
    │   └── screens.css               ALL screen-specific + component CSS (Home, Preview, Dashboard,
    │                                 Loading, Toast, ErrorModal, EmailModal, ContentModal, pv-tabs,
    │                                 quick-actions, scrape-opts, opt-toggle, home-features, sd-*, etc.)
    ├── data/
    │   └── mockData.js               LUMIO_EXTRACTION + mockExtractionForUrl + mockContacts
    │                                 + mockCustomExtraction + mockDomainMap (v2 helpers)
    ├── lib/
    │   ├── config.js                 VITE_* env + runtime override; hasSupabase/hasFirecrawl/hasAI flags
    │   ├── utils.js                  hostOf, pathOf, isExternal, fmtDate, timeAgo, snippet, uid,
    │   │                             isValidUrl, normalizeUrl, flattenJson, extractionRows,
    │   │                             extractionsToCsv, csvDownload (accepts array or single item)
    │   ├── supabaseClient.js         createClient when configured; null otherwise
    │   ├── firecrawlService.js       extractStructure(url, options) — mock OR real
    │   │                             options: { renderJs, customPrompt, mapMode, enrichMeta }
    │   │                             mapDomain(url) → { domain_map: string[] }
    │   │                             realScrape uses /v1/scrape + json mode for customPrompt
    │   ├── aiService.js              summarize, categorizeLinks, generateContent
    │   │                             CONTENT_FORMATS = [seo-outline, competitor-summary, social-posts]
    │   ├── linkCategorizer.js        categoryOf heuristic; CATEGORY_META; categoryCounts
    │   ├── extractionPresets.js      CONTACTS_PROMPT, QUICK_ACTIONS (5 presets), QUICK_ACTION_BY_KEY,
    │   │                             enrichMeta(key), resolveCustomPrompt({customMode,customPrompt,contactsMode})
    │   ├── enrichmentStore.js        localStorage: readEnrichments(url), saveEnrichment(url,entry),
    │   │                             saveCurrent(extraction), readCurrent() — keyed by URL→capKey
    │   ├── extractionsRepo.js        listExtractions, saveExtraction, deleteExtraction, updateEnrichments
    │   │                             Supabase + localStorage dual-write; isMissingColumnError fallback
    │   │                             rows tagged _saved:true; local.patch(id,fields)
    │   ├── pdfExport.js              extractionsToPdf(items) — jsPDF, lazy-loaded from Dashboard
    │   ├── webhook.js                notifyWebhook (fire-and-forget)
    │   ├── emailService.js           sendExtractionsEmail; webhook → email API → mailto fallback
    │   └── errorMessages.js          classifyError; 10 categories; SAVE/LOAD/DELETE_ERROR
    ├── components/
    │   ├── ExtractionProvider.jsx    Context: current, loading, loadingUrl, extract, enrich, save, view
    │   │                             extract(): full extraction + nav to /preview + enrichments hydration
    │   │                             enrich(url, preset): BACKGROUND — adds tab, persists, syncs to DB
    │   │                             view(item): merges DB+local enrichments; commitCurrent persists
    │   │                             current initialised from readCurrent() on mount
    │   ├── Toggle.jsx                Reusable toggle switch — props: icon, label, hint, checked, onChange
    │   ├── StructuredData.jsx        Renders arbitrary JSON (enrichment data) — ObjectRows, NodeList,
    │   │                             Value (email links, URL links, primitives, arrays, nested objects)
    │   ├── ContentModal.jsx          Generate content modal (portal); 3 formats; copy button
    │   ├── EmailModal.jsx            Send email modal (portal); multi-recipient; error handling
    │   ├── BrandLoader.jsx           Animated loader; used by Dashboard loading + Preview save overlay
    │   ├── Icon.jsx                  lucide-react name-map — add new icons here
    │   ├── Button.jsx                variant: primary/secondary/ghost/danger; size sm
    │   ├── FaviconDot.jsx            Deterministic hue monogram per domain
    │   ├── ThemeProvider.jsx         light/dark; persists to scrapelite.theme
    │   ├── Toast.jsx                 ToastProvider + useToast(); 2.6s auto-dismiss
    │   ├── ErrorModal.jsx            ErrorModalProvider + useErrorModal(err, override?, retryFn?)
    │   ├── TopBar.jsx                Brand, nav, theme toggle; "+ New" only on /preview
    │   └── LoadingScreen.jsx         Full-screen 4-step animated progress
    └── pages/
        ├── Home.jsx                  Toggles, custom extraction textarea, preset chips, 8 capability cards
        ├── Preview.jsx               Tabs (Overview + enrichments), quick-enrichment buttons, save/discard
        └── Dashboard.jsx             Table/cards, search, pagination, CSV/PDF/Generate/Email
```

---

## Supabase schema — CURRENT COMPLETE STATE

```sql
-- Run these once in the Supabase SQL editor:
create extension if not exists "pgcrypto";

create table if not exists public.extractions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  url               text not null,
  page_title        text,
  headings          jsonb not null default '[]'::jsonb,
  links             jsonb not null default '[]'::jsonb,
  ai_summary        text,
  custom_extraction jsonb,   -- v2: LLM extraction output
  domain_map        jsonb,   -- v2: array of discovered URLs
  enrichments       jsonb    -- v2: Quick Enrichment tab map { [capKey]: {key,label,icon,prompt,data,created_at} }
);

alter table public.extractions enable row level security;
create policy "anon full access" on public.extractions
  for all using (true) with check (true);
```

**Upgrading an existing (v1) table** — safe to run on live data:
```sql
alter table public.extractions
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;
```

> ⚠️ **THIS HAS NOT BEEN RUN YET on the live Supabase instance.**
> The app gracefully degrades: saves succeed (warning logged, base columns written),
> and enrichments are stored locally. Run the ALTER to unlock full cross-device sync.

---

## Environment variables

File: `/Users/vikash/Extracta/.env` — **has real values** (do NOT clear or overwrite)

```
VITE_SUPABASE_URL=           # live Supabase project URL
VITE_SUPABASE_ANON_KEY=      # anon/public key
VITE_FIRECRAWL_API_KEY=      # fc-... (real, working — direct browser calls work)
VITE_AI_API_KEY=             # sk-ant-... (real, working — browser-side, demo only)
VITE_AI_MODEL=claude-haiku-4-5-20251001
VITE_WEBHOOK_URL=            # n8n webhook URL (test vs prod — see note below)
```

**Webhook note:** `.env` has the n8n **test** URL (`/webhook-test/scrapelite`) — only responds
while the n8n editor is open. For live sends use production URL (`/webhook/scrapelite`)
with the workflow activated + CORS configured.

**Runtime override** (no rebuild): edit `public/runtime-config.js` to set
`window.__SCRAPELITE_RUNTIME__ = { webhookUrl, emailApiUrl }`. config.js prefers this
over VITE_*.

**Security**: `VITE_AI_API_KEY` is browser-bundled. Safe for local/demo. For production,
proxy AI calls through a Netlify function.

---

## Enrichment data model (v2 core concept)

Each extraction can carry a map of capability results as named tabs:
```js
extraction.enrichments = {
  contacts: { key, label, icon, prompt, data: {...}, created_at },
  social:   { key, label, icon, prompt, data: {...}, created_at },
  // ...one entry per executed QUICK_ACTIONS preset
}
```

- **Persisted** in two places: `localStorage` (key `scrapelite.enrichments`, indexed by URL then capKey) + Supabase `enrichments` column (when the column exists and the row is saved)
- **Lifecycle**: `enrich(url, preset)` adds/overwrites one entry; `view(item)` merges DB + local (newest-by-created_at wins per key); `export` always hydrates from both sources via `withEnrichments(item)`
- **Display**: Overview tab always shown; one tab per entry in `enrichments`; tab auto-activates on new result; clicking an executed button refreshes its tab

---

## Known warnings (expected, non-blocking)

1. **`V2 columns not found in Supabase`** — WARN (not error). The `enrichments`/`custom_extraction`/`domain_map` ALTER hasn't been run. Fix: run the migration above.
2. **`Webhook delivery failed: Failed to fetch`** — WARN. n8n webhook CORS / test URL issue. Fire-and-forget, never blocks saving.
3. **Vite HMR `<Shell>` errors** — appear in the dev console only during hot-reload of `ExtractionProvider.jsx` (exports both component + hook, so Vite does a full invalidation). Gone on a clean page reload. Never in production.

---

## Architecture rules (LOCKED — never re-ask, never undo)

| Rule | Detail |
|---|---|
| CSS | Keep `design-system.css` + `screens.css` tokens. Never convert to Tailwind. |
| Services | Mock-but-real-ready: env present → real call, absent → mock + localStorage |
| Supabase fallback | isMissingColumnError → retry with v1 columns only. Never hard-fail a save. |
| Dashboard seed | NONE — starts empty. `SEED_HISTORY` was deleted. Do not re-add. |
| Table layout | `table-layout:fixed`, fixed px widths on narrow cols (check/struct/date/act). Percentage widths on Page/Summary over-allocate and clip the date column — proven bug, avoid. |
| TopBar "+ New" | Only shown on `/preview`, not on `/dashboard` |
| PDF | Lazy-loaded via `await import()`. Never static-import jsPDF in Dashboard. |
| Background enrichment | `enrich()` must never show the full-screen loader or navigate. Page must stay visible. Errors → toast only, never blocking modal. |
| Enrichment tabs | Re-clicking a done preset = refresh (overwrites, does NOT create duplicates). |
| Auth | `AuthProvider` wraps the full tree. `apiClient.setAuthToken()` called on every auth event. Save on Preview gates on `user` — calls `openAuth()` if not signed in. |
| listExtractions fallback | Always falls back to localStorage on ANY error (no user-visible blocking). Write operations (save/delete) remain strict and surface errors to the user. |
| Demo data | `DEMO_EXTRACTIONS` shown when `items.length === 0`. Demo rows have `_demo:true` — suppress checkbox, delete, selection. Do NOT show demo rows in exports. |

---

## Critical bugs fixed (do NOT regress)

1. **Hero glow** — `.container > *` must come before `.hero-glow` in `screens.css` (specificity tie-break via order)
2. **Preview grid overflow** — `.preview-grid > * { min-width: 0; }` — do not remove
3. **Toast keyframe** — `@keyframes toast-in` ends at `translate(-50%,0)` (centred toast only). Never reuse for non-centred elements. Selection bar has its own `selbar-in`.
4. **Webhook relative URL** — `config.ensureAbsolute()` prepends `https://` if scheme missing
5. **Date column clipping** — do NOT set percentage widths on Page or AI-Summary columns; let them fill remaining space; only narrow cols get px widths
6. **Enrichment sync on unsaved row** — `enrich()` checks `base._saved && base.id` before calling `updateEnrichments`; skips silently if not saved yet (stores locally only)
7. **Contacts toggle UX** — turning Contacts on also sets `customMode=true` so the textarea appears immediately with the auto-populated prompt. Without this, Contacts had no visible feedback.
8. **Dashboard blocking modal** — `listExtractions` must always fall back to localStorage on any API error (including 404/500 from missing Netlify Functions in preview mode). Never call `showError` from the Dashboard's listExtractions catch block.

---

## Outstanding tasks for next session

### Highest priority — deploy v3 to production
1. **Supabase SQL** (run once in SQL Editor — enables RLS + per-user data isolation):
```sql
alter table public.extractions
  add column if not exists user_id           uuid references auth.users,
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;

alter table public.extractions enable row level security;
drop policy if exists "anon full access" on public.extractions;
drop policy if exists "users own extractions" on public.extractions;
create policy "users own extractions" on public.extractions
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

2. **Supabase dashboard** → Authentication → Providers: enable Google, Microsoft (Azure AD), GitHub. Set redirect URL to `https://scrapelite.netlify.app`.

3. **Netlify environment variables** — set these in Netlify dashboard (Site → Environment variables):
   - `SUPABASE_URL` + `SUPABASE_ANON_KEY` (no VITE_ prefix — used by Netlify Functions)
   - `FIRECRAWL_API_KEY` (no VITE_ prefix — used by Netlify Function, not browser)
   - `AI_API_KEY` (no VITE_ prefix — used by Netlify Function, not browser)
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (with VITE_ prefix — used by browser for Auth)
   - Keep `VITE_FIRECRAWL_API_KEY` and `VITE_AI_API_KEY` **empty** in production (forces API layer)

4. **Merge v3-supabase-auth into main** and trigger Netlify redeploy.

### Other pending work
- [ ] Connect GitHub repo → Netlify for auto-deploys on push to `main`
- [ ] Switch webhook to the **production** n8n URL (`/webhook/scrapelite`) and activate the workflow
- [ ] Consider Netlify Background Functions for email reliability
- [ ] `version-2.0` branch still exists; can be deleted: `git push origin --delete version-2.0`

---

## How to continue developing

```bash
cd /Users/vikash/Extracta   # working dir
git status                   # should be clean on main
npm run dev                  # starts Vite at http://localhost:5173
# After any .env change: Ctrl+C → npm run dev (Vite does NOT hot-reload .env)
```

**Test the full build before deploying:**
```bash
npm run build   # must complete with no errors
```

**Deploy to Netlify (manual):**
```bash
# If netlify CLI is installed:
netlify deploy --prod --dir=dist
# Or: push to main → Netlify auto-builds (once GitHub integration is connected)
```

---

## Git log (recent)

```
6147868  chore: add playwright as devDependency (used for e2e verification)
65e8701  v3: Supabase Auth — Google/Microsoft/GitHub OAuth + email/password + demo data
3937253  chore: update package-lock.json after npm install
593274b  V2 API layer: route all external calls through Netlify Functions
278ff5c  Merge version-2.0 into main: Extraction & Enrichment update (v2.0)
c45f77d  Dashboard exports: full-capability CSV + new PDF, moved to the top
```

---

## Session history summary (what was built across all sessions)

**v2.0 (branch: merged to main):**
- Custom JSON Schema Extraction, Domain Mapping, Contacts & Emails toggle
- Quick Enrichment — 5 capabilities, background execution, persistent enrichment tabs
- Full-capability CSV + PDF export, viewport-adaptive pagination, content generation modal

**v2 API layer (branch: v2-build-api-layer):**
- All Firecrawl, Anthropic, Supabase calls moved to Netlify Functions
- `apiClient.js` in browser; secrets never bundled client-side
- Netlify toml updated with esbuild bundler + `/api/*` redirect

**v3 Auth (branch: v3-supabase-auth) — fully tested, ready to deploy:**
- `authService.js` — Supabase Auth wrapper: email/password + Google/Microsoft/GitHub OAuth
- `AuthProvider.jsx` — global React context, JWT synced to `apiClient` on every auth event
- `AuthModal.jsx` — portal modal; inline SVG logos; sign-in + create-account tabs
- `TopBar.jsx` — UserChip (avatar/initials + sign-out) when signed in; Sign-in button otherwise
- `Preview.jsx` — onSave gates on auth; unauthenticated users see AuthModal instead
- `Dashboard.jsx` — DEMO_EXTRACTIONS (Stripe/Apple/Deloitte) when list is empty; no checkbox/delete on demo rows; demo banner with CTAs
- `mockData.js` — STRIPE_DEMO, APPLE_DEMO, DELOITTE_DEMO with pre-populated enrichment tabs
- `extractions.js` (Netlify fn) — requires JWT; validates via getUser(); per-user RLS via user_id
- `screens.css` — auth modal, OAuth buttons, spinner, user chip, demo badge/banner styles
- `extractionsRepo.js` — `listExtractions` always falls back to localStorage on any API error; `shouldFallback()` helper covers 401/403/404/503/network errors for write operations

**All findings from verification fixed:**
1. Contacts toggle now auto-enables Custom Extraction textarea (UX clarity)
2. Enrichment failure shows toast instead of blocking error modal (non-blocking background ops)
3. Dashboard `listExtractions` gracefully falls back to localStorage on any API error (no blocking modal)

**42/42 end-to-end Playwright tests green** (2026-06-08)
- Date column alignment fixed
- TopBar "+ New" removed from dashboard
- v2 section labels removed from Home; features merged into one auto-fit grid
- Content modal enlarged to 760px

**All tests passed (13 functional tests against real Firecrawl + AI + Supabase)** — see test results above.
