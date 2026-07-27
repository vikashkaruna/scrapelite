# Session handoff — 2026-07-27 — Invoicing & subscription lifecycle

**Branch:** `claude/datiq-invoicing-model-e16ea3` (4 commits, not merged, not pushed)
**Base:** `main` @ `f56306d`
**Size:** 69 files, +10,326 / −166

| Commit | Scope |
|---|---|
| `26b9374` | PR1 — server-authoritative entitlements + billing identity |
| `61f0f35` | PR2a — invoice engine: charge decomposition, numbering, PDF |
| `f209214` | PR2b — invoice download, resend, Account history UI |
| `cf5a41a` | PR3+PR4 — lifecycle, dunning, purge, admin |

---

## 1. State in one paragraph

DatIQ had **no invoicing model at all** (zero occurrences of `invoice`/`GSTIN`/`HSN`/`SAC` in `src/`) and no notion of a subscription ending. It now issues a numbered, itemized, GST-capable document for every payment, emails it automatically, lets the customer view/download/re-send it from Account, and runs a full lifecycle — active → suspended → deactivated → purge — with warnings at every step, automation that pauses and resumes with the subscription, and an operator API for suspend/reactivate/comp/offline-payment/refund.

**Nothing has been applied to a database.** Six migrations are unverified. See §6.

---

## 2. Test + build state

| Suite | Session start | Now | Δ |
|---|---|---|---|
| unit | 1005 (89 files) | **1436** (96 files) | +431 |
| contract | 382 (29 files) | **496** (35 files) | +114 |
| integration | 180 (35 files) | **205** (38 files) | +25 |
| system | 7 | **7** | — |

`npm run build` clean. `npm run readiness` → 5 pass / 2 warn / 0 fail (both warnings pre-existing: screenshot freshness, gallery coverage — neither is a blocker and PR1–4 make no visible change to the marketing surfaces).

Verify everything with:

```bash
npm run test:unit && npm run test:contract && npm run test:integration && npm run test:system && npm run build && npm run readiness
```

---

## 3. What shipped

### PR1 — Identity, RLS, server entitlements (`26b9374`)

The foundation. Nothing above it is real without this.

**The problem it fixes.** Every entitlement decision was a client-side read of `subscription.planId` from `localStorage`. `subscriptions.status` was written by the webhook and read in exactly one place — to print a label. And `subscriptions` / `payment_events` / `usage_records` / `usage_alerts` all carried `anon full access` (`for all using (true) with check (true)`), so anyone holding the public anon key could read every payment row and run `update subscriptions set plan_id='agency'`.

- **`src/lib/entitlementModel.js`** — one pure `can(ent, capability, ctx)`, imported by React *and* the Netlify functions so they can never disagree. `computeLifecycle` takes the **stricter of stored vs computed** status, so a stalled cron can't leave a lapsed user with paid access — the read path self-heals.
- **Two axes, never conflated.** `plan_id` (what they bought) and `status` (where they are) are separate columns. Modelling suspension as a `"suspended"` pseudo-plan would be silently dangerous: `getEffectivePlanById` falls back to Free for unknown ids, so a lapsed user would be *granted* the Free tier instead of denied.
- **`netlify/functions/lib/requireEntitlement.js`** — wired into `extract.js`, `ai.js`, `schedules.js`. **Fails open on infrastructure, closed only on an explicitly-read non-active status.** Same asymmetry as the existing coupon enforcement in `pricingSource.js`. Do not "harden" this.
- **`claim_billing_session()`** — `SECURITY DEFINER`, reads `auth.uid()` internally so a caller can't claim for anyone else, and refuses if the session already belongs to another user.
- **`schedules.js` allowlist** — it built its upsert row straight from the client object, so the browser dictated `status`. Independent of billing, that was a live issue.
- All six `checkCan*` keep their exact signatures (including the bare booleans), so the ~28 call sites in Preview/Dashboard/Batch were untouched. `whyCannot(cap)` is the new sibling for reasons.
- `usageService`'s `can*` are now thin delegates to the model — its 31 pre-existing tests pass unchanged, which is the evidence the refactor preserved semantics.

### PR2 — Invoice engine (`61f0f35`, `f209214`)

- **`src/lib/chargeMath.js`** — the money file. `totalMinor` keeps the **original one-step expression** whenever there's no proration credit, and an 80-case legacy-parity table (every plan × period × discount × currency) proves no charge moved. `tax = total − taxable`, **derived, never independently rounded**. `cgst = floor(tax/2)`, `sgst = remainder`.
- **`pricingMath.computeCharge`** is now an adapter over the same function, so the amount shown in `PaymentConfirmModal` is provably the amount charged.
- **`invoice_drafts`** — the price snapshot, written at order creation. `pricing_config` is runtime-mutable with a 60s cache, so without a snapshot an old invoice cannot be reproduced. **Rejected** stuffing this into Razorpay `notes`: capped at 15 keys/256 chars, and notes are partly *client-supplied*, which would put the browser in charge of a legal document.
- **Numbering is a counter table, not a sequence.** Sequences are non-transactional and gap on rollback; gaps in a GST series are what auditors ask about. `fy_of()` uses **1 April IST** — `2027-03-31T23:00Z` is already FY 27-28.
- **`issue_invoice(jsonb)`** returns `{created, invoice}`. Idempotency is a partial unique index on `(provider, provider_payment_id)` plus catching `unique_violation` — deliberately **not** the read-then-write pattern in `payment-webhook.js`, which races. Only `created:true` renders a PDF or sends mail.
- **`verify-payment.js` security fix.** It read `planId` from the **request body** and echoed it back with nothing cross-checking it against the order; `BillingProvider` then activated it. Harmless while entitlements were client-side, a free-upgrade path once the server grants access. It now reads plan/period from the draft.
- **Config-driven document type** via `SUPPLIER_GSTIN`: set → *Tax Invoice* (SAC 998314, place of supply, CGST/SGST vs IGST); unset → *Payment Receipt* that says it is not a tax invoice and emits no tax fields.
- **One layout model, two runtimes.** `invoiceModel.js` (pure) drives the PDF, the email body and the on-screen viewer. jsPDF 4.2.1 ships a real Node build (`"node": "./dist/jspdf.node.min.js"`), verified by rendering a `%PDF-` buffer headlessly.
- `GET /api/invoice-pdf?id=` — ownership is `auth.uid()` and **never `session_id`** (client-writable). Returns **404, not 403**, for another user's id so ids can't be enumerated.
- `POST /api/invoice-email` — takes an invoice id and nothing else; recipient resolved server-side from the verified session. Same open-relay reasoning as `contact-email.js`.
- Account UI: tabular list → click (or Enter) → view → download / email.

### PR3+PR4 — Lifecycle, dunning, purge, admin (`cf5a41a`)

- **`billing-lifecycle.js`** `@daily` — advances status, sends notices, applies due downgrades, pauses/resumes automation. Batch-first (one candidate query, one admin call for addresses), unlike the per-user loop in `reengagement.js`. **Deletes nothing.**
- **Notice series:** `renewal_t7`, `renewal_t2`, `lapsed_d0`, `suspend_d7`, `suspend_d21`, `deactivate_d30`, `delete_d83`, `delete_d88`, `delete_d90`. **At most one per run** — after an outage the customer gets the most recent notice, not the three that came due while it was down.
- **`billing_notice_log`** keyed on `user_id` (emails change) with `window_key` anchored on the **cycle**, not today. `reengagement.js` anchors on today, so an inactive user is emailed daily forever; for "your data will be deleted in 7 days" that would be catastrophic.
- Notices are **claimed before sending** (`Prefer: return=representation,resolution=ignore-duplicates`; empty array = another container owns it).
- **`prorationMath.js`** — credit is computed on `invoices.taxable_minor` of the invoice that *opened* the period, never list price. A customer who used a 20% coupon paid 20% less. No invoice → credit 0, line omitted.
- **`describePlanChange`** derives the "what you lose" list from the two plans' `limits`, so it can't go stale. Downgrade is warned, **never blocked**, and lands at period end.
- **`scheduled-runner.js`** now selects `user_id` + `system_paused=is.false` and batch-reads entitlements. It previously had no idea who owned a schedule and ran everything forever, for free.
- **`billing-purge.js`** — five independent interlocks, any one of which stops it: `PURGE_ENABLED === "1"` (default off); lifecycle cron succeeded within 48h; `last_notice_kind = 'delete_d90'`; `status=deactivated` AND `purge_after` past; `PURGE_MAX_USERS_PER_RUN`. Plus `PURGE_DRY_RUN`. **Invoices, payment_events, entitlements and the account survive** — tax retention outlives a deletion request.
- **`admin-billing.js`** — search/view/resend invoices, suspend, reactivate, comp, offline payment (issues a real numbered invoice via the same RPC, so the series stays gapless), refund → DTQC credit note with tax reversed **in proportion** for partials. Every mutation requires a `reason` and is audited.
- **`SuspendedBanner`** — non-dismissible by design; stays calm until the final week.

---

## 4. Schema reference (migrations 0012–0017)

**New tables:** `entitlements`, `billing_identity_links`, `invoices`, `invoice_lines`, `invoice_drafts`, `invoice_counters`, `invoice_emails`, `billing_notice_log`, `billing_audit_log`, `billing_cron_runs`

**New functions:** `claim_billing_session`, `merge_entitlement_from_subscriptions`, `plan_rank`, `fy_of`, `next_invoice_no`, `issue_invoice`, `invoices_immutable` (trigger)

**Columns added:** `user_id` on `subscriptions` / `payment_events` / `usage_records`; `system_paused` + `system_pause_reason` on `scheduled_tasks`

**`run-all.sql` is now GENERATED** — `npm run build:sql` (`--check` for CI). It had drifted: its own header claimed 0001–0011 but the file only contained 0001–0009, so fresh databases bootstrapped the documented way were silently missing `rate_limit_log` and `reengagement_log`. Fixed as a side effect.

---

## 5. Environment variables

All default safely — unset means "Payment Receipts, no purging".

| Var | Purpose |
|---|---|
| `SUPPLIER_GSTIN` | **The switch.** Set → Tax Invoice. Unset → Payment Receipt. |
| `SUPPLIER_LEGAL_NAME`, `SUPPLIER_TRADE_NAME`, `SUPPLIER_ADDRESS`, `SUPPLIER_STATE`, `SUPPLIER_COUNTRY`, `SUPPLIER_EMAIL`, `SUPPLIER_PAN` | Snapshotted onto every document at issue time |
| `BILLING_EMAIL_FROM` | `"DatIQ Billing <billing@datiq.app>"`. Send-only, `reply_to: hello@datiq.app`, so the two-inbox policy holds |
| `PURGE_ENABLED` | Must be exactly `"1"` to arm the purge |
| `PURGE_DRY_RUN` | `"1"` → report only |
| `PURGE_MAX_USERS_PER_RUN` | Default 50 |

Existing vars reused: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `URL`/`SITE_URL`.

**Scheduled functions now registered:** `scheduled-runner` `@hourly`, `reengagement` `@daily`, **`billing-lifecycle` `@daily`**, **`billing-purge` `@daily`**.

---

## 6. ⚠️ Deployment runbook — READ BEFORE APPLYING ANYTHING

### 6.1 The SQL has never been executed

There is no Postgres or Docker in this worktree. Migrations `0012`–`0017` have only been checked for `$$` balance and structure. **Apply them to a scratch Supabase project first** and confirm the objects in §4 exist.

```bash
PROD_SUPABASE_DB_URL=... npm run migrate:prod -- --dry-run
PROD_SUPABASE_DB_URL=... npm run migrate:prod
```

### 6.2 Migration order is load-bearing

`0012` is additive and behaviour-neutral. `0014` is not.

1. Apply **`0012`** (nullable columns, link table, `entitlements`). Zero behaviour change.
2. **Ship the dual-write release and let it run for at least one release cycle.** New rows then carry `user_id` from creation.
3. Apply **`0013`** (backfill). Note the orphan count it reports — those are genuine guest purchases.
4. Apply **`0014`** (RLS flip). **After this, guest/unclaimed payment history stops showing in-app.** That is the intended end state, but know it before you flip it.
5. Apply **`0015`**, **`0016`**, **`0017`**.

### 6.3 Arm the purge last, and slowly

Leave `PURGE_ENABLED` unset until `billing-lifecycle` has run cleanly for a full cycle. Then run with `PURGE_DRY_RUN=1` and read the logs before arming it for real. It cannot delete anyone who has not received `delete_d90`.

### 6.4 Before enabling `SUPPLIER_GSTIN`

Have a CA review one real rendered invoice. Note that checkout **already adds 18% labelled GST to every INR charge** (`create-checkout.js`); if there is no registration behind that, it needs its own review — the document type is not the only thing that has to be right.

---

## 7. Pending / not built

| Item | Notes |
|---|---|
| **Apply + verify the SQL** | The single biggest open risk. §6.1 |
| **Admin billing UI** | `admin-billing.js` and its 34 tests exist; **no React page consumes them yet.** Needs an `/admin/billing` page in the `AdminLayout` shell |
| **Billing-details capture UI** | Decision 6 was "Account profile card + optional checkout expander". `buyer_snapshot` and `placeOfSupply` are plumbed end-to-end and accepted by `create-checkout`, but **no UI collects them yet** — invoices currently carry email + name only, so place of supply defaults to intra-state |
| **Proration wired into checkout** | `prorationMath.js` is complete and tested; `create-checkout` accepts `prorationCreditMinor` and `chargeMath` applies it, but nothing yet **computes** it at upgrade time from the prior invoice |
| **`PlanChangeWarning` not mounted** | Component + CSS exist and are tested via `describePlanChange`; not yet wired into `Pricing.jsx`'s plan-select flow |
| **Scheduled-downgrade UI** | `scheduled_plan_id`/`scheduled_at` are honoured by the cron; no UI to set or cancel one |
| **Stripe path** | Still deferred. `create-checkout`'s Stripe branch does **not** write an invoice draft — only Razorpay does. Must be added when Stripe is re-enabled |
| **`purchaseBatchPack` client path** | Still never calls `logPaymentEvent`; now harmless because the invoice is created server-side from the draft, but the client-side gap remains |
| **e2e coverage** | No Playwright specs for invoices or the suspended state. `e2e/journeys/billing-suspended.spec.js` and `invoice-download.spec.js` were planned, not written |
| **`usage_records` / `usage_alerts` RLS** | Still `anon full access`. A privacy leak, **not** an entitlement escalation. Locking them breaks guest usage sync from `usageRepo.js`; needs guest writes moved behind a function first |
| **`reengagement.js` `user_email` bug** | Verified: it selects a column `0004_scheduler.sql` never creates, the query 400s, and `fetchActiveUsers` swallows it. **That cron is a silent no-op in production.** Not fixed here — out of scope — but the new billing crons deliberately avoid the pattern |
| **CLAUDE.md screenshots** | Readiness warns UI source changed since the newest screenshot. PR1–4 make no visible marketing-surface change; regenerate with `node docs/capture-screenshots.mjs` when convenient |

---

## 8. Bugs found and fixed along the way

**In existing code (verified in source, not inferred):**

1. `verify-payment.js:80` trusted `planId` from the request body and echoed it at `:206` with no cross-check against the order. Fixed in PR2.
2. `schedules.js:100-108` built its upsert from the client object, so the browser dictated `status`. Fixed in PR1.
3. `run-all.sql` contained only 0001–0009 while its header claimed 0001–0011. Fixed by generating it.
4. `reengagement.js:182` selects a non-existent `user_email` column → that cron has been a silent no-op. **Documented, not fixed.**

**In my own work, caught by tests or by rendering:**

5. **The cron's resume branch was unreachable.** With stricter-of-stored-vs-computed, a stored `suspended` can never be lifted by dates — schedules would have stayed paused **forever after a payment**, breaking requirement 10. Reactivation now resumes automation immediately in `activateFromInvoice`.
6. **`→` (U+2192) in invoice copy corrupted the whole text run's metrics** in the PDF — jsPDF's helvetica is WinAnsi and doesn't fall back to a placeholder. Only visible by rendering the page; every string assertion passed. `toPdfSafe()` now guards every text call.
7. The discount line carried SAC 998314 and a quantity. A discount is not a supply.
8. Admin comp clamped `days` with `Math.max(1, …)` *before* validating, so `days: 0` silently became a 1-day comp.
9. `entitlementClient.loadEntitlement` honoured an injected `now` for the freshness check but stamped `fetchedAt` with the real clock, making cache entries effectively immortal.
10. **The invoice email's "View in DatIQ" button linked to `/account/invoices/<id>` — a route that does not exist.** The plan called for dedicated routes; the implementation put the list and viewer on the Account page as a section + modal, and the email link was never updated. Every invoice email would have landed the customer on the NotFound page. Caught while fact-checking this handoff, not by any test. Now points at `/account`. All other `${siteUrl}/…` links in `netlify/functions` were audited against `App.jsx` and resolve correctly.

**Two places I reversed my own approved plan, and why:**

- **Draft-write failure no longer blocks checkout.** Blocking made Supabase a hard dependency of *revenue* when checkout deliberately works without it. A missing draft is recoverable (the reconstruct path); a refused checkout is a lost sale.
- **Unowned schedules run rather than being skipped.** A null `user_id` means *unknown*, not *lapsed*, and my own rule everywhere else is fail-open on unknown.

---

## 9. Known semantic gap (unchanged since planning)

With v1.0's **one-time Razorpay Orders there is no auto-renewal at all** — every renewal is a fresh purchase. So a "scheduled downgrade" cannot silently charge the cheaper plan at the boundary; in practice `scheduled_plan_id` means *"your next purchase is pre-selected as plan X"*, and the account also lapses to `suspended` in the same sweep. UI copy must say this.

**Razorpay Subscriptions / UPI Autopay remains the highest-value follow-up.** The webhook handlers for `subscription.charged` / `.cancelled` already exist and are unused.

---

## 10. Next-session entry point

```bash
cd /Users/vikash/Extracta/.claude/worktrees/datiq-invoicing-model-e16ea3
git log --oneline main..HEAD     # the 4 commits
npm run test:unit && npm run test:contract && npm run test:integration
```

Read in this order: `docs/SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md` (this file) → `src/lib/entitlementModel.js` (the authorization contract) → `src/lib/chargeMath.js` (the money contract) → `supabase/migrations/0012_billing_identity.sql` header (the migration ordering).

**Highest-value next steps, in order:**

1. Apply the migrations to a scratch Supabase project and verify §4.
2. Drive one real Razorpay **test-mode** payment end to end; confirm one invoice row, one number, one email with a `%PDF-` attachment, and `taxable + tax === total`.
3. Build the `/admin/billing` UI over the finished API.
4. Build the billing-details capture UI so invoices carry a real buyer and place of supply.
5. Wire proration into the upgrade path.

The approved plan is at `/Users/vikash/.claude/plans/datiq-does-not-have-lexical-cookie.md`.
