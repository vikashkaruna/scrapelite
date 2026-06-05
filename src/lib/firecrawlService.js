// firecrawlService.js — turns a URL into { page_title, headings, links }.
//
// • No VITE_FIRECRAWL_API_KEY  → mocked: a simulated ~2s delay + dummy data.
// • Key present                → real Firecrawl scrape, parsed in the browser.
//
// Both paths return the SAME shape, so the rest of the app never cares which
// one ran.

import { hasFirecrawl, FIRECRAWL_API_KEY } from "./config.js";
import { LUMIO_EXTRACTION, mockExtractionForUrl } from "../data/mockData.js";
import { hostOf } from "./utils.js";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
const MOCK_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock path ────────────────────────────────────────────────────────────────
async function mockScrape(url) {
  await delay(MOCK_DELAY_MS);
  // Use the rich Lumio fixture for the canonical demo host; generate a
  // host-derived fixture for anything else.
  const base = hostOf(url) === "lumio.io" ? LUMIO_EXTRACTION : mockExtractionForUrl(url);
  return {
    url,
    page_title: base.page_title,
    headings: base.headings,
    links: base.links,
    // Carry the fixture's curated summary as a hint so the demo shows rich copy;
    // aiService.summarize() uses it when present and generates one otherwise.
    ai_summary: base.ai_summary,
  };
}

// ── Real path ────────────────────────────────────────────────────────────────
// Parses an HTML string into the heading + link arrays our schema expects.
function parseHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .map((el) => ({
      tag: el.tagName.toUpperCase(),
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((h) => h.text);

  const seen = new Set();
  const links = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    let href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      continue;
    }
    try {
      href = new URL(href, baseUrl).href; // resolve relative URLs
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    const text = (a.textContent || "").replace(/\s+/g, " ").trim() || href;
    links.push({ text, href });
  }

  const page_title =
    (doc.querySelector("title")?.textContent || "").trim() ||
    headings[0]?.text ||
    hostOf(baseUrl);

  return { page_title, headings, links };
}

async function realScrape(url, options = {}) {
  const body = { url, formats: ["html"], onlyMainContent: false };
  // "Render JavaScript" → wait for client-side content to hydrate before capturing.
  if (options.renderJs) body.waitFor = 3000;

  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firecrawl request failed (${res.status}). ${detail}`.trim());
  }

  const json = await res.json();
  const data = json?.data || json || {};
  const html = data.html || data.rawHtml || "";
  const parsed = parseHtml(html, url);

  return {
    url,
    page_title: data.metadata?.title || parsed.page_title,
    headings: parsed.headings,
    links: parsed.links,
  };
}

/**
 * Extract a webpage's structure.
 * @param {string} url
 * @returns {Promise<{url:string, page_title:string, headings:Array, links:Array}>}
 */
export async function extractStructure(url, options = {}) {
  return hasFirecrawl ? realScrape(url, options) : mockScrape(url);
}
