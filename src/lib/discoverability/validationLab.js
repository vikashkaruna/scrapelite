// validationLab.js — did the work land, and did it move anything? W7.
//
// PURE. Shared by React and `netlify/`.
//
// `auditDiff` compares overall, framework and pillar scores, and sorts issues
// into resolved / remaining / introduced. That answers "is the page better".
// It does not answer the question the validation loop exists for: **which of
// the things I did actually moved anything.**
//
// Three gaps closed here, and they are one gap wearing three hats:
//
//   · SIGNAL-LEVEL DIFF. A pillar moving 4 points says nothing about which of
//     its five or six signals moved. Without that, "remaining" is a bucket of
//     twelve issues with no indication which are drifting worse.
//   · REGRESSED vs UNCHANGED. `remaining` conflates "still broken, no worse"
//     with "still broken and deteriorating", and only the second is urgent.
//     That split is only computable once signals are compared, which is why
//     these two arrived together.
//   · ATTRIBUTION. Relating an implemented recommendation to the movement of
//     the signal it targeted.
//
// ── 🔴 ATTRIBUTION IS CORRELATION AND SAYS SO IN EVERY RECORD ──────────────
// The PRD's own risk table names this as the claim most likely to be
// over-read, and it is right. Between two audits the page changed, the web
// changed, the engines changed, and PageSpeed may simply have been having a
// better morning. We can say "you marked this done, and the signal it targets
// moved +6.1". We cannot say the fix caused it, and a product that quietly
// implies it will eventually be caught doing so by a customer who did nothing
// and improved anyway.
//
// So every attribution carries `relationship: "correlation"` and a `caveat`
// string, and there is a test asserting no attribution ever claims causation.

import { SIGNALS } from "./signalRegistry.js";
import { ISSUES } from "./issueCatalog.js";

/** How much a signal must move before it is movement rather than noise. */
export const SIGNAL_NOISE_FLOOR = 1.0;

/** Windows the trend view offers. `custom` takes any day count. */
export const TREND_WINDOWS = Object.freeze([7, 28, 90]);

// ── Signal-level diff ──────────────────────────────────────────────────────
//
// 🔴 THERE ISN'T ONE HERE, AND THAT IS DELIBERATE.
// §7.7 of the implementation plan records the signal-level diff as missing.
// It is not: `auditDiff.diffAudits` has built one since the module shipped,
// through the same `delta()` every other comparison uses. W7 originally added a
// second one here before that was spotted — two differs that agree today and
// drift on the first change to either, which is the exact defect this module
// has found in itself twice (`EVENT_TO_SOURCE` against a CHECK constraint, and
// a cron registry against netlify.toml).
//
// So `classifyIssues` TAKES the signal diff rather than computing one, and
// `auditDiff` passes the array it already has.

// ── Issue classification ───────────────────────────────────────────────────

/**
 * resolved / new / regressed / unchanged — the PRD's four.
 *
 * `regressed` and `unchanged` both mean "still present". The difference is
 * whether the signal underneath is deteriorating, and it is the difference
 * between a backlog item and something actively getting worse while nobody
 * watches.
 *
 * ⚠️ AN ISSUE WHOSE SIGNAL CANNOT BE COMPARED IS `unchanged`, NOT `regressed`.
 * Calling an unmeasurable thing a regression manufactures urgency out of an
 * outage, and an operator who chases two of those stops trusting the fourth.
 */
export function classifyIssues(baseline = {}, current = {}, signalDiff = []) {
  const byCode = Object.fromEntries((signalDiff || []).map((d) => [d.code, d]));

  const beforeCodes = new Set((baseline.issues || []).map((i) => i.code));
  const afterCodes = new Set((current.issues || []).map((i) => i.code));
  const signalFor = (code) => (current.issues || []).concat(baseline.issues || [])
    .find((i) => i.code === code)?.signalCode || null;

  const describe = (code, extra = {}) => ({
    code,
    title: ISSUES[code]?.title || code,
    severity: ISSUES[code]?.severity || "medium",
    pillar: ISSUES[code]?.pillar || null,
    ...extra,
  });

  const resolved = [...beforeCodes].filter((c) => !afterCodes.has(c)).map((c) => describe(c));
  const introduced = [...afterCodes].filter((c) => !beforeCodes.has(c)).map((c) => describe(c));

  const regressed = [];
  const unchanged = [];
  for (const code of [...afterCodes].filter((c) => beforeCodes.has(c))) {
    const sc = signalFor(code);
    const d = sc ? byCode[sc] : null;
    if (d && d.comparable && d.change <= -SIGNAL_NOISE_FLOOR) {
      regressed.push(describe(code, { signalCode: sc, change: d.change }));
    } else {
      unchanged.push(describe(code, { signalCode: sc, change: d?.comparable ? d.change : null }));
    }
  }

  return {
    resolved, introduced, regressed, unchanged,
    resolvedCount: resolved.length,
    introducedCount: introduced.length,
    regressedCount: regressed.length,
    unchangedCount: unchanged.length,
    // Kept so existing readers of `remaining` do not break. It is the union,
    // which is exactly what it always was.
    remaining: [...regressed, ...unchanged],
    remainingCount: regressed.length + unchanged.length,
  };
}

// ── Trend windows ──────────────────────────────────────────────────────────

/**
 * The slice of a trend inside the last N days.
 *
 * Returns the points AND what was excluded, because "your score is flat" reads
 * very differently when it is computed over two points than over thirty, and a
 * window that silently drops data invites exactly that misreading.
 */
export function trendWindow(points = [], days = 28, now = Date.now()) {
  const all = Array.isArray(points) ? points : [];
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) {
    return { days: null, points: all, excluded: 0, label: "All time" };
  }
  const cutoff = now - n * 86_400_000;
  const kept = all.filter((p) => {
    const t = Date.parse(p.at || p.created_at || 0);
    return Number.isFinite(t) && t >= cutoff;
  });
  return {
    days: n,
    points: kept,
    excluded: all.length - kept.length,
    label: n === 7 ? "7 days" : n === 28 ? "28 days" : n === 90 ? "90 days" : `${n} days`,
  };
}

// ── Attribution ────────────────────────────────────────────────────────────

/**
 * Recommendations marked done between two audits, and what their signal did.
 *
 * 🔴 CORRELATION, DECLARED IN THE DATA AND NOT ONLY IN THE COPY.
 * Every record carries `relationship: "correlation"` and a caveat, so a
 * consumer that renders the number without the label has to have gone out of
 * its way to drop it. The PRD names this as the claim most likely to be
 * over-read; a product that implies causation here is one screenshot away from
 * being wrong in public.
 *
 * ⚠️ A FIX FOLLOWED BY A FALL IS REPORTED, NOT HIDDEN. That is the most useful
 * row on the screen: either the fix did not do what was expected, or something
 * else regressed underneath it, and both are worth knowing. Reporting only the
 * improvements would make this a marketing surface rather than a measurement.
 */
export function attributeMovement({
  recommendations = [], signalDiff = [], baselineAt = null, currentAt = null,
} = {}) {
  const bT = baselineAt ? Date.parse(baselineAt) : null;
  const cT = currentAt ? Date.parse(currentAt) : null;
  const byCode = Object.fromEntries(signalDiff.map((d) => [d.code, d]));

  const inWindow = (rec) => {
    if (rec.status !== "done") return false;
    const t = Date.parse(rec.status_changed_at || rec.statusChangedAt || 0);
    if (!Number.isFinite(t)) return false;
    if (Number.isFinite(bT) && t < bT) return false;
    if (Number.isFinite(cT) && t > cT) return false;
    return true;
  };

  const attributions = [];
  for (const rec of Array.isArray(recommendations) ? recommendations : []) {
    if (!inWindow(rec)) continue;
    const sc = rec.signal_code || rec.signalCode || null;
    const d = sc ? byCode[sc] : null;

    attributions.push({
      code: rec.code,
      title: rec.title || ISSUES[rec.code]?.title || rec.code,
      signalCode: sc,
      signalLabel: sc ? SIGNALS[sc]?.label || sc : null,
      implementedAt: rec.status_changed_at || rec.statusChangedAt || null,
      change: d?.comparable ? d.change : null,
      // The three honest outcomes. `unmeasurable` is not a failure of the fix.
      outcome: !d || !d.comparable ? "unmeasurable"
        : d.change >= SIGNAL_NOISE_FLOOR ? "moved_up"
        : d.change <= -SIGNAL_NOISE_FLOOR ? "moved_down"
        : "flat",
      relationship: "correlation",
      caveat: "Marked done between these two audits and the signal moved as shown. "
        + "The page, the web and the engines all changed in that window — this is "
        + "not a measurement of what the fix caused.",
    });
  }

  const measured = attributions.filter((a) => a.outcome !== "unmeasurable");
  return {
    attributions,
    implementedCount: attributions.length,
    movedUp: measured.filter((a) => a.outcome === "moved_up").length,
    movedDown: measured.filter((a) => a.outcome === "moved_down").length,
    flat: measured.filter((a) => a.outcome === "flat").length,
    unmeasurable: attributions.length - measured.length,
    relationship: "correlation",
  };
}
