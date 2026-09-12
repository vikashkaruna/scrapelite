# DatIQ — 12-Week Sprint Plan (Phase 0 & Phase 1)
**Council-reconciled execution plan · tasks, owners, engineering estimates, dependencies**
Version 1.0 · August 2026

---

## 0. Team, Cadence & Assumptions

**Team (5.5 FTE):** Backend Lead (BE-L), Backend Engineer (BE-2), Frontend Lead (FE-L), Full-Stack Engineer (FS), ML Engineer (ML, 0.5 FTE from Wk 3), Designer (DS, 0.75 FTE), PM/Founder. Capacity ≈ 50 person-days/sprint; plans target ≤80% (15–20% buffer, per Claude blueprint).
**Cadence:** 2-week sprints · Mon planning · daily standups · Thu demo · Fri retro.
**Stack (DH verdict, D5):** Next.js + Supabase(Postgres) + Redis + BullMQ + Stripe. **No** Kafka/ClickHouse/Playwright-grid in this 12-week window; DeepSeek's scale architecture is documented as the R4 migration path.
**Pre-work (Week 0):** request Twitter/X Basic API access, Stripe sandbox, HubSpot developer app + Marketplace application, Apollo API docs review — all external approval clocks start before Sprint 0.1.
**Adjustments vs Claude blueprint:** batch + scheduling are already live (tasks removed); their capacity is redirected to R0 growth work (SSR, programmatic SEO) and the change-detection diff engine.

---

## 1. Phase 0 — Foundation & Visibility (Weeks 1–4)

### Sprint 0.1 (Weeks 1–2) — API, SSR & Rebrand Assets — 39 pd planned / 50 capacity

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P0-01 | REST API v1: `/v1/extract`, `/v1/batch`, `/v1/schedules` wrapping live engine | BE-L | 5 | — |
| P0-02 | API key management (generate/revoke/rotate, per-tier rate limits in Supabase+Redis) | BE-L | 2 | P0-01 |
| P0-03 | OpenAPI 3.0 spec + Swagger UI + quickstart docs | BE-2 | 2 | P0-01 |
| P0-04 | **SSR result permalinks** `/r/{id}` + `/site/{domain}` with OG cards (Next.js SSR/ISR) | FS | 5 | — |
| P0-05 | **JSON / CSV / Markdown export** on all result surfaces + API | BE-2 | 2 | — |
| P0-06 | Brand identity system v1.0 (logo, palette, type — Inter UI / display serif marketing, tokens, icons) | DS | 4 | — |
| P0-07 | Figma component library on new tokens (buttons, cards, tables, modals, nav) | DS | 3 | P0-06 |
| P0-08 | Modular routing shell: `/extract` `/social` `/brand` `/connect` `/settings` + feature flags | FE-L | 3 | — |
| P0-09 | Schema extensions: `social_mentions`, `tracked_keywords`, `connectors`, `webhooks`, `billing_events`, `audit_logs` + entity tables (graph-ready IDs) | BE-L | 3 | — |
| P0-10 | Redis caching layer (result cache, TTL, per-user quotas) | BE-2 | 2 | P0-01 |
| P0-11 | Accounts hardening + **saved history & collections** data model + UI | FS | 4 | P0-09 |
| P0-12 | Persona landing routes scaffold (5 routes incl. `/ai-visibility`) with shared URL-box component | FE-L | 3 | P0-08 |
| P0-13 | Analytics foundation: PostHog events (sign-up, first-extract, export, share) | FS | 1 | — |

**Sprint risks:** brand-kit scope creep (DS timeboxed to v1.0); API rate-limit design complexity may push P0-03 into Wk 3 (acceptable).

### Sprint 0.2 (Weeks 3–4) — Ingestion, Billing & Rebrand Launch — 40 pd planned

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P0-14 | Social ingestion pipeline: X API v2 collector (5-min), Reddit/PRAW (15-min), RSS parser (30-min) → normalization layer → BullMQ queue | BE-L | 5 | P0-09 |
| P0-15 | Webhook system (extraction-complete, schedule-run, mention-detected; HMAC-signed) | BE-2 | 3 | P0-01, P0-09 |
| P0-16 | Stripe Checkout + Customer Portal (Free/Starter/Pro/Business) | BE-L | 3 | P0-09 |
| P0-17 | Usage metering (extraction credits, mention quotas, API calls per cycle) | BE-2 | 2 | P0-16 |
| P0-18 | **Change-detection diff engine v1** on scheduled runs (content hash + field-level diff, stored deltas) | FS | 4 | — |
| P0-19 | Rebranded homepage + pricing page + module cards (File 06 copy, Concept A hero) | FE-L + DS | 5 | P0-06/07/08 |
| P0-20 | **Programmatic SEO generator** (template pages from extraction corpus) + sitemap + robots | FS | 3 | P0-04 |
| P0-21 | Public changelog + docs hub (markdown-driven) | FE-L | 2 | — |
| P0-22 | CI/CD + automated tests (API unit, pipeline integration, E2E core flows) | BE-2 | 2 | P0-01, P0-14 |
| P0-23 | Sentiment/intent model prep: evaluate hosted LLM classifier vs fine-tuned baseline on public X/Reddit datasets (decision gate for P1-03) | ML | 4 | — |
| P0-24 | **Launch ops:** Product Hunt assets, @datiq_app activation, launch-day plan | PM + DS | 3 | P0-19 |
| P0-25 | Deploy rebrand to production behind flags; Phase-1 modules dark | FS | 1 | P0-19 |

**Phase 0 exit:** public API + docs live · rebrand shipped · >50 pages indexed or queued · billing sandbox-verified · ingestion filling `social_mentions` in staging · PH launch executed or scheduled.

---

## 2. Phase 1 — Core Intelligence Modules (Weeks 5–12)

### Sprint 1.1 (Weeks 5–6) — Social Listening MVP Core — 40 pd planned

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P1-01 | Social dashboard UI: summary bar, volume sparkline, mention feed, keyword panel (3-pane, File 04 §4) | FE-L | 5 | P0-08, P0-14 |
| P1-02 | Keyword/brand tracking engine (match, store, dedupe) | BE-L | 4 | P0-14 |
| P1-03 | Sentiment + **intent classification** integrated in pipeline (per P0-23 decision; LLM-API fallback path pre-approved) | ML | 4 | P0-23 |
| P1-04 | Mention detail view (full content, author, reach_score, sentiment breakdown, save-to-collection) | FE-L | 2 | P1-01 |
| P1-05 | Alert engine v1: spike (>300%/1-hr baseline), negative (>40%/30-min), high-influence (>100k followers); 30-min Redis suppression; email + in-app + webhook | BE-2 | 4 | P1-02, P0-15 |
| P1-06 | Onboarding wizard (first keyword → sources → first alert) | FS + DS | 3 | P1-01 |
| P1-07 | Cross-module dashboard card (mentions alongside extraction stats) | FS | 2 | P1-01 |
| P1-08 | Sentiment_trends daily rollup job + donut/top-keywords panel | BE-2 | 2 | P1-02 |

**Highest-risk sprint** (ML integration + heavy FE/BE). Mitigation: P0-23 decision gate ensures Sprint 1.1 is integration-only; hosted-classifier fallback pre-approved.

### Sprint 1.2 (Weeks 7–8) — Connectors & Cross-Module Integration — 41 pd planned

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P1-09 | Connector abstraction layer (authorize / test_connection / sync / map_fields / disconnect; registry, encrypted token vault, BullMQ sync engine, token-bucket rate limiter) | BE-L | 4 | P0-09 |
| P1-10 | HubSpot connector: OAuth 2.0, bi-directional contacts/companies, deal creation, social→notes; webhook receiver | BE-L | 5 | P1-09 |
| P1-11 | Apollo connector: people/match, organizations/enrich, email verification; user-provided key; 50%-rate bulk queue | BE-2 | 4 | P1-09 |
| P1-12 | Connector management UI (auth status, sync history, field-map config, disconnect) | FE-L | 4 | P1-10/11 |
| P1-13 | Field-mapping engine (default maps per File 04/blueprints + custom overrides, `datiq_intent_score` custom property) | BE-2 | 3 | P1-10/11 |
| P1-14 | Collections extended to social mentions (polymorphic item type) | FS | 3 | P1-01 |
| P1-15 | Scheduled connector syncs (hourly/daily/weekly) | BE-2 | 2 | P1-10/11 |
| P1-16 | Change-detection **alerts** wired to diff engine (price/feature-change notifications) | FS | 3 | P0-18, P1-05 |
| P1-17 | Metering extended to connector API calls | BE-L | 1 | P0-17 |

**External clocks:** HubSpot Marketplace approval (applied Wk 0); Apollo tier selection.

### Sprint 1.3 (Weeks 9–10) — Pricing Launch & Social Enhancements — 38 pd planned

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P1-18 | Self-service pricing page + Checkout upgrade/downgrade flow (frictionless, per File 05) | FE-L + BE-L | 4 | P0-16, P0-19 |
| P1-19 | Tiered feature gates in router (Social/Connectors/API/limits per tier) | FS | 3 | P0-16 |
| P1-20 | Usage dashboard (credits, mentions, API calls, quotas, projections) | FE-L | 3 | P0-17 |
| P1-21 | 30-day historical backfill for tracked keywords (X + Reddit) | BE-2 | 3 | P1-02 |
| P1-22 | Competitive tracking (competitor keywords, separate analytics, `is_competitor` flag) | FS | 3 | P1-02/03 |
| P1-23 | Sentiment trend comparison charts (own vs competitor, date ranges) | FE-L | 3 | P1-21/22 |
| P1-24 | Email digests (daily/weekly: mentions, sentiment shifts, site-change deltas) | BE-2 | 3 | P1-05, P1-16 |
| P1-25 | **LLM semantic-fallback parsing** in extraction pipeline (selector failure → semantic extract, flagged confidence) | ML | 4 | — |
| P1-26 | Grandfathering & migration comms for existing free users | PM + BE-L | 2 | P1-18 |

**Revenue inflection sprint.** Every extra click in the upgrade flow is conversion lost — pixel-perfect gate.

### Sprint 1.4 (Weeks 11–12) — Polish, Analytics & Phase 2 Prep — 33 pd planned (deliberately light)

| ID | Task | Owner | Est (pd) | Deps |
|---|---|---|---|---|
| P1-27 | Product analytics deep-dive: funnel, retention cohorts, feature adoption, TTV instrumentation | FS | 3 | P0-13 |
| P1-28 | Performance: virtual-scroll feed, lazy loading, cache tuning | FE-L + BE-2 | 3 | P1-01 |
| P1-29 | Accessibility audit + remediation to WCAG 2.1 AA on new modules | FE-L + DS | 3 | P1-01/12 |
| P1-30 | Mobile responsiveness: Social, Connectors, Pricing | FE-L + DS | 3 | P1-18 |
| P1-31 | Internal admin console v1 (users, subscriptions, system health) | BE-L | 3 | P0-16 |
| P1-32 | Bug-bash + tech-debt burn-down from Sprints 1.1–1.3 | All | 5 | — |
| P1-33 | Phase 2 architecture: Company Intelligence data model, MCP server design, Calendly workflow, battlecard schema; ClickHouse/Kafka migration decision memo | BE-L + PM | 3 | All P1 |
| P1-34 | User research: 6–8 interviews on Social MVP + connectors; Phase 2 recommendations doc | PM | 2 | P1-01/10 |
| P1-35 | Security review (RBAC roadmap, key encryption audit, TLS posture) | BE-L | 2 | — |
| P1-36 | v2.0 launch: changelog, PH "Ship" update, case-study capture from beta users | PM + DS | 3 | All |

---

## 3. Summary & Governance

| Sprint | Weeks | Planned pd | Key deliverables |
|---|---|---|---|
| 0.1 | 1–2 | 39 | API v1, SSR permalinks, export, brand kit, routing shell, history |
| 0.2 | 3–4 | 40 | Ingestion pipeline, Stripe, diff engine, rebrand launch, programmatic SEO, PH launch |
| 1.1 | 5–6 | 40 | Social Listening MVP (feed, sentiment+intent, alerts) |
| 1.2 | 7–8 | 41 | HubSpot + Apollo connectors, abstraction layer, change alerts |
| 1.3 | 9–10 | 38 | Pricing live, competitive tracking, digests, semantic fallback |
| 1.4 | 11–12 | 33 | Polish, a11y, mobile, admin, Phase-2 architecture |
| **Total** | | **231 pd** | ≈ 11.5 person-months across 5.5 FTE — fits with buffer |

**Critical path:** P0-14 (ingestion) → P1-02/03 (tracking+ML) → P1-05 (alerts) → P1-18/19 (monetization). **Top 5 risks:** X API cost/limits (fallback: Reddit+RSS-first launch, X as Pro gate) · HubSpot approval delay (fallback: private-app mode for beta) · ML classifier quality (fallback: hosted LLM API) · anti-bot escalation on diff targets (semantic fallback + polite crawl) · scope creep on rebrand (v1.0 timebox).
