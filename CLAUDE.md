# DatIQ — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-10 — R1 UI/UX polish complete: responsive nav, hamburger menu, geo-currency, persona chips, tooltips, favicon, simplified footer, AuthModal persona step**

---

## Quick orientation

| Property | Value |
|---|---|
| **Project** | DatIQ — zero-code web-extraction + enrichment platform |
| **Working dir** | `/home/user/scrapelite` (remote) or `/Users/vikash/Extracta` (local) |
| **Live site** | https://scrapelite.netlify.app |
| **GitHub** | https://github.com/vikashkaruna/scrapelite |
| **Netlify site ID** | `0ac65a7e-bd3f-4cde-a8d3-66c23899c473` |
| **Netlify** | https://app.netlify.com/projects/scrapelite |
| **Run locally** | `npm run dev` → http://localhost:5173 |
| **Current branch** | `main` — all work committed here |
| **Latest commit** | (see git log) — R1 UI polish: responsive nav+hamburger, geo-currency, persona chips, tooltips, favicon, footer slim, AuthModal persona step |

---

## Branch merge history (completed 2026-06-09)

All branches have been merged to main and pushed. Do NOT re-merge them.

| Branch | What it added | Merged |
|---|---|---|
| `Version-2.0-Docs` | Public help site at `/help/index.html` (16 pages) | ✅ |
| `v2-build-api-layer` | Netlify Functions API proxy (`/api/*`), `apiClient.js`, `authService.js` | ✅ |
| `v3-supabase-auth` | Supabase email+OAuth auth, `AuthProvider`, `AuthModal` | ✅ |
| `claude/v4-persona-onboard-lEZ1g` | 7-persona onboarding, `PersonaProvider`, `Footer`, Privacy/Terms pages | ✅ |
| `claude/v5-pricing-billing-7xoRQ` | Stripe/Razorpay/UPI payments, `BillingProvider`, admin console, usage metering | ✅ |
| `claude/v6-datiq-rebrand-82s24f` | DatIQ rebrand — localStorage keys → `datiq.*`, console logs → `[DatIQ]` | ✅ |
| `claude/r0-check-merged-fix-ui-4o44k2` | R0 UI polish + SEO/GEO + 7 new marketing pages + dropdown + email capture | ✅ merged to main |
| `claude/r0-polish-fix-ui-issues-mmrjql` | R1 UI polish: responsive nav, hamburger, geo-currency, persona chips, tooltips, favicon, footer slim | ✅ merged to main |

---

## Tech stack (locked — do NOT change these choices)

- **Vite 5 + React 18 + React Router 6** (v7 future flags set in `main.jsx`)
- **Tailwind CSS** for utilities only — design system tokens live in CSS custom properties
- **Design system** — `src/styles/design-system.css` + `src/styles/screens.css`. **NEVER convert to Tailwind classes.**
- **lucide-react** icons via `src/components/Icon.jsx`. Add new icons there only.
- **Supabase** (`@supabase/supabase-js`) — auth + DB. localStorage fallback when not configured.
- **jsPDF 4.2.1** — lazy-loaded only on PDF export click via `await import()`
- **stripe ^17.7.0** and **razorpay ^2.9.4** — in root `package.json` for Netlify Functions ONLY (never imported in Vite frontend)
- No test framework, no ESLint config (scripts: `dev`, `build`, `preview` only)

---

## Complete route map

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
| `/about` | About DatIQ — mission, values, how-it-works, personas | Public |
| `/blog` | Blog listing — featured + recent articles + email newsletter capture | Public |
| `/integrations` | Integration catalog — 4 live, 6 coming-soon, 1 agency, 1 roadmap | Public |
| `/use-cases/lead-generation` | Lead gen use-case landing page | Public |
| `/use-cases/competitor-research` | Competitor research landing page | Public |
| `/use-cases/seo-audit` | SEO audit use-case landing page | Public |
| `/use-cases/market-research` | Market research use-case landing page | Public |
| `/vs/browse-ai` | DatIQ vs Browse.ai comparison page | Public |
| `/vs/clay` | DatIQ vs Clay comparison page | Public |
| `/admin` | Admin shell (PIN gated, demo PIN: `ADMIN123`) | Standalone |
| `/admin/revenue` | Revenue dashboard | Admin |
| `/admin/pricing` | Configurable plan pricing & limits | Admin |
| `/admin/coupons` | Coupon CRUD | Admin |
| `/admin/users` | User management | Admin |
| `/help/index.html` | Static help site (16 pages, plain `<a>` — bypasses SPA router) | Public |

---

## Complete file map (current main state)

```
src/
├── App.jsx                           Provider tree + routes + Shell guard
├── main.jsx
├── index.css
├── styles/
│   ├── design-system.css             CSS tokens + @keyframes spin + .btn-full + brand tagline
│   └── screens.css                   All screen/component CSS (2200+ lines)
│                                     Includes: .uc-*, .vs-*, .int-*, .skip-link, .nav-dropdown*,
│                                     .home-social-proof, .blog-*, .about-*
├── data/
│   └── mockData.js
├── lib/
│   ├── config.js                     VITE_* env + runtime override; feature flags
│   ├── utils.js                      hostOf, pathOf, uid, flattenJson, extractionsToCsv, etc.
│   ├── supabaseClient.js             createClient when configured; null otherwise
│   ├── apiClient.js                  ★ V2: /api/* proxy — extract, ai, listExtractions, CRUD, setAuthToken
│   ├── authService.js                ★ V3: signUpWithEmail, signInWithEmail, signInWithOAuth, signOut
│   ├── firecrawlService.js           extractStructure, mapDomain — mock OR real via apiClient
│   ├── aiService.js                  summarize, categorizeLinks, generateContent, CONTENT_FORMATS
│   ├── linkCategorizer.js            categoryOf heuristic, CATEGORY_META, categoryCounts
│   ├── extractionPresets.js          CONTACTS_PROMPT, QUICK_ACTIONS (5), resolveCustomPrompt
│   ├── enrichmentStore.js            localStorage: readEnrichments, saveEnrichment, saveCurrent, readCurrent
│   ├── extractionsRepo.js            listExtractions, saveExtraction, updateEnrichments, deleteExtraction
│   │                                 Uses apiClient → localStorage fallback; LS_KEY = "datiq.saved"
│   ├── personaConfig.js              PERSONAS (7), PERSONA_BY_ID
│   ├── pricingConfig.js              ★ V5: 5 plan definitions + 3 top-up bundles + currency meta
│   ├── pricingOverrides.js           ★ V5: getEffectivePlans(), getEffectivePlanById(), getGlobalDiscount()
│   ├── currencyService.js            ★ V5: 6-currency rates (USD/INR/EUR/GBP/SGD/AED), daily BOD refresh
│   ├── migrationService.js           ★ R1: runMigrations() — copies scrapelite.* → datiq.* keys on first load
│   ├── usageService.js               ★ V5: canExtract/canEnrich/canExport — uses effective plan map
│   ├── usageRepo.js                  ★ V5: Supabase sync for usage_records + usage_alerts
│   ├── alertService.js               ★ V5: getAlertConfig, saveAlertConfig, checkAndFireAlerts
│   ├── adminService.js               ★ V5: coupon CRUD, user management, revenue metrics
│   ├── paymentConfig.js              ★ V5c: getPaymentProvider(currency), hasPayment, PROVIDER_META
│   ├── paymentService.js             ★ V5c: initiateCheckout (Stripe/Razorpay/demo), pending payment
│   ├── paymentRepo.js                ★ V5c: Supabase subscriptions + payment_events sync
│   ├── pdfExport.js                  Lazy-loaded jsPDF report (never static-imported)
│   ├── webhook.js                    notifyWebhook (fire-and-forget)
│   ├── emailService.js               sendExtractionsEmail; webhook → email API → mailto fallback
│   ├── errorMessages.js              classifyError; 10 categories
│   ├── statsService.js               ★ R0: getStats() → /api/stats (Supabase aggregate), fmtStat()
│   │                                 Caches in datiq.stats localStorage (5-min TTL)
│   └── emailCaptureService.js        ★ R0: captureEmail(email, source) → datiq.subscribers LS + n8n webhook
├── components/
│   ├── ThemeProvider.jsx             light/dark; persists to datiq.theme
│   ├── Toast.jsx                     ToastProvider + useToast(); 2.6s auto-dismiss
│   ├── ErrorModal.jsx                ErrorModalProvider + useErrorModal()
│   ├── AuthProvider.jsx              ★ V3: Supabase auth state, openAuth/closeAuth, authError
│   ├── AuthModal.jsx                 ★ V3: sign-up/sign-in modal with authError display
│   ├── PersonaProvider.jsx           ★ V4: personaId, userName, onboarded, resetOnboarding
│   ├── BillingProvider.jsx           ★ V5c: planId, usage, initiatePayment, confirmPayment, applyCoupon
│   ├── ExtractionProvider.jsx        current, loading, extract, enrich, save — checks billing limits
│   ├── TopBar.jsx                    Brand (DatIQ layers icon + tagline), main nav (Extract/Dashboard/Pricing),
│   │                                 ExploreDropdown (Use Cases/Compare/Resources sections with icons),
│   │                                 UserDropdown (persona dot+name, account/billing/role/sign-out),
│   │                                 MobileNav (hamburger panel <600px, Explore accordion, user actions)
│   ├── Footer.jsx                    Slim single-row: socials (LinkedIn/Twitter) | copyright | legal links
│   ├── Button.jsx                    variant: primary/secondary/ghost/danger; size sm; fullWidth
│   ├── Toggle.jsx                    Reusable toggle switch; accepts `tooltip` prop → hover popover
│   ├── Icon.jsx                      lucide-react name-map (76 icons registered)
│   ├── StructuredData.jsx            Renders arbitrary JSON (enrichment data)
│   ├── ContentModal.jsx              Generate content modal; 3 formats; copy button
│   ├── EmailModal.jsx                Send email modal; multi-recipient
│   ├── BrandLoader.jsx               Animated loader
│   ├── FaviconDot.jsx                Deterministic hue monogram per domain
│   ├── LoadingScreen.jsx             Full-screen 4-step animated progress
│   └── StructuredData.jsx            Renders arbitrary JSON (enrichment data)
└── pages/
    ├── Home.jsx                      URL input, 4 toggles, custom extraction, 8 capability cards,
    │                                 social proof (live stats from statsService + testimonials)
    ├── Preview.jsx                   Quick enrichment, enrichment tabs, save/discard
    ├── Dashboard.jsx                 Table/cards, search, pagination, CSV/PDF/Generate/Email
    ├── Onboarding.jsx                2-step persona selection (standalone, no chrome)
    ├── Pricing.jsx                   ★ V5c: plan cards, payment-backed select, provider badge, demo notice
    ├── Account.jsx                   ★ V5c: billing, usage, alerts, coupon, payment history
    ├── PaymentSuccess.jsx            ★ V5c: Stripe verify + Razorpay activate; 3 states
    ├── PaymentCancel.jsx             ★ V5c: clears pending payment, "No charge made"
    ├── Privacy.jsx                   Privacy Policy (contact: privacy@datiq.app)
    ├── Terms.jsx                     Terms of Service (contact: legal@datiq.app)
    ├── About.jsx                     ★ R0: mission, values, how-it-works, personas, CTA
    ├── Blog.jsx                      ★ R0: featured + grid articles + real email newsletter form
    ├── Integrations.jsx              ★ R0: 12-card catalog; "Notify me" shows toast
    ├── UseCaseLead.jsx               ★ R0: /use-cases/lead-generation
    ├── UseCaseCompetitor.jsx         ★ R0: /use-cases/competitor-research
    ├── UseCaseSEO.jsx                ★ R0: /use-cases/seo-audit
    ├── UseCaseResearch.jsx           ★ R0: /use-cases/market-research
    ├── VsBrowseAI.jsx                ★ R0: /vs/browse-ai comparison
    ├── VsClay.jsx                    ★ R0: /vs/clay comparison
    └── admin/
        ├── AdminLayout.jsx           PIN gate (ADMIN123), sidebar nav
        ├── AdminRevenue.jsx          KPI cards, MRR trend chart, plan distribution
        ├── AdminPricing.jsx          Editable plan prices + limits + global discount + bundles
        ├── AdminCoupons.jsx          Coupon CRUD (% or bonus extractions)
        └── AdminUsers.jsx            User table: search, filter, extend usage, invite

netlify/
└── functions/
    ├── ai.js                         POST /api/ai — Anthropic proxy (server-side AI_API_KEY)
    ├── extract.js                    POST /api/extract — Firecrawl proxy
    ├── extractions.js                GET/POST/PATCH/DELETE /api/extractions — Supabase proxy
    ├── create-checkout.js            ★ V5c: POST — Stripe Checkout session or Razorpay order
    ├── verify-payment.js             ★ V5c: GET=Stripe verify, POST=Razorpay HMAC verify
    ├── payment-webhook.js            ★ V5c: Stripe + Razorpay webhook handler
    └── stats.js                      ★ R0: GET /api/stats — aggregate teams/extractions from Supabase
                                      Direct REST (no SDK); 5-min CDN cache header

public/
├── favicon.svg
├── runtime-config.js                 window.__DATIQ_RUNTIME__ override (no rebuild needed)
├── llms.txt                          ★ R0: Agentic SEO — DatIQ capabilities for AI agent discovery
├── robots.txt                        ★ R0: allows GPTBot/ClaudeBot/PerplexityBot, blocks /api/ /admin
├── sitemap.xml                       ★ R0: all 20 public routes with priority + changefreq
└── help/
    ├── index.html                    Help home (links to 15 section pages)
    ├── help.css
    └── [15 section HTML pages + 6 screenshot assets]
```

---

## Provider tree (App.jsx)

```
ThemeProvider
  ToastProvider
    ErrorModalProvider
      AuthProvider
        PersonaProvider
          BillingProvider
            ExtractionProvider
              <Shell />   ← skip-link + TopBar + <main id="main-content"> + routes + Footer + AuthModal
```

---

## Architecture rules (LOCKED)

| Rule | Detail |
|---|---|
| CSS | Keep `design-system.css` + `screens.css` tokens. Never convert to Tailwind. |
| Pricing | Always use `getEffectivePlans()` / `getEffectivePlanById()` — never import `PLAN_BY_ID` from `pricingConfig` directly in UI code |
| API calls | All Supabase/Firecrawl/AI calls go through `apiClient.js` → Netlify Functions, not direct from browser |
| Supabase fallback | localStorage fallback on 401/403/404/503 or no `err.status`. Never hard-fail a save. |
| Dashboard seed | NONE — starts empty. Do not re-add mock data. |
| Table layout | `table-layout:fixed`, fixed px widths on narrow cols |
| TopBar "+ New" | Only shown on `/preview` |
| TopBar brand icon | Uses `layers` icon — do NOT change |
| TopBar tagline | `.brand-tagline` "Intelligence from every URL" — hidden on mobile (≤640px) |
| TopBar nav | Main links: Extract / Dashboard / Pricing + ExploreDropdown (3 sections) + UserDropdown |
| TopBar responsive | Desktop >820px: full text+icons; Tablet 600–820px: compressed; Mobile <600px: hamburger |
| TopBar MobileNav | Slide-down panel (position:fixed top:68px), Explore accordion, user persona + actions |
| Footer | Slim single-row: `.site-footer-slim` — socials left, copyright center, legal right |
| Page structure | All route pages return a plain `<div className="page">` — Shell provides `<main id="main-content">` |
| PDF | Lazy-loaded via `await import()`. Never static-import jsPDF. |
| Background enrichment | `enrich()` must never show the full-screen loader. |
| Admin | `/admin` is standalone (no TopBar/Footer). PIN: `ADMIN123`. |
| Payment secrets | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env ONLY. Never VITE_ prefix. |
| Netlify Functions | ESM (`export const handler`), in `netlify/functions/`. `stripe`/`razorpay` dynamic-imported only. |
| localStorage keys | All use `datiq.*` prefix (except `scrapelite.*` internal keys — NOT rebranded to avoid breaking sessions) |
| Help site | `/help/index.html` linked from TopBar as plain `<a>` (not React Router) — bypasses SPA router |
| Contact emails | `support@datiq.app` (payment), `legal@datiq.app` (terms), `privacy@datiq.app` (privacy) |
| Naming | App brand is "DatIQ" everywhere in UI. Netlify URL stays `scrapelite.netlify.app` for now. |

---

## Key localStorage keys

| Key | Used by |
|---|---|
| `datiq.saved` | extractionsRepo.js — saved extractions cache |
| `datiq.current` | enrichmentStore.js — current extraction |
| `datiq.enrichments` | enrichmentStore.js — enrichment data per URL |
| `datiq.theme` | ThemeProvider — light/dark preference |
| `datiq.dashLayout` | Dashboard.jsx — table/cards toggle |
| `datiq.tip.*` | Home.jsx — per-persona guide tip (shown once) |
| `datiq.stats` | statsService.js — cached aggregate stats (5-min TTL) |
| `datiq.subscribers` | emailCaptureService.js — newsletter email list |
| `scrapelite.adminAuth` | AdminLayout.jsx — admin PIN gate (intentionally NOT rebranded) |
| `scrapelite.*` | Internal keys (persona, usage, currency, pricing overrides etc.) — NOT rebranded |
| `datiq.plan` | BillingProvider — active plan ID |
| `datiq.pendingPayment` | paymentService.js — pending Stripe redirect state |
| `datiq.migrated` | migrationService.js — flag: scrapelite.* → datiq.* migration done |

---

## V5 — Pricing & Billing

### Plans: Free / Select / Pro / Business / Agency
- Defaults in `src/lib/pricingConfig.js`
- Admin overrides via `src/lib/pricingOverrides.js` (localStorage-backed, no rebuild)
- **Always** call `getEffectivePlanById(id)` — never use raw `PLAN_BY_ID`

### Payment provider routing
| Currency | Provider |
|---|---|
| INR, AED | Razorpay |
| USD, EUR, GBP, SGD | Stripe |
| Override | `VITE_PAYMENT_PROVIDER=stripe\|razorpay\|auto` |

**Demo mode** (no keys): `initiateCheckout` → `{status:"demo_mode"}` → upgrades plan locally, no real charge.

**Stripe flow**: `create-checkout` → Stripe hosted URL → `/payment/success?session_id=&plan=&provider=stripe` → `verify-payment` GET

**Razorpay flow**: `create-checkout` → `{orderId,amount,currency}` → paymentService lazy-loads CDN SDK → modal → `verify-payment` POST HMAC

---

## R0 — SEO/GEO & Marketing (2026-06-09)

### GEO & Agentic SEO
- `index.html` — 3 JSON-LD schemas: Organization (sameAs LinkedIn/Twitter/GitHub), WebSite+SearchAction, SoftwareApplication
- `public/llms.txt` — AI agent discovery (like robots.txt for LLMs)
- `public/robots.txt` — allows GPTBot/ClaudeBot/PerplexityBot, blocks /api/ /admin
- `public/sitemap.xml` — all 20 public routes

### Live stats pipeline
- `netlify/functions/stats.js` → `/api/stats` queries Supabase `usage_records` (teams = distinct session_ids, extractions = SUM)
- `src/lib/statsService.js` → fetches + caches in `datiq.stats` (5-min TTL)
- Home.jsx social proof shows real numbers when Supabase is configured; falls back to placeholders silently

### Email capture
- `src/lib/emailCaptureService.js` → `captureEmail(email, source)`:
  - Saves to `datiq.subscribers` in localStorage (deduped)
  - POSTs to `VITE_WEBHOOK_URL` (n8n) as fire-and-forget
- Blog.jsx newsletter has real form with idle/loading/success/already/error states
- Integrations.jsx "Notify me" buttons show a toast with Blog redirect suggestion

---

## Auth (Supabase + AuthProvider)

- `AuthProvider` manages Supabase session, exposes: `user`, `openAuth`, `closeAuth`, `showAuthModal`, `authError`
- On mount: detects `window.location.hash` with `error=` → sets `authError`, opens modal, cleans URL
- `signUpWithEmail` passes `emailRedirectTo: window.location.origin` (prevents localhost:3000 redirect)
- `apiClient.setAuthToken(token)` called on sign-in to include `Authorization` header on API requests

### OAuth — requires Supabase dashboard setup
1. Authentication → URL Configuration → Site URL + redirect URLs
2. Providers → Enable Google / Microsoft (Azure) / GitHub
3. Callback URL: `https://[project].supabase.co/auth/v1/callback`

---

## Supabase schema — run if not yet applied

```sql
-- V2 columns
ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS custom_extraction jsonb,
  ADD COLUMN IF NOT EXISTS domain_map        jsonb,
  ADD COLUMN IF NOT EXISTS enrichments       jsonb;

-- V5: Usage tracking
CREATE TABLE IF NOT EXISTS public.usage_records (
  id uuid primary key default gen_random_uuid(),
  session_id text not null, month text not null,
  extractions integer not null default 0, enrichments integer not null default 0,
  plan_id text not null default 'free', updated_at timestamptz not null default now(),
  unique(session_id, month)
);
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.usage_records;
CREATE POLICY "anon full access" ON public.usage_records FOR ALL USING (true) WITH CHECK (true);

-- V5: Alert preferences
CREATE TABLE IF NOT EXISTS public.usage_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique, email text not null,
  thresholds integer[] not null default '{80,95}', enabled boolean not null default true,
  last_notified_at timestamptz
);
ALTER TABLE public.usage_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.usage_alerts;
CREATE POLICY "anon full access" ON public.usage_alerts FOR ALL USING (true) WITH CHECK (true);

-- V5c: Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique, plan_id text, status text, provider text,
  provider_subscription_id text, provider_customer_id text,
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.subscriptions;
CREATE POLICY "anon full access" ON public.subscriptions FOR ALL USING (true) WITH CHECK (true);

-- V5c: Payment events
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid primary key default gen_random_uuid(),
  session_id text, event_type text, provider text, provider_event_id text,
  plan_id text, amount_cents integer, currency text, status text,
  created_at timestamptz default now()
);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon full access" ON public.payment_events;
CREATE POLICY "anon full access" ON public.payment_events FOR ALL USING (true) WITH CHECK (true);
```

---

## Environment variables

File: `.env` — **has real values (do NOT overwrite)**

```
# Browser-safe (VITE_ prefix)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_FIRECRAWL_API_KEY=        # fc-...
VITE_AI_API_KEY=               # sk-ant-... (browser-side demo only)
VITE_AI_MODEL=claude-haiku-4-5-20251001
VITE_WEBHOOK_URL=              # n8n webhook (also used for email capture)
VITE_PAYMENT_PROVIDER=auto     # auto | stripe | razorpay
VITE_STRIPE_PUBLISHABLE_KEY=   # pk_live_...
VITE_RAZORPAY_KEY_ID=          # rzp_live_...
VITE_STRIPE_PRICE_SELECT=      # recurring Stripe price IDs
VITE_STRIPE_PRICE_PRO=
VITE_STRIPE_PRICE_BUSINESS=
VITE_STRIPE_PRICE_AGENCY=
VITE_RAZORPAY_PLAN_SELECT=     # Razorpay subscription plan IDs
VITE_RAZORPAY_PLAN_PRO=
VITE_RAZORPAY_PLAN_BUSINESS=
VITE_RAZORPAY_PLAN_AGENCY=
VITE_LINK_CHANGELOG=           # optional footer links
VITE_LINK_ABOUT=
VITE_LINK_BLOG=

# Server-only — Netlify env ONLY, never VITE_ prefix
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
SUPABASE_URL=                  # used by stats.js Netlify function (no VITE_ prefix)
SUPABASE_SERVICE_KEY=          # preferred for stats.js (service key for aggregate queries)
```

---

## Netlify deploy

- **Site ID**: `0ac65a7e-bd3f-4cde-a8d3-66c23899c473`
- **Build**: `npm run build` → publishes `dist/`
- **Functions**: `netlify/functions/` (esbuild bundler)
- **API redirect**: `/api/*` → `/.netlify/functions/:splat`
- **SPA fallback**: `/*` → `/index.html`
- Auto-deploys from `main` on push

To trigger manually: Netlify dashboard → Deploys → Trigger deploy

---

## Critical bugs fixed (do NOT regress)

1. **Coupon use count** — `incrementCouponUses()` in `applyCoupon()`
2. **Admin auth boolean** — `ls(ADMIN_AUTH_KEY) === true || v === "true"`
3. **Currency dropdown click-outside** — `useEffect` + `mousedown` on `document`
4. **AbortSignal.timeout** — replaced with `AbortController + setTimeout`
5. **Effective plan map** — `usageService.js` + `BillingProvider` use `getEffectivePlanMap()`
6. **Email confirmation redirect** — `signUpWithEmail` passes `emailRedirectTo: window.location.origin`
7. **Hash error on auth redirect** — `AuthProvider` detects `#error=`, sets `authError`, opens modal, cleans URL
8. **netlify.toml duplicate [functions]** — removed; was causing Netlify CLI parse error + broken Functions deploy
9. **V5c: `initiatePayment` returns result** — `return result` in try, `throw e` in catch
10. **V5c: loading spinner** — `loading={loadingPlan}` is plan ID string, not boolean
11. **V5c: Account paymentError banner** — close button calls `setPaymentError("")`
12. **V5c: Account `handleUpgrade` nav** — demo_mode/success → `/account` (not `/pricing`)
13. **R0: nested `<main>` in agent pages** — UseCaseLead/Competitor/SEO/Research, VsBrowseAI/Clay, Integrations all returned `<main id="main-content">` inside Shell's existing `<main>`. Fixed to return `<div className="page">` directly.
14. **R0: scrapelite.tip.* localStorage key** — Home.jsx guide tip key updated to `datiq.tip.*`
15. **R0: contact emails** — `hello@scrapelite.io` → `support@datiq.app`, `legal@scrapelite.io` → `legal@datiq.app`, `privacy@scrapelite.io` → `privacy@datiq.app`
16. **R0: TopBar unused `plan` var** — removed from `useBilling()` destructuring
17. **R1: paymentService Razorpay `name`** — `"ScrapeLite"` → `"DatIQ"` in Razorpay modal options
18. **R1: alertService email subject** — `"ScrapeLite — Usage Alert"` → `"DatIQ — Usage Alert"`
19. **R1: localStorage migration** — `migrationService.js` + `runMigrations()` in `main.jsx` copies all `scrapelite.*` keys → `datiq.*` on first load (preserves existing user sessions)
20. **R1: TopBar restructure** — merged Blog/Help/About/Use Cases into single ExploreDropdown (3 sections: Use Cases, Compare, Resources); UserDropdown replaces separate PersonaBadge + UserChip
21. **R1: Footer simplified** — replaced 4-col layout with slim single-row `.site-footer-slim` (socials + copyright + legal only)
22. **R1: Responsive nav text** — nav labels visible at all breakpoints down to 600px; below 600px hamburger `MobileNav` panel shown
23. **R1: Geo-currency detection** — `detectCurrency()` in `currencyService.js`; `BillingProvider` auto-applies on first visit (timezone-first, language fallback)
24. **R1: Toggle tooltip prop** — `tooltip` prop on Toggle renders `.opt-tooltip` hover popover; all Home.jsx toggles updated
25. **R1: Persona quick-chips** — `.persona-contexts` above URL input on Home; persona-specific context chips populate search box
26. **R1: Scrape opts 2-col** — `.scrape-opts-grid` (2-column) replaces single-column layout; collapses to 1 col on mobile
27. **R1: AuthModal persona step** — post-signup persona selection step with skip; `usePersona.completeOnboarding()` called before closing
28. **R1: favicon layered-diamond** — SVG updated to 3-layer diamond matching in-app brand mark (indigo #4f46e5 bg)

---

## Outstanding tasks

### Supabase (manual — Supabase dashboard)
- [ ] Run SQL migration above in SQL Editor
- [ ] Enable Google / Microsoft (Azure) / GitHub OAuth providers
- [ ] Set Site URL → `https://datiq.app`; add redirect URLs including `https://datiq.app/**`
- [ ] Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` to Netlify env for stats.js

### Netlify (manual — Netlify dashboard)
- [ ] Add all env vars (see env section above)
- [ ] Register Stripe webhook → `https://datiq.app/.netlify/functions/payment-webhook` → copy secret → `STRIPE_WEBHOOK_SECRET`
- [ ] Register Razorpay webhook → same URL → `RAZORPAY_WEBHOOK_SECRET`
- [ ] Trigger redeploy after env vars are set

### Payment provider (before going live)
- [ ] Stripe: create Products + Prices for Select/Pro/Business/Agency → set `VITE_STRIPE_PRICE_*`
- [ ] Razorpay: create Subscription Plans → set `VITE_RAZORPAY_PLAN_*`

### Future development
- [x] ~~Full DatIQ rename: migrate `scrapelite.*` localStorage keys to `datiq.*`~~ — DONE via migrationService.js
- [x] ~~Full DatIQ rename: update Terms/Privacy legal text~~ — DONE (all ScrapeLite refs removed)
- [ ] Add `NETLIFY_AUTH_TOKEN` to session env for programmatic deploys from Claude
- [ ] Move `VITE_AI_API_KEY` to server-only via Netlify Function (security)
- [ ] Supabase real auth → replace localStorage persona/session for cross-device sync
- [ ] Switch webhook to production n8n URL
- [ ] Add "Use cases" links also to Footer Explore column (currently points only to /use-cases/lead-generation)

---

## How to continue developing

```bash
cd /home/user/scrapelite
git pull origin main
npm run dev   # http://localhost:5173
```

**Quick smoke tests:**
- `/onboarding` → pick a persona → lands on `/`
- `/pricing` → select paid plan → spinner → demo_mode → `/account` shows upgraded plan
- `/payment/success?plan=pro&provider=razorpay` → success state
- `/payment/cancel?plan=pro` → "No charge was made"
- `/admin` → PIN `ADMIN123` → Revenue / Pricing / Coupons / Users
- `/account` → enter coupon `LAUNCH20` → Apply; then × to remove
- TopBar → Sign in → create account → persona step appears → select persona → lands on `/`
- TopBar brand → shows `layers` icon + "DatIQ" + "Intelligence from every URL" tagline
- TopBar nav (desktop >820px) → Extract, Dashboard, Pricing all show text+icon; Explore dropdown shows
- TopBar Explore dropdown → 3 sections: Use Cases (4), Compare (2), Resources (About/Blog/Help)
- TopBar UserDropdown → persona colour dot + name; hover shows profile card + Account/Switch Role/Sign out
- TopBar (mobile <600px) → hamburger button visible; tap to open slide-down nav panel
- Mobile nav → Extract/Dashboard/Pricing links; Explore accordion expands; persona info shown
- `/about` → accessible without onboarding, shows hero + values + how-it-works + personas
- `/blog` → accessible without onboarding, featured post + article grid + email capture form
- `/blog` newsletter → enter email → "You're subscribed!" (localStorage + n8n webhook)
- `/integrations` → 12 cards; "Notify me" on coming-soon shows toast
- `/use-cases/lead-generation` → renders correctly inside Shell (no nested main)
- `/vs/clay` → comparison table with DatIQ wins highlighted
- Home social proof → stats load from /api/stats if Supabase configured, else show "500+" / "10K+"
- Footer → slim single row: LinkedIn + Twitter socials | copyright | Privacy · Terms links
- Home → persona chips above URL input (click to populate search box)
- Home → scrape toggles in 2-column grid; each toggle has hover tooltip
- Pricing → currency auto-detected from timezone (INR for India, EUR for Europe, GBP for UK, USD default)
- Pricing → currency picker still available; choice persists across sessions
- favicon → layered-diamond indigo SVG visible in browser tab

---

## Git log (recent)

```
(latest)  feat(R1): UI/UX polish — responsive nav, hamburger menu, favicon, tooltips, geo-currency [merge]
0bba84f  feat(r1): responsive nav — text+icons at all breakpoints, hamburger menu for mobile
da5e49e  feat(r1): comprehensive UI/UX polish — nav, footer, home, tooltips, currency
4bbcbbf  chore: update CLAUDE.md — full DatIQ rebrand complete (2026-06-10)
6e1529f  feat: complete DatIQ rebrand — remove all ScrapeLite references
8a3e14d  fix: E2E audit — nested main, contact emails, localStorage keys, unused vars
6d04fed  feat: Use Cases dropdown, email capture, live stats, and DatIQ branding
```
