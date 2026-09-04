// src/lib/templates/seedTemplates.js — the six launch templates (PRD 1).
//
// PURE DATA. Seeded into workflow_templates via publish_template_version() by
// netlify/functions/templates.js on first read, so the catalogue is versioned
// in the database rather than hard-coded into the UI — which is exactly what
// PRD 1's technical considerations ask for ("store template definitions as
// versioned JSON/configuration, not hard-coded UI logic").
//
// ── SEVEN, AND THE SEVENTH IS THE POSITIONING BET ───────────────────────────
// The PRD is explicit: "Build first: 6 templates only. Avoid creating 30
// templates before observing adoption." Every extra template dilutes the
// signal about which job-to-be-done deserves deeper investment.
//
// `ai_visibility_brief` is the deliberate exception, and it is not a seventh
// variation on "read a page" — it is the product's positioning made runnable.
// "Extract any URL" is a commodity: Firecrawl and Jina do it as infrastructure
// for less, and a chat model reads a URL for free. What DatIQ has that none of
// them do is the four-pillar SEO/AEO/GEO engine plus schema-validated,
// evidence-backed extraction — and the question that combination answers is
// one nobody else can: "how do we and our competitors appear to buyers AND to
// AI answer engines, and what do we change first?"
//
// It is the only template that reads MULTIPLE companies in one run and
// compares them, which is why it carries a per-competitor credit cost.
//
// ── bulk_icp_enrichment SHIPS AS A DRAFT, ON PURPOSE ────────────────────────
// Its definition is here so Phase 4 only has to publish it, but its status is
// 'draft' because the durable bulk runner (§1.3a) does not exist until Phase 4.
// A published template whose runner 404s is worse than an absent one: the
// catalogue would be advertising a workflow that cannot complete, and the user
// finds out only after spending their attention on the form.

import { TEMPLATE_STATUS } from "./templateModel.js";

export const SEED_TEMPLATES = [
  {
    template_key: "account_brief",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "Sales-ready Account Brief",
    persona: "sales",
    summary:
      "Turn one company domain into a brief you can open a call with: what they do, who they sell to, how they price, and who to talk to.",
    input_schema: {
      fields: [
        { name: "domain", kind: "domain", required: true, label: "Company domain",
          placeholder: "stripe.com", help: "We read their public site — no login required." },
        { name: "angle", kind: "choice", label: "Outreach angle", default: "discovery",
          options: [
            { value: "discovery", label: "Discovery call" },
            { value: "displacement", label: "Displacing an incumbent" },
            { value: "expansion", label: "Expansion / upsell" },
          ] },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "company_name", group: "identity" },
        { name: "description", group: "identity" },
        { name: "hq_location", group: "identity" },
        { name: "industry", group: "firmographics" },
        { name: "employee_range", group: "firmographics" },
        { name: "target_customer", group: "commercial" },
        { name: "pricing_model", group: "commercial" },
        { name: "customer_proof", group: "gtm" },
        { name: "leadership", group: "people" },
        { name: "recent_signals", group: "signals" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "The one-paragraph version" },
        { kind: "fields", title: "Account facts", groups: ["identity", "firmographics", "commercial"] },
        { kind: "list", title: "Conversation openers", from: "talking_points" },
        { kind: "fields", title: "People", groups: ["people"] },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      extract:
        "From this company's public website, extract: company name, one-sentence description, HQ location, " +
        "industry, employee-count range if stated, who they sell to, their pricing model, named customers or " +
        "case studies, leadership names with titles, and any recent announcements. " +
        "Return JSON. For anything not stated on the page, return null — never guess.",
      summarize:
        "Write a four-sentence brief for a salesperson about to call this company. Say what they do, who they " +
        "sell to, how they make money, and the single most useful thing to open with. State only what the " +
        "extracted facts support.",
      talking_points:
        "Given these facts, list three specific conversation openers referencing something concrete from their " +
        "site. Each must cite the fact it rests on. No generic flattery.",
    },
    credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 3, ai_calls_per_unit: 2 },
    plan_entitlement: "template.run",
    min_plan: "free",
  },

  {
    template_key: "competitor_pricing_tracker",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "Competitor Pricing Tracker",
    persona: "competitive-intel",
    summary:
      "Read a competitor's pricing page into a structured tier table you can diff later — the starting snapshot for a watchlist.",
    input_schema: {
      fields: [
        { name: "domain", kind: "domain", required: true, label: "Competitor domain", placeholder: "notion.so" },
        { name: "pricing_url", kind: "url", label: "Pricing page URL (optional)",
          help: "Leave blank and we'll find it from their site." },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "tiers", group: "commercial" },
        { name: "billing_periods", group: "commercial" },
        { name: "currency", group: "commercial" },
        { name: "free_tier", group: "commercial" },
        { name: "enterprise_contact_only", group: "commercial" },
        { name: "feature_gates", group: "commercial" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "What their pricing says about their strategy" },
        { kind: "table", title: "Tiers", from: "tiers",
          columns: ["name", "price", "billing_period", "seats", "headline_limits"] },
        { kind: "fields", title: "Packaging signals", groups: ["commercial"] },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      extract:
        "Extract every pricing tier from this page: tier name, price, currency, billing period, seat rules, and " +
        "the headline limits or features that distinguish it. Also capture whether a free tier exists and " +
        "whether the top tier is contact-sales only. Return JSON. Use null for anything not shown — do not " +
        "infer a price that is not printed.",
      summarize:
        "In three sentences, describe what this pricing structure suggests about who they are trying to win. " +
        "Separate what the page STATES from what you INFER, and label the inference as such.",
    },
    credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 2, ai_calls_per_unit: 2 },
    plan_entitlement: "template.run",
    min_plan: "free",
  },

  {
    template_key: "discoverability_audit",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "SEO / GEO / AEO Audit",
    persona: "seo",
    summary:
      "Score a page for classic search, AI answer engines, and generative engines — with a prioritised fix list.",
    input_schema: {
      fields: [
        { name: "url", kind: "url", required: true, label: "Page to audit",
          placeholder: "https://example.com/pricing" },
        { name: "profile", kind: "choice", label: "Lens", default: "balanced",
          options: [
            { value: "balanced", label: "Balanced" },
            { value: "seo", label: "Classic search" },
            { value: "aeo", label: "Answer engines" },
            { value: "geo", label: "Generative engines" },
          ] },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "pillar_scores", group: "qualification" },
        { name: "coverage", group: "governance" },
        { name: "issues", group: "qualification" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "Executive summary" },
        { kind: "fields", title: "Scores", groups: ["qualification"] },
        { kind: "recommendations", title: "Fix queue, highest lift first" },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    // Delegates to the existing discoverability engine rather than re-prompting.
    prompt_bundle: { delegate: "discoverability" },
    credit_cost: { base: 0, per_page: 0, per_ai_call: 0, pages_per_unit: 0, ai_calls_per_unit: 0 },
    // Audits carry their OWN monthly budget (see entitlementModel's `audit`
    // case) — charging credits here as well would bill the same work twice.
    plan_entitlement: "audit",
    min_plan: "free",
  },

  {
    template_key: "due_diligence_brief",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "Pre-Meeting Due Diligence Brief",
    persona: "founder-vc",
    summary:
      "A source-backed company brief before a first call: what they do, traction signals, team, and what to ask.",
    input_schema: {
      fields: [
        { name: "domain", kind: "domain", required: true, label: "Company domain", placeholder: "linear.app" },
        { name: "focus", kind: "choice", label: "Meeting type", default: "intro",
          options: [
            { value: "intro", label: "Intro call" },
            { value: "diligence", label: "Diligence deep-dive" },
            { value: "partnership", label: "Partnership" },
          ] },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "company_name", group: "identity" },
        { name: "what_they_do", group: "identity" },
        { name: "founded", group: "identity" },
        { name: "team", group: "people" },
        { name: "customers", group: "gtm" },
        { name: "pricing_model", group: "commercial" },
        { name: "hiring_signals", group: "signals" },
        { name: "tech_signals", group: "technology" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "Before you walk in" },
        { kind: "fields", title: "Company", groups: ["identity", "commercial"] },
        { kind: "fields", title: "Team & traction", groups: ["people", "gtm", "signals"] },
        { kind: "list", title: "Questions worth asking", from: "questions" },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      extract:
        "Extract: company name, what they do in one sentence, founding year if stated, named team members with " +
        "titles, named customers, pricing model, open roles that indicate investment areas, and any stated " +
        "technology choices. Return JSON. Anything not stated on the site is null.",
      summarize:
        "Write a five-sentence pre-meeting brief. Distinguish what the company CLAIMS from what is externally " +
        "evidenced. Do not speculate about funding, revenue, or headcount unless the site states it.",
      questions:
        "List four specific questions this research raises — each tied to a concrete observation, each one the " +
        "company could actually answer in a first call.",
    },
    credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 4, ai_calls_per_unit: 2 },
    plan_entitlement: "template.run",
    min_plan: "free",
  },

  {
    template_key: "customer_proof_extractor",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "Customer Proof Extractor",
    persona: "competitive-intel",
    summary:
      "Pull every named customer, case study, logo and quantified outcome off a site — the evidence layer for battlecards.",
    input_schema: {
      fields: [
        { name: "domain", kind: "domain", required: true, label: "Company domain", placeholder: "vercel.com" },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "named_customers", group: "gtm" },
        { name: "case_studies", group: "gtm" },
        { name: "quantified_outcomes", group: "gtm" },
        { name: "industries", group: "gtm" },
        { name: "testimonials", group: "gtm" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "Who they say they win with" },
        { kind: "table", title: "Customer proof", from: "case_studies",
          columns: ["customer", "industry", "outcome", "source"] },
        { kind: "list", title: "Named logos", from: "named_customers" },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      extract:
        "Extract every named customer, case study, and testimonial: customer name, their industry, the specific " +
        "quantified outcome claimed (e.g. '40% faster'), and the quote if present. Return JSON. " +
        "Only include customers NAMED on the page — never infer a customer from a generic logo strip you " +
        "cannot read, and never invent a metric that is not printed.",
      summarize:
        "In three sentences, describe the segment this company's proof actually targets — company sizes, " +
        "industries, and the outcome they lead with.",
    },
    credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 3, ai_calls_per_unit: 1 },
    plan_entitlement: "template.run",
    min_plan: "free",
  },

  {
    // ── THE POSITIONING TEMPLATE ─────────────────────────────────────────────
    // Reads your own site and up to four competitors, extracts each one's
    // positioning and pricing under the SAME schema (so the comparison is
    // like-for-like rather than four differently-shaped summaries), then writes
    // a brief about where you actually stand and what to change.
    template_key: "ai_visibility_brief",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "AI Visibility & Competitive Brief",
    persona: "competitive-intel",
    summary:
      "How you and your competitors describe, price and position yourselves — and what an AI answer engine would say about each of you. One brief, with the evidence behind every claim.",
    input_schema: {
      fields: [
        { name: "domain", kind: "domain", required: true, label: "Your domain",
          placeholder: "yourcompany.com",
          help: "We read your public site — positioning, pricing and proof points." },
        { name: "competitors", required: true, kind: "domain_list", label: "Competitors (up to 4)", max: 4,
          placeholder: "competitor-a.com, competitor-b.com",
          help: "Each competitor is read with the same schema, so the comparison is like-for-like." },
        { name: "audience", kind: "choice", label: "Who is this brief for", default: "gtm",
          options: [
            { value: "gtm", label: "Go-to-market team" },
            { value: "founder", label: "Founder / exec" },
            { value: "marketing", label: "Marketing & content" },
          ] },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "positioning", group: "positioning" },
        { name: "values", group: "positioning" },
        { name: "proof", group: "evidence" },
        { name: "plans", group: "commercial" },
        { name: "commercial", group: "commercial" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "summary", title: "Where you stand" },
        { kind: "list", title: "What to change first", from: "talking_points" },
        { kind: "comparison", title: "Side by side", from: "comparison" },
        { kind: "fields", title: "Your positioning and pricing", groups: ["positioning", "commercial", "evidence"] },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      // The extraction runs under the `mission` capability schema, so this
      // string is an addendum, not the whole instruction — see
      // resolveExtractionPlan() in extractionSchemas.js.
      extract:
        "Also capture how this company would answer 'what do you do and who is it for' in one sentence, " +
        "and any claim they make that a competitor could contest. " +
        "Return null for anything the pages do not state — never guess a positioning or a price, because " +
        "this brief is read side by side with competitors and one invented cell corrupts every comparison.",
      summarize:
        "Write a 5-7 sentence positioning brief. Say: what this company claims to be, who it says it is for, " +
        "how its pricing is structured, and — comparing against the competitor facts supplied — where it is " +
        "genuinely differentiated versus where it says the same thing as everyone else. Name the competitor " +
        "you are comparing against in each contrast. Where the evidence is thin, say the evidence is thin " +
        "rather than softening the claim.",
      talking_points:
        "List the 3-5 highest-leverage changes this company should make to how it presents itself, ordered " +
        "by impact. Each must (a) name the specific page or claim to change, (b) say what to change it to, " +
        "and (c) cite the extracted fact or competitor comparison that justifies it. " +
        "No generic advice — 'improve your messaging' is a failed answer. If the evidence does not support " +
        "five recommendations, give fewer.",
      comparison:
        "Build a like-for-like comparison across these companies on exactly these axes: category they claim, " +
        "target customer, pricing model, entry price, headline differentiator, and strongest proof point. " +
        "One row per company. Use null where a company does not state something — an empty cell is a finding " +
        "in itself, and inventing one destroys the comparison's value.",
    },
    // Per-competitor: each one is its own page read plus its share of the
    // synthesis. `pages_per_unit` covers the related-page gathering that
    // positioning extraction does (/about, /pricing) on each domain.
    credit_cost: { base: 2, per_page: 1, per_ai_call: 2, pages_per_unit: 3, ai_calls_per_unit: 1 },
    plan_entitlement: "template.run",
    min_plan: "free",
  },

  {
    template_key: "bulk_icp_enrichment",
    status: TEMPLATE_STATUS.PUBLISHED,
    title: "Bulk ICP Account Enrichment",
    persona: "sales",
    summary:
      "Upload a list of company domains and get back an enriched, scored, source-backed account table.",
    input_schema: {
      fields: [
        { name: "domains", kind: "domain_list", required: true, max: 500, label: "Company domains",
          help: "Paste or upload a CSV. We de-duplicate and normalise them for you." },
        { name: "icp_profile", kind: "choice", label: "Score against", default: "default",
          options: [{ value: "default", label: "DatIQ default ICP" }] },
      ],
    },
    extraction_schema: {
      fields: [
        { name: "company_name", group: "identity" },
        { name: "industry", group: "firmographics" },
        { name: "employee_range", group: "firmographics" },
        { name: "pricing_model", group: "commercial" },
        { name: "icp_score", group: "qualification" },
        { name: "icp_reasons", group: "qualification" },
      ],
    },
    output_schema: {
      blocks: [
        { kind: "table", title: "Accounts", from: "rows" },
        { kind: "sources", title: "Where this came from" },
      ],
    },
    prompt_bundle: {
      extract:
        "Extract firmographics, company name, industry, employee range, and pricing model for each account from its homepage and about/pricing pages. " +
        "Never invent or guess values — return null for any field that cannot be verified from the source text. " +
        "Identify whether pricing is published and extract verifiable employee counts.",
    },
    credit_cost: { base: 2, per_page: 1, per_ai_call: 2, pages_per_unit: 2, ai_calls_per_unit: 1 },
    plan_entitlement: "extract.batch",
    min_plan: "go",
  },
];

/** Only the templates a user can actually run today. */
export const PUBLISHED_SEEDS = SEED_TEMPLATES.filter(
  (t) => t.status === TEMPLATE_STATUS.PUBLISHED,
);

export function seedByKey(key) {
  return SEED_TEMPLATES.find((t) => t.template_key === key) || null;
}
