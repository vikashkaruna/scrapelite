// templateRoles.js — which roles each template serves.
//
// A template often serves several roles (an Account Brief is as much RevOps as
// Sales), so roles live HERE rather than in the stored `workflow_templates.
// persona` column, which holds one value and can only change through a
// republish: ensureSeeded() never updates an existing key, so retagging the
// catalogue in the database would mean a new version of every template.
//
// A template missing from this map falls back to its stored `persona`
// (resolved through the legacy aliases), so a new seed still files somewhere.

import { resolvePersonaId } from "../personaConfig.js";

export const TEMPLATE_ROLES = Object.freeze({
  account_brief: ["sales", "revops"],
  competitor_pricing_tracker: ["competitive-intel", "pmm"],
  discoverability_audit: ["seo", "brand-growth", "agency"],
  due_diligence_brief: ["founder-vc"],
  customer_proof_extractor: ["pmm", "competitive-intel", "sales"],
  ai_visibility_brief: ["pmm", "seo", "brand-growth", "competitive-intel"],
  bulk_icp_enrichment: ["revops", "sales"],
  recruiter_talent_sourcing: ["recruiter"],
  market_landscape_map: ["founder-vc", "competitive-intel"],
  agency_client_teardown: ["agency"],
  continuous_account_signal: ["revops", "sales"],
  // Template hub (2026-09-24)
  competitor_change_monitor: ["competitive-intel", "pmm", "founder-vc"],
  price_change_slack_alert: ["competitive-intel", "pmm", "revops"],
  account_research_outreach: ["sales", "revops"],
  event_followup_campaign: ["sales", "brand-growth"],
  weekly_visibility_monitor: ["seo", "brand-growth", "agency"],
  local_directory_check: ["agency", "seo", "brand-growth"],
  business_truth_setup: ["brand-growth", "seo", "agency"],
  icp_list_to_crm: ["revops", "sales"],
  competitor_content_brief: ["seo", "pmm"],
});

/**
 * The module each template belongs to, for the hub's Module filter. A key of
 * ROLE_MODULES (roleModules.js); code, not a stored column, for the same
 * reason as the roles above.
 */
export const TEMPLATE_MODULES = Object.freeze({
  account_brief: "enrich",
  competitor_pricing_tracker: "compete",
  discoverability_audit: "discover",
  due_diligence_brief: "enrich",
  customer_proof_extractor: "enrich",
  ai_visibility_brief: "discover",
  bulk_icp_enrichment: "workflows",
  recruiter_talent_sourcing: "enrich",
  market_landscape_map: "extract",
  agency_client_teardown: "discover",
  continuous_account_signal: "workflows",
  competitor_change_monitor: "compete",
  price_change_slack_alert: "workflows",
  account_research_outreach: "engage",
  event_followup_campaign: "engage",
  weekly_visibility_monitor: "discover",
  local_directory_check: "discover",
  business_truth_setup: "discover",
  icp_list_to_crm: "connect",
  competitor_content_brief: "extract",
});

export function moduleForTemplate(t) {
  return (t && TEMPLATE_MODULES[t.template_key]) || null;
}

/** Role ids for a template row: the map first, else its stored persona. */
export function rolesForTemplate(t) {
  if (!t) return [];
  const mapped = TEMPLATE_ROLES[t.template_key];
  if (mapped) return mapped;
  return t.persona ? [resolvePersonaId(t.persona)] : [];
}

/** The template's lead role, used for its card badge. */
export function primaryRole(t) {
  return rolesForTemplate(t)[0] || null;
}
