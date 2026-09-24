// src/lib/outcomeTiles.js — Q3 (outcome tiles above hero) data.
//
// Two kinds of tile, told apart on screen:
//   · FILL tiles (the first seven) pre-wire the composer — URL + intent +
//     prompt — and the user still presses Extract.
//   · OPEN tiles (`open`) take the user to the module that does the job,
//     prefilling it from the composer's URL where that module accepts one.
//     They never start work, spend credits or save anything by themselves.
// The row holds 12 so it fills whole rows at 6 / 3 / 2 columns (owner,
// 2026-09-24). Engagement is a private beta, so for an account outside it the
// Engage tile is swapped for "Weekly pricing watch" and the count stays 12.
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

/** OPEN tiles — each goes to a module. `state(url)` builds that module's prefill. */
export const MODULE_TILES = [
  {
    key: "ai-visibility",
    icon: "scan-search",
    title: "AI visibility check",
    desc: "How search and AI engines see a page",
    color: "var(--accent-4, #10b981)",
    open: { module: "Discover", to: "/discoverability", state: (url) => (url ? { auditUrl: url } : undefined) },
  },
  {
    key: "watch-competitor",
    icon: "eye",
    title: "Watch a competitor",
    desc: "Get alerted when their pages change",
    color: "var(--accent-3, #f59e0b)",
    open: { module: "Watchlists", to: "/watchlists" },
  },
  {
    key: "account-brief",
    icon: "file-text",
    title: "Account brief",
    desc: "A sales-ready brief from one domain",
    color: "var(--accent, #4f46e5)",
    open: { module: "Templates", to: "/templates?key=account_brief" },
  },
  {
    key: "outreach",
    icon: "users",
    title: "Start an outreach campaign",
    desc: "Reviewed, consent-checked drafts",
    color: "var(--accent-6, #8b5cf6)",
    requiresEngagement: true,
    open: { module: "Engagement", to: "/engagement", beta: true },
  },
  {
    key: "send-to-crm",
    icon: "share",
    title: "Send results to your CRM",
    desc: "HubSpot, Notion, Airtable, Slack, Sheets",
    color: "var(--accent-5, #ec4899)",
    open: { module: "Integrations", to: "/integrations" },
  },
];

/** Shown in place of the Engagement tile for accounts outside the beta. */
export const PRICING_WATCH_TILE = {
  key: "pricing-watch",
  icon: "calendar-clock",
  title: "Weekly pricing watch",
  desc: "Re-check a pricing page every week",
  color: "var(--accent-2, #06b6d4)",
  open: {
    module: "Schedules",
    to: "/schedules",
    state: (url) => ({
      openEditor: true,
      draftSchedule: { type: "track", target: url || "https://stripe.com/pricing", intent: "pricing", cadenceKey: "weekly" },
    }),
  },
};

/**
 * The 12 tiles for this visitor. `engageAccess` is true only when the server
 * said this account is in the Engagement beta; unknown or failed reads get
 * the pricing-watch tile, so the row never advertises a page that refuses them.
 */
export function homeTiles({ engageAccess = false } = {}) {
  const modules = MODULE_TILES.map((t) => (t.requiresEngagement && !engageAccess ? PRICING_WATCH_TILE : t));
  return [...OUTCOME_TILES, ...modules];
}

// Lookup helper for tile by key (used by tests + analytics).
export function getOutcomeTile(key) {
  return [...OUTCOME_TILES, ...MODULE_TILES, PRICING_WATCH_TILE].find((t) => t.key === key) || null;
}
