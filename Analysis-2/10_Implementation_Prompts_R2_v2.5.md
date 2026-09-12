# DatIQ Implementation Prompts — Release 2 · v2.5 "Competitive & Company Intelligence" (Months 4–6)
Condensed format (all Framework sections present, compressed). Expand any prompt via: *"Expand DP-R2-xx to full anatomy per the Master Framework."* Run after DP-R1-RC; honor any trigger-driven re-sequencing from the R1 council check-in.

---

## DP-R2-01 · Company Intelligence Workspace (2.1)
**Flag:** `company_intel` · **v2.5.0-beta** · after R1-RC
**Feature/stories:** Input domain/name → full company profile: overview, products, leadership, funding, hiring signals, tech stack, recent news, auto-SWOT, AI summary; save to Collections; refreshable; quota-gated (5/50/250 per File 05). Story: AE preps an account in 3 minutes instead of an hour.
**Impact:** Flagship module — "one URL, whole company" at scale; Pro conversion surface; feeds Calendly briefs (R2-03) and Exec Intelligence (R4). Risks: data accuracy/hallucination (every claim carries source link + confidence; "AI-generated" labeling; no-fabrication rule enforced in prompt templates); multi-page crawl cost (crawl budget per profile, cached 7 days).
**Backend:** `company_profiles` table (workspace-scoped cache + shared canonical layer keyed by domain, entities graph-ready); profile builder worker (site crawl via existing engine + news RSS + optional Apollo org enrich if connected); section-level prompt templates; refresh endpoint with staleness policy.
**Frontend:** `/company/{domain}` workspace: tabbed profile (Overview/People/Product/Signals/News/SWOT), source-cited cards, save/refresh/export (reuses R0-02), "Push to HubSpot company" action.
**Testing:** Golden company set (10 known firms) with field-presence + citation assertions; hallucination spot-check protocol (manual rubric on 5 profiles/release); E2E `@company` journey; quota gates.
**Deploy:** Internal → 20-beta → GA v2.5.0. Rollback: flag.
**Docs:** Feature + help + use case (account prep) + changelog + **blog: yes** + OpenAPI (`POST /v1/company`).
**DoD:** Framework + `company.profile_created/refreshed/exported` + accuracy rubric ≥ agreed bar.

## DP-R2-02 · MCP Server + Agent-Ready API (2.2)
**Flag:** `mcp_server` · **v2.5.0** · after R1-RC (pull to front if developer trigger fired)
**Feature:** Hosted MCP server exposing tools: `extract_url`, `batch_extract`, `search_mentions`, `get_company_profile`, `list_changes`; API-key auth mapped to tiers (Pro+); agent-optimized outputs (clean Markdown/JSON, token-frugal); cookbook examples (Claude, LangChain, n8n).
**Impact:** Opens agent/RAG segment (Firecrawl parity + intelligence layers they lack); strategic-fit monetizer. Risks: quota abuse (same metering as API); tool-description drift (generated from OpenAPI annotations, CI-checked).
**Backend:** MCP transport endpoint; tool handlers wrapping v1 API; per-tool metering.
**Frontend:** /developers route update + docs.
**Testing:** MCP protocol conformance suite; tool-call integration tests; token-budget snapshot per tool.
**Deploy:** Beta with 10 waitlisted builders → GA. **Docs:** MCP setup guide + cookbook + changelog + **blog: yes** ("Plug DatIQ into your agents").
**DoD:** `api.mcp_tool_called{tool}` + 10 external integrations confirmed.

## DP-R2-03 · Calendly Connector — Pre-Meeting Briefings (2.3)
**Flag:** `calendly_briefs` · **v2.5.1** · after DP-R2-01, DP-R1-07
**Feature:** Calendly OAuth + `invitee.created/rescheduled/canceled` webhooks → on booking: build/refresh company profile for attendee domain → Apollo person enrich (if connected) → briefing card (company overview, key people, recent news/social sentiment, suggested talking points) → email + HubSpot meeting note; 8am daily digest of all day's meetings. Story: rep wakes to briefs for all six meetings.
**Impact:** Council-protected signature workflow; Pro justification for sales pros; retention driver. Risks: personal-email attendees (skip gracefully, free-domain list); brief accuracy (inherits R2-01 citation rules).
**Backend:** Connector on R1-07 framework; brief assembler worker; attendee-domain resolver; digest scheduler (user-timezone).
**Frontend:** Connector card + brief preview in-app + settings (channels, digest time).
**Testing:** Webhook fixtures full lifecycle; free-domain skip tests; brief snapshot on golden companies; E2E booking-sandbox round trip.
**Deploy:** Beta 10 sales users → GA. **Docs:** Setup help + use case (the 6-meeting morning) + changelog + **blog: yes** (this is the screenshot feature) + runbook.
**DoD:** `connect.brief_generated/opened` + beta NPS comment capture.

## DP-R2-04 · Competitive Intelligence Module (2.4)
**Flag:** `compete_module` · **v2.5.1** · after DP-R1-09, DP-R2-01
**Feature:** `/compete` workspace: competitor registry (linking tracked keywords + monitored URLs + company profiles), change timeline (pricing/feature diffs from R1-09), side-by-side feature/pricing comparison tables (user-curated + extraction-assisted), **battlecards** (auto-drafted from profile+changes+mentions; user-editable; export/share via permalinks), win/loss notes. Pro+.
**Impact:** Crayon/Klue displacement at 1/20th price; Business-tier anchor. Risk: battlecard staleness (freshness stamps + change-triggered re-draft suggestions).
**Backend:** `competitors`, `battlecards` tables; comparison model; battlecard drafter (templated LLM w/ citations); linkage to diffs/mentions/profiles.
**Frontend:** Registry, timeline, comparison grid editor, battlecard editor (blocks), share/export.
**Testing:** Linkage integrity tests; battlecard snapshot on goldens; E2E `@compete` full journey.
**Deploy:** Beta → GA v2.5.1. **Docs:** Feature + help + use case (sales objection handling) + changelog + blog section in R2 post.
**DoD:** `compete.battlecard_created/shared`, `compete.timeline_viewed`.

## DP-R2-05 · Prebuilt Extraction Templates (2.5)
**Flag:** `templates` · **v2.5.2** · after R1-RC
**Feature:** Curated template library (25 at launch: common SaaS pricing pages, directories, job boards, review sites patterns) — one-click apply presets (fields, schedule suggestion, alert suggestion); template detail pages are indexable (pSEO synergy). Community submission deferred to R3-09.
**Impact:** Time-to-value + Browse AI/Thunderbit parity + SEO surface. Risk: template rot (freshness checks piggyback golden corpus; broken templates auto-hidden + alert to ops).
**Backend:** `templates` registry, apply endpoint, health-check worker.
**Frontend:** Gallery (search, categories), detail pages (SSR, indexable), apply flow.
**Testing:** Per-template health fixtures; E2E apply→run.
**Deploy:** GA. **Docs:** Gallery help + changelog + 25 template pages (content = docs).
**DoD:** `extract.template_applied{id}` + gallery→signup conversion tracked.

## DP-R2-06 · Zapier + Make + Sheets + Airtable (2.6)
**Flag:** `automation_integrations` · **v2.5.2** · after DP-R0-08, DP-R1-07
**Feature:** Official Zapier + Make apps (triggers: extraction/batch/schedule completed, change detected, mention alert; actions: run extraction, add keyword); Google Sheets + Airtable export destinations on results/schedules ("send rows on every run").
**Impact:** 7,000-app reach; Starter stickiness. Risks: partner review timelines (submit early; webhook recipes documented as interim); OAuth scope minimalism for Sheets.
**Backend:** Zapier/Make app definitions on API v1 + webhooks; Sheets/Airtable destination adapters on connector framework; per-destination sync logs.
**Frontend:** Destinations picker on schedules/batches; connect flows.
**Testing:** Partner-platform test suites; destination round-trip integration tests; E2E schedule→Sheet rows.
**Deploy:** Private Zapier → public listing; GA in-app. **Docs:** 4 setup helps + recipes page + changelog + blog mention.
**DoD:** `connect.destination_synced{provider}` + Zapier listing live.

## DP-R2-07 · Slack + Teams Alert Channels & Research Workspace (2.7 + 2.8)
**Flag:** `team_surfaces` · **v2.5.3** · after DP-R1-05
**Feature:** Slack + Teams as first-class alert/digest channels (rich cards, channel picker per rule); Research Workspace upgrade: Projects grouping collections/keywords/companies/battlecards, pinned reports, saved searches, favorites, project activity feed.
**Impact:** Meets teams where they live; switching-cost deepener; Business-tier groundwork. Risk: Slack app review (submit early), notification overload (per-channel rule mapping, digest defaults).
**Backend:** Slack/Teams adapters (OAuth, message formatting), `projects` model wrapping polymorphic items, saved-search persistence.
**Frontend:** Channel connect + per-rule routing UI; Projects nav, project home, pin/save controls.
**Testing:** Message-format snapshots; project-scoping RLS tests; E2E project journey + Slack sandbox delivery.
**Deploy:** Beta → GA. **Docs:** Helps (Slack, Teams, Projects) + changelog.
**DoD:** `social.alert_delivered{channel}`, `app.project_created`.

## DP-R2-08 · Source Expansion (YouTube/News) + Compliance Groundwork + Quality Pass (2.9–2.11)
**Flag:** `sources_v2` · **v2.5.3** · after DP-R1-01
**Feature:** YouTube comments + news-API collectors on the collector interface (Pro+ per File 04); SOC 2 evidence collection program start (policies repo, access reviews, logging audit — ops track with engineering support); mobile+WCAG pass on all R2 surfaces.
**Impact:** Source breadth (CMO persona) + cheap-now compliance option + quality parameters. Risk: YouTube API quotas (per-workspace budgets), news-API cost (tier-gated).
**Backend:** Two collectors + fixtures; audit-logging coverage review; retention policy verification.
**Frontend:** Source toggles in keyword settings; a11y/mobile remediations.
**Testing:** Collector fixture suites; axe/Lighthouse budgets on R2 routes.
**Deploy:** GA with tier gates. **Docs:** Source docs + trust page v1 (security posture) + changelog.
**DoD:** `social.mention_ingested{platform=youtube|news}` + evidence-collection tracker initialized.

---

## DP-R2-RC · Release Cut v2.5 → prep R3
Release notes + R2 launch blog ("From extraction to intelligence") · pricing-page badge moves Starter→Pro (File 05 note) · regression + goldens · tag v2.5.3 · council check-in vs R2 exits (WAU/MAU ≥40%, D30 retention lift from alerts, Pro-tier mix) · trigger re-check (esp. /ai-visibility waitlist → may pull R3-01 scope forward or price it $149) · open R3 milestone.
