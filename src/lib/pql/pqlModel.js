// pqlModel.js — PURE. Product-Qualified Lead scoring.
//
// Imported by BOTH React and netlify/ (same convention as entitlementModel.js
// and discoverability/*), so the score a founder sees on /admin/revenue and the
// score a server job stores can never be computed by different code.
//
// ─────────────────────────────────────────────────────────────────────────────
// SOURCE OF TRUTH
//
// The signal table and the activation definitions below are transcribed
// VERBATIM from the PRD ("DatIQ — Persona Specific Templates & Shareable
// Reports", §PQL Rules for DatIQ and §Recommended Activation Definitions).
// They are not a design proposal. Do not "improve" a weight here without
// changing the PRD too, or the two stop agreeing and nobody can tell which one
// the running system implements.
//
// ⚠️ THE POINTS SUM TO 130, NOT 100, AND THE THRESHOLD IS 50 RAW POINTS.
// It is very tempting to normalise this to a percentage. Doing so silently
// re-scales the threshold — 50 points out of 130 is 38%, so a "50%" threshold
// would be materially stricter than the PRD asks for and would suppress
// founder outreach the PRD wants triggered. The raw scale is kept.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE THIS INHERITS: AN UNMEASURED SIGNAL IS NOT A ZERO.
//
// Same distinction discoverability/scoringModel.js is built on. Two reasons a
// signal can be absent:
//
//   NOT DONE      the user genuinely never shared a report      → scores 0
//   NOT MEASURED  nothing in this deployment records it yet     → EXCLUDED
//
// This is load-bearing from day one rather than theoretical, because TWO of
// the PRD's nine signals cannot be measured by the product as it stands:
//
//   imported_enriched_10_companies (+20)  needs bulk enrichment — Phase 4
//   icp_fit                        (+15)  needs firmographic account data we
//                                         do not hold for a self-serve signup
//
// That is 35 of 130 points. Scoring them 0 would cap every user alive at
// 95/130 and quietly make the PRD's 50-point threshold harder than written —
// and then, on the day Phase 4 ships, produce a company-wide PQL surge that no
// customer caused. An excluded signal has its points REDISTRIBUTED across the
// signals that were measurable, and every score carries `coverage` so a thin
// score can be labelled thin rather than trusted.
// ─────────────────────────────────────────────────────────────────────────────

/** PRD: "PQL threshold: Start at 50 points." RAW points, not a percentage. */
export const PQL_THRESHOLD = 50;

/** The PRD's nine signals with their suggested points. Sums to 130. */
export const PQL_SIGNALS = Object.freeze([
  { key: "used_persona_template",          points: 10, label: "Used a persona template" },
  { key: "two_meaningful_extractions",     points: 10, label: "Completed two or more meaningful extractions" },
  { key: "created_shareable_report",       points: 10, label: "Created a shareable report" },
  { key: "connected_integration",          points: 20, label: "Connected HubSpot, Slack, Notion, Airtable, or Zapier" },
  { key: "created_recurring_monitor",      points: 20, label: "Created a recurring monitor" },
  { key: "imported_enriched_10_companies", points: 20, label: "Imported/enriched 10+ companies" },
  { key: "invited_teammate",               points: 15, label: "Invited a teammate" },
  { key: "pricing_viewed_twice_7d",        points: 10, label: "Visited pricing page twice within seven days" },
  { key: "icp_fit",                        points: 15, label: "Company is in ICP: B2B SaaS / relevant size / target geography" },
]);

export const PQL_SIGNAL_KEYS = Object.freeze(PQL_SIGNALS.map((s) => s.key));

/** 130. Exported so callers state the scale rather than assuming 100. */
export const PQL_MAX_POINTS = PQL_SIGNALS.reduce((n, s) => n + s.points, 0);

const SIGNAL_BY_KEY = Object.freeze(Object.fromEntries(PQL_SIGNALS.map((s) => [s.key, s])));

/**
 * Signals this build can actually observe from product events.
 *
 * `icp_fit` is ACCOUNT FIT, not behaviour — the PRD's own framing is "product
 * behavior plus account fit" — so it can never come from signalsFromEvents and
 * must be supplied by whatever knows the firmographics. Until something does,
 * it is unmeasurable and its 15 points are redistributed rather than lost.
 *
 * `imported_enriched_10_companies` becomes measurable when Phase 4's bulk
 * enrichment ships. Removing it from this list is the whole of that change.
 */
export const MEASURABLE_TODAY = Object.freeze(
  PQL_SIGNAL_KEYS.filter((k) => k !== "icp_fit" && k !== "imported_enriched_10_companies"),
);

// ── Activation, per the PRD's own table ──────────────────────────────────────
// PRD: "Do not use 'a user extracted one URL' as activation. That creates a
// misleading vanity metric." Every definition below is therefore compound.
//
// Activation conditions are a FINER vocabulary than the PQL signals on purpose:
// "runs an Account Brief template, exports/routes it, AND saves or monitors the
// account" is three distinct observations, and collapsing them onto the coarser
// PQL signals would let a user activate without doing what the PRD describes.
export const ACTIVATION_CONDITIONS = Object.freeze({
  ran_account_brief:        "Ran an Account Brief template",
  exported_or_routed:       "Exported or routed the result",
  saved_or_monitored:       "Saved or monitored the account",
  imported_10_accounts:     "Uploaded or imported at least 10 accounts",
  enriched_imported:        "Enriched them",
  sent_to_crm_sheet:        "Sent results to CRM, Sheets or Airtable",
  added_3_competitors:      "Added at least 3 competitors",
  monitored_pages:          "Monitored relevant pages",
  shared_or_received_digest:"Shared or received a first digest",
  ran_audit:                "Ran an audit",
  exported_content_brief:   "Exported a content or optimization brief",
  generated_diligence_brief:"Generated a company due-diligence brief",
  shared_or_saved_brief:    "Shared or saved the brief",
  ran_branded_report:       "Ran a client-branded report",
  connected_export_dest:    "Connected an export destination",
});

/**
 * The PRD's six activation definitions, verbatim in `label`, with `requires`
 * naming the conditions that must ALL hold.
 */
export const ACTIVATION_DEFINITIONS = Object.freeze({
  "sales-sdr": {
    label: "Runs an Account Brief template, exports/routes it, and saves or monitors the account",
    why: "They have produced actionable sales intelligence",
    requires: ["ran_account_brief", "exported_or_routed", "saved_or_monitored"],
  },
  "revops": {
    label: "Uploads/imports at least 10 accounts, enriches them, and sends results to CRM/Sheet/Airtable",
    why: "They have established a pipeline workflow",
    requires: ["imported_10_accounts", "enriched_imported", "sent_to_crm_sheet"],
  },
  "product-pmm": {
    label: "Adds at least 3 competitors, monitors relevant pages, and shares/receives first digest",
    why: "They have created a recurring intelligence loop",
    requires: ["added_3_competitors", "monitored_pages", "shared_or_received_digest"],
  },
  "seo-content": {
    label: "Runs an audit and exports a content/optimization brief",
    why: "They have created a production asset",
    requires: ["ran_audit", "exported_content_brief"],
  },
  "vc-analyst": {
    label: "Generates and shares/saves a company due-diligence brief",
    why: "They have replaced a manual research task",
    requires: ["generated_diligence_brief", "shared_or_saved_brief"],
  },
  "agency": {
    label: "Runs a client-branded report and connects an export destination",
    why: "They can monetize it with clients",
    requires: ["ran_branded_report", "connected_export_dest"],
  },
});

/**
 * The app ships SEVEN personas (personaConfig.js); the PRD defines SIX
 * activation groups. This is the mapping, kept explicit rather than inferred
 * from label similarity so a future persona rename cannot silently re-point
 * somebody's activation definition.
 *
 * `recruiter` has no PRD equivalent — the PRD's persona table does not include
 * recruiting. It is mapped to the closest DEFINED behaviour (research brief,
 * generated then kept) rather than given an invented definition of its own,
 * and flagged here so the gap is visible instead of buried.
 */
export const PERSONA_TO_ACTIVATION = Object.freeze({
  "sales":             "sales-sdr",
  "competitive-intel": "product-pmm",
  "seo":               "seo-content",
  "market-research":   "vc-analyst",
  "founder-vc":        "vc-analyst",
  "agency":            "agency",
  "recruiter":         "vc-analyst", // ⚠️ no PRD persona for recruiting — see above
});

/** Fallback for an unknown/unset persona. Never throws on a bad id. */
export const DEFAULT_ACTIVATION_KEY = "sales-sdr";

/** The activation definition for an app persona id. */
export function activationFor(personaId) {
  const key = PERSONA_TO_ACTIVATION[personaId] || DEFAULT_ACTIVATION_KEY;
  return ACTIVATION_DEFINITIONS[key];
}

const isTrue = (v) => v === true;

/**
 * Score one account against the PRD's table.
 *
 * @param {Record<string, boolean>} signals   observed signals, keyed by signal key
 * @param {{measurable?: string[], persona?: string, conditions?: Record<string,boolean>}} [opts]
 *   `measurable` lists signal keys this deployment can observe (defaults to
 *   MEASURABLE_TODAY, which is the honest answer for the product as it stands).
 *   `conditions` are the finer-grained activation observations.
 * @returns {{points:number|null, rawPoints:number, maxPoints:number,
 *            coverage:number, isPql:boolean, threshold:number, activated:boolean,
 *            activation:object, contributions:Array, excluded:string[]}}
 */
export function scorePql(signals = {}, opts = {}) {
  const measurable = Array.isArray(opts.measurable)
    ? PQL_SIGNAL_KEYS.filter((k) => opts.measurable.includes(k))
    : MEASURABLE_TODAY.slice();

  const excluded = PQL_SIGNAL_KEYS.filter((k) => !measurable.includes(k));
  const measurablePoints = measurable.reduce((n, k) => n + SIGNAL_BY_KEY[k].points, 0);
  const act = activationFor(opts.persona);
  const conditions = opts.conditions || {};
  const missing = act.requires.filter((k) => !isTrue(conditions[k]));

  // Nothing measurable is the ABSENCE of a score, not a score of zero. A null
  // renders as "no data"; a 0 renders as "unqualified", which is a claim.
  if (measurablePoints === 0) {
    return {
      points: null, rawPoints: 0, maxPoints: PQL_MAX_POINTS, coverage: 0,
      isPql: false, threshold: PQL_THRESHOLD, activated: false,
      activation: { key: PERSONA_TO_ACTIVATION[opts.persona] || DEFAULT_ACTIVATION_KEY,
                    label: act.label, missing: act.requires.slice() },
      contributions: [], excluded,
    };
  }

  const rawPoints = measurable.reduce(
    (n, k) => n + (isTrue(signals[k]) ? SIGNAL_BY_KEY[k].points : 0), 0);

  // Scale back onto the FULL 130-point scale so the PRD's 50-point threshold
  // keeps meaning the same thing when a signal is un-instrumented. Without
  // this, the two signals nobody can measure today would make the threshold
  // 35 points harder than the PRD specifies.
  const points = Math.round(rawPoints * (PQL_MAX_POINTS / measurablePoints));

  const contributions = measurable.map((k) => ({
    key: k,
    label: SIGNAL_BY_KEY[k].label,
    points: SIGNAL_BY_KEY[k].points,
    met: isTrue(signals[k]),
  }));

  return {
    points,
    rawPoints,
    maxPoints: PQL_MAX_POINTS,
    coverage: Math.round((measurablePoints / PQL_MAX_POINTS) * 1000) / 1000,
    isPql: points >= PQL_THRESHOLD,
    threshold: PQL_THRESHOLD,
    activated: missing.length === 0,
    activation: { key: PERSONA_TO_ACTIVATION[opts.persona] || DEFAULT_ACTIVATION_KEY,
                  label: act.label, missing },
    contributions,
    excluded,
  };
}

/**
 * Reduce raw analytics events to the signal map scorePql expects.
 * Pure: no clock, no storage, no network — `now` is a parameter so a test can
 * pin the seven-day pricing window.
 *
 * Never returns icp_fit: it is account fit, not behaviour. A caller that knows
 * the firmographics merges it in and widens `measurable` accordingly.
 */
export function signalsFromEvents(events = [], now = Date.now()) {
  // Rows arrive from BOTH the Supabase analytics table and the localStorage
  // flush buffer, either of which can carry junk. One malformed entry must not
  // take down a founder dashboard.
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === "object");
  const at = (e) => {
    const t = new Date(e.ts || e.created_at || e.occurred_at || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const named = (name) => list.filter((e) => String(e.name || "") === name);
  const startsWith = (p) => list.filter((e) => String(e.name || "").startsWith(p));

  // PRD wording is "two or more MEANINGFUL extractions" — a failed extraction
  // is not meaningful, so extraction_failed is deliberately not counted.
  const meaningful = named("extraction_success").length + named("workflow_run_completed").length;

  const pricingViews = named("pricing_viewed").map(at).filter((t) => t > 0).sort((a, b) => a - b);
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  let pricingTwiceIn7d = false;
  for (let i = 1; i < pricingViews.length; i += 1) {
    if (pricingViews[i] - pricingViews[i - 1] <= SEVEN_DAYS) { pricingTwiceIn7d = true; break; }
  }

  return {
    used_persona_template: startsWith("template_run").length > 0,
    two_meaningful_extractions: meaningful >= 2,
    created_shareable_report: named("report_published").length > 0 || named("report_shared").length > 0,
    connected_integration: named("integration_connected").length > 0,
    created_recurring_monitor: named("monitor_created").length > 0 || named("watchlist_created").length > 0,
    imported_enriched_10_companies:
      list.some((e) => e.name === "bulk_enrichment_completed" && Number(e.properties?.count) >= 10),
    invited_teammate: named("teammate_invited").length > 0,
    pricing_viewed_twice_7d: pricingTwiceIn7d,
  };
}
