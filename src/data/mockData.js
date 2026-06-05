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

// Seed history shown on the Dashboard the first time (already-saved extractions).
export const SEED_HISTORY = [
  {
    id: "ex_9f2a",
    created_at: "2026-06-04T15:42:00Z",
    url: "https://lumio.io",
    page_title: "Lumio — Product analytics that actually make sense",
    ai_summary:
      "A lead-generation landing page for a product-analytics SaaS, organized around real-time dashboards, automated reports, and privacy. Pricing is split into three tiers and nearly every section funnels toward a free trial.",
    headings: LUMIO_EXTRACTION.headings,
    links: LUMIO_EXTRACTION.links,
  },
  {
    id: "ex_7c10",
    created_at: "2026-06-04T11:08:00Z",
    url: "https://www.notion.so/help/guides",
    page_title: "Guides & tutorials — Notion Help Center",
    ai_summary:
      "A documentation hub indexing onboarding guides and tutorials by topic. Content is structured as nested categories with deep links into individual articles; the page is navigational rather than conversion-focused.",
    headings: [
      { tag: "H1", text: "Guides & tutorials" },
      { tag: "H2", text: "Getting started" },
      { tag: "H3", text: "Create your first page" },
      { tag: "H3", text: "Build a database" },
      { tag: "H2", text: "Collaboration" },
      { tag: "H3", text: "Share and permissions" },
      { tag: "H2", text: "Advanced" },
      { tag: "H3", text: "Formulas & relations" },
    ],
    links: [
      { text: "Getting started", href: "https://notion.so/help/getting-started" },
      { text: "Create a database", href: "https://notion.so/help/databases" },
      { text: "Keyboard shortcuts", href: "https://notion.so/help/shortcuts" },
      { text: "Import data", href: "https://notion.so/help/import" },
      { text: "API documentation", href: "https://developers.notion.com" },
      { text: "Contact support", href: "https://notion.so/help/contact" },
    ],
  },
  {
    id: "ex_4b88",
    created_at: "2026-06-03T09:21:00Z",
    url: "https://stripe.com/blog/state-of-payments-2026",
    page_title: "The State of Online Payments in 2026 — Stripe Blog",
    ai_summary:
      "A long-form editorial article reporting trends in online payments for 2026. It is structured around several data-backed sections, mixes outbound links to research and product pages, and ends with a newsletter subscription prompt.",
    headings: [
      { tag: "H1", text: "The State of Online Payments in 2026" },
      { tag: "H2", text: "Instant payouts go mainstream" },
      { tag: "H2", text: "Stablecoins enter the checkout" },
      { tag: "H3", text: "What this means for SMBs" },
      { tag: "H2", text: "Fraud, AI, and the new arms race" },
      { tag: "H2", text: "Subscribe for monthly insights" },
    ],
    links: [
      { text: "Read the full report (PDF)", href: "https://stripe.com/reports/payments-2026.pdf" },
      { text: "Stripe Payments", href: "https://stripe.com/payments" },
      { text: "Stripe Radar (fraud)", href: "https://stripe.com/radar" },
      { text: "Author: Dana Whitfield", href: "https://stripe.com/blog/authors/dana" },
      { text: "Subscribe to the newsletter", href: "https://stripe.com/newsletter" },
    ],
  },
  {
    id: "ex_2d54",
    created_at: "2026-06-01T17:55:00Z",
    url: "https://linear.app/pricing",
    page_title: "Pricing — Linear",
    ai_summary:
      "A pricing page presenting four plans from free to enterprise, each with a feature comparison. The copy is terse and product-led; CTAs emphasize self-serve signup over sales contact.",
    headings: [
      { tag: "H1", text: "Pricing" },
      { tag: "H2", text: "Free" },
      { tag: "H2", text: "Basic" },
      { tag: "H2", text: "Business" },
      { tag: "H2", text: "Enterprise" },
      { tag: "H3", text: "Compare all features" },
      { tag: "H4", text: "Frequently asked questions" },
    ],
    links: [
      { text: "Start building", href: "https://linear.app/signup" },
      { text: "Contact sales", href: "https://linear.app/contact/sales" },
      { text: "Compare plans", href: "https://linear.app/pricing#compare" },
      { text: "Read the docs", href: "https://linear.app/docs" },
      { text: "Switch from Jira", href: "https://linear.app/switch/jira" },
    ],
  },
];

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
