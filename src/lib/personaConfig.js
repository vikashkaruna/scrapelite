// personaConfig.js — V4 persona definitions.
// Each persona shapes the Home hero, example chips, Dashboard labels, and onboarding messaging.

export const PERSONAS = [
  {
    id: "sales",
    label: "Sales / SDR / BDR",
    icon: "target",
    color: "#4f46e5",
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
      "Paste any company URL — ScrapeLite extracts contacts, leadership, and an AI summary in seconds.",
  },
  {
    id: "competitive-intel",
    label: "Competitive Intelligence",
    icon: "eye",
    color: "#7c3aed",
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
      "Try a competitor's pricing page — ScrapeLite extracts every tier, CTA, and messaging detail.",
  },
  {
    id: "seo",
    label: "SEO / Content Marketer",
    icon: "search",
    color: "#0d9488",
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
  },
  {
    id: "market-research",
    label: "Market Researcher",
    icon: "bar-chart",
    color: "#d97706",
    tagline: "Map your entire market landscape — one URL at a time.",
    subtitle:
      "Discover company missions, pricing structures, and leadership across any vertical. Build your research database at machine speed.",
    badge: "Market Research",
    examples: ["ycombinator.com", "a16z.com", "techcrunch.com"],
    quickActions: ["mission", "pricing", "leadership"],
    featuresHighlight: ["summary", "map", "pricing"],
    heroStat: "100s",
    heroStatLabel: "companies mapped/hour",
    dashboardLabel: "Research Database",
    dashboardSub: "Your structured market research",
    welcomeTitle: "Build your market map.",
    welcomeBody:
      "Paste any company URL to extract their mission, pricing model, and leadership. Use domain mapping to discover their entire web presence.",
    demoUrl: "https://stripe.com",
    demoLabel: "Map Stripe's full product and pricing landscape",
    guideTip:
      "Enable 'Map entire domain' to discover every URL on a site — perfect for comprehensive market research.",
  },
  {
    id: "recruiter",
    label: "Recruiter",
    icon: "users",
    color: "#059669",
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
  },
  {
    id: "founder-vc",
    label: "Startup Founder / VC",
    icon: "zap",
    color: "#dc2626",
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
  },
  {
    id: "agency",
    label: "Agency / Enterprise",
    icon: "building",
    color: "#1d4ed8",
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
  },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));
