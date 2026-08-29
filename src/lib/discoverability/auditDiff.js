// auditDiff.js — comparing two audits of the same page.
//
// PURE. This is the validation loop: the product is not a one-time report, it
// is assess → fix → re-measure, and this module is what makes the second half
// of that sentence true.
//
// ── THE RULE THAT MAKES A DELTA HONEST ─────────────────────────────────────
// A change between two numbers is only a real change if BOTH were measured.
// If Core Web Vitals was unavailable on the baseline run and available now, the
// pillar will move — and none of that movement was caused by anything the
// author did. Reporting it as an improvement teaches the user to distrust every
// other number in the report.
//
// So every delta carries `comparable`. Where either side is null the delta is
// null and the reason says which side was missing. The headline "score moved
// +6.2" is computed ONLY over comparable pairs.

import { PILLAR_IDS, SIGNALS, signalLabel, pillarLabel } from "./signalRegistry.js";
import { FRAMEWORKS } from "./scoringModel.js";
import { ISSUES } from "./issueCatalog.js";

/** One before/after pair, with the honesty flag attached. */
export function delta(before, after) {
  const b = Number.isFinite(before) ? before : null;
  const a = Number.isFinite(after) ? after : null;
  if (b === null || a === null) {
    return {
      before: b, after: a, change: null, comparable: false,
      reason: b === null && a === null ? "not measured in either audit"
        : b === null ? "not measured in the baseline"
        : "not measured in this audit",
    };
  }
  return {
    before: b, after: a,
    change: Math.round((a - b) * 10) / 10,
    comparable: true,
    reason: null,
  };
}

/** Direction, with a dead band so noise is not reported as movement. */
export function direction(change, threshold = 0.5) {
  if (change === null || !Number.isFinite(change)) return "unknown";
  if (Math.abs(change) < threshold) return "flat";
  return change > 0 ? "up" : "down";
}

/**
 * Compare two complete audit payloads.
 *
 * @param {object} baseline  the earlier audit
 * @param {object} current   the later audit
 */
export function diffAudits(baseline, current) {
  if (!baseline || !current) return null;

  // ── frameworks ───────────────────────────────────────────────────────────
  const frameworks = {};
  for (const f of FRAMEWORKS) {
    frameworks[f] = delta(
      baseline.frameworks?.[f]?.score ?? baseline[`${f}Score`] ?? null,
      current.frameworks?.[f]?.score ?? current[`${f}Score`] ?? null,
    );
    frameworks[f].direction = direction(frameworks[f].change);
  }

  // ── pillars ──────────────────────────────────────────────────────────────
  const pillars = {};
  for (const p of PILLAR_IDS) {
    pillars[p] = {
      label: pillarLabel(p),
      ...delta(baseline.pillars?.[p]?.score ?? null, current.pillars?.[p]?.score ?? null),
    };
    pillars[p].direction = direction(pillars[p].change);
  }

  // ── signals ──────────────────────────────────────────────────────────────
  const signalMap = (audit) => {
    const out = {};
    for (const p of Object.values(audit.pillars || {})) {
      for (const s of p.signals || []) out[s.code] = s.score;
    }
    return out;
  };
  const b = signalMap(baseline);
  const c = signalMap(current);
  const signals = Object.keys(SIGNALS).map((code) => ({
    code, label: signalLabel(code), pillar: SIGNALS[code].pillar,
    ...delta(b[code] ?? null, c[code] ?? null),
  })).map((s) => ({ ...s, direction: direction(s.change) }));

  // ── issues: resolved, remaining, new ─────────────────────────────────────
  const beforeCodes = new Set((baseline.issues || []).map((i) => i.code));
  const afterCodes = new Set((current.issues || []).map((i) => i.code));

  const describe = (code) => ({
    code,
    title: ISSUES[code]?.title || code,
    severity: ISSUES[code]?.severity || "medium",
    pillar: ISSUES[code]?.pillar || null,
  });

  const resolved = [...beforeCodes].filter((c2) => !afterCodes.has(c2)).map(describe);
  const remaining = [...afterCodes].filter((c2) => beforeCodes.has(c2)).map(describe);
  // A NEW issue on a re-audit is the single most important line in this
  // report: it means a fix introduced a regression, which is exactly what the
  // validation loop exists to catch before it compounds.
  const introduced = [...afterCodes].filter((c2) => !beforeCodes.has(c2)).map(describe);

  // ── penalties ────────────────────────────────────────────────────────────
  const beforePen = new Set((baseline.penalties || []).map((p) => p.code));
  const afterPen = new Set((current.penalties || []).map((p) => p.code));
  const penalties = {
    cleared: [...beforePen].filter((p) => !afterPen.has(p)),
    remaining: [...afterPen].filter((p) => beforePen.has(p)),
    introduced: [...afterPen].filter((p) => !beforePen.has(p)),
    multiplier: delta(baseline.penaltyMultiplier ?? null, current.penaltyMultiplier ?? null),
  };

  // ── citation footprint ───────────────────────────────────────────────────
  const bSample = baseline.facts?.entity?.ai_citation_sample || null;
  const cSample = current.facts?.entity?.ai_citation_sample || null;
  const citation = bSample && cSample ? {
    comparable: bSample.engine === cSample.engine,
    // Two different engines are two different questions. Reporting the change
    // as an improvement would credit the author for our own configuration.
    reason: bSample.engine === cSample.engine ? null
      : `sampled with ${bSample.engine} then ${cSample.engine} — not comparable`,
    mentions: delta(bSample.mentions, cSample.mentions),
    citations: delta(bSample.citations, cSample.citations),
    shareOfVoice: delta(bSample.share_of_voice, cSample.share_of_voice),
  } : null;

  // ── coverage, and the caveat that depends on it ──────────────────────────
  const coverage = delta(baseline.coverage ?? null, current.coverage ?? null);
  const caveats = [];
  if (coverage.comparable && Math.abs(coverage.change) >= 5) {
    caveats.push(
      `These two audits measured different amounts of evidence (${coverage.before}% vs ${coverage.after}%). Part of the score change reflects what could be measured, not what changed on the page.`,
    );
  }
  const incomparableSignals = signals.filter((s) => !s.comparable && (s.before !== null || s.after !== null));
  if (incomparableSignals.length > 0) {
    caveats.push(
      `${incomparableSignals.length} signal${incomparableSignals.length === 1 ? " was" : "s were"} measured in only one of the two audits and ${incomparableSignals.length === 1 ? "is" : "are"} excluded from the comparison.`,
    );
  }

  return {
    baselineId: baseline.auditId || baseline.id || null,
    currentId: current.auditId || current.id || null,
    frameworks,
    pillars,
    signals,
    issues: {
      resolved, remaining, introduced,
      resolvedCount: resolved.length,
      remainingCount: remaining.length,
      introducedCount: introduced.length,
    },
    penalties,
    citation,
    coverage,
    caveats,
    headline: buildHeadline(frameworks.overall, resolved.length, introduced.length),
    nextBestActions: nextBestActions(current),
  };
}

/** One plain sentence a person can read without decoding the tables. */
export function buildHeadline(overall, resolvedCount, introducedCount) {
  if (!overall?.comparable) {
    return "This audit measured a different set of signals from the baseline, so the scores are not directly comparable.";
  }
  const dir = direction(overall.change);
  const move = Math.abs(overall.change);
  const parts = [];
  if (dir === "flat") parts.push("The overall score is essentially unchanged");
  else parts.push(`The overall score ${dir === "up" ? "rose" : "fell"} ${move} point${move === 1 ? "" : "s"} to ${overall.after}`);
  if (resolvedCount > 0) parts.push(`${resolvedCount} issue${resolvedCount === 1 ? "" : "s"} resolved`);
  // Always last, so a regression is the sentence's final word rather than
  // something buried behind good news.
  if (introducedCount > 0) parts.push(`${introducedCount} new issue${introducedCount === 1 ? "" : "s"} appeared`);
  return `${parts.join(", ")}.`;
}

/** The three highest-priority open recommendations, as the "do this next" list. */
export function nextBestActions(current, n = 3) {
  return (current.recommendations || [])
    .filter((r) => r.status === "open" || !r.status)
    .slice(0, n)
    .map((r) => ({
      code: r.code, title: r.title, owner: r.owner || r.owner_role,
      priority: r.priority, estimatedLift: r.estimatedLift ?? r.estimated_lift ?? null,
    }));
}

/**
 * Time series across many audits of one target.
 *
 * Points where a framework was not measured are emitted as null rather than
 * dropped, so a chart draws a GAP rather than a straight line between two
 * measured points either side of it. A line implies continuity that was never
 * observed.
 */
export function buildTrend(rows = []) {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  );
  return {
    points: ordered.map((r) => ({
      auditId: r.audit_id || r.id,
      at: r.created_at,
      overall: numOrNull(r.final_score),
      seo: numOrNull(r.seo_score),
      aeo: numOrNull(r.aeo_score),
      geo: numOrNull(r.geo_score),
      answerClarity: numOrNull(r.answer_clarity_score),
      entityAuthority: numOrNull(r.entity_authority_score),
      structuralHierarchy: numOrNull(r.structural_hierarchy_score),
      technicalAccessibility: numOrNull(r.technical_accessibility_score),
      coverage: numOrNull(r.coverage),
      issues: r.issue_count ?? null,
      critical: r.critical_count ?? null,
    })),
    // Computed over the first and last MEASURED points, not the first and last
    // rows — an audit that failed to measure the framework is not a data point.
    change: (() => {
      const measured = ordered.filter((r) => Number.isFinite(Number(r.final_score)));
      if (measured.length < 2) return null;
      return delta(Number(measured[0].final_score), Number(measured[measured.length - 1].final_score));
    })(),
    count: ordered.length,
  };
}

/**
 * Coerce to a number, or null.
 *
 * The explicit null/undefined/"" guard is load-bearing: `Number(null)` is 0 and
 * `Number("")` is 0, both of which are finite. Without it an unmeasured point
 * plots as a genuine zero and the trend chart shows the score plunging to the
 * floor on a month when nothing was measured at all — the same null-is-not-zero
 * error the scoring model exists to avoid, reappearing in the chart.
 */
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
