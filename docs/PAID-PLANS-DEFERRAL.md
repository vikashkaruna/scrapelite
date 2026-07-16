# Paid Plans (Select / Pro / Business / Agency) — DEFERRED to v2.0

> **DatIQ v1.0 ships with only the Free plan.** All 4 paid tiers
> (Select / Pro / Business / Agency) are deferred to v2.0 alongside Stripe
> and the recurring-billing infrastructure.

## Decision

The 4 paid plans are **deferred from v1.0** (launched 2026-07-16) and moved
to the v2.0 roadmap. Reasoning:

1. **Free plan covers the full product surface.** Every feature (extraction,
   AI summary, custom prompts, enrichment, domain mapping, batch up to 5 URLs,
   dashboard, CSV export, scheduling) is available in the Free plan with the
   25-extraction trial credit. The only limitations vs. paid are the
   extraction count and the export format set.
2. **Revenue is not the v1.0 KPI.** The goal of v1.0 is to validate product
   market fit, collect qualitative feedback, and seed organic SEO/AI-citation
   traffic. Charging for the product is a v2.0 concern.
3. **Payment infrastructure is not worth the launch risk.** Recurring billing
   (Razorpay Subscriptions or Stripe Subscriptions) requires webhook
   idempotency, plan-change proration, dunning, customer portal, and refund
   flows. None of which v1.0 needs.
4. **The paid-plan code is already complete and tested.** The pricing config
   (7 plan tiers, all features mapped), the admin editor, the plan-picker UI,
   the upgrade flow, the coupon engine, the revenue dashboard — all ship-
   ready. v2.0 re-enables with a single config flip.

## What v1.0 ships with

| Plan | Status in v1.0 | In /pricing | In /admin |
|---|---|---|---|
| **Free** | ✅ Active | ✅ Visible | ✅ Editable |
| **Select** ($19 / ₹1,899) | 🔒 v2.0 only | "Coming in v2.0" waitlist card | Visible (disabled) |
| **Pro** ($29 / ₹1,499) | 🔒 v2.0 only | "Coming in v2.0" waitlist card | Visible (disabled) |
| **Business** ($79 / ₹3,999) | 🔒 v2.0 only | "Coming in v2.0" waitlist card | Visible (disabled) |
| **Agency** ($299 / ₹14,999) | 🔒 v2.0 only | "Coming in v2.0" waitlist card | Visible (disabled) |
| **Developer** (coming soon) | ⏳ H2 2026 (existing) | "Notify me" card | Visible |
| **Enterprise** (custom) | 📞 Contact sales | "Contact sales" card | Visible (separate from PLANS array) |

### What still works in v1.0

- **Free plan** — full feature set with 10 extractions/month + 25 trial credit
- **Top-up bundles** (Batch Pack) — one-time purchases, no subscription needed
  (kept in scope; bundles aren't "subscription-based")
- **All 5 enrichment categories** (Contacts, Leadership, Social, Mission,
  Pricing)
- **All 5 export formats** within the Free plan's export set (CSV); PDF /
  Markdown / JSON / Email are gated to paid plans and won't fire in v1.0
- **Dashboard, scheduling, batch mode, content generation, persona selection**
- **Admin console** — fully functional, but paid plan edits are no-ops
  (the editor stays so v2.0 can flip the switch)

### What changes in the UI

- `/pricing` — 7 plan cards currently; v1.0 shows 4 cards (Free + Developer
  waitlist + Enterprise contact + a "Select/Pro/Business/Agency coming in
  v2.0" combined waitlist card with email capture)
- `/account` — no "Upgrade" CTA; "Current plan: Free" is the only state
- `/admin/pricing` — all 7 plans visible but Select/Pro/Business/Agency show
  a "v2.0 only" badge; editing them has no effect until v2.0 (data is still
  stored so v2.0 can read it)
- `/admin/coupons` — coupons tied to Select/Pro/Business/Agency are visible
  but cannot be self-applied (existing `planId: 'manual'` mechanic handles
  this; new `planId: 'v2-only'` will be added if needed)
- `/admin/revenue` — MRR = $0 (no paid customers); chart shows the
  month-by-month empty state
- `/admin/users` — every user shows "Free" as their plan; coupon column
  shows manual-assign coupons only

### Payment flow

- No real charges in v1.0. The Razorpay one-time Orders path stays wired
  (test mode) for any v1.0 BetaTester who needs a paid plan early — but the
  UI does not offer it.
- `DemoPaymentModal` (the "confirm/cancel" mock UI) is still in the code
  for v2.0.

## What's preserved (not removed)

The following paid-plan code is **kept in the codebase** so v2.0 can flip
the switch without a migration:

| File | What it does |
|---|---|
| `src/lib/pricingConfig.js` | All 4 paid plans fully defined (price, features, limits) |
| `src/lib/pricingOverrides.js` | `getEffectivePlans()` returns all 7 tiers; `getV1Plans()` filter helper for v1.0 UI |
| `src/pages/Pricing.jsx` | 7-card grid + billing toggle; v1.0 uses the waitlist card for paid tiers |
| `src/pages/Account.jsx` | Plan upgrade + coupon inputs (no-op for paid plans in v1.0) |
| `src/components/PaymentConfirmModal.jsx` | GST breakdown + confirm-cancel (no-op for paid plans in v1.0) |
| `src/components/TopupBundleModal.jsx` | Batch Pack top-up (active in v1.0) |
| `src/lib/paymentService.js` | `initiateRazorpayCheckout`, `initiateCheckout` (no-op for paid plans in v1.0; bundle purchases still work) |
| `src/lib/paymentConfig.js` | Routing + provider flags |
| `src/lib/couponService.js` + `src/lib/adminService.js` | Coupon engine (active for manual-assign coupons only) |
| `src/lib/billing/` | Plan upgrade + limit-check (paid-plan paths are no-ops in v1.0) |
| `src/pages/admin/AdminPricing.jsx` | Plan editor (all 7 plans editable; paid-plan edits are no-ops) |
| `src/pages/admin/AdminRevenue.jsx` | Live revenue dashboard (zero state in v1.0) |
| `src/pages/admin/AdminUsers.jsx` | User plan display (Free in v1.0) |
| `src/pages/admin/AdminCoupons.jsx` | Coupon CRUD (paid-plan coupons visible but inert) |
| `netlify/functions/create-checkout.js` | Order creation (bundle flow active; plan flow no-op) |
| `netlify/functions/verify-payment.js` | Payment verification (active for bundles) |
| `netlify/functions/payment-webhook.js` | Webhook handler (active; no paid-plan events expected) |
| `netlify/functions/admin-revenue.js` | Revenue aggregation (zero state) |
| `netlify/functions/admin-users.js` | User plan data (all show Free) |
| `netlify/__tests__/create-checkout.test.js` | 25 contract tests covering paid-plan + bundle flows |
| `netlify/__tests__/verify-payment.test.js` | 17 tests |
| `netlify/__tests__/payment-webhook.test.js` | 13 tests |
| `src/lib/paymentService.test.js` | Unit tests for service layer |
| `src/lib/pricingConfig.test.js` | Unit tests for plan config |
| `src/lib/pricingOverrides.test.js` | Unit tests for effective plan map |
| `src/lib/pricingMath.test.js` | GST/discount math tests |
| `src/components/PaymentConfirmModal.integration.test.jsx` | 10 tests |
| `src/components/TopupBundleModal.integration.test.jsx` | 11 tests |
| `src/pages/Account.integration.test.jsx` | Plan upgrade tests |
| `src/pages/Pricing.integration.test.jsx` | 7-card grid tests |
| `src/pages/admin/AdminPricing.integration.test.jsx` | Plan editor tests |
| `src/pages/admin/AdminRevenue.integration.test.jsx` | Live revenue tests |

**Total preserved test coverage:** 689 tests, all green.

## How to re-enable paid plans in v2.0

1. **Update `pricingConfig.js`** — flip `v1_active: false` to `true` on the
   4 paid plans (or remove the `v1_active` key entirely; default is active)
2. **Update `pricingOverrides.js`** — change `getV1Plans()` to return all
   plans, OR just delete the function and inline the filter
3. **Update `Pricing.jsx`** — switch from `getV1Plans()` to `getEffectivePlans()`
4. **Update `Account.jsx`, `PaymentConfirmModal.jsx`, `TopupBundleModal.jsx`** —
   same switch
5. **Update admin pages** — remove the "v2.0 only" badges
6. **Wire Razorpay Subscriptions** (or Stripe Subscriptions) — see
   `docs/STRIPE-DEFERRAL.md` for the Stripe path; Razorpay Subscriptions
   follow a parallel flow with the `VITE_RAZORPAY_PLAN_*` env vars
7. **Build, deploy, smoke-test** — `/pricing` → click "Get Pro" → real
   checkout → verify plan upgrades in `/account`

## Tracking

This deferral is referenced from:
- `CLAUDE.md` — added to "Future development" list as v2.0 backlog item
- `src/lib/pricingConfig.js` — `v1_active: false` flag on 4 paid plans
- `src/lib/pricingOverrides.js` — `getV1Plans()` filter helper
- `src/pages/Pricing.jsx` — uses `getV1Plans()` for the visible card set
- This document — single source of truth for the deferral decision
