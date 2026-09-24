// src/lib/outcomeTiles.js — Q3 (outcome tiles above hero) data.
//
// 6 jobs-to-be-done tiles that pre-wire an enrichment so a one-click paste
// gives the user a usable structured answer, not just a generic page summary.
// The tile's `url` is a representative public example; the `prompt` drives
// the AI custom extraction and produces a structured JSON answer the
// Preview page renders as the "Overview" tab.

export const OUTCOME_TILES = [
  {
    key: "lead",
    icon: "users",
    title: "Build a lead list",
    desc: "Surface contacts & emails from a page",
    color: "var(--accent, #4f46e5)",
    example: { url: "https://www.ycombinator.com/companies", intent: "contacts" },
    prompt: "Extract founder names, titles, emails, and LinkedIn URLs of leadership.",
  },
  {
    key: "pricing",
    icon: "tag",
    title: "Scrape pricing",
    desc: "Pull plan tiers, prices & features",
    color: "var(--accent-2, #06b6d4)",
    example: { url: "https://stripe.com/pricing", intent: "pricing" },
    prompt: "Extract every pricing tier, monthly + annual price, included features, and limits.",
  },
  {
    key: "competitor",
    icon: "trophy",
    title: "Competitor intel",
    desc: "Compare 2+ companies in seconds",
    color: "var(--accent-3, #f59e0b)",
    example: { url: "https://linear.app", intent: "summary" },
    prompt: "Summarize positioning, target customer, key features, and pricing in a comparable table.",
  },
  {
    key: "seo",
    icon: "search",
    title: "SEO audit",
    desc: "Headings, meta & content gaps",
    color: "var(--accent-4, #10b981)",
    example: { url: "https://www.anthropic.com", intent: "summary" },
    prompt: "List H1-H6 headings in order, page title, meta description, and any JSON-LD schemas.",
  },
  {
    key: "techstack",
    icon: "code-2",
    title: "Tech stack",
    desc: "Discover frameworks & integrations",
    color: "var(--accent-5, #ec4899)",
    example: { url: "https://vercel.com", intent: "summary" },
    prompt: "Identify front-end frameworks, analytics, hosting, CDNs, and any visible third-party scripts.",
  },
  {
    key: "jobs",
    icon: "briefcase",
    title: "Job postings",
    desc: "Extract open roles in one paste",
    color: "var(--accent-6, #8b5cf6)",
    example: { url: "https://openai.com/careers", intent: "summary" },
    prompt: "List every open job title, department, location, and remote-friendly flag.",
  },
  {
    // Moved from the retired "What can DatIQ extract" grid (owner 2026-09-24):
    // content generation was the one capability no chip or tile offered.
    key: "content",
    icon: "wand",
    title: "Write a content brief",
    desc: "SEO outline & brief from a page",
    color: "var(--accent-2, #06b6d4)",
    example: { url: "https://www.notion.so/product", intent: "summary" },
    prompt: "Write an SEO content brief for this page's topic: target keyword, search intent, recommended H1 and H2 outline, questions to answer, and a suggested word count.",
  },
];

// Lookup helper for tile by key (used by tests + analytics).
export function getOutcomeTile(key) {
  return OUTCOME_TILES.find((t) => t.key === key) || null;
}
