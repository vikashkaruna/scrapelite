// src/lib/extractionTemplates.js — Q5 (template / example library) data.
//
// 10–15 prebuilt extraction recipes. Each template is one click away:
// pasting the example URL with the intent + prompt pre-filled gives the
// user a structured, comparable result instead of a generic page summary.

export const EXTRACTION_TEMPLATES = [
  {
    key: "yc-companies",
    icon: "building-2",
    title: "Y Combinator company directory",
    desc: "Pull every YC company: name, blurb, founders, batch, and website.",
    exampleUrl: "https://www.ycombinator.com/companies",
    intent: "custom",
    prompt:
      "Extract company name, one-line description, founders, batch (e.g. W21), and website URL. Return a JSON array.",
    tags: ["leads", "startups", "directory"],
  },
  {
    key: "saas-pricing",
    icon: "tag",
    title: "SaaS pricing page",
    desc: "Turn any pricing page into a structured tier comparison.",
    exampleUrl: "https://stripe.com/pricing",
    intent: "pricing",
    tags: ["pricing", "competitor", "saas"],
  },
  {
    key: "job-board",
    icon: "briefcase",
    title: "Job postings scraper",
    desc: "Pull every open role: title, team, location, remote-friendly flag.",
    exampleUrl: "https://openai.com/careers",
    intent: "custom",
    prompt:
      "List every open job posting: title, department, location, and whether it's remote-friendly. Return a JSON array.",
    tags: ["jobs", "hiring", "research"],
  },
  {
    key: "leadership-contacts",
    icon: "users",
    title: "Leadership & board contacts",
    desc: "Surface emails + LinkedIn for founders, execs, and board members.",
    exampleUrl: "https://anthropic.com",
    intent: "contacts",
    tags: ["leads", "contacts"],
  },
  {
    key: "producthunt-launch",
    icon: "rocket",
    title: "Product Hunt launch brief",
    desc: "One-page product brief: tagline, features, makers, links.",
    exampleUrl: "https://www.producthunt.com",
    intent: "custom",
    prompt:
      "Extract the product name, tagline, short description, key features, maker names, and external links.",
    tags: ["marketing", "products"],
  },
  {
    key: "shopify-product",
    icon: "shopping-bag",
    title: "E-commerce product page",
    desc: "Title, price, variants, availability, reviews count.",
    exampleUrl: "https://www.allbirds.com",
    intent: "custom",
    prompt:
      "Extract product title, current price, currency, available variants, in-stock flag, and review count.",
    tags: ["ecommerce", "products", "research"],
  },
  {
    key: "seo-audit",
    icon: "search",
    title: "SEO audit basics",
    desc: "Headings, meta, canonical, schema, and OG tags.",
    exampleUrl: "https://www.anthropic.com",
    intent: "custom",
    prompt:
      "Return an object with: title, meta_description, h1 (array), h2 (array), canonical_url, og_image, json_ld_count.",
    tags: ["seo", "audit"],
  },
  {
    key: "tech-stack",
    icon: "code-2",
    title: "Tech stack fingerprint",
    desc: "Frameworks, analytics, hosting, and visible third-party scripts.",
    exampleUrl: "https://vercel.com",
    intent: "custom",
    prompt:
      "Identify front-end frameworks, analytics tools, hosting/CDN providers, and any third-party scripts visible in the source.",
    tags: ["research", "tech"],
  },
  {
    key: "competitor-pricing",
    icon: "trophy",
    title: "Competitor pricing snapshot",
    desc: "Side-by-side pricing comparison across 2+ companies.",
    exampleUrl: "https://linear.app/pricing",
    intent: "pricing",
    tags: ["competitor", "pricing"],
  },
  {
    key: "news-article",
    icon: "newspaper",
    title: "News article to JSON",
    desc: "Headline, author, date, summary, key entities.",
    exampleUrl: "https://techcrunch.com",
    intent: "custom",
    prompt:
      "Extract headline, author, publication date, summary (3 sentences), and 5 key entities (people/companies/products).",
    tags: ["news", "research"],
  },
  {
    key: "linkedin-profile",
    icon: "linkedin",
    title: "LinkedIn profile parse",
    desc: "Name, headline, current role, experience highlights.",
    exampleUrl: "https://www.linkedin.com",
    intent: "custom",
    prompt:
      "Extract the person's name, current headline, current company + title, and 3 most recent roles with start dates.",
    tags: ["leads", "contacts"],
  },
  {
    key: "github-repo",
    icon: "github",
    title: "GitHub repo overview",
    desc: "Stars, language, topics, README summary, last commit.",
    exampleUrl: "https://github.com/vercel/next.js",
    intent: "custom",
    prompt:
      "Extract repository name, owner, star count, primary language, topics, and a 2-sentence README summary.",
    tags: ["dev", "research"],
  },
];

export const TEMPLATE_TAGS = Array.from(
  new Set(EXTRACTION_TEMPLATES.flatMap((t) => t.tags)),
).sort();

export function getTemplateByKey(key) {
  return EXTRACTION_TEMPLATES.find((t) => t.key === key) || null;
}

export function filterTemplatesByTag(tag) {
  if (!tag || tag === "all") return EXTRACTION_TEMPLATES;
  return EXTRACTION_TEMPLATES.filter((t) => t.tags.includes(tag));
}
