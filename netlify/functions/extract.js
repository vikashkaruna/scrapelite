// Netlify Function — Web scraping proxy with provider fallback chain.
// Keeps all API keys server-side; never bundled into the browser.
//
// POST /api/extract
//   Body: { url, options: { renderJs?, customPrompt?, mapMode?, enrichKey?, deep? } }
//   Response: normalised scrape JSON (html + text + metadata) or map (mapLinks[])
//
// Provider chain default: Firecrawl → Spider.cloud → Jina AI → Direct fetch.
// See src/lib/providerRegistry.js — the shared catalogue the admin console and
// the runtime both read. Override with SCRAPE_PROVIDER_ORDER.
//
// SSRF guard (C-01): every inbound URL is run through isPublicHttpUrl
// before any provider HTTP call.
//
// ── WHAT CHANGED IN THE EXTRACTION BRAIN, AND WHY ───────────────────────────
//
// 1. SCHEMA-GUIDED, NOT PROSE-GUIDED. Capabilities now drive the model with a
//    real JSON Schema through each provider's native structured-output mode
//    (see extractionSchemas.js). The old path asked for JSON in prose and ran
//    the reply through a loose parser; when the parser lost, the user was told
//    "the AI read this page and found nothing" — a sentence about our parser,
//    reported as a fact about their page.
//
// 2. THE REASON NO LONGER LIES. `enrichmentReason` used to be
//    `relatedRes.reason || aiRes.reason || "no_match"`, so a related-page scan
//    that found no candidate links OVERWROTE a genuine `ai_chain_failed` with
//    `no_match`. With all three AI providers dead in production, every
//    capability whose hints came up empty (custom, social, and any page
//    without a matching subpage) reported "this page has nothing" while the
//    truth was "the AI account is out of credit". Infrastructure reasons now
//    outrank absence reasons, always — see pickReason().
//
// 3. RELATED PAGES ARE READ UP FRONT, NOT AS A CONSOLATION PRIZE. Leadership
//    lives on /about, pricing on /pricing, contacts on /contact. Scanning them
//    only after the homepage failed meant the good answer cost two round trips
//    and usually never happened. Entity capabilities now gather their subpages
//    before the single AI call, so the model reasons over the whole company
//    surface at once instead of one page at a time.
//
// 4. THE PAGE BODY IS RETURNED. `data.text` carries structure-preserving
//    content (headings, list items, table rows) so the browser's summariser
//    and content generator stop working from a table of contents.

import { runScrapeChain, runMapChain } from "./lib/scrapeProviders.js";
import { publicProvenance } from "./lib/aiFailure.js";
import { isPublicHttpUrlAsync, fetchPublicUrl } from "./lib/publicUrl.js";
import { RELATED_PAGE_HINTS } from "../../src/lib/extractionPresets.js";
import {
  resolveExtractionPlan, isSchemaResultEmpty, countSchemaFacts,
} from "../../src/lib/extractionSchemas.js";
import { extractPageContent } from "./lib/pageContent.js";
import { publicFailureCode } from "../../src/lib/aiFailureCopy.js";
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

// ── Budgets ─────────────────────────────────────────────────────────────────
// Generous on purpose. The old 24k-character cap was sized for a flash model
// and a flat word-bag; with structure-preserving text and a deep-tier model,
// truncating a pricing page mid-table is the expensive mistake, not the tokens.
const AI_EXTRACT_MAX_TOKENS   = 8192;
const AI_EXTRACT_TEXT_CHARS   = 90_000;  // whole-page budget across base + related
const BASE_PAGE_TEXT_CHARS    = 45_000;
const RELATED_PAGE_TEXT_CHARS = 18_000;
const RELATED_PAGE_MAX        = 3;
const RELATED_FETCH_TIMEOUT_MS = 9000;

// Capabilities whose answer routinely lives on a DIFFERENT page of the same
// site than the one the user pasted. These gather subpages before the AI call
// rather than after a failure. `social` is absent deliberately — profile links
// sit in the header/footer of every page, so a subpage adds cost and nothing
// else. `custom` is absent because free text has no reliable subpage signal.
const ENTITY_CAPABILITIES = new Set(["contacts", "leadership", "mission", "pricing"]);

// ── Reason vocabulary ───────────────────────────────────────────────────────
// Split out of the single overloaded "no_match", which used to mean any of:
// the AI never ran, the AI returned nothing, the AI returned unparseable text,
// or the page genuinely lacks the data. Those are four different actions for
// the operator and the user, and collapsing them is why a total provider
// outage was invisible for weeks.
export const ENRICH_REASON = {
  NOT_CONFIGURED: "ai_not_configured", // no provider key set at all
  CHAIN_FAILED:   "ai_chain_failed",   // providers reachable-ish but all failed
  NO_CREDIT:      "ai_no_credit",      // key valid, account unfunded
  BAD_KEY:        "ai_bad_key",        // key present and rejected
  RATE_LIMITED:   "ai_rate_limited",
  EMPTY_REPLY:    "ai_empty_reply",    // model answered with nothing
  UNPARSEABLE:    "ai_unparseable",    // model answered, we could not read it
  NO_CONTENT:     "page_no_content",   // the scrape produced no readable text
  ABSENT:         "no_match",          // the page genuinely does not have it
};

// Infrastructure reasons describe US; absence reasons describe THEIR page.
// A reason about us must never be replaced by a reason about them — that
// substitution is the exact bug this ordering exists to prevent.
const INFRA_REASONS = new Set([
  ENRICH_REASON.NOT_CONFIGURED, ENRICH_REASON.CHAIN_FAILED, ENRICH_REASON.NO_CREDIT,
  ENRICH_REASON.BAD_KEY, ENRICH_REASON.RATE_LIMITED, ENRICH_REASON.EMPTY_REPLY,
  ENRICH_REASON.UNPARSEABLE, ENRICH_REASON.NO_CONTENT,
]);

/** Pick the most informative reason from a set of attempts. Infra always wins. */
export function pickReason(...reasons) {
  const seen = reasons.filter(Boolean);
  const infra = seen.find((r) => INFRA_REASONS.has(r));
  return infra || seen[0] || ENRICH_REASON.ABSENT;
}

/** Map an aiProviders error code onto the enrichment vocabulary. */
function reasonForChainCode(code) {
  switch (code) {
    case "no_credit":     return ENRICH_REASON.NO_CREDIT;
    case "bad_key":       return ENRICH_REASON.BAD_KEY;
    case "rate_limited":  return ENRICH_REASON.RATE_LIMITED;
    case "no_key":        return ENRICH_REASON.NOT_CONFIGURED;
    default:              return ENRICH_REASON.CHAIN_FAILED;
  }
}

/**
 * The full enrichment diagnosis goes to the LOG, which is an operator surface.
 * This is the pairing that matters: the customer gets one generic sentence and
 * the operator gets the vendor's exact words — previously nobody got either,
 * which is how three dead provider accounts went unnoticed for weeks.
 */
function logEnrichmentFailure(capability, reason, attempts) {
  const detail = (attempts || [])
    .map((a) => `${a.provider}:${a.code || a.skipped || "?"}${a.error ? ` (${String(a.error).slice(0, 120)})` : ""}`)
    .join(" | ");
  console.warn(`[DatIQ] enrichment "${capability}" failed — reason=${reason} ${detail}`);
}

// ── Structured extraction ───────────────────────────────────────────────────

/**
 * Drive the AI chain with a capability schema over the gathered page text.
 * Returns { ok, data, reason?, provider?, model?, structured? }.
 */
async function extractStructuredWithAI({ plan, title, url, text, pagesRead }) {
  const presence = keyPresence();
  if (!Object.values(presence).some(Boolean)) {
    return { ok: false, reason: ENRICH_REASON.NOT_CONFIGURED };
  }
  if (!text || text.trim().length < 40) {
    return { ok: false, reason: ENRICH_REASON.NO_CONTENT };
  }

  const sourceNote = pagesRead && pagesRead.length > 1
    ? `\n\nThe content below is ${pagesRead.length} pages from this site, separated by "--- PAGE: <url> ---" markers. ` +
      `Treat them as one company surface. Attribute each evidence quote to the page it came from.`
    : "";

  const messages = [
    {
      role: "system",
      content:
        "You are a precise B2B data extractor working for an intelligence platform. " +
        "You only report what the supplied page content actually states. " +
        "You never infer a fact from prior knowledge of the company, and you never " +
        "fill a field to look complete. An honest empty field is correct; an invented one is a defect.",
    },
    {
      role: "user",
      content:
        `${plan.instruction}${sourceNote}\n\n` +
        `PAGE URL: ${url}\n` +
        `PAGE TITLE: ${title || "(untitled)"}\n\n` +
        `PAGE CONTENT:\n${text}`,
    },
  ];

  let r;
  try {
    r = await runChain(messages, AI_EXTRACT_MAX_TOKENS, {
      area: "enrichment",
      schema: plan.schema,
    });
  } catch (err) {
    console.warn("[DatIQ] enrichment runChain threw:", err?.message || err);
    return { ok: false, reason: ENRICH_REASON.CHAIN_FAILED };
  }
  if (!r || !r.ok) {
    console.warn("[DatIQ] enrichment chain failed:", r?.errorCode, JSON.stringify(r?.attempts || []));
    return { ok: false, reason: reasonForChainCode(r?.errorCode), attempts: r?.attempts };
  }

  // Native structured output hands back a parsed object; everything else still
  // goes through the loose parser, which is now a fallback rather than the
  // primary mechanism.
  const parsed = r.json ?? parseJsonLoose(r.text);
  if (parsed == null) {
    console.warn("[DatIQ] enrichment reply unparseable from", r.provider, r.model);
    return { ok: false, reason: ENRICH_REASON.UNPARSEABLE, provider: r.provider, model: r.model };
  }
  // The custom schema wraps its payload; capability schemas do not.
  const payload = unwrapCustomResult(parsed);
  if (isSchemaResultEmpty(payload)) {
    return { ok: false, reason: ENRICH_REASON.ABSENT, provider: r.provider, model: r.model };
  }
  return {
    ok: true, data: payload,
    provider: r.provider, model: r.model, structured: Boolean(r.structured),
    facts: countSchemaFacts(payload),
  };
}

/**
 * The custom schema returns { result, items, not_found, evidence }. Flatten it
 * so a free-text extraction renders like any other tab, while keeping `items`
 * (the listing case — a Product Hunt homepage is 30 products, not one) and the
 * evidence contract intact.
 */
function unwrapCustomResult(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const hasWrapper = "result" in parsed || "items" in parsed;
  if (!hasWrapper) return parsed;
  const out = {};
  if (parsed.result && typeof parsed.result === "object" && Object.keys(parsed.result).length) {
    Object.assign(out, parsed.result);
  }
  if (Array.isArray(parsed.items) && parsed.items.length) out.items = parsed.items;
  if (Array.isArray(parsed.not_found) && parsed.not_found.length) out.not_found = parsed.not_found;
  if (Array.isArray(parsed.evidence) && parsed.evidence.length) out.evidence = parsed.evidence;
  return Object.keys(out).length ? out : parsed;
}

function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === "object" ? v : null;
  } catch { /* fall through to the loose extractors */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const v = JSON.parse(fence[1].trim());
      return v && typeof v === "object" ? v : null;
    } catch { /* fall through */ }
  }
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
  const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 || lines.some((l) => /^[-*•]/.test(l))) {
    const kvObj = {};
    let count = 0;
    for (const line of lines) {
      const m = line.match(/^[-*•]?\s*([A-Za-z0-9_ ]{2,40})\s*:\s*(.+)$/);
      if (m && m[1] && m[2]) {
        kvObj[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
        count++;
      }
    }
    if (count >= 2) return kvObj;
  }
  return null;
}

// ── Related-page gathering ──────────────────────────────────────────────────

function decodeAnchorEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

/**
 * Score the base page's OWN same-domain links against the capability's hint
 * keywords, checked against both the path and the visible link text — a
 * "Meet the team" link with href /people/ matches on text, not path.
 */
export function findRelatedPageLinks(html, baseUrl, hints, limit = RELATED_PAGE_MAX) {
  if (!html || !hints || hints.length === 0) return [];
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return []; }
  const seen = new Map();
  const anchorRe = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const text = decodeAnchorEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().toLowerCase();
    let abs;
    try { abs = new URL(m[1], baseUrl); } catch { continue; }
    if (abs.origin !== origin) continue;
    if (!/^https?:$/.test(abs.protocol)) continue;
    abs.hash = "";
    const absStr = abs.toString();
    if (absStr === baseUrl) continue;
    // Skip obvious non-content endpoints that match on a stray keyword.
    if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|css|js)$/i.test(abs.pathname)) continue;
    const haystack = `${abs.pathname.toLowerCase()} ${text}`;
    let bestScore = 0;
    for (let i = 0; i < hints.length; i++) {
      if (haystack.includes(hints[i])) bestScore = Math.max(bestScore, hints.length - i);
    }
    if (bestScore > 0) {
      // A shallow path is a better bet than a deep one: /about beats
      // /blog/2019/about-our-rebrand for "who runs this company".
      const depth = abs.pathname.split("/").filter(Boolean).length;
      const score = bestScore * 10 - Math.min(depth, 5);
      if (score > (seen.get(absStr) || -Infinity)) seen.set(absStr, score);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([url]) => url);
}

/** Best-effort fetch of one related page's readable text. Never throws. */
async function fetchRelatedPageText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RELATED_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchPublicUrl(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DatIQBot/1.0; +https://datiq.app)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const { text } = extractPageContent(html, { maxChars: RELATED_PAGE_TEXT_CHARS });
    // 80 chars filters redirect stubs, error shells and empty SPA frames
    // without discarding a genuinely terse contact or team page.
    return text && text.length > 80 ? { url, text } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Gather up to RELATED_PAGE_MAX same-domain subpages for a capability, in
 * parallel. Returns [] when the capability has no hints or nothing matched.
 */
async function gatherRelatedPages(baseHtml, baseUrl, enrichKey) {
  const hints = RELATED_PAGE_HINTS[enrichKey];
  if (!hints || hints.length === 0) return [];
  const candidates = findRelatedPageLinks(baseHtml, baseUrl, hints);
  if (candidates.length === 0) return [];
  const settled = await Promise.allSettled(candidates.map(fetchRelatedPageText));
  return settled
    .filter((s) => s.status === "fulfilled" && s.value)
    .map((s) => s.value);
}

/** Join base + related page text into one budgeted corpus with page markers. */
function buildCorpus(baseUrl, baseText, related) {
  const parts = [`--- PAGE: ${baseUrl} ---\n${baseText}`];
  let used = parts[0].length;
  const pagesRead = [baseUrl];
  for (const r of related) {
    const chunk = `\n\n--- PAGE: ${r.url} ---\n${r.text}`;
    if (used + chunk.length > AI_EXTRACT_TEXT_CHARS) break;
    parts.push(chunk);
    used += chunk.length;
    pagesRead.push(r.url);
  }
  return { text: parts.join(""), pagesRead };
}

// True when a customPrompt-driven extraction actually found something.
// Firecrawl's prompt-only JSON extraction frequently returns `{}` when it
// cannot confidently match — an empty object is truthy, so `!customExtraction`
// alone let a genuinely empty extraction masquerade as "already handled".
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
        // Opt OUT of related-page gathering. Defaults to on for entity
        // capabilities; batch runs at scale pass false because latency per
        // row dominates there and the extra fetches multiply across the run.
        ...(rawOptions.deep === false ? { deep: false } : {}),
        ...(rawOptions.customPrompt == null ? {} : { customPrompt: String(rawOptions.customPrompt).trim().slice(0, 12000) }),
        // Whitelisted against the known capability keys (not free text) —
        // this only ever selects which RELATED_PAGE_HINTS bucket to scan,
        // never anything that reaches a query or a filesystem path, but
        // there is no reason to accept an arbitrary client-supplied string.
        ...(typeof rawOptions.enrichKey === "string" && RELATED_PAGE_HINTS[rawOptions.enrichKey]
          ? { enrichKey: rawOptions.enrichKey }
          : {}),
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

    // ── Enrichment: schema-guided structured extraction ────────────────────
    //
    // The chain only ever fills `customExtraction` when Firecrawl handled it
    // natively. Every other provider returns null, so this is the primary path
    // in most deployments — which is why an unfunded AI account presented as a
    // total enrichment outage rather than a degradation.
    let aiExtractionUsed = false;
    let enrichmentReason = null;
    let enrichmentMeta = null;
    let relatedPagesScanned = null;

    const wantsEnrichment = Boolean(options.customPrompt || options.enrichKey);
    // Provider-supplied markdown (Firecrawl, Jina) is already main-content
    // isolated and keeps tables and lists intact — strictly better than
    // anything we can recover by flattening raw HTML ourselves. Fall back to
    // our own extractor for providers that only return HTML.
    const page = result.text && result.text.trim().length > 200
      ? {
          text: String(result.text).slice(0, BASE_PAGE_TEXT_CHARS),
          chars: String(result.text).length,
          truncated: String(result.text).length > BASE_PAGE_TEXT_CHARS,
          mode: `provider:${result.source}`,
        }
      : extractPageContent(result.html || "", { maxChars: BASE_PAGE_TEXT_CHARS });

    if (wantsEnrichment && isEmptyExtraction(result.customExtraction)) {
      const plan = resolveExtractionPlan(options.enrichKey, options.customPrompt);

      // Gather subpages BEFORE the model call for entity capabilities, so the
      // one AI call reasons over the whole company surface. `deep:false` opts
      // out (batch runs at scale, where latency per row dominates).
      let related = [];
      const deepAllowed = options.deep !== false;
      if (deepAllowed && options.enrichKey && ENTITY_CAPABILITIES.has(options.enrichKey)) {
        try {
          related = await gatherRelatedPages(result.html || "", url, options.enrichKey);
        } catch (err) {
          console.warn("[DatIQ] related-page gather failed (continuing):", err?.message);
        }
      }

      const corpus = buildCorpus(url, page.text, related);
      const aiRes = await extractStructuredWithAI({
        plan, title: result.title || "", url,
        text: corpus.text, pagesRead: corpus.pagesRead,
      });

      if (aiRes.ok) {
        result.customExtraction = aiRes.data;
        aiExtractionUsed = true;
        enrichmentMeta = {
          ok: true,
          capability: plan.key,
          label: plan.label,
          groups: plan.groups || undefined,
          provider: aiRes.provider,
          model: aiRes.model,
          structured: aiRes.structured,
          facts: aiRes.facts,
          pagesRead: corpus.pagesRead,
        };
        if (corpus.pagesRead.length > 1) relatedPagesScanned = corpus.pagesRead.slice(1);
      } else {
        // SECOND CHANCE, and only for a genuine absence. When the reason is
        // infrastructure there is nothing to retry against — walking more
        // pages would spend three more fetches to reach the same dead chain.
        let secondReason = null;
        if (aiRes.reason === ENRICH_REASON.ABSENT && deepAllowed && related.length === 0
            && options.enrichKey && RELATED_PAGE_HINTS[options.enrichKey]?.length) {
          try {
            const late = await gatherRelatedPages(result.html || "", url, options.enrichKey);
            if (late.length) {
              const c2 = buildCorpus(url, page.text, late);
              const retry = await extractStructuredWithAI({
                plan, title: result.title || "", url, text: c2.text, pagesRead: c2.pagesRead,
              });
              if (retry.ok) {
                result.customExtraction = retry.data;
                aiExtractionUsed = true;
                relatedPagesScanned = c2.pagesRead.slice(1);
                enrichmentMeta = {
                  ok: true, capability: plan.key, label: plan.label,
                  groups: plan.groups || undefined, provider: retry.provider,
                  model: retry.model, structured: retry.structured,
                  facts: retry.facts, pagesRead: c2.pagesRead,
                };
              } else {
                secondReason = retry.reason;
              }
            }
          } catch (err) {
            console.warn("[DatIQ] related-page retry failed:", err?.message);
          }
        }
        if (!aiExtractionUsed) {
          // pickReason(), not `secondReason || aiRes.reason`. An absence found
          // on the retry must never overwrite an infrastructure failure from
          // the first pass — that substitution is the reported bug.
          enrichmentReason = pickReason(aiRes.reason, secondReason);
          // ⚠️ NO provider names, NO vendor error text, NO attempt list. This
          // response is read by every customer and every /api/v1 key holder,
          // and the vendors' own words are our billing state, not theirs
          // ("Your credit balance is too low…"). The client turns `reason`
          // into one generic sentence; the full diagnosis is in the function
          // log and on /admin/ai. See lib/aiFailure.js.
          logEnrichmentFailure(plan.key, enrichmentReason, aiRes.attempts);
          enrichmentMeta = {
            ok: false,
            capability: plan.key,
            label: plan.label,
            // COLLAPSED: every operator fault leaves as `ai_unavailable`. The
            // specific reason (`ai_no_credit`, `ai_bad_key`, …) stays in the
            // log line above and on /admin/ai. `no_match` and
            // `page_no_content` pass through — those are findings about the
            // customer's own page, and the UI says something useful for each.
            reason: publicFailureCode(enrichmentReason),
            // Which pages we read IS the customer's own information, and it is
            // what makes "we found nothing" a claim they can check.
            pagesRead: [url, ...related.map((r) => r.url)],
          };
        }
      }
    }

    // Build the normalised response.
    const responseBody = {
      data: {
        html: result.html,
        // THE PAGE BODY. Every client-side AI prompt (summary, generated
        // content, template synthesis, briefs) previously saw only headings
        // and a link list, because realScrape() parsed the HTML and threw it
        // away. That is why summaries read like a table of contents and a
        // "Competitor Summary" was an LLM guessing from a nav menu. Structure
        // is preserved (headings, list items, table rows) so a pricing grid
        // stays legible instead of collapsing into word soup.
        text: page.text || undefined,
        textMeta: page.text ? { chars: page.chars, truncated: page.truncated, mode: page.mode } : undefined,
        metadata: { title: result.title || "" },
        json: isEmptyExtraction(result.customExtraction) ? undefined : result.customExtraction,
      },
      source: result.source,
      _providerAttempts: result.attempts,
      // Present ONLY when a customPrompt was asked for and came back empty.
      // Absent on success, so existing clients are unaffected.
      // Full enrichment telemetry: which capability ran, which provider and
      // model answered, whether structured output was native, how many facts
      // came back, and which pages were read. On failure it carries the
      // specific reason plus the provider attempts, so an outage is legible
      // from the response instead of only from the function logs.
      // REDACTED AT THE SOURCE. enrichmentMeta carries `provider`, `model` and
      // `structured` for the server's own logging; none of the three is any of
      // a customer's business, and the UI is not the only reader of this body
      // (network tab, /api/v1 key holders, support screenshots, log
      // aggregators). Same boundary the failure path already enforces — this
      // was the success-path door, left open.
      ...(enrichmentMeta ? { _enrichment: publicProvenance(enrichmentMeta) } : {}),
      // True when the AI-extraction fallback produced the custom_extraction
      // (the chain itself didn't have a provider that supports it). Useful
      // for debug + so future tests can pin the regression fix. Stays
      // absent from the response when Firecrawl handled it natively, so
      // existing clients ignore it.
      ...(aiExtractionUsed ? { _aiExtractFallback: true } : {}),
      // Present only when the answer came from a related same-domain page
      // rather than the URL the caller gave us — e.g. pricing found on
      // /pricing after the homepage itself had none. Debug/UX transparency;
      // absent whenever no related-page scan happened.
      ...(relatedPagesScanned ? { _relatedPagesScanned: relatedPagesScanned } : {}),
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
