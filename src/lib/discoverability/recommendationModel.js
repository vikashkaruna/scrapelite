// recommendationModel.js — turning findings into a queue somebody can work.
//
// PURE. A report that lists defects is descriptive; a report that says what to
// do first is useful. This module is the difference.
//
// ── SEVERITY IS NOT PRIORITY ───────────────────────────────────────────────
// A critical defect that needs a three-month re-platform is not the first thing
// anyone should do on Monday. Severity says how bad it is; priority says how
// soon to do it, and that also depends on how certain we are, how much of the
// score it unlocks, and how expensive it is. Conflating them produces a queue
// whose top item is always the one nobody can start.

import { ISSUES, SEVERITIES, compareIssues } from "./issueCatalog.js";
import { SIGNALS, PILLARS } from "./signalRegistry.js";
import { PENALTIES, composePenalty } from "./scoringModel.js";

/**
 * How much of the score is genuinely recoverable by fixing this signal, right
 * now, on this page.
 *
 * This is the single biggest improvement over a static impact prior. The
 * catalogue's `impact` says "FAQ markup is worth about 60 in general"; this
 * says "on YOUR page it is worth 4.8 points, because you are already at 61 and
 * the signal carries 25% of a pillar worth 20%". The queue then ranks by what
 * this page can actually gain rather than by a textbook average.
 *
 *   recoverable = (100 - current) x signalWeight x pillarWeight
 *
 * Returns null when the signal was never measured — we cannot promise a lift we
 * have no baseline for, and quoting one would be exactly the kind of invented
 * number the scoring model is built to avoid.
 */
export function estimateLift(signalCode, currentScore) {
  const sig = SIGNALS[signalCode];
  if (!sig) return null;
  if (!Number.isFinite(currentScore)) return null;
  const pillarWeight = PILLARS[sig.pillar]?.weight ?? 0;
  const recoverable = (100 - Math.max(0, Math.min(100, currentScore))) * sig.weight * pillarWeight;
  return Math.round(recoverable * 10) / 10;
}

/**
 * The score released by clearing a multiplicative blocker.
 *
 * A blocker does not cost a page a few signal points; it scales the WHOLE score
 * down. A page whose pre-penalty total is 62 and which carries NOINDEX (0.20)
 * is shown 49.6; clearing it returns the full 62. That fix is worth 12.4
 * points — double the 6.25 its signal share alone would suggest.
 *
 * Ignoring this is not an academic inaccuracy. It sorted "remove the noindex
 * directive" BELOW "add an answer-first block" on a page that cannot be indexed
 * at all, which is precisely backwards: the content fix cannot pay off until
 * the blocker is gone.
 *
 * @param {string} penaltyCode        the blocker this fix removes
 * @param {number} prePenaltyScore    the score before the penalty layer
 * @param {string[]} activePenalties  every blocker currently applied
 */
export function penaltyLift(penaltyCode, prePenaltyScore, activePenalties = []) {
  if (!penaltyCode || !PENALTIES[penaltyCode]) return 0;
  if (!Number.isFinite(prePenaltyScore)) return 0;
  if (!activePenalties.includes(penaltyCode)) return 0;   // not actually applied

  const withIt = composePenalty(activePenalties).multiplier;
  const withoutIt = composePenalty(activePenalties.filter((c) => c !== penaltyCode)).multiplier;
  return Math.round(prePenaltyScore * (withoutIt - withIt) * 10) / 10;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY FORMULA — the product judgement at the heart of the action queue.
// ═══════════════════════════════════════════════════════════════════════════
//
// Four inputs, and the interesting question is how they combine:
//
//   impact      how much score this unlocks        (0-100)
//   confidence  how sure we are the finding is real (0-100)
//   breadth     how many of SEO/AEO/GEO it helps    (1-3)
//   effort      how expensive the fix is            (0-100, higher = harder)
//
// The shape below treats impact and confidence MULTIPLICATIVELY — both must
// hold, because a large lift we are unsure about is not worth a developer's
// Monday — and treats breadth and ease as MODIFIERS rather than gates.
//
// That choice has a consequence worth stating plainly: an expensive fix that is
// both certain and critical (server-rendering a hydration-only page, say) still
// ranks high, because ease only ever scales the result by 0.6-1.0. It cannot
// bury a genuine emergency under a pile of quick wins. The alternative — making
// effort a full multiplicative divisor — produces a queue sorted mostly by
// cheapness, which feels productive and leaves the real problem unfixed.
//
// If you would rather the queue favoured quick wins more aggressively, widen
// the ease range (0.3-1.0 instead of 0.6-1.0). If you would rather it ignored
// effort entirely and sorted purely by recoverable score, set EASE_FLOOR to 1.
export const BREADTH_BONUS = 0.15;   // per additional framework helped
export const EASE_FLOOR = 0.6;       // the most that effort can ever discount a fix

/**
 * @param {object} f
 * @param {number} f.impact      0-100 — prefer the per-audit estimateLift, rescaled
 * @param {number} f.confidence  0-100
 * @param {number} f.breadth     1-3 — count of frameworks helped
 * @param {number} f.effort      0-100, higher is harder
 * @returns {number} 0-100 priority score
 */
export function computePriorityScore({ impact = 0, confidence = 0, breadth = 1, effort = 50 } = {}) {
  const i = Math.max(0, Math.min(100, Number(impact) || 0)) / 100;
  const c = Math.max(0, Math.min(100, Number(confidence) || 0)) / 100;
  const b = Math.max(1, Math.min(3, Number(breadth) || 1));
  const e = Math.max(0, Math.min(100, Number(effort) || 0)) / 100;

  const value   = i * c;                                  // both must hold
  const breadthMul = 1 + BREADTH_BONUS * (b - 1);         // 1.00 / 1.15 / 1.30
  const easeMul    = EASE_FLOOR + (1 - EASE_FLOOR) * (1 - e);

  return Math.round(Math.min(100, 100 * value * breadthMul * easeMul) * 10) / 10;
}

/** Priority bands, so the UI label and the API `priority` field always agree. */
export function priorityBand(score) {
  if (!Number.isFinite(score)) return "low";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

/**
 * Build one recommendation from a raised issue.
 *
 * `measuredScore` is the current value of the signal this issue sits on. When
 * present it replaces the catalogue's generic impact prior with what this page
 * can actually recover, which is what makes two audits of different pages rank
 * the same issue differently — correctly.
 */
export function buildRecommendation(issueCode, {
  measuredScore = null,
  signalCode = null,
  evidence = "",
  details = null,
  confidenceOverride = null,
  prePenaltyScore = null,
  activePenalties = [],
} = {}) {
  const issue = ISSUES[issueCode];
  if (!issue) return null;

  const signalLift = signalCode ? estimateLift(signalCode, measuredScore) : null;
  const blockerLift = penaltyLift(issue.penalty, prePenaltyScore, activePenalties);
  // Signal recovery PLUS blocker removal. Either alone under-prices the fix.
  const lift = signalLift === null && blockerLift === 0
    ? null
    : Math.round(((signalLift || 0) + blockerLift) * 10) / 10;

  // Rescale the recoverable points onto the 0-100 impact axis. The largest
  // single signal any page can recover is 30% x 35% = 10.5 points
  // (heading_tree_integrity is the biggest at 0.20 x 0.35 = 7.0; direct_answer
  // at 0.30 x 0.30 = 9.0), so 10 points is a sensible full-scale anchor. Where
  // no measurement exists we fall back to the catalogue prior rather than
  // dropping the recommendation.
  const impact = lift === null ? issue.impact : Math.min(100, (lift / 10) * 100);

  const confidence = Number.isFinite(confidenceOverride) ? confidenceOverride : issue.confidence;
  const breadth = issue.frameworks.filter((f) => f !== "common").length || 1;
  const priorityScore = computePriorityScore({
    impact, confidence, breadth, effort: issue.effort,
  });

  return {
    code: issueCode,
    pillar: issue.pillar,
    severity: issue.severity,
    frameworks: [...issue.frameworks],
    owner: issue.owner,
    title: issue.fix,
    issueTitle: issue.title,
    rationale: issue.why,
    evidence,
    details,
    assetType: issue.asset,
    impactScore: Math.round(impact * 10) / 10,
    effortScore: issue.effort,
    confidenceScore: confidence,
    breadth,
    estimatedLift: lift,
    signalLift,
    blockerLift: blockerLift || 0,
    priorityScore,
    priority: priorityBand(priorityScore),
    status: "open",
  };
}

/**
 * Blockers that gate other work, and which pillars they gate.
 *
 * The BRD lists **dependency** as a required field on every recommendation, and
 * this is why it matters rather than being bookkeeping.
 *
 * On a page whose content only exists after JavaScript runs, adding an
 * answer-first block helps no non-rendering crawler at all — the passage is as
 * invisible as everything else until the page is server-rendered. The content
 * fix's estimated lift is real, but it is NOT REALISABLE while the blocker
 * stands, so ranking it above the blocker sends the author to do work that
 * cannot pay off yet.
 *
 * Only blockers that genuinely gate downstream work appear here. A missing
 * canonical is critical and does not gate anything, so it is absent.
 */
export const BLOCKER_GATES = Object.freeze({
  // Content nobody can see cannot be improved by writing more of it.
  CONTENT_HYDRATION_ONLY: { code: "TA-07", pillars: ["answer_clarity", "structural_hierarchy"] },
  // A page asking not to be indexed will not be read, however it is written.
  NOINDEX: { code: "TA-03", pillars: ["answer_clarity", "structural_hierarchy", "entity_authority"] },
  // Answer-engine crawlers that are refused cannot be persuaded by better copy.
  AI_CRAWLER_BLOCKED: { code: "TA-01", pillars: ["answer_clarity", "entity_authority"] },
});

/**
 * Mark which recommendations are waiting on an unresolved blocker.
 *
 * Mutates nothing; returns a new list with `blockedBy` set where it applies.
 */
export function applyDependencies(recs = [], activePenalties = []) {
  const gates = activePenalties
    .map((p) => BLOCKER_GATES[p])
    .filter(Boolean);
  if (gates.length === 0) return recs;

  return recs.map((r) => {
    // A blocker is never blocked by itself, or by another blocker's gate.
    const gate = gates.find((g) => g.code !== r.code && g.pillars.includes(r.pillar));
    return gate ? { ...r, blockedBy: gate.code } : r;
  });
}

/**
 * Rank the queue.
 *
 * Dependencies lead: anything waiting on an unresolved blocker sorts below the
 * work that unblocks it, regardless of its own score. Then priority. Severity
 * breaks a priority tie, so between two equally-ranked items the more dangerous
 * one surfaces first. The final tiebreak is the issue code — arbitrary, but
 * STABLE, because without it two runs of the same audit could present the queue
 * in different orders and a user would reasonably conclude the tool was making
 * things up.
 */
export function rankRecommendations(recs = []) {
  return [...recs].sort((a, b) => {
    const aBlocked = a.blockedBy ? 1 : 0;
    const bBlocked = b.blockedBy ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    const s = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    if (s !== 0) return s;
    return String(a.code).localeCompare(String(b.code));
  });
}

/** The "top N fixes" a summary view and the SMB persona both lead with. */
export function topRecommendations(recs = [], n = 10) {
  return rankRecommendations(recs).slice(0, n);
}

/** Group the queue by who has to do the work — the assignment view. */
export function groupByOwner(recs = []) {
  const out = {};
  for (const r of rankRecommendations(recs)) (out[r.owner] ||= []).push(r);
  return out;
}

/** Filter to one framework tab. "common" items appear everywhere. */
export function filterByFramework(recs = [], framework) {
  if (!framework || framework === "overall") return recs;
  return recs.filter((r) => r.frameworks.includes(framework) || r.frameworks.includes("common"));
}

/**
 * Total recoverable score if every open recommendation were implemented.
 *
 * Deliberately a SUM of independent signal gaps and not a promise: signals
 * interact, and the penalty layer can move separately. The UI must present this
 * as "up to", which is why the function name says estimate and the report copy
 * repeats it.
 */
export function estimateTotalLift(recs = []) {
  const total = recs
    .filter((r) => r.status === "open" && Number.isFinite(r.estimatedLift))
    .reduce((a, r) => a + r.estimatedLift, 0);
  return Math.round(total * 10) / 10;
}

/**
 * The lift available RIGHT NOW — excluding anything waiting on a blocker.
 *
 * Reported alongside the total so a user can see the difference between "worth
 * 12 points eventually" and "worth 4 points until the hydration problem is
 * fixed". Presenting only the total on a blocked page promises work that
 * cannot pay off yet.
 */
export function estimateUnblockedLift(recs = []) {
  const total = recs
    .filter((r) => r.status === "open" && !r.blockedBy && Number.isFinite(r.estimatedLift))
    .reduce((a, r) => a + r.estimatedLift, 0);
  return Math.round(total * 10) / 10;
}

export { compareIssues };
