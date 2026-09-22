# Unified Usage Credits — plan v2

> **Status: PROPOSAL. Nothing implemented.** Updated 2026-09-22 with the owner's
> decisions. Supersedes v1 and folds in
> [CREDITS-UNIFICATION-ADDENDUM.md](./CREDITS-UNIFICATION-ADDENDUM.md), which is
> kept for its evidence trail.
>
> Every claim is cited to a file. Estimates say so.

---

## 0. Decisions locked by the owner

| # | Decision |
|---|---|
| D1 | **Everything is sold as credits.** One currency, one pool. |
| D2 | **Paid plans reset monthly. No rollover.** |
| D3 | **Free does NOT reset** — a one-time lifetime grant. |
| D4 | Free keeps **1 audit + 10 extractions**; the rest of its grant is enrichment. |
| D5 | **Registration is required to SAVE** an extraction or audit result. |
| D6 | Agency `scheduled_monitoring` capped at **100 jobs**. |
| D7 | An audit is sold as **Discoverability**, not "an audit". |

---

## 1. 🔴 Correction to v1 — guest identity already exists

**v1 and the addendum both claimed server-side guest identity was the one piece
of new infrastructure the model needed. That was wrong.** It is already built,
and it is built well:

- `netlify/functions/lib/guestUsage.js` — *"Server-authoritative anonymous
  identity and quota."*
- `datiq_guest_id` cookie: 32 random bytes, **HttpOnly, Secure, SameSite=Lax**,
  1-year age.
- Stored as **SHA-256 only** — `0026_guest_identity_usage.sql` states *"Raw
  guest identifiers are never stored"*. Privacy-preserving by construction.
- `guest_identities` table + `consume_guest_credit()` RPC, service-role only.
- **Separate buckets already:** `single: 10`, `batch: 5`, and — from `0073` —
  **`audit: 1`**, with the comment: *"its OWN bucket, so an audit never draws on
  the ten cheap extraction credits, and the UI's 'one free audit' is what is
  enforced."*

**The guest half of D3/D4 is therefore already enforced, server-side, today.**
The architecture is a bucket-per-action; D1 asks for one pool. That is a
*generalisation* of working code, not new infrastructure.

> ⚠️ **The one real gap: enrichment consumes no bucket.** There is no
> enrichment bucket, and `/api/ai` never calls `consumeGuestCredit`. §2 covers it.

---

## 2. The leaks (unchanged from v1, plus enrichment)

`chargeLedger()` has **three** production callers: `watchlist-monitor`,
`watchlists`, `templates`. Extraction, enrichment, audits and every AI call
reach none of them.

| # | Surface | Finding |
|---|---|---|
| **L0** | **Enrichment** | 🔴 **Largest.** `case "ai": return ok();` is unconditional; `checkCapability` fails open for guests; `enrichments_per_extraction` is **`Infinity` on all 7 plans**, so the per-URL counter the client writes is never compared to a finite limit. An AI call — the most expensive action — is free and uncapped for everyone including anonymous visitors. ⚠️ **Wrong axis, not wrong number:** it caps depth *per URL* when cost is *per call*. |
| **L1** | Scheduled audits | `discoverability-monitor.js:210` calls `createAudit()` with **no quota check**, yet those rows **do** count — the cron exceeds the plan *and* silently starves the customer's interactive quota. |
| **L2** | Prompt monitors | `@daily`, real answer-engine calls via `sampleCitations()`, **no meter**. Capped by monitor count, not spend. |
| **L3** | Bulk enrichment | Caps **list size**, not monthly volume; `bulk-runner.js` has **zero** metering hooks. |
| **L5** | P2 modules | `ok(Infinity)` — correct today (verified: no provider calls) but unenforced, so the first AI call added there is free by default. |

---

## 3. The unit and the weights

> **1 credit = one page fetch.**

| Action | Credits | Notes |
|---|---|---|
| Page fetch | 1 | the anchor |
| AI call — fast | 2 | |
| AI call — deep | 5 | |
| **Enrichment** | **3** | 1 fetch + 1 fast AI call; 4–5 when the related-page scan fires |
| **Discoverability run** | **12** | ~2 fetches + robots + PageSpeed + citation sample + AI evaluator |
| Monitor check (page) | 1 / page | already charged this way |
| Prompt-monitor sample | 2 / prompt | one AI call each |
| Bulk enrichment row | 3 | 1 fetch + 1 AI call |
| Template run | sum of parts | already modelled |
| P2 module read/write | **0** | no provider call — free **by rule** |

⚠️ **Estimates. Calibrate before selling** (§7 step B).

### What is never charged

| Outcome | Charge? | Why |
|---|---|---|
| Data returned | ✅ | we paid, they got value |
| `no_match` — page genuinely lacks it | ✅ | **a measurement is a result** |
| `ai_chain_failed`, `no_key`, `truncated` | ❌ | our outage |
| Cached / unchanged pre-filter | ❌ | no provider call happened |
| Refused at a gate (SSRF, robots, entitlement) | ❌ | nothing was done |

`chargeableEvents()` already encodes this; `extract.js`'s gate order keeps it true.

---

## 4. Free — a one-time grant, and how it is enforced

### The model
Free is **a trial, not a tier**. One lifetime grant, never refilled. When it is
gone the account still works — saved results, exports, sharing — but no new
credit-consuming runs until they upgrade.

### Sizing (D4)

| Component | Credits |
|---|---|
| 1 Discoverability run | 12 |
| 10 extractions | 10 |
| Enrichment (~9 runs) | 28 |
| **Free lifetime grant** | **50** |

Shown to the user as *"1 Discoverability report + 10 extractions + ~9
enrichments."*

⚠️ **Open decision — pool or earmark?** A pure pool lets someone spend all 50 on
enrichment and never run the Discoverability report that is the product's
headline. **Recommendation: pure pool, but reserve the 12 for the first
Discoverability run** — it is the one action that demonstrates the product, and
the onboarding flow leads with it. A pool with one reserved action is still one
currency.

⚠️ **This is a reduction:** Free gets 3 audits today, and unlimited enrichment.
Deliberate per D4, but it should be stated plainly rather than discovered.

### Enforcement — the actual question

A lifetime grant is only as strong as the identity behind it, and a monthly
reset is self-limiting in a way a lifetime grant is not: the worst a monthly
abuser gains is one month's allowance, whereas a lifetime abuser just registers
again. Four layers, cheapest first:

| Layer | Mechanism | Status |
|---|---|---|
| **1. Guest, pre-registration** | `guest_identities` cookie bucket | ✅ **already built** (§1) — generalise buckets → credits |
| **2. Grant on VERIFIED email, not signup** | Supabase already verifies; move the grant to the verification hook | small change |
| **3. Disposable-domain blocklist** | reject known throwaway domains at signup | new, cheap, high value |
| **4. Per-IP signup rate limit** | blocks bulk automation | new, cheap |
| **5. Monitor, do not hard-gate** | track grants per IP / domain, alert on anomaly | new |

🔴 **Do NOT add device fingerprinting.** It is the obvious fifth idea and it is
wrong here: it conflicts with the DPDP posture in `/privacy`, with the consent
architecture this repo just spent a session tightening, and with `0026`'s own
choice to store only a hash. It would trade a real privacy commitment for a
marginal gain against an already-bounded loss.

### Why the economics matter more than perfect enforcement

At ~$0.002 provider cost per credit (estimate), the **50-credit grant costs
about $0.10**. A hundred fake accounts is ~$10; a thousand is ~$100 and would be
visible in layer 5 long before that.

> **Size the grant so that abuse is a marketing cost, not a threat.** Layers 2–4
> exist to stop *automated* and *casual repeat* abuse. Perfect enforcement of a
> $0.10 grant is not worth the engineering or the privacy cost.

### D5 — run free, register to save

Guests may **run**; saving requires an account.

- Saves the result to the account, with history — which is what makes a
  Discoverability report worth anything (the trend is the product).
- Puts the registration ask at the **moment of demonstrated value**, not before it.
- Bounds guest cost: a guest spends credits but takes nothing persistent.

⚠️ **Two existing behaviours must be reconciled, not overridden:**
1. `/discoverability` is currently **signed-in only**. D5 *opens* it to guests
   for one run — a funnel improvement, but a real scope change.
2. Extractions already work signed-out into localStorage, and
   `claimLocalExtractions()` replays them on sign-in. **That is exactly the D5
   flow and it already exists** — extend it to Discoverability results rather
   than building a second mechanism.

---

## 5. Plans — everything in credits (D1, D2)

| Plan | $/mo | **Credits / month** | $/credit | ≈ extractions if spent purely there | ≈ Discoverability runs |
|---|---|---|---|---|---|
| **Free** | 0 | **50 one-time (never resets)** | — | 10 + 1 run + ~9 enrichments | 1 |
| **Go** | 4.80 | **750** | 0.0064 | 750 | 62 |
| **Select** | 14.40 | **3,000** | 0.0048 | 3,000 | 250 |
| **Pro** | 20.40 | **6,000** | 0.0034 | 6,000 | 500 |
| **Developer** | 32.40 | **25,000** | 0.0013 | 25,000 | 2,083 |
| **Business** | 44.40 | **35,000** | 0.0013 | 35,000 | 2,916 |
| **Agency** | 106.80 | **100,000** | 0.0011 | **100,000** | 8,333 |

**No rollover** (D2): unused credits expire at period end. Free never refills (D3).

### Nobody loses capability except Agency

| Plan | extractions today | extraction-equivalent now |
|---|---|---|
| Go | 200 | 750 ✅ |
| Select | 500 | 3,000 ✅ |
| Pro | 1,000 | 6,000 ✅ |
| Business | 10,000 | 35,000 ✅ |
| Agency | ∞ | **100,000** ⚠️ |

Pools are sized **above** a naive extraction+audit conversion because enrichment
is now metered and is unlimited today. Under-sizing would make the switch a
stealth downgrade.

### Price per credit declines with volume
`0.0064 → 0.0048 → 0.0034 → 0.0013 → 0.0011`. A clean curve — each tier up is
better value per credit, which is what makes upgrading rational.

---

## 6. Agency (D6) — the extraction number

**Proposed: 100,000 credits/month**, which if spent entirely on extraction is
**100,000 extractions**.

### Why a real number replaces "unlimited"
D1 says everything is sold as credits, and "unlimited" cannot be expressed in a
currency. A published number is also more honest than undisclosed throttling.

### Why 100,000
Modelled agency usage — 5 client workspaces, regular reporting and monitoring:

| Activity | Credits/month |
|---|---|
| 100 Discoverability runs (5 workspaces × 20) | 1,200 |
| 100 monitors × 30 days × ~1 page | 3,000 |
| ~5,000 extractions | 5,000 |
| ~2,000 enrichments | 6,000 |
| **Realistic total** | **≈ 15,000** |

**100,000 is ~6.6× realistic usage.** Generous enough that no legitimate agency
hits it, finite enough to bound exposure.

### The cap that actually matters (D6)
🔴 `scheduled_monitoring: Infinity` → **100**.

Unlimited *extraction* is **attended** — bounded by a human working. Unlimited
*monitors* are **unattended, recurring and compounding**: one afternoon of setup
bills every day for ever with nobody watching. **That, not extraction volume,
was the real exposure.**

### Overage — soft landing
- 100% → notify the owner. **Do not stop.**
- 150% → overage commitment, or throttle concurrency.
- **Never hard-stop mid-month.** An agency has client deliverables; a hard stop
  damages their customer, not ours.

---

## 7. What is metered, what is not

> **Meter what a third party bills us for. Gate everything else by tier.
> Rate-limit what is abusable but free.**

| Surface | Treatment |
|---|---|
| Page fetch · AI call · Discoverability run · monitor check · bulk row | **credits** |
| **Push integrations** (HubSpot/Notion/Airtable/Slack) | **tier-gated, never metered** — one API call to the customer's own system; metering it would tax the action that creates retention to recover a cost that rounds to zero |
| Google Sheets export | free to everyone (client-side CSV) |
| Signal-rule dispatch | free; **rate-limit only** — 10,000 fires is a spam problem, not a cost one |
| Exports · sharing · branding · seats · webhooks | tier-gated |
| P2 modules (truth, graph, local, trust, scores, SXO) | **free by rule**, guarded by a parity test |

**"Workflows" is a surface, not a cost centre.** Each step already resolves to a
row above — list → bulk rows, watchlist → monitor checks, rule → dispatch,
template → its parts. Fixing L3 makes the pipeline consistent; nothing new is
needed.

---

## 8. Plan of work

No paid customers today, so the dual-write phases that protected existing
billing relationships are dropped. **Calibration is not** — it is a pricing
requirement, not a migration one.

| | Step | Notes |
|---|---|---|
| **A** | **Stop the leaks** — L0 (enrichment), L1, L2, L3, L5 | Pure bug-fixing, correct under any pricing model. **Do this regardless of everything below.** |
| **B** | **Calibrate** — representative + synthetic workload, compare modelled credits to real provider invoices, fix §3 | Days, not a month (no customer traffic needed). The one step that cannot be skipped or reordered. |
| **C** | **Switch** — one pool, one ledger. Generalise `guest_identities` buckets → credits. Retire `usage.extractions`, the audit row count and `enrichments_per_extraction`. Add Free's one-time grant (`credit_ledger` already has a `grant` reason). | No migration risk with no paid customers. |
| **D** | **Free-tier enforcement** — grant on verified email, disposable-domain blocklist, per-IP signup limit, anomaly monitoring | Ships with or just after C. |
| **E** | **Sell** — credit bundles as one SKU; publish Agency fair use; rename audits → Discoverability (D7) | After B has confirmed the weights. |

### What NOT to do
- ❌ Ship the weights un-calibrated — a wrong Discoverability weight re-prices every plan at once.
- ❌ Charge for refused, cached or failed work.
- ❌ Make the P2 modules cost credits while they make no provider call — billing for work nobody did is the mirror of the leak.
- ❌ Lower `enrichments_per_extraction` instead of retiring it — wrong axis.
- ❌ Add device fingerprinting.
- ❌ Build a second guest-identity mechanism. **One exists** (§1); generalise it.

---

## 9. Still open

1. **Free: pool or reserved first run?** *(Recommended: pool, with the 12 for the first Discoverability run reserved.)*
2. **D5 scope** — opening `/discoverability` to guests for one run is a real change to a currently signed-in-only surface. Confirm.
3. **Charge for `no_match`?** *(Recommended: yes — it is a measurement.)*
4. **Agency overage price** per 1,000 credits above 100,000.
5. **Developer tier** sits at Business's $/credit on a lower pool. Intentional?
