# Manual Test Plan — DatIQ Intelligence Workflows (Phases 0–7 Complete & Shipped)

> **Covers:** PRD 1 (Workflow Templates & Guided Onboarding), PRD 2 (Shareable Intelligence Reports),
> PRD 3 (Bulk Account Intelligence & Activation Funnel), PRD 4 (Competitor Watchlists & Change Intelligence),
> PRD 5 (Native Signal Routing), Workflow Run History Modal, Smart Company Resolver, and Integration Recipes.
> **Source Plan:** `docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md` (derived from `DatIQ - Persona Specific Templates & Shareable Reports.pdf`).
> **Status:** ALL PHASES (0–7) SHIPPED. Updated **2026-09-06**.
> **Automated coverage:** unit 3 016 · contract 2 006 · integration 432 · db 463+17+56 · e2e smoke 142.
> This document covers the interactive checks that static mocks cannot assert.
>
> 👉 **Run `POST-DEPLOYMENT-MANUAL-TEST.md` first.** It is the shorter, ordered pass to run
> immediately after a deploy (M1–M3 and the n8n T1–T6), and it says which of the checks below
> are the 🔴 priority subset if you do not have time for all 158. This document remains the
> exhaustive per-feature reference.
>
> ⚠️ **Two things below are known to be verified against synthetic fixtures only:** `/workflows`
> has never run against a populated account, and the `EVENT_TO_SOURCE` routing fix is reasoned
> from the schema and pinned by test rather than observed firing. Both are M2/M3 in the
> post-deployment doc.

---

## Document Roadmap & Table of Contents

- [§0 — Preconditions & Environments](#0--preconditions--environments)
- [§1 — Persona, Scenario & Use-Case Strategic Matrix](#1--persona-scenario--use-case-strategic-matrix)
- [§2 — Templates Catalogue (`/templates`)](#2--templates-catalogue-templates)
- [§3 — Smart Company Entry & Domain Resolver](#3--smart-company-entry--domain-resolver)
- [§4 — Template Runners: Comprehensive Per-Template Test Suites](#4--template-runners-comprehensive-per-template-test-suites)
  - [4.1 Sales-ready Account Brief (`account_brief`)](#41-sales-ready-account-brief-account_brief)
  - [4.2 Competitor Pricing Tracker (`competitor_pricing_tracker`)](#42-competitor-pricing-tracker-competitor_pricing_tracker)
  - [4.3 SEO / GEO / AEO Audit Hand-off (`discoverability_audit`)](#43-seo--geo--aeo-audit-hand-off-discoverability_audit)
  - [4.4 Pre-Meeting Due Diligence Brief (`due_diligence_brief`)](#44-pre-meeting-due-diligence-brief-due_diligence_brief)
  - [4.5 Customer Proof Extractor (`customer_proof_extractor`)](#45-customer-proof-extractor-customer_proof_extractor)
  - [4.6 AI Visibility & Competitive Brief (`ai_visibility_brief`)](#46-ai-visibility--competitive-brief-ai_visibility_brief)
  - [4.7 Bulk ICP Enrichment Runner (`bulk_icp_enrichment`)](#47-bulk-icp-enrichment-runner-bulk_icp_enrichment)
- [§5 — Runs, Credits & Append-Only Ledger](#5--runs-credits--append-only-ledger)
- [§6 — Workflow Run History & Detail Modal (`/dashboard?view=runs` & `/account`)](#6--workflow-run-history--detail-modal-dashboardviewruns--account)
- [§7 — Shareable Intelligence Reports & State Machine (`/r/:slug`)](#7--shareable-intelligence-reports--state-machine-rslug)
- [§8 — Integration Recipe Gallery (`/integrations`)](#8--integration-recipe-gallery-integrations)
- [§9 — Activation & PQL Founder Funnel (`/admin/revenue`)](#9--activation--pql-founder-funnel-adminrevenue)
- [§10 — Entitlements & Plan Packaging Enforcement](#10--entitlements--plan-packaging-enforcement)
- [§11 — Regression Sweep: Neighbouring Modules](#11--regression-sweep-neighbouring-modules)
- [§12 — Phase 4: Bulk Account Intelligence (`/lists`)](#12--phase-4-bulk-account-intelligence-lists)
- [§13 — Phase 5: Competitor Watchlists & Change Intelligence (`/watchlists`)](#13--phase-5-competitor-watchlists--change-intelligence-watchlists)
- [§14 — Phase 6: Native Signal Routing (`/rules`)](#14--phase-6-native-signal-routing-rules)
- [§15 — Phase 7: Packaging, Navigation & Staging Gate Verification](#15--phase-7-packaging-navigation--staging-gate-verification)
- [§16 — SQL Data Integrity Sweep](#16--sql-data-integrity-sweep)
- [§17 — Staging Promotion & Production Deployment Guide](#17--staging-promotion--production-deployment-guide)

---

## §0 — Preconditions & Environments

### 0.1 Migrations State
The database must have migrations `0001` through `0043` applied:
- `0036_workflow_templates.sql` — versioned template catalog, `template_runs`, `template_run_sources`
- `0037_credit_ledger.sql` — append-only ledger (`credit_ledger`), estimate drift tracking (`credit_estimates`)
- `0038_field_provenance.sql` — field-level provenance (`extracted_fields`, `field_provenance`)
- `0039_report_access.sql` — shareable reports (`reports`, `report_grants`, `report_access_log`)
- `0040_pql.sql` — product qualified lead scoring (`pql_scores`, `activation_events`)
- `0041_bulk_enrichment.sql` — lists, canonical entities, list records, ICP rules, chunked enrichment jobs, review queue (7 tables)
- `0042_watchlists.sql` — competitor watchlists, targets, monitored pages, field snapshots, field changes, feedback (6 tables)
- `0043_signal_rules.sql` — native routing rules, condition evaluators, execution audit log (2 tables)

### 0.2 Testing Environments
1. **Local Full Stack**: `nvm use 24 && netlify dev` (serves frontend on port 8888, proxies Netlify functions).
2. **Staging**: `https://staging--datiqapp.netlify.app` (deploy `6a9a2b6ad676f30008224cd9`, Netlify Edge Access SSO).
3. **Production**: `https://datiq.app` (live site on main).

### 0.3 Test Accounts Required
- **Account A (Guest / Signed Out)**: Used to verify public catalogue reachability, guest execution toast, and sign-up modal triggers.
- **Account B (Free Plan)**: Used to verify baseline template execution, credit allowance limits, report publishing, and attribution branding enforcement ("Made with DatIQ").
- **Account C (Business or Agency Plan)**: Used to verify custom Brand Kit attribution replacement, bulk enrichment priority processing, and multi-seat sharing.
- **Account D (Secondary Collaborator Account)**: Used to verify named collaborator grants and org-level access controls.

---

## §1 — Persona, Scenario & Use-Case Strategic Matrix

DatIQ translates raw web scraping into structured economic outcomes. The matrix below defines the exact business scenarios, personas, triggers, and deliverables for each implemented workflow:

| Persona | Workflow / Subsystem | Trigger / Scenario | Input Required | Delivered Outcome & Differentiators | Commercial / Economic Value |
|---|---|---|---|---|---|
| **Sales / SDR / BDR** | `account_brief`<br>*(Sales-ready Account Brief)* | 15 mins before a cold outreach or discovery call; researching an inbound target account | Company domain (e.g. `stripe.com`) + Outreach angle (`discovery`, `displacement`, `expansion`) | 1-paragraph summary, structured account facts (HQ, size, pricing model), 3 concrete conversation openers cited from site evidence, leadership contacts. | Saves 30–45 mins of manual browsing per account; eliminates generic flattery; increases outreach reply rates by citing real site claims. |
| **Competitive Intelligence** | `competitor_pricing_tracker`<br>*(Competitor Pricing Tracker)* | Competitor announces repackaging, or quarterly pricing review across market landscape | Competitor domain (`notion.so`) + optional explicit pricing URL | Structured tier table (names, prices, billing periods, seat rules, limits), free tier presence, enterprise gating, packaging strategy signals. | Eliminates manual copy-pasting of pricing matrices; establishes a baseline snapshot for historical diffing and pricing battlecards. |
| **SEO / Content Marketer** | `discoverability_audit`<br>*(SEO / GEO / AEO Audit)* | Client content audit; assessing visibility in AI search engines (Perplexity, ChatGPT Search, Google SGE) | Target page URL (`https://example.com/pricing`) + Lens (`balanced`, `seo`, `aeo`, `geo`) | Direct hand-off to `/discoverability` module: 4-pillar scores (Classic SEO, Content Quality, AI Discoverability, Performance), prioritized fix queue. | Turns a routine crawl into actionable recommendations; identifies whether AI answer engines can cite the brand's pages. |
| **Startup Founder / VC / Analyst** | `due_diligence_brief`<br>*(Pre-Meeting Due Diligence Brief)* | Prepping for a founder pitch, partnership discussion, or preliminary investment screening | Company domain (`linear.app`) + Meeting focus (`intro`, `diligence`, `partnership`) | "Before you walk in" brief, claimed vs evidenced traction, open roles indicating investment areas, 4 tailored questions to ask. | Protects investor/founder time; separates marketing claims from verifiable facts; avoids entering meetings with information blind spots. |
| **Product Marketing Manager (PMM)** | `customer_proof_extractor`<br>*(Customer Proof Extractor)* | Building sales battlecards; competitive displacement campaign; refreshing customer proof library | Competitor domain (`vercel.com`) | Structured customer proof table (named customer, industry, quantified outcome like "40% faster", source quote), named logo list. | Collects verified proof points in under 60 seconds; feeds win-loss programs; prevents sales reps from citing fabricated or unverified claims. |
| **PMM / Executive / CI** | `ai_visibility_brief`<br>*(AI Visibility & Competitive Brief)* | Strategic positioning review; board deck prep; understanding how AI answer engines perceive your brand vs rivals | Your domain + Up to 4 competitor domains + Audience focus (`gtm`, `founder`, `marketing`) | Side-by-side like-for-like comparison grid across category, target buyer, pricing, headline differentiator, strongest proof point; "What to change first" action list. | DatIQ's flagship positioning asset: evaluates how answer engines represent the company vs competitors; highlights empty claims ("not stated"). |
| **RevOps / Growth Marketer** | **Bulk Account Intelligence**<br>*(PRD 3 / `/lists`)* | Ingesting event attendee lead lists, CSV cold account tiers, or territory assignment lists | CSV upload or pasted domains (up to 500 domains) | Chunked background enrichment, domain deduplication preview, normalized canonical entities, weighted ICP fit scores with §1.6 coverage rule, Human Review Queue for low-confidence contacts. | Automates days of manual firmographic qualification; flags accounts that fail ICP criteria before reps waste time calling them; redistributes unmeasured weights so accounts are never unfairly scored 0. |
| **CI / Product Leadership** | **Competitor Watchlists**<br>*(PRD 4 / `/watchlists`)* | Continuous market monitoring without manual bookmarking or alert noise fatigue | Competitor domains (e.g. `supabase.com`, `neon.tech`) | Auto-discovery of pricing/product/positioning pages, deterministic materiality classification (Critical, High, Medium, Low), strict structural separation of objective Fact vs AI Strategic Interpretation, and relevance feedback loops. | Eliminates 95% of alert noise from cosmetic HTML updates; alerts GTM leadership within minutes when a rival drops prices or introduces enterprise gates; provides defensible, cited diffs. |
| **RevOps / Sales Operations** | **Native Signal Routing**<br>*(PRD 5 / `/rules`)* | Automating downstream handoffs when high-value signals or target qualification events occur | Trigger events + Condition criteria + Target action channels | If-this-then-that rule engine routing ICP 80+ accounts to HubSpot, sending instant Slack alerts on competitor pricing drops, dispatching webhook events, or emailing SDR leads. Full interactive Rule Evaluation Sandbox. | Connects intelligence directly to revenue execution systems without third-party integration friction; guarantees sub-second event evaluation; provides an audit log for every execution. |

---

## §2 — Templates Catalogue (`/templates`)

### 2.1 Navigation & Public Reachability
- [ ] **2.1.1** 🟠 Main nav renders **Templates** between *Extract* and *Discover*.
      ✅ Expect: Nav order is **Extract · Templates · Discover · Dashboard**.
- [ ] **2.1.2** 🟠 Click **Templates** → URL navigates to `/templates`, and the nav item is marked active.
- [ ] **2.1.3** 🔴 Open `/templates` in a signed-out / incognito browser window.
      ✅ Expect: The catalogue loads immediately without demanding authentication. (Public acquisition surface per PRD 1).
- [ ] **2.1.4** 🟡 Inspect browser tab title:
      ✅ Expect: *"Workflow templates — turn a URL into finished work | DatIQ"*.

### 2.2 Catalogue Content & Cards Display
- [ ] **2.2.1** 🔴 Exactly **SIX** template cards are rendered in the catalogue:
      1. Sales-ready Account Brief (`account_brief`)
      2. Competitor Pricing Tracker (`competitor_pricing_tracker`)
      3. SEO / GEO / AEO Audit (`discoverability_audit`)
      4. Pre-Meeting Due Diligence Brief (`due_diligence_brief`)
      5. Customer Proof Extractor (`customer_proof_extractor`)
      6. AI Visibility & Competitive Brief (`ai_visibility_brief`)
- [ ] **2.2.2** 🔴 **`bulk_icp_enrichment` MUST NOT be visible.**
      ✅ Expect: Absent from the catalogue (its status is strictly `draft` pending Phase 4's durable runner).
- [ ] **2.2.3** 🟠 Each template card displays: Title, Persona badge, 1-2 sentence Summary, and "Run this →" CTA.
- [ ] **2.2.4** 🔴 Inspect DevTools → Network → `GET /api/templates` JSON response.
      ✅ Expect: **`prompt_bundle` is completely absent** from the listing response. (Prompts must not leak in public catalogues).

### 2.3 Persona Filtering Chips
- [ ] **2.3.1** 🟠 Persona filter chips appear: **All roles**, **Sales / SDR / BDR**, **Competitive Intelligence**, **SEO / Content Marketer**, **Startup Founder / VC**.
      ✅ Expect: No filter chip rendered for personas that currently have zero published templates.
- [ ] **2.3.2** 🟠 Click **Sales / SDR / BDR** → Grid filters to exactly 1 card: *Sales-ready Account Brief*.
- [ ] **2.3.3** 🟠 Click **Competitive Intelligence** → Grid filters to exactly 3 cards: *Competitor Pricing Tracker*, *Customer Proof Extractor*, *AI Visibility & Competitive Brief*.
- [ ] **2.3.4** 🟠 Click **SEO / Content Marketer** → Grid filters to exactly 1 card: *SEO / GEO / AEO Audit*.
- [ ] **2.3.5** 🟠 Click **Startup Founder / VC** → Grid filters to exactly 1 card: *Pre-Meeting Due Diligence Brief*.
- [ ] **2.3.6** 🟠 Click **All roles** → All 6 published cards return.
- [ ] **2.3.7** 🟡 When signed in as a user with a preset persona, that persona chip is pre-selected on first page load.

---

## §3 — Smart Company Entry & Domain Resolver

The Smart Company Resolver (`companyResolver.js` & `DomainField`) allows users to type either a domain or a natural company name.

### 3.1 Direct Domain Input (Bypass Path)
- [ ] **3.1.1** 🟠 Open any single-domain template (e.g. `account_brief`).
- [ ] **3.1.2** 🟠 Type a clean domain: `stripe.com` and press Enter or Tab (blur).
      ✅ Expect: No company lookup spinner is shown; `suggestion` box remains null; the input value remains `stripe.com`.

### 3.2 Company Name Fuzzy Resolution
- [ ] **3.2.1** 🟠 In the Company domain input, type a plain brand name: `Protean` (or `Stripe` or `Linear`).
- [ ] **3.2.2** 🟠 Press `Enter` or click outside the input field (`blur`).
      ✅ Expect:
      1. Network tab records `GET /api/resolve-company?q=Protean`.
      2. Inline spinner shows *"Looking up…"*.
      3. A suggestion banner appears below the input:
         - Green/blue icon.
         - Text: *"Found: proteantech.in — Protean eGov Technologies"* (or verified best guess).
         - Buttons: **"Use this"** and **"Ignore"**.
- [ ] **3.2.3** 🟠 Click **"Use this"**.
      ✅ Expect: The input field text is replaced with the resolved domain (`proteantech.in`); the suggestion box dismisses cleanly.
- [ ] **3.2.4** 🟠 Type `Acme Example Nonexistent Widget Corporation 123456` and blur.
      ✅ Expect: Suggestion box does not appear; helper text shows: *"Couldn't find a domain for that name — type it directly (for example acme.com)."*
- [ ] **3.2.5** 🔴 Verify lookup does NOT trigger while typing keystroke-by-keystroke.
      ✅ Expect: Lookup ONLY triggers on explicit commit (Enter key or Blur). Typing characters does not fire debounced requests.

---

## §4 — Template Runners: Comprehensive Per-Template Test Suites

### 4.1 Sales-ready Account Brief (`account_brief`)
- **Persona**: Sales / SDR / BDR | **Credits**: ~8 credits (1 setup, 3 pages, 2 AI calls)
- [ ] **4.1.1** 🟠 Open `/templates?key=account_brief`. Form renders two fields:
      - *Company domain* (text, required, marked with `*`)
      - *Outreach angle* (select dropdown: `Discovery call`, `Displacing an incumbent`, `Expansion / upsell`)
- [ ] **4.1.2** 🔴 Submit with empty domain → Inline error: *"Company domain is required"*. No network call is made.
- [ ] **4.1.3** 🔴 Verify credit estimate line before run:
      ✅ Expect: *"8 credits — 1 × Workflow setup, 3 × Pages fetched, 2 × AI analysis"*.
- [ ] **4.1.4** 🟠 Enter `stripe.com`, select angle `Displacing an incumbent`, click **Run this template**.
      ✅ Expect: Progress bar advances (*"Starting…" → "Reading the page…" → "Structuring what we found…" → "Done"*).
- [ ] **4.1.5** 🔴 Verify Output Structure:
      - **Summary**: 4-sentence overview of what Stripe does, target buyer, revenue model, displacement angle.
      - **Disclaimer**: *"Written by AI from the extracted facts below."*
      - **Talking Points**: 3 bulleted conversation openers citing specific facts.
      - **Extracted Facts**: Structured facts card displaying identity, firmographics, commercial model, leadership.
      - **Sources**: List of fetched URLs with timestamps (e.g. `https://stripe.com · read 03/09/2026`).
      - **Action**: **"Create shareable report"** button is visible.

### 4.2 Competitor Pricing Tracker (`competitor_pricing_tracker`)
- **Persona**: Competitive Intelligence | **Credits**: ~7 credits (1 setup, 2 pages, 2 AI calls)
- [ ] **4.2.1** 🟠 Open `/templates?key=competitor_pricing_tracker`. Form renders:
      - *Competitor domain* (text, required, placeholder `notion.so`)
      - *Pricing page URL* (optional URL field, help text: *"Leave blank and we'll find it from their site."*)
- [ ] **4.2.2** 🟠 Enter `notion.so` (leave pricing URL blank), click **Run this template**.
      ✅ Expect: The engine automatically navigates to and extracts the `/pricing` subpage.
- [ ] **4.2.3** 🔴 Verify Output Structure:
      - **Summary**: Analysis of Notion's packaging and monetization strategy.
      - **Tiers Table**: Grid with columns `Tier Name`, `Price`, `Billing Period`, `Seats`, `Headline Limits` (Free, Plus, Business, Enterprise).
      - **Packaging Signals**: Free tier boolean (`true`), Enterprise contact gate (`true`), feature gates.
      - **Null Handling**: Any unprinted price displays as `null` or `not stated` — never an invented price.
      - **Sources**: Direct link to `https://www.notion.so/pricing` with extraction timestamp.

### 4.3 SEO / GEO / AEO Audit Hand-off (`discoverability_audit`)
- **Persona**: SEO / Content Marketer | **Cost**: Uses monthly audit quota, 0 template credits.
- [ ] **4.3.1** 🔴 Open `/templates?key=discoverability_audit`.
      ✅ Expect: Credit estimate explicitly reads: **"No credits will be used."**
      Helper text explains: *"This audit runs in the Discoverability module, which has the full four-pillar engine, history and re-audit comparison."*
- [ ] **4.3.2** 🟠 Form renders:
      - *Page to audit* (URL input, required)
      - *Lens* (select: `Balanced`, `Classic search`, `Answer engines`, `Generative engines`)
- [ ] **4.3.3** 🔴 Enter `https://example.com/pricing`, select Lens `Answer engines`, click **Open in Discoverability**.
      ✅ Expect:
      1. Browser navigates to `/discoverability`.
      2. The audit URL is pre-filled with `https://example.com/pricing`.
      3. **Does NOT auto-run immediately** (prevents unintended quota consumption before user inspects settings).
      4. Zero template credits deducted.

### 4.4 Pre-Meeting Due Diligence Brief (`due_diligence_brief`)
- **Persona**: Startup Founder / VC / Analyst | **Credits**: ~9 credits (1 setup, 4 pages, 2 AI calls)
- [ ] **4.4.1** 🟠 Open `/templates?key=due_diligence_brief`. Form renders:
      - *Company domain* (text, required, placeholder `linear.app`)
      - *Meeting type* (select: `Intro call`, `Diligence deep-dive`, `Partnership`)
- [ ] **4.4.2** 🟠 Enter `linear.app`, select `Diligence deep-dive`, click **Run this template**.
- [ ] **4.4.3** 🔴 Verify Output Structure:
      - **Summary ("Before you walk in")**: Concise brief distinguishing company claims from externally evidenced proof.
      - **Company**: Founding year (if stated), core value proposition, pricing model.
      - **Team & Traction**: Stated leadership, customer logos, and hiring signals (open engineering/sales roles indicating investment areas).
      - **Questions worth asking**: 4 concrete diligence questions tailored to observations from the site.
      - **No Speculation Rule**: Verify that funding amount and valuation are NOT hallucinated if not present on site.

### 4.5 Customer Proof Extractor (`customer_proof_extractor`)
- **Persona**: Competitive Intelligence / Sales | **Credits**: ~6 credits (1 setup, 3 pages, 1 AI call)
- [ ] **4.5.1** 🟠 Open `/templates?key=customer_proof_extractor`. Form renders:
      - *Company domain* (text, required, placeholder `vercel.com`)
- [ ] **4.5.2** 🟠 Enter `vercel.com`, click **Run this template**.
- [ ] **4.5.3** 🔴 Verify Output Structure:
      - **Summary ("Who they say they win with")**: Concise breakdown of target company sizes, industries, and headline claims.
      - **Customer Proof Table**: Columns for `Customer`, `Industry`, `Quantified Outcome` (e.g. *"90% faster deployments"*), `Source`.
      - **Named Logos List**: List of verified enterprise brand names.
      - **Anti-Hallucination Assertion**: Check that generic unlabelled icons or stock vectors are NOT invented as named customers.

### 4.6 AI Visibility & Competitive Brief (`ai_visibility_brief`)
- **Persona**: Competitive Intelligence / Executive | **Credits**: Per-competitor pricing (~2 base + 3 pages + 1 AI call per company)
- [ ] **4.6.1** 🔴 Open `/templates?key=ai_visibility_brief`. Form renders:
      - *Your domain* (domain text field, required, placeholder `yourcompany.com`)
      - *Competitors (up to 4)* (multiline domain list textarea, required, placeholder `competitor-a.com, competitor-b.com`)
      - *Who is this brief for* (select: `Go-to-market team`, `Founder / exec`, `Marketing & content`)
- [ ] **4.6.2** 🔴 Submit with more than 4 competitors (e.g. 5 comma-separated domains).
      ✅ Expect: Inline validation error: *"Competitors cannot exceed 4 domains"*.
- [ ] **4.6.3** 🟠 Enter your domain: `datiq.app` and competitors: `firecrawl.dev, jina.ai`.
- [ ] **4.6.4** 🟠 Select audience: `Go-to-market team`, click **Run this template**.
      ✅ Expect: The engine reads each company site with the unified capability schema and performs synthesis.
- [ ] **4.6.5** 🔴 Verify Output Structure:
      - **Summary ("Where you stand")**: 5–7 sentences comparing positioning, target audience, and differentiation vs named rivals.
      - **"What to change first"**: 3–5 highest-leverage positioning and messaging changes, citing specific pages and competitor contrasts.
      - **Side-by-Side Comparison Table**:
        - Columns: `Company`, `Category`, `Target Customer`, `Pricing Model`, `Entry Price`, `Headline Differentiator`, `Strongest Proof Point`.
        - Your company row is highlighted with a `you` badge.
        - Missing claims explicitly display *`not stated`* in italics (not empty whitespace).
      - **Sources**: All domains crawled listed with individual timestamps.

### 4.7 Bulk ICP Enrichment Runner (`bulk_icp_enrichment`)
- **Persona**: RevOps / Growth | **Credits**: Dynamic based on domain count (1 setup + 2 per domain + 1 AI call per company)
- [ ] **4.7.1** 🟠 Navigate to `/templates?key=bulk_icp_enrichment`. Form renders:
      - *Account domains* (multiline textarea, required, placeholder `stripe.com\nlinear.app\nnotion.so`)
      - *Target Industry / Persona* (select: `B2B SaaS`, `Fintech`, `Enterprise Software`, `Custom`)
- [ ] **4.7.2** 🔴 Submit with empty domains → Inline validation: *"At least one valid domain is required"*.
- [ ] **4.7.3** 🟠 Enter test domains: `stripe.com`, `linear.app`. Verify credit estimate dynamically calculates.
- [ ] **4.7.4** 🟠 Click **Run this template** → Progress updates as chunked background runner processes items.
- [ ] **4.7.5** 🔴 Verify Output Structure:
      - **Summary**: Overall batch execution summary (processed count, qualified accounts count).
      - **Enriched Accounts Grid**: Table showing Company Name, Domain, Industry, Team Size, Pricing Model, and ICP Fit Score badge.
      - **Action**: **"View full list in Lists →"** button links to the created list in `/lists`.
- [ ] **4.7.6** 🧪 Query in Supabase:
      `select template_key, status from workflow_templates where template_key='bulk_icp_enrichment';`
      ✅ Expect: `status = 'published'`.

---

## §5 — Runs, Credits & Append-Only Ledger

### 5.1 Failure Invariant: Zero Credits Charged on Errors 🔴
- [ ] **5.1.1** Run any template with an invalid, unreachable domain: `nonexistent-domain-error-test-404xyz.com`.
      ✅ Expect: Run fails with a red toast: *"Could not reach domain — no credits were used."*
- [ ] **5.1.2** 🧪 Run query in Supabase:
      `select status, credits_actual from template_runs order by created_at desc limit 1;`
      ✅ Expect: `status = 'failed'`, `credits_actual = 0`.
- [ ] **5.1.3** 🧪 Verify credit ledger:
      `select count(*) from credit_ledger where run_id = (select id from template_runs order by created_at desc limit 1);`
      ✅ Expect: Exactly `0` rows.

### 5.2 Ledger Immutability & Balance Audit 🧪
- [ ] **5.2.1** 🔴 Run query on an existing completed run:
      `update credit_ledger set credits = 999 where id = (select id from credit_ledger limit 1);`
      ✅ Expect: Postgres triggers error: *"credit_ledger is append-only"*.
- [ ] **5.2.2** 🔴 Attempt delete:
      `delete from credit_ledger where id = (select id from credit_ledger limit 1);`
      ✅ Expect: Postgres triggers error: *"credit_ledger is append-only"*.
- [ ] **5.2.3** 🟠 Verify monthly derived balance:
      `select credit_balance('<user-uuid>'::uuid, to_char(now(), 'YYYY-MM'));`
      ✅ Expect: Returns a single integer matching the sum of ledger rows for the user this month.

---

## §6 — Workflow Run History (`/dashboard?view=runs` & `/account`)

### 6.1 Dashboard Workflow Runs View
- [ ] **6.1.1** 🟠 Navigate to `/dashboard?view=runs` as a signed-in user.
      ✅ Expect: Workflow Run History component mounts.
- [ ] **6.1.2** 🟠 Verify Stats Bar:
      - Total runs count (e.g. `12 runs`)
      - Succeeded count (e.g. `10 succeeded`)
      - Partial count (e.g. `1 partial`)
      - Failed count (e.g. `1 failed`)
      - Total credits spent (marked with *actual* tooltip)
      - Success rate percentage (e.g. `91% success`)
- [ ] **6.1.3** 🟠 Filter Chips:
      - Click **Succeeded** → List only shows runs with `status = 'complete'`.
      - Click **Partial** → List only shows runs flagged partial.
      - Click **Failed** → List only shows failed runs with 0 credit charges.
      - Click **All** → All runs return.
- [ ] **6.1.4** 🟠 Template & Month Selectors:
      - Select specific template (e.g. *Sales-ready Account Brief*) → List filters accordingly.
      - Select month (e.g. *2026-09*) → Filters to runs created in that month.
- [ ] **6.1.5** 🟠 Live Search:
      - Type domain (e.g. `stripe.com`) in the search input → List filters in real-time.
- [ ] **6.1.6** 🟠 Row Contents:
      - Each row displays: Template Name, Target Domain/URL, Output Summary snippet, Status pill, Charged Credits (e.g. `8 cr`), and Relative/Absolute Timestamp.

### 6.2 Account Page Compact Run History
- [ ] **6.2.1** 🟠 Navigate to `/account`.
      ✅ Expect: Compact summary section renders under Usage/Workflows showing recent run counts.
- [ ] **6.2.2** 🟠 Click **"See all N runs →"**.
      ✅ Expect: Navigates directly to `/dashboard?view=runs`.

### 6.3 Interactive Workflow Run Detail Modal (`WorkflowRunModal.jsx`) 🔴
- [ ] **6.3.1** 🔴 Click any completed run row in `/dashboard?view=runs`.
      ✅ Expect: Detail modal opens instantly. URL does not navigate away; background content is shadowed.
- [ ] **6.3.2** 🟠 Verify Header & Identity:
      - Title: Template Name (e.g. *Sales-ready Account Brief*)
      - Target Domain pill: `stripe.com`
      - Run ID: Monospace shortened UUID (e.g. `run_3f8a...`)
      - Status pill: Green `Completed` badge.
- [ ] **6.3.3** 🔴 Verify Credits Breakdown:
      ✅ Expect: Clear badge indicating actual credits billed vs original estimate (e.g. *"8 credits charged (est: 8 credits)"*).
- [ ] **6.3.4** 🟠 Verify AI Summary & Key Talking Points:
      - Formatted executive summary explaining company position, market, and business model.
      - 3 bulleted conversation openers / talking points derived from extracted evidence.
- [ ] **6.3.5** 🔴 Verify Extracted Facts & Provenance Table:
      - Table renders all structured key-value pairs (e.g. `HQ`, `Company Size`, `Pricing Model`, `Leadership`).
      - Provenance column states extraction method (`observed`, `inferred`, `ai_generated`).
      - Confidence percentage badge renders with color-coding:
        - 🟢 Green badge for high confidence (≥ 80%)
        - 🟡 Yellow badge for medium confidence (50% – 79%)
        - 🔴 Red badge for low confidence (< 50%)
- [ ] **6.3.6** 🟠 Verify Source Evidence Citations:
      - Fetched URLs listed with timestamps (e.g. `https://stripe.com/pricing · fetched 2026-09-04 02:22 UTC`).
      - Clicking source URL opens target site in a new tab with `rel="noopener noreferrer"`.
- [ ] **6.3.7** 🔴 Verify Failed Run Handling:
      - In run list, filter by **Failed** or find a failed run.
      - Click the failed run row.
      - ✅ Expect: Modal renders with an amber/red warning banner:
        - Reason for failure (e.g. *"Target domain unreachable: HTTP 504"* or DNS lookup failed).
        - Explicit billing assurance: *"0 credits billed — you are never charged for incomplete or failed runs."*
- [ ] **6.3.8** 🟠 Verify Modal Action Buttons:
      - Click **"Re-run in Templates"** → Navigates to `/templates?key=<template_key>` with domain pre-filled ready for execution.
      - Click **"Create shareable report"** → Opens the Report publishing dialog for this run ID.
- [ ] **6.3.9** 🟡 Keyboard & Accessibility:
      - Navigate table rows using `Tab` key. Press `Enter` or `Space` on a row → Modal opens.
      - Press `Escape` key → Modal closes immediately, focus returns to the selected row.
      - Click backdrop outside the modal card → Modal dismisses.

---

## §7 — Shareable Intelligence Reports & State Machine (`/r/:slug`)

### 7.1 Creation & Private Default
- [ ] **7.1.1** 🔴 Run a template (e.g. `account_brief`) while signed in.
- [ ] **7.1.2** 🔴 Click **"Create shareable report"**.
      ✅ Expect: Share dialog opens with **"Private"** selected by default.
- [ ] **7.1.3** 🔴 🧪 Run query:
      `select slug, visibility from reports order by created_at desc limit 1;`
      ✅ Expect: `visibility = 'private'`, `slug IS NULL`. (No URL is minted while private).

### 7.2 Link Publishing & Noindex Enforcement
- [ ] **7.2.1** 🔴 In Share dialog, select **"Anyone with the link"**.
      ✅ Expect: An 8-character slug is minted (e.g. `/r/a1b2c3d4`). Copy the URL.
- [ ] **7.2.2** 🔴 Open the link in a private/incognito window (signed out).
      ✅ Expect: The report renders completely with title, AI summary, structured facts, and source citations.
- [ ] **7.2.3** 🔴 View HTML source (`curl -s <url> | grep robots` or DevTools Elements).
      ✅ Expect: Exactly **ONE** `<meta name="robots" content="noindex">` tag. (Link shares must not be crawled).
- [ ] **7.2.4** 🟠 Verify acquisition CTA:
      ✅ Expect: Button **"Run this on another company"** links to `/templates?key=account_brief`.

### 7.3 Unpublish vs Revoke (Decision D3) 🔴
- [ ] **7.3.1** 🔴 Switch report back to **"Private"** in Share dialog.
      ✅ Expect: Toast *"Sharing stopped. Re-publish any time — the same link will work again."*
- [ ] **7.3.2** 🔴 Reload incognito tab → ✅ Expect: HTTP 404 *"This report isn't available"*.
- [ ] **7.3.3** 🔴 🧪 Check Supabase: `select slug from reports where id='<id>';`
      ✅ Expect: The slug is **still present** in the database.
- [ ] **7.3.4** 🔴 In Share dialog, re-select **"Anyone with the link"**.
      ✅ Expect: The **exact same slug** is re-activated.
- [ ] **7.3.5** 🔴 Reload incognito tab → ✅ Expect: Report renders again.
- [ ] **7.3.6** 🔴 In Share dialog, click **"Revoke this link permanently"** and confirm dialog.
      ✅ Expect: Status becomes revoked.
- [ ] **7.3.7** 🔴 Reload incognito tab AND reload as report owner.
      ✅ Expect: Both receive a terminal 404. Revoked slugs can never be viewed or restored.

### 7.4 Branding & Paywall Bypass Probe
- [ ] **7.4.1** 🟠 On Free plan, shared report footer displays: *"Made with DatIQ"*.
- [ ] **7.4.2** 🔴 On Free account, execute API payload probe in browser console:
      ```javascript
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session.access_token },
        body: JSON.stringify({ action: 'create', title: 'Bypass probe', branding: { hideAttribution: true } })
      });
      ```
- [ ] **7.4.3** 🧪 Query database: `select branding from reports where title = 'Bypass probe';`
      ✅ Expect: `branding = '{}'`. (Server-side gate silently drops paid branding attributes for unpaid tiers).

---

## §8 — Integration Recipe Gallery (`/integrations`)

### 8.1 Outcome-First Cards Display
- [ ] **8.1.1** 🟠 Navigate to `/integrations`.
- [ ] **8.1.2** 🟠 Scroll to section: **"What you can wire up"** (`RecipeGallery.jsx`).
      ✅ Expect: Cards lead with the business outcome (e.g. *"Create a HubSpot company with verified fields"*), then explicit **When** and **Then** triggers.
- [ ] **8.1.3** 🟠 Verify Readiness Tags:
      - "Ready now" for native, active automations.
      - "One click" for manual push triggers (HubSpot, Google Sheets, Slack).
      - "Soon" with title tooltip (e.g. *"Needs: Phase 5"*, *"Needs: Phase 6"*) for scheduled watchlists and signal routing.
- [ ] **8.1.4** 🟠 Roadmap cards do NOT render clickable action buttons; instead show: *"Not available yet — arrives with Phase X."*
- [ ] **8.1.5** 🟠 Click bottom link **"Browse the full workflow template library →"**.
      ✅ Expect: Seamlessly navigates to `/templates`.

---

## §9 — Activation & PQL Founder Funnel (`/admin/revenue`)

### 9.1 PQL Component Rendering (`PqlFunnel.jsx`)
- [ ] **9.1.1** 🔴 Sign in as an Admin and navigate to `/admin/revenue`.
- [ ] **9.1.2** 🟠 Locate the **Activation & PQL** card.
      ✅ Expect: Renders header: *"Activation & PQL — PQL at 50 of 100 points"*.
- [ ] **9.1.3** 🟠 Verify Key Funnel Stats:
      - Accounts count
      - Activated count (with % of all accounts)
      - PQLs count (with % of scored accounts, highlighted in accent tone)
      - Mean score across scored accounts
- [ ] **9.1.4** 🟠 Verify Caveat Banners:
      - If unscorable accounts exist: Information note stating accounts without measurable signals are excluded from the mean.
      - If mean coverage < 100%: Warning note stating PQL count is a floor until bulk enrichment and firmographics land.
- [ ] **9.1.5** 🟠 Verify Score Distribution Bands:
      - Cold (<25 pts)
      - Warming (25–49 pts)
      - PQL (50–74 pts)
      - Strong (≥75 pts)
- [ ] **9.1.6** 🟠 Verify Activation Groups Breakdown Table:
      - Groups: Sales Outreach, Competitive Analysis, Content & SEO, Investment Diligence.
      - Columns: Activation group, Accounts, Activated, Rate, PQLs.

---

## §10 — Entitlements & Plan Packaging Enforcement

| Capability | Free | Go / Select | Pro | Business | Agency |
|---|---|---|---|---|---|
| `template.run` | ✅ (Unlimited public seeds) | ✅ | ✅ | ✅ | ✅ |
| `template.duplicate` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `report.share` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `report.branding` | ❌ (Made with DatIQ) | ❌ | ❌ | ✅ (Custom Brand Kit) | ✅ (Custom Brand Kit) |
| `extract.batch` | ❌ | ❌ | ✅ (Manual) | ✅ (Priority) | ✅ (Priority) |

- [ ] **10.1** 🔴 Run a template as a Free user → Allowed.
- [ ] **10.2** 🔴 Publish a report as a Free user → Allowed (drives PLG viral acquisition loop).
- [ ] **10.3** 🔴 Attempt custom brand kit on Free plan → Denied server-side.
- [ ] **10.4** 🔴 Verify monthly credit allowance enforcement:
      When monthly credit balance is exhausted, the template runner displays inline error before submission: *"This run needs N credits and you have 0 left this month. Upgrade your plan, or wait for your allowance to reset."*

---

## §11 — Regression Sweep: Neighbouring Modules

Ensure zero regression on existing DatIQ modules:
- [ ] **11.1** 🔴 **Home (`/`)**: URL composer still performs single-URL extraction, JS rendering toggle, and domain mapping.
- [ ] **11.2** 🔴 **Dashboard (`/dashboard`)**: Saved extractions table, search, export to CSV/PDF/Sheets, and layout toggles operate smoothly.
- [ ] **11.3** 🟠 **Batch (`/batch`)**: Multi-URL batch extraction runner continues processing.
- [ ] **11.4** 🟠 **Discoverability (`/discoverability`)**: 4-pillar audit runs and stores historical audits.
- [ ] **11.5** 🟠 **Schedules (`/schedules`)**: Hourly/daily monitoring tasks list and trigger.
- [ ] **11.6** 🟠 **Pricing (`/pricing`)**: Tier comparison matrix and upgrade checkout links render correctly.
- [ ] **11.7** 🔴 **Public Reports Gallery (`/gallery`)**: Curated community reports display unchanged.
- [ ] **11.8** 🔴 **Legacy Share Links (`/p/:slug`)**: Existing `/p/` links migrate cleanly to `/r/` or continue resolving.

---

## §12 — Phase 4: Bulk Account Intelligence (`/lists`)

### 12.1 Strategic Context & Use Cases
- **Target Personas**: RevOps Managers, Growth Marketers, SDR Leadership.
- **Trigger**: Ingesting a CSV of 50–500 target accounts (e.g. event leads, territory accounts) that need firmographic qualification and ICP scoring before sales outreach.
- **Core Value**: Saves days of manual research; automatically normalizes domains, drops duplicates, computes weighted ICP fit scores with the §1.6 coverage rule (unmeasured fields redistributed, never penalized as 0), and routes low-confidence contacts to a human review queue.

### 12.2 Navigation & Lists Overview
- [ ] **12.2.1** 🟠 Open navigation: Click **Lists** in main navbar (or navigate directly to `/lists`).
      ✅ Expect: Lists dashboard mounts showing header *"Account Lists & Bulk Enrichment"*, total lists count, and active accounts count.
- [ ] **12.2.2** 🟠 Click **"+ New List"** button.
      ✅ Expect: Modal opens with list name input, description, and input mode tabs (**"Upload CSV"** and **"Paste Domains"**).

### 12.3 Input Normalization & Deduplication Preview 🔴
- [ ] **12.3.1** 🟠 In **"Paste Domains"** tab, enter:
      ```text
      https://www.stripe.com/pricing
      stripe.com
      HTTP://NOTION.SO/
      https://linear.app
      invalid-domain-format-no-tld
      stripe.com
      ```
- [ ] **12.3.2** 🔴 Inspect the live Pre-Enrichment Deduplication Banner:
      ✅ Expect:
      - Total inputs: `6`
      - Normalized valid domains: `3` (`stripe.com`, `notion.so`, `linear.app`)
      - Duplicates dropped: `2` (duplicate `stripe.com` instances collapsed)
      - Invalid lines flagged: `1` (`invalid-domain-format-no-tld`)
- [ ] **12.3.3** 🟠 Test CSV Upload tab:
      - Upload a CSV containing columns `Company Name`, `Website`, `Country`.
      - Map column dropdown selects `Website`.
      - ✅ Expect: Correctly extracts domains and displays deduplicated count preview.

### 12.4 Chunked Enrichment Execution & Resilience 🔴
- [ ] **12.4.1** 🟠 Click **"Create & Start Enrichment"**.
      ✅ Expect:
      1. List is created in `lists` table.
      2. Job enqueues in `enrichment_jobs`.
      3. Credit estimate dialog shows expected credits (e.g. `9 credits`).
- [ ] **12.4.2** 🔴 Observe Chunk Runner Progress:
      - Progress bar advances smoothly (e.g. `Processing item 1 of 3: stripe.com`).
      - Verified chunked execution loop (`bulkClient.js` running chunk batches within Netlify timeout limits).
- [ ] **12.4.3** 🔴 Error Tolerance Invariant:
      - If one domain times out or returns HTTP 404/500, verify that the runner marks that item as `failed` with error details and **continues processing the remaining domains**.
      - ✅ Expect: Job finishes with status `completed` (or `partial`), never crashing the entire batch.
- [ ] **12.4.4** 🔴 Credit Ledger Settlement:
      - Verify credit ledger only deducts credits for successfully enriched accounts.
      - Failed items incur 0 credits.

### 12.5 Accounts Table & ICP Fit Scoring (§1.6 Coverage Rule) 🔴
- [ ] **12.5.1** 🟠 Open the enriched list. The Accounts Table renders:
      - Company Name & Domain
      - Industry & Business Model
      - Team Size / HQ
      - ICP Fit Badge (`High Fit ≥80`, `Medium Fit 50-79`, `Low Fit <50`, `Unmeasured`)
      - Extracted Contacts / Key Leadership
- [ ] **12.5.2** 🔴 Verify ICP §1.6 Coverage Rule:
      - If an account has unmeasured fields (e.g. `employee_count` not found on website), verify the score does NOT treat it as 0.
      - Weights of unmeasured signals are redistributed across measured signals.
      - Hover over ICP badge: Tooltip displays exact formula, points breakdown, and `coverage: 80%`.
      - For records with zero measured fields: displays badge `Unmeasured` (`score: null`, `coverage: 0.00`).

### 12.6 ICP Rule Simulator Sandbox 🟠
- [ ] **12.6.1** 🟠 On the list view, click **"Configure ICP Rules"**.
      ✅ Expect: ICP Rule Simulator modal opens with criteria sliders (e.g. *B2B SaaS model*, *Pricing published*, *Enterprise contact gate*, *Leadership identified*).
- [ ] **12.6.2** 🟠 Adjust slider weight for *Pricing published* from 20 → 40.
      ✅ Expect: Sandbox preview recalculates fit scores for sample accounts in real time.
- [ ] **12.6.3** 🟠 Click **"Reset to DatIQ Defaults"**.
      ✅ Expect: All weights and criteria restore to persona-seeded defaults.
- [ ] **12.6.4** 🟠 Save rules → Accounts table updates fit badges accordingly.

### 12.7 Human Review Queue 🔴
- [ ] **12.7.1** 🟠 Navigate to tab **"Review Queue"** in Lists.
      ✅ Expect: Lists all extracted leadership contacts or data points with confidence score `< 0.70`.
- [ ] **12.7.2** 🔴 Each review card displays:
      - Candidate Name, Title, and Email / LinkedIn handle.
      - Source page snippet where the evidence was found.
      - Extraction Confidence badge (e.g. `62%`).
      - Action buttons: **"Confirm"** (green checkmark) and **"Reject"** (red cross).
- [ ] **12.7.3** 🟠 Click **"Confirm"** on an item:
      ✅ Expect: Contact promotes to confirmed status; item removes from Review Queue; account row in main table reflects confirmed contact.
- [ ] **12.7.4** 🟠 Click **"Reject"**:
      ✅ Expect: Item is discarded; audit log records human rejection.

---

## §13 — Phase 5: Competitor Watchlists & Change Intelligence (`/watchlists`)

### 13.1 Strategic Context & Use Cases
- **Target Personas**: Competitive Intelligence Directors, Product Marketing Managers (PMM), Product Executives.
- **Trigger**: Monitoring market rivals (e.g. 5 key competitors) for strategic shifts in pricing, packaging, product capabilities, or brand positioning.
- **Core Value**: Eliminates 95% of alert noise by filtering out cosmetic HTML/CSS updates; triggers high-priority alerts ONLY when a normalized business field changes; separates verifiable facts from AI strategic interpretations.

### 13.2 Watchlist Setup & Target Management
- [ ] **13.2.1** 🟠 Click **Watchlists** in main navbar (or navigate to `/watchlists`).
      ✅ Expect: Watchlists dashboard renders active watchlists (e.g. *"Core Database Competitors"*), total targets monitored, and recent material changes count.
- [ ] **13.2.2** 🟠 Click **"+ Create Watchlist"**:
      - Name: *"Developer Tool Rivals"*
      - Notification Channel: Select *Email Digest* and/or *Slack Webhook*.
      - Sensitivity: Select *Normal* (Critical & High changes).
- [ ] **13.2.3** 🟠 Add Competitor Target:
      - Domain: `supabase.com`
      - Click **Add Target**.

### 13.3 Automated Page Discovery 🟠
- [ ] **13.3.1** 🟠 On target details card for `supabase.com`, inspect **"Monitored Pages"**.
      ✅ Expect: Automatic discovery recommends:
      - Pricing: `https://supabase.com/pricing`
      - Features / Product: `https://supabase.com/database`
      - Customers: `https://supabase.com/customers`
- [ ] **13.3.2** 🟠 Toggle page monitoring checkboxes on/off. Click **"Save Monitored Pages"**.

### 13.4 Change Detection & Materiality Classification 🔴
- [ ] **13.4.1** 🔴 Inspect the **Change Feed**:
      Each detected delta renders with a **Materiality Badge**:
      - 🔴 **Critical**: Core pricing tier price change, removal of free tier, new seat minimums. (Triggers immediate notification).
      - 🟠 **High**: New product module launched, enterprise pricing gate added, major positioning overhaul. (Enters daily digest).
      - 🟡 **Medium**: Minor packaging change, new case study published, secondary nav update. (Enters weekly digest).
      - ⚪ **Low / Cosmetic**: Copyright year update (`2025 → 2026`), CSS class change, minor copy polish. (Stored in audit table, **no notification sent**).
- [ ] **13.4.2** 🔴 Pre-filter Invariant (§1.4):
      - When a monitored page has an identical content hash, verify 0 AI calls are made and 0 credits are deducted.
      - Only pages with content hash changes trigger field extraction and diffing.

### 13.5 Structural Fact vs AI Strategic Interpretation Separation 🔴
- [ ] **13.5.1** 🔴 Click any change item in the feed to expand details.
      ✅ Expect: Strict two-tab or two-column split layout:
      1. **Objective Fact Tab**:
         - Field name (e.g. `pro_tier_price`)
         - Previous value: `$25/mo`
         - Detected new value: `$29/mo`
         - Timestamp detected
         - Source URL with direct snapshot link
      2. **AI Strategic Interpretation Tab**:
         - Strategic Analysis: *"Supabase increased Pro tier pricing by 16%, introducing higher compute allocations."*
         - Market Impact: *"Widens the pricing gap with entry-level open-source alternatives; positions product upmarket."*
         - Recommended Counter-Action: *"Update sales battlecard #4 highlighting DatIQ's fixed billing advantages."*
- [ ] **13.5.2** 🔴 Verify that AI interpretation is NEVER blended into the raw fact values. (Audit-defensible evidence).

### 13.6 Human Relevance Feedback Loop 🟠
- [ ] **13.6.1** 🟠 On any change card, inspect the feedback buttons:
      - 👍 **"Useful"**
      - 👎 **"Not Useful"**
      - 🔕 **"Mute this field"**
- [ ] **13.6.2** 🟠 Click **"Not Useful"**:
      - Modal prompts: *"Why was this change not useful? (False alarm / Too minor / Wrong category)"*.
      - Select reason and submit.
      - ✅ Expect: Stored in `change_feedback` table; updates client-side false-positive suppression model.
- [ ] **13.6.3** 🟠 Click **"Mute this field"** on a noisy field:
      ✅ Expect: Future changes to that specific field on this target are suppressed from alerts.

---

## §14 — Phase 6: Native Signal Routing (`/rules`)

### 14.1 Strategic Context & Use Cases
- **Target Personas**: RevOps Engineers, Sales Operations, Demand Gen Leads.
- **Trigger**: Automatic revenue action required when an intelligence signal fires (e.g. an account scores ICP ≥ 80, or a competitor changes pricing).
- **Core Value**: Turns intelligence into immediate execution without Zapier tax or pipeline delays; natively syncs to CRM (HubSpot), Team Chat (Slack), Email (Resend), or Custom HTTP Webhooks.

### 14.2 Rule Builder Interface
- [ ] **14.2.1** 🟠 Navigate to `/rules` via main navigation.
      ✅ Expect: Rules dashboard renders with active rules count, total executions count, and **"+ Create New Rule"** button.
- [ ] **14.2.2** 🟠 Click **"+ Create New Rule"**:
      The form follows the strict **If-This-Then-That** design:
      - **WHEN (Trigger Event)**:
        - `watchlist.change_detected`
        - `bulk.account_qualified`
        - `template.run_completed`
      - **IF (Condition Criteria)**:
        - Field selector (e.g. `icp_score`, `materiality`, `change_type`, `domain`)
        - Operator (e.g. `greater_than_or_equal`, `equals`, `contains`, `in_list`)
        - Value input (e.g. `80`, `critical`, `pricing`)
      - **THEN (Action Dispatch)**:
        - Action selector: `Slack Webhook`, `Send Email (Resend)`, `POST Webhook`, `HubSpot Company Sync`
        - Destination config (Webhook URL, Channel, Recipient email, HubSpot API token)
- [ ] **14.2.3** 🟠 Build sample rule:
      - Name: *"High Fit ICP to HubSpot & Slack"*
      - Trigger: `bulk.account_qualified`
      - Condition: `icp_score >= 80`
      - Actions:
        1. `Slack Webhook` → Channel `#inbound-high-icp`
        2. `HubSpot Company Sync` → Create/Update company record with ICP score and verified contacts.
- [ ] **14.2.4** 🟠 Save Rule → Rule appears active in rules list.

### 14.3 Interactive Rule Evaluation Sandbox 🔴
- [ ] **14.3.1** 🔴 On any rule card, click **"Test in Sandbox"**.
      ✅ Expect: Interactive sandbox panel opens with an editable sample JSON event payload.
- [ ] **14.3.2** 🔴 Test Matching Payload:
      - Set JSON payload: `{"event": "bulk.account_qualified", "domain": "stripe.com", "icp_score": 88, "industry": "Fintech"}`.
      - Click **"Evaluate Rule"**.
      - ✅ Expect:
        - Result banner: 🟢 **"MATCH: Rule conditions satisfied"**.
        - Match reasons: `icp_score (88) is >= 80`.
        - Action Dispatch Preview: Formatted Slack message block preview and HubSpot company payload preview.
- [ ] **14.3.3** 🔴 Test Non-Matching Payload:
      - Modify payload: `{"icp_score": 65}`.
      - Click **"Evaluate Rule"**.
      - ✅ Expect:
        - Result banner: ⚪ **"NO MATCH: Condition not met"**.
        - Explanatory reason: `icp_score (65) is not >= 80`.
        - Action Dispatch Preview: Explicitly disabled.

### 14.4 Live Action Dispatch & Audit History
- [ ] **14.4.1** 🟠 In sandbox, click **"Send Test Dispatch"**.
      ✅ Expect: Dispatch triggers real webhook/HTTP call; returns HTTP 200 response with delivery latency.
- [ ] **14.4.2** 🟠 Navigate to tab **"Execution History"** in `/rules`:
      - Displays timestamped execution logs.
      - Columns: Rule Name, Event Trigger, Matched Status, Action Dispatched, Status (`Success` / `Failed`), Latency.
      - Click log row to view exact dispatched JSON payload and remote server response.

---

## §15 — Phase 7: Packaging, Navigation & Staging Gate Verification

### 15.1 TopBar & Navigation Parity
- [ ] **15.1.1** 🟠 Verify Main Navigation Bar on desktop and mobile:
      - Links present: **Extract**, **Templates**, **Lists**, **Watchlists**, **Rules**, **Discover**, **Dashboard**.
      - Active route highlights the corresponding navigation tab with `--accent` indicator.
- [ ] **15.1.2** 🟠 Verify TopBar Explore Dropdown:
      - Links for `/templates`, `/lists`, `/watchlists`, `/rules`, `/integrations`.
- [ ] **15.1.3** 🟠 Verify User Account Dropdown:
      - Usage & Workflows link points to `/dashboard?view=runs`.

### 15.2 Staging Gate Pipeline Verification 🔴
- [ ] **15.2.1** 🔴 Verify GitHub Actions [Staging Gate](https://github.com/vikashkaruna/scrapelite/actions/workflows/staging-gate.yml):
      - Run #33829281244 is **100% SUCCESS** across all 4 gate jobs:
        1. `Staging Gate: Vulnerabilities` (green)
        2. `Staging Gate: Open Issues/Defects` (green)
        3. `Staging Gate: Test Suites` (green: 2,871 unit tests, 1,887 contract tests, 131 E2E tests)
        4. `Staging Gate: Deployed & Smoke Tested` (green)
- [ ] **15.2.2** 🔴 Netlify Staging Deployment:
      - Deploy ID: `6a9a2b6ad676f30008224cd9` is in `state: ready`.
      - Functions bundle contains all 62 serverless functions without import path errors.

---

## §16 — SQL Data Integrity Sweep

Execute the following comprehensive verification queries in the Supabase SQL editor to assert zero schema drift across all 43 migrations:

```sql
-- 16.1 Verify every expected migration table exists
--    Presence check over a hand-picked SUBSET of the schema (the numbered
--    migrations create ~87 public tables), so it is NOT a total-count assertion.
--    Left-joined on purpose: a bare count(*) can tell you the number is short
--    but never WHICH name is missing.
--    Until 2026-09-05 this list also asserted `user_settings`, `plans`,
--    `coupons`, `checkout_sessions` and `audit_comparisons`. None has ever
--    existed in any migration, so the sweep returned 37 and read as a FAILED
--    apply on a completely healthy database. Do not re-add them: plans and
--    coupons live in `pricing_config` (jsonb, keys 'plans'/'coupons') plus
--    `coupon_counters` / `coupon_redemptions` / `admin_coupon_assignments`;
--    the checkout snapshot is `invoice_drafts`; user settings are localStorage
--    + `auth.users.user_metadata`; stored comparisons are `audit_benchmarks`
--    + `audit_benchmark_members`.
with expected(tablename) as (
  values ('extractions'),('usage_records'),('public_reports'),
         ('subscriptions'),('invoices'),
         ('scheduled_tasks'),('workflow_events'),('workflow_runs'),('analytics_events'),
         ('audits'),
         ('workflow_templates'),('template_runs'),('template_run_sources'),
         ('credit_ledger'),('credit_estimates'),('extracted_fields'),('field_provenance'),
         ('reports'),('report_grants'),('report_access_log'),('pql_scores'),('activation_events'),
         ('lists'),('canonical_entities'),('list_records'),('icp_score_rules'),
         ('enrichment_jobs'),('enrichment_job_items'),('review_queue'),
         ('watchlists'),('watchlist_targets'),('monitored_pages'),('entity_snapshots'),
         ('field_changes'),('change_feedback'),
         ('signal_rules'),('rule_executions')
)
select e.tablename as missing_table
  from expected e
  left join pg_tables t
    on t.schemaname = 'public' and t.tablename = e.tablename
 where t.tablename is null
 order by 1;
-- ✅ Expect: 0 rows. Any row names a table the migrations did not create.

-- 16.2 Verify RLS is enabled on ALL newly created tables
select tablename from pg_tables
 where schemaname = 'public'
   and tablename in (
     'lists', 'canonical_entities', 'list_records', 'icp_score_rules',
     'enrichment_jobs', 'enrichment_job_items', 'review_queue',
     'watchlists', 'watchlist_targets', 'monitored_pages', 'entity_snapshots',
     'field_changes', 'change_feedback',
     'signal_rules', 'rule_executions'
   )
   and not rowsecurity;
-- ✅ Expect: 0 rows (all tables MUST have rowsecurity = true)

-- 16.3 Verify Foreign Key Integrity on List Records & Entities
select count(*) from list_records lr
 where not exists (select 1 from lists l where l.id = lr.list_id)
    or not exists (select 1 from canonical_entities ce where ce.id = lr.entity_id);
-- ✅ Expect: 0 orphaned list records

-- 16.4 Verify Watchlist Targets & Monitored Pages Cascading
select count(*) from monitored_pages mp
 where not exists (select 1 from watchlist_targets wt where wt.id = mp.target_id);
-- ✅ Expect: 0 orphaned monitored pages

-- 16.5 Verify Default ICP Rules Seeded
select persona, count(*) from icp_score_rules
 group by persona;
-- ✅ Expect: Rows for 'sales', 'revops', 'ci'

-- 16.6 Verify Append-Only Ledger Immutability
select count(*) from credit_ledger where credits = 0;
-- ✅ Expect: 0 zero-credit records
```

---

## §17 — Staging Promotion & Production Deployment Guide

When promoting the verified staging branch to `main` for production release:

1. **Verify Main Branch State**: Ensure working directory `/Users/vikash/Extracta` is clean on `main` at `db8868c`.
2. **Execute Database Migrations on Production Supabase**:
   Apply migrations `0041_bulk_enrichment.sql`, `0042_watchlists.sql`, and `0043_signal_rules.sql` via Supabase CLI or Web SQL Editor.
3. **Merge Staging to Main**:
   ```bash
   git checkout main
   git merge origin/staging --ff-only  # or create GitHub release PR
   git push origin main
   ```
4. **Production CI / CD Gate**:
   Monitor the GitHub Actions `Production Gate` run.
5. **Post-Deploy Smoke Test**:
   Execute manual test cases in §4, §6.3, §12, §13, and §14 against `https://datiq.app`.

