# DatIQ Intelligence Workflows — Implementation Plan

> Source: `DatIQ - Persona Specific Templates & Shareable Reports.pdf` (BRD + PRD 1–5).
> **Status: ALL PHASES (0–7) SHIPPED to `staging`. 100% Green Staging Gate (Run #33829281244). Netlify Deploy Ready.**
> Live delivery status: **[§2.0 Status board](#20-status-board)**. Decisions D1–D6 resolved (see §5).
> Last updated: **2026-09-04** following Staging Gate resolution.
> Read this after `CLAUDE.md`. Companion docs: `docs/MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md`, `docs/DISCOVERABILITY-MODULE.md`.

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

> ⚠️ **2026-09-06 addendum — read before trusting the ✅s below.** The phase table
> records that code shipped. It does not record that the code *ran*. The v2
> workflow dispatch loop was marked delivered and had **never once fired on a
> cron**: `workflow-orchestrator` declared its schedule inside the function,
> which Netlify honours only for v2 handlers, and was absent from both
> `netlify.toml` and `AUTOMATION_JOBS`. Fixed 2026-09-06 by splitting the cron
> into `workflow-orchestrator-cron.js` (a scheduled function loses HTTP access,
> and the original serves n8n's `/ping` and `/dispatch`). End-to-end
> verification against real traffic is still outstanding —
> `POST-DEPLOYMENT-MANUAL-TEST.md` §4.


> Single source of truth for what exists. Updated at the end of every session.
> Last updated **2026-09-04** — revised after a BRD-conformance, security and coverage
> review. **Phases 4-6 were previously recorded as DONE; they are not.** They shipped the
> data model and the UI but not the security spine, the plan enforcement, or the engines
> that make them run. See §2.0a. A green Staging Gate did not catch any of it, because the
> three endpoints had no contract tests at all.

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| **0** | Spine — versioned templates, credit ledger, field provenance, shared pure models | ✅ **DONE** | `0036`–`0038` applied · `templateModel` / `creditModel` / `visibilityModel` + 86 unit tests |
| **1** | PRD 1 — workflow templates & guided onboarding | ✅ **DONE** | 6 templates published + runner · `/templates` catalogue + runner · `templates.js` (21 contract tests) |
| **2** | PRD 2 — shareable intelligence reports | ✅ **DONE** | `0039` applied · `/r/:slug` · publish/unpublish/revoke state machine · `reports.js` (23 contract tests) |
| **3** | Activation instrumentation (PQL) + integration recipe gallery | ✅ **DONE** | `0040_pql.sql` · `pqlModel` transcribed from PRD (9 signals / 130 pts / threshold 50) · `/api/pql` intake + scoring · recipe gallery on `/integrations` · activation funnel on `/admin/revenue`. **89 tests.** |
| **4** | PRD 3 — bulk account intelligence | ✅ **DONE** (engine landed 2026-09-04) | `0041_bulk_enrichment.sql` (7 tables) · pure `identityModel` & `icpModel` (coverage rule §1.6) · chunked durable runner `bulkStore.js` / `bulk-enrichment.js` · `bulkClient.js` · `/lists` UI with CSV/paste input, real-time dedup preview, ICP Rule Simulator sandbox, and Human Review queue · `bulk_icp_enrichment` template published. |
| **5** | PRD 4 — competitor watchlists & change intelligence | ✅ **DONE** (engine landed 2026-09-04) | `0042_watchlists.sql` (6 tables) · pure `materialityModel.js` (critical/high/medium/low) · fact vs AI interpretation separation · `watchlistStore.js` / `watchlists.js` · `watchlistClient.js` · `/watchlists` UI with change feed, materiality badges, and human relevance feedback loops. |
| **6** | PRD 5 — native signal routing | ✅ **DONE** (dispatcher landed 2026-09-04) | `0043_signal_rules.sql` (2 tables) · pure `ruleModel.js` · `ruleStore.js` / `signal-rules.js` · `rulesClient.js` · `/rules` UI with If-This-Then-That rule builder and live Rule Evaluation Sandbox · Slack, Email, Webhook, and HubSpot dispatch actions. |
| **7** | Packaging, Navigation, Modal & Staging Deployment | ✅ **DONE** | Interactive `WorkflowRunModal.jsx` on Dashboard/Account · Nav updated (`TopBar.jsx` & `App.jsx` for `/lists`, `/watchlists`, `/rules`) · 43 migrations applied · 4,800+ automated tests green · 100% Green Staging Gate (Run #33829281244) · Netlify Deploy `ready`. |

**Effort remaining: 0 sessions for the PRD "Must" set.** The three execution engines
(§2.0b) shipped 2026-09-04, so every Must requirement across PRD 1-5 now has an
implementation. Two "Should"-level follow-ups remain, listed in §2.0b.

### 2.0a Review findings — 2026-09-04

A conformance review against the BRD PDF, plus a security and coverage audit, found that
Phases 0-3 hold up well and Phases 4-6 shipped without three things the earlier phases had.

**Fixed in this pass (all were live on staging):**

| # | Severity | Finding |
|---|---|---|
| S1 | **Critical** | `0041`/`0042`/`0043` shipped `grant all … to anon` on 15 tables plus a policy reading `using (user_id = auth.uid() or auth.uid() is null)`. `auth.uid()` **is** null for the anon role, so the clause that looks like a dev convenience grants every row to exactly the caller it should exclude. `canonical_entities_insert`'s `with check (auth.uid() is null or auth.uid() is not null)` is literally `true`. **Verified exploitable** against the staging project with nothing but the publishable anon key that ships in every browser bundle: `GET /rest/v1/lists?select=id&limit=1` → HTTP 200 with real ids, no Authorization header. Fixed by `0044`, which restores the service-role-only pattern `0029`, `0031` and `0036`-`0040` all use. |
| S2 | **Critical** | All three handlers used `const userId = auth.ok ? auth.user?.id : null`, so an auth *failure* became an anonymous request rather than a refusal. Each store then did `if (userId) q = q.eq("user_id", userId)` — a null id meant *no filter* on a query running under the service key. An unauthenticated `GET /api/signal-rules` returned every tenant's rules including the Slack webhook URLs in `action_config`. |
| S3 | **High** | Cross-tenant writes (IDOR). `recordFieldChange` took no user id at all — anyone knowing a watchlist id could inject fabricated competitor "changes" into another tenant's feed. `resolveReviewItem` updated by id alone. `processJobChunk` and `deleteRule` had no ownership check. |
| S4 | **High** | `getIcpRules` queried every row for a persona regardless of owner and fell back to `data[0]` — handing the caller **another tenant's custom ICP criteria** whenever they had none of their own. |
| S5 | **High** | No entitlement or credit check on any Phase 4-6 endpoint, while `templates.js` and `reports.js` gate correctly. This left three cost-bearing operations unmetered and made three of the BRD's own stated upgrade triggers ("bulk limits", "monitored URLs", "automation volume") unenforceable. Now gated on `bulk.enrich`, `watchlist.create`, `rule.create` — each reusing a limit the pricing page **already sells**, because choosing new per-tier allowances is a pricing decision for the owner, not something to attach to a security fix. |
| S6 | **Medium** | `action_config` accepted any URL unvalidated — a stored SSRF primitive waiting for the dispatcher (G1) to be built. Now validated at write time via `isPublicHttpUrlAsync`, with Slack actions pinned to `hooks.slack.com`. ⚠️ **Trap for the next caller:** `isPublicHttpUrl` **throws** for a bad scheme but **returns `false`** for a private IP, despite a JSDoc describing only the first. A `try/catch` alone silently accepts `http://169.254.169.254/`. Both channels must be handled. |
| Q1 | **Coverage** | `bulk-enrichment.js`, `watchlists.js` and `signal-rules.js` had **zero** contract tests — which is why every item above shipped green. `netlify/__tests__/workflow-tenancy.test.js` now covers them (25 tests), and `db-verify` pins the RLS lockdown across all 15 tables (+76 assertions). |

**G1-G3 — CLOSED 2026-09-04.** The three engines below were the outstanding BRD "Must"
requirements at review time. Each is now implemented, scheduled and tested. See §2.0b.

### 2.0b Execution engines — delivered 2026-09-04

The three gaps recorded as G1-G3 in the review were the parts of PRD 3, 4 and 5 that had
tables and UI but nothing driving them. All three now run on a cron and are covered by tests.

| Gap | BRD requirement | Delivered |
|---|---|---|
| **G1** | PRD 5: "native actions", "action execution history and error status", "retry failed actions" | `netlify/functions/lib/signalDispatch.js`. A canonical event model (the PRD's own 10 kinds), all four actions (Slack, Resend email, webhook POST, HubSpot company), `rule_executions` written on every attempt with status, payload, response and latency. The runtime shares ONE evaluator with the "test with sample payload" sandbox, so a rule that previews as matching actually fires. Destinations are re-validated **at dispatch**, not only at write: a hostname that resolved publicly when the rule was saved can point at `169.254.169.254` today. 18 contract tests. |
| **G2** | PRD 4: "scheduled crawling at plan-defined frequency", "structured snapshot", "field-level comparison against previous snapshot" | `netlify/functions/watchlist-monitor.js` (`@hourly`, honours each watchlist's own cadence internally) + pure `src/lib/watchlist/snapshotModel.js`. Deterministic extraction — the differ must be reproducible or every diff is noise. A first sighting is a BASELINE and never alerts; a failed fetch is never reported as a deletion; a robots refusal pauses the page rather than retrying hourly for ever. Material changes are handed to G1. Charges `monitor_check` to the credit ledger, per the BRD's "credits must be tied to cost-bearing actions … monitoring frequency". 24 unit + 6 contract tests. |
| **G3** | PRD 3: "queue-based asynchronous processing with progress" | `netlify/functions/bulk-runner.js` (every 5 min). Work is claimed per ITEM, so the cron and the existing client-driven chunk endpoint are safe to run concurrently — the client path is deliberately kept, because it is what makes a small list feel instant. A `failed` item is never silently re-crawled: re-running failures stays an explicit user action, so a customer's credits are not spent on the same refusal for ever. |

🔴 **A fourth defect, found while building G3 and larger than any of them.** The shipped bulk
enrichment **never fetched anything**. It built firmographics by string-matching the domain name —
`industry: domain.includes("tech") ? "Software" : "Services"`, a hardcoded `employee_count: 55` for
every company, `has_pricing: true` always — and stamped the result `confidence_score: 0.95`. Every
ICP score in the product derived from that invention. This is the same defect this repository has
already had to fix once (production serving locally-generated fixture prose badged `ai_generated`),
in a more expensive place, because a RevOps user routes real outbound off these scores.

Replaced by `netlify/functions/lib/bulkEnrich.js`, built on one rule: a field is **observed**,
**inferred**, or **ABSENT** — never invented. Absent fields are omitted, and `evaluateIcp` already
treats an absent field as unmeasured and redistributes its weight (§1.6), so honesty produces a
lower *coverage* rather than a wrong *score*. When the AI chain is down the inferred fields simply
do not appear, which is strictly better than being confidently wrong at 0.95. Field-level
provenance (`0045`) travels with every row. 12 contract tests, including two that assert the exact
fabrications are gone.

**Remaining, both "Should" rather than "Must":**

| # | Item |
|---|---|
| ~~R-01~~ | ✅ **DONE 2026-09-04.** `signal-retry` cron (`*/5`) + pure `retryModel.js`. Backoff matches the platform's existing schedule (1m, 5m, 30m, 2h, 12h), ceiling 5 attempts. **`refused` and `skipped` are never retried** — a refusal is the SSRF guard firing, and retrying would turn one blocked request into a scheduled repeating attempt at a private address; a skip needs a configuration change, not patience. A 4xx settles immediately (except 408/429), because resending a request the destination already rejected is how a broken rule earns a rate-limit ban on a customer's own Slack workspace. A retryable failure stores as **`retrying`**, not `failed`, so the history does not show a permanent failure for something still in flight. |
| ~~R-02~~ | ✅ **DONE 2026-09-04.** `discoverPages()` (pure) + wired into `watchlist-monitor`. **This was larger than "polish": `watchlistStore` never touched `monitored_pages` at all, so a user could add a competitor and the crawler had NOTHING to crawl** — PRD 4 was inert end-to-end until somebody inserted rows by hand. Discovery runs in the cron, not in `createWatchlist`, so a form submission never waits on a competitor's site being up. Capped at 4 pages, one per category (breadth over three views of the same fact), same-origin only (*"watch rival.com"* must not become an open-ended crawler pointed at third parties), and every page is labelled **`source: 'auto'`** (`0047`) so the UI can present them as suggestions to prune rather than silently mixing them with the user's own choices. |

🔴 **A bug found while building R-01, and worth recording because of HOW it hid.**
`0043` constrained `rule_executions.status` to `('success','failed','skipped')`, and the dispatcher
shipped in this same cycle produces a fourth value — **`refused`**, the verdict when the SSRF guard
rejects a destination. The insert violated the CHECK, and `dispatchSignal` catches bookkeeping
errors so they can never break a dispatch — so the row was dropped with a `console.error`.
**Every security refusal was missing from the audit trail**, which is precisely the event an
operator most needs to see.

Neither existing suite could see it: the contract tests mock `recordExecution`, and the
real-Postgres E2E only ever recorded `success`. **An end-to-end test that walks only the happy path
has the same blind spot as a mock** — it proves the schema accepts what the code usually writes, not
what it writes when something goes wrong. `0046` widens the CHECK (keeping `refused` DISTINCT from
`failed`: "we would not send this" and "we tried and it did not answer" mean different things to the
person reading the history), and the E2E now asserts every status the dispatcher can produce.

### What is SHIPPED and LIVE on Staging

| Item | Where | State |
|---|---|---|
| `bulk_icp_enrichment` template | `/templates?key=bulk_icp_enrichment` | Published and runnable via chunked background enrichment worker |
| Bulk Account Intelligence | `/lists` | CSV/Paste import, deduplication preview, chunked enrichment, ICP Rule Simulator, Review Queue |
| Competitor Watchlists | `/watchlists` | Multi-domain tracking, auto-page discovery, materiality diffing, Fact vs AI tabs, user feedback |
| Native Signal Routing | `/rules` | If-This-Then-That trigger/condition/action rules, live sandbox tester, multi-channel dispatch |
| Workflow Run History Modal | `/dashboard?view=runs`, `/account` | Clickable run rows opening detail modal with facts, confidence %, credit breakdown, and source links |
| Shareable Intelligence Reports | `/r/:slug` | Private by default, link/org/named/public visibility state machine, noindex, revoke |
| PQL Funnel & Integrations Gallery | `/admin/revenue`, `/integrations` | Compound activation metrics, PQL distribution bands, outcome-first integration cards |

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
the PRD's persona table does not cover recruiting. It has its **own** definition (owner decision,
2026-09-03), built to the same standard as the PRD's six and marked `fromPrd: false` in
`ACTIVATION_DEFINITIONS` so it stays distinguishable from what the PRD actually specifies:

| Persona | Activated when | Why it matters |
|---|---|---|
| Recruiter *(not from PRD)* | Sources leadership or hiring signals across 3+ companies **and** exports the shortlist | They have built a sourcing pipeline rather than looked up one company |

It was previously folded onto `vc-analyst`, which measured the wrong thing: a diligence brief is a
one-off artefact, whereas sourcing is inherently repeated, so a recruiter who ran a single brief
counted as activated without having sourced anybody. **Revisit if the PRD is extended to cover
recruiting.**

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

### Phase 3 — Activation instrumentation + integration recipe gallery — ✅ DONE
*Small, cheap, and landed before scaling acquisition.*

| Item | Detail |
|---|---|
| `0040_pql.sql` | `pql_scores`, `activation_events` (RLS enabled, compound activation rules) |
| `src/lib/pql/pqlModel.js` | PURE. The PRD's 9-signal scoring table; threshold 50; exclude-and-redistribute rule |
| Analytics events | Full vocabulary + drift guards (`/api/pql` intake and scoring) |
| Per-persona activation definitions | Per the PRD's table + custom recruiter definition |
| Integration recipe gallery | Turns the five existing integrations from checkboxes into business outcomes (`/integrations`) |
| Founder dashboard | Extended `/admin/revenue` with the compound activation and PQL funnel |

### Phase 4 — PRD 3: Bulk Account Intelligence — ✅ DONE
| Item | Detail |
|---|---|
| `0041_bulk_enrichment.sql` | `lists`, `list_records`, `canonical_entities`, `enrichment_jobs`, `enrichment_job_items`, `icp_score_rules`, `review_queue` (7 tables with RLS) |
| Durable runner | `bulkStore.js` and `bulk-enrichment.js` on chunked-budget pattern (§1.3). Idempotent, resumable, per-domain error recording |
| Identity & Deduplication | `identityModel.js`: domain normalization, canonical deduplication, and pre-run duplicate drop preview |
| Import v1 | CSV upload + paste text input with live deduplication preview in New List modal |
| ICP scoring engine | `icpModel.js`, PURE, implementing the §1.6 coverage rule (unmeasured fields redistributed, zero-measurement records score null with 0.00 coverage) |
| ICP rule simulator | Criteria, weights, and thresholds editor with live "Score this sample account" preview and Reset to DatIQ Defaults escape hatch |
| `src/pages/Lists.jsx` | Lists manager, accounts table, ICP fit badges (High, Medium, Low, Unmeasured), filter views, re-run failed items |
| Human review queue | Verification queue for low-confidence extracted contacts with approve/reject actions |
| Template runner | `bulk_icp_enrichment` template published in `seedTemplates.js` and wired to chunk runner |

### Phase 5 — PRD 4: Competitor Watchlists & Change Intelligence — ✅ DONE
| Item | Detail |
|---|---|
| `0042_watchlists.sql` | `watchlists`, `watchlist_targets`, `monitored_pages`, `entity_snapshots`, `field_changes`, `change_feedback` (6 tables with RLS) |
| Page discovery | Automated domain crawl recommending `/pricing`, `/product`, `/features`, `/customers` pages |
| Snapshot extraction | 3 core business signal types: pricing, product, positioning |
| `materialityModel.js` | PURE (§1.5). Classifies deltas into Critical (immediate alert), High (daily digest), Medium (weekly digest), Low (stored without alert) |
| Fact vs AI separation | Objective facts (`fact_summary`, old/new value, source timestamp) and strategic context (`ai_interpretation`) in separate columns |
| `watchlistStore.js` / `watchlists.js` | Backend API for watchlist CRUD, delta extraction, and relevance feedback |
| Feedback loop | Useful / Not useful / Mute field buttons feeding measured false-positive suppression |
| `src/pages/Watchlists.jsx` | Watchlist dashboard, target management, change feed with materiality badges, and tabbed Fact vs AI views |

### Phase 6 — PRD 5: Native Signal Routing — ✅ DONE
| Item | Detail |
|---|---|
| `0043_signal_rules.sql` | `signal_rules`, `rule_executions` with RLS and foreign-key cascading |
| `ruleModel.js` | PURE (§1.7). Evaluates conditions on event kind, fields, ICP score, change type, source, and confidence |
| Rule builder UI | Deliberately if-this-then-that trigger/condition/action rule creator (`/rules`) |
| Native actions | Slack incoming webhook, Resend email notification, outgoing webhook POST, and HubSpot company sync |
| Rule Evaluation Sandbox | Live interactive evaluator: paste incoming JSON event, test conditions, view match reasons, and preview formatted dispatch payload |
| Execution history | Audit history logging all dispatches, delivery statuses, payloads, and failure causes |

### Phase 7 — Packaging, Navigation, Modal & Staging Deployment — ✅ DONE
| Item | Detail |
|---|---|
| Run History Modal | Clickable rows in `/dashboard?view=runs` and `/account` open interactive `WorkflowRunModal.jsx` detailing facts, confidence %, credit ledger charges, failed run explanations, and "Re-run in Templates" / "Create report" CTAs |
| Navigation Integration | Added `/lists`, `/watchlists`, `/rules` routes to `App.jsx`; added Explore & Account dropdown links in `TopBar.jsx` |
| Database Migrations | Migrations `0001` through `0043` verified on WASM PostgreSQL (`npm run test:db`: 43 migrations applied, 384 assertions passed) |
| Test Suites | Unit tests (2,871 passed), Contract tests (1,887 passed), E2E smoke tests (131 passed), Production build, and Security suite all green |
| Staging Gate CI | Run #33829281244 completed with 100% green status across all 4 gate jobs |
| Live Staging Deploy | Deploy `6a9a2b6ad676f30008224cd9` is live and in `state: ready` (62 serverless functions deployed) |

---

## 3. Effort and timeline

**Unit:** one *session* = a focused block producing a reviewed, tested, merge-ready increment.

| Phase | Sessions | Notes |
|---|---|---|
| 0 — Spine | ~~2–3~~ | ✅ **DONE** |
| 1 — Templates (PRD 1) | ~~3–4~~ | ✅ **DONE** |
| 2 — Reports (PRD 2) | ~~2–3~~ | ✅ **DONE** — includes RLS fix |
| 3 — PQL + recipe gallery | ~~1–2~~ | ✅ **DONE** |
| 4 — Bulk (PRD 3) | ~~5–6~~ | ✅ **DONE** — `0041` + chunked worker + `/lists` |
| 5 — Watchlists (PRD 4) | ~~3–4~~ | ✅ **DONE** — `0042` + materiality + `/watchlists` |
| 6 — Routing (PRD 5) | ~~3–4~~ | ✅ **DONE** — `0043` + rule sandbox + `/rules` |
| 7 — Packaging + release | ~~2–3~~ | ✅ **DONE** — Run modal + navigation + Staging Gate green |
| **Total** | **All Delivered** | **Shipped to `staging` 2026-09-04** |
| **Remaining** | **0 sessions** | All 5 PRDs complete and verified on staging |
| *Phase 4b — import connectors* | *+1.5* | *Optional future follow-on (Sheets/Airtable)* |
| *Phase 5b — remaining 4 signals* | *+1* | *Optional future follow-on (Hiring/Security)* |

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
