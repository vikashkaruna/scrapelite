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
