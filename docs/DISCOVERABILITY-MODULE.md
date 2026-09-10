# Discoverability module — architecture and operating notes

> **Internal.** Never summarise into `public/help/` or any customer-facing surface.
> The external guide is `docs/DatIQ-User-Guide.md` §11; the public API contract is
> `docs/DatIQ-Developer-API.md`.

The SEO / AEO / GEO audit engine. Takes a URL, returns four pillar scores, three
framework views, a prioritised recommendation queue and copy-ready
implementation constructs.

---

## 1. The three rules

Everything below follows from these. Break one and the module stops being
trustworthy, which for a measurement product is the same as stopping working.

### 1.1 `unknown` is never `0`

A signal can be missing for two innocent reasons: it could not be **measured**
(PageSpeed rate-limited, no citation-sampling engine configured), or it does not
**apply** (a pricing page has no procedure, so no HowTo markup).

Either way it is **excluded** from its pillar and its weight is **redistributed**
across the signals that were measured. `weightedMean()` in
`src/lib/discoverability/scoringModel.js` is the one function that implements
this, and every score in the product flows through it.

Scoring a missing signal as 0 would subtract ~7.5 points from every audit during
a PageSpeed outage, then show a phantom "+7.5 improvement" when it recovered —
which makes the trend line, the entire point of the validation loop, a fiction.

Every score therefore carries `coverage`: the share of intended evidence
actually gathered. Coverage is **signal-level and framework-weighted**, so a
missing technical signal costs the tech-heavy SEO view more coverage than the
answer-heavy AEO view.

### 1.2 A profile is a lens, not different maths

All four framework views are ALWAYS computed with identical weightings. The
`audit_profile` only selects which one leads the report.

Re-weighting per profile would mean the same page scoring differently depending
on which profile it was run under, and a user who switched profiles between runs
would see a change in their trend that no change to their page caused.

There are **eight** profiles since W2. Four name a framework (`balanced`, `seo`,
`aeo`, `geo`); four name a **business model** (`saas`, `services`, `local`,
`ecommerce`) and then pick the framework that business is usually judged by. The
business-model four exist because *"which of SEO, AEO and GEO matters most to
me?"* is not a question a first-time visitor can answer and *"I sell software"*
is. **The rule binds them exactly as hard** — a page audited as `ecommerce` and
as `balanced` produces the same four numbers, and `auditPipeline.test.js` asserts
it for all four.

The profile is **settled, not supplied**, and the audit records why:

| `audit_profile_source` | Means |
|---|---|
| `explicit` | the caller named a profile |
| `goal` | derived from `primary_goal` |
| `inferred` | read from what the page declares (schema first, then page type) |
| `default` | nothing argued for a lens, so `balanced` |

`resolveAuditProfile()` in `intakeModel.js` is that ordering, and the ordering is
the definition of the column. A **stated goal outranks page inference**: the
customer told us their intent in words, while the schema is our reading of markup
they may not control and may be trying to fix.

It is settled **twice** in a run — once before the fetch, once after the parse.
The first pass is what an unreachable URL is reported under: a page that returned
no HTML gives inference nothing to read, and a profile guessed from a page nobody
saw would be a fabrication.

### 1.3 Constructs use placeholders, never inventions

Anything the audit could not observe is emitted as an explicit `TODO:`. A
generated Organization block with a hallucinated founder name is worse than no
block at all, because these are pasted into live sites and tend to be published
without being read.

`hasPlaceholders()` drives the "needs your details" badge in the UI.

---

## 2. Layout

```
src/lib/discoverability/          PURE. Imported by BOTH React and netlify/,
                                  exactly like entitlementModel.js — the score a
                                  user sees and the score the server stored are
                                  computed by the same lines.
  signalRegistry.js               20 signals, 4 pillars, weights summing to 1
  scoringModel.js                 pillar/framework maths, penalty layer, bands
  signalScorers.js                the individual curves
  issueCatalog.js                 44 issue codes → severity, owner, fix, penalty
  recommendationModel.js          priority formula, per-page lift, ranking
  constructTemplates.js           13 generators for ready-made assets
  auditProfiles.js                8 profiles (lenses) + 12 page-type rule packs
  intakeModel.js                  what was ASKED FOR — §2c. Audit types, goals,
                                  geography, competitors, profile resolution
  evidenceModel.js                the evidence envelope — §2b
  auditDiff.js                    two audits → deltas, with comparability
  auditReport.js                  markdown / CSV / JSON renderings
  auditUrl.js                     canonical target identity
  discoverabilityClient.js        browser → /api/discoverability/*

netlify/functions/lib/audit/      Server only.
  htmlParse.js                    hand-rolled parsing (no DOM in a function)
  fetchLayer.js                   raw + rendered fetch, robots, canonical
  answerAnalysis.js               ┐
  structureAnalysis.js            ├ the four pillar analysers
  entityAnalysis.js               │
  technicalAnalysis.js            ┘
  webVitals.js                    PageSpeed Insights adapter
  citationSampling.js             Perplexity | AI-chain, pluggable
  aiEvaluator.js                  optional LLM refinement, always degradable
  evidenceCollector.js            what an analyser records its workings into
  auditPipeline.js                the 7 stages
  auditStore.js                   Supabase persistence
  webhookDispatch.js              HMAC-signed delivery

netlify/functions/
  discoverability.js              the API router
  discoverability-monitor.js      @daily scheduled monitoring

supabase/migrations/0030_discoverability_audits.sql
supabase/migrations/0048_discoverability_evidence.sql
src/pages/Discoverability.jsx
src/components/discoverability/*.jsx
```

---

## 2b. The evidence contract

The BRD's sentence is unambiguous, and the whole product rests on it:

> Every signal and issue must retain evidence. Evidence includes **source URL,
> selector or extracted section, observed value, excerpt/structured object,
> collection timestamp and confidence.**

Every observation the engine makes is therefore a record built by
`makeEvidence()` in `evidenceModel.js`:

```
{ method, observed, source_url, selector, section,
  observed_value, excerpt, structured, collected_at, confidence }
```

**Four rules shape it.**

**1. No source, no evidence.** `makeEvidence` returns `null` for an unknown
method, a missing source URL or an unusable timestamp. It never fills in a
default. A record whose provenance was guessed is worse than an absent one:
absence shows in the UI as "not measured", while a fabricated source is
indistinguishable from a real observation and gets quoted back to the customer
as fact.

**2. Observation is not inference, and `method` is what says so.** Each method
declares `observed: true|false`, so the distinction is a property of how the
thing was learned rather than a flag a call site can forget to set. `derived`
and `model_inference` are the only two that are not observations, and they carry
the lowest default confidence. This is the BRD's *"separate observed facts from
model/LLM inference"* expressed as data — `EVIDENCE_METHODS` has a test that
forces a decision about which side of that line any new method falls on.

**3. Recording never fails an audit.** `makeEvidence` returns `null` for
anything it will not vouch for, and the collector drops nulls silently. A
missing `section` string must never be able to fail an audit the customer was
already charged for. The finding still stands; it is simply less well supported,
and `evidenceConfidence` reports that honestly.

**4. Confidence takes the STRONGEST record, not the mean.** Evidence
accumulates — a fact read straight from the HTTP response does not become less
certain because a model also had an opinion about it. It returns `null` for no
evidence rather than `0`, the same discipline the scorer applies to unmeasured
signals.

**One decorator, two paths.** `attachEvidenceToPillars()` is called by the
pipeline (from a live collector) *and* by `rehydrate()` (from stored rows), so a
fresh audit and one reopened from history carry identical shapes **by
construction**. That is the same reasoning §2's `scorePillar` note gives, and for
the same reason: the alternative is a bug that renders perfectly while you are
looking at it. `rehydrate.test.js` pins it.

**`raw_value` and `threshold_json` are stored AND derived.** The columns exist so
"twelve months of `core_web_vitals` raw values" is an index scan rather than a
JSON walk; they are written from the evidence records at persist time and
derived again from those same records on read. The two can therefore never
disagree.

**A threshold is usually NULL, and that is correct.** Most signals are curves —
conciseness declines either side of a 40-60 word band, heading integrity is a
proportion, render completeness is a ratio. Only signals with a genuine published
cut-off (Core Web Vitals, the ideal answer band) write a threshold. Inventing one
so the column looks populated would show a customer a number the scorer never
applied.

**`scoring_model_version` is NOT NULL with no default.** A default would let a
writer that forgets the stamp file a future v3 score as v1 — precisely the
mislabelling the version exists to prevent. `auditDiff` refuses to compare across
versions: a delta between two different models is a number nobody earned.

---

## 2c. The intake contract

Everything the customer said **before anything was fetched**. Migration 0049,
`src/lib/discoverability/intakeModel.js` (pure), echoed on the result as
`intake` and rebuilt identically by `rehydrate()`.

| Field | Column | Nullable | Why |
|---|---|---|---|
| Audit type | `audits.audit_type` | no, defaults `url` | Knowable retrospectively — every audit that already exists fetched one page |
| Primary goal | `audits.primary_goal` | **yes, and never defaulted** | see below |
| Target geography | `audits.target_geography` (jsonb) | yes | `NULL`, never `{}` |
| Competitor URLs | `audits.competitor_urls` (text[]) | no, defaults `{}` | recorded context only |
| Profile source | `audits.audit_profile_source` | no, defaults `default` | §1.2 |

### `primary_goal` is nullable on purpose and cannot be back-filled

Every other column in this module records something we **measured**, and a
measurement can be taken again by re-running the audit. This one records
something the **customer said**. If nobody was asked *"what are you trying to
achieve?"* at the moment the audit was commissioned, that answer does not exist
anywhere and no later migration can recover it.

A default here would be a **fabricated intent** — the same class of error as an
evidence record with a guessed source URL (§2b) — and the P2 brand, product,
service and local modules key off this field, so a guessed goal would propagate
into work nobody commissioned.

```
NULL      this audit predates the question, or it was not answered
NOT NULL  the customer said this
```

### `source` and `audit_type` answer different questions

They overlap on two values, which is what made them easy to conflate before W2.

| | Question | Values |
|---|---|---|
| `source` | who **asked** | `api` · `ui` · `schedule` · `benchmark` · `rerun` |
| `audit_type` | what **kind** of audit | `url` · `domain` · `benchmark` · `prompt_monitor` · `rerun` |

A scheduled run is `source = schedule`, `audit_type = rerun` — a monitor
re-audits a page it has audited before. Collapsing the two is why *"show me my
domain snapshots"* and *"show me everything the scheduler ran"* could not both be
answered.

### Two audit types are legal in the column and refused by the API

`domain` and `prompt_monitor` pass the CHECK constraint and are rejected by
`parseAuditOptions` with a "not available yet" error. The vocabulary is a stored
contract and widening a live CHECK later is a migration, a deploy, and a window
in which the API and the database disagree about what is legal — declaring the
full set now costs nothing.

What would cost something is a row **claiming to be a domain snapshot when one
page was fetched**. That claim is invisible: the row looks like a domain snapshot
in every list, export and trend it appears in. A rejected request is visible in
the moment; a mislabelled row is found a quarter later inside a trend line.

`benchmark` and `rerun` are legal but not caller-selectable — they are set by the
routes that create their context. A rerun with no baseline is a re-audit of
nothing.

### Intake reuse is what makes a re-audit answerable

*"Did my fix work"* is only answerable if the second run was commissioned exactly
like the first. `rerunRoute` inherits goal, geography, competitors, profile and
page-type hint from the baseline, and `audit_schedules` stores the same four so
every scheduled run replays them.

A rerun that quietly dropped the context would **still be diffed** against its
baseline — nothing in the diff engine knows the context changed — and the delta
would be read as page movement.

The inheritance uses `??`, not `||`, on every field a caller can legitimately
clear: with `||` an explicit `primary_goal: null` ("I no longer have that goal")
silently re-inherits the old one, which is the failure mode of a form that lets
you change your mind and does not record it.

### Competitor URLs are context, not audits

Naming a competitor at intake **fetches nothing and spends no credit**. The cap
of 10 exists so the column cannot be used as unbounded storage, not because each
entry costs anything. `audit_benchmarks` is what turns competitors into runs.
Rejected and overflowing URLs are **named back to the caller** rather than
dropped: someone who believes a competitor is being tracked when it is not will
read the next report as though it covered them.

---

## 3. Gate order in `discoverability.js`

```
auth → idempotency → quota CHECK → SSRF → compliance → rate limit
     → audit row (the CHARGE) → run → persist → webhook
```

**The distinction that matters is CHECKING the quota versus SPENDING it.** The
check is free and side-effect-free, so it runs early — somebody over their limit
is told immediately rather than after we have fetched their robots.txt.

The **charge is the audit row itself**. Audits are counted from the `audits`
table (`status != 'failed'`, current month); there is no counter column,
deliberately, because a counter that drifts from the rows it counts eventually
bills somebody for work that is not there.

A request refused for SSRF, robots.txt or the operator host allowlist creates no
row and costs nothing. This mirrors `extract.js`, where `consumeGuestCredit`
once ran before the compliance check and a guest pasting three disallowed
LinkedIn URLs was charged three times for work never done.

**Compliance applies to audits.** It is tempting to exempt them — the point of
`TA-01` is to REPORT that crawlers are blocked — but we fetch and read the page
either way, and `/blog` advertises that we honour robots.txt. The recorded
per-host attestation (`lib/scrapeConsent.js`) is the escape hatch.

---

## 3b. Dependencies — the fix that cannot pay off yet

The BRD lists **dependency** as a required field on every recommendation, and
`BLOCKER_GATES` in `recommendationModel.js` is why it matters rather than being
bookkeeping.

On a page whose content only exists after JavaScript runs, adding an answer-first
block helps no non-rendering crawler at all — the new passage is as invisible as
everything else until the page is server-rendered. The lift is real, but it is
**not realisable** while the blocker stands.

So a gated recommendation is marked `blockedBy` and sorts below the work that
unblocks it, regardless of its own score. The UI says so on the row, and the
panel reports `estimatedUnblockedLift` beside the total — presenting only the
total on a blocked page promises work that cannot pay off yet.

Only blockers that genuinely gate downstream work are listed. A broken canonical
is critical and gates nothing, so it is absent. And the gate is per-PILLAR, not
blanket: `EA-01` (add Organization JSON-LD) stays unblocked on a shell page,
because JSON-LD lives in the `<head>` — which a non-rendering crawler does read.
Gating it would discourage work that pays off immediately.

**This is also why the queue's top item is not always the blocker.** A cheap,
certain, genuinely-effective fix can legitimately come first: a team can add
schema this afternoon while re-platforming takes a sprint. What the dependency
guarantees is narrower and more important — nothing that *depends* on the
blocker outranks it.

---

## 4. Failure modes, and which way each fails

| Condition | Behaviour | Why |
|---|---|---|
| Quota lookup degraded | **OPEN** — audit runs | Same asymmetry as `requireEntitlement`. A Supabase blip must not take auditing down. |
| Entitlement explicitly over quota | **CLOSED** — 402 | An explicitly-read state is an answer. |
| PageSpeed unavailable | signal `null`, weight redistributed | Rule 1.1. |
| No citation engine configured | signal `null` | An unsampled brand is unknown, never uncited. |
| AI evaluator unavailable | deterministic pre-screen stands | The audit must never depend on a model being up. |
| Scrape chain throws | audit completes on the raw fetch | Losing 19 signals to one provider is worse than a thin audit. |
| Page unreachable | `status: completed`, `unreachable: true` | The technical facts gathered are exactly what the user needs. |
| Persist fails after the run | result returned, `persisted: false` | The work was done and charged for; discarding it is worse. Saying nothing is worse still. |
| Webhook endpoint down | recorded on the row | Never fails an audit that already ran. |
| robots.txt unreadable | `TA-16`, crawler access `unknown` | Not a block. "Not checked is never down." |
| Audit budget exhausted | remaining evidence `null`, `stageErrors` says `skipped: …` | Running out of TIME is just another reason a signal could not be measured. Rule 1.1 applies unchanged. |

---

## 4b. The wall-clock budget — why it exists

`deadline.js`. The pipeline had per-call timeouts but no notion of the
**platform's** limit, and those timeouts compose **additively** wherever the
work is serial. Measured against an environment where every third party is
merely SLOW rather than down:

| Stage | Why it cost that | Measured |
|---|---|---|
| `collectPage` | scrape chain is a serial fallback: 4 providers × 20s | **80s** |
| `sampleCitations` | 5 default prompts `await`ed in a `for` loop × 15s | **75s** |
| `evaluatePassage` | `runChain` had no timeout at **any** layer | unbounded |

A Netlify synchronous function is killed at **10s** (26s is the paid ceiling),
so the audit could not finish. The client saw `POST /audits failed (504)` and —
because the audit row is opened *before* the run and quota counts every row that
is not `failed` — **the user was charged for it, and again on every retry**.

Three changes, in order of how much they bought:

1. **Citation prompts run concurrently.** They are independent and reduced by
   counting, so nothing needed the ordering. 75s → ~15s. `runs` is still
   rebuilt in prompt order, so stored evidence is byte-identical.
2. **A budget threaded through every optional stage.** Each is handed the time
   that is actually left; one with no room is not started, and is recorded as
   unmeasured. The scrape chain stops walking providers once the budget is gone.
3. **`runChain` accepts an `AbortSignal`.** Optional, so `/api/ai` and
   `extract.js` are unchanged — but a caller on a deadline must pass one, or a
   single slow provider holds the whole chain open indefinitely.

⚠️ **A healthy page never touches any of this** — it audits in well under a
second, and the deadline only engages when something upstream is slow. If audits
start reporting `skipped:` stage errors, the budget is too tight for the
environment, not the other way round: raise the function timeout and
`AUDIT_BUDGET_MS` together.

⚠️ **`ABANDONED_AUDIT_MS` in `auditStore.js` is the other half of the charging
fix.** A `running` row older than 5 minutes cannot be in flight — no audit can
outlive a 26s function — so it is a crashed run and is excluded from the monthly
count. Recent `running` rows still count, so concurrent audits cannot be used to
slip past the quota.

---

## 5. Operating

### Environment

All optional; every one degrades to a smaller audit rather than a failure.

| Variable | Effect if unset |
|---|---|
| `AUDIT_BUDGET_MS` | Total wall clock one audit may occupy. Defaults to **8000**, sized for Netlify's **stock 10s** function timeout. Raise the function's timeout to 26s (Site configuration → Functions) and set this to `20000` for fuller evidence. See §4b. |
| `PAGESPEED_API_KEY` | PSI still works keyless at low volume; on exhaustion CWV reads `not measured` |
| `DISABLE_PAGESPEED=1` | CWV never attempted |
| `PERPLEXITY_API_KEY` | Citation sampling falls back to the AI chain, flagged `live: false` in the UI |
| `PERPLEXITY_MODEL` | defaults to `sonar` |
| `DISABLE_AI_CITATION_SAMPLING=1` | Citation footprint reads `not measured` |
| `DISABLE_AUDIT_AI=1` | `passage_independence` uses the deterministic pre-screen only |
| `FIRECRAWL_API_KEY` / `SPIDER_API_KEY` | Without either, render completeness reads `not measured` — the two fetches would be identical and comparing them a tautology |

### Cron

`discoverability-monitor` is `@daily`, declared in **`netlify.toml`** and
registered in **`AUTOMATION_JOBS`**. Both are required and
`netlify/__tests__/audit/cron-registry-parity.test.js` asserts they agree — the
check that would have caught the R19 incident where every cron sat unscheduled
for months with no error anywhere.

Netlify runs scheduled functions for the **production deploy only**. A branch
deploy returning 200 on the endpoint proves nothing.

### Retention

`prune_audit_history(days)` deletes completed audits older than `days`
(30-day floor), skipping any that are a baseline, a benchmark member, or a
schedule's last run — pruning those would turn a working comparison into a
dangling reference.

**`audit_events` is never pruned.** A retention job that erases the record of a
deletion is what an audit trail exists to prevent. Nothing calls
`prune_audit_history` yet; wire it when volume justifies it.

---

## 6. Things that will bite

- **A fragment must never displace a document.** The scrape chain's later
  providers do not return HTML. Jina returns markdown, which `scrapeProviders.js`
  converts to a shell of headings and links — no `<head>`, so no meta, no
  canonical, no JSON-LD. Parsing that as the page made the engine report "no
  viewport meta tag" on a page whose first meta tag is a viewport. A whole
  pillar of phantom findings, delivered with total confidence, which is the
  worst failure an audit tool has. `looksLikeFullDocument()` gates the choice
  and `headSignalsReliable` turns the remaining blind spot into *unmeasured*
  rather than a measured absence. **This was found by running the engine against
  a live page, not by a test.** Mocks agreed with each other.

- **A JavaScript shell is named as one.** `looksLikeJsShell()` recognises a real
  document that defers its content, so the engine raises `TA-07` ("your content
  is JavaScript-only") instead of the content analysers each reporting their own
  half of it as "no H1", "no answer passage", "no headings". An author whose H1
  is plainly visible in their browser reads the latter and concludes the tool is
  broken.

- **Signal and issue codes are a public contract.** They travel in the JSON
  payload, in webhook bodies, in stored rows and in every historical diff.
  "AC-02 was resolved" is only true if AC-02 still means what it meant when the
  baseline was taken. Add codes; never repurpose or renumber one.

- **The weight tables are pinned by tests.** Rebalancing is allowed; forgetting
  to rebalance so a pillar no longer sums to 1.0 fails the build, because
  otherwise it would silently rescale every user's historical score.

- **Help page numbers shift.** `public/help/NN-slug.html` is derived from the
  `## N.` headings in the user guide. Inserting a section renumbers everything
  after it. The six pages that shifted when Discoverability became §11 have
  permanent redirects in `scripts/site-routes.mjs` (mirrored into
  `netlify.toml`, asserted by `page-ownership.test.mjs`). Resolve help pages by
  **slug**, never by number — the readiness audit learned this the hard way.

- **`/discoverability` is a private prefix.** It must stay in sync across four
  places: `PRIVATE_PREFIXES` in `scripts/site-routes.mjs`, the `X-Robots-Tag`
  header in `netlify.toml`, `public/robots.txt`, and the inline guard in
  `index.html`. `page-ownership.test.mjs` asserts all four.

- **`_apiKeyUserId` is in-process only.** It is how `api-v1.js` passes an
  API-key-resolved user into the shared handler. It cannot arrive over the
  network, and a test proves it cannot be forged through a header, a query
  param or the body. Do not read it from anywhere else.

- **`PERMITTED_HOSTS` is EXCLUSIVE.** Setting it blocks every host not listed,
  for audits as well as extraction.

---

## 7. Deliberately not built

- **Automatic publishing of fixes.** Out of scope in the BRD and it should stay
  that way. DatIQ generates the construct; a human decides to publish it.
- **A ranking or traffic prediction.** An explicit non-goal. Every surface —
  report footer, UI, blog post, help section — says the scores describe how
  discoverable a page is today and predict nothing.
- **Workspaces.** The PRD schema has a `workspaces` table; DatIQ does not.
  Every table carries a nullable `workspace_id` reserved for when team
  workspaces ship, so the column can be back-filled without a second migration.
- **A separate auth system.** The PRD specifies `/api/v1/auth/login`. DatIQ has
  Supabase auth. Building a second identity system beside the real one is how an
  app ends up with two answers to "who is this?" and the wrong one gating access.

---

## 8. Release mapping

⚠️ **This table maps the module onto the CURRENT consolidated BRD/PRD (P1/P2/P3),
which is not the three-phase document the module was originally built against.**
An earlier version of this file marked all three of THAT document's phases ✅,
and that remains true of it — but the new P1 is broader in several places and
the new P2 is largely greenfield, so the old mapping does not transfer. The
clause-by-clause gap analysis lives in
[DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md).

| P1 area | State |
|---|---|
| Four-pillar model, SEO/AEO/GEO framework views | ✅ weights match the PRD exactly |
| Evidence envelope and explainability | ✅ W1 — `evidenceModel.js`, migration 0048 |
| Penalty model | ⚠️ W3 — shipped calibration retained by decision; two PRD conditions still to add |
| Goal-based intake (audit type, primary goal, geography, 8 profiles) | ✅ W2 — `intakeModel.js`, migration 0049 |
| Gap analysis v2 (root cause, module, observed-fact/inference split) | ❌ W4 |
| Recommendation Studio (meta variants, internal links, content brief) | ⚠️ W5 — 13 of 17 constructs |
| AI visibility (prompt taxonomy, 7 citation states, SOV, WAVI, displacement) | ❌ W6 — largest remaining P1 item |
| Validation Lab (signal diff, regressed/unchanged, trend windows, attribution) | ⚠️ W7 |
| Workflow Hub lite (7-state lifecycle, assignment, due dates, notes) | ⚠️ W8 — 4 of 9 states |
| `/api/v1/discoverability/*` namespace | ⚠️ W8 — served under `/api/v1/audits/*` |

**P2 — brand, product, service and local intelligence — is not started.** Schema
intelligence has two of its signals; everything else (truth record, entity graph,
BDS/PDS/SFS, NAP and directory, trust and proof, service radius) is greenfield.

Workspace rollups are no longer blocked: `public.workspaces` has existed since
migration 0031, and the nullable `workspace_id` columns on every audit table are
the hook. Wiring them is W8.
