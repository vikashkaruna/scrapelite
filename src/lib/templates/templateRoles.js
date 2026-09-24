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
});

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
