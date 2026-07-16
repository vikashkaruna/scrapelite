# Stripe Payment Integration — DEFERRED to v2.0

> **DatIQ v1.0 ships with Razorpay/INR one-time Orders as the primary payment
> path for all paid plans and bundles. USD users can still pay via Razorpay's
> international-card support (no native Stripe checkout).** Native USD/Stripe
> Checkout (and Razorpay Subscriptions / Stripe Subscriptions for recurring
> billing) is preserved in the codebase and re-enabled in v2.0.

## Decision

Native Stripe Checkout is **deferred from v1.0** (launched 2026-07-16) and
moved to the v2.0 roadmap. Reasoning:

1. **INR is the primary launch market.** Timezone detection defaults to INR;
   pricing page shows ₹1,499/mo and ₹14,999/mo by default for India-detected
   visitors. Razorpay's one-time Orders model handles INR end-to-end.
2. **USD users are not blocked.** Razorpay supports international cards, so
   USD visitors can complete checkout via Razorpay's USD order flow (no FX
   conversion by DatIQ — the user is charged in their card's currency by
   Razorpay). The server-side `create-checkout` already handles
   `currency: "USD"` + `provider: "razorpay"` (contract-tested in
   `create-checkout.test.js`).
3. **Native Stripe is a v2.0 differentiator.** It enables Stripe Subscriptions
   (recurring billing for monthly/annual cycles), Stripe Tax (US sales tax
   compliance), and Apple Pay / Google Pay buttons — all of which require
   dedicated engineering work that's not in v1.0 scope.
4. **The Stripe code path is already complete** and contract-tested in M2
   (55 tests across `create-checkout.test.js`, `verify-payment.test.js`,
   `payment-webhook.test.js`). Re-enabling is a config flip, not a rebuild.

## What v1.0 does

- **All 4 paid tiers (Select / Pro / Business / Agency) are active** in v1.0
  with one-time Order payments via Razorpay
- INR users → Razorpay INR order (default)
- USD users → Razorpay USD order (international card support)
- USD users with `VITE_STRIPE_PUBLISHABLE_KEY` set → Stripe Checkout (v2.0+;
  no production keys are set in v1.0)
- Override `VITE_PAYMENT_PROVIDER=stripe|razorpay` to force a specific provider
  regardless of currency

The free tier is unaffected — all visitors can use DatIQ end-to-end without
any payment integration. **Recurring billing** (auto-renewal, subscriptions)
is separately deferred — see [`docs/RECURRING-BILLING-DEFERRAL.md`](RECURRING-BILLING-DEFERRAL.md).

## What's preserved (not removed)

The following Stripe code is **kept in the codebase** so v2.0 can flip the
switch without a migration:

| File | What it does |
|---|---|
| `src/lib/paymentConfig.js` | `hasStripe` flag, `STRIPE_PRICE_IDS`, `getPaymentProvider()` routing |
| `src/lib/paymentService.js` | `initiateStripeCheckout`, `confirmStripeSession` |
| `src/pages/PaymentSuccess.jsx` | Stripe success-page verification branch |
| `netlify/functions/create-checkout.js` | `provider=stripe` Checkout session creation |
| `netlify/functions/verify-payment.js` | Stripe Checkout session retrieval |
| `netlify/functions/payment-webhook.js` | Stripe webhook event handler |
| `netlify/__tests__/create-checkout.test.js` | 25 contract tests (full Stripe code path covered) |
| `netlify/__tests__/verify-payment.test.js` | 17 contract tests |
| `netlify/__tests__/payment-webhook.test.js` | 13 contract tests |
| `scripts/setup-providers.sh` | Stripe product+price bootstrap (gated by `DATIQ_ENABLE_STRIPE=1`) |

## How to re-enable Stripe in v2.0

1. **Stripe Dashboard** → Developers → API keys → copy the live keys to Netlify
   env (`VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`).
2. **Stripe Dashboard** → Products → create the 4 plan products (Select / Pro /
   Business / Agency) with monthly + annual recurring prices in USD.
3. Run `DATIQ_ENABLE_STRIPE=1 bash scripts/setup-providers.sh` to surface the
   Stripe webhook URL (it does NOT auto-create products — those need the
   Stripe Dashboard UI for tax/recurring setup).
4. **Stripe Dashboard** → Webhooks → confirm the webhook URL points at
   `https://datiq.app/.netlify/functions/payment-webhook` (provider auto-detected
   from the URL, no `?provider=` query param for Stripe).
5. **Netlify** → Trigger a full redeploy. `getPaymentProvider("USD")` will
   now route to Stripe first (because `hasStripe` is true); Razorpay stays
   the primary path for INR.
6. Smoke test: `/pricing` → change to USD → click "Get Pro" → Stripe checkout
   opens → pay with `4242 4242 4242 4242` (Stripe test card) → verify plan
   upgrades in `/account`.

## v2.0 follow-ups (not in v1.0 scope)

- **Stripe Tax** — turn on Stripe Tax in the dashboard; configure US sales tax
  for the 4 plan products; update the `create-checkout` math to include tax
  line items.
- **Stripe Subscriptions** — switch from one-time Checkout sessions to
  recurring Subscriptions for the monthly/annual cycle (the billing model
  already threads `billingPeriod` through end-to-end, so the client doesn't
  change).
- **Apple Pay / Google Pay** — enabled automatically once Stripe Checkout is
  live; verify the Payment Request API button shows on /pricing.
- **Stripe Customer portal** — let users self-serve plan changes / cancellations
  via Stripe's hosted portal (link from `/account`).
- **Webhook replay tool** — handle missed Stripe events during deploy windows.
- **Update `VITE_STRIPE_PRICE_AGENCY`** to the new $299/mo Stripe price
  (was $199 in older docs; corrected to $299 in R4 pricingConfig).
- **Re-evaluate Supabase migrations** — current `pricing_config` table handles
  the v1.0 Razorpay-only world; v2.0 may add Stripe-customer-id mapping.

## Tracking

This deferral is referenced from:
- `CLAUDE.md` — added to "Future development" list as v2.0 backlog item, with
  a v2.0 follow-up list (Tax, Subscriptions, Apple/Google Pay, portal, replay)
- `scripts/setup-providers.sh` — Stripe steps gated by
  `DATIQ_ENABLE_STRIPE=1` (default 0)
- This document — single source of truth for the deferral decision

Public-facing:
- `public/help/index.html` — no change needed (Stripe was never announced as
  v1.0; the help site describes the live payment flow which is Razorpay)
- `pricingConfig.js` — `provider: "auto"` defaults to Razorpay; USD is
  routed through Razorpay international card support
- `public/vs/compare.html` — references "from $19/month" in the comparison
  CTAs (R4 update); this is a base-price statement, not a payment-method
  claim, so it stays accurate
