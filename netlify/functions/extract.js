// Netlify Function — Web scraping proxy with provider fallback chain.
// Keeps all API keys server-side; never bundled into the browser.
//
// POST /api/extract
//   Body: { url: string, options: { renderJs?, customPrompt?, mapMode? } }
//   Response: normalised scrape JSON (html + metadata) or map (mapLinks[])
//
// Provider chain (default): Firecrawl → Spider.cloud → Jina AI → Direct fetch
// Override with SCRAPE_PROVIDER_ORDER env var (comma-separated, e.g. "spider,jina,direct").
// Each provider is skipped automatically when its API key is absent (except Jina + Direct,
// which work without a key at reduced rate limits).
//
// SSRF guard (C-01): every inbound URL is run through isPublicHttpUrl
// before any provider HTTP call. Private IPs, non-HTTP(S) schemes, and
// malformed URLs are rejected with 400.

import { runScrapeChain, runMapChain } from "./lib/scrapeProviders.js";
import { isPublicHttpUrl } from "./lib/publicUrl.js";

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  let reqBody;
  try {
    reqBody = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const { url, options = {} } = reqBody;
  if (!url) return respond(400, { error: "url is required" });

  // SSRF guard: reject private IPs, non-http(s) schemes, malformed URLs
  // BEFORE we make any outbound provider HTTP call.
  try {
    if (!isPublicHttpUrl(url)) {
      return respond(400, { error: "URL is not a public http(s) address" });
    }
  } catch (err) {
    return respond(400, { error: err.message || "Invalid URL" });
  }

  try {
    // ── Map mode: discover all URLs in a domain ──────────────────────────────
    if (options.mapMode) {
      const result = await runMapChain(url);
      if (!result.ok) {
        return respond(502, {
          error: result.error,
          _providerAttempts: result.attempts,
        });
      }
      return respond(200, {
        mapLinks: result.mapLinks,
        source: result.source,
        _providerAttempts: result.attempts,
      });
    }

    // ── Scrape mode: extract page HTML + metadata ────────────────────────────
    const result = await runScrapeChain(url, options);
    if (!result.ok) {
      return respond(502, {
        error: result.error,
        _providerAttempts: result.attempts,
      });
    }

    // Normalise to the shape firecrawlService.js / realScrape() expects:
    //   raw?.data?.html         → page HTML
    //   raw?.data?.metadata?.title → page title
    //   raw?.data?.json         → LLM custom extraction (Firecrawl only; null for others)
    return respond(200, {
      data: {
        html: result.html,
        metadata: { title: result.title || "" },
        json: result.customExtraction || undefined,
      },
      source: result.source,
      _providerAttempts: result.attempts,
    });
  } catch (err) {
    return respond(502, { error: `Scrape chain failed: ${err.message}` });
  }
};
