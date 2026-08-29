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
import { DENY_STATUS, denyBody, resolveRequestEntitlement, checkCapability } from "./lib/requireEntitlement.js";
import { buildWorkspaceCtx } from "./lib/workspaceContext.js";
import { consumeGuestCredit } from "./lib/guestUsage.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { hasScrapeConsent } from "./lib/scrapeConsent.js";

function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extraHeaders,
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
      .replace(/<[^>]+>/g, " ")
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
const AI_EXTRACT_MAX_TOKENS = 2048;
const AI_EXTRACT_TEXT_CHARS = 24000; // ~6k tokens of plain text — well within every model

async function extractJsonWithAI({ prompt, title, text }) {
  const presence = keyPresence();
  if (!Object.values(presence).some(Boolean)) {
    return { ok: false, reason: "ai_not_configured" };
  }
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
  let r;
  try {
    r = await runChain(messages, AI_EXTRACT_MAX_TOKENS);
  } catch (err) {
    console.warn("[DatIQ] AI extraction runChain threw:", err?.message || err);
    return { ok: false, reason: "ai_chain_failed" };
  }
  if (!r || !r.ok) {
    console.warn("[DatIQ] AI extraction provider chain failed:", r?.error, r?.attempts);
    return { ok: false, reason: "ai_chain_failed", attempts: r?.attempts };
  }
  if (!r.text || !r.text.trim()) {
    return { ok: false, reason: "no_match" };
  }
  const parsed = parseJsonLoose(r.text);
  if (!parsed || isEmptyExtraction(parsed)) {
    return { ok: false, reason: "no_match" };
  }
  return { ok: true, data: parsed };
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
  // Find the outermost JSON object OR array in the reply.
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

  // Structured key-value lines fallback (requires at least 2 distinct key-value pairs)
  const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 || lines.some((l) => /^[-*•]/.test(l))) {
    const kvObj = {};
    let count = 0;
    for (const line of lines) {
      const m = line.match(/^[-*•]?\s*([A-Za-z0-9_ ]{2,40})\s*:\s*(.+)$/);
      if (m && m[1] && m[2]) {
        const k = m[1].trim().toLowerCase().replace(/\s+/g, "_");
        kvObj[k] = m[2].trim();
        count++;
      }
    }
    if (count >= 2) {
      return kvObj;
    }
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
  // on a request we are about to reject anyway) and BEFORE any outbound call at
  // all — including the robots.txt fetch below. A denied account must cost us
  // nothing on the wire, which is what entitlement-enforcement.test.js pins.
  //
  // Signed-in users only: guests fall through untouched and are still governed
  // solely by the per-host token bucket below. Fails OPEN when Supabase is
  // unreachable — see the header of lib/requireEntitlement.js for why that
  // asymmetry is deliberate and must not be "fixed".
  //
  // `respond`, not `reply`: consumeGuestCredit has not run yet, so there is no
  // cookie to set — and it would return none here anyway, since it short-
  // circuits for any request carrying an Authorization header.
  try {
    const resolved = await resolveRequestEntitlement(event);
    // A caller acting "as" a workspace names it in the body; a request naming
    // none is unaffected — personal extractions behave exactly as before.
    // See lib/workspaceContext.js for why this can't just be `requireCapability`.
    const { ctx, refusal } = await buildWorkspaceCtx(resolved, reqBody.workspaceId);
    if (refusal) return respond(403, { error: refusal.message, code: refusal.code });
    const check = checkCapability(resolved, "extract", ctx);
    if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  } catch (err) {
    console.warn("[DatIQ] entitlement check errored (failing open):", err.message);
  }

  // FD3: robots.txt compliance. Server-enforced; clients cannot bypass it.
  //
  // ⚠️ ORDERING IS LOAD-BEARING: this runs BEFORE consumeGuestCredit. It used
  // to run after, which meant a guest who pasted three LinkedIn URLs spent
  // three of their ten free extractions on requests that were refused on
  // policy grounds before any provider was ever contacted. You do not bill for
  // work you declined to do. The check needs only the URL, so it costs nothing
  // to do it first — and it still sits after the SSRF guard, which is the one
  // ordering that actually matters (never fetch robots.txt from an address we
  // are about to reject as non-public).
  //
  // The refusal is OVERRIDABLE for a signed-in user who has attested that they
  // have permission for this host — but only from a record we resolve here,
  // server-side, from their JWT. See lib/scrapeConsent.js.
  {
    try {
      const compliance = await checkCompliance(url, {
        permittedHosts: process.env.PERMITTED_HOSTS || "",
      });
      if (!compliance.allowed) {
        // Only a robots.txt refusal is overridable. `host_not_permitted` is the
        // OPERATOR's allowlist decision, not the site's, and a user must not be
        // able to attest their way past their own operator.
        //
        // This resolution has its OWN try/catch, and it must keep it. The outer
        // catch below fails open on compliance-engine errors, which is right for
        // "we could not read robots.txt" — but catastrophic here: a throw while
        // looking up the attestation would fall through to that handler and
        // allow a scrape the site refused. An error resolving consent means NO
        // consent, always.
        let overridden = false;
        let consentAvailable = false;
        if (compliance.code === "robots_disallowed") {
          try {
            const auth = await authenticateBearer(event, { label: "extract-consent" });
            if (auth.ok && auth.user?.id) {
              const consent = await hasScrapeConsent(auth.user.id, compliance.host);
              // `degraded` (we could not read the record) is treated exactly
              // like "no record" — see the fail-closed note in scrapeConsent.js.
              overridden = consent.granted === true;
              // ...and it also suppresses the OFFER. `degraded` means the
              // consent store could not answer — unconfigured, unmigrated, or
              // unreachable — so recording an attestation would fail too.
              // Advertising the override there sends the user into a dialog
              // that can only ever error: they tick the box, the POST 502s,
              // and nothing is granted. Better to show the plain refusal, which
              // is accurate in every case, than a door that cannot open.
              consentAvailable = !overridden && !consent.degraded;
            }
          } catch (err) {
            console.warn("[DatIQ] consent lookup errored (refusal stands):", err.message);
            overridden = false;
            consentAvailable = false;
          }
        }
        if (!overridden) {
          return respond(403, {
            error: compliance.reason,
            code: compliance.code,
            _complianceBlocked: true,
            _crawlDelayMs: compliance.crawlDelayMs,
            host: compliance.host,
            // Tells the client whether to offer the attestation dialog or ask
            // the caller to sign in first. Never a permission in itself.
            consentAvailable,
          });
        }
        console.info(`[DatIQ] robots.txt refusal overridden by recorded attestation for ${compliance.host}`);
      }
    } catch (err) {
      // Fail open on compliance-engine errors.
      console.warn("[DatIQ] compliance check errored (failing open):", err.message);
    }
  }

  // The guest charge. Everything above this line is a gate that can decline
  // WITHOUT doing any work, so nothing above it may bill. This used to sit
  // directly under the SSRF guard, which is how a guest pasting three LinkedIn
  // URLs spent three of their ten free extractions on requests that were
  // refused on policy grounds before a provider was ever contacted.
  const guestUsage = await consumeGuestCredit(event, "single");
  const reply = (statusCode, body) => respond(
    statusCode,
    body,
    guestUsage.cookie ? { "Set-Cookie": guestUsage.cookie } : {},
  );
  if (!guestUsage.allowed) {
    return reply(429, {
      error: "Guest extraction limit reached. Sign in to continue.",
      code: guestUsage.reason || "single_limit_reached",
      remaining: 0,
    });
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
        return reply(502, {
          error: result.error,
          _providerAttempts: result.attempts,
        });
      }
      return reply(200, {
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
      return reply(200, {
        data: cacheHit.result.data,
        source: `${cacheHit.result.source || "cache"} (cached)`,
        _cacheHit: true,
      });
    }

    // ── Scrape mode: extract page HTML + metadata ────────────────────────────
    const result = await runScrapeChain(url, options);
    if (!result.ok) {
      return reply(502, {
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
      const aiRes = await extractJsonWithAI({
        prompt: options.customPrompt,
        title: result.title || "",
        text: htmlToPlainText(result.html || ""),
      });
      if (aiRes.ok && aiRes.data && !isEmptyExtraction(aiRes.data)) {
        result.customExtraction = aiRes.data;
        aiExtractionUsed = true;
      } else {
        enrichmentReason = aiRes.reason || "no_match";
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

    return reply(200, responseBody);
  } catch (err) {
    return reply(502, { error: `Scrape chain failed: ${err.message}` });
  }
};
