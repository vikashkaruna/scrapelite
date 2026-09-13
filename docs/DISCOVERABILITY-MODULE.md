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
  scoringModel.js                 pillar/framework maths, 9 penalties, bands, v2
  signalScorers.js                the individual curves
  issueCatalog.js                 46 issue codes → severity, owner, fix, penalty,
                                  root cause and module (W4)
  gapTaxonomy.js                  8 root causes + 13 modules — §3d. WHY a
                                  finding exists and WHICH capability answers it
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

## 3c. The penalty model — shipped vs the PRD

Nine multiplicative blockers, applied to the weighted sum as `score * (1 - factor)`
across **every** framework view. They exist because some failures undermine
discovery no matter how good the content is, and an additive deduction cannot
express that: a page whose content only exists after hydration is not "a good
page minus a few points" to a crawler that does not run JavaScript — it is a
blank page.

### The mapping, and the four deliberate divergences

| PRD critical condition | PRD | Shipped | Why |
|---|---|---|---|
| Key URL blocked by robots or `noindex` | 20% | `NOINDEX` **0.20** | matches |
| Relevant AI-search bot denied access | 15% | `AI_CRAWLER_BLOCKED` **0.20** | **⬆ diverges.** A page an engine cannot fetch is not a discounted page, it is an absent one. 15% understates a total exclusion. |
| Canonical destination non-200 | 15% | `CANONICAL_TARGET_BROKEN` **0.15** | matches |
| Major raw-to-rendered content loss | 15% | `CONTENT_HYDRATION_ONLY` **0.20** | **⬆ diverges.** Same reasoning as the crawler block — a non-rendering crawler receives an effectively empty page. |
| Critical entity schema invalid | 10% | `ENTITY_SCHEMA_INVALID` **0.10** | **added in W3** at the PRD's weight |
| FAQ schema differs from visible FAQ | 10% | `FAQ_SCHEMA_MISMATCH` **0.10** | matches |
| Severe CWV failure | 10% | `SEVERE_CWV_FAILURE` **0.10** | **added in W3** at the PRD's weight |
| *(no PRD row)* | — | `AI_CRAWLER_PARTIAL_BLOCK` **0.05** | **➕ DatIQ extension.** Uneven citation coverage is a real, milder defect the PRD does not model at all. |
| *(no PRD row)* | — | `MOBILE_PARITY_MISSING` **0.10** | **➕ DatIQ extension.** Mobile is the crawl default; a desktop-only page is a partial block by another name. |

**Priority also diverges, deliberately.** The PRD specifies a linear
`0.40I + 0.20C + 0.20B + 0.20E`; `recommendationModel.js` uses a multiplicative
`100 · (I·C) · breadthMul · easeMul`. A linear form lets a high-impact,
zero-confidence finding outrank a certain one, which is precisely the queue
nobody trusts twice.

These divergences are **decision D1** in the implementation plan. They are
recorded here rather than only there because the next person to read the PRD
beside this code will otherwise see four discrepancies and "fix" them.
`scoringModel.test.js` asserts every factor above, so an alignment pass that
silently re-calibrates fails the build with the reasoning attached.

### What "severe" and "invalid" actually mean

Both new blockers had to be given detection rules the PRD does not specify, and
both rules are deliberately **narrower** than their names suggest. A blocker
that fires on ordinary pages teaches its reader to dismiss the ones that matter.

**`ENTITY_SCHEMA_INVALID`** fires when an entity block is *present* and cannot
identify the thing it declares — an `Organization` with no `name`, an `Article`
with no `headline`. It is not the same claim as EA-01 (*no entity markup*) or
EA-02 (*thin entity markup*):

```
absent   →  EA-01, a signal score. An engine infers the publisher from prose.
thin     →  EA-02, a signal score. The entity resolves, incompletely.
UNUSABLE →  EA-11 + the blocker. A resolver has a node to build and no
            identity to attach — and a half-built node is what gets merged
            into the WRONG knowledge-graph entry.
```

⚠️ `WebSite` is deliberately excluded from the check. The sitelinks-searchbox
pattern is a `WebSite` block carrying `url` and `potentialAction` and nothing
else, which is both extremely common and entirely correct.

**`SEVERE_CWV_FAILURE`** fires on either of two conditions — **two or more
metrics past their poor threshold**, or **one metric at or beyond twice its
poor threshold** (LCP ≥ 8s, INP ≥ 1000ms, CLS ≥ 0.5). One marginal reading is a
fault and is already reported as TA-09/10/11 and priced into the
`core_web_vitals` signal; this is the separate claim that performance has
crossed from an experience problem into a discovery one.

The 2× clause exists because CrUX frequently returns only LCP for low-traffic
URLs, and without it a twelve-second page escapes whenever the field data is
thin. It is the same `unknown ≠ 0` discipline read the other way: thin data
must not manufacture a blocker, and must not excuse one either.

### The version, and why a diff refuses to cross it

`SCORING_MODEL_VERSION` is `v2` as of W3. It travels on `audit_results` and
`auditDiff` **refuses** to compare across versions — see `incomparableDiff()`.

That refusal is the harsher choice and the correct one. A caveat printed under a
confident `+4.2` is read as a footnote; the number is what gets screenshotted
and pasted into a board deck. "Re-run to compare" costs the user one audit; a
delta that mixes two penalty sets costs them their trust in every number in the
report, and they will never know to spend it.

What the guard still reports, because a version bump does not invalidate it:

| | Across a version boundary |
|---|---|
| Framework, pillar, signal deltas | refused — `comparable: false`, `change: null` |
| Coverage, penalty multiplier | refused |
| **Issue resolved / remaining / introduced** | **still reported** — issue codes are a public contract that does not move with the scoring model |
| Penalty cleared / introduced | refused — the penalty **set** is exactly what changed, so "cleared" would credit a fix nobody made |

A row written before migration 0048 carries no version and is treated as `v1`:
it *was* scored, by the only model this repository had shipped.

⚠️ **v1 → v2 moves the score of a page only if it trips one of the two new
conditions.** Nothing else changed — no weight, no curve, no existing factor.
That is what makes the bump narrow rather than a re-calibration, and it is
asserted in `scoringModel.test.js`.

---

## 3d. Gap analysis — from a list to a diagnosis

The BRD specifies **eleven** fields on every issue. The table carried six, and
the five it did not carry are the five that make a queue actionable rather than
merely correct.

| BRD field | Before W4 | Now |
|---|---|---|
| Stable code, title, pillar, frameworks, severity | ✅ | unchanged |
| **Observed fact, separately from inference** | one blended `evidence` column | `observed` + `inference` |
| Evidence reference `{url, selector, excerpt}` | ✅ W1 | `evidence_json` |
| **Root cause** | no taxonomy | `root_cause`, 8 causes |
| **Recommended DatIQ module** | absent | `recommended_module` |
| Recommended owner role | catalogue-only | `owner_role` |
| **Workflow state** | issues had no lifecycle | `status` (W8 wires transitions) |

### Why a root cause, when every issue already has a code

46 codes is more than anyone reads. Forty individually-true findings is a
**list**, not a diagnosis — and the reader's question is *"what is wrong with
this page"*, which no single code answers.

Grouping by **pillar** does not answer it either, because a pillar is a scoring
construct. *"Entity authority is 42"* says where points were lost, not what to
go and do.

Root cause is the axis a person can act on. Eleven findings that all reduce to
`entity_ambiguity` are **one afternoon's work**, and seeing that is the
difference between a report that gets worked and one that gets filed.

The eight causes are fixed and ordered — technical access first, because nothing
downstream matters on a page a crawler cannot reach. `groupByRootCause()` returns
them in taxonomy order rather than by count, deliberately: the commonest cause on
a broken page is usually `weak_page_structure` simply because there are more
structural codes to trip, and leading with it on an unreachable page tells the
reader to restructure headings nobody will ever see.

⚠️ **Two of the eight are unused in P1 and that is correct.**
`location_radius_mismatch` and `conversion_friction` belong to P2's local and
service modules. They are declared now because the taxonomy is a stored contract
and one that arrives in two halves invites the second half to be numbered around
the first. `rootCausesInUse()` is what the UI renders, so no customer is shown an
empty bucket.

### Observed and inferred have different warranties

```
"The page has two H1 elements"      MEASURED. We will defend it.
"This dilutes the topical signal"   REASONED. A fair expert could disagree.
```

Both values already existed — the per-audit sentence and the catalogue's `why` —
but they reached the reader as **one paragraph**, which gives the second the
authority of the first. Naming them is the whole fix, and it is the same rule the
evidence envelope enforces one layer down (`method` carries `observed: true|false`,
so a judgement cannot be dressed as a reading by a forgetful call site).

`observed` is per-**audit**; `inference` is per-**code**. What we saw varies by
page; what it means does not.

⚠️ `evidence` is kept and keeps its meaning — every export prints it and every
historical diff compares it. On a row written before W4 the sentence **is** the
observed fact; it was just never labelled as one, which is why `observed` falls
back to it and `inference` does not fall back to the catalogue. Back-filling an
inference would put a diagnosis in front of a customer that no run ever produced.

### The module referral is stored as a slug, not as "M1–M13"

The BRD names thirteen modules **M1–M13** and does not enumerate which is which
anywhere this repository can see. Numbering them from a guess and storing those
numbers would break the rule that matters most — *codes are a public contract;
never renumber one* — the first time the real list disagreed.

So the stable identifier is the **slug**, derived from the PRD's own §7/§9 section
names, and `MODULES[].mCode` is a nullable display alias waiting for
confirmation. **Nothing keys off it.** Filling in thirteen labels later is a
one-line change; renumbering a shipped column is not.

Each module declares `phase` and `available`, so a finding referred to a P2
module is still correctly diagnosed and the UI shows it as *"(coming)"* rather
than implying a customer can click through to something that does not exist.

### 🔴 `audit_recommendations.issue_id` was declared in 0030 and written by nothing

NULL on every row for the life of the module — the same defect class W1 found on
`audit_signals.raw_value` and `.evidence_json`, in the same table set.

Every recommendation was an **orphan**. *"Which finding produced this task"* had
no answer in the data, so the validation loop could not close: when a re-audit
reports AC-01 resolved there was no way to mark the recommendation it produced as
validated except by matching on `code` — which works only while that mapping
stays one-to-one and **silently mis-attributes** the moment it does not.

The fix costs a round trip and is worth it. `persistResult` used to fire all four
child writes concurrently with `return=minimal`; issues are now inserted **first**
and **alone**, asking for the rows back, and the returned ids are threaded onto
the recommendation rows. The other three writes still go concurrently behind it.

⚠️ The ordering guarantee is unchanged: every child is written before the parent
is marked `completed`, so a partial failure leaves the audit visibly `running`
rather than showing a finished audit with a score and no evidence behind it.

A recommendation whose code matches no issue keeps a **null** link rather than
guessing — that happens on the unreachable-page path. `ON DELETE SET NULL` means
re-auditing a finding away nulls the link instead of deleting the work, because a
recommendation deleted with its issue would erase the record that anyone ever did
anything about it.

### The evidence envelope finally reaches a screen

W1 built the envelope and threaded it through the pipeline, the store and the API
— and it rendered **nowhere**. A record that is stored and never shown answers
*"where exactly did you see that?"* only for whoever can query the database, which
is not the person asking.

`SignalEvidence` renders it inline and collapsed **on the signal it supports**,
because the question is always *"why is THIS number what it is"* — an evidence
drawer elsewhere on the page would make the reader carry a signal code across it.
Observation and inference are visually distinct, from the record's own `observed`
flag. It renders nothing at all when there is no evidence: an empty "Evidence"
disclosure would read as *"we looked and found none"*.

---

## 3e. The Canonical Business Truth Record (P2 · W9)

Until W9 this module could say what a **page** claims. It could not say what is
**true**. Those are different questions, and the second one is what every P2
module is waiting on: the entity graph needs a subject, brand scoring needs a
brand, NAP matching needs a name-address-phone to match *against*, and the
accuracy half of citation classification needs something to check an engine's
answer against — `citationStates.js` narrows its accuracy check to price for
exactly that reason, and says so in its own header.

| Layer | Where |
|---|---|
| Pure model | `src/lib/discoverability/businessTruth.js` |
| Schema | `supabase/migrations/0055_business_truth.sql` |
| Store | `netlify/functions/lib/audit/auditStore.js` (`*TruthRecord*`, `*TruthVersion*`, `*TruthConflict*`) |
| API | `/api/discoverability/business-truth/*` |
| Client | `discoverabilityClient.js` |

### D3 name mapping

| PRD name | Actual table |
|---|---|
| `business_truth_records` | `public.audit_business_truth_records` |
| `business_truth_versions` | `public.audit_business_truth_versions` |
| *(not in the PRD)* | `public.audit_business_truth_conflicts` |

The third table is ours. The PRD stops at storing the record; storing it without
comparing it to the pages produces a form, not a finding.

### `declared` is not an evidence method, and that is deliberate

The obvious move is to add `customer_declared` to `EVIDENCE_METHODS` and reuse
`makeEvidence` for everything. It is the wrong move.

That model answers one question — *where on the web did you read this?* — and
requires a source URL, a selector, a section and an excerpt. A customer typing
their own legal name into a form has none of those, and forcing it through would
mean **inventing a source URL for a fact that was never on a page**: fabricating
provenance to satisfy a schema.

So a fact carries a `source` from `FACT_SOURCES`, and where that source is
`observed` it carries a real `makeEvidence` record. One evidence model, used
wherever evidence exists; no second one invented where it does not.

🔴 **`makeFact` REFUSES an `observed` or `imported` fact with no evidence
attached**, and so does the API — a client may only submit `declared` or
`inferred`. Those two verifiable sources promise that somebody could go and
check; a claim of verifiability with nothing to verify against is a guess
wearing a warranty, and accepting it from a request body would make provenance a
flag anyone can set — the same defect as an `?consented=true` query parameter.

### Authority is not confidence

| Source | Authority | Verifiable |
|---|---|---|
| `declared` | 1.00 | no |
| `imported` | 0.85 | yes |
| `observed` | 0.70 | yes |
| `inferred` | 0.30 | no |

A declaration outranks a page reading for the canonical value — the owner knows
their registered name better than their own footer does, and footers go stale.
But `observed` carries a warranty `declared` never can.

⚠️ **`pickCanonicalFact` does not discard the losers, and callers must not
either.** The page reading that lost to a declaration is precisely what
`detectConflicts` needs; throwing it away would delete the finding before anyone
saw it.

### The contradiction is the product

🔴 A table that only stores what the customer typed is a form. Comparing it to
the pages produces *"you told us Acme Technologies Pvt Ltd; your schema says
Acme"* — frequently the explanation for why three engines disagree about who
they are. `detectConflicts` is that, which is why this ships with issue codes
rather than just a table.

| Code | Means | Why it is its own code |
|---|---|---|
| `BT-01` | the page states something else | a contradiction |
| `BT-02` | the page does not state it at all | **an absence, with the opposite remedy** |
| `BT-03` | a required identifying fact is missing | the record itself is incomplete |
| `BT-04` | a canonical value rests on inference alone | nobody confirmed it |

Collapsing `BT-01` and `BT-02` would tell a customer their address is *wrong*
when the real finding is that their contact page never mentions it. Opposite
remedies, and the wrong one wastes the fix.

⚠️ **The check is SCOPED to fields a page could plausibly have stated**
(`SCHEMA_READABLE`). Unscoped, every field the record holds that one audited
page never mentions becomes a `BT-02`, and a single audit of a blog post would
raise twenty absences. A page not stating the company's GSTIN is not a finding —
it is a question that audit did not ask.

⚠️ **It runs only against an APPROVED version.** Comparing a page to an
un-reviewed draft would raise findings against facts nobody has agreed are true,
which is the exact effect the approval gate exists to prevent.

⚠️ **And it never fails an audit.** The audit ran and was charged for; a truth
record that is missing, unapproved or briefly unreadable is not a reason to lose
it. Every failure path returns null and the audit is returned as normal.

### Approval means a second person looked

A version moves `draft → pending_review → approved`, or to `rejected` (with a
mandatory reason) — and an approved version retires to `superseded` when a newer
one is promoted, so the history reads as history rather than as a list of rows
that all claim to be current.

🔴 **Self-approval is refused in three places**: `canPromote()` in the pure
model, the `audit_btv_no_self_approval` CHECK constraint, and
`promote_business_truth_version()` itself. The same three-layer discipline
`ops_audit_log` uses for its mandatory reason — a rule that lives in one
endpoint is a rule the next endpoint forgets, and this record is about to become
the thing other modules assert as true.

🔴 **Promotion is one SQL function because it is three writes that must not
separate**: supersede the outgoing version, approve the incoming one, repoint
the record. As three PostgREST calls there are windows where the record points
at a superseded version, at nothing, or at two versions that both believe they
are current. `setTruthVersionState` refuses `approved` outright, so there is
exactly one path in — the one carrying the interlocks.

### Two required fields, not fifteen

`REQUIRED_FOR_CANONICAL` is `legal_name` and `canonical_domain` only. A gate
that blocks promotion until fifteen fields are filled is a gate people type
placeholders past, and the record ends up **less** true than if it had never
asked. Everything else a module needs is declared on that module's own field row
through `requiredFor`, so `readinessFor()` reports *"local intelligence needs a
locality and a phone"* rather than a blanket refusal that names nothing.

⚠️ `canonical_domain` is also **the bridge key to `public.canonical_entities`**
(migration 0041), so a company is resolved once across the platform. Both sides
must spell it identically — bare host, lower-case, no `www.` — which is what
`normalizeFieldValue("canonical_domain", …)` produces and what the API stores.

⚠️ **Phone normalisation strips presentation and adds no meaning.** Guessing
that a ten-digit Indian number is `+91` would store an inference as a
*declaration* and match it against directories as though a human had said it.

### Completeness

`truthCompleteness()` reports `known / applicable` and **names what it excluded**.
A field the business genuinely does not have (`not_applicable` on the record) is
excluded and reported, never scored zero — a business with no premises has no
street address, and counting that against them reports a correct record as a
deficient one.

⚠️ **But a field that is merely unfilled is missing.** The redistribution rule
is about what does not *apply*, not about gaps; an inventory that excused every
gap would always read 100% and mean nothing.

### A source change with no value change is a real event

`diffVersions` gives it its own bucket, `resourced`. *"We inferred your founding
year, then you confirmed it"* moves nothing on screen but changes what the
product is entitled to assert — reporting it as `unchanged` would hide the one
thing that actually happened.

---

## 3f. The Entity Graph Builder (P2 · W10)

W9 gave the module one approved set of **facts**. A fact is a value; it says
nothing about how things relate. *"Acme sells Acme Cloud"*, *"Acme Cloud is a
product, not the company"*, *"these two office records are one organisation"* —
those are edges, and edges are what a knowledge graph resolves an entity by.

| Layer | Where |
|---|---|
| Pure model | `src/lib/discoverability/entityGraph.js` |
| Schema | `supabase/migrations/0056_entity_graph.sql` |
| Store | `auditStore.js` (`*Entity*`, `*Relationship*`, `*GraphConflict*`) |
| API | `/api/discoverability/entity-graph/*` |
| Client | `discoverabilityClient.js` |

### D3 name mapping

| PRD name | Actual table |
|---|---|
| `entities` | `public.audit_entities` |
| `entity_relationships` | `public.audit_entity_relationships` |
| `entity_evidence` | `public.audit_entity_evidence` |
| *(not in the PRD)* | `public.audit_entity_conflicts` |

### D7 is still open, and this does not pre-empt it

Graph conflicts get their own table, exactly as W9's truth conflicts did, rather
than retrofitting `subject_type` + `subject_id` onto `audit_issues`. That
retrofit touches every reader of the P1 queue, the diff engine and all four
exports — doing it as a side effect of building the graph would ship the two one
bug apart. When D7 lands, these findings migrate into whatever it decides.

⚠️ **W9 and W10 both attach to a business rather than to an audit**, so whatever
D7 resolves to attaches to them rather than replacing them.

### The §9.2 taxonomy, reconciled without rewriting history

The consolidated BRD/PRD publishes **fifteen semantic entity types** and **nine
relationships**. W10 shipped before that list was available and already stored
fourteen stable type ids and nine stable predicate ids. Migration `0065` follows
the rule recorded here from the start: **add; never renumber or repurpose**.

`ENTITY_TYPES[].prdType` now maps eleven original ids and four additive ids onto
all fifteen published concepts exactly. The implementation keeps three useful
extensions (`offer`, `event`, `topic`), for eighteen internal ids total.
Likewise, `PREDICATES[].prdPredicate` maps five original and four additive ids
onto all nine published relationships; four implementation extensions (`owns`,
`part_of`, `same_as`, `about`) remain, for thirteen internal ids total.

**Additive types** — `partner`, `customer_case_study`, `directory_listing`,
`competitor`.

**Additive predicates** — `provides`, `founded_by`, `validated_by`, `listed_on`.

The pure-model test asserts published semantic coverage and preserves the old id
prefix; `db-verify` reads the final applied CHECK constraints and asserts exact
parity with both registries.

⚠️ **Every predicate declares a domain and a range, and `validateRelation`
enforces them.** Without that a graph is a bag of edges: *"this review employs
that topic"* is storable, meaningless, and impossible to notice later.

### Every relation carries evidence, or it is not a relation

🔴 A graph is only worth reasoning over if each edge traces back to the bytes
that justified it. `makeRelation` refuses an `observed` edge with no evidence,
and so does the `audit_rel_observed_has_evidence` CHECK. An edge nobody can
drill into is indistinguishable from one somebody made up.

The API refuses `observed` and `imported` from a client for the same reason W9
does: those sources promise somebody could go and check, and this path has
nothing to attach.

### Three things the database refuses outright

| Refused | Why |
|---|---|
| **A self-edge** (`audit_rel_no_self_edge`) | *"Acme is part of Acme"* is vacuously true and pollutes every traversal. |
| **A duplicate edge** (`audit_rel_unique`) | A crawler re-reading the same page weekly would otherwise add a row per run, every count would double, and *"who do we compete with"* would answer differently depending on how many audits had happened. Re-observation **corroborates**; it does not accumulate. |
| **A dangling edge** (cascade on both endpoints) | An edge to a deleted node is not a partial edge, it is a pointer every traversal has to defend against for ever. |

### Approval approves the endpoints too

🔴 `approve_entity_relationship()` is one SQL function because **an approved
edge between two unreviewed nodes is a half-built statement** — the graph would
assert a relationship between two things it has not agreed exist. So approving
an edge approves its endpoints, under the same reviewer, in the same statement.

⚠️ **The endpoints are approved, not created.** A node somebody explicitly
rejected blocks the edge (`endpoint_rejected`) rather than being silently
revived — reviving it would undo an explicit decision.

🔴 **Self-approval is refused** in the pure model, in the CHECK constraints on
both tables, and in the function. Same discipline as W9.

### Conflicts read the approved graph only

| Code | Means |
|---|---|
| `EG-01` | two approved values for a one-value relationship (`located_at`, `part_of`) |
| `EG-02` | the hierarchy contains a cycle |
| `EG-03` | `same_as` links two entities of different types |
| `EG-04` | an approved edge whose endpoints do not fit the predicate |
| `EG-05` | an **identifying** entity with no approved relationship at all |
| `EG-06` | an approved relationship resting on inference alone |

⚠️ **A proposal that contradicts the graph is not a conflict, it is a
proposal.** Reporting it as one would make the review queue argue with itself.

⚠️ **`EG-05` fires only on `identifying` types.** A Topic nothing points at yet
is an ordinary state of affairs; an Organization nothing points at is a node
that resolves nobody.

⚠️ **`EG-02` is reported once, not once per member of the cycle.** A hierarchy
that loops makes every rollup either infinite or silently truncated, and the
truncation is the dangerous one because it looks like an answer.

### The endpoint types are joined, never stored on the edge

🔴 `audit_entity_relationships` holds no `subject_type` or `object_type`, and
`toRelationModels()` joins them from the entities. Denormalising them onto the
edge would be a second copy of a fact that already has an owner, and the two
would drift the first time an entity was re-typed — after which `EG-03` and
`EG-04` would be checking against a type nobody holds any more.

### The conflict sweep runs on approval, and it writes

🔴 `refreshGraphConflicts()` runs when an edge is approved, because that is when
the approved graph changes. A conflict table nothing writes is the failure
pattern this repo has shipped three times; a contract test asserts the write and
was confirmed RED first.

⚠️ **Already-open conflicts are not re-written** — a queue that grows while
nothing gets worse is a queue people stop reading — and **the sweep never fails
the approval** that already succeeded.

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
| Truth-record lookup fails mid-audit | audit returned as normal, no `businessTruth` key | The audit ran and was charged for. A record briefly unreadable is not a reason to lose it. |
| Truth record exists but nothing is approved | **no comparison at all** | Findings against an un-reviewed draft are what the approval gate exists to prevent. |
| Page carries no identity markup | every in-scope field reports `BT-02`, `identity_markup_present: false` | "We compared and found nothing" and "there was nothing to compare" are different answers. |
| Graph conflict sweep fails after an approval | approval stands, `conflicts: null` | The edge was approved. A sweep that cannot write is not a reason to report the approval as failed. |
| An edge's endpoint was rejected | approval refused, `endpoint_rejected` | Approving it would silently revive a node somebody explicitly declined. |

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
- **Discoverability portfolio rollups.** DatIQ has had `public.workspaces` since
  migration `0031`, and every audit table carries the nullable `workspace_id`
  bridge. P3 Stage 4 builds the nine-axis rollup; no second workspace or team
  model is needed.
- **A separate auth system.** The PRD specifies `/api/v1/auth/login`. DatIQ has
  Supabase auth. Building a second identity system beside the real one is how an
  app ends up with two answers to "who is this?" and the wrong one gating access.

---

## 8. Consolidated BRD/PRD mapping

This section maps the repository to the current P1/P2/P3 document. The complete
P1/P2 audit trail is in
[DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md);
the ordered P3 checkpoints are in
[DISCOVERABILITY-P3-IMPLEMENTATION-PLAN.md](DISCOVERABILITY-P3-IMPLEMENTATION-PLAN.md).

### §5.2 module-name mapping

The document's `M1`–`M13` ids are architectural modules. They are not the same
registry as `gapTaxonomy.js`'s recommendation-destination slugs. The explicit
mapping prevents that accidental thirteen-to-thirteen coincidence from becoming
a stored contract.

| BRD/PRD module | Repository implementation | State |
|---|---|---|
| M1 Audit Intake | `intakeModel.js`, `auditProfiles.js` | ✅ P1 |
| M2 Extraction & Evidence | `auditPipeline.js`, `evidenceCollector.js`, `evidenceModel.js` | ✅ existing + P1 |
| M3 Scoring Engine | `scoringModel.js`, `subjectScoring.js`; P3 extends with SXO | ✅ P1/P2; P3 extension planned |
| M4 Gap Analysis | `issueCatalog.js`, `gapTaxonomy.js` | ✅ P1 |
| M5 Recommendation Studio | `recommendationModel.js`, `constructTemplates.js` | ✅ P1; extended by P2/P3 findings |
| M6 Validation Lab | `auditDiff.js`, `validationLab.js` | ✅ P1 |
| M7 Benchmarks & AI Visibility | `promptTaxonomy.js`, `citationStates.js`, `aiVisibility.js`, `displacement.js` | ✅ P1/P2 |
| M8 Workflow Hub | `workflowLifecycle.js`, recommendation routes and lifecycle webhooks | ✅ P1 lite/P2; P3 governance extension planned |
| M9 Entity Graph Builder | `entityGraph.js`, migrations `0056` + `0065` | ✅ P2 |
| M10 Local & Directory Intelligence | `directorySources.js`, `napModel.js`, migration `0058` | ✅ P2 |
| M11 Trust & Proof Audit | `schemaIntelligence.js`, `trustProof.js`, migration `0062` | ✅ P2 |
| M12 SXO Experience Lab | P3 Stages 2–3 | ⏳ not yet implemented |
| M13 Portfolio Operations | P3 Stage 4 | ⏳ not yet implemented |

### P1 and P2

| Release | Repository state | Customer-facing residue |
|---|---|---|
| P1 · W1–W8 | ✅ Complete: evidence, intake, penalty model, gap analysis, Recommendation Studio, grounded AI visibility, Validation Lab, Workflow Hub, canonical `/api/v1/discoverability/*` routes | A live grounded-provider exercise remains an environment gate, not missing code |
| P2 · W9–W14 | ✅ Backend/model/API complete: truth record, entity graph, BDS/PDS/SFS, directory/local, schema/trust, entitlement and revalidation | Stage 1 supplies the P2 screens and the approved-entity → scorable-subject entry point (DEV-01) |

“Complete as code” does not mean the two named Stage 1 residues are usable by a
customer today. It means the P1/P2 contracts they extend are present and tested,
so P3 builds on one implementation rather than recreating them.

### P3 · Search-to-outcome intelligence

P3 is deliberately sequential:

1. Stage 0 freezes ground truth, published taxonomy and release gates.
2. Stage 1 closes the P1/P2 reachability and UI residue P3 consumes.
3. Stage 2 adds static SXO: TD, intent fit, first-screen clarity, UX friction,
   conversion design and the versioned SXO/composite scorer.
4. Stage 3 adds privacy-minimized analytics, funnels, forms and measurement
   maturity behind operator-configured provider connections.
5. Stage 4 adds templates, workspace rollups, persona views and controlled
   experiment records.
6. Stage 5 runs branch → staging → production release gates and updates every
   public promise only after the evidence is green.

The out-of-scope guarantees remain binding throughout: no raw session-replay
store, no autonomous experiment deployment, and no causal label without
controlled experimental evidence.
