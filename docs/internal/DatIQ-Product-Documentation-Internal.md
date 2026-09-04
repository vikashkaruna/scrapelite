# DatIQ — Complete Product Documentation (Internal)

> **INTERNAL master reference.** This document is the full product + architecture record, including
> technical sections (stack, data model, persistence, environment). It is **not** the public help site.
>
> - **Public, end-user help** is generated from `docs/DatIQ-User-Guide.md` → `public/help/` (sanitized: no code, DB, or internals).
> - **Public developer API reference** lives in `docs/DatIQ-Developer-API.md` → `public/help/developers.html`.
> - Keep anything code-, database-, or infrastructure-specific in THIS file only — never in the two public sources above.

> **Zero-code web extraction & enrichment platform**
> Paste any URL → get its structure, an AI summary, and one-click B2B enrichment — no scraping scripts required.

| | |
|---|---|
| **Product** | DatIQ |
| **Documented version** | **V1.0 production + Intelligence Workflows (PRD 1-5)** (current staging promotion candidate; workflow templates, bulk account intelligence with ICP scoring, competitor watchlists with materiality classification, native signal routing, shareable reports with five visibility levels, team workspaces — on top of the composer / background runs / addressable batches / one Push menu baseline) |
| **Live site** | https://datiq.app (Netlify project `datiqapp`) |
| **Repository** | https://github.com/vikashkaruna/scrapelite |
| **Document purpose** | Internal master reference for the product, its screens, and its architecture. Source of truth for the public help split-outs above, onboarding, and support knowledge base. |
| **Last updated** | 2026-09-04 (documentation + public-surface refresh for the intelligence-workflow release. See §16 for what changed and where. User guide grew from 17 to 23 sections — six new workflow guides, so eight help URLs renumbered and carry 301s; five new use-case pages; four new changelog groups; four new blog posts; six new FAQ entries in both the visible list and the JSON-LD; `llms.txt` / `llms-full.txt` repositioned from extractor to platform. **Two integrity fixes worth knowing about:** four fabricated testimonials from named people and several invented usage statistics were removed from live use-case pages, and stale pricing claims — Select at $19/mo with 100 extractions, integrations gated to Business — were corrected against `pricingConfig.js`.) |

---

## How to read this document

This document is written to serve three downstream uses, so it is deliberately structured and self-contained:

1. **In-app HTML help** — every screen and feature has its own clearly-titled section with a screenshot, so each section can be exported to a standalone HTML help page reachable from the DatIQ menu.
2. **Onboarding & sales enablement** — the persona, segment, and prioritization sections explain *who* each feature is for and *why* it exists.
3. **Chatbot / knowledge base** — short, question-style headings, a glossary, and an FAQ make the content easy to chunk and retrieve.

> **Navigation map for the help menu** — Each top-level numbered section below is intended to become one help page:
> Overview · What's New / Versions · Who It's For · Screens (Home, Preview, Dashboard) · Features A–Z · Workflows · Exports & Sharing · Technology & Architecture · Data & Privacy · FAQ · Glossary.

### Table of contents

1. [Product overview](#1-product-overview)
2. [Product evolution: MVP → v1 → v2.0 → latest](#2-product-evolution-mvp--v1--v20--latest)
3. [Who it's for — personas, user groups & business segments](#3-who-its-for--personas-user-groups--business-segments)
4. [Feature → persona / segment mapping](#4-feature--persona--segment-mapping)
5. [Feature & functionality prioritization principles](#5-feature--functionality-prioritization-principles)
6. [Complete feature catalog](#6-complete-feature-catalog)
7. [Application flow — screen-by-screen, with screenshots](#7-application-flow--screen-by-screen-with-screenshots)
8. [End-to-end workflows](#8-end-to-end-workflows)
9. [Exports & sharing](#9-exports--sharing)
10. [Technology stack, their uses & architecture](#10-technology-stack-their-uses--architecture)
11. [Data model & persistence](#11-data-model--persistence)
12. [Privacy, security & data handling](#12-privacy-security--data-handling)
13. [FAQ & troubleshooting](#13-faq--troubleshooting)
14. [Glossary](#14-glossary)
15. [Appendix — regenerating screenshots & environment](#15-appendix--regenerating-screenshots--environment)

---

## 1. Product overview

**DatIQ turns any public web page into structured, usable data in seconds — without writing a single line of scraping code.**

You paste a URL. DatIQ returns:

- the page's **heading outline** (H1–H6, in document order),
- **every link** on the page (internal & external, de-duplicated and AI-categorized),
- a **plain-language AI summary** of what the page is about and how it's structured,

and then lets you go further with **enrichment** — pulling specific facts out of the page in plain English (contacts, pricing, social links, mission, or any custom field you describe), **mapping an entire domain's** indexed URLs, and **generating marketing content** (SEO outlines, competitor briefs, social posts) from anything you've saved.

Everything you keep lands in a personal **Dashboard**, where it can be searched, re-opened, exported (CSV / PDF) or emailed.

### The core promise

| Pillar | What it means |
|---|---|
| **No code** | No selectors, no XPath, no Python. A URL and a toggle are the entire interface. |
| **Structured in seconds** | Results come back as clean, typed data (headings, links, JSON enrichments), not raw HTML. |
| **Extract *and* enrich** | v2.0's defining shift: DatIQ doesn't just *read* a page, it *answers questions about it* — contacts, pricing, mission — as reusable, saved tabs. |
| **Always usable** | The app degrades gracefully: with API keys it makes real calls; without them it runs on realistic mock data and browser storage, so it never hard-fails. |

### One-line positioning

> *"Firecrawl + an LLM, wrapped in a zero-config product that a non-technical operator can drive — and that remembers everything it learns about a URL."*

---

## 2. Product evolution: MVP → v1 → v2.0 → latest

DatIQ grew in three product stages plus a deployment stage. Understanding the arc explains why the UI is layered the way it is (simple core, progressively-disclosed power features).

### Stage 1 — MVP / v1: "Extract & summarize"

The original product answered one question: *"What's on this page?"*

- URL input with validation and example chips
- Firecrawl-backed scrape → **headings (H1–H6)** + **links**
- **AI summary** of the page (Claude)
- **Preview** screen to review the result
- **Save to Dashboard**; dashboard list with search and pagination
- **CSV export**
- Robust **error handling** (typed error modal with retry), **toasts**, light/dark theme
- Graceful fallback: mock data + `localStorage` when no API keys are configured

**Design decisions locked in this stage** (still in force): a hand-built CSS design-system (not Tailwind-ified), centralized icon map, mock-but-real-ready services, and a dashboard that starts empty (no seed data).

### Stage 2 — v2.0: "Extract & **enrich**"

v2.0 is the current feature release. It transformed DatIQ from a *reader* into an *enrichment platform*. Everything from v1 remains; v2.0 **adds**:

| # | v2.0 capability | What it does |
|---|---|---|
| 1 | **Custom extraction** | Describe any field in plain English ("product name, price, rating") → Firecrawl's LLM extraction returns structured JSON. |
| 2 | **Domain mapping** | Discover **every indexed URL** on a site via Firecrawl's `/map` endpoint, returned as a searchable list. |
| 3 | **Contacts & emails** | One toggle auto-loads a leadership/board/contact-email extraction prompt. |
| 4 | **Quick enrichment** | Five one-click capabilities (Contacts, Leadership & Board, Social Links, Mission, Pricing) that run **in the background** and are saved as **persistent tabs** per URL. |
| 5 | **Content generation** | Turn any saved page into an **SEO blog outline**, **competitor summary**, or **social posts** (Claude). |
| 6 | **AI link categorization** | Each link is tagged Internal / External / Social / Email / Document / Media (heuristics always, refined by Claude when available). |
| 7 | **Full-capability CSV export** | CSV now deep-flattens meta + headings + links + domain map + every enrichment. |
| 8 | **PDF export** | jsPDF report of the same complete content, lazy-loaded only on demand. |
| 9 | **Email selected extractions** | Send saved pages to recipients (webhook → email API → `mailto` fallback). |

The Home screen surfaces these as an **8-capability card grid**, and the Preview screen gained **tabs** (Overview + one per enrichment) that **persist across reloads and devices**.

### Stage 3 — Latest (deployment / operations)

The most recent commits after the v2.0 merge were **infrastructure, not new product features**:

- **Deploy to Netlify** with secrets-scanning bypass for the build (`6e1d499`)
- Merge of the deployment PR **#1** (`5b267d3`)
- Addition of the in-repo project context file `CLAUDE.md` (`5c803b5`)

> **So "the latest version" of the *product* is v2.0.** The latest *changes* made it publicly deployed and reproducible. There is no v3 feature set yet — the "Outstanding tasks" (Supabase migration, Netlify env vars, AI proxy, auth) are the runway toward it.

---

## 3. Who it's for — personas, user groups & business segments

DatIQ's enrichment prompts and content formats are unmistakably **B2B go-to-market oriented** (leadership contacts, pricing tiers, competitor briefs, SEO outlines). The product is built for **non-technical operators who need web data fast**.

### Primary personas

| Persona | Job to be done | Features they live in |
|---|---|---|
| **Sales / SDR / RevOps** | Build prospect lists; find decision-makers and contact emails; understand a target account's pricing and positioning. | Contacts & emails, Leadership & Board, Custom extraction, Email selected, CSV export |
| **Marketing / Content / SEO** | Repurpose competitor and reference pages into content; map a site's structure for an SEO audit. | Content generation (SEO outline, social posts), Domain mapping, Headings outline, AI summary |
| **Competitive / Market intelligence** | Track how competitors position, price, and structure their sites. | Competitor summary, Pricing & Plans, Company Mission, Custom extraction |
| **Founders / Small teams / Agencies** | Do research-grade web extraction without hiring an engineer or buying a scraping stack. | The whole product — zero-config is the point |
| **Researchers / Analysts** | Capture page structure + a readable summary; keep a searchable archive of sources. | AI summary, Headings, Links, Dashboard search, PDF export |
| **Recruiters / BD** | Find leadership/board members and general contact channels at target companies. | Leadership & Board, Contacts & emails, Social Links |

### User groups (by access pattern)

- **Single operator / demo user** — runs on `localStorage`, no backend needed. The app is fully functional with zero setup.
- **Configured team** — Supabase-backed; saved extractions and enrichment tabs sync across devices/browsers.
- **Evaluator / prospect** — lands on the live demo, which runs against real APIs or rich mock data.

### Business segments

| Segment | Fit | Why |
|---|---|---|
| **SMB & startups** | ★★★★★ | No code, no infra, instant value; the free/local mode removes all onboarding friction. |
| **Sales & marketing agencies** | ★★★★★ | Lead enrichment + content repurposing in one tool, exportable to CSV/PDF/email. |
| **Mid-market GTM teams** | ★★★★☆ | Quick enrichment + dashboard archive; would benefit from the planned auth + Supabase sync. |
| **Enterprise** | ★★★☆☆ | Needs the planned hardening (server-side AI proxy, auth, multi-user isolation) before broad rollout. |
| **Solo researchers / journalists** | ★★★★☆ | Fast structure + summary + durable, searchable archive. |

---

## 4. Feature → persona / segment mapping

A consolidated cross-reference (useful as chatbot training data for "which feature should I use for X?").

| Feature | Primary persona | Secondary | Business value |
|---|---|---|---|
| Heading structure (H1–H6) | Researcher, SEO | Marketing | Understand page intent & content hierarchy |
| Every link (AI-categorized) | SEO, Researcher | Sales | Link audit; find social, docs, contact channels |
| AI summary | Everyone | — | Instant "what is this page" without reading it |
| Custom extraction | Sales, Competitive intel | Everyone | Pull *any* field in plain English |
| Domain mapping | SEO, Researcher | Competitive intel | Site-wide URL discovery / audit |
| Contacts & emails | Sales, Recruiting | BD | Decision-maker outreach lists |
| Quick: Find Contact Info | Sales/SDR | Recruiting | Names, titles, emails, phones |
| Quick: Leadership & Board | Sales, Recruiting, BD | Investors | Org top-of-house mapping |
| Quick: Social Links | Marketing, BD | Sales | Multi-channel presence |
| Quick: Company Mission | Competitive intel, Sales | Content | Positioning & value prop |
| Quick: Pricing & Plans | Competitive intel, Sales | Product | Pricing benchmarking |
| Content: SEO Blog Outline | Content/SEO | Marketing | Ready-to-write structure |
| Content: Competitor Summary | Competitive intel, Sales | Strategy | Battle-card raw material |
| Content: Social Posts | Marketing | Founders | Quick promo copy |
| CSV export | Sales/RevOps | Analysts | Feed CRMs / spreadsheets |
| PDF export | Researcher, Marketing | Exec reporting | Shareable report |
| Email selected | Sales, Marketing | Anyone | Distribute findings |
| Dashboard search & archive | Everyone | — | Reusable, searchable knowledge store |

---

## 5. Feature & functionality prioritization principles

These are the principles that guided what got built (and how), reconstructed from the product's locked architecture rules. They double as guidance for future features.

1. **Zero-config first, power on demand.** The single most important rule: a brand-new user with no API keys and no database can use the *entire* product immediately (mock services + `localStorage`). Real integrations are additive, never required. *Priority: removing onboarding friction beats every individual feature.*

2. **Graceful degradation over hard failure.** Every external dependency has a fallback:
   - No Firecrawl key → realistic mock scrape.
   - No AI key → heuristic link categorization + templated summary/content.
   - No Supabase → `localStorage`.
   - Un-migrated Supabase columns → save the v1 columns, store v2 data locally, log a warning — **never block a save**.
   - Webhook/email failure → fall through (webhook → email API → `mailto`), fire-and-forget, never blocks the UI.

3. **Progressive disclosure.** The Home screen leads with one input and one button. Scrape options (toggles) sit below; the custom-extraction textarea only appears when toggled; advanced capabilities are surfaced as discoverable cards. Complexity is opt-in.

4. **Non-blocking enrichment.** Quick Enrichment runs **in the background** — the page stays visible, only the clicked control spins. Users never hit a full-screen loader for a secondary action. This was an explicit, locked UX rule.

5. **Persistence & resilience of learned data.** Anything DatIQ *learns* about a URL (enrichment tabs) is saved in two places (local cache + Supabase column) and merged newest-wins on read, so insights survive reloads, navigation, and device switches.

6. **Exports must be complete.** CSV and PDF bundle *everything* known about a page — including every enrichment capability, deep-flattened — because the export is often the real deliverable for a sales/marketing user.

7. **Cost & performance discipline.** AI calls are bounded (link categorization caps at 60 links; prompts are tight). Heavy libraries (jsPDF) are **lazy-loaded** only when the user actually exports. Concurrent work (summary + categorization) runs in parallel.

8. **Design-system integrity.** A hand-authored CSS token system (`design-system.css` + `screens.css`) is treated as a locked asset — never rewritten into utility classes — so the product keeps a consistent, bespoke look.

9. **Safety of irreversible actions.** Deletes are optimistic with rollback on failure; saves retry without losing the extraction; superseded async requests are ignored (request-id guard) so a fast second action can't be overwritten by a slow first one.

---

## 6. Complete feature catalog

A flat, exhaustive list (good for chatbot retrieval). Grouped by area.

### 6.1 Extraction (input)

The **Home composer (`HeroComposer`) is the only entry point** for every job kind — single, batch, and
scheduled. `/batch` is a run + results surface reached *from* the composer, never a place users go first;
it is not in the top nav (`Extract` matches `/batch` too).

- **Composer input** with live validation and normalization (adds scheme if missing), classified by
  `classifyInput` into `single` / `multi` / `csv` / `embedded` / `text`.
- **`embedded` kind** — prose that *contains* links (email, Slack thread, Markdown list). Deliberately
  **not auto-routed**: the composer renders an inline chooser ("Extract all N" / "Extract this text as one
  page") because the intent is genuinely ambiguous. Choosing the links reuses `ingestUrls`, the same path
  as drag-drop and CSV import. **HTML stays on the `text` path on purpose** — `buildStructureFromText`
  runs it through `parseHtml`, which beats whitespace tokenising.
- **Example chips** — `lumio.io`, `stripe.com/pricing`, `notion.so/help`.
- **Intent chips** — AI summary / Find contacts / Scrape pricing / Map site / Custom.
- **`＋` menu** — Import CSV, Add multiple URLs, and **Run in background** (sticky via
  `datiq.runInBackground`; a dot on `＋` when active). Applies to single and batch alike.
- **Advanced options** — **Render JavaScript** (waits ~3 s for SPA hydration) and **Generate AI content for
  each URL** + `CONTENT_FORMATS` picker. Both apply to single *and* batch runs; the content toggle and the
  CSV detected-column readout were moved here from `/batch`, where they existed only on that screen and so
  vanished whenever a run started from Home.
- **Custom extraction panel** — free-text prompt box + 5 Quick-Action preset chips (shown when intent is Custom).
- **Guest gating** — every extraction entry point calls one `requireGuestCredit(kind)` on the provider.

### 6.2 Extraction (output, on Preview)
- **Page identity** — favicon monogram, title, clickable URL, stat counts.
- **AI summary** — 3–5 sentence plain-language overview.
- **Headings card** — full H1–H6 outline, indented by level.
- **Links card** — de-duped links with **AI category tags** and an All / Internal / External filter; per-category counts.
- **Domain map card** (map mode) — searchable/filterable list of all discovered URLs.

### 6.3 Enrichment
- **Quick Enrichment** panel — 5 one-click capabilities:
  - **Find Contact Info** — names, titles, emails, phones.
  - **Leadership & Board** — execs, founders, directors + general contacts.
  - **Social Links** — LinkedIn, X/Twitter, Facebook, Instagram, YouTube, GitHub.
  - **Company Mission** — mission, value proposition, description.
  - **Pricing & Plans** — every tier: name, price, period, features.
- **Background execution** — page stays visible; only the clicked button shows a spinner, then a ✓ badge.
- **Enrichment tabs** — Overview + one tab per executed capability; the new result's tab auto-activates.
- **Refresh** — re-running a capability overwrites its tab (no duplicates).
- **Persistence** — tabs survive reload and re-open from Dashboard; merged from local cache + Supabase newest-wins.
- **Structured-data renderer** — renders arbitrary enrichment JSON: email links, URL links, primitives, arrays, nested objects.

### 6.4 Content generation (from saved pages)
- **SEO Blog Outline** — title, meta description (≤155 chars), 4–6 H2s with H3 sub-points, target keywords.
- **Competitor Summary** — what they do, positioning, target customers, strengths, likely gaps.
- **Social Posts** — three short LinkedIn-tone promotional posts.
- **Copy button** in the modal.

### 6.5 Dashboard (archive)
- **Table / Card** layout toggle (persisted).
- **Smart search** — AND-logic across title, URL, summary, headings, and links.
- **Viewport-adaptive pagination** — rows-per-page adjust to window height.
- **Selection** — per-row + select-all-on-page; selection bar with Clear / Generate / Send email.
- **Row actions** — View, Delete (optimistic with rollback).
- **Header actions** — CSV, PDF, New extraction.

### 6.6 Exports & sharing
- **CSV** — comprehensive, deep-flattened (all capabilities).
- **PDF** — jsPDF report, lazy-loaded, full content.
- **Email** — send selected extractions; webhook → email API → `mailto` fallback.
- Export scope = selected rows, or everything matching the current search if nothing is selected.

### 6.7 System / cross-cutting
- **Light / dark theme** (persisted).
- **Toasts** (2.6s auto-dismiss) for every action.
- **Typed error modal** with category-specific copy and a retry action.
- **Reload resilience** — last-viewed extraction restored on Preview after a browser reload.
- **Webhook notification** on save (fire-and-forget).

---

## 7. Application flow — screen-by-screen, with screenshots

DatIQ is a 3-screen single-page app with a persistent top navigation bar.

```
┌─────────────────────────────────────────────────────────────────┐
│  TopBar:  DatIQ logo │ Extract · Dashboard │ 🌙 theme │ +New │
└─────────────────────────────────────────────────────────────────┘
        │                         │                        │
        ▼                         ▼                        ▼
   /  (Home)   ──Extract──▶  /preview  ──Save──▶     /dashboard
   Extract screen           Review & enrich         Saved archive
        ▲                         │                        │
        └──────── New ◀───────────┴────── View / Open ◀────┘
```

**The end-to-end loop:** *Paste a URL on Home → review structure + summary on Preview → optionally enrich (tabs) → Save → it appears in the Dashboard → reopen, export, generate content, or email it.*

---

### 7.1 Screen 1 — Home (Extract) · route `/`

![DatIQ Home screen](assets/screenshots/01-home.png)

**Purpose:** the entry point — turn a URL into an extraction.

**What's on the screen (top to bottom):**

1. **Eyebrow** — "No code · structured in seconds" with a **V1.0** pill.
2. **Hero headline** — "Intelligence from the Web." + a one-paragraph value proposition.
3. **Common jobs** — a 6-card grid of fast-path outcomes (lead list, pricing, competitor intel, SEO audit, tech stack, job postings).
4. **Example chips** — `example.com`, `stripe.com/pricing`, `anthropic.com`; click to fill the composer.
5. **The composer (`HeroComposer`)** — one textarea plus a toolbar: **`＋`** (Import CSV · Add multiple URLs · Run in background), **Batch** toggle, **Schedule** dropdown, and the **Extract** action button whose icon reflects the mode (page / layers / calendar).
6. **Trust strip** — Encrypted in transit · Auto-deleted in 30 days · Never used to train AI.
7. **Intent chips** — "What do you want to extract?": AI summary / Find contacts / Scrape pricing / Map site / Custom.
8. **Custom-extraction panel** (when intent is Custom) — a textarea plus 5 **Quick Action** preset chips: Find Contact Info, Leadership & Board, Social Links, Company Mission, Pricing & Plans.
9. **Advanced options** (collapsed) — Render JavaScript, Generate AI content for each URL + content-type chips.
10. **Capability cards**, **template library** (12 recipes), and the **Try-it-now** auto-playing demo.

**Behavior notes:**
- Map mode ignores per-page options and routes to the `/map` endpoint; a note explains this.
- **Multi-URL input routes to `/batch` and runs there** — unless **Run in background** is on, in which case the run starts and *stays* on Home (routing away to say "you can navigate away" would defeat the point).
- Progress is reported by **one surface**, `ExtractionProgressDock`, for both job kinds. A batch shows a real `completed/total` percentage; the single-extraction stepper is cosmetic pacing, because a lone scrape reports no progress.
- On failure, you're returned to Home with an error modal offering **Try again** (re-runs the same URL + options).

**Dark mode** (theme is one click in the top bar, and persists):

![DatIQ Home in dark mode](assets/screenshots/02-home-dark.png)

---

### 7.2 Screen 2 — Preview (Review & Enrich) · route `/preview`

![DatIQ Preview screen](assets/screenshots/03-preview.png)

**Purpose:** review the extraction, enrich it, then save or discard.

**What's on the screen (top to bottom):**

1. **Action bar** — **Back** (to Home), **Discard** (drops it, returns Home), **Save to Dashboard** (persists + navigates to Dashboard, with a saving overlay).
2. **Page identity** — favicon monogram, page title, clickable URL, and **stats** (headings & links count, or URL count in map mode).
3. **AI summary card** — the generated overview, badged "AI".
4. **Quick enrichment panel** — the five capability buttons. Each runs in the background:
   - while running → a spinner on the button,
   - when done → a green ✓ badge,
   - clicking a done button **refreshes** it.
   *(In the screenshot, Leadership & Board and Pricing & Plans show ✓ — they've been run.)*
5. **Tabs** — **Overview** plus one tab per executed enrichment (here: *Leadership & Board*, *Pricing & Plans*).
6. **Tab content:**
   - **Overview** → the **Headings** card (H1–H6 outline) and the **Links** card (AI-tagged, filterable All/Internal/External, with per-category counts) side by side.
   - **An enrichment tab** → the structured data for that capability (e.g., a contacts list or pricing table), with a **Refresh** button and a "Saved N minutes ago" timestamp.

**Map-mode variant** — when you extracted with **Map entire domain**, the Overview tab shows a single **Domain map** card: a searchable list of every discovered URL, with a filter box and a count pill. (Quick enrichment is hidden in map mode.)

![DatIQ domain map preview](assets/screenshots/09-domain-map.png)

**Behavior notes:**
- Quick enrichment **never** shows the full-screen loader or navigates — the page stays put.
- Enrichment tabs are saved per-URL and **reappear** when you reopen this page from the Dashboard, even on another device (when Supabase is configured).
- The last-viewed extraction is restored if you reload the browser on this screen.

---

### 7.3 Screen 3 — Dashboard (Saved archive) · route `/dashboard`

![DatIQ Dashboard, table view](assets/screenshots/06-dashboard-table.png)

**Purpose:** your searchable archive of saved extractions; the hub for export, content generation, and email.

**What's on the screen:**

1. **Header** — "Your extractions", a count subtitle, and the action cluster:
   - **Batch runs** dropdown and **Collection** filter,
   - **Table / Card** layout toggle,
   - **Export ▾**, **Push ▾**, **Refresh**,
   - **New extraction** (back to Home).
2. **Toolbar** — a **smart search** box (matches across title, URL, summary, headings, links), type filter chips (All / Single / Batch / Scheduled), and an inline selection row.
3. **Table** (default) — columns: select, **Page** (favicon + title + host), **Type**, **AI summary** (snippet), **Structure** (heading & link counts), **Extracted** (date), and row actions (**Collection**, **View**, **Delete**). Clicking a row opens it in Preview.
4. **Pager** — appears when results exceed the viewport-fit page size.

**Selection** — ticking rows shows an inline row beside the filters: *N selected · Clear · **Generate** · **Send email***.
- **Generate** opens the **Content modal** (SEO outline / competitor summary / social posts) for the first selected page.
- **Send email** opens the **Email modal** (multi-recipient) to send the selected pages.

**The floating selection bar was removed.** It duplicated the page — count / Clear / Generate / Email are the
inline selection row, and its `Export ▾` was the toolbar's. **Push was the only thing unique to it**, which
was the only reason it existed. Push moved to the toolbar **between Export and Refresh** and shares Export's
selection semantics via `exportTargets()` (the selection when there is one, everything filtered otherwise),
so *"Export all 8"* and *"Push to (8)"* agree. Removed with it: the `SelectionBar` component, `.dash-float-*`
CSS, and the `float-bar-in` keyframe.

**Local-only extractions.** Signed-out work is saved to `localStorage` but is not durable. Dashboard shows how
many pages are browser-only, and on sign-in `claimLocalExtractions()` replays them onto the account. A row
that merely fell back to localStorage again is **not** counted as claimed — otherwise the warning would
disappear while the data was still browser-only.

**Card view** — the same data as cards (toggle persists):

![DatIQ Dashboard, card view](assets/screenshots/07-dashboard-cards.png)

**Empty states** — a friendly empty state when nothing is saved ("No extractions yet") and a "No matches" state when a search returns nothing.

---

### 7.4 Screen 4 — Batch (Multi-URL extraction) · route `/batch`

![DatIQ batch results](assets/screenshots/04-batch.png)

`<h1>` is **Batch extraction** (was "Multi-URL extraction"). This is a **run + results surface, not an entry
point** — users arrive from the composer, the progress dock, or Dashboard run history. It is **not in the top
nav**; `Extract` matches `/batch` too.

**The run lives above the router.** `runBatch()` used to be called inside `Batch.jsx`'s component body,
holding its `AbortController` and progress in that component's state — so **navigating away abandoned the
run**. `src/components/BatchRunProvider.jsx` now owns it. Post-run persistence moved with it, because a run
that finishes after the user has navigated away must still save and record itself.

On completion a **results table** lists each page with a summary snippet and per-URL status, with **filter**
(All / Success / Failed), **sort**, and a per-row **Retry**. All successful pages **auto-save to the
Dashboard** and are grouped as one batch run. Results export via **Export ▾** (CSV/PDF/Markdown/JSON) and
send via **Push ▾**.

**Addressable results — `/batch?run=<id>`.** `saveBatchRun` stores **every row including failures**.
Failures previously lived only in React state, so leaving the page lost the failure list *and* the per-row
Retry. Dashboard cannot stand in: only successes are saved as extractions, so a failed URL has no row there
at all. Dashboard's run banner links back when a run had failures. Archived rows carry
`url/status/error/title` only — enough for the table, filters, sort and Retry, but not heading/link counts;
the saved pages are on Dashboard and the results view says so.

The typed list is persisted (draft) so it survives refresh and back-navigation; **New batch** clears it.
Per-URL extraction counts toward the monthly quota; plans cap URLs-per-batch.

### 7.5 Screen 5 — Schedules (Monitoring) · route `/schedules`

![DatIQ schedules screen](assets/screenshots/05-schedules.png)

Schedules are recurring extractions that **watch a page for changes** and optionally alert by email. They are
created either from the Home composer (preset cadence) or here via the inline **ScheduleEditor** (no modal). The
editor sets URL, intent, a **cadence** (presets or a custom frequency · day · time builder), an optional
**"run until" end date**, an alert email, and a name. List cards show cadence, last/next run, and an expandable
detail panel; each supports **Run now** (with change detection), **Edit**, **Pause/Resume**, and **Delete**.
Automated (hourly) runs detect changes, record them, and fire the alert email + automation webhook; the manual
**Run now** is client-side and only reports the change on screen.

**Schedules require auth to be real — this was a functional bug.** `saveSchedule` posts to `/api/schedules`;
a signed-out user got 401, and `schedulerService.shouldFallback` treated 401 as "backend unreachable",
keeping the schedule in `localStorage`. But what *executes* schedules is
`netlify/functions/scheduled-runner.js` — hourly, reading Supabase, with no view of a browser's storage.
**The schedule listed as active, advertised a next run time, and was inert.** The same-named helper in
`extractionsRepo` lists 401 **correctly**, because an extraction in localStorage still works; that asymmetry
is now stated in both files, since sharing a function name is what made them look interchangeable.

- 401/403 removed from `schedulerService.shouldFallback`; `saveSchedule` rethrows and rolls the optimistic
  local write back. Reads (list/delete/toggle) still tolerate auth errors.
- `ScheduleEditor` stashes the schedule (`lib/pendingSchedule.js`, **sessionStorage** — OAuth navigates the
  document away and back) and prompts sign-in. A global `PendingScheduleFlush` saves it once a session
  exists, triggering on *the presence of a stash plus a user*, **not** a signed-out → signed-in transition:
  an OAuth callback can land with the session already restored, so the transition may never be observed.
- Any schedule that did degrade to local-only is flagged `_localOnly`; the card says **"Not running" /
  "Sign in to start this schedule"** instead of a fake next run.

### 7.6 Modals & system UI

| Element | Trigger | What it does |
|---|---|---|
| **Loading screen** | Submitting an extraction | Full-screen 4-step animated progress. |
| **Saving overlay** | Save on Preview | Branded loader over the page while persisting. |
| **Content modal** | Generate (Dashboard) | Pick a format, generate via Claude, copy the markdown. |
| **Email modal** | Send email (Dashboard) | Enter recipients, send selected extractions. |
| **Error modal** | Any failed action | Category-specific message + **Try again** retry. |
| **Toasts** | Every action | Brief confirmation, auto-dismiss (~2.6s). |
| **Theme toggle** | Top bar | Light/dark, persisted. |

---

## 8. End-to-end workflows

Concrete, step-by-step task recipes (ideal chatbot "how do I…" answers).

### Workflow A — Extract a page and save it
1. On **Home**, paste a URL (or click an example chip).
2. *(Optional)* enable **Render JavaScript** for an SPA.
3. Click **Extract** → wait for the loader → land on **Preview**.
4. Review the AI summary, headings, and links.
5. Click **Save to Dashboard**.

### Workflow B — Build a contact / leadership list for a prospect
1. Extract the company's homepage (or About page).
2. On **Preview**, in **Quick enrichment**, click **Leadership & Board** (and/or **Find Contact Info**).
3. The result saves as a tab — open it to see names, titles, emails.
4. **Save to Dashboard**.
5. Later, select the row → **CSV** to push the contacts into your CRM/spreadsheet, or **Send email** to share.

### Workflow C — Benchmark a competitor's pricing
1. Extract the competitor's pricing page (e.g., `stripe.com/pricing`).
2. Click **Pricing & Plans** in Quick enrichment → a structured tier table is saved as a tab.
3. *(Optional)* click **Company Mission** for positioning.
4. Save → from the Dashboard, **Generate → Competitor Summary** for a battle-card draft.

### Workflow D — Map a site for an SEO audit
1. On **Home**, toggle **Map entire domain**, paste the domain, click **Map domain**.
2. On **Preview**, use the **Domain map** card's filter to scan URLs by path.
3. Save → export to **CSV/PDF** for the audit deliverable.

### Workflow E — Turn a reference page into content
1. Extract and save any page.
2. On the **Dashboard**, select it → **Generate**.
3. Choose **SEO Blog Outline**, **Competitor Summary**, or **Social Posts**.
4. **Copy** the generated markdown into your CMS or doc.

### Workflow F — Custom field extraction
1. On **Home**, toggle **Custom extraction**.
2. Type exactly what you want, e.g. *"Extract the product name, price, and customer rating."*
3. Extract → the structured result appears as a **Custom extraction** tab on Preview, and persists.

---

## 9. Exports & sharing

| Channel | Scope | Contents | Notes |
|---|---|---|---|
| **CSV** | Selected rows, or all search matches if none selected | Meta + headings + links + domain map + **every enrichment capability**, deep-flattened to JSON paths | Best for CRM/spreadsheet import |
| **PDF** | Same scope | Same complete content as a formatted report | jsPDF, **lazy-loaded** only on click |
| **Email** | Selected rows | Title, URL, AI summary, heading/link counts per page | Delivery chain: webhook → email API → `mailto` fallback |

**Export scope rule:** if you've selected rows, exports use the selection; otherwise they export everything currently matching the search. Implemented once as `exportTargets()` and shared with **Push**, so the two menus can never disagree about scope. Each exported page is **hydrated** with its enrichments from both local cache and Supabase before export, so nothing is missed.

### Export ▾ vs Push ▾ — one affordance each

Destinations used to be reachable two ways with two different lists: the Push menu (HubSpot / Notion /
Airtable / Slack) and `Export ▾ → Send to →` the `ExportIntegrations` modal (those four **plus Google
Sheets**) — the shorter list being the more prominent one.

- **Google Sheets is not a push**: nothing to authorise, it downloads a CSV and opens a blank sheet. It is
  now a row in the Push menu marked *"No setup needed"*, running the same `openInGoogleSheets()` helper, and
  is deliberately **not** a `PUSH_PROVIDER`.
- **"Send to" is gone from all three Export dropdowns** (Batch, Dashboard header, Dashboard selection).
  Export ▾ is downloads + clipboard only.
- The button is always **"Push"**, never "Push N" — the count belongs in the menu header.
- `ExportIntegrations` is **not deleted**: its Airtable pane carries the only "Load columns" recovery for an
  empty `field_map`, which nothing else offers (Account → Integrations has no field mapping). It moved
  behind an optional **"More destination options…"** link inside the Push menu.
- `PushIntegrationMenu`'s `compact` prop now has **no caller** (the floating bar was its only one). Kept —
  it is part of the component's documented API.

---

## 10. Technology stack, their uses & architecture

### 10.1 Stack at a glance

| Layer | Technology | Why it's used |
|---|---|---|
| **Build tool** | **Vite 5** | Fast dev server + optimized production build; env handling via `import.meta.env`. |
| **UI framework** | **React 18** | Component model; concurrent-friendly hooks. |
| **Routing** | **React Router 6** (v7 future flags) | The 3-route SPA (`/`, `/preview`, `/dashboard`). |
| **Styling** | **Tailwind (utilities only) + a bespoke CSS design system** | Tokens (`--accent`, `--bg`, `--surface`, radii, shadows) live in CSS custom properties; Tailwind is used only for incidental utilities. The token system is a **locked** asset. |
| **Icons** | **lucide-react** via a central `Icon.jsx` map | One place to add/rename icons; no scattered imports. |
| **Scraping** | **Firecrawl API** (`/v1/scrape`, `/v1/map`, JSON/LLM extraction mode) | Turns URLs into HTML/structured data, including LLM-based field extraction and domain mapping. |
| **AI** | **Anthropic Claude** (`claude-haiku-4-5` by default) | Summaries, link categorization, content generation. |
| **Database** | **Supabase** (Postgres + PostgREST) | Cloud persistence of saved extractions & enrichments, with RLS. |
| **Local persistence** | **`localStorage`** | Zero-config fallback + offline mirror + UI prefs (theme, layout, last-viewed, enrichment cache). |
| **PDF** | **jsPDF 4.2.1** | Client-side PDF reports; **lazy-loaded**. |
| **Automation** | **Webhook (n8n)** + optional email API | Save notifications and email delivery. |

No test framework or ESLint config is wired in; scripts are `dev`, `build`, `preview` only.

### 10.2 Architecture overview

DatIQ is a **100% client-side SPA**. There is no custom backend server — the browser talks directly to Firecrawl, Anthropic, and Supabase. A layered design keeps this clean:

```
┌──────────────────────────────────────────────────────────────────────┐
│                              React UI                                  │
│   Pages: Home · Preview · Dashboard      Components: modals, cards…    │
└───────────────┬───────────────────────────────────────────────────────┘
                │ React Context
        ┌───────▼─────────────────────────────────────────┐
        │           ExtractionProvider (orchestrator)      │
        │  extract() · enrich() · save() · view()          │
        └───┬───────────────┬──────────────┬───────────────┘
            │               │              │
   ┌────────▼──────┐ ┌──────▼───────┐ ┌────▼─────────────┐
   │ firecrawl     │ │ aiService    │ │ extractionsRepo  │
   │ Service       │ │ summarize/   │ │ + enrichmentStore│
   │ scrape/map/   │ │ categorize/  │ │ (Supabase +      │
   │ customPrompt  │ │ generate     │ │  localStorage)   │
   └───┬───────────┘ └──────┬───────┘ └────┬─────────────┘
       │                    │              │
  ┌────▼────┐         ┌─────▼────┐    ┌────▼──────┐   ┌──────────┐
  │Firecrawl│         │Anthropic │    │ Supabase  │   │localStorage│
  │  API    │         │  Claude  │    │ (Postgres)│   │ (browser) │
  └─────────┘         └──────────┘    └───────────┘   └──────────┘
        ▲                  ▲                ▲
        └── config.js feature flags decide REAL vs MOCK per service ──┘
```

**Key architectural ideas:**

- **`config.js` is the single source of truth** for which integrations are live. Each flag (`hasFirecrawl`, `hasAI`, `hasSupabase`, `hasWebhook`, `hasEmail`) flips on automatically when its env var is present. It also supports a **runtime override** (`public/runtime-config.js` → `window.__SCRAPELITE_RUNTIME__`) so webhook/email endpoints can change **without a rebuild**.

- **Mock-but-real-ready services.** Every service has two code paths returning the **same shape**: a real API call when configured, a realistic mock otherwise. The rest of the app never knows or cares which ran. This is what makes the zero-config experience possible.

- **`ExtractionProvider` orchestrates the flow.** It exposes `extract` (scrape + summarize + categorize in parallel → Preview), `enrich` (background single-capability extraction → tab), `save`, and `view` (reopen a saved row, merging enrichments). It guards against race conditions with a monotonic **request-id** so a slow earlier request can't overwrite a newer one.

- **Dual-write persistence with safe degradation.** `extractionsRepo` writes to Supabase *and* mirrors to `localStorage`. If the Supabase schema lacks the v2 columns (`custom_extraction`, `domain_map`, `enrichments`), it detects the "missing column" error and **retries with v1 columns only**, keeping v2 data locally — a save never hard-fails.

- **Separation of concerns in `lib/`** — scraping (`firecrawlService`), AI (`aiService`), link heuristics (`linkCategorizer`), prompts (`extractionPresets`), persistence (`extractionsRepo`, `enrichmentStore`, `supabaseClient`), exports (`utils` CSV, `pdfExport`), delivery (`webhook`, `emailService`), config (`config`), and typed errors (`errorMessages`).

### 10.3 How a request flows (sequence)

**Standard extraction** (`extract`):
1. UI calls `extract(url, options)`.
2. `firecrawlService.extractStructure` → real `/v1/scrape` (HTML parsed in-browser into headings/links; `customPrompt` adds JSON LLM extraction) **or** mock.
3. In parallel: `aiService.summarize` + `aiService.categorizeLinks`.
4. Result (+ any custom-extraction enrichment, + previously-saved enrichments for that URL) is committed to context & `localStorage`, then routes to **Preview**.

**Background enrichment** (`enrich`):
1. UI calls `enrich(url, preset)` for one capability.
2. `firecrawlService` runs a focused `customPrompt` extraction.
3. The result is saved as an enrichment entry (local cache + context tab); if the row is already saved, the enrichment map is synced to Supabase (fire-and-forget).

---

## 11. Data model & persistence

### 11.1 The `extractions` record

```jsonc
{
  "id": "uuid",
  "created_at": "ISO-8601",
  "url": "https://lumio.io",
  "page_title": "Lumio — Product analytics…",
  "headings": [ { "tag": "H1", "text": "…" }, … ],     // H1–H6 in order
  "links":    [ { "text": "…", "href": "…", "category": "internal" }, … ],
  "ai_summary": "…",                                    // plain-language overview
  "custom_extraction": { … },                           // v2: LLM extraction output (optional)
  "domain_map": [ "https://…", … ],                     // v2: discovered URLs (optional)
  "enrichments": {                                      // v2: capability tabs (optional)
    "leadership": { "key", "label", "icon", "prompt", "data": {…}, "created_at" },
    "pricing":    { "key", "label", "icon", "prompt", "data": {…}, "created_at" }
  }
}
```

### 11.2 Supabase schema (current target)

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
  custom_extraction jsonb,   -- v2
  domain_map        jsonb,   -- v2
  enrichments       jsonb    -- v2
);

alter table public.extractions enable row level security;
create policy "anon full access" on public.extractions
  for all using (true) with check (true);
```

> **Migration note:** the three v2 columns may not yet exist on the live database. Until the `ALTER TABLE … add column if not exists …` migration is run, the app saves the v1 columns to Supabase and keeps v2 data in `localStorage`, logging a non-blocking warning. Running the migration unlocks full cross-device sync of custom extractions, domain maps, and enrichment tabs.

### 11.3 `localStorage` keys

| Key | Holds |
|---|---|
| `datiq.saved` | Saved extractions (the local mirror / fallback backend). |
| `datiq.enrichments` | Enrichment cache, indexed by URL → capability key. |
| `datiq.current` | The last-viewed extraction (restores Preview after reload). |
| `datiq.theme` | `light` / `dark`. |
| `datiq.dashLayout` | `table` / `cards`. |
| `datiq.schedules` | R19 — scheduled tasks (cadence, intent, lifecycle); synced to `/api/schedules`. |
| `datiq.batchRuns` | Batch + scheduled run summaries (max 50). |
| `datiq.batchMap` | `{ extractionId → runId }` map for Dashboard grouping. |
| `datiq.batchDraft` | Persisted Batch textarea content. |
| `datiq.plan` | Active plan id (BillingProvider). |
| `datiq.guestTrial` | Guest trial counters; **never cleared** (bypass-prevention). |
| `datiq.globalSettings` | Cached guest-limit settings (5-min TTL). |

> The complete, authoritative key list (including `scrapelite.*` internal keys) lives in `CLAUDE.md` —
> treat that file as the live source of truth and this table as a summary.

### 11.4 Link categories

`email · social · document · media · internal · external` — assigned by host/extension heuristics first (always reliable), then optionally refined by a single batched Claude call (capped at 60 links). Any AI failure silently falls back to heuristics.

---

## 12. Privacy, security & data handling

- **What DatIQ stores:** the public page content you extract (headings, links, summary, enrichments) plus your UI preferences — in your browser (`localStorage`) and, when configured, your Supabase project (per-user when signed in).
- **Accounts & auth:** Supabase email + OAuth (Google/Microsoft/GitHub) auth is live (V3). Signed-in data is per-user; unauthenticated use is supported with localStorage and a guest-trial gate (soft + hard limits). Sign-out clears sensitive localStorage keys.
- **Server-side keys.** AI and scraping keys live **server-side only** (Netlify Function env, no `VITE_` prefix). The browser calls `/api/*` proxies; provider keys are never shipped to end users (R4). Scraping uses a provider fallback chain; AI uses a multi-provider fallback chain — both server-side.
- **Outbound calls** go only to the configured services (scrape providers, AI providers, Supabase, your webhook/email endpoint), all from server functions. Endpoints are forced absolute (`https://`).
- **Email delivery** prefers the configured webhook/email API and falls back to the user's own mail client via `mailto`. Scheduled change alerts are sent server-side via the configured email provider.
- **Privacy compliance** — the public Privacy Policy covers applicable data-protection regulations (incl. DPDP Act 2023); Terms specify governing law/arbitration.

---

## 13. FAQ & troubleshooting

**Do I need an API key or a database to use DatIQ?**
No. With nothing configured it runs on realistic mock data and stores everything in your browser. Keys and Supabase add real scraping/AI and cross-device sync.

**What's the difference between "Custom extraction" and "Quick enrichment"?**
Custom extraction runs *while you extract* (from Home) using a prompt you type. Quick enrichment runs *after*, on the Preview screen, with one click per preset — and each result is saved as its own tab.

**Why didn't my enrichment tabs sync to another device?**
Cross-device sync needs Supabase configured **and** the v2 columns migrated. Until then, tabs persist locally in the browser that created them.

**I saw a warning: "V2 columns not found in Supabase."**
Expected if the v2 migration hasn't run. Saves still succeed (v1 columns to Supabase, v2 data local). Run the `ALTER TABLE` migration to enable full persistence.

**The webhook says "Failed to fetch."**
Non-blocking. It's usually the n8n **test** URL (only live while the editor is open) or a CORS/activation issue. Switch to the production webhook URL and activate the workflow; saving is never blocked by this.

**Map mode didn't show headings or links.**
By design — domain mapping returns a list of URLs, not a single page's structure. The Overview tab shows the searchable URL list instead.

**Export looks empty / missing enrichments.**
Exports hydrate from both local cache and Supabase. If a capability was run in a different browser without Supabase sync, export from the browser that has the local cache, or enable Supabase sync.

**Re-running a Quick Action — does it duplicate the tab?**
No. Re-running **refreshes** (overwrites) the existing tab.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Extraction** | One run against a URL → the saved record (headings, links, summary, enrichments). |
| **Enrichment** | A focused, AI-extracted answer about a page (contacts, pricing, etc.), saved as a tab. |
| **Quick Action / preset** | A one-click enrichment with a built-in B2B prompt. |
| **Custom extraction** | A free-text prompt you write to pull arbitrary fields. |
| **Domain mapping** | Discovering all indexed URLs on a site (Firecrawl `/map`). |
| **Capability card** | A Home-screen tile describing one product capability. |
| **Mock path** | A service's offline/no-key code path returning realistic demo data. |
| **Dual-write** | Saving to Supabase and `localStorage` together. |
| **Request-id guard** | A counter that ignores stale async results so a newer action wins. |
| **Runtime override** | `public/runtime-config.js` values that beat build-time env vars without a rebuild. |

---

## 15. Appendix — regenerating screenshots & environment

### 15.1 Screenshots in this document

All screenshots live in `docs/assets/screenshots/` and were captured from the running app at 1280px width:

| File | Screen |
|---|---|
| `01-home.png` | Home (light) — unified composer |
| `02-home-dark.png` | Home (dark) |
| `03-preview.png` | Preview with enrichment |
| `04-batch.png` | Batch results |
| `05-schedules.png` | Schedules / monitoring |
| `06-dashboard-table.png` | Dashboard, table view |
| `07-dashboard-cards.png` | Dashboard, card view |
| `08-pricing.png` | Pricing |
| `09-domain-map.png` | Preview in domain-map mode |

**Regeneration is now scripted.** With the dev server running (`npm run dev`):

```bash
node docs/capture-screenshots.mjs
```

This drives the running app with Playwright (system Chrome via `channel:"chrome"`, 1280px, 2× DPR),
performs real flows (extraction, batch, schedule), and writes all PNGs to `docs/assets/screenshots/`.
Then run `node docs/build-help.mjs` to copy them into the help site.

### 15.2 Environment variables (current)

Browser-safe (`VITE_` prefix) and server-only (Netlify env, **no** `VITE_` prefix). Provider/payment
secrets are server-only. The exhaustive, authoritative list is in `CLAUDE.md`; key ones:

| Variable | Side | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | browser | Auth + cloud persistence. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | server | Stats, pricing config, scheduler reads. |
| `AI_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | server | AI provider fallback chain. |
| `FIRECRAWL` / `SPIDER` / `JINA` keys | server | Scrape provider fallback chain. |
| `RESEND_API_KEY` / `ALERT_EMAIL_FROM` | server | Scheduled change-alert email. |
| `SCHEDULE_ALERT_WEBHOOK` / `VITE_WEBHOOK_URL` | server / browser | Automation webhook + save/capture notifications. |
| Razorpay / Stripe keys | server (+ `VITE_` publishable) | Payments. |

Absent any of these, the corresponding feature uses its mock/fallback path. **Never** add a `VITE_` prefix
to a secret.

### 15.3 Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

---

*End of document. This file is the canonical source for DatIQ's HTML help pages and future knowledge-base/chatbot content. Keep it in sync with the product as features ship.*

---

## 16. Intelligence Workflows — documentation & public-surface record (2026-09-04)

This section records what the 2026-09-04 documentation pass changed, so the next
person does not have to diff it out of the repository.

### 16.1 What the release actually shipped (the reason for the pass)

PRDs 1-5 landed across the preceding sessions and **nothing customer-facing
described them**. The user guide had no section on any of it; `/pricing` sold
none of it; the changelog, blog, FAQ and `llms*.txt` did not mention it.

| Surface | Route | Backed by |
|---|---|---|
| Workflow templates | `/templates` | `src/lib/templates/*`, `seedTemplates.js` (7 published templates) |
| Bulk account intelligence | `/lists` | `src/lib/bulk/*` — `identityModel.js`, `icpModel.js` |
| Competitor watchlists | `/watchlists` | `src/lib/watchlist/*` — `materialityModel.js`, `snapshotModel.js` |
| Signal routing | `/rules` | `src/lib/rules/*` — `ruleModel.js`, `retryModel.js` |
| Shareable reports | `/r/:slug` | `src/lib/reports/visibilityModel.js` |
| Credit ledger | Account | `src/lib/credits/creditModel.js` |

### 16.2 Entitlements — everything reuses an existing limit

Recorded here because it is the single fact most likely to be re-derived wrongly.
`entitlementModel.js` deliberately does **not** introduce new per-tier allowances
for the workflow surfaces; each reuses a limit the pricing page already sells:

| Capability | Entitlement case | Reuses |
|---|---|---|
| Bulk account list | `bulk.enrich` | `limits.batch_max_urls` (+ bonus bundles) |
| Competitor watchlist | `watchlist.create` | `limits.scheduled_monitoring` |
| Signal routing rule | `rule.create` | `limits.integrations` |
| Fork a template | `template.duplicate` | `limits.template_duplicate` |
| Share a report | `report.share` | Ungated on every plan, by design (PRD 2's acquisition loop) |
| Brand a report | `report.branding` | `limits.white_label_pdf` |

`PricingMatrix.jsx`'s new **Intelligence workflows** group derives every cell from
these same limits rather than hardcoding numbers, so the table cannot promise a
capability the server will refuse. That failure mode is not hypothetical — it is
exactly how the discoverability rows came to be missing from `/pricing` while the
server had been enforcing an audit quota all along.

### 16.3 Help-centre renumbering (8 URLs, all 301'd)

Six workflow guides were inserted as user-guide sections 10-15, shifting the eight
sections after them by six. New redirects are in `scripts/site-routes.mjs` and
mirrored in `netlify.toml`; `page-ownership.test.mjs` asserts they match and that
no two-hop chain exists. **The pre-existing help redirects were repointed at the
NEW numbers**, not at the intermediate ones — leaving them would have created the
chains that test forbids.

### 16.4 Integrity fixes made during the pass

Two categories of pre-existing defect were found on live public pages:

1. **Fabricated social proof.** `UseCaseLead`, `UseCaseCompetitor`, `UseCaseSEO`
   and `UseCaseResearch` each carried an invented testimonial attributed to a
   named person ("Alex R., Head of Sales") plus invented usage statistics
   ("1,200+ CI analysts", "50K+ competitor pages tracked"). The repo's own policy
   had hidden Home's testimonials pending real data since R4; these four pages
   were never cleaned up. All four testimonial blocks were **removed** and the
   stat trios replaced with verifiable capability facts derived from
   `pricingConfig.js` and `seedTemplates.js`.
2. **Stale pricing and tier claims.** The lead-generation FAQ JSON-LD in
   `pageSeo.js` advertised "Select ($19/mo) is 100, Pro ($29/mo) is 250,
   Business ($79/mo) is 1,000, Agency ($299/mo)" — every figure wrong against
   `pricingConfig.js` — and claimed integrations were "Business and Agency plans"
   when `limits.integrations` is true from **Select**. `llms-full.txt` claimed
   DatIQ "starts at $19/mo" (it is $4.80) and that Select includes 100
   extractions (it is 500). All corrected against the source of truth.

⚠️ **Both classes are invisible to every automated gate.** The readiness audit
checks admin leakage, email routing, help freshness and *plan-name* coherence —
not whether a JSON-LD answer body quotes a real price, and not whether a
testimonial is real. Re-read the JSON-LD answer bodies whenever pricing moves.

### 16.5 Tooling change

`scripts/prerender.mjs` gained a **`PRERENDER_CHROMIUM_PATH`** env override. Some
container images ship a Chromium revision that does not match the one the
installed Playwright expects, so both the `channel:"chrome"` path *and* the
bundled-chromium fallback fail, and no marketing page can be prerendered at all.
That is an environment mismatch, not a repo problem, but it must not be the
reason a page ships without crawlable HTML. In this container:

```bash
PRERENDER_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run prerender
```

### 16.6 Still open

- **Screenshots are stale.** `docs/capture-screenshots.mjs` needs a dev server and
  a working browser; the new `/templates`, `/lists`, `/watchlists` and `/rules`
  screens have no captures, so the help pages for sections 10-15 carry no imagery.
  This is the standing readiness WARN.
- **Public gallery coverage** cannot be proven from source (it is runtime-populated
  from Supabase `public_reports`). The workflow personas now have use-case pages;
  the gallery still needs curated samples per persona.
- **The workflow surfaces have no public REST API.** `docs/DatIQ-Developer-API.md`
  now carries a *Planned endpoints* table saying so explicitly, and points
  integrators at webhook signal rules as the supported egress today.
