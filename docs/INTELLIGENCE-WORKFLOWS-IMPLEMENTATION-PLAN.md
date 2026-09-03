# DatIQ Intelligence Workflows — Implementation Plan

> Source: `DatIQ - Persona Specific Templates & Shareable Reports.pdf` (BRD + PRD 1–5).
> **Status: Phases 0, 1 and 2 SHIPPED to `staging`. Phases 3–7 PENDING.**
> Live delivery status: **[§2.0 Status board](#20-status-board)**. Decisions D1–D6 resolved (see §5).
> Written 2026-09-02 against `claude/datiq-implementation-plan-6caf6f`
> (= `main`/`staging` tip `e9cef39`).
> Read this after `CLAUDE.md`. Companion docs: `docs/DISCOVERABILITY-MODULE.md` (the closest
> architectural precedent in this repo), `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` (the v2 queue).

---

## 0. The headline finding

Roughly **40% of the five PRDs already exists in this codebase** — but almost every existing piece
is shaped for a *narrower job* than the PRD describes. The work is therefore **not** "build five new
features". It is:

> **Promote four existing subsystems from ad-hoc helpers into first-class, persisted, versioned
> objects — then build the one thing that genuinely does not exist (durable bulk enrichment).**

That reframing is what keeps this affordable. The table below is the whole plan in miniature.

| PRD | What exists today | What it actually is vs. what the PRD needs | Real work |
|---|---|---|---|
| **1 — Templates** | `extractionTemplates.js` (12 recipes), `TemplateGallery.jsx`, `outcomeTiles.js`, `personaConfig.js` (7 personas), `Onboarding.jsx`, `onboardingTour.js` | A **prompt-prefill library** (client-side constant). PRD needs a **versioned template engine** with `input_schema`/`extraction_schema`/`output_schema`/`credit_cost`/`plan_entitlement`, persisted runs, and a defined *output document* | New engine; keep the 12 recipes as seed data |
| **2 — Reports** | `shareService.js`, `public_reports`, `/p/:slug`, `PublicReportArticle.jsx`, `Gallery.jsx`, `exportBranding.js` brand kit, `report-email.js`, PDF | **Public-by-default, slug-is-the-only-auth.** PRD needs **private-by-default** with org links, named collaborators, expiry, revocation, access logs, engagement analytics | Access-model rework (also fixes a known RLS landmine — §2.9) |
| **3 — Bulk Account Intelligence** | `batchService.js` (in-browser, concurrency 3), `BatchRunProvider`, `creditEstimator.js`, export-only integrations | A **browser-driven batch runner**. PRD needs a **durable server-side queue**, canonical entities, dedup, ICP scoring, review queue, and *import* connectors | **The genuinely new build.** Heaviest phase |
| **4 — Watchlists** | `scheduled_tasks` + `scheduled-runner.js` (@hourly), `hashContent` change detection, `watchlistDeltas.js`, `auditDiff.js` | **Whole-page content hashing** — detects *that* something changed, never *what* or *whether it matters* | Replace hash-diff with **normalized field snapshots + materiality** |
| **5 — Signal Routing** | `workflow_events` + `workflow-orchestrator.js` + `workflow_runs` (retries, backoff, history), `/admin/automation`, n8n (17 flows), 5 integrations | A **system-event pipeline with no user-facing rules layer**; 5 whitelisted kinds, none of them intelligence events | Rules layer + event-kind expansion on an existing substrate — **cheapest of the five** |

**Consequence for sequencing:** PRD 5 looks like the biggest ask and is the smallest build. PRD 3
looks like an extension of `/batch` and is roughly a third of the total effort. Plan accordingly.

---

## 1. Architectural spine

Ten decisions that make all five PRDs cheaper *together* than any two of them separately. These
follow this repo's existing locked rules (see `CLAUDE.md` → Architecture rules) rather than
inventing new ones.

### 1.1 A template is **data**, not code
New `workflow_templates` table holding versioned rows. A pure `src/lib/templates/templateModel.js`
is imported by **both** React and `netlify/` — the same pattern as `entitlementModel.js` and
`discoverability/scoringModel.js`, and for the same reason: *the client and the server must not be
able to disagree about what a template does.*

`extractionTemplates.js` is **not deleted**. Its 12 recipes become seed rows and it keeps serving the
existing quick-recipe surface (`TemplateGallery.jsx` + its tests). The new engine is a superset.

### 1.2 One canonical run object — `template_runs`
**This is the highest-leverage decision in the plan.** Every one of the five PRDs either writes to or
reads from a single run row:

- PRD 1 — a template execution *is* a run
- PRD 2 — a report is *rendered from* a run (so "generate a report" becomes near-free)
- PRD 3 — each bulk list item *is* a run
- PRD 4 — each watchlist snapshot *is* a run
- PRD 5 — `template.run.completed` is the event that fires rules

Without this, each PRD invents its own result envelope and PRD 2 has to special-case four of them.

### 1.3 Durable jobs: **extend `workflow_events`, never add a second queue**
The repo already has optimistic-concurrency claiming, exponential backoff (1m/5m/30m/2h/12h),
per-attempt history in `workflow_runs`, and an admin UI at `/admin/automation`. A second queue means
two retry semantics, two failure modes, and two places to look during an incident.

PRD 3's `enrichment_jobs` becomes a **domain** table; its *execution* is driven by the existing
orchestrator via a new kind `enrichment.chunk`.

⚠️ **The one real constraint:** the orchestrator runs every 5 minutes, and a synchronous Netlify
function is killed at 10s. 100 domains cannot run in one invocation. Two viable shapes — **this is a
decision for you (§5, D1)**:
- **(a) Chunked self-invocation** — worker processes N items bounded by a remaining-ms budget, then
  re-enqueues itself. Mirrors `AUDIT_BUDGET_MS` in `discoverability.js`, which exists precisely
  because this repo already shipped a 504 from this exact mistake. No new platform surface.
- **(b) Netlify background functions** (`-background` suffix, 15-minute ceiling). Simpler code, but a
  new deploy-time surface, and this repo has a documented history of scheduled/deploy config
  silently not taking effect (the R19 four-unscheduled-crons incident).

**Resolved (D1): (a) — chunked self-invocation.** The budget-and-resume pattern is already proven
here, and it adds no new deploy-time surface. Referred to below as **§1.3a**.

### 1.4 Structured field snapshots replace content hashes (PRD 4's core)
Today: `hashContent(page)` → "changed / unchanged". That can never answer *what* changed or *whether
it matters*.

New shape, which keeps `hashContent` as a **cost-control pre-filter**:

```
fetch page → hash unchanged?  → stop. Zero AI cost, zero credits.
           → hash changed?    → extract normalized fields → diff FIELDS → classify materiality
```

Only a material field change ever reaches an AI call or a user's inbox. This is simultaneously the
differentiator ("alert only when a normalized business field changes") and the credit-cost control.

### 1.5 Materiality is a **pure function**, not an AI call
`src/lib/watchlist/materialityModel.js` — deterministic `(field, oldValue, newValue) → critical |
high | medium | low | unknown`. AI is invoked **only afterwards**, to explain a change already
classified as material, and its output is stored in a separate `interpretation` column beside the
`fact` columns (old value, new value, source URL, detected-at).

Three things fall out for free:
- The PRD's hard requirement that "AI explanation must distinguish **fact** from **interpretation**"
  is satisfied *structurally*, not by prompt discipline.
- Alert precision becomes unit-testable with no AI key.
- It matches the repo's existing rule: *"use model outputs only after structured evidence collection."*

### 1.6 `unknown` is never `0` — reuse the discoverability scoring rule verbatim
ICP scoring (PRD 3) and confidence scoring must route through the same `weightedMean()` discipline
already in `discoverability/scoringModel.js`: an unmeasured signal is **excluded and its weight
redistributed**, never scored zero, and every score carries `coverage`.

Concretely: an account whose employee count could not be extracted must **not** be scored as "0
employees, poor fit." That single bug would poison every ranked call list the product exists to
produce.

### 1.7 Rules are data; the evaluator is pure
`src/lib/rules/ruleModel.js` — `evaluateRule(rule, event) → { matched, reasons[] }`. Pure and shared,
so PRD 5's "test rule with a sample payload" is **the same function the runtime uses**, not a parallel
mock path that can drift from it. Actions dispatch through the existing `workflow_events` channels.

### 1.8 Credits: an append-only ledger is the source of truth; counters are derived
`credit_ledger` rows, with `usage_records` demoted to a cache. This copies the deliberate decision
already documented for audits in `CLAUDE.md`:

> *"audits are counted from the `audits` table … with no counter column, deliberately, because a
> counter that drifts from the rows it counts eventually bills somebody for work that is not there."*

Satisfies the PRD's "show expected credits before a run and actual credits after" with one table.

### 1.9 Reports: private by default, resolved server-side
Report reads move behind `netlify/functions/public-reports.js` (which already exists), which resolves
visibility with the service key. The `public read` RLS policy — which today exposes **every column
including `session_id`** to anyone holding a slug — is replaced.

This also finally closes the landmine `CLAUDE.md` already flags: the `owner update` policy is
unsatisfiable for anonymous sharers, and the tempting "just send the `x-session-id` header" fix would
let *any reader of a public report rewrite or delete it*. PRD 2 forces the correct fix.

### 1.10 Event kinds: expand the whitelist, keep it a whitelist
`KIND_WHITELIST` in `workflowEnqueue.js` goes from 5 → 15, adding the 9 canonical events the PRD
names plus `template.run.completed`. Keep the whitelist, keep the per-event `_ctx` pattern (it is what
makes one set of n8n workflow JSONs work across production, staging, and every branch deploy).

---

## 2.0 Status board

> Single source of truth for what exists. Updated at the end of every session.
> Last updated **2026-09-03**.

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| **0** | Spine — versioned templates, credit ledger, field provenance, shared pure models | ✅ **DONE** | `0036`–`0038` applied to staging · `templateModel` / `creditModel` / `visibilityModel` + 86 unit tests |
| **1** | PRD 1 — workflow templates & guided onboarding | ✅ **DONE** | 5 templates live on staging + 1 draft · `/templates` catalogue + runner · `templates.js` (21 contract tests) |
| **2** | PRD 2 — shareable intelligence reports | ✅ **DONE** | `0039` applied · `/r/:slug` · publish/unpublish/revoke state machine · `reports.js` (23 contract tests) |
| **3** | Activation instrumentation (PQL) + integration recipe gallery | 🟡 **PARTIAL** | Spine done: `0040_pql.sql` verified on WASM PG · `pqlModel.js` transcribed from the PRD (9 signals / **130 points** / threshold **50 raw**) + 25 unit tests + 18 db assertions. **Pending:** ~15 analytics event kinds, activation wiring, recipe gallery, founder funnel |
| **4** | PRD 3 — bulk account intelligence ⚠️ heaviest | ⬜ **PENDING** | `bulk_icp_enrichment` seeded as `draft`, awaiting its durable runner |
| **5** | PRD 4 — competitor watchlists & change intelligence | ⬜ **PENDING** | — |
| **6** | PRD 5 — native signal routing | 🟡 **PARTIAL** | Event model shipped (`KIND_WHITELIST` 5→16). Rules layer + UI pending |
| **7** | Packaging, GTM surfaces, release collateral | 🟡 **PARTIAL** | Entitlements + plan limits done. Pricing page, persona landing pages, help/changelog pending |

**Effort remaining: ~12–16 sessions** of the original 20–28.

### What is DONE but deliberately not yet exposed

| Item | Where | Why it is not live |
|---|---|---|
| `bulk_icp_enrichment` template | seeded `status='draft'` | Its durable runner is Phase 4. A template whose runner 404s is worse than an absent one. |
| `template.duplicate` entitlement | `entitlementModel.js`, gated Go+ | The fork/edit UI is a Phase 7 follow-up. The gate exists so pricing copy cannot drift ahead of it. |
| `report.branding` entitlement | gated Business+ | Server-side enforcement is live; the Brand Kit picker for reports is a follow-up. |
| `extracted_fields` / `field_provenance` | `0038`, live on staging | Written by Phases 4 and 5. Phase 1 runs store provenance in the run's `output` blob for now. |
| `credit_estimates` drift tracking | `0037`, live | Rows accumulate now so estimate-vs-actual drift is measurable *before* anyone tunes a price. |
| `pqlModel.js` | `src/lib/pql/`, no caller yet | Transcribed from the PRD (see §PRD source tables below). Wiring it to real events is the rest of Phase 3. |

### Known gaps inside the shipped phases — tracked, not forgotten

| Gap | Phase | Consequence today |
|---|---|---|
| Runs orchestrated client-side | 1 | Closing the tab mid-run abandons it. Phase 4 brings the durable server runner. |
| No `/reports` management screen | 2 | `GET /api/reports` works; sharing is driven from the run screen only. |
| Report export (PDF/CSV/email) not wired to `reports` | 2 | PRD 2 lists it "Later if not already supported". |
| `report_access_log` recorded but not surfaced | 2 | Engagement analytics fill correctly; no UI reads them. |
| Schema drift on staging | ops | `account_deletion_audit` + `delete_user_account` exist in no migration. Reconcile before promoting to prod. |

---

---

## 2.1 PRD source tables (transcribed — the PRD itself is not in this repo)

> Added 2026-09-03. A prior session had to **guess** the PQL table because the plan referenced
> "the PRD's 9-signal scoring table" while the PRD lived only as a PDF outside the repo. The guess
> was materially wrong. These transcriptions exist so that cannot happen again.
>
> Source: *DatIQ — Persona Specific Templates & Shareable Reports*, §PQL Rules for DatIQ and
> §Recommended Activation Definitions. `src/lib/pql/pqlModel.js` implements them, and
> `pqlModel.test.js` asserts the transcription so code and PRD cannot drift.

### PQL signal table

⚠️ **Sums to 130, not 100. The threshold is 50 RAW POINTS, not 50%.** Normalising to a percentage
re-scales the threshold to 65/130 — materially stricter than the PRD asks.

| Signal | Points | Measurable today? |
|---|---|---|
| Used a persona template | +10 | ✅ |
| Completed two or more meaningful extractions | +10 | ✅ |
| Created a shareable report | +10 | ✅ |
| Connected HubSpot, Slack, Notion, Airtable, or Zapier | +20 | ✅ |
| Created a recurring monitor | +20 | ✅ |
| Imported/enriched 10+ companies | +20 | ❌ needs Phase 4 |
| Invited a teammate | +15 | ✅ |
| Visited pricing page twice within seven days | +10 | ✅ |
| Company is in ICP: B2B SaaS / relevant size / target geography | +15 | ❌ firmographic data we do not hold |

**PQL threshold: 50 points.** Above it, the PRD calls for a *founder* email offering help with the
user's exact observed workflow — explicitly not a generic sales email.

⚠️ 35 of 130 points are unmeasurable today, so the exclude-and-redistribute rule in `pqlModel.js`
is load-bearing immediately: scoring them 0 would cap every user at 95/130 and then produce a
phantom company-wide PQL surge on the day Phase 4 ships.

### Activation definitions

> PRD: *"Do not use 'a user extracted one URL' as activation. That creates a misleading vanity
> metric."* Every definition is compound.

| Persona | Activated when | Why it matters |
|---|---|---|
| Sales / SDR | Runs an Account Brief template, exports/routes it, and saves or monitors the account | They have produced actionable sales intelligence |
| RevOps | Uploads/imports at least 10 accounts, enriches them, and sends results to CRM/Sheet/Airtable | They have established a pipeline workflow |
| Product / PMM | Adds at least 3 competitors, monitors relevant pages, and shares/receives first digest | They have created a recurring intelligence loop |
| SEO / Content | Runs an audit and exports a content/optimization brief | They have created a production asset |
| VC / Analyst | Generates and shares/saves a company due-diligence brief | They have replaced a manual research task |
| Agency | Runs a client-branded report and connects an export destination | They can monetize it with clients |

⚠️ **The PRD defines SIX groups; the app ships SEVEN personas.** `recruiter` has no PRD equivalent —
the PRD's persona table does not cover recruiting. It is mapped to the closest DEFINED behaviour
(`vc-analyst`) in `PERSONA_TO_ACTIVATION`, flagged rather than given an invented definition.

### Watchlist signal types (PRD §4) — for Phase 5

| Signal type | Example detection | Business interpretation |
|---|---|---|
| Pricing | Price, plan, billing period, feature entitlement changed | Packaging, discounting, upmarket/downmarket move |
| Product | New product/module/integration/changelog item | Competitive gap or positioning response |
| Positioning | Homepage headline, ideal customer, vertical messaging changed | Target-segment shift |
| Customer proof | New case study, logo, industry, quantified outcome | Segment traction and sales-battlecard evidence |
| Hiring | New role family, leadership vacancy, geography | Growth, expansion, product investment, GTM push |
| Partnerships | New technology or channel partner | Ecosystem strategy change |
| Security / compliance | SOC 2, ISO, DPA, policy, terms-page update | Enterprise-readiness or vendor-risk indicator |

> Decision **D4** ships the first three (pricing, product, positioning) in Phase 5; the remaining
> four are additive config in Phase 5b, not new architecture.
>
> 🔴 PRD: *"Do not alert on every DOM change. Alert only when a **normalized business field**
> changes. Then explain why that change may matter."*

### Signal-routing condition/action pairs (PRD §5) — for Phase 6

| Condition | Action |
|---|---|
| A monitored competitor changes a pricing field | Notify selected Slack channel and add a Notion battlecard update |
| Account ICP score is 80+ | Create/update HubSpot company and assign an owner |
| DatIQ identifies a leadership/contact candidate | Add to Airtable review table with confidence/source |
| A target account creates an enterprise sales job role | Add a "growth signal" property to HubSpot and notify SDR |
| Domain score drops due to a changed criterion | Add it to a requalification queue |
| SEO/GEO/AEO audit score is below threshold | Create an audit report and send it to the content owner |
| A new customer case study is published | Add evidence to a competitor proof repository |


## 2. Phased build plan

Migrations are numbered from `0036` (current head is `0035`). Every phase ends green on
`npm run test:prepush` and merges to `staging` only — `main` stays a separate, deliberate call.

### Phase 0 — Spine (no user-visible feature) — ✅ DONE
*Everything after this is cheaper. Nothing after this is safe without it.*

| Item | Detail |
|---|---|
| `0036_workflow_templates.sql` | `workflow_templates` (versioned), `template_runs`, `template_run_sources` |
| `0037_credit_ledger.sql` | `credit_ledger` (append-only), `credit_estimates` |
| `0038_field_provenance.sql` | `extracted_fields`, `field_provenance` — field-level: source URL, method, version, confidence, and `observed \| inferred \| ai_generated` |
| `src/lib/templates/templateModel.js` | PURE. Schema validation, version resolution, credit costing. Shared client↔server |
| `src/lib/credits/creditModel.js` | PURE. Estimate vs. actual; extends `creditEstimator.js` rather than replacing it |
| `provenanceService.js` v2 | Adds method/version + the observed/inferred/generated distinction |
| `workflowEnqueue.js` | `KIND_WHITELIST` 5 → 15 |

**Est. 2–3 sessions.** Highest test density (pure modules, cheap to test exhaustively).

### Phase 1 — PRD 1: Workflow Templates & Guided Onboarding — ✅ DONE
| Item | Detail |
|---|---|
| Seed 6 templates | Account Brief · Bulk ICP Enrichment · Competitor Pricing Tracker · SEO/GEO/AEO Audit · Pre-Meeting Due Diligence · Customer Proof Extractor. **Six only** — the PRD explicitly warns against 30 templates before observing adoption |
| `netlify/functions/templates.js` | List / get / run / duplicate. Entitlement-gated |
| `src/pages/Templates.jsx` + `TemplateRunner.jsx` | Persona-filtered gallery → input form driven by `input_schema` → run → output rendered from `output_schema` |
| `Onboarding.jsx` | Persona → recommended templates. Maps existing 7 personas onto the PRD's 6 |
| Entitlements | New `template.run`, `template.duplicate` capabilities |
| Reuse | `creditEstimator.js`, `outcomeTiles.js`, `onboardingTour.js` (already a multi-tour registry) |

**Acceptance gate:** a new user completes a first meaningful workflow in **under five minutes with
zero prompt authoring**, and every output carries source URLs + an extraction timestamp.

**Est. 3–4 sessions.**

### Phase 2 — PRD 2: Shareable Intelligence Reports — ✅ DONE
| Item | Detail |
|---|---|
| `0039_report_access.sql` | `reports` (supersedes `public_reports`, with migration), `report_grants`, `report_access_log`. Visibility state machine per §2.2a |
| Publish / unpublish mechanism | The §2.2a state machine — this is D3 |
| RLS rework | Drop `public read`; all reads via `public-reports.js` with the service key (§1.9) |
| `src/pages/Report.jsx` | Renders from a `template_runs` row. Sections driven by template type |
| Branding | Free tier: DatIQ attribution enforced **server-side**; paid: brand kit via existing `exportBranding.js`. The attribution line must not be suppressible by any Brand Kit field — same rule already enforced in `exportBranding.js` |
| "Duplicate / run on another company" CTA | The PRD's core acquisition loop |
| `noindex` | Private share pages added to the private-prefix invariant — **all four places** (`PRIVATE_PREFIXES`, the `X-Robots-Tag` rule, `robots.txt`, `index.html`'s inline guard). `page-ownership.test.mjs` asserts this |
| Analytics | `report.shared`, `report.viewed`, report→signup conversion |

**Est. 2–3 sessions** (lower than it looks — the renderer, PDF, email, and brand kit all exist).

#### 2.2a Report visibility state machine (resolves **D3**)

A report is **created private**. It becomes reachable only through an explicit, user-initiated
publish. Five states, one transition function, all transitions logged to `report_access_log`.

| State | Who can read | Slug exists | Indexable | In `/gallery` |
|---|---|---|---|---|
| `private` *(default on create)* | Owner + workspace members with access | **No** | — | No |
| `link` | Anyone holding the URL | Yes | **No** (`noindex`) | No |
| `org` | Any member of the owning workspace | Yes | No | No |
| `named` | Only listed collaborators (`report_grants`) | Yes | No | No |
| `public` | Anyone | Yes | **Yes** | Eligible (subject to admin curation) |

**Transitions** — `src/lib/reports/visibilityModel.js`, PURE, shared client↔server:

```
private ──publish(link|org|named|public)──▶ shared state   [mints slug on FIRST publish only]
shared  ──unpublish()──────────────────────▶ private        [slug retained, resolve refuses]
shared  ──change(state)────────────────────▶ shared state   [no slug change]
shared  ──revoke()─────────────────────────▶ revoked        [terminal; slug burned, never reissued]
any     ──expires_at passes────────────────▶ expired        [resolve refuses; owner may re-publish]
```

Rules that make this safe, each a direct consequence of a PRD requirement or an existing repo rule:

1. **A slug is minted at first publish, never at report creation.** A private report has no URL to
   leak, so there is nothing to guess at.
2. **Revocation is immediate and terminal.** `public-reports.js` resolves visibility **per request**
   with the service key (§1.9) — so the report body must never be edge-cached, and a revoked slug is
   burned permanently rather than returned to the pool. The PRD's *“revoking a link blocks access
   immediately”* is unachievable with a cached body.
3. **`unpublish` ≠ `revoke`.** Unpublish is reversible and keeps the slug (a re-shared link still
   works, which is what users expect when they briefly hide a report). Revoke is the panic button.
   Exposing only one of these would force users to pick between convenience and safety.
4. **`public` is the only indexable state**, and the only one eligible for `/gallery`. Every other
   shared state carries `noindex` — asserted in all four places by `page-ownership.test.mjs`.
5. **Free-tier attribution is enforced server-side at render**, not at publish, so a plan downgrade
   cannot leave an unbranded page live.

**Migration of existing `public_reports` rows → `link`, not `private`.** Every existing row exists
*because a user pressed Share* — that is the “option to make it public” already having been exercised.
Migrating them to `private` would silently break links already sent to third parties. They land on
`link` (reachable, unlisted, `noindex`); the `curated = true` subset that is already surfaced in
`/gallery` lands on `public`, preserving the gallery exactly as it stands.

### Phase 3 — Activation instrumentation + integration recipe gallery — ⬜ PENDING (next)
*Small, cheap, and the PRD is right that it must land before scaling acquisition.*

| Item | Detail |
|---|---|
| `0040_pql.sql` | `pql_scores`, `activation_events` |
| `src/lib/pql/pqlModel.js` | PURE. The PRD's 9-signal scoring table; threshold 50 |
| Analytics events | ~15 new kinds (`analytics_events` currently tracks 4) |
| Per-persona activation definitions | Per the PRD's table — *not* "extracted one URL" |
| Integration recipe gallery | Turns the five existing integrations from a checkbox into an outcome. Almost pure UI |
| Founder dashboard | Extend `/admin/revenue` with the funnel |

**Est. 1–2 sessions.**

### Phase 4 — PRD 3: Bulk Account Intelligence — ⬜ PENDING ⚠️ *heaviest*
| Item | Detail |
|---|---|
| `0041_bulk_enrichment.sql` | `lists`, `list_records`, `canonical_entities`, `enrichment_jobs`, `enrichment_job_items`, `icp_score_rules`, `review_queue` (7 tables) |
| Durable runner | `enrichment-worker.js` on the chunked-budget pattern (§1.3). Idempotent, resumable, per-domain error recording |
| Identity | Domain normalization + canonicalization + dedup (`urlIdentity.js` is a starting point) |
| **Import** — v1 (**D2**) | **CSV upload + paste only.** All five integrations are export-only today; each import is a distinct auth scope, pagination model, and failure mode. Sheets / Airtable / HubSpot import ships as **Phase 4b**, independently, off the critical path |
| ICP scoring (**D6**) | `icpModel.js`, PURE, on the §1.6 coverage rule, with per-account explanation. **Product-defined defaults, seeded per persona, and customer-editable** — `icp_score_rules` rows are editable in-app, with a *Reset to DatIQ defaults* escape hatch. A default set is a starting point, never a ceiling |
| ICP rule editor | Criteria + weights + thresholds, with a live “score this sample account” preview driven by the same pure `icpModel` the runtime uses |
| `src/pages/Lists.jsx` | Table, per-row status (incl. `needs review`), filters, saved views, re-run stale/failed only |
| Review queue | Human confirmation for low-confidence contacts |
| Credits | Estimate before confirm; actual after; hard cap enforcement |

**Est. 5–6 sessions** (was 5–7: **−1.5** for CSV-only import per D2, **+1** for the editable ICP rule
editor per D6). Still the heaviest phase; the durable runner now dominates it alone.

**Phase 4b — import connectors (Sheets / Airtable / HubSpot): +1.5 sessions**, schedulable any time
after Phase 4 and safe to defer indefinitely.

### Phase 5 — PRD 4: Competitor Watchlists & Change Intelligence — ⬜ PENDING
| Item | Detail |
|---|---|
| `0042_watchlists.sql` | `watchlists`, `watchlist_targets`, `monitored_pages`, `entity_snapshots`, `field_changes`, `change_feedback` |
| Page discovery | Domain → recommend pricing / product / customers / careers / security pages. Reuses `RELATED_PAGE_HINTS` from `extractionPresets.js` |
| Snapshot extraction — v1 (**D4**) | **3 signal types: pricing, product, positioning.** These are the three the PRD's own materiality table classes as `critical`/`high`, and the three a competitor watchlist is bought for. Customer proof, hiring, partnerships and security/compliance follow as **Phase 5b** — the schema is identical, so each is additive config, not new architecture |
| `materialityModel.js` | PURE (§1.5). Critical → immediate · High → daily · Medium → weekly · Low → store, no alert · Unknown → review queue |
| AI explanation | Fact and interpretation stored in **separate columns** |
| Digests | Weekly/monthly via the existing `workflow_events` → n8n → Resend/Slack path |
| Feedback | useful / not useful / mute field / sensitivity — feeding a measured **false-positive rate** |
| Scheduler | Watchlists ride the existing `scheduled-runner.js` (@hourly) with a new task kind |

⚠️ **Do not reuse the existing whole-page `hashContent` alert as the user-facing signal.** Keep it
strictly as the pre-filter (§1.4). Shipping "the page changed" as a competitor alert would train users
to ignore the feature within a week — the PRD is explicit that *alert precision matters more than
alert volume*.

**Est. 3–4 sessions** (was 4–5: **−1** for 3 signal types per D4).

**Phase 5b — remaining 4 signal types: +1 session**, additive.

### Phase 6 — PRD 5: Native Signal Routing — 🟡 PARTIAL (event model done)
| Item | Detail |
|---|---|
| `0043_signal_rules.sql` | `signal_rules`, `rule_executions` |
| `ruleModel.js` | PURE (§1.7). Conditions on field, score, change type, source, confidence, schedule |
| Rule builder UI | Deliberately **if-this-then-that**, not a visual workflow canvas (the PRD defers that, and it is the right call — a canvas is a product in itself) |
| Native actions | Slack, Resend email, webhook, HubSpot create/update/task. All four clients exist |
| Test-with-sample-payload | Same evaluator as runtime |
| History + retry | Reuses `workflow_runs`; surfaced to users, not just `/admin/automation` |
| Persona rule templates | Seeded from the PRD's condition/action table |

**Est. 3–4 sessions.** Cheapest of the five — the durable dispatch substrate is done.

### Phase 7 — Packaging, GTM surfaces, release collateral — 🟡 PARTIAL
| Item | Detail |
|---|---|
| Pricing (**D5** — confirmed) | PRD **Team → existing `business`**; PRD **Business → existing `agency`**. **No tier is renamed** — `pricingConfig.js`, `entitlementModel.js`, `PricingMatrix`, invoices, and live coupons all key on the current ids, so a rename would break redemption of coupons already issued |
| New units | Monitored URLs, automation runs, list rows, report branding |
| `/pricing` | New capability rows — the matrix derives from limits, but **plan-card feature strings are hand-written and will not auto-update** |
| Persona landing pages | Per-persona + per-template acquisition pages (the PRD's primary organic lever) |
| Docs / help / changelog / blog | Via the `production-readiness` skill |
| Screenshots, e2e journeys, prerender | Full release gate |

**Est. 2–3 sessions.**

---

## 3. Effort and timeline

**Unit:** one *session* = a focused block producing a reviewed, tested, merge-ready increment
(typically one migration + one pure model + its callers + its tests, all gates green). It is roughly a
half-day to a day of your calendar time including review.

| Phase | Sessions | Notes |
|---|---|---|
| 0 — Spine | ~~2–3~~ | ✅ **DONE** |
| 1 — Templates (PRD 1) | ~~3–4~~ | ✅ **DONE** |
| 2 — Reports (PRD 2) | ~~2–3~~ | ✅ **DONE** — includes the RLS fix |
| 3 — PQL + recipe gallery | 1–2 | |
| 4 — Bulk (PRD 3) | 5–6 | ⚠️ Heaviest. −1.5 (D2 CSV-only) · +1 (D6 ICP editor) |
| 5 — Watchlists (PRD 4) | 3–4 | −1 (D4 — 3 signal types) |
| 6 — Routing (PRD 5) | 3–4 | |
| 7 — Packaging + release | 2–3 | |
| **Total** | **20–28 sessions** | |
| **Delivered so far** | **Phases 0–2** | shipped to `staging` 2026-09-02 |
| **Remaining** | **~12–16 sessions** | Phases 3–7 |
| *Phase 4b — import connectors* | *+1.5* | *Optional, off critical path* |
| *Phase 5b — remaining 4 signals* | *+1* | *Optional, additive* |

### Calendar bands

| Your review cadence | Elapsed |
|---|---|
| Concentrated (2 sessions/day, same-day review) | **~2.5–3.5 weeks** |
| Steady (1 session/day) | **~4–6 weeks** |
| Part-time (3 sessions/week) | **~7–9 weeks** |

Optional Phases 4b + 5b add ~2.5 sessions whenever you want them.

### Against the PRD's own roadmap
- **"Now: 0–8 weeks"** = Phases 0–3 ≈ **8–12 sessions ≈ 1.5–3 weeks concentrated.** Comfortably
  inside the window, with slack.
- **"Next: 2–5 months"** = Phases 4–6 ≈ **11–14 sessions ≈ 2–3.5 weeks concentrated.** Substantially
  ahead of the PRD's own schedule.
- **"Later"** — correctly deferred; see §6.

### What dominates the estimate
1. **Phase 4's durable runner** (~2 sessions) — now the single largest item, since D2 moved the import
   connectors off the critical path. The correctness bar (idempotent, resumable, credit-accurate under
   partial failure) is high, and this repo has already been burned by a function timeout on exactly
   this shape.
2. **Phase 2's visibility state machine** (~1 session of the phase). Five states, immediate revocation,
   and a migration of live public links — small in code, unforgiving in review.
3. **The test/gate discipline itself.** 343 test files, ~4,500 tests, a pre-push gate, `db-verify`, a
   prerender gate, e2e, and the standing rule that every behavioural test must be **confirmed to fail
   against pre-fix code**. Call it **+25–30% on every phase** — it is already priced in above, and it
   is the reason this codebase can absorb a change of this size at all.

### What could compress it further
Two of the three original trims are **already taken** (D2 CSV-only import, D4 three signal types).
One remains:
- Deferring Phase 4's review queue and saved views to a fast-follow: **−1 session**.

**Realistic floor for all five PRDs at a shippable v1: ~19 sessions.**

---

## 4. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Bulk enrichment exceeds function limits | 504s; billed-but-failed jobs | §1.3 chunked budget; the audit row / credit ledger only charges on completed work |
| Watchlist alert noise | Users mute the feature; churn | §1.4/§1.5 pre-filter + deterministic materiality; measure FP rate from day one |
| Credit model confusion | Support load; trust loss | Ledger is truth; estimate before, actual after; never charge for a refused request (existing gate-order rule in `extract.js`) |
| Report privacy regression | Data exposure | Server-resolved visibility; `noindex` asserted in all four places by test |
| Third-party import APIs | Schedule slip | Ship CSV first; connectors as independent follow-ons |
| Scope creep into CRM / workflow platform | Loses the category | The PRD's Non-Goals are binding — see §6 |
| Plan-id renaming | Breaks live coupons, invoices, entitlements | Map new packaging onto existing ids; never rename |

---

## 5. Decisions — **resolved 2026-09-02**

| # | Decision | Resolution | Effort delta |
|---|---|---|---|
| **D1** | Durable job execution | **Chunked self-invocation** with a remaining-ms budget (§1.3a). No new platform surface | — |
| **D2** | Bulk import scope, v1 | **CSV upload + paste only.** Sheets / Airtable / HubSpot import becomes **Phase 4b**, off the critical path | **−1.5** |
| **D3** | Report visibility | **Private by default, with an explicit publish/unpublish mechanism** — full state machine in §2.2a | ~0 |
| **D4** | Watchlist signal breadth, v1 | **3 types: pricing, product, positioning.** Remaining 4 become **Phase 5b** | **−1** |
| **D5** | Plan packaging | PRD **Team → existing `business`**; PRD **Business → existing `agency`**. **No tier renamed** | — |
| **D6** | ICP scoring rules | **Product-defined defaults, seeded per persona, and customer-editable**, with *Reset to DatIQ defaults* | **+1** |

**Net: 22–31 → 20–28 sessions.**

### D1 addendum — the budget rule this inherits
The chunked worker must carry a hard remaining-ms budget and stop *before* the platform kills it,
exactly as `AUDIT_BUDGET_MS` does in `discoverability.js`. That constant exists because this repo
already shipped a 504 by composing per-call timeouts additively with no notion of the platform's own
limit — and, worse, **billed for the killed run**. The bulk runner must not repeat either half: it
stops on budget and re-enqueues, and the credit ledger records only completed items.

### D3 addendum — one sub-decision still open
The state machine in §2.2a is fully specified except for one line: **what happens to a slug on
`unpublish` → re-`publish`.** See §5.1 — it is a genuine security-vs-convenience trade-off with no
obviously correct answer, and it belongs to whoever owns the trust posture of the product.

### 5.1 Open sub-decision — slug reuse on re-publish

When a user unpublishes a report and later publishes it again, the transition function must either
reuse the original slug or mint a fresh one. Prepared location:

```js
// src/lib/reports/visibilityModel.js
//
// Called by publish() when a report that was previously shared is being
// shared again. `report.slug` holds the slug from the earlier publish.
//
// REUSE  → the link a colleague already has starts working again. Convenient,
//          and matches what a user means by "unhide". But it means an old link
//          can be silently re-armed without the holder ever being re-granted.
// FRESH  → every publish is a distinct grant; an old link is dead for good.
//          Safer and easier to reason about in an audit log, but it breaks
//          links that recipients reasonably believe are theirs.
//
// Note: `revoke()` is terminal and always burns the slug — this decision only
// governs the reversible unpublish→publish path.
function resolveSlugForRepublish(report) {
  // TODO
}
```

**Recommendation: REUSE, plus an explicit “Revoke and reissue link” action** in the UI — so unpublish
stays the reversible, low-stakes control users expect, and burning a link becomes a deliberate,
clearly-labelled act rather than a side effect. Confirm or override before Phase 2 starts.

---

## 6. Explicitly deferred (per the PRD's own Non-Goals — treat as binding)

Full CRM · general-purpose workflow automation · proprietary contact database · unrestricted
LinkedIn/X scraping · full legal/compliance management · knowledge graph / entity resolution ·
unmetered crawling · visual workflow builder · third-party enrichment waterfall · community/review
intelligence · full white-label multi-client operations.

Two of these deserve a specific note, because they will be tempting:
- **Knowledge graph / entity resolution** — the PRD ranks it 15/16. `canonical_entities` in Phase 4 is
  deliberately a *dedup key*, not the start of a graph. Do not let it become one.
- **Visual workflow builder** — PRD 5 ships if-this-then-that on purpose. A canvas is a product, not a
  feature, and it is not what makes anyone buy DatIQ.

---

## 6a. CI: why the Staging Gate kept going red, and what changed

Measured 2026-09-02 across the last 25 Staging Gate runs: **5 failed, and 4 of
those 5 failed on the same step — `End-to-end smoke tests (Playwright)`.**

Every one had passed the pre-push hook first, because `test-all.mjs --prepush`
deliberately skips the e2e suite. So the most common route to a red gate was:
change a UI file → nine local gates green in ~30s → push → find out ten minutes
later in CI. Phase 1's own nav change did exactly this.

**Fixed** in `scripts/pre-push.sh`: the e2e smoke suite now runs in the hook,
**conditionally** on the diff touching the same source set the prerender gate
already watches (`src/{pages,components,styles,lib,hooks}`, `index.html`,
`site-routes.mjs`) plus `e2e/` itself.

- Matched to the prerender gate rather than narrowed to pages/components,
  because if a change can make a prerendered page stale it can break a
  rendered-structure contract — `pricingConfig.js` → `PricingMatrix` →
  `pricing.spec.js` is a real path with no component file in it.
- **Conditionality is the design.** A gate that adds ~90s to *every* push gets
  `--no-verify`'d, and this repo has an incident about that habit. Docs,
  `netlify/`, and migration-only pushes still finish in ~30s; a UI push takes
  ~112s.
- Escape hatch is explicit: `PREPUSH_SKIP_E2E=1`.
- `scripts/prepush-gate.test.mjs` guards it — including that it sits **outside**
  the docs-only early exit (the prerender gate once lived inside
  `PREPUSH_FORCE`, so a flag meant to run *more* checks silently switched it
  off) and that the installed hook has not drifted from source. Five of its
  assertions were confirmed to fail with the gate removed.

Verified live: a `src/pages` push ran all 131 smoke tests in the hook and
reported `all gates green in 112s`.

---

## 7. Suggested branch and merge strategy

- One long-lived branch: `feat/intelligence-workflows`, cut from `staging`.
- Merge to `staging` **per phase**, not per PRD — each phase is independently shippable and
  independently revertible.
- `main` stays a separate, deliberate promotion (this repo's standing rule).
- Every migration must run under `npm run test:db` (WASM Postgres) **and** be applied to the staging
  Supabase project before the phase merges. Note the standing caveat: PGlite has no GoTrue, no
  PostgREST, and shimmed roles — a green `test:db` is necessary, not sufficient.
- Both `AUTOMATION_JOBS` (`monitoringModel.js`) **and** `netlify.toml` must be edited for any new
  cron; `cron-registry-parity.test.js` asserts they agree.
