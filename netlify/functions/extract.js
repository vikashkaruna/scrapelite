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
import { isPublicHttpUrlAsync } from "./lib/publicUrl.js";
import { getCached, setCached } from "./lib/resultCacheStore.js";
import { buildCacheKey, isCacheable } from "../../src/lib/resultCache.js";
import { checkCompliance } from "./lib/complianceEngine.js";
import { takeTokenBlocking, configFromEnv } from "./lib/rateLimiter.js";
import { headlessAttribution, isHeadlessAvailable } from "./lib/headlessProvider.js";
import { runChain, keyPresence } from "./lib/aiProviders.js";
import { DENY_STATUS, denyBody, requireCapability } from "./lib/requireEntitlement.js";

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

// HTML → plain text (used by the AI-extraction fallback so the prompt
// stays within the model context window). Tags stripped, scripts/styles
// removed first so we don't pay tokens for JS/CSS. Whitespace is
// collapsed; entities are decoded. Returns "" on any failure.
function htmlToPlainText(html) {
  if (!html || typeof html !== "string") return "";
  try {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?[a-z][^>]*>/gi, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

// AI-extraction fallback for customPrompt when the scrape chain returned
// no customExtraction. Only Firecrawl (and Spider, theoretically) support
// server-side JSON extraction; Spider/Jina/Direct all return null. Without
// this fallback, "Find Contact Info" / "Leadership & Board" / etc. silently
// saved an empty enrichment on any chain that fell through to a
// non-Firecrawl provider — the user saw "No data returned for this
// capability" even on a perfectly valid URL. Now the function asks the
// multi-provider AI chain to extract the JSON from the page text using the
// user's customPrompt as the schema instruction.
//
// Strict-JSON prompt: the model is told to return ONLY a JSON object, with
// no markdown fences and no preamble. parseJsonLoose tolerates a few
// common deviations (```json fences, leading prose) so a slightly messy
// reply still produces a usable extraction instead of silently failing.
const AI_EXTRACT_MAX_TOKENS = 2048;
const AI_EXTRACT_TEXT_CHARS = 24000; // ~6k tokens of plain text — well within every model

async function extractJsonWithAI({ prompt, title, text }) {
  const presence = keyPresence();
  if (!Object.values(presence).some(Boolean)) return null;
  const trimmed = (text || "").slice(0, AI_EXTRACT_TEXT_CHARS);
  const messages = [
    {
      role: "user",
      content:
        `You are a precise data extractor. Apply the instruction below to the page ` +
        `content and return ONLY a JSON object. No markdown fences, no explanations, ` +
        `no preamble — just the JSON.\n\n` +
        `INSTRUCTION:\n${prompt}\n\n` +
        `PAGE TITLE: ${title || ""}\n\n` +
        `PAGE CONTENT (truncated):\n${trimmed}`,
    },
  ];
  const r = await runChain(messages, AI_EXTRACT_MAX_TOKENS);
  if (!r.ok || !r.text) return null;
  return parseJsonLoose(r.text);
}

function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  // Fast path: the whole reply IS JSON.
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === "object" ? v : null;
  } catch { /* fall through to the loose extractors */ }
  // Strip ```json ... ``` or ``` ... ``` fences the model sometimes adds
  // despite the explicit "no fences" instruction.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const v = JSON.parse(fence[1].trim());
      return v && typeof v === "object" ? v : null;
    } catch { /* fall through */ }
  }
  // Last resort: find the outermost JSON object OR array in the reply. The
  // "no preamble" instruction usually works, but some models add a one-line
  // intro, and prompts that are naturally list-shaped (e.g. "extract all
  // social links") sometimes come back as a bare `[...]` rather than an
  // object — only scanning for `{`/`}` missed that shape entirely and threw
  // away a perfectly good extraction.
  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  const candidates = [];
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1));
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));
  for (const candidate of candidates) {
    try {
      const v = JSON.parse(candidate);
      return v && typeof v === "object" ? v : null;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// True when a customPrompt-driven extraction actually found something.
// Firecrawl's prompt-only JSON extraction (no schema) frequently comes back
// as `{}` when it can't confidently match the prompt — an EMPTY OBJECT is
// truthy in JS, so `!result.customExtraction` alone let a genuinely empty
// extraction masquerade as "already handled" and skip the AI-extraction
// fallback below, leaving the user with a "No data returned" tab even
// though the requested info was on the page. Null/undefined/empty-object/
// empty-array all count as "nothing found" and should still fall through.
function isEmptyExtraction(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
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

  const { url, options: rawOptions = {} } = reqBody;
  const options = rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)
    ? {
        renderJs: rawOptions.renderJs === true,
        mapMode: rawOptions.mapMode === true,
        noCache: rawOptions.noCache === true,
        ...(rawOptions.customPrompt == null ? {} : { customPrompt: String(rawOptions.customPrompt).trim().slice(0, 12000) }),
      }
    : {};
  if (!url) return respond(400, { error: "url is required" });

  // SSRF guard: reject private IPs, non-http(s) schemes, malformed URLs
  // BEFORE we make any outbound provider HTTP call.
  try {
    if (!(await isPublicHttpUrlAsync(url))) {
      return respond(400, { error: "URL is not a public http(s) address" });
    }
  } catch (err) {
    return respond(400, { error: err.message || "Invalid URL" });
  }

  // Subscription gate. Placed AFTER the SSRF guard (never spend a DB round-trip
  // on a request we are about to reject anyway) and BEFORE any provider call.
  //
  // Signed-in users only: guests fall through untouched and are still governed
  // solely by the per-host token bucket below. Fails OPEN when Supabase is
  // unreachable — see the header of lib/requireEntitlement.js for why that
  // asymmetry is deliberate and must not be "fixed".
  try {
    const { check } = await requireCapability(event, "extract");
    if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  } catch (err) {
    console.warn("[DatIQ] entitlement check errored (failing open):", err.message);
  }

  // FD3: robots.txt compliance. This is server-enforced; clients cannot bypass it.
  {
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
  {
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

    // AI-extraction fallback. Only Firecrawl supports server-side JSON
    // extraction from a customPrompt. If the chain fell through to Spider,
    // Jina, or Direct (no API key, quota, transient error, …) the result
    // has customExtraction === null even though we have valid HTML. Without
    // this fallback the user's enrichment tab saves as null and shows
    // "No data returned for this capability" — the bug the user
    // reported. Call the multi-provider AI chain to do the extraction
    // server-side; the response is best-effort and never blocks the
    // response (any failure leaves customExtraction as null, which the
    // client already handles as "no data").
    let aiExtractionUsed = false;
    // WHY an empty enrichment happened, in the response. Every distinct cause
    // used to collapse into one blank tab reading "No data returned for this
    // capability", which is why "none of the Quick enrichment buttons work"
    // survived several rounds of fixes: a server with no AI key configured and
    // a page that genuinely has no pricing table were indistinguishable from
    // the UI, from the logs, and from each other.
    let enrichmentReason = null;
    if (options.customPrompt && isEmptyExtraction(result.customExtraction)) {
      const aiConfigured = Object.values(keyPresence()).some(Boolean);
      if (!aiConfigured) {
        // The single most likely cause in a fresh deployment, and previously
        // the most silent: extractJsonWithAI() returns null before making any
        // request when no provider key is set. Nothing else in the product
        // reveals this — aiService falls back to mock summaries, so summaries
        // keep "working" and only enrichment visibly dies.
        enrichmentReason = "ai_not_configured";
      } else {
        try {
          const aiJson = await extractJsonWithAI({
            prompt: options.customPrompt,
            title: result.title || "",
            text: htmlToPlainText(result.html || ""),
          });
          if (!isEmptyExtraction(aiJson)) {
            result.customExtraction = aiJson;
            aiExtractionUsed = true;
          } else {
            // The chain answered, and the answer was "nothing here".
            enrichmentReason = "no_match";
          }
        } catch (err) {
          // Non-fatal: the response goes back to the client with null
          // customExtraction. The error is logged so the regression can
          // be diagnosed from the function log if it fires repeatedly.
          console.warn("[DatIQ] AI-extract fallback failed:", err?.message || err);
          enrichmentReason = "ai_chain_failed";
        }
      }
    }

    // Build the normalised response.
    const responseBody = {
      data: {
        html: result.html,
        metadata: { title: result.title || "" },
        json: isEmptyExtraction(result.customExtraction) ? undefined : result.customExtraction,
      },
      source: result.source,
      _providerAttempts: result.attempts,
      // Present ONLY when a customPrompt was asked for and came back empty.
      // Absent on success, so existing clients are unaffected.
      ...(enrichmentReason ? { _enrichment: { ok: false, reason: enrichmentReason } } : {}),
      // True when the AI-extraction fallback produced the custom_extraction
      // (the chain itself didn't have a provider that supports it). Useful
      // for debug + so future tests can pin the regression fix. Stays
      // absent from the response when Firecrawl handled it natively, so
      // existing clients ignore it.
      ...(aiExtractionUsed ? { _aiExtractFallback: true } : {}),
      // F36 — headless attribution. Only surface when the caller asked for
      // JS rendering; otherwise we omit the field so the UI doesn't show a
      // confusing "rendered via X" message on plain HTTP extractions.
      ...(options.renderJs
        ? { _headless: headlessAttribution(result.source) }
        : {}),
    };

    // If the caller asked for renderJs but no headless-capable provider is
    // configured, the chain will fall through to jina/direct (both static).
    // Surface a hint so the UI can warn the user.
    if (options.renderJs && !isHeadlessAvailable()) {
      responseBody._headless = {
        rendered: false,
        note: "JS rendering requested but no headless provider (Firecrawl / Spider) is configured. Falling back to a static HTML snapshot.",
      };
    }

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
