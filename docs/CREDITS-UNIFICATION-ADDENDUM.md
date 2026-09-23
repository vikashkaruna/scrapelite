# Unified Credits — Addendum: enrichment, workflows, integrations, Agency, and going direct

> **Status: SHIPPED (2026-09-23).** Every recommendation below was implemented
> and all four open decisions in §5 are closed — see **§6** for what shipped and
> where it diverged. The analysis above is left as WRITTEN, not edited to match
> the outcome: it is the reasoning that produced the decisions, and rewriting it
> to agree with them would destroy the record of why they were made.
>
> Companion to [CREDITS-UNIFICATION-PROPOSAL.md](./CREDITS-UNIFICATION-PROPOSAL.md),
> answering four questions raised 2026-09-22.

---

## 0. New finding — enrichment is the biggest leak, and it was missed

**The owner's instinct was right, and the reality is worse.** Enrichment is not
merely unmetered — its gate is **inert on every plan, and it is reachable by
guests**.

The chain, verified end to end:

| Step | Code | Result |
|---|---|---|
| 1 | `ai.js:158` → `checkCapability(resolved, "ai", ctx)` | the only gate |
| 2 | `entitlementModel.js` `case "ai": return ok();` | **unconditional pass — "Not plan-gated today"** |
| 3 | Guests | `checkCapability` **fails open for guests** by design |
| 4 | Client calls `billing.trackEnrichment(url)` | writes `usage.enrichments[url]` |
| 5 | `case "enrich"` reads `L.enrichments_per_extraction` | **`Infinity` on *every* plan** |
| 6 | `if (limit === Infinity) return ok(Infinity)` | short-circuits before reading the counter |

So the counter at step 4 is written and **never read against a finite limit**.

```
free -> Infinity     go -> Infinity      select -> Infinity
pro  -> Infinity     business -> Infinity  agency -> Infinity   developer -> Infinity
```

### Why this outranks L1–L3

- **Highest unit cost.** Enrichment is an AI call — the most expensive action
  in the product — plus up to 2 related-page fetches (`RELATED_PAGE_HINTS`).
- **No ceiling on any plan.** L1–L3 are at least bounded by monitor count or
  list size. This is bounded by nothing.
- **Guest-reachable.** The others require an account.
- **Cheap to exploit without meaning to.** A Free user with 10 extractions can
  enrich each one indefinitely — the per-URL counter increments forever and is
  never compared to anything.

The only backstops are the per-host rate limiter and the guest trial counter on
**extraction**, which enrichment does not touch.

> ⚠️ **`enrichments_per_extraction` is the wrong axis, not a wrong number.**
> Setting it to a finite value would cap *depth per URL* when the cost is
> *per call*. Ten enrichments across ten URLs costs exactly what ten
> enrichments on one URL costs; only the second is capped. **Do not "fix" this
> by lowering the number** — retire the axis.

---

## 1. How enrichment should be priced

### The unit
An enrichment is **one AI call plus the pages it had to read**. Both are already
known at the call site, so charge **actuals, not an estimate**:

| Component | Credits |
|---|---|
| AI call (fast tier) | 2 |
| AI call (deep tier) | 5 |
| Each page fetched (base + related) | 1 |

Typical enrichment on a page that already holds the answer → **3 credits**.
One that triggers the related-page scan (up to 2 extra fetches) → **4–5**.

### Charge on the outcome, not the attempt
`pickReason()` already distinguishes these and the ledger already models it
(`chargeableEvents()` drops `cached` / `skipped` / `failed`):

| Outcome | Charge? | Why |
|---|---|---|
| Data returned | ✅ yes | we paid, the user got value |
| `no_match` — page genuinely lacks it | ✅ yes | **a measurement is a result.** "They don't publish pricing" is a finding |
| `ai_chain_failed`, `no_key`, `truncated` | ❌ **never** | our outage. The user gets nothing |
| Cached / unchanged pre-filter | ❌ no | no provider call happened |

> This is the same asymmetry `extract.js`'s gate order enforces: everything able
> to decline sits above the charge. **Never bill for our own failure** — the
> 2026-09-03 incident where a dead AI account was reported to customers as
> "your page is empty" is the precedent for why this distinction matters.

### Replace the axis
- **Retire** `enrichments_per_extraction` (inert on all plans; wrong dimension).
- Enrichment draws from **the one credit pool**, like everything else.
- Keep a **per-URL soft cap** (e.g. 25) purely as a runaway guard — a loop
  re-enriching one URL is a bug, not a use case.

### Guests
Guests currently reach `/api/ai` ungated. Fold them into the existing guest
trial as a **credit** allowance rather than an action count.
⚠️ **This does not close the hole** — the guest trial is localStorage-backed and
this repo already documents it as clearable. **Server-side guest identity is a
prerequisite**, and it is the one genuinely new piece of infrastructure the
credits model needs.

---

## 2. Workflows and integrations — the rule to apply

The question "do integrations cost credits?" is really: *what deserves a meter?*

### The principle

> **Meter what a third party bills us for. Gate everything else by tier.
> Rate-limit what could be abused but costs nothing.**

Applying it:

| Surface | Provider cost to DatIQ | Treatment |
|---|---|---|
| Page fetch (Firecrawl/Spider/Jina/direct) | real | **credits** |
| AI call (enrichment, summary, evaluator, citations) | real | **credits** |
| Discoverability audit | real (bundle) | **credits** |
| Monitor check (page or prompt) | real | **credits** |
| Bulk enrichment row | real | **credits** |
| **Push integrations** (HubSpot/Notion/Airtable/Slack) | ~nil — one API call to the **customer's own** system | **tier-gated, never metered** ✅ *(the owner's read is correct)* |
| Google Sheets export | nil — client-side CSV | **free to everyone** (already is) |
| Signal-rule dispatch (email/webhook/Slack) | ~nil (Resend/HTTP) | **free; rate-limit only** |
| Exports (CSV/PDF/MD/JSON) | nil — local render | **tier-gated** |
| Report share / branding / seats / webhooks | nil | **tier-gated** |
| P2 modules (truth, graph, local, trust, scores, SXO) | nil — own records | **free by rule** |

### Why integrations must stay free
Metering a push would tax **the action that makes the product sticky** — the
one that moves DatIQ's output into the customer's CRM. It costs us a single
HTTP request. Charging for it discourages exactly the behaviour that creates
retention, to recover a cost that rounds to zero.

They remain **plan-gated** (`L.integrations`, Select+) as a *tier* feature. That
is a packaging decision, not a metering one, and it is already correct.

### Why rule dispatch needs a limiter, not a meter
A rule that fires 10,000 times is not a **cost** problem — it is a **spam**
problem, and the destination is the customer's own Slack or inbox. The control
is a per-account dispatch rate limit plus the existing `rule.create` cap, not a
credit charge.

### Workflows are not a category
"Workflows" is a *surface* (Lists → Watchlists → Rules), not a cost centre. Each
step already resolves to something on the table above:
- a **list** → bulk enrichment rows → credits *(today: unmetered, L3)*
- a **watchlist** → monitor checks → credits *(today: correctly charged)*
- a **rule** → dispatch → free + rate limit
- a **template** → sum of its parts → credits *(today: correctly charged)*

**Nothing new is needed for workflows.** Fixing L3 makes the pipeline
consistent end to end.

---

## 3. Agency

### The actual risk is not "unlimited extractions"
It is **`scheduled_monitoring: Infinity`**. The difference matters:

- Unlimited *extraction* is **attended** — bounded by a human doing work.
- Unlimited *monitors* are **unattended, recurring and compounding.** One
  afternoon of setup produces cost every day, for ever, with nobody watching.

### Recommendation

1. **Keep "unlimited extractions" as the headline.** It is the marketing claim,
   it is attended, and a fair-use pool set far above real usage keeps it honest.
2. 🔴 **Cap `scheduled_monitoring` at a real number — suggest 100.** No agency
   legitimately needs infinite unattended monitors, and this is the single
   largest uncontrolled cost in the pricing table.
3. **Fair-use pool ≈ 150,000 credits/month** with a *soft landing*:
   - 100% → notify the account owner. **Do not stop.**
   - 150% → require an overage commitment, or throttle concurrency.
   - **Never hard-stop an agency mid-month.** They have client deliverables, and
     a hard stop damages their customer, not ours.
4. **Publish the fair-use number.** "Unlimited (fair use: 150k credits)" is a
   promise you can keep. Undisclosed throttling is the version that loses trust.

---

## 4. Going direct — no paid customers changes the plan materially

### What the phases were protecting
Phases 1–3 in the main proposal exist to protect **existing billing
relationships**: dual-write so nobody's quota changes under them, show the
balance before gating on it, switch only once people have watched it accrue.

**With no paid customers, none of that applies.** The phasing is
over-engineered for the actual situation.

### But one step is NOT about customers
**Calibration.** §4.2's weights are estimates. Shipping them uncalibrated
re-prices every plan at once on a guess — and an audit that really costs 30
credits rather than 12 makes Business unprofitable the day it sells.

Calibration is a **pricing** requirement, not a migration one. It survives.
The difference is the *source*: instead of a month of customer traffic, use
**your own usage plus synthetic runs** against real provider billing. Days, not
a month.

### Revised plan

| | Step | Why now |
|---|---|---|
| **A** | **Stop the leaks** — L1, L2, L3, L5 **and enrichment (§0)** | Pure bug-fixing. Correct on any pricing model. Do this regardless of everything below. |
| **B** | **Calibrate** — run a representative workload, compare modelled credits to real provider invoices, fix the weights | Days. The only step that cannot be skipped or reordered. |
| **C** | **Switch outright** — one pool, one ledger, retire `usage.extractions`, the audit row count and `enrichments_per_extraction` | No migration risk with no paid customers. Every day on three meters accretes more code against them. |
| **D** | **Sell** — credit bundles as one SKU; publish Agency fair use | After C. |

**This collapses five phases into four steps and removes the dual-write
period entirely** — which is the single largest piece of throwaway work in the
original plan.

### The one thing that gets harder, not easier
**Server-side guest identity.** The guest trial is localStorage-backed and
clearable. Today that is tolerable because guests are capped on *extractions*
and enrichment is simply free for everyone. The moment credits become the real
currency, an anonymous pool that resets on "Clear site data" is the obvious
bypass — and enrichment (§0) is already guest-reachable and unmetered.

**Treat this as a prerequisite of step C, not a follow-up.** It is the only
genuinely new infrastructure the model requires, and it is the one thing the
original proposal under-weighted.

---

## 5. Decisions still open

1. **Agency:** accept the `scheduled_monitoring` cap of 100, and publish the
   fair-use number?
2. **Guest credits:** how many, and is server-side guest identity in scope for
   step C? *(Recommended: yes — it is a prerequisite.)*
3. **`no_match` billing:** charge for a genuine "they don't publish this"
   result? *(Recommended: yes — it is a measurement.)*
4. **Free tier:** a single pool means 50 credits ≈ 3 audits **or** ~16
   enrichments, not both. Today they get unlimited enrichment, so this is a
   **reduction** — deliberate, and worth stating plainly before it ships.

---

## 6. What shipped (2026-09-23) — every §5 decision, closed

### The four open decisions

| # | Decision | Outcome |
|---|---|---|
| 1 | Agency: cap `scheduled_monitoring` at 100 and publish fair use? | **Yes to both, and further.** Agency is **100 monitors** exactly as recommended. Fair use is **100,000 credits**, not the suggested 150,000 — see below. |
| 2 | Guest credits, and is server-side guest identity in scope? | **Guest identity was already server-side** (`guest_identities`, 0026/0073 — an HttpOnly cookie hashed SHA-256), so the prerequisite this section called "the only genuinely new infrastructure" turned out to be built. `/api/ai` **checks** the guest bucket and does not spend from it. |
| 3 | Charge for a genuine `no_match`? | **Yes.** `record()` charges unless the call `failed`, was `cached` or was `skipped`. "They don't publish this" is a measurement and costs a provider call. |
| 4 | Free tier is a reduction — state it plainly | **Stated, and the reduction is smaller than feared.** Free is **100 credits, granted once and never resetting** (not 50, and not monthly), of which 19 are reserved so the first Discoverability run cannot be spent away on extractions first. |

### Where reality diverged from the recommendation

🔴 **"Keep unlimited extractions as the headline" did NOT survive.** §3 argued
that unlimited *extraction* is safe because it is attended, and only unattended
monitors compound. That reasoning is sound and the owner overrode the
conclusion anyway: the 2026-09-23 sheet gives Agency **100,000 extractions and
100,000 credits**, both finite. **No shipped plan carries an `Infinity` limit on
any axis now.**

That is a stronger position than this document proposed, and it costs one thing
worth knowing: `prorationMath`'s "drops from unlimited" wording is no longer
reachable from any real plan pair. Its test drives a synthetic plan so the
branch stays covered — an operator override can still set `Infinity`.

⚠️ **Fair use is 100,000, not 150,000.** The addendum picked 150k as a number
"far above real usage". The sheet sets the pool and the fair-use ceiling to the
same 100,000, which makes the claim simpler to state and to keep. The soft
landing survives intact: notify at 100%, commit at 150%, **never hard-stop**
(`AGENCY_OVERAGE.hardStop: false`).

🔴 **AND IT PRODUCED ONE CONSEQUENCE NOBODY CHOSE.** At $200 for 100,000
credits, Agency's committed rate is **$0.002/credit** — and `AGENCY_OVERAGE` is
$2.00 per 1,000, which is **the same number**. Overage now costs exactly what
the plan does, so there is no margin on overrun and no penalty for it. That is
defensible as a policy ("past fair use you keep paying the plan rate") and it
is not what the 150k figure would have produced. The invariant was relaxed from
`>` to `>=`; **below** the committed rate is still refused, because that would
make overrunning cheaper than the plan that grants the credits.

### The revised A–D plan, as executed

| | Step | What happened |
|---|---|---|
| **A** | Stop the leaks | Done. The register (L0, L0b, L1, L2, L3, L5, L6) is closed and a parity test fails the build on a provider call with no caller id — it found **12** unmetered call sites on its first run, more than the register listed. |
| **B** | Calibrate | 🔴 **NOT DONE, and deliberately so.** The owner overrode §6 of the main proposal on 2026-09-23: ship the measured call-counts, recalibrate later, on the grounds that nobody pays today. **This is the one step this document said "cannot be skipped or reordered", and it was skipped.** It is a decision with an expiry: re-run it before the first paid signup. |
| **C** | Switch outright | Done — one pool, one ledger. `usage.extractions` and the audit row count survive as descriptive fields that no gate reads. |
| **D** | Sell | Done. Credit packs are purchasable on any plan including Free and never expire; Agency fair use is published on `/pricing`, in `llms.txt` and in the help site. |

### One thing this document did not anticipate

**A repricing needed protecting against, not just a migration.** The addendum
reasoned that "with no paid customers, none of that applies" — true of the
*migration*, and it quietly assumed prices would not move again. They did, the
same week: the 2026-09-23 sheet cut Developer's batch and bulk limits from 500
to 250. Without a snapshot that would have halved a paying subscriber's list
size mid-period. `0080` and `src/lib/planSnapshot.js` close it; the rule is
**while the paid period runs nothing gets worse, and improvements still reach
you**.
