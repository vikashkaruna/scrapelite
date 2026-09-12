# Face-lift release plan — R0, R1, R2

**Branch baseline:** `face-lift` from local `staging` at `4922c04` (2026-09-12)  
**Purpose:** move DatIQ's public positioning to **“DatIQ — Intelligence, Connected.”** while closing the highest-value R0 gaps and truthfully presenting later capabilities.

## Scope and source interpretation

The five supplied `Analysis-2` files are product/reference material, not executable repository instructions. In particular, their assumed Next.js, TypeScript, Stripe, Redis and BullMQ stack does not match this Vite + React + Netlify Functions repository. The implementation must retain the existing stack, routing, migration, RLS, and Razorpay choices.

The user-directed decisions override the source material:

- Do not introduce or re-enable Stripe billing. Razorpay and the existing metering are the billing baseline.
- Do not claim unfinished work is available. Use a quiet **Beta** label for a usable, access-controlled capability still undergoing production hardening; use **Upcoming** for work that has not been integrated and released.
- Do not merge or copy parallel work into this branch. Review it only after its owner has completed it, its tests pass, and it is merged into the intended integration branch.
- Treat **DatIQ Discover** as the sixth platform pillar. It is an evidence-backed SEO, AEO, and GEO intelligence workflow—not a claim to guarantee rankings, citations, or traffic.

`face-lift` was intentionally cut from **local** `staging`, which is ahead of `origin/staging`. Preserve that baseline until it has its own review and deployment evidence.

## Current product truth

### Release 0 audit

| Item | Source status | Evidence on `face-lift` | Required gap / disposition |
|---|---|---|---|
| 0.1 Shareable result permalinks | Partial | Public report routes (`/r/:slug`, `/p/:slug`) and API share operations exist. | They are client-rendered report surfaces, not the specified SSR extraction permalink or `/site/{domain}` page. Design a privacy-first, Vite-compatible prerender/Edge solution before calling R0 complete. |
| 0.2 JSON / CSV / Markdown export | Built | Shared `ExportMenu`, Preview, Dashboard, and Discoverability provide JSON, CSV, Markdown (plus PDF/Excel). | Add one cross-surface contract test and document the stable API/export format. |
| 0.3 REST API, keys, OpenAPI | Partial | `/api/v1` has health, extraction, batch, schedule, share and audit routes; key/rate-limit code and a developer API guide exist. | Publish a generated OpenAPI contract and interactive/reference docs; verify all documented endpoints against a deployed test key. |
| 0.4 Persona landing routes | Built, route names evolved | Use-case routes cover lead generation, competitor research, SEO, AI visibility, account intelligence, recruiting and diligence. | Keep redirects, sitemap, metadata and CTA behavior under the new homepage IA. |
| 0.5 Programmatic SEO | Partial | Curated programmatic routes, static prerendering, sitemap and quality checks exist. | Do not call it a generation engine until consent/freshness/quality-controlled generation and takedown workflow exist. |
| 0.6 Accounts, history, collections | Built | Auth, Dashboard history, Workspace collections, reports and data controls exist. | Validate real-account cross-device/RLS behavior in staging; avoid a schema rewrite. |
| 0.7 Changelog, docs, launch surface | Partial | Public changelog, blog, help site, sitemap and `llms.txt` exist. | Add link/RSS/documentation freshness checks; Product Hunt and social launch remain operator work, not code-complete. |
| 0.8 Rebrand | Gap | Brand still says “Intelligence from the Web”; the old pillar banner is hidden; no truthful module overview exists. | First face-lift implementation slice. See “Homepage decision” below. |
| 0.9 Modular shell | Partial | Extract, Discover, Templates, Dashboard, Workspace, lists/watchlists/rules and integrations exist. | Do not add empty `/social`, `/brand`, or `/connect` routes. The module catalog may link only to delivered surfaces or a passive upcoming state. |
| 0.10 Webhooks | Partial | n8n/webhook, integration and signal-routing paths exist. | Reconcile event naming, HMAC/retry/delivery-log behavior and public docs before advertising general-purpose v1 webhooks as complete. |

### Release 1 audit

| Item | Current status | Release communication and next gate |
|---|---|---|
| 1.1 Social listening | Upcoming | No integrated X/Reddit/RSS collection and intent-feed release. Keep Social out of “available” claims. |
| 1.2 Billing, pricing, usage | Built with product decision | Razorpay, plan gates and usage surfaces exist. Stripe is intentionally out of scope. Verify the live Razorpay upgrade/cancel path separately. |
| 1.3 HubSpot | Beta | Push/sync code and setup UI exist, but full bi-directional contacts/companies/deals plus social notes are not release-proven. |
| 1.4 Apollo | Upcoming | No integrated Apollo connector should be advertised as available. |
| 1.5 Change detection and alerts | Beta | Watchlists, snapshots, monitor cron and signal routing exist. Promote only after staging verifies a real monitored target and alert delivery. |
| 1.6 Connector management and field mapping | Partial | Integration setup and some mappings exist. A uniform connection/test/map/disconnect contract is not established. |
| 1.7 Usage dashboard | Partial | Billing/usage/PQL data exists. Expand to a single, user-visible source for credits, audits, API and future social quotas. |
| 1.8 Keyword trends | Upcoming | Watchlists are not competitive keyword tracking/trend comparison. |
| 1.9 Digest reports | Partial | Report email and alerts exist; consolidated daily/weekly social-and-change digests do not. |
| 1.10 Historical social backfill | Upcoming | Depends on the unintegrated social collector. |
| 1.11 Semantic fallback parsing | Partial | Provider fallbacks exist, but there is no explicit measured selector-to-semantic fallback contract. |
| 1.12 Product analytics | Partial | Consent-aware first-party analytics and activation/PQL models exist; PostHog-specific funnel/cohort operating evidence does not. |
| 1.13 Onboarding wizard | Partial | Persona/onboarding flows exist; the first-keyword, connector and alert journey cannot be claimed until those capabilities are integrated. |

### Release 2 audit

| Item | Current status | Release communication and next gate |
|---|---|---|
| 2.1 Company Intelligence workspace | Beta foundation | Lists, enrichment and workflow templates provide account-intelligence building blocks. A cited `/company/{domain}` profile with all promised sections is not integrated. |
| 2.2 MCP / agent-ready API | Beta foundation | REST API and n8n MCP documentation exist. Package it as a supported hosted, metered DatIQ MCP release only after endpoint/auth/conformance testing. |
| 2.3 Calendly briefs | Upcoming | No release-ready Calendly workflow. |
| 2.4 Competitive Intelligence | Beta foundation | Watchlists/change feed and battlecard-related surfaces exist; no integrated `/compete` registry, comparison grid and battlecard lifecycle. |
| 2.5 Prebuilt templates | Beta | Template gallery and runners exist. Audit catalog size, health checks and per-template UX before calling it a broad template library. |
| 2.6 Zapier/Make/Sheets/Airtable | Partial / Beta | Zapier, Airtable and Google Sheets paths exist; Make and partner-listing proof are outstanding. |
| 2.7 Slack/Teams channels | Partial / Beta | Slack webhook integration exists; Teams is upcoming. |
| 2.8 Research Workspace | Partial | Workspace and collections exist; projects, pins, saved searches and unified activity are upcoming. |
| 2.9 YouTube and news sources | Upcoming | No integrated social source collectors. |
| 2.10 SOC 2 evidence | Upcoming operations track | Code-level security/RLS testing is not a SOC 2 evidence program. |
| 2.11 Mobile and WCAG pass | Ongoing | Existing a11y suite is a strong base. Re-run axe, keyboard, contrast and mobile assertions for every face-lift and beta module change. |

## Homepage decision: DatIQ — Intelligence, Connected.

Ship the homepage in the first delivery train with Concept A (“Dashboard Reveal”) as the visual direction, but use only factual product cards and no fabricated social proof. The URL composer remains immediately below the hero because it is still the core activation path.

### Homepage content contract

- **Headline:** `Intelligence, Connected.`
- **Descriptor:** `Turn web, social, and market signals into automated revenue workflows.`
- **Functional subhead:** explain current URL extraction and the connected intelligence direction without promising unshipped social or CRM outcomes.
- **Primary CTA:** `Start free` (existing sign-in/trial path).
- **Secondary CTA:** `Paste a URL and see it work` (scroll/focus the composer).
- **Proof bar:** only capability claims that are true today: results in seconds, no credit card to start, exports and connected workflows where configured. Do not publish customer counts, ratings, HubSpot/Apollo availability, or testimonial claims without evidence.
- **SEO:** update title, canonical description, visible answer block, static prerender, OG metadata and tests together. Retain noindex on signed-in tool routes.

### Six-pillar module overview

Use one data-driven catalog shared by Home, About, navigation/help and marketing metadata. A module card must render one of `Available`, `Beta`, or `Upcoming`; only Available/Beta can have a product CTA.

| Pillar | Public card copy | Status at face-lift launch | CTA behavior |
|---|---|---|---|
| DatIQ Extract | **Every page, structured.** Turn one URL, a batch, or a schedule into clean data, summaries and exports. | Available | Open Extract |
| DatIQ Enrich | **Answers behind the page.** Pull contacts, pricing, company context and custom fields from what a page actually says. | Available | Open Extract preset |
| DatIQ Compete | **Never miss a competitor move.** Monitor pricing, positioning and page changes with evidence and an alert trail. | Beta | Explore Watchlists; beta label persists until a real staging monitor/alert gate passes. |
| DatIQ Connect | **Put intelligence to work.** Export or route verified outputs to your operating tools and workflows. | Beta | Explore Integrations; retain provider-level availability labels. |
| DatIQ Engage | **Turn research into next steps.** Organise prospect intelligence and outreach workflows. | Upcoming | Non-interactive roadmap card until the parallel engagement branch is integrated and released. |
| **DatIQ Discover** | **Be found where decisions start.** Measure visibility across search, answer engines and AI. Act on evidence-backed priorities and track progress. | **Beta** | **Run a visibility audit**; show the beta label until the parallel P1–P3 engine has integrated, passed the release gate and been production-verified. |

This gives Discover the requested sixth-pillar position without representing unmerged enhancements as current production functionality.

## Safe two-train delivery plan

### Train A — Face-lift and R0 truthfulness

1. **Inventory and hard gates.** Add the module catalog and assertion tests that prevent an `Upcoming` card from having a live-product CTA, prevent a `Beta` card from saying “available,” and fail unsupported provider claims. Baseline public route, SEO, a11y and visual snapshots first.
2. **Homepage and shared brand system.** Implement the new hero, composer anchor, module overview, dark/mobile dashboard-reveal art, revised footer/nav/tagline and metadata. Build the Concept A static illustration in component/CSS rather than inventing metrics or claiming live integrations.
3. **R0 finish line.** Close the R0 technical/documentation gaps in dependency order: share/privacy design → export contract test → OpenAPI/docs → pSEO governance → webhook contract → analytics event coverage. Every item is additive, flaggable where behavior changes, and deployable behind its own acceptance check.
4. **Train-A release gate.** Run the local gate, preview deploy gate, staging read-only and authenticated test-account regression, focused manual review on desktop/mobile/light/dark, then production canary. If activation or SEO health regresses, revert the face-lift catalog/hero flag only; never roll back migrations blindly.

### Train A implementation record — 2026-09-12

The implementation below is deliberately limited to Train A. It does not absorb any active
parallel-branch feature work.

- [x] Added a tested, shared six-pillar module catalog. Extract and Enrich are **Available**;
  Compete, Connect and Discover are **Beta**; Engage is **Upcoming** and intentionally has no
  product CTA. The catalog prevents beta copy from being presented as generally available.
- [x] Cut over the Home hero to `Intelligence, Connected.`, added the requested
  `Paste a URL and see it work` composer-focus CTA, the Concept A dashboard-reveal illustration,
  factual answer copy, and the approved DatIQ Discover Beta message and CTA.
- [x] Rebranded shared public touchpoints (navigation, footer, exports, invoices, static metadata,
  prerendered marketing pages and their visual baselines) without altering the stack or billing.
- [x] Closed the Train-A R0 documentation/contract slice: privacy and share boundary, a
  cross-surface export contract, a machine-readable OpenAPI 3.1 description, pSEO governance,
  precise webhook boundaries, and analytics-event vocabulary. These documents make remaining R0
  implementation gaps explicit rather than turning roadmap items into availability claims.
- [x] Added the parameterized release runner and tested it against production’s public read-only
  surface. The complete local quality gate passes: readiness, unit, contract, integration, system,
  database/referral, build/sync, prerender, security, smoke, a11y and visual checks.
- [ ] **Staging deployment gate:** still requires the approved Netlify Edge Access test path.
  Staging currently returns 401 before public application or API tests can begin; this is an
  external deployment-access condition, not an application pass or a reason to relax the gate.

### Train B — Integrated beta stabilization, then R1/R2 slices

1. **Integration review first.** Rebase/merge no parallel branch automatically. Inspect schema overlap, RLS, endpoint ownership, route collisions, pricing entitlements, user-facing claims, migrations and test evidence in an isolated integration PR.
2. **Promote only verified beta foundations.** Watchlists/change alerts, HubSpot, templates, Zapier/Airtable/Slack, account-intelligence primitives and Discover are candidates for controlled beta. Each gets a real staging test user, one owned target, teardown, latency/error baseline and clear UI label.
3. **Build the missing capability chains—not isolated screens.** Social collection before keyword trends/digests; company profile evidence model before Calendly briefs; change feed + profiles before `/compete`; connector contract before provider expansion; projects model before a Research Workspace claim.
4. **Train-B release gate.** Per feature: migration/RLS test → unit/contract/integration → deployed UI path → one controlled live workflow → rollback/kill-switch proof → docs/changelog/status-catalog update. Unfinished work stays Upcoming.

## Parallel branches: deliberately deferred

| Branch | Snapshot | Handling on `face-lift` |
|---|---|---|
| `workflow-implementation-and-optimization` | Workflow/integration optimization work is active and diverged from staging. | Review post-completion only; do not make release claims from it. |
| `feat/prospect-engagement-engine` | Adds a Prospect Engagement Engine, its functions, migration and extensive UI. | Keep **DatIQ Engage** Upcoming until its branch is completed, security-reviewed, merged and exercised against a staging account. |
| `Discoverability-P1-P3-implementation` | Adds substantial Discoverability P1–P3 work, migrations and test coverage beyond the staging baseline. | Keep **DatIQ Discover** Beta; perform a migration/RLS/API/claim review after merge before changing that label. |

## Regression automation

`npm run test:release` is the release runner added with this plan.

### Staging access precondition (observed 2026-09-12)

The read-only runner was exercised against `https://staging--datiqapp.netlify.app` on this date.
Netlify Edge Access returned HTTP 401 before every public page, static asset and API route, so the
runner correctly returned a failed report rather than treating the unreachable deployment as safe.
This is an operator configuration prerequisite—not a reason to weaken application auth or make the
gate ignore 401s. Before a staging gate can pass, give the designated non-interactive release test
path access to the intended staging surfaces (at minimum public pages/assets, `/api/v1/_health`,
and `/api/discoverability/*`) through the approved Netlify Edge Access policy or a documented
service-access mechanism. Then rerun the unchanged command below.

For comparison, the same read-only runner reached production on 2026-09-12: all ten deployed
smoke probes and all three public API contracts passed. Its local, browser, RLS and authenticated
logical-flow phases were intentionally skipped in that invocation, so this is reachability evidence
rather than a full production-release sign-off.

| Invocation | What it verifies | Writes data? |
|---|---|---|
| `npm run test:release -- --base-url https://preview…` | Deployed smoke, public API health, Discoverability public contract, deployed Chromium smoke suite. | No |
| `npm run test:release -- --base-url https://staging… --environment staging --with-local --verify-rls` | Above plus all local source/migration/security/build/visual tests and anonymous live RLS verification. | No |
| `DATIQ_TEST_BEARER_TOKEN=… npm run test:release -- --full --environment staging --base-url https://staging… --discover-url https://owned-test… --allow-live-write --report artifacts/staging.json` | Full local + deployed suite + live RLS + one authenticated audit, persisted retrieval, evidence endpoints, JSON/CSV/Markdown exports, and teardown. | One disposable audit, then deleted |

The runner reports every check as pass, fail, or skipped, and emits a JSON report when `--report` is supplied. A skipped provider sandbox, real payment, email, webhook or CRM check is a deviation—not a pass. Keep those provider-specific tests opt-in with separate sandbox credentials and explicit cleanup.

## Release evidence checklist

- `npm run test:all -- --visual` passes on the branch.
- `npm run test:release -- --full …` passes on staging with a non-production test account and an owned target URL.
- `npm run test:release -- --full …` passes on production only after using the production test account, production-owned test target and `--environment production`.
- The generated report contains no failed or skipped required check; any intentional skip has a ticket/owner and does not upgrade a module status.
- No public card, schema, footer, pricing surface, docs or OpenGraph asset claims an Upcoming feature is usable.
- The branch review includes a visual comparison of Home at desktop/mobile in light/dark and a crawlable prerender/metadata check.
