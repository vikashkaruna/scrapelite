// scoringModel.js — the discoverability scoring mathematics.
//
// PURE. Zero I/O, no clock, no randomness. Imported by BOTH the React app and
// the Netlify functions, exactly like src/lib/entitlementModel.js, so that the
// score a user sees and the score the server stored are computed by the same
// lines of code. Precedent for the cross-import already exists (extract.js
// imports buildCacheKey from src/lib/resultCache.js).
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONE RULE THAT SHAPES THIS ENTIRE FILE: `unknown` IS NEVER `0`.
// ═══════════════════════════════════════════════════════════════════════════
// A signal can be missing for two innocent reasons that have nothing to do with
// the page being bad:
//
//   • It could not be MEASURED. PageSpeed Insights was rate-limited; the AI
//     evaluator was unreachable; no citation-sampling engine is configured.
//   • It does not APPLY. A pricing page has no procedural content, so it has no
//     HowTo markup to score.
//
// Scoring either as 0 invents a defect. A rate-limited third-party call would
// silently subtract ~7.5 points from every audit run during the outage, and
// re-running the same URL an hour later would show a "+7.5 improvement" the
// author did nothing to earn — which makes the trend line, the whole point of
// the validation loop, a fiction.
//
// So an unknown signal is EXCLUDED from its pillar and its weight is
// REDISTRIBUTED across the signals that were measured. A pillar score is
// therefore a weighted mean over the available EVIDENCE, not over the full
// ideal signal set. The same rule applies one level up: a pillar with no
// measurable signals at all is itself unknown and its weight redistributes
// across the pillars that do have evidence.
//
// Every score carries its own `coverage` — the fraction of intended weight that
// was actually measured — so the UI can say "78, based on 85% of signals"
// rather than presenting a thin result as if it were a complete one. This is
// the same discipline as healthModel.js's `unknown` verdict and computeUptime()
// returning null instead of 0%.

import { PILLARS, PILLAR_IDS, SIGNALS, signalsForPillar } from "./signalRegistry.js";

/**
 * Framework weightings over the four pillars.
 *
 * The three views are not cosmetic re-labels of one number. They encode a real
 * difference in what each discipline rewards: classic SEO leans hardest on
 * technical accessibility, answer engines lean hardest on extractable answers,
 * and generative engines lean hardest on entity authority and citation. A page
 * can legitimately be strong for one and weak for another, and collapsing them
 * into a single number would hide precisely the gap the product exists to show.
 *
 * Each row sums to 1.0 — asserted in the test suite so a future edit cannot
 * quietly rescale everyone's historical comparisons.
 */
export const FRAMEWORK_WEIGHTS = Object.freeze({
  overall: { answer_clarity: 0.30, entity_authority: 0.25, structural_hierarchy: 0.20, technical_accessibility: 0.25 },
  seo:     { answer_clarity: 0.20, entity_authority: 0.20, structural_hierarchy: 0.20, technical_accessibility: 0.40 },
  aeo:     { answer_clarity: 0.45, entity_authority: 0.15, structural_hierarchy: 0.25, technical_accessibility: 0.15 },
  geo:     { answer_clarity: 0.25, entity_authority: 0.35, structural_hierarchy: 0.20, technical_accessibility: 0.20 },
});

export const FRAMEWORKS = Object.freeze(["overall", "seo", "aeo", "geo"]);

/**
 * Hard blockers, applied MULTIPLICATIVELY after the weighted sum.
 *
 * These exist because some failures undermine discovery no matter how good the
 * content is, and an additive deduction cannot express that. A page whose
 * content lives only in post-hydration JavaScript is not "a good page minus a
 * few points" to a crawler that does not run JavaScript — it is a blank page.
 * A multiplier scales the whole result down, which is the honest shape.
 *
 * Every blocker is ALSO reflected in its pillar's own signals, deliberately.
 * The signal answers "how does this page compare"; the penalty answers "does
 * this page reach the audience at all". Removing the double-count would make a
 * robots block cost only its 25%-of-25% signal share — about six points on a
 * page that is, in practice, invisible.
 *
 * `factor` is the fraction removed. Applied as score * (1 - factor).
 * There is deliberately NO floor: five simultaneous blockers land near 0.44x,
 * and a page that is blocked, broken-canonical, mismatched, hydration-only and
 * mobile-hostile has genuinely earned that.
 */
export const PENALTIES = Object.freeze({
  AI_CRAWLER_BLOCKED: {
    factor: 0.20, severity: "critical",
    label: "AI crawlers are disallowed",
    description: "robots.txt or a meta directive blocks the crawlers that feed answer engines, so this page cannot be cited no matter how well it is written.",
  },
  AI_CRAWLER_PARTIAL_BLOCK: {
    factor: 0.05, severity: "medium",
    label: "Some AI crawlers are disallowed",
    description: "At least one major answer-engine crawler is blocked while others are permitted, so citation coverage is uneven.",
  },
  CANONICAL_TARGET_BROKEN: {
    factor: 0.15, severity: "critical",
    label: "Canonical points somewhere broken",
    description: "The declared canonical URL does not resolve to a 200, so indexing signals are being sent to a dead address.",
  },
  FAQ_SCHEMA_MISMATCH: {
    factor: 0.10, severity: "high",
    label: "FAQ markup does not match visible text",
    description: "FAQPage markup describes questions or answers a human cannot see on the page, which risks the markup being ignored or penalised outright.",
  },
  CONTENT_HYDRATION_ONLY: {
    factor: 0.20, severity: "critical",
    label: "Primary content only exists after hydration",
    description: "The main content is absent from the raw HTML, so any crawler that does not execute JavaScript receives an effectively empty page.",
  },
  MOBILE_PARITY_MISSING: {
    factor: 0.10, severity: "high",
    label: "No mobile parity",
    description: "The primary content or markup differs on small screens, and mobile is the crawl default.",
  },
  NOINDEX: {
    factor: 0.20, severity: "critical",
    label: "Page is marked noindex",
    description: "The page explicitly asks not to be indexed. Everything else in this audit is advisory until that is intentional or removed.",
  },
});

export const PENALTY_CODES = Object.freeze(Object.keys(PENALTIES));

// ── Primitives ─────────────────────────────────────────────────────────────

/** Clamp to the 0-100 range every signal is normalised into. */
export function clamp100(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Round to 1dp for storage and display. Scores are numeric(5,2) in Postgres. */
export function round1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/**
 * A signal value is "measured" only if it is a finite number. `null` and
 * `undefined` both mean unknown; the distinction between "could not measure"
 * and "does not apply" is carried alongside in `reasons`, for the UI's benefit,
 * and never changes the arithmetic.
 */
function isMeasured(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Weighted mean over measured entries only, with the unmeasured entries'
 * weight redistributed proportionally across the rest.
 *
 * Returns `{ score: null, coverage: 0 }` when nothing at all was measured,
 * because averaging an empty set is not 0 — it is "no answer".
 */
export function weightedMean(entries) {
  let weighted = 0;
  let usedWeight = 0;
  let totalWeight = 0;

  for (const { value, weight } of entries) {
    totalWeight += weight;
    if (!isMeasured(value)) continue;
    weighted += clamp100(value) * weight;
    usedWeight += weight;
  }

  if (usedWeight <= 0) return { score: null, coverage: 0 };
  return {
    score: weighted / usedWeight,          // ← the redistribution, in one line
    coverage: totalWeight > 0 ? usedWeight / totalWeight : 0,
  };
}

// ── Pillar scoring ─────────────────────────────────────────────────────────

/**
 * Score one pillar from its raw signal values.
 *
 * @param {string} pillar
 * @param {Record<string, number|null>} signalValues  code → 0-100, or null
 * @param {Record<string, string>} [reasons]  code → why it is unknown
 * @returns {{ score, coverage, signals, measured, unmeasured }}
 */
export function scorePillar(pillar, signalValues = {}, reasons = {}) {
  const codes = signalsForPillar(pillar);
  const entries = codes.map((code) => ({
    code,
    weight: SIGNALS[code].weight,
    value: signalValues[code] ?? null,
  }));

  const { score, coverage } = weightedMean(entries);

  const signals = entries.map(({ code, weight, value }) => ({
    code,
    label: SIGNALS[code].label,
    weight,
    score: isMeasured(value) ? round1(clamp100(value)) : null,
    measured: isMeasured(value),
    // `applicable: false` is the "does not apply" case — a page with no
    // procedural content is not failing HowTo, it simply has no HowTo. The UI
    // says "not applicable"; the arithmetic treats it the same as unmeasured.
    applicable: !(reasons[code] === "not_applicable"),
    unknownReason: isMeasured(value) ? null : (reasons[code] || "not_measured"),
  }));

  return {
    score: round1(score),
    coverage: round1(coverage * 100),
    signals,
    measured: signals.filter((s) => s.measured).length,
    unmeasured: signals.filter((s) => !s.measured).length,
  };
}

/** Score all four pillars at once. */
export function scoreAllPillars(signalValues = {}, reasons = {}) {
  const out = {};
  for (const pillar of PILLAR_IDS) {
    out[pillar] = { ...scorePillar(pillar, signalValues, reasons), weight: PILLARS[pillar].weight };
  }
  return out;
}

// ── Framework scoring ──────────────────────────────────────────────────────

/**
 * Combine pillar scores into one framework view, redistributing the weight of
 * any pillar that came back unknown.
 *
 * Coverage is computed over SIGNALS, not over pillars, and that distinction
 * matters. If Core Web Vitals is the only unmeasured signal, all four pillars
 * still produce a score, so pillar-level coverage would report a reassuring
 * 100% while 7.5% of the intended evidence is missing. Composing the two levels
 * — each pillar's own signal coverage, weighted by that pillar's share of this
 * framework — is what makes "78, based on 92% of signals" an honest sentence.
 */
export function scoreFramework(framework, pillarScores) {
  const weights = FRAMEWORK_WEIGHTS[framework];
  if (!weights) throw new Error(`Unknown framework: ${framework}`);

  const entries = PILLAR_IDS.map((pillar) => ({
    value: pillarScores?.[pillar]?.score ?? null,
    weight: weights[pillar],
  }));

  const { score } = weightedMean(entries);

  // Σ (pillar share of this framework × that pillar's signal coverage). A
  // pillar with no evidence at all contributes 0, which is correct: its share
  // of the intended evidence was genuinely not gathered.
  let coverage = 0;
  for (const pillar of PILLAR_IDS) {
    const pc = pillarScores?.[pillar]?.coverage;
    coverage += weights[pillar] * (Number.isFinite(pc) ? pc / 100 : 0);
  }

  return { score: round1(score), coverage: round1(coverage * 100) };
}

/** All four framework views. */
export function scoreAllFrameworks(pillarScores) {
  const out = {};
  for (const f of FRAMEWORKS) out[f] = scoreFramework(f, pillarScores);
  return out;
}

// ── Penalty layer ──────────────────────────────────────────────────────────

/**
 * Compose the multiplicative penalty from a list of triggered blocker codes.
 *
 * Unknown codes are IGNORED rather than throwing. A pipeline that emits a code
 * this build does not recognise (an older stored audit, a newer analyser)
 * should degrade to a slightly generous score, never to a crash that loses the
 * whole audit.
 *
 * @returns {{ multiplier, applied: Array }}
 */
export function composePenalty(codes = []) {
  const applied = [];
  let multiplier = 1;

  // De-duplicate: the same blocker detected by two analysers must not be
  // charged twice.
  for (const code of [...new Set(codes)]) {
    const p = PENALTIES[code];
    if (!p) continue;
    multiplier *= 1 - p.factor;
    applied.push({
      code, factor: p.factor, severity: p.severity,
      label: p.label, description: p.description,
    });
  }

  return { multiplier: Math.round(multiplier * 10000) / 10000, applied };
}

// ── Top level ──────────────────────────────────────────────────────────────

/**
 * The complete score computation: signals → pillars → frameworks → penalties.
 *
 * The penalty multiplier is applied to EVERY framework view, not only to the
 * overall score. A robots block is not less of a problem when you happen to be
 * looking at the AEO tab.
 *
 * @param {object} input
 * @param {Record<string, number|null>} input.signalValues
 * @param {Record<string, string>} [input.unknownReasons]
 * @param {string[]} [input.penaltyCodes]
 */
export function scoreAudit({ signalValues = {}, unknownReasons = {}, penaltyCodes = [] } = {}) {
  const pillars = scoreAllPillars(signalValues, unknownReasons);
  const prePenalty = scoreAllFrameworks(pillars);
  const { multiplier, applied } = composePenalty(penaltyCodes);

  const frameworks = {};
  for (const f of FRAMEWORKS) {
    const pre = prePenalty[f].score;
    frameworks[f] = {
      score: pre === null ? null : round1(pre * multiplier),
      prePenaltyScore: pre,
      coverage: prePenalty[f].coverage,
    };
  }

  // Overall coverage is the honest headline: how much of the intended evidence
  // this audit actually gathered. A 92 built on 40% coverage is not a 92.
  const overallCoverage = prePenalty.overall.coverage;

  return {
    pillars,
    frameworks,
    penalties: applied,
    penaltyMultiplier: multiplier,
    coverage: overallCoverage,
    // Flat mirrors of the four headline numbers. Every consumer wants these and
    // reaching through `.frameworks.seo.score` at 40 call sites invites typos
    // that read `undefined` as a legitimate score.
    finalScore: frameworks.overall.score,
    seoScore: frameworks.seo.score,
    aeoScore: frameworks.aeo.score,
    geoScore: frameworks.geo.score,
    scoreMath: {
      prePenaltyTotal: prePenalty.overall.score,
      penaltyMultiplier: multiplier,
      finalScore: frameworks.overall.score,
    },
  };
}

// ── Presentation bands ─────────────────────────────────────────────────────

/**
 * Score bands. Shared so the gauge colour, the report wording and the CSV
 * export can never disagree about whether 70 is "good".
 *
 * `null` maps to its own band rather than the bottom one, so an unmeasured
 * score never renders in the same red as a genuinely failing one.
 */
export const BANDS = Object.freeze([
  { id: "excellent", min: 85, label: "Excellent", tone: "success" },
  { id: "good",      min: 70, label: "Good",      tone: "ok" },
  { id: "fair",      min: 50, label: "Needs work", tone: "warn" },
  { id: "poor",      min: 0,  label: "Poor",      tone: "danger" },
]);

export function scoreBand(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return { id: "unknown", label: "Not measured", tone: "muted", min: null };
  }
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
}
