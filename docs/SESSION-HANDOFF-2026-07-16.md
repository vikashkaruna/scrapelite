# Session Handoff — 2026-07-16 (DatIQ v1.0 launch readiness)

> **Context for the next Claude session.** This is the state at end of today's
> session, when the user saved the session to start fresh. All v1.0 launch
> work is in `main`; live at https://datiq.app; 689/689 tests green.

## TL;DR

- **Live site**: https://datiq.app returns 200
- **Branch**: `main` (clean, all pushed to origin/main)
- **Latest commit**: `cbb470a` — "fix(v1.0): correct deferral scope — paid plans REMAIN; only recurring billing is deferred to v2.0"
- **Tests**: 689/689 pass (308 unit + 255 contract + 119 integration + 7 system)
- **Build**: clean (1.74s)
- **Production deploys**: auto from main → Netlify

## What v1.0 ships

- **All 4 paid plans (Free / Select / Pro / Business / Agency) are active** with one-time Razorpay Order payments
- Free plan: 10 extractions/mo + 25-extraction trial credit (FR-Z-02)
- Top-up bundles (Batch Pack) active
- All 5 enrichment categories, batch mode (up to 5 URLs), scheduling, content generation
- Admin console fully functional
- Live stats pipeline (when Supabase configured)
- 2 production bug fixes (SSRF guard in extract.js, id preservation in extractions.js)

## What's deferred to v2.0

1. **Recurring/subscription billing** — see [`docs/RECURRING-BILLING-DEFERRAL.md`](RECURRING-BILLING-DEFERRAL.md)
   - Razorpay Subscriptions, Stripe Subscriptions, auto-renewal, dunning, customer portal
2. **Stripe Checkout** — see [`docs/STRIPE-DEFERRAL.md`](STRIPE-DEFERRAL.md)
   - USD-native checkout; Razorpay handles USD via international cards in v1.0

## Critical files (all committed)

- `src/lib/pricingConfig.js` — 7 plans (all v1_active default)
- `src/lib/pricingOverrides.js` — `getEffectivePlans()` (no v1_active filter)
- `src/pages/Pricing.jsx` — 7-card grid (Free + 4 paid + Developer + Enterprise)
- `src/lib/paymentConfig.js` — Razorpay/INR + Razorpay/USD routing; Stripe dormant
- `netlify/functions/lib/scrapeProviders.js` — 4-provider chain (Firecrawl/Spider/Jina/Direct)
- `netlify/functions/lib/aiProviders.js` — multi-provider AI (Gemini/Anthropic/OpenAI)

## Netlify env state (production, verified 2026-07-16)

**Set:**
- SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ACCESS_TOKEN
- AI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, RESEND_API_KEY
- SPIDER_API_KEY, FIRECRAWL_API_KEY
- RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
- VITE_RAZORPAY_KEY_ID, VITE_RAZORPAY_PLAN_SELECT/PRO/BUSINESS/AGENCY (INR prices)
- ADMIN_PIN_HASH (demo PIN ADMIN123 is dead)
- ALERT_EMAIL_FROM, SCHEDULE_ALERT_WEBHOOK
- SCRAPE_PROVIDER_ORDER=direct,spider,jina
- VITE_AI_MODEL=claude-3-5-haiku-20241022
- VITE_ENABLE_EXTRACT=true
- VITE_LINK_ABOUT/BLOG/PRICING (datiq.app URLs)
- VITE_PAYMENT_PROVIDER=auto
- VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
- VITE_WEBHOOK_URL, SECRETS_SCAN_OMIT_PATHS

**Empty (intentional for v1.0):**
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, VITE_STRIPE_PUBLISHABLE_KEY
- VITE_STRIPE_PRICE_*
- JINA_API_KEY (falls back to free tier)
- VITE_LINK_CHANGELOG (footer link hidden)
- DATIQ_ENABLE_STRIPE (gates scripts/setup-providers.sh Stripe steps)

**Unset from initial state (security cleanup):**
- VITE_AI_API_KEY (moved to server AI_API_KEY; no longer leaks in JS bundle)
- VITE_FIRECRAWL_API_KEY (moved to server FIRECRAWL_API_KEY)

## Pending operator actions (for the user)

These are dashboard-side only — I can't do them from here:

1. **Run SQL migrations in Supabase** (production project
   `aubwooslkkrprdxuiyvj.supabase.co`):
   - `scripts/migrations.sql` — usage tracking, subscriptions, payment events,
     pricing_config, coupon_redemptions, redeem_coupon RPC
   - `scripts/ai-config.sql` — app_config (multi-provider AI chain)
   - `scripts/scheduler.sql` — scheduled_tasks (R19 hourly runner)
2. **Optional Razorpay live keys** (if user wants real revenue in v1.0):
   - Generate live keys in Razorpay Dashboard
   - Replace `VITE_RAZORPAY_KEY_ID` + `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`
     in Netlify env (currently test mode)
   - Register webhook → `https://datiq.app/.netlify/functions/payment-webhook?provider=razorpay`
   - Set `RAZORPAY_WEBHOOK_SECRET`
   - Trigger Netlify redeploy

## Test re-run commands (for the next session)

```bash
cd /Users/vikash/Extracta
git checkout main
git pull origin main

# Full test suite
npm run test:unit         # 308 tests, ~3s
npm run test:contract     # 255 tests, ~3s
npm run test:integration  # 119 tests, ~4s
npm run test:system       # 7 tests, ~1s
npm run build             # ~2s
npm run test:security     # stub (M0; full scan pending)
```

For e2e:
```bash
npm run test:e2e:smoke    # 23 Playwright specs (K-01..23)
npm run test:e2e:journeys # 5 journey specs (cross-browser)
npm run test:e2e:a11y     # 9 a11y specs
npm run test:e2e:visual   # 8 visual regression specs
```

Or all-in-one:
```bash
npm run test:all          # unit + contract + integration + system + build + smoke + security
```

## Branch state

`main` is the only fully-tested branch. There are stale feature branches in
`origin/` from earlier R-numbered releases that were all merged — the user
should delete them with `git push origin --delete <branch>` to keep the
remote clean. The user mentioned wanting a "fresh branch to start further
implementation" so the next session will likely:

1. `git checkout -b feat/v2.0-...`
2. Pick up the recurring-billing + Stripe work
3. Follow the re-enable runbooks in `docs/STRIPE-DEFERRAL.md` and
   `docs/RECURRING-BILLING-DEFERRAL.md`

## Memory / profile

User is **Vikash Karuna** (GitHub `vikashkaruna`), solo founder/maintainer
of DatIQ. Repo: `https://github.com/vikashkaruna/scrapelite`. Live:
`datiq.app` (Netlify project `datiqapp`).

## Key context files to read first in a new session

1. `/Users/vikash/Extracta/CLAUDE.md` — the live project memory (recent
   updated 2026-07-16)
2. `/Users/vikash/Extracta/docs/internal/DatIQ-Product-Documentation-Internal.md`
   — full product + architecture record
3. `/Users/vikash/Extracta/docs/STRIPE-DEFERRAL.md` — Stripe deferral
4. `/Users/vikash/Extracta/docs/RECURRING-BILLING-DEFERRAL.md` — recurring
   billing deferral
5. This file — session handoff snapshot
