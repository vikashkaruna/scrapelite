# Recurring Billing (Subscriptions) — DEFERRED to v2.0

> **DatIQ v1.0 ships paid plans with one-time Order payments only.** The 4
> paid tiers (Select / Pro / Business / Agency) are active in v1.0 — the user
> pays a single amount and the plan is active until they cancel or repurchase.
> Auto-renewal, monthly/annual recurring charges, dunning, proration, and the
> customer portal are **deferred to v2.0**.

## What this deferral covers

| Concept | Status in v1.0 | Notes |
|---|---|---|
| Paid plan tiers (Select/Pro/Business/Agency) | ✅ Active | One-time payment per purchase |
| Free plan | ✅ Active | 10 extractions/mo + 25 trial credit |
| Top-up bundles (Batch Pack) | ✅ Active | One-time payment per bundle |
| Razorpay one-time Orders | ✅ Active | Used for all v1.0 plan + bundle purchases |
| **Razorpay Subscriptions** (recurring) | 🔒 v2.0 | Auto-billed monthly/annual cycles |
| **Stripe Subscriptions** (recurring) | 🔒 v2.0 | Same |
| Stripe Checkout (one-time) | 🔒 v2.0 (per STRIPE-DEFERRAL.md) | |
| Plan auto-renewal | 🔒 v2.0 | |
| Subscription webhook events (Razorpay: `subscription.activated/cancelled/charged`) | 🔒 v2.0 | |
| Customer portal (self-serve cancel / change plan) | 🔒 v2.0 | |
| Dunning / failed-payment retry | 🔒 v2.0 | |
| Proration on plan upgrade mid-cycle | 🔒 v2.0 | |

## Why the split

The 4 paid plans and the recurring billing infrastructure are two different
features. v1.0 needs the **plans** (so users see what they're getting and the
admin console can manage them) but doesn't need the **recurring** mechanic
yet. The user buys a plan with a single Razorpay one-time Order; the plan
stays active until they manually re-purchase or until an admin revokes it.

In v2.0 the same plans convert to recurring: each plan purchase creates a
Razorpay Subscription (or Stripe Subscription) that auto-renews monthly or
annually, with a webhook handler to track renewals / cancellations.

The architecture is set up for this — `billingPeriod` is already threaded
through the entire client and server stack (R11), the `subscriptions` table
in Supabase already has the `provider_subscription_id` column, and the
`payment-webhook.js` function already has a `subscription.activated` handler
(C-13) that simply needs to be wired into the order-creation flow.

## What changes in v1.0 vs v2.0

### v1.0 (one-time Orders)

- `/pricing` → user clicks "Get Pro" → Razorpay one-time Order created for
  `price_inr * 12 * 1.18` paise (annual) or `price_inr * 1.18` paise
  (monthly) → user pays → plan activated for the period → no auto-renewal
- Webhook receives `payment.captured` → marks subscription active in
  `subscriptions` table with `status: "active"`, no `provider_subscription_id`
- `current_period_end` is set to "now + 30 days" (monthly) or "now + 365
  days" (annual) on the client at activation time
- Plan expires when `current_period_end` passes; user re-purchases manually

### v2.0 (recurring Subscriptions)

- `/pricing` → user clicks "Get Pro" → Razorpay **Subscription** created
  (Razorpay Subscriptions API) or Stripe **Subscription** created (Stripe
  Subscriptions API) → user pays the first cycle → `subscription.activated`
  webhook → plan marked active with `provider_subscription_id` set
- Webhook receives `subscription.charged` (Razorpay) or
  `invoice.payment_succeeded` (Stripe) monthly/annually → extends
  `current_period_end` automatically
- Webhook receives `subscription.cancelled` (Razorpay) or
  `customer.subscription.deleted` (Stripe) → marks plan as cancelled
- Failed payments → dunning flow with retry + email notification
- Customer can self-serve cancel / change plan via Stripe Customer Portal
  (or a DatIQ-built equivalent for Razorpay)

## What's preserved for v2.0

| File | What it does |
|---|---|
| `src/lib/paymentService.js` | `initiateRazorpayCheckout`, `initiateStripeCheckout`; `billingPeriod` already threaded end-to-end (R11) |
| `netlify/functions/create-checkout.js` | Razorpay Order creation (v1.0) + Stripe Checkout session creation (preserved) |
| `netlify/functions/payment-webhook.js` | Handles `payment.captured` (v1.0) + `subscription.activated/charged/cancelled` (v2.0) + Stripe events (v2.0); 13 contract tests cover the full subscription webhook flow |
| `netlify/functions/verify-payment.js` | Razorpay HMAC verify + Stripe session retrieval |
| `src/lib/billing/` | `upgradePlan`, `applyCoupon`, `usageService` — all plan-aware, ready for recurring |
| `src/components/BillingProvider.jsx` | `currentPlanId`, `initiatePayment`, `retryPayment` — already handle `billingPeriod` |
| `supabase subscriptions` table | `provider_subscription_id` column already present; `current_period_start/end` already present |
| `scripts/setup-providers.sh` | `DATIQ_ENABLE_STRIPE=1` gate for Stripe product+webhook creation |
| `docs/STRIPE-DEFERRAL.md` | 6-step runbook for the Stripe side of v2.0 |

**Test coverage preserved:** 689 tests pass; the `create-checkout`,
`verify-payment`, and `payment-webhook` contract suites already exercise the
recurring webhook code path (C-13, C-21, C-24, C-25, C-26, C-30, C-31) so
v2.0 only needs the Razorpay Subscription / Stripe Subscription API calls
wired up — no test gaps.

## How to re-enable recurring billing in v2.0

1. **Razorpay Dashboard** → Subscriptions → Plans → create 4 plans
   (Select / Pro / Business / Agency) with monthly + annual cycles at the
   promotional INR prices. Copy the plan IDs to Netlify env:
   `VITE_RAZORPAY_PLAN_SELECT`, `VITE_RAZORPAY_PLAN_PRO`,
   `VITE_RAZORPAY_PLAN_BUSINESS`, `VITE_RAZORPAY_PLAN_AGENCY`.
2. **Stripe Dashboard** → Products → create 4 products with monthly +
   annual recurring prices in USD. Follow the `docs/STRIPE-DEFERRAL.md`
   6-step runbook.
3. **Code changes** in `netlify/functions/create-checkout.js`:
   - For Razorpay, switch from `POST /v1/orders` to
     `POST /v1/subscriptions` (Razorpay Subscriptions API) with `plan_id`,
     `customer_notify: 1`, `total_count: 12` (monthly) or `1` (annual).
   - For Stripe, use the existing `stripe.checkout.sessions.create` with
     `mode: "subscription"` and the `price` IDs from step 2.
4. **Add a cron / scheduled function** to handle dunning (retry failed
   payments 1, 3, 7 days after failure) — or use Razorpay's built-in
   `subscription.retry` setting.
5. **Build the customer portal** — for Stripe, link to
   `https://billing.stripe.com/p/login/<portal_id>`; for Razorpay, build a
   minimal in-app `/account/billing` page (cancel / change plan) using
   the Razorpay Subscriptions API.
6. **Update `payment-webhook.js`** — the handlers for
   `subscription.charged` and `subscription.cancelled` already exist; wire
   them to the Supabase `subscriptions` table updates.
7. **Smoke test** with a test card: subscribe to Pro annual → wait 1
   minute for first renewal (Stripe test mode does this immediately) →
   verify `current_period_end` advanced → cancel → verify `status: cancelled`.

## Tracking

This deferral is referenced from:
- `CLAUDE.md` — added to "Future development" + "Payment provider before
  going live" as the v2.0 backlog item for recurring billing
- `netlify/functions/payment-webhook.js` — subscription event handlers
  preserved with a TODO comment pointing at this doc
- This document — single source of truth for the recurring-billing deferral
