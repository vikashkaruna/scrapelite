// scrapeProviders.js — Multi-provider web scraping with ordered fallback chain.
//
// Mirrors the aiProviders.js pattern so both extraction and enrichment degrade
// gracefully when a primary provider is down or unconfigured.
//
// Default chain: Firecrawl → Spider.cloud → Jina AI → Direct fetch
// Override with SCRAPE_PROVIDER_ORDER env var (comma-separated provider names).
//
// Server-side env vars (no VITE_ prefix except where noted for local dev):
//   FIRECRAWL_API_KEY  (or VITE_FIRECRAWL_API_KEY for netlify dev fallback)
//   SPIDER_API_KEY     — spider.cloud
//   JINA_API_KEY       — r.jina.ai (optional; unauthenticated requests work but rate-limited)
//   Direct fetch       — no key required
//
// Every scrape adapter returns: { ok, source, html, title, customExtraction }
// Every map  adapter returns:  { ok, source, mapLinks[] }

import { fetchPublicUrl } from "./publicUrl.js";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const SPIDER_BASE    = "https://api.spider.cloud/v1";
const JINA_BASE      = "https://r.jina.ai";

const TIMEOUT_MS = 20_000;

function abortAfter(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

// Basic markdown → HTML conversion so browser-side parseHtml() (DOMParser) can
// extract headings and anchor links from Jina's markdown output.
function mdToBasicHtml(md) {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ── Scrape adapters ────────────────────────────────────────────────────────────

async function scrapeFirecrawl(url, options, apiKey) {
  const formats = ["html"];
  const payload = { url, formats, onlyMainContent: false };
  if (options.renderJs) payload.waitFor = 3000;
  if (options.customPrompt) {
    formats.push("json");
    payload.jsonOptions = { prompt: options.customPrompt };
  }

  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
    clear();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: `Firecrawl ${res.status}: ${err?.error || ""}` };
    }
    const data = await res.json();
    const inner = data?.data || data || {};
    const html = inner.html || inner.rawHtml || "";
    if (!html) return { ok: false, error: "Firecrawl: empty html" };
    return {
      ok: true,
      source: "firecrawl",
      html,
      title: inner.metadata?.title || "",
      customExtraction: inner.json || inner.extract || inner.llm_extraction || null,
    };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

async function scrapeSpider(url, options, apiKey) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${SPIDER_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, return_format: "html", metadata: true }),
      signal,
    });
    clear();
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Spider ${res.status}` };
    }
    const data = await res.json();
    // Spider returns an array: [{ content, metadata }]
    const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data);
    const html = item?.content || "";
    if (!html) return { ok: false, error: "Spider: empty content" };
    return {
      ok: true,
      source: "spider",
      html,
      title: item?.metadata?.title || item?.metadata?.description || "",
      customExtraction: null,
    };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

async function scrapeJina(url, options, apiKey) {
  const headers = {
    Accept: "application/json",
    "X-Return-Format": "markdown",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  // Hint to Jina to wait for JS rendering when requested (best-effort)
  if (options.renderJs) headers["X-Wait-For-Selector"] = "body";

  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${JINA_BASE}/${encodeURIComponent(url)}`, { headers, signal });
    clear();
    if (!res.ok) return { ok: false, status: res.status, error: `Jina ${res.status}` };
    const data = await res.json();
    const inner = data?.data || {};
    const markdown = inner.content || inner.text || "";
    if (!markdown) return { ok: false, error: "Jina: empty content" };
    return {
      ok: true,
      source: "jina",
      // Convert markdown headings + links → HTML so browser parseHtml() works
      html: mdToBasicHtml(markdown),
      title: inner.title || inner.description || "",
      customExtraction: null,
    };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

async function scrapeDirect(url, _options, _apiKey) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetchPublicUrl(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (compatible; DatIQ/1.0; +https://datiq.app)",
        Accept:            "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal,
      redirect: "follow",
    });
    clear();
    if (!res.ok) return { ok: false, status: res.status, error: `Direct ${res.status}` };
    const html = await res.text();
    if (!html) return { ok: false, error: "Direct: empty response" };
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      ok: true,
      source: "direct",
      html,
      title: (titleMatch?.[1] || "").trim(),
      customExtraction: null,
    };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

// ── Map adapters ──────────────────────────────────────────────────────────────

async function mapFirecrawl(url, apiKey) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url }),
      signal,
    });
    clear();
    if (!res.ok) return { ok: false, status: res.status, error: `Firecrawl map ${res.status}` };
    const data = await res.json();
    const raw = data?.links || data?.data || [];
    const mapLinks = raw.map((l) => (typeof l === "string" ? l : l?.url)).filter(Boolean);
    return { ok: true, source: "firecrawl", mapLinks };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

async function mapSpider(url, apiKey) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${SPIDER_BASE}/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, limit: 200, return_format: "html", depth: 1, metadata: false }),
      signal,
    });
    clear();
    if (!res.ok) return { ok: false, status: res.status, error: `Spider crawl ${res.status}` };
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data?.data || []);
    const mapLinks = items.map((it) => it?.url).filter(Boolean);
    return { ok: true, source: "spider", mapLinks };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

async function mapDirect(url, _apiKey) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetchPublicUrl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DatIQ/1.0; +https://datiq.app)" },
      signal,
    });
    clear();
    if (!res.ok) return { ok: false, error: `Direct map ${res.status}` };
    const html = await res.text();
    // Regex-extract all href links; resolve relative to the base URL
    const base = new URL(url);
    const seen = new Set();
    const mapLinks = [];
    const hrefRe = /href=["']([^"'#?][^"']*)/gi;
    let m;
    while ((m = hrefRe.exec(html)) !== null) {
      try {
        const resolved = new URL(m[1], base).href;
        if (!seen.has(resolved) && /^https?:/.test(resolved)) {
          seen.add(resolved);
          mapLinks.push(resolved);
        }
      } catch { /* skip malformed hrefs */ }
    }
    return { ok: true, source: "direct", mapLinks };
  } catch (err) {
    clear();
    return { ok: false, error: err?.message || "fetch error" };
  }
}

// ── Provider registry ──────────────────────────────────────────────────────────

export const SCRAPE_PROVIDERS = {
  firecrawl: {
    label: "Firecrawl",
    keyEnv: "FIRECRAWL_API_KEY",
    keyEnvFallback: "VITE_FIRECRAWL_API_KEY",
    requiresKey: true,
    scrape: scrapeFirecrawl,
    map: mapFirecrawl,
  },
  spider: {
    label: "Spider.cloud",
    keyEnv: "SPIDER_API_KEY",
    keyEnvFallback: null,
    requiresKey: true,
    scrape: scrapeSpider,
    map: mapSpider,
  },
  jina: {
    label: "Jina AI Reader",
    keyEnv: "JINA_API_KEY",
    keyEnvFallback: null,
    requiresKey: false, // works without a key at lower rate limits
    scrape: scrapeJina,
    map: null,          // Jina has no crawl/map endpoint
  },
  direct: {
    label: "Direct fetch",
    keyEnv: null,
    keyEnvFallback: null,
    requiresKey: false,
    scrape: scrapeDirect,
    map: mapDirect,
  },
};

export const DEFAULT_SCRAPE_ORDER = ["firecrawl", "spider", "jina", "direct"];

function keyFor(providerKey) {
  const p = SCRAPE_PROVIDERS[providerKey];
  if (!p?.keyEnv) return "";
  return (
    process.env[p.keyEnv] ||
    (p.keyEnvFallback ? process.env[p.keyEnvFallback] : "") ||
    ""
  );
}

function resolveOrder() {
  const raw = process.env.SCRAPE_PROVIDER_ORDER || "";
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((p) => SCRAPE_PROVIDERS[p]);
  return parsed.length ? parsed : DEFAULT_SCRAPE_ORDER.slice();
}

// ── Chain runners ─────────────────────────────────────────────────────────────

/**
 * Run the scrape fallback chain — tries each provider in order until one succeeds.
 * @param {string} url
 * @param {{ renderJs?: boolean, customPrompt?: string }} options
 * @returns {Promise<{ ok, source?, html?, title?, customExtraction?, attempts, error? }>}
 */
export async function runScrapeChain(url, options = {}) {
  const chain = resolveOrder();
  const attempts = [];

  for (const providerKey of chain) {
    const p = SCRAPE_PROVIDERS[providerKey];
    const apiKey = keyFor(providerKey);

    if (p.requiresKey && !apiKey) {
      attempts.push({ provider: providerKey, skipped: "no-key" });
      continue;
    }

    try {
      const result = await p.scrape(url, options, apiKey);
      if (result.ok && result.html) {
        return { ...result, attempts };
      }
      attempts.push({ provider: providerKey, error: result.error || "empty result", status: result.status });
    } catch (err) {
      attempts.push({ provider: providerKey, error: err?.message || "exception" });
    }
  }

  return { ok: false, attempts, error: "All scrape providers failed or are unconfigured." };
}

/**
 * Run the map fallback chain — discover all URLs in a domain.
 * @param {string} url
 * @returns {Promise<{ ok, source?, mapLinks?, attempts, error? }>}
 */
export async function runMapChain(url) {
  const chain = resolveOrder();
  const attempts = [];

  for (const providerKey of chain) {
    const p = SCRAPE_PROVIDERS[providerKey];
    if (!p.map) {
      attempts.push({ provider: providerKey, skipped: "no-map-support" });
      continue;
    }
    const apiKey = keyFor(providerKey);
    if (p.requiresKey && !apiKey) {
      attempts.push({ provider: providerKey, skipped: "no-key" });
      continue;
    }

    try {
      const result = await p.map(url, apiKey);
      if (result.ok) {
        return { ...result, attempts };
      }
      attempts.push({ provider: providerKey, error: result.error || "failed" });
    } catch (err) {
      attempts.push({ provider: providerKey, error: err?.message || "exception" });
    }
  }

  return { ok: false, attempts, error: "All map providers failed or are unconfigured." };
}

/**
 * Report which providers have keys configured (used by admin diagnostics).
 * No secrets are returned — only boolean availability.
 */
export function scrapeProviderStatus() {
  const out = {};
  for (const [key, p] of Object.entries(SCRAPE_PROVIDERS)) {
    const hasKey = Boolean(keyFor(key));
    out[key] = {
      label: p.label,
      hasKey,
      requiresKey: p.requiresKey,
      available: !p.requiresKey || hasKey,
    };
  }
  return out;
}
