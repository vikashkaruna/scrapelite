// aiVisibility.js — the Weighted AI Visibility Index.
//
// PURE. Shared by React and `netlify/`.
//
// The PRD defines WAVI as `0.20M + 0.30C + 0.30R + 0.10P + 0.10A` over
// MentionRate, CitationRate, RecommendationRate, answer Prominence and answer
// Accuracy. The weighting is the PRD's and is not ours to re-derive: citation
// and recommendation carry 60% between them because being the SOURCE and being
// the ANSWER are the two outcomes that change a business, and mere recall is
// worth a fifth of the index.
//
// ── IT REDISTRIBUTES, LIKE EVERY OTHER SCORE HERE ──────────────────────────
// A component we could not measure is EXCLUDED and its weight spread across the
// ones we did — through `weightedMean`, the same single implementation every
// pillar uses. Scoring an unmeasured component as 0 would sink WAVI on every
// audit of a page with no prices to check, and then show a phantom recovery the
// day somebody added a price. That is exactly the fiction `scoringModel.js`
// was written to prevent, and re-creating it one metric later would be worse
// than never having built the rule.
//
// So WAVI carries `coverage` like everything else, and a caller that shows the
// number without it is showing half a measurement.

import { weightedMean } from "./scoringModel.js";

/** The PRD's weights. Not ours to re-derive. */
export const WAVI_WEIGHTS = Object.freeze({
  mention: 0.20,
  citation: 0.30,
  recommendation: 0.30,
  prominence: 0.10,
  accuracy: 0.10,
});

export const WAVI_COMPONENT_IDS = Object.freeze(Object.keys(WAVI_WEIGHTS));

/** Human labels, so a UI need not restate the vocabulary. */
export const WAVI_COMPONENT_LABELS = Object.freeze({
  mention: "Mention rate",
  citation: "Citation rate",
  recommendation: "Recommendation rate",
  prominence: "Answer prominence",
  accuracy: "Answer accuracy",
});

// ── Prominence ─────────────────────────────────────────────────────────────

/**
 * How early in an answer the brand appears, 0-100.
 *
 * A name in the opening sentence is read; a name in the last line of a long
 * answer frequently is not, and in a voice or summary surface it may never be
 * rendered at all. So position is the measurement, not presence.
 *
 * ⚠️ NULL WHEN THE BRAND IS ABSENT. Absence is already counted by MentionRate,
 * and scoring it 0 here would charge the same absence twice — once as a missing
 * mention and again as poor placement of a mention that never existed.
 */
export function answerProminence(text, brand) {
  const body = String(text || "");
  const name = String(brand || "").trim();
  if (!body || !name) return null;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let idx = -1;
  try { idx = body.search(new RegExp(`\\b${escaped}\\b`, "i")); } catch { return null; }
  if (idx < 0) return null;

  // Linear on position through the answer. The first character scores 100, the
  // last scores 0, and a short answer is not penalised for being short — what
  // matters is how much of THIS answer a reader passes before meeting the name.
  const ratio = idx / Math.max(body.length, 1);
  return Math.round((1 - Math.min(ratio, 1)) * 1000) / 10;
}

/**
 * Prominence across a run set: the mean of the answers that named the brand.
 *
 * Null when no answer named it — unmeasured, not zero.
 */
export function aggregateProminence(runs = []) {
  const values = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && !r.error && Number.isFinite(r.prominence))
    .map((r) => r.prominence);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Accuracy across a run set, over the answers we could actually check.
 *
 * 🔴 `misrepresented === null` MEANS UNCHECKABLE AND IS EXCLUDED. It is the
 * common case — most pages state no price to check a claim against — and
 * treating it as "accurate" would hand a full 10% of WAVI to every audit on the
 * strength of a check that never ran.
 */
export function aggregateAccuracy(runs = []) {
  const checked = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && !r.error && (r.misrepresented === true || r.misrepresented === false));
  if (!checked.length) return null;
  const wrong = checked.filter((r) => r.misrepresented === true).length;
  return Math.round(((checked.length - wrong) / checked.length) * 1000) / 10;
}

// ── The index ──────────────────────────────────────────────────────────────

/**
 * Compute WAVI from its five components.
 *
 * Every component is 0-100 or null. Returns `{score, coverage, components}`
 * with the same shape a pillar returns, so the UI that renders coverage for a
 * pillar renders it here without a second code path.
 */
export function computeWavi({
  mentionRate = null, citationRate = null, recommendationRate = null,
  prominence = null, accuracy = null,
} = {}) {
  const values = {
    mention: mentionRate,
    citation: citationRate,
    recommendation: recommendationRate,
    prominence,
    accuracy,
  };

  const { score, coverage } = weightedMean(
    WAVI_COMPONENT_IDS.map((id) => ({ value: values[id], weight: WAVI_WEIGHTS[id] })),
  );

  return {
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    components: Object.fromEntries(WAVI_COMPONENT_IDS.map((id) => [id, {
      value: values[id],
      weight: WAVI_WEIGHTS[id],
      measured: Number.isFinite(values[id]),
      label: WAVI_COMPONENT_LABELS[id],
    }])),
  };
}

/**
 * WAVI straight from a sampling result.
 *
 * `null` when there is no sample at all, which the caller turns into an
 * unmeasured signal rather than a zero — the distinction `citation_footprint`
 * has always drawn and that this must not break.
 */
export function waviFromSample(sample) {
  if (!sample || !sample.promptCount) return null;
  const rates = sample.states || {};
  return computeWavi({
    mentionRate: rates.mentionRate ?? null,
    citationRate: rates.citationRate ?? null,
    recommendationRate: rates.recommendationRate ?? null,
    prominence: aggregateProminence(sample.runs),
    accuracy: aggregateAccuracy(sample.runs),
  });
}
