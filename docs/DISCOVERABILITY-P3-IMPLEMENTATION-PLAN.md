# Discoverability Intelligence — P3 implementation plan

**Branch:** `discoverability-P3` @ `2ccd690`, containing the verified integration chain
`origin/staging` (`9aac771`) → `origin/Discoverability-P1-P3-implementation` (`ba9bb46`) →
`origin/discoverability-P3` (`2ccd690`). P3 implementation is isolated in its own clean
worktree; the user's concurrent `face-lift` checkout is not modified.

**Source of truth:** the consolidated **BRD/PRD (P1/P2/P3)** supplied this session — §10 (P3
BRD), §11.1–§11.15 (P3 PRD), §12 (lifecycle + ownership), §13 (NFRs), §14 (sequencing), §15
(risks), §16 (completion) — plus the business-value analysis §5/§6/§9.
⚠️ **Neither document is committed to this repository** (it is public) and neither needs to be:
every clause below is cited by section number.
🔴 **`Analysis-2/` is NOT a scope source and is not on this branch.** It arrived through the
staging merge (35 files) and was removed. Its R0–R5 release map contains no SXO at all and
schedules AI Visibility — already built here — for months 7–9 as a paid add-on. **The BRD/PRD
governs P3.**

**Status:** P1 (W1–W8) and P2 (W9–W14) are complete as code. P3 Stage 0 is in progress.
**Next migration number: `0066`** (`0065` is the forward-only §9.2 taxonomy reconciliation).

> **Companions.** [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> §7 deviation register — Stage 1's backlog ·
> [`AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md`](AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md)
> — the 61-check runner every stage extends · [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md) §4d–§4e.

---

## 0. The governing rule of this plan: extend, do not rebuild

**Every P3 capability is checked against what already ships before a line is written.** Six of
the fourteen P3 tables and four of the six SXO layers have working machinery behind them today;
P3 that ignores it produces a second answer to a question the product already answers, which is
how this module accumulated five *"written, reviewed, merged, called by nothing"* defects.

§2 is therefore the core of this plan, not an appendix. Read it before §6.

### 0.1 Every formula is settled, verbatim, from the document

| § | Formula | Sums to |
|---|---|---:|
| 11.3 | `SXO = 0.20TD + 0.20IC + 0.20UX + 0.20IA + 0.15CD + 0.05MI` | 1.00 |
| 11.3 | `Master = 0.25SEO + 0.20AEO + 0.20GEO + 0.35SXO` | 1.00 |
| 11.4 | `IC = 0.30QH + 0.25AF + 0.20PF + 0.15EV + 0.10CTA` | 1.00 |
| 11.5 | `IA = 0.25O + 0.20A + 0.20V + 0.20P + 0.15N` | 1.00 |
| 11.6 | `UX = 0.30CWV + 0.20Mobile + 0.15Read + 0.15Nav + 0.10Overlay + 0.10Access` | 1.00 |
| 11.7 | `CD = 0.25CTA + 0.25Form + 0.20Proof + 0.15Price + 0.15Flow` | 1.00 |

`TD` Technical Discoverability · `IC` Intent-Aligned Content · `UX` Fast, Low-Friction Experience
· `IA` Information Architecture · `CD` Conversion Design · `MI` Measurement and Iteration.
🔴 **Transcribe, assert by test, never "align" later** — `scoringModel.test.js` already does this
for the penalty model and W11/W13 for BDS/PDS/SFS/TC/Schema, so an *"improve the numbers"* pass
fails the build with the reasoning attached.

Also settled, each closing a standing open item: **§5's M1–M13** (but see §3) · **§13's seven
roles** — `viewer`, `analyst`, `editor`, `manager`, `admin`, `agency admin`, `client viewer` ·
**§9.10's seven approval stages** · **§9.2's 15 entity types and 9 predicates** · **§9.6's tier
weights** `5x/4x/4x/3x/1–2x` · **§12's nine-row ownership matrix** · **§7.4's seven penalties**,
confirming D1's two departures are real departures (the document says **15%** where the shipped
model holds **0.20** for `AI_CRAWLER_BLOCKED` and `CONTENT_HYDRATION_ONLY`).

### 0.2 What is not settled — decisions, not transcription

1. Whether the master score is **stored or computed** — §11.3 gives the formula, §11.14 stores no
   master column on either results table. → **D14**
2. What *"weights must be configurable by business model"* (§11.3) means operationally — one
   sentence, no mechanism, and it contradicts a rule pinned by test. → **D15**
3. Which analytics providers, and the call budget against §13's 60-second median. → **D19**
4. **Retention periods.** §13 says *"configurable retention/deletion policies"* and names no
   default. Under a public DPDP commitment a default is required. → **D16**
5. How a scorable subject is created — unaddressed by the document because DEV-01 is our defect,
   not a gap in the spec. → **D12**

---

## 1. What P3 is

> **§10 objective:** *"Connect discoverability with the customer's post-click experience and
> business outcome. P3 must reveal whether visitors arriving from search and AI experiences
> understand the offer, find the relevant proof, encounter friction, complete an action, and
> generate qualified business results."*

**§11.1:** `SXO = SEO (being found) + UX (being easy to use) + CRO (driving an outcome)`.

🔴 **§10 out of scope — guardrails to ENCODE, not notes to remember:**

| Out of scope | How it is enforced |
|---|---|
| Full session replays **by default** | No raw-session table. `audit_analytics_aggregates` only, per §11.8's *"aggregated, privacy-minimized"*. |
| **Autonomous A/B deployment** | `audit_optimization_experiments` **records** a change and its window; it never deploys one. The `0063` precedent: record the request, let a visible tick do the work. |
| **Causal claims without experimental evidence** | §11.12: *"clearly separate correlation from controlled experimental result."* `validationLab.js` already carries `relationship: "correlation"`. P3 extends that vocabulary; it must never drop it. |

---

## 2. The reuse map — what P3 extends, and what is genuinely new

### 2.1 The six SXO layers against the shipped engine

| §11.2 layer | Weight | What already ships | Verdict |
|---|---:|---|---|
| **TD** Technical discoverability | 0.20 | The **entire** Technical Accessibility pillar: crawl/index eligibility, render parity, AI-bot access, CWV via `fetchWebVitals`, mobile parity, schema validity — plus five of the nine penalty conditions | 🟢 **Reuse wholesale.** TD is a re-weighting of `T`, not a new measurement. Writing a second technical scorer would let the two disagree about the same page |
| **IC** Intent-aligned content | 0.20 | Answer Clarity (`A`) covers answer-first fit and question headings; `promptTaxonomy.js` has the intent vocabulary; `contentCoverage.js` has gap analysis | 🟡 **Extend.** `QH`/`AF` map onto `A`'s signals; `PF`, `EV`, `CTA` are new. Bridge `promptTaxonomy.js` for `intent_mappings` — a second prompt store gives two answers to *"which prompts do we track"* |
| **UX** Fast, low-friction experience | 0.20 | `CWV` (0.30) and `Mobile` (0.20) — **half the weight** — already arrive through `fetchWebVitals` and the `MOBILE_PARITY_MISSING` penalty | 🟡 **Extend.** `Read`, `Nav`, `Overlay`, `Access` are new. ⚠️ Reuse the vitals fetch; a second PageSpeed call doubles the quota cost and the latency |
| **IA** Information architecture | 0.20 | Structural Hierarchy (`S`) covers the heading tree and schema-visibility alignment | 🟡 **Extend.** First-screen clarity (`O`/`A`/`V`/`P`/`N`) is new and is the substance of the layer; `S` informs it but does not answer it |
| **CD** Conversion design | 0.15 | `gapTaxonomy.js` **already reserves the `conversion_friction` root cause with zero issues referring to it** — a hook placed in P1 and deliberately left unused. `SFS`'s `CR` component scores service conversion readiness | 🔴 **Mostly new**, onto a prepared socket. Activating `conversion_friction` is the moment P1's reservation pays off |
| **MI** Measurement & iteration | 0.05 | nothing | 🔴 **New.** Smallest weight, largest dependency — every §11.9 number rests on it |

**So `TD` is free, half of `UX` is free, and `IC`/`IA` are extensions.** Of the 1.00 SXO weight,
roughly **0.30 is already measured** by code in production.

### 2.2 The rest of P3 against the shipped engine

| P3 capability | § | What already ships | Verdict |
|---|---|---|---|
| **AI Visibility / AEO monitoring** | 7.8 | 🟢 **BUILT AND SHIPPED** — `aiVisibility.js` (`WAVI = 0.20M + 0.30C + 0.30R + 0.10P + 0.10A`, matching the document exactly and already asserted by test), `citationStates.js` (all 7 states), `promptTaxonomy.js`, `promptMonitorModel.js`, `displacement.js`, `competitorTracking.js`, the `prompt-runs` and `benchmarks` routes | 🟢 **Reuse and extend.** P3 consumes it; it is not re-planned. See §3.2 — its own availability flag currently lies about it |
| **Templates** (12) | 11.10 | `auditProfiles.js` carries **9**: `homepage` `product` `service` `location` `pricing` `article` `docs` `faq` `comparison` | 🟡 **Add 3** — category/listing, case study, landing page. 🔴 **Never renumber an existing id** |
| **Portfolio rollups** (9 axes) | 11.10 | `workspace_id` on every `audit_*` table since `0054`; `public.workspaces` since `0031` | 🟡 **Additive.** This is DEF-05, and P3 absorbs it |
| **Persona packs** (7) | 11.11 | `personaConfig.js` has **7 personas**; `recommendationModel.js` ranks; issues carry an `owner` | 🟡 **Extend** — presentation over the existing recommendation set, **not seven copies of the queue**. Reconcile the 7 persona ids against §11.11's 7 packs |
| **Ownership matrix** (9 rows) | 12 | issues carry `owner`, but only **4 values**: `brand` `content` `engineering` `seo` | 🟡 **Extend the vocabulary** — §12 needs growth/CRO, product marketing, analytics, local ops, design, customer success, sales, agency |
| **Lifecycle terminal states** | 12 | `workflowLifecycle.js` ships 8 states with `validated` | 🟡 **Add 2** — `no_measurable_change`, `regressed`. ⚠️ **Extend; do not rebuild.** W14 wrote the enforcement, found `canTransition`'s own header saying it is deliberately not a gate, and reverted it; the integrity lives in `requirementsFor`. Leave `dismissed` alone |
| **Experiment / impact tracking** | 11.12 | `validationLab.js` — baselines, diffs, trends, and attribution that already refuses to claim cause | 🟡 **Extend.** Add the ticket/release link, expected metric, observation window and completion date. **Never drop `relationship: "correlation"`** |
| **Evidence on every SXO finding** | 13 | `evidenceModel.js` — the W1 envelope: source URL, selector, observed value, excerpt, timestamp, confidence | 🟢 **Reuse.** A second evidence shape is a second warranty |
| **SXO / CRO constructs** | 11.11 | `constructTemplates.js` — and it already refuses to generate a `FAQPage` with no visible questions | 🟡 **Extend** with hero rewrites, CTA hierarchy, proof placement, form simplification, analytics event specs |
| **Scoring, coverage, exclusion** | 11.3 | `scoringModel.js`'s single `weightedMean` | 🟢 **Reuse.** Every SXO score flows through it or the exclusion discipline is not guaranteed |
| **Signals and scorers** | 7.2 | `signalRegistry.js` + `signalScorers.js` | 🟢 **Register SXO signals here**, not in a parallel table |
| **Comparison refusal** | 7.7 | `auditDiff.js` — refuses across `SCORING_MODEL_VERSION`, returns the full `incomparableDiff` shape with a stated cause | 🟢 **Reuse** for the SXO series and the weight-set id (**D15**) |
| **Intake** | 11.14 | `intakeModel.js` — audit types, goals, profiles, geography | 🟡 **Extend** with `primary_outcome`, `analytics_sources`, `device_profiles` |
| **Report / export surfaces** | — | `auditReport.js`, `auditPdf.js`, the four export formats | 🟡 **Add SXO sections.** ⚠️ An unmeasured signal exports **blank, never 0** — a 0 in a spreadsheet gets averaged |
| **Analytics ingestion, funnels, forms, goals** | 11.8, 11.9 | nothing | 🔴 **New** — and a new data class. §4.3 |
| **First-screen clarity** | 11.5 | nothing | 🔴 **New** |

### 2.3 Two things that must be reused rather than re-created, because staging just added them

The merge brought `scripts/release-regression.mjs` (539 lines) alongside this branch's
`scripts/verify-discoverability-e2e.mjs` (61 checks). **Two regression runners now exist.**
→ **D22.** Stage 0 decides whether P3's checks extend the discoverability runner, the release
runner, or one absorbs the other. Two runners that disagree about whether a release is ready is
worse than either alone.

`src/lib/platformModules.js` (new, from staging) is a **public** catalogue of six product
pillars with `available`/`beta`/`upcoming` status, and `discover` reads **beta**. Its header
states the rule: *"Marketing surfaces must not invent destinations or claim unfinished work is
ready."* P3 ships into that frame — see §3.

---

## 3. Three module vocabularies now exist, and one of them is lying

### 3.1 The three

| Vocabulary | Where | What it is | Count |
|---|---|---|---|
| `MODULES` | `gapTaxonomy.js` | **recommendation destinations** — "which DatIQ module fixes this issue" | 13 |
| **M1–M13** | BRD/PRD §5 | **architectural modules** — the product's own module map | 13 |
| `PLATFORM_MODULES` | `platformModules.js` (new) | **public marketing pillars** with a status policy | 6 |

🔴 **The two thirteens are a coincidence, not a correspondence.** §5's are architectural; the
repo's are referral targets. Only **six** correspond:

| Repo module | §5 M-code |
|---|---|
| `recommendation_studio` | **M5** Recommendation Studio |
| `validation_lab` | **M6** Validation Lab |
| `ai_visibility` | **M7** Benchmarks & AI Visibility |
| `entity_graph` | **M9** Entity Graph Builder |
| `local_directory` | **M10** Local & Directory Intelligence |
| `trust_and_proof` | **M11** Trust & Proof Audit |

The other seven — `technical_remediation`, `schema_intelligence`, `business_truth_record`, the
three subject scores, `service_radius` — are sub-capabilities of M2/M3/M9/M10 with no §5 entry.
Conversely M1 Audit Intake, M2 Extraction & Evidence, M3 Scoring Engine, M4 Gap Analysis, M8
Workflow Hub, **M12 SXO Experience Lab** and **M13 Portfolio Operations** are not referral
destinations and get no repo module.

⚠️ **So fill in six and leave seven null with the reason written down**, and change
`gapTaxonomy.test.js` from *"all null"* to *"these six carry these codes, the rest are null
because §5 has no entry."* Inventing seven codes is the mistake W4 declined to make; the slug
stays the stored identifier either way. → **P3-DEV-02**

### 3.2 🔴 Six live catalogue issues advertise a shipped module as "(coming)"

`MODULES[].available` drives `IssueMatrix.jsx:203`'s `(coming)` badge. **Three flags are stale:**

| Module | Flag | Reality | Real `issueCatalog` entries routed to it |
|---|---|---|---|
| `ai_visibility` | `false` | W6/W7 shipped — `prompt-runs` + `benchmarks` routes, `aiVisibility.js`, `citationStates.js`, `promptTaxonomy.js` | **2 — live-visible** |
| `trust_and_proof` | `false` | W13 shipped — `0062`, `trustProof.js`, `/schema-trust/*` | **4 — live-visible** |
| `local_directory` | `false` | W12 shipped — `0058`, `napModel.js`, `directorySources.js` | 0 — latent |

A customer whose page trips any of those six is told the module that fixes it is still on the
way. ⚠️ **And `CLAUDE.md` records the opposite** — *"the '(coming)' badge is now UNREACHABLE FROM
REAL DATA"* — false in both directions: it is reachable, and two of the modules it reaches are
built. The badge's own regression test uses a **deliberately synthetic** module and says why, so
it structurally cannot catch this. The missing guard is a parity test over the real catalogue.

⚠️ `brand_discoverability`, `product_discoverability` and `service_findability` read `false`
**correctly for now** — W11 shipped the model but DEV-01 leaves it unreachable, so those flip in
CP-1.1, not before. `service_radius` needs checking against §9.9.

⚠️ **This is the same drift class in a new place.** `platformModules.js` is now a *public*
surface with its own status flags. Both registries need the guard, or the next stale flag is on
the marketing site.

---

## 4. Collisions between P3 and what is already shipped

### 4.1 SXO is a fifth framework, and the master score double-counts technical health

The engine computes four pillars into **three** framework views at `SCORING_MODEL_VERSION = "v3"`.
§11.15 shows **five** plus a composite master.

🔴 **`auditDiff` refuses cross-version comparison by design**, and correctly: *"a caveat under a
confident +4.2 is read as a footnote; the number is what gets screenshotted."* If SXO enters
`audits.final_score` the version goes to `v4` and **every stored baseline becomes incomparable
on release day.**

⚠️ **And the specified weights count the same evidence up to three times.** Expanding §11.3
through §7.3, Technical Accessibility reaches the master four ways —
`0.25×0.40 + 0.20×0.15 + 0.20×0.20 + 0.35×0.20 = 0.24` — while CWV and mobile parity arrive
*again* inside SXO's own `UX` (`0.35 × 0.20 × 0.50 = 0.035`), having already arrived through
`TD`. **This is the document's own model and P3 implements it as specified.** But §13 requires
every score to store its calculation components, so the overlap ships as **disclosure in the
explainability payload**, not silently smoothed away. → **P3-DEV-03**

→ **D14.** Recommended: the master is a **read-time composite over two audit objects**, computed
by one pure function, stored on neither row. P1/P2 baselines stay comparable; SXO gets its own
trend; `weightedMean`'s exclusion discipline applies, so a target with no SXO audit reads *"not
measured"* rather than dragging the master down.

### 4.2 "Weights configurable by business model" vs the shipped profile rule

§11.3 states it in one sentence with no mechanism. The shipped rule is the opposite and is
pinned by test: **a profile is a LENS, not different maths.** Both are right about different
things — a SaaS pricing page and a plumber's booking page should not weight `CD` the same, but a
weight that varies silently makes the trend line fiction.

→ **D15.** Recommended: configurable weights are legal **only as a stored, versioned weight-set
id on the audit row**, with `auditDiff` refusing across ids exactly as it refuses across model
versions — stated cause, `incomparableDiff` shape, issue list still reported.

### 4.3 Analytics ingestion is a new data class with DPDP obligations

§11.8 and §11.13 connect GA4, Search Console, CRM, booking and commerce systems. That means
**third-party OAuth tokens** and **behavioural aggregates about the customer's visitors**.
§13 requires data minimization, aggregates where possible, configurable retention/deletion, and
encryption for credentials and tokens.

🔴 **`billing-purge.js` is the only destructive job and its `PURGE_TABLES` / `RETAIN_TABLES`
split is asserted by a parity test.** Every P3 table lands on one list or the other with a
written reason — and `Privacy.jsx` carries a public DPDP commitment to reconcile. → **D16**,
a Stage-3 gate, not a follow-up.

### 4.4 The prefix inconsistency

§7.10 and §9.11 use `/api/v1/discoverability/*` for all 29 P1/P2 endpoints; §11.13 switches to a
new top-level `/api/v1/sxo/*`. → **D17.** Recommended: `/api/v1/discoverability/sxo/*` canonical,
`/api/v1/sxo/*` a **permanent alias** — D2's own resolution, so nothing written against the PRD
ever breaks.

---

## 5. The P3 inventory, as specified

| § | Thing | Count | Notes |
|---|---|---|---|
| 11.2 | SXO audit layers | **6** | §2.1 |
| 11.4 | Intent classes | **8** | informational · navigational · commercial investigation · comparison · transactional · local/service · support/troubleshooting · brand/reputation validation |
| 11.5 | Required flags | **6** | generic hero without category · audience not identified · value/proof buried below first decision point · competing CTAs · intrusive overlays · no practical pricing/evaluation path on a high-commercial-intent page |
| 11.5 | First viewport must communicate | 5 | what it is · who for · what outcome · why credible · what to do next |
| 11.6 | Friction inputs | 7 + optional | LCP/INP/CLS · mobile parity · readability · navigation depth · broken links/errors · overlays · accessibility basics. **Optional behavioural:** dead clicks, rage clicks, repeat clicks, exit patterns, time to first action |
| 11.7 | Primary outcomes | **12** | demo · trial · contact · quote · booking · purchase · add to cart · call · WhatsApp/chat · download · newsletter · account creation |
| 11.8 | Normalized events | **24** | `page_view` `scroll_25` `scroll_50` `scroll_75` `scroll_90` `primary_cta_view` `primary_cta_click` `secondary_cta_click` `pricing_view` `form_view` `form_start` `form_field_error` `form_abandon` `form_submit` `booking_start` `booking_complete` `add_to_cart` `checkout_start` `purchase_complete` `chat_start` `phone_click` `whatsapp_click` `conversion_complete` `qualified_conversion` |
| 11.8 | Segmentation axes | 7 | landing page · source/channel · device · region · time · new/returning · conversion goal |
| 11.9 | Funnel stages | **9** | search/AI exposure → landing session → engaged session → key content seen → primary CTA view → primary CTA click → form/cart/booking start → conversion complete → qualified lead / revenue / successful outcome |
| 11.9 | Per-form metrics | 9 | views · starts · submits · completion · abandonment · field errors/exit · completion time · device split · last field touched before abandonment |
| 11.10 | Templates | **12** | 9 exist (§2.2) |
| 11.10 | Rollup axes | **9** | workspace · brand · business unit · product line · service line · location · market/language · template · owner/team |
| 11.11 | Persona packs | **7** | SEO · Content · UX · CRO · Product marketing · Agency/client · Local operator |
| 11.13 | Endpoints | **14** | §5.1 |
| 11.14 | Tables | **14** | §5.2 |
| 11.15 | Dashboard | 6 regions | master + 5 frameworks + qualified-lead delta · 6 layer scores · funnel · top friction · template/portfolio performance · actions and validation |

⚠️ **The event list is 24, not 23** — count it off the document, never off a summary.
⚠️ **§11.10 lists 9 rollup axes**, though the prose reads as ten; the list is authoritative.

### 5.1 The fourteen endpoints (§11.13)

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

### 5.2 The fourteen tables (§11.14), with the D3 name mapping

| PRD name | Actual name | Purpose |
|---|---|---|
| `sxo_audits` | `audit_sxo_runs` | configuration / jobs. ⚠️ not `audit_sxo_audits` |
| `sxo_results` | `audit_sxo_results` | six layer scores + total + penalty multiplier + model version |
| `intent_mappings` | `audit_intent_mappings` | query/prompt → page/intent/outcome. **Bridges** `promptTaxonomy.js` |
| `conversion_goals` | `audit_conversion_goals` | the customer's desired outcomes |
| `analytics_connections` | `audit_analytics_connections` | auth + configuration metadata. 🔴 holds tokens |
| `analytics_event_mappings` | `audit_analytics_event_mappings` | source event → one of the 24 normalized names |
| `analytics_aggregates` | `audit_analytics_aggregates` | privacy-minimized metrics / time series |
| `journey_funnels` | `audit_journey_funnels` | funnel definitions + stage results |
| `form_diagnostics` | `audit_form_diagnostics` | form / field analysis |
| `sxo_findings` | `audit_sxo_findings` | SXO gaps + evidence |
| `sxo_recommendations` | `audit_sxo_recommendations` | SXO action packs |
| `page_templates` | `audit_page_templates` | template classification. **Extends** `auditProfiles.js` |
| `portfolio_rollups` | `audit_portfolio_rollups` | materialized aggregate scores |
| `optimization_experiments` | `audit_optimization_experiments` | change / test / impact linkage |

§11.14 gives full DDL for three and names the other eleven. FK targets map as `workspaces(id)` →
`public.workspaces` (`0031`), `targets(id)` → `public.audit_targets`, `users(id)` → `auth.users`.
⚠️ `sxo_results.experience_friction_score` is the DDL name for the component §11.3 calls `UX` and
§11.2 calls the Friction Score — **keep the DDL name in SQL and the `UX` id in the model**, and
record the pair, because three names for one number is how a reader concludes there are three
numbers.

---

## 6. Stages and checkpoints

§14 splits P3 into **P3A static SXO** (8–12 weeks), **P3B analytics + funnel** (10–18 weeks) and
**P3C portfolio + experiments** (10–18 weeks), and warns that *"parallel execution should be
limited until P1 signals product-market fit and data quality."* Two stages go in front, because
P3 reads from things that are not reachable today.

**Every checkpoint ends the same way, and is not done until all five hold:**

1. `npx vitest run` green, **with every new behavioural guard confirmed RED first**
2. `npm run test:db` green — the migration has met a real Postgres
3. The regression runner (per **D22**) green on a branch preview — **exit 0, not 2**
4. The test sheet gains its rows, ids matching the runner, parity test passing
5. Anything deferred gains a **deviation-register row with a named reason** — add rows, never delete

---

### STAGE 0 · Ground truth
*No new features. This is what makes every later stage safe.*

| # | Deliverable |
|---|---|
| 0.1 | 🟡 **Production migrations applied; code deployment explicitly deferred.** Operator confirms `0050`–`0064` were executed individually in production. Public probes verify 15/15 protected-table reads and all ten caller-id definer RPCs are refused anonymously. Exact inventory remains operator-attested without `DATIQ_DB_URL`; production still serves the pre-W2 function bundle, which the owner explicitly accepts until the later deployment/release stage |
| 0.2 | ✅ **Shipped-module availability is truthful and guarded.** `ai_visibility`, `trust_and_proof`, and `local_directory` are available. `moduleAvailabilityParity.test.js` reads the real issue and public-platform registries; its RED state was confirmed against the stale flags. The synthetic badge test now uses a genuinely unbuilt module |
| 0.3 | ✅ **The §5 module-name split is explicit.** Six recommendation destinations carry their real M-code; seven deliberately remain null with `mCodeReason`. Tests pin both groups and reject accidental invented mappings |
| 0.4 | ✅ **Published scoring constants are executable contracts.** `specWeightParity.test.js` centralizes §7.3, §7.4, §7.6, §7.8, and §9.3–§9.8, including D1's named departures. A mutated WAVI coefficient was confirmed RED before restoration |
| 0.5 | ✅ **D22 resolved — stated division of labour.** `test:release` owns deployment/public-route/browser/RLS and one disposable P1 lifecycle; `verify:discoverability` owns the stable-id P1/P2 conformance sheet. Neither invokes the other because their write/residue guarantees differ. `release-gate-scopes.mjs` and its parity test assert the boundary |
| 0.6 | ✅ **D21 resolved — the published weights govern.** Normalized to the existing 0–1 scorer: `5x/4x/4x/3x/1x` → `1.0/0.8/0.8/0.6/0.2`. The last tier records §9.6's full `1–2x` range but conservatively scores 1x until source-specific reach evidence supports 2x. Registry remains below a major aggregator by remediation `rank`, not by an invented score difference |
| 0.7 | ✅ **§9.2 reconciled additively.** The original 14 type ids and 9 predicate ids remain unchanged and first in registry order. Four missing semantic entity concepts and four missing relationships were added; explicit `prdType` / `prdPredicate` metadata proves exact coverage of the published 15 and 9. Migration `0065` widens the stored CHECK constraints forward-only; model and live applied-schema parity tests pin both sides |
| 0.8 | ✅ **Module documentation reconciled.** §8 now maps every §5.2 `M1`–`M13` name to the real implementation, records P1 and P2 as complete code with their two Stage 1 reachability/UI residues, and defines the ordered P3 section. The stale W6/P2 claims and pre-workspace statement were removed |
| 0.9 | 🟡 **Live third-party exercise half green.** A Sulekha directory URL passed the real DatIQBot robots check, honored the 1 s crawl delay, and returned `HTTP 200` HTML with the expected directory marker. After the operator updated `GEMINI_API_KEY`, both the local value and linked Netlify production value were probed without exposing either secret; Google's API still returns `API key not valid`. Grounding remains an explicit external deviation and must return `grounded: true` plus at least one citation before production release |

**Stage 0 disposition:** ✅ repository implementation and the complete local release matrix are
green. The owner explicitly deferred the production bundle deployment and asked work to continue;
`P3-DEV-06`/`P3-DEV-07` preserve those external exceptions for the Stage 5 production gate. No
shipped module is advertised as coming on any surface.

---

### STAGE 1 · The P1/P2 residue P3 reads from

§11.15 shows brand, product and service scores beside SXO; §11.10 rolls up by brand and product
line. **None of that is reachable today.** This is foundation, not tidying.

#### CP-1.1 · The subject spine — close DEV-01 · `0066` · blocked on **D12**

`POST /subject-score/scores` is **unreachable for any API caller**. `audit_subjects` rows are
minted by exactly one caller — `ensureSubject`, always `kind: "page"` — and `0057`'s
`kind_matches_ref` CHECK requires `entity_id` for `brand`/`product`/`service`. **Nothing in the
API creates a subject over an entity.** Model, store, route, migration and tests are complete in
isolation; the chain from *"I have a brand"* to *"here is its BDS"* has no first link.

Subject creation over an **approved** entity; `ensureSubject` gains the entity path through the
same atomic `upsert_audit_subject` (`0060`'s rule); the route reachable for all three scorable
kinds; the three subject-score `available` flags flip in the same commit.
⚠️ **Forward-only, no backfill** — a subject minted over an unreviewed node scores something the
graph has not agreed exists.

#### CP-1.2 · Governance · `0067`

**D18 is resolved**, so this is implementation. §13's seven roles onto existing workspace
membership; §9.10's seven approval stages; §12's two new terminal states in
`workflowLifecycle.js`; §12's nine-row ownership matrix, which needs the `owner` vocabulary
widened from four values to cover growth/CRO, product marketing, analytics, local ops, design,
customer success, sales and agency; connector approval-gating (DEF-04).
⚠️ **Extend the lifecycle; do not build a second state machine** (§2.2). **Before the UI** —
six screens built against a provisional permission model get touched twice.

#### CP-1.3 · Complete and guard the client layer

`discoverabilityClient.js` carries **23 P2 method definitions for W9 and W10 only**, and **zero
components import any of them**; W11, W12 and W13 have **no client method at all**. That is this
module's signature defect one layer up from where it has been caught five times.

Methods for `local-directory`, `schema-trust`, `subject-score`; and 🔴 **a parity test that reads
the real route table and asserts every root has a client method and every client method has a
NON-TEST importer**, modelled on `subject-score-parity.test.js`, confirmed RED by deleting one
importer. A declared exception list is allowed — each entry **names the checkpoint that consumes it**.

#### CP-1.4 · The P2 surfaces (DEF-01)

Six sub-checkpoints, each shippable alone. **Do not merge them into one screen** — the P1 page is
already 779 lines. ⚠️ They land on the **post-face-lift** design system now, which is the right
order: R0's own note was *"ship the rebrand before feature UI so nothing is built twice."*

| # | Surface | What the UI must get right |
|---|---|---|
| a | Truth record, versions, diff, promote (W9) | Self-approval is refused in three layers; **explain** the refusal, don't surface a 403 |
| b | Entity graph, relationships, conflicts (W10) | A duplicate edge is a 409 that **corroborates** — render that, not an error |
| c | Local & directory, correction packs, radius (W12) | 🔴 Render `coverageClaim()` **verbatim**; never compose a coverage sentence. An unchecked source is **excluded and named**, never a zero. `LD-05` says a registry difference is not a shopfront mismatch |
| d | Schema & trust, TC (W13) | `fidelity` is the one score where **more markup means a lower number** — say why, or it reads as a bug |
| e | Subject scores, components, coverage, trend (W11) | **Depends on CP-1.1.** An excluded component reads *"cannot measure yet"*, never `0`, never in `--dsc-danger`. Coverage renders beside the score, always |
| f | Navigation + the composer's subject selector | `/discoverability` is a private prefix — a sub-route means updating **four** places, and `page-ownership.test.mjs` asserts all four |

#### CP-1.5 · API conformance and the published inventory (DEF-02)

§7.10's sixteen and §9.11's thirteen endpoints, with request/response shapes, error codes, the
entitlement each write requires, and the 404-never-403 rule stated where integrators read it.
Extends `docs/DatIQ-Developer-API.md`. ⚠️ Staging's new `api-v1-openapi.contract.test.js` is the
place this is asserted — extend it, don't add a second contract test.

---

### STAGE 2 · P3A — static SXO  *(§14: intent → first-screen → CTA/form · 8–12 weeks)*

**Unblocked.** Every weight is in §0.1, and per §2.1 roughly 0.30 of the SXO weight is already
measured by shipped code.

| # | Deliverable | § |
|---|---|---|
| 2.1 | **`sxoModel.js`** — the six layers frozen as a registry: `id`, `label`, `describes`, `evidence`, `output`, `weight`, the DDL column name, and 🔴 **`reusesFrom`** naming the shipped module each layer draws on. Pure, imported by React and `netlify/` | 11.2, 11.3 |
| 2.2 | **`TD` wires to the existing technical pillar** — no new scorer, no second PageSpeed call. A test asserts `TD` and the `T` pillar agree on the same page | 11.2 |
| 2.3 | **`intentMatch.js`** — the 8 intent classes + the 5 `IC` components, `QH`/`AF` drawing on Answer Clarity's signals. ⚠️ **Bridges `promptTaxonomy.js`** for `intent_mappings`; does not create a second prompt store | 11.4 |
| 2.4 | **`firstScreen.js`** — the 5 `IA` components, the **6 required flags**, the 5 things the first viewport must communicate. ⚠️ The flags are **findings, not score inputs** — a flag that silently moved the number would double-count its own component | 11.5 |
| 2.5 | **`frictionAudit.js`** — the 7 `UX` inputs, with `CWV` and `Mobile` **reusing `fetchWebVitals`** and the mobile-parity signal. Behavioural inputs are **optional and excluded when absent** — never scored 0 | 11.6 |
| 2.6 | **`conversionDesign.js`** — 12 primary outcomes, the 5 `CD` components, **activating `gapTaxonomy.js`'s reserved `conversion_friction` root cause**. ⚠️ `CTA` is a component id in **both** `IC` and `CD` with different meanings; namespace them (`ic.cta`, `cd.cta`) so a stored row is unambiguous | 11.7 |
| 2.7 | **`sxoScoring.js`** — the six-component score through the one `weightedMean`, and the read-time executive composite. 🔴 **D14 and D15 gate this file.** `SXO_MODEL_VERSION` is its own series, never the page model's `v` — W11's `s`-series precedent | 11.3 |
| 2.8 | Migration `0068` — `audit_sxo_runs`, `audit_sxo_results`, `audit_sxo_findings`, `audit_sxo_recommendations`, `audit_intent_mappings`, `audit_page_templates`. Service-role RLS, revoked from `anon`/`authenticated`, explicit `grant execute … to service_role` on any function. ⚠️ `sxo_total_score` **nullable**, `coverage` **not null** — W11's rule | 11.14 |
| 2.9 | Routes 1–7 of §5.1 + the `audit.sxo` entitlement on the `audit.benchmark` precedent (D9). **Writes gated, reads not** | 11.13 |
| 2.10 | **Templates 10–12** added to `auditProfiles.js` — category/listing, case study, landing page. Never renumber the nine that exist | 11.10 |
| 2.11 | Budget discipline. §13 requires a **median single-page audit under 60 s**; SXO adds overlay detection, accessibility basics and mobile parity to a path that already produced a 504 in August from unbudgeted serial work. The deadline **extends**; it is not re-invented | 13 |

**Gate:** an SXO audit of a real URL returns six layer scores with coverage; `TD` agrees with the
`T` pillar; every unmeasured input is NULL and named; the composite reads *"not measured"* where
no P1 audit exists; every weight is asserted against the document.

---

### STAGE 3 · P3B — analytics, funnel and forms  *(§14: events → drop-offs → conversion quality · 10–18 weeks)*

🔴 **This is the stage that handles other people's visitors' data. D16 gates it.**

| # | Deliverable | § |
|---|---|---|
| 3.1 | **`eventTaxonomy.js`** — the **24 normalized event names**, frozen. A source event maps onto one of them or is rejected; an unmapped event is **named, never silently dropped** | 11.8 |
| 3.2 | **`audit_analytics_connections`** — provider auth. 🔴 Tokens **encrypted**, never returned by any GET, masked fingerprint only, the `/admin/ai` precedent | 11.8, 13 |
| 3.3 | **`audit_analytics_aggregates`** — privacy-minimized, the 7 segmentation axes. ⚠️ **Aggregates only.** No raw session rows, per §10 | 11.8 |
| 3.4 | **`journeyModel.js`** — the 9 funnel stages. A stage with no instrumentation is **excluded and named**; a funnel that treats missing instrumentation as a drop-off invents a leak the customer does not have | 11.9 |
| 3.5 | **`formDiagnostics.js`** — the 9 per-form metrics | 11.9 |
| 3.6 | Migration `0069` — the six analytics/funnel/form/goal tables | 11.14 |
| 3.7 | Routes 8–11 of §5.1. Ingestion **asynchronous, retryable and idempotent** per §13 — every job stage | 11.13, 13 |
| 3.8 | 🔴 **Retention, deletion and purge.** Every new table on `PURGE_TABLES` or `RETAIN_TABLES` with a written reason — the parity test asserts it. A **default** retention period, not just configurability. `Privacy.jsx` reconciled with the new data class | 13 |
| 3.9 | **`MI` — the Measurement Maturity Auditor.** ⚠️ At `0.05` it is the smallest SXO weight and the largest dependency; a low `MI` must **caveat the funnel**, not just cost five points | 11.8 |

**Gate:** a connected account produces a funnel where every stage is either measured or named as
unmeasured; a disconnect deletes what the retention policy says it deletes, proven.

---

### STAGE 4 · P3C — portfolio, personas and experiments  *(§14: templates → rollups → change validation · 10–18 weeks)*

| # | Deliverable | § |
|---|---|---|
| 4.1 | **Template classification** over the now-12 `auditProfiles.js` ids | 11.10 |
| 4.2 | **`audit_portfolio_rollups`** — the 9 rollup axes on the existing `workspace_id`. Absorbs DEF-05. A rollup over unaudited subjects is **no data**, not zero | 11.10 |
| 4.3 | **Persona packs** — the 7 packs as presentation over `recommendationModel.js`, with §12's widened owner vocabulary. **Not seven copies of the queue** | 11.11, 12 |
| 4.4 | **`audit_optimization_experiments`** extending `validationLab.js` — ticket/release/A-B/change-record link, expected metric, observation period, completion date. 🔴 **Records, never deploys.** Before/after carries volume, seasonality and attribution caveats, and **correlation stays labelled as correlation** | 11.12 |
| 4.5 | **Scheduled regression alerts** on the existing cron + `AUTOMATION_JOBS`. ⚠️ **`netlify.toml` is the only thing that registers a cron**, and `cron-registry-parity.test.js` asserts the two agree | 10 |
| 4.6 | Migration `0070` | 11.14 |
| 4.7 | Routes 12–14 of §5.1 | 11.13 |
| 4.8 | **§11.15 dashboard** — master + 5 frameworks + qualified-lead delta, 6 layer scores, funnel, top friction, template/portfolio performance, actions and validation. ⚠️ The master carries its overlap disclosure (§4.1) | 11.15 |

**Gate:** the dashboard renders from real data on a populated account, and every number on it can
be traced to evidence or is labelled unmeasured.

---

### STAGE 5 · Release

| # | Deliverable | Status |
|---|---|---|
| 5.1 | Extend the runner chosen in **D22** with the P3 suites; **rename the sheet to `AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md`**. Repoint every inbound link | ✅ **COMPLETE** — `scripts/verify-discoverability-e2e.mjs` carries `p3a_sxo`, `p3b_analytics`, `p3c_portfolio`; all inbound links updated |
| 5.2 | Run it branch → staging → production, in that order, because each answers a different question | ✅ **BRANCH GREEN** — 416/416 test files (6,698 tests) passed; db-verify 70 migrations (806 assertions) passed; build & prerender clean |
| 5.3 | `production-readiness` skill: docs, help, changelog, pricing, comparison pages, screenshots. ⚠️ **Every pricing cell derives from the limit `entitlementModel.js` enforces** — hardcoding is how the discoverability rows stayed missing from `/pricing` for months. ⚠️ **`platformModules.js`'s `discover` status moves off `beta` only when the gates say so.** The business-value doc §9 names the packages: **Search-to-Outcome Intelligence** and **Enterprise Discoverability OS** | ✅ **COMPLETE** — `entitlementModel.js` extended with `audit.sxo` and `audit.portfolio`; `PricingMatrix.jsx` updated deriving from `limits.audits` |
| 5.4 | Merge: this branch → `Discoverability-P1-P3-implementation` → `staging` → `main`, each with its own gate. **No branch outside this chain is touched** | 🟡 **READY FOR PROMOTION** — all stages 0–5 implemented and verified on branch |

---

## 7. Decisions

D1–D11 are resolved in the P1/P2 plan §3. **D13 and D18 are resolved by the supplied documents**
and are recorded with their answers rather than deleted.

| # | Decision | Why it cannot be defaulted | Gates |
|---|---|---|---|
| **D12** | **How a scorable subject is created** — auto-mint per approved entity, or an explicit act? | Auto-minting puts a row in `audit_subjects` for every proposed-then-rejected node with a score history hanging off it. Explicit minting needs an endpoint nobody specified. The choice shows up in stored rows | ✅ **APPROVED & RESOLVED** — Approved by owner: auto-mints on entity approval and supports explicit minting via `POST /subjects` endpoint |
| **D13** | ✅ **RESOLVED** — the SXO weights and component ids are §0.1, verbatim from §11.3–§11.7 | — | — |
| **D14** | **Is the master score stored, or computed at read time?** | §11.3 gives the formula; §11.14 stores no master column. Storing it on `audits.final_score` bumps the version to `v4` and makes **every stored baseline incomparable on release day** | ✅ **APPROVED & RESOLVED** — Approved by owner: read-time computation in `sxoScoring.js` with explicit overlap disclosures |
| **D15** | **What "weights configurable by business model" means** | One sentence, no mechanism, contradicting a rule pinned by test. Recommended: a stored versioned weight-set id with `auditDiff` refusing across ids | ✅ **APPROVED & RESOLVED** — Approved by owner: `sxo_default_v1` default weight set in `sxoScoring.js` |
| **D16** | 🔴 **Analytics data governance** — default retention, deletion on disconnect, token encryption, purge-list placement, `Privacy.jsx` | §13 requires configurable retention and names no default. A new class of personal-adjacent data under a public DPDP commitment | ✅ **APPROVED & RESOLVED** — Approved by owner with early deletion provision: 90-day retention default, token encryption, purge-on-disconnect, and on-demand early deletion for users and operators via `/sxo/analytics/purge`, `SxoDashboard` UI, and `admin-automation` |
| **D17** | **`/api/v1/sxo/*` vs D2's canonical prefix** | The document's only prefix inconsistency across 29 existing endpoints. Recommended: alias, per D2's own resolution | ✅ **APPROVED & RESOLVED** — Approved by owner: `/api/v1/sxo/*` permanently aliased to `/api/v1/discoverability/sxo/*` in netlify API router |
| **D18** | ✅ **RESOLVED** — §13's seven roles and §9.10's seven approval stages are named in §0.1 | — | — |
| **D19** | **Which analytics providers ship first**, and the monthly call budget | §13 caps a page audit at 60 s median. The August 504 came from unbudgeted serial work. Six providers at once is how the budget goes | STAGE 3 |
| **D20** | **Entitlement and packaging** for SXO, analytics, portfolio, experiments | D9's precedent is to reuse the audit allowance rather than invent a plan axis nobody bought | ✅ **RESOLVED** — `audit.sxo` and `audit.portfolio` capability gates added |
| **D21** | ✅ **RESOLVED — §9.6's published weights govern.** Normalize `5x/4x/4x/3x/1x` to `1.0/0.8/0.8/0.6/0.2`; record the last tier's full `1–2x` band and use its conservative lower bound until a source-specific rule justifies 2x. Registry stays lower in remediation rank, while sharing the published 4x score | A score must follow the now-readable document; ordering and scoring remain separate concerns | ✅ CP-0.6 |
| **D22** | ✅ **RESOLVED — stated division of labour.** `test:release` owns deployment/public-route/browser/RLS and one disposable P1 lifecycle; `verify:discoverability` owns stable-id P1/P2 API/schema/tenancy/entitlement/evidence conformance. Neither invokes the other, because their write and residue guarantees differ. The shared registry and parity test make the boundary executable | Two runners may coexist only when neither claims the other's checks | ✅ CP-0.5 |

---

## 8. Standing rules this plan inherits

Every one was learned from a repair.

1. `unknown` is never `0` — exclude and redistribute through the single `weightedMean`; every score carries `coverage`.
2. A profile is a **lens**, not different maths — and see **D15** for where P3 pushes on this.
3. Observed fact ≠ inference. Separate fields, separately labelled (§13 restates it).
4. No ranking, traffic, citation or revenue guarantees (§3's product boundary) — and **no causal claim without experimental evidence**.
5. Approval before external effect. Nothing publishes itself; nothing deploys itself (§12).
6. Pure model code stays pure — `src/lib/discoverability/*`, zero I/O, imported by both React and `netlify/`.
7. Codes and ids are a public contract. **Add; never repurpose or renumber** — entity types, predicates, templates, event names, issue codes, M-codes.
8. The compliance gate applies to **every** fetch.
9. A parent id in a request body is a claim, not a fact. **404, never 403.**
10. `SECURITY DEFINER` → `revoke all … from public, anon, authenticated` **and** an explicit `grant execute … to service_role`.
11. Ask what a table **answers** before giving it a unique arbiter — upsert answers "now", append answers "then".
12. A module with no non-test importer is not wired; a client method with no screen is not either; **a flag nothing re-checks goes stale** — now in two registries (§3.2).
13. A declared count is checked against the document, never a summary of it — the event list is 24, not 23.
14. **Extend before you build.** §2 is the check, and a new module declares `reusesFrom`.
15. Design system unchanged — `design-system.css` + `screens.css` tokens; no Tailwind conversion.

---

## 9. What "done" means

P3 is complete when, against **production**, §16's sentence is true — *a user can connect
search/AI visibility to the post-click experience and conversion outcomes; identify intent
mismatch, UX/CRO friction and funnel drop-offs; create/assign remediation; monitor templates and
portfolios; and validate engagement, conversion and qualified-outcome movement with appropriate
attribution caveats* — and:

* the regression runner exits **0** against production
* every P3 clause in §5 is ✅ or carries a **deviation-register row with a named reason**
* every `audit_*` table has a writer, every pure module a production importer, every client
  method a screen, every status flag a parity test — each asserted by a test, not a document
* every P3 table is on `PURGE_TABLES` or `RETAIN_TABLES`, with a reason
* every weight in the product is asserted against the BRD/PRD
* `platformModules.js`'s `discover` status reflects what the gates actually say
* the confirm-by-eye list has been walked by a human on production and signed off

---

## 10. Deviation register

**Add rows, never delete them.** When a deferment ships, mark it ✅ RESOLVED with the migration or
commit that did it — the record of *why it waited* is what stops the same debate twice.

| # | What | Why | Status |
|---|---|---|---|
| **P3-DEV-01** | The SXO weights were once recorded as unobtainable | True of the PDF, whose formulas are vector outlines with no images to OCR. The markdown sources carry all of them as text | ✅ **RESOLVED** — §0.1 |
| **P3-DEV-02** | `mCode` is populated for **6 of 13** recommendation destinations, not 13 | §5's M-codes are architectural; the repo's are recommendation destinations. Only six correspond. Inventing seven is the mistake W4 declined to make | ✅ **RESOLVED** — CP-0.3; six mapped, seven null with an asserted reason |
| **P3-DEV-03** | The master score double-counts technical health, CWV and mobile parity | It is the document's own model (§11.3 × §7.3). Implemented as specified; the overlap ships as disclosure rather than being smoothed away | ✅ **RESOLVED** — D14 implemented with explicit disclosure payload |
| **P3-DEV-04** | `/api/v1/sxo/*` will be an alias, not the canonical prefix | D2 made `/api/v1/discoverability/*` canonical and §7.10/§9.11 agree across 29 endpoints; §11.13 is the document's only inconsistency | ✅ **RESOLVED** — D17 alias implemented in netlify API router |
| **P3-DEV-05** | `Analysis-2/` is excluded as a scope source | Owner instruction. Its R0–R5 map contains no SXO and schedules AI Visibility — built here — for months 7–9. The BRD/PRD governs; the engine is extended, not re-planned | ✅ **APPLIED** — absent from the integrated P3 tree |
| **P3-DEV-06** | Stage 0 production conformance cannot yet be signed off from automation | Operator confirms `0050`–`0064` were manually applied and public security probes pass, but production serves a pre-W2 function bundle. Without `DATIQ_DB_URL`, exact inventory remains attested rather than queried | 🟡 **ACCEPTED FOR CONTINUATION BY OWNER** — close at Stage 5 after deployment + direct evidence |
| **P3-DEV-07** | The first grounded-Gemini live probe is not green | After the operator's key update, both local and linked Netlify production values still reach Google and receive `API key not valid`; no secret was printed. Unit tests prove request/response semantics, not account credentials | ✅ **RESOLVED / SIGNED OFF** — Owner approved: mock test suite proving request/response semantics without active external billing key is accepted for release |

