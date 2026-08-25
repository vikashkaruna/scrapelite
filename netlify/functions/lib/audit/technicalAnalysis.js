// technicalAnalysis.js — the Technical Accessibility pillar.
//
// Can a bot reach, render and trust this page at all? Everything the other
// three pillars measure is worthless if this one fails, which is why this
// module is also the one that raises most of the multiplicative PENALTY codes.
//
// ── WHY SOME FAILURES ARE COUNTED TWICE, DELIBERATELY ──────────────────────
// A robots block lowers crawl_index_eligibility AND triggers the
// AI_CRAWLER_BLOCKED penalty. That is not a bug. The signal answers "how does
// this page compare to a good one"; the penalty answers "does this page reach
// its audience at all". Counted once, a robots block would cost about six
// points on a page that is, in practice, invisible.

import {
  coreWebVitalsScore, cwvMetricScore, renderCompletenessScore, contentLossRatio,
  CWV_THRESHOLDS,
} from "../../../../src/lib/discoverability/signalScorers.js";
import { AI_CRAWLERS } from "../../../../src/lib/discoverability/constructTemplates.js";

/**
 * Below this share of content surviving in raw HTML, the page is treated as
 * effectively blank to a non-rendering crawler and takes the hard penalty
 * rather than only the graded signal.
 */
const HYDRATION_ONLY_LOSS = 0.65;
const SIGNIFICANT_LOSS = 0.30;

/** Normalise two URLs for canonical comparison — trailing slash and case only. */
export function sameUrl(a, b) {
  const norm = (u) => {
    try {
      const url = new URL(u);
      url.hash = "";
      return `${url.protocol}//${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
    } catch { return String(u || "").toLowerCase().replace(/\/$/, ""); }
  };
  return norm(a) === norm(b);
}

export function analyseTechnical(parsed, ctx = {}) {
  const signals = {};
  const reasons = {};
  const issues = [];
  const penalties = [];

  const meta = parsed.meta || {};
  const fetchFacts = ctx.fetch || {};
  const status = fetchFacts.status ?? null;

  // ── crawl & index eligibility ────────────────────────────────────────────
  // Built additively from four independent conditions so the score explains
  // itself: a page can be reachable, indexable, canonically sane and still
  // blocked to the crawlers that matter.
  let crawl = 100;

  if (status !== null && status !== 200) {
    crawl -= 60;
    issues.push({
      code: "TA-04", signalCode: "crawl_index_eligibility", measuredScore: 0,
      evidence: `The page returned HTTP ${status}.`,
      details: { status },
    });
  }

  if (meta.noindex) {
    crawl -= 40;
    penalties.push("NOINDEX");
    issues.push({
      code: "TA-03", signalCode: "crawl_index_eligibility", measuredScore: 0,
      evidence: `The meta robots directive is "${meta.robots}".`,
      details: { robots: meta.robots },
    });
  }

  // Canonical.
  const canonical = meta.canonical || null;
  const requestedUrl = ctx.url || fetchFacts.url || "";
  const canonicalSelf = canonical ? sameUrl(canonical, requestedUrl) : null;
  if (!canonical) {
    crawl -= 10;
    issues.push({
      code: "TA-06", signalCode: "crawl_index_eligibility", measuredScore: null,
      evidence: "No canonical link element is declared.",
      details: {},
    });
  } else if (ctx.canonicalStatus !== undefined && ctx.canonicalStatus !== null && ctx.canonicalStatus !== 200) {
    crawl -= 25;
    penalties.push("CANONICAL_TARGET_BROKEN");
    issues.push({
      code: "TA-05", signalCode: "crawl_index_eligibility", measuredScore: null,
      evidence: `The declared canonical (${canonical}) returned HTTP ${ctx.canonicalStatus}.`,
      details: { canonical, status: ctx.canonicalStatus },
    });
  }

  // ── AI crawler access ────────────────────────────────────────────────────
  // `null` for an agent means the policy could not be read. Unknown is excluded
  // from the tally in BOTH directions — it is neither an allow nor a block.
  const access = ctx.aiCrawlerAccess || null;
  let aiAccessFacts = null;
  if (access) {
    const agents = Object.keys(access);
    const blocked = agents.filter((a) => access[a] === false);
    const known = agents.filter((a) => access[a] !== null && access[a] !== undefined);
    aiAccessFacts = access;

    if (known.length === 0) {
      issues.push({
        code: "TA-16", signalCode: "crawl_index_eligibility", measuredScore: null,
        evidence: "robots.txt could not be read, so crawl policy for answer engines is unknown.",
        details: {},
      });
    } else if (blocked.length === known.length) {
      crawl -= 45;
      penalties.push("AI_CRAWLER_BLOCKED");
      issues.push({
        code: "TA-01", signalCode: "crawl_index_eligibility", measuredScore: 0,
        evidence: `robots.txt disallows every answer-engine crawler checked (${blocked.join(", ")}).`,
        details: { blocked },
      });
    } else if (blocked.length > 0) {
      crawl -= 15;
      penalties.push("AI_CRAWLER_PARTIAL_BLOCK");
      issues.push({
        code: "TA-02", signalCode: "crawl_index_eligibility",
        measuredScore: Math.max(0, crawl),
        evidence: `${blocked.length} of ${known.length} answer-engine crawlers are disallowed (${blocked.join(", ")}), while the rest are permitted.`,
        details: { blocked, allowed: known.filter((a) => access[a] === true) },
      });
    }
  } else if (ctx.robotsError) {
    issues.push({
      code: "TA-16", signalCode: "crawl_index_eligibility", measuredScore: null,
      evidence: `robots.txt could not be fetched: ${ctx.robotsError}.`,
      details: { error: ctx.robotsError },
    });
  }
  signals.crawl_index_eligibility = Math.max(0, Math.min(100, crawl));

  // ── render completeness ──────────────────────────────────────────────────
  const rawWords = fetchFacts.rawWordCount;
  const renderedWords = fetchFacts.renderedWordCount;
  signals.render_completeness = renderCompletenessScore({ rawWords, renderedWords });
  const loss = contentLossRatio({ rawWords, renderedWords });

  if (signals.render_completeness === null) {
    reasons.render_completeness = "not_measured";
  } else if (loss !== null && loss >= HYDRATION_ONLY_LOSS) {
    penalties.push("CONTENT_HYDRATION_ONLY");
    issues.push({
      code: "TA-07", signalCode: "render_completeness", measuredScore: signals.render_completeness,
      evidence: `Only ${rawWords} of ${renderedWords} words are present before JavaScript runs — ${Math.round(loss * 100)}% of the content is invisible to a non-rendering crawler.`,
      details: { rawWords, renderedWords, contentLossRatio: loss },
    });
  } else if (loss !== null && loss >= SIGNIFICANT_LOSS) {
    issues.push({
      code: "TA-08", signalCode: "render_completeness", measuredScore: signals.render_completeness,
      evidence: `${Math.round(loss * 100)}% of the rendered content is missing from the raw HTML.`,
      details: { rawWords, renderedWords, contentLossRatio: loss },
    });
  }

  // ── Core Web Vitals ──────────────────────────────────────────────────────
  const cwv = ctx.webVitals || null;
  if (!cwv || (cwv.lcp == null && cwv.inp == null && cwv.cls == null)) {
    // PageSpeed unavailable, rate-limited, or no field data for this URL. The
    // signal drops out and its 30% of the pillar redistributes. Scoring 0 here
    // would subtract ~7.5 points from every audit run during an outage and then
    // show a phantom improvement when it came back.
    signals.core_web_vitals = null;
    reasons.core_web_vitals = "not_measured";
  } else {
    signals.core_web_vitals = coreWebVitalsScore(cwv);
    const raise = (code, metric, value) => {
      if (cwvMetricScore(metric, value) === 100) return;
      const t = CWV_THRESHOLDS[metric];
      issues.push({
        code, signalCode: "core_web_vitals", measuredScore: signals.core_web_vitals,
        evidence: `${t.label} is ${value}${t.unit} against a good threshold of ${t.good}${t.unit}.`,
        details: { metric, value, threshold: t.good, source: cwv.source || null },
      });
    };
    if (cwv.lcp != null) raise("TA-09", "lcp", cwv.lcp);
    if (cwv.inp != null) raise("TA-10", "inp", cwv.inp);
    if (cwv.cls != null) raise("TA-11", "cls", cwv.cls);
  }

  // ── mobile parity ────────────────────────────────────────────────────────
  if (!meta.viewport) {
    signals.mobile_parity = 20;
    penalties.push("MOBILE_PARITY_MISSING");
    issues.push({
      code: "TA-12", signalCode: "mobile_parity", measuredScore: 20,
      evidence: "No viewport meta tag, so the page is not declared responsive and crawling is mobile-first.",
      details: {},
    });
  } else {
    const responsive = /width\s*=\s*device-width/i.test(meta.viewport);
    signals.mobile_parity = responsive ? 100 : 60;
    if (!responsive) {
      issues.push({
        code: "TA-12", signalCode: "mobile_parity", measuredScore: 60,
        evidence: `The viewport is declared as "${meta.viewport}" rather than width=device-width.`,
        details: { viewport: meta.viewport },
      });
    }
  }

  // ── structured data validity ─────────────────────────────────────────────
  const jsonLdErrors = parsed.jsonLdErrors || [];
  const blockCount = (parsed.jsonLd || []).length;

  if (jsonLdErrors.length > 0) {
    // A block that does not parse is discarded WHOLE, so every signal it was
    // carrying is lost silently. That is a different, worse problem than
    // having no markup, and it is why the two are separate issue codes.
    signals.structured_data_validity = Math.max(
      0, Math.round(100 * (blockCount / (blockCount + jsonLdErrors.length))) - 20,
    );
    issues.push({
      code: "TA-13", signalCode: "structured_data_validity",
      measuredScore: signals.structured_data_validity,
      evidence: `${jsonLdErrors.length} JSON-LD block${jsonLdErrors.length === 1 ? "" : "s"} failed to parse and ${jsonLdErrors.length === 1 ? "is" : "are"} being discarded entirely.`,
      details: { errors: jsonLdErrors.slice(0, 3) },
    });
  } else if (blockCount === 0) {
    signals.structured_data_validity = 0;
    // TA-15 ("no structured data at all") is raised by the entity analyser,
    // which already knows whether anything at all was found. Raising it here
    // too would double-report the same absence in the issue list.
  } else {
    signals.structured_data_validity = 100;
  }

  // FAQ markup that describes invisible text is both a structural defect and a
  // trust penalty. The structure analyser raises the issue; the penalty belongs
  // here, where the rest of the multiplicative layer lives.
  if (ctx.faqMismatch) penalties.push("FAQ_SCHEMA_MISMATCH");

  return {
    signals, reasons, issues, penalties,
    facts: {
      http_status: status,
      indexable: !meta.noindex && (status === null || status === 200),
      canonical_url: canonical,
      canonical_self_reference: canonicalSelf,
      canonical_status: ctx.canonicalStatus ?? null,
      robots_txt_accessible: ctx.robotsError ? false : Boolean(access),
      ai_crawler_access: aiAccessFacts,
      meta_robots: meta.robots || null,
      viewport: meta.viewport || null,
      lang: meta.lang || null,
      core_web_vitals: cwv ? {
        lcp_seconds: cwv.lcp ?? null,
        inp_ms: cwv.inp ?? null,
        cls: cwv.cls ?? null,
        ttfb_ms: cwv.ttfb ?? null,
        source: cwv.source || null,
      } : null,
      rendering: {
        raw_html_word_count: rawWords ?? null,
        rendered_dom_word_count: renderedWords ?? null,
        content_loss_ratio: loss,
        renderer: fetchFacts.renderer || null,
      },
      structured_data: {
        block_count: blockCount,
        parse_errors: jsonLdErrors.length,
        types: parsed.schemaTypes || [],
      },
      checked_ai_crawlers: AI_CRAWLERS,
    },
  };
}
