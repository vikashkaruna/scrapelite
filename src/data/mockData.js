// mockData.js — demo payloads used when no real API keys are configured.
// Mirrors the shape of the Supabase `extractions` table so the mock path and
// the real path are interchangeable.

// The page the demo "extracts" on Home: a SaaS landing page for "Lumio".
export const LUMIO_EXTRACTION = {
  url: "https://lumio.io",
  page_title: "Lumio — Product analytics that actually make sense",
  ai_summary:
    "Lumio is a product-analytics platform aimed at fast-moving teams who want clarity without a data-science degree. The landing page leads with a bold value proposition — turning raw event data into plain-language insight — and frames the product around three pillars: real-time dashboards, automated reporting, and privacy-first data handling. Social proof is heavy throughout, citing 4,000+ teams and named customer logos. Pricing is presented in three tiers (Starter, Growth, Enterprise) with a prominent free-trial call-to-action repeated at the top, mid-page, and in the footer. The overall intent is lead generation: nearly every section funnels visitors toward starting a free trial or booking a demo.",
  headings: [
    { tag: "H1", text: "Product analytics that actually make sense" },
    { tag: "H2", text: "Built for teams who move fast" },
    { tag: "H3", text: "Real-time dashboards" },
    { tag: "H3", text: "Automated reports, zero spreadsheets" },
    { tag: "H3", text: "Privacy-first by design" },
    { tag: "H2", text: "Loved by 4,000+ product teams" },
    { tag: "H4", text: "“We cut our reporting time in half.”" },
    { tag: "H4", text: "“The dashboards just make sense.”" },
    { tag: "H2", text: "Simple, transparent pricing" },
    { tag: "H3", text: "Starter" },
    { tag: "H3", text: "Growth" },
    { tag: "H3", text: "Enterprise" },
    { tag: "H5", text: "Frequently asked questions" },
    { tag: "H6", text: "Is there a free trial?" },
    { tag: "H6", text: "Can I export my data?" },
    { tag: "H2", text: "Start your free trial today" },
  ],
  links: [
    { text: "Product", href: "https://lumio.io/product" },
    { text: "Features", href: "https://lumio.io/features" },
    { text: "Pricing", href: "https://lumio.io/pricing" },
    { text: "Customers", href: "https://lumio.io/customers" },
    { text: "Integrations", href: "https://lumio.io/integrations" },
    { text: "Documentation", href: "https://docs.lumio.io" },
    { text: "API Reference", href: "https://docs.lumio.io/api" },
    { text: "Blog", href: "https://lumio.io/blog" },
    { text: "Changelog", href: "https://lumio.io/changelog" },
    { text: "Log in", href: "https://app.lumio.io/login" },
    { text: "Start free trial", href: "https://app.lumio.io/signup" },
    { text: "Book a demo", href: "https://lumio.io/demo" },
    { text: "Contact sales", href: "https://lumio.io/contact" },
    { text: "About us", href: "https://lumio.io/about" },
    { text: "Careers — we're hiring", href: "https://lumio.io/careers" },
    { text: "Security", href: "https://lumio.io/security" },
    { text: "System status", href: "https://status.lumio.io" },
    { text: "Privacy Policy", href: "https://lumio.io/legal/privacy" },
    { text: "Terms of Service", href: "https://lumio.io/legal/terms" },
    { text: "Twitter / X", href: "https://twitter.com/lumiohq" },
    { text: "LinkedIn", href: "https://linkedin.com/company/lumio" },
    { text: "GitHub", href: "https://github.com/lumio" },
  ],
};

// ── V2 mock helpers ────────────────────────────────────────────────────────
// Used by firecrawlService when no real Firecrawl key is configured, so the new
// V2 features (custom extraction, contacts, domain mapping) are fully demoable.

function brandFromUrl(url) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
  const brand = (host.split(".")[0] || "site").replace(/^\w/, (c) => c.toUpperCase());
  return { host, brand };
}

// Synthetic senior-leadership / board contacts for the Contacts & Emails toggle.
export function mockContacts(url) {
  const { host, brand } = brandFromUrl(url);
  const domain = host.replace(/^www\./, "");
  return [
    { name: "Jordan Avery", title: "Chief Executive Officer", email: `jordan.avery@${domain}` },
    { name: "Priya Raman", title: "Chief Financial Officer", email: `priya.raman@${domain}` },
    { name: "Marcus Lee", title: "Chief Technology Officer", email: `marcus.lee@${domain}` },
    { name: "Elena Fischer", title: "VP, Marketing", email: `elena.fischer@${domain}` },
    { name: "Daniel Okoro", title: "Board Member", email: `daniel.okoro@${domain}` },
    { name: `${brand} Press Office`, title: "General Inquiries", email: `hello@${domain}` },
  ];
}

// Synthetic structured output for an arbitrary custom prompt. Inspects the
// prompt for intent so the demo returns shape-appropriate data.
export function mockCustomExtraction(url, prompt) {
  const { host, brand } = brandFromUrl(url);
  const p = String(prompt || "").toLowerCase();

  if (/contact|email|leadership|board|executive|founder/.test(p)) {
    return { contacts: mockContacts(url) };
  }
  if (/social|linkedin|twitter|facebook|instagram|youtube|github/.test(p)) {
    return {
      social_links: {
        linkedin: `https://linkedin.com/company/${host.split(".")[0]}`,
        twitter: `https://twitter.com/${host.split(".")[0]}`,
        github: `https://github.com/${host.split(".")[0]}`,
        youtube: `https://youtube.com/@${host.split(".")[0]}`,
      },
    };
  }
  if (/price|pricing|plan|tier|cost/.test(p)) {
    return {
      plans: [
        { name: "Starter", price: "$0", period: "forever", features: ["1 project", "Community support"] },
        { name: "Growth", price: "$49", period: "month", features: ["Unlimited projects", "Priority support", "Integrations"] },
        { name: "Enterprise", price: "Custom", period: "—", features: ["SSO & SAML", "Dedicated CSM", "SLA"] },
      ],
    };
  }
  if (/mission|value proposition|what.*do/.test(p)) {
    return {
      mission: `${brand} helps fast-moving teams turn complexity into clarity.`,
      value_proposition: `${brand} delivers measurable outcomes with a zero-code experience.`,
      summary: `${brand} is a modern platform focused on speed, simplicity, and trust.`,
    };
  }
  // Generic fallback: a couple of plausible fields derived from the prompt.
  return {
    query: String(prompt || "").trim(),
    result: `Structured data matching your request would appear here for ${brand}.`,
    source: url,
  };
}

// Synthetic site map (list of indexed URLs) for the "Map Entire Domain" toggle.
export function mockDomainMap(url) {
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = "https://" + String(url).replace(/^https?:\/\//, "").split("/")[0];
  }
  const paths = [
    "/", "/about", "/pricing", "/features", "/blog", "/contact", "/careers",
    "/docs", "/docs/getting-started", "/docs/api", "/integrations", "/customers",
    "/security", "/legal/privacy", "/legal/terms", "/login", "/signup",
    "/blog/announcing-v2", "/blog/how-we-scale", "/changelog",
  ];
  return paths.map((p) => origin + p);
}

// ── Pre-populated demo extractions shown on empty Dashboard ────────────────
// Each item uses _demo:true (hides checkbox + delete) and _saved:true so the
// view() path doesn't try to re-save them.

const STRIPE_DEMO = {
  id: "demo-stripe",
  _demo: true,
  _saved: true,
  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  url: "https://stripe.com/pricing",
  page_title: "Pricing & fees | Stripe",
  ai_summary:
    "Stripe's pricing page is structured around transparency and simplicity. The primary model is pay-as-you-go at 2.9% + 30¢ per successful card transaction with no setup or monthly fees. Specialised products — Radar for fraud, Billing for subscriptions, Connect for platforms — are individually priced. Enterprise custom pricing is available. The page is heavy on trust signals: named brands, precise fee tables, and a prominent FAQ section addressing common concerns about interchange, international cards, and refund handling.",
  headings: [
    { tag: "H1", text: "Simple, transparent pricing" },
    { tag: "H2", text: "Integrated per-transaction pricing" },
    { tag: "H3", text: "Card processing" },
    { tag: "H3", text: "Local payment methods" },
    { tag: "H2", text: "Products built for your business" },
    { tag: "H3", text: "Stripe Billing" },
    { tag: "H3", text: "Stripe Radar" },
    { tag: "H3", text: "Stripe Connect" },
    { tag: "H2", text: "Custom pricing for large-volume businesses" },
    { tag: "H2", text: "Frequently asked questions" },
  ],
  links: [
    { text: "Products", href: "https://stripe.com/products" },
    { text: "Developers", href: "https://stripe.com/developers" },
    { text: "Pricing", href: "https://stripe.com/pricing" },
    { text: "Documentation", href: "https://stripe.com/docs" },
    { text: "Sign in", href: "https://dashboard.stripe.com/login" },
    { text: "Contact sales", href: "https://stripe.com/contact/sales" },
  ],
  enrichments: {
    pricing: {
      key: "pricing",
      label: "Pricing & Plans",
      icon: "tag",
      prompt: "Extract all pricing tiers, costs, and key features for each plan.",
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      data: {
        plans: [
          { name: "Integrated", price: "2.9% + 30¢", period: "per successful card charge", features: ["No setup fees", "No monthly fees", "Pay-as-you-go"] },
          { name: "Custom", price: "Volume discounts", period: "contact sales", features: ["High-volume processing", "Multi-product discounts", "Country-specific rates"] },
        ],
        add_ons: [
          { name: "Stripe Radar", price: "5¢ per screened transaction" },
          { name: "Stripe Billing", price: "0.5%–0.8% of recurring revenue" },
          { name: "Stripe Connect", price: "0.25%+ per payout" },
        ],
      },
    },
  },
};

const APPLE_DEMO = {
  id: "demo-apple",
  _demo: true,
  _saved: true,
  created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  url: "https://www.apple.com",
  page_title: "Apple",
  ai_summary:
    "Apple's homepage serves as a curated editorial surface showcasing its latest flagship products — primarily iPhone, Mac, and services. The page is visually dominant with large hero images and minimal copy, relying on brand recognition rather than explanation. Navigation exposes the full product portfolio (iPhone, iPad, Mac, Watch, Vision, AirPods, TV, Music). The overall intent is product discovery and purchase initiation; every section ends with 'Learn more' or 'Shop' CTAs.",
  headings: [
    { tag: "H2", text: "iPhone 16 Pro" },
    { tag: "H3", text: "Hello, Apple Intelligence." },
    { tag: "H2", text: "MacBook Pro" },
    { tag: "H3", text: "Mind-blowing. Battery life that does too." },
    { tag: "H2", text: "Apple Intelligence" },
    { tag: "H3", text: "AI for the rest of us." },
    { tag: "H2", text: "Apple Watch Series 10" },
    { tag: "H2", text: "AirPods Pro" },
  ],
  links: [
    { text: "iPhone", href: "https://www.apple.com/iphone/" },
    { text: "Mac", href: "https://www.apple.com/mac/" },
    { text: "iPad", href: "https://www.apple.com/ipad/" },
    { text: "Watch", href: "https://www.apple.com/watch/" },
    { text: "Vision Pro", href: "https://www.apple.com/apple-vision-pro/" },
    { text: "AirPods", href: "https://www.apple.com/airpods/" },
    { text: "Apple TV+", href: "https://www.apple.com/apple-tv-plus/" },
    { text: "Apple Music", href: "https://www.apple.com/apple-music/" },
    { text: "Shop iPhone 16 Pro", href: "https://www.apple.com/shop/buy-iphone" },
    { text: "Learn more about Apple Intelligence", href: "https://www.apple.com/apple-intelligence/" },
  ],
  enrichments: {
    mission: {
      key: "mission",
      label: "Company Mission",
      icon: "target",
      prompt: "Extract the company's mission statement, value proposition, and core purpose.",
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      data: {
        mission: "Apple designs products that empower people and enrich their daily lives through innovative hardware, software, and services.",
        value_proposition: "The best technology in the world, crafted to be intuitive, beautiful, and deeply integrated across devices.",
        core_values: ["Privacy by design", "Environmental responsibility", "Accessibility for everyone", "Human-centred design"],
        tagline: "Think different.",
      },
    },
  },
};

const DELOITTE_DEMO = {
  id: "demo-deloitte",
  _demo: true,
  _saved: true,
  created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  url: "https://www2.deloitte.com",
  page_title: "Deloitte | Global professional services",
  ai_summary:
    "Deloitte's global homepage positions the firm as an integrated professional-services leader spanning audit, consulting, financial advisory, risk advisory, and tax. The page leads with thought-leadership content — industry outlooks, research reports, and executive perspectives — rather than explicit service pitches. Branding is built around scale (330,000+ professionals in 150+ countries) and trust. Navigation is deep: industry verticals, service lines, geography, and career entry points all compete for prominence. The overall intent is relationship and reputation building for C-suite buyers.",
  headings: [
    { tag: "H1", text: "Making an impact that matters" },
    { tag: "H2", text: "Insights" },
    { tag: "H3", text: "2025 Global Human Capital Trends" },
    { tag: "H3", text: "Tech Trends 2025" },
    { tag: "H3", text: "CFO Signals™ Survey" },
    { tag: "H2", text: "Services" },
    { tag: "H3", text: "Consulting" },
    { tag: "H3", text: "Audit & Assurance" },
    { tag: "H3", text: "Risk & Financial Advisory" },
    { tag: "H2", text: "Industries" },
    { tag: "H2", text: "About Deloitte" },
  ],
  links: [
    { text: "Consulting", href: "https://www2.deloitte.com/global/en/services/consulting.html" },
    { text: "Audit & Assurance", href: "https://www2.deloitte.com/global/en/services/audit.html" },
    { text: "Tax", href: "https://www2.deloitte.com/global/en/services/tax.html" },
    { text: "Risk Advisory", href: "https://www2.deloitte.com/global/en/services/risk.html" },
    { text: "Financial Advisory", href: "https://www2.deloitte.com/global/en/services/financial-advisory.html" },
    { text: "About Deloitte", href: "https://www2.deloitte.com/global/en/pages/about-deloitte/topics/about-deloitte.html" },
    { text: "Careers", href: "https://www2.deloitte.com/global/en/careers.html" },
    { text: "Press releases", href: "https://www2.deloitte.com/global/en/pages/about-deloitte/articles/press-releases.html" },
  ],
  enrichments: {
    contacts: {
      key: "contacts",
      label: "Find Contact Info",
      icon: "users",
      prompt: "Extract leadership contacts, executive emails, and key personnel.",
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      data: {
        contacts: [
          { name: "Joe Ucuzoglu", title: "Global CEO", email: "jucuzoglu@deloitte.com" },
          { name: "Punit Renjen", title: "Former Global CEO / Senior Advisor", email: "prenjen@deloitte.com" },
          { name: "Sharon Thorne", title: "Global Board Chair", email: "sthorne@deloitte.com" },
          { name: "Anthony Viel", title: "CEO, Deloitte Canada", email: "aviel@deloitte.ca" },
          { name: "General Inquiries", title: "Press Office", email: "press@deloitte.com" },
        ],
      },
    },
  },
};

export const DEMO_EXTRACTIONS = [STRIPE_DEMO, APPLE_DEMO, DELOITTE_DEMO];

// Generates a plausible mock extraction for an arbitrary URL (host-derived),
// so the demo works for any input, not just lumio.io.
export function mockExtractionForUrl(url) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
  const brand = (host.split(".")[0] || "site").replace(/^\w/, (c) => c.toUpperCase());
  const origin = `https://${host}`;

  return {
    url,
    page_title: `${brand} — Official website`,
    ai_summary:
      `${brand}'s page is organized around a clear primary message with supporting sections that build context and credibility. ` +
      `Navigation and call-to-action links point visitors toward learning more, getting started, or contacting the team.`,
    headings: [
      { tag: "H1", text: `Welcome to ${brand}` },
      { tag: "H2", text: "What we do" },
      { tag: "H3", text: "Key features" },
      { tag: "H3", text: "How it works" },
      { tag: "H2", text: "Why teams choose us" },
      { tag: "H4", text: "Trusted by growing companies" },
      { tag: "H2", text: "Get started today" },
    ],
    links: [
      { text: "Home", href: `${origin}/` },
      { text: "Features", href: `${origin}/features` },
      { text: "Pricing", href: `${origin}/pricing` },
      { text: "About", href: `${origin}/about` },
      { text: "Blog", href: `${origin}/blog` },
      { text: "Documentation", href: `${origin}/docs` },
      { text: "Log in", href: `${origin}/login` },
      { text: "Sign up", href: `${origin}/signup` },
      { text: "Twitter / X", href: "https://twitter.com" },
      { text: "LinkedIn", href: "https://linkedin.com" },
    ],
  };
}
