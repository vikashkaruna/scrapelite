# Unified Usage Credits — audit findings and proposal

> **Status: PROPOSAL. Nothing here is implemented.** Written 2026-09-22 at the
> owner's request: *"currently they are extraction based but workflows and
> discoverability talk about credits. We need a common measure of usage and
> pricing them."*
>
> Every claim below is cited to a file and line. Where a number is an estimate
> rather than a measurement it says so.

---

## 1. Executive summary

DatIQ meters usage **three different ways at once**, and two more surfaces are
capped by *how many objects you may own* rather than *how much they spend*.

| # | Meter | Unit | Reset | Who writes it |
|---|---|---|---|---|
| M1 | `usage.extractions` | one page | monthly | `usageService` / client + `extract.js` |
| M2 | `audits` table row count | one audit | monthly | implicit — any row that exists counts |
| M3 | `credit_ledger` (0037) | a credit | never (append-only) | **3 callers only** |

**The core problem is not that there are three meters. It is that they are not
fungible and not comparable.** An audit costs roughly a dozen provider calls and
consumes "1 audit"; a single extraction costs one fetch and consumes "1
extraction". Nothing converts between them, so no one can answer *"what did this
customer actually cost us this month?"* — and no plan can be priced against a
single number.

`credit_ledger` is already the right shape for the answer. It is simply not
plugged into anything except templates and watchlists.

---

## 2. What is metered today

### 2.1 The three meters

**M1 — extraction counter.** `entitlementModel.js` `case "extract"` /
`case "extract.batch"` check `L.extractions` against `usage.extractions`.

**M2 — audit row count.** `auditStore.countAuditsThisMonth()` counts rows in
`audits` where `status != 'failed'` in the current month. There is deliberately
no counter column — the row *is* the charge. Checked by `discoverability.js`
(two call sites).

**M3 — the credit ledger.** `credit_ledger` (migration 0037) carries
`reason`, `unit`, `credits`. `src/lib/credits/creditModel.js` is a complete,
tested estimate-vs-actual model with drift reconciliation.

🔴 **`chargeLedger()` has exactly three production callers:**

```
netlify/functions/watchlist-monitor.js:389   monitor_check
netlify/functions/watchlists.js:206          monitor_check ("Check now")
netlify/functions/templates.js:318           template_run
```

Extraction, enrichment, audits and every AI call reach **none** of them.

### 2.2 The two cardinality proxies

These cap *count of objects*, not *consumption*:

- `L.scheduled_monitoring` — how many monitors may exist
- `L.batch_max_urls` — how large one list may be

Neither bounds monthly spend.

---

## 3. Leakage findings

### L1 · Scheduled audits bypass the quota check but still consume it
**Severity: high. Both a cost leak and a UX failure.**

`discoverability.js` gates interactive audits on `countAuditsThisMonth()`
(lines 1926, 2065). `discoverability-monitor.js:210` calls `store.createAudit()`
**directly, with no quota check** — yet the row it creates *does* count.

Consequences, both real:
1. **Over-delivery.** A Business plan (500 audits) with 25 daily schedules
   generates ~750 audits/month. 250 are never paid for.
2. **Self-starvation.** Because cron rows count, a background job can silently
   consume the customer's allowance, and their next *interactive* audit is
   refused with "You've used all 500 audits this month" — for audits they never
   ran and cannot see.

### L2 · Prompt monitors make unmetered AI calls
**Severity: high.**

`prompt-monitor.js` is scheduled `@daily` (netlify.toml:102) and calls
`sampleCitations()` → `runChain()` — real answer-engine calls. It writes
**nothing** to any meter.

`entitlementModel.js` `case "audit.prompt_monitor"` is gated at *create* time and
its own comment states the risk precisely:

> ⚠️ GATED BECAUSE IT SPENDS SOMEBODY ELSE'S QUOTA. A monitor makes real
> answer-engine calls on a cadence, without a human present to notice.

The gate caps monitors at `L.scheduled_monitoring`. It does not cap what they
spend. At `MAX_MONITORS_PER_TICK = 25`, daily, a Business account can sustain
~750 monitor runs/month — each sampling a whole prompt set — against an audit
allowance of 500. **Agency has `scheduled_monitoring: Infinity`.**

### L3 · Bulk enrichment is capped per-list, not per-month
**Severity: high — the largest unbounded surface.**

`case "bulk.enrich"` checks `rowCount > effective` where `effective =
batch_max_urls`. That is a **per-list size cap**. Nothing limits how many lists
a user creates, or how often a list is re-processed.

`bulk-runner.js` — the cron that does the work, calling `runChain()` per row via
`bulkEnrich.js:266` — contains **zero** metering hooks (verified by grep).

A Business account may therefore process 250-row lists indefinitely, at one AI
call per row, recording no consumption anywhere.

### L4 · No single view of spend
**Severity: medium (structural).**

Because M1/M2/M3 are disjoint, there is no query that answers "what did this
account cost us?". `creditModel.reconcile()` — built to detect mispriced
templates by comparing estimate to actual — can only see the ~3 % of activity
that reaches the ledger.

### L5 · P2 intelligence modules priced by tier proxy
**Severity: low. Noted for completeness — currently correct.**

`audit.business_truth`, `.entity_graph`, `.local_directory`, `.schema_trust`,
`.subject_score`, `.sxo`, `.portfolio` gate on `L.audits >= 25` and then
`return ok(Infinity)`.

**This is defensible today** and the code says why: these read and write the
customer's own records and make no provider call, so charging an audit would
bill for work nobody did. Verified — no `runChain` / `fetchWebVitals` /
`sampleCitations` call exists on these paths.

⚠️ **But the safety is incidental, not enforced.** The moment one of these
modules gains an AI call — an AI-written truth summary, an LLM entity resolver —
it becomes unmetered by default, and nothing fails. This is exactly how W9–W13
shipped ungated.

---

## 4. Proposal — one credit, one ledger

### 4.1 The unit

**A DatIQ Credit ≈ one unit of billable provider work.** Anchor it to the
cheapest real action so the number stays intuitive:

> **1 credit = one page fetch.**

Everything else is expressed as a multiple. Users keep seeing "extractions" and
"audits" in the UI where those words are clearer — but both *resolve to credits*
underneath, and the plan sells one pool.

### 4.2 Proposed weights

Grounded in what each action actually does today. **These are estimates and must
be calibrated against a month of real provider invoices before launch.**

| Action | Ledger reason | Credits | Why |
|---|---|---|---|
| Page fetch | `page_fetch` | 1 | the anchor |
| AI call (fast tier) | `ai_call` | 2 | ~1 model call, small budget |
| AI call (deep tier) | `ai_call` | 5 | larger token budget |
| Enrichment | `enrichment` | 3 | 1 fetch + 1 AI call |
| **Discoverability audit** | `audit` | **12** | ~2 fetches + robots + PageSpeed + citation sample + AI evaluator |
| Monitor check (page) | `monitor_check` | 1/page | already charged this way |
| Prompt-monitor sample | `monitor_check` | 2/prompt | one AI call per prompt |
| Bulk enrich row | `enrichment` | 3/row | 1 fetch + 1 AI call |
| Template run | `template_run` | sum of parts | already modelled |
| P2 module read/write | — | **0** | no provider call — free by *rule*, not by accident |

### 4.3 Plan pools

Derived so **no existing plan loses value** — each pool is the current
allowance converted at the weights above, rounded up:

| Plan | extractions | audits | Implied credits | Proposed pool |
|---|---|---|---|---|
| Free | 10 | 3 | 10 + 36 = 46 | **50** |
| Go | 200 | 10 | 200 + 120 = 320 | **350** |
| Select | 500 | 25 | 500 + 300 = 800 | **1,000** |
| Pro | 1,000 | 100 | 1,000 + 1,200 = 2,200 | **2,500** |
| Business | 10,000 | 500 | 10,000 + 6,000 = 16,000 | **18,000** |
| Developer | 10,000 | 250 | 10,000 + 3,000 = 13,000 | **15,000** |
| Agency | ∞ | 2,000 | — | **150,000** (soft, see below) |

⚠️ **Agency currently has `extractions: Infinity` AND
`scheduled_monitoring: Infinity`.** That is the single largest exposure in the
pricing table: unlimited monitors × unlimited extraction, with no meter. A
*fair-use* pool with overage pricing is the honest fix, and it is a **commercial
decision, not a technical one** — flagged, not assumed.

### 4.4 Keep the sub-caps as guardrails

Credits replace the *budget*; they do not replace the *guardrails*. Keep
`batch_max_urls` (protects the runner) and `scheduled_monitoring` (protects the
cron tick). A pool alone would let one account spend it in a single afternoon.

---

## 5. Migration plan

**Each phase ships and is verifiable on its own. No phase requires the next.**

### Phase 0 — stop the leaks (no pricing change)
Independently valuable; do this even if the rest is rejected.

1. **L1** — call the quota check in `discoverability-monitor.js` before
   `createAudit()`; on exhaustion, pause the schedule and record the reason, the
   way a robots refusal already does. *Never silently drop a run.*
2. **L2** — `chargeLedger({ reason: "monitor_check", unit: "monitor_check" })`
   in `prompt-monitor.js`, one entry per prompt sampled.
3. **L3** — `chargeLedger({ reason: "enrichment" })` per row in `bulk-runner.js`.
4. **L5** — add a parity test asserting no P2 route reaches `runChain` /
   `fetchWebVitals` / `sampleCitations`, so the "free because it costs nothing"
   claim fails loudly the day it stops being true.

### Phase 1 — observe (still no pricing change)
Write **every** cost-bearing action to `credit_ledger` in parallel with the
existing meters. Ship the weight table as data. Change no gate.

Then run `creditModel.reconcile()` over a full month and compare modelled
credits against real provider invoices. **Calibrate here, before anyone is
billed on it.** §4.2's numbers are estimates and should be expected to move.

### Phase 2 — show
Surface the credit balance in `/account` and the pre-flight estimate
(`creditEstimator.js` already exists). Users see credits accruing while still
being *gated* by the old meters. No one is refused on a number they have not
been watching.

### Phase 3 — switch
Move `entitlementModel.can()` onto the pool. Keep `extract`/`audit` as named
capabilities — they now resolve to credit costs. Keep the sub-caps.

### Phase 4 — sell
Top-up bundles become credit bundles (one SKU, not per-feature). Overage
pricing for Agency.

---

## 6. What NOT to do

- ❌ **Do not delete M1/M2 in Phase 1.** Dual-write first. The repo's own
  invoicing migration sequence (0012 → dual-write → 0013 → 0014) is the
  precedent, and its header says why.
- ❌ **Do not charge for refused, cached or failed work.** `chargeableEvents()`
  already encodes this; the gate order in `extract.js`
  (SSRF → entitlement → compliance → charge) exists to keep it true.
- ❌ **Do not make the P2 modules cost credits** while they make no provider
  call. Billing for work nobody did is the mirror of the leak.
- ❌ **Do not turn `already_approved`-style precision into a refusal.** Same
  lesson as 0077: more information must not become a new error.
- ❌ **Do not ship the weights un-calibrated.** A wrong audit weight
  re-prices every plan at once.

---

## 7. Open decisions for the owner

1. **Agency fair-use.** Unlimited × unlimited is the biggest exposure. Pool +
   overage, or hard cap?
2. **Do credits roll over?** Non-expiring credits are a deferred liability;
   monthly reset is simpler and matches the current model.
3. **Is the audit still sold as "audits"?** Recommended: keep the word in the
   UI, price it in credits underneath.
4. **Free tier at 50 credits** = 3 audits *or* 10 extractions, not both. Today
   they get both. Slightly more generous is fine; it should be a decision.
