# DatIQ — project context for Codex

> This file is read automatically at the start of every new Codex session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-09-14 (Discoverability P1, P2, and P3 fully rechecked and validated end-to-end; all 419 test files / 6,724 tests green; 70 migrations applied; 159/159 smoke tests green; see `CLAUDE.md` and `docs/sessions/SESSION-LOG.md` for current state.)**
>
> **The current source of truth is `CLAUDE.md`** — that file is updated with every release.
> This `AGENTS.md` is kept as a minimal pointer for tooling that auto-loads it.

---

## Quick orientation

| Property | Value |
|---|---|
| **Project** | DatIQ (rebranded from ScrapeLite in R6, 2026-06-09) — zero-code web-extraction + enrichment platform |
| **Working dir** | `/Users/vikash/Extracta` |
| **Live site** | https://datiq.app (Netlify project `datiqapp`; site `0ac65a7e-bd3f-4cde-a8d3-66c23899c473`) |
| **Staging site** | https://staging--datiqapp.netlify.app |
| **GitHub** | https://github.com/vikashkaruna/scrapelite |
| **Netlify** | https://app.netlify.com/projects/datiqapp |
| **Run locally** | `npm run dev` → http://localhost:5173 |
| **Current branch** | `main` / `staging` (in sync with `origin/main` and `origin/staging`) |
| **Active handoff** | `docs/sessions/SESSION-LOG.md` |
| **Session history** | `docs/sessions/SESSIONS-HISTORY.md` (all 70 prior session records consolidated; see `docs/sessions/README.md`) |
| **Safety tag** | `pre-integration-merge` @ `ebaa4bf` (main's pre-merge HEAD) — in case the staging promotion needs to roll back |
| **Remaining operator action** | Add `/api/*` to Netlify Edge Access bypass (~2 min UI walkthrough in the late-night handoffs) so the in-browser Connect/Push calls stop hitting the SSO gate on the branch preview |

---

## Tech stack (locked — do NOT change these choices)

- **Vite 8 + React 19 + React Router 8** — router APIs import from `react-router`; the `react-router-dom` package no longer exists and must not be reintroduced. `BrowserRouter` in `main.jsx` deliberately passes **no** `future` prop and **no** `useTransitions`: both old v7 flags are v8 defaults, and `useTransitions={true}` is a different, unevaluated mode (see the comment there).
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
├── AGENTS.md                         ← this file
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
VITE_AI_MODEL=Codex-haiku-4-5-20251001
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
| Background enrichment | `enrich()` must never show the full-screen loader or navigate. Page must stay visible. |
| Enrichment tabs | Re-clicking a done preset = refresh (overwrites, does NOT create duplicates). |

---

## Critical bugs fixed (do NOT regress)

1. **Hero glow** — `.container > *` must come before `.hero-glow` in `screens.css` (specificity tie-break via order)
2. **Preview grid overflow** — `.preview-grid > * { min-width: 0; }` — do not remove
3. **Toast keyframe** — `@keyframes toast-in` ends at `translate(-50%,0)` (centred toast only). Never reuse for non-centred elements. Selection bar has its own `selbar-in`.
4. **Webhook relative URL** — `config.ensureAbsolute()` prepends `https://` if scheme missing
5. **Date column clipping** — do NOT set percentage widths on Page or AI-Summary columns; let them fill remaining space; only narrow cols get px widths
6. **Enrichment sync on unsaved row** — `enrich()` checks `base._saved && base.id` before calling `updateEnrichments`; skips silently if not saved yet (stores locally only)

---

## v1.0+ status (2026-07-17)

**v1.0 is shipped + 3 rounds of Quick Wins landed on `feat/v1-quickwins`
(PR #14, open).** Live at https://datiq.app, all tests green (1133/1133).
See `docs/SESSION-HANDOFF-2026-07-16.md` (v1.0 closeout) and
`docs/SESSION-HANDOFF-2026-07-17.md` (this session's quick-wins drop) for
the full trail. The list below captures current state + the v2.0 backlog.

### Done in v1.0 + v1.0+ Quick Wins (this branch)
- [x] All v1.0 items (Netlify env, Supabase auth, M0–M7 quality gate, 2 production bug fixes, etc.) — see session handoff
- [x] **MetaAI Quick Wins (Round 1)**: drag-drop URL (`urlIngest.js`), persona example chips, At-a-glance charts on /preview (hand-rolled SVG), recent extractions widget on Home, +2 content presets (Compare, Explain)
- [x] **DeepSeq Quick Wins (Round 2)**: Scrape Similar CTA, Open in Google Sheets, Add multiple URLs reveal-textarea
- [x] **Groke AI Quick Wins (Drop 1 only — scope-split decision)**: inline tag editor on Preview + Dashboard tag filter, CollectionPicker + /collections page + Dashboard collection filter, per-URL Batch retry
- [x] **A11y bonus fix**: dark-mode intent chip contrast (2.93:1 → passes WCAG AA via `--accent-on-dark`)

### v1.0+ surface (what ships on this branch)
- Everything in v1.0 (7 plans, free tier + trial credit, batch + scheduling, etc.)
- Drag-drop / paste / file import for URLs (CSV + plain-text + browser drag)
- "At a glance" charts on every extraction (3 visualisations: stats, heading depth, link categories)
- Recent extractions carousel on Home + "Scrape similar" on Preview
- 5 content generation presets (was 3): SEO / Competitor / Social / **Compare** / **Explain**
- Open in Google Sheets export (CSV + new-sheet deep link)
- Inline tag editor with auto-suggest (URL-host + known-tags)
- Collection picker + /collections page for grouping extractions
- Per-URL Retry on failed Batch rows

### v2.0 backlog (deferred — see `docs/SESSION-HANDOFF-2026-07-17.md` for full details)
- [ ] **Recurring subscription billing** (Razorpay Subscriptions, Stripe Subscriptions, auto-renewal, dunning, customer portal) — see `docs/RECURRING-BILLING-DEFERRAL.md`
- [ ] **Stripe Checkout re-enable** — see `docs/STRIPE-DEFERRAL.md` (6-step runbook)
- [ ] **Browser extension** (Chrome + Firefox + Edge, Manifest v3, OAuth, store submission) — multi-week project; the Groke AI "low effort" rating was wrong
- [ ] **Bulk-tag UI on Dashboard** — ad-clutter risk; add if usage demands it
- [ ] **Sidebar folders / Smart collections** (col-1 + col-3 variants) — overlap with the /collections page
- [ ] **Batch templates** (ba-2) — save current batch as named template + replay on a schedule; combines with R19's scheduler
- [ ] **Batch share** (ba-3) — public read-only link to a batch run; needs new Netlify Function + access control
- [ ] **PNG export** of extractions (DeepSeq QW#5) — low ROI; PDF already exists
- [ ] `/blog/:slug` SEO routing
- [ ] Referral/affiliate program (UI teaser already live on /pricing)
- [ ] Cross-device Supabase session sync (currently single-device localStorage)

### Next session entry point
- Branch: `feat/v1-quickwins` (PR #14 open against `main`)
- Test count: 800 vitest + 363 Playwright = 1163 total, all green
- Build: clean (1.87s)
- The next step is to either **merge PR #14 to main** OR spin up a fresh `v2.0` branch from `main` (the v1.0+ features are stacked but not yet merged).

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
5b267d3  Merge pull request #1 from vikashkaruna/agent-with-secrets-scanning-bypass-37db
6e1d499  Deploy Vite project to Netlify with secrets scanning bypass (6a2387998ea7c38bb41237db)
278ff5c  Merge version-2.0 into main: Extraction & Enrichment update (v2.0)
c45f77d  Dashboard exports: full-capability CSV + new PDF, moved to the top
47a6c76  Fix misaligned "Extracted" date column in dashboard table
a747769  v2.0: persist enrichments map to Supabase (cross-device sync)
e54837c  v2.0: persisted, tabbed Quick Enrichment + 8th capability card
634a68f  v2.0 UX refinements: dashboard, home, background enrichment
49bcb20  v2.0: Extraction & Enrichment update
c45...   (earlier v1 commits — error modal, vertical centering, seed data removal)
```

---

## Session history summary (what was built in this session)

This single session took the project from a finished V1 MVP to a full v2.0 platform:

**v2.0 features added:**
- Custom JSON Schema Extraction (textarea + LLM mode + preset chips)
- Domain Mapping (`/map` endpoint → searchable URL list)
- Contacts & Emails toggle (auto-populates leadership contact prompt)
- Integrated Content Generation modal (3 formats, real Codex output)
- Quick Enrichment — 5 one-click capabilities, background execution, per-button spinners
- Enrichment tabs — each executed capability becomes a persistent, reloadable tab
- Full enrichment persistence: localStorage (by URL+key) + Supabase `enrichments` column + cross-device merge
- 8-capability card grid on Home screen
- Full-capability CSV export (meta+headings+links+all enrichments, deep-flattened JSON)
- PDF export (jsPDF, lazy-loaded, full content report)

**UX fixes in this session:**
- Generate button moved from table rows → selection bar
- Table horizontal scroll eliminated (fixed layout + px column widths)
- Viewport-adaptive pagination
- Date column alignment fixed
- TopBar "+ New" removed from dashboard
- v2 section labels removed from Home; features merged into one auto-fit grid
- Content modal enlarged to 760px

**All tests passed (13 functional tests against real Firecrawl + AI + Supabase)** — see test results above.
