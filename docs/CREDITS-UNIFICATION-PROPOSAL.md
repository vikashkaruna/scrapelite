# Unified Usage Credits — plan v3

> **Status: PROPOSAL. Nothing implemented.** Revised 2026-09-23 with the owner's
> second round of decisions, a **measured** Discoverability weight, and a
> module-by-module map of the revenue loop.
>
> Supersedes v2. The evidence trail stays in
> [CREDITS-UNIFICATION-ADDENDUM.md](./CREDITS-UNIFICATION-ADDENDUM.md).
> Measurements are cited to file and line; estimates say so.

---

## 0. Decisions carried in

| # | Decision | Source |
|---|---|---|
| D1 | Everything is sold as credits | owner |
| D2 | **Rollover: capped, 1 month** — see §1, this is a recommendation | this doc |
| D3 | Free does **not** reset — a one-time lifetime grant | owner |
| D4 | **Free = 100 credits**, pure pool, with the first Discoverability run reserved | owner |
| D5 | Registration required to **save** a result | owner |
| D6 | Agency `scheduled_monitoring` capped at **100** | owner |
| D7 | An audit is sold as **Discoverability** | owner |
| D8 | Enrichment, scheduled audits, prompt monitors and bulk are all metered | owner |
| D9 | Guests are **capped**, not free — `checkCapability` stops failing open for them | owner |

---

## 1. Rollover — recommendation: **capped, one month**

The question is not "do customers like rollover" (they do) but **what does
rollover cost a business whose unit costs are variable?** DatIQ's costs are
per-provider-call, not fixed capacity, so an unused credit is a real deferred
liability rather than idle server time somebody already paid for.

### Why unlimited rollover is wrong here
A customer banks twelve months, then spends it in one week. Nothing caps the
provider bill in that week, and it lands in a month whose revenue already
closed. That is precisely the exposure this whole exercise exists to remove.

### Why no rollover at all is also wrong here
🔴 **DatIQ is a monitoring product, and that changes the usual argument.**
Monitors run whether or not anyone signs in, so a quiet month still consumes
credits — the "I paid and used nothing" complaint is rarer here than in a
seat-based tool. But the mirror case is real and common: a customer audits a
client's site heavily in week one, then watches. Hard expiry punishes exactly
the usage shape the product encourages.

### The recommendation

> **Unused credits roll over, the carried balance is capped at 1× the monthly
> allowance, and rolled-over credits are spent FIRST (FIFO) and expire after
> one month.**

| Property | Effect |
|---|---|
| Carry cap = 1× monthly | A customer can hold at most **2 months'** worth at once |
| Worst-case monthly spend | Bounded at **2× the plan's budget** — forecastable |
| FIFO | The oldest credits burn first, so a balance cannot quietly compound |
| Free tier | **No rollover concept** — it is already a lifetime pool (D3) |

This removes "I lost credits I paid for" without creating an unbounded
liability, and keeps the worst month arithmetically knowable. ⚠️ **State the
cap on the pricing page.** An undisclosed cap is the version that loses trust,
the same reasoning as Agency fair use.

---

## 2. 🔴 The Discoverability weight WAS wrong — measured, not estimated

v2 priced a Discoverability run at **12 credits**. That was a guess, and the
guess was low. Counted from the pipeline:

| Stage | Calls | Source |
|---|---|---|
| `collectPage` | **3 fetches** — raw, rendered, crawler, in one `Promise.all` | `fetchLayer.js:377` |
| canonical check | +1 fetch (conditional) | `checkCanonicalTarget` |
| `fetchWebVitals` | 1 PageSpeed call — **free at low volume**, keyless fallback | `webVitals.js` |
| `sampleCitations` | **5 AI calls** on the default prompt set (3 subject + 2 brand) | `citationSampling.js:56-68` |
| `evaluatePassage` | 1 AI call | `aiEvaluator.js:76` |
| `summariseAudit` | 1 AI call — lazy, on first report view | `aiEvaluator.js:233` |

At the v2 weights (page = 1, AI fast = 2):

| Path | Arithmetic | Credits |
|---|---|---|
| Default run | 4 fetches + 6 AI | **16** |
| …plus the exec summary nearly everyone opens | +1 AI | **18** |
| 🔴 At `MAX_PROMPTS_PER_AUDIT = 10` | 4 fetches + 11 AI | **26** |

**v2's 12 was ~33 % low on the default path and ~54 % low at the ceiling.**

### Proposed calibrated weight

> **A Discoverability run costs 18 credits, plus 2 for each citation prompt
> beyond the 5 defaults** (so a 10-prompt run is 28).

⚠️ **The variable part is not a detail.** `MAX_PROMPTS_PER_AUDIT` is 10 and the
prompt set is caller-supplied, so a flat price makes the most expensive audit
the cheapest per unit of work — and it is the one an engaged customer runs.
Charging for the prompts they chose is both honest and self-limiting.

⚠️ **This is still a MODEL, not an invoice.** It counts *calls*, not tokens; a
deep-tier model or a long page costs more than a fast-tier call on a short one.
Step **B** (§6) exists to replace these numbers with measured spend, and 18 is
the figure to calibrate *against*, not to ship unexamined.

### What this does to D4's reservation
🔴 **The Free reservation must track the weight.** The owner's instruction said
reserve **12**; at the calibrated weight the first run costs **18**, so a 12-
credit reserve under-reserves and the very first Discoverability run — the one
action that demonstrates the product — fails for a user who spent 89 credits on
enrichment first. **Reserve 18, and re-derive it whenever the weight moves.**

---

## 3. The revenue loop, module by module

Verified by grep for `runChain` / `runScrapeChain` / `fetchWebVitals` /
`sampleCitations` / `collectPage` across `netlify/functions/`.

| Step | Surface | Provider calls today | Credits |
|---|---|---|---|
| 1.1–1.4 | **Audit** | 4 fetches + 6 AI | **18** (+2/extra prompt) |
| 2 | Business Truth | none | **0** |
| 3 | Schema & Trust | none | **0** |
| 4 | Entity Graph | none | **0** |
| 4 | Local Directory | none *today* — a real connector changes this | **0** |
| 5 | Subject Scores | none — computation over stored rows | **0** |
| 6 | SXO & Outcomes | none — aggregates stored scores | **0** |
| ↻ | Re-audit | identical to the audit | **18** |

And the surfaces that run without anyone watching:

| Surface | Cost | Metered today? |
|---|---|---|
| Scheduled Discoverability (`discoverability-monitor`) | 18 / run | 🔴 **no quota check at all** (L1) |
| Prompt monitor (`@daily`) | 2 / prompt sampled | 🔴 **nothing** (L2) |
| Bulk enrichment row (`bulk-runner`) | 3 / row | 🔴 **nothing** (L3) |
| Enrichment (`/api/ai`) | 3 (4–5 with related-page scan) | 🔴 **nothing, and guest-reachable** (L0) |
| **Extraction schedule (`scheduled-runner`)** | 1 / page | 🔴 **nothing — NEW, §4** |
| Watchlist monitor | 1 / page | ✅ correct |
| Template run | sum of parts | ✅ correct |

### 🔴 The rule that makes this survive the next feature

Pricing each module by hand is how L0–L3 happened: somebody adds a module, the
metering is a separate step, and nobody remembers. The fix is structural.

> **Meter at the CHOKE POINT, not per feature.** Exactly four functions spend
> money — `runChain`, `runScrapeChain`, `fetchWebVitals`, `sampleCitations`.
> If each one writes to `credit_ledger` with the caller's id and reason, then a
> new module that adds an AI call is metered **on the day it lands**, with no
> one having to remember.

That is the direct answer to *"any similar call leaking credits must fall under
credits usage consideration."* It converts the rule from a habit into a
property of the code. ⚠️ Pair it with the parity test from §5/L5 so a module
that reaches a provider **without** a caller id fails the build rather than
billing nobody.

---

## 4. 🔴 NEW leak found while calibrating — L6

**`scheduled-runner.js` re-scrapes on a cadence and meters nothing.**

It is the `@hourly` cron behind every user extraction schedule, it calls
`runScrapeChain` (line 227), and a grep for `chargeLedger` /
`trackExtraction` / `consumeGuestCredit` / `checkCapability` across the file
returns **zero**.

So a user with schedules consumes provider calls every hour, for ever, against
no budget — the same shape as L1 and L2, on the oldest cron in the product.
It was not in the original list because the audit stopped at the discoverability
surface. **Add it to step A.**

---

## 5. The leak register, with the owner's decisions applied

| # | Surface | Fix |
|---|---|---|
| **L0** | **Enrichment** | `case "ai"` stops being an unconditional `ok()`. Retire `enrichments_per_extraction` (**wrong axis** — it caps depth per URL when the cost is per call); enrichment draws on the pool. Keep a per-URL soft cap (~25) purely as a runaway guard. |
| **L0b** | **Guests reach `/api/ai` free** | `checkCapability` stops failing open for a guest. ⚠️ **Fail open on INFRASTRUCTURE, closed on an ABSENT entitlement** — a Supabase blip must still not take extraction down, but "no account" is a known state with a known bucket (`guest_identities`), not an infrastructure failure. |
| **L1** | **Scheduled Discoverability** | Check the quota **before** `createAudit()` (`discoverability-monitor.js:210`), debit the pool, and **pause the schedule with a recorded reason** when exhausted — the way a robots refusal already does. Never silently drop a run. |
| **L2** | **Prompt monitors** | `chargeLedger` one `monitor_check` per prompt sampled. Capped by monitor **count** (existing) **and** spend (new). |
| **L3** | **Bulk enrichment** | Keep `batch_max_urls` as the per-list guard; add a **monthly volume** cap drawn from the pool, and `chargeLedger` per row in `bulk-runner.js`. |
| **L5** | **P2 modules** | They make no provider call today, so they stay **free by rule, not by accident**: a parity test asserts no P2 route reaches the four choke points. The moment one does, it is metered — no first-call-free. |
| **L6** | **Extraction schedules** | §4. Meter `scheduled-runner.js` per page read. |

---

## 6. Plans — recalculated at the measured weight

Sized so **no plan loses capability**, with the audit at 18 (not 12) and
enrichment now metered. Rollover per §1: carry ≤ 1× monthly, FIFO, 1-month life.

| Plan | $/mo | **Credits / month** | $/credit | Covers (illustrative) |
|---|---|---|---|---|
| **Free** | 0 | **100 one-time, never resets** | — | 1 Discoverability (18, reserved) + 10 extractions + ~24 enrichments |
| **Go** | 4.80 | **750** | 0.0064 | 200 ext + 10 Disc + ~100 enrich = 680 |
| **Select** | 14.40 | **2,500** | 0.0058 | 500 ext + 25 Disc + ~250 enrich = 1,700 |
| **Pro** | 20.40 | **6,000** | 0.0034 | 1,000 ext + 100 Disc + ~500 enrich = 4,300 |
| **Developer** | 32.40 | **28,000** | 0.0012 | 10,000 ext + 250 Disc + ~5,000 enrich = 29,500* |
| **Business** | 44.40 | **40,000** | 0.0011 | 10,000 ext + 500 Disc + ~5,000 enrich = 34,000 |
| **Agency** | 106.80 | **100,000** | 0.0011 | modelled real usage ≈ 15,800 → ~6× headroom |

\* Developer's illustrative mix slightly exceeds its pool — deliberate. It is an
API tier whose real mix is extraction-heavy and Discoverability-light, not the
balanced mix shown.

**Price per credit declines monotonically** — `0.0064 → 0.0058 → 0.0034 →
0.0012 → 0.0011 → 0.0011` — so upgrading is always better value per unit, which
is what makes the ladder rational.

⚠️ **Every plan gains extraction-equivalent headroom except Agency**, which
trades "unlimited" for a published ceiling because a currency cannot express
infinity.

---

## 7. Plan of work

| | Step | Notes |
|---|---|---|
| **A** | **Stop the leaks** — L0, L0b, L1, L2, L3, L5, **L6** | Pure bug-fixing, correct under any pricing model. **Worth doing even if everything below is rejected.** |
| **B** | **Meter at the choke point** — the four functions write to `credit_ledger` with a caller id; parity test forbids a provider call without one | This is what stops the list from growing again. Do it before C, not after. |
| **C** | **Calibrate** — run a representative + synthetic workload, compare modelled credits to real provider invoices, replace §2's numbers | Days. §2's 18 is a counted model, not measured spend. **The one step that cannot be skipped.** |
| **D** | **Switch** — one pool, one ledger, rollover per §1; retire `usage.extractions`, the audit row count and `enrichments_per_extraction`; Free's one-time grant via the ledger's existing `grant` reason | No migration risk with no paid customers. |
| **E** | **Free-tier enforcement** — grant on verified email, disposable-domain blocklist, per-IP signup limit, anomaly monitoring; **no device fingerprinting** | Ships with or just after D. |
| **F** | **Sell** — credit bundles as one SKU; publish Agency fair use and the rollover cap; rename audits → Discoverability | After C confirms the weights. |

### What NOT to do
- ❌ Ship §2's weights un-calibrated — a wrong Discoverability weight re-prices every plan at once.
- ❌ Charge for refused, cached or failed work (`chargeableEvents()` already encodes this).
- ❌ Reserve 12 for Free's first run — the calibrated cost is **18** (§2).
- ❌ Lower `enrichments_per_extraction` instead of retiring it — wrong axis.
- ❌ Meter per feature instead of per choke point — that is how L0–L3 and L6 happened.
- ❌ Let `checkCapability` fail closed on an INFRASTRUCTURE error while closing the guest hole.
- ❌ Add device fingerprinting.

---

## 8. Still open

1. **Rollover cap** — 1× monthly recommended (§1). Confirm, or pick a different multiple.
2. **Charge for a genuine `no_match`?** *(Recommended: yes — a measurement is a result.)*
3. **Agency overage price** per 1,000 credits above 100,000.
4. **Does the prompt surcharge apply to scheduled prompt monitors**, or only interactive runs? *(Recommended: both — the cost is identical and unattended spend is the larger risk.)*
5. **PageSpeed** is free at low volume and falls back to keyless. Price it at 0 now and revisit if a paid quota is ever needed.
