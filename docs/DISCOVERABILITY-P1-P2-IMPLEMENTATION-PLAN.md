# Discoverability Intelligence — P1 + P2 implementation plan

**Branch:** `discoverability-p1-to-p3` (cut from `staging`)
**Source of truth:** *DatIQ Discoverability Intelligence System — Consolidated BRD and PRD, P1/P2/P3* (37pp) and the Perplexity architecture/mindmap deck (18pp).
**Status:** awaiting approval. Nothing in this plan has been implemented yet.

---

## 0. Repository state (verified 2026-09-10)

### 0.1 Branch sync

| Question | Answer |
|---|---|
| Does `main` contain anything `staging` does not? | **No.** `git rev-list --count --no-merges origin/staging..origin/main` = **0**. The three commits on `main` that are absent from `staging` (`2042348`, `2c6067c`, `ac9e170`) are all *merge* commits created by GitHub when `staging` PRs (#161, #162, #164) landed. Every line of content on `main` came from `staging`. |
| Is `staging` ahead? | **Yes, by one commit** — `4922c04` (`feat(discoverability): resolve all 7 audit issues on datiq.app…`), which is why `git diff origin/main origin/staging` shows 33 files (32 prerendered `public/**/index.html` files plus `src/pages/Home.jsx`). |
| Action required | **None.** `staging` is already up to date with `main`. No merge, rebase or cherry-pick is needed. |

> ⚠️ **Caveat — this comparison is against the last successful fetch.** `git fetch` currently fails:
> `remote: Invalid username or token. Password authentication is not supported for Git operations.`
> The credential helper reads `$GITHUB_TOKEN`, which is present but is an expired 40-character classic
> `ghp_` token. **A fresh token (fine-grained PAT with `contents: read/write`, or `gh auth login`) is
> required before I can re-verify against the live remote or push this branch.** Everything above is
> true as of the last successful fetch; I will re-verify the moment credentials work.

Local `main` (`b073218`) is itself stale relative to `origin/main`, which is harmless — all work
branches from `staging`.

### 0.2 What is already built

The Discoverability module is **substantially more complete than the Perplexity deck's
"current-state map" claims** (that deck estimated the four-pillar scorer at 15% and gap analysis at
20%; both are shipped). `docs/DISCOVERABILITY-MODULE.md` maps it to an *older* three-phase PRD and
marks all three phases ✅. That mapping does **not** transfer to the new P1/P2/P3 definitions — the
new P1 is broader than the old Phase 1–3 combined in several places, and the new P2 is greenfield.

Shipped today:

| Area | Where |
|---|---|
| 4 pillars, 20 signals, weights | `src/lib/discoverability/signalRegistry.js` |
| Core + SEO/AEO/GEO framework maths, penalty layer, `unknown ≠ 0` coverage model | `scoringModel.js` |
| 44 issue codes → severity/owner/impact/effort/confidence/fix/asset | `issueCatalog.js` |
| Priority + per-page lift + blocker gates | `recommendationModel.js` |
| 13 ready-made construct generators | `constructTemplates.js` |
| 4 profiles + 8 page-type rule packs | `auditProfiles.js` |
| Baseline diff, trends, next-best-actions | `auditDiff.js` |
| Markdown / CSV / JSON / PDF reports | `auditReport.js`, `auditPdf.js` |
| 7-stage server pipeline, wall-clock budget, per-stage survivability | `netlify/functions/lib/audit/auditPipeline.js` |
| Fetch (raw + rendered), robots, canonical, redirect chain | `fetchLayer.js` |
| 4 pillar analysers, PSI adapter, Perplexity citation sampling, optional LLM refinement | `answerAnalysis.js`, `structureAnalysis.js`, `entityAnalysis.js`, `technicalAnalysis.js`, `webVitals.js`, `citationSampling.js`, `aiEvaluator.js` |
| 13 tables + RLS + retention function | `supabase/migrations/0030_discoverability_audits.sql` |
| API router, `/api/v1/audits\|recommendations\|targets\|benchmarks` delegation | `netlify/functions/discoverability.js`, `api-v1.js` |
| Daily scheduled monitoring, HMAC webhooks | `discoverability-monitor.js`, `webhookDispatch.js` |
| Dashboard: score tiles, issue matrix, recommendation queue, evidence panels, trend chart, history | `src/pages/Discoverability.jsx`, `src/components/discoverability/*` |

**The four-pillar weights and the three framework views already match the new PRD §7.3 exactly**
(0.30/0.25/0.20/0.25; SEO 0.20/0.20/0.20/0.40; AEO 0.45/0.15/0.25/0.15; GEO 0.25/0.35/0.20/0.20).
That is the single largest piece of P1 and it needs no change.

---

## 1. P1 gap analysis — clause by clause

Legend: ✅ done · ⚠️ partial · ❌ missing

### §7.1 Intake

| PRD requirement | State | Gap |
|---|---|---|
| Target URL/domain (required) | ✅ | `audits.target_url` |
| **Audit type** (url, domain, benchmark, prompt monitor, re-audit) (required) | ⚠️ | No `audit_type` column. `source` (`api\|ui\|schedule\|benchmark\|rerun`) conflates *provenance* with *type*. **Domain snapshot** and **prompt monitor** are not first-class audit types. |
| **Primary goal** (SEO health, AI citations, product discovery, service leads, local discovery, competitor intelligence) (required) | ❌ | Absent entirely. This is the field that makes the audit contextual rather than generic, and P2/P3 modules key off it. |
| **Audit profile** (balanced, seo, aeo, geo, **saas, services, local, e-commerce**) (required) | ⚠️ | Only 4 of 8. The four business-model profiles are missing. |
| Page type hint | ⚠️ | 8 packs shipped (article, faq, howto, pricing, product, docs, page, unknown). PRD adds **homepage, service, location, comparison**. |
| Competitor URLs | ⚠️ | Only as a separate `audit_benchmarks` object; not an intake field on a single audit. |
| **Target geography** (country, city, region, language) | ❌ | Absent. Blocks local prompt generation and P2 service-radius work. |
| Prompt set | ✅ | `audits.prompt_set_id` |
| Baseline audit | ✅ | `audits.baseline_audit_id` |
| *Acceptance:* profile inferred from page characteristics, overridable | ⚠️ | Page **type** is inferred (`inferPageType`); **profile** is not. |
| *Acceptance:* inputs saved and reusable on re-audit | ⚠️ | Verify `rerunRoute` carries the full new intake set once the columns exist. |

### §7.2 Extraction and evidence

Collection is largely there (HTTP/redirect/headers, canonical/robots, raw + rendered, title/meta/
headings/links/images, FAQs/lists/tables/answer passages, JSON-LD, author/publisher/dates, CWV).

**The real gap is the evidence contract.** The PRD is unambiguous:

> Every signal and issue must retain evidence. Evidence includes **source URL, selector or extracted
> section, observed value, excerpt/structured object, collection timestamp and confidence.**

Today `audit_signals.evidence_json` is free-form and `audit_issues.evidence` is a plain `text`
column. There is no enforced envelope, no `selector`, no `collected_at`, no per-evidence
`confidence`. Every downstream P1 and P2 claim ("we observed X on page Y at selector Z at time T
with confidence C") depends on this, so it is **the first thing to build** — everything else in P1
and all of P2 writes into it.

Also missing: **sitemap indicator** and a **microdata** inventory (JSON-LD only today).

### §7.3 Four-pillar score model — ✅ exact match. No change.

### §7.4 Penalty model — calibration deliberately retained (see D1)

| PRD critical condition | PRD suggests | Shipped | Ships as |
|---|---|---|---|
| Key URL blocked by robots or `noindex` | 20% | `NOINDEX` 0.20 | **0.20** unchanged |
| Relevant AI-search bot denied access | 15% | `AI_CRAWLER_BLOCKED` 0.20 | **0.20 kept** — a blocked page is not "a good page minus a few points" to an engine that cannot fetch it |
| Canonical destination non-200 | 15% | `CANONICAL_TARGET_BROKEN` 0.15 | **0.15** unchanged |
| Major raw-to-rendered content loss | 15% | `CONTENT_HYDRATION_ONLY` 0.20 | **0.20 kept** — same reasoning; a non-rendering crawler receives an effectively empty page |
| Critical entity schema invalid | 10% | — | **ADD `ENTITY_SCHEMA_INVALID` 0.10** |
| FAQ schema differs from visible FAQ | 10% | `FAQ_SCHEMA_MISMATCH` 0.10 | **0.10** unchanged |
| Severe CWV failure | 10% | — | **ADD `SEVERE_CWV_FAILURE` 0.10** |
| *(no PRD row)* Some AI crawlers disallowed | — | `AI_CRAWLER_PARTIAL_BLOCK` 0.05 | **0.05 kept** — uneven citation coverage is a real, milder defect the PRD does not model |
| *(no PRD row)* No mobile parity | — | `MOBILE_PARITY_MISSING` 0.10 | **0.10 kept** — mobile is the crawl default |

Net effect: **nine blockers**, two of them new. A page tripping neither new condition scores
identically before and after.

### §7.5 Gap analysis — ⚠️ the issue record is under-specified

| PRD field on every issue | State |
|---|---|
| Stable issue code | ✅ 44 codes, documented as a public contract |
| Title + plain-language description | ✅ `title`, `why` |
| Pillar and framework mapping | ✅ |
| Severity (critical/high/medium/low) | ✅ |
| **Observed facts and separate inference** | ❌ One blended `evidence` text. The PRD and the deck's design principles both insist these are *different sentences* ("JSON-LD is invalid" is measured; "this may suppress citation likelihood" is reasoned). |
| **Evidence reference** `{url, selector, excerpt}` | ❌ unstructured |
| **Root cause** | ❌ No taxonomy. Deck gives 8: technical access, weak page structure, entity ambiguity, insufficient proof, missing content coverage, location/radius mismatch, UX friction, conversion friction. |
| **Recommended DatIQ module** (M1–M13) | ❌ |
| Recommended owner role | ⚠️ In the catalogue; not persisted on the row |
| Estimated impact, effort, confidence | ⚠️ On the recommendation, not the issue |
| **Workflow state** | ❌ Issues have no state |

### §7.6 Recommendation Studio v1

| PRD output asset | State |
|---|---|
| Direct-answer blocks | ✅ `answerBlock` |
| H1/H2/H3 restructuring plan | ✅ `headingTree` |
| FAQ content + FAQPage JSON-LD | ✅ `faqContentBlock`, `faqSchema` |
| Organization + Article JSON-LD | ✅ `organizationSchema`, `articleSchema` (+ Person, HowTo, Breadcrumb, entity card, author bio) |
| Meta title and description **variants** | ✅ **W5.** This row was wrong when written: `metaTags` has emitted **three title angles** since the scoring engine shipped (`c902be9`, present in `staging`), so only the *description* lacked variants. W5 added three descriptions paired to the three title angles, plus a truncation warning measured on observed text only. ⚠️ Angles B and C stay `TODO:` scaffolds even when the page has a description — re-angling an author's sentence is writing, not transforming, and meta copy ships verbatim. |
| **Internal-link recommendations** | ✅ **W5.** `internalLinkPlan` + issue `SH-11`. ⚠️ It never proposes a url to link to — the audit reads one page and the sitemap indicator records only that a sitemap was *declared*, so a suggested target would be a guess pasted into live markup. It fixes the anchor text on links already present. |
| **Content brief** for missing category / comparison / use-case / industry page | ✅ **W5.** `fetchSitemapUrls` (budget-aware, one index level, capped) + pure `contentCoverage.js` + `contentBrief` + issues `AC-09`–`AC-12`. ⚠️ `fetched` and `urls` are separate and callers branch on `fetched` first: no declaration, no budget, a 404 or a TRUNCATED crawl all yield **zero** findings, never "you publish none". Classification is by url shape, so every sentence states what we MATCHED, at confidence 60. |
| robots.txt and crawler-access remediation | ✅ `robotsTxtBlock` |
| **Basic technical remediation brief** | ✅ **W5.** `technicalBrief` + issue `TA-18`. ⚠️ It exists for the SEQUENCING, not the list — `applyDependencies` has computed which fixes are inert behind a blocker since the module shipped and nothing rendered it. Fires only when an active blocker gates other work, so an ordinary page raises nothing. |

Priority formula: PRD specifies linear `Priority = 0.40I + 0.20C + 0.20B + 0.20E`. Shipped is
multiplicative `100 · (I·C) · breadthMul · easeMul`. → **decision D1.**

Acceptance verbs: copy ✅, export ✅, accept ✅, dismiss ✅, mark implemented ✅ (`done`),
**assign ✅ W5** — migration `0051`, `assign_recommendation`, `POST /recommendations/{id}/assign`, owner control on every open card. The shared-workspace check lives in SQL so the column cannot be set to an arbitrary account id by any path. ✅ **`0051` applied to dev and stage (2026-09-11), alongside `0048`–`0050`.** ⚠️ Production has none of `0048`–`0051`.

### §7.7 Validation Lab

| PRD function | State |
|---|---|
| Save baseline audits | ✅ |
| Re-run manually or on schedule | ✅ |
| Compare overall, framework, pillar **and signal** scores | ⚠️ overall/framework/pillar yes; **signal-level diff missing** |
| Identify resolved / new / **regressed** / **unchanged** issues | ⚠️ `resolved` / `remaining` / `introduced`; no regressed or unchanged classification |
| **Relate implemented recommendations to score movement** | ❌ The closed-loop claim of the whole product |
| 7-day, 28-day, 90-day and custom trend views | ⚠️ `buildTrend` exists; **no windowing** |

### §7.8 AI visibility and benchmarks — the biggest P1 gap

| PRD | State |
|---|---|
| Prompt taxonomy: brand, category, buyer problem, comparison, industry, local, trust | ❌ `defaultPrompts` is a generic 5-prompt heuristic |
| `PromptSet = Category × Service/Product × Persona × Industry × Geography × Intent` generator | ❌ |
| 7 citation states (absent, mentioned, cited, recommended, cited+recommended, incorrectly represented, competitor-dominated) | ❌ Two booleans: `mention_detected`, `citation_detected` |
| MentionRate, CitationRate | ⚠️ Derivable from counts; not stored as metrics |
| **RecommendationRate** | ❌ Requires a commercial-prompt classifier |
| **AI SOV** (vs tracked competitor mentions) | ❌ Competitor mentions are not tracked |
| **WAVI** `0.20M + 0.30C + 0.30R + 0.10P + 0.10A` | ❌ Needs answer **prominence** and **accuracy** |
| Competitor displacement ("Competitor X is cited for prompt Y because…") | ❌ |
| Engines | Perplexity (live) + AI-chain fallback (labelled non-live). No Gemini grounding, no ChatGPT Search, no AI Overviews → **decision D4.** |

### §7.9 Workflow Hub lite

PRD lifecycle: `Open → Accepted → Assigned → In progress → Implemented → Validation scheduled → Validated`.
Shipped: `open | accepted | dismissed | done`. Owner assignment ❌, due date ❌, notes ❌, evidence
attachments ❌. Exports exist at audit level ✅; queue-level export ❌. Webhook events are
`audit.completed | audit.failed | audit.regressed` — no recommendation-lifecycle events.

### §7.10 P1 APIs

PRD namespace is `/api/v1/discoverability/*`. Shipped is `/api/v1/audits|recommendations|targets|benchmarks`
(delegating to `discoverability.js`) plus the internal `/api/discoverability/*`.

| PRD endpoint | State |
|---|---|
| `POST /audits`, `GET /audits/{id}`, `/results`, `POST /{id}/rerun`, `GET /{id}/compare/{baseline}`, `GET /targets/{id}/history`, `/trends`, `GET /{id}/issues`, `/recommendations`, `POST /recommendations/{id}/status` | ✅ (different path prefix) |
| `POST /prompt-sets` | ⚠️ `/prompts/samples` — different shape |
| `POST /prompt-runs`, `GET /prompt-runs/{id}` | ❌ |
| `POST /benchmarks`, `GET /benchmarks/{id}` | ✅ (no `discoverability` segment) |
| `POST /webhooks` | ⚠️ exists on the internal router, not exposed under `/api/v1` |

→ **decision D2.**

### §7.11 P1 database schema

PRD names tables `discoverability_*`; we use `audits` / `audit_*`. This was a *deliberate,
documented* deviation (see the migration header) and renaming 13 live tables has real risk and zero
product value. → **decision D3.**

`workspace_id` is reserved-and-unused on every table; `public.workspaces` now exists (migration
0031), so the hook can finally be wired. → **decision D6.**

### §7.12 P1 dashboard

Present: score tiles, pillar breakdown, issue matrix, recommendation queue, evidence panels, trend
chart, history. Missing against the PRD wireframe: **goal selector in the header**, **baseline delta
in the header**, and the **AI-visibility panel** (mention/cite/recommend %, top displacer, key query).

---

## 2. P2 gap analysis — effectively greenfield

| PRD §  | Module | State |
|---|---|---|
| 9.1 | Canonical Business Truth Record (+ versions, approval-before-canonical) | ❌ |
| 9.2 | Entity Graph Builder (14 entity types, 9 predicates, evidence + confidence on every relation) | ❌ |
| 9.3 | Brand Discoverability Score `BDS = 0.25EC + 0.20SD + 0.25ASOV + 0.20TC + 0.10RA` | ❌ |
| 9.4 | Product Discoverability `PDS = 0.25CF + 0.20EA + 0.20CC + 0.15TP + 0.10AR + 0.10RA` | ❌ |
| 9.5 | Service Findability `SFS = 0.25IC + 0.20VC + 0.20PE + 0.15GA + 0.10TR + 0.10CR` | ❌ |
| 9.6 | Local & Directory Intelligence (5-tier source registry, NAP formula, per-directory match, correction packs, India-first sources) | ❌ |
| 9.7 | Schema intelligence (8 schema types + `Schema = 0.30O + 0.30L + 0.20S + 0.10F + 0.10G`) | ⚠️ Two signals exist (`schema_identity_completeness`, `structured_data_validity`); no per-type validation matrix, no Schema score |
| 9.8 | Trust & Proof Audit `TC = 0.25D + 0.20R + 0.20P + 0.15M + 0.10C + 0.10X` | ❌ |
| 9.9 | Service-radius query builder (5 coverage bands) | ❌ |
| 9.10 | Workflow Hub expansion (7 approval stages, agency/client permissions, PM/CRM connectors, revalidation trigger) | ⚠️ Connectors exist (HubSpot, Slack, Notion, Airtable, Zapier); approval model ❌ |
| 9.11 | 14 P2 endpoints | ❌ |
| 9.12 | 14 P2 tables | ❌ |

**Adjacent tables that are *not* reusable as-is but must not be duplicated:**
`public.canonical_entities` (0041) is domain-level company enrichment for bulk lists;
`public.entity_snapshots` / `field_changes` (0042) are competitor watchlist monitoring. The P2 entity
graph is a different concern (workspace-scoped, approval-gated, relationship-bearing) and should be
its own tables, with a documented foreign-key bridge to `canonical_entities` on `canonical_domain`
so we resolve a company once.

**P2's hard dependency is external data acquisition** for §9.6 (Google Business Profile, Maps,
Justdial, IndiaMART, Sulekha, MCA, TradeIndia, review platforms). → **decision D5.** This is the
single largest risk in the whole plan and the one most likely to change what "50+ sources" means.

---

## 3. Decisions — RESOLVED 2026-09-10

| # | Decision | Ruling |
|---|---|---|
| **D1** | Scoring alignment | **Keep the shipped penalty calibration; add only what is missing.** The shipped percentages stay exactly as they are — `NOINDEX` 0.20, `AI_CRAWLER_BLOCKED` **0.20** (not the PRD's 0.15), `CANONICAL_TARGET_BROKEN` 0.15, `CONTENT_HYDRATION_ONLY` **0.20** (not the PRD's 0.15), `FAQ_SCHEMA_MISMATCH` 0.10 — and both DatIQ extensions are retained as first-class members of the model: `AI_CRAWLER_PARTIAL_BLOCK` **0.05** and `MOBILE_PARITY_MISSING` **0.10**. The two PRD conditions with no shipped equivalent are **added** at the PRD's suggested weights: `ENTITY_SCHEMA_INVALID` **0.10** and `SEVERE_CWV_FAILURE` **0.10**. Priority stays multiplicative — `100 · (I·C) · breadthMul · easeMul` — **not** the PRD's linear `0.40I + 0.20C + 0.20B + 0.20E`. Adding two blockers still changes the score of any page that trips them, so this ships as `scoring_model_version = "v2"` with `auditDiff` refusing cross-version comparison ("baseline was scored on v1 — re-run to compare") rather than showing a delta that mixes two penalty sets. Far fewer audits move than under a full re-calibration: a page that triggers neither new condition scores identically on v1 and v2. **Documentation must record the divergence and its reasoning** — `DISCOVERABILITY-MODULE.md` gets a penalty table mapping each shipped blocker to its PRD row, with the four deliberate differences and why each one is calibrated where it is. |
| **D2** | API namespace | **Add `/api/v1/discoverability/*` as canonical**; keep `/api/v1/audits\|recommendations\|targets\|benchmarks` as permanent aliases. No existing integration breaks. |
| **D3** | Table naming | **Keep the existing `audits` / `audit_*` names, and extend the same `audit_` prefix to every new table** rather than the PRD's `discoverability_*`. So P2 creates `audit_business_truth_records`, `audit_business_truth_versions`, `audit_entities`, `audit_entity_relationships`, `audit_entity_evidence`, `audit_brand_results`, `audit_products`, `audit_services`, `audit_locations`, `audit_directory_sources`, `audit_directory_listings`, `audit_directory_findings`, `audit_schema_entities`, `audit_trust_evidence`, `audit_service_radius_profiles`. One prefix across the whole module; the bare PRD names (`products`, `services`, `locations`, `entities`) would collide with generic namespace anyway. A PRD-name → actual-name mapping goes in `DISCOVERABILITY-MODULE.md`. |
| **D4** | AI visibility engines | **Perplexity + Gemini with Google Search grounding.** No browser-driven ChatGPT / AI Overviews sampling. The existing AI-chain fallback stays as the non-live degradation path, flagged `live: false`. |
| **D5** | Directory data acquisition | **Three-tier.** (i) Authorized APIs where they exist — Google Business Profile via the customer's own OAuth; (ii) customer-declared listing URLs; (iii) public listing pages fetched through the existing compliance engine (robots + SSRF + host allowlist + per-host attestation). Registry and matching engine built now; (ii)+(iii) ship first, (i) as a pluggable adapter. **Product copy must read "50+ configured sources, coverage depending on what each customer authorizes" — never a flat "50+ directories audited".** |
| **D6** | Workspaces / RBAC | **Wire `workspace_id` through the audit tables in P1** (columns already exist, `public.workspaces` exists since 0031, back-filling later is far more expensive). The PRD's 7-role RBAC — viewer, analyst, editor, manager, admin, agency admin, client viewer — **defers to P2** alongside the workflow expansion, where those roles first have something to act on. |
| **D8** | Sequencing | **Hard P1 gate.** P1 ships complete and verified against the PRD §16 completion definition before any P2 work starts. ✅ **W1–W8 COMPLETE.** The gate is now `src/lib/discoverability/p1Gate.test.js` — 11 assertions reading the real registries, so P1 cannot quietly become incomplete. A completion claim living only in a document goes stale the first time somebody deletes a function and nothing says so. |

### Still open — not blocking, will surface at the workstream that needs them

| # | Decision | Default I will proceed on unless told otherwise |
|---|---|---|
| **D7** | P2 subject model — how business-level audits (brand/product/service/location) relate to page-level ones | Sibling audit tables per the PRD, **sharing** the P1 evidence, issue and recommendation tables via a polymorphic `subject_type` + `subject_id`, so one queue, one diff engine and one workflow serve every audit kind. Needed at **W10**; I will confirm before building it. |
| **D9** | Entitlement gating for new capabilities (prompt monitoring, brand audits, local/NAP, trust audits) | Follow the existing `audit.benchmark` / `audit.schedule` precedent in `entitlementModel.js`, with capability keys mapped onto the deck's packaging tiers. Needed at **W8**; I will bring a concrete plan→capability matrix for sign-off then. |
| **D10** | P3 scope | Out of scope on this branch until P1 + P2 are complete and merged, per your instruction. |
| **D11** | Credentials | `$GITHUB_TOKEN` is an expired classic `ghp_` token; `git fetch` and `git push` both fail. Local build is unblocked. A fine-grained PAT with `contents: read/write`, or `gh auth login`, is needed before I can re-verify against the live remote or push this branch. |

---

## 4. Proposed workstreams

Sequenced so each stream's output is the next stream's input. Every stream ends with tests
(`vitest` unit + `netlify` contract), a migration where relevant, and a doc update.

### P1 — 8 workstreams

**W1 · Evidence envelope and explainability spine** *(foundation — everything else writes into it)*
Normalised evidence record `{source_url, selector, section, observed_value, excerpt, structured, collected_at, confidence}`;
enforced at the analyser boundary; persisted on `audit_signals` and `audit_issues`. Each signal row
gains raw value, normalized score, weight, threshold and model version (PRD §13 Explainability).
Adds sitemap indicator + microdata inventory to extraction.

**W2 · Goal-based intake**
`audit_type`, `primary_goal`, `target_geography`, competitor URLs on the audit; 4 new audit profiles
(saas, services, local, e-commerce); 4 new page-type packs (homepage, service, location, comparison);
profile inference with override; intake reuse on re-audit; progressive disclosure in the composer UI.

**W3 · Penalty model completion** *(D1)*
Add `ENTITY_SCHEMA_INVALID` (0.10) and `SEVERE_CWV_FAILURE` (0.10) with their detection rules,
issue codes and remediation constructs. Every existing penalty keeps its shipped weight. Bump
`scoring_model_version` to `v2` and add the cross-version comparability guard to `auditDiff`.
Rewrite the penalty section of `DISCOVERABILITY-MODULE.md` as a shipped-vs-PRD mapping table with
the reasoning for each of the four deliberate divergences.

**W4 · Gap analysis v2**
Root-cause taxonomy (8 causes); observed-fact / inference separation; `recommended_module` (M1–M13);
owner role and workflow state persisted on the issue; issue↔recommendation linkage tightened.

**W5 · Recommendation Studio completion**
Meta title/description **variants**; internal-link recommendations; content brief generator
(category / comparison / use-case / industry); technical remediation brief. Assign verb on the queue.

**W6 · AI Visibility Intelligence** — ✅ **COMPLETE.** Grounded Gemini (D4's second engine, which did not exist), the seven-kind prompt taxonomy and generator, the seven citation states, competitor tracking with declared and discovered kept apart, WAVI as a scoring signal at `scoring_model_version` **v3**, prompt monitors on their own table and cron, the displacement narrative, and the AI-visibility panel. ✅ Migrations `0052`/`0053` applied to dev and stage. ⚠️ Nothing verified against a live engine key yet.
Prompt taxonomy + `PromptSet` combinatorial generator; 7-state citation classifier; commercial-prompt
classifier for RecommendationRate; competitor mention tracking → AI SOV; answer prominence and
accuracy → WAVI; competitor-displacement narrative; prompt-run scheduling; `prompt-runs` endpoints;
AI-visibility dashboard panel.

**W7 · Validation Lab completion** — ✅ **COMPLETE.** ⚠️ §7.7's "signal-level diff missing" was WRONG: `auditDiff` has compared every signal through `delta()` since the module shipped. W7 nearly added a second differ before that was spotted. What it adds is the four-way classification (resolved / new / regressed / unchanged), 7/28/90/custom trend windows that report what they EXCLUDED, and implemented-recommendation attribution carrying `relationship: "correlation"` in every record.
Signal-level diff; resolved / new / **regressed** / **unchanged** classification; 7/28/90/custom trend
windows; **implemented-recommendation → score-movement attribution** (correlation, explicitly
labelled as correlation, per the PRD's risk table).

**W8 · Workflow Hub lite + API conformance** — ✅ **COMPLETE.** Migration `0054`: eight lifecycle states (the PRD's seven plus `dismissed`, which is ours and load-bearing), due dates, notes, and `validated_by_audit_id` — without which `validated` is a second word for `implemented`. Queue-level export, nine recommendation-lifecycle webhook events, `/api/v1/discoverability/*` canonical with the bare prefixes as PERMANENT aliases (D2), and `workspace_id` actually written (D6). ⚠️ Evidence attachments deferred: they need file storage, which is a larger call than a column.
Full 7-state lifecycle; assignment, due date, notes, evidence attachments; queue-level exports;
recommendation-lifecycle webhook events; `/api/v1/discoverability/*` namespace with aliases;
`workspace_id` wired through.

### P2 — 6 workstreams

**W9 · Canonical Business Truth Record** — versioned, audit-historied, approval-gated;
`business_truth_records` + `business_truth_versions`.

**W10 · Entity Graph Builder** *(gated on D7)* — `entities`, `entity_relationships`, `entity_evidence`;
14 types, 9 predicates, evidence + confidence on every relation, approve/reject, conflicts raised as
diagnostic findings, drill-down to source; bridged to `canonical_entities`.

**W11 · Brand / Product / Service scoring** — BDS, PDS, SFS with their full component signal sets;
product entity cards, missing-facts matrix, comparison blueprints, service intent coverage map,
service/industry/location page backlog.

**W12 · Local & Directory Intelligence** *(gated on D5; longest lead time)* — `directory_sources`
registry with 5-tier weighting, NAP normalisation, per-directory `Match_d`, weighted NAP score,
findings, correction packs, service-radius query builder, India-first source pack.

**W13 · Schema intelligence + Trust & Proof** — 8-schema validation matrix and Schema score;
`schema_entities`; `trust_evidence` and the TC score with source quality/recency/relevance weighting
rather than raw counts.

**W14 · Workflow Hub v2 + P2 APIs** *(gated on D6, D9)* — 7 approval stages, agency/client permission
model, revalidation trigger on "implemented", the 14 P2 endpoints, entitlement gating.

---

## 5. Cross-cutting rules this build will hold to

Taken from the PRD's non-functional section, the deck's design principles, and this repo's own
locked architecture rules (`AGENTS.md`):

1. **One evidence model, many scorecards.** No parallel data silo per framework.
2. **`unknown` is never `0`.** The existing coverage/redistribution discipline extends to every new
   signal, score and P2 module without exception.
3. **Observed fact ≠ inference.** Separate fields, separately labelled, everywhere they surface.
4. **No ranking, traffic, citation or revenue guarantees** in any copy, report, export or API field.
5. **Approval before external effect.** Constructs, corrections and integration payloads are
   generated for review; nothing publishes itself.
6. **Pure model code stays pure** (`src/lib/discoverability/*` — zero I/O, imported by both React and
   Netlify functions, so the score the user sees is the score the server stored).
7. **Codes are a public contract.** Add signal, issue and construct codes; never repurpose or
   renumber one.
8. **Compliance gate applies to every fetch**, including directory pages — robots, SSRF, host
   allowlist, per-host attestation, exactly as `extract.js` and the current audit router do.
9. **Design system unchanged** — `design-system.css` + `screens.css` tokens; no Tailwind conversion.

---

## 6. What I will do first, on approval

1. Re-verify branch sync against the live remote once a working token is available (§0.1).
2. **W1 — the evidence envelope**, because every other workstream in both phases writes into it and
   retrofitting it later would mean touching every analyser twice.
3. **W2 — goal-based intake**, because it is the smallest change that makes every subsequent audit
   carry the context P2 needs, and back-filling goal/geography onto historical audits is impossible.

Then W3–W8 in order, with a P1 completion review against the PRD §16 definition —

> *A user can audit a URL/domain, select a discoverability goal, receive transparent SEO/AEO/GEO
> scores with evidence, review ranked issues, generate implementation-ready fixes, save a baseline,
> re-audit, understand score/issue changes, monitor selected AI prompts, and identify competitors
> displacing them.*

— before any P2 work begins.
