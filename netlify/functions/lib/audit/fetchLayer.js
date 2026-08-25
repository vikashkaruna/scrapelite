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
export async function checkCanonicalTarget(canonicalUrl, requestedUrl) {
  if (!canonicalUrl) return null;
  let absolute;
  try { absolute = new URL(canonicalUrl, requestedUrl).toString(); } catch { return null; }
  // A self-referencing canonical is already proven reachable by the page fetch
  // that produced it; re-requesting it would only spend budget confirming what
  // we know.
  if (absolute === requestedUrl) return 200;
  if (!(await isPublicHttpUrlAsync(absolute))) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CANONICAL_TIMEOUT_MS);
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
  if (robots.error) return { access: null, error: robots.error, robotsFound: false };
  return {
    access: evaluateAgentAccess(robots.text, agents, path),
    error: null,
    // A missing robots.txt is PERMISSIVE, and distinct from an unreadable one.
    robotsFound: robots.text !== null && robots.text !== undefined,
  };
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

  const [raw, rendered, crawler] = await Promise.all([
    fetchRawHtml(url, opts),
    // renderJs only helps where an upstream provider can actually honour it.
    runScrapeChain(url, headless ? { renderJs: true } : {}).catch((err) => ({
      ok: false, error: err?.message || "scrape chain threw",
    })),
    checkAiCrawlerAccess(url).catch(() => ({ access: null, error: "crawler check failed", robotsFound: false })),
  ]);

  const rawHtml = raw.ok ? raw.html : "";
  const renderedHtml = rendered?.ok && rendered.html ? capHtml(rendered.html).html : "";

  // Parse from the rendered DOM where we have one — that is what a reader and a
  // rendering crawler see, and therefore what the content pillars should judge.
  const primaryHtml = renderedHtml || rawHtml;

  const rawWordCount = rawHtml ? wordCount(visibleText(rawHtml)) : null;
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
      // Without a headless provider the "rendered" HTML is the same static
      // snapshot, so the comparison would be a tautology reading 100. Report
      // it as unmeasured instead — see the header.
      renderedWordCount: headless ? renderedWordCount : null,
      renderer: headless ? (rendered?.source || null) : null,
      headlessAvailable: headless,
      scrapeProvider: rendered?.source || null,
      scrapeAttempts: rendered?.attempts || [],
    },
    aiCrawlerAccess: crawler.access,
    robotsError: crawler.error,
    robotsFound: crawler.robotsFound,
    ok: Boolean(primaryHtml),
  };
}
