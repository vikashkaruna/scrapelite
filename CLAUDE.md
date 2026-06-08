# ScrapeLite — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-08 (after V4 E2E fixes: footer env vars, keyboard a11y, localStorage guards, mobile CSS)**

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
| **Current branch** | `claude/v4-persona-onboard-lEZ1g` (V4 in development) |
| **Latest commit** | `(see git log)` — V4: Footer env-var links, a11y, localStorage guards, mobile CSS; 90/90 E2E |

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

## V4.0 — Persona Onboarding (June 2026, branch: claude/v4-persona-onboard-lEZ1g)

### New files added in V4
| File | Purpose |
|---|---|
| `src/lib/personaConfig.js` | 7 personas (Sales/SDR, Competitive Intel, SEO, Market Researcher, Recruiter, Founder/VC, Agency) each with tagline, subtitle, examples, featuresHighlight, dashboardLabel, guideTip, demoUrl |
| `src/components/PersonaProvider.jsx` | Context: personaId, onboarded, userName; persisted to localStorage keys scrapelite.persona / scrapelite.onboarded / scrapelite.userName |
| `src/pages/Onboarding.jsx` | 2-step persona selection flow — Step 1: card grid (7 personas), Step 2: name entry + welcome |
| `src/pages/Privacy.jsx` | Full Privacy Policy (7 sections: data collection, usage, storage, third-parties, rights, cookies, changes) |
| `src/pages/Terms.jsx` | Full Terms of Service (12 sections: acceptable use, IP, liability, termination, etc.) |
| `src/components/Footer.jsx` | Site footer: Product/Company/Legal nav + LinkedIn/Twitter socials + copyright |

### V4 routing changes (App.jsx)
- `PersonaProvider` wraps `ExtractionProvider` (so all pages have persona context)
- First-time visitors (onboarded = false) are redirected to `/onboarding` automatically
- New routes: `/onboarding` (standalone, no TopBar), `/privacy`, `/terms`
- `Footer` rendered in Shell after Routes (not shown during LoadingScreen or on /onboarding)
- `PUBLIC_PATHS = ["/onboarding", "/privacy", "/terms"]` — never redirected

### V4 UX patterns
- **Persona badge** in TopBar: colored dot + role label + click-to-switch
- **Persona-adaptive Home**: hero tagline, subtitle, examples, stat badge, guide tip, "Recommended" feature cards — all change per persona
- **Switch role**: available from TopBar badge click or "Switch role" link at Home page bottom — resets onboarding state, navigates to /onboarding
- **Guide tip**: shown once per persona (dismissed via localStorage `scrapelite.tip.{personaId}`)
- **Dashboard**: persona-specific title (`dashboardLabel`) and subtitle (`dashboardSub`)
- **Feature card highlighting**: cards in `featuresHighlight` array get accent border + "Recommended" tag

---

## Complete file map (v2.0 + V4 state)

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
    ├── App.jsx                       ThemeProvider > ToastProvider > ErrorModalProvider > PersonaProvider > ExtractionProvider > Shell
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
    │   ├── personaConfig.js          V4: PERSONAS array (7), PERSONA_BY_ID map
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
    │   ├── PersonaProvider.jsx        V4: PersonaProvider + usePersona(); localStorage persistence
    │   ├── Footer.jsx                 V4: site footer with nav links + social icons
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
    │   ├── TopBar.jsx                V4: Brand, nav, PersonaBadge (colored dot + role + switch), theme toggle, "+ New" on /preview
    │   └── LoadingScreen.jsx         Full-screen 4-step animated progress
    └── pages/
        ├── Home.jsx                  V4: Persona-adaptive hero (tagline/subtitle/examples/featuresHighlight), guide tip, URL form, 8 capability cards
        ├── Onboarding.jsx            V4: 2-step persona selection (/onboarding, standalone — no TopBar/Footer)
        ├── Privacy.jsx               V4: Privacy Policy page (/privacy)
        ├── Terms.jsx                 V4: Terms of Service page (/terms)
        ├── Preview.jsx               Tabs (Overview + enrichments), quick-enrichment buttons, save/discard
        └── Dashboard.jsx             V4: Persona label in header; Table/cards, search, pagination, CSV/PDF/Generate/Email
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

## Outstanding tasks for next session

### Highest priority — Supabase migration (still unrun)
```sql
-- Run in Supabase SQL Editor → unlocks full v2 persistence across devices
alter table public.extractions
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;
```

### V4 pending work
- [ ] **Merge `claude/v4-persona-onboard-lEZ1g` → `main`** once approved
- [ ] **Real Supabase Auth** — PersonaProvider currently uses localStorage only. Adding Supabase Auth would allow cross-device persona persistence and proper multi-user isolation.
- [ ] **Preview persona context** — Preview.jsx could show persona-specific enrichment labels (e.g., "Prospect Intel" for sales vs "Site Audit" for SEO). Currently neutral.
- [ ] **Demo video links** — each persona has `demoUrl` + `demoLabel` fields in personaConfig but no "play demo" button is currently shown on the onboarding page (Step 2) or Home. Add a `<PlayCircle>` button that opens the demo URL.
- [x] **Blog, Pricing, Changelog, About** — now env-var driven (`VITE_LINK_BLOG`, `VITE_LINK_PRICING`, `VITE_LINK_CHANGELOG`, `VITE_LINK_ABOUT` in `.env.example`). When unset, link is hidden entirely (no placeholder anchors). Documented in config.js.
- [ ] **Sign-in modal** — currently "Sign in" / "Get started" navigates to /onboarding. A proper modal for returning users (entering name/email) would be more polished.

### V4 fixes applied in last session
- Footer brand div: `onKeyDown` keyboard handler added (a11y)
- Home.jsx guide tip: `localStorage.getItem/setItem` wrapped in `try/catch` (private browsing safety)
- `.topbar-username` hidden on viewports ≤ 760px via media query
- Footer `Company` section filtered from render when both `LINK_ABOUT` and `LINK_BLOG` are unset (no empty nav column)
- E2E test suite: **90/90 passed, 0 failed**

### V2 pending work (still applies)
- [ ] Set Netlify environment variables to match `.env` and trigger a redeploy
- [ ] Switch webhook to the **production** n8n URL and activate the workflow
- [ ] Add a **Netlify Function proxy** for `VITE_AI_API_KEY` before real production
- [ ] Connect GitHub repo → Netlify for auto-deploys on push to `main`
- [ ] `version-2.0` branch still exists; can be deleted with `git push origin --delete version-2.0`

---

## How to continue developing

```bash
cd /home/user/scrapelite    # working dir (remote) or /Users/vikash/Extracta (local)
git checkout claude/v4-persona-onboard-lEZ1g
git status                   # should be clean
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
5acac2f  V4: Persona-based onboarding, persona-adaptive UI, Privacy/Terms pages, Footer
5c803b5  Add CLAUDE.md — complete project context for new sessions
5b267d3  Merge pull request #1 from vikashkaruna/agent-with-secrets-scanning-bypass-37db
6e1d499  Deploy Vite project to Netlify with secrets scanning bypass
278ff5c  Merge version-2.0 into main: Extraction & Enrichment update (v2.0)
c45f77d  Dashboard exports: full-capability CSV + new PDF, moved to the top
47a6c76  Fix misaligned "Extracted" date column in dashboard table
a747769  v2.0: persist enrichments map to Supabase (cross-device sync)
```

---

## Session history summary (what was built in this session)

This single session took the project from a finished V1 MVP to a full v2.0 platform:

**v2.0 features added:**
- Custom JSON Schema Extraction (textarea + LLM mode + preset chips)
- Domain Mapping (`/map` endpoint → searchable URL list)
- Contacts & Emails toggle (auto-populates leadership contact prompt)
- Integrated Content Generation modal (3 formats, real Claude output)
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
