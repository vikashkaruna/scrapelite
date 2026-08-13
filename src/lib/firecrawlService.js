// firecrawlService.js — turns a URL into { page_title, headings, links }.
//
// Architecture (V2 API layer):
//   UI → extractStructure() → /api/extract (Netlify Function) → Firecrawl API
//
// The VITE_FIRECRAWL_API_KEY is now a feature flag only — it tells the app
// whether to use the real API path or the mock path. The actual key lives in
// the Netlify Function and is never bundled into the browser.
//
// Mock path: no key configured → simulated delay + fixture data (dev / demo).
// Real path: key configured → calls /api/extract → Firecrawl (server-side).

import { hasFirecrawl } from "./config.js";
import { apiClient } from "./apiClient.js";
import {
  LUMIO_EXTRACTION,
  mockExtractionForUrl,
  mockCustomExtraction,
  mockDomainMap,
} from "../data/mockData.js";
import { hostOf, looksLikeHtml, hashContent } from "./utils.js";

const MOCK_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock path ─────────────────────────────────────────────────────────────────
async function mockScrape(url, options = {}) {
  await delay(MOCK_DELAY_MS);
  const base =
    hostOf(url) === "lumio.io" ? LUMIO_EXTRACTION : mockExtractionForUrl(url);
  const result = {
    url,
    page_title: base.page_title,
    headings: base.headings,
    links: base.links,
    ai_summary: base.ai_summary,
  };
  if (options.customPrompt) {
    result.custom_extraction = mockCustomExtraction(url, options.customPrompt);
  }
  return result;
}

async function mockMap(url) {
  await delay(MOCK_DELAY_MS);
  return mockDomainMap(url);
}

// ── HTML parser (browser-only — runs after the API returns raw HTML) ───────────
// The /api/extract function returns the raw Firecrawl JSON; the browser parses
// the HTML locally so the DOMParser API is still available here.
function parseHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const headings = Array.from(
    doc.querySelectorAll("h1, h2, h3, h4, h5, h6")
  )
    .map((el) => ({
      tag: el.tagName.toUpperCase(),
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((h) => h.text);

  const seen = new Set();
  const links = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    let href = a.getAttribute("href") || "";
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:")
    ) {
      continue;
    }
    try {
      href = new URL(href, baseUrl).href;
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

// ── Real path (via /api/extract) ──────────────────────────────────────────────
async function realScrape(url, options = {}) {
  const raw = await apiClient.extract(url, options);
  const data = raw?.data || raw || {};
  const html = data.html || data.rawHtml || "";
  const parsed = parseHtml(html, url);

  const result = {
    url,
    page_title: data.metadata?.title || parsed.page_title,
    headings: parsed.headings,
    links: parsed.links,
  };
  if (options.customPrompt) {
    result.custom_extraction =
      data.json || data.extract || data.llm_extraction || null;
    // Carry WHY an extraction came back empty. Without this the UI can only
    // say "No data returned", which reads identically whether the server has
    // no AI key, the AI chain errored, or the page genuinely has nothing to
    // extract — three very different things to act on.
    if (raw?._enrichment?.reason) {
      result.custom_extraction_reason = raw._enrichment.reason;
    }
  }
  // F36 — headless attribution. Surfaced in the UI so the user knows
  // whether JS was actually executed.
  if (raw && raw._headless) {
    result._headless = raw._headless;
  }
  return result;
}

async function realMap(url) {
  const raw = await apiClient.extract(url, { mapMode: true });
  // The function normalises the map response and adds `mapLinks`.
  return raw?.mapLinks || [];
}

// ── Paste-anything path (raw text / HTML, no network) ──────────────────────────
// When the user pastes content instead of a URL (a pricing table, an email
// thread, newsletter HTML…), we build the same { page_title, headings, links }
// structure locally. HTML is parsed with DOMParser; plain text is wrapped so the
// downstream AI summary / custom extraction still works. The pseudo-URL keeps the
// rest of the pipeline (save, enrichment store keyed by url) happy.
function buildStructureFromText(rawText, options = {}) {
  const text = String(rawText || "").trim();
  const pseudoUrl = options.pseudoUrl || `text://pasted-${hashContent(text)}`;

  if (looksLikeHtml(text)) {
    const parsed = parseHtml(text, "https://pasted.local/");
    return {
      url: pseudoUrl,
      page_title: parsed.page_title || "Pasted content",
      headings: parsed.headings,
      links: parsed.links,
      is_pasted: true,
      raw_text: text,
    };
  }

  // Plain text: derive a title from the first non-empty line; keep the body as
  // a single content blob the summarizer/custom-extractor can read.
  const firstLine = text.split(/\n/).map((l) => l.trim()).find(Boolean) || "Pasted text";
  return {
    url: pseudoUrl,
    page_title: firstLine.slice(0, 120),
    headings: [{ tag: "H1", text: firstLine.slice(0, 120) }],
    links: [],
    is_pasted: true,
    raw_text: text,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Map an entire domain — discover its indexed URLs.
 * @param {string} url
 * @returns {Promise<object>}
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
  // Paste-anything: when options.rawText is present, skip the network entirely and
  // build the structure from the pasted content (handles raw text + HTML).
  if (options.rawText) {
    return buildStructureFromText(options.rawText, { pseudoUrl: url });
  }
  if (options.mapMode) return mapDomain(url);
  return hasFirecrawl ? realScrape(url, options) : mockScrape(url, options);
}
