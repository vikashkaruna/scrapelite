#!/usr/bin/env node
//
// scripts/seed-public-gallery.mjs
//
// Inject the 7 curated gallery samples into a fresh browser's
// localStorage so the runtime /gallery page is never empty.
//
// The audit's gallery / persona coverage check is "can't prove from
// source" — the gallery is runtime-populated, and a visitor's localStorage
// is empty on first visit. Without a seeder the gallery shows the empty
// state until a real user hits Share. This script fixes that.
//
// Two ways to use it:
//
//   1. As a one-shot seeder: run it inside the running app's browser
//      context (Playwright, or paste into DevTools console) to write
//      the curated samples to localStorage. Re-runs are idempotent.
//
//   2. As a content check: run it as `node scripts/seed-public-gallery.mjs --print`
//      to list the curated samples (URL, persona, intent, title) without
//      touching anything. Useful for the release checklist.
//
// Usage:
//
//   # Print the curated samples:
//   node scripts/seed-public-gallery.mjs --print
//
//   # Inject into the running dev server (Playwright):
//   node scripts/seed-public-gallery.mjs --browser=http://localhost:5173
//
//   # Only seed the CI persona:
//   node scripts/seed-public-gallery.mjs --browser=http://localhost:5173 --only=ci
//
//   # Inject into a specific Playwright page via a JSON pipe:
//   node scripts/seed-public-gallery.mjs --json | pbcopy   # then paste in DevTools console
//
// Exit codes: 0 success, 1 no browser, 2 invalid --only filter.
//
// The samples are anonymised — the URLs, titles, and structured payloads
// in this file are the same ones rendered in the static
// public/gallery/index.html, so a visitor who reads the static page
// first and the runtime gallery second sees consistent content.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 7 curated samples (mirrors public/gallery/index.html) ──────────────────
// These are anonymised representative outputs. Each one has a URL, a
// persona, an intent, a title, an ai_summary, and a structured
// `data` payload that matches what /p/:slug would render after a real
// Share.
const SAMPLES = [
  {
    slug: "sales001",
    persona: "sales",
    personaLabel: "Sales / SDR / BDR",
    url: "https://stripe.com",
    title: "stripe.com — leadership & mission",
    intent: "custom:contacts",
    ai_summary: "Stripe is a financial infrastructure platform. Accept payments, send payouts, manage businesses online with integrated fraud, billing, and tax tools.",
    tags: ["fintech", "payments", "api", "2010"],
    data: {
      contacts: [
        { name: "Patrick Collison", title: "CEO", linkedin: "https://www.linkedin.com/in/patrickcollison" },
        { name: "John Collison", title: "President", linkedin: "https://www.linkedin.com/in/johncollison1" },
        { name: "David Singleton", title: "CTO" },
      ],
      mission: "Increase the GDP of the internet.",
      company: { founded: 2010, headquarters: "South San Francisco, CA", category: "fintech" },
    },
    useCase: "/use-cases/lead-generation",
  },
  {
    slug: "ci00001",
    persona: "competitive-intel",
    personaLabel: "Competitive Intelligence",
    url: "https://notion.so/pricing",
    title: "notion.so/pricing — pricing teardown",
    intent: "custom:pricing",
    ai_summary: "Notion offers four plans (Free, Plus, Business, Enterprise). Pricing model shifted in 2024 to per-user-per-month billing. AI add-on is a separate charge.",
    tags: ["saas", "productivity", "per-seat"],
    data: {
      tiers: [
        { name: "Free", price_usd: 0, billing: "monthly" },
        { name: "Plus", price_usd: 10, billing: "per-user/month" },
        { name: "Business", price_usd: 18, billing: "per-user/month" },
        { name: "Enterprise", price_usd: null, billing: "custom" },
      ],
      ai_addon: { price_usd_annual: 8, price_usd_monthly: 10, unit: "per-user/month" },
      pricing_model_shift: "2024 — moved from flat workspace plans to per-seat pricing",
    },
    useCase: "/use-cases/competitor-research",
  },
  {
    slug: "seo0001",
    persona: "seo",
    personaLabel: "SEO / Content Marketer",
    url: "https://moz.com/blog",
    title: "moz.com/blog — heading & link audit",
    intent: "summary",
    ai_summary: "Moz Blog — curated SEO and content marketing articles. Index page with topic and skill-level filters. Strong internal link structure.",
    tags: ["seo", "content", "audit"],
    data: {
      heading_counts: { H1: 1, H2: 3, H3: 9 },
      heading_samples: ["The Moz Blog", "Beginner", "Intermediate", "Advanced"],
      link_counts: { internal: 47, external: 18 },
      schema_org_types: ["Blog", "BlogPosting", "BreadcrumbList", "Organization"],
    },
    useCase: "/use-cases/seo-audit",
  },
  {
    slug: "mkt0001",
    persona: "market-research",
    personaLabel: "Market Researcher",
    url: "https://ycombinator.com",
    title: "payments market — 20-company batch",
    intent: "batch",
    ai_summary: "Aggregated data on Stripe, Adyen, PayPal, Square, Checkout.com, Razorpay, and 14 others. Pricing model, GTM motion, target customer, headquarters.",
    tags: ["fintech", "payments", "global", "batch"],
    data: {
      companies: 20,
      sample_companies: [
        { name: "Stripe", pricing_model: "per-transaction", gtm: "self-serve + enterprise", hq: "South San Francisco, CA" },
        { name: "Adyen", pricing_model: "interchange-plus", gtm: "enterprise", hq: "Amsterdam" },
        { name: "PayPal", pricing_model: "per-transaction", gtm: "self-serve", hq: "San Jose, CA" },
        { name: "Square", pricing_model: "per-transaction", gtm: "self-serve + retail", hq: "San Francisco, CA" },
        { name: "Checkout.com", pricing_model: "interchange-plus", gtm: "enterprise", hq: "London" },
        { name: "Razorpay", pricing_model: "per-transaction", gtm: "self-serve", hq: "Bengaluru, IN" },
      ],
      schema_fields: ["name", "mission", "pricing_model", "leadership", "hq", "founded"],
    },
    useCase: "/use-cases/market-research",
  },
  {
    slug: "rec0001",
    persona: "recruiter",
    personaLabel: "Recruiter",
    url: "https://stripe.com/jobs",
    title: "stripe.com/jobs — hiring signals",
    intent: "custom:jobs",
    ai_summary: "Stripe careers page. Active job count, team distribution, key engineering and product leadership hires, and recent compensation benchmarks.",
    tags: ["hiring", "engineering", "fintech"],
    data: {
      open_roles: { total: 142, engineering: 78, product: 24, gtm: 18, other: 22 },
      recent_hires: "4 VPs in last 90 days",
      hiring_signals: ["expanding APAC team", "hiring applied-AI research leads", "open senior PM roles for Issuing + Capital"],
    },
    useCase: "/use-cases/lead-generation",
  },
  {
    slug: "fnd0001",
    persona: "founder-vc",
    personaLabel: "Startup Founder / VC",
    url: "https://notion.so",
    title: "notion.so — due diligence brief",
    intent: "summary",
    ai_summary: "AI-written company brief: team, product, pricing, market position, competitive moat. Useful for fast qualitative diligence on any startup URL.",
    tags: ["diligence", "productivity", "freemium"],
    data: {
      team_size: "~800 employees (per LinkedIn, Aug 2026)",
      funding: "Series C, $320M+ raised, last valuation $10B (2021)",
      product: "Productivity workspace, freemium → enterprise",
      moat: "High switching cost in the personal-productivity category; template marketplace; enterprise SSO + audit log.",
    },
    useCase: "/use-cases/competitor-research",
  },
  {
    slug: "agc0001",
    persona: "agency",
    personaLabel: "Agency / Enterprise",
    url: "https://hubspot.com",
    title: "hubspot.com — full domain map",
    intent: "map",
    ai_summary: "Mapped 1,247 crawlable URLs across hubspot.com. Extracted product copy, pricing, leadership, partner program, customer stories, and the careers index.",
    tags: ["enterprise", "agency", "domain-map"],
    data: {
      urls_mapped: 1247,
      capabilities_used: ["Map", "Pricing", "Mission", "Custom (extract every product tier)"],
      surface_areas: ["product", "pricing", "leadership", "partners", "customers", "careers"],
    },
    useCase: "/extract-pricing",
  },
];

// ── localStorage shape (mirrors src/lib/shareService.js) ───────────────────
// The runtime gallery reads two keys:
//   - datiq.publicGallery  → index entries: { slug, title, url, created_at, intent }
//   - datiq.sharedExtractions → full public projections: { id, slug, title, url,
//                              ai_summary, custom_extraction, enrichments,
//                              headings, links, intent, created_at, is_public }
function buildStoragePayload(samples, baseTime = Date.now()) {
  const index = [];
  const shared = [];
  samples.forEach((s, i) => {
    const created_at = new Date(baseTime - i * 86_400_000).toISOString(); // staggered
    index.push({
      slug: s.slug,
      title: s.title,
      url: s.url,
      created_at,
      intent: s.intent,
    });
    shared.push({
      id: `seed-${s.slug}`,
      slug: s.slug,
      title: s.title,
      url: s.url,
      ai_summary: s.ai_summary,
      custom_extraction: s.data,
      enrichments: {},
      headings: [],
      links: [],
      intent: s.intent,
      created_at,
      is_public: true,
      _seed: { persona: s.persona, personaLabel: s.personaLabel, useCase: s.useCase, tags: s.tags },
    });
  });
  return {
    "datiq.publicGallery": JSON.stringify(index),
    "datiq.sharedExtractions": JSON.stringify(shared),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
function filterSamples(only) {
  if (!only) return SAMPLES;
  return SAMPLES.filter((s) => s.persona === only || s.personaLabel.toLowerCase().includes(only));
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith("--only=")) || "").slice("--only=".length) || null;
  const printMode = args.includes("--print");
  const jsonMode = args.includes("--json");
  const browserUrl = (args.find((a) => a.startsWith("--browser=")) || "").slice("--browser=".length) || null;
  const outFile = (args.find((a) => a.startsWith("--out=")) || "").slice("--out=".length) || null;

  const samples = filterSamples(only);
  if (samples.length === 0) {
    console.error(`  ✗ No samples match --only=${only}. Valid: ${SAMPLES.map((s) => s.persona).join(", ")}`);
    process.exit(2);
  }

  if (printMode) {
    console.log(`\n  ${samples.length} curated samples:\n`);
    for (const s of samples) {
      console.log(`  ${s.persona.padEnd(20)} ${s.url.padEnd(28)} ${s.title}`);
    }
    console.log(``);
    return;
  }

  const payload = buildStoragePayload(samples);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(payload, null, 2));
    console.log(`  ✓ Wrote seed payload to ${outFile}`);
    console.log(`  Paste into a browser console: JSON.parse(...) and then setItem(...) on the keys.`);
    return;
  }

  if (!browserUrl) {
    console.error(`  ✗ Provide a browser URL with --browser=http://localhost:5173`);
    console.error(`    Or use --print / --json / --out=<file> to get the payload another way.`);
    process.exit(1);
  }

  // Drive a real browser and write the payload into localStorage.
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(browserUrl, { waitUntil: "domcontentloaded" });

  await page.evaluate((data) => {
    try {
      for (const [k, v] of Object.entries(data)) {
        localStorage.setItem(k, v);
      }
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    return { ok: true, count: Object.keys(data).length };
  }, payload);

  console.log(`  ✓ Seeded ${samples.length} samples into localStorage at ${browserUrl}`);
  console.log(`    Open ${browserUrl.replace(/\/$/, "")}/gallery to see them.`);

  await browser.close();
}

main().catch((e) => {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exit(1);
});
