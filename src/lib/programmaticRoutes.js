// src/lib/programmaticRoutes.js — F11 (programmatic SEO routes).
//
// Single source of truth for /for-* and /extract-* landing pages. Each entry
// describes the URL, page title, meta description, H1, subhead, and the
// persona-aligned call-to-action. Routes are rendered by the ProgrammaticRoute
// component using this data, so adding a new long-tail page is a one-line edit.

export const PROGRAMMATIC_ROUTES = {
  // ── Persona landing pages (/for-*) ────────────────────────────────────
  "for-sales": {
    kind: "persona",
    persona: "sales",
    personaLabel: "Sales / SDR / BDR",
    icon: "target",
    h1: "DatIQ for sales teams",
    sub: "Turn any company website into a qualified prospect — leadership contacts, pricing, mission, and an AI brief — in under 30 seconds.",
    description:
      "DatIQ for sales: extract contacts, leadership, pricing, and tech stack from any company URL in 30 seconds. Built for SDRs and BDRs who need to prospect at scale without copy-paste.",
    ctaPrimary: { label: "Try a HubSpot prospect extraction", href: "/", prefilled: "https://hubspot.com", intent: "contacts" },
    ctaSecondary: { label: "See the Sales Pack", href: "/onboarding?persona=sales" },
    keywords: ["sales prospecting", "lead generation", "SDR tool", "BDR tool", "company enrichment"],
    bullets: [
      "Extract leadership contacts and emails from any company page",
      "Get a company brief (mission, team, pricing, recent posts) in 30 seconds",
      "Map an entire site to find case studies, careers, and product pages",
      "Export to CSV or HubSpot-compatible JSON in one click",
    ],
  },
  "for-seo": {
    kind: "persona",
    persona: "seo",
    personaLabel: "SEO / Content Marketer",
    icon: "search",
    h1: "DatIQ for SEO teams",
    sub: "Audit any site's heading structure, link profile, and content gaps — no setup, no crawler config, no monthly bill.",
    description:
      "DatIQ for SEO: extract H1–H6, internal/external links, meta tags, schema, and OG data from any URL. Build content briefs in minutes, not days.",
    ctaPrimary: { label: "Try a competitor SEO audit", href: "/", prefilled: "https://www.anthropic.com", intent: "summary" },
    ctaSecondary: { label: "See the SEO Pack", href: "/onboarding?persona=seo" },
    keywords: ["seo audit", "content brief", "competitor analysis", "heading structure", "link profile"],
    bullets: [
      "Pull every H1–H6 in document order, with the anchor text of every link",
      "Discover internal link gaps and orphan-page candidates",
      "Generate content briefs from competitor articles in one click",
      "Compare two URLs side-by-side (the Battle-card generator)",
    ],
  },
  "for-ci": {
    kind: "persona",
    persona: "competitive-intel",
    personaLabel: "Competitive Intelligence",
    icon: "eye",
    h1: "DatIQ for competitive intelligence",
    sub: "Monitor competitor pricing, messaging, and leadership changes — automatically. The full competitor teardown in 5 minutes.",
    description:
      "DatIQ for competitive intelligence: track competitor pricing pages, monitor leadership changes, and surface messaging updates. Schedule a weekly digest or get pinged the moment a page changes.",
    ctaPrimary: { label: "Try a Notion pricing teardown", href: "/", prefilled: "https://notion.so/pricing", intent: "pricing" },
    ctaSecondary: { label: "See the CI Pack", href: "/onboarding?persona=competitive-intel" },
    keywords: ["competitive intelligence", "competitor monitoring", "pricing tracker", "market intel"],
    bullets: [
      "Extract every pricing tier, CTA, and feature comparison table",
      "Schedule daily/weekly monitoring with email alerts on change",
      "Map an entire competitor site to discover new product pages and posts",
      "Generate a side-by-side battle-card with the comparison generator",
    ],
  },

  // ── Industry landing pages (/for-*) ──────────────────────────────────
  "for-finance": {
    kind: "industry",
    industry: "finance",
    industryLabel: "Financial Services & FinTech",
    icon: "dollar-sign",
    h1: "DatIQ for financial services & fintech",
    sub: "Turn company filings, fee schedules, executive changes, and regulatory disclosures into structured intelligence in seconds.",
    description:
      "DatIQ for financial services: extract pricing tiers, corporate disclosures, executive rosters, and fintech fee structures from any web page without code.",
    ctaPrimary: { label: "Try a Stripe pricing extraction", href: "/", prefilled: "https://stripe.com/pricing", intent: "pricing" },
    ctaSecondary: { label: "Explore financial intelligence", href: "/use-cases/market-research" },
    keywords: ["financial web extraction", "fintech intelligence", "investment diligence", "financial data scraping", "fee extraction"],
    bullets: [
      "Extract structured fee schedules, pricing tiers, and currency options in one click",
      "Monitor executive appointments, board changes, and committee rosters",
      "Track quarterly disclosures and regulatory notice revisions automatically",
      "Export structured financial tables to Excel (.xlsx), CSV, or webhook pipelines",
    ],
  },
  "for-healthcare": {
    kind: "industry",
    industry: "healthcare",
    industryLabel: "Healthcare & Life Sciences",
    icon: "activity",
    h1: "DatIQ for healthcare & life sciences",
    sub: "Extract provider directories, clinical services, executive leadership, and compliance disclosures with source-level verification.",
    description:
      "DatIQ for healthcare: extract provider listings, clinic locations, medical leadership, and regulatory documentation from healthcare domains instantly.",
    ctaPrimary: { label: "Try a healthcare team extraction", href: "/", prefilled: "https://modernhealth.com", intent: "contacts" },
    ctaSecondary: { label: "Explore healthcare use cases", href: "/use-cases/account-intelligence" },
    keywords: ["healthcare web scraping", "life sciences intelligence", "provider extraction", "pharma intelligence", "clinic directory scraper"],
    bullets: [
      "Surface medical leadership, department heads, and verified credentials",
      "Extract clinic locations, contact directories, and accepted insurance plans",
      "Monitor policy updates, clinical trial announcements, and research publications",
      "Maintain 100% verifiable source links with timestamped change logs",
    ],
  },
  "for-retail": {
    kind: "industry",
    industry: "retail",
    industryLabel: "E-Commerce & Retail",
    icon: "tag",
    h1: "DatIQ for e-commerce & retail",
    sub: "Track product catalogs, competitor pricing shifts, seasonal promotions, and brand positioning across thousands of storefronts.",
    description:
      "DatIQ for retail: extract SKU pricing, stock availability, promo banners, and competitor catalog hierarchies across e-commerce storefronts.",
    ctaPrimary: { label: "Try a competitor catalog extraction", href: "/", prefilled: "https://allbirds.com", intent: "pricing" },
    ctaSecondary: { label: "See competitive intelligence", href: "/use-cases/competitive-monitoring" },
    keywords: ["retail price intelligence", "ecommerce catalog scraping", "competitor pricing tracker", "ecommerce extraction", "sku price monitor"],
    bullets: [
      "Extract product tiers, currency options, discount codes, and promotion terms",
      "Map entire storefront domains to discover newly added collections and categories",
      "Schedule daily competitor pricing checks with instant threshold alerts",
      "Export directly to Google Sheets, CSV, or retail BI workflows",
    ],
  },
  "for-legal": {
    kind: "industry",
    industry: "legal",
    industryLabel: "Legal & Compliance",
    icon: "shield",
    h1: "DatIQ for legal & compliance",
    sub: "Extract terms of service revisions, privacy policy updates, regulatory filings, and partner directories with cryptographic audit proof.",
    description:
      "DatIQ for legal: monitor policy changes, extract attorney directories, and track compliance notices with verified timestamped evidence.",
    ctaPrimary: { label: "Extract OpenAI policies", href: "/", prefilled: "https://openai.com/policies", intent: "summary" },
    ctaSecondary: { label: "See due diligence brief", href: "/use-cases/investor-diligence" },
    keywords: ["legal compliance monitoring", "terms of service tracker", "regulatory extraction", "legal due diligence", "policy change alert"],
    bullets: [
      "Extract complete Terms of Service and Privacy Policy text with heading hierarchy",
      "Surface attorney rosters, practice areas, bar admissions, and direct contacts",
      "Monitor regulatory change notices and compliance updates on automated schedules",
      "Preserve objective page snapshots with permanent audit trail evidence",
    ],
  },

  // ── Programmatic SEO pages (/extract-*) ───────────────────────────────
  "extract-pricing": {
    kind: "extract",
    intent: "pricing",
    intentLabel: "Pricing",
    icon: "tag",
    h1: "Extract pricing from any web page",
    sub: "Paste any pricing URL. DatIQ returns every tier, feature, price, and CTA in a structured table — instantly.",
    description:
      "Extract structured pricing data from any web page. DatIQ pulls every tier name, price, currency, feature list, and CTA button into a JSON or CSV you can use immediately.",
    ctaPrimary: { label: "Extract Stripe's pricing now", href: "/", prefilled: "https://stripe.com/pricing", intent: "pricing" },
    ctaSecondary: { label: "View all pricing templates", href: "/#templates" },
    keywords: ["extract pricing", "pricing scraper", "competitor pricing", "pricing intelligence", "pricing api"],
    bullets: [
      "Works on tiered pricing, per-seat pricing, usage-based pricing, and contact-sales pages",
      "Returns JSON with tier names, prices, currencies, and feature lists",
      "Export to CSV for spreadsheets, or JSON for downstream pipelines",
      "Schedule a weekly digest to monitor competitor pricing changes",
    ],
  },
  "extract-contacts": {
    kind: "extract",
    intent: "contacts",
    intentLabel: "Contacts",
    icon: "users",
    h1: "Extract contacts from any web page",
    sub: "Paste any URL. DatIQ surfaces leadership names, emails, titles, and social profiles in a clean contact list.",
    description:
      "Extract contacts and emails from any web page. DatIQ surfaces leadership names, titles, emails, LinkedIn profiles, and Twitter handles — ready to export to your CRM.",
    ctaPrimary: { label: "Extract Anthropic's team page", href: "/", prefilled: "https://anthropic.com", intent: "contacts" },
    ctaSecondary: { label: "View the leadership template", href: "/#templates" },
    keywords: ["extract contacts", "leadership contacts", "email finder", "lead enrichment", "team scraper"],
    bullets: [
      "Pull founder, executive, and board-member names with titles and emails",
      "Capture LinkedIn, Twitter, and GitHub profiles for each contact",
      "Filter for seniority (C-suite, VP, Director) before export",
      "Export to CSV or HubSpot-compatible JSON",
    ],
  },
  "extract-headings": {
    kind: "extract",
    intent: "summary",
    intentLabel: "Headings",
    icon: "list-tree",
    h1: "Extract headings from any web page",
    sub: "Paste any URL. DatIQ returns the full H1–H6 outline in document order — perfect for SEO audits and content briefs.",
    description:
      "Extract the complete heading structure of any web page. DatIQ returns H1–H6 in document order, with text, tag, and level — ready for SEO audits, content briefs, and accessibility checks.",
    ctaPrimary: { label: "Extract Vercel's heading outline", href: "/", prefilled: "https://vercel.com", intent: "summary" },
    ctaSecondary: { label: "View the SEO audit template", href: "/#templates" },
    keywords: ["extract headings", "heading outline", "seo audit", "h1 h2 h3", "page structure"],
    bullets: [
      "Get every H1–H6 in document order with the original text",
      "Spot heading gaps and over-optimisation patterns",
      "Use the outline as a content brief input for AI writing tools",
      "Compare two URLs side-by-side with the battle-card generator",
    ],
  },
};

export function getRouteBySlug(slug) {
  return PROGRAMMATIC_ROUTES[slug] || null;
}

export function getAllSlugs() {
  return Object.keys(PROGRAMMATIC_ROUTES);
}
