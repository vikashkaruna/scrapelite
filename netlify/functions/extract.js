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
import { getCached, setCached } from "./lib/resultCacheStore.js";
import { buildCacheKey, isCacheable } from "../../src/lib/resultCache.js";
import { checkCompliance } from "./lib/complianceEngine.js";
import { takeTokenBlocking, configFromEnv } from "./lib/rateLimiter.js";

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

  // FD3: robots.txt compliance (skip when explicitly bypassed).
  const bypassCompliance = options.bypassCompliance === true;
  if (!bypassCompliance) {
    try {
      const compliance = await checkCompliance(url, {
        permittedHosts: process.env.PERMITTED_HOSTS || "",
      });
      if (!compliance.allowed) {
        return respond(403, {
          error: compliance.reason,
          _complianceBlocked: true,
          _crawlDelayMs: compliance.crawlDelayMs,
        });
      }
    } catch (err) {
      // Fail open on compliance-engine errors.
      console.warn("[DatIQ] compliance check errored (failing open):", err.message);
    }
  }

  // FD3: per-host rate limiter. Wait for a token before any provider call.
  if (!bypassCompliance) {
    try {
      await takeTokenBlocking(url, configFromEnv());
    } catch (err) {
      console.warn("[DatIQ] rate limiter errored (continuing):", err.message);
    }
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

    // ── FD2: result cache + URL-level dedup ─────────────────────────────────
    // If the same URL (modulo tracking params) was scraped within the cache
    // TTL and the options are cacheable, return the cached result without
    // calling any provider. Caching is opt-out via `options.noCache: true`.
    let cacheHit = null;
    if (isCacheable(options) && !options.noCache) {
      const key = buildCacheKey(url, options);
      try {
        cacheHit = await getCached(key);
      } catch { /* cache miss on any error */ }
    }
    if (cacheHit && cacheHit.result) {
      return respond(200, {
        data: cacheHit.result.data,
        source: `${cacheHit.result.source || "cache"} (cached)`,
        _cacheHit: true,
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

    // Build the normalised response.
    const responseBody = {
      data: {
        html: result.html,
        metadata: { title: result.title || "" },
        json: result.customExtraction || undefined,
      },
      source: result.source,
      _providerAttempts: result.attempts,
    };

    // FD2: write to cache (best-effort, fire-and-forget).
    if (isCacheable(options) && !options.noCache) {
      try {
        const key = buildCacheKey(url, options);
        // Don't await — the response goes back to the client immediately.
        setCached(key, "ok", { data: responseBody.data, source: result.source })
          .catch(() => {});
      } catch { /* cache write failure is non-fatal */ }
    }

    return respond(200, responseBody);
  } catch (err) {
    return respond(502, { error: `Scrape chain failed: ${err.message}` });
  }
};
