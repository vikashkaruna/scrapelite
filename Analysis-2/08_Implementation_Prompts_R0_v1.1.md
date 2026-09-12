# DatIQ Implementation Prompts — Release 0 · v1.1 "Foundation & Visibility" (Weeks 1–4)
Run in order. Prepend the GLOBAL SYSTEM CONTEXT (File 07 §2) to each.

---

## DP-R0-00 · Platform Bootstrap (infrastructure for the whole program)
**Feature:** — (enabler) · **Flag:** n/a · **Version:** v1.1.0-alpha · **Run after:** —

**Description & stories.** Stand up the delivery machinery every later prompt depends on. Stories: as an engineer I can gate any change behind a typed flag; as a PM I see a changelog auto-assembled per release; as an agent I can run the full CI gate locally with one command.

**Impact analysis.** No user-facing change; blast radius = CI + repo layout. Risk: over-engineering — timebox to 3 days. Enables: 100% of downstream prompts; without it the docs/deploy contracts are unenforceable.

**Backend.** Create `/lib/flags.ts` (typed registry, env + per-workspace overrides in a `feature_flags` table with RLS); `/docs` + `/content` scaffolds per doc contract; changelog assembler script (`scripts/release-notes.ts` concatenating `/content/changelog/*` by version); PostHog server client + event taxonomy file `/lib/analytics/events.ts` (namespaced `extract.*, social.*, connect.*, billing.*, growth.*`); golden datasets: `/tests/golden/urls.json` (50 frozen URLs + expected field snapshots), `/tests/golden/mentions.json` placeholder (filled in R1); Supabase migration framework check with tested down() template.

**Frontend.** "What's new" modal component reading published changelog entries; flag-aware `<Gated flag="…">` wrapper; error-boundary + toast standards.

**Testing.** CI pipeline (typecheck→lint→unit→integration→E2E→visual) green on main; flag toggling unit-tested; golden extraction test passing against live engine.

**Deployment.** Merge to main, deploy; verify health endpoint + Sentry/PostHog events flowing.

**Docs.** `/docs/internal/engineering-handbook.md` (conventions from Framework §2); `.env.example`; ADR-001 recording actual stack vs assumed.

**DoD.** CI green · flags demoable · changelog assembler produces empty v1.1.0 notes · tracker row DP-R0-00 = Done.

---

## DP-R0-01 · SSR Result Permalinks (Feature 0.1)
**Flag:** `permalinks` · **Version:** v1.1.0 · **Run after:** DP-R0-00

**Description & stories.** Every extraction gets a durable, server-rendered, shareable URL: `/r/{publicId}` (single result) and `/site/{domain}` (latest public result for a domain). As a user I can share a result link that renders rich OG cards in Slack/LinkedIn; as a search crawler I can index result pages; as a returning visitor I land on a result and am invited to run my own extraction (conversion loop).

**Impact analysis.** Highest-composite growth feature (4.55): turns product usage into compounding SEO + virality; directly attacks the #1 structural weakness (zero indexed pages). Systems: extraction storage, routing, caching. Risks: (a) private-data exposure — results private by default, explicit "Make shareable" toggle generates publicId; (b) crawl-budget bloat — index only shared results + curated /site pages; (c) SSR cost — ISR with 24h revalidate. Metrics that must move: indexed pages (>50 in 30 days), share events, referral signups.

**Backend.** Migration: `extractions` add `public_id (nanoid, unique, nullable)`, `is_public bool default false`, `shared_at`. Endpoint `POST /v1/extractions/{id}/share` (auth) returns permalink; `GET /r/{publicId}` server route fetches sanitized result (strip requester identity, respect robots-honored source note). `/site/{domain}` shows latest public extraction + "Analyze this site now" CTA. OG-image generation route (`/api/og/r/[id]`) rendering headline stats card. Sitemap generator includes public results.

**Frontend.** Share button + toggle on result screens (all: single/batch/schedule views); copied-link toast; public result page = read-only result layout + sticky signup CTA + "Run your own" URL box; noindex on private, index on public. States: revoked-link 410 page.

**Testing.** Unit: publicId lifecycle, sanitization. Integration: share→fetch→revoke. E2E `@permalinks`: create→share→open logged-out→CTA signup path. Visual snapshot of /r page. Acceptance: OG card validates in Slack/Twitter debuggers; Lighthouse SEO ≥95 on /r. Smoke script: share 3 real results, fetch logged-out, revoke one, confirm 410.

**Deployment.** Flag ON staging → canary 5% → GA within 3 days (low risk). Rollback: flag off hides share UI; existing public links keep serving (product decision — record in ADR).

**Docs & content.** feature doc + help ("Sharing results") + use case (sales rep shares prospect teardown) + changelog + **blog: yes** ("Every DatIQ result is now a link") + OpenAPI update + robots/sitemap doc note.

**DoD.** Framework checklist + `growth.result_shared`, `growth.public_result_viewed`, `growth.public_result_signup` events verified in PostHog.

---

## DP-R0-02 · Export Everywhere: JSON / CSV / Markdown (0.2)
**Flag:** `export` · **Version:** v1.1.0 · **Run after:** DP-R0-00

**Description & stories.** One-click export of any result (single row or batch set) as JSON, CSV, Markdown; same formats via API `Accept` header / `?format=`. Analyst exports batch to CSV; developer curls JSON; writer copies Markdown summary.

**Impact.** Table-stakes gap vs every competitor; unblocks analyst/developer personas; conversion assist (export is a top pre-signup intent). Risk: minimal; large-batch exports → stream + size cap (10k rows UI, unlimited via API paged).

**Backend.** Serializers module `/lib/export/{json,csv,markdown}.ts` with stable column contract (documented); batch export as streamed CSV; `GET /v1/extractions/{id}?format=` and `/v1/batches/{id}/export`. Metering: exports counted (analytics only, not billed).

**Frontend.** Export menu on result/batch/schedule-run views; clipboard-copy for MD/JSON; progress state for large CSV; empty/error states.

**Testing.** Golden-dataset round-trip (export→parse→field equality); CSV injection sanitization (`=`,`+`,`-`,`@` prefixes escaped); E2E `@export` download assertions. Acceptance: 5k-row batch exports <10s.

**Deployment.** Staging → GA same week (no data risk). Rollback: flag.

**Docs.** Feature + help + API reference + changelog + use case (lead-list CSV → CRM import). Blog: folded into R0 launch post.

**DoD.** Framework + `extract.exported{format}` event live.

---

## DP-R0-03 · REST API v1 + Keys + OpenAPI Docs (0.3)
**Flag:** `public_api` · **Version:** v1.1.0 · **Run after:** DP-R0-02

**Description & stories.** Public REST API wrapping the live engine: `POST /v1/extract`, `POST /v1/batch`, `GET/POST /v1/schedules`, plus `GET` result endpoints; API-key auth; per-tier rate limits; interactive Swagger at /docs/api. Developer integrates DatIQ into a pipeline in <15 min from docs alone.

**Impact.** Unlocks developer/agent-builder persona, Zapier/webhooks (R0-08), and future MCP (R2). Risk: abuse — token-bucket limits + key scoping (read/extract), anomaly alerting; breaking-change risk — freeze v1 contract, additive-only, documented deprecation policy.

**Backend.** `api_keys` table (hashed, prefix-searchable, last_used, scopes, workspace_id, RLS); middleware for auth + Redis token-bucket (Free 0 · Starter 1k/mo · Pro 10k · Business 50k — enforced now, billed from R1); idempotency keys on POST; consistent error envelope; OpenAPI 3.0 spec as source of truth with CI drift check; SDK-ready examples (curl, Python, Node) generated into docs.

**Frontend.** Settings → API Keys screen (create/reveal-once/revoke/rotate, scope picker, usage sparkline); /docs/api Swagger embed styled to brand.

**Testing.** Contract tests generated from OpenAPI; rate-limit integration tests; key rotation E2E `@api`. Acceptance: quickstart doc executes verbatim; p95 extract latency parity with in-app.

**Deployment.** Staging + 3 design-partner keys for 1 week → GA. Rollback: flag disables key auth surface (existing UI unaffected).

**Docs.** Full API reference + quickstart + auth/limits pages + changelog + **blog: yes** ("The DatIQ API is live") + runbook (rate-limit ops).

**DoD.** Framework + `api.key_created`, `api.request{endpoint,status}` events.

---

## DP-R0-04 · Persona Landing Routes (0.4)
**Flag:** `persona_routes` · **Version:** v1.1.1 · **Run after:** DP-R0-01

**Description.** Five SSR marketing routes — `/lead-generation`, `/competitor-pricing`, `/seo-audit`, `/developers`, `/ai-visibility` — each with persona headline, 3 proof points, tailored URL-box preset (pre-selecting output modules), FAQ schema markup, and CTA. `/ai-visibility` intentionally pre-ranks the nascent AEO category (feature ships R3; page states "early access — join waitlist").

**Impact.** Long-tail intent capture the single home URL cannot; conversion lift from message match. Risk: thin-content penalty — each page ≥600 words of genuinely persona-specific copy (draft in prompt appendix of the marketing repo; agent generates first pass, founder edits). Metrics: per-route signup conversion, /ai-visibility waitlist count (feeds R3 trigger).

**Backend.** Waitlist table + endpoint for /ai-visibility; route-level analytics attribution (utm + landing_route on user record).

**Frontend.** Shared `PersonaLanding` template (hero, proof, preset URL box, FAQ, footer links); JSON-LD FAQ schema; internal links from homepage footer + docs.

**Testing.** E2E per route incl. preset behavior; Lighthouse SEO ≥95; schema validation. Smoke: submit waitlist, verify attribution on a test signup.

**Deployment.** GA immediately (marketing pages). Rollback: flag hides nav/footer links; routes 302 to home.

**Docs.** Changelog + internal doc mapping route↔persona↔preset; sitemap update.

**DoD.** Framework + `growth.landing_view{route}`, `growth.waitlist_joined{route}`.

---

## DP-R0-05 · Programmatic SEO Engine (0.5)
**Flag:** `pseo` · **Version:** v1.1.1 · **Run after:** DP-R0-01, DP-R0-04

**Description.** Template-generated indexable pages from the (public/consented) extraction corpus and curated seed lists: "Extract contacts from {domain}", "Track {competitor} pricing changes", "Website structure analysis of {domain}" — each rendering cached sample output + live CTA. Batch-generated, sitemap-fed, quality-gated.

**Impact.** The Browse AI/Thunderbit acquisition playbook; compounds with permalinks. Risks: (a) doorway-page penalty — every page must show unique data-driven content (real cached structure stats), n≥300-word template variance, canonicalization; (b) target-site sensitivity — generate only for consenting/owned/sample domains at launch + widely-cited public SaaS pricing pages; takedown route + honor robots. Metrics: indexed count, organic clicks (GSC), pSEO→signup rate.

**Backend.** `pseo_pages` table (slug, template_id, domain, cached_payload, quality_score, status); nightly generator worker with quality gate (min fields present, freshness ≤30d); sitemap partitioning; takedown endpoint.

**Frontend.** Three page templates on shared layout; "Data freshness" stamp; prominent "Run live analysis" conversion module.

**Testing.** Generator unit tests (quality gate, dedupe); render tests per template; crawlability audit script. Acceptance: 100 seed pages generated, zero thin-content flags in manual QA sample of 10.

**Deployment.** 100-page pilot → GSC monitoring 2 weeks → scale to 1k. Rollback: flag + sitemap prune (pages 410).

**Docs.** Internal playbook (seed-list curation, quality rubric), changelog, takedown-policy public page.

**DoD.** Framework + GSC verified + `growth.pseo_view/signup` events.

---

## DP-R0-06 · Accounts Hardening + Saved History & Collections (0.6)
**Flag:** `collections` · **Version:** v1.1.1 · **Run after:** DP-R0-00

**Description.** Authenticated users get automatic run history (single/batch/schedule) and Collections: named folders holding any result (and, from R1, social mentions — design polymorphic now). Stories: revisit last week's extraction; group prospect analyses per campaign; pin favorites.

**Impact.** Retention prerequisite (weekly-habit users convert 3–4×); switching-cost start. Risk: history privacy expectations — clear retention policy per tier (File 05 matrix), delete controls (GDPR/DPDPA).

**Backend.** `collections` + `collection_items` (polymorphic `item_type` enum extraction|mention|company_profile — future-proofed) with RLS; history query endpoints with pagination/filters; retention cron enforcing tier windows; user-initiated delete + export-my-data endpoint.

**Frontend.** App-shell left nav: History, Collections; list views with search/filter (domain, date, type); drag/add-to-collection from any result; empty states teaching the feature; settings → data controls.

**Testing.** RLS isolation tests (cross-workspace denial); retention cron unit tests; E2E `@collections` full journey. Acceptance: history visible within 1s of run completion.

**Deployment.** Staging → GA with flag; canary 24h. Rollback: flag (data persists).

**Docs.** Feature + help (2 articles: history, collections) + use case (campaign research) + changelog + privacy-policy update (retention table).

**DoD.** Framework + `app.collection_created`, `app.item_saved` events.

---

## DP-R0-07 · Public Changelog + Docs Hub + Launch Ops (0.7)
**Flag:** `docs_hub` · **Version:** v1.1.2 · **Run after:** DP-R0-00 (content from all prior prompts)

**Description.** Public `/changelog` (from `/content/changelog`), `/docs` hub (from `/docs` markdown, sidebar nav auto-generated), `/blog` shell; Product Hunt launch kit (gallery copy, first-comment, hunter outreach checklist) and @datiq_app activation calendar (2 posts/week template queue).

**Impact.** Trust surface — the credibility gap is the #1 non-product objection. Risk: stale-content debt — mitigated structurally: docs merge with features (contract) so the hub cannot rot.

**Backend.** Markdown pipeline (MDX render, search index via pg trigram or minisearch), RSS feeds for changelog+blog.

**Frontend.** Docs layout (sidebar, TOC, search, dark mode), changelog timeline page, blog index/post templates on brand tokens.

**Testing.** Link-checker in CI; search E2E; RSS validation.

**Deployment.** GA. Launch ops executed per checklist (PH launch scheduled with founder).

**Docs.** Meta: contributing-to-docs guide; changelog entry announcing the changelog (yes, really — it demonstrates the habit).

**DoD.** Framework + `growth.docs_view`, `growth.changelog_view`; PH assets approved by founder.

---

## DP-R0-08 · Webhooks v1 (0.10)
**Flag:** `webhooks` · **Version:** v1.1.2 · **Run after:** DP-R0-03

**Description.** User-configurable webhooks: `extraction.completed`, `batch.completed`, `schedule.run_completed` (R1 adds `mention.detected`, `change.detected`). HMAC-signed, retried with backoff, delivery log visible.

**Impact.** Enables Make/Zapier community recipes pre-official-integration; developer-persona stickiness. Risk: SSRF — egress allowlist rules (block private ranges), URL validation; retry storms — capped exponential backoff + circuit breaker.

**Backend.** `webhooks` + `webhook_deliveries` tables; BullMQ delivery worker (3 retries: 1m/10m/1h → dead-letter); signing secret per endpoint; test-fire endpoint.

**Frontend.** Settings → Webhooks: CRUD, secret reveal-once, delivery log with payload inspector, test button.

**Testing.** Signature verification vectors; retry/DLQ integration tests; SSRF unit tests. Smoke: webhook.site round-trip.

**Deployment.** Staging → GA. Runbook required (DLQ drain procedure).

**Docs.** API webhook reference (payload schemas, signature verification samples) + help + changelog + runbook.

**DoD.** Framework + `api.webhook_delivered{event,status}`.

---

## DP-R0-09 · Rebrand Rollout: Identity, Homepage, Pricing Page (0.8)
**Flag:** `rebrand_2026` · **Version:** v1.1.2 · **Run after:** DP-R0-04 (copy from File 06)

**Description.** Ship the new identity (tokens already in component library from bootstrap): homepage per File 06 (Concept A hero, light+dark variants), pricing page rendering File 05 matrix (tiers visible; checkout stubs "Coming soon — join beta" until R1 billing), nav/footer per File 06 §2.9, tagline swap sitewide + all meta/OG.

**Impact.** Positioning shift live; every later launch lands on-brand. Risk: conversion regression — hero A/B harness included (Concept A vs current) with 2-week decision window; SEO — 301s for any moved routes, meta continuity checklist.

**Backend.** A/B assignment util (cookie-stable, PostHog-fed); pricing config as data (`/config/pricing.ts`) consumed by page and (later) billing gates — single source.

**Frontend.** Homepage sections per File 06 §2.1–2.9; pricing cards; dark-mode toggle; OG image refresh; 404/500 on new brand.

**Testing.** Visual snapshots all marketing routes; meta/OG audit script; a11y pass; E2E signup path from each CTA.

**Deployment.** Staging full review with founder → GA cutover in low-traffic window → GSC monitored 2 weeks.

**Docs.** Brand usage doc (`/docs/internal/brand.md`), changelog, **blog: yes** (rebrand announcement — narrative from File 01 §4 platform thesis).

**DoD.** Framework + hero A/B live + `growth.hero_variant_view/convert`.

---

## DP-R0-10 · Analytics Foundation & Activation Instrumentation (part of 0.6/1.12 pulled forward)
**Flag:** n/a (internal) · **Version:** v1.1.2 · **Run after:** DP-R0-00

**Description.** Complete the funnel instrumentation: signup→first-extract (activation)→export/share→return-visit cohorts; per-landing-route attribution; weekly automated metrics digest to founder (email) implementing the council check-in inputs.

**Impact.** Every R1+ decision and re-scoring trigger depends on this. Risk: PII in analytics — event payload lint rule (no emails/URLs with tokens).

**Backend.** Server-side event relay (ad-block resilient); cohort SQL views; digest worker.

**Frontend.** Event coverage audit — every R0 surface emits its named events.

**Testing.** Event-schema validation tests; digest snapshot test.

**Deployment.** GA. **Docs.** Event taxonomy reference; runbook.

**DoD.** Founder receives first weekly digest with activation %, route attribution, share/export counts.

---

## DP-R0-RC · Release Cut v1.1 → prep v2.0
Assemble release notes from changelog · publish R0 launch blog ("DatIQ v1.1: now the web can see us") · execute Product Hunt launch per DP-R0-07 kit · full regression + golden suites · tag v1.1.2 · council check-in report vs R0 exit criteria (>50 indexed, activation ≥20%, organic baseline) · evaluate re-scoring triggers (esp. /ai-visibility waitlist + /developers route share) · open R1 milestone in tracker; carry any deferred items with explicit tracker rows.

---

## Appendix — Weekly Council Check-in Prompt (template)
```
Using PostHog + GSC + Stripe data for the last 7 days, produce: activation %, free→paid,
WAU/MAU, per-route conversion, share/export counts, indexed pages, top-3 drop-offs.
Evaluate File 02 §9 triggers 1–6 against this data. Recommend: (a) continue as planned,
or (b) specific re-sequencing with the affected prompt IDs. Output ≤1 page.
```
