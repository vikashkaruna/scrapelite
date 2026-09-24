// personaConfig.js — the roles DatIQ is set up for.
//
// Each role shapes the Home hero, example chips, Dashboard labels, the
// onboarding page and the Templates filter. Eight roles (owner, 2026-09-24),
// replacing the seven V4 personas.
//
// ── IDS ARE STORED DATA, NOT LABELS ─────────────────────────────────────────
// A role id lives in localStorage, the user's `user_metadata.persona_id`,
// `public_reports.persona` (CHECK constraint, 0025 → 0084), template rows and
// analytics. So an id is KEPT wherever a role carries forward and only its
// label moves. Two ids are retired from the picker but stay valid:
//   · `market-research` merged into Founder, VC & Market Research — it
//     RESOLVES to `founder-vc` (resolvePersonaId).
//   · `recruiter` is not one of the eight and has no close match — it stays a
//     hidden LEGACY role, so whoever chose it keeps their experience.
// Never delete an id from PERSONA_BY_ID; a stored value would stop resolving.
//
// ── THE ONBOARDING FIELDS ───────────────────────────────────────────────────
// job · jobs[{text, module}] · outcome · firstStep. Every `module` must be a
// key of ROLE_MODULES (roleModules.js), which names a real route; the parity
// test fails the build otherwise. Nothing here may claim an unshipped feature.

export const PERSONAS = [
  {
    id: "sales",
    starterPack: "sales",
    label: "Sales, SDR & BDR",
    shortLabel: "Sales",
    icon: "target",
    color: "#4f46e5",
    job: "Research accounts before outreach and turn public signals into relevant conversations.",
    jobs: [
      { text: "Turn a prospect's website into a sales-ready account brief", module: "templates" },
      { text: "Pull contacts, leadership and pricing cues from any page", module: "enrich" },
      { text: "Research a whole list of accounts in one batch", module: "extract" },
      { text: "Draft reviewed, consent-checked outreach from your research", module: "engage" },
      { text: "Push accounts and briefs to HubSpot, Airtable or Sheets", module: "connect" },
    ],
    modules: ["extract", "enrich", "templates", "engage", "connect"],
    outcome: "Less time researching, sharper personalisation and more qualified pipeline.",
    firstStep: { label: "Build your first account brief", to: "/templates?key=account_brief" },
    tagline: "Turn any company website into a qualified prospect — in under 30 seconds.",
    subtitle:
      "Extract company details, leadership contacts, and custom data fields instantly. Build your pipeline faster than any enrichment tool.",
    badge: "Sales Intelligence",
    examples: ["stripe.com", "hubspot.com", "salesforce.com"],
    quickActions: ["contacts", "leadership", "mission"],
    featuresHighlight: ["contacts", "summary", "custom"],
    heroStat: "30s",
    heroStatLabel: "avg. time to prospect",
    dashboardLabel: "Prospect Research",
    dashboardSub: "Your qualified company extractions",
    welcomeTitle: "Ready to prospect smarter?",
    welcomeBody:
      "We've pre-loaded an example so you can see exactly what you get — company overview, leadership contacts, and an AI brief, instantly.",
    demoUrl: "https://hubspot.com",
    demoLabel: "See a live HubSpot prospect extraction",
    guideTip:
      "Paste any company URL — DatIQ extracts contacts, leadership, and an AI summary in seconds.",
    discoverPack: null,
  },
  {
    id: "revops",
    starterPack: "sales",
    label: "RevOps & Growth Operations",
    shortLabel: "RevOps",
    icon: "sliders",
    color: "#0891b2",
    job: "Clean, enrich, score and route account lists before they reach sales.",
    jobs: [
      { text: "Import an account list and enrich every company on it", module: "workflows" },
      { text: "Score each account against your ICP, with the evidence shown", module: "workflows" },
      { text: "Define custom fields — industry, pricing model, tech signals", module: "enrich" },
      { text: "Route new signals to Slack, email or your CRM with rules", module: "workflows" },
      { text: "Send enriched, ranked accounts to HubSpot, Airtable or Sheets", module: "connect" },
    ],
    modules: ["extract", "enrich", "workflows", "templates", "connect"],
    outcome: "Enriched, ranked accounts reach CRM faster, and SDRs stop working the wrong ones.",
    firstStep: { label: "Import and enrich an account list", to: "/lists" },
    tagline: "Every account list enriched, scored and routed — without a spreadsheet marathon.",
    subtitle:
      "Batch-enrich company URLs, score them against your ICP, and send the ranked list to the tools your team already works in.",
    badge: "Revenue Operations",
    examples: ["hubspot.com", "segment.com", "clearbit.com"],
    quickActions: ["mission", "pricing", "contacts"],
    featuresHighlight: ["custom", "summary", "pricing"],
    heroStat: "500",
    heroStatLabel: "accounts per list",
    dashboardLabel: "Account Operations",
    dashboardSub: "Your enriched and scored accounts",
    welcomeTitle: "Put your lists to work.",
    welcomeBody:
      "Import a list of company URLs, enrich and score them, then route the best ones straight to your CRM.",
    demoUrl: "https://segment.com",
    demoLabel: "Enrich Segment as a sample account",
    guideTip:
      "Account lists take a paste or a CSV of domains — each company is enriched and ICP-scored with its evidence attached.",
    discoverPack: null,
  },
  {
    id: "competitive-intel",
    starterPack: "ci",
    label: "Product Manager & Competitive Intelligence",
    shortLabel: "Product & CI",
    icon: "eye",
    color: "#7c3aed",
    job: "Track competitors' products, pricing, features and positioning — with evidence of every change.",
    jobs: [
      { text: "Watch competitor pricing, product and release pages", module: "compete" },
      { text: "Get alerted when a watched page changes, with the before and after", module: "compete" },
      { text: "Extract tiers, features and positioning into comparable profiles", module: "templates" },
      { text: "Route the changes that matter to your team", module: "workflows" },
    ],
    modules: ["compete", "templates", "workflows", "extract"],
    outcome: "Faster strategic response and roadmap decisions built on evidence, not tab-hopping.",
    firstStep: { label: "Start a competitor watchlist", to: "/watchlists" },
    tagline: "Monitor your competitors' pricing, messaging, and leadership — automatically.",
    subtitle:
      "Extract competitor pricing pages, track messaging changes, and surface leadership moves. Stay two steps ahead — without the manual research.",
    badge: "Competitive Analysis",
    examples: ["linear.app", "notion.so/pricing", "figma.com/pricing"],
    quickActions: ["pricing", "mission", "social"],
    featuresHighlight: ["pricing", "summary", "map"],
    heroStat: "5 min",
    heroStatLabel: "full competitor teardown",
    dashboardLabel: "Competitor Profiles",
    dashboardSub: "Your competitive intelligence database",
    welcomeTitle: "Build your competitive moat.",
    welcomeBody:
      "Paste any competitor URL to extract their pricing, messaging, and leadership. Save extractions to build a living competitor database.",
    demoUrl: "https://notion.so/pricing",
    demoLabel: "Watch us tear down Notion's pricing page",
    guideTip:
      "Try a competitor's pricing page — DatIQ extracts every tier, CTA, and messaging detail.",
    discoverPack: null,
  },
  {
    id: "pmm",
    starterPack: "ci",
    label: "Product Marketing Manager",
    shortLabel: "Product Marketing",
    icon: "megaphone",
    color: "#c026d3",
    job: "Keep battlecards current, sharpen messaging and back every claim with a source.",
    jobs: [
      { text: "Pull competitors' claims, pricing and customer proof, linked to the source", module: "templates" },
      { text: "Compare how you and your competitors appear to AI answer engines", module: "discover" },
      { text: "Monitor competitor messaging and comparison pages for changes", module: "compete" },
      { text: "Share evidence-backed briefs with sales", module: "connect" },
    ],
    modules: ["templates", "discover", "compete", "connect"],
    outcome: "More credible positioning and battlecards that stay current.",
    firstStep: { label: "Run the AI visibility & competitive brief", to: "/templates?key=ai_visibility_brief" },
    tagline: "Battlecards backed by evidence — and kept current automatically.",
    subtitle:
      "Extract competitor messaging, pricing and proof points with their sources, and see how your product shows up in search and AI answers.",
    badge: "Product Marketing",
    examples: ["linear.app", "asana.com/compare", "monday.com/pricing"],
    quickActions: ["pricing", "mission", "social"],
    featuresHighlight: ["pricing", "summary", "content"],
    heroStat: "1 page",
    heroStatLabel: "per evidence-backed battlecard",
    dashboardLabel: "Positioning Research",
    dashboardSub: "Your messaging and competitor evidence",
    welcomeTitle: "Positioning you can defend.",
    welcomeBody:
      "Paste a competitor's product or comparison page to pull their claims, pricing and proof — each linked to where it came from.",
    demoUrl: "https://linear.app",
    demoLabel: "Pull Linear's positioning and proof points",
    guideTip:
      "Customer Proof and AI Visibility templates return claims with their source link, ready for a battlecard.",
    discoverPack: "product_marketing",
  },
  {
    id: "seo",
    starterPack: "seo",
    label: "SEO, Content, AEO & GEO",
    shortLabel: "SEO & Content",
    icon: "search",
    color: "#0d9488",
    job: "Improve how pages are found and cited — in search, answer engines and AI.",
    jobs: [
      { text: "Audit a page for SEO, answer-engine and AI visibility", module: "discover" },
      { text: "Get a prioritised fix queue with ready-to-paste markup", module: "discover" },
      { text: "Map a site's headings, links and structure", module: "extract" },
      { text: "Turn competitor pages into content briefs", module: "templates" },
      { text: "Re-audit on a schedule and watch the trend", module: "discover" },
    ],
    modules: ["discover", "extract", "templates"],
    outcome: "Faster audits, clearer technical priorities and content that answer engines can cite.",
    firstStep: { label: "Run your first visibility audit", to: "/discoverability" },
    tagline: "Audit any site's structure, headings, and link profile — no setup required.",
    subtitle:
      "Extract H1–H6 hierarchies, discover every internal and external link, and generate AI content briefs. Faster than any crawler.",
    badge: "SEO Analysis",
    examples: ["moz.com/blog", "ahrefs.com", "backlinko.com"],
    quickActions: ["social", "contacts", "mission"],
    featuresHighlight: ["headings", "links", "map"],
    heroStat: "H1→H6",
    heroStatLabel: "full heading audit",
    dashboardLabel: "Site Audits",
    dashboardSub: "Your SEO and content analysis library",
    welcomeTitle: "Audit any site in seconds.",
    welcomeBody:
      "Paste any URL and get a full heading structure, link profile, and AI content brief. Perfect for competitor analysis and content gap identification.",
    demoUrl: "https://moz.com/blog",
    demoLabel: "Audit Moz Blog's heading and link structure",
    guideTip:
      "Paste any page URL — you'll see the full H1–H6 structure, every link, and an instant AI content brief.",
    discoverPack: "seo",
  },
  {
    id: "brand-growth",
    starterPack: "discoverability",
    label: "Brand, Growth & CRO",
    shortLabel: "Brand & Growth",
    icon: "trending-up",
    color: "#ea580c",
    job: "Govern how your brand is represented, and connect discovery to conversion.",
    jobs: [
      { text: "Record the facts about your company, then check the web against them", module: "discover" },
      { text: "Measure how often AI answer engines cite you versus competitors", module: "discover" },
      { text: "Check that trust and proof on your pages are verifiable", module: "discover" },
      { text: "Find conversion friction on the pages people land on", module: "discover" },
      { text: "Monitor competitor offers and landing pages", module: "compete" },
    ],
    modules: ["discover", "compete", "templates"],
    outcome: "A consistent brand story, and landing pages that match what people were promised.",
    firstStep: { label: "Audit your brand's visibility", to: "/discoverability" },
    tagline: "Know how your brand is represented — and fix it where it counts.",
    subtitle:
      "Compare your truth record with what search and AI say about you, and find the friction between the answer and the landing page.",
    badge: "Brand & Growth",
    examples: ["notion.so", "canva.com", "miro.com"],
    quickActions: ["mission", "social", "pricing"],
    featuresHighlight: ["summary", "content", "headings"],
    heroStat: "1",
    heroStatLabel: "source of truth for your brand",
    dashboardLabel: "Brand Research",
    dashboardSub: "Your brand and landing-page evidence",
    welcomeTitle: "Own your brand's story.",
    welcomeBody:
      "Start with a visibility audit of your own site, then record the facts engines should repeat about you.",
    demoUrl: "https://canva.com",
    demoLabel: "See how Canva's homepage reads to answer engines",
    guideTip:
      "Discoverability's trust and conversion findings show where a page's proof or call to action lets visitors down.",
    discoverPack: "cro",
  },
  {
    id: "founder-vc",
    starterPack: "research",
    label: "Founder, VC & Market Research",
    shortLabel: "Founder & VC",
    icon: "zap",
    color: "#dc2626",
    job: "Research companies and markets fast — for diligence, market maps and validation.",
    jobs: [
      { text: "Generate a pre-meeting due-diligence brief from a URL", module: "templates" },
      { text: "Map a market: pricing, positioning and tech stack across many companies", module: "templates" },
      { text: "Research a batch of companies with the same fields for each", module: "extract" },
      { text: "Watch a market or portfolio for changes", module: "compete" },
      { text: "Export comparable profiles for memos and market maps", module: "connect" },
    ],
    modules: ["templates", "extract", "compete", "connect"],
    outcome: "Shorter research cycles and consistent, comparable diligence.",
    firstStep: { label: "Generate a due-diligence brief", to: "/templates?key=due_diligence_brief" },
    tagline: "Due diligence on any startup — team, product, and pricing in under a minute.",
    subtitle:
      "Get AI-powered company summaries, team structure, pricing models, and competitive positioning. All from a URL.",
    badge: "Due Diligence",
    examples: ["stripe.com", "figma.com", "notion.so"],
    quickActions: ["mission", "leadership", "pricing"],
    featuresHighlight: ["summary", "pricing", "custom"],
    heroStat: "10x",
    heroStatLabel: "faster due diligence",
    dashboardLabel: "Deal Pipeline",
    dashboardSub: "Your company research portfolio",
    welcomeTitle: "Your unfair diligence advantage.",
    welcomeBody:
      "Paste any startup URL to get an instant AI brief, team overview, and pricing analysis. Save extractions to build your deal research database.",
    demoUrl: "https://notion.so",
    demoLabel: "Run instant due diligence on Notion",
    guideTip:
      "The AI Summary gives you an instant company brief. Use Quick Enrichment to add leadership and pricing in one click.",
    discoverPack: null,
  },
  {
    id: "agency",
    starterPack: "discoverability",
    label: "Agency, Enterprise & Consultant",
    shortLabel: "Agency",
    icon: "building",
    color: "#1d4ed8",
    job: "Deliver repeatable audits, monitoring and intelligence across clients or business units.",
    jobs: [
      { text: "Run a client onboarding and competitive teardown", module: "templates" },
      { text: "Audit client sites for SEO, answer engines, local listings and trust", module: "discover" },
      { text: "Monitor client competitors on a schedule", module: "compete" },
      { text: "Deliver branded reports and share links", module: "connect" },
      { text: "Organise work in team workspaces", module: "workflows" },
    ],
    modules: ["templates", "discover", "compete", "connect", "workflows"],
    outcome: "Repeatable retainers, higher margins and evidence clients can act on.",
    firstStep: { label: "Run a client teardown", to: "/templates?key=agency_client_teardown" },
    tagline: "Extract at scale — your clients, their competitors, your data pipeline.",
    subtitle:
      "Bulk-extract client and competitor data, generate structured datasets, and export to CSV or PDF. Built for professional delivery.",
    badge: "Enterprise Scale",
    examples: ["hubspot.com", "salesforce.com", "marketo.com"],
    quickActions: ["mission", "pricing", "social"],
    featuresHighlight: ["map", "custom", "content"],
    heroStat: "∞",
    heroStatLabel: "pages extracted",
    dashboardLabel: "Client Research",
    dashboardSub: "Your extraction library",
    welcomeTitle: "Your extraction engine, at scale.",
    welcomeBody:
      "Extract any client or competitor site, enrich with one click, and export polished CSV or PDF reports. Built to deliver at agency speed.",
    demoUrl: "https://hubspot.com",
    demoLabel: "Extract HubSpot's full product landscape",
    guideTip:
      "Use domain mapping to discover a client's entire site structure, then export as a polished PDF report.",
    discoverPack: "agency_client",
  },
];

/**
 * Roles that still resolve but are not offered. Kept whole (not aliased)
 * because nothing among the eight is close to recruiting.
 */
export const LEGACY_PERSONAS = [
  {
    id: "recruiter",
    starterPack: "research",
    label: "Recruiter",
    shortLabel: "Recruiter",
    legacy: true,
    icon: "users",
    color: "#059669",
    job: "Surface leadership and hiring signals from company websites.",
    jobs: [
      { text: "Pull leadership teams and hiring signals from a company site", module: "templates" },
      { text: "Research a list of target companies in one batch", module: "extract" },
    ],
    modules: ["templates", "extract"],
    outcome: "A sourcing pipeline built from what companies publish.",
    firstStep: { label: "Source talent signals", to: "/templates?key=recruiter_talent_sourcing" },
    tagline:
      "Find leadership contacts and company culture signals from any company website — instantly.",
    subtitle:
      "Surface hiring pages, leadership team details, company culture, and contact emails. Build your sourcing pipeline without manual digging.",
    badge: "Talent Sourcing",
    examples: ["stripe.com/jobs", "notion.so/careers", "figma.com/about"],
    quickActions: ["leadership", "contacts", "social"],
    featuresHighlight: ["contacts", "summary", "links"],
    heroStat: "∞",
    heroStatLabel: "companies sourced",
    dashboardLabel: "Company Profiles",
    dashboardSub: "Your talent sourcing intelligence",
    welcomeTitle: "Source smarter, hire faster.",
    welcomeBody:
      "Paste any company URL to surface their leadership team, contact emails, and culture signals. Every saved extraction builds your sourcing database.",
    demoUrl: "https://stripe.com/jobs",
    demoLabel: "Extract Stripe's leadership and hiring signals",
    guideTip:
      "Enable 'Contacts & emails' to automatically surface leadership names, titles, and email addresses.",
    discoverPack: null,
  },
];

/** Retired ids that now mean another role. */
export const LEGACY_PERSONA_ALIASES = Object.freeze({
  "market-research": "founder-vc",
});

/** Every id a stored value may hold: the eight, the legacy role, the aliases. */
export const ALL_PERSONA_IDS = Object.freeze([
  ...PERSONAS.map((p) => p.id),
  ...LEGACY_PERSONAS.map((p) => p.id),
  ...Object.keys(LEGACY_PERSONA_ALIASES),
]);

/** A stored id → the id to use now. Unknown ids come back unchanged. */
export function resolvePersonaId(id) {
  if (!id) return id;
  return LEGACY_PERSONA_ALIASES[id] || id;
}

const BY_ID = Object.fromEntries([...PERSONAS, ...LEGACY_PERSONAS].map((p) => [p.id, p]));

/** Looks up any stored id — current, legacy or aliased. */
export const PERSONA_BY_ID = Object.freeze({
  ...BY_ID,
  ...Object.fromEntries(Object.entries(LEGACY_PERSONA_ALIASES).map(([from, to]) => [from, BY_ID[to]])),
});
