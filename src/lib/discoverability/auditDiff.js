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
import { classifyIssues } from "./validationLab.js";

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

  // ── THE VERSION GATE ─────────────────────────────────────────────────────
  //
  // Everything below this line subtracts one number from another. That is only
  // a measurement of change when both numbers came out of the same model —
  // otherwise part of the delta is the model moving, and no reader can tell
  // which part. So a cross-version comparison is REFUSED rather than annotated:
  // a caveat under a confident "+4.2" is read as a footnote, and the number is
  // what gets screenshotted, quoted in a standup and pasted into a board deck.
  //
  // This is deliberately the harsher choice. "Re-run to compare" costs the user
  // an audit; a delta that mixes two penalty sets costs them their trust in
  // every other number in the report, and they will not know to spend it.
  //
  // Rows written before migration 0048 carry no version and are v1 — the only
  // model this repository had shipped when they were written. That is the same
  // fallback `rehydrate()` applies, and it means the guard treats a
  // pre-versioning baseline as what it actually is rather than as unknown.
  const baselineVersion = baseline.scoringModelVersion || "v1";
  const currentVersion = current.scoringModelVersion || "v1";
  if (baselineVersion !== currentVersion) {
    return incomparableDiff(baseline, current, baselineVersion, currentVersion);
  }

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
  // W7 note: this signal-level diff has existed since the module shipped —
  // §7.7 of the implementation plan records it as missing, and that row is
  // wrong. What W7 adds is the CLASSIFICATION built on top of it, plus the
  // weight and ordering a reader needs to know which move mattered.
  const signals = Object.keys(SIGNALS).map((code) => ({
    code, label: signalLabel(code), pillar: SIGNALS[code].pillar,
    weight: SIGNALS[code].weight,
    ...delta(b[code] ?? null, c[code] ?? null),
  }))
    .map((s) => ({ ...s, direction: direction(s.change) }))
    // Biggest move first: a list in registry order buries the one thing that
    // changed under twenty that did not.
    .sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0));

  // ── issues: resolved, remaining, new ─────────────────────────────────────
  const beforeCodes = new Set((baseline.issues || []).map((i) => i.code));
  const afterCodes = new Set((current.issues || []).map((i) => i.code));

  const describe = (code) => ({
    code,
    title: ISSUES[code]?.title || code,
    severity: ISSUES[code]?.severity || "medium",
    pillar: ISSUES[code]?.pillar || null,
  });

  // The four-way classification, fed the signal diff computed above so there is
  // exactly one signal differ in this codebase.
  const classified = classifyIssues(baseline, current, signals);

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
      // W7 — the split that separates a backlog item from something actively
      // deteriorating. `remaining` stays as their union so every existing
      // reader keeps working.
      regressed: classified.regressed,
      unchanged: classified.unchanged,
      regressedCount: classified.regressedCount,
      unchangedCount: classified.unchangedCount,
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

/**
 * ── THE TWO REASONS A COMPARISON IS REFUSED ──────────────────────────────
 *
 * Both produce the same full shape with every delta non-comparable; they differ
 * in one place that matters, and the difference is not cosmetic.
 *
 * A VERSION mismatch means the same page measured two ways. The numbers cannot
 * be compared, but the FINDINGS can: issue codes are a public contract that
 * does not move with the scoring model, and the issue list is the most
 * actionable thing left on the page.
 *
 * A SUBJECT mismatch (D7) means two different things entirely — a brand audit
 * against a page audit, or two unrelated URLs. Here the issue lists must be
 * withheld too, because "AC-01 was resolved" would credit a fix on one subject
 * to another. That is the silent mis-attribution failure this repository has
 * already had to fix once, in `audit_recommendations.issue_id`.
 */
export function versionMismatchCause(baselineVersion, currentVersion) {
  return {
    kind: "version",
    keepIssues: true,
    reason: `scored on ${baselineVersion}, compared against ${currentVersion}`,
    versionMismatch: {
      baseline: baselineVersion,
      current: currentVersion,
      // What the UI should offer. The baseline is the stale side by
      // definition — it is the older measurement — so re-running the page is
      // what restores comparability, not re-running the current audit.
      remedy: "rerun",
    },
    subjectMismatch: null,
    caveat: `The baseline was scored with model ${baselineVersion} and this audit with ${currentVersion}. Scores from two different models are not comparable, so no deltas are shown — re-run the baseline page to compare like with like.`,
    headline: `This baseline was scored with an earlier version of the model (${baselineVersion}), so its scores cannot be compared with this audit's. The issue list below is still accurate — issue codes do not change between model versions.`,
  };
}

export function subjectMismatchCause(explanation) {
  const text = explanation || "These two audits are about different subjects, so their scores are not comparable.";
  return {
    kind: "subject",
    keepIssues: false,
    reason: "the two audits are about different subjects",
    versionMismatch: null,
    // There is no remedy the customer can apply — nothing is stale, the two
    // audits are simply about different things — so `remedy` is deliberately
    // absent rather than a "rerun" that would fix nothing.
    subjectMismatch: { reason: text },
    caveat: text,
    headline: text,
  };
}

/**
 * The same shape, with every delta refused.
 *
 * ── WHY A FULL SHAPE AND NOT `null` ──────────────────────────────────────
 * Every consumer of `diffAudits` — the compare route, the report writer, the
 * dashboard's diff panel, the monitor's regression alert — reads named keys off
 * the result. Returning `null` here would turn an honest refusal into a
 * TypeError somewhere downstream, and the user would see "something went wrong"
 * instead of the one sentence that actually explains their situation.
 *
 * So the shape is complete and every delta is non-comparable, with the reason
 * on each one. `versionMismatch` is the machine-readable form of the same fact,
 * for a caller that wants to render a "re-run" button rather than a sentence.
 *
 * ⚠️ The ISSUE lists are still computed and still true. Issue codes are a
 * public contract that does not move with the scoring model, so "AC-01 was
 * resolved" survives a version bump intact — and it is the most actionable
 * thing left on the page when the numbers cannot be compared. Withholding it
 * would be refusing more than the model actually invalidated.
 */
export function incomparableDiff(baseline, current, baselineVersion, currentVersion, cause = null) {
  const c = cause || versionMismatchCause(baselineVersion, currentVersion);
  const refused = (r) => ({
    before: null, after: null, change: null, comparable: false, reason: r, direction: "unknown",
  });
  const reason = c.reason;

  const beforeCodes = new Set((baseline.issues || []).map((i) => i.code));
  const afterCodes = new Set((current.issues || []).map((i) => i.code));
  const describe = (code) => ({
    code,
    title: ISSUES[code]?.title || code,
    severity: ISSUES[code]?.severity || "medium",
    pillar: ISSUES[code]?.pillar || null,
  });
  // 🔴 THE ISSUE LISTS SURVIVE A VERSION BUMP AND MUST NOT SURVIVE A SUBJECT
  // MISMATCH. Codes are a public contract that does not move with the scoring
  // model, so "AC-01 was resolved" stays true across v1 → v2 on the same page.
  // Across two DIFFERENT subjects it is a lie of exactly the shape this repo
  // has already recorded: a finding on one thing credited as a fix on another,
  // reported confidently, with nobody seeing an error.
  const resolved = c.keepIssues ? [...beforeCodes].filter((x) => !afterCodes.has(x)).map(describe) : [];
  const remaining = c.keepIssues ? [...afterCodes].filter((x) => beforeCodes.has(x)).map(describe) : [];
  const introduced = c.keepIssues ? [...afterCodes].filter((x) => !beforeCodes.has(x)).map(describe) : [];

  return {
    baselineId: baseline.auditId || baseline.id || null,
    currentId: current.auditId || current.id || null,
    versionMismatch: c.versionMismatch,
    subjectMismatch: c.subjectMismatch || null,
    frameworks: Object.fromEntries(FRAMEWORKS.map((f) => [f, refused(reason)])),
    pillars: Object.fromEntries(PILLAR_IDS.map((p) => [p, { label: pillarLabel(p), ...refused(reason) }])),
    signals: Object.keys(SIGNALS).map((code) => ({
      code, label: signalLabel(code), pillar: SIGNALS[code].pillar, ...refused(reason),
    })),
    issues: {
      resolved, remaining, introduced,
      resolvedCount: resolved.length,
      remainingCount: remaining.length,
      introducedCount: introduced.length,
    },
    penalties: {
      // Penalty codes are a contract too, but the SET they are drawn from is
      // exactly what changed between versions — a code absent from the baseline
      // may be absent because the page was clean or because the check did not
      // exist yet. Reporting "cleared" would be reporting a fix nobody made.
      cleared: [], remaining: [], introduced: [],
      multiplier: refused(reason),
    },
    citation: null,
    coverage: refused(reason),
    caveats: [c.caveat],
    headline: c.headline,
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
