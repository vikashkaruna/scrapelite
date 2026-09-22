# Unified Usage Credits — plan v4

> **Status: PROPOSAL. Nothing implemented.** Revised 2026-09-23 with the owner's
> final decisions, a dynamic actual-usage counter design, and the top-up /
> add-on model rebuilt around credits.
>
> Supersedes v3. Evidence trail:
> [CREDITS-UNIFICATION-ADDENDUM.md](./CREDITS-UNIFICATION-ADDENDUM.md).
> Measurements cite file and line; estimates say so.

---

## 0. Decisions — all settled

| # | Decision |
|---|---|
| D1 | Everything is sold as credits |
| D2 | **Rollover: carry ≤ 1× the monthly allowance**, FIFO, one-month life |
| D3 | Free does **not** reset — a one-time lifetime grant |
| D4 | **Free = 100 credits**, pure pool, first Discoverability run reserved |
| D5 | Registration required to **save** a result |
| D6 | Agency `scheduled_monitoring` capped at **100** |
| D7 | An audit is sold as **Discoverability** |
| D8 | Every unattended surface is metered |
| D9 | Guests are capped, not free |
| D10 | **`no_match` is charged** — a measurement is a result |
| D11 | **PageSpeed is charged** and included in paid plans |
| D12 | **The prompt surcharge applies to scheduled monitors AND interactive runs** |
| D13 | **Agency overage is sold per 1,000 credits** above 100,000 |
| D14 | The balance is computed from **actual usage**, not an estimate |

---

## 1. Weights — with PageSpeed now charged (D11)

> **1 credit = one page fetch.**

| Action | Credits | Note |
|---|---|---|
| Page fetch | 1 | the anchor |
| **PageSpeed (CrUX/PSI) call** | **1** | D11 — was 0 in v3 |
| AI call — fast | 2 | |
| AI call — deep | 5 | |
| Enrichment | 3 | 1 fetch + 1 fast AI; 4–5 when the related-page scan fires |
| **Discoverability run** | **19** | recount below |
| Citation prompt beyond the 5 defaults | **+2 each** | D12 — same rate scheduled or interactive |
| Monitor check (page) | 1 / page | |
| Prompt-monitor sample | 2 / prompt | D12 |
| Bulk enrichment row | 3 | |
| Template run | sum of parts | |
| P2 module read/write | **0** | no provider call — free **by rule** (§5) |

### The Discoverability recount

| Stage | Calls | Credits | Source |
|---|---|---|---|
| `collectPage` | 3 fetches (raw, rendered, crawler) | 3 | `fetchLayer.js:377` |
| canonical check | 1 fetch | 1 | `checkCanonicalTarget` |
| `fetchWebVitals` | 1 PSI call | **1** | D11 |
| `sampleCitations` | 5 AI calls (default set) | 10 | `citationSampling.js:56-68` |
| `evaluatePassage` | 1 AI call | 2 | `aiEvaluator.js:76` |
| `summariseAudit` | 1 AI call (first report view) | 2 | `aiEvaluator.js:233` |
| | | **19** | |

🔴 **At `MAX_PROMPTS_PER_AUDIT = 10` it is 29** (5 extra prompts × 2). The
surcharge is what keeps the most expensive run from being the cheapest per unit
of work — and D12 makes it identical whether a human pressed the button or a
cron did, because **the cost is identical and the unattended one is the larger
risk**.

### ⚠️ Free's reservation must track this
v3 raised it 12 → 18; D11 raises it again. **Reserve 19.** Re-derive it every
time the weight moves — a reserve that lags the weight means the one action
that demonstrates the product fails for a user who spent their pool first.

---

## 2. 🔴 The counter is a SUM over the ledger, never a stored number (D14)

> **Balance = Σ(grants not expired) − Σ(chargeable events).** No counter column.

This is the same rule the audit quota already follows, and its reasoning is
already written down in this repo: *"audits are counted from the `audits` table
with no counter column, deliberately, because a counter that drifts from the
rows it counts eventually bills somebody for work that is not there."*

### Charge from ACTUALS, never from the estimate

| Moment | What is used | Where it lives |
|---|---|---|
| Before a run | the **estimate**, shown to the user | `creditEstimator.js` ✅ exists |
| After a run | the **actual** events, written to the ledger | `chargeableEvents()` ✅ exists |
| Periodically | **estimate vs actual**, drift named by direction | `reconcile()` ✅ exists |

So "a run that fetched 2 related pages" is charged 2, and "a run that fetched
none" is charged 0 — the number follows the work, not the forecast.
`creditModel.js` already models exactly this, including `OVERRUN_TOLERANCE` and
the overrun/underrun distinction (*an overrun is a trust problem, an underrun is
a pricing problem*). **It is complete and has three callers; this plan gives it
the rest.**

### What is never charged (unchanged, and D10 sharpens one line)

| Outcome | Charge? | Why |
|---|---|---|
| Data returned | ✅ | we paid, they got value |
| **`no_match`** — the page genuinely lacks it | ✅ **D10** | a measurement is a result |
| `ai_chain_failed`, `no_key`, `truncated` | ❌ | our outage |
| Cached / unchanged pre-filter | ❌ | no provider call happened |
| Refused at a gate (SSRF, robots, entitlement) | ❌ | nothing was done |

### What has to be added to make it work

1. **`credit_ledger` grant rows gain `expires_at`** — rollover (D2) is FIFO over
   grants, so the oldest unexpired grant is drawn down first.
2. **A balance read**, cached ~60 s client-side exactly like `entitlementClient`
   — ⚠️ **UX only, never authorization**; the server re-sums before every
   charge, because a cached balance is a paint decision.
3. **Charge at the four choke points** (§5), with the caller's id and a reason.

**All three are small, and every model they depend on already exists.** That is
what makes D14 implementable now rather than after a rebuild.

---

## 3. Rollover (D2)

> Unused credits roll over. The carried balance is capped at **1× the monthly
> allowance**, rolled-over credits are spent **first (FIFO)** and **expire after
> one month**.

| Property | Effect |
|---|---|
| Carry cap = 1× monthly | at most **2 months'** worth held at once |
| Worst-case month | bounded at **2× the plan budget** — forecastable |
| FIFO + 1-month life | a balance cannot quietly compound |
| Free | no rollover concept — it is already a lifetime pool (D3) |

⚠️ **Publish the cap.** An undisclosed cap is the version that loses trust.

---

## 4. Plans, overage and top-ups

### 4.1 Monthly pools (recalculated at 19)

| Plan | $/mo | **Credits / month** | $/credit |
|---|---|---|---|
| **Free** | 0 | **100 one-time, never resets** | — |
| **Go** | 4.80 | **750** | 0.0064 |
| **Select** | 14.40 | **2,500** | 0.0058 |
| **Pro** | 20.40 | **6,000** | 0.0034 |
| **Developer** | 32.40 | **28,000** | 0.0012 |
| **Business** | 44.40 | **40,000** | 0.0011 |
| **Agency** | 106.80 | **100,000** | 0.0011 |

Price per credit declines monotonically, so upgrading is always better value
per unit — which is what makes the ladder rational.

### 4.2 Agency overage (D13)

> **$2.00 per 1,000 credits** above the 100,000 fair-use pool.

That is ~**2× Agency's committed rate** ($0.00107/credit) — enough that the pool
is worth committing to, far below any top-up pack, and it keeps the soft landing
from v2 intact: notify at 100 %, require an overage commitment at 150 %,
**never hard-stop mid-month** (an agency has client deliverables, and a hard
stop damages their customer, not ours).

### 4.3 🔴 Do top-ups still make sense? — Yes, but only half of them

This is the clarifying distinction, and it decides the whole section:

> **A CONSUMPTION limit is credits. A CAPACITY limit is not.**
>
> Extractions, Discoverability runs and enrichment are *spend* — once credits
> exist, a separate bundle for them is a second currency for the same thing.
> Monitor slots, workspaces and batch size are *structural caps* that protect
> the cron tick and the runner. **Buying credits must never hand you a 26th
> monitor slot**, and buying a slot must never hand you free runs.

| Today's bundle | Verdict | Why |
|---|---|---|
| **Extractions Bundle** ($9 / 100 extractions) | 🔴 **Retire → Credit Pack** | Pure consumption. Also mispriced: $0.09/credit is **14× Go's plan rate**. |
| **Batch Pack** ($9 / 50 URLs) | ✅ **Keep** | Caps list *size* — a runner guard, not spend |
| **Scheduled Monitor** ($5 / URL / month) | ✅ **Keep, with a correction** | Buys the **slot**. ⚠️ Its runs draw on the pool — state this plainly or customers will expect the runs to be included |
| **Extra Workspace** ($19) | ✅ **Keep** | Pure capacity, no provider call |

**And on Discoverability specifically:** under credits, `L.audits` is retired
and a run is pure consumption — so **there is no Discoverability add-on to
build. Buying credits *is* buying Discoverability capacity.** That is a real
simplification of the question rather than a dodge.

### 4.4 Proposed Credit Packs

Anchored at ~**3× the Select plan rate**, with volume breaks — expensive enough
that upgrading usually wins, cheap enough to be a reasonable answer to "I hit my
cap on the 20th".

| Pack | Credits | Price (USD) | $/credit | ≈ Discoverability runs | ≈ extractions |
|---|---|---|---|---|---|
| Small | **500** | $9 | 0.0180 | 26 | 500 |
| Medium | **2,000** | $29 | 0.0145 | 105 | 2,000 |
| Large | **10,000** | $119 | 0.0119 | 526 | 10,000 |

⚠️ **This is far more generous than today's bundle** ($9 buys 500 credits
instead of 100 extractions) — because today's bundle is priced 14× above the
plans it sits beside, which is not a pricing decision anyone made deliberately.
**Confirm the direction before it ships.**

### 4.5 Capacity add-ons — proposed credit consequences

| Add-on | Price | Buys | Credits it consumes |
|---|---|---|---|
| Scheduled Monitor | $5 / mo | **1 monitor slot** | runs draw on the pool: page monitor **1/page**, prompt monitor **2/prompt** |
| Batch Pack | $9 | +50 URLs of list size | rows draw on the pool at **3/row** |
| Extra Workspace | $19 / mo | +1 workspace | **0** — no provider call |

> The rule stated once: **an add-on buys the RIGHT to do something; the doing
> still costs credits.** A monitor slot that included its own runs would be a
> second, unmetered budget — which is exactly the shape of L1, L2 and L6.

---

## 5. Metering every unattended surface (D8)

### The structural rule

> **Meter at the CHOKE POINT, not per feature.** Exactly four functions spend
> money — `runChain`, `runScrapeChain`, `fetchWebVitals`, `sampleCitations`.
> Each writes to `credit_ledger` with the caller's id and a reason, so a new
> module that adds an AI call is metered **the day it lands**.

Pricing modules by hand is precisely how L0–L3 and L6 happened. A parity test
asserts no provider call reaches a choke point **without a caller id**, so a
module that would bill nobody fails the build.

### The register

| # | Surface | Fix |
|---|---|---|
| **L0** | **Enrichment** — `case "ai"` is an unconditional `ok()` | Draws on the pool. **Retire `enrichments_per_extraction`** — wrong axis: it caps depth per URL when the cost is per call. Keep a per-URL soft cap (~25) as a runaway guard only. |
| **L0b** | **Guests reach `/api/ai` free** | Stop failing open for guests. ⚠️ **Fail open on INFRASTRUCTURE, closed on an ABSENT entitlement** — a Supabase blip must not take extraction down, but "no account" is a known state with a known bucket (`guest_identities`), not an infrastructure failure. |
| **L1** | **Scheduled Discoverability** — `discoverability-monitor.js:210` calls `createAudit()` with no quota check | Check the pool **before** the run, debit 19, and **pause the schedule with a recorded reason** when exhausted, the way a robots refusal already does. Never silently drop a run. |
| **L2** | **Prompt monitors** (`@daily`) | 2 credits per prompt sampled (D12). Capped by monitor **count** and **spend**. |
| **L3** | **Bulk enrichment** | Keep `batch_max_urls` as the per-list guard; add a **monthly volume** cap from the pool; `chargeLedger` per row in `bulk-runner.js`. |
| **L5** | **P2 modules** | No provider call today → free **by rule**, guarded by the parity test. The moment one reaches a choke point it is metered — no first-call-free. |
| **L6** | **Extraction schedules** — `scheduled-runner.js:227` calls `runScrapeChain`, zero meter hooks | 1 credit per page read. |

---

## 6. Plan of work

| | Step | Notes |
|---|---|---|
| **A** | **Stop the leaks** — L0, L0b, L1, L2, L3, L5, L6 | Pure bug-fixing, correct under any pricing model. **Worth doing even if everything below is rejected.** |
| **B** | **Meter at the choke point** + parity test | Stops the list growing again. Before C, not after. |
| **C** | **Calibrate** — representative + synthetic workload against real provider invoices; replace §1 | §1 counts *calls*, not tokens. **The one step that cannot be skipped.** |
| **D** | **Dynamic counter** — `expires_at` on grants, balance as a SUM, 60 s UX cache, charge from actuals | §2. Every model it needs already exists. |
| **E** | **Switch** — one pool; retire `usage.extractions`, the audit row count, `enrichments_per_extraction`; Free's grant via the ledger's `grant` reason | No migration risk with no paid customers. |
| **F** | **Free-tier enforcement** — grant on verified email, disposable-domain blocklist, per-IP signup limit, monitoring; **no device fingerprinting** | With or just after E. |
| **G** | **Sell** — Credit Packs replace the Extractions Bundle; capacity add-ons stay; publish Agency fair use, the overage rate and the rollover cap; audits → Discoverability | After C confirms the weights. |

### What NOT to do
- ❌ Ship §1 un-calibrated — a wrong Discoverability weight re-prices every plan at once.
- ❌ Store the balance in a counter column — it drifts from the rows it counts.
- ❌ Charge the **estimate**. Charge the actuals; show the estimate.
- ❌ Reserve less than **19** for Free's first run.
- ❌ Let a capacity add-on include its own runs — that is a second unmetered budget.
- ❌ Keep a bundle that sells consumption alongside credits — two currencies for one thing.
- ❌ Meter per feature instead of per choke point.
- ❌ Let `checkCapability` fail closed on an INFRASTRUCTURE error.
- ❌ Add device fingerprinting.

---

## 7. Still open

1. **Credit Pack pricing direction** (§4.4) — the proposal is ~5× more generous per dollar than today's bundle, because today's is 14× above plan rate. Confirm.
2. **Does the Scheduled Monitor add-on stay at $5** once its runs are visibly drawn from the pool? It is now buying strictly less than it appeared to.
3. **Deep-tier AI at 5** is a placeholder ratio — step C should measure it against fast-tier spend rather than assume 2.5×.
