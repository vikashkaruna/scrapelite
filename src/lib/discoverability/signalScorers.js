// signalScorers.js — the individual 0-100 formulas behind the named signals.
//
// PURE. Every function here takes measured facts and returns a normalised
// score, or `null` when the facts needed to judge were not available. They are
// separated from scoringModel.js because these are the opinionated,
// domain-judgement half of the engine — the part most likely to be tuned as
// answer-engine behaviour changes — whereas the weighted-mean arithmetic next
// door should essentially never change.
//
// ── null vs 0, restated, because it is easy to get wrong here ──────────────
// `null` means "we could not judge". `0` means "we judged, and it failed".
// coreWebVitals with no PageSpeed response is null. coreWebVitals with a 9
// second LCP is a low number. Returning 0 for the first case would invent a
// defect; returning null for the second would hide a real one.

// ── Answer Clarity ─────────────────────────────────────────────────────────

/** Word count that answer-engine guidance converges on for a direct answer. */
export const IDEAL_ANSWER_MIN = 40;
export const IDEAL_ANSWER_MAX = 60;

/**
 * Conciseness of the primary answer passage.
 *
 * Shape: flat 100 across the 40-60 word band that AEO guidance recommends,
 * ramping up from a fragment below it and decaying past it, with a soft floor
 * rather than a hard zero for very long passages. The floor matters — a 400
 * word answer is a worse answer, not the absence of one, and scoring it the
 * same as a page with nothing at all would tell the author to delete instead
 * of tighten.
 *
 * @param {number} words  length of the primary answer passage
 * @returns {number|null} null only when no answer passage was identified at all
 *                        AND that fact is unknown rather than measured
 */
export function concisenessScore(words) {
  if (!Number.isFinite(words)) return null;
  // A measured zero is a real failure: there is no answer passage to be
  // concise about. It is scored, not excused.
  if (words <= 0) return 0;
  // Below ~10 words this is a heading fragment, not a self-contained answer.
  if (words < 10) return 20;
  // Ramp: 10 words scores 40, rising to 100 at the start of the ideal band.
  if (words < IDEAL_ANSWER_MIN) return 40 + ((words - 10) / (IDEAL_ANSWER_MIN - 10)) * 60;
  if (words <= IDEAL_ANSWER_MAX) return 100;
  // Decay to 30 at 200 words, the point AEO guidance treats as a soft failure
  // for an answer meant to be quoted whole.
  if (words <= 200) return 100 - (words - IDEAL_ANSWER_MAX) * (70 / (200 - IDEAL_ANSWER_MAX));
  // Beyond that, keep declining but never below 10.
  return Math.max(10, 30 - (words - 200) * 0.05);
}

/**
 * Position of the direct answer within the page.
 *
 * Answer-first placement is the single most repeated recommendation in AEO
 * guidance: the resolution belongs above the fold, not after the narrative.
 *
 * @param {number} positionPercent  how far into the document the answer starts
 */
export function answerPositionScore(positionPercent) {
  if (!Number.isFinite(positionPercent)) return null;
  if (positionPercent <= 10) return 100;   // first screenful
  if (positionPercent <= 25) return 80;
  if (positionPercent <= 50) return 55;
  if (positionPercent <= 75) return 30;
  return 15;                                // buried at the bottom
}

/**
 * Scannable formatting — lists and tables.
 *
 * Answer engines lift ordered lists and comparison tables close to verbatim, so
 * their presence raises the odds of extraction. This saturates deliberately:
 * six lists is not six times better than one, and rewarding volume would push
 * authors to fragment prose into bullet soup.
 */
export function extractableFormattingScore({ lists = 0, tables = 0, listItems = 0 } = {}) {
  if (![lists, tables, listItems].every(Number.isFinite)) return null;
  let score = 0;
  if (lists > 0) score += 45;
  if (tables > 0) score += 30;
  // Substance check: a two-item list is decoration, not structure.
  if (listItems >= 3) score += 25;
  else if (listItems > 0) score += 10;
  return Math.min(100, score);
}

// ── Structural Hierarchy ───────────────────────────────────────────────────

/** Points removed per skipped heading level (H2 → H4 with no H3 between). */
export const SKIP_PENALTY = 15;
/** Points removed per structurally empty heading — a tag used for styling. */
export const EMPTY_HEADING_PENALTY = 8;

/**
 * Heading tree integrity.
 *
 * Retrieval systems chunk documents on their heading hierarchy, so a skipped
 * level does not merely look untidy — it merges two logically distinct sections
 * into one chunk and splits the answer away from its question. Empty headings
 * are penalised more gently: they are noise in the outline rather than a
 * mis-nesting of real content.
 */
export function headingTreeIntegrityScore({ skipped = 0, empty = 0, total = 0 } = {}) {
  if (!Number.isFinite(skipped) || !Number.isFinite(empty)) return null;
  // No headings at all is a measured failure of structure, not an unknown.
  if (total === 0) return 0;
  return Math.max(0, 100 - skipped * SKIP_PENALTY - empty * EMPTY_HEADING_PENALTY);
}

/**
 * Single, intent-aligned H1.
 *
 * Zero H1s and several H1s are different failures. No H1 leaves the page with
 * no declared subject; several leave a machine choosing between competing
 * subjects, which is milder but still ambiguous.
 */
export function singleH1Score({ h1Count = 0, h1Text = "", titleText = "" } = {}) {
  if (!Number.isFinite(h1Count)) return null;
  if (h1Count === 0) return 0;
  let score = h1Count === 1 ? 100 : Math.max(40, 100 - (h1Count - 1) * 25);
  // Intent alignment: an H1 that shares no vocabulary with the <title> means
  // the two most important labels on the page disagree about its subject.
  if (h1Text && titleText) {
    const norm = (s) => new Set(
      String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3),
    );
    const a = norm(h1Text);
    const b = norm(titleText);
    if (a.size && b.size) {
      const shared = [...a].filter((w) => b.has(w)).length;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap < 0.2) score = Math.min(score, 55);
    }
  }
  return score;
}

// ── Technical Accessibility ────────────────────────────────────────────────

/** Published Core Web Vitals thresholds. Good / needs-improvement boundaries. */
export const CWV_THRESHOLDS = Object.freeze({
  lcp: { good: 2.5,  poor: 4.0,  unit: "s",  label: "Largest Contentful Paint" },
  inp: { good: 200,  poor: 500,  unit: "ms", label: "Interaction to Next Paint" },
  cls: { good: 0.1,  poor: 0.25, unit: "",   label: "Cumulative Layout Shift" },
});

/** One metric against its thresholds: 100 good, 60 needs work, 20 poor. */
export function cwvMetricScore(metric, value) {
  const t = CWV_THRESHOLDS[metric];
  if (!t || !Number.isFinite(value)) return null;
  if (value < t.good) return 100;
  if (value <= t.poor) return 60;
  return 20;
}

/**
 * Core Web Vitals composite.
 *
 * Averages only the metrics that came back. Field data (CrUX) frequently omits
 * INP for low-traffic URLs, and treating that absence as a failure would punish
 * exactly the small sites this product is meant to help. All three missing
 * returns null and the signal drops out of the pillar entirely.
 */
export function coreWebVitalsScore({ lcp, inp, cls } = {}) {
  const parts = [
    cwvMetricScore("lcp", lcp),
    cwvMetricScore("inp", inp),
    cwvMetricScore("cls", cls),
  ].filter((v) => v !== null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * Render completeness — how much of the page survives without JavaScript.
 *
 * Compares the word count of the rendered DOM against the raw HTML a
 * non-rendering crawler receives. Several answer-engine crawlers do not execute
 * JavaScript at all, so content that only exists after hydration is invisible
 * to them however good it is.
 *
 * A small gap is normal and forgiven — client-side nav, cookie widgets and lazy
 * comment threads all inflate the rendered count without touching the content
 * that matters.
 */
export function renderCompletenessScore({ rawWords, renderedWords } = {}) {
  if (!Number.isFinite(rawWords) || !Number.isFinite(renderedWords)) return null;
  if (renderedWords <= 0) return null;      // nothing rendered: nothing to compare
  const loss = Math.max(0, (renderedWords - rawWords) / renderedWords);
  if (loss <= 0.10) return 100;                                  // normal enhancement
  if (loss <= 0.50) return 100 - ((loss - 0.10) / 0.40) * 60;    // 100 → 40
  if (loss <= 0.90) return Math.max(0, 40 - ((loss - 0.50) / 0.40) * 40); // 40 → 0
  return 0;                                                       // effectively blank
}

/** The loss ratio itself, surfaced as a fact in the JSON payload. */
export function contentLossRatio({ rawWords, renderedWords } = {}) {
  if (!Number.isFinite(rawWords) || !Number.isFinite(renderedWords) || renderedWords <= 0) return null;
  return Math.round(Math.max(0, (renderedWords - rawWords) / renderedWords) * 10000) / 10000;
}

// ── Entity Authority ───────────────────────────────────────────────────────

/**
 * Citation footprint from a sampled prompt set.
 *
 * Two deliberate choices:
 *
 * 1. A CITATION outweighs a MENTION (0.65 / 0.35). Being named in an answer is
 *    worth something; being named as the SOURCE of it is the outcome GEO work
 *    is actually trying to buy.
 *
 * 2. Diminishing returns, via a square root. Citation rates in the wild are
 *    low; a brand cited in 4 of 20 prompts is doing genuinely well, and a
 *    linear scale would score that 20 and tell a successful author they had
 *    failed. The square root makes the first points of progress the easiest to
 *    earn, which is both realistic and the right incentive.
 *
 * Sentiment modulates rather than dominates (0.7-1.0 multiplier): being cited
 * negatively is still better for discovery than not being cited, so it must
 * never scale the score toward zero.
 *
 * @returns {number|null} null when no prompts were sampled — the honest answer
 *                        when no engine is configured, and the reason this
 *                        signal drops out instead of scoring the brand at 0.
 */
export function citationFootprintScore({ prompts = 0, mentions = 0, citations = 0, sentiment = null } = {}) {
  if (!Number.isFinite(prompts) || prompts <= 0) return null;
  const mentionRate  = Math.min(1, (mentions   || 0) / prompts);
  const citationRate = Math.min(1, (citations  || 0) / prompts);
  const blended = 0.35 * mentionRate + 0.65 * citationRate;
  const base = 100 * Math.sqrt(blended);
  const s = Number.isFinite(sentiment) ? Math.max(0, Math.min(1, sentiment)) : 1;
  return Math.max(0, Math.min(100, base * (0.7 + 0.3 * s)));
}

/** Share of voice across a sampled prompt set — reported as a fact, not scored. */
export function shareOfVoice({ prompts = 0, citations = 0 } = {}) {
  if (!Number.isFinite(prompts) || prompts <= 0) return null;
  return Math.round(((citations || 0) / prompts) * 10000) / 10000;
}

/**
 * Freshness. Recency matters more for some page types than others, but a page
 * that never says when it was written asks a reader — and a model — to trust it
 * blind, so the absence of any date is treated as worse than an old one.
 */
export function freshnessScore({ ageDays = null, hasVisibleDate = false, hasSourceLinks = false } = {}) {
  if (ageDays === null && !hasVisibleDate) {
    // No date anywhere. Sourcing alone earns partial credit, but these two
    // values must both sit BELOW the worst dated outcome (35 sourced / 20
    // unsourced for a page over two years old): an undated page is worse than
    // an openly stale one, because the reader cannot even tell it is stale.
    return hasSourceLinks ? 30 : 12;
  }
  let score;
  if (!Number.isFinite(ageDays)) score = 60;              // dated, but unparseable
  else if (ageDays <= 90)   score = 100;
  else if (ageDays <= 365)  score = 85;
  else if (ageDays <= 730)  score = 60;
  else                      score = 35;
  if (!hasSourceLinks) score -= 15;                       // claims with no attribution
  return Math.max(0, Math.min(100, score));
}
