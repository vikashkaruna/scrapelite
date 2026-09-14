// promptMonitorModel.js — when a monitor is due, and what changed since last time.
//
// PURE. Shared by React and `netlify/`, like every other model here.

import { CITATION_STATES } from "./citationStates.js";

export const CADENCES = Object.freeze(["daily", "weekly", "monthly"]);

const MS = { daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 };

/** When a monitor on this cadence should next run. Unknown cadence → weekly. */
export function cadenceToNextRun(cadence, now = Date.now()) {
  return new Date(now + (MS[cadence] || MS.weekly)).toISOString();
}

/** Is this monitor due, by the user's intent and the platform's? */
export function isDue(monitor, now = Date.now()) {
  if (!monitor || monitor.status !== "active" || monitor.system_paused) return false;
  if (monitor.run_until && Date.parse(monitor.run_until) < now) return false;
  if (!monitor.next_run_at) return true;              // never run — run it
  return Date.parse(monitor.next_run_at) <= now;
}

/**
 * What changed between two monitor runs.
 *
 * 🔴 THE ALERT CONDITION IS A STATE CHANGE, NOT A SCORE MOVE. Going from
 * `cited` to `absent` on one prompt is news even when WAVI barely moves,
 * because the thing that changed is whether anybody can reach you through that
 * question. A score threshold alone would stay silent through exactly the
 * change an operator most needs to hear about.
 *
 * ⚠️ RUNS OF DIFFERENT LIVENESS ARE NOT COMPARABLE. A week sampled live against
 * a week answered from a model's own weights are measurements of different
 * things, and a delta across them is part visibility and part which engine
 * answered. `comparable` is false there and every delta is null — the same
 * refusal `auditDiff` makes across scoring versions, for the same reason.
 */
export function diffMonitorRuns(previous, current) {
  if (!current) return null;
  if (!previous) {
    return {
      comparable: false, reason: "first run — nothing to compare against",
      stateChanges: [], waviChange: null, newlyAbsent: [], newlyCited: [],
    };
  }
  if (Boolean(previous.live) !== Boolean(current.live)) {
    return {
      comparable: false,
      reason: previous.live
        ? "the previous run was sampled live and this one was not — not comparable"
        : "this run was sampled live and the previous one was not — not comparable",
      stateChanges: [], waviChange: null, newlyAbsent: [], newlyCited: [],
    };
  }

  const before = new Map((previous.runs || []).map((r) => [r.prompt, r.state]));
  const stateChanges = [];
  for (const r of current.runs || []) {
    const was = before.get(r.prompt);
    if (was === undefined || was === r.state) continue;
    stateChanges.push({
      prompt: r.prompt,
      from: was,
      to: r.state,
      // Direction by the states' own ranks, which are ordered by what they mean
      // for the operator rather than by sentiment.
      worse: (CITATION_STATES[r.state]?.rank ?? 9) > (CITATION_STATES[was]?.rank ?? 9),
    });
  }

  const num = (v) => (Number.isFinite(v) ? v : null);
  const a = num(previous.wavi_score ?? previous.waviScore);
  const b = num(current.wavi_score ?? current.waviScore);

  return {
    comparable: true,
    reason: null,
    stateChanges,
    waviChange: a === null || b === null ? null : Math.round((b - a) * 10) / 10,
    newlyAbsent: stateChanges.filter((c) => c.to === "absent").map((c) => c.prompt),
    newlyCited: stateChanges.filter((c) => ["cited", "cited_and_recommended"].includes(c.to)).map((c) => c.prompt),
  };
}

/**
 * Should this run send mail?
 *
 * Alerts fire on movement, never on existence — a weekly monitor that mails
 * every week regardless is one nobody reads by week four. The same rule
 * `discoverability-monitor` already states for audits.
 */
export function shouldAlert(monitor, diff) {
  if (!monitor?.alert_email || !diff?.comparable) return false;
  if (monitor.alert_on_state_change && diff.stateChanges.length > 0) return true;
  const threshold = Number(monitor.alert_wavi_delta);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return diff.waviChange !== null && Math.abs(diff.waviChange) >= threshold;
}
