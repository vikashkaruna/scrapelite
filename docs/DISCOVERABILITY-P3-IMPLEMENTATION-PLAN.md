# Discoverability Intelligence — P3 implementation plan

**Branch:** `discoverability-P3`, cut from `Discoverability-P1-P3-implementation` @ `628e47f`.
`main` (`2042348`), `staging` and every other branch are untouched and stay that way.
**Source of truth, now IN THIS REPOSITORY:**
[`reference/DISCOVERABILITY-BRD-PRD-P1-P3.md`](reference/DISCOVERABILITY-BRD-PRD-P1-P3.md) —
the consolidated BRD/PRD, §1–§17 — and
[`reference/DISCOVERABILITY-BUSINESS-VALUE-ANALYSIS.md`](reference/DISCOVERABILITY-BUSINESS-VALUE-ANALYSIS.md)
— the current-state and packaging analysis, §5/§6/§9.
**Status:** P1 (W1–W8) and P2 (W9–W14) are complete as code; §2 is the honest account of why
neither is complete as a product. P3 is not started.
**Next migration number: `0065`.**

> **Companions.** [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> — what shipped, plus its **§7 deviation register**, which Stage 1 consumes as its backlog ·
> [`AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md`](AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md)
> — the 61-check runner every stage extends · [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md) §4d–§4e.

---

## 0. What the source documents settle, and what they still do not

The markdown sources carry **every formula as text**. Nothing in P3's scoring has to be guessed.
A prior revision of this file recorded the weights as unreadable — that was true of the PDF, whose
formulas are vector outlines, and is **superseded**.

### 0.1 Settled — transcribe verbatim, assert by test, never "align" later

| § | Formula | Sums to |
|---|---|---:|
| 11.3 | `SXO = 0.20TD + 0.20IC + 0.20UX + 0.20IA + 0.15CD + 0.05MI` | 1.00 |
| 11.3 | `Master = 0.25SEO + 0.20AEO + 0.20GEO + 0.35SXO` | 1.00 |
| 11.4 | `IC = 0.30QH + 0.25AF + 0.20PF + 0.15EV + 0.10CTA` | 1.00 |
| 11.5 | `IA = 0.25O + 0.20A + 0.20V + 0.20P + 0.15N` | 1.00 |
| 11.6 | `UX = 0.30CWV + 0.20Mobile + 0.15Read + 0.15Nav + 0.10Overlay + 0.10Access` | 1.00 |
| 11.7 | `CD = 0.25CTA + 0.25Form + 0.20Proof + 0.15Price + 0.15Flow` | 1.00 |

Component letters are given with each: `TD` Technical Discoverability · `IC` Intent-Aligned
Content · `UX` Fast, Low-Friction Experience · `IA` Information Architecture · `CD` Conversion
Design · `MI` Measurement and Iteration maturity. **P3-DEV-01 and D13 are RESOLVED.**

Also now settled, and each closes a standing P1/P2 open item — see §2.6:

* **§5's M1–M13 module map** — W4's longest-open item. ⚠️ Only **6 of the repo's 13 modules**
  correspond to an M-code; see §2.6.1 before filling anything in.
* **§13's seven roles** — `viewer`, `analyst`, `editor`, `manager`, `admin`, `agency admin`,
  `client viewer`. **D18 is RESOLVED.**
* **§9.10's seven approval stages** — draft, content review, brand/legal review, technical
  review, approved, implemented, validated.
* **§9.2's entity types (15) and predicates (9)** — W10's derived vocabulary is now checkable.
* **§9.6's directory tier weights** — Tier 1 `5x`, Tier 2 `4x`, Tier 3 `4x`, Tier 4 `3x`,
  Tier 5 `1x–2x`, and the two NAP formulas. W12's deviation is now checkable.
* **§12's nine-row ownership matrix** and the nine-state lifecycle.
* **§7.4's seven penalty conditions** — confirming D1's recorded departures are real departures,
  not a misreading: the document says **15%** where the shipped model holds **0.20** for both
  `AI_CRAWLER_BLOCKED` and `CONTENT_HYDRATION_ONLY`.

### 0.2 Still not settled — decisions, not transcription

1. **Whether the master score is stored or computed.** §11.3 gives the formula; §11.14's
   `sxo_results` stores `sxo_total_score` and **no master column**, and P1's
   `discoverability_results` has no master column either. → **D14**
2. **What "weights must be configurable by business model" (§11.3) means operationally** —
   one sentence, no mechanism, and it contradicts a rule this repo pins by test. → **D15**
3. **Which analytics providers, and the call budget** against §13's 60-second median. → **D19**
4. **Retention periods.** §13 says "configurable retention/deletion policies" and names no
   default. Under a public DPDP commitment a default is required. → **D16**
5. **How a scorable subject is created** — unchanged, and unaddressed by either document,
   because DEV-01 is a defect in our implementation rather than a gap in the spec. → **D12**

---

## 1. What P3 is

> **§10 objective, verbatim:** *"Connect discoverability with the customer's post-click
> experience and business outcome. P3 must reveal whether visitors arriving from search and AI
> experiences understand the offer, find the relevant proof, encounter friction, complete an
> action, and generate qualified business results."*

> **§16 complete when:** *"A user can connect search/AI visibility to the post-click experience
> and conversion outcomes; identify intent mismatch, UX/CRO friction and funnel drop-offs;
> create/assign remediation; monitor templates and portfolios; and validate engagement,
> conversion and qualified-outcome movement with appropriate attribution caveats."*

**§11.1 defines it:** `SXO = SEO (being found) + UX (being easy to use) + CRO (driving an outcome)`.

**§10 in scope:** SXO Experience Lab · query/prompt-to-landing-page intent analysis · first-screen
clarity and IA audit · UX friction, mobile and page-experience diagnostics · CTA, form, booking,
checkout, pricing and proof analysis · analytics/event/CRM conversion ingestion ·
search-to-outcome funnels and form diagnostics · template classification and workspace rollups ·
scheduled regression alerts, persona packs, experiments and impact tracking.

🔴 **§10 out of scope — guardrails to ENCODE, not notes to remember:**

| Out of scope | How it is enforced |
|---|---|
| Full user session replays **by default** | No raw-session table. `audit_analytics_aggregates` only, per §11.8's *"aggregated, privacy-minimized"*. A replay integration, if ever added, is opt-in and its own decision. |
| **Autonomous A/B test deployment** | `audit_optimization_experiments` **records** a change and its observation window. It never deploys one. The `0063` precedent: record the request, let a visible tick do the work. ⚠️ The business-value doc §6 lists *"Autonomous/agentic optimization — suggested next test"* as a later P3 row; **suggesting is in scope, deploying is not**, and the two must not blur. |
| **Causal claims without experimental evidence** | §11.12's own words: *"clearly separate correlation from controlled experimental result."* W7 already carries `relationship: "correlation"` on every attribution record. P3 extends that vocabulary; it must never drop it. |

---

## 2. Collisions between P3 and what is already shipped

The part worth reading twice. Each is a decision or a defect, not an implementation detail.

### 2.1 SXO is a fifth framework, and the master score double-counts technical health

The shipped model computes four pillars into **three** framework views at
`SCORING_MODEL_VERSION = "v3"`. §11.15's dashboard shows **five** plus a composite master.

🔴 **`auditDiff` refuses cross-version comparison by design**, and correctly: *"a caveat under a
confident +4.2 is read as a footnote; the number is what gets screenshotted."* If SXO enters
`audits.final_score`, the version goes to `v4` and **every stored baseline in the product becomes
incomparable on release day.**

⚠️ **And the specified master weights count the same evidence up to three times.** Expanding
§11.3 through §7.3, Technical Accessibility reaches the master four ways —
`0.25×0.40 (SEO) + 0.20×0.15 (AEO) + 0.20×0.20 (GEO) + 0.35×0.20 (SXO's TD) = 0.24` — while CWV
and mobile parity additionally arrive inside SXO's own `UX` component
(`0.35 × 0.20 × 0.50 = 0.035`), having already arrived through `TD`. **This is the document's
own model and P3 implements it as specified.** But a score whose overlap is undisclosed is the
kind of number a customer later feels misled by, and this repo's rule is that every score stores
its calculation components (§13). So the overlap is recorded in the explainability payload, not
silently smoothed away.

→ **D14.** Recommended: the master is a **read-time composite over two audit objects**, computed
by one pure function and stored on neither row. P1/P2 baselines stay comparable; SXO gets its own
trend; `weightedMean`'s exclusion discipline applies, so a target with no SXO audit reads
*"not measured"* rather than dragging the master down; and the overlap ships as disclosure.

### 2.2 "Weights configurable by business model" vs the shipped profile rule

§11.3 states it in one sentence with no mechanism. The shipped rule is the opposite and is pinned
by test: **a profile is a LENS, not different maths** — every framework view uses identical
weightings, because *"a user who switched profiles between runs would see movement no change to
their page caused."*

Both are right about different things. A SaaS pricing page and a local plumber's booking page
should not weight `CD` the same — but a weight that varies silently makes the trend line fiction.

→ **D15.** Recommended: configurable weights are legal **only as a stored, versioned weight-set
id on the audit row**, with `auditDiff` refusing comparison across weight-set ids exactly as it
refuses across model versions — stated cause, `incomparableDiff` shape, issue list still
reported. The invariant survives and §11.3 is satisfied.

### 2.3 Analytics ingestion is a new data class with DPDP obligations

P3 connects GA4, Search Console, CRM, booking and commerce systems (§11.8, and the business-value
doc §2 names Clarity, Hotjar and FullStory). That means **third-party OAuth tokens** and
**behavioural aggregates about the customer's visitors**.

§13 is explicit: data minimization, aggregates where possible, **configurable
retention/deletion**, encryption for credentials and tokens.

🔴 **`billing-purge.js` is the only destructive job and its `PURGE_TABLES` / `RETAIN_TABLES` split
is asserted by a parity test.** Every P3 table lands on one list or the other with a written
reason — and `Privacy.jsx` carries a public DPDP commitment that a new class of
personal-adjacent data has to be reconciled with. → **D16**, a Stage-3 gate, not a follow-up.

### 2.4 §12's lifecycle adds two terminal states the repo does not have

§12: `Open → Accepted → Assigned → In progress → Awaiting approval → Approved → Implemented →
Validation scheduled → Validated / No measurable change / Regressed`.

`workflowLifecycle.js` ships eight states and has `validated`. It has neither
`no_measurable_change` nor `regressed` — and those two are the whole point of P3: **a
recommendation that shipped and moved nothing is a finding, not a success.**

⚠️ **Extend; do not rebuild** — and re-read W14's finding first: `canTransition` is deliberately
not a gate, and the obvious enforcement is dead code that reads as a guard. The integrity that
matters lives in `requirementsFor`. Leave `dismissed` alone; it is ours and load-bearing.

### 2.5 Four vocabularies to bridge, never duplicate

| §11.14 table | Already in the repo | Rule |
|---|---|---|
| `intent_mappings` | W6's prompt taxonomy + `audit_prompt_*` tables | **Bridge.** A second prompt store gives two answers to "which prompts do we track". |
| `page_templates` — 12 | W2's 8 page-type packs (`homepage`, `service`, `location`, `comparison`, …) | **Extend.** Add the missing ids; never renumber one. |
| `portfolio_rollups` — 10 axes | `workspace_id` on every `audit_*` table since `0054`; `public.workspaces` since `0031` | **Additive.** This is DEF-05, and P3 absorbs it. |
| `conversion_goals` | nothing equivalent | New. |

### 2.6 What the documents let us check — and two things that turn out to be wrong

#### 2.6.1 🔴 M1–M13 maps onto only SIX of the repo's thirteen modules

W4 refused to guess the numbering and recorded `mCode: null` on all thirteen, with
`gapTaxonomy.test.js` asserting `toBeNull()` for every one. §5 now supplies the list — and the
counts matching at thirteen is a **coincidence**, not a correspondence. §5's M-codes are
*architectural modules*; the repo's `MODULES` are *recommendation destinations*.

| Repo module | §5 M-code |
|---|---|
| `recommendation_studio` | **M5** Recommendation Studio |
| `validation_lab` | **M6** Validation Lab |
| `ai_visibility` | **M7** Benchmarks & AI Visibility |
| `entity_graph` | **M9** Entity Graph Builder |
| `local_directory` | **M10** Local & Directory Intelligence |
| `trust_and_proof` | **M11** Trust & Proof Audit |
| `technical_remediation`, `schema_intelligence`, `business_truth_record`, `brand_discoverability`, `product_discoverability`, `service_findability`, `service_radius` | **none** — sub-capabilities of M2/M3/M9/M10, not modules in §5's map |

Conversely M1 Audit Intake, M2 Extraction & Evidence, M3 Scoring Engine, M4 Gap Analysis,
M8 Workflow Hub, M12 SXO Experience Lab and M13 Portfolio Operations are **not** referral
destinations and get no repo module.

⚠️ **So fill in six and leave seven null with a written reason**, and change the parity test from
*"all null"* to *"these six carry these codes, the rest are null because §5 has no entry for
them."* Inventing a code for the other seven is the exact mistake W4 declined to make — and the
slug stays the stored identifier either way.

#### 2.6.2 🔴 SIX live catalogue issues advertise a shipped module as "(coming)"

`MODULES[].available` drives `IssueMatrix.jsx:203`'s `(coming)` badge. Three flags are stale:

| Module | Flag | Reality | Catalogue issues routed to it |
|---|---|---|---|
| `ai_visibility` | `false` | W6/W7 shipped — `prompt-runs` and `benchmarks` routes, `aiVisibility.js`, `citationStates.js`, `promptTaxonomy.js` | **2 — live-visible** |
| `trust_and_proof` | `false` | W13 shipped — `0062`, `trustProof.js`, `/schema-trust/*` | **4 — live-visible** |
| `local_directory` | `false` | W12 shipped — `0058`, `napModel.js`, `directorySources.js` | 0 — latent |

So a customer whose page trips any of those six issues is told the module that fixes it is still
on the way. ⚠️ **And `CLAUDE.md` records the opposite** — *"The '(coming)' badge is now
UNREACHABLE FROM REAL DATA — no issue in `issueCatalog` maps to an unbuilt module any more"* —
which is false in both directions: it is reachable, and two of the modules it reaches are built.
The badge's own regression test uses a **deliberately synthetic** module and says why, so it
cannot catch this; the missing guard is a parity test over the real catalogue.

⚠️ `brand_discoverability`, `product_discoverability` and `service_findability` read `false`
**correctly for now** — W11 shipped the model but DEV-01 leaves it unreachable, so the flag flips
in CP-1.1, not before. `service_radius` needs checking against §9.9.

#### 2.6.3 What checks out

`WAVI = 0.20M + 0.30C + 0.30R + 0.10P + 0.10A` matches `aiVisibility.js` exactly and is already
asserted by test. The §7.3 pillar and framework weights, §9.3's `BDS`, §9.4's `PDS`, §9.5's
`SFS`, §9.7's `Schema` and §9.8's `TC` all match what W11/W13 recorded as verbatim. **Stage 0
asserts all of them against the committed document** so the claim stops resting on memory.

---

## 3. The P3 inventory, as specified

| § | Thing | Count | Notes |
|---|---|---|---|
| 11.2 | **SXO audit layers** | **6** | Technical discoverability → Technical readiness · Intent-aligned content → Intent Match Score · Fast low-friction experience → Friction Score · Information architecture → Information Clarity Score · Conversion design → Conversion Readiness Score · Measurement & iteration → Measurement Maturity Score |
| 11.3 | Score model + executive master | 6 + 4 | §0.1 — weights verbatim |
| 11.4 | **Intent classes** | **8** | informational · navigational · commercial investigation · comparison · transactional · local/service · support/troubleshooting · brand/reputation validation |
| 11.4 | Intent Match components | 5 | `QH` query-to-heading · `AF` answer-first fit · `PF` page-format fit · `EV` evidence relevance · `CTA` CTA relevance to stage |
| 11.5 | First-screen / IA components | 5 | `O` offer · `A` audience · `V` value/outcome · `P` proof visibility · `N` next-action |
| 11.5 | Required flags | 6 | generic hero without category · audience not identified · value/proof buried below first decision point · competing CTAs · intrusive overlays · no practical pricing/evaluation path on a high-commercial-intent page |
| 11.5 | First viewport must communicate | 5 | what it is · who for · what outcome · why credible · what to do next |
| 11.6 | Friction inputs | 7 + optional | LCP/INP/CLS · mobile parity · readability · navigation depth · broken links/errors · overlays · accessibility basics. **Optional behavioural:** dead clicks, rage clicks, repeat clicks, exit patterns, time to first action |
| 11.7 | Primary outcomes | **12** | demo · trial · contact · quote · booking · purchase · add to cart · call · WhatsApp/chat · download · newsletter · account creation |
| 11.7 | Conversion Design components | 5 | `CTA` · `Form` · `Proof` · `Price` · `Flow` |
| 11.8 | **Normalized events** | **24** | `page_view` `scroll_25` `scroll_50` `scroll_75` `scroll_90` `primary_cta_view` `primary_cta_click` `secondary_cta_click` `pricing_view` `form_view` `form_start` `form_field_error` `form_abandon` `form_submit` `booking_start` `booking_complete` `add_to_cart` `checkout_start` `purchase_complete` `chat_start` `phone_click` `whatsapp_click` `conversion_complete` `qualified_conversion` |
| 11.8 | Segmentation axes | 7 | landing page · source/channel · device · region · time · new/returning · conversion goal |
| 11.9 | **Funnel stages** | **9** | search/AI exposure → landing session → engaged session → key content seen → primary CTA view → primary CTA click → form/cart/booking start → conversion complete → qualified lead / revenue / successful outcome |
| 11.9 | Per-form metrics | 9 | views · starts · submits · completion · abandonment · field errors/exit · completion time · device split · last field touched before abandonment |
| 11.10 | **Templates** | **12** | homepage · category/listing · product · service · location · pricing · article · documentation/help · FAQ · comparison/alternatives · case study · landing page |
| 11.10 | **Rollup axes** | **9** | workspace · brand · business unit · product line · service line · location · market/language · template · owner/team |
| 11.11 | **Persona packs** | **7** | SEO · Content · UX · CRO · Product marketing · Agency/client · Local operator |
| 11.12 | Experiment record | 4 rules | link to ticket/release/A-B test/change record · expected metric + observation period + completion date · before/after with volume, seasonality, attribution caveats · separate correlation from controlled result |
| 11.13 | **Endpoints** | **14** | §3.1 |
| 11.14 | **Tables** | **14** | §3.2 |
| 11.15 | Dashboard | 6 regions | master + 5 frameworks + qualified-lead delta · 6 layer scores · search-to-outcome funnel · top friction · template/portfolio performance · actions and validation |

⚠️ **The event list is 24 names, not 23** — count it off the document, never off a summary.
⚠️ **§11.10 lists 9 rollup axes**, though the sentence reads as ten; the list is authoritative.

### 3.1 The fourteen endpoints (§11.13)

```
POST /api/v1/sxo/audits                            create an SXO audit
GET  /api/v1/sxo/audits/{id}                       summary / status
GET  /api/v1/sxo/audits/{id}/results               scores + evidence
GET  /api/v1/sxo/audits/{id}/intent-match          intent findings
GET  /api/v1/sxo/audits/{id}/first-screen          first-screen findings
GET  /api/v1/sxo/audits/{id}/journey               funnel / journey result
GET  /api/v1/sxo/audits/{id}/form-diagnostics      form data + findings
POST /api/v1/sxo/events/import                     import aggregates / events
POST /api/v1/sxo/integrations/{provider}/connect   connect a provider
POST /api/v1/sxo/conversion-goals                  create / update a goal
GET  /api/v1/sxo/conversion-goals                  list goals
POST /api/v1/sxo/experiments                       attach an experiment / change
GET  /api/v1/sxo/portfolio/rollups                 portfolio score rollups
POST /api/v1/sxo/recommendations/{id}/validate     trigger validation
```

⚠️ **D2 made `/api/v1/discoverability/*` canonical**, and §7.10/§9.11 use that prefix for all
twenty-nine P1/P2 endpoints. §11.13 switches to a new top-level `/api/v1/sxo/*` — the document's
only prefix inconsistency. → **D17.** Recommended: `/api/v1/discoverability/sxo/*` canonical with
`/api/v1/sxo/*` a **permanent alias** — D2's own resolution, so nothing written against the PRD
ever breaks.

### 3.2 The fourteen tables (§11.14), with the D3 name mapping

D3 requires one `audit_` prefix across the module, and a PRD-name → actual-name mapping recorded
in `DISCOVERABILITY-MODULE.md`.

| PRD name | Actual name | Purpose |
|---|---|---|
| `sxo_audits` | `audit_sxo_runs` | configuration / jobs. ⚠️ not `audit_sxo_audits` |
| `sxo_results` | `audit_sxo_results` | six layer scores + total + penalty multiplier + model version |
| `intent_mappings` | `audit_intent_mappings` | query/prompt → page/intent/outcome. **Bridges** W6 |
| `conversion_goals` | `audit_conversion_goals` | the customer's desired outcomes |
| `analytics_connections` | `audit_analytics_connections` | auth + configuration metadata. 🔴 holds tokens |
| `analytics_event_mappings` | `audit_analytics_event_mappings` | source event → one of the 24 normalized names |
| `analytics_aggregates` | `audit_analytics_aggregates` | privacy-minimized metrics / time series |
| `journey_funnels` | `audit_journey_funnels` | funnel definitions + stage results |
| `form_diagnostics` | `audit_form_diagnostics` | form / field analysis |
| `sxo_findings` | `audit_sxo_findings` | SXO gaps + evidence |
| `sxo_recommendations` | `audit_sxo_recommendations` | SXO action packs |
| `page_templates` | `audit_page_templates` | template classification. **Extends** W2 |
| `portfolio_rollups` | `audit_portfolio_rollups` | materialized aggregate scores |
| `optimization_experiments` | `audit_optimization_experiments` | change / test / impact linkage |

§11.14 gives full DDL for three and names the other eleven. FK targets map as: `workspaces(id)`
→ `public.workspaces` (`0031`), `targets(id)` → `public.audit_targets`, `users(id)` →
`auth.users`. ⚠️ `sxo_results.experience_friction_score` is the DDL name for the component §11.3
calls `UX` and §11.2 calls the Friction Score — **keep the DDL name in SQL and the `UX` id in the
model**, and record the pair, because three names for one number is how a reader concludes there
are three numbers.

---

## 4. Stages and checkpoints

§14 splits P3 into **P3A static SXO** (8–12 weeks), **P3B analytics + funnel** (10–18 weeks) and
**P3C portfolio + experiments** (10–18 weeks), and warns that *"parallel execution should be
limited until P1 signals product-market fit and data quality."* This plan keeps those three and
puts two stages in front, because P3 cannot be built onto what is there today.

**Every checkpoint ends the same way, and is not done until all five hold:**

1. `npx vitest run` green, **with every new behavioural guard confirmed RED first**
2. `npm run test:db` green — the migration has met a real Postgres
3. `npm run verify:discoverability` on a branch preview — **exit 0, not 2**
4. The test sheet gains its rows, ids matching the runner, parity test passing
5. Anything deferred gains a **deviation-register row with a named reason** — add rows, never delete

---

### STAGE 0 · Ground truth and production parity
*No new features. This is what makes every later stage safe.*

| # | Deliverable |
|---|---|
| 0.1 | 🔴 **Apply `0050`–`0064` to production.** Fifteen behind; every P2 endpoint reads a table that does not exist there. **`0061` first and alone** if a feature release is not imminent — it is the RPC lockdown: ten `SECURITY DEFINER` functions taking a caller-supplied `p_user_id`, each an impersonation primitive reachable with the committed publishable key. Runbook §4d + §4e. |
| 0.2 | Verify: `npm run verify:rls -- --prod` → 15/15 refused; `verify:discoverability --env=production` → the migration rows stop reading DEVIATION. |
| 0.3 | 🔴 **Fix the three stale `available` flags** (§2.6.2) — `ai_visibility`, `trust_and_proof`, `local_directory` — and add the parity test the synthetic-module test cannot be: **every module referenced by a real `issueCatalog` entry whose workstream has shipped must read `available: true`**. Confirm RED by reverting one flag. Correct `CLAUDE.md`'s claim that the badge is unreachable. |
| 0.4 | **Populate `mCode` for the six modules §5 actually names** (§2.6.1), leave seven null with the reason written in, and rewrite the `toBeNull()` assertion to pin the split rather than the absence. |
| 0.5 | **Assert the shipped weights against the committed document** — §7.3 pillars and frameworks, §7.4 penalties (recording D1's two departures as departures), §7.6 priority, §7.8 WAVI, §9.3 BDS, §9.4 PDS, §9.5 SFS, §9.7 Schema, §9.8 TC. One test file, sourced from `docs/reference/`. The claim that they match is currently a memory, not a check. |
| 0.6 | **Reconcile W12's tier model against §9.6's weights** (`5x/4x/4x/3x/1–2x`). W12 deliberately ranks by reach rather than trust and put `registry` below `major_aggregator`; §9.6 puts India directories at Tier 3 `4x`. Either the reasoning survives contact with the document or the weights change — **record which, with the reason, either way.** |
| 0.7 | **Reconcile W10's entity types and predicates against §9.2's 15 and 9.** 🔴 **Add; never renumber** — an entity type id travels in stored rows and every historical diff. |
| 0.8 | Correct `DISCOVERABILITY-MODULE.md` §8. It still marks **W6 ❌ "largest remaining P1 item"** and says *"P2 … is not started"* — both were true when written, neither is true now, and the next person to plan from that table plans the wrong half of the module. Add the §3.2 name mapping and a P3 section. |
| 0.9 | **First live third-party exercise** (DEF-06): one real directory fetch through the compliance engine, one real grounded-Gemini prompt run. Both are pinned only by unit test today. |

**Gate:** production answers `verify:discoverability` with zero stop-ship rows, and no shipped
module is advertised as coming.

---

### STAGE 1 · The P1/P2 residue P3 stands on

§11.15's dashboard shows brand, product and service scores beside SXO; §11.10 rolls up by brand,
product line and service line. **None of that is reachable today.** Stage 1 is not tidying — it
is the foundation P3 reads from.

#### CP-1.1 · The subject spine — close DEV-01 · migration `0065` · blocked on **D12**

`POST /subject-score/scores` is **unreachable for any API caller**. `audit_subjects` rows are
minted by exactly one caller — `ensureSubject`, always with `kind: "page"` — and `0057`'s
`kind_matches_ref` CHECK requires `entity_id` for `brand`/`product`/`service`. **Nothing in the
API creates a subject over an entity.** Model, store, route, migration and tests are each
complete in isolation; the chain from *"I have a brand"* to *"here is its BDS"* has no first link.

Deliverables: subject creation over an **approved** entity; `ensureSubject` gains the entity path
through the same atomic `upsert_audit_subject` (`0060`'s rule); the route reachable for all three
scorable kinds; `brand_discoverability`, `product_discoverability` and `service_findability` flip
to `available: true` in the same commit.
⚠️ **Forward-only, no backfill** — a subject minted over a node nobody reviewed puts a score on
something the graph has not agreed exists.
**Gate:** runner rows `F-02`, `F-04`, `F-05`, `D-11` move from DEVIATION/BLOCKED to PASS.

#### CP-1.2 · Governance — roles, approval stages, lifecycle, connector gating · `0066`

**D18 is resolved**, so this is now implementation rather than a decision. §13's seven roles
(`viewer`, `analyst`, `editor`, `manager`, `admin`, `agency_admin`, `client_viewer`) mapped onto
existing workspace membership; §9.10's seven approval stages (draft, content review, brand/legal
review, technical review, approved, implemented, validated); §12's two new terminal states
(`no_measurable_change`, `regressed`) added to `workflowLifecycle.js`; §12's nine-row ownership
matrix encoded; connector approval-gating (DEF-04) so a push from a finding goes through
approval rather than straight out.

⚠️ **Extend the lifecycle; do not build a second state machine** — and re-read W14's finding
first (§2.4). **Why before the UI:** six screens built against a provisional permission model get
touched twice.

#### CP-1.3 · Complete and guard the client layer

`discoverabilityClient.js` carries **23 P2 method definitions for W9 and W10 only**, and **zero
components import any of them**; W11, W12 and W13 have **no client method at all**. That is this
module's signature defect one layer up from where it has been caught five times — a wrapper
written, reviewed, merged and called by nothing, with its own suite passing.

Deliverables: methods for `local-directory`, `schema-trust`, `subject-score`; and 🔴 **a parity
test that reads the real route table and asserts every root has a client method and every client
method has a NON-TEST importer**, modelled on `subject-score-parity.test.js`, confirmed RED by
deleting one importer. A declared exception list is allowed — each entry **names the checkpoint
that will consume it**.

#### CP-1.4 · The P2 surfaces (DEF-01)

Six sub-checkpoints, each shippable alone. **Do not merge them into one screen** — the P1 page is
already 779 lines.

| # | Surface | The thing the UI must get right |
|---|---|---|
| a | Truth record, versions, diff, promote (W9) | Self-approval is refused in three layers; **explain** the refusal, don't surface a 403 |
| b | Entity graph, relationships, conflicts (W10) | A duplicate edge is a 409 that **corroborates** — render that, not an error |
| c | Local & directory, correction packs, radius (W12) | 🔴 Render `coverageClaim()` **verbatim**; never compose a coverage sentence. An unchecked source is **excluded and named**, never a zero. `LD-05` says a registry difference is not a shopfront mismatch — say so |
| d | Schema & trust, TC (W13) | `fidelity` is the one score where **more markup means a lower number** — say why, or it reads as a bug |
| e | Subject scores, components, coverage, trend (W11) | **Depends on CP-1.1.** An excluded component reads *"cannot measure yet"*, never `0`, never in `--dsc-danger`. Coverage renders beside the score, always |
| f | Navigation + the composer's subject selector | `/discoverability` is a private prefix — a sub-route means updating **four** places, and `page-ownership.test.mjs` asserts all four |

#### CP-1.5 · API conformance and the published inventory (DEF-02)

The canonical prefix exists; the **published inventory** does not. §7.10's sixteen and §9.11's
thirteen endpoints, with request/response shapes, error codes, the entitlement each write
requires, and the 404-never-403 rule stated where integrators read it. Extends
`docs/DatIQ-Developer-API.md`.

---

### STAGE 2 · P3A — static SXO  *(§14: intent → first-screen → CTA/form · 8–12 weeks)*

**Unblocked.** Every weight is in §0.1.

| # | Deliverable | § |
|---|---|---|
| 2.1 | **`sxoModel.js`** — the six layers frozen as a registry: `id`, `label`, `describes`, `evidence`, `output`, `weight`, plus the DDL column name (§3.2's three-names warning). Pure, imported by React and `netlify/`. | 11.2, 11.3 |
| 2.2 | **`intentMatch.js`** — 8 intent classes + the 5 `IC` components. ⚠️ **Bridges** W6's prompt taxonomy for `intent_mappings`; does not create a second prompt store. | 11.4 |
| 2.3 | **`firstScreen.js`** — the 5 `IA` components, the **6 required flags**, and the 5 things the first viewport must communicate. ⚠️ The flags are **findings, not score inputs** — a flag that silently moved the number would double-count its own component. | 11.5 |
| 2.4 | **`frictionAudit.js`** — the 7 `UX` inputs. ⚠️ CWV already arrives via `fetchWebVitals`; **reuse it**, and record the `TD`/`UX` overlap (§2.1) rather than resolving it. Behavioural inputs are **optional and excluded when absent** — never scored 0. | 11.6 |
| 2.5 | **`conversionDesign.js`** — 12 primary outcomes, the 5 `CD` components. ⚠️ `CTA` is a component id in **both** `IC` and `CD` with different meanings; namespace them (`ic.cta`, `cd.cta`) so a stored row is unambiguous. | 11.7 |
| 2.6 | **`sxoScoring.js`** — the six-component score through the one `weightedMean`, and the read-time executive composite. 🔴 **D14 and D15 gate this file.** `SXO_MODEL_VERSION` is its own series, never the page model's `v` — the `s`-series precedent from W11. | 11.3 |
| 2.7 | Migration `0067` — `audit_sxo_runs`, `audit_sxo_results`, `audit_sxo_findings`, `audit_sxo_recommendations`, `audit_intent_mappings`, `audit_page_templates`. Service-role RLS, revoked from `anon`/`authenticated`, explicit `grant execute … to service_role` on any function. ⚠️ `sxo_total_score` **nullable**, `coverage` **not null** — W11's rule. | 11.14 |
| 2.8 | Routes 1–7 of §3.1 + the `audit.sxo` entitlement on the `audit.benchmark` precedent (D9). **Writes gated, reads not.** | 11.13 |
| 2.9 | Budget discipline. §13 requires a **median single-page audit under 60 s**; SXO adds overlay detection, accessibility basics and mobile parity to a path that already produced a 504 in August from unbudgeted serial work. The deadline **extends**; it is not re-invented. | 13 |

**Gate:** an SXO audit of a real URL returns six layer scores with coverage; every unmeasured
input is NULL and named; the composite reads *"not measured"* where no P1 audit exists; the
weights are asserted against `docs/reference/`.

---

### STAGE 3 · P3B — analytics, funnel and forms  *(§14: events → drop-offs → conversion quality · 10–18 weeks)*

🔴 **This is the stage that handles other people's visitors' data. D16 gates it.**

| # | Deliverable | § |
|---|---|---|
| 3.1 | **`eventTaxonomy.js`** — the **24 normalized event names**, frozen. A source event maps onto one of them or is rejected; an unmapped event is **named, never silently dropped**. | 11.8 |
| 3.2 | **`audit_analytics_connections`** — provider auth. 🔴 Tokens **encrypted**, never returned by any GET, masked fingerprint only, the `/admin/ai` precedent. | 11.8, 13 |
| 3.3 | **`audit_analytics_aggregates`** — privacy-minimized, the 7 segmentation axes. ⚠️ **Aggregates only.** No raw session rows, per §10. | 11.8 |
| 3.4 | **`journeyModel.js`** — the 9 funnel stages. A stage with no instrumentation is **excluded and named**; a funnel that treats missing instrumentation as a drop-off invents a leak the customer does not have. | 11.9 |
| 3.5 | **`formDiagnostics.js`** — the 9 per-form metrics. | 11.9 |
| 3.6 | Migration `0068` — `audit_analytics_connections`, `audit_analytics_event_mappings`, `audit_analytics_aggregates`, `audit_journey_funnels`, `audit_form_diagnostics`, `audit_conversion_goals`. | 11.14 |
| 3.7 | Routes 8–11 of §3.1. Ingestion **asynchronous, retryable and idempotent** per §13 — every job stage. | 11.13, 13 |
| 3.8 | 🔴 **Retention, deletion and purge.** Every new table on `PURGE_TABLES` or `RETAIN_TABLES` with a written reason — the parity test asserts it. A **default** retention period, not just configurability. `Privacy.jsx` reconciled with the new data class. | 13 |
| 3.9 | **Measurement Maturity Auditor** (`MI`) — scores whether the customer can measure at all, which is the honest prerequisite for every number above it. ⚠️ At `0.05` it is the smallest SXO weight and the largest dependency; a low `MI` must **caveat** the funnel, not just cost five points. | 11.8 |

**Gate:** a connected account produces a funnel where every stage is either measured or named as
unmeasured; a disconnect deletes what the retention policy says it deletes, proven.

---

### STAGE 4 · P3C — portfolio, personas and experiments  *(§14: templates → rollups → change validation · 10–18 weeks)*

| # | Deliverable | § |
|---|---|---|
| 4.1 | **Template classification** — the 12 templates, **extending** W2's page-type vocabulary rather than replacing it. Add the missing ids; never renumber one. | 11.10 |
| 4.2 | **`audit_portfolio_rollups`** — the 9 rollup axes. Absorbs DEF-05. A rollup over subjects nobody has audited is **no data**, not zero. | 11.10 |
| 4.3 | **Persona packs** — the 7 packs. Presentation over the existing recommendation set; **not** seven copies of the queue. §12's ownership matrix supplies the owner per recommendation type. | 11.11, 12 |
| 4.4 | **`audit_optimization_experiments`** — ticket/release/A-B/change-record link; expected metric, observation period, completion date. 🔴 **Records, never deploys.** Before/after carries volume, seasonality and attribution caveats, and **correlation is labelled as correlation** — extending W7's `relationship` field, never dropping it. | 11.12 |
| 4.5 | **Scheduled regression alerts** — on the existing cron + `AUTOMATION_JOBS` registry. ⚠️ **`netlify.toml` is the only thing that registers a cron**, and `cron-registry-parity.test.js` asserts the two agree. | 10 |
| 4.6 | Migration `0069` — `audit_portfolio_rollups`, `audit_optimization_experiments`. | 11.14 |
| 4.7 | Routes 12–14 of §3.1. | 11.13 |
| 4.8 | **§11.15 dashboard** — master + 5 frameworks + qualified-lead delta, 6 layer scores, the funnel, top friction, template/portfolio performance, actions and validation. ⚠️ The master carries its overlap disclosure (§2.1). | 11.15 |

**Gate:** the §11.15 dashboard renders from real data on a populated account, and every number on
it can be traced to evidence or is labelled unmeasured.

---

### STAGE 5 · Release

| # | Deliverable |
|---|---|
| 5.1 | Extend `scripts/verify-discoverability-e2e.mjs` with the P3 suites; **rename the sheet to `AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md`** — its own header says P3 extends it rather than replacing it. Repoint every inbound link. |
| 5.2 | Run it branch → staging → production, in that order, because each answers a different question. |
| 5.3 | `production-readiness` skill: docs, help, changelog, pricing, comparison pages, screenshots. ⚠️ **Every pricing cell derives from the limit `entitlementModel.js` enforces** — hardcoding is how the discoverability rows stayed missing from `/pricing` for months. The business-value doc §9 names the packages: **Search-to-Outcome Intelligence** (SXO, analytics connectors, funnel, CRO) and **Enterprise Discoverability OS** (portfolio rollups, SSO, governance, workflows, API, custom rule packs). |
| 5.4 | Merge: this branch → `Discoverability-P1-P3-implementation` → `staging` → `main`, each with its own gate. **No branch outside this chain is touched.** |

---

## 5. Decisions

D1–D11 are resolved in the P1/P2 plan §3. **D13 and D18 are resolved by the committed source
documents** and are recorded here with their answers rather than deleted.

| # | Decision | Why it cannot be defaulted | Gates |
|---|---|---|---|
| **D12** | **How a scorable subject is created** — auto-mint one per approved entity, or an explicit act with its own endpoint? | Auto-minting puts a row in `audit_subjects` for every proposed-and-later-rejected node, and a score history hangs off it. Explicit minting needs an endpoint nobody has specified. The choice shows up in stored rows. Neither document addresses it, because DEV-01 is our defect, not a gap in the spec. | CP-1.1 |
| **D13** | ✅ **RESOLVED** — the SXO weights and component ids are §0.1, verbatim from §11.3–§11.7. | — | — |
| **D14** | **Is the master score stored, or computed at read time?** | §11.3 gives the formula; §11.14 stores no master column on either results table. Storing it on `audits.final_score` bumps `SCORING_MODEL_VERSION` to `v4` and makes **every stored baseline incomparable on release day**. Recommended: read-time composite, plus the overlap disclosure in §2.1. | CP-2.6 |
| **D15** | **What "weights configurable by business model" (§11.3) means** | One sentence, no mechanism, and it contradicts a rule pinned by test. Recommended: a stored, versioned weight-set id, with `auditDiff` refusing across ids as it already refuses across versions. | CP-2.6 |
| **D16** | 🔴 **Analytics data governance** — the default retention period, deletion on disconnect, token encryption, purge-list placement, the `Privacy.jsx` reconciliation | §13 requires configurable retention and names no default. A new class of personal-adjacent data under a public DPDP commitment, with `billing-purge.js` the only destructive job and a parity test on its table lists. | STAGE 3 |
| **D17** | **`/api/v1/sxo/*` vs D2's canonical `/api/v1/discoverability/*`** | The document's only prefix inconsistency: §7.10 and §9.11 use the long form for all 29 P1/P2 endpoints, §11.13 switches. Recommended: `/api/v1/discoverability/sxo/*` canonical, `/api/v1/sxo/*` a permanent alias — D2's own resolution. | CP-2.8 |
| **D18** | ✅ **RESOLVED** — §13's seven roles are `viewer`, `analyst`, `editor`, `manager`, `admin`, `agency admin`, `client viewer`; §9.10's approval stages are draft, content review, brand/legal review, technical review, approved, implemented, validated. | — | — |
| **D19** | **Which analytics providers ship first**, and the monthly call budget | §13 caps a single-page audit at 60 s median and requires async retryable jobs. The August 504 came from unbudgeted serial work. The business-value doc names GA4, GSC, Clarity, Hotjar, FullStory and CRM; shipping all six at once is how the budget goes. | STAGE 3 |
| **D20** | **Entitlement and packaging** for SXO, analytics, portfolio and experiments | Business-value doc §9 gives two packages (§5.3 above); D9's precedent is to reuse the audit allowance rather than invent a plan axis nobody bought. | CP-2.8 |
| **D21** | **Whether W12's reach-ranked directory tiers survive §9.6's published weights** | W12 put `registry` below `major_aggregator` on the reasoning that a statutory filing is the most trustworthy record and one of the least read. §9.6 publishes `5x/4x/4x/3x/1–2x` with India directories at Tier 3. Either the reasoning holds against the document or the weights change; a tier weight moves every NAP score. | CP-0.6 |

---

## 6. Standing rules this plan inherits

Every one was learned from a repair.

1. `unknown` is never `0` — exclude and redistribute through the single `weightedMean`; every score carries `coverage`.
2. A profile is a **lens**, not different maths — and see **D15** for where P3 pushes on this.
3. Observed fact ≠ inference. Separate fields, separately labelled, everywhere they surface (§13 restates it).
4. No ranking, traffic, citation or revenue guarantees (§3's product boundary) — and in P3, **no causal claim without experimental evidence**.
5. Approval before external effect. Nothing publishes itself; nothing deploys itself (§12).
6. Pure model code stays pure — `src/lib/discoverability/*`, zero I/O, imported by both React and `netlify/`.
7. Codes and ids are a public contract. **Add; never repurpose or renumber** — entity types, predicates, page templates, event names, issue codes, M-codes.
8. The compliance gate applies to **every** fetch.
9. A parent id in a request body is a claim, not a fact. **404, never 403.**
10. `SECURITY DEFINER` → `revoke all … from public, anon, authenticated` **and** an explicit `grant execute … to service_role`.
11. Ask what a table **answers** before giving it a unique arbiter — upsert answers "now", append answers "then".
12. A module with no non-test importer is not wired; a client method with no screen is not either; **a flag nothing re-checks goes stale** (§2.6.2).
13. A declared count is checked against the document, never against a summary of it — the event list is 24, not 23.
14. Design system unchanged — `design-system.css` + `screens.css` tokens; no Tailwind conversion.

---

## 7. What "done" means

P3 is complete when, against **production**, §16's sentence is true, and:

* `npm run verify:discoverability --base-url=https://datiq.app --env=production` exits **0**
* every P3 clause in §3 is ✅ or carries a **deviation-register row with a named reason**
* every `audit_*` table has a writer, every pure module a production importer, every client
  method a screen, every `available` flag a parity test — each asserted by a test, not a document
* every P3 table is on `PURGE_TABLES` or `RETAIN_TABLES`, with a reason
* every weight in the product is asserted against `docs/reference/`
* the confirm-by-eye list has been walked by a human on production and signed off

---

## 8. Deviation register

**Add rows, never delete them.** When a deferment ships, mark it ✅ RESOLVED with the migration or
commit that did it — the record of *why it waited* is what stops the same debate twice.

| # | What | Why | Status |
|---|---|---|---|
| **P3-DEV-01** | The SXO component weights and ids were recorded as unobtainable | True of the PDF, whose formulas are vector outlines with no images to OCR. The markdown sources carry all of them as text. | ✅ **RESOLVED** — §0.1 |
| **P3-DEV-02** | `mCode` will be populated for **6 of 13** modules, not 13 | §5's M-codes are architectural modules; the repo's are recommendation destinations. Only six correspond. Inventing seven is the mistake W4 declined to make. | 🔴 OPEN — CP-0.4 |
| **P3-DEV-03** | The master score double-counts technical health, CWV and mobile parity | It is the document's own model (§11.3 × §7.3). Implemented as specified; the overlap ships as disclosure in the explainability payload rather than being silently smoothed. | 🔴 OPEN — **D14** |
| **P3-DEV-04** | `/api/v1/sxo/*` will be an alias, not the canonical prefix | D2 made `/api/v1/discoverability/*` canonical and §7.10/§9.11 agree across 29 endpoints; §11.13 is the document's only inconsistency. Nothing written against the PRD breaks. | 🔴 OPEN — **D17** |
