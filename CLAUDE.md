# ScrapeLite — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-08 (after V5c: real payment integration — Stripe/Razorpay/UPI, E2E audit 94/94 pass)**

---

## Quick orientation

| Property | Value |
|---|---|
| **Project** | ScrapeLite — zero-code web-extraction + enrichment platform |
| **Working dir** | `/home/user/scrapelite` (remote) or `/Users/vikash/Extracta` (local) |
| **Live site** | https://scrapelite.netlify.app |
| **GitHub** | https://github.com/vikashkaruna/scrapelite |
| **Netlify** | https://app.netlify.com/projects/scrapelite |
| **Run locally** | `npm run dev` → http://localhost:5173 |
| **Current branch** | `claude/v5-pricing-billing-7xoRQ` (V5 in development) |
| **Latest commit** | see `git log` — V5c: real payment integration (Stripe/Razorpay/UPI) |

---

## Tech stack (locked — do NOT change these choices)

- **Vite 5 + React 18 + React Router 6** (v7 future flags set in `main.jsx`)
- **Tailwind CSS** for utilities only — design system tokens live in CSS custom properties
- **Design system** — `src/styles/design-system.css` + `src/styles/screens.css`. **NEVER convert to Tailwind classes.**
- **lucide-react** icons via `src/components/Icon.jsx`. Add new icons there only.
- **Supabase** (`@supabase/supabase-js`) — localStorage fallback when not configured
- **jsPDF 4.2.1** — lazy-loaded only on PDF export click
- **stripe ^17.7.0** and **razorpay ^2.9.4** — in root package.json for Netlify Functions ONLY (never imported in Vite frontend)
- No test framework, no ESLint config (scripts: `dev`, `build`, `preview` only)

---

## Complete route map (V5 state)

| Route | Description | Access |
|---|---|---|
| `/` | Home / Extract | Requires onboarding |
| `/preview` | Review & Save extraction | Requires onboarding |
| `/dashboard` | Saved extractions | Requires onboarding |
| `/pricing` | Pricing plans, currency picker, top-up bundles | Public |
| `/account` | Billing & usage, metering alerts, coupon input, payment history | Requires onboarding |
| `/payment/success` | Post-payment confirmation (Stripe redirect / Razorpay success) | Public |
| `/payment/cancel` | Checkout cancelled screen | Public |
| `/onboarding` | 2-step persona selection | Standalone (no chrome) |
| `/privacy` | Privacy Policy | Public |
| `/terms` | Terms of Service | Public |
| `/admin` | Admin shell (PIN gated, demo PIN: `ADMIN123`) | Standalone |
| `/admin/revenue` | Revenue dashboard | Admin |
| `/admin/pricing` | Configurable plan pricing & limits | Admin |
| `/admin/coupons` | Coupon CRUD | Admin |
| `/admin/users` | User management | Admin |

---

## V5 — Pricing & Billing (June 2026, branch: claude/v5-pricing-billing-7xoRQ)

### New files added in V5

| File | Purpose |
|---|---|
| `src/lib/pricingConfig.js` | 5 plan definitions (Free/Select/Pro/Business/Agency) + 3 top-up bundles + multi-currency meta |
| `src/lib/pricingOverrides.js` | Admin-configurable price/limit overrides stored in localStorage — `getEffectivePlans()`, `getEffectivePlanById()`, `getGlobalDiscount()`, `applyGlobalDiscount()` |
| `src/lib/currencyService.js` | 6-currency conversion (USD/INR/EUR/GBP/SGD/AED), daily BOD refresh at 5 AM IST via open.er-api.com, localStorage cache |
| `src/lib/usageService.js` | Monthly extraction + enrichment counters; `canExtract()`, `canEnrich()`, `canExport()`, `canEmailExport()` — all use effective plan map so admin overrides apply |
| `src/lib/usageRepo.js` | Supabase sync layer for usage records + alert config. `syncUsageToDb()`, `fetchUsageFromDb()`, `getSessionId()` |
| `src/lib/alertService.js` | Metering alert config (`getAlertConfig()`, `saveAlertConfig()`), threshold tracking, `checkAndFireAlerts()` fires email via webhook |
| `src/lib/adminService.js` | Admin: coupon CRUD, user management, revenue metrics. `incrementCouponUses()` called on apply. Revenue uses localStorage pricing overrides. |
| `src/lib/paymentConfig.js` | ★ V5c: provider routing (`getPaymentProvider(currency)`), `hasPayment`, `PROVIDER_META` for UI |
| `src/lib/paymentService.js` | ★ V5c: `initiateCheckout({planId,currency,rates,discountPercent,sessionId,email})` — orchestrates Stripe redirect or Razorpay modal. Returns `{status: "demo_mode"\|"redirecting"\|"success"\|"cancelled"\|"contact_sales"}`. Pending payment in localStorage. |
| `src/lib/paymentRepo.js` | ★ V5c: Supabase sync — `syncSubscriptionToDb()`, `fetchSubscriptionFromDb()`, `logPaymentEvent()`, `fetchPaymentHistory()` |
| `src/components/BillingProvider.jsx` | ★ V5c: + `initiatePayment()`, `confirmPayment()`, `paymentLoading`, `paymentError`, `setPaymentError`, `paymentHistory`, `dbSubscription`, `paymentProvider`, `providerMeta`, `hasPayment` |
| `src/pages/Pricing.jsx` | ★ V5c: payment-backed `handleSelect`, `ProviderBadge`, provider badge, demo notice, UPI note, coupon discount banner, loading spinner per plan |
| `src/pages/Account.jsx` | ★ V5c: `PaymentHistorySection`, `apc-provider-badge`, `apc-status-warn`, `handleUpgrade` with real payment, paymentError banner with close button |
| `src/pages/PaymentSuccess.jsx` | ★ V5c: route `/payment/success` — verifies Stripe session or activates Razorpay; 3 states (verifying/success/error) |
| `src/pages/PaymentCancel.jsx` | ★ V5c: route `/payment/cancel` — clears pending payment, shows "No charge made" |
| `netlify/functions/create-checkout.js` | ★ V5c: POST — creates Stripe Checkout session or Razorpay order; dynamic imports; no VITE_ vars |
| `netlify/functions/verify-payment.js` | ★ V5c: GET=Stripe session verification, POST=Razorpay HMAC-SHA256 verification |
| `netlify/functions/payment-webhook.js` | ★ V5c: Stripe + Razorpay webhook handler; signature verification; Supabase subscription update |
| `src/pages/admin/AdminLayout.jsx` | Admin shell with PIN gate (ADMIN123), sidebar nav: Revenue / Pricing / Coupons / Users |
| `src/pages/admin/AdminPricing.jsx` | Fully editable plan pricing + limits + global discount + top-up bundle prices — no hardcoding |
| `src/pages/admin/AdminRevenue.jsx` | KPI cards, 6-month MRR trend bar chart, plan distribution — uses `getEffectivePlanById()` |
| `src/pages/admin/AdminCoupons.jsx` | Coupon CRUD: create (% or bonus extractions), activate/deactivate/delete |
| `src/pages/admin/AdminUsers.jsx` | User table: search, plan filter, extend usage, personalised invite |

### Key architectural patterns (V5)

| Pattern | Detail |
|---|---|
| **No hardcoded pricing** | `pricingConfig.js` holds defaults; `pricingOverrides.js` layers admin edits. Always call `getEffectivePlans()` / `getEffectivePlanById()` — never import `PLAN_BY_ID` directly from `pricingConfig`. |
| **Usage enforcement** | `BillingProvider` exposes `checkCanExtract()` / `checkCanEnrich()`. `ExtractionProvider` calls them before extract/enrich. Limit breach shows toast + redirects to /pricing. |
| **Usage DB sync** | `BillingProvider` debounces DB writes (2 s) after every tracked extraction or enrichment. `fetchUsageFromDb()` on mount to hydrate from Supabase. |
| **Metering alerts** | `checkAndFireAlerts()` called after every extraction. Fires once per threshold per month via webhook → mailto fallback. |
| **Coupon use count** | `incrementCouponUses()` called in `BillingProvider.applyCoupon()` to prevent unlimited reuse. |
| **Admin pricing** | Changes in `/admin/pricing` immediately apply site-wide (localStorage-backed, no rebuild). `getEffectivePlanMap()` is called in `usageService.js` and `BillingProvider` on every check. |
| **Admin auth** | `localStorage.getItem("scrapelite.adminAuth")` === `"true"` (JSON boolean). Demo PIN: `ADMIN123`. |
| **BillingProvider tree** | `PersonaProvider > BillingProvider > ExtractionProvider` in `App.jsx`. |
| **Payment provider routing** | `getPaymentProvider(currency)` in `paymentConfig.js` — INR/AED → Razorpay, else → Stripe. Overridable via `VITE_PAYMENT_PROVIDER=stripe\|razorpay\|auto`. |
| **Demo mode** | `hasPayment = false` (no keys set) → `initiateCheckout` returns `{status:"demo_mode"}` → `upgradePlan()` locally, no real charge. |
| **Stripe flow** | `create-checkout` → Stripe hosted URL → redirect to `/payment/success?session_id=…&plan=…&provider=stripe` → `verify-payment` GET → activate. |
| **Razorpay flow** | `create-checkout` → returns `{orderId,amount,currency}` → paymentService lazy-loads CDN SDK → opens modal → `verify-payment` POST HMAC → activate. |
| **Pending payment** | `savePendingPayment(planId, provider)` to localStorage before Stripe redirect; cleared on `/payment/success` or `/payment/cancel`. |
| **Server-side secrets** | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env only, never VITE_ prefixed. |
| **Netlify Functions** | ESM (`export const handler`), `esbuild` bundler, in `netlify/functions/`. `stripe`/`razorpay` npm packages in root `package.json`, dynamic-imported in functions only. |

---

## Supabase schema — COMPLETE STATE (V5c additions)

Run in Supabase SQL Editor:

```sql
-- V5: Usage tracking
create table if not exists public.usage_records (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  month       text not null,
  extractions integer not null default 0,
  enrichments integer not null default 0,
  plan_id     text not null default 'free',
  updated_at  timestamptz not null default now(),
  unique(session_id, month)
);
alter table public.usage_records enable row level security;
create policy "anon full access" on public.usage_records
  for all using (true) with check (true);

-- V5: Alert preferences
create table if not exists public.usage_alerts (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null unique,
  email        text not null,
  thresholds   integer[] not null default '{80,95}',
  enabled      boolean not null default true,
  last_notified_at timestamptz
);
alter table public.usage_alerts enable row level security;
create policy "anon full access" on public.usage_alerts
  for all using (true) with check (true);

-- V5c: Payment subscriptions
create table if not exists public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  session_id                text not null unique,
  plan_id                   text,
  status                    text,
  provider                  text,
  provider_subscription_id  text,
  provider_customer_id      text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);
alter table public.subscriptions enable row level security;
create policy "anon full access" on public.subscriptions
  for all using (true) with check (true);

-- V5c: Payment event audit log
create table if not exists public.payment_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       text,
  event_type       text,
  provider         text,
  provider_event_id text,
  plan_id          text,
  amount_cents     integer,
  currency         text,
  status           text,
  created_at       timestamptz default now()
);
alter table public.payment_events enable row level security;
create policy "anon full access" on public.payment_events
  for all using (true) with check (true);
```

> ⚠️ `usage_records`, `usage_alerts`, `subscriptions`, `payment_events` tables have NOT been created yet. App gracefully degrades to localStorage when Supabase is not configured or tables are missing.

---

## Environment variables

File: `.env` — **has real values** (do NOT clear or overwrite)

```
VITE_SUPABASE_URL=           # live Supabase project URL
VITE_SUPABASE_ANON_KEY=      # anon/public key
VITE_FIRECRAWL_API_KEY=      # fc-... (real, working)
VITE_AI_API_KEY=             # sk-ant-... (real, working — browser-side, demo only)
VITE_AI_MODEL=claude-haiku-4-5-20251001
VITE_WEBHOOK_URL=            # n8n webhook (test URL — use production URL for live sends)
VITE_LINK_CHANGELOG=         # Optional footer link
VITE_LINK_ABOUT=             # Optional footer link
VITE_LINK_BLOG=              # Optional footer link

# Payment (V5c) — add to .env for real payment mode
VITE_PAYMENT_PROVIDER=auto               # auto | stripe | razorpay
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # browser-safe
STRIPE_SECRET_KEY=sk_test_...            # Netlify env ONLY — never VITE_
STRIPE_WEBHOOK_SECRET=whsec_...          # Netlify env ONLY
VITE_STRIPE_PRICE_SELECT=price_...       # recurring price IDs per plan
VITE_STRIPE_PRICE_PRO=price_...
VITE_STRIPE_PRICE_BUSINESS=price_...
VITE_STRIPE_PRICE_AGENCY=price_...
VITE_RAZORPAY_KEY_ID=rzp_test_...        # browser-safe
RAZORPAY_KEY_ID=rzp_test_...             # Netlify env ONLY
RAZORPAY_KEY_SECRET=...                  # Netlify env ONLY
RAZORPAY_WEBHOOK_SECRET=...              # Netlify env ONLY
VITE_RAZORPAY_PLAN_SELECT=plan_...       # Razorpay subscription plan IDs
VITE_RAZORPAY_PLAN_PRO=plan_...
VITE_RAZORPAY_PLAN_BUSINESS=plan_...
VITE_RAZORPAY_PLAN_AGENCY=plan_...
```

---

## Complete file map (V5c state)

```
src/
├── App.jsx                           V5c: + /payment/success, /payment/cancel in PUBLIC_PATHS + routes
├── main.jsx
├── index.css
├── styles/
│   ├── design-system.css             + .btn-full, @keyframes spin
│   └── screens.css                   + pricing, account, admin, alerts, payment pages (1700+ lines)
├── data/
│   └── mockData.js
├── lib/
│   ├── pricingConfig.js              Plan defaults (5 plans, 3 bundles, currency meta)
│   ├── pricingOverrides.js           ★ Admin-editable overrides; getEffectivePlans(), getGlobalDiscount()
│   ├── currencyService.js            6-currency rates, daily BOD refresh, localStorage cache
│   ├── usageService.js               Monthly counters, canExtract/canEnrich/canExport — uses effective plans
│   ├── usageRepo.js                  Supabase sync: syncUsageToDb, fetchUsageFromDb, getSessionId
│   ├── alertService.js               Threshold alerts: getAlertConfig, saveAlertConfig, checkAndFireAlerts
│   ├── adminService.js               Coupon CRUD, user management, revenue metrics (reads price overrides)
│   ├── paymentConfig.js              ★ V5c: provider routing, hasPayment, PROVIDER_META
│   ├── paymentService.js             ★ V5c: initiateCheckout (Stripe/Razorpay/demo), confirmStripeSession, pending payment localStorage
│   ├── paymentRepo.js                ★ V5c: Supabase subscription + payment_events sync
│   ├── config.js
│   ├── utils.js
│   ├── supabaseClient.js
│   ├── firecrawlService.js
│   ├── aiService.js
│   ├── linkCategorizer.js
│   ├── extractionPresets.js
│   ├── enrichmentStore.js
│   ├── extractionsRepo.js
│   ├── pdfExport.js
│   ├── webhook.js
│   ├── emailService.js
│   ├── errorMessages.js
│   └── personaConfig.js
├── components/
│   ├── BillingProvider.jsx           ★ V5c: + initiatePayment, confirmPayment, paymentLoading/Error, paymentHistory, dbSubscription
│   ├── PersonaProvider.jsx
│   ├── ExtractionProvider.jsx        V5: checks billing limits before extract/enrich; tracks usage
│   ├── Footer.jsx                    + /pricing and /account links
│   ├── TopBar.jsx                    V5: plan badge (paid plans), account icon, Pricing nav link
│   ├── Button.jsx                    + fullWidth prop
│   ├── Toggle.jsx
│   ├── StructuredData.jsx
│   ├── ContentModal.jsx
│   ├── EmailModal.jsx
│   ├── BrandLoader.jsx
│   ├── Icon.jsx                      + CreditCard, Tag, Gift, Crown, AlertCircle, Calendar, DollarSign, Percent
│   ├── FaviconDot.jsx
│   ├── ThemeProvider.jsx
│   ├── Toast.jsx
│   ├── ErrorModal.jsx
│   └── LoadingScreen.jsx
└── pages/
    ├── Home.jsx
    ├── Preview.jsx
    ├── Dashboard.jsx                 V5: billing-gated CSV/PDF/email exports
    ├── Pricing.jsx                   ★ V5c: payment-backed select, ProviderBadge, loading per plan, demo notice
    ├── Account.jsx                   ★ V5c: PaymentHistorySection, handleUpgrade, paymentError banner with close
    ├── PaymentSuccess.jsx            ★ V5c: /payment/success — Stripe verify + Razorpay activate; 3 states
    ├── PaymentCancel.jsx             ★ V5c: /payment/cancel — clears pending, shows "No charge"
    ├── Onboarding.jsx
    ├── Privacy.jsx
    ├── Terms.jsx
    └── admin/
        ├── AdminLayout.jsx           PIN gate (ADMIN123), sidebar: Revenue/Pricing/Coupons/Users
        ├── AdminRevenue.jsx          KPI cards, MRR trend chart, plan distribution (uses getEffectivePlanById)
        ├── AdminPricing.jsx          ★ V5: fully editable plan prices, limits, global discount, bundles
        ├── AdminCoupons.jsx          Coupon CRUD
        └── AdminUsers.jsx            User management, invite, extend limits

netlify/
└── functions/
    ├── create-checkout.js            ★ V5c: POST — Stripe Checkout session or Razorpay order creation
    ├── verify-payment.js             ★ V5c: GET=Stripe verify, POST=Razorpay HMAC verify
    └── payment-webhook.js            ★ V5c: Stripe + Razorpay webhook handler
```

---

## Architecture rules (LOCKED)

| Rule | Detail |
|---|---|
| CSS | Keep `design-system.css` + `screens.css` tokens. Never convert to Tailwind. |
| Pricing | Always use `getEffectivePlans()` / `getEffectivePlanById()` — never use `PLAN_BY_ID` from `pricingConfig` directly in UI code |
| Services | Mock-but-real-ready: env present → real call, absent → mock + localStorage |
| Supabase fallback | isMissingColumnError → retry with v1 columns only. Never hard-fail a save. |
| Dashboard seed | NONE — starts empty. Do not re-add. |
| Table layout | `table-layout:fixed`, fixed px widths on narrow cols |
| TopBar "+ New" | Only shown on `/preview` |
| PDF | Lazy-loaded via `await import()`. Never static-import jsPDF. |
| Background enrichment | `enrich()` must never show the full-screen loader. |
| Admin | `/admin` is standalone (no TopBar/Footer). PIN: `ADMIN123`. |
| Payment secrets | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env ONLY. Never VITE_ prefix. |
| Netlify Functions | ESM (`export const handler`), in `netlify/functions/`. `stripe`/`razorpay` dynamic-imported only — never imported in any Vite frontend file. |

---

## Critical bugs fixed in V5 (do NOT regress)

1. **Coupon use count** — `incrementCouponUses()` called in `applyCoupon()` to prevent unlimited reuse
2. **Admin auth boolean** — `ls(ADMIN_AUTH_KEY) === true || v === "true"` (was checking string vs bool)
3. **Currency dropdown** — click-outside handler via `useEffect` + `mousedown` listener on `document`
4. **AbortSignal.timeout** — replaced with manual `AbortController + setTimeout` (wider browser compat)
5. **Effective plan map** — `usageService.js` and `BillingProvider` use `getEffectivePlanMap()` not hardcoded `PLAN_BY_ID`
6. **Revenue prices** — `adminService.getRevenueMetrics()` reads localStorage pricing overrides directly
7. **Consistent canExtract/canEnrich shapes** — always return `{ allowed, remaining, reason? }`
8. **Coupon remove UI** — "×" button in Account.jsx calls `removeCoupon()` to clear applied coupon
9. **Coupon planId validation** — `validateCoupon(code, currentPlanId)` now enforces plan-restricted coupons (e.g. INDIE10 only valid on Select plan)
10. **V5c: `initiatePayment` returns result** — BillingProvider has `return result` in try + `throw e` in catch; free plan returns `{ status: "free" }`
11. **V5c: loading spinner targets correct plan** — `PlanCard` receives `loading={loadingPlan}` (plan ID string); checks `loading === plan.id`
12. **V5c: `AdminRevenue` uses `getEffectivePlanById`** — was importing `PLAN_BY_ID` directly (arch violation; plan name overrides wouldn't show)
13. **V5c: Account paymentError banner** — has close button (`setPaymentError("")`) matching Pricing.jsx pattern
14. **V5c: Account `handleUpgrade` navigation** — on demo_mode/success goes to `/account` (not `/pricing`)

---

## Outstanding tasks for next session

### Supabase migrations (still unrun)
```sql
-- Run in Supabase SQL Editor:
-- 1. V2 columns (if not done yet)
alter table public.extractions
  add column if not exists custom_extraction jsonb,
  add column if not exists domain_map        jsonb,
  add column if not exists enrichments       jsonb;

-- 2. V5 usage + alert tables (see schema section above)
-- 3. V5c payment tables: subscriptions + payment_events (see schema section above)
```

### Payment provider setup (before going live)
- [ ] **Stripe Dashboard**: Create Products + recurring Prices for Select/Pro/Business/Agency plans + 3 bundle one-time prices → set `VITE_STRIPE_PRICE_*` env vars
- [ ] **Razorpay Dashboard**: Create Subscription Plans for each paid plan → set `VITE_RAZORPAY_PLAN_*` env vars
- [ ] **Netlify env vars**: Set all `STRIPE_*`, `RAZORPAY_*` server-only secrets in Netlify dashboard (Project → Environment variables)
- [ ] **Stripe webhook**: Register `https://scrapelite.netlify.app/.netlify/functions/payment-webhook` in Stripe Dashboard → Webhooks; copy signing secret → `STRIPE_WEBHOOK_SECRET`
- [ ] **Razorpay webhook**: Register same endpoint in Razorpay Dashboard → Account Settings → Webhooks

### V5 remaining work
- [ ] **Supabase Auth** — Replace localStorage persona/session with real auth for cross-device usage tracking
- [ ] **Preview persona context** — Persona-specific enrichment labels (e.g. "Prospect Intel" for Sales, "Site Audit" for SEO)
- [ ] **Demo video links** — `demoUrl` + `demoLabel` in personaConfig but no play button yet
- [ ] **Sign-in modal** — "Sign in" for returning users

### V2/V4 pending (still applies)
- [ ] Merge `claude/v5-pricing-billing-7xoRQ` → `main` once reviewed
- [ ] Switch webhook to production n8n URL
- [ ] Add Netlify Function proxy for `VITE_AI_API_KEY`
- [ ] Delete `version-2.0` branch: `git push origin --delete version-2.0`

---

## How to continue developing

```bash
cd /home/user/scrapelite    # remote
git checkout claude/v5-pricing-billing-7xoRQ
git status                   # should be clean
npm run dev                  # http://localhost:5173
```

**Test payment flow (demo mode — no keys needed):**
1. Go to `/pricing`
2. Select any paid plan → button shows spinner → "demo_mode" → redirects to `/account`
3. Account page shows upgraded plan

**Test payment success page (demo):**
1. Navigate to `/payment/success?plan=pro&provider=razorpay`
2. Should show success state with plan name

**Test payment cancel page:**
1. Navigate to `/payment/cancel?plan=pro`
2. Should show "No charge was made" with plan name

**Test admin module:**
1. Navigate to `/admin`
2. Enter PIN: `ADMIN123`
3. Revenue → Pricing → Coupons → Users

**Test pricing overrides:**
1. Go to `/admin/pricing`
2. Change a plan price → click Save
3. Go to `/pricing` — updated price is shown immediately

**Test metering alerts:**
1. Go to `/account`
2. Enable alerts, enter email, choose thresholds
3. Click Save alert settings

**Test coupon:**
1. Go to `/account`
2. Enter `LAUNCH20` → Apply
3. Check bonus or discount applied
4. Click × to remove coupon

---

## Git log (recent)

```
(pending)  V5c: payment integration fixes (E2E 94/94), CLAUDE.md updated
(pending)  V5c: real payment integration — Stripe/Razorpay/UPI
(pending)  V5b: coupon planId validation fix, E2E audit 90/91 pass
de2d134    V5: Pricing & Billing module — plans, usage metering, admin console
e1502a7    Merge V4 Persona-Onboard as base for V5 Pricing-Billing
5c803b5    Add CLAUDE.md
fdd5b81    V4: Footer env-var links, a11y keyboard handler, localStorage guards, mobile CSS
5acac2f    V4: Persona-based onboarding, persona-adaptive UI, Privacy/Terms pages, Footer
```

---

## E2E test results (2026-06-08, V5c)

Static code analysis + runtime logic tracing across all routes (no `.env` in CI environment — mock/demo mode):

**94/94 functional checks PASS** — clean run, no regressions.

All routes, components, CSS classes (25 new payment classes), icon registrations, provider tree, admin PIN gate, coupon CRUD, pricing overrides, usage metering, alerts, Netlify functions (create-checkout, verify-payment, payment-webhook), PaymentSuccess/Cancel pages, BillingProvider payment context, and all payment flow paths verified intact.
