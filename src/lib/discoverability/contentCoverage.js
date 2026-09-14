// contentCoverage.js — which KINDS of page a site publishes, and which it does not.
//
// PURE. Given the urls a sitemap declares, sort them into the four content
// kinds the PRD names — category, comparison, use case, industry — and report
// which kinds are absent.
//
// ── THIS MODULE MAKES A CLAIM ABOUT SOMEBODY'S WHOLE SITE, SO READ THIS ─────
// Everything here is inferred from URL SHAPE. That is a heuristic, not a fact.
// A site really can publish comparisons at /battle-cards/ or /head-to-head/,
// and we will not see them. So every statement this module produces is phrased
// as what we MATCHED, never as what the site HAS:
//
//   ✅ "No url among the 412 in your sitemap matches a comparison pattern."
//   ❌ "Your site has no comparison page."
//
// The first is measured and defensible. The second is a claim we cannot
// support, about a site we read one page of — and it is the kind of confident
// wrongness that costs trust faster than saying nothing would. W4 split
// `observed` from `inference` for exactly this: the match count is observed,
// "you should publish one" is reasoned.
//
// ⚠️ ABSENCE IS ONLY REPORTABLE WHEN THE SITEMAP WAS ACTUALLY READ. Callers get
// `fetched` from `fetchSitemapUrls` and MUST branch on it first. An unread
// sitemap yields no findings at all — not "zero matches".

/**
 * The four kinds, with the url shapes that identify each.
 *
 * Patterns are deliberately BROAD. A false positive costs us one unraised
 * recommendation; a false negative tells a customer they are missing a page
 * they already publish, which is the expensive mistake here.
 */
export const CONTENT_KINDS = Object.freeze({
  comparison: {
    id: "comparison",
    label: "Comparison",
    patterns: [/\/vs[\/-]/i, /\/compare/i, /-vs-/i, /\/alternatives?/i, /\/versus/i, /\/head-to-head/i, /\/battle-?cards?/i],
    query: "\"X vs Y\", \"alternatives to X\", \"is X better than Y\"",
    why: "Comparison queries are high intent and are answered disproportionately by whoever published the comparison — including by answer engines, which cite a side-by-side far more readily than a product page.",
  },
  use_case: {
    id: "use_case",
    label: "Use case",
    patterns: [/\/use-?cases?/i, /\/solutions?/i, /\/for-[a-z]/i, /\/how-to/i, /\/guides?\//i, /\/playbooks?/i],
    query: "\"how do I do J\", \"X for J\"",
    why: "A use-case page matches the job a reader is trying to finish rather than the product they have not chosen yet, which is the phrasing most searches actually use.",
  },
  industry: {
    id: "industry",
    label: "Industry",
    patterns: [/\/industr(y|ies)/i, /\/sectors?/i, /\/verticals?/i, /\/for-(healthcare|finance|legal|retail|education|manufacturing|government|nonprofit)/i],
    query: "\"X for healthcare\", \"X for legal teams\"",
    why: "Industry pages carry the constraints, vocabulary and proof a buyer in that sector checks for, none of which a general product page can hold at once.",
  },
  category: {
    id: "category",
    label: "Category",
    patterns: [/\/categor(y|ies)/i, /\/collections?/i, /\/topics?/i, /\/browse/i, /\/directory/i],
    query: "\"best X tools\", \"types of X\"",
    why: "A category page is the page that can rank for the plural, unbranded query — the one a reader types before they know which product they want.",
  },
});

export const CONTENT_KIND_IDS = Object.freeze(Object.keys(CONTENT_KINDS));

/** Lookup with a null for an unknown id, never a throw. */
export function contentKind(id) {
  return CONTENT_KINDS[id] || null;
}

/** Which kinds does this single url look like? A url may match more than one. */
export function classifyUrl(url) {
  const s = String(url || "");
  if (!s) return [];
  let path = s;
  try { path = new URL(s).pathname; } catch { /* classify the raw string */ }
  return CONTENT_KIND_IDS.filter((id) => CONTENT_KINDS[id].patterns.some((re) => re.test(path)));
}

/**
 * Sort a site's urls into the four kinds and report which matched nothing.
 *
 * `sitemap` is the whole result from `fetchSitemapUrls`, not just its urls —
 * deliberately, so a caller cannot reach the counts without also holding the
 * `fetched` flag that says whether they mean anything.
 *
 * When the sitemap was not read, `usable` is false and `missing` is EMPTY. That
 * is the load-bearing line in this file: no read, no absence, no finding.
 */
export function analyseContentCoverage(sitemap = {}) {
  const fetched = Boolean(sitemap.fetched);
  const urls = Array.isArray(sitemap.urls) ? sitemap.urls : [];

  const matches = Object.fromEntries(CONTENT_KIND_IDS.map((id) => [id, []]));
  if (fetched) {
    for (const u of urls) {
      for (const id of classifyUrl(u)) {
        if (matches[id].length < 25) matches[id].push(u);
      }
    }
  }

  const counts = Object.fromEntries(CONTENT_KIND_IDS.map((id) => [id, matches[id].length]));

  // ⚠️ A truncated crawl saw only part of the site, so a kind absent from what
  // we read may be present in what we did not. Reporting it as missing would
  // be the budget-skip confusion again, one level up.
  const usable = fetched && !sitemap.truncated;

  return {
    usable,
    fetched,
    truncated: Boolean(sitemap.truncated),
    reason: sitemap.reason || null,
    urlsSeen: fetched ? urls.length : 0,
    counts,
    matches,
    missing: usable ? CONTENT_KIND_IDS.filter((id) => counts[id] === 0) : [],
    present: fetched ? CONTENT_KIND_IDS.filter((id) => counts[id] > 0) : [],
  };
}

/**
 * The sentence an issue records as its OBSERVED fact.
 *
 * Names the pattern set as well as the count, because a reader who publishes
 * comparisons at a url we do not match deserves to see immediately why we
 * missed them — rather than concluding our audit is simply wrong.
 */
export function describeAbsence(kindId, coverage = {}) {
  const kind = contentKind(kindId);
  if (!kind) return null;
  const n = coverage.urlsSeen || 0;
  return `None of the ${n} url${n === 1 ? "" : "s"} in this site's sitemap matches a ${kind.label.toLowerCase()} pattern (${kind.patterns.length} shapes checked, including ${kind.patterns.slice(0, 2).map((r) => r.source.replace(/\\\//g, "/").replace(/[\^$]/g, "")).join(" and ")}).`;
}
