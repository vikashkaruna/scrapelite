// fetchLayer.js — gather the raw material an audit scores.
//
// ── THE TWO FETCHES, AND WHY BOTH ARE NECESSARY ────────────────────────────
// This module deliberately fetches the page TWICE:
//
//   RAW      a plain HTTP GET, no JavaScript. This is what a non-rendering
//            crawler receives — and several answer-engine crawlers do not
//            execute JavaScript at all.
//   RENDERED through the existing scrape chain with renderJs, so upstream
//            (Firecrawl / Spider) runs the page's JavaScript.
//
// Comparing the two is the ONLY way to measure render completeness, which is
// the difference between "this page looks great" and "this page is blank to
// half the crawlers that matter". A single fetch cannot produce that number.
//
// When no headless-capable provider is configured the two fetches return the
// same HTML, the comparison becomes meaningless, and we report render
// completeness as UNMEASURED rather than as a perfect 100. Claiming a perfect
// render score because we never rendered anything would be the exact inversion
// of the truth.
//
// ── EVERY FETCH GOES THROUGH THE SSRF GUARD ────────────────────────────────
// fetchPublicUrl / isPublicHttpUrlAsync are the same guards extract.js uses.
// An audit takes a URL from a user and fetches it server-side, so it is the
// same attack surface and gets the same protection — no exceptions for the
// robots.txt or canonical follow-ups.

import { runScrapeChain } from "../scrapeProviders.js";
import { isHeadlessAvailable } from "../headlessProvider.js";
import { fetchPublicUrl, isPublicHttpUrlAsync } from "../publicUrl.js";
import { fetchRobotsText, evaluateAgentAccess } from "../complianceEngine.js";
import { AI_CRAWLERS } from "../../../../src/lib/discoverability/constructTemplates.js";
import { visibleText, wordCount, capHtml } from "./htmlParse.js";

export const RAW_FETCH_TIMEOUT_MS = 10_000;
export const CANONICAL_TIMEOUT_MS = 6_000;
export const AUDIT_UA = "DatIQBot/1.0 (+https://datiq.app/about; discoverability audit)";

/**
 * Does this look like a complete HTML document rather than a fragment?
 *
 * ⚠️ THIS CHECK IS LOAD-BEARING AND THE REASON IS NOT OBVIOUS.
 *
 * The scrape chain's later providers do not return the page's HTML. Jina AI
 * returns MARKDOWN, which scrapeProviders.js converts to a minimal HTML shell
 * of headings and links — no <head>, and therefore no meta tags, no canonical,
 * no viewport, no lang, no JSON-LD.
 *
 * Parsing that as if it were the page reports every head-level signal as
 * missing. On example.com the audit confidently raised "no viewport meta tag"
 * and applied the mobile-parity penalty to a page whose very first meta tag is
 * a viewport. A whole pillar's worth of phantom findings, delivered with total
 * confidence — which is the worst failure an audit tool has, because the user
 * cannot tell it apart from a real one.
 *
 * So a fragment is never allowed to displace a real document.
 */
/**
 * A complete HTML document that defers its content to JavaScript.
 *
 * A single-page app serves a real, well-formed document containing a mount
 * point and a script tag. To a crawler that does not execute JavaScript that
 * page has no headings, no answer passage and no structure — which is a REAL
 * finding, and an important one.
 *
 * But reporting it as "your page has no H1" is the wrong sentence. The author
 * can see their H1; what they cannot see is that half their audience cannot.
 * Detecting the shell lets the engine say the accurate thing — the content is
 * JavaScript-only — which is both true and actionable.
 *
 * Deliberately conservative. It requires a real document, a substantial script
 * presence, and almost no visible text, so a genuinely short page is not
 * mistaken for a shell.
 */
export function looksLikeJsShell(html, visibleWordCount) {
  if (!looksLikeFullDocument(html)) return false;
  if (!Number.isFinite(visibleWordCount) || visibleWordCount > 60) return false;
  const scripts = (html.match(/<script\b/gi) || []).length;
  const hasMount = /<div[^>]+id\s*=\s*["']?(root|app|__next|___gatsby)["']?/i.test(html);
  return scripts >= 1 && (hasMount || scripts >= 3);
}

export function looksLikeFullDocument(html) {
  if (!html || html.length < 40) return false;
  return /<html[\s>]/i.test(html) || /<head[\s>]/i.test(html) || /<!doctype\s+html/i.test(html);
}

/** The raw HTML a non-rendering crawler receives. */
export async function fetchRawHtml(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || RAW_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchPublicUrl(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": AUDIT_UA, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);
    const html = await res.text();
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers?.get?.("content-type") || null,
      html: capHtml(html).html,
      // A redirect chain that lands somewhere else is a canonical fact, not an
      // error, and the technical analyser needs to know about it.
      redirected: Boolean(res.url && res.url !== url),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: null,
      error: err?.name === "AbortError" ? "raw fetch timed out" : (err?.message || "raw fetch failed"),
      html: "",
    };
  }
}

/** Is the canonical target actually reachable? Drives TA-05 and its penalty. */
export async function checkCanonicalTarget(canonicalUrl, requestedUrl, opts = {}) {
  if (!canonicalUrl) return null;
  let absolute;
  try { absolute = new URL(canonicalUrl, requestedUrl).toString(); } catch { return null; }
  // A self-referencing canonical is already proven reachable by the page fetch
  // that produced it; re-requesting it would only spend budget confirming what
  // we know.
  if (absolute === requestedUrl) return 200;
  if (!(await isPublicHttpUrlAsync(absolute))) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || CANONICAL_TIMEOUT_MS);
  try {
    const res = await fetchPublicUrl(absolute, {
      method: "HEAD", signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": AUDIT_UA },
    });
    clearTimeout(timer);
    // Some servers reject HEAD outright while serving GET fine. Treating a 405
    // as a broken canonical would be a false critical finding on a working page.
    if (res.status === 405 || res.status === 501) return 200;
    return res.status;
  } catch {
    clearTimeout(timer);
    return null;   // could not check — unknown, so no penalty is applied
  }
}

/** Which answer-engine crawlers may fetch this path? */
export async function checkAiCrawlerAccess(url, agents = AI_CRAWLERS) {
  let origin;
  let path = "/";
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname + (u.search || "");
  } catch {
    return { access: null, error: "invalid url", robotsFound: false };
  }

  const robots = await fetchRobotsText(origin);
  if (robots.error) {
    return { access: null, error: robots.error, robotsFound: false, sitemaps: [] };
  }
  return {
    access: evaluateAgentAccess(robots.text, agents, path),
    error: null,
    // A missing robots.txt is PERMISSIVE, and distinct from an unreadable one.
    robotsFound: robots.text !== null && robots.text !== undefined,
    // Read from the SAME fetch, so the sitemap indicator the BRD asks for costs
    // no extra request. A second fetch of robots.txt for this alone would be
    // a request we already made, against a host we have promised to be polite to.
    sitemaps: extractSitemapDeclarations(robots.text),
  };
}

/**
 * Sitemap declarations in robots.txt.
 *
 * `Sitemap:` is a NON-GROUP directive — it belongs to the file, not to any
 * `User-agent` block — so it is read globally rather than per agent. A file can
 * legitimately declare several (an index plus per-section maps), and the cap
 * exists because a robots.txt is attacker-controllable text and an unbounded
 * list would ride along on every audit row for that host thereafter.
 */
export const MAX_SITEMAP_DECLARATIONS = 20;

export function extractSitemapDeclarations(robotsText) {
  if (!robotsText) return [];
  const out = [];
  for (const line of String(robotsText).split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!m) continue;
    // Only absolute HTTP(S). A relative or javascript: value is not a sitemap,
    // and recording it as one would put a bad URL in front of a customer as
    // though we had verified it.
    if (!/^https?:\/\//i.test(m[1])) continue;
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= MAX_SITEMAP_DECLARATIONS) break;
  }
  return out;
}

/**
 * Collect everything, in parallel where it is safe to do so.
 *
 * The raw and rendered fetches run concurrently: they are independent, and
 * running them in series would roughly double the wall-clock of the slowest
 * part of the audit for no benefit.
 */
export async function collectPage(url, opts = {}) {
  const env = opts.env || process.env;
  const headless = isHeadlessAvailable(env);

  // The audit's wall-clock budget, when it has one. These three run
  // concurrently, so this stage costs the slowest of them — but the scrape
  // chain is itself a serial fallback over four providers, so without a
  // deadline it alone can reach 80s against a function killed at 10.
  const deadline = opts.deadline || null;
  const slice = deadline ? deadline.sliceFor(RAW_FETCH_TIMEOUT_MS) : RAW_FETCH_TIMEOUT_MS;
  const deadlineAt = deadline ? Date.now() + slice : null;
  const chainOpts = { ...(headless ? { renderJs: true } : {}) };
  if (deadlineAt !== null) chainOpts.deadlineAt = deadlineAt;

  const [raw, rendered, crawler] = await Promise.all([
    fetchRawHtml(url, { ...opts, timeoutMs: opts.timeoutMs || slice }),
    // renderJs only helps where an upstream provider can actually honour it.
    runScrapeChain(url, chainOpts).catch((err) => ({
      ok: false, error: err?.message || "scrape chain threw",
    })),
    checkAiCrawlerAccess(url).catch(() => ({ access: null, error: "crawler check failed", robotsFound: false, sitemaps: [] })),
  ]);

  const rawHtml = raw.ok ? raw.html : "";
  const renderedHtml = rendered?.ok && rendered.html ? capHtml(rendered.html).html : "";

  const rawIsDocument = looksLikeFullDocument(rawHtml);
  const renderedIsDocument = looksLikeFullDocument(renderedHtml);

  // Choose what the analysers parse.
  //
  // Prefer the rendered DOM — it is what a reader and a rendering crawler see,
  // and it carries content that only exists after JavaScript. But ONLY when it
  // is a real document. A markdown-derived fragment from a fallback provider
  // has no <head>, so parsing it would report every meta tag, the canonical and
  // all structured data as absent.
  let primaryHtml;
  let primarySource;
  if (renderedIsDocument) {
    primaryHtml = renderedHtml;
    primarySource = "rendered";
  } else if (rawIsDocument) {
    primaryHtml = rawHtml;
    primarySource = "raw";
  } else {
    // Neither is a full document. Take whichever has more to say and record
    // that the head-level signals are unreliable, rather than reporting them
    // as measured absences.
    primaryHtml = renderedHtml.length > rawHtml.length ? renderedHtml : rawHtml;
    primarySource = "fragment";
  }

  const rawWordCount = rawHtml ? wordCount(visibleText(rawHtml)) : null;
  const rawIsJsShell = looksLikeJsShell(rawHtml, rawWordCount);
  const renderedWordCount = renderedHtml ? wordCount(visibleText(renderedHtml)) : null;

  return {
    url,
    primaryHtml,
    rawHtml,
    renderedHtml,
    fetch: {
      url,
      status: raw.status,
      finalUrl: raw.finalUrl || url,
      redirected: Boolean(raw.redirected),
      contentType: raw.contentType || null,
      error: raw.ok ? null : raw.error,
      rawWordCount,
      // Two conditions, both required:
      //   • a headless provider actually ran, otherwise the comparison is a
      //     tautology between two copies of the same static snapshot
      //   • the rendered side is a real document, otherwise we would be
      //     comparing a markdown fragment's word count against a full page and
      //     reporting a lossy CONVERSION as a hydration gap
      renderedWordCount: headless && renderedIsDocument ? renderedWordCount : null,
      renderer: headless ? (rendered?.source || null) : null,
      headlessAvailable: headless,
      primarySource,
      // False when we only had a fragment to work with. The technical analyser
      // reads this and reports head-level signals as UNMEASURED rather than as
      // measured absences — the same rule the rest of the engine follows.
      headSignalsReliable: primarySource !== "fragment",
      // A complete document that defers its content to JavaScript. Lets the
      // technical analyser say "your content is JavaScript-only" instead of
      // the content analysers each reporting their own half of that as a
      // separate, confusing defect.
      rawIsJsShell,
      parsedRenderedContent: primarySource === "rendered",
      scrapeProvider: rendered?.source || null,
      scrapeAttempts: rendered?.attempts || [],
    },
    aiCrawlerAccess: crawler.access,
    robotsError: crawler.error,
    robotsFound: crawler.robotsFound,
    sitemaps: crawler.sitemaps || [],
    ok: Boolean(primaryHtml),
  };
}
