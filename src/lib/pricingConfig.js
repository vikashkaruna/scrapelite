// pricingConfig.js — V6 revised plan definitions, USD + INR only.

// India-first: USD for all other regions, INR for Indian users.
export const CURRENCIES = ["USD", "INR"];

// INR prices are BASE prices (pre-GST). 18% GST is added at checkout time.
// price_inr_annual = promotional annual INR per month (base, pre-GST) — fixed rate

export const CURRENCY_META = {
  USD: { symbol: "$",  label: "US Dollar",   flag: "🇺🇸" },
  INR: { symbol: "₹", label: "Indian Rupee", flag: "🇮🇳" },
};

// price_usd         = monthly USD price
// price_usd_annual  = annual plan price per month (USD, ~17% off the monthly price)
// price_inr         = monthly INR price (base, pre-GST — 18% GST added at checkout)
// price_inr_annual  = promotional annual price per month (INR, base, pre-GST) — fixed rate
// trialCredit       = RETIRED (D-credits). It was a once-only 25-extraction
//                     credit the BROWSER granted itself on signup, into
//                     localStorage. The server now grants FREE_GRANT credits
//                     once per account under grant_period 'signup'
//                     (creditMeter.ensureAllowance), so keeping the client one
//                     meant an account was told it had 125 while the ledger —
//                     the thing that actually refuses a run — held 100. That is
//                     the exact defect the referral loop already had once: a
//                     banner promising a bonus on the same screen that refuses
//                     to spend it. The field is gone; nothing reads it.
//
// ── credits: THE ONE AXIS EVERYTHING IS SOLD ON ────────────────────────────
// 1 credit = one page fetch; every other weight is a multiple of it. The table
// lives in src/lib/credits/creditWeights.js and is shared with the server, so
// the number quoted and the number billed cannot diverge.
//
// 🔴 `extractions` and `audits` ARE NO LONGER ENFORCED. They are kept because
// three public surfaces still print them (the plan cards, the comparison
// matrix and llms-full.txt) and because removing a limit key silently changes
// what getEffectivePlanById returns for an operator override written against
// the old shape. The gate is `credits`; these are descriptive.
//
// ⚠️ Free's pool is a LIFETIME grant (D3), not a monthly one — it does not
// reset, and 19 of its 100 are reserved for the first Discoverability run so
// the action that demonstrates the product cannot be spent away on
// extractions first.
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price_usd: 0,
    price_usd_annual: 0,
    price_inr: 0,
    price_inr_annual: 0,
    period: "month",
    tagline: "Try DatIQ risk-free",
    badge: null,
    highlight: false,
    limits: {
      credits: 100,
      extractions: 10,
      audits: 3,
      enrichments_per_extraction: Infinity,
      exports: ["csv"],
      email_export: false,
      scheduled_monitoring: 0,
      team_seats: 1,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      workspaces: 1,
      batch_max_urls: 5,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: false,
      integrations: false,
      browser_extension: false,
    },
    features: [
      { label: "100 credits to start — never expires, no card needed", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (5 accounts)", included: true },
      { label: "Competitor watchlists",          included: false },
      { label: "Signal routing to Slack / email / webhook / CRM", included: false },
      { label: "Fork & edit workflow templates", included: false },
      { label: "Full AI features",              included: true },
      { label: "CSV export",                    included: true },
      { label: "25-extraction trial credit",    included: true },
      { label: "Batch mode (up to 5 URLs)",     included: true },
      { label: "PDF export",                    included: false },
      { label: "Markdown / JSON export",        included: false },
      { label: "Email export",                  included: false },
      { label: "Scheduled monitoring",          included: false },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: false },
      { label: "Browser extension",             included: false },
      { label: "API access",                    included: false },
      { label: "White-label PDF",               included: false },
    ],
  },
  {
    id: "go",
    name: "Go",
    price_usd: 4.8,
    price_usd_annual: 4,
    price_inr: 359,
    price_inr_annual: 299,
    period: "month",
    tagline: "Your first step up from Free",
    badge: null,
    highlight: false,
    limits: {
      credits: 750,
      extractions: 200,
      audits: 10,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      scheduled_monitoring: 0,
      team_seats: 1,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      workspaces: 1,
      batch_max_urls: 20,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: false,
      browser_extension: false,
    },
    features: [
      { label: "750 credits / month — about 750 pages or 39 Discoverability runs", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (20 accounts)", included: true },
      { label: "Competitor watchlists",          included: false },
      { label: "Signal routing to Slack / email / webhook / CRM", included: false },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments",                  included: true },
      { label: "CSV + PDF + Markdown + JSON export", included: true },
      { label: "Email export",                     included: true },
      { label: "Batch mode (up to 20 URLs)",       included: true },
      { label: "Scheduled monitoring",             included: false },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: false },
      { label: "Browser extension",                included: false },
      { label: "API access",                       included: false },
      { label: "White-label PDF",                  included: false },
    ],
  },
  {
    id: "select",
    name: "Select",
    price_usd: 14.4,
    price_usd_annual: 12,
    price_inr: 1199,
    price_inr_annual: 999,
    period: "month",
    tagline: "For individuals & freelancers",
    badge: null,
    highlight: false,
    limits: {
      credits: 2500,
      extractions: 500,
      audits: 25,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      scheduled_monitoring: 5,
      team_seats: 1,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      workspaces: 1,
      batch_max_urls: 50,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    },
    features: [
      { label: "2,500 credits / month — about 2,500 pages or 131 Discoverability runs", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (50 accounts)", included: true },
      { label: "Competitor watchlists",          included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments",                  included: true },
      { label: "CSV + PDF + Markdown + JSON",      included: true },
      { label: "Email export",                     included: true },
      { label: "Batch mode (up to 50 URLs)",       included: true },
      { label: "5 scheduled monitors",             included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension",                included: true },
      { label: "API access",                       included: false },
      { label: "White-label PDF",                  included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price_usd: 20.4,
    price_usd_annual: 17,
    price_inr: 1799,
    price_inr_annual: 1499,
    period: "month",
    tagline: "For power users & consultants",
    badge: "Recommended",
    highlight: true,
    limits: {
      credits: 6000,
      extractions: 1000,
      audits: 100,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      scheduled_monitoring: 10,
      team_seats: 1,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      workspaces: 1,
      batch_max_urls: 100,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    },
    features: [
      { label: "6,000 credits / month — about 6,000 pages or 315 Discoverability runs", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (100 accounts)", included: true },
      { label: "Competitor watchlists",          included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments",                  included: true },
      { label: "CSV + PDF + Markdown + JSON",      included: true },
      { label: "Email export",                     included: true },
      { label: "Batch mode (up to 100 URLs)",      included: true },
      { label: "10 scheduled monitors",            included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension",                included: true },
      { label: "Google Sheets push",               included: true },
      { label: "API access",                       included: false },
      { label: "White-label PDF",                  included: false },
    ],
  },
  {
    id: "business",
    name: "Business",
    price_usd: 44.4,
    price_usd_annual: 37,
    price_inr: 4199,
    price_inr_annual: 3499,
    period: "month",
    tagline: "For teams and growing agencies",
    badge: null,
    highlight: false,
    limits: {
      credits: 40000,
      extractions: 10000,
      audits: 500,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      scheduled_monitoring: 25,
      team_seats: 3,
      extra_seat_usd: 9,
      api_access: true,
      // Business now ships with the white-label PDF + priority support that
      // were previously Agency-only (2026-08-02). Both flags are surfaced in
      // the PricingMatrix, the entitlement model, and the white-label template
      // storage layer so the feature parity is real, not just a label.
      white_label_pdf: true,
      priority_support: true,
      workspaces: 1,
      batch_max_urls: 250,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    },
    features: [
      { label: "40,000 credits / month — about 40,000 pages or 2105 Discoverability runs", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (250 accounts)", included: true },
      { label: "Competitor watchlists",          included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments",                  included: true },
      { label: "CSV + PDF + Markdown + JSON",      included: true },
      { label: "Email export",                     included: true },
      { label: "Batch mode (up to 250 URLs)",      included: true },
      { label: "CSV import enrichment",            included: true },
      { label: "25 scheduled monitors",            included: true },
      { label: "API access",                       included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension",                included: true },
      { label: "3 seats + HubSpot CRM sync",       included: true },
      { label: "White-label PDF",                  included: true },
      { label: "Priority support",                 included: true },
    ],
  },
  {
    id: "agency",
    name: "Agency",
    price_usd: 106.8,
    price_usd_annual: 89,
    price_inr: 10199,
    price_inr_annual: 8499,
    period: "month",
    tagline: "Unlimited scale, your brand",
    badge: "Best Value",
    highlight: false,
    limits: {
      credits: 100000,
      extractions: Infinity,
      audits: 2000,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      scheduled_monitoring: Infinity,
      team_seats: 5,
      extra_seat_usd: null,
      api_access: true,
      white_label_pdf: true,
      priority_support: true,
      workspaces: 5,
      batch_max_urls: 500,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    },
    features: [
      { label: "100,000 credits / month — about 100,000 pages or 5263 Discoverability runs", included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (500 accounts)", included: true },
      { label: "Competitor watchlists",          included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments",                  included: true },
      { label: "CSV + PDF + Markdown + JSON",      included: true },
      { label: "Email export",                     included: true },
      { label: "Batch mode (up to 500 URLs)",      included: true },
      { label: "CSV import enrichment",            included: true },
      { label: "Unlimited scheduled monitoring",   included: true },
      { label: "API access",                       included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension",                included: true },
      { label: "5 client workspaces",              included: true },
      { label: "White-label PDF",                  included: true },
      { label: "Slack routing",                    included: true },
      { label: "Priority support",                 included: true },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    price_usd: 32.4,
    price_usd_annual: 27,
    price_inr: 2999,
    price_inr_annual: 2499,
    period: "month",
    tagline: "API-first, 10K row credits",
    badge: "Coming H3 2026",
    highlight: false,
    comingSoon: true,
    limits: {
      credits: 28000,
      extractions: 10000,
      audits: 250,
      enrichments_per_extraction: Infinity,
      exports: ["csv", "pdf", "markdown", "json", "jsonl"],
      email_export: true,
      scheduled_monitoring: 10,
      team_seats: 1,
      extra_seat_usd: null,
      api_access: true,
      white_label_pdf: false,
      priority_support: false,
      workspaces: 1,
      batch_max_urls: 500,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    },
    features: [
      { label: "28,000 credits / month — about 28,000 pages or 1473 Discoverability runs", included: true },
      { label: "10,000 row credits / month",   included: true },
      { label: "Workflow template library",     included: true },
      { label: "Bulk account lists (500 accounts)", included: true },
      { label: "Competitor watchlists",          included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "API access (no UI required)",  included: true },
      { label: "Batch mode (up to 500 URLs)",  included: true },
      { label: "CSV import enrichment",        included: true },
      { label: "JSONL / RAG export",           included: true },
      { label: "Webhook push",                 included: true },
      { label: "All enrichments",              included: true },
      { label: "10 scheduled monitors",        included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension",            included: true },
      { label: "Team seats",                   included: false },
      { label: "White-label PDF",              included: false },
    ],
  },
];

// Enterprise plan — custom pricing, displayed separately
export const ENTERPRISE_PLAN = {
  id: "enterprise",
  name: "Enterprise",
  tagline: "Custom (≥ $1,000 / mo)",
  badge: null,
  features: [
    { label: "Custom extraction volume",      included: true },
    { label: "SSO / SAML",                   included: true },
    { label: "DPA & SLA",                    included: true },
    { label: "On-prem deployment option",    included: true },
    { label: "Dedicated support engineer",   included: true },
    { label: "Custom integrations",          included: true },
  ],
};

export const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p]));

// All price_inr are BASE prices (pre-GST). 18% GST added at checkout.
// hidden: true → not shown in top-up section on Pricing page.
// ── A CONSUMPTION LIMIT IS CREDITS. A CAPACITY LIMIT IS NOT. ───────────────
//
// That distinction decides this whole list. Extractions, audits and enrichment
// are SPEND — once credits exist, a bundle selling them is a second currency
// for the same thing, and the two drift. Monitor slots, workspaces and batch
// size are STRUCTURAL CAPS that protect the cron tick and the runner.
//
// 🔴 The rule, stated once: AN ADD-ON BUYS THE RIGHT TO DO SOMETHING; THE
// DOING STILL COSTS CREDITS. A monitor slot that included its own runs would
// be a second, unmetered budget — which is exactly the shape of leaks L1, L2
// and L6.
//
// ⚠️ THE EXTRACTIONS BUNDLE IS GONE (D15). It sold pure consumption at
// $0.09/credit — FOURTEEN TIMES Go's plan rate — which was never a decision
// anyone made. CREDIT_PACKS below replace it at roughly a fifth of that.
// Removing it is one line; migrating the three OTHER writers of
// `bonus_extractions` was not — see CREDITS-UNIFICATION-PROPOSAL.md §4.6.
export const TOPUP_BUNDLES = [
  {
    id: "batch-pack",
    name: "Batch Pack",
    icon: "layers",
    price_usd: 9,
    price_inr: 749,
    description: "Unlock batch mode for 50 URLs. Run multi-URL extractions with combined CSV/JSON/Markdown output. Stackable in multiples of 50.",
    unit: "per 50 URLs",
    stackable: true,
    bonusBatchUrls: 50,
    hidden: true,           // hidden from the Pricing page top-up section
  },
  {
    id: "scheduler-addon",
    name: "Scheduled Monitor",
    icon: "clock",
    price_usd: 5,
    price_inr: 399,
    // D16 — SLOT ONLY, and the copy has to say so. The price is unchanged but
    // it now buys strictly less than it appeared to: the runs draw on your
    // credit pool (1 credit per page read). Leaving the old wording would let
    // a customer reasonably expect the runs included, which is the kind of
    // thing discovered on an invoice.
    description: "Adds one monitoring slot — one URL checked daily, with an email alert when the content changes. The checks themselves draw on your credit pool (1 credit per page read).",
    unit: "per slot / month",
    slotOnly: true,
    stackable: true,
  },
  {
    id: "workspace-addon",
    name: "Extra Workspace",
    icon: "briefcase",
    price_usd: 19,
    price_inr: 1499,
    // An extra workspace gets the same features as the user's current plan
    // (extractions, exports, enrichments, API access, white-label PDF, etc.)
    // but is bounded by the parent plan's team_seats cap. So on Business
    // (3 seats), each extra workspace can invite at most 3 members. This
    // is intentional: workspace add-ons scale capacity, not headcount.
    description: "Adds a fully-featured client workspace — same plan features as your current tier, capped at your plan's team-seats limit (e.g. 3 seats on Business).",
    unit: "/ month",
    stackable: true,
    // Feature-parity with the parent plan is enforced by the entitlement
    // model (entitlementModel.js — see `workspaceAddonFeaturesForPlan`).
    // The add-on itself does NOT carry plan features; it inherits them.
    inheritsParentPlanFeatures: true,
    cappedByParentTeamSeats: true,
  },
];

// ── Credit Packs (D18) ─────────────────────────────────────────────────────
//
// Anchored at roughly 3x the Select plan rate, with volume breaks: expensive
// enough that upgrading usually wins, cheap enough to be a reasonable answer
// to "I hit my cap on the 20th".
//
// ⚠️ A PACK NEVER EXPIRES AND NEVER ROLLS OVER, because it was not an
// allowance — it was bought. Granting it with the monthly expiry would delete
// something the customer paid for; that is why credit_grant() takes the expiry
// as a parameter instead of assuming one.
export const CREDIT_PACKS = [
  {
    id: "credits-500",
    name: "500 credits",
    icon: "zap",
    price_usd: 9,
    price_inr: 749,
    credits: 500,
    description: "Roughly 26 Discoverability runs, or 500 page extractions.",
    unit: "one-off",
    stackable: true,
  },
  {
    id: "credits-2000",
    name: "2,000 credits",
    icon: "zap",
    price_usd: 29,
    price_inr: 2399,
    credits: 2000,
    description: "Roughly 105 Discoverability runs, or 2,000 page extractions.",
    unit: "one-off",
    stackable: true,
    badge: "Best value",
  },
  {
    id: "credits-10000",
    name: "10,000 credits",
    icon: "zap",
    price_usd: 119,
    price_inr: 9899,
    credits: 10000,
    description: "Roughly 526 Discoverability runs, or 10,000 page extractions.",
    unit: "one-off",
    stackable: true,
  },
];

export const CREDIT_PACK_BY_ID = Object.fromEntries(CREDIT_PACKS.map((p) => [p.id, p]));

// ── Agency fair use (D13) ──────────────────────────────────────────────────
// ⚠️ PUBLISH THIS. An undisclosed cap is the version that loses trust, and the
// same is true of the overage rate and the rollover cap.
export const AGENCY_OVERAGE = Object.freeze({
  fairUseCredits: 100_000,
  usdPer1000: 2.0,
  // The soft landing: notify at 100%, require a commitment at 150%, NEVER
  // hard-stop mid-month. An agency has client deliverables, and a hard stop
  // damages their customer rather than ours.
  notifyAtPct: 100,
  commitAtPct: 150,
  hardStop: false,
});
