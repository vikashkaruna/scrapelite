# DatIQ — Prioritized Feature Release Roadmap
**Cumulative superset of all model-council reports, scored and bundled into trackable releases**
Version 1.0 · August 2026

---

## 1. Scoring Model

Each feature scored 1–5 on six weighted parameters (MiniMax model, extended with a Conversion lens per the founder's success criteria):

| Parameter | Weight | Measures |
|---|---|---|
| Impact | 0.22 | Revenue / market-reach potential |
| Conversion | 0.15 | Direct lift to free→paid or sign-up conversion |
| Engagement | 0.15 | Retention / habit formation |
| Effort-ease | 0.18 | Higher = lower engineering effort for a 3–5 eng team |
| Differentiation | 0.15 | Uniqueness vs Firecrawl / Browse AI / Brandwatch / Crayon / Apollo |
| Strategic fit | 0.15 | Fit to platform thesis & monetization architecture |

Composite ≥4.2 → Release 0–1 candidate · 3.7–4.2 → R2 · 3.3–3.7 → R3 · <3.3 or gated by triggers → R4–R5.
**Already live (excluded from backlog):** single-URL extraction, batch extraction, scheduled runs, AI enrichment/summary, heading/link/contact/pricing extractors, freemium entry, Pillar-0 module framing.

---

## 2. Release Map at a Glance

| Release | Version | Window | Theme | Revenue event |
|---|---|---|---|---|
| **R0** | v1.1 | Weeks 1–4 | Foundation & Visibility | — (acquisition engine) |
| **R1** | v2.0 | Weeks 5–12 | Platform Launch: Social + Connectors + Monetization | Paid tiers go live |
| **R2** | v2.5 | Months 4–6 | Competitive & Company Intelligence | Pro-tier expansion |
| **R3** | v3.0 | Months 7–9 | Brand, AI Visibility & Content Engine | Add-on revenue begins |
| **R4** | v3.5 | Months 10–12 | Enterprise, Trust & Reliability | Enterprise tier opens |
| **R5** | v4.0 | Year 2 | Autonomous & Predictive Intelligence | Platform licensing |

---

## 3. Release 0 — v1.1 "Foundation & Visibility" (Weeks 1–4)

*Fixes the binding constraint: a working product the market cannot see. Runs parallel with API/infra foundation (File 03, Phase 0).*

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 0.1 | **SSR + deep-linkable result permalinks** (`/r/{id}`, `/site/{domain}`) | MiniMax | **4.55** | Every extraction becomes a shareable, indexable SEO asset; #1 structural fix |
| 0.2 | **One-click JSON / CSV / Markdown export** | MiniMax, DeepSeek | **4.50** | Table stakes vs every competitor; unblocks analyst & developer personas |
| 0.3 | **REST API v1** (`/v1/extract`, `/v1/batch`, `/v1/schedules`) + API keys + OpenAPI/Swagger docs | Claude, DeepSeek | 4.40 | Unlocks Zapier, webhooks, agent builders; prerequisite for R1 connectors |
| 0.4 | **Persona landing routes** (/lead-generation, /competitor-pricing, /seo-audit, /developers, /ai-visibility) | MiniMax, Gemini | 4.30 | Include /ai-visibility now to rank early in the nascent AEO category |
| 0.5 | **Programmatic SEO pages** ("Extract contacts from {domain}" etc.) | MiniMax | 4.20 | Long-tail acquisition engine; Browse AI/Thunderbit playbook |
| 0.6 | **Accounts + saved history + collections** | MiniMax, Gemini | 4.15 | Retention prerequisite; weekly-habit users convert 3–4× |
| 0.7 | **Public changelog + docs hub + Product Hunt & social launch** | MiniMax | 4.10 | Trust surface; zero footprint is the #1 credibility gap |
| 0.8 | **Rebrand rollout** — new identity system, tagline, homepage (File 06) | All | 4.10 | Ship before feature UI so nothing is built twice |
| 0.9 | **Modular routing shell** (/extract /social /brand /connect /settings) | Claude | 4.00 | Platform chassis for all pillars |
| 0.10 | **Webhooks (extraction-complete, schedule-run)** | Claude, DeepSeek | 3.95 | Cheap now (rides API work); enables Make/Zapier community recipes |

**Exit criteria:** >50 indexed pages · organic baseline measurable · activation (first successful extraction) ≥20% · API publicly documented.

---

## 4. Release 1 — v2.0 "Platform Launch" (Weeks 5–12)

*The revenue inflection. Detailed task plan in File 03; Social spec in File 04; pricing in File 05.*

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 1.1 | **Social Listening MVP** — Twitter/X + Reddit + RSS, keyword tracking, sentiment + **intent tagging** (purchase_intent / churn_risk), mention feed, spike/negative/influencer alerts | Claude ⊕ DeepSeek | **4.45** | Intent tagging is the differentiator vs Brand24/Brandwatch-SMB |
| 1.2 | **Stripe billing + 4-tier pricing + usage metering + self-serve upgrade flow** | Claude, DeepSeek, Gemini | 4.40 | Enables all revenue; tier gates per File 05 |
| 1.3 | **HubSpot connector** (bi-directional contacts/companies/deals, social→CRM notes) | All | 4.35 | Most-requested workflow; Starter-tier conversion driver |
| 1.4 | **Apollo connector** (contact/company enrichment, email verification, sequence push) | All | 4.25 | Extract→Enrich→Sync pipeline = killer use case; user-key model keeps COGS ~0 |
| 1.5 | **Change-detection alerts on scheduled runs** (diff engine + notify) | MiniMax | 4.20 | Scheduling is live; the *alerting* on change is the retention lever and fulfills the "competitor pricing tracker" promise |
| 1.6 | **Connector management UI + field-mapping engine** | Claude | 4.05 | 5-method abstraction (authorize/test/sync/map/disconnect) — pays off every later connector |
| 1.7 | **Usage dashboard** (credits, mentions, API calls, quotas) | Claude | 4.00 | Transparency reduces churn + support load |
| 1.8 | **Competitive keyword tracking + trend comparison charts** | Claude | 3.95 | Positions vs Klue/Crayon at 1/20th price |
| 1.9 | **Email digest reports** (daily/weekly social + change summary) | Claude, Gemini | 3.90 | Retention mechanism; precursor to Executive Intelligence |
| 1.10 | **Historical backfill (30 days) for tracked keywords** | Claude | 3.75 | Instant time-to-value on first keyword |
| 1.11 | **LLM semantic-fallback parsing** (selector fails → semantic extract) | DeepSeek | 3.75 | Cheap resilience now; full self-healing deferred to R4 |
| 1.12 | **Product analytics** (PostHog: activation, funnel, cohorts) | Claude | 3.70 | Feeds all re-scoring triggers |
| 1.13 | **Onboarding wizard** (first keyword, first connector, first alert) | Claude | 3.70 | Guards the ≥30% activation target |

**Exit criteria:** free→paid ≥3% · WAU/MAU trending to 40% · first 50 paying workspaces · churn <5%/mo.

---

## 5. Release 2 — v2.5 "Competitive & Company Intelligence" (Months 4–6)

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 2.1 | **Company Intelligence workspace** — domain/name → profile, products, leadership, funding, hiring, tech stack, news, SWOT, AI summary | Gemini | **4.20** | Flagship module; the "one URL, whole company" magic moment scaled |
| 2.2 | **MCP server + agent-ready API** | MiniMax, ZAi | 4.15 | Opens AI-agent/RAG buyer segment (Firecrawl/Simplescraper parity, plus intelligence layers they lack) |
| 2.3 | **Calendly connector — automated pre-meeting briefings** (booking → extract → Apollo enrich → HubSpot note → brief email) | Claude | 4.10 | Council-protected feature; justifies Pro alone for sales pros |
| 2.4 | **Competitive Intelligence module** — competitor tracking, pricing/feature-change monitoring, website diffs, battlecards, win/loss notes | Gemini, MiniMax | 4.05 | Builds on 1.5 diff engine; Crayon/Klue displacement |
| 2.5 | **Prebuilt extraction templates for popular sites** | MiniMax | 3.85 | Browse AI (150+) / Thunderbit parity; community-submittable later |
| 2.6 | **Zapier + Make + Google Sheets + Airtable integrations** | MiniMax | 3.85 | 7,000-app reach via one listing each |
| 2.7 | **Slack + Teams alert channels** | DeepSeek, Gemini | 3.80 | Where SMB teams actually live |
| 2.8 | **Research Workspace** (projects, pinned reports, saved searches, favorites) | Gemini | 3.75 | Multi-user groundwork; switching-cost builder |
| 2.9 | **YouTube comments + news sources for social pillar** | Gemini, ZAi | 3.70 | Source expansion, Pro-tier gate |
| 2.10 | **SOC 2 evidence collection begins** (policies, logging, vendor review) | Council (D11) | 3.60 | Cheap now, certify in R4 |
| 2.11 | **Mobile-responsive pass + WCAG 2.1 AA across new modules** | Claude | 3.55 | Quality/reach parameter |

---

## 6. Release 3 — v3.0 "Brand, AI Visibility & Content Engine" (Months 7–9)

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 3.1 | **AI Visibility / AEO monitoring** — track brand presence, citations & recommendation share across ChatGPT, Perplexity, Gemini, Claude, Copilot; optimization guidance | Gemini, DeepSeek | **4.30** | Highest-differentiation feature in the superset; premium add-on ($99/mo); nascent category (vs Profound, HubSpot AEO) |
| 3.2 | **Brand Intelligence / Share-of-Voice engine** — SoV matrix, brand health score, reputation trends, crisis detection | DeepSeek, Gemini, ZAi | 4.05 | Elevates sentiment into CMO-grade analytics |
| 3.3 | **Verified contact enrichment** (email/phone verification waterfall) | MiniMax | 3.90 | Gate: pursue only if GTM persona dominates analytics (trigger honored) |
| 3.4 | **Social Posts Writer & Thread Generator** — turn extractions + trends into LinkedIn/X drafts | ZAi | 3.80 | Extraction-signal-fed content is the differentiator vs Buffer/Taplio |
| 3.5 | **Community Moderator** — scan brand-post comments, flag negatives, auto-draft replies, escalate | ZAi | 3.65 | Seat-license monetization; support-team appeal |
| 3.6 | **LinkedIn company-page + Instagram/Facebook public sources** (subject to API constraints) | Gemini, DeepSeek | 3.60 | OH flag: partnership/API risk — timeboxed spike first |
| 3.7 | **Influencer discovery & reach mapping** | Gemini, DeepSeek | 3.55 | reach_score field (File 04) makes this near-free |
| 3.8 | **Campaign performance tracking** (tag mentions to campaigns) | Gemini | 3.50 | CMO persona depth |
| 3.9 | **Public template/recipe gallery + community sharing** | Council | 3.45 | UGC-driven programmatic SEO flywheel |

---

## 7. Release 4 — v3.5 "Enterprise, Trust & Reliability" (Months 10–12)

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 4.1 | **Team workspaces + roles/RBAC + audit logs** | Claude, DeepSeek | 4.00 | Enterprise gate-opener |
| 4.2 | **SSO/SAML + SOC 2 Type II certification + GDPR/DPDPA posture** | DeepSeek, MiniMax | 3.95 | Trigger: ≥5 enterprise-qualified opportunities in pipeline (met per projections) |
| 4.3 | **Self-healing extraction + validation layer** (auto-repair selectors, anomaly QA on outputs) | MiniMax, DeepSeek | 3.85 | Kadoa parity; reliability = enterprise trust |
| 4.4 | **Salesforce + Pipedrive + Dynamics connectors** | Claude, Gemini | 3.80 | AppExchange listing lead time — start approval in R3 |
| 4.5 | **Executive Intelligence module** — one-click CEO/board morning brief, industry summary, competitor summary | Gemini | 3.80 | Built on digest engine + company/competitive pillars |
| 4.6 | **Anomaly detection service hardening** (volume/sentiment models, PagerDuty channel) | DeepSeek | 3.65 | Ops maturity for enterprise SLAs |
| 4.7 | **Dedicated proxy pools + data-residency options (incl. India region)** | DeepSeek, Council | 3.60 | Enterprise add-on ($250/mo); DPDPA-relevant for Indian accounts |
| 4.8 | **Advanced admin console** (user mgmt, subscription ops, system health) | Claude | 3.55 | Support-cost control at scale |
| 4.9 | **Customer Intelligence (v1)** — reviews + tickets + NPS ingestion, churn-risk surfacing | Gemini | 3.45 | Leverages intent_class=churn_risk pipeline |

---

## 8. Release 5 — v4.0 "Autonomous & Predictive Intelligence" (Year 2)

| # | Feature | Source(s) | Composite | Notes |
|---|---|---|---|---|
| 5.1 | **Autonomous AI Agents** — Research, Competitive, Brand, Sales, Executive, Compliance agents running scheduled autonomous workflows | Gemini | 4.10* | *Exceptional impact/differentiation, gated on retention proof; schema made agent-ready from R1 |
| 5.2 | **Knowledge Graph** — entities (companies, people, products, brands) correlated across all pillars | Gemini | 3.95* | The long-term moat; graph-ready schema decision already paid in R1 |
| 5.3 | **Virality prediction & trend forecasting** | Gemini | 3.50 | Predictive layer on topic_metrics time series |
| 5.4 | **Multi-modal ingestion** — PDF, DOCX, CSV, audio, video, email, images | Gemini | 3.50 | "Intelligence from Everywhere"; expands beyond web |
| 5.5 | **Market Intelligence module** — TAM/SAM/SOM estimation, market maps, emerging-player detection | Gemini | 3.45 | Similarweb-adjacent; analyst persona |
| 5.6 | **Risk Intelligence** — vendor/cyber/compliance/ESG monitoring | Gemini | 3.40 | BFSI/enterprise wedge (strong India public-sector resonance) |
| 5.7 | **Sub-product packaging** — DatIQ Brand / Social / Sales / Executive / Research sold standalone on shared platform | Gemini | 3.40 | Portfolio commercialization once pillars mature |
| 5.8 | **Marketplace & partner ecosystem** (connectors, templates, agents) | Council | 3.35 | Platform-economy endgame |

---

## 9. Standing Re-Scoring Triggers

1. **Developer/agent-builder dominance in analytics** → pull 2.2 (MCP) and 4.3 into R1–R2.
2. **CMO/brand dominance** → pull 3.1 (AI Visibility) and 3.2 into R2.
3. **GTM/lead-gen dominance** → pull 3.3 (verified enrichment) into R2.
4. **Activation <20% at R0 exit** → freeze acquisition, redirect one sprint to onboarding.
5. **Scheduling/alerts fail to lift D30 retention in R1** → reprioritize integrations (2.6) forward.
6. **Enterprise inbound before R3** → accelerate 4.1/4.2.

## 10. Feature Count Reconciliation

74 unique features extracted across five reports → 7 already live (excluded) → 10 in R0 · 13 in R1 · 11 in R2 · 9 in R3 · 9 in R4 · 8 in R5 · 7 absorbed as sub-items of listed features (e.g., NER inside 1.1; donut/SoV charts inside 3.2; deduplication inside pipeline). **Nothing from any model report was dropped.**
