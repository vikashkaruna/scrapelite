// funnelModel.js — PURE. Aggregates stored pql_scores into the founder view.
//
// PRD §Now: "PQL event tracking — know who is likely to pay and why. Essential
// before scaling acquisition."
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE THIS INHERITS, AND WHY IT MATTERS MORE IN AGGREGATE
//
// pqlModel stores a NULL score when nothing was measurable, and a `coverage`
// alongside every real one. Both survive into this aggregation rather than
// being flattened, because an average silently does the wrong thing with them:
//
//   - A NULL counted as 0 drags the mean down and invents disengagement.
//   - A NULL excluded from the DENOMINATOR inflates every rate.
//
// So `scored` and `unscorable` are reported separately, every rate states the
// denominator it used, and a cohort where nothing could be measured returns
// null rates rather than zeros. A founder dashboard that invents a number is
// worse than one that says "no data", because the invented number gets used to
// decide whether to spend on acquisition.
//
// ⚠️ COVERAGE IS NOT OPTIONAL DECORATION HERE. Two of the PRD's nine signals
// have no source until Phase 4 (bulk enrichment) and until firmographics
// exist. Every score today is computed from seven of nine, so the ABSOLUTE
// PQL count is a floor, not a measurement — and the number will jump when
// those land, for reasons no customer caused. `meanCoverage` is what lets
// somebody reading the dashboard six months from now tell those apart.
// ─────────────────────────────────────────────────────────────────────────────

import { PQL_THRESHOLD, PQL_MAX_POINTS, PERSONA_TO_ACTIVATION, ACTIVATION_DEFINITIONS } from "./pqlModel.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Ratio, or null when the denominator is zero — never 0/0 rendered as 0%. */
function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * @param {Array<{score:number|null, coverage:number, is_pql:boolean,
 *                activated:boolean, persona:string|null}>} rows
 * @returns {object} the founder funnel
 */
export function buildPqlFunnel(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");

  const total = list.length;
  const scored = list.filter((r) => isNum(r.score));
  const unscorable = total - scored.length;
  const activated = list.filter((r) => r.activated === true).length;
  const pqls = list.filter((r) => r.is_pql === true).length;

  // Averaged over SCORED rows only. Including unscorable rows as 0 would
  // manufacture disengagement out of an instrumentation gap.
  const meanScore = scored.length
    ? Math.round(scored.reduce((n, r) => n + r.score, 0) / scored.length)
    : null;
  const meanCoverage = scored.length
    ? Math.round((scored.reduce((n, r) => n + (isNum(r.coverage) ? r.coverage : 1), 0) / scored.length) * 1000) / 1000
    : null;

  // Per persona, using the PRD's activation groups rather than the app's seven
  // personas: the question a founder is asking is "which JOB activates?", and
  // two app personas mapping to one PRD definition are the same job.
  const byGroup = {};
  for (const key of Object.keys(ACTIVATION_DEFINITIONS)) {
    byGroup[key] = { key, label: ACTIVATION_DEFINITIONS[key].label, users: 0, activated: 0, pqls: 0, activationRate: null };
  }
  const unmapped = { key: "unknown", label: "No persona recorded", users: 0, activated: 0, pqls: 0, activationRate: null };
  for (const r of list) {
    const group = PERSONA_TO_ACTIVATION[r.persona] ? byGroup[PERSONA_TO_ACTIVATION[r.persona]] : unmapped;
    group.users += 1;
    if (r.activated === true) group.activated += 1;
    if (r.is_pql === true) group.pqls += 1;
  }
  for (const g of [...Object.values(byGroup), unmapped]) g.activationRate = rate(g.activated, g.users);

  // Distribution in threshold-relative bands. Absolute point buckets would
  // have to be re-cut every time the weights change; these stay meaningful.
  const bands = { belowHalf: 0, approaching: 0, atThreshold: 0, strong: 0 };
  for (const r of scored) {
    if (r.score >= PQL_THRESHOLD * 1.5) bands.strong += 1;
    else if (r.score >= PQL_THRESHOLD) bands.atThreshold += 1;
    else if (r.score >= PQL_THRESHOLD / 2) bands.approaching += 1;
    else bands.belowHalf += 1;
  }

  return {
    threshold: PQL_THRESHOLD,
    maxPoints: PQL_MAX_POINTS,
    total,
    scored: scored.length,
    // Reported, never hidden: these are accounts the product cannot currently
    // judge, and that is a fact about the instrumentation, not about them.
    unscorable,
    activated,
    pqls,
    activationRate: rate(activated, total),
    pqlRate: rate(pqls, scored.length),      // of SCORED, not of total
    meanScore,
    meanCoverage,
    bands,
    groups: [...Object.values(byGroup), ...(unmapped.users ? [unmapped] : [])]
      .sort((a, b) => b.users - a.users),
  };
}
