# Discoverability Intelligence — P1 + P2 implementation plan

**Branch:** `Discoverability-P1-P3-implementation` (the one live branch; `discoverability-p1-to-p3` was folded into it)
**Source of truth:** *DatIQ Discoverability Intelligence System — Consolidated BRD and PRD, P1/P2/P3* (37pp) and the Perplexity architecture/mindmap deck (18pp).
**Status (2026-09-12, final):** ✅ **P1 (W1–W8) AND P2 (W9–W14) ARE COMPLETE**
on `Discoverability-P1-P3-implementation`. P3 has not started.

✅ **Every migration through `0064` is applied to dev/stage** (owner-confirmed
2026-09-12) — `0055`–`0058` earlier, `0059`–`0061` and `0062`–`0064` since.
🔴 **Production has none of `0050`–`0064` and is fifteen migrations behind.**
Every P2 endpoint reads a table that does not exist there, so a deploy without
the apply turns a feature that tested clean twice into a 500.
See [DB-MIGRATION-RUNBOOK.md §4d + §4e](DB-MIGRATION-RUNBOOK.md).
**The next migration number is `0065`.**

📋 **The pass before any promotion is now automated.**
[AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md](AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md)
(renamed from `MANUAL-TEST-…`; P3 extends it rather than replacing it) drives
`npm run verify:discoverability` — **61 checks across branch → staging →
production, in that order**, because each environment answers a different
question. **13 rows genuinely cannot be automated** and are listed there rather
than quietly omitted. 🔴 **Production is READ-ONLY by default**: a full write
pass creates real rows in a customer's account and spends real audit quota, and
several P2 tables have no delete endpoint — `audit_subject_scores` **appends by
design**, because the trend is the product — so that residue cannot be tidied
away. `--allow-writes` and `--allow-audits` must be passed by hand there.

⚠️ **§7 below is the DEVIATION REGISTER** — every place the shipped code differs
from this plan, and every thing deliberately deferred, with the reason. Read it
before concluding anything here is missing by accident.

✅ **Two completion sweeps close this plan out, and both are clean.** Every one
of the 32 `src/lib/discoverability/*` modules has a production importer
(`subjectScoring.js` was the only orphan, and closing it is what `0064` did);
every `audit_*` table across `0030`–`0064` has a writer. ⚠️ Five tables look
unwritten to a JS-only grep and are **not** defects — `report_access_log` is
written by a SQL function in `0039`, the rest belong to other phases.

⚠️ **What is deliberately NOT built, so it is not mistaken for an oversight:**
the fourteen-endpoint `/api/v1/discoverability/*` published inventory (the
canonical prefix and its permanent aliases exist; the inventory does not),
connector approval-gating, **D6's seven discoverability roles** (needs the
signed role matrix — guessing a role vocabulary is the same mistake as guessing
the PRD's component expansions, somewhere harder to reverse), and **any UI for
the P2 modules**: `0062`–`0064` and their routes are the storage and the
contract, and no screen reads them yet.

⚠️ **Migrations `0059`–`0061` are repairs, not features, and all three were
found by review rather than by a failing test.** `0059` — W12's listing upsert
named an expression index PostgREST cannot use as a conflict arbiter, so every
save would have been refused. `0060` — D7's `upsert_audit_subject` shipped as
SELECT-then-INSERT, so a concurrent caller raised `unique_violation` instead of
receiving the existing subject; harmless today because `sameSubject()` falls
back to `target_id`, and not harmless once W13 persists an entity-backed
subject that has no fallback. `0061` — 🔴 **the 0044 defect one layer down**:
ten SECURITY DEFINER functions taking a caller-supplied `p_user_id` were
executable by `anon`, because PostgreSQL grants EXECUTE to PUBLIC by default
and nobody had checked functions when 0044 locked the tables. ✅ **All three are
applied to dev/stage** (owner-confirmed 2026-09-12); production still needs them.

🔴 **AND A FOURTH DECLARED-AND-NEVER-WRITTEN TABLE, found in the same review.**
`audit_entity_evidence` (W10 / `0056`) holds CORROBORATION — every later
sighting of an edge, which the migration's own header says is what separates
*"we read this once in 2024"* from *"we have read this on six pages across nine
months"*. `recordEntityEvidence` was written for it and **called by nothing**,
so the table was empty for the life of the module. Worse than silence: the
duplicate-edge route returned a 409 whose message read *"Re-observing one
corroborates it rather than adding a second copy"* — a sentence that was false,
and whose test asserted the CLAIM rather than the write, so it stayed green.
Now wired, with the 409 carrying a `corroborated` flag so a caller can tell a
recorded sighting from a lost one. **The running count of this defect in this
schema is four:** `audit_signals.raw_value`, `audit_signals.evidence_json`,
`audit_recommendations.issue_id`, and now this one.

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

> ## 🔴 THIS SECTION RECORDS THE STATE ON 2026-09-10, BEFORE ANY WORK. IT IS HISTORY.
> **P1 is complete.** Every ⚠️ and ❌ below was closed by W1–W8 unless this note
> names it as deferred. The rows are kept rather than rewritten because two of
> them turned out to be **WRONG about the code at the time** — §7.6 recorded
> `metaTags` as emitting no variants when it had emitted three since the scoring
> engine shipped, and §7.7 recorded the signal-level diff as missing when
> `auditDiff` had built one all along. A second differ was written against that
> row before it was caught. **Read this section as a hypothesis somebody held
> once, never as a survey of the code.**
>
> **The live answer is `src/lib/discoverability/p1Gate.test.js`** — assertions
> that read the real registries, so P1 cannot quietly become incomplete the way
> four crons once did.
>
> **Deferred, deliberately, and the only P1 item not built:**
> **evidence attachments** on a recommendation (§7.9). They need file storage
> with its own quota, lifecycle and purge path, which is a larger call than a
> column — recorded rather than quietly dropped.



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
| 9.1 | Canonical Business Truth Record (+ versions, approval-before-canonical) | ✅ W9 — `0055`, three tables, approval enforced in three layers |
| 9.2 | Entity Graph Builder (14 entity types, 9 predicates, evidence + confidence on every relation) | ✅ W10 — `0056`, four tables, domain/range enforced |
| 9.3 | Brand Discoverability Score `BDS = 0.25EC + 0.20SD + 0.25ASOV + 0.20TC + 0.10RA` | 🟡 W11 — model + tests; TC redistributed pending W13. **D7 is signed off and built (`0057`)**, so persistence is unblocked; the surface lands with W13 when TC exists to store |
| 9.4 | Product Discoverability `PDS = 0.25CF + 0.20EA + 0.20CC + 0.15TP + 0.10AR + 0.10RA` | 🟡 W11 — model + tests; TP pending W13 |
| 9.5 | Service Findability `SFS = 0.25IC + 0.20VC + 0.20PE + 0.15GA + 0.10TR + 0.10CR` | 🟡 W11 — model + tests; **GA now measurable (W12 shipped)**, TR pending W13 |
| 9.6 | Local & Directory Intelligence (5-tier source registry, NAP formula, per-directory match, correction packs, India-first sources) | ✅ W12 — registry, pure matcher, correction packs, service-radius builder, `0058`; `0059` repairs the live listing-upsert arbiter |
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
| **D7** | P2 subject model — how business-level audits relate to page-level ones | ✅ **SIGNED OFF AND SHIPPED** as `0057` (`audit_subjects`), per [`DISCOVERABILITY-D7-SUBJECT-MODEL.md`](DISCOVERABILITY-D7-SUBJECT-MODEL.md).** Short version: do NOT make `audit_issues` polymorphic — a `subject_id` pointing at different tables per row cannot carry a foreign key, and it touches every reader of the P1 queue. Instead make the AUDIT polymorphic one level up, via an `audit_subjects` registry where every reference is a real FK and a CHECK enforces exactly-one-of. `audit_issues` and `audit_recommendations` stay UNCHANGED; one queue and one differ are preserved because findings still hang off `audit_id`. **Needed before W11 can persist anything.** |
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

**W9 · Canonical Business Truth Record** — ✅ **COMPLETE.** Migration `0055`: `audit_business_truth_records`, `audit_business_truth_versions` and a third table the PRD does not name, `audit_business_truth_conflicts` — because storing the record without comparing it to the pages produces a form, not a finding. Five version states, self-approval refused in three places (pure model, CHECK constraint, and the promotion function), and promotion as ONE SQL function because it is three writes that must not separate. ⚠️ `declared` is deliberately **not** an evidence method: `makeEvidence` requires a source URL, and forcing a customer's own assertion through it would mean fabricating provenance for a fact that was never on a page. The API refuses `observed`/`imported` from a client for the same reason. 🔴 The conflict table **is written**, by every audit whose domain has an approved record — asserted by contract test, because this repo's own history is three columns declared, merged and never written.
Versioned, audit-historied, approval-gated; `business_truth_records` + `business_truth_versions`.

**W10 · Entity Graph Builder** — ✅ **COMPLETE.** Migration `0056`: `audit_entities`, `audit_entity_relationships`, `audit_entity_evidence` and a fourth the PRD does not name, `audit_entity_conflicts`. 14 types and 9 predicates, each predicate declaring a **domain and range** that `validateRelation` enforces — without that a graph is a bag of edges and "this review employs that topic" is storable, meaningless and impossible to notice later. ⚠️ **The PRD enumerates neither list anywhere visible in this repo**, the same situation W4 hit with M1–M13; the counts match and the NAMES are derived from schema.org, the vocabulary this module already reads and validates. If the PRD's own list differs, ADD — never renumber. 🔴 Self-edges, duplicate edges and dangling edges are all refused by the schema, and `approve_entity_relationship()` approves an edge's ENDPOINTS in the same statement because an approved edge between two unreviewed nodes is a half-built statement. 🔴 Endpoint types are JOINED from the entities, never stored on the edge — a second copy would drift the first time a node was re-typed, after which EG-03 and EG-04 would check against a type nobody holds. ⚠️ **D7 is not pre-empted:** graph conflicts get their own table rather than retrofitting `subject_type`/`subject_id` onto `audit_issues`, which touches every reader of the P1 queue.
`entities`, `entity_relationships`, `entity_evidence`; 14 types, 9 predicates, evidence + confidence
on every relation, approve/reject, conflicts raised as diagnostic findings, drill-down to source;
bridged to `canonical_entities`.

**W11 · Brand / Product / Service scoring** — ✅ **COMPLETE.** The model shipped in W11; its result surface landed as `0064` once both stated blockers were gone.

🔴 **`subjectScoring.js` WAS IMPORTED BY NOTHING FOR THREE WORKSTREAMS, AND THE DEFERRAL EXPLAINING IT HAD EXPIRED.** The withholding was deliberate and recorded: persisting a subject score needed a subject model (D7) and two components that did not exist (TC, TP). **D7 shipped as `0057` and TC/TP as `0062`** — after which nothing connected the two facts, exactly as `local_directory.built` stayed `false` for a session after W12 went live. **A module whose only reader is its own test is not wired**, which is this schema's recorded failure mode four times over; it is not the fifth. `subject-score-parity.test.js` now asserts a **non-test importer exists** — the guard that would have caught it.

⚠️ **AND W14 HAD ALREADY ADDED `audit.subject_score` FOR A ROUTE THAT DID NOT EXIST** — a capability with no caller, introduced by the very session closing this class of defect elsewhere. It has one now.

🔴 **THIS TABLE APPENDS; EVERY SIBLING UPSERTS, AND THE DIFFERENCE IS WHAT EACH IS FOR.** `audit_schema_entities` answers *"what does this page declare now"* — a second opinion is not wanted. `audit_subject_scores` answers *"what did this brand score on the 12th"*, which **is** the product. An arbiter here would silently collapse a subject's whole history into one row on every re-score, leaving a single row claiming to be the trend. Two scorings on the same day are two measurements; refusing the second to prevent a duplicate would be refusing a re-measure.

🔴 **`score` IS NULLABLE AND `coverage` IS NOT.** A stored `0` would be indistinguishable, for ever, from a subject that genuinely scored zero. And a score without its coverage is not a smaller score, it is a **different** one: 72 at 80% with TC excluded and 72 at 100% are not the same measurement, so a trend drawn through scores whose coverage was dropped shows a phantom jump the day an excluded component starts being measured — `weightedMean`'s own failure mode re-created at the storage layer.

⚠️ **`SUBJECT_MODEL_VERSION` IS AN `s`-SERIES, NOT THE PAGE MODEL'S `v`.** `SCORING_MODEL_VERSION` is `v3` and describes the penalty and pillar maths; BDS/PDS/SFS moves for different reasons, and one number for both would make both comparability claims false. ⚠️ **Bump it when a WEIGHT moves, never when a component's SOURCE arrives** — TC becoming measurable is coverage rising under the same formula, which `coverage` and `blockedBy` already record.

⚠️ **THE KIND COMES FROM THE STORED SUBJECT, NEVER THE REQUEST BODY**, and the CHECK constrains it to the three scorable kinds — `audit_subjects` also holds `page`, `domain` and `location`, for which `scoreIdFor()` returns null. A row claiming a page has a BDS is a category error, refused in both layers so they cannot disagree about who decides. **The score is computed server-side and never accepted from a client** — a supplied score is not a measurement, it is a number somebody typed.

*Original row, kept for the record:* 🟡 **SCORING MODEL COMPLETE; PERSISTENCE IS W13's STEP 5.** ⚠️ This row read "awaits D7" until D7 shipped as `0057`; the remaining blocker is not the subject model but TC and TP, which W13 supplies.** `subjectScoring.js` implements all three formulas at the PRD's exact weights (asserted, so an "align the numbers" pass fails the build), the missing-facts matrix and the service intent-coverage map. ⚠️ **The weights are the PRD's; the component NAMES are derived** — the abbreviations are expanded nowhere visible in this repo, the same situation W4 and W10 hit — and every component is bound to a named `source`, because a component with no source is a weight applied to a number nobody produces. 🔴 **TC is 20% of BDS and W13 has not shipped**, so it is EXCLUDED and redistributed and the result carries `blockedBy: ["W13"]` — scoring it 0 would take every brand score down twenty points for a module that does not exist, then show a phantom twenty-point gain the day it lands. The missing-facts matrix **splits what the customer can act on from what WE have not built**: telling somebody to improve trust when the thing that measures it is unbuilt is a referral to nothing. ⏸ **Persistence, the API and the UI are deliberately NOT built** — they need a subject model, which is D7, and implementing an unapproved schema decision is harder to reverse than deferring it. See `DISCOVERABILITY-D7-SUBJECT-MODEL.md`.
BDS, PDS, SFS with their full component signal sets; product entity cards, missing-facts matrix,
comparison blueprints, service intent coverage map, service/industry/location page backlog.

**W12 · Local & Directory Intelligence** — ✅ **SHIPPED.** `directorySources.js` (18 sources, five
tiers, D5's three acquisition modes, India-first pack), `napModel.js` (normalisation, per-field match
states, `Match_d`, the weighted NAP score, eight `LD-xx` findings, correction packs, the
service-radius query builder), migration `0058` (4 tables), `/local-directory/*`.
🔴 **NORMALISATION IS MOST OF THE MODULE AND THAT IS THE POINT** — "Pvt Ltd" against "Private
Limited", "Rd" against "Road" and `+91 80 4718 2200` against `08047182200` are the SAME values, and a
checker that reports them as mismatches produces a list nobody reads, after which the one real
mismatch in it goes unfixed. ⚠️ **`LD-05` exists because the obvious check is wrong on registries**: a
registered office is routinely not a shopfront, so an MCA difference gets its own low-severity code
rather than sending a customer to amend a statutory filing to match a shop. ⚠️ **An unchecked source
is EXCLUDED and named, never scored 0** — under D5 most customers authorise nothing, and a
zero-for-unchecked rule would open every local report near zero and then jump the day they connect
one. ⚠️ **`coverageClaim()` is the one place the coverage sentence is built**, and a test asserts the
forbidden flat "N directories audited" phrasing can never come out of it.

**W13 / W14 preflight — five rules the 2026-09-12 review earned.** Each of
these cost a migration or a route fix on work that had already been reviewed
and merged, so they are stated here rather than rediscovered:

0a. **Every new table gets a contract test that asserts the WRITE, confirmed
    RED before the table is merged.** Four tables in this schema have now been
    declared, reviewed, merged and written by nothing
    (`audit_signals.raw_value`, `audit_signals.evidence_json`,
    `audit_recommendations.issue_id`, `audit_entity_evidence`). A column
    nothing writes is invisible, because the read path returns `null` exactly
    as it would for "not applicable". ⚠️ Assert the CALL, not the claim: the
    409 that said "re-observing corroborates" had a passing test that checked
    the *sentence*.
0b. **A unique constraint that backs an upsert must name COLUMNS, not an
    expression.** PostgREST's `on_conflict=` takes a column list, and
    PostgreSQL will not select an expression index as that arbiter — so 0058's
    `coalesce(...)` index enforced the invariant and refused every save. Use
    `unique nulls not distinct (...)` when a nullable column is part of the key
    (`0059`).
0c. **Get-or-create is `INSERT .. ON CONFLICT`, never SELECT-then-INSERT.**
    A unique index makes a second row impossible; it does not make the losing
    caller return the winner's id. Infer a partial index by restating its
    predicate (`0060`).
0d. **A new SECURITY DEFINER function revokes from `public`, not just from
    `anon` and `authenticated`.** PostgreSQL grants EXECUTE to PUBLIC by
    default and both roles inherit it, so the narrower revoke is a no-op that
    reads as though it worked — which is how ten impersonation primitives
    shipped and how `claim_billing_session` stayed anon-reachable from 0012 to
    `0061`. Then grant `service_role` explicitly rather than relying on
    Supabase's default privileges, which a restored dump does not carry.
0e. **A parent id in a request body is a claim, not a fact.** Check
    `truth_record_id`, `subject_id`, `entity_id` and any new reference against
    a row the caller owns before writing, and refuse with **404, not 403**, so
    the endpoint is not an enumeration oracle over other tenants' uuids.
    W9 and W10 did this; W12 shipped without it.

**W13 · Schema intelligence + Trust & Proof** — ✅ **SHIPPED.** `trustProof.js`
(three independence tiers, seven trust signals, the PRD's six TC terms),
`schemaIntelligence.js` (eight approved types, the PRD's five Schema terms),
migration `0062` (2 tables), `/schema-trust/*`. **`trust_proof` and
`local_directory` are now `built: true`**, so TC (20% of BDS), TP (15% of PDS),
TR (10% of SFS) and GA (15% of SFS) stop being redistributed.

🔴 **W12's OWN FLAG WAS STILL `false` AND NOBODY NOTICED FOR A SESSION.** It
shipped `napModel.js` and `/local-directory/*` and never flipped
`local_directory.built`, so `geographic_availability` kept reading `null` and
kept telling the customer it was "waiting on W12" for a module that was already
live. The old test simply restated the stale list and agreed with it —
**a list that restates the thing it checks cannot catch it drifting**, the same
defect as the hand-written `STORE_EXPORTS` array. The registry now names the
module implementing each source and the parity test imports it, so the flag is
checked rather than trusted.

*Original plan, kept for the record:*

1. **Freeze the two scoring registries before wiring a route.** The repository
   records the two exact formulas, but not the PRD expansions for
   `Schema = 0.30O + 0.30L + 0.20S + 0.10F + 0.10G` and
   `TC = 0.25D + 0.20R + 0.20P + 0.15M + 0.10C + 0.10X`. Resolve those names
   from the signed PRD, then make each a versioned registry entry with its
   source, applicability and weight. Do not guess an expansion from the
   initials: a plausible but wrong metric is worse than an explicit hold.
2. **Reuse the P1 extraction, not a second crawler.** Build pure
   `schemaIntelligence` and `trustProof` models from the existing JSON-LD,
   microdata inventory, visible content, dates, authorship and evidence
   envelope. The schema matrix will cover the PRD's eight approved types,
   validate only types applicable to the page, and return `null` for an
   unmeasured fact. Missing or malformed markup is an observed fact; any
   citation, ranking or trust implication remains a labelled inference.
3. **Score evidence quality, never raw volume.** Each trust item must retain
   evidence URL, extraction location, observed value, collection time,
   source-quality, recency and relevance inputs. The TC model weights those
   inputs, excludes unavailable components and reports coverage/reasons; ten
   low-quality testimonials must never outscore one independently verifiable
   source. It must not fabricate reviews, customers, credentials or claims.
4. **Persist additively in `0062`.** ⚠️ *This step said `0060` when written; `0059`–`0061` have since been taken by the three repairs named in the status header above.* Add `audit_schema_entities` and
   `audit_trust_evidence`, plus the W11 subject-scoring result/subject data only
   where an immutable historical result is required. Reuse `audit_issues` for
   actionable findings and W1's evidence envelope rather than inventing a
   second issue queue. Every table is owner-scoped, workspace-aware, RLS locked
   to `service_role`, and has a retention/purge classification before merge.
5. ✅ **DONE as `0064` — but only after this step sat unactioned while W13 was marked SHIPPED, which is the same declared-vs-actual drift W13 itself found in `local_directory.built`.** **Land W11's withheld result surface together with its inputs.** Persist
   BDS/PDS/SFS against `audit_subjects`, preserving component values, coverage,
   model version and `blockedBy`. Once W13 supplies TC and TP, stop
   redistributing those two components only; do not reinterpret historical
   scores under the new model version. Expose a read-only scorecard that shows
   evidence, unknowns and the reason a component is absent.
6. **Use narrow internal routes first.** Add authenticated, owner-filtered
   schema/trust/subject-score endpoints and client methods; W14 owns the final
   canonical `/api/v1/discoverability/*` inventory. No client-provided
   `observed`, `verified`, source-quality or approval flags may create a
   higher-fidelity record, and any future evidence fetch must go through the
   existing SSRF, robots, allowlist, consent and wall-clock gates.
7. **Acceptance gates.** Confirm every new pure-model test RED first; migration
   constraints and owner isolation under real PGlite; route contracts for
   foreign IDs and forbidden provenance; score-version comparability; then
   `test:db`, unit, contract, integration, security, build and prerender.

**W14 · Workflow Hub v2 + P2 APIs** — 🟡 **D9 SHIPPED; the lifecycle needed no
change, and that is a finding rather than a gap.**

🔴 **W9 THROUGH W13 HAD NO ENTITLEMENT CHECK OF ANY KIND.** Every truth record,
graph edge, directory listing and trust observation was writable on any plan
including Free — the same gap Phases 4-6 had, where three cost-bearing
operations went unmetered and three of the BRD's own upgrade triggers were
unenforceable. Six new capabilities follow the `audit.benchmark` precedent D9
names: reuse the audit allowance that already exists rather than invent a plan
axis nobody bought. **Writes are gated; reads are not** — refusing to show a
customer the record they already own is taking away something they were given.

✅ **Revalidation is now an explicit, idempotent REQUEST** (`0063`,
`POST /recommendations/{id}/revalidate`). It records intent and charges
nothing; the run happens on the monitor's tick where it is visible and
countable. Idempotency is enforced by a `revalidation_requested_at=is.null`
filter on the PATCH rather than a read-then-write, so two concurrent clicks
produce one claim — **clicking twice must not cost twice**, and a check-then-set
would race exactly as `payment-webhook.js`'s dedup does.

🔴 **STEP 2 WAS A FALSE PREMISE AND THE CODE STOPPED IT.** The plan asks that
every transition validate the prior state. `workflowLifecycle.js` already
carries all seven stages plus `dismissed`, and `canTransition`'s own header
says it is **deliberately not a gate**: *"`next` is what the UI should OFFER…
a state machine that refuses a legitimate jump teaches people to work around
the tool."* It returns `{allowed, suggested}`, so the obvious enforcement —
`!canTransition(...)` — is **dead code that reads as a guard**. And the
integrity that matters was never missing: `requirementsFor` has always refused
`validated` without the audit that re-measured the signal, *"otherwise it is a
claim, not a measurement"*. The enforcement was written, then reverted, and
both halves are pinned by test so it is not attempted again.

⚠️ **STILL OPEN:** the fourteen-endpoint `/api/v1/discoverability/*` inventory
(step 4), connector approval-gating (step 5), and D6's seven discoverability
roles — which need the signed role matrix, not a guess.

*Original plan, kept for the record:*

1. **Resolve the two remaining decisions before coding.** D6's workspace-id
   plumbing is complete, but P2's seven discoverability roles are not. Keep
   global workspace membership roles unchanged; introduce a
   discoverability-scoped role mapping only if the signed role matrix cannot be
   derived from existing membership. D9 must name capability, plan, quota,
   upgrade copy and failure behaviour for brand, product, service, local,
   schema, trust, prompt-monitoring and revalidation actions. No UI-only gate.
2. **Extend the existing lifecycle; do not create a competing state machine.**
   Map the PRD's seven approval stages onto `workflowLifecycle.js`, retain the
   existing load-bearing `dismissed` state, and make every transition validate
   actor role, prior state, required note/assignee/evidence and workspace
   membership on the server. Preserve the current audit/recommendation history
   rather than backfilling a guessed state.
3. **Make revalidation an explicit, idempotent request.** An approved
   `implemented` item may create one `validation_scheduled` record linked to
   the recommendation and baseline, but it must not silently run a paid audit
   or publish a correction. The worker checks entitlement, workspace access,
   compliance and idempotency before a re-audit; refusals are visible and cost
   nothing.
4. **Lock the API contract before implementation.** Build the requested
   fourteen-endpoint table from the signed PRD, mapping every endpoint to its
   existing internal route or a new handler, request/response schema,
   capability check, role requirement, idempotency requirement and audit event.
   Make `/api/v1/discoverability/*` canonical and retain established aliases;
   no endpoint is considered delivered until its owner and cross-tenant 404
   contract are tested.
5. **Connector effects remain approval-gated.** HubSpot, Slack, Notion,
   Airtable and Zapier payloads are generated from approved records only,
   revalidated immediately before delivery, destination-validated, idempotent
   and logged. A connector failure cannot move a recommendation to implemented
   or expose another workspace's payload.
6. **Acceptance gates.** Add a role × action matrix test, all lifecycle
   transition tests, two-tenant IDOR tests, entitlement-denial/no-charge tests,
   revalidation idempotency tests and API-schema parity tests. Finish with the
   full DB, unit, contract, integration, security, build, prerender and smoke
   suite before any production migration.

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

---

## 7. Deviation register — what differs from this plan, and why

> **Added 2026-09-12.** This section exists because a plan read six months later
> is indistinguishable from a specification, and every gap in it then reads as an
> oversight. Each row below is either a **deliberate departure** from what §4
> proposed or a **deferment with a named blocker**. None is an accident.
>
> ⚠️ **Rule for whoever extends this into P3: add rows, never delete them.** A
> deferment that later ships is marked ✅ RESOLVED with the migration or commit
> that did it — the record of *why it waited* is the part that stops the same
> debate happening twice.

### 7.1 Deviations — the code differs from the plan, deliberately

| # | What the plan implies | What shipped | Why |
|---|---|---|---|
| **DEV-01** | 🔴 W11 scores a brand, product or service, and W13 unblocks TC/TP so `trust_credibility` reads as measured. | **`POST /subject-score/scores` is unreachable for any API caller today.** `audit_subjects` rows are minted by exactly one caller — `ensureSubject`, from the audit pipeline — always with `kind: "page"`. `0057`'s `kind_matches_ref` CHECK requires `entity_id is not null` for `brand`/`product`/`service`, and **nothing in the API creates a subject over an entity.** So `scoreIdFor("page")` returns null and the route correctly 400s. | The model, the store, the route, the migration and the tests are each complete and correct **in isolation**; the chain from *"I have a brand"* to *"here is its BDS"* has no first link. **This is the same class of defect this phase closed twice already** — a module whose only reader was its own test, and a capability with no caller. It is recorded rather than patched because the fix is a **design decision, not a mechanical one**: does creating an entity mint a subject automatically, or is a subject an explicit act? Auto-minting puts a row in `audit_subjects` for every proposed-and-later-rejected node; explicit minting needs an endpoint nobody has specified. **That choice belongs to the owner.** Detected by `F-02`, which reports DEVIATION with this text rather than a false green. |
| **DEV-02** | The trust model refuses an unsourced third-party claim, and the refusal is testable through the API. | **The database CHECK is unreachable through the route**, and that is correct. The route refuses a body-supplied `independence` **outright** (D-09), so a caller can never reach the state the CHECK guards. | Two layers, one decision: `makeObservation()` derives independence from whether a checkable source URL is present, and the CHECK is the backstop for a writer that bypasses the route. The old test sheet's `D-08` described exercising the CHECK through the API, which cannot be done; it is now a manual/db-verify row. **A guard you cannot reach from the route is not dead code — it is the second lock.** |
| **DEV-03** | §4's W14 step 2 asks that every recommendation transition validate the prior state. | **Reverted in full.** `canTransition` returns `{allowed, suggested}` and is **always true for a known state, by design** — its own header says so: *"`next` is what the UI should OFFER; it is not a gate. A state machine that refuses a legitimate jump teaches people to work around the tool."* So `!canTransition(...)` is permanently false: **dead code that reads as enforcement.** | The integrity that matters was never missing — `requirementsFor` has always refused `validated` without the audit that re-measured the signal. Both halves are pinned by test. ⚠️ **A function called by nothing is usually a defect in this codebase — four times over — but not always, and here the code said which.** |
| **DEV-04** | D1 aligns the penalty model to the PRD. | **Not one existing factor moved.** `AI_CRAWLER_BLOCKED` stays **0.20** (PRD says 0.15), `CONTENT_HYDRATION_ONLY` stays **0.20** (PRD says 0.15), both DatIQ extensions stay first-class, and priority stays **multiplicative**, not the PRD's linear form. Only the two PRD conditions with no shipped equivalent were **added**. | A page an engine cannot fetch or render is not a discounted page, it is an absent one. `scoringModel.test.js` asserts **every** factor, so an "align to the PRD" pass fails the build with the reasoning attached rather than silently re-calibrating every score in the product. Full mapping: `DISCOVERABILITY-MODULE.md` §3c. |
| **DEV-05** | One model version. | **Two series, deliberately.** `SCORING_MODEL_VERSION` is `v3` (page penalties and pillars); `SUBJECT_MODEL_VERSION` is `s1` (BDS/PDS/SFS). | Different formulas moving for different reasons. **One number for both would make both comparability claims false.** ⚠️ Bump the `s` series when a **weight** moves — never when a component's **source** arrives; TC becoming measurable is coverage rising under the same formula, which `coverage` and `blockedBy` already record. |
| **DEV-06** | The PRD's component, type and predicate names are implemented as written. | **The PRD expands none of them anywhere in this repository** — BDS's `EC`/`SD`/`ASOV`/`TC`/`RA`, W4's "M1–M13", W10's fourteen entity types and nine predicates, W11's component ids, W13's TC and Schema initials. **Counts match; names are derived**, each recorded with its `binding` and `derivedFrom`, under the constraint that every component binds to something already extractable. | 🔴 **If the PRD's list differs, change the `label` and the `binding` — NEVER the weight and never the id.** Ids travel in stored rows and in every historical diff; a renumbered code silently mis-attributes a fix. Every **weight** is verbatim and asserted by test. |
| **DEV-07** | `audit_*` tables behave consistently. | **`audit_subject_scores` APPENDS; every sibling UPSERTS.** | They answer different questions. `audit_schema_entities` answers *"what does this page declare NOW"* — a second opinion is not wanted, and without the upsert a weekly crawler doubles every count. `audit_subject_scores` answers *"what did this brand score on the 12th"*, which **is** the product. An arbiter there would collapse a subject's whole history into one row on every re-score. ⚠️ **Two scorings on the same day are two MEASUREMENTS**; refusing the second to prevent a duplicate would be refusing a re-measure. Pinned by `F-04`. |

### 7.2 Deferments — not built, with the blocker named

| # | Deferred | Blocked on | Notes |
|---|---|---|---|
| **DEF-01** | 🔴 **Any UI for the P2 modules.** `0062`–`0064` and their routes are the storage and the contract; **no screen reads them.** | Product design. | The automated pass is API-level throughout for this reason, and says so. This is the largest single gap between "P2 is complete" and "a customer can use P2". |
| **DEF-02** | The fourteen-endpoint `/api/v1/discoverability/*` **published inventory**. | Nothing technical — the canonical prefix and its permanent aliases exist. | The routes work; the public inventory document does not. |
| **DEF-03** | **D6's seven discoverability roles.** | The signed role matrix. | Guessing a role vocabulary is the same mistake as guessing the PRD's component expansions, in a place that is harder to reverse: a role id ends up in stored grants. |
| **DEF-04** | **Connector approval-gating** for directory sources. | D5's connector design. | Until then `acquisition: "authorized_api"` is refused from any request body — fidelity is not a flag a client can set. |
| **DEF-05** | **Workspace-level rollups.** | A workspaces table this module does not own. | Every P2 table already carries a nullable `workspace_id` as the hook, so this is additive when it lands. |
| **DEF-06** | Exercising **any** P2 path against a **live third-party engine**. | Nothing — it simply has not been done. | The citation and PageSpeed paths are P1's and unchanged. ⚠️ P2's own network surface (directory listing fetches) has never run against a real directory. |
| **DEF-07** | 🔴 **Applying `0050`–`0064` to production.** | An operator with production credentials. | **Fifteen migrations behind.** Every P2 endpoint reads a table that does not exist there. ⚠️ **`0061` is a SECURITY fix and should not wait on a feature release to carry it** — see [DB-MIGRATION-RUNBOOK.md §4d](DB-MIGRATION-RUNBOOK.md). |
| **DEF-08** | Deleting the stale remote branch `claude/p2-w9-work-streams-o4gvmq`. | A branch-deletion path that works from here. | `git push origin --delete` fails with `send-pack: unexpected disconnect` and the GitHub MCP set has **no delete-branch tool**. Delete it from the branches page. |

### 7.3 Found while building the automated pass, and fixed

| # | What | Where |
|---|---|---|
| **FIX-01** | 🔴 **`npm run verify:rls` could report "0044 is applied" from a machine that never reached the project.** Behind an egress proxy that allow-lists hosts, every anonymous probe is answered **403 by the proxy** before it reaches Supabase, and the loop counted each as an RLS refusal. It handled a *thrown* network error correctly and missed the case where something in the middle **answers on the host's behalf** — which does not throw and looks exactly like a real response. **Reproduced, then fixed.** | `scripts/lib/postgrestAnswer.mjs` is now the one predicate both verifiers use: PostgREST answers in JSON, always, including its errors; a proxy answers with its own content type and prose. Anything else is **INCONCLUSIVE** (exit 2), a third verdict and not a synonym for either of the others. ⚠️ **A security gate that reports "locked down" when it could not reach the host is worse than no gate.** |
| **FIX-02** | The first draft of the runner's own summary printed **"PRODUCTION: READY"** off a run with **zero passes and sixty-one skips**, because it counted only failures. The same fail-open shape as FIX-01, one level up. | The verdict is now computed from what was **actually exercised**: a stop-ship check that was skipped or blocked leaves the question open, and an open question is not a yes. Pinned by `verify-discoverability-e2e.test.mjs`. |
