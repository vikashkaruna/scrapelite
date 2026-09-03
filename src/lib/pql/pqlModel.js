// pqlModel.js — PURE. Product-Qualified Lead scoring.
//
// Imported by BOTH React and netlify/ (same convention as entitlementModel.js
// and discoverability/*), so the score a founder sees on /admin/revenue and
// the score a server job stores can never be computed by different code.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE THIS INHERITS: AN UNMEASURED SIGNAL IS NOT A ZERO.
//
// This is the same distinction discoverability/scoringModel.js is built on, and
// it matters more here, not less. There are two reasons a signal can be absent:
//
//   NOT DONE      the user genuinely never exported anything      → scores 0
//   NOT MEASURED  nothing in this deployment records exports yet  → EXCLUDED
//
// Collapsing those makes every account look unqualified the moment an
// instrumentation gap appears, and then produces a phantom company-wide "PQL
// surge" on the day someone ships the missing tracking. A founder dashboard
// that moves for reasons the customers didn't cause is worse than no dashboard,
// because decisions get made on it. An excluded signal has its weight
// REDISTRIBUTED across the signals that were measurable, and every score
// carries `coverage` so a thin score can be labelled thin rather than trusted.
//
// Callers declare what they can measure via `measurable`. Omit it and every
// signal is assumed measurable — which is right for a fully-instrumented
// deployment and wrong to assume silently, hence `coverage` on every result.
// ─────────────────────────────────────────────────────────────────────────────

/** A score at or above this is a PQL. */
export const PQL_THRESHOLD = 50;

/**
 * The nine signals, with weights summing to 100.
 *
 * ⚠️ THESE WEIGHTS ARE A STARTING POINT, NOT A MEASUREMENT. They encode a
 * hypothesis about which behaviours predict revenue; nobody has observed that
 * yet for DatIQ. They are deliberately in one table so tuning them is a
 * one-line diff and so the reasoning below can be argued with.
 *
 * The ordering principle: weight COMMITMENT over ACTIVITY. Running one more
 * extraction is activity — cheap, reversible, and something a tyre-kicker does.
 * Putting DatIQ output in front of a colleague, or on a schedule, or inside
 * another system of record, is commitment: it costs the user something
 * socially or operationally and is what actually precedes a purchase.
 */
export const PQL_SIGNALS = Object.freeze([
  {
    key: "completed_workflow",
    weight: 18,
    label: "Completed a template workflow",
    why: "The core aha. Everything else is downstream of getting one finished, source-backed output.",
  },
  {
    key: "repeat_workflow_7d",
    weight: 14,
    label: "Ran a second workflow within 7 days",
    why: "Separates 'evaluated it' from 'started using it'. A single run is curiosity; the second is a decision.",
  },
  {
    key: "shared_report",
    weight: 13,
    label: "Published or shared a report",
    why: "Putting output in front of a colleague or client stakes the user's own credibility on it — the strongest voluntary signal short of paying.",
  },
  {
    key: "created_monitor",
    weight: 12,
    label: "Created a schedule or watchlist",
    why: "A standing commitment to keep receiving output. Converts a tool into a subscription in the user's own mind before it does on the invoice.",
  },
  {
    key: "pushed_to_integration",
    weight: 11,
    label: "Pushed data to an integration",
    why: "Output reaching HubSpot/Notion/Airtable/Slack means DatIQ entered a system of record. Removing it now costs the user work.",
  },
  {
    key: "multi_domain",
    weight: 10,
    label: "Analysed 3+ distinct domains",
    why: "Breadth proves a real use case rather than one test on their own homepage — which is what nearly every first run is.",
  },
  {
    key: "team_expansion",
    weight: 8,
    label: "Invited a teammate or created a second workspace",
    why: "Seat expansion intent. Small weight because it is rare early, not because it is weak.",
  },
  {
    key: "habitual_return",
    weight: 8,
    label: "Active on 3+ distinct days",
    why: "Habit, measured in days rather than sessions so one long evening of evaluation cannot fake it.",
  },
  {
    key: "hit_plan_limit",
    weight: 6,
    label: "Hit a plan limit or viewed pricing after activating",
    why: "Buying intent, but deliberately the SMALLEST weight: it is the signal most easily produced by a user who is about to churn instead of pay, and weighting frustration highly would point sales at the wrong accounts.",
  },
]);

export const PQL_SIGNAL_KEYS = Object.freeze(PQL_SIGNALS.map((s) => s.key));

const SIGNAL_BY_KEY = Object.freeze(
  Object.fromEntries(PQL_SIGNALS.map((s) => [s.key, s])),
);

/**
 * Per-persona activation definitions.
 *
 * Deliberately NOT "extracted one URL" for anyone. That fires for a visitor who
 * pasted a homepage to see what happens, so measuring it tells you how good the
 * landing page is, not whether anybody got value. Each definition below is the
 * smallest thing that means "this person got what they came for", expressed as
 * signal keys that must ALL be present.
 */
export const PERSONA_ACTIVATION = Object.freeze({
  "sales":             { requires: ["completed_workflow", "pushed_to_integration"], label: "Brief completed and pushed into the CRM" },
  "competitive-intel": { requires: ["completed_workflow", "created_monitor"],       label: "Competitor workflow completed and put on a schedule" },
  "seo":               { requires: ["completed_workflow", "shared_report"],         label: "Audit completed and shared with a stakeholder" },
  "market-research":   { requires: ["completed_workflow", "multi_domain"],          label: "Workflows completed across 3+ domains" },
  "recruiter":         { requires: ["completed_workflow", "repeat_workflow_7d"],    label: "Came back and ran a second workflow" },
  "founder-vc":        { requires: ["completed_workflow", "shared_report"],         label: "Diligence brief completed and shared" },
  "agency":            { requires: ["completed_workflow", "team_expansion"],        label: "Workflow completed and a client workspace created" },
});

/** Fallback for an unknown or unset persona — never throws on a bad id. */
export const DEFAULT_ACTIVATION = Object.freeze({
  requires: ["completed_workflow", "repeat_workflow_7d"],
  label: "Completed a workflow and came back for another",
});

function truthy(v) { return v === true; }

/**
 * Score one account.
 *
 * @param {Record<string, boolean>} signals    observed signals, keyed by signal key
 * @param {{measurable?: string[], persona?: string}} [opts]
 *   `measurable` lists the signal keys this deployment can actually observe.
 *   Anything omitted is EXCLUDED and its weight redistributed — see the header.
 * @returns {{score:number, coverage:number, isPql:boolean, threshold:number,
 *            activated:boolean, activation:{label:string, missing:string[]},
 *            contributions:Array, excluded:string[]}}
 */
export function scorePql(signals = {}, opts = {}) {
  const measurable = Array.isArray(opts.measurable)
    ? PQL_SIGNAL_KEYS.filter((k) => opts.measurable.includes(k))
    : PQL_SIGNAL_KEYS.slice();

  const excluded = PQL_SIGNAL_KEYS.filter((k) => !measurable.includes(k));
  const totalWeight = measurable.reduce((n, k) => n + SIGNAL_BY_KEY[k].weight, 0);

  // Nothing measurable at all is not a score of zero — it is the absence of a
  // score, and must be reported as such rather than as nine failed signals.
  if (totalWeight === 0) {
    return {
      score: null, coverage: 0, isPql: false, threshold: PQL_THRESHOLD,
      activated: false,
      activation: { label: activationFor(opts.persona).label, missing: activationFor(opts.persona).requires.slice() },
      contributions: [], excluded,
    };
  }

  const earned = measurable.reduce((n, k) => n + (truthy(signals[k]) ? SIGNAL_BY_KEY[k].weight : 0), 0);

  // Normalised against the MEASURABLE weight, not against 100. That is the
  // redistribution: with one signal un-instrumented, the remaining eight can
  // still reach 100, so the threshold keeps meaning the same thing.
  const score = Math.round((earned / totalWeight) * 100);

  const contributions = measurable.map((k) => ({
    key: k,
    label: SIGNAL_BY_KEY[k].label,
    weight: SIGNAL_BY_KEY[k].weight,
    met: truthy(signals[k]),
    // What this signal contributed to the FINAL 0-100 score, so an explanation
    // adds up to the number shown rather than to the raw weight table.
    points: truthy(signals[k]) ? Math.round((SIGNAL_BY_KEY[k].weight / totalWeight) * 100) : 0,
  }));

  const act = activationFor(opts.persona);
  const missing = act.requires.filter((k) => !truthy(signals[k]));

  return {
    score,
    coverage: Math.round((totalWeight / 100) * 100) / 100,
    isPql: score >= PQL_THRESHOLD,
    threshold: PQL_THRESHOLD,
    activated: missing.length === 0,
    activation: { label: act.label, missing },
    contributions,
    excluded,
  };
}

/** The activation definition for a persona, falling back rather than throwing. */
export function activationFor(personaId) {
  return PERSONA_ACTIVATION[personaId] || DEFAULT_ACTIVATION;
}

/**
 * Reduce raw analytics events to the signal map scorePql expects.
 * Pure: takes events, returns booleans. No clock, no storage, no network —
 * `now` is a parameter so a test can pin the 7-day window.
 */
export function signalsFromEvents(events = [], now = Date.now()) {
  // Drop non-objects up front. These rows arrive from BOTH the Supabase
  // analytics table and the localStorage flush buffer, and a single malformed
  // entry must not take down a founder dashboard — the same fail-soft posture
  // the rest of the analytics path already has.
  const list = (Array.isArray(events) ? events : []).filter(
    (e) => e && typeof e === "object",
  );
  const at = (e) => {
    const t = new Date(e.ts || e.created_at || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const named = (prefix) => list.filter((e) => String(e.name || "").startsWith(prefix));

  const runs = named("workflow_run_completed").sort((a, b) => at(a) - at(b));
  const domains = new Set(
    list.map((e) => e.properties?.domain).filter(Boolean).map((d) => String(d).toLowerCase()),
  );
  const days = new Set(
    list.map((e) => at(e)).filter((t) => t > 0).map((t) => new Date(t).toISOString().slice(0, 10)),
  );

  const firstRun = runs[0] ? at(runs[0]) : null;
  const repeatWithin7d = firstRun != null && runs.some(
    (r) => at(r) > firstRun && at(r) - firstRun <= 7 * 24 * 60 * 60 * 1000,
  );

  return {
    completed_workflow: runs.length > 0,
    repeat_workflow_7d: repeatWithin7d,
    shared_report: named("report_published").length > 0 || named("report_shared").length > 0,
    created_monitor: named("monitor_created").length > 0 || named("watchlist_created").length > 0,
    pushed_to_integration: named("integration_push").length > 0,
    multi_domain: domains.size >= 3,
    team_expansion: named("workspace_created").length > 0 || named("teammate_invited").length > 0,
    habitual_return: days.size >= 3,
    hit_plan_limit: named("plan_limit_hit").length > 0 || named("pricing_viewed_post_activation").length > 0,
  };
}
