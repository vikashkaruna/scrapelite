// recipeCatalog.js — PURE. The integration recipe gallery.
//
// PRD §Now: "Integration recipe gallery — make existing Zapier/HubSpot/Slack/
// Notion/Airtable integrations usable. Converts integrations from checkbox to
// outcome."
//
// The problem this solves is positioning, not plumbing. All five destinations
// already work. What /integrations shows today is a list of LOGOS — which
// answers "do you support HubSpot?" and not "what do I get?". The PRD is blunt
// about why that matters:
//
//   "customers do not buy DatIQ because 'it has a Zapier integration'. They
//    buy it because a relevant event is detected and the next action occurs
//    automatically."
//
// So a recipe is stated as an OUTCOME with a named trigger and a named action,
// in the user's language, and is directly runnable. Every recipe below maps to
// something the product can do TODAY — a gallery advertising work that has not
// shipped is worse than no gallery, because the first click teaches the user
// the page is decorative.
//
// `readiness` is that promise, made explicit:
//   "live"     — runnable now, end to end.
//   "manual"   — the destination works, but the trigger is the user pressing a
//                button rather than an automatic rule. Honest about the seam.
//   "rules"    — needs the Phase 6 rules engine. Listed so the gallery shows
//                the shape of the product, but NEVER rendered as runnable.
//
// The conditions and actions are lifted from the PRD's own §5 table so the
// gallery and the rules engine cannot describe different products.

import { PERSONAS } from "../personaConfig.js";

export const RECIPE_READINESS = Object.freeze({
  LIVE: "live",
  MANUAL: "manual",
  RULES: "rules",
});

/** Destinations a recipe can target. Slugs match integrationsClient.PUSH_PROVIDERS. */
export const RECIPE_PROVIDERS = Object.freeze(["hubspot", "notion", "airtable", "zapier", "slack"]);

export const RECIPES = Object.freeze([
  {
    key: "account-brief-to-crm",
    title: "Turn a domain into a CRM-ready account brief",
    outcome: "Your SDR opens HubSpot and the company is already researched.",
    when: "You run the Sales-ready Account Brief template",
    then: "The company and its contacts are pushed to HubSpot with source URLs",
    provider: "hubspot",
    personas: ["sales"],
    readiness: RECIPE_READINESS.LIVE,
    template: "account_brief",
    cta: { label: "Run the Account Brief", to: "/templates?key=account_brief" },
  },
  {
    key: "pricing-change-to-slack",
    title: "Know within a day when a competitor changes pricing",
    outcome: "The team hears about a pricing move from you, not from a lost deal.",
    when: "A monitored competitor changes a pricing field",
    then: "A summary of what changed is posted to your Slack channel",
    provider: "slack",
    personas: ["competitive-intel"],
    // PRD §5, row 1. Needs the rules layer to fire on a FIELD change rather
    // than on a page diff — the PRD is explicit that alerting on every DOM
    // change trains users to ignore the feature within a week.
    readiness: RECIPE_READINESS.RULES,
    phase: "Signal routing",
  },
  {
    key: "audit-to-notion",
    title: "File every SEO audit as a Notion page the content team can action",
    outcome: "Findings land where the work is planned, not in someone's downloads folder.",
    when: "You run the SEO / GEO / AEO Audit template",
    then: "A Notion page is created with the scores and the prioritised fix queue",
    provider: "notion",
    personas: ["seo"],
    readiness: RECIPE_READINESS.LIVE,
    template: "discoverability_audit",
    cta: { label: "Run the audit", to: "/templates?key=discoverability_audit" },
  },
  {
    key: "leadership-to-airtable",
    title: "Build a sourcing table without copying names by hand",
    outcome: "A reviewable shortlist with a source URL against every name.",
    when: "You extract leadership or contact details from a company",
    then: "Rows are added to an Airtable base with confidence and source",
    provider: "airtable",
    personas: ["recruiter", "sales"],
    // The destination is live; the trigger is the user pressing Push. Saying
    // "live" would over-promise an automatic rule that does not exist yet.
    readiness: RECIPE_READINESS.MANUAL,
    cta: { label: "Extract a company", to: "/" },
  },
  {
    key: "diligence-to-notion",
    title: "Walk into a first meeting already briefed",
    outcome: "A source-backed company brief, filed before the call.",
    when: "You run the Pre-Meeting Due Diligence Brief",
    then: "The brief is written to Notion with its sources and timestamp",
    provider: "notion",
    personas: ["founder-vc", "market-research"],
    readiness: RECIPE_READINESS.LIVE,
    template: "due_diligence_brief",
    cta: { label: "Run the brief", to: "/templates?key=due_diligence_brief" },
  },
  {
    key: "icp-score-to-hubspot",
    title: "Route only the accounts worth a rep's time",
    outcome: "High-fit accounts get an owner; the rest never reach the queue.",
    when: "An enriched account scores 80 or above on your ICP rules",
    then: "A HubSpot company is created or updated and an owner is assigned",
    provider: "hubspot",
    personas: ["sales"],
    // PRD §5, row 2. Needs both bulk enrichment (Phase 4) and the rules layer.
    readiness: RECIPE_READINESS.RULES,
    phase: "Bulk enrichment + signal routing",
  },
  {
    key: "anything-to-zapier",
    title: "Send any result anywhere Zapier reaches",
    outcome: "The 6,000-app escape hatch, for the destination we do not have.",
    when: "You push any extraction or report",
    then: "The payload is delivered to your Zap and on to whatever it triggers",
    provider: "zapier",
    personas: PERSONAS.map((p) => p.id),
    // PRD: "Zapier is valuable for long-tail automation... Native recipes make
    // the product feel complete, while Zapier remains the extensibility layer."
    // It is listed LAST for that reason — it is the fallback, not the pitch.
    readiness: RECIPE_READINESS.MANUAL,
    cta: { label: "Extract a page", to: "/" },
  },
]);

/** Recipes for one persona, most-actionable first. `null`/unknown → all. */
export function recipesForPersona(personaId) {
  const list = personaId
    ? RECIPES.filter((r) => r.personas.includes(personaId))
    : RECIPES.slice();
  const rank = { [RECIPE_READINESS.LIVE]: 0, [RECIPE_READINESS.MANUAL]: 1, [RECIPE_READINESS.RULES]: 2 };
  // Runnable things first. A gallery that leads with what the user cannot do
  // yet reads as a roadmap, and a roadmap does not convert anybody.
  return list.sort((a, b) => rank[a.readiness] - rank[b.readiness]);
}

/** True when a recipe can actually be run right now. */
export function isRunnable(recipe) {
  return recipe?.readiness !== RECIPE_READINESS.RULES && Boolean(recipe?.cta);
}
