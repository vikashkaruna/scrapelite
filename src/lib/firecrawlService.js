// firecrawlService.js — turns a URL into { page_title, headings, links }.
//
// • No VITE_FIRECRAWL_API_KEY  → mocked: a simulated ~2s delay + dummy data.
// • Key present                → real Firecrawl scrape, parsed in the browser.
//
// V2 additions (both paths return the same superset shape):
// • options.customPrompt → run Firecrawl's llm-extraction (json) mode and return
//   the structured result on `custom_extraction`.
// • options.mapMode      → call Firecrawl's /map endpoint and return the list of
//   discovered URLs on `domain_map` (via mapDomain()).
//
// Both paths return the SAME shape, so the rest of the app never cares which
// one ran.

import { hasFirecrawl, FIRECRAWL_API_KEY } from "./config.js";
import {
  LUMIO_EXTRACTION,
  mockExtractionForUrl,
  mockCustomExtraction,
  mockDomainMap,
} from "../data/mockData.js";
import { hostOf } from "./utils.js";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const FIRECRAWL_ENDPOINT = `${FIRECRAWL_BASE}/scrape`;
const FIRECRAWL_MAP_ENDPOINT = `${FIRECRAWL_BASE}/map`;
const MOCK_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock path ────────────────────────────────────────────────────────────────
async function mockScrape(url, options = {}) {
  await delay(MOCK_DELAY_MS);
  // Use the rich Lumio fixture for the canonical demo host; generate a
  // host-derived fixture for anything else.
  const base = hostOf(url) === "lumio.io" ? LUMIO_EXTRACTION : mockExtractionForUrl(url);
  const result = {
    url,
    page_title: base.page_title,
    headings: base.headings,
    links: base.links,
    // Carry the fixture's curated summary as a hint so the demo shows rich copy;
    // aiService.summarize() uses it when present and generates one otherwise.
    ai_summary: base.ai_summary,
  };
  if (options.customPrompt) {
    result.custom_extraction = mockCustomExtraction(url, options.customPrompt);
  }
  return result;
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
  const formats = ["html"];
  const body = { url, formats, onlyMainContent: false };
  // "Render JavaScript" → wait for client-side content to hydrate before capturing.
  if (options.renderJs) body.waitFor = 3000;
  // Custom JSON Schema Extraction → Firecrawl's LLM extraction (json) mode.
  if (options.customPrompt) {
    formats.push("json");
    body.jsonOptions = { prompt: options.customPrompt };
  }

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

  const result = {
    url,
    page_title: data.metadata?.title || parsed.page_title,
    headings: parsed.headings,
    links: parsed.links,
  };
  // Firecrawl returns LLM-extraction output on `json` (v1) / `extract` (legacy).
  if (options.customPrompt) {
    result.custom_extraction = data.json || data.extract || data.llm_extraction || null;
  }
  return result;
}

// ── Domain mapping (Firecrawl /map) ───────────────────────────────────────────
async function realMap(url) {
  const res = await fetch(FIRECRAWL_MAP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firecrawl map request failed (${res.status}). ${detail}`.trim());
  }
  const json = await res.json();
  // /map returns { success, links: ["https://…", …] } (sometimes objects).
  const raw = json?.links || json?.data || [];
  return raw.map((l) => (typeof l === "string" ? l : l?.url)).filter(Boolean);
}

async function mockMap(url) {
  await delay(MOCK_DELAY_MS);
  return mockDomainMap(url);
}

/**
 * Map an entire domain — discover its indexed URLs without scraping each one.
 * @param {string} url
 * @returns {Promise<{url:string, page_title:string, domain_map:string[]}>}
 */
export async function mapDomain(url) {
  const links = hasFirecrawl ? await realMap(url) : await mockMap(url);
  return {
    url,
    page_title: `Site map — ${hostOf(url)}`,
    headings: [],
    links: [],
    domain_map: links,
  };
}

/**
 * Extract a webpage's structure.
 * @param {string} url
 * @param {{renderJs?:boolean, customPrompt?:string, mapMode?:boolean}} options
 * @returns {Promise<object>}
 */
export async function extractStructure(url, options = {}) {
  if (options.mapMode) return mapDomain(url);
  return hasFirecrawl ? realScrape(url, options) : mockScrape(url, options);
}
