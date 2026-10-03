# Credit Charges — Calculation and Calibration

> **Status: 2026-09-30.** Companion to `docs/CREDITS-UNIFICATION-PROPOSAL.md` and
> `src/lib/credits/creditWeights.js`. Explains, surface by surface, what a run costs,
> where the number comes from, and where quote and charge can drift. Includes the
> findings of the 2026-09-30 calibration audit (template double-billing fixed;
> three unmetered touch points flagged for a pricing decision).

---

## 1. The machinery (read this first)

### 1.1 The one price list

`src/lib/credits/creditWeights.js` — imported by both the browser (estimates) and the
functions (charges), so a quote and a ledger row can never disagree about what a unit costs.

| Kind | Credits | Notes |
|---|---|---|
| `page_fetch` | 1 | one page read by a scrape provider |
| `ai_fast` | 2 | classification / link tagging / citation samples — small fixed-answer work |
| `ai_deep` | 5 | structured extraction, synthesis, briefs, summaries — frontier-model work |
| `pagespeed` | 1 | one PageSpeed Insights lookup (Discoverability) |
| `monitor_page` / `monitor_prompt` | 1 / 2 | renamed page reads / prompt samples inside monitoring |
| `citation_prompt_extra` | 2 | each citation prompt beyond the default 5 |
| `outreach_email` | 1 | one outbound email from the Prospect Engagement Engine |

⚠️ **These are counts of provider calls, not tokens.** A `deep` call with a big token
budget costs the same 5 as a small one — the weights measure "how many times did we reach
a provider", because that is the number every surface shares.

### 1.2 The two charging paths

1. **Choke-point meters** — `runChain`, `runScrapeChain`, `fetchWebVitals`,
   `sampleCitations` route every cost-bearing call through `creditMeter.record()`,
   flushed once per request to the ledger against the verified user. This covers
   `/api/extract` and `/api/ai` for **all** surfaces.
2. **Template finish events** — a template run accumulates events client-side and
   `templates.js {action:"finish"}` writes them to the ledger, attributed to the run and
   reconciled against the pre-run estimate. For template traffic the choke points are
   **suppressed** (`meterScope: "template_run"` → `meterContext({suppressed: true})`),
   so the run is billed exactly once.

### 1.3 What is never charged

- **A call that did not land** — a provider error (`failed`), a cache hit (`cached`), or a
  content-hash skip (`skipped`) writes nothing. Not a zero row — nothing.
- **A run refused at a gate** — SSRF, robots/compliance, entitlement, guest limit, rate
  limiter and insufficient-credits checks all sit **above** the first metered call.
- **Bookkeeping reads** — robots.txt compliance reads, balance checks, report loads.
- **Guests' ledger rows** — a guest has no user id; their rows (where they exist) bill
  nobody. Guests are bounded by the separate guest-usage bucket, not by credits.

### 1.4 Estimate vs charge vs affordability check — three different numbers

| Number | What it is | Where it lives |
|---|---|---|
| **Estimate** | the itemised quote shown before a run | `templateModel.estimateCredits` (templates), `creditEstimator` (pages-only floor on Home/Batch) |
| **Affordability check** | "would this run fit in the remaining allowance?" — never ledgered | `creditMeter.affords()`, `creditModel.checkAllowance()` |
| **Charge** | what the pipeline actually did, written to `credit_ledger` | choke-point meters + template finish events |

The charge is always **from actuals**. A run that was cut short by its deadline costs less
than one that completed; a run whose citation sample was skipped costs less than one that
completed. If the actual exceeds the estimate by more than 25% the run is flagged
`overrun` — that is a pricing defect to fix, not the user's problem to absorb silently.

---

## 2. Surface by surface

### 2.1 Home / Preview extraction (single URL)

**Path:** `/api/extract` → choke-point meters. Not template traffic — no events involved.

| Component | Credits | When |
|---|---|---|
| Page fetch | 1 | every landed scrape (a fallback retry that also lands adds 1) |
| AI extraction (schema / enrichKey / custom prompt) | 5 (deep) | when the structured-extraction AI call lands |
| AI link categorization (Preview) | 2 (fast) | when the AI classify path runs (heuristic fallback is free) |
| Related-page scans | 0 | see §4.3 calibration note |

**Range: 1–8 credits.**

Examples:
- Paste a URL, extract headings only → **1**.
- Home custom extraction ("find their pricing") → 1 page + 5 AI = **6**.
- Preview extraction with schema + AI link categorisation → 1 + 5 + 2 = **8**.
- The scrape provider fails three times then succeeds → still **1** (failures are free).

### 2.2 Preview enrichment (Quick Enrichment tabs)

**Path:** `/api/extract` with an `enrichKey` (contacts / leadership / social / mission /
pricing / talent) → choke-point meters.

| Component | Credits | When |
|---|---|---|
| Page fetch (base page) | 1 | always (cache hit = 0) |
| Capability AI extraction | 5 (deep) | when it lands |
| Related-page gathering (/about, /pricing, …) | 0 | see §4.3 |

**Range: 1–6 credits per capability run** (typically **6**).
The AI **summary card** and each **Generate content** format are separate `/api/ai`
synthesis calls: **5 each**. Re-opening an existing tab costs nothing (cached report);
the **Refresh** button re-runs it (6 again).

### 2.3 Batch / bulk enrichment

**Path:** bulk runner → per row: `runScrapeChain` + one classification-area AI call.
**Charged per row, from actuals — there is no run-level consolidation AI.**

| Component | Credits | When |
|---|---|---|
| Page fetch | 1 | every landed fetch |
| Inference (industry, employee band, ICP signals) | 2 (fast) | when the row has enough text and AI is enabled |

**Range: 1–3 credits per row.**

Examples:
- 100 rows, all fetched and inferred → **300**.
- 100 rows, 20 with too little text to infer → 100 + 80×2 = **260**.
- A row whose fetch fails → **0** for that row (retried free later).

A 50-row run that costs 150 credits against a quote of "3 per row" is on estimate; the
`overrun` flag only trips when actuals systematically exceed the model.

### 2.4 Discoverability audit

#### Interactive (`/discoverability` → Run audit)

**Path:** audit pipeline → `fetchLayer` + `fetchWebVitals` + `sampleCitations` +
`evaluatePassage`, all metered at the choke points.

| Stage | Credits |
|---|---|
| Raw HTML fetch | 1 |
| Crawler-check fetch (robots origin) | 1 |
| Canonical HEAD check | 1 (skipped free when the canonical is self-referencing) |
| PageSpeed Insights lookup | 1 |
| Citation sample — 5 prompts × fast AI | 10 |
| Passage evaluation — 1 fast AI call (the `discoverability` area ships on the fast tier) | 2 |
| **Typical in-run total** | **16** |
| Executive summary (lazy — first report view) | 0 today — ⚠️ unmetered, see §5.2 |

Extra citation prompts beyond the default 5 cost 2 each. A skipped citation sample (budget)
costs 0. **Range: ~8–16+ for the run itself**, ~16 typical.

#### Scheduled (Discoverability monitor / recurring audits)

**Identical pipeline, identical actuals** — `discoverability-monitor.js` builds a meter
per scheduled run and flushes the same choke-point charges. Nothing is double-charged and
nothing is quoted-then-flattened: a re-audit whose citation sample was cut by budget
genuinely costs less than the first run.

#### What `discoverabilityCredits()` = 19 means (the affordability check)

`DISCOVERABILITY_BASE = 19` in `creditWeights.js` is a **recount of the pipeline's price** —
the number the product quotes for "one audit" — and `discoverabilityCredits(promptCount) =
19 + (extra prompts × 2)`.

It is **never written to the ledger**. It is used in exactly two places:

1. **`affords()`** — before opening a scheduled audit run, the monitor asks "does this
   user's remaining allowance cover a 19-credit audit?" If not, the schedule is **paused**
   with the message "out of credits: this audit costs 19 and N remain". Pausing on the
   quote rather than the actual is deliberate: a schedule that ran, spent 12, and only
   then discovered the pool was empty would produce a half-charged trend point.
2. **Plan pricing and the free-tier reserve** — the Free plan's 100-credit lifetime pool
   is sized as "five Discoverability runs" (5 × 19 ≈ 95 + headroom).

The ledger charge itself remains whatever the pipeline actually did (~16 typical today —
the 2-credit delta is the lazy executive summary, §5.2). So: **19 is the price tag, ~16 is
the receipt**, and the gap is a known, documented calibration drift, not a bug.

### 2.5 Watchlists (on-demand "check now")

**Path:** `watchlists.js` → per page actually snapshotted, one explicit ledger row
(`monitor_check`, 1 credit). **No AI anywhere in this path** — change detection is a
content hash, which is why it can run cheaply on demand.

| Component | Credits | When |
|---|---|---|
| Each page snapshotted | 1 | per page, per check |
| Discovery crawl for a brand-new target | 0 today — ⚠️ see §5.2 |
| Change evaluation / alerts | 0 | deterministic hash comparison |

**Range: 1 × (number of pages actually read).** A watchlist target whose three monitored
pages all get read = **3**. An unchanged page still costs 1 (it had to be read to know
that); an unreadable page costs 0.

### 2.6 Watchlists — multiple domains/URLs (the consolidation question)

A watchlist is `targets × pages`. **Each target is metered independently, page by page.
There are no cross-target AI calls and no consolidation step** — the engine compares each
page against its own previous snapshot (hash) and fires rules per material change.

Example: a watchlist with 5 competitor domains × up to 8 discovered pages each,
all due in one tick → up to **40 credits**. Adding a 6th competitor costs 0 immediately;
its **first** tick discovers and snapshots its pages (each 1 credit — that is the baseline
every later comparison needs), then each cadence tick costs 1 per page read.

If you want an AI "what changed across my competitors this week" digest, that feature does
not exist yet — when it does, it should be quoted as a synthesis call (5) per digest and
metered at the choke point like every other AI call.

### 2.7 Watchlist / prompt monitors (cron)

**Watchlist monitor** (`watchlist-monitor.js`): the cron path meters at the choke point
with a `kindMap` (`page_fetch` → `monitor_page`), one ledger row per target per tick,
**including the discovery crawl** for newly added targets (the earlier hand-rolled charge
missed it — that was the point of the refactor).

| Component | Credits | When |
|---|---|---|
| Each page read (snapshot or discovery) | 1 | per page, per due target |
| Material-change detection + rule firing | 0 | deterministic |

**Prompt monitor** (`prompt-monitor.js`): per tick, `sampleCitations` runs the monitor's
prompt set against a live answer engine — **2 credits (fast AI) per prompt that landed**.
A 5-prompt monitor = **10 per tick**; 3 landed + 2 failed = **6**.

### 2.8 Prompt monitors — multiple domains/URLs

Same answer as §2.6, one level up: each monitor is scoped to one domain and one prompt
set; N monitors = N × prompts × 2. There is **no consolidation AI** across monitors — each
monitor's evidence (citation URLs, engine answers) is stored per run and rendered as its
own trend line. A "portfolio view" across monitors would be a new, quotable surface.

### 2.9 Scheduled extractions (fingerprint schedules)

`scheduled-runner.js` re-fetches each due schedule's target(s) via the scrape chain and
charges through the choke point with `kindMap` → `monitor_check` (**1 per page read**).
No AI. A daily schedule over one URL = ~30 credits/month.

### 2.10 Prospect Engagement Engine (emails)

`engagement-dispatcher.js` → every outbound message is metered **`outreach_email` = 1**,
with an affordability check before send (an account out of credits gets its messages
deferred as `insufficient_credits`, not silently dropped). WhatsApp/SMS must get their own,
higher weights before those channels open — never reuse this one.

---

## 3. Template runs (after the 2026-09-30 fix)

Included here because the template estimate is the one quote users see itemised.

**Quote** (`estimateCredits`, mirrored from what the runner actually spends):

```
Workflow setup (base)            cost.base                      e.g. 1–2
Pages fetched                    units × pages_per_unit         e.g. 3–4
                    + extra_subpages × units      0–4 each
AI extraction                    units × 5 (deep tier)          the structured-extraction call
AI synthesis                     units × (bundle prompts) × 5   summarize / talking_points /
                                                                questions / comparison, as declared
                                                                ai_depth=quick → 0
```

Custom fields ride **inside** the extraction call (the schema grows, the call count does
not) — no surcharge. `credit_cost.units_extra: 1` makes the Visibility Brief count the
user's own domain in addition to the competitor list.

**Charge** (finish events, from actuals): pages actually read (1 + related scans — this is
where related pages ARE billed), the extraction AI call only if it landed (priced from
`enrichment_meta.tier`), each landed synthesis call priced from the response's `_tier`.
Failed, cached or skipped work is dropped.

**Worked example — Account Brief, standard depth, 3 pages read, everything landed:**

| | Estimate | Charge |
|---|---|---|
| Workflow setup | 1 | — |
| Pages (3) | 3 | 3 |
| AI extraction (deep) | 5 | 5 |
| AI synthesis (2 prompts × deep) | 10 | 10 |
| **Total** | **19** | **18–19** |

Before the fix the same run quoted 8 and actually billed ~32 (double-metered, flat-2 AI).
Deep mode costs the same as standard — it buys a bigger token budget, not more calls; the
weights count calls, not tokens. Visibility Brief (2 competitors + own domain, 3 synthesis
prompts): quote ≈ 2 + 9 + 15 + 15 = **41**.

---

## 4. Calibration findings (2026-09-30 audit)

### 4.1 Fixed

- **Template double-billing** — every template run's fetches and AI calls were ledgered
  twice (choke points + finish events; ~3–4× the quote). Fixed with
  `meterScope: "template_run"` → suppressed choke-point context; the run's events are the
  one charge. Verified in the live ledger (zero choke-point rows during template traffic)
  and the full e2e matrix (535/0).
- **Flat-2 AI pricing** — template AI events now price from the tier that actually ran.
- **Estimate drift** — `estimateCredits` rewritten to mirror the runner (ai_depth-aware,
  bundle-derived synthesis count, own-domain unit for the Visibility Brief);
  `per_ai_call` / `ai_calls_per_unit` seed keys retired.

### 4.2 Unmetered touch points found — a pricing decision is owed

These spend real provider money and bill nobody. They are flagged, not silently "fixed" —
each needs the owner's pricing decision, and a weight added to `creditWeights.js` (the
parity tests will then force the metering in).

| # | Touch point | What it costs us | Recommendation |
|---|---|---|---|
| 1 | **Signal-rule EMAIL actions** (`signalDispatch.js`) — a material change emails the user via Resend. Slack/webhook/HubSpot actions are negligible. | ~1 email per material change | Meter as `outreach_email` (1), same as the Engagement Engine; or document alert emails as included in the plan |
| 2 | **Discoverability executive summary** — `summariseAudit` runs lazily on first report view through `runChain` **without a meter**. | 1 fast AI call per audit's first reader | Thread a meter through `summaryRoute`; add 2 to the audit's actuals (bringing the receipt to the quoted 19) |
| 3 | **Map mode** (`runMapChain` — Home "Map entire domain") — the map provider call is not metered. | 1 provider call (Firecrawl /map) per mapping | Meter as `page_fetch` (1) — it is one provider call for one URL's URL list |
| 4 | **Related-page scans on non-template paths** — `gatherRelatedPages` (extract.js) reads up to 7–11 same-domain pages per extraction; the choke point bills only the base page (1). Template runs DO bill them (their events count `pagesRead`); Home/Preview enrichments do not. | up to ~10 unmetered fetches per enrichment run | Either fold into the enrichment price deliberately (raise `ai_deep`-bearing runs' quote) or meter each related read as `page_fetch`. The current behaviour undercharges Preview enrichment by up to ~10 credits/run vs the "1 credit = one page fetch" anchor |

*(Also not metered, by design: robots/compliance reads — a gate, not billable work;
report/diff/CSV rendering — client-side; guests — bounded by the guest bucket instead.)*

### 4.3 SXO, Outcomes and the other Discoverability tabs (7.2)

**Zero additional credits, by construction.** The audit produces one payload per run —
pillar scores, signal findings, entity data, content coverage, outcome tiles — and every
report tab (Technical, Content, SXO, Citations, Outcomes, Trends, Diffs) is a *rendering*
of that same payload. `outcomeTiles.js`, `auditDiff.js` and the scoring models are pure
client-side code with no fetch calls: opening ten tabs costs the same as opening none.
Re-running an audit re-runs the pipeline and costs a new ~16; comparing two existing audits
is free.

### 4.4 Watchlist Rule Engines (7.1)

The "rule engine" is the **signal-rules** layer (PRD 5 / migration 0085): rules with
conditions ("notify me when competitor X's pricing page changes materially") routed to
actions (Slack / email / webhook / HubSpot).

- **Rule evaluation: 0 credits.** Conditions are evaluated against the change event
  deterministically — no model is asked whether a change "matters".
- **Rule actions: 0 credits today** — including the email action, which is exactly the
  unmetered send flagged in §4.2 (#1). If alert emails get priced, it is one weight
  (`outreach_email`) plus a meter line in `signalDispatch.performAction`.
- Backoff/retry of failed dispatches (`reengagement-handler`) never re-evaluates rules and
  never re-charges; delivery retries are our cost.

---

## 5. Quick reference — typical ranges

| Surface | Typical | Range | Notes |
|---|---|---|---|
| Home extraction (fetch only) | 1 | 1–2 | provider fallback can add 1 |
| Home custom extraction | 6 | 1–6 | +2 if AI link categorisation runs |
| Preview Quick Enrichment (per capability) | 6 | 1–6 | +5 per AI summary / generated format |
| Batch / bulk row | 3 | 1–3 | × row count; no consolidation |
| Discoverability audit (in-run) | 16 | ~8–16 | +2 per extra citation prompt; summary lazy |
| Discoverability monitor tick | 16 | ~8–16 | same pipeline |
| Watchlist check (per page) | 1 | 1 | × pages; no AI; discovery crawl unmetered today |
| Prompt monitor tick | 10 | 2 × prompts landed | per monitor |
| Scheduled extraction (per page) | 1 | 1 | `monitor_check` |
| Engagement email | 1 | 1 | affordability-gated |
| Template run | 19–41 | varies | itemised quote = charge (§3) |
| Anything failed / cached / refused | 0 | 0 | the rule that outranks all others |
