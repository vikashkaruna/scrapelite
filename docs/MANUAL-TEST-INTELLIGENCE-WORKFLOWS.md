# Manual Test Plan — DatIQ Intelligence Workflows (Phases 0–3 & Shipped Enhancements)

> **Covers:** PRD 1 (Workflow Templates & Guided Onboarding), PRD 2 (Shareable Intelligence Reports),
> PRD 3 Activation & PQL Funnel (Phase 3), Integration Recipe Gallery, Smart Company Resolver,
> and Workflow Run History.
> **Source Plan:** `docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md` (derived from `DatIQ - Persona Specific Templates & Shareable Reports.pdf`).
> **Status:** Phases 0, 1, 2, 3 + Company Resolver + Run History + Recipe Gallery SHIPPED to `staging` and `main` (`db8868c`).
> **Pending Roadmap:** Phase 4 (Bulk Account Intelligence), Phase 5 (Competitor Watchlists & Change Intelligence), Phase 6 (Native Signal Routing), Phase 7 (Packaging/GTM).
> **Automated coverage:** 4,800+ unit, contract, integration, and database tests green. This document covers the interactive, end-to-end, and manual verification steps that cannot be asserted purely by static mocks.

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
  - [4.7 Bulk ICP Enrichment Draft Invariant (`bulk_icp_enrichment`)](#47-bulk-icp-enrichment-draft-invariant-bulk_icp_enrichment)
- [§5 — Runs, Credits & Append-Only Ledger](#5--runs-credits--append-only-ledger)
- [§6 — Workflow Run History (`/dashboard?view=runs` & `/account`)](#6--workflow-run-history-dashboardviewruns--account)
- [§7 — Shareable Intelligence Reports & State Machine (`/r/:slug`)](#7--shareable-intelligence-reports--state-machine-rslug)
- [§8 — Integration Recipe Gallery (`/integrations`)](#8--integration-recipe-gallery-integrations)
- [§9 — Activation & PQL Founder Funnel (`/admin/revenue`)](#9--activation--pql-founder-funnel-adminrevenue)
- [§10 — Entitlements & Plan Packaging Enforcement](#10--entitlements--plan-packaging-enforcement)
- [§11 — Regression Sweep: Neighbouring Modules](#11--regression-sweep-neighbouring-modules)
- [§12 — SQL Data Integrity Sweep](#12--sql-data-integrity-sweep)
- [§13 — Known Gaps & Roadmap Alignment (Phases 4–7)](#13--known-gaps--roadmap-alignment-phases-47)

---

## §0 — Preconditions & Environments

### 0.1 Migrations State
The database must have migrations `0001` through `0040` applied.
- `0036_workflow_templates.sql` — versioned template catalog, `template_runs`, `template_run_sources`
- `0037_credit_ledger.sql` — append-only ledger (`credit_ledger`), estimate drift tracking (`credit_estimates`)
- `0038_field_provenance.sql` — field-level provenance (`extracted_fields`, `field_provenance`)
- `0039_report_access.sql` — shareable reports (`reports`, `report_grants`, `report_access_log`)
- `0040_pql.sql` — product qualified lead scoring (`pql_scores`, `activation_events`)

### 0.2 Testing Environments
1. **Local Full Stack**: `nvm use 24 && netlify dev` (serves frontend on port 8888, proxies Netlify functions).
2. **Staging**: `https://staging--datiqapp.netlify.app` (requires Netlify Edge SSO authentication or bypass).
3. **Production**: `https://datiq.app` (live site).

### 0.3 Test Accounts Required
- **Account A (Guest / Signed Out)**: Used to verify public catalogue reachability, guest execution toast, and sign-up modal triggers.
- **Account B (Free Plan)**: Used to verify baseline template execution, credit allowance limits, report publishing, and attribution branding enforcement ("Made with DatIQ").
- **Account C (Business or Agency Plan)**: Used to verify custom Brand Kit attribution replacement and multi-seat sharing.
- **Account D (Secondary Collaborator Account)**: Used to verify named collaborator grants and org-level access controls.

---

## §1 — Persona, Scenario & Use-Case Strategic Matrix

DatIQ translates raw web scraping into structured economic outcomes. The matrix below defines the exact business scenarios, personas, triggers, and deliverables for each implemented workflow template:

| Persona | Workflow Template | Trigger / Scenario | Input Required | Delivered Outcome & Differentiators | Commercial / Economic Value |
|---|---|---|---|---|---|
| **Sales / SDR / BDR** | `account_brief`<br>*(Sales-ready Account Brief)* | 15 mins before a cold outreach or discovery call; researching an inbound target account | Company domain (e.g. `stripe.com`) + Outreach angle (`discovery`, `displacement`, `expansion`) | 1-paragraph summary, structured account facts (HQ, size, pricing model), 3 concrete conversation openers cited from site evidence, leadership contacts. | Saves 30–45 mins of manual browsing per account; eliminates generic flattery; increases outreach reply rates by citing real site claims. |
| **Competitive Intelligence** | `competitor_pricing_tracker`<br>*(Competitor Pricing Tracker)* | Competitor announces repackaging, or quarterly pricing review across market landscape | Competitor domain (`notion.so`) + optional explicit pricing URL | Structured tier table (names, prices, billing periods, seat rules, limits), free tier presence, enterprise gating, packaging strategy signals. | Eliminates manual copy-pasting of pricing matrices; establishes a baseline snapshot for historical diffing and pricing battlecards. |
| **SEO / Content Marketer** | `discoverability_audit`<br>*(SEO / GEO / AEO Audit)* | Client content audit; assessing visibility in AI search engines (Perplexity, ChatGPT Search, Google SGE) | Target page URL (`https://example.com/pricing`) + Lens (`balanced`, `seo`, `aeo`, `geo`) | Direct hand-off to `/discoverability` module: 4-pillar scores (Classic SEO, Content Quality, AI Discoverability, Performance), prioritized fix queue. | Turns a routine crawl into actionable recommendations; identifies whether AI answer engines can cite the brand's pages. |
| **Startup Founder / VC / Analyst** | `due_diligence_brief`<br>*(Pre-Meeting Due Diligence Brief)* | Prepping for a founder pitch, partnership discussion, or preliminary investment screening | Company domain (`linear.app`) + Meeting focus (`intro`, `diligence`, `partnership`) | "Before you walk in" brief, claimed vs evidenced traction, open roles indicating investment areas, 4 tailored questions to ask. | Protects investor/founder time; separates marketing claims from verifiable facts; avoids entering meetings with information blind spots. |
| **Product Marketing Manager (PMM)** | `customer_proof_extractor`<br>*(Customer Proof Extractor)* | Building sales battlecards; competitive displacement campaign; refreshing customer proof library | Competitor domain (`vercel.com`) | Structured customer proof table (named customer, industry, quantified outcome like "40% faster", source quote), named logo list. | Collects verified proof points in under 60 seconds; feeds win-loss programs; prevents sales reps from citing fabricated or unverified claims. |
| **PMM / Executive / CI** | `ai_visibility_brief`<br>*(AI Visibility & Competitive Brief)* | Strategic positioning review; board deck prep; understanding how AI answer engines perceive your brand vs rivals | Your domain + Up to 4 competitor domains + Audience focus (`gtm`, `founder`, `marketing`) | Side-by-side like-for-like comparison grid across category, target buyer, pricing, headline differentiator, strongest proof point; "What to change first" action list. | DatIQ's flagship positioning asset: evaluates how answer engines represent the company vs competitors; highlights empty claims ("not stated"). |
| **RevOps / Growth** | `bulk_icp_enrichment`<br>*(Bulk ICP Account Enrichment)* | Processing event lead lists or cold account lists from conference attendee exports | List of domains (CSV upload or paste, up to 500) | Enriched firmographics, normalized canonical entity, weighted ICP fit score + score explanation. | **Phase 4 Deliverable** (currently in `draft` status — see §4.7 for safety assertion). |

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

### 4.7 Bulk ICP Enrichment Draft Invariant (`bulk_icp_enrichment`)
- [ ] **4.7.1** 🔴 Directly navigate to `/templates?key=bulk_icp_enrichment`.
      ✅ Expect: Page displays *"This template couldn't be loaded right now"* or renders in preview with execution disabled.
- [ ] **4.7.2** 🧪 Query in Supabase:
      `select template_key, status from workflow_templates where template_key='bulk_icp_enrichment';`
      ✅ Expect: `status = 'draft'`. (Must never be marked `published` before Phase 4 ships its serverless queue runner).

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

## §12 — SQL Data Integrity Sweep

Execute the following verification queries in the Supabase SQL editor:

```sql
-- 12.1 No orphaned runs without corresponding versioned template
select count(*) from template_runs r
 where not exists (
   select 1 from workflow_templates t
    where t.template_key = r.template_key and t.version = r.template_version
 );
-- ✅ Expect: 0

-- 12.2 No shared report without an active slug
select count(*) from reports where visibility not in ('private', 'revoked') and slug is null;
-- ✅ Expect: 0

-- 12.3 No revoked report lost its slug (slug retention prevents reissuance)
select count(*) from reports where visibility = 'revoked' and slug is null;
-- ✅ Expect: 0

-- 12.4 Exactly one published version per template key
select template_key, count(*) from workflow_templates
 where status = 'published' group by template_key having count(*) > 1;
-- ✅ Expect: 0 rows

-- 12.5 Ledger contains no zero-credit transactions
select count(*) from credit_ledger where credits = 0;
-- ✅ Expect: 0

-- 12.6 RLS is enabled on all newly introduced tables
select tablename from pg_tables
 where schemaname = 'public'
   and tablename in ('workflow_templates', 'template_runs', 'template_run_sources',
                     'credit_ledger', 'credit_estimates', 'extracted_fields',
                     'field_provenance', 'reports', 'report_grants',
                     'report_access_log', 'pql_scores', 'activation_events')
   and not rowsecurity;
-- ✅ Expect: 0 rows
```

---

## §13 — Known Gaps & Roadmap Alignment (Phases 4–7)

| Feature / PRD Area | Current Status | Delivery Target | Architectural Detail |
|---|---|---|---|
| **Bulk ICP Enrichment** (PRD 3) | Seeded as `draft` | **Phase 4** | Requires `0041_bulk_enrichment.sql`, chunked durable runner (`enrichment-worker.js`), canonical entity dedup, and customer-editable ICP rule editor (`icp_score_rules`). |
| **Competitor Watchlists & Change Diffs** (PRD 4) | In design / Pending | **Phase 5** | Requires `0042_watchlists.sql`, page category discovery, deterministic `materialityModel.js` (critical/high/medium/low), fact vs interpretation columns, digests, and feedback loops. |
| **Native Signal Routing & Rules** (PRD 5) | Event model partial | **Phase 6** | `KIND_WHITELIST` expanded (16 events). User-facing if-this-then-that rule builder (`0043_signal_rules.sql`, `ruleModel.js`) and sample tester pending. |
| **Template Duplication / Forking UI** | Entitlement gated | **Phase 7** | Backend permissions exist; custom in-browser schema editor is a follow-up. |
| **Report PDF/CSV Direct Export** | Deferrable | **Phase 7** | Reports render in web view; direct download buttons scheduled for release packaging. |
