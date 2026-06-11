# DatIQ — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-11 — R5: Batch mode, CSV-import enrichment, Markdown/JSON exports, plan limit updates**

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
| **Latest commit** | (see git log) — R5: batch mode (/batch), CSV-import enrichment, Markdown+JSON export, plan limits, Batch Pack top-up bundle |

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
| `claude/r0-polish-ui-issues-fqbogg` | R2+R3: onboarding in Shell, nav routing, topbar alignment, auth-gated menus, padding override, collapsible admin sidebar | ✅ merged to main |
| `claude/r0-polish-ui-fixes-11ikut` | R4: pricing overhaul (USD+INR, annual, new tiers), /contact, /use-cases, founder block, DPDP, Indian arbitration, usage banner, blog modal, branding fixes | ✅ merged to main |
| `claude/batch-mode-export-formats-fkjkxx` | R5: /batch page (multi-URL mode, CSV import), Markdown+JSON export, plan batch limits, Batch Pack top-up bundle, updated metering | ✅ merged to main |

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
| `/` | Home / Extract | Public (no forced onboarding) |
| `/preview` | Review & Save extraction | Public |
| `/dashboard` | Saved extractions | Public |
| `/batch` | Batch multi-URL extraction (10–500 URLs); CSV-import; progress; combined export | Public (plan-gated) |
| `/pricing` | Pricing plans, annual/monthly toggle, USD+INR, top-up bundles | Public |
| `/account` | Billing & usage, metering alerts, coupon input, payment history | Public |
| `/payment/success` | Post-payment confirmation (Stripe redirect / Razorpay success) | Public |
| `/payment/cancel` | Checkout cancelled screen | Public |
| `/onboarding` | 2-step persona selection | Public (in Shell with TopBar+Footer; opt-in) |
| `/contact` | Support contact form (5 enquiry types + sidebar info) | Public |
| `/privacy` | Privacy Policy (includes DPDP Act 2023 section) | Public |
| `/terms` | Terms of Service (Indian arbitration governing law) | Public |
| `/about` | About DatIQ — mission, values, how-it-works, founder block, personas | Public |
| `/blog` | Blog listing — featured + grid + email capture; click card → in-page modal | Public |
| `/integrations` | Integration catalog — 4 live, 6 coming-soon, 1 agency, 1 roadmap | Public |
| `/use-cases` | Use-cases hub — 4 cards linking to detail pages | Public |
| `/use-cases/lead-generation` | Lead gen use-case landing page | Public |
| `/use-cases/competitor-research` | Competitor research landing page | Public |
| `/use-cases/seo-audit` | SEO audit use-case landing page | Public |
| `/use-cases/market-research` | Market research use-case landing page | Public |
| `/vs/browse-ai` | DatIQ vs Browse.ai comparison page | Public |
| `/vs/clay` | DatIQ vs Clay comparison page | Public |
| `/docs` | Redirect → `/help/index.html` (window.location.href, not SPA nav) | Public |
| `/compare` | Redirect → `/vs/browse-ai` (React Router Navigate) | Public |
| `/compare/*` | Redirect → `/vs/browse-ai` | Public |
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
│                                     ★ R4: added /contact, /use-cases, /docs redirect, /compare redirect
│                                     UsageUpsellBanner placed between TopBar and <main>
├── main.jsx
├── index.css
├── styles/
│   ├── design-system.css             CSS tokens + @keyframes spin + .btn-full + brand tagline
│   └── screens.css                   All screen/component CSS (~2500 lines)
│                                     Includes: .uc-*, .vs-*, .int-*, .skip-link, .nav-dropdown*,
│                                     .home-social-proof, .blog-*, .about-*, .contact-*, .billing-toggle-*,
│                                     .enterprise-card, .plan-coming-soon, .referral-teaser, .usage-upsell-banner
├── data/
│   └── mockData.js
├── lib/
│   ├── batchService.js               ★ R5: runBatch() — parallel multi-URL extraction (CONCURRENCY=3); parseUrlsFromCsv()
│   ├── config.js                     VITE_* env + runtime override; feature flags
│   │                                 ★ R4: removed AI_API_KEY export; hasAI = true (key server-side only)
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
│   ├── pricingConfig.js              ★ R4: 7 plan tiers + ENTERPRISE_PLAN export + TOPUP_BUNDLES
│   │                                 Plans: Free/Select/Pro/Business/Agency/Developer(comingSoon)/Enterprise
│   │                                 Fields: price_usd, price_usd_annual, price_inr_annual, trialCredit
│   │                                 CURRENCIES = ["USD", "INR"] (EUR/GBP/SGD/AED removed)
│   ├── pricingOverrides.js           ★ V5: getEffectivePlans(), getEffectivePlanById(), getGlobalDiscount()
│   ├── currencyService.js            ★ R4: USD+INR only; DEFAULT_RATES = { USD:1, INR:83.5 }
│   │                                 detectCurrency() returns "USD" or "INR" only
│   ├── migrationService.js           ★ R1: runMigrations() — copies scrapelite.* → datiq.* keys on first load
│   ├── usageService.js               ★ V5: canExtract/canEnrich/canExport — uses effective plan map
│   ├── usageRepo.js                  ★ V5: Supabase sync for usage_records + usage_alerts
│   ├── alertService.js               ★ V5: getAlertConfig, saveAlertConfig, checkAndFireAlerts
│   ├── adminService.js               ★ V5: coupon CRUD, user management, revenue metrics
│   ├── paymentConfig.js              ★ V5c: getPaymentProvider(currency), hasPayment, PROVIDER_META
│   │                                 INR → Razorpay; USD → Stripe
│   ├── paymentService.js             ★ V5c: initiateCheckout (Stripe/Razorpay/demo), pending payment
│   ├── paymentRepo.js                ★ V5c: Supabase subscriptions + payment_events sync
│   ├── pdfExport.js                  Lazy-loaded jsPDF report (never static-imported)
│   │                                 ★ R5: utils.js also exports extractionsToMarkdown/markdownDownload/extractionsToJson/jsonDownload
│   ├── webhook.js                    notifyWebhook (fire-and-forget)
│   ├── emailService.js               sendExtractionsEmail; webhook → email API → mailto fallback
│   ├── errorMessages.js              classifyError; 10 categories
│   ├── statsService.js               ★ R0: getStats() → /api/stats (Supabase aggregate), fmtStat()
│   │                                 Caches in datiq.stats localStorage (5-min TTL)
│   └── emailCaptureService.js        ★ R0: captureEmail(email, source) → datiq.subscribers LS + n8n webhook
├── components/
│   ├── ThemeProvider.jsx             light/dark; persists to datiq.theme
│   ├── Toast.jsx                     ToastProvider + useToast(); 2.6s auto-dismiss
│   │                                 IMPORTANT: useToast() returns the fn directly, not {showToast}
│   ├── ErrorModal.jsx                ErrorModalProvider + useErrorModal()
│   ├── AuthProvider.jsx              ★ V3: Supabase auth state, openAuth/closeAuth, authError
│   ├── AuthModal.jsx                 ★ V3: sign-up/sign-in modal with authError display
│   ├── PersonaProvider.jsx           ★ V4: personaId, userName, onboarded, resetOnboarding
│   ├── BillingProvider.jsx           ★ V5c: planId, usage, initiatePayment, confirmPayment, applyCoupon
│   ├── ExtractionProvider.jsx        current, loading, extract, enrich, save — checks billing limits
│   ├── UsageUpsellBanner.jsx         ★ R4: shows at ≥80% extraction usage; dismiss stores month in LS
│   │                                 Key: datiq.upsellDismissedMonth; re-shows next month
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
│   └── LoadingScreen.jsx             Full-screen 4-step animated progress
└── pages/
    ├── Home.jsx                      URL input, 4 toggles, custom extraction, 8 capability cards,
    │                                 social proof (real stats; hidden until teams≥10 OR extractions≥100)
    │                                 ★ R4: testimonials permanently hidden until real backend data
    ├── Preview.jsx                   Quick enrichment, enrichment tabs, save/discard
    ├── Dashboard.jsx                 Table/cards, search, pagination, CSV/PDF/Generate/Email
    ├── Onboarding.jsx                2-step persona selection (in Shell with TopBar+Footer; opt-in)
    ├── Pricing.jsx                   ★ R4: annual/monthly toggle (default: annual), USD+INR only,
    │                                 BillingToggle component, EnterpriseCard, Developer comingSoon card
    │                                 resolvePrice() uses plan.price_inr_annual / price_usd_annual
    ├── Account.jsx                   ★ V5c: billing, usage, alerts, coupon, payment history
    ├── PaymentSuccess.jsx            ★ V5c: Stripe verify + Razorpay activate; 3 states
    ├── PaymentCancel.jsx             ★ V5c: clears pending payment, "No charge made"
    ├── Contact.jsx                   ★ R4: /contact — support form (5 types) + sidebar info cards
    ├── Privacy.jsx                   ★ R4: full DPDP Act 2023 section added; URL → datiq.app
    ├── Terms.jsx                     ★ R4: governing law → Indian arbitration (A&C Act 1996, Bengaluru)
    ├── About.jsx                     ★ R4: founder block (Vikash Karuna, LinkedIn); fixed copy bug
    ├── Blog.jsx                      ★ R4: all 7 posts have fullContent; PostModal overlay on card click
    ├── Integrations.jsx              ★ R0: 12-card catalog; "Notify me" shows toast
    ├── UseCases.jsx                  ★ R4: /use-cases hub — 4 cards linking to detail pages
    ├── UseCaseLead.jsx               ★ R0: /use-cases/lead-generation
    ├── UseCaseCompetitor.jsx         ★ R0: /use-cases/competitor-research
    ├── UseCaseSEO.jsx                ★ R0: /use-cases/seo-audit
    ├── UseCaseResearch.jsx           ★ R0: /use-cases/market-research
    ├── VsBrowseAI.jsx                ★ R4: pricing updated to $0–$299/mo; API access → Business plan
    ├── VsClay.jsx                    ★ R4: pricing updated; CTA → "from $19/month"
    ├── Batch.jsx                     ★ R5: /batch — paste URLs / import CSV → progress → results → export
    └── admin/
        ├── AdminLayout.jsx           PIN gate (ADMIN123), collapsible sidebar (chevron + pin)
        ├── AdminRevenue.jsx          KPI cards, MRR trend chart, plan distribution
        ├── AdminPricing.jsx          Editable plan prices + limits + global discount + bundles
        ├── AdminCoupons.jsx          Coupon CRUD (% or bonus extractions)
        └── AdminUsers.jsx            User table: search, filter, extend usage, invite

netlify/
└── functions/
    ├── ai.js                         POST /api/ai — Anthropic proxy (server-side AI_API_KEY, no VITE_ prefix)
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
├── llms.txt                          ★ R4: updated all URLs → datiq.app; new pricing tiers; /contact added
├── robots.txt                        ★ R4: Sitemap URL → https://datiq.app/sitemap.xml
├── sitemap.xml                       ★ R4: all URLs → datiq.app; added /contact, /use-cases
└── help/
    ├── index.html                    ★ R4: metadata table → datiq.app; title fixed
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
| TopBar nav | Main links: Extract / Dashboard + ExploreDropdown + UserDropdown (logged in) OR Sign in + Sign up (logged out) |
| TopBar alignment | `.topbar-inner` (max-width: 1080px, auto margins) wraps all content — aligns with `.container` |
| TopBar responsive | Desktop >820px: full text+icons; Tablet 600–820px: compressed; Mobile <600px: hamburger |
| TopBar MobileNav | Slide-down panel (position:fixed top:68px), Explore accordion, user persona + actions |
| Footer | Slim single-row: `.site-footer-slim` — socials left, copyright center, legal right |
| Page structure | All route pages return a plain `<div className="page">` — Shell provides `<main id="main-content">` |
| Page class padding | When a page class (`.uc-page`, `.vs-page`, etc.) is combined with `.container`, use `padding-top`/`padding-bottom` only — never `padding: Xpx 0 Ypx` shorthand (zeroes horizontal padding, overrides `.container`) |
| Onboarding | `/onboarding` inside Shell with TopBar+Footer — not standalone. No forced redirect. |
| Auth nav gating | UserDropdown only when `user` (logged in). Sign in + Sign up when `!user`. |
| PDF | Lazy-loaded via `await import()`. Never static-import jsPDF. |
| Exports | CSV: `csvDownload()`; PDF: lazy `extractionsToPdf()`; Markdown: `markdownDownload()`; JSON: `jsonDownload()` — all in `utils.js` |
| Batch mode | `runBatch()` in `batchService.js` — CONCURRENCY=3; each URL increments extraction counter via `billing.trackExtraction(1)` |
| Batch gating | `checkCanBatch(urlCount)` and `checkCanExtractBatch(urlCount)` on BillingProvider; Business≤200, Agency≤500; Batch Pack top-up adds 50 slots |
| Background enrichment | `enrich()` must never show the full-screen loader. |
| Admin | `/admin` is standalone (no TopBar/Footer). PIN: `ADMIN123`. Sidebar is collapsible — toggle (chevron) + pin button. State in `datiq.adminSidebarCollapsed` / `datiq.adminSidebarPinned`. |
| Payment secrets | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env ONLY. Never VITE_ prefix. |
| Netlify Functions | ESM (`export const handler`), in `netlify/functions/`. `stripe`/`razorpay` dynamic-imported only. |
| localStorage keys | All use `datiq.*` prefix (except `scrapelite.*` internal keys — NOT rebranded to avoid breaking sessions) |
| Help site | `/help/index.html` linked from TopBar as plain `<a>` (not React Router) — bypasses SPA router |
| Contact emails | `support@datiq.app` (payment), `legal@datiq.app` (terms), `privacy@datiq.app` (privacy) |
| Naming | App brand is "DatIQ" everywhere in UI. Netlify URL stays `scrapelite.netlify.app` for now. |
| Currencies | USD and INR only (EUR/GBP/SGD/AED removed in R4). INR → Razorpay; USD → Stripe. |
| Pricing billing | Default billing period on /pricing is `"annual"` (20% off). Toggle to monthly available. |
| AI key | `hasAI = true` always; `AI_API_KEY` (no VITE_ prefix) lives in Netlify env only. Never export from config.js. |

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
| `datiq.adminSidebarCollapsed` | AdminLayout.jsx — sidebar collapsed state ("1" = collapsed) |
| `datiq.adminSidebarPinned` | AdminLayout.jsx — sidebar pin state ("0" = unpinned) |
| `datiq.upsellDismissedMonth` | UsageUpsellBanner.jsx — month string (e.g. "2026-06") when banner was dismissed |

---

## V5 / R4 — Pricing & Billing

### Plans (R4 revised tiers)

| Plan | USD/mo | USD/yr | INR/yr | Notes |
|---|---|---|---|---|
| Free | $0 | — | — | 10 ext/mo + 25 trial credit |
| Select | $19 | $15/mo | ₹999/mo | |
| Pro | $29 | $23/mo | ₹1,499/mo | badge: Recommended |
| Business | $79 | $63/mo | ₹3,999/mo | API access |
| Agency | $299 | $239/mo | ₹14,999/mo | 5 workspaces |
| Developer | $49 | $39/mo | ₹2,499/mo | comingSoon — H2 2026 |
| Enterprise | Custom (≥$1,000/mo) | — | — | Contact sales |

- Defaults in `src/lib/pricingConfig.js` — also exports `ENTERPRISE_PLAN`
- Admin overrides via `src/lib/pricingOverrides.js` (localStorage-backed, no rebuild)
- **Always** call `getEffectivePlanById(id)` — never use raw `PLAN_BY_ID`
- Annual billing is default on `/pricing` (20% off monthly); toggle to monthly available
- INR annual prices are fixed promotional amounts — NOT converted from USD at runtime
- Free tier: 10 extractions/month + full-feature access (except API/white-label) + 1 workspace + once-only 25-extraction trial credit at signup (`trialCredit: 25` in config; UI shows it; actual grant wired in usageService/AuthProvider is a future task)

### Payment provider routing
| Currency | Provider |
|---|---|
| INR | Razorpay |
| USD | Stripe |
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
- Home.jsx social proof is **hidden** until `stats.teams >= 10 OR stats.extractions >= 100`
- Testimonials section is permanently hidden (`{false && …}`) until real backend data is wired; no placeholder names/photos shown
- When Supabase is not configured, `getStats()` returns null → social proof section is not rendered

### Email capture
- `src/lib/emailCaptureService.js` → `captureEmail(email, source)`:
  - Saves to `datiq.subscribers` in localStorage (deduped)
  - POSTs to `VITE_WEBHOOK_URL` (n8n) as fire-and-forget
- Blog.jsx newsletter has real form with idle/loading/success/already/error states
- Integrations.jsx "Notify me" buttons show a toast with Blog redirect suggestion

---

## Auth (Supabase + AuthProvider)

- `AuthProvider` manages Supabase session, exposes: `user`, `openAuth(mode)`, `closeAuth`, `showAuthModal`, `authMode`, `authError`
- `openAuth('signin')` opens modal on Sign in tab; `openAuth('signup')` opens on Create account tab
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
29. **R1: PlanBadge removed** — plan name badge (e.g. "Select") in TopBar was redundant with "Account & Usage" in UserDropdown; removed `PlanBadge` component and its render call
30. **R2: Onboarding in Shell** — Onboarding page now renders inside main Shell (with TopBar + Footer); removed standalone rendering block; deleted duplicate brand mark and footer links from page; `.ob-page` CSS class added
31. **R2: No forced onboarding redirect** — removed `if (!onboarded && !isPublic) return <Navigate to="/onboarding" replace />` from Shell; all routes accessible without onboarding; onboarding is opt-in
32. **R2: TopBar content alignment** — wrapped TopBar content in `.topbar-inner` (max-width: 1080px, margin: 0 auto) so brand/nav aligns with page `.container` content at all viewport widths
33. **R2: Auth-gated nav** — TopBar UserDropdown (Account & Usage, Switch Role, Sign out) only shown when user is logged in; not-logged-in state shows Sign in + Sign up buttons opening AuthModal on correct tab; `authMode` state added to AuthProvider; `openAuth(mode)` accepts 'signin'/'signup'
34. **R2: Page padding override fix** — `.about-page`, `.blog-page`, `.pricing-page`, `.account-page`, `.uc-page`, `.vs-page`, `.int-page` used `padding: Xpx 0 Ypx` shorthand which zeroed out `.container`'s horizontal padding (screens.css loads after design-system.css). Fixed to `padding-top`/`padding-bottom` only.
35. **R3: Admin sidebar collapsible** — `AdminLayout` converted from CSS Grid to Flexbox layout. Sidebar has collapse/expand toggle (chevron), pin button (locks state), and hover-expand when unpinned+collapsed. State persisted to `datiq.adminSidebarCollapsed` + `datiq.adminSidebarPinned`. Mobile (≤700px) stays horizontal bar with controls hidden.
36. **R4: AI_API_KEY moved server-side** — Removed `export const AI_API_KEY` from `config.js`; `hasAI` is now always `true` (key lives in Netlify Function env as `AI_API_KEY`, no VITE_ prefix). Browser never sees the key.
37. **R4: "DatIQ (powered by DatIQ)" copy bug** — About.jsx hero paragraph fixed to "DatIQ is a zero-code…"
38. **R4: Social proof threshold gate** — Home.jsx stats section only renders when `stats && (stats.teams >= 10 || stats.extractions >= 100)`; testimonials permanently hidden with `{false && …}` until real backend data is wired.
39. **R4: scrapelite.netlify.app → datiq.app** — Fixed in Privacy.jsx intro, help/index.html metadata table, public/robots.txt Sitemap header, public/llms.txt, public/sitemap.xml.
40. **R4: /vs/clay CTA** — "from $9/month" → "from $19/month"; pricing row "$0–$199/mo" → "$0–$299/mo"; API access row updated to "Business plan ($79/mo)".
41. **R4: Blog post expansion** — Clicking any blog card opens an in-page `PostModal` overlay with full article text. `selectedPost` state in Blog.jsx; minimal markdown rendering (##/\*\*/\`code\`).
42. **R4: useToast() usage** — `useToast()` returns the `showToast` function directly (not `{showToast}`). Contact.jsx and any new components must use `const showToast = useToast()`.
43. **R4: /docs redirect** — `DocsRedirect` component uses `window.location.href = "/help/index.html"` (not React Router) to ensure the static HTML file is served, bypassing the SPA.
44. **R4: DPDP Act 2023** — Full compliance section added to Privacy.jsx covering applicability, lawful basis, data principal rights, grievance officer (privacy@datiq.app), cross-border transfers, retention.
45. **R4: Indian arbitration** — Terms.jsx "Governing Law and Dispute Resolution" updated to Indian law, Arbitration and Conciliation Act 1996, seat Bengaluru, English language, sole arbitrator.

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
- [x] ~~Move `VITE_AI_API_KEY` to server-only via Netlify Function~~ — DONE (R4: `hasAI = true`, key is `AI_API_KEY` in Netlify env only)
- [x] ~~Add /contact page~~ — DONE (R4)
- [x] ~~Add /use-cases hub~~ — DONE (R4)
- [x] ~~Fix dead URLs (/docs, /compare)~~ — DONE (R4: /docs → window.location redirect, /compare → Navigate)
- [ ] **Stripe**: update Agency plan Price IDs (plan changed $199 → $299); set `VITE_STRIPE_PRICE_AGENCY`
- [ ] **Razorpay**: update Agency plan Plan IDs to match new ₹14,999/mo price
- [ ] Add `NETLIFY_AUTH_TOKEN` to session env for programmatic deploys from Claude
- [ ] Implement once-only 25-extraction trial credit at signup (`trialCredit: 25` is in plan config; grant not yet wired in usageService/AuthProvider)
- [ ] Referral/affiliate program — teaser UI is live on /pricing; backend not implemented
- [ ] Supabase real auth → replace localStorage persona/session for cross-device sync
- [ ] Switch webhook to production n8n URL
- [ ] Add "Use cases" links to Footer Explore column
- [ ] AdminPricing.jsx: add UI fields for `price_usd_annual` and `price_inr_annual` (currently only monthly prices editable in admin)
- [ ] `/blog/:slug` routing for SEO-indexed posts (currently all content is in-page modal only)
- [x] ~~Batch/multi-URL mode (10–500 URLs)~~ — DONE (R5: /batch page, batchService.js, plan limits, Batch Pack bundle)
- [x] ~~CSV-import enrichment~~ — DONE (R5: Batch page "Import CSV" tab, parseUrlsFromCsv in batchService.js)
- [x] ~~Markdown export~~ — DONE (R5: markdownDownload(), extractionsToMarkdown() in utils.js; Select+ plan)
- [x] ~~JSON export~~ — DONE (R5: jsonDownload(), extractionsToJson() in utils.js; Pro+ plan)
- [ ] `/batch` page: save successful batch results to Dashboard (currently batch results are not persisted)
- [ ] AdminPricing.jsx: add UI field for `batch_max_urls` per plan
- [ ] Batch Pack top-up: wire purchase flow through payment (currently purely a Batch Pack concept without checkout)

---

## How to continue developing

```bash
cd /home/user/scrapelite
git pull origin main
npm run dev   # http://localhost:5173
```

**Quick smoke tests:**
- `/` → accessible without onboarding (no redirect to /onboarding)
- `/dashboard` → accessible without onboarding
- `/onboarding` → shows TopBar + Footer (part of Shell); pick a persona → lands on `/`
- TopBar (not logged in) → shows "Sign in" (ghost) + "Sign up" (primary) buttons
- TopBar "Sign in" → opens modal on Sign in tab; "Sign up" → opens modal on Create account tab
- TopBar (logged in) → shows UserDropdown with Account & Usage, Switch Role, Sign out
- `/pricing` → default shows **Annual** billing toggle selected; "Save 20%" badge visible
- `/pricing` → switch to Monthly; prices update; Annual toggle reverts to lower prices
- `/pricing` → currency auto-detected (INR for India timezone, USD default)
- `/pricing` → INR annual note below plans: "Promotional INR price. Billed annually…"
- `/pricing` → Developer card shows "Coming soon" badge + disabled "Notify me" button
- `/pricing` → Enterprise card has dashed border; "Contact sales" → mailto link
- `/pricing` → select paid plan → spinner → demo_mode → `/account` shows upgraded plan
- `/payment/success?plan=pro&provider=razorpay` → success state
- `/payment/cancel?plan=pro` → "No charge was made"
- `/contact` → form with 5 type buttons; email + message required; on submit → mailto opens + success state
- `/contact` → sidebar shows 3 info cards: Email us, Response times, Self-service resources
- `/use-cases` → 4 cards (Lead Gen, Competitor Research, SEO Audit, Market Research) with highlights
- `/use-cases` → clicking "Explore X" navigates to the correct `/use-cases/slug` page
- `/docs` → browser navigates to `/help/index.html` (full page load, not SPA nav)
- `/compare` → redirects to `/vs/browse-ai`
- `/admin` → PIN `ADMIN123` → Revenue / Pricing / Coupons / Users
- Admin sidebar → chevron button collapses sidebar to 64px icon-only strip; chevron expands it back
- Admin sidebar → pin button (pin/pin-off icon) locks state; when unpinned+collapsed, hovering sidebar temporarily expands it
- Admin sidebar → state persists across page reloads (localStorage)
- `/account` → enter coupon `LAUNCH20` → Apply; then × to remove
- TopBar → Sign in → create account → persona step appears → select persona → lands on `/`
- TopBar brand → shows `layers` icon + "DatIQ" + "Intelligence from every URL" tagline
- TopBar nav (desktop >820px) → Extract, Dashboard, Pricing all show text+icon; Explore dropdown shows
- TopBar Explore dropdown → 4 sections: Pricing (Plans & Pricing + Integrations), Use Cases (4), Compare (2), Resources (About/Blog/Help)
- TopBar UserDropdown → persona colour dot + name; hover shows profile card + Account/Switch Role/Sign out
- TopBar (mobile <600px) → hamburger button visible; tap to open slide-down nav panel
- Mobile nav → Extract/Dashboard/Pricing links; Explore accordion expands; persona info shown
- `/about` → founder block visible (Vikash Karuna, role, bio, LinkedIn link)
- `/about` → hero text does NOT say "DatIQ (powered by DatIQ)" — should read "DatIQ is a zero-code…"
- `/blog` → clicking any article card opens in-page PostModal overlay with full content
- `/blog` → PostModal has close button + "Back to blog" footer link
- `/blog` newsletter → enter email → "You're subscribed!" (localStorage + n8n webhook)
- `/integrations` → 12 cards; "Notify me" on coming-soon shows toast
- `/privacy` → page URL reads `https://datiq.app` (not scrapelite.netlify.app)
- `/privacy` → DPDP Act 2023 section present with Grievance Officer contact details
- `/terms` → governing law section says "India" + "Arbitration and Conciliation Act, 1996" + "Bengaluru"
- `/use-cases/lead-generation` → content left/right edges align with TopBar and Footer
- `/vs/clay` → CTA says "from $19/month"; Agency row removed; API access → "Business plan ($79/mo)"
- Home social proof → section hidden when stats are null OR both teams<10 AND extractions<100
- Home social proof → visible when Supabase returns real numbers above thresholds
- Footer → slim single row: LinkedIn + Twitter socials | copyright | Privacy · Terms links
- Home → persona chips above URL input (click to populate search box)
- Home → scrape toggles in 2-column grid; each toggle has hover tooltip
- favicon → layered-diamond indigo SVG visible in browser tab
- Usage upsell banner → appears between TopBar and page content when extraction usage ≥80%
- Usage upsell banner → dismiss button hides it; re-appears next calendar month

---

## Git log (recent)

```
(latest)  chore: update CLAUDE.md — R4 session fully documented
5dd3db6  feat(r0-session4): comprehensive UI/UX polish, pricing overhaul, new pages
9da7968  chore: update CLAUDE.md — R3 admin sidebar collapse documented
cbf8993  feat(admin): collapsible sidebar with toggle and pin controls
0ae1c84  Add files via upload
99a2534  merge(css): fix content alignment on use-case, compare and marketing pages
6ecc1e6  fix(css): page padding override — use padding-top/bottom to preserve .container alignment [R2]
113e20d  chore: sync feature branch with main after UI fixes merge
```
