# Unified Usage Credits — plan v5 (decision-complete)

> **Status: STEPS A, B and D ARE IMPLEMENTED (2026-09-23). C, E, F and G are
> not.** Every decision is settled; §7 records the last four. §8 records what
> shipped, the two places implementation proved this document wrong, and why
> the remaining steps are still gated on C.
>
> Supersedes v4. Evidence trail:
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
| D15 | **Extractions Bundle is removed** — see §4.3 and ⚠️ §4.6 |
| D16 | **Scheduled Monitor stays**, revised to slot-only at $5 |
| D17 | **Deep-tier AI stays at 5** — settled, not a placeholder |
| D18 | **Credit Packs ship** as proposed (§4.4) |

---

## 1. Weights — with PageSpeed now charged (D11)

> **1 credit = one page fetch.**

| Action | Credits | Note |
|---|---|---|
| Page fetch | 1 | the anchor |
| **PageSpeed (CrUX/PSI) call** | **1** | D11 — was 0 in v3 |
| AI call — fast | 2 | |
| AI call — deep | **5** | D17 — settled as a pricing decision, not a placeholder |
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
| **Extractions Bundle** ($9 / 100 extractions) | 🔴 **REMOVED — D15** | Pure consumption. Also mispriced: $0.09/credit is **14× Go's plan rate**. Replaced by Credit Packs. |
| **Batch Pack** ($9 / 50 URLs) | ✅ **Keep** | Caps list *size* — a runner guard, not spend |
| **Scheduled Monitor** ($5 / URL / month) | ✅ **KEEP, REVISED — D16** | Buys the **slot only**, at the unchanged $5. ⚠️ Its runs draw on the pool, so it now buys strictly less than it appeared to — **say so on the pricing page**, or customers will reasonably expect the runs included |
| **Extra Workspace** ($19) | ✅ **Keep** | Pure capacity, no provider call |

**And on Discoverability specifically:** under credits, `L.audits` is retired
and a run is pure consumption — so **there is no Discoverability add-on to
build. Buying credits *is* buying Discoverability capacity.** That is a real
simplification of the question rather than a dodge.

### 4.4 Credit Packs — shipping (D18)

Anchored at ~**3× the Select plan rate**, with volume breaks — expensive enough
that upgrading usually wins, cheap enough to be a reasonable answer to "I hit my
cap on the 20th".

| Pack | Credits | Price (USD) | $/credit | ≈ Discoverability runs | ≈ extractions |
|---|---|---|---|---|---|
| Small | **500** | $9 | 0.0180 | 26 | 500 |
| Medium | **2,000** | $29 | 0.0145 | 105 | 2,000 |
| Large | **10,000** | $119 | 0.0119 | 526 | 10,000 |

✅ **Confirmed (D18).** This is ~5× more generous per dollar than the bundle it
replaces — deliberately, because that bundle sat at $0.09/credit, **14× Go's
plan rate**, which was never a decision anyone made.

### 4.5 Capacity add-ons — proposed credit consequences

| Add-on | Price | Buys | Credits it consumes |
|---|---|---|---|
| Scheduled Monitor | $5 / mo | **1 monitor slot** | runs draw on the pool: page monitor **1/page**, prompt monitor **2/prompt** |
| Batch Pack | $9 | +50 URLs of list size | rows draw on the pool at **3/row** |
| Extra Workspace | $19 / mo | +1 workspace | **0** — no provider call |

> The rule stated once: **an add-on buys the RIGHT to do something; the doing
> still costs credits.** A monitor slot that included its own runs would be a
> second, unmetered budget — which is exactly the shape of L1, L2 and L6.

### 4.6 🔴 Removing the bundle is one line — `bonusExtractions` is not

Deleting `extractions-bundle` from `TOPUP_BUNDLES` is trivial. **The field it
grants is not the bundle's**, and three other things write it:

| Writer | What it is | Must become |
|---|---|---|
| `redeem_referral_code` → `entitlements.bonus_extractions` (`0029:179-189`) | **the referral reward, both sides** | a credit **grant** |
| `admin-users.js:276` → `user_metadata.bonus_extractions` | admin coupon grant | a credit **grant** |
| `BillingProvider.js:503` — coupon `type === "extractions"` | bonus-extraction coupons | a credit **grant** |

And `BillingProvider.js:150` sums all three into the quota
(`entitlements + user_metadata + subscription`), while `creditEstimator.js:31`
and two banners read it for display.

⚠️ **Remove the bundle without migrating these and the referral programme
silently stops rewarding anything** — both sides still get a row written, the
quota reader is gone, and nothing errors. That is the exact
declared-and-never-read failure this schema has already produced four times.

**Each one maps cleanly to a credit grant** (`credit_ledger` already has a
`grant` reason), so this is a translation, not a redesign — but it is
**required work in step E, not a follow-up.**

---

## 5. Metering every unattended surface (D8)

### The structural rule

> **Meter at the CHOKE POINT, not per feature.** ~~Exactly four functions~~
> **Five** spend money — `runChain`, `runScrapeChain`, `fetchWebVitals`,
> `sampleCitations`, **and `fetchLayer`'s three direct fetches**. Each writes
> to `credit_ledger` with the caller's id and a reason, so a new module that
> adds an AI call is metered **the day it lands**.

🔴 **THE "FOUR" WAS WRONG, AND §1 ALREADY KNEW IT.** Three of the four fetches
a Discoverability run makes never touch `runScrapeChain`: the raw HTML read,
the robots.txt read behind the crawler check and the canonical HEAD all call
`fetchPublicUrl` directly. Under the four-choke-point model an audit would have
been charged **16** against the **19** this same document prices it at — the
recount in §1 and the metering plan here disagreed with each other, and the
recount was right.

⚠️ **`fetchPublicUrl` ITSELF IS THE WRONG BOUNDARY**, which is why the fifth
choke point sits one layer up. It has nine callers and two of them must never
be charged: `complianceEngine`'s robots read (a request refused at a gate does
no billable work) and `scrapeProviders`' own direct adapter (already charged by
`runScrapeChain`, so metering both would double-bill every extraction).
`fetchLayer` is the narrowest boundary containing only audit spend.

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
| **C** | **Calibrate** — representative + synthetic workload against real provider invoices; replace §1 | §1 counts *calls*, not tokens. **The one step that cannot be skipped.** ⚠️ The deep-tier ratio is settled at 5 (D17) — calibration reports it if it is materially off, but does not re-open it by default. |
| **D** | **Dynamic counter** — `expires_at` on grants, balance as a SUM, 60 s UX cache, charge from actuals | §2. Every model it needs already exists. |
| **E** | **Switch** — one pool; retire `usage.extractions`, the audit row count, `enrichments_per_extraction`; Free's grant via the ledger's `grant` reason | No migration risk with no paid customers. |
| **F** | **Free-tier enforcement** — grant on verified email, disposable-domain blocklist, per-IP signup limit, monitoring; **no device fingerprinting** | With or just after E. |
| **G** | **Sell** — Credit Packs ship (D18); Extractions Bundle removed (D15) **with §4.6's grant migration done**; Scheduled Monitor relabelled slot-only (D16); publish Agency fair use, the overage rate and the rollover cap; audits → Discoverability | After C confirms the weights. |

### What NOT to do
- ❌ Ship §1 un-calibrated — a wrong Discoverability weight re-prices every plan at once.
- ❌ Store the balance in a counter column — it drifts from the rows it counts.
- ❌ Charge the **estimate**. Charge the actuals; show the estimate.
- ❌ Reserve less than **19** for Free's first run.
- ❌ Let a capacity add-on include its own runs — that is a second unmetered budget.
- ❌ Keep a bundle that sells consumption alongside credits — two currencies for one thing.
- ❌ Remove the Extractions Bundle without migrating `bonusExtractions`' three other writers (§4.6) — that silently kills the referral reward.
- ❌ Meter per feature instead of per choke point.
- ❌ Let `checkCapability` fail closed on an INFRASTRUCTURE error.
- ❌ Add device fingerprinting.

---

## 7. Resolved — the last four

| Question | Decision |
|---|---|
| Credit Pack pricing direction | **Ship as proposed** (D18). ~5× more generous than the bundle it replaces, because that bundle was 14× plan rate. |
| Does Scheduled Monitor stay at $5 now it buys strictly less? | **Yes, unchanged** (D16) — but the slot-only semantics must be stated on the pricing page. |
| Is deep-tier AI at 5 a placeholder? | **No — settled** (D17). Calibration reports it if materially off; it does not re-open by default. |
| Does the Extractions Bundle survive? | **No — removed** (D15), with §4.6's grant migration as required work. |

**Nothing in this plan is open.** The remaining dependency is step **C**:
§1 counts provider *calls*, not tokens, and those numbers should meet a real
invoice before anyone is billed on them.

---

## 8. What shipped — steps A, B and D (2026-09-23)

### The register is closed

| # | Surface | State |
|---|---|---|
| **L0** | Enrichment | ✅ metered at `runChain` via `extract.js`'s request context |
| **L0b** | Guests on `/api/ai` | ✅ **CHECKS** the `single` guest bucket, does not spend from it — see below. Fails open on infrastructure, closed on an exhausted bucket |
| **L1** | Scheduled Discoverability | ✅ pool checked **before** `createAudit()`; schedule **paused with a recorded reason** when short |
| **L2** | Prompt monitors | ✅ 2/prompt; a short account **records a skipped run with its reason** and advances its clock |
| **L3** | Bulk enrichment | ✅ per-chunk pool check, per-row charge from actuals, `enrichment_jobs.paused_reason` added so a paused job says why |
| **L5** | P2 modules | ✅ free by rule, guarded by the parity test |
| **L6** | Extraction schedules | ✅ 1/page, filed as `monitor_check` |

### 🔴 Two things implementation proved this document wrong about

**1. There are FIVE choke points, not four.** Recorded in §5 above. The
metering plan and the §1 recount disagreed by 3 credits per audit.

**1b. `/api/ai` must CHECK the guest bucket, not consume it.** The obvious
reading of L0b — "charge a guest credit here too" — would have halved the
trial silently. One extraction from the browser is `/api/extract`, which
already charges, **plus** an `/api/ai` call for the summary and usually a
second for link tagging. Consuming at each would have taken a guest from ten
extractions to three or four while `GuestTrialBanner` went on advertising ten:
the server and the UI disagreeing about the same number, with no error
anywhere. A **read** closes the leak exactly — once the ten credits are gone
the AI endpoint stops too — and charges nothing twice.

**2. A balance of zero is not the same as no balance, and conflating them
would have taken the product down the day `0078` was applied.** These gates
ship *before* step G starts granting monthly allowances, so on apply day
`credit_available()` correctly reads **0 for every account** — and a gate
reading 0 as "refuse" would have paused every schedule, every prompt monitor
and every bulk job at once.

`credit_status()` answers `enforced`, which is simply *has this account ever
been granted credits*. `affords()` says **yes** in three cases and only one of
them is about credits:

| Case | Meaning |
|---|---|
| `degraded` | we could not read it (blip, or `0078` not applied here) |
| `!enforced` | this account is not on the credit system at all |
| `ok` | they genuinely have the credits |

⚠️ **It arms itself.** The first grant to an account turns enforcement on for
that account — there is no flag to remember to flip and no window where it is
half on. `CREDITS_ENFORCEMENT_DISABLED=1` is the break-glass, read from the
environment so that, unlike a database flag, it cannot itself fail open.

### Also found while wiring it

- **Watchlist monitoring under-charged and its metadata was discarded.** It
  built its own ledger row from `s.pages`, which excluded the discovery crawl —
  so the first run against every new target read a page nobody paid for. And
  its `metadata` never arrived: `chargeLedger()` passes `p_meta: {}`
  unconditionally, so `watchlist_id` / `target_id` / `domain` were assembled
  and dropped one call later. Both fixed by moving it onto the choke point.
- **Charges are buffered and flushed once per request.** `runChain` is a serial
  fallback inside an 8s budget that has already caused one production 504;
  awaiting a Supabase round-trip per provider call would spend the customer's
  deadline on our bookkeeping. A choke point records synchronously and the
  request flushes once, collapsing a 40-page run to ~3 ledger rows.
  ⚠️ A request killed before its flush loses the charge, and that is the right
  direction — under-billing for our own crash is the error we are willing to
  make.

### What is NOT done, and why

**Step C — calibration — is the one remaining step, and it is an
operator/finance pass, not a code change.** §6 puts it before the switch and
the first line of "What NOT to do" is *"❌ Ship §1 un-calibrated — a wrong
Discoverability weight re-prices every plan at once."*

⚠️ **The owner overrode that ordering explicitly on 2026-09-23**, on the
grounds that there are no paying customers today, so a wrong weight costs
nothing that cannot be corrected before one exists. E, F and G shipped against
the **measured** call counts (Discoverability 19, AI fast 2 / deep 5,
enrichment 3). That is a decision with an expiry: **re-run step C before the
first paid signup.**

§1 counts provider **calls**, not tokens. Those counts are measured against the
real pipeline and enforced by test, but they have still never met a provider
invoice. Step C is: take a month of real invoices, divide by the calls in the
ledger, and confirm or correct §1. The ledger now produces exactly the data
that pass needs, which it could not before.

---

## 9. What shipped — steps E, F and G (2026-09-23)

### E — the switch

Plans are sold in credits. `entitlementModel`'s gates cost the work and check
the pool; `limits.extractions` and `limits.audits` remain on every plan as a
historical read and are **enforced by nothing**.

🔴 **`creditsCtx` returns `known: false` for three different situations and the
gate lets all three through.** `degraded`, `enforced !== true`, and a
non-finite balance. That is the same fail-open asymmetry `requireEntitlement`
holds, and it is why applying `0078` cannot take the product down: on apply day
every account reads 0 and `enforced` is false, so nothing refuses anything
until a grant arms it.

### F — the Free pool

`freeTierPolicy.js` is pure and has no network. A grant is withheld from an
unverified address or a disposable domain, and rate-limited per IP to 3 in 24h.

🔴 **NO DEVICE FINGERPRINTING, AND A TEST READS THE SOURCE TO PROVE IT.**
`freeTierPolicy.test.js` greps the module for `navigator.userAgent`,
`createElement("canvas")`, `getContext(`, `webgl`, `screen.width` and
`AudioContext`. A comment saying we do not fingerprint is worth nothing; a test
that fails the build when somebody adds it is worth something.

⚠️ **The IP is hashed, windowed and never stored as an address** — salted
SHA-256 truncated to 32 chars, counted over 24h, written into the grant's
`meta` and never read back as an address. It answers "how many free grants came
from this origin today" and cannot answer "where is this person".

⚠️ **Every unknown reads as ELIGIBLE.** `freeGrantsFromIp` returns `null`, not
`0`, when it cannot count — and `null` grants. Refusing a signup because a
count failed is refusing a customer for our own outage.

### G — the surfaces, and the one that was actively wrong

Four surfaces mislabelled a number. The fifth refused runs the server allows.

🔴 **`creditEstimator` LIED IN THE BLOCKING DIRECTION.** It read
`plan.limits.extractions` (free = 10) minus `usage.extractions`, so a free
account holding a full 100-credit pool was told *"Blocked — 10 remaining, 12
needed"* for a batch the gate runs for 12 credits. **A pre-flight that refuses
a run the gate would allow is worse than no pre-flight**: the user never learns
it was wrong, because they never press the button. Its tests now run the real
`can()` beside it and assert both reach the same verdict — which the old suite
could not have done, because the two were reading different pools.

🔴 **A SECOND SIGNUP GRANT THAT ONLY THE BROWSER KNEW ABOUT.** `trialCredit: 25`
had the client add 25 to `bonusExtractions` in localStorage on `SIGNED_IN`,
while the server grants `FREE_GRANT` once under `grant_period = 'signup'`. Every
surface reading the local subscription showed a pool 25 larger than the ledger
would spend from. **That is the referral-loop defect exactly** — a number
nothing downstream reads, shown beside a refusal. Retired; `applyTrialCredit`
stays as a no-op, because two live call sites invoke it and a no-op is a smaller
change than removing a call from an auth event handler.

⚠️ **`CREDIT_PACKS` WAS IMPORTED BY `/pricing` AND RENDERED NOWHERE**, so the
packs that replaced the removed Extractions Bundle were purchasable by the
server and reachable from no screen. Rendered. `purchaseBatchPack` resolves a
pack id now and deliberately does **not** write the credits locally:
`verify-payment` grants them into the ledger keyed `pack:<paymentId>`, so the
client re-reads instead of adding, and demo mode returns `creditsPending`
rather than faking a balance nothing backs.

**`creditPressure()`** is the one place *"is this account running low?"* is
answered — for `UsageUpsellBanner`, `ReferralBanner` and Account's meter, which
previously answered it three different ways against the retired quota.
⚠️ **Its load-bearing field is `known`, not the threshold.** A guest, an account
never granted credits, and an unreadable read must all render **nothing**;
`low` and `empty` are both `false` in those cases, so a surface branching on
`low` alone still cannot invent an outage. ⚠️ **`remainingPct` may exceed 1**
and is not clamped — rollover means two grants can be live at once.

**Public copy.** `llms.txt`, `llms-full.txt` and `pageSeo.js`'s JSON-LD all
quoted extraction allowances nothing enforces. ⚠️ **This is the third time that
copy has rotted**, and the readiness audit's "pricing coherence" check compares
plan **names**, not numbers, so it passed through every incident. New
`publicPricingCopy.test.js` checks the **numbers** against `PLANS`, in both
directions: each plan's real allowance must appear, and each retired extraction
claim must not.

### Verified

vitest **451 files / 7,228 passed / 0 failed** · db-verify **79 migrations /
888 assertions** · referral **19** · workflows **56** · build clean · prerender
**32 pages / 128 refs**. **30 guards confirmed RED first** — 13 estimator
(including the gate-agreement rows) and 17 pricing-copy.

### Still outstanding

- 🔴 **Migrations `0074`–`0079` are OPERATOR ACTIONS** and have only met WASM
  Postgres. Nothing in the credit system enforces anything until `0078` is
  applied, and `0079` must follow it. See
  [DB-MIGRATION-RUNBOOK.md §4f](DB-MIGRATION-RUNBOOK.md).
- 🔴 **Step C**, above — before the first paid signup.
- ⚠️ `bonus_extractions` survives as a stored wire name on three writers. It is
  read as credits and decides nothing; renaming the column would orphan every
  row already written.
