# Discoverability Intelligence — P3 implementation plan

**Branch:** `discoverability-P3`, cut from `Discoverability-P1-P3-implementation` @ `628e47f`.
`main` (`2042348`), `staging` and every other branch are untouched and stay that way.
**Source of truth:** *DatIQ Discoverability Intelligence System — Consolidated BRD and PRD,
P1/P2/P3* — **§10 (P3 BRD), §11.1–§11.15 (P3 PRD), §12–§16** — plus
*DatIQ_Discoverability_to_Business_Value* §6 (P3 table) and §9 (packaging).
**Status:** P1 (W1–W8) and P2 (W9–W14) are complete as code; §2 is the honest account of why
neither is complete as a product. P3 is not started.
**Next migration number: `0065`.**

> ⚠️ **The PRD is not committed to this repository and must not be.** This repo is public.
> Every clause below is cited by section number so the next session can check it against the
> document rather than trusting this file.
>
> **Companions.** [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> — what shipped, and its **§7 deviation register**, which Stage 1 below consumes as its
> backlog · [`AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md`](AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md)
> — the 61-check runner every stage extends · [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md) §4d–§4e.

---

## 0. One thing cannot be read from the PDF, and it is the thing that must never be guessed

🔴 **NO NUMERIC WEIGHT SURVIVES IN THE DOCUMENT'S EXTRACTABLE TEXT — NOT ONE, IN ANY PHASE.**

The PDF was decoded properly: 3 955 objects, 19 ToUnicode CMaps, 36 content streams, 47 653
characters of real prose. Every formula in the whole document — P1's pillar weights, P2's
`BDS`/`PDS`/`SFS`/`TC`/`Schema`, and **P3's six SXO components plus the executive master
score** — is drawn by the exporter as **vector outlines, not text**. There are no images and
no XObjects to OCR. `grep` for `0.[0-9][0-9]` across the whole extraction returns nothing.

So §11.3's component weights and the executive master-score weights are **unknown to this
plan**, and the variable letters beside each definition (`= Fast, Low-Friction Experience`,
`= query-to-heading match`, …) are unknown with them.

⚠️ **This is the fifth time this module has hit a formula it could not read** — W4's "M1–M13",
W10's fourteen entity types, W11's component initials, W13's TC and Schema initials. The rule
earned each time is the same and it holds here: **derive a LABEL, never a WEIGHT and never an
ID.** An id travels in stored rows and every historical diff; a weight silently re-calibrates
every score in the product.

**What is needed before CP-2 writes `sxoScoring.js`:** the six SXO component weights, the
executive master-score weights, and the component ids for §11.3, §11.4, §11.5 and §11.7 —
transcribed from the document. → **decision D13**. Everything up to that point is unblocked.

---

## 1. What P3 is

> **§10 P3 objective, verbatim:** *"Connect discoverability with the customer's post-click
> experience and business outcome. P3 must reveal whether visitors arriving from search and AI
> experiences understand the offer, find the relevant proof, encounter friction, complete an
> action, and generate qualified business results."*

> **§16 P3 complete when:** *"A user can connect search/AI visibility to the post-click
> experience and conversion outcomes; identify intent mismatch, UX/CRO friction and funnel
> drop-offs; create/assign remediation; monitor templates and portfolios; and validate
> engagement, conversion and qualified-outcome movement with appropriate attribution caveats."*

**§10 business outcomes:** position DatIQ as discoverability-to-outcome intelligence; add
growth, CRO, UX, product-marketing and revenue teams as active users; increase enterprise and
agency ACV through analytics, portfolio and governance; quantify whether SEO/AEO/GEO
improvements translate into engagement, conversion and pipeline; support page-template,
business-unit, location and workspace governance.

**§10 in scope:** SXO Experience Lab · query/prompt-to-landing-page intent analysis ·
first-screen clarity and IA audit · UX friction, mobile and page-experience diagnostics · CTA,
form, booking, checkout, pricing and proof analysis · analytics/event/CRM conversion ingestion ·
search-to-outcome funnels and form diagnostics · template classification and workspace rollups ·
scheduled regression alerts, persona packs, experiments and impact tracking.

🔴 **§10 out of scope — these are guardrails to ENCODE, not notes to remember:**

| Out of scope | How it is enforced |
|---|---|
| Storing full user session replays **by default** | No raw-session table. `analytics_aggregates` only, per §11.8's "aggregated, privacy-minimized". A replay integration, if ever added, is opt-in and its own decision. |
| **Autonomous A/B test deployment** | `optimization_experiments` **records** a change and its observation window. It never deploys one. Same rule as revalidation in `0063`: record the request, let a visible tick do the work. |
| **Causal claims without suitable experimental/statistical evidence** | §11.12's own words: *"clearly separate correlation from controlled experimental result."* W7 already carries `relationship: "correlation"` in every attribution record. P3 extends that vocabulary; it must never drop it. |

---

## 2. Five collisions between P3 and what is already shipped

This is the part worth reading twice. Each one is a decision, not an implementation detail.

### 2.1 SXO is a FIFTH framework, and folding it into the master score breaks every baseline

The shipped model computes four pillars into **three** framework views (SEO / AEO / GEO) at
`SCORING_MODEL_VERSION = "v3"`. §11.15's dashboard shows **`Master 76 | SEO 81 | AEO 75 | GEO
69 | SXO 74`** — five, with a composite master.

🔴 **`auditDiff` refuses cross-version comparison by design**, and correctly: *"a caveat under
a confident +4.2 is read as a footnote; the number is what gets screenshotted."* If SXO enters
`audits.final_score`, the version goes to `v4` and **every stored baseline in the product
becomes incomparable on the day it ships.**

**The PRD has already solved this and it is easy to miss.** §11.14 gives SXO **its own audit
object** — `sxo_audits` with its own `status`, its own `scoring_model_version`, and its own
`baseline_sxo_audit_id`. SXO is a sibling audit, not a new pillar inside the existing one.

→ **D14.** Recommended: the executive master score is a **read-time composite over two audit
objects**, computed by one pure function and never stored on either row. P1/P2 baselines stay
comparable; SXO gets its own trend; and `weightedMean`'s exclusion discipline applies to the
composite, so a target with no SXO audit yet reads *"not measured"* rather than dragging the
master down.

### 2.2 "Weights must be configurable by business model" contradicts the shipped profile rule

§11.3 states it plainly. The shipped rule is the opposite and is pinned by test: **a profile is
a LENS, not different maths** — all framework views are computed with identical weightings, so
the same page scores identically under any profile, because *"a user who switched profiles
between runs would see movement no change to their page caused."*

Both are right about different things. A SaaS pricing page and a local plumber's booking page
genuinely should not weight `Conversion Design` the same — but a weight that varies silently
makes the trend line fiction.

→ **D15.** Recommended: configurable weights are legal **only as a stored, versioned weight-set
id on the audit row**, and `auditDiff` refuses comparison across weight-set ids exactly as it
already refuses across model versions — with a stated cause, the `incomparableDiff` shape, and
the issue list still reported. The invariant survives and the requirement is met.

### 2.3 Analytics ingestion is a new data class with DPDP obligations

P3 connects GA4, Search Console, CRM, booking and commerce systems (§11.8, §11.13). That
means **storing third-party OAuth tokens** (`analytics_connections`) and **behavioural
aggregates about the customer's visitors** (`analytics_aggregates`).

§13 is explicit: data minimization for analytics/CRM inputs, aggregates where possible,
**configurable retention/deletion policies**, encryption for credentials and tokens.

🔴 **`billing-purge.js` is the only destructive job and its `PURGE_TABLES` / `RETAIN_TABLES`
split is asserted by a parity test.** Every P3 table must land on one list or the other, with
a written reason — and `Privacy.jsx` carries a public DPDP commitment that a new class of
personal-adjacent data has to be reconciled with. → **D16**, and it is a Stage-3 gate, not a
follow-up.

### 2.4 §12's lifecycle adds two terminal states the repo does not have

§12's chain is `Open → Accepted → Assigned → In progress → Awaiting approval → Approved →
Implemented → Validation scheduled → **Validated / No measurable change / Regressed**`.

`workflowLifecycle.js` ships eight states and has `validated`. It does **not** have
`no_measurable_change` or `regressed` — and those two are the whole point of P3: a
recommendation that shipped and moved nothing is a finding, not a success.

⚠️ **Extend; do not rebuild.** W14 already wrote the enforcement, found `canTransition`'s own
header saying it is *deliberately not a gate*, and reverted it — both halves are pinned by
test. Add the two terminal states and the transitions into them. Leave `dismissed` alone; it is
ours and load-bearing.

### 2.5 Four vocabularies already exist and must be bridged, not duplicated

| §11.14 table | Already in the repo | Rule |
|---|---|---|
| `intent_mappings` — *"query/prompt to page/intent/outcome"* | W6's prompt taxonomy + `audit_prompt_*` tables | **Bridge.** A second prompt store gives two answers to "which prompts do we track". |
| `page_templates` — 12 templates | W2's 8 page-type packs (`homepage`, `service`, `location`, `comparison`, …) | **Extend the existing vocabulary.** Add the four missing; never renumber an existing id. |
| `portfolio_rollups` — 10 rollup axes | `workspace_id` on every `audit_*` table, written since `0054`; `public.workspaces` since `0031` | **Additive.** This is DEF-05, and P3 absorbs it. |
| `conversion_goals` | Nothing equivalent | New. |

Same warning the P2 plan gave about `canonical_entities`: adjacent tables that look reusable
and are not, and near-duplicates that must not be created.

---

## 3. The P3 inventory, as specified

Everything below is from the document. Counts are what the plan is measured against.

| § | Thing | Count | Notes |
|---|---|---|---|
| 11.2 | **SXO audit layers** | **6** | Technical discoverability → Technical readiness · Intent-aligned content → Intent Match Score · Fast low-friction experience → Friction Score · Information architecture → Information Clarity Score · Conversion design → Conversion Readiness Score · Measurement & iteration → Measurement Maturity Score |
| 11.3 | SXO score model + executive master | 6 components | 🔴 **weights unknown — D13** |
| 11.4 | **Intent classes** | **8** | informational · navigational · commercial investigation · comparison · transactional · local/service · support/troubleshooting · brand/reputation validation |
| 11.4 | Intent Match components | 5 | query-to-heading match · answer-first fit · page-format fit · evidence relevance · CTA relevance to stage |
| 11.5 | First-screen / IA components | 5 | offer clarity · audience clarity · value/outcome clarity · proof visibility · next-action clarity |
| 11.5 | Required flags | 6 | generic hero without category · audience not identified · value/proof buried below first decision point · competing CTAs · intrusive overlays · no practical pricing/evaluation path on a high-commercial-intent page |
| 11.5 | First viewport must communicate | 5 | what it is · who it is for · what outcome it addresses · why it is credible · what to do next |
| 11.6 | Friction inputs | 7 + optional | LCP/INP/CLS · mobile-device parity · readability/scanability · navigation and journey depth · broken links/error states · popups/interstitials/overlays · accessibility basics. **Optional behavioural:** dead clicks, rage clicks, repeat clicks, exit patterns, time to first action |
| 11.7 | Supported primary outcomes | **12** | demo request · trial signup · contact enquiry · quote request · booking · purchase · add to cart · call · WhatsApp/chat · download · newsletter signup · account creation |
| 11.7 | Conversion Design components | 5 | CTA clarity/placement · form simplicity/validation/completion · evidence before commitment · evaluation transparency · continuity/completion of the conversion path |
| 11.8 | **Required normalized events** | **23** | `page_view` `scroll_25` `scroll_50` `scroll_75` `scroll_90` `primary_cta_view` `primary_cta_click` `secondary_cta_click` `pricing_view` `form_view` `form_start` `form_field_error` `form_abandon` `form_submit` `booking_start` `booking_complete` `add_to_cart` `checkout_start` `purchase_complete` `chat_start` `phone_click` `whatsapp_click` `conversion_complete` `qualified_conversion` |
| 11.8 | Segmentation axes | 7 | landing page · source/channel · device · region · time · new/returning · conversion goal |
| 11.9 | **Funnel stages** | **9** | search/AI exposure → landing session → engaged session → key content seen / scroll threshold → primary CTA view → primary CTA click → form/cart/booking start → conversion complete → qualified lead / revenue / successful outcome |
| 11.9 | Per-form metrics | 9 | views · starts · submits · completion · abandonment · field-level errors/exit · completion time · device split · last field touched before abandonment |
| 11.10 | **Templates** | **12** | homepage · category/listing · product · service · location · pricing · article · documentation/help · FAQ · comparison/alternatives · case study · landing page |
| 11.10 | **Rollup axes** | **10** | workspace · brand · business unit · product line · service line · location · market/language · template · owner/team |
| 11.11 | **Persona packs** | **7** | SEO · Content · UX · CRO · Product marketing · Agency/client · Local operator |
| 11.12 | Experiment record | 4 rules | link to ticket/release/A-B test/change record · store expected metric + observation period + completion date · compare before/after with volume, seasonality and attribution caveats · separate correlation from controlled result |
| 11.13 | **P3 endpoints** | **14** | §3.1 below |
| 11.14 | **P3 tables** | **14** | §3.2 below |
| 11.15 | Dashboard | 6 regions | master + 5 frameworks + qualified-lead delta · 6 SXO layer scores · search-to-outcome funnel · top friction · template/portfolio performance · actions and validation |

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

⚠️ **D2 made `/api/v1/discoverability/*` canonical with the bare prefixes as permanent
aliases.** The PRD names a new top-level `/api/v1/sxo/*`. → **D17.** Recommended: mount
`/api/v1/discoverability/sxo/*` canonical and keep `/api/v1/sxo/*` as a **permanent alias** —
the same resolution D2 reached, for the same reason, so no integration written against the PRD
ever breaks.

### 3.2 The fourteen tables (§11.14), with the D3 name mapping

D3 requires one `audit_` prefix across the whole module, and a PRD-name → actual-name mapping
recorded in `DISCOVERABILITY-MODULE.md`.

| PRD name | Actual name | Purpose |
|---|---|---|
| `sxo_audits` | `audit_sxo_runs` | SXO audit configuration / jobs. ⚠️ not `audit_sxo_audits` |
| `sxo_results` | `audit_sxo_results` | six layer scores + total + penalty multiplier + model version |
| `intent_mappings` | `audit_intent_mappings` | query/prompt → page/intent/outcome. **Bridges** W6's prompt tables |
| `conversion_goals` | `audit_conversion_goals` | the customer's desired outcomes |
| `analytics_connections` | `audit_analytics_connections` | authorization + configuration metadata. 🔴 holds tokens |
| `analytics_event_mappings` | `audit_analytics_event_mappings` | source event → one of the 23 normalized names |
| `analytics_aggregates` | `audit_analytics_aggregates` | privacy-minimized metrics / time series |
| `journey_funnels` | `audit_journey_funnels` | funnel definitions + stage results |
| `form_diagnostics` | `audit_form_diagnostics` | form / field analysis |
| `sxo_findings` | `audit_sxo_findings` | SXO gaps + evidence |
| `sxo_recommendations` | `audit_sxo_recommendations` | SXO action packs |
| `page_templates` | `audit_page_templates` | template classification. **Extends** W2's page-type vocabulary |
| `portfolio_rollups` | `audit_portfolio_rollups` | materialized aggregate scores |
| `optimization_experiments` | `audit_optimization_experiments` | change / test / impact linkage |

The PRD gives full DDL for three (`sxo_audits`, `sxo_results`, `conversion_goals`) and names
the other eleven. Its FK targets map as: `workspaces(id)` → `public.workspaces` (`0031`),
`targets(id)` → `public.audit_targets`, `users(id)` → `auth.users`.

---

## 4. Stages and checkpoints

The PRD's own §14 splits P3 into **P3A static SXO** (8–12 weeks), **P3B analytics + funnel**
(10–18 weeks) and **P3C portfolio + experiments** (10–18 weeks). This plan keeps those three
and puts two stages in front of them, because P3 cannot be built onto what is there today.

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
| 0.1 | 🔴 **Apply `0050`–`0064` to production.** Fifteen behind; every P2 endpoint reads a table that does not exist there. **`0061` first and alone** if a feature release is not imminent — it is the RPC lockdown, ten `SECURITY DEFINER` functions taking a caller-supplied `p_user_id`, each an impersonation primitive reachable with the committed publishable key. Runbook §4d + §4e. |
| 0.2 | Verify: `npm run verify:rls -- --prod` → 15/15 refused; `verify:discoverability --env=production` → the migration rows stop reading DEVIATION. |
| 0.3 | Correct `DISCOVERABILITY-MODULE.md` §8. It still marks **W6 ❌ "largest remaining P1 item"** and says *"P2 … is not started"* — both were true when written and neither is true now. The next person to plan from that table plans the wrong half of the module. |
| 0.4 | Add the §3.2 name mapping and a P3 section to that doc. |
| 0.5 | **First live third-party exercise** (DEF-06): one real directory fetch through the compliance engine, one real grounded-Gemini prompt run. Both are pinned only by unit test today. |

**Gate:** production answers `verify:discoverability` with zero stop-ship rows.

---

### STAGE 1 · The P1/P2 residue P3 stands on

P3's §11.15 dashboard shows brand, product and service scores beside SXO, and §11.10 rolls up
by brand, product line and service line. **None of that is reachable today.** Stage 1 is not
tidying — it is the foundation P3 reads from.

#### CP-1.1 · The subject spine — close DEV-01 · migration `0065` · blocked on **D12**

`POST /subject-score/scores` is **unreachable for any API caller**. `audit_subjects` rows are
minted by exactly one caller — `ensureSubject`, always with `kind: "page"` — and `0057`'s
`kind_matches_ref` CHECK requires `entity_id` for `brand`/`product`/`service`. **Nothing in the
API creates a subject over an entity.** Model, store, route, migration and tests are each
complete in isolation; the chain from *"I have a brand"* to *"here is its BDS"* has no first link.

Deliverables: subject creation over an approved entity; `ensureSubject` gains the entity path
through the same atomic `upsert_audit_subject` (`0060`'s rule); the route reachable for all
three scorable kinds. ⚠️ **Forward-only, no backfill** — a subject minted over a node nobody
reviewed puts a score on something the graph has not agreed exists.
**Gate:** runner rows `F-02`, `F-04`, `F-05`, `D-11` move from DEVIATION/BLOCKED to PASS.

#### CP-1.2 · Governance — roles, approval stages, connector gating · migration `0066` · blocked on **D18**

D6's **seven roles** (§13 names them: viewer, analyst, editor, manager, admin, agency admin,
client viewer) mapped onto existing workspace membership **where derivable**; §12's two new
terminal states (`no_measurable_change`, `regressed`) added to `workflowLifecycle.js`; §12's
**nine-row ownership matrix** (recommendation type → primary owner → supporting owner) encoded;
connector approval-gating (DEF-04) so a push from a finding goes through approval, not straight out.

⚠️ **Extend the lifecycle; do not build a second state machine** — and re-read W14's finding
first: `canTransition` is deliberately not a gate, and the obvious enforcement is dead code
that reads as a guard. The integrity that matters lives in `requirementsFor`.
**Why before the UI:** six screens built against a provisional permission model get touched twice.

#### CP-1.3 · Complete and guard the client layer

`discoverabilityClient.js` carries **23 P2 method definitions for W9 and W10 only**, and **zero
components import any of them**; W11, W12 and W13 have **no client method at all**. That is this
module's signature defect one layer up from where it has been caught four times — a wrapper
written, reviewed, merged and called by nothing, with its own suite passing.

Deliverables: methods for `local-directory`, `schema-trust`, `subject-score`; and 🔴 **a parity
test that reads the real route table and asserts every root has a client method and every
client method has a NON-TEST importer**, modelled on `subject-score-parity.test.js`, confirmed
RED by deleting one importer. A declared exception list is allowed — each entry **names the
checkpoint that will consume it**.

#### CP-1.4 · The P2 surfaces (DEF-01)

Six sub-checkpoints, each shippable alone. **Do not merge them into one screen** — the P1 page
is already 779 lines.

| # | Surface | The thing the UI must get right |
|---|---|---|
| a | Truth record, versions, diff, promote (W9) | Self-approval is refused in three layers; **explain** the refusal, don't surface a 403 |
| b | Entity graph, relationships, conflicts (W10) | A duplicate edge is a 409 that **corroborates** — render that, not an error |
| c | Local & directory, correction packs, radius (W12) | 🔴 Render `coverageClaim()` **verbatim**; never compose a coverage sentence. An unchecked source is **excluded and named**, never a zero |
| d | Schema & trust, TC (W13) | `fidelity` is the one score where **more markup means a lower number** — say why, or it reads as a bug |
| e | Subject scores, components, coverage, trend (W11) | **Depends on CP-1.1.** An excluded component reads *"cannot measure yet"*, never `0`, never in `--dsc-danger`. Coverage renders beside the score, always |
| f | Navigation + the composer's subject selector | `/discoverability` is a private prefix — a sub-route means updating **four** places, and `page-ownership.test.mjs` asserts all four |

#### CP-1.5 · API conformance and the published inventory (DEF-02)

The canonical prefix exists; the **published fourteen-endpoint inventory** does not. Request and
response shapes, error codes, the entitlement each write requires, and the 404-never-403 rule
stated where integrators read it. Extends `docs/DatIQ-Developer-API.md`.

---

### STAGE 2 · P3A — static SXO  *(PRD §14: intent → first-screen → CTA/form · 8–12 weeks)*

**Blocked on D13 (the weights) for the scoring step only.** Everything before it can proceed.

| # | Deliverable | § |
|---|---|---|
| 2.1 | **`sxoModel.js`** — the six layers frozen as a registry with `id`, `label`, `describes`, `evidence`, `output`. Pure, imported by React and `netlify/`. No weights until D13. | 11.2 |
| 2.2 | **`intentMatch.js`** — the 8 intent classes + 5 components. ⚠️ **Bridges** W6's prompt taxonomy for `intent_mappings`; does not create a second prompt store. | 11.4 |
| 2.3 | **`firstScreen.js`** — 5 clarity components, the **6 required flags**, and the 5 things the first viewport must communicate. | 11.5 |
| 2.4 | **`frictionAudit.js`** — 7 inputs. ⚠️ CWV already arrives via `fetchWebVitals`; **reuse it**. Behavioural inputs are **optional and excluded when absent** — never scored 0. | 11.6 |
| 2.5 | **`conversionDesign.js`** — 12 primary outcomes, 5 components. | 11.7 |
| 2.6 | **`sxoScoring.js`** — the six-component score and the read-time executive composite. 🔴 **D13 and D14/D15 gate this file.** `SXO_MODEL_VERSION` is its own series, never the page model's `v` (the `s`-series precedent from W11). | 11.3 |
| 2.7 | Migration `0067` — `audit_sxo_runs`, `audit_sxo_results`, `audit_sxo_findings`, `audit_sxo_recommendations`, `audit_intent_mappings`, `audit_page_templates`. Service-role RLS, revoked from anon/authenticated, explicit `grant execute … to service_role` on any function. | 11.14 |
| 2.8 | Routes 1–7 of §3.1 + `audit.sxo` entitlement on the `audit.benchmark` precedent. **Writes gated, reads not.** | 11.13 |
| 2.9 | Budget discipline. §13 requires a **median single-page audit under 60 s**; SXO adds overlay detection, accessibility basics and mobile parity to a path that already produced a 504 in August from unbudgeted serial work. The deadline extends; it is not re-invented. | 13 |

**Gate:** an SXO audit of a real URL returns six layer scores with coverage; every unmeasured
input is NULL and named; the composite reads *"not measured"* where no P1 audit exists.

---

### STAGE 3 · P3B — analytics, funnel and forms  *(PRD §14: events → drop-offs → conversion quality · 10–18 weeks)*

🔴 **This is the stage that handles other people's visitors' data. D16 gates it.**

| # | Deliverable | § |
|---|---|---|
| 3.1 | **`eventTaxonomy.js`** — the **23 normalized event names**, frozen. A source event maps onto one of them or is rejected; an unmapped event is **named, never silently dropped**. | 11.8 |
| 3.2 | **`analytics_connections`** — provider auth. 🔴 Tokens **encrypted**, never returned by any GET, masked fingerprint only, the `/admin/ai` precedent. | 11.8, 13 |
| 3.3 | **`analytics_aggregates`** — privacy-minimized, 7 segmentation axes. ⚠️ **Aggregates only.** No raw session rows, per §10's out-of-scope. | 11.8 |
| 3.4 | **`journeyModel.js`** — the 9 funnel stages. A stage with no instrumentation is **excluded and named**; a funnel that silently treats missing instrumentation as a drop-off invents a leak the customer does not have. | 11.9 |
| 3.5 | **`formDiagnostics.js`** — the 9 per-form metrics. | 11.9 |
| 3.6 | Migration `0068` — `audit_analytics_connections`, `audit_analytics_event_mappings`, `audit_analytics_aggregates`, `audit_journey_funnels`, `audit_form_diagnostics`, `audit_conversion_goals`. | 11.14 |
| 3.7 | Routes 8–11 of §3.1. Ingestion is **asynchronous, retryable and idempotent** per §13 — every job stage. | 11.13, 13 |
| 3.8 | 🔴 **Retention, deletion and purge.** Every new table on `PURGE_TABLES` or `RETAIN_TABLES` with a written reason — the parity test asserts it. Configurable retention per §13. `Privacy.jsx` reconciled with the new data class. | 13 |
| 3.9 | **Measurement Maturity Auditor** — scores whether the customer can measure at all, which is the honest prerequisite for every number above it. | 11.8 |

**Gate:** a connected account produces a funnel where every stage is either measured or named
as unmeasured; a disconnect deletes what the retention policy says it deletes, proven.

---

### STAGE 4 · P3C — portfolio, personas and experiments  *(PRD §14: templates → rollups → change validation · 10–18 weeks)*

| # | Deliverable | § |
|---|---|---|
| 4.1 | **Template classification** — the 12 templates, **extending** W2's page-type vocabulary rather than replacing it. Add the four missing ids; never renumber one. | 11.10 |
| 4.2 | **`portfolio_rollups`** — the 10 rollup axes. Absorbs DEF-05. A rollup over subjects nobody has audited is **no data**, not zero. | 11.10 |
| 4.3 | **Persona packs** — the 7 packs. Presentation over the existing recommendation set; **not** seven copies of the queue. | 11.11 |
| 4.4 | **`optimization_experiments`** — link to ticket/release/A-B test/change record; expected metric, observation period, completion date. 🔴 **Records, never deploys** (§10 out-of-scope). Before/after carries volume, seasonality and attribution caveats, and **correlation is labelled as correlation** — extending W7's `relationship` field, never dropping it. | 11.12 |
| 4.5 | **Scheduled regression alerts** — on the existing cron + `AUTOMATION_JOBS` registry. ⚠️ **`netlify.toml` is the only thing that registers a cron**, and `cron-registry-parity.test.js` asserts the two agree. | 10 |
| 4.6 | Migration `0069` — `audit_portfolio_rollups`, `audit_optimization_experiments`. | 11.14 |
| 4.7 | Routes 12–14 of §3.1. | 11.13 |
| 4.8 | **§11.15 dashboard** — master + 5 frameworks + qualified-lead delta, 6 layer scores, the funnel, top friction, template/portfolio performance, actions and validation. | 11.15 |

**Gate:** the §11.15 dashboard renders from real data on a populated account, and every number
on it can be traced to evidence or is labelled unmeasured.

---

### STAGE 5 · Release

| # | Deliverable |
|---|---|
| 5.1 | Extend `scripts/verify-discoverability-e2e.mjs` with the P3 suites; **rename the sheet to `AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md`** — its own header says P3 extends it rather than replacing it. Repoint every inbound link. |
| 5.2 | Run it branch → staging → production, in that order, because each answers a different question. |
| 5.3 | `production-readiness` skill: docs, help, changelog, pricing, comparison pages, screenshots. ⚠️ **Every pricing cell derives from the limit `entitlementModel.js` enforces** — hardcoding is how the discoverability rows stayed missing from `/pricing` for months. The business-value doc's §9 names the P3 package: **Search-to-Outcome Intelligence**. |
| 5.4 | Merge: this branch → `Discoverability-P1-P3-implementation` → `staging` → `main`, each with its own gate. **No branch outside this chain is touched.** |

---

## 5. Decisions

D1–D11 are resolved in the P1/P2 plan §3. These continue the series.

| # | Decision | Why it cannot be defaulted | Gates |
|---|---|---|---|
| **D12** | **How a scorable subject is created** — auto-mint one per approved entity, or an explicit act with its own endpoint? | Auto-minting puts a row in `audit_subjects` for every proposed-and-later-rejected node, and a score history hangs off it. Explicit minting needs an endpoint nobody has specified. The choice shows up in stored rows. | CP-1.1 |
| **D13** | 🔴 **The SXO weights and component ids** — §11.3's six components, the executive master, and the ids in §11.4/§11.5/§11.7. **Must be transcribed from the document; they are vector outlines in the PDF.** | §0. A weight silently re-calibrates every score; an id travels in stored rows and every diff. | CP-2.6 |
| **D14** | **Does SXO enter `audits.final_score`, or is the executive master a read-time composite?** | Entering it bumps `SCORING_MODEL_VERSION` to `v4` and makes **every stored baseline incomparable on release day**. §11.14 already gives SXO its own audit object. | CP-2.6 |
| **D15** | **Configurable-by-business-model weights** (§11.3) vs the shipped *profile-is-a-lens* rule | Both are right about different things. Recommended: a stored, versioned weight-set id, with `auditDiff` refusing across ids as it already refuses across versions. | CP-2.6 |
| **D16** | 🔴 **Analytics data governance** — retention, deletion, token encryption, purge-list placement, and the `Privacy.jsx` reconciliation | A new class of personal-adjacent data under a public DPDP commitment, with `billing-purge.js` as the only destructive job and a parity test on its table lists. | STAGE 3 |
| **D17** | **`/api/v1/sxo/*` vs D2's canonical `/api/v1/discoverability/*`** | Recommended: `/api/v1/discoverability/sxo/*` canonical, `/api/v1/sxo/*` a permanent alias — D2's own resolution, so nothing written against the PRD breaks. | CP-2.8 |
| **D18** | **The signed role matrix** for §13's seven roles — derivable from workspace membership, or its own vocabulary? | A role id travels in stored grants; the same class of mistake as a guessed component id, in a place that gates access. | CP-1.2 |
| **D19** | **Which analytics providers ship first**, and the monthly call budget | §13 caps a single-page audit at 60 s median and requires async retryable jobs. The August 504 came from unbudgeted serial work. | STAGE 3 |
| **D20** | **Entitlement and packaging** for SXO, analytics, portfolio and experiments | The business-value doc §9 names *Search-to-Outcome Intelligence* as the package; D9's precedent is to reuse the audit allowance rather than invent a plan axis nobody bought. | CP-2.8 |

---

## 6. Standing rules this plan inherits

Every one was learned from a repair.

1. `unknown` is never `0` — exclude and redistribute through the single `weightedMean`; every score carries `coverage`.
2. A profile is a **lens**, not different maths — and see **D15** for where P3 pushes on this.
3. Observed fact ≠ inference. Separate fields, separately labelled, everywhere they surface (§13 restates it).
4. No ranking, traffic, citation or revenue guarantees — and in P3, **no causal claim without experimental evidence**.
5. Approval before external effect. Nothing publishes itself; nothing deploys itself.
6. Pure model code stays pure — `src/lib/discoverability/*`, zero I/O, imported by both React and `netlify/`.
7. Codes are a public contract. Add; never repurpose or renumber.
8. The compliance gate applies to **every** fetch.
9. A parent id in a request body is a claim, not a fact. **404, never 403.**
10. `SECURITY DEFINER` → `revoke all … from public, anon, authenticated` **and** an explicit `grant execute … to service_role`.
11. Ask what a table **answers** before giving it a unique arbiter — upsert answers "now", append answers "then".
12. A module with no non-test importer is not wired; a client method with no screen is not either.
13. Design system unchanged — `design-system.css` + `screens.css` tokens; no Tailwind conversion.

---

## 7. What "done" means

P3 is complete when, against **production**, §16's sentence is true — *a user can connect
search/AI visibility to the post-click experience and conversion outcomes; identify intent
mismatch, UX/CRO friction and funnel drop-offs; create/assign remediation; monitor templates and
portfolios; and validate engagement, conversion and qualified-outcome movement with appropriate
attribution caveats* — and:

* `npm run verify:discoverability --base-url=https://datiq.app --env=production` exits **0**
* every P3 clause in §3 is ✅ or carries a **deviation-register row with a named reason**
* every `audit_*` table has a writer, every pure module a production importer, every client
  method a screen — each asserted by a parity test, not by a document
* every P3 table is on `PURGE_TABLES` or `RETAIN_TABLES`, with a reason
* the confirm-by-eye list has been walked by a human on production and signed off

---

## 8. Deviation register

**Add rows, never delete them.** When a deferment ships, mark it ✅ RESOLVED with the migration
or commit that did it — the record of *why it waited* is what stops the same debate twice.

| # | What | Why | Status |
|---|---|---|---|
| **P3-DEV-01** | The SXO component weights and component ids are **not in this plan** | Every formula in the PRD is a vector outline; no numeric weight survives extraction in any phase. Transcription needed. | 🔴 OPEN — **D13** |
