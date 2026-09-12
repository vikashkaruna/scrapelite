# DatIQ Model Council — Final Synthesis Report
**Rebranding & Augmenting DatIQ into a Complete Web + Social + Data Intelligence Platform**
Version 1.0 · August 2026 · Confidential

---

## 1. Council Composition & Method

Five council seats reviewed all source inputs — the MiniMax market/product analysis, the Claude execution blueprint, the DeepSeek/ZAi strategic blueprints, the Gemini "Intelligence Platform" repositioning paper — plus a live re-inspection of datiq.app (August 2026).

| Seat | Perspective | Primary lens |
|---|---|---|
| **Business Analyst (BA)** | Market sizing, competitive benchmarks, unit economics | Is the economics real? |
| **Product Owner (PO)** | Feature prioritization, release packaging, roadmap integrity | What ships, in what order, why? |
| **Development Head (DH)** | Effort, architecture, technical risk, sequencing dependencies | Can we build it with 3–5 engineers? |
| **Operations Head / Critic (OH)** | Reliability, compliance, cost-to-serve, support load, anti-bot/API risk | What breaks at scale? |
| **Persona Panel (PP)** | Four user voices: RevOps/sales lead, CMO/brand director, developer/AI-agent builder, founder-executive | Would I pay, and for what? |

Method: each seat independently scored the cumulative feature superset (74 distinct features extracted across all five reports), debated the eleven material conflicts between reports, and converged on verdicts recorded below. No report was discarded; every differentiating feature appears in the roadmap (File 02), even where deferred.

---

## 2. Live Website Findings (August 2026 re-inspection)

The council re-fetched datiq.app before scoring. **Material change since the MiniMax report (July 2026):**

- Site metadata now reads *"The Unified Web Intelligence Platform — extract, enrich and operationalize data from any public URL, batch, or scheduled run. Built on Pillar 0 (Web Intelligence Core)."*
- **Already live (do not re-build):** single-URL extraction, **batch extraction**, **scheduled runs**, AI enrichment/summary, freemium entry, a "Pillar" module framing, and an active brand line evolution ("Intelligence from Web").
- **Still unresolved (confirmed):** the site remains a client-rendered SPA serving only `<head>` metadata to crawlers; no indexed subpages, no public pricing page, no docs/changelog/blog, no result permalinks, no discoverable API, no social/Product Hunt footprint.

**Council implication:** MiniMax's #1 structural finding — near-zero public footprint — remains the binding constraint. Batch and scheduling being live *raises* the urgency: DatIQ now has more product than the market can see. Growth/visibility work is therefore **Release 0, non-negotiable**, running in parallel with platform build — a correction to the Claude/DeepSeek blueprints, which jump straight to platform infrastructure.

---

## 3. The Eleven Debates & Verdicts

**D1 — Category & positioning.** Gemini argues "URL analysis" is an input, not an outcome; reposition as an Intelligence Platform. MiniMax cautions the single-URL "magic moment" is the product's best conversion asset. **Verdict (unanimous):** both. Keep the one-box magic moment as the front door; reposition the *company* as a unified intelligence platform organized into Intelligence Pillars (the site's own "Pillar 0" language confirms this direction is already internalized). Category: **Unified Web & Data Intelligence Platform** — the orchestration layer across scraping, social listening, competitive/brand intelligence, and CRM automation, which no single competitor (Firecrawl, Brandwatch, Crayon, Similarweb, Apollo) occupies.

**D2 — Tagline.** Candidates: "Web Intelligence, Delivered." (Claude), "Unified Web, Social, and Pipeline Intelligence" (DeepSeek/ZAi), "Intelligence. Connected." (Gemini), current "Intelligence from Web". **Verdict (4–1, BA dissenting for Claude's option):** primary **"DatIQ — Intelligence, Connected."** (memorable, pillar-proof, implies the connector moat); enterprise descriptor *"Turn web, social, and market signals into automated revenue workflows."*; retain "Web Intelligence, Delivered." as the A/B challenger. Full rationale in File 06.

**D3 — Growth-first vs platform-first.** MiniMax: fix SEO/shareability first. Claude/DeepSeek: build API + pipeline first. **Verdict:** parallel tracks. Release 0 (Weeks 1–4) pairs the growth quick wins (SSR permalinks, export, programmatic SEO, changelog, launch) with API/infra foundation. Growth work is ~12 person-days and compounds; deferring it wastes every later launch.

**D4 — Pricing anchor.** Claude: $29/$79. DeepSeek/ZAi: $99/$499/$1,999. Gemini: $29/$99/$399/$1,499. **Verdict (OH + BA led):** DeepSeek's $99 entry is indefensible for a product with zero reviews and no public footprint; Claude's $79 ceiling under-monetizes the connector/competitive value. Adopt the **Gemini-shaped 4-tier ladder (Free / Starter $29 / Pro $99 / Business $399 / Enterprise custom) with modular add-ons** — the add-on architecture (AI Visibility, Social Topic Packs, Executive Intelligence) is the mechanism that lets pricing scale toward DeepSeek's enterprise ambition without gating early adoption. Detail in File 05.

**D5 — Social Listening scope.** DeepSeek specifies Kafka + ClickHouse + Playwright grids; Claude specifies Supabase + Redis with three sources. **Verdict (DH decisive):** for a 3–5 engineer team, DeepSeek's architecture is a Series-B stack, not an MVP. Ship Claude's pragmatic architecture (Supabase/Postgres + Redis, Twitter/X + Reddit + RSS) **but adopt DeepSeek's schema ideas** — intent classification (purchase_intent / churn_risk), reach_score, and the 300%-spike / 40%-negative / high-influence alert triggers — because intent tagging is the genuinely differentiating field no mainstream SMB tool exposes. Merged spec in File 04.

**D6 — AI Visibility / AEO monitoring.** Gemini and DeepSeek both flag tracking brand presence in ChatGPT/Perplexity/Gemini/Claude answers as a fast-growing category. Absent from Claude and MiniMax reports. **Verdict (unanimous, PP-CMO strongest advocate):** this is the single highest-differentiation feature in the superset — nascent category, premium willingness-to-pay, natural fit with DatIQ's extraction engine. Scheduled for R3 as a paid add-on and its own persona landing page from R0 (rank for the category before the category matures).

**D7 — Calendly pre-meeting briefing.** Only the Claude report develops this (auto-brief on booking: extract company site → Apollo enrich → HubSpot note → email brief). **Verdict:** protected. PP-RevOps rated it the most "screenshot-worthy" workflow in the entire plan; it alone can justify Pro. R2.

**D8 — Executive Intelligence.** Gemini's CEO/board morning-brief module. **Verdict:** high strategic value, but requires multi-source maturity; R4 module, with a lightweight "Daily Digest email" precursor shipping in R1 (already specced by Claude as P1-21).

**D9 — Knowledge graph & autonomous agents.** Gemini rates both "Exceptional/Exceptional." **Verdict:** DH and OH veto for Year 1 — highest effort, highest ops burden; premature before retention proves out. R5 (Year 2), with the schema designed graph-ready from R1 (entity tables, [[links]] between mentions/companies/contacts) so the option stays cheap.

**D10 — Self-healing extraction & anti-bot.** MiniMax (Kadoa parity) and DeepSeek (LLM-fallback parsing) both raise it. **Verdict:** adopt DeepSeek's *semantic-LLM-fallback* pattern early (it is cheap insurance inside the existing pipeline, R1) and defer the full validation/self-healing layer to R4.

**D11 — Compliance timing.** SOC 2 / SSO / RBAC. **Verdict:** trigger-based, per MiniMax: begin SOC 2 evidence collection in R2 (cheap), certify in R4 only when enterprise pipeline justifies spend. RBAC ships with team workspaces in R4.

---

## 4. Consolidated Strategic Direction

**One platform, six pillars, one graph underneath.**

```
DatIQ Platform
├── Pillar 0  Web Intelligence Core      (LIVE: single/batch/scheduled extraction, enrichment)
├── Pillar 1  Social Intelligence        (R1: listening, sentiment, intent, alerts)
├── Pillar 2  Competitive Intelligence   (R2: company workspace, change detection, battlecards)
├── Pillar 3  Brand & AI Visibility      (R3: SoV, AEO/LLM answer monitoring, content engine)
├── Pillar 4  Revenue Automation         (R1–R2: HubSpot, Apollo, Stripe, Calendly, Zapier/n8n)
└── Pillar 5  Executive & Autonomous     (R4–R5: exec briefs, agents, knowledge graph)
```

**Kill criteria / re-scoring triggers** (carried from MiniMax, endorsed): if analytics show developer/agent-builder dominance, pull MCP server + API forward; if CMO/brand dominance, pull AI Visibility into R2; if activation <20%, freeze acquisition spend and fix onboarding.

**North-star metrics by release:** R0 — >50 indexed pages, organic baseline established; R1 — activation ≥30%, free→paid ≥3%; R2 — WAU/MAU ≥40%, D30 retention lift from scheduling/alerts; R3 — free→paid ≥5%, add-on attach ≥15%; R4 — first 5 enterprise logos, NRR ≥110%.

---

## 5. What Each Model Uniquely Contributed (traceability)

| Source | Unique contributions preserved in final plan |
|---|---|
| **MiniMax** | Growth-first Release 0; SSR permalinks; programmatic SEO; persona routes; weighted scoring model (reused); benchmarks (activation 20–40%, free→paid 3–5%/8%, WAU/MAU 40–60%); re-scoring triggers; competitor pricing baseline |
| **Claude blueprint** | Task-level 12-week plan (P0/P1 IDs, reused in File 03); Calendly meeting-brief workflow; connector 5-method abstraction; tier feature matrix mechanics; Sprint 1.4 "breathing room" principle |
| **DeepSeek / ZAi** | Intent classification (purchase/churn); reach_score; alert trigger thresholds + 30-min suppression; LLM-fallback parsing; unit-economics per 1,000 ops ($0.60 COGS, 80% GM target); Social Writer & Community Moderator module; add-on packs |
| **Gemini** | Intelligence-domain architecture; AI Visibility/AEO category; Executive Intelligence; Company Intelligence workspace; knowledge graph + agent layer; "Intelligence. Connected." tagline; cross-connector workflows; 4-layer platform model |
| **Live site review** | Batch + scheduling already shipped (removed from backlog); "Pillar" naming adopted platform-wide; confirmed SSR/SEO gap persists |

---

## 6. Deliverable Index

| File | Contents |
|---|---|
| 02_Prioritized_Feature_Release_Roadmap.md | 74-feature superset scored & bundled into Releases 0–5 (v1.1 → v4.0) |
| 03_12Week_Sprint_Plan_Phase0_Phase1.md | Task-level plan, owners, person-day estimates, dependencies, risks |
| 04_Social_Listening_MVP_Spec.md | Sources, schema, UI, alerting — merged Claude × DeepSeek spec |
| 05_Pricing_Packaging_Revenue_Model.md | 4-tier + add-on model, 24-month projections, unit economics |
| 06_Homepage_Rebrand_Hero_Concepts.md | Final copy + 3 hero concepts with layout specs and A/B plan |
