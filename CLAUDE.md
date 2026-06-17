# DatIQ — project context for Claude

> This file is read automatically at the start of every new Claude session.
> It captures the complete state of the project so work can continue seamlessly.
> **Last updated: 2026-06-17 — R17 (logout cleanup, guest hard limits, admin General Settings) merged to main and deployed to Netlify**

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
| **Current branch** | `main` — R17 merged and pushed; `claude/enrich-batch-mall-3tkc1s` is the completed feature branch (can be deleted) |
| **Latest main commit** | R17 merge: logout cleanup + guest hard limits (10 single / 5 batch) + admin General Settings page + globalSettingsService |
| **Latest branch commit** | Same as main (branch fully merged) |

---

## Branch merge history (completed 2026-06-09 → 2026-06-15)

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
| `claude/batch-mode-export-formats-fkjkxx` | R5–R7: /batch page, CSV import, MD/JSON export, batch limits; R6: inline batch on Home, feature tags, Dashboard empty state; R7: batch_max_urls admin, Batch Pack payment, stable AI model | ✅ merged to main |
| `R0-polish-feature-ui-enhancement` | R6: batch inline on Home, feature card tags fixed, Dashboard no-demo; **R12**: plan card hover/selection states, TopupBundleModal qty selector, payment-gated activation | ✅ merged to main |
| `claude/r0-polish-feature-ui-fgj5yo` | R8: grouped Export dropdown (Dashboard), floating AI selection bar (bottom), auto-save on extraction, Preview → View Dashboard + Delete, Generate content in Preview QA card, Home removes Batch toggle + Try examples, Batch result View button, emailService webhook→mailto fallback; R9: Batch nav before Dashboard, batch auto-save fix (strip _status/_error), Netlify fn strips _status/_error, Dashboard localStorage-first loading + Refresh button + inline Generate/Email selection buttons + dropdown z-index fix, Preview Download ▾ dropdown; R10: Explore menu Contact Us + Submit Bug, Contact page bug type + query-param pre-fill | ✅ merged to main |
| `claude/razorpay-payment-integration-76uecb` | R11: complete Razorpay end-to-end integration — `PAYMENT_STAGE` state machine, `PaymentProcessingModal` step-by-step UX, `onStageChange` threading, billingPeriod wiring, INR annual fix, `retryPayment` callback with `lastPaymentArgs` ref, `create-checkout.js` rewrite (agency $299, bundles), `verify-payment.js` timing-safe HMAC, `payment-webhook.js` Supabase sync, audit fixes (account-stats CSS, unused providerMeta) | ✅ merged to main |
| `claude/pricing-batch-help-polish-dwwlj7` | R13: GST breakdown `PaymentConfirmModal`, bundle base prices (pre-GST display), TopupBundleModal INR upsell prices, Enterprise plan card restored, Apify+PhantomBuster comparison pages, compare.html multi-page links, batch table full-width, usage banner container-constrained, Account batch/content generation stats, `batchRuns`+`contentGenerations` in usageService, TopBar Explore restructure (remove Browse.ai/Clay from Compare, remove Submit Bug, About DatIQ last), help/index.html External/Internal labels removed, 09-exports-and-sharing.html full rewrite (all 5 formats) | ✅ merged to main |
| `claude/firecrawl-fallback-analysis-qyksr4` | R14a: Firecrawl → Spider.cloud → Jina AI → Direct fetch fallback chain; `scrapeProviders.js` provider registry + chain runners; `extract.js` rewritten to use chain; `config.js` `hasFirecrawl` covers all providers + `VITE_ENABLE_EXTRACT` flag | ✅ merged to main |
| `home-screen-enhancement` | R14b: Home intent chips (5: summary/contacts/pricing/map/custom) replace 4 toggles; OG preview card (800ms debounce); clickable feature cards map to intent chips; FAB (layers-2) beside Extract navigates to /batch; `BulkUploadModal` component created but now only reachable from /batch; Batch page unified intent chips + run history via `batchRunsService.js`; Dashboard `BatchRunsDropdown` filter + `batch-item-tag` chips | ✅ merged to main |
| `claude/enrich-batch-mall-3tkc1s` | **R16**: Batch mode parity — Map site intent chip (5th), per-URL content generation toggle (SEO/competitor/social), enrichMeta tab persistence for contacts/pricing/custom; Guest trial gate — `GuestTrialProvider`, `GuestTrialBanner`, `GuestTrialModal`, `guestTrialService`; soft gate (TRIAL_LIMIT=3, re-prompts every 2); sign-in/out bypass prevention (count never cleared on login) | ✅ merged to main |
| `claude/enrich-batch-mall-3tkc1s` (R17) | **R17**: Logout clears sensitive data (7 localStorage keys + navigate to /); guest hard limits (10 single-URL / 5 batch runs, configurable); non-dismissible hard block modal; pre-flight checks in ExtractionProvider + Batch; Admin General Settings page (`/admin/general`) + Netlify fn `admin-general-config.js` + `globalSettingsService.js` | ✅ merged to main |

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
| `/admin/ai` | AI provider chain editor (model, order, enable toggles, max tokens) | Admin |
| `/admin/general` | Global application settings (guest limits, reprompt interval) | Admin |
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
│   └── screens.css                   All screen/component CSS (~4300+ lines)
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
│   ├── emailCaptureService.js        ★ R0: captureEmail(email, source) → datiq.subscribers LS + n8n webhook
│   ├── batchRunsService.js           ★ R14b: saveBatchRun/listBatchRuns/deleteBatchRun + recordBatchItems/readBatchMap
│   │                                 localStorage keys: datiq.batchRuns (run summaries) + datiq.batchMap (id→runId map)
│   ├── guestTrialService.js          ★ R16: guest trial counters (count + batchCount) in datiq.guestTrial
│   │                                 getGuestCount/incrementGuestCount, getGuestBatchCount/incrementGuestBatchCount
│   │                                 shouldShowTrialPrompt, isTrialLimitReached, isSingleHardLimitReached, isBatchHardLimitReached
│   │                                 TRIAL_LIMIT=3, SINGLE_HARD_LIMIT=10, BATCH_HARD_LIMIT=5 (overridden by globalSettings)
│   └── globalSettingsService.js      ★ R17: fetches /api/admin-general-config with 5-min TTL cache (datiq.globalSettings)
│                                     getSettings() synchronous (immediate cache read + DEFAULTS fallback)
│                                     loadSettings() async (fetch → cache → return merged)
│                                     updateCachedSettings(settings) called by AdminGeneral after save
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
│   ├── ContentModal.jsx              Generate content modal; 3 formats; copy button; ★ R13: calls incrementContentGenerations()
│   ├── EmailModal.jsx                Send email modal; multi-recipient
│   ├── PaymentConfirmModal.jsx       ★ R13: pre-payment GST breakdown modal (base + 18% GST + total)
│   ├── BrandLoader.jsx               Animated loader
│   ├── FaviconDot.jsx                Deterministic hue monogram per domain
│   ├── LoadingScreen.jsx             Full-screen 4-step animated progress
│   ├── BulkUploadModal.jsx           ★ R14b: paste URLs + CSV upload modal; currently NOT used by Home (FAB → /batch)
│   │                                 Still exists for potential future use on /batch or other pages
│   ├── GuestTrialProvider.jsx        ★ R16: Context provider for guest trial tracking
│   │                                 SENSITIVE_KEYS cleared on logout (never includes datiq.guestTrial)
│   │                                 checkCanExtractSingle/checkCanExtractBatch pre-flight checks
│   │                                 trackGuestExtraction/trackGuestBatchRun post-completion tracking
│   │                                 Mount useEffect restores hard-block state on page reload
│   │                                 Auth-transition useEffect: login→clear prompts; logout→clear sensitive keys + navigate("/")
│   │                                 Settings loaded via useState(getSettings) + async loadSettings() on mount
│   ├── GuestTrialBanner.jsx          ★ R16: Top banner showing remaining trial credits (single + batch)
│   └── GuestTrialModal.jsx           ★ R16: Soft prompt (dismissible) + Hard block (non-dismissible) modal
│                                     Hard block: no backdrop click, no Escape, no "Continue as guest" button
│                                     Hard block: overlay itself provides dark background (no backdrop div)
└── pages/
    ├── Home.jsx                      URL input + Extract button + FAB (Bulk import → /batch), 5 intent chips,
    │                                 OG preview card, 8 clickable capability cards, social proof
    │                                 ★ R14b: intent chips replace toggles; FAB navigates to /batch (no inline multi-URL)
    │                                 ★ R4: testimonials permanently hidden until real backend data
    ├── Preview.jsx                   Quick enrichment, enrichment tabs, save/discard
    ├── Dashboard.jsx                 Table/cards, search, pagination, CSV/PDF/MD/JSON/Generate/Email
    │                                 ★ R6: no demo data — shows real extractions; proper empty state when none
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
    │                                 ★ R14b: intent chips; batch run history (batchRunsService.js)
    │                                 ★ R15: textarea draft persisted to datiq.batchDraft in localStorage; unified Export ▾ dropdown
    │                                 ★ R16: pre-flight batch hard limit check (checkCanExtractBatch) before run
    │                                 ★ R16: trackGuestBatchRun() called after batch completes (not trackGuestExtraction)
    └── admin/
        ├── AdminLayout.jsx           PIN gate (server-verified via admin-auth fn; async login,
        │                             token session, 5→60s lockout), collapsible sidebar (chevron + pin)
        │                             ★ R17: NAV includes General Settings (/admin/general)
        ├── AdminRevenue.jsx          KPI cards, MRR trend chart, plan distribution
        ├── AdminPricing.jsx          Editable plan prices + limits + global discount + bundles
        ├── AdminCoupons.jsx          Coupon CRUD (% or bonus extractions)
        ├── AdminUsers.jsx            User table: search, filter, extend usage, invite
        ├── AdminAI.jsx               ★ AI provider chain editor — reorder providers, model per
        │                             provider, enable toggles, max tokens (via adminConfigService)
        └── AdminGeneral.jsx          ★ R17: Global application settings editor
                                      4 fields: soft_limit, reprompt_interval, single_hard_limit, batch_hard_limit
                                      Calls getGeneralConfig/saveGeneralConfig (adminConfigService.js)
                                      updateCachedSettings() after save so changes take effect immediately

netlify/
└── functions/
    ├── ai.js                         ★ POST /api/ai — MULTI-PROVIDER proxy w/ ordered fallback
    │                                 (Gemini→Claude→OpenAI default); normalizes to Anthropic shape
    ├── admin-ai-config.js            ★ GET=config+key presence; POST=upsert app_config 'ai' (token-gated)
    ├── admin-general-config.js       ★ R17: GET=merge app_config 'general' + DEFAULTS; POST=sanitize+upsert (token-gated)
    │                                 Sanitizes 4 integer fields with min/max bounds; localStorage fallback when no Supabase
    ├── lib/aiProviders.js            ★ provider adapters + loadAiConfig() + runChain() fallback
    ├── lib/adminToken.js             ★ verifyAdminToken() — HMAC check of admin-auth session token
    ├── extract.js                    POST /api/extract — multi-provider scraping proxy (Firecrawl→Spider→Jina→Direct)
    ├── extractions.js                GET/POST/PATCH/DELETE /api/extractions — Supabase proxy
    ├── create-checkout.js            ★ V5c: POST — Stripe Checkout session or Razorpay order
    │                                 ★ now sources prices/coupons/global via lib/pricingSource.js
    ├── verify-payment.js             ★ V5c: GET=Stripe verify, POST=Razorpay HMAC verify
    ├── payment-webhook.js            ★ V5c: Stripe + Razorpay webhook handler
    ├── admin-auth.js                 ★ POST — server-side admin PIN verify (ADMIN_PIN_HASH);
    │                                 returns HMAC-signed session token; demo mode = ADMIN123
    ├── lib/pricingSource.js          ★ shared server source of truth — loadPricing() merges
    │                                 Supabase pricing_config over static tables; resolveDiscountFraction()
    ├── stats.js                      ★ R0: GET /api/stats — aggregate teams/extractions from Supabase
    │                                 Direct REST (no SDK); 5-min CDN cache header
    ├── og-preview.js                 ★ R14b: GET /api/og-preview?url= — server-side OG metadata fetch
    │                                 Reads first 15KB, parses og:title/description/<title>/meta; 5-min CDN cache
    └── lib/scrapeProviders.js        ★ R14a: 4-provider scraping chain — Firecrawl/Spider/Jina/Direct
                                      SCRAPE_PROVIDERS registry; runScrapeChain(); runMapChain(); scrapeProviderStatus()

public/
├── favicon.svg
├── runtime-config.js                 window.__DATIQ_RUNTIME__ override (no rebuild needed)
├── llms.txt                          ★ R4: updated all URLs → datiq.app; new pricing tiers; /contact added
├── robots.txt                        ★ R4: Sitemap URL → https://datiq.app/sitemap.xml
├── sitemap.xml                       ★ R4: all URLs → datiq.app; added /contact, /use-cases
├── vs/
│   ├── compare.html                  ★ R13: hero quick-links + all 4 comparison pages listed
│   ├── apify.html                    ★ R13: DatIQ vs Apify comparison page (new)
│   └── phantombuster.html            ★ R13: DatIQ vs PhantomBuster comparison page (new)
└── help/
    ├── index.html                    ★ R4: metadata table → datiq.app; R13: removed External/Internal labels + Internal section
    ├── help.css
    ├── 09-exports-and-sharing.html   ★ R13: full rewrite — all 5 export formats, plan requirements, tips
    └── [14 other section HTML pages + 6 screenshot assets]
```

---

## Provider tree (App.jsx)

```
ThemeProvider
  ToastProvider
    ErrorModalProvider
      AuthProvider
        GuestTrialProvider
          PersonaProvider
            BillingProvider
              ExtractionProvider
                <Shell />   ← skip-link + TopBar + GuestTrialBanner + <main id="main-content"> + routes + GuestTrialModal + Footer + AuthModal
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
| TopBar nav | Main links: Extract / Batch / Dashboard + ExploreDropdown + UserDropdown (logged in) OR Sign in + Sign up (logged out) |
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
| Admin | `/admin` is standalone (no TopBar/Footer). **PIN verified server-side** via `netlify/functions/admin-auth.js` (env `ADMIN_PIN_HASH`); demo PIN `ADMIN123` only when no PIN env is set or the function is unreachable (`npm run dev`). `adminLogin()` is async → token in `scrapelite.adminAuth` (+ exp); 5-attempt → 60s lockout (`datiq.adminLock`). Sidebar is collapsible — toggle (chevron) + pin button. State in `datiq.adminSidebarCollapsed` / `datiq.adminSidebarPinned`. |
| Payment secrets | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `*_WEBHOOK_SECRET` — Netlify env ONLY. Never VITE_ prefix. |
| Netlify Functions | ESM (`export const handler`), in `netlify/functions/`. `stripe`/`razorpay` dynamic-imported only. |
| localStorage keys | All use `datiq.*` prefix (except `scrapelite.*` internal keys — NOT rebranded to avoid breaking sessions) |
| Help site | `/help/index.html` linked from TopBar as plain `<a>` (not React Router) — bypasses SPA router |
| Contact emails | `support@datiq.app` (payment), `legal@datiq.app` (terms), `privacy@datiq.app` (privacy) |
| Naming | App brand is "DatIQ" everywhere in UI. Netlify URL stays `scrapelite.netlify.app` for now. |
| Currencies | USD and INR only (EUR/GBP/SGD/AED removed in R4). INR → Razorpay; USD → Stripe. |
| Pricing billing | Default billing period on /pricing is `"annual"` (20% off). Toggle to monthly available. |
| AI key | `hasAI = true` always; `AI_API_KEY` (no VITE_ prefix) lives in Netlify env only. Never export from config.js. |
| Guest trial soft gate | `GuestTrialProvider` tracks `count` (single-URL extractions). Soft prompt after `guest_trial_soft_limit` (default 3), re-prompts every `guest_trial_reprompt_interval` (default 2). Soft prompt is dismissible. |
| Guest trial hard block | Hard block after `guest_single_hard_limit` (default 10) single-URL extractions OR `guest_batch_hard_limit` (default 5) batch runs. Hard block is **non-dismissible** — no Escape, no backdrop click, no "Continue as guest". Modal overlay provides its own dark background. |
| Guest trial counter | `datiq.guestTrial` localStorage key is **NEVER cleared** (not in SENSITIVE_KEYS). Prevents bypass via sign-in/out cycling. Count persists even after logout and login. |
| Guest logout cleanup | On logout: 7 SENSITIVE_KEYS cleared from localStorage + `navigate("/")` called to flush in-memory React state (Dashboard items, etc.). Guest trial key preserved. |
| Global settings service | `globalSettingsService.js` caches `guest_*` limits from `/api/admin-general-config` in `datiq.globalSettings` (5-min TTL). Synchronous `getSettings()` for immediate use. `GuestTrialProvider` uses both `useState(getSettings)` on mount and async `loadSettings()` refresh. |
| Admin general config | `admin-general-config.js` Netlify fn: GET merges `app_config key='general'` + DEFAULTS; POST is token-gated, sanitizes integer ranges, upserts to Supabase. `AdminGeneral.jsx` page calls `updateCachedSettings()` after save so changes propagate immediately in same tab. |
| ExtractionProvider pre-flight | `extract()` checks `checkCanExtractSingle()` before starting. If blocked → sets `showHardBlock(true)` and returns early without extraction. |
| Batch pre-flight | `handleRun()` in `Batch.jsx` checks `checkCanExtractBatch()` before starting. If blocked → sets `showHardBlock(true)` and returns early. |

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
| `scrapelite.adminAuth` | adminService.js — admin session **token** from `admin-auth` fn (NOT rebranded) |
| `scrapelite.adminAuthExp` | adminService.js — admin token expiry (ms epoch) |
| `datiq.adminLock` | adminService.js — failed-PIN-attempt lockout state (`{attempts, until}`) |
| `scrapelite.*` | Internal keys (persona, usage, currency, pricing overrides etc.) — NOT rebranded |
| `datiq.plan` | BillingProvider — active plan ID |
| `datiq.pendingPayment` | paymentService.js — pending Stripe redirect state |
| `datiq.migrated` | migrationService.js — flag: scrapelite.* → datiq.* migration done |
| `datiq.adminSidebarCollapsed` | AdminLayout.jsx — sidebar collapsed state ("1" = collapsed) |
| `datiq.adminSidebarPinned` | AdminLayout.jsx — sidebar pin state ("0" = unpinned) |
| `datiq.upsellDismissedMonth` | UsageUpsellBanner.jsx — month string (e.g. "2026-06") when banner was dismissed |
| `datiq.batchRuns` | batchRunsService.js — array of past batch run summaries (max 50) |
| `datiq.batchMap` | batchRunsService.js — map of `{ extractionId: batchRunId }` for Dashboard tagging |
| `datiq.batchDraft` | Batch.jsx — persisted textarea content; survives refresh + back-navigation; cleared on "New batch" |
| `datiq.guestTrial` | guestTrialService.js — guest trial counts `{ count, batchCount, sid }`. **NEVER cleared on login or logout** — intentional bypass-prevention. |
| `datiq.globalSettings` | globalSettingsService.js — cached guest limit settings from server (5-min TTL). Falls back to DEFAULTS when uncached or fetch fails. |

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

-- Server-authoritative pricing/coupon overrides (read by create-checkout.js via
-- pricingSource.loadPricing). Operator-managed: edited directly (SQL/dashboard) or
-- via the "Generate SQL" panel in /admin/pricing. RLS is enabled with NO anon policy
-- on purpose — only the service key (which bypasses RLS) may read/write, because
-- these values set real charge amounts. If the table is empty, the server uses its
-- static fallback tables. Keys: 'plans' | 'bundles' | 'coupons' | 'global'.
CREATE TABLE IF NOT EXISTS public.pricing_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
-- (Intentionally no anon policy. Service key bypasses RLS.)

-- Coupon redemption tracking — server-enforced maxUses + one-redemption-per-user.
-- Written by create-checkout.js via the redeem_coupon RPC (service key only).
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null,
  session_id  text not null,
  order_ref   text,
  created_at  timestamptz default now(),
  unique (coupon_code, session_id)   -- per-user one-time use
);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY; -- no anon policy

CREATE TABLE IF NOT EXISTS public.coupon_counters (
  coupon_code text primary key,
  uses integer not null default 0
);
ALTER TABLE public.coupon_counters ENABLE ROW LEVEL SECURITY;    -- no anon policy

-- Atomic redeem: (1) claim the per-user slot via the unique constraint, then
-- (2) conditionally increment the per-coupon counter ONLY while under the cap (the
-- UPDATE...WHERE uses < p_max is row-locked, so the cap can't be exceeded under
-- concurrency). Returns 'ok' | 'already_redeemed' | 'cap_reached'. p_max<=0 = no cap.
CREATE OR REPLACE FUNCTION public.redeem_coupon(
  p_code text, p_session text, p_max integer, p_order text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE new_uses integer;
BEGIN
  BEGIN
    INSERT INTO public.coupon_redemptions (coupon_code, session_id, order_ref)
    VALUES (p_code, p_session, p_order);
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_redeemed';
  END;
  IF p_max IS NULL OR p_max <= 0 THEN
    RETURN 'ok';
  END IF;
  INSERT INTO public.coupon_counters (coupon_code, uses) VALUES (p_code, 0)
    ON CONFLICT (coupon_code) DO NOTHING;
  UPDATE public.coupon_counters SET uses = uses + 1
   WHERE coupon_code = p_code AND uses < p_max
  RETURNING uses INTO new_uses;
  IF new_uses IS NULL THEN
    DELETE FROM public.coupon_redemptions WHERE coupon_code = p_code AND session_id = p_session;
    RETURN 'cap_reached';
  END IF;
  RETURN 'ok';
END; $$;
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
# ── AI providers (multi-provider fallback chain; keys server-only) ──
AI_API_KEY=                    # Anthropic Claude (sk-ant-...)
GEMINI_API_KEY=                # Google Gemini (AIza...) — default PRIMARY provider
OPENAI_API_KEY=                # OpenAI (sk-...)
AI_PROVIDER_ORDER=gemini,anthropic,openai   # optional; overrides default chain order
GEMINI_MODEL=gemini-2.5-flash               # optional per-provider model overrides
AI_MODEL=claude-3-5-haiku-20241022          # (Anthropic) optional
OPENAI_MODEL=gpt-4o-mini                     # optional
AI_MAX_TOKENS=1024                           # optional default per-request budget
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
SUPABASE_URL=                  # used by stats.js + pricingSource.js (no VITE_ prefix)
SUPABASE_SERVICE_KEY=          # service key — stats.js aggregates + pricing_config reads
ADMIN_PIN_HASH=                # SHA-256 hex of a STRONG admin PIN (preferred). Generate:
                               #   printf '%s' 'your-strong-pin' | shasum -a 256
ADMIN_PIN=                     # plaintext admin PIN (fallback if you can't pre-hash)
ADMIN_TOKEN_SECRET=            # optional HMAC key for the admin session token
```

> **Admin PIN is verified server-side** by `netlify/functions/admin-auth.js` — the secret
> never ships in the browser bundle. If neither `ADMIN_PIN_HASH` nor `ADMIN_PIN` is set,
> the function runs in DEMO mode (accepts `ADMIN123`, returns `demo:true`). Set
> `ADMIN_PIN_HASH` to a strong value to disable demo mode. `admin-auth.js` is plain Node
> `crypto` (no external deps), so it works in `npm run dev` only via the dev fallback
> (accepts `ADMIN123` when the function is unreachable); production must set the env var.

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
46. **R6: Home batch mode** — `batchMode` toggle added to scrape-opts-grid (first position). When active: multi-URL textarea replaces single URL field, progress bar + cancel during run, inline `BatchResultsPanel` after completion with CSV/PDF/MD/JSON export buttons. Dead `submitBatch` function removed; single `handleBatchExtract` used.
47. **R6: Feature card tag layout** — `.feature-body` + `.feature-title-row` wrapper added so Popular and Recommended tags sit inline next to the title. CSS: `.feature-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }` + `.feature-title-row .feature-tag { margin-left: 0; }`.
48. **R6: Dashboard no-demo** — `DEMO_EXTRACTIONS` import removed; `showingDemo` always `false`; demo banner removed. Empty state when `items.length === 0` shows bookmark icon + "Nothing saved yet" + "Extract a page" CTA button.
49. **R6: Batch inline CSS** — Added `.batch-field-wrap`, `.batch-field-header`, `.batch-field-label`, `.batch-field-count`, `.batch-field-textarea`, `.batch-field-footer`, `.batch-field-progress`, `.batch-field-progress-label`, `.batch-cancel-btn`, `.batch-inline-results`, `.batch-inline-header`, `.batch-inline-badge`, `.batch-inline-fail`, `.batch-inline-exports`, `.batch-inline-btn`, `.batch-inline-rows`, `.batch-inline-row`, `.batch-inline-dot`, `.batch-inline-url`, `.batch-inline-errmsg`, `.batch-inline-meta` to screens.css.
50. **R6b: AI step non-fatal** — `realSummary()` and `realContent()` in `aiService.js` now wrap `callAI()` in try/catch; if AI returns 400/503/any error, they silently fall back to `mockSummary()`/`mockContent()` so the extraction still succeeds. This fixes "AI request failed (400)" causing all extractions to fail when the Anthropic model returns 400.
51. **R6b: ai.js model fallback** — `netlify/functions/ai.js` now retries once with `claude-3-5-haiku-20241022` when the primary model (`claude-haiku-4-5-20251001`) returns HTTP 400. Uses a nested `callAnthropic(modelId)` helper. The `FALLBACK_MODEL` const is separate from `DEFAULT_MODEL` for easy maintenance.
52. **R6c: Batch auto-save** — After `runBatch` completes, all successful results are automatically saved to the database via `Promise.allSettled(successItems.map(saveExtraction))`. A "N pages saved to Dashboard" toast fires when done. Applies to both `/batch` page and Home inline batch mode. `saveExtraction` imported in `Batch.jsx` and `Home.jsx`.
53. **R6c: PDF stale-chunk error** — `Failed to fetch dynamically imported module` (stale Vite chunk after deploy) was misclassified as a network error. Fixed: (a) new category in `errorMessages.js` for dynamic import failures → "App update available, please refresh"; (b) all PDF export handlers (`Dashboard.jsx`, `Batch.jsx`, `Home.jsx`) detect the error and show a toast "App updated — please refresh the page and try again." instead of the confusing error modal.
54. **R7: AdminPricing `batch_max_urls` field** — Added numeric input "Batch URL limit (0 = disabled)" to `PlanEditor` form (step=50). Included in `save()` → `limits.batch_max_urls` via `setPlanOverride`. Defaults to `plan.limits.batch_max_urls ?? 0`.
55. **R7: Batch Pack payment wiring** — `BillingProvider.purchaseBatchPack(bundleId)` added. Demo mode: immediately increments `subscription.bonusBatchUrls` by `bundle.bonusBatchUrls` (50). Real payment: calls `initiateTopupCheckout` → on success/demo_mode grants bonus URLs. Pricing.jsx `handleBundleBuy` replaced mailto stub with `purchaseBatchPack(bundleId)` → navigates to `/account` on success.
56. **R7: Stable AI model default** — `netlify/functions/ai.js` `DEFAULT_MODEL` changed to `claude-3-5-haiku-20241022` (stable). `FALLBACK_MODEL` is now `claude-haiku-4-5-20251001` (newer, used only as fallback if stable returns 400). Set `AI_MODEL` env var in Netlify to override.
57. **R8: Grouped Export dropdown** — Dashboard: 4 individual CSV/PDF/MD/JSON buttons → single "Export ▾" dropdown showing plan hints. Same dropdown in floating selection bar.
58. **R8: Floating selection action bar** — `SelectionBar` component fixed at bottom of Dashboard when ≥1 rows selected. Generate (→ContentModal) / Email (→EmailModal) / Export dropdown. Animated slide-up.
59. **R8: Auto-save on extraction** — `ExtractionProvider.extract()` calls `saveExtraction(result)` fire-and-forget after navigate to `/preview`. Sets `result._saved = true` on success.
60. **R8: Preview action bar redesign** — "Save to Dashboard" + "Discard" replaced with "View Dashboard" (primary) + "Generate" (→ContentModal) + "Delete" (ghost). `deleteExtraction` statically imported.
61. **R8: Generate content on Preview** — ContentModal accessible from Quick Enrichment card header ("Generate content" button) and action bar.
62. **R8: Home cleanup** — Batch mode toggle and inline batch UI removed. "Use Batch mode →" hint link added. "Try" example chips removed; only validation error shown.
63. **R8: Batch result View button** — Each success row in `/batch` results table has "View" → `view(item)` → `/preview`. AI summary snippet shown in results.
64. **R8: Email webhook fallback** — `emailService` catches network-level `fetch` failures (CORS / server down) and falls through to mailto instead of showing raw "Failed to fetch".
65. **R9: TopBar Batch order** — `mainLinks` reordered to Extract → Batch → Dashboard (was Extract → Dashboard → Batch).
66. **R9: Batch auto-save `_status`/`_error` fields** — `Batch.jsx` strips `_status` and `_error` before calling `saveExtraction()`. `netlify/functions/extractions.js` also destructures and discards these fields before the Supabase insert to prevent 500 errors from unknown columns.
67. **R9: Dashboard dropdown z-index** — `.dash-header` and `.preview-bar` given `position: relative; z-index: 10` so their Export/Download dropdowns paint above sibling cards (which inherit `z-index: 1` from `.container > *`).
68. **R9: Dashboard localStorage-first loading** — `items` state initialized via `useState(readLocalItems)` (lazy init from `datiq.saved`); `loading` spinner only shown when localStorage has no data; API sync runs in background and updates items silently.
69. **R9: Dashboard Refresh button** — "Refresh" ghost button added to header; calls `listExtractions()` and updates state; shows "Refreshed" toast on success.
70. **R9: Dashboard inline selection actions** — When rows are selected, `dash-toolbar-right` shows Generate + Email + Clear buttons inline (in addition to the floating selection bar at the bottom).
71. **R9: Preview Download dropdown** — Action bar "Generate" button replaced with "Download ▾" dropdown (CSV / PDF / Markdown / JSON). "Generate content" button remains in the Quick Enrichment card header.
72. **R9: Footer alignment** — `.site-footer-slim { padding: 18px 0 }` changed to `padding-top/bottom` only so `.container`'s horizontal `clamp(20px, 4vw, 44px)` padding is no longer overridden. Footer left/right edges now align with TopBar and page content.
73. **R9: Dashboard Generate/Email guard** — `setContentItem(selectedItems[0])` and `setEmailOpen(true)` now guarded by `selectedItems.length > 0` in both inline toolbar and floating SelectionBar, preventing crash when stale selection IDs don't exist in current items list.
74. **R9: Batch export strips `_status`/`_error`** — `successResults` mapped to remove `_status` and `_error` before CSV/PDF/Markdown/JSON exports, so users don't see internal batch fields in their downloaded data.
75. **R9: extractionsRepo `shouldFallback` covers 500** — Added `err.status === 500` to the fallback condition so unexpected Supabase/function errors degrade to localStorage instead of surfacing a hard error modal to the user.
76. **R9: Dashboard loading init single-read** — `loading` now initialised as `!localStorage.getItem("datiq.saved")` (key existence check only) to avoid double JSON-parse. The `useEffect` cleanup simplified: `setLoading(false)` moved back to `.finally()` only.
77. **R10: Explore menu Contact Us + Submit Bug** — `EXPLORE_SECTIONS` Resources section now has: About DatIQ (top), Contact Us (/contact), Submit Bug (/contact?type=bug), Blog, Help Center. `/contact` added to `EXPLORE_ACTIVE_PATHS`.
78. **R10: Contact page bug report pre-fill** — New "Bug report" enquiry type added to `CONTACT_TYPES`. `useLocation` reads `?type=` query param on mount; matching type is pre-selected (fallback "support"). When `type=bug`, subject is pre-filled with "Bug report: ". Icon for "other" type corrected from unregistered "message-circle" to "message-square".
79. **R10: Explore restructure — Company + Contact sections** — `EXPLORE_SECTIONS` now has 6 sections: Company (About DatIQ at top), Pricing, Use Cases, Compare, Resources (Blog + Help Center), Contact (Contact Us + Submit Bug at bottom). Mobile nav accordion auto-propagates the new structure.
80. **R10: AdminUsers PLAN_BY_ID fix** — `AdminUsers.jsx` `PlanPill` component was importing `PLAN_BY_ID` directly from `pricingConfig.js` (violating arch rule). Fixed to use `getEffectivePlanById()` from `pricingOverrides.js` so admin price overrides apply consistently.
81. **R11: Razorpay `PAYMENT_STAGE` state machine** — Added `PAYMENT_STAGE` / `PAYMENT_STAGE_LABELS` exports to `paymentService.js`. `initiateRazorpayCheckout` threads `onStageChange(stage, msg)` through all steps: `PREPARING → PORTAL_OPEN → VERIFYING → ACTIVATING`. Error patterns in `rzp.on("payment.failed")` map to user-friendly messages.
82. **R11: `PaymentProcessingModal`** — New global overlay component mounted in `BillingProvider`. Shows 3-step progress indicator during Razorpay flow. Hidden during `IDLE` and `PORTAL_OPEN` (Razorpay's own modal covers screen). Error state has "Try again" + "Contact support". Cancelled state has "Back to pricing".
83. **R11: `retryPayment` callback** — `BillingProvider` stores `lastPaymentArgs` ref (planId + billingPeriod). `retryPayment()` re-calls `initiatePayment` with stored args on error, so "Try again" in modal actually re-initiates the payment flow without user re-clicking.
84. **R11: INR annual amount fix** — `initiateRazorpayCheckout` now uses `plan.price_inr_annual × 12 × 100` (paise) for annual INR billing instead of USD→INR live conversion — matches the fixed promotional price shown on Pricing page.
85. **R11: `create-checkout.js` rewrite** — Added `billingPeriod` server-side price tables; fixed Agency plan `$199 → $299`; added `batch-pack` / `workspace-addon` bundle support; input validation with specific error codes (`INVALID_PROVIDER`, `UNKNOWN_PLAN`, `AMOUNT_TOO_SMALL`, `RAZORPAY_NOT_CONFIGURED`).
86. **R11: `verify-payment.js` timing-safe HMAC** — Replaced `generated === signature` string comparison with `timingSafeEqual` from Node.js `crypto` module to prevent timing side-channel attacks.
87. **R11: `payment-webhook.js` Supabase sync** — Complete rewrite: lightweight `getDb()` REST client (no SDK); handles Razorpay events (`payment.captured`, `payment.failed`, `subscription.*`); Stripe events (`checkout.session.completed`, `invoice.payment_failed`); returns HTTP 200 even on DB errors to prevent gateway retries.
88. **R11: `billingPeriod` threading** — `billingPeriod` now flows end-to-end: `Pricing.jsx handleSelect(planId, billingPeriod) → BillingProvider.initiatePayment(planId, billingPeriod) → initiateCheckout({billingPeriod}) → initiateRazorpayCheckout/initiateStripeCheckout → server`.
89. **R11: `account-stats` CSS** — Missing `.account-stats { display: flex; flex-direction: column; }` class added to `screens.css` (referenced in Account.jsx quick-stats card).
90. **R11: unused `providerMeta` removed** — `providerMeta` removed from `useBilling()` destructuring in `Account.jsx` (component uses `PROVIDER_META` directly from import). Prop also removed from `PaymentHistorySection` call site and function signature.
91. **R12: Plan card hover states** — `.plan-card:hover` scoped with `:not(.plan-current):not(.plan-coming-soon):not(.plan-selecting)` guards — lifts 3px, accent border, subtle tint. Active/disabled cards never lift.
92. **R12: Plan card current/selecting states** — `.plan-card.plan-current` green ring + `.plan-current-badge` pill overlay ("Your plan"). `.plan-card.plan-selecting` pulsing accent ring via `@keyframes plan-select-pulse` (runs while payment modal is open).
93. **R12: TopupBundleModal** — New component `src/components/TopupBundleModal.jsx`: quantity selector 1–10 with live cumulative pricing, bonus URL count scaled by qty, upsell section showing up to 2 higher plans, CTA "Add N bundle(s) — {total}". Opens from every "Add to plan" button on Pricing page. Missing CSS classes `.tbm-summary-per` and `.tbm-upsell-divider` added to `screens.css`.
94. **R12: Payment-gated plan activation** — `upgradePlan()` only fires on `status === "demo_mode"` or `status === "success"`. Cancelled, error, and exception paths leave plan unchanged. Default planId for new/unpaid users is `"free"` (set in `readSubscription()` default). `purchaseBatchPack` qty param: `bonusUrls = (bundle.bonusBatchUrls || 50) * qty`; server receives qty and computes `unitAmount × qty` authoritatively.
95. **R12 hotfix: DemoPaymentModal** — Clicking "Get Plan" with no payment keys configured (`hasPayment=false`) previously silently upgraded the plan with zero UI. Fixed: `initiatePayment` now `await`s a `new Promise` whose resolve is stored in `demoResolveRef`. Setting `demoTarget` state mounts `DemoPaymentModal` (plan name + price + greyed-out mock card fields + "Demo mode" badge + confirm/cancel). `confirmDemoPayment` resolves `true` → `upgradePlan` → returns `"demo_mode"` to caller. `cancelDemoPayment` resolves `false` → returns `"cancelled"`, plan unchanged. Real payment flow (Razorpay/Stripe) is completely unaffected — only the `!hasPayment` code path changed. To enable real payments: set `VITE_RAZORPAY_KEY_ID` + `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (or Stripe equivalents) in Netlify env vars and redeploy.
96. **Razorpay env-var diagnostic notices** — Pricing page demo-mode banner now lists exact variable names needed. `DemoPaymentModal` body replaced generic text with numbered setup instructions (`VITE_RAZORPAY_KEY_ID` browser/build-time, `RAZORPAY_KEY_ID` server-side, `RAZORPAY_KEY_SECRET` server-side). `RAZORPAY_NOT_CONFIGURED` server error message now names the exact Netlify env vars and rebuild requirement. `screens.css`: `payment-demo-notice` upgraded to multi-line with `code` monospace styling; new `.dpm-env-list` rule.
97. **R13: `PaymentConfirmModal`** — New modal (`src/components/PaymentConfirmModal.jsx`) shown before initiating payment. Displays itemized price breakdown: base price, 18% GST amount, total amount in INR/USD. Has "Confirm & Pay" → calls `initiatePayment`, and "Cancel" / "Upgrade to X" upsell option. `BillingProvider` now sets `confirmTarget` state before opening payment, mounts `<PaymentConfirmModal>` in provider tree.
98. **R13: Bundle display prices are pre-GST** — `TopupBundleModal` and bundle cards on `/pricing` now show base price (pre-GST). GST breakdown (18%) and total shown only in `PaymentConfirmModal` at confirm step. This matches how plan prices are displayed throughout the UI.
99. **R13: TopupBundleModal upsell INR prices** — Previously hardcoded `formatPrice(plan.price_usd_annual, "USD")`. Now checks `isINR` flag: shows `₹{plan.price_inr_annual}` when currency is INR, falls back to USD otherwise. E2E verified: shows ₹999/mo and ₹1,499/mo when INR is active.
100. **R13: Enterprise plan card missing** — `ENTERPRISE_PLAN` was defined in `pricingConfig.js` and `EnterpriseCard` component existed in `Pricing.jsx` but neither the import nor the `<EnterpriseCard>` render call was present. Both added. E2E verified: 7 plan cards (Free/Select/Pro/Business/Agency/Developer/Enterprise) all visible.
101. **R13: Batch results table full width** — `.batch-page { max-width: 860px }` in `screens.css` was constraining the results table. Changed to `width: 100%` so table uses full container width, matching other pages.
102. **R13: Usage upsell banner page-width constraint** — `.usage-upsell-banner` previously spanned full viewport with its background. Refactored: outer `.usage-upsell-banner-wrap` takes full width with the background colour; inner `.usage-upsell-banner` is `max-width: 1080px; margin: 0 auto` with clamp padding, aligning to page container. `isOver` class moved to outer wrap.
103. **R13: Account quick stats — batch + content counts** — Added two new rows in Account.jsx quick stats: "Batch executions" (`usage?.batchRuns`) and "Content generations" (`usage?.contentGenerations`). Both default to 0.
104. **R13: `usageService.js` new counters** — Added `batchRuns: 0` and `contentGenerations: 0` to default usage object in `readUsage()`. Added `incrementBatchRuns(count)` and `incrementContentGenerations(count)` exports. `Batch.jsx` calls `incrementBatchRuns(1)` after each batch completes. `ContentModal.jsx` calls `incrementContentGenerations(1)` after each successful generation.
105. **R13: TopBar Explore restructure** — `EXPLORE_SECTIONS` updated: Browse.ai and Clay removed from Compare section (only "Compare Tools" → `/vs/compare.html` remains). "Submit Bug" removed from Contact section. "About DatIQ" moved to the last section ("Company") at the bottom of the dropdown. All external links open in the same window (`target="_blank"` removed).
106. **R13: Comparison pages — Apify + PhantomBuster** — Created `public/vs/apify.html` (DatIQ vs Apify) and `public/vs/phantombuster.html` (DatIQ vs PhantomBuster). Both are full comparison pages with feature tables, verdict cards, and cross-links to all 4 comparison pages. `public/vs/compare.html` updated: hero quick-links section at top lists all 4 pages; bottom "Detailed comparisons" section updated to list all 4.
107. **R13: Help file cleanup** — `public/help/index.html`: removed "(External)" labels from User Guide and Developer Reference sections; removed entire "Internal Reference" sidebar section (I1–I5 links) since those are internal developer docs not relevant to end users. `public/help/09-exports-and-sharing.html`: complete rewrite — fixed brand name, all 5 export formats (CSV/PDF/Markdown/JSON/Email) with plan requirements and descriptions, "Where to export from" section, "Email export" step-by-step, "Tips" section; removed all code/DB/architecture references.
108. **R14a: Firecrawl fallback chain** — `netlify/functions/extract.js` rewritten to use `runScrapeChain` / `runMapChain` from new `netlify/functions/lib/scrapeProviders.js`. Default chain: Firecrawl → Spider.cloud → Jina AI → Direct fetch. Each adapter normalizes to `{ data: { html, metadata: { title }, json } }` shape — `firecrawlService.js` needs no changes. Jina converts markdown to basic HTML (heading + link tags) so browser `parseHtml()` works. Direct fetch is always available (no key). Chain order overrideable via `SCRAPE_PROVIDER_ORDER` env var. `config.js` `hasFirecrawl` is now true when any provider key is set or `VITE_ENABLE_EXTRACT=true`.
109. **R14b: Home intent chips** — 5 intent chips (AI summary / Find contacts / Scrape pricing / Map site / Custom) replace 4 Toggle components. `INTENTS` array + `CARD_TO_INTENT` map; `handleCardClick` scrolls to and selects the matching chip when a feature card is clicked. Active chip applies `var(--chip-accent)` border.
110. **R14b: Smart multi-URL input** — Progressive disclosure: "Need multiple URLs?" reveal below URL field expands a `<textarea>`. For 2–10 URLs, `handleBatchExtract()` runs inline (maps to `/batch` with pre-populated state); for >10, navigates to `/batch` with `{ state: { urls, intent } }`. FAB button (layers-2 icon) opens `BulkUploadModal` (paste list + CSV upload). `parseUrlsFromText()` deduplicates and normalizes bare domains. `MULTI_INLINE_MAX = 10`.
111. **R14b: OG preview card** — 800ms debounce on `url`/`valid` state; calls `/api/og-preview?url=...` (new `netlify/functions/og-preview.js`); fetches first 15KB of target page, parses og:title/og:description/`<title>`/meta-description, returns `{ url, hostname, favicon, title, description }`; favicon from `https://www.google.com/s2/favicons?domain=X&sz=32`. Preview card hidden when loading or no data.
112. **R14b: Batch intent chips + history** — `/batch` page uses same `BATCH_INTENTS` chip pattern (4 chips: summary/contacts/pricing/custom). After each batch run: `uid()` generates `batchRunId`, `recordBatchItems(batchRunId, savedIds)` writes `datiq.batchMap`, `saveBatchRun({id, label, intent, createdAt, totalUrls, successCount, failedCount})` writes `datiq.batchRuns` (max 50). "View in Dashboard →" CTA appears after completion.
113. **R14b: Dashboard batch history filter** — `BatchRunsDropdown` component in `dash-header-actions`: shows run count badge, dropdown lists past runs (label + meta + delete ×), click-to-filter sets `batchFilter` state. `filtered` memo gates on `batchMap.current[it.id] === batchFilter`. Active filter shown as dismissable `batch-filter-banner`. Table rows and `DashCard` get `batch-item-tag` chip when `isBatchItem(id)` is true. localStorage keys: `datiq.batchRuns` + `datiq.batchMap`.
114. **R15: Home FAB navigates to /batch** — Bottom "Need multiple URLs?" section removed from Home entirely. FAB button (layers-2 icon) beside the Extract button now shows icon + "Bulk import" label and navigates directly to `/batch` instead of opening `BulkUploadModal`. `BulkUploadModal` import and `bulkOpen` state removed from `Home.jsx`. `handleBulkUrls` removed.
115. **R15: Batch textarea localStorage draft** — `Batch.jsx` `pasteText` state initialized from: (1) `location.state.urls` (nav from Home FAB), (2) `localStorage.getItem("datiq.batchDraft")` fallback, (3) empty string. `useEffect` persists every `pasteText` change to `datiq.batchDraft`. "New batch" button clears the draft (`localStorage.removeItem`). Textarea content now survives page refresh and back-navigation.
116. **R15: Batch Export ▾ unified dropdown** — Replaced 4 individual CSV/PDF/MD/JSON export buttons in `/batch` results with single `ExportDropdown` component (same pattern as Dashboard). Results actions bar: `[Export ▾] [New batch] [View in Dashboard →]`.
117. **R15: Dashboard BatchRunsDropdown alignment** — `.batch-runs-menu` changed from `right: 0` to `left: 0`. The 300px dropdown was overflowing left off-screen because the button is on the far left of the toolbar. Now opens rightward from the button's left edge, within the page layout.
118. **R17: Hard block not shown on page reload** — If count ≥ hardLimit and user refreshes, `GuestTrialProvider` mounted with `showHardBlock=false` (default). Fixed: mount `useEffect` with `[]` deps reads localStorage counts + `getSettings()` synchronously; calls `setShowHardBlock(true)` if either limit already reached. Ensures hard block appears immediately on page load without requiring an extraction attempt.
119. **R17: Missing `setShowHardBlock(false)` in logout soft-prompt path** — Logout if/else chain set `showHardBlock(true)` for hard cases but never explicitly set it `false` for the soft-prompt or clean-slate branches. If `showHardBlock` was previously `true`, it could persist into the wrong gate. Fixed: explicit `setShowHardBlock(false)` added in both the soft-prompt branch and the else (clean-slate) branch.
120. **R17: Hard block overlay transparent** — Hard block removes the backdrop `<div>`, so `.guest-trial-overlay` had no background. Clicks could reach page elements behind. Fixed: `.guest-trial-overlay.gtm-hard { background: rgba(0,0,0,.60); }` — overlay provides its own dark background. Also added `.gtm-icon-warn` CSS class for warning-coloured icon variant.

### Razorpay live payment — required Netlify env vars (INR only; Stripe/USD on hold)

| Variable | Prefix | Value | Purpose |
|---|---|---|---|
| `VITE_RAZORPAY_KEY_ID` | `VITE_` (browser, **build-time**) | `rzp_test_...` or `rzp_live_...` | Unlocks real payment flow (`hasPayment=true`); opens Razorpay modal |
| `RAZORPAY_KEY_ID` | none (server, runtime) | same value as above | Netlify Function creates Razorpay order |
| `RAZORPAY_KEY_SECRET` | none (server, runtime) | your key secret | Order creation + HMAC signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | none (server, optional) | webhook secret | Verifies incoming Razorpay webhook events |

**NOT needed:** `VITE_RAZORPAY_PLAN_*` — current code uses Razorpay Orders (one-time), not Subscriptions.
**CRITICAL:** After setting `VITE_RAZORPAY_KEY_ID`, trigger a **full rebuild** in Netlify (Deploys → Trigger deploy) — it is baked into the JS bundle at build time.

---

## Multi-provider AI (enrichment) — fallback chain + admin config

> The enrichment AI (summaries, link categorization, content generation) is now
> provider-agnostic. **Scraping uses its own separate fallback chain** (Firecrawl → Spider → Jina → Direct)
> via `scrapeProviders.js` — this section only covers the enrichment/AI layer.
> Frontend is unchanged: `aiService.js` → `apiClient.ai` → `/api/ai`; every adapter
> normalizes its reply to the Anthropic `content[].text` shape so the browser never
> knows which provider answered.

| Piece | Detail |
|---|---|
| Default chain | **Gemini → Anthropic Claude → OpenAI** (cost-first). Override via `AI_PROVIDER_ORDER` env or `/admin/ai`. |
| Adapters | `netlify/functions/lib/aiProviders.js` — `callGemini` / `callAnthropic` / `callOpenAI`; `runChain()` tries each **enabled** provider **with a key**, returns first success; else 502 → `aiService.js` mock fallback. |
| Proxy | `netlify/functions/ai.js` — rewritten; **ignores client `model`** (per-provider model from config), honors client `max_tokens`. 503 when no provider key is set. |
| Config source | `loadAiConfig()` merges Supabase `app_config` row `key='ai'` over env/static defaults (60s cache) — same pattern as `pricingSource.loadPricing()`. Operator config PREVAILS; static is fallback. |
| Admin screen | `/admin/ai` (`AdminAI.jsx`) — reorder providers, edit model id per provider, enable toggles, default max tokens. Shows per-provider key presence (no secrets) + a not-persisted warning when Supabase is unconfigured. |
| Write path | `netlify/functions/admin-ai-config.js` — GET (public-ish: config + key presence, no keys); POST gated by `verifyAdminToken()` (`lib/adminToken.js`, HMAC of the `admin-auth` session token), upserts `app_config`. |
| Keys | `GEMINI_API_KEY` / `AI_API_KEY` / `OPENAI_API_KEY` — **server env only, never VITE_**. Stored config holds only non-secret model ids/order. |
| DB | Run `scripts/ai-config.sql` (creates `public.app_config`, RLS-locked to service key). Empty table → built-in defaults. |
| Rule | Never re-introduce a single hardcoded provider in `ai.js`. Add new providers in `aiProviders.js` `ADAPTERS` + `PROVIDER_META` + `DEFAULT_MODELS`. |

## Outstanding tasks

### R17 — On branch `claude/enrich-batch-mall-3tkc1s` (2026-06-17, NOT yet merged to main)

**Files added/changed:**
- `src/lib/globalSettingsService.js` (NEW) — 5-min TTL cache for admin-controlled guest limits
- `netlify/functions/admin-general-config.js` (NEW) — GET/POST for `app_config key='general'`; token-gated POST; sanitizes 4 integer fields
- `src/lib/guestTrialService.js` — added `batchCount`, `getGuestBatchCount`, `incrementGuestBatchCount`, `isSingleHardLimitReached`, `isBatchHardLimitReached`, `SINGLE_HARD_LIMIT`, `BATCH_HARD_LIMIT` exports
- `src/components/GuestTrialProvider.jsx` — SENSITIVE_KEYS logout cleanup + navigate("/"); hard limit state; mount useEffect for page-reload restore; dynamic settings from globalSettingsService
- `src/components/GuestTrialModal.jsx` — hard block mode (non-dismissible, own background, warning icon)
- `src/components/GuestTrialBanner.jsx` — shows both single + batch remaining counts
- `src/components/ExtractionProvider.jsx` — pre-flight `checkCanExtractSingle()` before extraction
- `src/pages/Batch.jsx` — pre-flight `checkCanExtractBatch()` before run; `trackGuestBatchRun` instead of `trackGuestExtraction`
- `src/lib/adminConfigService.js` — added `getGeneralConfig`, `saveGeneralConfig` exports
- `src/pages/admin/AdminGeneral.jsx` (NEW) — 4 configurable fields; load/save/reset; Supabase-not-configured warning
- `src/pages/admin/AdminLayout.jsx` — added `/admin/general` to NAV
- `src/App.jsx` — added `AdminGeneral` import + route
- `src/styles/screens.css` — admin-general-* CSS classes; `.guest-trial-overlay.gtm-hard` background; `.gtm-icon-warn`

**Status:** E2E tested ✅ — merged to main ✅ — pushed to origin ✅ — Netlify auto-deploy triggered ✅

- [x] ~~Merge R17 to main~~ — done (`a4bca63`)
- [ ] Supabase `app_config` table needs the `general` key row — auto-created on first POST save via AdminGeneral page (upsert)

---

### R14 — Merged to main (2026-06-15)

#### Firecrawl fallback chain (`claude/firecrawl-fallback-analysis-qyksr4` — merged)
- [x] ~~Merge to main~~ — done
- [ ] **Optional Netlify env vars** to activate fallback providers (no redeploy needed for server-only vars):
  - `SPIDER_API_KEY` — Spider.cloud API key (scrape + crawl/map)
  - `JINA_API_KEY` — Jina AI Reader API key (higher rate limits; works without key too)
  - `SCRAPE_PROVIDER_ORDER` — optional override, e.g. `spider,jina,direct` (default: firecrawl,spider,jina,direct)
  - `VITE_ENABLE_EXTRACT=true` — **build-time** flag; set in Netlify env + trigger redeploy to enable real extraction in browser without a Firecrawl key (e.g. when only using Jina/Direct)
  - `VITE_SPIDER_API_KEY` — **build-time** flag (tells browser real extraction is available); same value as `SPIDER_API_KEY`
  - `VITE_JINA_API_KEY` — **build-time** flag; same value as `JINA_API_KEY`

**Files changed:**
- `netlify/functions/lib/scrapeProviders.js` (NEW) — 4-provider chain: Firecrawl → Spider.cloud → Jina AI → Direct fetch
- `netlify/functions/extract.js` — rewritten to use `runScrapeChain` / `runMapChain`; response shape unchanged (backward-compatible with `firecrawlService.js`)
- `src/lib/config.js` — `hasFirecrawl` now true when any provider key is set or `VITE_ENABLE_EXTRACT=true`

**Architecture rules added:**
- Never add a second hardcoded scrape provider to `extract.js` — add it to `scrapeProviders.js` `SCRAPE_PROVIDERS` registry instead
- Chain order is runtime-configurable via `SCRAPE_PROVIDER_ORDER` env var — no code change needed to reorder or disable providers
- `_providerAttempts` field in all extract responses shows which providers were tried and why each failed (diagnostic; not displayed in UI)
- Jina AI and Direct fetch require no paid API key — extraction always works in production even without Firecrawl/Spider keys

#### Home UX + batch history (`home-screen-enhancement` — merged)
- [x] ~~Merge to main~~ — done
- [x] ~~New Netlify Function `og-preview.js`~~ — merged (`netlify/functions/og-preview.js`; GET `/api/og-preview?url=`; no env vars needed)

**Files changed (R14b + R15):**
- `netlify/functions/og-preview.js` (NEW) — server-side OG metadata fetcher (avoids CORS), reads first 15KB only, 5-min CDN cache
- `src/pages/Home.jsx` — 5 intent chips replace 4 toggles; 800ms OG preview card; clickable feature cards; FAB "Bulk import" navigates to /batch (no inline textarea, no BulkUploadModal on Home)
- `src/pages/Batch.jsx` — intent chips; batch run history via `batchRunsService.js`; textarea draft persisted to `datiq.batchDraft`; unified Export ▾ dropdown replacing 4 buttons
- `src/pages/Dashboard.jsx` — `BatchRunsDropdown` filter (left-aligned dropdown), `batch-item-tag` chips, `batchFilter` state
- `src/components/BulkUploadModal.jsx` (NEW, exists in codebase but NOT used on Home) — paste URLs + CSV upload modal
- `src/lib/batchRunsService.js` (NEW) — localStorage batch run history (`datiq.batchRuns` + `datiq.batchMap`)
- `src/styles/screens.css` — new CSS for all new components; `.batch-runs-menu` left-aligned; `.home-input-fab` with label styling

---

### Supabase (manual — Supabase dashboard)
- [ ] Run SQL migration above in SQL Editor
- [ ] Run `scripts/ai-config.sql` (creates `app_config` for the AI provider chain)
- [ ] Add at least one AI provider key to Netlify env: `GEMINI_API_KEY` (primary), `AI_API_KEY` (Claude), and/or `OPENAI_API_KEY` — no VITE_ prefix; redeploy
- [ ] Enable Google / Microsoft (Azure) / GitHub OAuth providers
- [ ] Set Site URL → `https://datiq.app`; add redirect URLs including `https://datiq.app/**`
- [ ] Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` to Netlify env for stats.js

### Netlify (manual — Netlify dashboard)
- [ ] **Set a strong admin PIN**: add `ADMIN_PIN_HASH` (server, no VITE_ prefix) = `printf '%s' 'your-strong-pin' | shasum -a 256` → redeploy. Until set, `/admin` accepts the demo PIN `ADMIN123`.
- [ ] (optional) Add `ADMIN_TOKEN_SECRET` (server) — random string to sign admin session tokens; defaults to the PIN hash if unset.
- [ ] Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (server) — also enables operator `pricing_config` overrides for live charges (else server uses static price table).
- [ ] Add `VITE_RAZORPAY_KEY_ID` (browser/build-time) — from Razorpay Dashboard → Settings → API Keys
- [ ] Add `RAZORPAY_KEY_ID` (server, no VITE_ prefix) — same value as above
- [ ] Add `RAZORPAY_KEY_SECRET` (server, no VITE_ prefix) — from same Razorpay API Keys page
- [ ] **Trigger a full redeploy** after adding the above — `VITE_RAZORPAY_KEY_ID` is baked at build time
- [ ] Register Razorpay webhook → `https://scrapelite.netlify.app/.netlify/functions/payment-webhook?provider=razorpay` → copy secret → add as `RAZORPAY_WEBHOOK_SECRET` → redeploy
- [ ] **Enable auto-capture** in Razorpay Dashboard → Settings → Payment Capture (belt-and-suspenders; `verify-payment.js` also explicitly captures any `authorized` payment so uncaptured payments are never auto-refunded)
- [ ] Register Stripe webhook (when USD/Stripe is enabled) → same base URL without `?provider` → `STRIPE_WEBHOOK_SECRET`
- [ ] Add remaining env vars when ready (see env section above)

### Razorpay hardening (Razorpay-Integration-Enhancement branch)
> Per Razorpay Standard Checkout guide. One-time Orders model (no Subscriptions). Razorpay/INR only.
- **Server shared source of truth** (`netlify/functions/lib/pricingSource.js`): prices, coupons, and the global discount all resolve through `loadPricing()`. Resolution order — **operator overrides PREVAIL, static is the fallback**: (1) static tables in `pricingSource.js` (mirror `pricingConfig.js` + `adminService.js` seeds); (2) operator overrides in the Supabase `pricing_config` table (rows keyed `plans` / `bundles` / `coupons` / `global`, each a jsonb value). Merge is per-field. Result cached 60s per warm container. If Supabase is unconfigured/unreachable → static tables (so "static as start" always holds). **No public write endpoint** (operator-managed by design — these values drive real charges); `pricing_config` is RLS-locked to the service key. `verify-payment.js` does NOT recompute (compares against the Razorpay order), so `create-checkout.js` is the only consumer.
- **Server-authoritative amounts**: `create-checkout.js` recomputes base + 18% GST (INR) from `loadPricing()` and IGNORES any client `amount` — prevents amount tampering. Admin price edits (incl. new INR + annual fields) now reach live charges via `pricing_config`.
- **Server-authoritative discounts** (closes the prior coupon leak): the client sends a `couponCode` (not a `discountPercent`). `create-checkout.js` resolves the discount via `resolveDiscountFraction(pricing, couponCode, planId)` = **max(coupon, global sale)** — the two never stack, and the result is always ≤ the UI's displayed (global-only) price, so a customer is never charged MORE than shown. Coupon checks: active/expiry/plan-match; unknown/expired/mismatched → 0. A tampered client can't dictate its own discount. Threaded through `paymentService.js` (Stripe + Razorpay) and `BillingProvider.jsx` (sends `subscription.coupon?.code`); `subscription.discountPercent` survives only as a client-side display hint.
- **Admin pricing UI** (`AdminPricing.jsx`): plan editor now has USD-monthly, USD-annual, INR-monthly, INR-annual fields (+ bundle INR); `pricingOverrides.js` merges all of them. A **"Generate SQL"** panel emits the exact `insert … on conflict … do update` for `pricing_config` so the operator applies admin edits to live charges with one paste (the operator-managed write path — no insecure endpoint).
- **Coupon `maxUses` + one-per-user are server-enforced** (atomic): `create-checkout.js` calls `reserveCoupon()` → Supabase `redeem_coupon` RPC, which claims a per-user slot (unique `coupon_code,session_id`) and increments a row-locked `coupon_counters` cap. `ok` applies the coupon; `already_redeemed`/`cap_reached` drops it (global sale still applies, never an over-discount); `null` (no Supabase / RPC error) falls back to applying the coupon unenforced so payments never hard-fail. Reservation happens at order-creation, so the discount + redemption are atomic. **Trade-off:** an abandoned discounted checkout consumes a slot — cleanup of stale unpaid reservations (e.g. set `order_ref`, reconcile against captured payments / TTL-expire) is a follow-up.
- Caveats (documented): display modals (`PaymentConfirmModal`/`pricingMath.computeCharge`) don't subtract the discount (server charges ≤ displayed); the `pricing_config`/`coupons` config is operator-edited (admin UI edits localStorage for display + emits SQL — they don't auto-propagate to the server).
- **Capture + status verification**: after the mandatory HMAC signature check (§1.5), `verify-payment.js` fetches the payment + order, confirms `order_id` + amount/currency match, captures if `authorized`, and only returns `verified:true` on `captured` (§1.6/§3.2).
- **Persistence (§1.4)**: `razorpay_payment_id` → `payment_events.provider_event_id`; `razorpay_order_id` → `subscriptions.provider_subscription_id` (synchronous path + webhook). Signature is verified then discarded (not persisted — acceptable).
- **Webhook idempotency**: `payment_events` deduped on `provider_event_id`.
- **Shared GST math**: `src/lib/pricingMath.js` (`computeCharge`) used by `PaymentConfirmModal` for display; server mirrors the same one-step rounding (no drift).
- `PaymentSuccess.jsx` Razorpay branch is display-only — never grants a plan (verification/activation happen in the modal handler).

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
- [ ] Add `NETLIFY_AUTH_TOKEN` to session env for programmatic deploys from Claude (branch deploys auto-trigger via GitHub integration when not set)
- [ ] Implement once-only 25-extraction trial credit at signup (`trialCredit: 25` is in plan config; grant not yet wired in usageService/AuthProvider)
- [ ] Referral/affiliate program — teaser UI is live on /pricing; backend not implemented
- [ ] Supabase real auth → replace localStorage persona/session for cross-device sync
- [ ] Switch webhook to production n8n URL
- [ ] Add "Use cases" links to Footer Explore column
- [ ] AdminPricing.jsx: add UI fields for `price_usd_annual` and `price_inr_annual` (currently only monthly prices editable in admin)
- [ ] `/blog/:slug` routing for SEO-indexed posts (currently all content is in-page modal only)
- [ ] `PaymentConfirmModal` — wire actual `initiatePayment` call through the confirm step in `BillingProvider` (currently confirm/cancel flow uses local state; payment initiation still triggered by the parent CTA click)
- [x] ~~Batch/multi-URL mode (10–500 URLs)~~ — DONE (R5: /batch page, batchService.js, plan limits, Batch Pack bundle)
- [x] ~~CSV-import enrichment~~ — DONE (R5: Batch page "Import CSV" tab, parseUrlsFromCsv in batchService.js)
- [x] ~~Markdown export~~ — DONE (R5: markdownDownload(), extractionsToMarkdown() in utils.js; Select+ plan)
- [x] ~~JSON export~~ — DONE (R5: jsonDownload(), extractionsToJson() in utils.js; Pro+ plan)
- [x] ~~Batch mode integrated on Home Extract screen~~ — DONE (R6: batch toggle, multi-URL textarea, inline progress+results, CSV/PDF/MD/JSON export)
- [x] ~~Remove demo data from Dashboard~~ — DONE (R6: showingDemo always false; proper empty state with "Extract a page" CTA)
- [x] ~~Feature card Popular/Recommended tags not visible~~ — DONE (R6: restructured .feature-cell with .feature-body + .feature-title-row)
- [x] ~~`/batch` page: save successful batch results to Dashboard~~ — DONE (R6c: Promise.allSettled saveExtraction after runBatch)
- [x] ~~Home batch mode: save batch results to Dashboard on completion~~ — DONE (R6c: same pattern in handleBatchExtract)
- [x] ~~AdminPricing.jsx: add UI field for `batch_max_urls` per plan~~ — DONE (R7: numeric input step=50, saved to limits.batch_max_urls)
- [x] ~~Batch Pack top-up: wire purchase flow through payment~~ — DONE (R7: purchaseBatchPack() in BillingProvider; Pricing.jsx handleBundleBuy wired; demo_mode grants bonusBatchUrls locally)
- [x] ~~Set `AI_MODEL=claude-3-5-haiku-20241022` in Netlify env vars~~ — DONE in code (R7: DEFAULT_MODEL in ai.js is now the stable model; still set env var in Netlify dashboard for explicit override)

---

## How to continue developing

```bash
cd /home/user/scrapelite
git checkout main
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
- `/admin` → PIN (server-verified; `ADMIN123` in demo/dev) → Revenue / Pricing / Coupons / Users
- `/admin` → 5 wrong PINs → "Locked for 60s" countdown disables the form; auto-unlocks after 60s
- `/admin` → with `ADMIN_PIN_HASH` set in Netlify, `ADMIN123` is rejected (only the configured PIN works)
- Admin sidebar → chevron button collapses sidebar to 64px icon-only strip; chevron expands it back
- Admin sidebar → pin button (pin/pin-off icon) locks state; when unpinned+collapsed, hovering sidebar temporarily expands it
- Admin sidebar → state persists across page reloads (localStorage)
- `/account` → enter coupon `LAUNCH20` → Apply; then × to remove
- TopBar → Sign in → create account → persona step appears → select persona → lands on `/`
- TopBar brand → shows `layers` icon + "DatIQ" + "Intelligence from every URL" tagline
- TopBar nav (desktop >820px) → Extract, Batch, Dashboard all show text+icon; Explore dropdown shows
- TopBar Explore dropdown → 6 sections: Company (About DatIQ), Pricing (Plans & Pricing + Integrations), Use Cases (4), Compare (2), Resources (Blog + Help Center), Contact (Contact Us + Submit Bug)
- TopBar Explore → Contact section (bottom) → "Contact Us" navigates to /contact; "Submit Bug" navigates to /contact?type=bug
- `/contact?type=bug` → Contact page opens with "Bug report" type pre-selected and subject pre-filled "Bug report: "
- `/admin/users` → Plan pill displays correct plan name using effective plan overrides
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
- Home → URL input + Extract button + FAB "Bulk import" button; NO inline multi-URL toggle or textarea
- Home → no "Try lumio.io / stripe.com..." chips below URL input; only validation error shown
- TopBar nav order: Extract → Batch → Dashboard (Batch is before Dashboard)
- Home → extract URL → auto-saves to DB → /preview shows "View Dashboard" (primary) + "Download ▾" + "Delete"
- `/preview` → "Download ▾" dropdown in action bar → shows CSV / PDF / Markdown / JSON options
- `/preview` → "Generate content" button in Quick Enrichment card header → opens ContentModal with 3 format options
- `/preview` → "View Dashboard" navigates to /dashboard; "Delete" removes extraction and goes home
- `/batch` → paste 2+ URLs → Run → progress → results table with "View" button per row
- `/batch` → click "View" on a result → navigates to /preview showing that extraction
- `/batch` → batch complete → toast "N pages saved to Dashboard" fires automatically (items saved with _status stripped)
- `/dashboard` → loads instantly from localStorage cache (no spinner if local data exists); API sync happens in background
- `/dashboard` → "Refresh" ghost button in header → re-fetches from DB, shows "Refreshed" toast
- `/dashboard` → export buttons: single "Export ▾" dropdown shows CSV / PDF / MD / JSON; dropdown appears above table (z-index fix)
- `/dashboard` → check any row → toolbar shows: count + Generate + Email + Clear inline; floating bar also appears at bottom
- `/dashboard` → toolbar "Generate" (inline) → ContentModal with SEO Blog Outline / Competitor Summary / Social Posts
- `/dashboard` → toolbar "Email" (inline) → EmailModal (no "Failed to fetch" error; falls back to mailto if webhook down)
- `/dashboard` → floating bar "Export ▾" → dropdown with CSV/PDF/MD/JSON options
- `/dashboard` → empty state shows bookmark icon + "Nothing saved yet" + "Extract a page" CTA (no demo data)
- `/dashboard` → after extraction: saved pages appear in table/card view
- `/dashboard` → PDF export → if app was updated since page loaded, toast "App updated — refresh and try again"
- Home feature cards → Popular tag visible next to title (inline, not pushed off); Recommended tag visible when persona matched
- `/admin/pricing` → open any plan card → "Batch URL limit" field visible; enter 100 → Save → value persists across refresh
- `/pricing` → Top-up bundles section → "Add to plan" on Batch Pack → opens TopupBundleModal (not direct purchase)
- TopupBundleModal → qty 1 shows unit price; qty 2+ shows total + per-bundle note; CTA "Add N bundle(s) — ₹/$ X"
- TopupBundleModal → "−" button disabled when qty=1; "+" button disabled when qty=10
- TopupBundleModal → upsell section shows plans with higher price_usd than current plan
- TopupBundleModal → click upsell plan → modal closes → payment flow starts for that plan
- TopupBundleModal → backdrop click (outside card) → modal closes
- TopupBundleModal → in demo mode: modal closes, navigates to /account, bonusBatchUrls += 50 × qty
- `/pricing` → click "Get Pro" (no payment keys): DemoPaymentModal appears with plan name, price, greyed-out card fields, "Demo mode" badge
- DemoPaymentModal → "Confirm — activate Pro (Demo)": plan upgrades, navigates to /account
- DemoPaymentModal → "Cancel, keep current plan" or backdrop click: modal closes, plan unchanged
- `/pricing` → plan cards: hovering non-current plans shows lift+border+tint effect
- `/pricing` → current plan card: green ring border + "Your plan" badge pill at top
- `/pricing` → click "Get Pro" (or any paid plan): button shows "Processing…" + card pulses with accent ring during payment
- `/pricing` → cancel Razorpay/Stripe payment: plan stays at previous value (NOT upgraded)
- `/pricing` → new user with no plan: only Free plan has "Current plan" badge; all paid plans show "Get X"
- `/account` → after buying Batch Pack: bonusBatchUrls shows on subscription state
- `/account` quick stats → "Batch executions" row visible; "Content generations" row visible (both default 0)
- `/batch` → run batch → completion increments "Batch executions" counter in account stats
- `/preview` or `/dashboard` → Generate content → completion increments "Content generations" counter
- TopBar Explore dropdown → Compare section has only "Compare Tools" (no Browse.ai / Clay separate links)
- TopBar Explore dropdown → Contact section has only "Contact Us" (no "Submit Bug")
- TopBar Explore dropdown → last section is "Company" containing "About DatIQ"
- `/vs/compare.html` → hero quick-links shows all 4 comparison pages at top
- `/vs/compare.html` → bottom section lists all 4 detailed pages (Browse.ai, Clay, Apify, PhantomBuster)
- `/vs/apify.html` → loads DatIQ vs Apify comparison page with feature table
- `/vs/phantombuster.html` → loads DatIQ vs PhantomBuster comparison page
- `/pricing` → all 7 plan cards visible: Free, Select, Pro, Business, Agency, Developer (coming soon), Enterprise
- `/pricing` → Enterprise card has dashed border and "Contact sales" CTA
- `/pricing` → TopupBundleModal upsell plans show INR prices (₹999/mo, ₹1,499/mo) when INR currency selected
- `/batch` results → table uses full container width (not capped at 860px)
- Usage upsell banner (when ≥80% used) → content aligns to 1080px page width, not full browser width
- `/help/index.html` → User Guide section has no "(External)" label
- `/help/index.html` → no "Internal Reference" sidebar section
- `/help/09-exports-and-sharing.html` → lists all 5 formats: CSV, PDF, Markdown, JSON, Email
- Home → 5 intent chips row visible below URL input: AI summary / Find contacts / Scrape pricing / Map site / Custom
- Home → clicking an intent chip selects it (active border); switching away from Custom clears custom prompt
- Home → clicking a feature card scrolls to and selects the matching intent chip
- Home → FAB button ("Bulk import" label + layers-2 icon) beside Extract button → navigates to /batch page
- Home → NO inline multi-URL textarea on Home; no BulkUploadModal on Home; multi-URL entry is handled entirely on /batch
- Home → single URL with valid domain → after 800ms, OG preview card appears below URL input with favicon + title + description
- Home → OG preview card disappears when URL is cleared or invalid
- `/batch` → intent chips visible (AI summary / Find contacts / Scrape pricing / Custom ← no Map Site)
- `/batch` → paste URLs → navigate away → navigate back → textarea retains the URLs (localStorage draft)
- `/batch` → "New batch" button clears the textarea and the localStorage draft
- `/batch` results → single "Export ▾" dropdown (CSV / PDF / Markdown / JSON) — not 4 separate buttons
- `/batch` → run batch → "View in Dashboard →" button appears after results
- `/dashboard` → batch run dropdown button visible in header (shows count badge when runs exist)
- `/dashboard` → click batch runs dropdown → menu opens LEFT-aligned (not overflowing off left side of screen)
- `/dashboard` → click dropdown → shows past batch runs with label + date + URL count; click to filter; × to delete
- `/dashboard` → filtered state shows `batch-filter-banner` with run label + "Clear filter" button
- `/dashboard` → items from a batch run show "Batch" tag chip in table row and card view
- Extraction on any provider fallback → `_providerAttempts` present in response (visible in network tab)
- Home → extract as guest → after 3 extractions, GuestTrialModal soft prompt appears with "Sign up free" CTA
- Home → soft prompt → "Continue as guest" dismisses it; attempting 2 more extractions re-shows it
- Home → extract as guest → after 10 extractions, hard block modal appears — no dismiss button, no backdrop click, no Escape
- Home → hard block → only "Sign up free" or "Sign in" buttons work; page behind not clickable
- `/batch` → run batch as guest → after 5 batch runs, hard block modal appears (reason: "batch")
- GuestTrialBanner → shows between TopBar and page content for guest users
- GuestTrialBanner → correctly shows remaining single-URL credits AND batch credits
- GuestTrialBanner → disappears when user is logged in
- Guest extraction → sign in → GuestTrialBanner disappears; soft/hard prompt clears
- Sign out (previously had extractions) → localStorage cleared (dashboard shows nothing); navigates to "/"
- Sign out → re-open app on same machine → guest trial count is preserved (not cleared); banner shows remaining credits
- `/admin/general` → accessible after admin PIN; shows 4 configurable fields with current values
- `/admin/general` → change soft limit to 5, save → toast "General settings saved" → limit takes effect within 5 min
- `/admin/general` → "Reset to defaults" → fields reset to 3 / 2 / 10 / 5
- `/admin/general` → "Reload" button → re-fetches from server and updates form
- `/admin/general` → without Supabase configured: shows warning banner; fields still load with defaults; changes are not persisted server-side

---

## Git log (recent)

```
a4bca63  Merge branch 'claude/enrich-batch-mall-3tkc1s' — R17: logout cleanup + guest hard limits + admin general settings
3af49a5  chore: update CLAUDE.md — R16/R17 session state, all sections updated
09fbdda  feat(R17): logout data cleanup + guest hard limits + admin general settings
52c6631  Merge branch 'claude/enrich-batch-mall-3tkc1s' — R16: batch mode parity + guest trial gate
663bda6  Update founder description for clarity
9b5a7f8  fix(guest-trial): preserve count across sign-in/out cycles
208dabb  feat: batch mode parity + guest trial gate
aa7e6bd  chore: E2E test suite 89/89 passing; update help docs + internal test report
35fbf4f  chore: update CLAUDE.md — R15 session state, fix stale docs for FAB/multi-URL/batch changes
40ded1d  fix(dashboard): batch runs dropdown left-aligns to button instead of overflowing off-screen
d3e21ab  feat(home+batch): streamline multi-URL flow — FAB navigates to /batch, draft persists
f686d77  fix(home): replace inline multi-URL textarea with BulkUploadModal dialog
```
