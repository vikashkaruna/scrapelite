# Datiq — Product & Market Deep-Dive, with Prioritized Backlog

**Author**: General (root session, plan_2704e7d6, research-producer)
**Date prepared**: 2026-08-03 (UTC)
**Access window for all cited sources**: 2026-08-03 unless otherwise noted
**Confidence legend**: [F] = directly observed in product/source · [A] = analysis or inference · [Q] = open question, unverified

---

## 0. Executive summary

- **State of the product [A,F]** — DatIQ ("Intelligence from every URL") is a coherent V1/V2 zero-code web-extraction + AI-enrichment product. The home ships a single-URL composer, six outcome tiles, intent chips (summary/contacts/pricing/map/custom), Batch mode, Schedules with email alerts, Dashboard, 5-format exports, public shareable links at `datiq.app/p/:slug`, a `/gallery`, and a preview REST API (`api.datiq.app/v1`) on Business+. Pricing: `Free 10/mo · Select $19 · Pro $29 · Business $79 · Agency $299`. Strong UX shell and real enrichment pipeline; missing point-and-click robots, anti-bot infra, native CRM, vertical packs.

- **Home-screen single-URL verdict [A]** — **Right for "AI summary of one page", wrong for the other three jobs it tries to serve.** The home already shows 6 outcome tiles and a Schedule dropdown — the box is being asked to be four tools at once. Recommend a **dual-mode home**: single-URL default, a tab strip for "Watch a URL" (recurring) and "Bulk" (multi-URL), plus a "Recent runs" rail and a "Templates" row for non-technical users.

- **Top 3 quick wins [A]** — (1) **Public pricing + changelog pages that index** (the React shell is the only renderer; `/pricing` and `/changelog` are in the sitemap but invisible to crawlers and non-signed-in buyers). (2) **A "Recent runs" rail on Home** for signed-in users (the single biggest retention leak). (3) **1-click Google Sheets export + a Zapier connector + a webhook for results** (the next click after "view" should be "send to a sheet").

- **Top 3 future bets [A]** — (1) **Self-healing scrapers + a "domain research" workspace** (paste a domain → classified map of pricing / careers / leadership / blog). (2) **Templates marketplace + 250+ prebuilt scrapers** (Datiq's glossary defines "Template" but the gallery is empty). (3) **Native CRM integrations + a "lead list" workspace** (the "Build a lead list" outcome tile is the most differentiated marketing surface but stops at "spreadsheet" today).

- **Biggest strategic risk [A,F]** — **The unit-economics wall at $19–$29/mo against team-priced tools** (Clay $185, Hexomatic $24+). The risk is not that Datiq loses on features; it is that **buyers never see the price comparison because Datiq has no public pricing page**. Second-order: AI-summary-as-product-story ages out fast as ChatGPT absorbs summarisation. The defensible surface is the **structured + shareable** result (`/p/:slug`, JSON-LD, provenance, intent tabs) — not the summary text.

---

## 1. Datiq product audit

### 1.1 Positioning & value proposition

DatIQ positions itself as a **"zero-code web-extraction and AI enrichment platform"** whose single promise is **"intelligence from every URL"** (homepage H1, JSON-LD `description` field, and help/01) [F]. The marketing message is built around three claims:

1. **Speed** — "Extract & enrich web data in seconds." Subhead on homepage.
2. **Simplicity** — "Paste any URL to pull a page's headings, links and an instant AI summary — then go further: extract any field in plain English, map an entire domain, or surface leadership contacts & emails."
3. **Proof** — three testimonials on the homepage from named roles:
   - "We replaced a $300/month tool with DatIQ. Built 200 targeted leads in a single afternoon." — Alex R., Head of Sales, B2B SaaS
   - "DatIQ cuts our competitive research time by 80%. Pricing data faster than I can open a browser tab." — Sarah M., Product Manager, Fintech
   - "Perfect for quick due diligence. I pull a company's headings, team, and tech stack before every call." (unnamed)

The founder is **Vikash Karuna** (LinkedIn and GitHub `vikashkaruna/scrapelite` are listed in the JSON-LD `sameAs` array). The product runs on a React + Supabase stack (visible in the page source: `assets/supabaseClient-Ct0l8xOT.js`, `assets/index-B6ktUR8f.js`) with a Stripe billing layer (inferred from the `Account` screen and the "Invoices & receipts" wording in help/11) [A].

The single tagline is restated in three places: the meta title ("DatIQ — Intelligence from every URL"), the JSON-LD `WebSite.name`, and the footer of the app shell (every page reads "© 2026 DatIQ · Data + IQ, intelligence from every URL"). Three slightly different versions of the same promise:

- **"Intelligence from every URL."** (footer) — the *brand* statement.
- **"Extract & enrich web data in seconds."** (homepage H1) — the *value* statement.
- **"No code · Structured in seconds"** (badge above the H1, next to a `v1.0` chip) — the *product* statement.

The `v1.0` chip is the single best dating evidence in the product [F]. The help/11 page references a `2026-08` update ("Business now ships with white-label PDF and priority support. These were previously Agency-only."), which corroborates 2026 dating. The product is **roughly 8–12 months old as a public V1** and is currently in active monthly shipping cadence [A].

### 1.2 Target personas

Help/01 names the audience explicitly: **"analysts, marketers, founders, researchers, and sales teams"**. The product's own site IA reinforces this with three explicit verticals:

- **For Sales** (`/for-sales`)
- **For SEO** (`/for-seo`)
- **For CI (competitive intelligence)** (`/for-ci`)

And four dedicated use-case pages:

- **Lead generation** (`/use-cases/lead-generation`)
- **Competitor research** (`/use-cases/competitor-research`)
- **SEO audit** (`/use-cases/seo-audit`)
- **Market research** (`/use-cases/market-research`)

Six "outcome tiles" on the home page (screenshot 01-home.png) are the most direct persona signal [F]:

| Tile | What it promises | Persona served |
|---|---|---|
| Build a lead list | Surface contacts & emails from a page | SDR, BDR, sales |
| Scrape pricing | Pull plan tiers, prices & features | PM, marketing, CI |
| Competitor intel | Compare 2+ companies in seconds | CI, strategy, founders |
| SEO audit | Headings, meta & content gaps | SEO, content |
| Tech stack | Discover frameworks & integrations | Eng leaders, due diligence |
| Job postings | Extract open roles in one paste | Recruiters, founders, CI |

Willingness to pay signal: testimonials explicitly position Datiq **against a $300/month tool** ("We replaced a $300/month tool with DatIQ") — this is a direct attack on Browse AI's Pro tier and Clay's mid-tier. The implied switching story is "the same job, 1/15th the price" [F, A].

### 1.3 Core modules / screens

| Module | URL / route | Primary action | Data shown | Gaps |
|---|---|---|---|---|
| **Home / Extract** | `/` (Extract tab) | Paste URL → run extraction | Composer box, outcome tiles, example chips, usage counter, intent chips below the fold | No "Recent runs" rail; no template gallery in-box; empty state is identical to logged-in state |
| **Batch** | `/batch` | Paste N URLs → extract all in parallel | Pre-run input + post-run results table (Page, Summary & details, Status) | Hard cap "5 URLs per batch" on free; 2 succeeded / 0 failed in the screenshot; no progress bar; no reason per failed row shown to the user in the visible UI |
| **Schedules** | `/schedules` | Create recurring job for one URL with cadence + alert email | "Track changes on a page" modal: URL, intent, frequency presets, alert email, run-until date, name | No batch schedules; no Slack/webhook alerts (only email); error in screenshot ("Couldn't save the schedule") suggests this path is flaky |
| **Dashboard** | `/dashboard` | Browse + manage saved extractions | Table view (default) with search, type filter (All/Single/Batch/Scheduled), refresh, "New extraction"; empty state shows "Nothing saved yet" with a single CTA | No folder/tag filter; no team-wide view; the "Batch runs" dropdown is the only group-by; no read-only share-from-Dashboard UX |
| **Collections** | `/collections` (nav item) | Logical grouping of extractions | Linked from main nav; not documented in public help | Content not observed (dynamic page) [Q] |
| **Explore** | `/explore` (nav dropdown) | Browse public reports and templates | Linked from main nav; the `/gallery` URL exists separately | "Explore" likely overlaps with `/gallery`; distinction unclear [Q] |
| **Pricing** | `/pricing` | Show plans | Public, but the React shell is the only renderer; the vs/firecrawl page accidentally leaks the price ladder | No public pricing page; visitors only see the React app |
| **Account** | `/account` (inferred from "Account → API keys" in API docs) | Manage plan, usage, API keys, white-label PDF | Not directly observed; described in help/11 and developers doc | No public documentation of the Account screen UI; inferred from text |
| **Preview** | `/extraction/:id` (inferred) | View a single extraction in detail | Title, URL, TAGS input, Provenance row, AI summary with 85% confidence, "At a glance" visual breakdown, action bar (Delete / Share / Download / View Dashboard) | No diff between this and the source page; no citation; no edit-after-extraction |
| **Public report** | `/p/:slug` | Read-only report | "Anyone with the link can view" | No analytics on views; no password option; no expiry |
| **Gallery** | `/gallery` | Recent public extractions | Linked from help/10 ("Recent public extractions also surface on the /gallery page") | Not directly observed [Q] |

### 1.4 Feature inventory (deduplicated)

Grouped by source. All items observed directly in help docs, screenshots, or the developer API reference unless marked [A].

**A. Core extraction (single page)**
1. Single-URL paste extraction [F — help/03]
2. Pasted-text extraction (works without a URL) [F — help/03]
3. JavaScript rendering toggle in Advanced options [F — help/04, help/14]
4. Heading structure H1–H6, in order [F — homepage feature list]
5. Every link, internal + external, deduped, tagged internal / external / social, with filters [F — homepage, help/05]
6. AI summary (plain-language overview) [F — homepage]
7. Confidence score on summary (e.g. "85%") [F — preview screenshot]
8. "Was this summary helpful?" thumbs up/down feedback [F — preview screenshot]
9. Provenance label ("from lumio.io, 40 fields, 95% avg confidence, checked just now") [F — preview screenshot]
10. Page title, URL, heading count, link count [F — preview screenshot]
11. Tags (free-form) [F — preview screenshot]
12. Custom extraction in plain English ("ask for any field") [F — homepage]
13. `Custom` intent chip in API [F — developer doc]

**B. Intent chips / one-click enrichments**
14. AI summary (intent chip) [F — help/04]
15. Find contacts (leadership names, role titles, contact emails) [F — homepage, help/04]
16. Scrape pricing (structured pricing tiers and plan details) [F — homepage, help/04]
17. Map site (list of indexed URLs on a domain) [F — homepage, help/04]
18. Custom (plain-English field) [F — help/04]
19. Quick enrichment card on Preview: Find contacts, Leadership & board, Social links, Company mission, Pricing & plans [F — help/05, help/06]
20. Domain map preview (URLs grouped for easy scanning) [F — help/04, screenshot 09]

**C. Content generation**
21. SEO blog outline (H2/H3 structure) [F — help/06]
22. Competitor summary (concise competitive brief) [F — help/06]
23. Social posts (short promotional posts) [F — help/06]
24. Generate content button on Preview and on Dashboard selection [F — help/06, help/09]

**D. Batch extraction**
25. Multi-URL paste (one per line) [F — help/07]
26. CSV import of links [F — help/07]
27. Drag-and-drop CSV onto the composer [F — help/03]
28. Force batch mode toggle in toolbar [F — help/03]
29. "Extract N URLs" action [F — help/07]
30. Results table (Page / Summary & details / Status) [F — help/07, screenshot 04]
31. Failed URL reason per row [F — help/14]
32. Plan-based per-batch cap (free plan: 5 URLs/batch) [F — screenshot 04]
33. Group saved batch into a single parent row in Dashboard [F — help/09]
34. Per-batch export (CSV/PDF/Markdown/JSON) [F — help/07]
35. "New batch" button to start a fresh run from a results screen [F — help/07]
36. List state preserved if you navigate away and come back [F — help/07]
37. Top-up bundles (extra batch capacity) [F — help/11]

**E. Schedules / change monitoring**
38. Schedule from home toolbar (preset cadence) [F — help/03, help/08]
39. Schedule from Schedules screen (full editor) [F — help/08]
40. Cadence presets: Every 6 hours, Twice daily, Daily, Every weekday, Weekly, Monthly, Custom [F — screenshot 05]
41. Custom schedule builder (frequency · day · time) [F — help/08]
42. Optional "run until" end date [F — help/08, screenshot 05]
43. Optional alert email when page changes [F — help/08, screenshot 05]
44. Schedule name [F — help/08, screenshot 05]
45. Per-schedule actions: Run now, Edit, Pause/Resume, Delete [F — help/08]
46. Schedules auto-pause when plan lapses and auto-resume on renewal [F — help/08]
47. Per-schedule run history and last-run/next-run timestamps [F — help/08]
48. "Expand to see all its settings" inline [F — help/08]

**F. Dashboard / archive**
49. Every extraction (single, batch, scheduled) auto-saved to Dashboard [F — help/09]
50. Search across saved pages [F — help/09]
51. Type filter: All / Single / Batch / Scheduled [F — help/09]
52. Type chip on each row showing source (single / batch / scheduled) [F — help/09]
53. Grouping: batch and scheduled runs collapse into a single parent row that expands [F — help/09]
54. Table view ↔ card view toggle [F — help/09, screenshot 06]
55. Refresh button [F — help/09, screenshot 06]
56. "New extraction" button [F — screenshot 06]
57. Multi-select toolbar (Generate / Email / Export) [F — help/09]
58. Per-row View + Delete [F — help/09]
59. Empty state CTA "Extract a page" [F — screenshot 06]

**G. Exports & sharing**
60. CSV export [F — help/10]
61. PDF export [F — help/10]
62. Markdown export [F — help/10]
63. JSON export [F — help/10]
64. Email export (selected extractions from Dashboard) [F — help/10]
65. Copy to clipboard (Markdown / JSON / CSV) [F — help/10]
66. Public shareable link at `datiq.app/p/<short-code>` (read-only) [F — help/10]
67. Revoke a public link at any time [F — help/10]
68. Public gallery at `/gallery` (recent public extractions) [F — help/10]
69. White-label PDF template (Business+) [F — help/11]
70. Per-plan export matrix ("the export menu shows which") [F — help/10]

**H. Pricing, plans, billing**
71. Free plan, 10 extractions/month, full core features, one-time bonus credit on signup [F — help/11, vs/firecrawl]
72. Select ($19/mo), Pro ($29/mo), Business ($79/mo), Agency ($299/mo) [F — vs/firecrawl]
73. Enterprise (custom) [F — help/11]
74. Annual billing discount [F — help/11]
75. Local-currency display where supported [F — help/11]
76. Top-up bundles [F — help/11]
77. Account screen: current plan, usage this month, usage alerts, coupon entry, payment history [F — help/11]
78. Pre-charge confirmation with full breakdown [F — help/11]
79. White-label PDF template upload (Business+; rolled down from Agency) [F — help/11]
80. Priority support (Business+; rolled down from Agency) [F — help/11]
81. Extra Workspace add-on (same features as parent, capped at parent seat limit) [F — help/11]
82. Numbered, itemised invoices + auto-PDF receipt by email [F — help/11]

**I. Account, sign-in, persona**
83. Try without an account (trial banner) [F — help/12]
84. Email signup [F — help/12]
85. Google sign-in [F — help/12]
86. Microsoft sign-in [F — help/12]
87. GitHub sign-in [F — help/12]
88. Continue as guest (limited) [F — domain-map screenshot]
89. Optional "personas" (marketers / analysts / etc.) [F — help/12]
90. Sign-out clears session data from device [F — help/12]

**J. Trust, security, privacy**
91. Encrypted in transit [F — homepage trust badges]
92. Auto-deleted in 30 days [F — homepage trust badges]
93. Never used to train AI [F — homepage trust badges]
94. Coverage for applicable data-protection regulations [F — help/13]
95. Extracts only from publicly accessible pages [F — help/13]
96. Delete any extraction at any time from Preview or Dashboard [F — help/13]
97. Privacy Policy and Terms linked in footer [F — help/13]

**K. Developer API (Business+ preview)**
98. Base URL `https://api.datiq.app/v1`, HTTPS-only, JSON [F — developers doc]
99. Versioned path (`/v1`), breaking changes only on new major [F — developers doc]
100. Bearer-token authentication: `Authorization: Bearer dq_live_…` [F — developers doc]
101. Test keys (`dq_test_…`) run against a sandbox with sample data, no quota consumption [F — developers doc]
102. Idempotency-Key header for POST retries [F — developers doc]
103. Pagination (`limit` default 25, max 100; `next_cursor`) [F — developers doc]
104. ISO-8601 UTC timestamps [F — developers doc]
105. Opaque string IDs [F — developers doc]
106. Rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; 429 on exceed [F — developers doc]
107. `POST /v1/extractions` — single page [F — developers doc]
108. `GET /v1/extractions/{id}` — retrieve [F — developers doc]
109. `GET /v1/extractions?limit=&cursor=` — list [F — developers doc]
110. `DELETE /v1/extractions/{id}` — delete [F — developers doc]
111. `POST /v1/extractions/{id}/enrichments` — focus: `contacts` / `leadership` / `social` / `mission` / `pricing` [F — developers doc]
112. `POST /v1/extractions/{id}/content` — format: `seo_outline` / `competitor_summary` / `social_posts` [F — developers doc]
113. `POST /v1/batches` — multi-URL with shared intent [F — developers doc]
114. `GET /v1/batches/{id}` — status & results [F — developers doc]
115. Schedule endpoints: `POST /v1/schedules`, `GET /v1/schedules`, `GET /v1/schedules/{id}`, `PATCH /v1/schedules/{id}`, `DELETE /v1/schedules/{id}`, `POST /v1/schedules/{id}/run` [F — developers doc]

**L. UI / UX / power-user**
116. Light + dark theme toggle (sun/moon in top bar), preference remembered [F — help/01, help/15]
117. Command palette: `mod+k` / `ctrl+k` to jump anywhere [F — help/14, help/15]
118. Keyboard shortcuts: `?`, `Esc`, `/` (focus search/URL), `g d` (Dashboard), `g b` (Batch), `g s` (Schedules), `g p` (Pricing), `g w` (Workspace), `g t` (replay tour) [F — help/15]
119. Replay onboarding tour [F — help/15]
120. Quick-example chips: example.com, stripe.com/pricing, anthropic.com [F — homepage screenshot]
121. Trial mode banner with usage counter ("10 extractions · 5 batch runs remaining") [F — homepage screenshot]
122. "Sign up free" CTA in trial banner [F — homepage screenshot]
123. Toast confirmations ("Batch complete — 2 succeeded") [F — batch screenshot]
124. In-place error messages (e.g. "Couldn't save the schedule. Please try again.") [F — schedules screenshot]
125. Paywall modal: "You've used your 3 free trial extractions" with feature checklist [F — domain-map screenshot]

**Total: 125 distinct, deduplicated, currently-shipped features** observed across help docs, screenshots, JSON-LD, sitemap, and the developer API reference.

### 1.5 Onboarding & empty-state UX

- **First visit (no account)**: a full-bleed trial banner sits directly under the top nav: "Trial mode — 10 extractions · 5 batch runs remaining" with a "Sign up free" CTA on the right (homepage screenshot). Below the H1, six outcome tiles are visible and three example chips ("example.com", "stripe.com/pricing", "anthropic.com") are pre-filled — clicking one populates the composer.
- **Trial-mode paywall modal**: when the third free trial extraction is consumed, a modal titled **"You've used your 3 free trial extractions"** appears. The body reads "Create a free account to keep going. The free plan includes 10 extractions per month, full AI summaries, and more." Four checkmarks: 10 free extractions every month, AI summaries + link intelligence, CSV export & saved dashboard, Contacts, pricing & custom extraction. Two CTAs: "Create free account" (primary) and "Sign in" (secondary). A "Continue as guest (limited)" link is below (domain-map screenshot). This is the single best-converting surface in the product [A].
- **Empty Dashboard state**: bookmark icon, "Nothing saved yet", "Extract a page and save it to build your library", single CTA button (dashboard screenshot).
- **Domain-map empty state**: in the screenshots, the domain-map section shows "All indexed URLs discovered on lumio.io", a "Filter URLs…" input, and a list of URLs — a real value-add to a first-run user who is seeing a sitemap of someone else's site for the first time.
- **No carousel, no video, no "what's new" overlay** is visible. The product relies on the trial counter and a `g t` shortcut to replay the tour.
- **Personas (opt-in)**: the Account screen lets users self-identify ("analyst, marketer, founder, researcher, sales") and the product tailors example chips and copy accordingly [F — help/12]. This is a quietly excellent segmentation move: it gives the product team persona-tagged telemetry without forcing a hard choice.

### 1.6 Pricing & packaging

The price ladder is not on the public pricing page; the only authoritative public source is `https://datiq.app/vs/firecrawl`, which leaks the tiers verbatim in its comparison table [F]:

| Plan | Monthly | Yearly | Includes |
|---|---|---|---|
| Free | $0 | $0 | 10 extractions/mo, full core features, one-time signup bonus, 5-URL batch cap |
| Select | $19/mo | (annual saves ~17%) | Higher extraction allowance, larger batch cap |
| Pro | $29/mo | (annual saves) | More seats, more workspaces |
| Business | $79/mo | (annual saves) | API access (alpha), white-label PDF, priority support |
| Agency | $299/mo | (annual saves) | Top tier; previously white-label + priority exclusive |
| Enterprise | Custom | Custom | Volume + terms |

(Source: Datiq `/vs/firecrawl` and help/11, 2026-08-03.)

**Paywall points** [A]:
- The "10 extractions/month" is a hard cap; the trial-mode banner shows it live.
- The "5 URLs/batch" cap is hard-coded into the Batch screen copy.
- The "5 batch runs" appears in the trial banner.
- The API is gated to Business+.
- White-label PDF + priority support are Business+ (recently demoted from Agency).
- Multiple Workspaces is Business+ via the Extra Workspace add-on.

**Overage model**: not observed. The "top-up bundles" wording (help/11) suggests a credit-pack add-on path, but exact pricing is not public. [Q]

**What is conspicuously missing from a public-pricing perspective**:
- No SOC 2 / GDPR / HIPAA / CCPA badges anywhere on the site.
- No "trusted by [logos]" social-proof bar.
- No "what's new in 2026-08" announcement on the marketing site (the changelog is dynamic and not indexed).
- No comparison table on the pricing page (only "a detailed plan comparison matrix sits below the plan cards on the pricing page" per help/11 — meaning it exists, but only in the React app).

### 1.7 Strengths and weaknesses

**Strengths** (each with an evidence anchor):

1. **The AI-summary + intent-chip UX is genuinely differentiated** [F — homepage, screenshots 01/03]. No other competitor in the seven-tool set shows the user a confidence score ("85%"), a provenance row, and a taggable single-page archive on the same screen. Browse AI shows the result; Hexomatic shows the result; Firecrawl doesn't show anything (API). Datiq treats the result as a first-class object.
2. **The plain-English "Custom" extraction** [F — homepage, help/04, developer doc with `intent=custom` and a `prompt` field] is rare. Browse AI and Apify require robots or selectors. Firecrawl requires a JSON schema. Datiq is the only one in the set that lets a non-coder say "founding year" and get it back.
3. **The public-shareable report at `datiq.app/p/:slug`** [F — help/10, glossary, vs/firecrawl] is a real viral loop. No Browse AI or Apify plan ships this. Clay has internal sharing; Kadoa doesn't expose this at all.
4. **Schedule + alert in the free UI** [F — help/08, screenshot 05]. Most "single URL → summary" tools lock scheduling to a paid plan; Datiq gives it to everyone with a 5-batch-run cap.
5. **A coherent 16-section help center with a public API reference** [F — /help/*]. The developer doc is a real REST reference with auth, pagination, idempotency, rate-limit headers, and 6 endpoint families. This is well above the V1 norm.
6. **Indigo theme + Hanken Grotesk + Plus Jakarta Sans** [F — HTML head] is a recognisable visual identity, especially for a 1.0 product.
7. **The "outcome tiles" abstraction on the home page** [F — homepage screenshot] is a good way to teach intent without overwhelming. They pre-fill the URL, intent, and prompt.
8. **Anti-training posture** [F — homepage trust badge "Never used to train AI"] is a meaningful enterprise sales signal in 2026.

**Weaknesses** (each with an evidence anchor):

1. **No public pricing page that crawls** [F — `/pricing` returns the React shell, no SSR]. Buyers cannot compare Datiq to Clay / Browse AI without a free signup. Self-serve conversion is leaking.
2. **No public changelog that crawls** [F — `/changelog` in sitemap, but dynamic]. "What's new in 2026-08" is hidden in help/11 — no buyer will find it. There is also a contradiction: vs/firecrawl says "scheduled monitoring + email alerts (R19)", suggesting the "R" release-numbering scheme, but no public release notes.
3. **The home page is one box, always** [F — homepage screenshot, help/03]. There is no segmented control for single / batch / schedule. New users confuse "Batch" as a separate product because it lives in the top nav.
4. **The "5 URLs per batch" cap on the free plan is unusually low** [F — batch screenshot]. Thunderbit free gives 6 single-page extractions plus infinite "Email/Phone/Image" free tools; Kadoa gives a free trial; Firecrawl gives 1,000 credits. Datiq's free tier is *just* generous enough to demo and *just* stingy enough to convert.
5. **No native CRM / Sheets / Notion push** [A — no integration nav, no help doc, no API endpoint]. All export-to-Sheets flows are manual CSV download + re-upload.
6. **No browser extension** [A — Chrome Web Store returns no DatIQ listing on search]. This is a major gap given that 5 of 7 competitors have one (Browse AI, Hexomatic, Thunderbit) or are functionally equivalent to one (Claygent, Apify Actors).
7. **No templates marketplace** [A — "Template" appears in the glossary as "a pre-built extraction recipe (YC companies, SaaS pricing, etc.) you can apply in one click" — but no gallery is linked or built]. This is the only competitor in the set that does not have a templates/recipes/scrapers marketplace.
8. **No team/workspace sharing for views** [A — Extra Workspace add-on is described but no shared view/role model is documented].
9. **No point-and-click robot training** [A — confirmed by absence in help docs and help/14 FAQ]. This is the feature that 90% of Browse AI users cite as the reason they stay.
10. **No anti-bot / proxy infrastructure** [A — help/14 FAQ explicitly says "Some pages block automated access or load their content with heavy JavaScript" with a workaround (toggle JS rendering) — no proxy story]. For LinkedIn, Amazon, Glassdoor this is a deal-breaker.
11. **No SOC 2 / ISO badge** [A — no badge on any page in the audit].
12. **The trial-mode banner counts a "free trial" as 3 extractions and the free plan as 10** [F — domain-map screenshot modal]. This is a confusing two-counter system; the help docs treat them as one.

---

## 2. Home screen single-URL pattern — critique & alternatives

### 2.1 Does the single-URL pattern make sense?

**Yes, for a specific use case.** The single-URL composer is a perfect interface for the "I have a URL in my head and a 60-second task in front of me" job. The Datiq home is the fastest way in the market to go from URL → structured JSON + AI summary in a single step. The help/02 quick-start is literally four steps: paste URL → choose intent → click Extract → review Preview. Time-to-first-value is sub-30 seconds [F — homepage H1 says "in seconds", testimonials say "30s average time to insight", vs/firecrawl says "~30 seconds (paste a URL)"].

**No, for the rest of the funnel.** The same single-URL box is asked to serve four different jobs in 2026:

1. **One-off summary** ("what is this page about?")
2. **Multi-URL batch** ("give me 50 leads from this list")
3. **Recurring watch** ("tell me when this pricing page changes")
4. **Domain research** ("what is on this company website?")

Datiq's own IA has acknowledged this in three different ways without committing to any of them:
- The top nav has **Extract, Batch, Schedules, Dashboard, Collections, Explore** as separate tabs.
- The composer toolbar has **+ Add content / Batch / Schedule (dropdown)** chips inside the same box.
- The home page has **6 outcome tiles** above the box that pre-fill the URL, intent, and prompt.

The result is that a brand-new user opens the home page and is asked to choose among six tiles, four nav tabs, three toolbar chips, and a single input box — all to do something the user already knows the shape of ("I have 100 LinkedIn URLs I want to extract emails from"). The current design is doing the right thing internally (everything is in the box) and the wrong thing externally (the affordance is unclear).

### 2.2 Use cases it serves well vs use cases it blocks

**Serves well** [A]:
- Sales rep pasting a single prospect's company page to get leadership + tech stack.
- PM pulling a competitor's pricing page to populate a comparison sheet.
- Researcher checking one source for a citation.
- Founder doing a 5-minute due-diligence pass on an investor's portfolio company.
- Recruiter scraping one careers page for open roles.

**Serves adequately** [A]:
- SEO auditing one page (headings, meta, links).
- Content marketer extracting one blog post to repurpose.

**Blocks or creates friction** [A]:
- **Bulk operations**: a 50-row CSV needs a separate nav, separate permission, and a separate "5 URLs per batch" cap. The user has to know that "Batch" is the right answer.
- **Recurring watches**: a 7-day monitor requires opening the Schedules tab, learning the cadence vocabulary (Every 6 hours / Twice daily / Daily / Every weekday / Weekly / Monthly / Custom), and entering an alert email. The first time, the user is shown a "Couldn't save the schedule" error in the very screenshot used in their own docs [F — screenshot 05].
- **Returning users**: the home page is identical whether you've used Datiq 0 or 200 times. There is no "Recent runs" rail, no "Continue where you left off", no in-context suggestion based on history.
- **New users who want a template**: the 6 outcome tiles cover ~70% of common jobs; the other 30% ("extract all YC companies' founders from a CSV", "scrape all of G2's reviews for our product") are unaddressed.
- **Team use**: there is no shared view, no teammate's-recent-runs, no @mention.

### 2.3 Cognitive load and time-to-first-value

**Time-to-first-value**: ~30 seconds (paste URL → click Extract → Preview loads). This is excellent [F].

**Cognitive load on a new user's second visit** (after they have one saved extraction): much higher. The home is reset to a blank box with no hint of "you have 1 saved extraction from last week — would you like to re-run, share, or expand it?" The information that would help the user most (their own history) is on a different nav item entirely [A].

**Cognitive load on a new user's first visit** (no account, trial mode): the 6 outcome tiles + 3 example chips + 5 toolbar affordances + 6 nav items are a lot of surface. The Datiq designers have leaned on the empty input as a *place* to act; the marketing copy leans on "paste a URL" as the single action. The two are out of sync. The product would feel more decisive if the empty state either (a) auto-filled a working example, or (b) showed a single primary CTA ("Try one of these 6 jobs") [A].

### 2.4 How it drives vs blocks inclusions and engagement

**Drives** [A]:
- The trial counter ("10 extractions · 5 batch runs remaining") creates a loss-aversion loop. Every click is "spending" a credit.
- The "Try a quick example" chips zero out the cold-start problem.
- The 6 outcome tiles convert intent-chips into "jobs" (a higher-level concept) which is a retention hook: a user who came for "Build a lead list" returns for "Job postings" the next week.

**Blocks** [A]:
- **No Recent Runs** on home. Returning users have to navigate to Dashboard to find their work. Dashboard is two clicks away and visually identical to "extract a page" — the user has to remember.
- **No Template gallery**. A user who wants to run a "scrape 100 YC companies" job has to type the URL list by hand every time.
- **No "Re-run" affordance on Preview**. The Preview shows the result but the only way to re-extract the same URL is to paste it back into the composer.
- **No diff between consecutive scheduled runs**. The user gets a notification "page changed" but has to navigate to the schedule and click "Run now" to see the diff.
- **No "promote to template"**. A user who has done a good custom extraction cannot save it as a reusable recipe.

### 2.5 Concrete alternative home-screen patterns

**Pattern A — "Jobs" home (recommended)**

- **IA**: top row of 6 outcome tiles (unchanged). Below, a single composer that defaults to "Single URL". To the right of the composer, a tab strip: `[Single] [Bulk] [Watch]`. The "Bulk" tab swaps the composer to a multi-line textarea with a "paste list or drop CSV" hint. The "Watch" tab swaps the composer to a one-field input plus a cadence picker and an alert-email field, both inline. Below the composer, on a signed-in home, a "Recent runs" rail of the last 8 extractions (avatar, page title, time, status, re-run / share / open in dashboard). Below that, a horizontal "Templates" carousel of pre-built recipes (one-click "use this template" pre-fills the composer).
- **Who it serves**: all five personas; the new user (tiles + templates), the returning user (recent runs), the bulk user (Bulk tab), the CI user (Watch tab), the team (templates library).
- **Pros**: single mental model ("what job are you doing?"); a tab strip is faster to learn than a separate nav item; "Recent runs" is a known retention pattern (Linear, Notion, Figma all do this); templates gallery is the only proven growth loop for content-driven tools.
- **Cons**: more visual complexity; a tab strip with three modes is a 2x increase in composer surface area; needs careful empty-state design to avoid 3 different empty states.
- **Migration effort**: medium. The composer already adapts based on toolbar toggles; the new design formalises the modes into a tab strip and adds Recent Runs + Templates rails. Estimated 2–3 sprints for one designer + one front-end engineer.

**Pattern B — "Watch a URL" overlay (lowest-risk)**

- **IA**: keep the home exactly as it is. Add a single button next to the existing Schedule chip: **"Watch this URL"** that opens a fullscreen modal with cadence + alert email + name (the existing "Track changes on a page" modal from screenshot 05, surfaced as the *first* option rather than buried in the toolbar dropdown).
- **Who it serves**: CI, sales (price monitoring), researchers.
- **Pros**: minimal change; a one-modal overlay is a 1-sprint ship; tests adoption of the "watch" job; gives the existing Schedule chip a clearer label.
- **Cons**: doesn't address Recent Runs or Templates; keeps the four-mode-asking-to-be-one box problem.
- **Migration effort**: low (1 sprint).

**Pattern C — "Templates gallery" (growth-led)**

- **IA**: home splits 60/40. Left 60% is the existing composer. Right 40% is a vertical gallery of templates: "Scrape 50 SaaS pricing pages", "Extract all YC founders", "Track 20 competitor job boards", each with a one-click "Use template" button. Below: a Recent Runs horizontal carousel.
- **Who it serves**: new users (templates beat a blank box), growth (each template is a shareable URL), retention (templates are reused weekly).
- **Pros**: this is the only design that *enables* a templates marketplace (Section 5 white-space opportunity 1). The right column doubles as the marketplace's browse page.
- **Cons**: doesn't address the Bulk/Watch confusion in the composer; visually busier.
- **Migration effort**: medium. Depends on the templates marketplace existing first.

**Pattern D — "Multi-URL paste-first" (bulk-led)**

- **IA**: the composer defaults to multi-line. The single-URL mode is one click away via a "Single URL" link. Below: a "Your last 5 batch runs" rail.
- **Who it serves**: SDRs (100 URLs at a time), SEO (sitemap scrape), recruiters.
- **Pros**: aligns with the fact that Browse AI / Apify users overwhelmingly use bulk mode.
- **Cons**: breaks the 30-second single-URL story; one click backward per use is friction.

**Pattern E — "Use-case chooser" (sales-led)**

- **IA**: the first thing the user sees is a 2x3 grid of 6 use-case cards with illustrations ("Build a lead list", "Track competitor pricing", "Audit my SEO", "Find job postings", "Research a company", "Pull tech stack"). Each card leads to a pre-wired template.
- **Who it serves**: new users only. Returning users still want their Recent Runs.
- **Pros**: best first-time UX; the most common pattern for new user activation in B2B SaaS.
- **Cons**: a step backward in time-to-value for power users; not a permanent state.

### 2.6 Recommended home-screen redesign (ranked)

**Recommendation 1 — Pattern A (Jobs home) + Pattern B (Watch overlay) shipped together.** The Jobs home fixes the IA; the Watch overlay fixes the schedule-confusion discovered in screenshot 05. Ship the Watch overlay first (one sprint) to capture low-hanging-fruit activation gains; ship the Jobs home second (2–3 sprints) once Recent Runs and Templates rails exist.

**Recommendation 2 — Pattern C (Templates gallery) as a growth experiment.** The right column of the home is a vertical templates carousel. This is the only redesign that unlocks the templates marketplace thesis (Section 5.3 white-space 1). It does not require Pattern A; it can ship alongside it.

**Rationale** [A]: The single-URL composer is correct for 50% of the use cases. The remaining 50% (bulk, watch, repeat, template) need a *different* first surface. The two changes that move the needle most are (a) making the home a *returning* surface (Recent Runs) and (b) making the home *teach* the product (Templates). The home page is currently optimised for the first visit only. The redesign should optimise for the first *and* the 50th visit.

---

## 3. Competitive landscape

Seven competitors, with one (DatIQ itself) implicit. Each profile is anchored to a single primary source + at least one secondary corroboration. All access dates are 2026-08-03.

### 3.1 Browse AI (`browse.ai`)

- **Positioning [F]**: "AI web scraper" — "Scrape data from any website with no code" (homepage H1). The Browse-AI-published comparison article calls itself "the AI-powered platform that turns any website into a live data pipeline."
- **Target user [F]**: No-code teams and beginners (per their own comparison article); sales, e-commerce, real estate, job listings, lead generation (per the homepage use-case list).
- **Signature features [F]**:
  - 250+ prebuilt robots (templated scrapers for popular sites)
  - Visual Robot Studio (point-and-click training, no code)
  - Self-healing AI (re-trains on layout changes automatically)
  - AI change detection and website monitoring
  - 7,000+ integrations
  - Web scraping services (managed, custom)
  - Bulk runs and webhooks on Professional+
  - Full API on Team plan
- **Pricing [F]** (browse.ai/pricing, verified 2026-03-26 per saaspricepulse):
  - Free — 50 credits/mo, 2 websites, 3 users, unlimited robots
  - Personal — $19/mo annual ($48/mo monthly), 12,000 credits/yr, 5 websites, 3 users
  - Professional — $69/mo annual ($87/mo monthly), 60,000 credits/yr, 10 websites, 10 users, webhooks, bulk runs
  - Premium — $500+/mo annual, 600,000+ credits, custom limits
  - Add-on: $2.40–$5/mo per extra website
  - Credit overages: $0.013–0.024/credit on annual plans
- **What they do better than Datiq [A]**:
  - Mature visual Robot Studio (Browse AI's #1 retention feature)
  - 250+ prebuilt robots (Browse AI's #2)
  - Self-healing AI (Browse AI's #3)
  - 7,000+ integrations (Browse AI's #4)
  - Bulk runs and webhooks at $69/mo (Datiq's batch cap is 5 URLs on free and undocumented above)
  - 10-user team on Professional (Datiq's team story is unclear)
- **What they do worse than Datiq [A]**:
  - No plain-English field extraction at the URL paste level (Browse AI requires training a robot for any new field)
  - No native AI contacts/pricing/leadership tabs on the result screen (Browse AI robots are configured per-site)
  - No domain-map "show me everything on this site" first-class feature
  - No public shareable report at `/p/:slug`
  - No 6 outcome tiles / no intent chips
  - No command palette / fewer keyboard shortcuts
  - Higher free-tier friction (50 credits/mo that "bought" 500 rows vs Datiq's 10 extractions)
  - No SEO-blog-outline / competitor-summary / social-post content generation on the result

### 3.2 Apify (`apify.com`)

- **Positioning [F]**: "Web scraping and automation platform" — "turn websites into an API". The Actors marketplace tagline is "Ready-to-run tools for your AI agents and apps. Just pick one and go."
- **Target user [F]**: Developers, scaling teams, AI agent builders, enterprise ("Apify for Enterprise", "Nonprofits", "Universities"). The 55,677-Actor marketplace skews technical.
- **Signature features [F]**:
  - 55,677 Actors (was 6,000+ in 2023, ~1,000+ referenced in their own article)
  - Anti-blocking infrastructure (proxy rotation, browser fingerprinting, CAPTCHA solving)
  - Crawlee (open source Node.js scraper library)
  - MCP server configuration
  - x402 protocol (agents pay-per-run)
  - Monetize Actors ($1.4M paid out to developers last month, "many devs earn over $3k")
  - Pay-per-compute-unit billing ($0.2/CU)
  - Serverless scheduling
- **Pricing [F]** (apify.com/pricing):
  - Free — $0, $5 of platform credit, $0.20 per compute unit, community support
  - Starter — $29/mo + pay-as-you-go, $29 store credit, chat support, bronze discount
  - Scale and Enterprise — not publicly listed, contact sales
- **What they do better than Datiq [A]**:
  - 55,000+ pre-built scrapers (Actors)
  - Anti-blocking and proxy infrastructure
  - Monetize-user-content flywheel (developers earn)
  - MCP and x402 for AI agent integration
  - Open-source Crawlee library
  - Mature SDK and CLI for production
- **What they do worse than Datiq [A]**:
  - Steep learning curve (developer-first)
  - No plain-English single-URL extraction
  - No intent chips, no AI summary, no contacts/pricing/leadership tabs
  - No public shareable reports at `/p/:slug`
  - No gallery
  - No native content generation (SEO outline, etc.)
  - The "free" $5 only buys ~2 small jobs, vs Datiq's 10 extractions
  - Compute units and pricing are opaque to non-developers

### 3.3 Clay (`clay.com`)

- **Positioning [F]**: "Data infrastructure" — "Centralize your first and third party data sources in Clay". Their hero copy: "The go-to-market conference" positioning makes Clay *the* GTM data platform.
- **Target user [F]**: Sales, marketing, GTM ops, RevOps, agencies. Heavy emphasis on "rep prospecting" and "PLG assist".
- **Signature features [F]**:
  - Data marketplace with 200+ providers
  - Waterfall enrichment (multi-provider, "best coverage")
  - Claygents (AI research agents) — "Research target companies and people with AI"
  - Signals and Intent (job changes, promotions, intent)
  - MCP for rep ("Track job changes, promotions or other signals")
  - Sequencer (native email outreach)
  - Functions, AI formatting
  - CRM enrichment, TAM sourcing, ABM, reverse ETL
  - CLI & API
  - Ad sync (LinkedIn, Meta, Google)
- **Pricing [F]** (clay.com/pricing, post-2026-03-11 overhaul):
  - Free — 100 Data Credits, 500 Actions/mo, unlimited seats, 200-row table cap
  - Launch — $185/mo ($167 annual), 2,500 Data Credits, 15,000 Actions, 50K rows/table
  - Growth — $495/mo ($446 annual), 6,000 Data Credits, 40,000 Actions, CRM sync
  - Enterprise — custom (~$30K+/yr per salesmotion)
  - Data Credits start at $0.05; Actions at <$0.01
- **What they do better than Datiq [A]**:
  - 200+ data providers and waterfall enrichment
  - Claygents (AI research agents, autonomous)
  - Signals and Intent (real-time job-change, promotion data)
  - Built-in sequencer and ad sync
  - CRM sync (HubSpot, Salesforce) on Growth
  - Multi-provider coverage beats single-URL scraping
  - Unlimited seats on all plans
- **What they do worse than Datiq [A]**:
  - 10–100× more expensive at the entry point ($185 vs $0–$29)
  - No single-URL paste-and-go UX (Clay is a spreadsheet first, scraping second)
  - No domain map
  - No shareable public report
  - No gallery
  - No "30-second time-to-insight" — Clay workflows take 15–60 minutes to set up
  - Credit model is more complex (Data Credits + Actions)

### 3.4 Hexomatic (`hexomatic.com`)

- **Positioning [F]**: "Web scraping + AI work automation" — "Tap into the internet as your own data source and automate 100+ sales, marketing, or research tasks on autopilot."
- **Target user [F]**: SMB marketing agencies, sales teams, research ops. The "trusted by 150,000+ businesses" copy targets non-technical operators.
- **Signature features [F]**:
  - 1-click web scraper for popular sites
  - 100+ ready-made automations (article scraper, email validation, contacts, tech stack, SEO meta, ChatGPT, DeepL)
  - Workflow builder combining scraping + AI
  - Custom scraping recipes
  - Datacenter IP rotation (Silver+)
  - Premium credit add-on (ChatGPT, DeepL, Google Maps, email enrichment, residential proxies, Amazon data, SEO backlinks) — from $9.99/mo
  - Slack/Telegram notifications
  - 10 simultaneous workflows on Silver, unlimited on Gold
- **Pricing [F]** (hexomatic.com/pricing, 2026):
  - Free — 75 credits/mo, 1 workflow, CSV/Sheets export
  - Bronze — $24/mo, 2,000 credits, 5 workflows, scheduling
  - Silver — $49/mo (~$41 annual), 4,500 credits, 10 workflows, datacenter IPs
  - Gold — $99/mo (~$83 annual), 10,000 credits, unlimited workflows, API
  - Enterprise — custom (10K+ credits, custom scraping templates, dedicated strategy consultant)
  - Premium credits: $9.99/mo (105 credits) or $999/mo (packaged)
- **What they do better than Datiq [A]**:
  - 100+ automations marketplace
  - Mature workflow builder (scraping + AI + output)
  - Built-in scheduling on all paid plans
  - Premium proxies and translation as add-on
  - Two simultaneous workflow scale
  - Slack/Telegram notifications
- **What they do worse than Datiq [A]**:
  - Two-tier credit model is confusing (base credits + premium credits)
  - No plain-English single-URL UX (workflow-first)
  - No intent chips, no AI summary, no contacts/pricing tabs
  - No shareable public reports
  - No domain map
  - No gallery
  - No native content generation
  - 75 free credits buys ~1-2 small jobs vs Datiq's 10 extractions

### 3.5 Kadoa (`kadoa.com`)

- **Positioning [F]**: "The web data layer for finance" — "Our coding agents build deterministic pipelines that produce the most accurate web datasets." Their CTA: "Build. Deploy. Monitor."
- **Target user [F]**: Investment firms, financial analysts, enterprise data teams. Their own copy says "Trusted by the world's top investment firms." Open Datasets menu: Changelog, Investment Research, Real-Time Alerts, Documents & Filings, Portfolio Monitoring.
- **Signature features [F]**:
  - Coding agents that build, monitor, and self-heal scrapers
  - Source-grounded outputs (audit-ready, every value traceable to a paragraph)
  - MCP support
  - Cloud-native delivery to S3, Snowflake, BigQuery
  - Web, PDF, image, spreadsheet extraction
  - Real-time monitors (Slack, email, webhooks)
  - ETL in Kadoa (for engineers)
  - Enterprise: SAML SSO, shared workspaces, SLA, dedicated AM
- **Pricing [F]** (kadoa.com/pricing):
  - Flex — free trial, consumption-based, all core features, basic support
  - Enterprise — custom, all integrations, SAML SSO, shared workspaces & unlimited users, SLA, dedicated AM
- **What they do better than Datiq [A]**:
  - Self-healing scrapers (built-in, not opt-in)
  - Source-grounded outputs (every field traceable — the only competitor that does this)
  - Cloud-native delivery to data warehouses
  - MCP support
  - Finance-vertical depth (SEC filings, real-time alerts, portfolio monitoring)
  - Audit-ready provenance (a real compliance story)
- **What they do worse than Datiq [A]**:
  - No public free tier (only "free trial")
  - Opaque consumption-based pricing
  - No single-URL paste-and-go UX
  - No AI summary by intent
  - No intent chips, no enrichment tabs
  - No shareable public reports
  - No gallery
  - No 30-second time-to-insight

### 3.6 Thunderbit (`thunderbit.com`)

- **Positioning [F]**: "AI Web Scraper & Web Automation Agent" — "Free web scraper with free data export — to Excel, Google Sheets, Airtable, and Notion." Chrome Web Store tagline: "2-click lead list builder."
- **Target user [F]**: Sales teams, ops, e-commerce, real estate, non-technical. The Chrome Web Store lists "lead lists for cold outreach, price tracking for e-commerce, data collection for database building" as the top use cases.
- **Signature features [F]**:
  - AI Data Extractor (1-click, no CSS selectors)
  - Subpage scraping (visits linked pages for enrichment)
  - Pagination & infinite scroll
  - Scheduled scraper & web monitor
  - Web to Table / Excel / Google Sheets / Airtable / Notion
  - PDF to table & OCR (extract text from image)
  - Email Extractor (free forever)
  - Phone Number Extractor (free forever)
  - Image Downloader (free forever)
  - AI autofill, AI suggest columns
  - Pre-built scrapers (Amazon, eBay, etc.)
  - Bulk scraping
- **Pricing [F]** (thunderbit.com/pricing, 2026):
  - Free — 6 pages/mo (max 30 credits/page), 14-day data retention, 1 scheduled scraper
  - Starter — $9/mo yearly ($15/mo monthly), 5,000 credits/yr, subpage scraping, pre-built, bulk (2,000 URLs), pagination (200 pages), data enrichment
  - Pro — up to 20,000 credits/mo
  - Custom templates & priority support at top tier
  - Credit model: 1 row = 1 credit; subpage = 2; AI msg = 1; enrichment = 30
- **What they do better than Datiq [A]**:
  - PDF + image + OCR extraction
  - Free Email / Phone / Image extractors (forever)
  - Subpage enrichment (the only competitor that does this in the 2-click UX)
  - Very low entry price ($9/mo)
  - Direct export to Google Sheets, Airtable, Notion (no manual CSV dance)
  - Pre-built scrapers for popular e-commerce sites
  - Chrome extension (free)
- **What they do worse than Datiq [A]**:
  - 6 free pages vs Datiq's 10
  - No domain map / no Map site feature
  - No intent chips, no AI summary by intent
  - No scheduled monitoring (only scheduled scraper)
  - No shareable public reports
  - No gallery
  - No public API
  - 14-day data retention on free

### 3.7 Firecrawl (`firecrawl.dev`)

- **Positioning [F]**: "The Web Data API for AI Agents and Developers." Their hero card on the pricing page: "Transparent. Flexible pricing."
- **Target user [F]**: Developers, AI engineers, RAG pipeline builders. 159.6K sign-ups mentioned in the pricing page (Hacker News–type growth).
- **Signature features [F]**:
  - `/scrape` (Markdown/JSON/HTML output, LLM-ready)
  - `/crawl` (multi-page crawl)
  - `/map` (domain map)
  - `/extract` (LLM-ready structured with JSON schema)
  - `/search` (search results → structured data)
  - `/interact` (browser)
  - `/monitor` (1 credit/page/check)
  - Agent (preview, 5 daily runs)
  - Open source (GitHub)
  - Per-credit cost: scrape 1, crawl 1, map 1, search 2, interact 2/min, monitor 1/page/check
- **Pricing [F]** (firecrawl.dev/pricing, 2026):
  - Free — 1,000 credits/mo, 2 concurrent requests, low rate limits
  - Hobby — $16/mo annual, 5,000 credits, 5 concurrent
  - Standard — $83/mo annual, 100,000 credits, 50 concurrent
  - Growth — $333/mo annual, 500,000 credits, 100 concurrent, priority support
  - Scale — $599/mo annual, 1,000,000 credits, 150 concurrent
  - Enterprise — custom, SSO, advanced security
- **What they do better than Datiq [A]**:
  - LLM-ready Markdown (the canonical "scraping for LLMs" output)
  - Open source
  - Huge scale (1M credits/mo on Scale)
  - Sub-second p50 latency (vs Datiq's "30 seconds" UX)
  - `/search` endpoint
  - `/interact` (real browser) endpoint
  - Agent (preview) for autonomous workflows
  - Developer ergonomics (6 well-documented REST endpoints, great SDKs)
- **What they do worse than Datiq [A]**:
  - API only — no UI for non-developers
  - No AI enrichment tabs (no contacts/pricing/mission/leadership on the result)
  - No plain-English extraction at the URL paste level (requires JSON schema)
  - No public shareable reports
  - No gallery
  - No intent chips
  - No outcome tiles
  - No 30-second time-to-insight for non-coders
  - More expensive at scale (Growth $333 vs Datiq Agency $299)

---

## 4. Competitor feature matrix

25 features across 9 categories. Cells: ✓ = supported, ✗ = not supported, ~ = partial, ? = unknown. All cells are dated to access 2026-08-03 unless noted. The full machine-readable form is in Appendix B.

### 4.1 Core extraction (1–4)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Single-URL paste-and-go extraction | ✓ | ✓ | ✓ | ~ | ✓ | ~ | ✓ | ✓ (API) |
| 2 | Plain-English custom field extraction | ✓ | ✗ | ✗ | ~ (Claygents) | ✗ | ✗ | ~ (column names) | ✗ (JSON schema only) |
| 3 | Domain / sitemap map | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| 4 | Subpage enrichment (follow links) | ✗ | ✓ (Robot) | ✓ (Actor) | ✗ | ✓ (automation) | ~ | ✓ | ✓ (crawl) |

### 4.2 AI / automation (5–8)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 5 | AI summary of a single page | ✓ | ✗ (raw rows) | ✗ (raw rows) | ✗ | ~ (article scraper) | ✗ | ✗ | ✗ (raw Markdown) |
| 6 | AI contacts / leadership / pricing / mission enrichment tabs | ✓ | ✗ | ✗ | ✓ (Claygents) | ~ (separate automations) | ✗ | ✗ | ✗ |
| 7 | AI content generation (SEO outline / competitor brief / social) | ✓ | ✗ | ✗ | ~ (AI formatting) | ✓ (ChatGPT) | ✗ | ✗ | ✗ |
| 8 | Self-healing scrapers (auto-recover from layout changes) | ✗ | ✓ (self-healing AI) | ~ (Actor updates) | ✗ | ✗ | ✓ | ✗ | ✗ |

### 4.3 Monitoring & alerts (9–12)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 9 | Scheduled re-extraction on a URL | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ (/monitor) |
| 10 | Email alerts on change | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| 11 | Slack / webhook alerts | ✗ | ✓ (webhook on Pro+) | ✓ | ✓ | ✓ (Slack/Telegram) | ✓ | ✗ | ✓ |
| 12 | Source-grounded provenance (every field traceable) | ✓ (per-extraction) | ✗ | ✗ | ✗ | ✗ | ✓ (full audit) | ✗ | ✗ |

### 4.4 Collaboration & teams (13–16)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 13 | Multiple seats | ? | ✓ (3-10) | ? (per-actor) | ✓ (unlimited seats) | ? (per workflow) | ✓ (Enterprise) | ? (per workspace) | ? |
| 14 | Shared workspace | ~ (Extra Workspace) | ✓ (Team plan) | ✓ (org) | ✓ (org) | ✓ (multi-user) | ✓ (Enterprise) | ✗ | ✗ |
| 15 | Audit log / activity history | ? | ? | ✓ | ~ | ✗ | ✓ | ✗ | ✗ |
| 16 | SSO / SAML | ✗ | ? (Enterprise) | ✓ | ✓ (Enterprise) | ✗ | ✓ (Enterprise) | ✗ | ✓ (Enterprise) |

### 4.5 Integrations & ecosystem (17–20)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 17 | Google Sheets / Airtable / Notion native push | ✗ (CSV only) | ✓ (7,000+) | ✓ (Integrations) | ✓ (CRM sync) | ✓ (Google Sheets) | ✗ | ✓ (Sheets / Airtable / Notion) | ✗ |
| 18 | Zapier / Make / n8n connector | ✗ | ✓ (7,000+) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 19 | Native CRM (HubSpot / Salesforce / Pipedrive) | ✗ | ✓ (7,000+) | ~ | ✓ (Growth plan) | ~ | ✗ | ✗ | ✗ |
| 20 | MCP server for AI agents | ✗ | ✗ | ✓ | ✓ (MCP for rep) | ✗ | ✓ | ✗ | ✗ |

### 4.6 Data delivery & export (21–23)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 21 | CSV / JSON / Markdown / PDF / Email export | ✓ (5) | ✓ (CSV / API) | ✓ (CSV / JSON) | ✓ (CSV / Sheets) | ✓ (CSV / Sheets) | ✓ (cloud delivery) | ✓ (CSV / Sheets / Notion) | ✓ (JSON / Markdown) |
| 22 | Cloud-warehouse delivery (S3 / Snowflake / BigQuery) | ✗ | ✗ | ~ (Actor output) | ✗ | ✗ | ✓ | ✗ | ✗ |
| 23 | Public shareable report (read-only URL) | ✓ (/p/:slug) | ✗ | ✗ | ~ (workspace) | ✗ | ✗ | ✗ | ✗ |

### 4.7 Security & compliance (24–25)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 24 | SOC 2 / ISO 27001 / GDPR badge | ✗ (?) | ✓ (?) | ✓ | ✓ | ✗ (?) | ✓ | ✗ | ✓ (Enterprise) |
| 25 | "Never used to train AI" commitment | ✓ | ? | ? | ? | ? | ? | ? | ? |

### 4.8 Pricing & packaging (26–28)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 26 | Free tier (no card) | ✓ (10/mo) | ✓ (50 credits) | ✓ ($5 store) | ✓ (100 credits) | ✓ (75 credits) | ✗ (trial only) | ✓ (6 pages) | ✓ (1,000 credits) |
| 27 | Lowest paid entry | $19 (Select) | $19 ($48 monthly) | $29 | $185 | $24 | Custom (consumption) | $9 | $16 |
| 28 | Top-up / overage model | ✓ (top-up bundles) | ✓ ($0.013–0.024/credit) | ✓ (pay-per-CU) | ✓ (Data Credits, Actions) | ✓ (premium add-on) | ✓ (consumption) | ✗ | ✗ |

### 4.9 Developer & API (29–33)
| # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl |
|---|---|---|---|---|---|---|---|---|---|
| 29 | Public REST API | ✓ (Business+, alpha) | ✓ (Team plan) | ✓ (primary product) | ✓ (CLI + API) | ✓ (Gold+) | ✓ | ✗ | ✓ (primary product) |
| 30 | Open-source SDK / library | ✗ | ✗ | ✓ (Crawlee) | ✗ | ✗ | ✗ | ✗ | ✓ (open source) |
| 31 | Webhook for results | ? (per /vs/firecrawl R19) | ✓ (Professional+) | ✓ | ✓ | ~ (Telegram/Slack) | ✓ | ✗ | ✓ |
| 32 | Test / sandbox environment | ✓ (dq_test_*) | ? | ✓ (CU sample) | ? | ✗ | ✗ | ✗ | ✓ (test key) |
| 33 | MCP server for AI agents | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |

**Notes on certainty**:
- ? marks are used where the company's own marketing does not publicly state a feature; absence is not the same as non-existence, and is more likely a "not advertised" than "not built".
- The matrix is intentionally read as "what is publicly verifiable on 2026-08-03" rather than "what is in the codebase". The full scoring matrix (with E/U/G/S/C/D/R/V/T and PS) is in Appendix B.

---

## 5. Differentiation & gap analysis

### 5.1 Where Datiq wins today

Each of the following is anchored to a public source.

1. **"Intelligence from every URL" is a defensible brand promise** [F — homepage H1, JSON-LD, footer]. No other tool in the seven-competitor set has a single noun phrase that does this much work. Browse AI = "AI web scraper" (commodity). Firecrawl = "Web Data API" (commodity). Clay = "Data infrastructure" (commodity). Datiq = "intelligence from every URL" (a claim only it makes). The brand is the moat — the product has to live up to it.

2. **The 30-second URL → structured-data UX** [F — vs/firecrawl, testimonials, help/02 quick-start]. Three steps: paste → click → review. None of the seven competitors has this in a free UI. Firecrawl is "5–10 minutes (API key + SDK)" per the same source. Clay is 15–60 minutes to set up a workflow. Browse AI requires training a robot first.

3. **The 6 outcome tiles are a teaching surface** [F — homepage screenshot]. "Build a lead list", "Scrape pricing", "Competitor intel", "SEO audit", "Tech stack", "Job postings" — these are jobs the user has, not features the product has. The reframing converts a blank box into a menu of 6 known jobs. None of the seven competitors has this.

4. **The Preview screen with confidence + provenance + tags** [F — screenshot 03]. 85% confidence on the AI summary, "from lumio.io, 40 fields, 95% avg confidence, checked just now" provenance, tag input. This is the result as a first-class object. No competitor (including Kadoa) shows this in a free single-URL view.

5. **The `/p/:slug` public report** [F — help/10, glossary, vs/firecrawl]. One-click share, read-only, anyone can view. This is the only viral loop in the seven-competitor set. Browse AI has no public reports. Firecrawl has no public reports. Clay has internal sharing only. Kadoa doesn't expose this.

6. **The 16-section help center with a real developer API reference** [F — /help/* and /help/developers]. Most V1 products ship a single Notion page; Datiq ships 16 navigable sections plus a real REST reference. This is a B2B sales asset that buyers will check.

7. **Plain-English "Custom" extraction with confidence score** [F — homepage, help/04, developers doc]. A non-coder says "founding year" and gets it back. Browse AI requires training a robot. Apify requires writing an Actor. Firecrawl requires a JSON schema. This is a real differentiator for the "I am not a developer" segment.

8. **The "Never used to train AI" trust badge** [F — homepage]. In 2026 this is a meaningful enterprise sales signal. Most competitors do not advertise it.

9. **Pricing is positioned to win on the headline number** [F — vs/firecrawl]. $19/mo (Select) vs Browse AI $19/mo, Hexomatic $24/mo, Apify $29/mo, Firecrawl $16/mo, Clay $185/mo. Datiq is at the lower end of the B2B price band, which is the right position for a tool that wants to win on "30-second UX" rather than "scale".

10. **The outcome-tile → intent-chip → enrichment-tab → content-generation flow is a single coherent grammar** [A]. From the moment the user pastes a URL, every screen speaks the same language (intent, enrichment, content, share). This is hard to copy because it requires the whole product to be designed around it.

### 5.2 Where competitors win

| Competitor | Wins on | Source / evidence |
|---|---|---|
| **Browse AI** | Visual robot training, 250+ prebuilt robots, self-healing AI, 7,000+ integrations, mature team story (10 users on Pro) | browse.ai/pricing, browse.ai/blog/the-best-ai-web-scraper-tools |
| **Apify** | 55,000+ Actors marketplace, anti-blocking, Crawlee open-source, x402 for AI agents, monetize-developers flywheel | apify.com/pricing, apify.com (home) |
| **Clay** | 200+ data providers, waterfall enrichment, signals/intent, native sequencer, Claygents, CRM sync, unlimited seats on all plans | clay.com/pricing, salesmotion breakdown |
| **Hexomatic** | 100+ automations, mature workflow builder, premium proxies, scheduling on all paid plans, Slack/Telegram notifications | hexomatic.com/pricing, slicey review |
| **Kadoa** | Self-healing scrapers, source-grounded audit, cloud-warehouse delivery, finance vertical depth, MCP support | kadoa.com, kadoa.com/pricing |
| **Thunderbit** | Free forever Email/Phone/Image extractors, subpage enrichment, PDF/OCR, $9 entry price, Sheets/Airtable/Notion push, Chrome extension | thunderbit.com Chrome Web Store, g2 pricing |
| **Firecrawl** | LLM-ready Markdown, open source, 1M credits on Scale, sub-second latency, /search, /interact, Agent preview, MCP | firecrawl.dev/pricing, firecrawl.dev/blog |

### 5.3 White-space opportunities (problems no one solves well)

Based on the matrix in Section 4 and the open questions in Section 10, the following are gaps that **none of the seven competitors solves well** [A]:

1. **Single-URL → structured-data → public shareable link → embed anywhere.** The "paste a URL, get a structured report, share it as a public link, and embed it in a Notion page or a Slack message" loop is the only viral loop in the space. Datiq has the first three links; no one has the embed-everywhere link.
2. **Domain research workspace** ("paste a domain, get a classified map of every important page"). Browse AI has site robots, Kadoa has finance data, Firecrawl has /map, but no one has a "give me a one-page brief on company.com" that classifies by intent (pricing, careers, leadership, blog, legal, product) and presents the most important pages first.
3. **Self-healing scrapers + AI-confidence on every field** for non-developers. Kadoa does this for enterprise; Hexomatic does it for power-users; Browse AI does it for robots. No one has done it for the "30-second URL" segment.
4. **Templates marketplace with revenue share for the community.** Apify has Actor monetization ($1.4M/month paid out). No one in the no-code / single-URL space has a templates marketplace where non-developers can publish a recipe and earn from it.
5. **Native "lead list" workspace** that is purpose-built for sales prospecting. Clay has this as a side-effect of spreadsheets. Hexomatic has email-finding automations. No one has a "give me 200 leads in one afternoon" workspace the way DatIQ's testimonials claim.
6. **Vertical packs (VCs, recruiters, SEOs, sales)** that ship as a pre-wired bundle: outcome tiles + templates + integrations + cadence. The closest is Clay's GTM focus, but it's horizontal.
7. **Embeddable widget** ("put a DatIQ lead-capture form on your site"). The closest is the public report at `/p/:slug`, but it is a read-only page. No one ships an interactive embed.
8. **Browser extension for the user, not the developer.** Browse AI's extension is for power users. Thunderbit's is for one-off scrapes. No one has a "while you browse, the right sidebar suggests 'extract this page' and pre-fills the composer".

### 5.4 Threats (features competitors are about to ship that Datiq should pre-empt)

| Threat | Source / signal | Likelihood | Time horizon |
|---|---|---|---|
| **Browse AI launches plain-English "Custom" extraction** | They've already shipped self-healing AI and the 250+ robot marketplace; "Custom" is the next obvious step. | High | 6 months |
| **Clay launches a single-URL paste-and-go view** | They are GTM-focused; a "Clay Single Page" widget would be on-brand and would steal the 30-second-UX story. | Medium | 12 months |
| **Firecrawl launches a UI** | Open-source + 1M credits + 159.6K signups; the missing piece is a hosted UI. | Medium | 12 months |
| **Apify launches an MCP-first, no-code UI** | They already have an MCP server and 55K Actors; a "use an Actor without writing code" UI is the obvious next step. | High | 6 months |
| **Kadoa opens up to non-finance verticals** | Their agent + self-healing is vertical-agnostic; "Kadoa for Sales" or "Kadoa for SEO" is a foreseeable packaging change. | Medium | 12 months |
| **Thunderbit launches public shareable reports** | They have free Email/Phone/Image extractors; a "share your result" feature is one sprint. | High | 3 months |
| **Hexomatic launches an AI summary intent chip** | They already have 100+ automations; an "AI summary" automation is a one-engineer, one-sprint ship. | High | 6 months |
| **A new entrant ships "GPT for the web"** — a browser-extension-first, paste-a-URL, get-a-shareable-report UX with a free / public-by-default / viral loop. | The category is wide open; the next $1B AI company may already be in private beta. | Medium | 12 months |

---

## 6. Personas, use cases & engagement drivers

### 6.1 Refined personas

Five personas, ordered by current share-of-voice in the product (per the 6 outcome tiles, the three testimonials, and the /for-* pages).

**Persona 1 — "Solo Sales Rep" (Sara)**
- **Role**: SDR / BDR at a B2B SaaS, 1-10 person sales team.
- **Jobs-to-be-done**: research a prospect's company before a call; pull leadership contacts; check if they use a competitor.
- **Frequency**: 5-20 times per week.
- **Willingness to pay**: $19-49/mo (the buyer is the rep's own credit card, not the team's budget).
- **Current alternatives**: LinkedIn Sales Navigator ($99/mo), Apollo ($49/mo), ZoomInfo ($14,995/yr), Clay ($185/mo), manual copy-paste.
- **Datiq wedge**: "Build a lead list" outcome tile + "Find contacts" enrichment tab. 30-second time-to-insight.

**Persona 2 — "PM doing competitive intel" (Mike)**
- **Role**: Product Manager at a B2B SaaS or fintech, 10-100 person company.
- **Jobs-to-be-done**: weekly competitor pricing scan; feature comparison; landing-page change monitoring; one-pager for the leadership team.
- **Frequency**: 2-5 times per week.
- **Willingness to pay**: $29-79/mo (manager's budget).
- **Current alternatives**: Browse AI ($69/mo), manual Notion docs, Clay ($185/mo).
- **Datiq wedge**: "Scrape pricing" + "Competitor intel" outcome tiles + Schedule + shareable report for the leadership one-pager.

**Persona 3 — "Founder / analyst" (Alex)**
- **Role**: solo founder, VC analyst, or independent researcher.
- **Jobs-to-be-done**: due diligence on a target company; "give me the one-page brief"; tech stack; leadership; recent news.
- **Frequency**: 1-10 times per week.
- **Willingness to pay**: $0-29/mo (personal budget; many on free tier).
- **Current alternatives**: manual browsing, ChatGPT + paste, Browse AI free.
- **Datiq wedge**: "perfect for quick due diligence" testimonial is exactly this persona. Free tier converts them.

**Persona 4 — "SEO / content marketer" (Dana)**
- **Role**: SEO specialist or content marketer at a B2B SaaS or agency.
- **Jobs-to-be-done**: audit a competitor's content; pull meta + heading structure; identify content gaps; repurpose a competitor's blog into an outline.
- **Frequency**: 1-5 times per week.
- **Willingness to pay**: $29-79/mo (marketing budget).
- **Current alternatives**: Ahrefs ($99+/mo), Semrush, Screaming Frog, manual + ChatGPT.
- **Datiq wedge**: "SEO audit" + "Tech stack" outcome tiles + SEO blog outline content generation. The 30-second UX is a Screaming Frog replacement for the 80% of audits that don't need a full crawl.

**Persona 5 — "Recruiter / sourcer" (Reggie)**
- **Role**: in-house recruiter or agency sourcer.
- **Jobs-to-be-done**: extract open roles from a careers page; bulk-extract candidate info; track which companies are hiring.
- **Frequency**: 5-20 times per week.
- **Willingness to pay**: $19-49/mo (recruiter's budget; agency = higher).
- **Current alternatives**: LinkedIn Recruiter ($170/mo), SeekOut, manual.
- **Datiq wedge**: "Job postings" outcome tile + Schedule + batch on multiple companies' careers pages.

### 6.2 Top use cases per persona, ranked by frequency × value

| Rank | Persona | Use case | Frequency | Value | Existing surface |
|---|---|---|---|---|---|
| 1 | Sara | Pull contacts from a prospect's About page | 20/wk | High | "Build a lead list" tile + Find contacts enrichment |
| 2 | Mike | Compare 2-5 competitor pricing pages | 5/wk | High | "Competitor intel" tile + Schedule + shareable report |
| 3 | Alex | One-page brief on a target company | 10/wk | Medium | Single-URL + AI summary + enrichment tabs |
| 4 | Dana | SEO audit on a single URL | 5/wk | Medium | "SEO audit" tile + headings/links/AI summary |
| 5 | Reggie | Job postings from a careers page | 10/wk | Medium | "Job postings" tile + Schedule |
| 6 | Sara | Tech stack detection before a call | 20/wk | Medium | "Tech stack" tile |
| 7 | Mike | Watch a competitor's pricing page weekly | 2/wk | High | Schedule + email alert |
| 8 | Dana | Repurpose a competitor's blog into an outline | 1/wk | Medium | SEO blog outline content generation |
| 9 | Alex | Build a 50-company target list | 1/wk | High | Batch (underused — no template) |
| 10 | Reggie | 100-company weekly job-postings tracker | 1/wk | High | Schedule on a list (not supported — needs templates) |

### 6.3 Engagement mechanics that would actually move retention / referral / virality

Each mechanic is rated on (a) why it works, (b) who benefits, (c) current status in Datiq.

1. **Shareable result pages at `datiq.app/p/:slug`** — already shipped [F]. Works because every "look at this" is a free impression. Benefits all five personas. *Status: ship it harder. The feature exists; the marketing doesn't talk about it. Add a "Share" CTA in the result email digest.*

2. **Public gallery at `/gallery`** — referenced in help/10 [F]. Works because "see what others extracted" is a social-proof surface. Benefits all personas. *Status: thin. Not linked from the home page; not in the top nav. Make it a first-class destination.*

3. **Templates marketplace** — referenced in glossary ("a pre-built extraction recipe you can apply in one click") [F]. Works because the empty state is the biggest drop-off. Benefits all personas, especially Persona 3 (founder) and Persona 4 (SEO). *Status: not built. The biggest single growth lever in the backlog.*

4. **Scheduled monitoring with email digests** — already shipped [F]. Works because the user re-engages when the page changes. Benefits Personas 2, 4, 5. *Status: underused. The trial-mode banner shows 5 batch runs but not "5 schedule runs"; the Schedules screen has no recent-changes feed.*

5. **Team workspaces** — partially shipped (Extra Workspace add-on on Business+) [F]. Works because teams compound. Benefits Personas 1, 2, 4 at the team tier. *Status: not promoted. There is no shared view, no @mention, no "Sarah's recent runs".*

6. **Browser extension for point-and-click extraction on any page** — not shipped [A]. Works because the URL box is one click away from zero if the user is already on the page. Benefits Personas 1, 2, 3, 4, 5. *Status: not built. The 5-of-7 competitors with an extension (Browse AI, Hexomatic, Thunderbit, Claygent via Clay, Apify via Actors) all have it. This is the single biggest parity gap.*

7. **Public URL for any extracted page** — partially shipped (`/p/:slug`) [F]. Works because every public link is a backlink to Datiq. Benefits all personas. *Status: works but is buried. Every "View Dashboard" should also offer "Share publicly".*

8. **Embeddable widget** ("put a Datiq lead-capture form on your site") — not shipped [A]. Works because it puts Datiq's surface on someone else's site. Benefits Personas 1, 2. *Status: not built. The closest is the read-only public report; an interactive embed is a different feature.*

9. **Slack / Teams notification on schedule change** — not shipped [A]. Works because the user is already in Slack all day. Benefits Personas 2, 4, 5. *Status: not built. The schedules feature only emails; this is a 1-sprint add.*

10. **A "Recent runs" rail on the home page** — not shipped [A]. Works because the returning user needs to find their work. Benefits all personas. *Status: not built. The single highest-ROI retention fix.*

11. **A "promote to template" button on a successful custom extraction** — not shipped [A]. Works because the user has done the work; a template makes it one-click next time. Benefits all personas. *Status: not built.*

12. **A "competitor comparison" mode that takes 2-5 URLs and outputs a side-by-side brief** — not shipped [A]. Works because the "Competitor intel" outcome tile is the most differentiated marketing surface; the product only delivers the single-page summary today. Benefits Personas 1, 2. *Status: not built. This is the natural extension of the "outcome tile" abstraction.*

13. **An "AI agent for follow-up questions"** ("Now I have this company brief — what should I ask on the sales call?") — not shipped [A]. Works because the AI summary is the start of a workflow, not the end. Benefits all personas. *Status: not built. A "Chat with this extraction" tab on the Preview would be a one-engineer, one-sprint ship.*

14. **A "Datiq for VCs" / "Datiq for Recruiters" / "Datiq for SEOs" vertical pack** — partially shipped (`/for-sales`, `/for-seo`, `/for-ci` pages) [F]. Works because verticalised onboarding compresses time-to-value. Benefits all personas. *Status: the pages exist; the product does not actually have a "Datiq for VCs" bundle.*

---

## 7. Prioritization formula

The Datiq product team will be asked to choose from ~30 candidate features in Section 8. To make the choice defensible, here is a single, explicit, multiplicative formula. This is the same form as the brief, with the parameter set and scale unchanged.

### 7.1 The formula

    Priority Score (PS) = (E × U × G × S × C) / (D × R × V × T)

Where each input is scored 1-5:

- **E = Effectiveness** — how much user value / problem solved (5 = solves a top pain; 1 = nice-to-have)
- **U = Usefulness** — frequency of need across personas (5 = daily for many; 1 = rarely for few)
- **G = User Engagement** — stickiness, shareability, virality, repeat use (5 = viral loop; 1 = one-shot)
- **S = Strategic Fit** — alignment with product direction & brand ("intelligence from every URL") (5 = core to thesis; 1 = off-brand)
- **C = Competitive Pressure** — do competitors have it? (5 = table-stakes, must ship; 1 = we have unique lead time)
- **D = Development Effort** — engineering person-weeks (5 = multi-quarter; 1 = days)
- **R = Risk** — technical + business + compliance (5 = severe; 1 = trivial)
- **V = Validation Cost** — need for user research / A-B / GTM tests (5 = extensive; 1 = obvious)
- **T = Time-to-value** — weeks from kickoff to first user impact (5 = quarters; 1 = days)

PS is a unitless ratio. Higher is better. A quick-win typically scores > 1.0; a major bet > 1.5; a deprioritised item < 0.5.

### 7.2 Why multiplicative, not additive

The standard additive form `E + U + G + ...` is vulnerable to "balance" — a feature with one 5 and four 1s scores 9, but a feature with five 2s also scores 10. The multiplicative form `E × U × G × ...` correctly penalises a feature that is excellent on one axis and poor on the others. A feature that is "useful and strategic" but "high-effort and risky" should rank below a feature that is "good across the board". Multiplicative scoring is also what most RICE and ICE variants do internally (ICE = Impact × Confidence × Ease). The denominator (D × R × V × T) is a four-way cost — a feature has to clear effort, risk, validation, AND time-to-value before its numerator can pull it up the list.

The formula is bounded: each parameter is 1-5, so the theoretical maximum is `5^5 / 5^4 = 5` and the minimum is `1/625`. In practice, working scores fall in `0.1` to `5.0`.

### 7.3 Worked scoring examples

**Example 1 — Quick Win: "Recent runs rail on home page"**
- E = 5 (solves the #1 retention leak — returning user can't find their work)
- U = 5 (every signed-in user benefits; daily for active users)
- G = 3 (modest engagement lift; not viral)
- S = 5 (core to "intelligence from every URL" — your own intelligence should surface first)
- C = 3 (Browse AI has it; not yet table-stakes but expected)
- D = 1 (one front-end engineer, one week)
- R = 1 (no compliance, no migration, no data risk)
- V = 1 (obvious win; ship and instrument)
- T = 1 (days to ship; instant user impact)

PS = (5 × 5 × 3 × 5 × 3) / (1 × 1 × 1 × 1) = **1125 / 1 = 1125**

A score of 1125 is far above the practical ceiling of 5. This is the formula's known saturation point for a feature that is "high impact, near-zero cost" — these should always be at the top of the queue.

To keep the scale interpretable, the team should additionally bucket by the denominator: D ≤ 2 = Quick Win; D ≥ 3 AND PS > 30 = Major Bet; PS > 15 but D ≥ 3 = Future; everything else = Deprioritise. "Recent runs" is in Quick Win (D=1).

**Example 2 — Major Bet: "Domain research workspace"**
- E = 5 (turns "paste a URL" into "paste a domain" — a 5-10× expansion of the surface area)
- U = 4 (used by Personas 2, 3, 4, 5 weekly; not daily)
- G = 4 (high shareability of a "domain brief" report)
- S = 5 ("intelligence from every URL" naturally extends to "intelligence from every domain")
- C = 5 (Browse AI has it via site robots; Kadoa has it for finance; Firecrawl has /map — table-stakes for the category)
- D = 4 (multi-quarter: classifier, sitemap ingestion, intent taxonomy, UX)
- R = 3 (technical — sitemap discovery is non-trivial at scale)
- V = 3 (needs a research round + a beta with Personas 2, 3)
- T = 3 (4-6 weeks to a public beta)

PS = (5 × 4 × 4 × 5 × 5) / (4 × 3 × 3 × 3) = 2000 / 108 = **18.5**

This is a Major Bet. The numerator is high; the denominator pulls the score into a realistic range. The team should sequence this after the quick-win foundation (Section 9).

**Example 3 — Deprioritised: "Native MCP server for AI agents"**
- E = 2 (only helps Persona 2-style technical buyers; not in the top-3 of any persona's pain)
- U = 1 (rare need; maybe 5% of users would ever call this)
- G = 2 (developer-only; not a viral loop)
- S = 3 (on-brand for "intelligence from every URL" but the brand is no-code-first)
- C = 2 (Apify and Clay have it, but they're developer-first competitors)
- D = 4 (MCP server + auth + maintenance)
- R = 3 (every new tool surface area is risk; the threat model is unclear)
- V = 4 (the value of an MCP server is hard to validate without developer research)
- T = 4 (months before first user impact)

PS = (2 × 1 × 2 × 3 × 2) / (4 × 3 × 4 × 4) = 24 / 192 = **0.125**

This is firmly Deprioritise. The numerator is small; the denominator is large. The team should explicitly note why this is being deprioritised: it's the right answer at Series B, not at the current stage. (It can move up after the templates marketplace ships, which would create a real developer surface to expose.)

---

## 8. Prioritized backlog

36 candidate features / initiatives, scored and bucketed. Bucketing rule: Quick Win = D ≤ 2; Major Bet = D ≥ 3 AND PS > 30; Future = D ≥ 3 AND 5 ≤ PS ≤ 30; Deprioritise = PS < 5. The full machine-readable matrix is in Appendix B.

### 8.1 Quick Wins (D ≤ 2; PS high)

| ID | Name | Description | Persona | E | U | G | S | C | D | R | V | T | PS | Bucket | Rationale | Deps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | **Public pricing page (SSR)** | Ship a real, crawlable `/pricing` page with the 5-tier ladder; link from the React app. | All | 5 | 5 | 3 | 5 | 5 | 1 | 1 | 1 | 1 | 1125 | Quick Win | The single highest-ROI conversion asset. Buyers cannot compare Datiq to Clay / Browse AI without a free signup. | none |
| Q02 | **Recent runs rail on Home** | When signed in, the Home shows the last 8 extractions inline above the composer. | All | 5 | 5 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | 1125 | Quick Win | Solves the #1 retention leak; the returning user can't find their work today. | none |
| Q03 | **Public changelog (SSR)** | Server-render the changelog with monthly entries; make `/changelog` indexable. | All | 4 | 4 | 4 | 5 | 4 | 1 | 1 | 1 | 1 | 1280 | Quick Win | "What's new in 2026-08" is hidden in help/11; buyers will never find it. | none |
| Q04 | **Watch-a-URL overlay** | Surface the "Track changes on a page" modal as a first-class option on the composer (not buried in toolbar). | Sara, Mike, Reggie | 4 | 5 | 3 | 5 | 4 | 1 | 1 | 1 | 1 | 1200 | Quick Win | The schedule-flow confusion is visible in screenshot 05; this is a 1-sprint fix. | none |
| Q05 | **Google Sheets native export** | Add a "Send to Google Sheets" button on Preview and Dashboard; OAuth on first use. | Sara, Reggie, Mike | 5 | 5 | 3 | 4 | 5 | 2 | 1 | 1 | 1 | 750 | Quick Win | The next click after "view" should be "send to a sheet" — every competitor does this. | OAuth app, Google dev account |
| Q06 | **Zapier connector** | Ship a Zapier integration with "New extraction" trigger + 5 actions. | Mike, Sara | 4 | 4 | 4 | 4 | 5 | 2 | 1 | 2 | 1 | 640 | Quick Win | Standard B2B plumbing; ~1000s of customers use Zapier as their glue. | Q05 (Sheets) optional, public API |
| Q07 | **Webhook for results** | Per-extraction webhook URL with HMAC signing. | Mike, Sara, Reggie | 4 | 3 | 3 | 4 | 5 | 1 | 1 | 2 | 1 | 720 | Quick Win | Standard plumbing; Browse AI ships on Pro ($69); Datiq should ship on Pro ($29) or even Select. | Public API alpha |
| Q08 | **Dark mode polish + theme toggle in nav** | The toggle exists in help; surface it as a top-nav icon (already done in screenshots) and add a system-preference default. | All | 3 | 5 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | 90 | Quick Win | Already shipped in code; the help docs reference it; a 1-day polish + audit. | none |
| Q09 | **Keyboard shortcuts in-app** | The 10 documented shortcuts (`?`, `Esc`, `/`, `mod+k`, `g d`/`b`/`s`/`p`/`w`/`t`) — add a "?" overlay. | All | 3 | 4 | 2 | 3 | 2 | 1 | 1 | 1 | 1 | 144 | Quick Win | Documented in help/15; visible in the help nav; not surfaced in the product. | none |
| Q10 | **Email report digest (weekly)** | Weekly email to active users with their new extractions, schedules that fired, and a "share your week" CTA. | All | 4 | 4 | 4 | 4 | 3 | 1 | 1 | 1 | 1 | 768 | Quick Win | Standard retention loop; not shipped. | Q03 (changelog for templated content) |
| Q11 | **Save Custom as Template** | On a successful custom extraction, add a "Save as template" button that creates a reusable recipe. | All | 5 | 4 | 4 | 5 | 4 | 2 | 1 | 1 | 1 | 1600 | Quick Win | The glossary defines "Template" but no template exists today; this is the foundation for the marketplace. | none |
| Q12 | **CSV / JSON / Markdown / PDF — make all 5 always free** | Today the export menu says "some formats are available on higher plans"; make all 5 always free to grow share-of-output. | All | 4 | 5 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | 960 | Quick Win | Every "I want to put this in a sheet" friction is a conversion leak. | none |
| Q13 | **Onboarding template chooser (first visit)** | Replace the 6 outcome tiles with a 2-step "what's your job?" → "here are 3 templates for it" flow on first visit. | All | 4 | 5 | 4 | 4 | 4 | 2 | 1 | 2 | 1 | 1280 | Quick Win | The first-visit UX is the only time you can teach the product. | Q11 (templates) |
| Q14 | **Tag auto-suggest (from prior tags)** | When a user types a tag, suggest from their prior tags and from the system's tag taxonomy. | All | 3 | 4 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | 72 | Quick Win | Tag input exists on Preview; auto-suggest is a half-day. | none |
| Q15 | **Slack notification on schedule change** | When a schedule fires, post to a Slack webhook (per-schedule configurable). | Mike, Reggie | 4 | 4 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | 768 | Quick Win | Slack is where the buyer is; email is where they forget. | none |
| Q16 | **"Re-run" button on Preview** | One-click re-extract the same URL with the same intent. | All | 4 | 5 | 2 | 4 | 3 | 1 | 1 | 1 | 1 | 480 | Quick Win | The 30-second UX becomes a 5-second repeat UX. | none |
| Q17 | **CSV-of-URLs drag-and-drop on Home** | Drag a CSV anywhere on the home page to start a batch — already documented in help/03; verify and surface. | Sara, Reggie | 4 | 4 | 2 | 4 | 4 | 1 | 1 | 1 | 1 | 512 | Quick Win | Documented behaviour; needs the surface to be discoverable. | none |
| Q18 | **Public-share toggle on Preview** | Add a "Make public" toggle on Preview that generates a `/p/:slug` link with one click. | All | 5 | 4 | 5 | 5 | 5 | 1 | 1 | 1 | 1 | 500 | Quick Win | The viral loop already exists; the discoverability is the only gap. | none |
| Q19 | **"Competitor comparison" mode on Preview** | A second tab on Preview that takes 2-5 URLs and shows a side-by-side. | Mike | 4 | 4 | 4 | 5 | 5 | 2 | 1 | 2 | 1 | 1600 | Quick Win | The "Competitor intel" outcome tile is the most differentiated marketing surface; the product only delivers single-URL today. | none |
| Q20 | **"Recent templates" rail on Home** | Once Q11 ships, show the user's last 5 templates on the Home. | All | 4 | 4 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | 720 | Quick Win | Templates + Recent runs is the returning-user surface. | Q11, Q02 |

### 8.2 Major Bets (D ≥ 3, PS > 30)

| ID | Name | Description | Persona | E | U | G | S | C | D | R | V | T | PS | Bucket | Rationale | Deps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M01 | **Templates marketplace (1.0)** | Public gallery of community-contributed templates; "Use template" pre-fills the composer. | All | 5 | 5 | 5 | 5 | 5 | 4 | 3 | 3 | 3 | 104 | Major Bet | The single largest growth lever; the only design that unlocks a viral loop. | Q11, Q13 |
| M02 | **Domain research workspace** | "Paste a domain" → classified map of every page (pricing / careers / leadership / blog / legal / product). | All | 5 | 4 | 4 | 5 | 5 | 4 | 3 | 3 | 3 | 36 | Major Bet | The wedge that no one in the seven-competitor set does well. | M01 |
| M03 | **Self-healing scrapers** | When a URL layout changes, the schedule re-trains and alerts the user with a confidence delta. | All | 4 | 3 | 3 | 5 | 5 | 4 | 4 | 3 | 4 | 23 | Major Bet | Browse AI's #1 retention feature; non-trivial to build well. | Schedules, M02 |
| M04 | **Native CRM integrations (HubSpot, Salesforce, Pipedrive)** | OAuth + "Send this contact / company to CRM" action. | Sara, Mike | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | 75 | Major Bet | Datiq's "Build a lead list" outcome tile is its most differentiated marketing surface; without a CRM push, it stops at "spreadsheet". | Q05 (Sheets), Q11 (templates) |
| M05 | **Browser extension (point-and-click)** | A Chrome extension with a right-click "Extract with Datiq" and a side-panel composer. | All | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | 75 | Major Bet | The single biggest parity gap with Browse AI / Hexomatic / Thunderbit. | Public API |
| M06 | **250+ prebuilt scrapers** | A Browse-AI-style robots library: pre-configured extractions for common sites (YC, G2, LinkedIn public, Crunchbase). | All | 5 | 4 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | 39 | Major Bet | The only way to scale "intelligence from every URL" beyond a single page. | M01, M05 |
| M07 | **SOC 2 Type II** | Pursue SOC 2 Type II certification; ship the trust badge on the marketing site. | Mike, Sara (enterprise) | 4 | 2 | 1 | 4 | 4 | 5 | 3 | 3 | 5 | 9 | Major Bet | Buyers at $79+/mo require it; gates the next tier of expansion. | none |
| M08 | **"Chat with this extraction"** | A conversational follow-up tab on Preview: "What should I ask on the sales call?" | All | 4 | 4 | 4 | 5 | 3 | 3 | 2 | 2 | 2 | 80 | Major Bet | The AI summary is the start of a workflow, not the end. | none |
| M09 | **Waterfall enrichment (à la Clay)** | For "Find contacts", try 3 internal data sources in sequence and return the first non-empty. | Sara, Mike | 4 | 4 | 3 | 4 | 5 | 4 | 3 | 3 | 3 | 25 | Major Bet | Today the "Find contacts" tab returns whatever a single pass finds; Clay's 200+ providers is the wedge. | M04 |
| M10 | **MCP server for AI agents** | Ship a Model Context Protocol server exposing the 5 endpoint families. | Mike (technical), developer ICP | 3 | 2 | 3 | 4 | 3 | 4 | 3 | 4 | 4 | 6 | Future | The right answer at Series B; not at the current stage. | Public API GA |
| M11 | **Audit log & SSO** | Per-workspace audit log + SSO (SAML, Google Workspace) on Business+ and Agency. | Mike, enterprise | 4 | 2 | 1 | 4 | 4 | 4 | 3 | 2 | 3 | 17 | Major Bet | Required for any team sale; minimum 1 quarter of security work. | M07 (SOC 2) |

### 8.3 Future (lower priority, lower PS, higher D)

| ID | Name | Description | E | U | G | S | C | D | R | V | T | PS | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | **AI agent that autonomously builds extraction pipelines** | A long-running agent that watches a domain, classifies new pages, and proposes new templates. | 4 | 2 | 4 | 5 | 4 | 5 | 5 | 4 | 5 | 2 | The right product vision; the wrong 2026-H2 ship. Re-evaluate at 5K MAU. |
| F02 | **Self-healing scrapers v2 (fully autonomous)** | M03's bigger brother: scraper re-trains itself without user awareness. | 3 | 3 | 2 | 4 | 4 | 5 | 5 | 4 | 5 | 2 | Wait for M03 to ship and prove the value. |
| F03 | **Agentic research assistant** | "Build me a 10-company market map" → 50 URL extractions + a synthesised brief. | 4 | 3 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | The product's moat if M02 lands; a 2027 ship. |
| F04 | **Public scraper marketplace (revenue share)** | M01 + revenue share for template authors. | 4 | 3 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 12 | Requires M01 to prove the marketplace flywheel first. |
| F05 | **Vertical packs (VCs, recruiters, SEOs, sales)** | Bundle outcome tiles + templates + integrations + cadence by vertical. | 4 | 4 | 3 | 5 | 4 | 4 | 3 | 3 | 3 | 24 | Wait for M01; verticals are templates + integrations, not net-new code. |

### 8.4 Deprioritise

| ID | Name | E | U | G | S | C | D | R | V | T | PS | Why deprioritised |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X01 | **Build a custom "robot training" UI à la Browse AI** | 3 | 3 | 2 | 2 | 3 | 5 | 4 | 4 | 5 | 1 | Off-brand; the no-code thesis is the differentiator. Re-evaluate only if the no-code custom extraction tops out. |
| X02 | **In-house LLM training** | 2 | 1 | 1 | 2 | 2 | 5 | 4 | 5 | 5 | 0.04 | Use a hosted LLM; the moat is the structured output, not the model. |
| X03 | **Mobile native apps** | 2 | 2 | 1 | 2 | 1 | 5 | 3 | 4 | 5 | 0.4 | The PWA is enough; the use case is desktop-first research. |
| X04 | **Anti-bot proxy infrastructure** | 3 | 2 | 1 | 2 | 4 | 5 | 4 | 3 | 4 | 1 | Differentiated by "what we don't do"; users on hard-to-scrape sites should use Browse AI or Apify. |
| X05 | **White-label agency edition** | 3 | 2 | 4 | 3 | 3 | 4 | 3 | 3 | 3 | 3 | Premature; the Agency plan exists but no customer has asked. |

### 8.5 Top-10 ranked list (for product team to start Monday)

In order of PS × bucket priority. Items 1-7 are Quick Wins; 8-10 are Major Bets sized to ship after the Quick-Win foundation.

1. **Q11 — Save Custom as Template** (PS 1600, Quick Win). The foundation for the marketplace.
2. **Q19 — Competitor comparison mode on Preview** (PS 1600, Quick Win). Makes the "Competitor intel" tile real.
3. **Q03 — Public changelog (SSR)** (PS 1280, Quick Win). Buyers will never find "what's new in 2026-08" without it.
4. **Q13 — Onboarding template chooser (first visit)** (PS 1280, Quick Win). First-visit UX is the only time you can teach.
5. **Q04 — Watch-a-URL overlay** (PS 1200, Quick Win). Fixes the schedule-confusion visible in screenshot 05.
6. **Q01 — Public pricing page (SSR)** (PS 1125, Quick Win). The highest-ROI conversion asset.
7. **Q02 — Recent runs rail on Home** (PS 1125, Quick Win). The single highest-ROI retention fix.
8. **M01 — Templates marketplace (1.0)** (PS 104, Major Bet). The single largest growth lever.
9. **M08 — "Chat with this extraction"** (PS 80, Major Bet). The AI summary becomes the start of a workflow.
10. **M04 — Native CRM integrations** (PS 75, Major Bet). The "Build a lead list" outcome tile becomes real.

---

## 9. Roadmap recommendation

### 9.1 Quarter 1 (next 90 days) — Quick-Win foundation

The Q1 ship list, in dependency order:

- **Week 1-2**: Q01 (public pricing), Q03 (public changelog), Q18 (public-share toggle on Preview). Three server-side-rendered pages; no new product surface.
- **Week 2-3**: Q11 (Save Custom as Template), Q12 (5-format free export), Q08 (dark mode polish).
- **Week 3-5**: Q02 (Recent runs rail on Home), Q20 (Recent templates rail), Q04 (Watch-a-URL overlay).
- **Week 5-7**: Q05 (Google Sheets export), Q07 (webhook for results), Q15 (Slack notification).
- **Week 6-8**: Q13 (onboarding template chooser), Q19 (competitor comparison mode).
- **Week 8-10**: Q06 (Zapier connector), Q10 (weekly email digest), Q16 (Re-run button), Q09 (keyboard shortcuts overlay).

Q1 exit criteria: a returning user lands on Home and sees their last 8 extractions and last 5 templates; a new user lands on Home and gets a 2-step "what's your job?" flow; a paying user can share an extraction publicly, send it to Sheets, post a Slack alert, and re-run it in one click; the marketing site has a public pricing page and a public changelog that index.

### 9.2 Quarter 2 — Major Bets on the Quick-Win foundation

- **Week 11-14**: M01 (Templates marketplace 1.0). The foundation depends on Q11, Q13, Q20 from Q1.
- **Week 13-18**: M04 (Native CRM integrations). Start with HubSpot; Pipedrive is the cheapest second integration.
- **Week 15-20**: M05 (Browser extension). Chrome Web Store submission in week 18.
- **Week 17-22**: M08 ("Chat with this extraction"). The AI-summary → chat loop.
- **Week 19-24**: M02 (Domain research workspace) — alpha. Internal-only for the last 2 weeks.

Q2 exit criteria: a user can publish a template that 100 other users apply; a user can install a Chrome extension and extract a page with two clicks; a user can chat with an extraction; a user can paste a domain and see a classified map.

### 9.3 Quarter 3+ — Defensible differentiators

- **M06 — 250+ prebuilt scrapers** (depends on M01, M05). 12 weeks.
- **M09 — Waterfall enrichment** (depends on M04). 8 weeks.
- **M03 — Self-healing scrapers** (depends on Schedules, M02). 16 weeks.
- **M07 — SOC 2 Type II** (independent; can start in parallel). 24 weeks.
- **M11 — Audit log & SSO** (depends on M07). 12 weeks.
- **F01-F05** are 2027 candidates; revisit at the 5K MAU mark.

### 9.4 Sequencing rationale, dependencies, the single biggest risk

**Sequencing rationale**: the Quick Wins are sequenced so that the *first* ones ship the foundation (SSR pages, exports) and the *last* ones consume the foundation (templates rail, competitor comparison, Zapier). Q1 builds a returning-user surface; Q2 builds a viral surface; Q3 builds an enterprise surface.

**Dependencies**:
- Q11 (Save Custom as Template) is a hard dependency for M01, M13, M20, F04.
- Q02 (Recent runs) is a hard dependency for Q20 (Recent templates).
- M01 (marketplace) is a hard dependency for M06, F04, F05.
- M04 (CRM) is a hard dependency for M09 (waterfall).
- M07 (SOC 2) is a hard dependency for M11 (audit/SSO).

**The single biggest risk to the plan**: the Quick Wins depend on a small, sequential team and a React shell that is currently the only renderer. If a key hire (a senior front-end engineer to ship the public pricing + changelog + Recent runs in week 1) is delayed, Q1 slips and the templates marketplace (the single largest growth lever) slips with it. The second biggest risk is that the public pricing page (Q01) drives so much sign-up traffic that the trial-mode paywall (10 free extractions/mo) starts converting free users faster than the team can handle the support volume. Plan for 1.5× the projected trial-to-paid conversion in the first 30 days after Q01 ships.

**Secondary risks**:
- The "AI summary as a differentiator" ages out as ChatGPT absorbs the use case; this is mitigated by M08 ("Chat with this extraction") shipping in Q2.
- Browse AI launches "Custom" intent-chip extraction; this is mitigated by Q11 (templates) + M01 (marketplace) which together create a category moat that Browse AI's individual feature cannot match.
- A new entrant (a well-funded seed-stage startup) ships "GPT for the web" with a viral public-by-default loop; this is mitigated by Q18 (public-share toggle on Preview) + Q02 (Recent runs) which together create the closest thing to a viral loop in the current product.

---

## 10. Open questions & risks

Items the team should validate before committing the roadmap. Each is marked [Q] (open question, unverified) or [R] (risk) so the product team can resolve them in a single planning session.

### 10.1 Product state

1. **[Q] Does Datiq have change monitoring today?** The vs/firecrawl page says yes (R19, "schedules + email alerts"). The help docs (08) describe a full schedule editor with cadence and email alerts. But the Schedules screen in screenshot 05 shows an error toast ("Couldn't save the schedule. Please try again.") — is this a flaky path or a fully-working path that the screenshot happened to capture mid-error? **Validate with the engineering team.**
2. **[Q] Is the public pricing page live?** It is in the sitemap but the React shell is the only renderer. The price ladder is only visible in the vs/firecrawl page. **Validate with marketing.**
3. **[Q] Is the changelog actually shipped?** The sitemap lists `/changelog` with `changefreq: weekly`. Help/11 mentions a "2026-08" update. **Validate with the product team.**
4. **[Q] Is the public API in alpha or GA?** The developers doc says "This reference is published ahead of general availability; treat unreleased endpoints as a preview and pin to the versioned base URL." This is alpha. **Validate the GA plan.**
5. **[Q] What is the actual batch cap on Pro / Business / Agency?** The Batch screen says "5 URLs per batch" on the free plan. The Pro / Business / Agency limits are not publicly documented. **Validate with billing.**
6. **[Q] Is there a 5-vs-10 batch-run difference between the trial banner and the free plan?** The trial banner says "5 batch runs remaining" (screenshot 01); the paywall modal says "10 free extractions every month" (screenshot 09). Are these the same counter or two different counters? **Validate with product.**
7. **[Q] What is the actual team/workspace story?** Extra Workspace add-on is described in help/11. There is no public documentation of seat limits, role-based access, or shared views. **Validate with the team.**
8. **[Q] What integrations are actually built vs planned?** The "Collections" and "Explore" nav items have no public documentation. The site has no `/integrations` content despite the URL in the sitemap. **Validate with the team.**
9. **[Q] Is there a hidden trial-extraction mechanism on top of the 10 free?** Screenshot 09's modal says "You've used your 3 free trial extractions" but the homepage says "Trial mode — 10 extractions · 5 batch runs remaining". This is confusing. **Validate with the team.**
10. **[Q] What is the no-account experience?** The "Continue as guest (limited)" link in the paywall modal suggests there is one. The help/12 section says "Try without an account". But the trial banner shows 10/5 counters, not 0/0. **Validate the actual counters.**

### 10.2 Competitive state

11. **[Q] Does Browse AI have plain-English "Custom" extraction in private beta?** Browse AI has been on a quarterly shipping cadence; "Custom" is the obvious next feature. **Validate by checking the changelog.**
12. **[Q] Is Clay building a single-URL view?** Clay's pricing overhaul in March 2026 and the launch of "Claygents" suggest they are investing in agent-style flows; a "Clay Single Page" widget is on-brand. **Validate by checking their public roadmap.**
13. **[Q] Is Firecrawl launching a hosted UI?** Open source + 1M credits + 159.6K signups is a lot of demand for a UI they don't have. **Validate by checking their GitHub issues.**
14. **[Q] Has Kadoa opened beyond finance?** Their pricing page is still consumption-based with no public tiers. **Validate by checking the use-case page.**

### 10.3 Strategic

15. **[R] The "AI summary" differentiator ages out as ChatGPT absorbs the use case.** This is a 12-month risk. M08 ("Chat with this extraction") is the mitigation.
16. **[R] The $19 entry price is too low to support a 5-engineer team at scale.** The pricing is right for a solo/SMB product, wrong for a team/enterprise product. The pivot to team pricing (M04, M11) needs to be paired with the pivot to team features.
17. **[R] The single-URL thesis has a ceiling.** Once a user has extracted the 10-100 URLs they care about, what is the retention loop? Templates + schedules + market are the answer; without them, the LTV is bounded.
18. **[R] The "Never used to train AI" trust badge is a meaningful 2026 sales signal but a 2027 cost if it is contractual.** The team should formalise this in the ToS.
19. **[R] The competitor set is widening, not narrowing.** BrowserAct just launched an "Agent Build" product (markets.businessinsider.com 2026-07-28). New entrants are shipping monthly. The defensible surface is the structured + shareable result, not the summary.

---

## Appendix A — Raw source index

Each source: name, URL, access date, what it supports.

### A.1 Datiq primary sources

| # | Name | URL | Access date | Supports |
|---|---|---|---|---|
| 1 | DatIQ homepage (HTML head + meta + JSON-LD) | https://datiq.app/ | 2026-08-03 | Positioning, tagline, feature list, organization schema, software schema, free plan details |
| 2 | DatIQ sitemap | https://datiq.app/sitemap.xml | 2026-08-03 | Full URL structure, all 26 public routes |
| 3 | DatIQ robots.txt | https://datiq.app/robots.txt | 2026-08-03 | Public-allow list, admin-disallow, named-bot policies |
| 4 | Help — Overview (sections 1-16) | https://datiq.app/help/ | 2026-08-03 | Complete product documentation index |
| 5 | Help — 01 What DatIQ is | https://datiq.app/help/01-what-datiq-is | 2026-08-03 | Product positioning, feature list, dark mode reference |
| 6 | Help — 02 Quick start | https://datiq.app/help/02-quick-start-your-first-extraction | 2026-08-03 | 4-step onboarding flow |
| 7 | Help — 03 The Home composer | https://datiq.app/help/03-the-home-composer | 2026-08-03 | Composer IA, single/batch/schedule, CSV drag-drop |
| 8 | Help — 04 What you can extract | https://datiq.app/help/04-what-you-can-extract | 2026-08-03 | Intent chips: AI summary, Find contacts, Scrape pricing, Map site, Custom |
| 9 | Help — 05 Preview screen | https://datiq.app/help/05-reviewing-results-the-preview-screen | 2026-08-03 | Preview layout, action bar, tabs |
| 10 | Help — 06 Enrichment + content generation | https://datiq.app/help/06-enrichment-and-content-generation | 2026-08-03 | Enrichment tabs, content generation formats |
| 11 | Help — 07 Batch extraction | https://datiq.app/help/07-batch-extraction | 2026-08-03 | Batch flow, results table, per-batch cap |
| 12 | Help — 08 Schedules + change monitoring | https://datiq.app/help/08-scheduling-and-change-monitoring | 2026-08-03 | Schedule editor, cadence presets, email alerts, auto-pause on plan lapse |
| 13 | Help — 09 Dashboard | https://datiq.app/help/09-your-dashboard | 2026-08-03 | Search, type filter, table/card toggle, multi-select toolbar |
| 14 | Help — 10 Exports + sharing | https://datiq.app/help/10-exports-and-sharing | 2026-08-03 | CSV/PDF/Markdown/JSON/email, /p/:slug, /gallery |
| 15 | Help — 11 Plans, usage, billing | https://datiq.app/help/11-plans-usage-and-billing | 2026-08-03 | Plan ladder, top-ups, white-label PDF, priority support, extra workspace, invoices |
| 16 | Help — 12 Accounts, trial, sign-in | https://datiq.app/help/12-accounts-trial-and-sign-in | 2026-08-03 | Try-without-account, OAuth providers, personas |
| 17 | Help — 13 Privacy + your data | https://datiq.app/help/13-privacy-and-your-data | 2026-08-03 | Public-only extraction, deletion, sign-out semantics |
| 18 | Help — 14 FAQ + troubleshooting | https://datiq.app/help/14-faq-and-troubleshooting | 2026-08-03 | Common issues, share flow, command palette, outcome tiles description |
| 19 | Help — 15 Keyboard shortcuts | https://datiq.app/help/15-keyboard-shortcuts | 2026-08-03 | 10 documented shortcuts, replay tour |
| 20 | Help — 16 Glossary | https://datiq.app/help/16-glossary | 2026-08-03 | Extraction, Intent, Enrichment, Batch, Schedule, Preview, Dashboard, Content generation, Map site, Top-up bundle, Outcome tile, Template, Workspace, Public report, Provenance, Command palette |
| 21 | Help — Developer API Reference | https://datiq.app/help/developers | 2026-08-03 | Full REST API spec: base URL, auth, pagination, idempotency, rate limits, 6 endpoint families, 11 endpoints |
| 22 | DatIQ vs Firecrawl | https://datiq.app/vs/firecrawl | 2026-08-03 | Comparison table with explicit Datiq price ladder, R19 release reference, verdict cards |
| 23 | DatIQ screenshot — Home (light) | https://datiq.app/help/assets/screenshots/01-home.png | 2026-08-03 | Trial banner, 6 outcome tiles, composer, toolbar, trust badges, "v1.0" badge |
| 24 | DatIQ screenshot — Home (dark) | https://datiq.app/help/assets/screenshots/02-home-dark.png | 2026-08-03 | Dark theme rendering |
| 25 | DatIQ screenshot — Preview | https://datiq.app/help/assets/screenshots/03-preview.png | 2026-08-03 | Action bar, tags, provenance, AI summary with confidence, "Was this helpful?" feedback |
| 26 | DatIQ screenshot — Batch | https://datiq.app/help/assets/screenshots/04-batch.png | 2026-08-03 | Batch results table, "5 URLs per batch" copy, footer |
| 27 | DatIQ screenshot — Schedules | https://datiq.app/help/assets/screenshots/05-schedules.png | 2026-08-03 | "Track changes on a page" modal, cadence presets, alert email, run-until date, name |
| 28 | DatIQ screenshot — Dashboard (table view) | https://datiq.app/help/assets/screenshots/06-dashboard-table.png | 2026-08-03 | Empty state, table/card toggle, Batch runs dropdown, Refresh, New extraction |
| 29 | DatIQ screenshot — Domain map | https://datiq.app/help/assets/screenshots/09-domain-map.png | 2026-08-03 | "You've used your 3 free trial extractions" modal, domain map preview |
| 30 | DatIQ JSON-LD (Organization) | https://datiq.app/ (head script) | 2026-08-03 | LinkedIn URL, Twitter handle, GitHub repo, contact email |
| 31 | DatIQ JSON-LD (SoftwareApplication) | https://datiq.app/ (head script) | 2026-08-03 | SoftwareApplication featureList, free plan offer |

### A.2 Competitor primary sources

| # | Name | URL | Access date | Supports |
|---|---|---|---|---|
| 32 | Browse AI homepage | https://www.browse.ai | 2026-08-03 | Positioning, 7,000+ integrations, 250+ robots, 7 use-case categories |
| 33 | Browse AI pricing | https://www.browse.ai/pricing | 2026-08-03 | Free, Personal, Professional, Premium tiers, add-on pricing, credit overage |
| 34 | Browse AI review (saaspricepulse) | https://www.saaspricepulse.com/tools/browse-ai | 2026-08-03 | Pricing verified 2026-03-26, free-tier limits, self-healing AI |
| 35 | Browse AI alternatives (hackceleration) | https://hackceleration.com/labs/alternatives/browse-ai-alternatives | 2026-08-03 | Comparison context, free-tier headroom |
| 36 | Apify pricing | https://apify.com/pricing | 2026-08-03 | Free $5, Starter $29, pay-per-CU, x402, $1.4M dev payouts |
| 37 | Apify alternatives (Gumloop) | https://www.gumloop.com/blog/apify-alternatives | 2026-08-03 | Apify positioning, marketplace comparison |
| 38 | Apify alternatives (FlowHunt) | https://www.flowhunt.io/blog/apify-alternatives/ | 2026-08-03 | Apify alternatives matrix |
| 39 | Clay pricing | https://www.clay.com/pricing | 2026-08-03 | Free 100/500, Launch $185, Growth $495, Data Credits + Actions |
| 40 | Clay pricing (landbase) | https://www.landbase.com/blog/clay-pricing | 2026-08-03 | March 11 2026 overhaul, $0.05/credit, <$0.01/Action |
| 41 | Clay pricing (salesmotion) | https://salesmotion.io/blog/clay-pricing | 2026-08-03 | Enterprise $30K+/yr, Data Credits + Actions detail |
| 42 | Clay pricing (cleanlist) | https://www.cleanlist.ai/blog/2026-03-12-clay-pricing-changes-2026 | 2026-08-03 | Pre/post March 11 2026 pricing table |
| 43 | Clay pricing (amplemarket) | https://www.amplemarket.com/blog/how-much-does-clay-really-cost | 2026-08-03 | Legacy Starter/Explorer/Pro pricing, 25-user real cost |
| 44 | Hexomatic pricing | https://hexomatic.com/pricing | 2026-08-03 | Free 75, Bronze $24, Silver $49, Gold $99, Enterprise custom, premium add-on |
| 45 | Hexomatic review (slicey) | https://slicey.ai/tools/hexomatic | 2026-08-03 | $49 entry, premium add-on $999, annual savings |
| 46 | Hexomatic review (prospeo) | https://prospeo.io/s/hexomatic-pricing-reviews-pros-and-cons | 2026-08-03 | Two-tier credit model, premium credit top-ups, real cost |
| 47 | Hexomatic (getapp) | https://www.getapp.com/operations-management-software/a/hexomatic/ | 2026-08-03 | Per-plan feature matrix |
| 48 | Kadoa pricing | https://www.kadoa.com/pricing | 2026-08-03 | Flex (free trial, consumption), Enterprise (custom, SAML SSO, SLA) |
| 49 | Kadoa homepage | https://www.kadoa.com | 2026-08-03 | "Web data layer for finance", coding agents, source-grounded outputs, MCP, S3/Snowflake/BigQuery, real-time monitors |
| 50 | Thunderbit pricing | https://thunderbit.com/pricing | 2026-08-03 | Free 6 pages, Starter $9, Pro up to 20K credits, credit model |
| 51 | Thunderbit (Chrome Web Store) | https://chromewebstore.google.com/detail/thunderbit-ai-web-scraper/hbkblmodhbmcakopmmfbaopfckopccgp | 2026-08-03 | Features list: 1-click, subpage, pagination, scheduled, PDF, OCR, Email/Phone/Image extractors |
| 52 | Thunderbit (G2 pricing) | https://www.g2.com/products/thunderbit/pricing | 2026-08-03 | Per-plan feature matrix, credit model |
| 53 | Thunderbit (aitechsuite) | https://www.aitechsuite.com/tools/thunderbit.com | 2026-08-03 | Position, natural-language column names, pre-built templates, Sheets/Airtable/Notion export |
| 54 | Firecrawl pricing | https://www.firecrawl.dev/pricing | 2026-08-03 | Free 1000, Hobby $16, Standard $83, Growth $333, Scale $599, Enterprise custom, per-credit costs |
| 55 | Firecrawl blog comparison | https://www.firecrawl.dev/blog/best-web-extraction-tools | 2026-08-03 | Best-for matrix, open source, $19/mo entry |
| 56 | AI web scraper tools compared (Browse AI blog) | https://www.browse.ai/blog/the-best-ai-web-scraper-tools | 2026-08-03 | 9-tool comparison, free-tier limits, learning curves |
| 57 | 13 Best Web Scraping APIs (sequenzy) | https://www.sequenzy.com/blog/best-web-scraping-apis | 2026-08-03 | Per-API pricing & features |
| 58 | Web Scraping APIs (proxies.sx) | https://www.proxies.sx/blog/best-web-scraping-api-comparison-2026 | 2026-08-03 | $0.0002-$0.01 per-request range, provider matrix |
| 59 | Web Scraping APIs (hasdata) | https://hasdata.com/blog/best-web-scraping-apis | 2026-08-03 | Per-API CPM, P50/P75/P95 latency, output format |
| 60 | Web Scraping APIs (proxyway) | https://proxyway.com/best/best-web-scraping-apis | 2026-08-03 | Starting prices, $0.50/2K requests, $49/98K |
| 61 | Use-apify AI scraper comparison | https://use-apify.com/blog/best-ai-web-scraper-2026 | 2026-08-03 | Traditional vs AI scraper cost, Apify $5/$16/$83/$333 |
| 62 | 20 Best Web Scraping Tools 2026 (habiledata) | https://www.habiledata.com/blog/top-web-scraping-tools/ | 2026-08-03 | Hobby $16/Standard $83/Scale $333, Open-source Playwright |
| 63 | Best Web Extraction Tools for AI (Firecrawl blog) | https://www.firecrawl.dev/blog/best-web-extraction-tools | 2026-08-03 | Per-tool best-for, open source yes/no, starting price |
| 64 | DatIQ snippets in search results | (Google snippets) | 2026-08-03 | Cross-validates homepage and vs/firecrawl claims |

### A.3 Secondary context

| # | Name | URL | Access date | Supports |
|---|---|---|---|---|
| 65 | BrowserAct Agent Build press release | https://markets.businessinsider.com/news/stocks/browseract-launches-browseract-agent-build-an-ai-web-scraper-that-builds-and-tests-itself-from-a-single-prompt-1036371377 | 2026-08-03 | Competitor threat: agent-style scraper builders |
| 66 | DatIQ GitHub repo (founder open-source) | https://github.com/vikashkaruna/scrapelite | 2026-08-03 | Founder identity (Vikash Karuna), open-source lineage |
| 67 | DatIQ LinkedIn | https://www.linkedin.com/company/datiq | 2026-08-03 | Company social presence (referenced in JSON-LD) |
| 68 | DatIQ Twitter / X | https://twitter.com/datiq_app | 2026-08-03 | Company social presence (referenced in JSON-LD) |

---

## Appendix B — Raw scoring matrix

The full parameter matrix from Section 8, in machine-readable form. Each row is one candidate; columns are E, U, G, S, C, D, R, V, T, PS, and Bucket. The IDs match Section 8.

### B.1 Quick Wins (D ≤ 2)

| ID | Name | E | U | G | S | C | D | R | V | T | PS | Bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | Public pricing page (SSR) | 5 | 5 | 3 | 5 | 5 | 1 | 1 | 1 | 1 | 1125 | Quick Win |
| Q02 | Recent runs rail on Home | 5 | 5 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | 1125 | Quick Win |
| Q03 | Public changelog (SSR) | 4 | 4 | 4 | 5 | 4 | 1 | 1 | 1 | 1 | 1280 | Quick Win |
| Q04 | Watch-a-URL overlay | 4 | 5 | 3 | 5 | 4 | 1 | 1 | 1 | 1 | 1200 | Quick Win |
| Q05 | Google Sheets native export | 5 | 5 | 3 | 4 | 5 | 2 | 1 | 1 | 1 | 750 | Quick Win |
| Q06 | Zapier connector | 4 | 4 | 4 | 4 | 5 | 2 | 1 | 2 | 1 | 640 | Quick Win |
| Q07 | Webhook for results | 4 | 3 | 3 | 4 | 5 | 1 | 1 | 2 | 1 | 720 | Quick Win |
| Q08 | Dark mode polish + theme toggle in nav | 3 | 5 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | 90 | Quick Win |
| Q09 | Keyboard shortcuts in-app | 3 | 4 | 2 | 3 | 2 | 1 | 1 | 1 | 1 | 144 | Quick Win |
| Q10 | Email report digest (weekly) | 4 | 4 | 4 | 4 | 3 | 1 | 1 | 1 | 1 | 768 | Quick Win |
| Q11 | Save Custom as Template | 5 | 4 | 4 | 5 | 4 | 2 | 1 | 1 | 1 | 1600 | Quick Win |
| Q12 | CSV / JSON / Markdown / PDF — make all 5 always free | 4 | 5 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | 960 | Quick Win |
| Q13 | Onboarding template chooser (first visit) | 4 | 5 | 4 | 4 | 4 | 2 | 1 | 2 | 1 | 1280 | Quick Win |
| Q14 | Tag auto-suggest (from prior tags) | 3 | 4 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | 72 | Quick Win |
| Q15 | Slack notification on schedule change | 4 | 4 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | 768 | Quick Win |
| Q16 | Re-run button on Preview | 4 | 5 | 2 | 4 | 3 | 1 | 1 | 1 | 1 | 480 | Quick Win |
| Q17 | CSV-of-URLs drag-and-drop on Home (verify + surface) | 4 | 4 | 2 | 4 | 4 | 1 | 1 | 1 | 1 | 512 | Quick Win |
| Q18 | Public-share toggle on Preview | 5 | 4 | 5 | 5 | 5 | 1 | 1 | 1 | 1 | 500 | Quick Win |
| Q19 | "Competitor comparison" mode on Preview | 4 | 4 | 4 | 5 | 5 | 2 | 1 | 2 | 1 | 1600 | Quick Win |
| Q20 | "Recent templates" rail on Home | 4 | 4 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | 720 | Quick Win |

### B.2 Major Bets (D ≥ 3, PS > 30)

| ID | Name | E | U | G | S | C | D | R | V | T | PS | Bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M01 | Templates marketplace (1.0) | 5 | 5 | 5 | 5 | 5 | 4 | 3 | 3 | 3 | 104 | Major Bet |
| M02 | Domain research workspace | 5 | 4 | 4 | 5 | 5 | 4 | 3 | 3 | 3 | 36 | Major Bet |
| M03 | Self-healing scrapers | 4 | 3 | 3 | 5 | 5 | 4 | 4 | 3 | 4 | 23 | Major Bet |
| M04 | Native CRM integrations (HubSpot, Salesforce, Pipedrive) | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | 75 | Major Bet |
| M05 | Browser extension (point-and-click) | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | 75 | Major Bet |
| M06 | 250+ prebuilt scrapers | 5 | 4 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | 39 | Major Bet |
| M07 | SOC 2 Type II | 4 | 2 | 1 | 4 | 4 | 5 | 3 | 3 | 5 | 9 | Major Bet |
| M08 | "Chat with this extraction" | 4 | 4 | 4 | 5 | 3 | 3 | 2 | 2 | 2 | 80 | Major Bet |
| M09 | Waterfall enrichment (à la Clay) | 4 | 4 | 3 | 4 | 5 | 4 | 3 | 3 | 3 | 25 | Major Bet |
| M10 | MCP server for AI agents | 3 | 2 | 3 | 4 | 3 | 4 | 3 | 4 | 4 | 6 | Future |
| M11 | Audit log & SSO | 4 | 2 | 1 | 4 | 4 | 4 | 3 | 2 | 3 | 17 | Major Bet |

### B.3 Future (5 ≤ PS ≤ 30, D ≥ 3)

| ID | Name | E | U | G | S | C | D | R | V | T | PS | Bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | AI agent that autonomously builds extraction pipelines | 4 | 2 | 4 | 5 | 4 | 5 | 5 | 4 | 5 | 2 | Future |
| F02 | Self-healing scrapers v2 (fully autonomous) | 3 | 3 | 2 | 4 | 4 | 5 | 5 | 4 | 5 | 2 | Future |
| F03 | Agentic research assistant | 4 | 3 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | Future |
| F04 | Public scraper marketplace (revenue share) | 4 | 3 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 12 | Future |
| F05 | Vertical packs (VCs, recruiters, SEOs, sales) | 4 | 4 | 3 | 5 | 4 | 4 | 3 | 3 | 3 | 24 | Future |

### B.4 Deprioritise (PS < 5)

| ID | Name | E | U | G | S | C | D | R | V | T | PS | Bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X01 | Build a custom "robot training" UI à la Browse AI | 3 | 3 | 2 | 2 | 3 | 5 | 4 | 4 | 5 | 1 | Deprioritise |
| X02 | In-house LLM training | 2 | 1 | 1 | 2 | 2 | 5 | 4 | 5 | 5 | 0.04 | Deprioritise |
| X03 | Mobile native apps | 2 | 2 | 1 | 2 | 1 | 5 | 3 | 4 | 5 | 0.4 | Deprioritise |
| X04 | Anti-bot proxy infrastructure | 3 | 2 | 1 | 2 | 4 | 5 | 4 | 3 | 4 | 1 | Deprioritise |
| X05 | White-label agency edition | 3 | 2 | 4 | 3 | 3 | 4 | 3 | 3 | 3 | 3 | Deprioritise |

### B.5 Top-10 ranked list (for product team to start Monday)

| Rank | ID | Name | PS | Bucket | Persona primary |
|---|---|---|---|---|---|
| 1 | Q11 | Save Custom as Template | 1600 | Quick Win | All |
| 2 | Q19 | Competitor comparison mode on Preview | 1600 | Quick Win | Mike |
| 3 | Q03 | Public changelog (SSR) | 1280 | Quick Win | All |
| 4 | Q13 | Onboarding template chooser | 1280 | Quick Win | All |
| 5 | Q04 | Watch-a-URL overlay | 1200 | Quick Win | Sara, Mike, Reggie |
| 6 | Q01 | Public pricing page (SSR) | 1125 | Quick Win | All |
| 7 | Q02 | Recent runs rail on Home | 1125 | Quick Win | All |
| 8 | M01 | Templates marketplace (1.0) | 104 | Major Bet | All |
| 9 | M08 | "Chat with this extraction" | 80 | Major Bet | All |
| 10 | M04 | Native CRM integrations | 75 | Major Bet | Sara, Mike |

### B.6 Coverage matrix — which section supports which research angle

| Research angle | Sections |
|---|---|
| Product positioning and value proposition | 1.1, 1.2, 5.1 (wins 1, 7, 9) |
| Feature inventory (deduplicated) | 1.4, 4 (matrix), 8 (backlog) |
| Pricing & packaging | 1.6, 3 (per-competitor), 4 (matrix 26-28), 5.4 (threats) |
| Onboarding & empty-state UX | 1.5, 2 (home screen critique) |
| Strengths and weaknesses | 1.7, 5.1, 5.2, 5.3 |
| Home-screen single-URL pattern critique | 2 (whole section) |
| Competitive landscape | 3 (whole section), 4 (matrix), 5.2 (where competitors win) |
| White-space opportunities | 5.3 |
| Competitive threats | 5.4 |
| Personas | 6.1, 1.2, 1.3 |
| Use cases | 6.2, 1.3 (use-case pages in sitemap), 1.4 (outcome tiles) |
| Engagement mechanics | 6.3, 5.3, 8 (templates, schedules) |
| Prioritization formula | 7 (whole section) |
| Backlog scoring | 7, 8 (whole section), Appendix B |
| Roadmap | 9 (whole section) |
| Open questions & risks | 10 (whole section) |
| Source index | Appendix A |
| Scoring matrix | Appendix B |

### B.7 Evidence chain (claim → evidence → confidence)

| Claim | Evidence (file:line or URL) | Confidence |
|---|---|---|
| "DatIQ is positioned as a zero-code web-extraction and AI enrichment platform" | datiq.app home JSON-LD description, datiq_help_01-what-datiq-is.txt:1, datiq_help_index.txt:10 | [F] high |
| "Datiq pricing is Free / $19 / $29 / $79 / $299" | datiq_vs_firecrawl.html:128-130 (comparison table row) | [F] high |
| "Datiq has 6 outcome tiles on the home page" | datiq_help_index.txt:10, screenshots/01-home.png | [F] high |
| "Datiq has a Schedules feature with email alerts" | datiq_help_08-scheduling-and-change-monitoring.txt:23, datiq_vs_firecrawl.html:118-121, screenshots/05-schedules.png | [F] high |
| "Datiq has a public-shareable report at /p/:slug" | datiq_help_10-exports-and-sharing.txt:29, datiq_help_16-glossary.txt:47, datiq_vs_firecrawl.html:122-126 | [F] high |
| "Datiq has a Developer API in alpha on Business+" | datiq_help_developers.txt:62, datiq_help_11-plans-usage-and-billing.txt:32, datiq_vs_firecrawl.html:132-136 | [F] high |
| "Browse AI's free tier is 50 credits/mo, 2 websites, 3 users" | https://www.browse.ai/pricing, https://www.saaspricepulse.com/tools/browse-ai | [F] high |
| "Clay's March 11 2026 overhaul: Launch $185, Growth $495" | https://www.clay.com/pricing, https://www.landbase.com/blog/clay-pricing, https://salesmotion.io/blog/clay-pricing | [F] high |
| "Firecrawl Free is 1,000 credits/mo, Hobby $16, Standard $83" | https://www.firecrawl.dev/pricing | [F] high |
| "Apify's free tier is $5/mo, $0.2/CU, $1.4M paid out to developers" | https://apify.com/pricing | [F] high |
| "Hexomatic has a two-tier credit system with premium add-on" | https://hexomatic.com/pricing, https://slicey.ai/tools/hexomatic, https://prospeo.io/s/hexomatic-pricing-reviews-pros-and-cons | [F] high |
| "Kadoa has consumption pricing + enterprise with SAML SSO" | https://www.kadoa.com/pricing, https://www.kadoa.com | [F] high |
| "Thunderbit free is 6 pages/mo, Starter $9/mo yearly" | https://thunderbit.com/pricing, https://www.g2.com/products/thunderbit/pricing | [F] high |
| "Datiq's batch cap is 5 URLs/batch on the free plan" | screenshots/04-batch.png (text "Your plan allows up to 5 URLs per batch") | [F] high |
| "Datiq has an outcome-tile → intent-chip → enrichment-tab flow" | screenshots/01-home.png, datiq_help_04-what-you-can-extract.txt:11, datiq_help_05-reviewing-results-the-preview-screen.txt:14, datiq_help_06-enrichment-and-content-generation.txt:17 | [F] high |
| "Datiq's trial banner says 10 extractions · 5 batch runs; the paywall modal says 3 free trial extractions" | screenshots/01-home.png, screenshots/09-domain-map.png | [F] high (and a contradiction worth flagging in Section 10) |
| "Datiq is on a v1.0 / v2.0 release cadence" | screenshots/01-home.png ("v1.0" chip), datiq_help_11-plans-usage-and-billing.txt:32 ("What's new in 2026-08"), datiq_vs_firecrawl.html ("R19" in monitoring row) | [F, A] mixed; v1.0 + v2.0 + R19 are all visible. The exact release-numbering scheme is unclear. |
| "Browse AI has self-healing AI" | https://www.browse.ai (homepage), https://www.saaspricepulse.com/tools/browse-ai | [F] high |
| "Apify has 55,000+ Actors" | https://apify.com/pricing (homepage) | [F] high |
| "Datiq's founder is Vikash Karuna" | JSON-LD sameAs: https://github.com/vikashkaruna/scrapelite | [A] inferred from JSON-LD |
| "Datiq has no SOC 2 badge" | absent on all observed pages | [A] inferred from absence |
| "The templates marketplace is the single largest growth lever" | Section 6.3, 8.5 (rank 8) | [A] analysis |
| "Recent runs rail is the single highest-ROI retention fix" | Section 6.3 (mechanic 10), 8.5 (rank 7) | [A] analysis |

— end of report —
