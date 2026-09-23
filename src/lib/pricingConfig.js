// pricingConfig.js — V6 revised plan definitions, USD + INR only.

// India-first: USD for all other regions, INR for Indian users.
import { DISCOVERABILITY_BASE } from "./credits/creditWeights.js";

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
// ── THE PRICE AND ELIGIBILITY TABLE — THE ONE PLACE EITHER IS SET ───────────
//
// 🔴 EVERY NUMBER A CUSTOMER IS QUOTED OR GATED BY COMES FROM HERE. The plan
// objects below, the numeric lines on each plan card, the comparison matrix
// and the server's own price table are all derived from this one literal, so a
// repricing is one edit rather than a sweep. The prior shape hand-wrote each
// figure three times — in `limits`, in a `features` label and again in
// `pageSeo.js` — and it had drifted in all three by the time anyone looked.
//
// 🔴 INR IS A PRICE, NOT A CONVERSION. `price_inr` is set here and never
// derived from `price_usd` at any exchange rate. A converted price moves when
// the rate moves, which means the number on the card and the number charged
// can differ between the page load and the checkout; it also makes every INR
// price an odd amount nobody would choose. `resolvePlanPrice` no longer has a
// conversion path for plans at all.
//
// ⚠️ ANNUAL IS "TWO MONTHS FREE", ROUNDED TO THE SAME HOUSE STYLE. The rate is
// `usd_annual` / `inr_annual` **per month**, billed twelve at a time. It is
// stated rather than computed because the rounding is a pricing choice;
// `annualSavingsPercent` derives the advertised % from these numbers, so the
// badge can never claim a discount the cards do not give.
//
// ⚠️ `batch` AND `bulk` ARE SEPARATE, AND FREE IS WHY. They were one key
// (`batch_max_urls`) until this table, which meant Free's 5-URL batch also
// granted it a 5-row bulk account list — a different, more expensive product.
// Free is batch 5 / bulk 0. Every other plan sets them equal today; the point
// is that it can now say otherwise without a code change.
//
// ⚠️ `seats: 1` IS SOLO, NOT ZERO. The source sheet writes 0 for the plans
// with no team feature, but the account owner is themselves a seat — a plan
// with 0 seats could not be used by the person who bought it. 0 in the sheet
// means "no TEAM", which is `seats: 1`.
//
// ⚠️ `extract` AND `discover` ARE DESCRIPTIVE AND ENFORCED BY NOTHING. Credits
// are the gate. They are kept because they are the figures customers use to
// judge a plan's size, and because dropping a limit key changes what an
// operator override written against the old shape resolves to.
export const PLAN_TABLE = Object.freeze({
  //            USD/mo   USD/mo(annual)   INR/mo   INR/mo(annual)  credits   extract  discover  batch  bulk  monitors  seats  workspaces
  free:      { usd:   0, usd_annual:   0, inr:     0, inr_annual:     0, credits:    100, extract:     10, discover:    1, batch:   5, bulk:   0, monitors:   0, seats: 1, workspaces: 1 },
  go:        { usd:   5, usd_annual:   4, inr:   490, inr_annual:   409, credits:    750, extract:    200, discover:   10, batch:  20, bulk:  20, monitors:   0, seats: 1, workspaces: 1 },
  select:    { usd:  15, usd_annual:  12, inr:  1449, inr_annual:  1209, credits:   2500, extract:    500, discover:   25, batch:  50, bulk:  50, monitors:   5, seats: 1, workspaces: 1 },
  pro:       { usd:  25, usd_annual:  20, inr:  2449, inr_annual:  2049, credits:   6000, extract:   1000, discover:  100, batch: 100, bulk: 100, monitors:  10, seats: 1, workspaces: 1 },
  developer: { usd:  55, usd_annual:  45, inr:  5449, inr_annual:  4549, credits:  25000, extract:  10000, discover:  250, batch: 250, bulk: 250, monitors:  10, seats: 1, workspaces: 1 },
  business:  { usd:  85, usd_annual:  70, inr:  7849, inr_annual:  6549, credits:  40000, extract:  10000, discover:  500, batch: 250, bulk: 250, monitors:  25, seats: 3, workspaces: 1 },
  agency:    { usd: 200, usd_annual: 165, inr: 19449, inr_annual: 16249, credits: 100000, extract: 100000, discover: 2000, batch: 500, bulk: 500, monitors: 100, seats: 5, workspaces: 5 },
});

/** Credits a standard Discoverability run costs. Imported rather than written
 *  as a number so the "≈ N runs" line on every card moves with the weight. */
const AUDIT_COST = DISCOVERABILITY_BASE;

const n = (v) => v.toLocaleString("en-US");

/**
 * The numeric feature lines, DERIVED from the table above.
 *
 * 🔴 These used to be hand-written strings beside the limits they described,
 * which is how "Bulk account lists (500 accounts)" survived on a Developer
 * plan whose batch size had been cut to 250. A label that restates a number
 * cannot be kept in step by review; it has to be computed from it.
 */
function quantitativeFeatures(id) {
  const t = PLAN_TABLE[id];
  const runs = Math.floor(t.credits / AUDIT_COST);
  const out = [
    {
      label: id === "free"
        ? `${n(t.credits)} credits to start — never expires, no card needed`
        : // 1 credit = 1 page, so the pool IS the page count — never `t.extract`,
          // which is the separate descriptive extraction figure and would
          // under-quote Go by 550 pages.
          `${n(t.credits)} credits / month — about ${n(t.credits)} pages or ${n(runs)} Discoverability runs`,
      included: true,
    },
    { label: "Workflow template library", included: true },
    {
      label: t.bulk > 0 ? `Bulk account lists (${n(t.bulk)} accounts)` : "Bulk account lists",
      included: t.bulk > 0,
    },
  ];
  return { t, runs, out };
}

function monitorFeature(t) {
  if (t.monitors === 0) return { label: "Scheduled monitoring", included: false };
  return { label: `${n(t.monitors)} scheduled monitors`, included: true };
}

function batchFeature(t) {
  return { label: `Batch mode (up to ${n(t.batch)} URLs)`, included: true };
}

function limitsFor(id, extra = {}) {
  const t = PLAN_TABLE[id];
  return {
    credits: t.credits,
    extractions: t.extract,
    audits: t.discover,
    enrichments_per_extraction: Infinity,
    scheduled_monitoring: t.monitors,
    team_seats: t.seats,
    workspaces: t.workspaces,
    batch_max_urls: t.batch,
    // ⚠️ Separate from batch_max_urls on purpose — see the table's header.
    // `bulk.enrich` reads this and falls back to batch_max_urls when an
    // operator override written against the older shape omits it.
    bulk_list_max: t.bulk,
    ...extra,
  };
}

export const PLANS = [
  {
    id: "free",
    name: "Free",
    price_usd: PLAN_TABLE.free.usd,
    price_usd_annual: PLAN_TABLE.free.usd_annual,
    price_inr: PLAN_TABLE.free.inr,
    price_inr_annual: PLAN_TABLE.free.inr_annual,
    period: "month",
    tagline: "Try DatIQ risk-free",
    badge: null,
    highlight: false,
    limits: limitsFor("free", {
      exports: ["csv"],
      email_export: false,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      // Fork a workflow template and edit its prompts (entitlementModel:
      // 'template.duplicate'). Free runs templates but cannot rewrite them.
      template_duplicate: false,
      integrations: false,
      browser_extension: false,
    }),
    features: [
      ...quantitativeFeatures("free").out,
      { label: "Competitor watchlists", included: false },
      { label: "Signal routing to Slack / email / webhook / CRM", included: false },
      { label: "Fork & edit workflow templates", included: false },
      { label: "Full AI features", included: true },
      { label: "CSV export", included: true },
      batchFeature(PLAN_TABLE.free),
      { label: "PDF export", included: false },
      { label: "Markdown / JSON export", included: false },
      { label: "Email export", included: false },
      monitorFeature(PLAN_TABLE.free),
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: false },
      { label: "Browser extension", included: false },
      { label: "API access", included: false },
      { label: "White-label PDF", included: false },
    ],
  },
  {
    id: "go",
    name: "Go",
    price_usd: PLAN_TABLE.go.usd,
    price_usd_annual: PLAN_TABLE.go.usd_annual,
    price_inr: PLAN_TABLE.go.inr,
    price_inr_annual: PLAN_TABLE.go.inr_annual,
    period: "month",
    tagline: "Your first step up from Free",
    badge: null,
    highlight: false,
    limits: limitsFor("go", {
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      template_duplicate: true,
      integrations: false,
      browser_extension: false,
    }),
    features: [
      ...quantitativeFeatures("go").out,
      { label: "Competitor watchlists", included: false },
      { label: "Signal routing to Slack / email / webhook / CRM", included: false },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments", included: true },
      { label: "CSV + PDF + Markdown + JSON export", included: true },
      { label: "Email export", included: true },
      batchFeature(PLAN_TABLE.go),
      monitorFeature(PLAN_TABLE.go),
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: false },
      { label: "Browser extension", included: false },
      { label: "API access", included: false },
      { label: "White-label PDF", included: false },
    ],
  },
  {
    id: "select",
    name: "Select",
    price_usd: PLAN_TABLE.select.usd,
    price_usd_annual: PLAN_TABLE.select.usd_annual,
    price_inr: PLAN_TABLE.select.inr,
    price_inr_annual: PLAN_TABLE.select.inr_annual,
    period: "month",
    tagline: "For individuals & freelancers",
    badge: null,
    highlight: false,
    limits: limitsFor("select", {
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    }),
    features: [
      ...quantitativeFeatures("select").out,
      { label: "Competitor watchlists", included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments", included: true },
      { label: "CSV + PDF + Markdown + JSON", included: true },
      { label: "Email export", included: true },
      batchFeature(PLAN_TABLE.select),
      monitorFeature(PLAN_TABLE.select),
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension", included: true },
      { label: "API access", included: false },
      { label: "White-label PDF", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price_usd: PLAN_TABLE.pro.usd,
    price_usd_annual: PLAN_TABLE.pro.usd_annual,
    price_inr: PLAN_TABLE.pro.inr,
    price_inr_annual: PLAN_TABLE.pro.inr_annual,
    period: "month",
    tagline: "For power users & consultants",
    badge: "Recommended",
    highlight: true,
    limits: limitsFor("pro", {
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      extra_seat_usd: null,
      api_access: false,
      white_label_pdf: false,
      priority_support: false,
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    }),
    features: [
      ...quantitativeFeatures("pro").out,
      { label: "Competitor watchlists", included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments", included: true },
      { label: "CSV + PDF + Markdown + JSON", included: true },
      { label: "Email export", included: true },
      batchFeature(PLAN_TABLE.pro),
      monitorFeature(PLAN_TABLE.pro),
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension", included: true },
      { label: "Google Sheets push", included: true },
      { label: "API access", included: false },
      { label: "White-label PDF", included: false },
    ],
  },
  {
    id: "business",
    name: "Business",
    price_usd: PLAN_TABLE.business.usd,
    price_usd_annual: PLAN_TABLE.business.usd_annual,
    price_inr: PLAN_TABLE.business.inr,
    price_inr_annual: PLAN_TABLE.business.inr_annual,
    period: "month",
    tagline: "For teams and growing agencies",
    badge: null,
    highlight: false,
    limits: limitsFor("business", {
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      extra_seat_usd: 9,
      api_access: true,
      white_label_pdf: true,
      priority_support: true,
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    }),
    features: [
      ...quantitativeFeatures("business").out,
      { label: "Competitor watchlists", included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments", included: true },
      { label: "CSV + PDF + Markdown + JSON", included: true },
      { label: "Email export", included: true },
      batchFeature(PLAN_TABLE.business),
      { label: "CSV import enrichment", included: true },
      monitorFeature(PLAN_TABLE.business),
      { label: "API access", included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension", included: true },
      { label: `${n(PLAN_TABLE.business.seats)} seats + HubSpot CRM sync`, included: true },
      { label: "White-label PDF", included: true },
      { label: "Priority support", included: true },
    ],
  },
  {
    id: "agency",
    name: "Agency",
    price_usd: PLAN_TABLE.agency.usd,
    price_usd_annual: PLAN_TABLE.agency.usd_annual,
    price_inr: PLAN_TABLE.agency.inr,
    price_inr_annual: PLAN_TABLE.agency.inr_annual,
    period: "month",
    tagline: "Agency scale, your brand",
    badge: "Best Value",
    highlight: false,
    limits: limitsFor("agency", {
      exports: ["csv", "pdf", "markdown", "json"],
      email_export: true,
      extra_seat_usd: null,
      api_access: true,
      white_label_pdf: true,
      priority_support: true,
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    }),
    features: [
      ...quantitativeFeatures("agency").out,
      { label: "Competitor watchlists", included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "All enrichments", included: true },
      { label: "CSV + PDF + Markdown + JSON", included: true },
      { label: "Email export", included: true },
      batchFeature(PLAN_TABLE.agency),
      { label: "CSV import enrichment", included: true },
      monitorFeature(PLAN_TABLE.agency),
      { label: "API access", included: true },
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension", included: true },
      { label: `${n(PLAN_TABLE.agency.workspaces)} client workspaces`, included: true },
      { label: "White-label PDF", included: true },
      { label: "Slack routing", included: true },
      { label: "Priority support", included: true },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    price_usd: PLAN_TABLE.developer.usd,
    price_usd_annual: PLAN_TABLE.developer.usd_annual,
    price_inr: PLAN_TABLE.developer.inr,
    price_inr_annual: PLAN_TABLE.developer.inr_annual,
    period: "month",
    tagline: "API-first, built for pipelines",
    badge: "Coming H3 2026",
    highlight: false,
    comingSoon: true,
    limits: limitsFor("developer", {
      exports: ["csv", "pdf", "markdown", "json", "jsonl"],
      email_export: true,
      extra_seat_usd: null,
      api_access: true,
      white_label_pdf: false,
      priority_support: false,
      template_duplicate: true,
      integrations: true,
      browser_extension: true,
    }),
    features: [
      ...quantitativeFeatures("developer").out,
      { label: "Competitor watchlists", included: true },
      { label: "Signal routing to Slack / email / webhook / CRM", included: true },
      { label: "Fork & edit workflow templates", included: true },
      { label: "API access (no UI required)", included: true },
      batchFeature(PLAN_TABLE.developer),
      { label: "CSV import enrichment", included: true },
      { label: "JSONL / RAG export", included: true },
      { label: "Webhook push", included: true },
      { label: "All enrichments", included: true },
      monitorFeature(PLAN_TABLE.developer),
      { label: "Integrations (HubSpot, Notion, Airtable, Slack)", included: true },
      { label: "Browser extension", included: true },
      { label: "Team seats", included: false },
      { label: "White-label PDF", included: false },
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
/**
 * Capacity add-on prices. Same rule as PLAN_TABLE: INR is SET, never converted.
 *
 * ⚠️ AN ADD-ON BUYS THE RIGHT TO DO SOMETHING; THE DOING STILL COSTS CREDITS.
 * A monitor slot whose runs were included would be a second, unmetered budget —
 * the shape of leaks L1, L2 and L6. `credits_consumed` records what each one
 * still draws from the pool so the copy beside it cannot quietly drop the point.
 */
export const ADDON_PRICES = Object.freeze({
  "scheduler-addon": { usd: 5,  inr:  490, credits_consumed: "runs draw on the pool: page monitor 1/page, prompt monitor 2/prompt" },
  "batch-pack":      { usd: 9,  inr:  879, credits_consumed: "rows draw on the pool at 3/row" },
  "workspace-addon": { usd: 19, inr: 1849, credits_consumed: "0 — no provider call" },
});

export const TOPUP_BUNDLES = [
  {
    id: "batch-pack",
    name: "Batch Pack",
    icon: "layers",
    price_usd: ADDON_PRICES["batch-pack"].usd,
    price_inr: ADDON_PRICES["batch-pack"].inr,
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
    price_usd: ADDON_PRICES["scheduler-addon"].usd,
    price_inr: ADDON_PRICES["scheduler-addon"].inr,
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
    price_usd: ADDON_PRICES["workspace-addon"].usd,
    price_inr: ADDON_PRICES["workspace-addon"].inr,
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
/** One sentence per pack, DERIVED — a hand-written "roughly 26 runs" goes stale
 *  the moment a weight moves, and nothing would fail when it did. */
function packDescription(credits) {
  return `Roughly ${n(Math.floor(credits / AUDIT_COST))} Discoverability runs, or ${n(credits)} page extractions.`;
}

export const CREDIT_PACKS = [
  {
    id: "credits-500",
    name: "500 credits",
    icon: "zap",
    price_usd: 5,
    price_inr: 490,
    credits: 500,
    description: packDescription(500),
    unit: "one-off",
    stackable: true,
  },
  {
    id: "credits-2000",
    name: "2,000 credits",
    icon: "zap",
    price_usd: 19,
    price_inr: 1849,
    credits: 2000,
    description: packDescription(2000),
    unit: "one-off",
    stackable: true,
    badge: "Best value",
  },
  {
    id: "credits-10000",
    name: "10,000 credits",
    icon: "zap",
    price_usd: 89,
    price_inr: 11449,
    credits: 10000,
    description: packDescription(10000),
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
