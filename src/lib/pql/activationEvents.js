// activationEvents.js — PURE. The event vocabulary that feeds PQL scoring and
// activation. Shared by the browser and netlify/, like pqlModel.js.
//
// WHY THIS FILE EXISTS SEPARATELY FROM pqlModel.js
// ------------------------------------------------
// pqlModel says WHAT counts. This says what the product must EMIT for that to
// be observable, and it is a genuinely different failure mode: a scoring model
// can be perfectly correct and still read zero for every user forever, because
// the emitter and the consumer disagree about a string.
//
// That is not hypothetical in this codebase. From CLAUDE.md:
//
//   "schedulerService sent {url, name} to analytics when the object carries
//    target/label, so every monitor_created event ever recorded was
//    undefined/undefined."
//
// Nothing failed. Nothing logged. The events were recorded, they were just
// empty — and it went unnoticed until somebody read the rows. The same shape
// of bug is available here on every one of the names below, so the vocabulary
// lives in ONE place, carries the signal it feeds, and a test asserts that
// every name pqlModel looks for is declared here and vice versa.

/**
 * Every analytics event name that PQL or activation reads.
 *
 * `feeds` names the PQL signal (pqlModel.PQL_SIGNALS) this event contributes
 * to, or null when it only serves activation. `conditions` names the activation
 * conditions (pqlModel.ACTIVATION_CONDITIONS) it can satisfy.
 *
 * `requires` documents the properties the event MUST carry to be useful. An
 * event emitted without them is not an error anywhere — it is simply a row
 * that can never satisfy the thing it was emitted for, which is exactly how
 * the monitor_created bug survived.
 */
export const ACTIVATION_EVENTS = Object.freeze({
  // ── PQL signals ──────────────────────────────────────────────────────────
  template_run_completed: {
    feeds: "used_persona_template",
    conditions: ["ran_account_brief", "ran_audit", "generated_diligence_brief", "ran_branded_report"],
    requires: ["templateKey"],
    note: "Which condition it satisfies depends on templateKey — one event, several possible meanings.",
  },
  extraction_success:  { feeds: "two_meaningful_extractions", conditions: [], requires: ["domain"] },
  report_published:    { feeds: "created_shareable_report", conditions: ["shared_or_saved_brief", "shared_or_received_digest"], requires: [] },
  report_shared:       { feeds: "created_shareable_report", conditions: ["shared_or_saved_brief", "shared_or_received_digest"], requires: [] },
  integration_connected: { feeds: "connected_integration", conditions: ["connected_export_dest", "sent_to_crm_sheet"], requires: ["provider"] },
  monitor_created:     { feeds: "created_recurring_monitor", conditions: ["saved_or_monitored", "monitored_pages"], requires: ["target"] },
  watchlist_created:   { feeds: "created_recurring_monitor", conditions: ["monitored_pages", "added_3_competitors"], requires: ["competitorCount"] },
  bulk_enrichment_completed: { feeds: "imported_enriched_10_companies", conditions: ["imported_10_accounts", "enriched_imported"], requires: ["count"] },
  teammate_invited:    { feeds: "invited_teammate", conditions: [], requires: [] },
  pricing_viewed:      { feeds: "pricing_viewed_twice_7d", conditions: [], requires: [] },

  // ── activation only ──────────────────────────────────────────────────────
  extraction_exported: { feeds: null, conditions: ["exported_or_routed", "exported_content_brief", "exported_or_routed_shortlist"], requires: ["format"] },
  extraction_saved:    { feeds: null, conditions: ["saved_or_monitored"], requires: [] },
  integration_push:    { feeds: null, conditions: ["exported_or_routed", "sent_to_crm_sheet", "exported_or_routed_shortlist"], requires: ["provider"] },
  // Satisfies BOTH recruiter conditions: one event proves sourcing happened,
  // and three with distinct `domain` values prove it happened across companies.
  // Declaring only the first made the recruiter definition look unsatisfiable.
  enrichment_completed:{ feeds: null, conditions: ["sourced_hiring_signals", "sourced_across_3_companies"], requires: ["capability", "domain"] },
  digest_received:     { feeds: null, conditions: ["shared_or_received_digest"], requires: [] },
});

export const ACTIVATION_EVENT_NAMES = Object.freeze(Object.keys(ACTIVATION_EVENTS));

// Template keys that satisfy a specific activation condition. Kept beside the
// vocabulary rather than inside the runner so adding a template cannot quietly
// stop satisfying an activation definition it used to.
export const TEMPLATE_CONDITION = Object.freeze({
  account_brief:            "ran_account_brief",
  discoverability_audit:    "ran_audit",
  due_diligence_brief:      "generated_diligence_brief",
  competitor_pricing_tracker: null,
  customer_proof_extractor: null,
  bulk_icp_enrichment:      null,
  ai_visibility_brief:      null,
  recruiter_talent_sourcing: null,
  market_landscape_map: null,
  agency_client_teardown: null,
  continuous_account_signal: null,
  // Template hub (2026-09-24). The eight hand-offs never produce a template run
  // — the module they open emits its own events — so they satisfy nothing here.
  // The content brief is a run, but running it is not EXPORTING a brief, which
  // is what seo-content's condition asks for.
  competitor_change_monitor: null,
  price_change_slack_alert: null,
  account_research_outreach: null,
  event_followup_campaign: null,
  weekly_visibility_monitor: null,
  local_directory_check: null,
  business_truth_setup: null,
  icp_list_to_crm: null,
  competitor_content_brief: null,
});

const RECRUITER_CAPABILITIES = Object.freeze(["leadership", "contacts", "social"]);

/**
 * Derive the ACTIVATION CONDITIONS (pqlModel.ACTIVATION_CONDITIONS) from raw
 * events. Pure; no clock, no storage.
 *
 * Kept separate from pqlModel.signalsFromEvents because the two answer
 * different questions at different granularity — see pqlModel's header — and
 * fusing them would make one of the two wrong.
 */
export function conditionsFromEvents(events = []) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === "object");
  const named = (n) => list.filter((e) => String(e.name || "") === n);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const out = {};
  const set = (k) => { if (k) out[k] = true; };

  for (const e of named("template_run_completed")) {
    set(TEMPLATE_CONDITION[e.properties?.templateKey]);
    if (e.properties?.branded === true) set("ran_branded_report");
  }
  for (const e of named("integration_connected")) {
    set("connected_export_dest");
    if (["hubspot", "airtable", "sheets", "google-sheets"].includes(String(e.properties?.provider || "").toLowerCase())) {
      set("sent_to_crm_sheet");
    }
  }
  for (const e of named("integration_push")) {
    set("exported_or_routed");
    set("exported_or_routed_shortlist");
    if (["hubspot", "airtable", "sheets", "google-sheets"].includes(String(e.properties?.provider || "").toLowerCase())) {
      set("sent_to_crm_sheet");
    }
  }
  for (const e of named("extraction_exported")) {
    set("exported_or_routed");
    set("exported_or_routed_shortlist");
    if (["md", "markdown", "pdf"].includes(String(e.properties?.format || "").toLowerCase())) set("exported_content_brief");
  }
  if (named("extraction_saved").length || named("monitor_created").length) set("saved_or_monitored");
  if (named("monitor_created").length || named("watchlist_created").length) set("monitored_pages");
  if (named("report_published").length || named("report_shared").length) {
    set("shared_or_saved_brief");
    set("shared_or_received_digest");
  }
  if (named("digest_received").length) set("shared_or_received_digest");

  // Count-based conditions. These are the ones most likely to be silently
  // wrong, because a missing property reads as 0 rather than as an error —
  // which is why ACTIVATION_EVENTS declares `requires` for each of them.
  if (named("watchlist_created").some((e) => num(e.properties?.competitorCount) >= 3)) set("added_3_competitors");
  if (named("bulk_enrichment_completed").some((e) => num(e.properties?.count) >= 10)) {
    set("imported_10_accounts");
    set("enriched_imported");
  }

  const recruiterRuns = named("enrichment_completed")
    .filter((e) => RECRUITER_CAPABILITIES.includes(String(e.properties?.capability || "").toLowerCase()));
  if (recruiterRuns.length) set("sourced_hiring_signals");
  const sourcedDomains = new Set(
    recruiterRuns.map((e) => String(e.properties?.domain || "").toLowerCase()).filter(Boolean),
  );
  if (sourcedDomains.size >= 3) set("sourced_across_3_companies");

  return out;
}
