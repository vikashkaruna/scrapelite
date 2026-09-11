// gapTaxonomy.js — WHY a finding exists, and WHICH capability answers it.
//
// PURE. Imported by React and by netlify/ alike.
//
// ── TWO REGISTRIES, TWO DIFFERENT QUESTIONS ───────────────────────────────
// `ROOT_CAUSES` answers "what kind of problem is this really" — the diagnosis.
// `MODULES` answers "which part of DatIQ addresses it" — the referral.
//
// They are separate because the mapping between them is many-to-many and moves
// independently: a new module does not change what caused a defect, and a
// re-classified defect does not change what the product can do about it.
//
// ── WHY A TAXONOMY AT ALL, WHEN EVERY ISSUE ALREADY HAS A CODE ────────────
// 46 codes is more than anyone reads. A queue of forty individually-true
// findings is not a diagnosis, it is a list — and the reader's actual question
// is "what is WRONG with this page", which no single code answers.
//
// Grouping by pillar does not answer it either, because a pillar is a scoring
// construct: "entity authority is 42" says where points were lost, not what to
// go and do. Root cause is the axis a person can act on — eleven findings that
// all reduce to `entity_ambiguity` are ONE afternoon's work, and seeing that is
// the difference between a report that gets worked and one that gets filed.

/**
 * The eight causes.
 *
 * Fixed at eight deliberately. A taxonomy that grows whenever something does
 * not quite fit stops being a taxonomy — it becomes a second copy of the issue
 * list with worse names. When a new finding does not fit cleanly, the right
 * move is almost always to pick the closest cause and say so in the issue's own
 * `why`, not to add a ninth bucket.
 *
 * ⚠️ TWO OF THE EIGHT ARE UNUSED IN P1, AND THAT IS CORRECT.
 * `location_radius_mismatch` and `conversion_friction` belong to P2's local and
 * service modules, which do not exist yet. They are declared now because the
 * taxonomy is a stored contract — the same reasoning migration 0049 applies to
 * the audit types the engine cannot yet produce — and because a taxonomy that
 * arrives in two halves invites the second half to be numbered around the
 * first. `rootCausesInUse()` is what the UI should render, so no customer is
 * shown an empty bucket.
 */
export const ROOT_CAUSES = Object.freeze({
  technical_access: {
    id: "technical_access", label: "Technical access",
    // First in the list because it is first in causality. Nothing downstream
    // matters on a page a crawler cannot reach, and a report that opens with
    // heading advice on an unreachable page has buried its own finding.
    order: 1,
    description: "A crawler or answer engine cannot reach, render or index the page.",
    question: "Can the page be fetched and read at all?",
    modules: ["technical_remediation"],
  },
  weak_page_structure: {
    id: "weak_page_structure", label: "Weak page structure",
    order: 2,
    description: "The content is present but not shaped so a machine can lift a specific part of it.",
    question: "Can a machine find the answer inside the page?",
    modules: ["recommendation_studio", "schema_intelligence"],
  },
  entity_ambiguity: {
    id: "entity_ambiguity", label: "Entity ambiguity",
    order: 3,
    description: "An engine cannot tell with confidence who publishes this or what it is about.",
    question: "Does the engine know who you are?",
    modules: ["entity_graph", "schema_intelligence", "business_truth_record"],
  },
  insufficient_proof: {
    id: "insufficient_proof", label: "Insufficient proof",
    order: 4,
    description: "Claims are made without the authorship, dating or attribution that makes them quotable.",
    question: "Why should an engine trust this page?",
    modules: ["trust_and_proof", "recommendation_studio"],
  },
  missing_content_coverage: {
    id: "missing_content_coverage", label: "Missing content coverage",
    order: 5,
    description: "The page does not address the question it is being asked, or a needed page does not exist.",
    question: "Is the answer actually here?",
    modules: ["recommendation_studio", "ai_visibility"],
  },
  location_radius_mismatch: {
    id: "location_radius_mismatch", label: "Location and radius mismatch",
    order: 6,
    description: "Location, service area or directory presence do not agree with where the business claims to operate.",
    question: "Does the engine know where you serve?",
    modules: ["local_directory", "service_radius"],
  },
  ux_friction: {
    id: "ux_friction", label: "UX friction",
    order: 7,
    description: "The page works, but slowly or awkwardly enough that it loses to alternatives.",
    question: "Is the page pleasant enough to keep?",
    modules: ["technical_remediation"],
  },
  conversion_friction: {
    id: "conversion_friction", label: "Conversion friction",
    order: 8,
    description: "Discovery succeeds and the page fails to turn attention into an enquiry or a sale.",
    question: "Does found traffic go anywhere?",
    modules: ["service_findability", "product_discoverability"],
  },
});

export const ROOT_CAUSE_IDS = Object.freeze(
  Object.keys(ROOT_CAUSES).sort((a, b) => ROOT_CAUSES[a].order - ROOT_CAUSES[b].order),
);

/**
 * The DatIQ capabilities a finding can be referred to.
 *
 * ── ⚠️ THE KEY IS THE SLUG, NOT THE M-NUMBER ──────────────────────────────
 * The BRD refers to these as "M1–M13" and does NOT enumerate which module is
 * which anywhere this repository can see. Numbering them from a guess and then
 * storing those numbers would break the rule that matters most here — codes are
 * a public contract; never repurpose or renumber one — the first time the real
 * list disagreed.
 *
 * So the stable identifier is the SLUG, which is derived from the PRD's own
 * §7/§9 section names and cannot be wrong about itself. `mCode` is a nullable
 * DISPLAY ALIAS, to be filled in once the PRD's numbering is confirmed, and
 * nothing keys off it. Filling in thirteen labels later is a one-line change;
 * renumbering a column that has shipped is not.
 *
 * `phase` says when the module can actually accept a referral. A finding
 * referred to a P2 module today is still correctly diagnosed — the UI shows it
 * as "not yet available" rather than pretending the referral is actionable.
 */
export const MODULES = Object.freeze({
  technical_remediation: {
    id: "technical_remediation", label: "Technical remediation",
    mCode: null, phase: "P1", available: true,
    description: "Crawl access, rendering, canonicals and performance.",
  },
  recommendation_studio: {
    id: "recommendation_studio", label: "Recommendation Studio",
    mCode: null, phase: "P1", available: true,
    description: "Answer blocks, heading plans, FAQ content and metadata.",
  },
  schema_intelligence: {
    id: "schema_intelligence", label: "Schema intelligence",
    mCode: null, phase: "P1", available: true,
    description: "Structured-data generation and validation.",
  },
  ai_visibility: {
    id: "ai_visibility", label: "AI Visibility Intelligence",
    mCode: null, phase: "P1", available: false,
    description: "Prompt monitoring, citation classification and share of voice.",
  },
  validation_lab: {
    id: "validation_lab", label: "Validation Lab",
    mCode: null, phase: "P1", available: true,
    description: "Baselines, re-audits and score-movement attribution.",
  },
  business_truth_record: {
    id: "business_truth_record", label: "Canonical Business Truth Record",
    mCode: null, phase: "P2", available: false,
    description: "One approved source of truth for business facts.",
  },
  entity_graph: {
    id: "entity_graph", label: "Entity Graph Builder",
    mCode: null, phase: "P2", available: false,
    description: "Entities, relationships and the evidence behind each.",
  },
  brand_discoverability: {
    id: "brand_discoverability", label: "Brand discoverability",
    mCode: null, phase: "P2", available: false,
    description: "Brand-level scoring, share of voice and recommendation rate.",
  },
  product_discoverability: {
    id: "product_discoverability", label: "Product discoverability",
    mCode: null, phase: "P2", available: false,
    description: "Product entity cards, missing facts and comparison blueprints.",
  },
  service_findability: {
    id: "service_findability", label: "Service findability",
    mCode: null, phase: "P2", available: false,
    description: "Service intent coverage and the page backlog behind it.",
  },
  local_directory: {
    id: "local_directory", label: "Local and directory intelligence",
    mCode: null, phase: "P2", available: false,
    description: "NAP consistency, directory listings and correction packs.",
  },
  trust_and_proof: {
    id: "trust_and_proof", label: "Trust and proof",
    mCode: null, phase: "P2", available: false,
    description: "Authorship, citations, reviews and the evidence that backs a claim.",
  },
  service_radius: {
    id: "service_radius", label: "Service radius",
    mCode: null, phase: "P2", available: false,
    description: "Coverage bands and the queries a service area should answer.",
  },
});

export const MODULE_IDS = Object.freeze(Object.keys(MODULES));

/** The cause registry entry, or null for an unknown id. */
export function rootCause(id) {
  return ROOT_CAUSES[id] || null;
}

/** The module registry entry, or null. */
export function moduleFor(id) {
  return MODULES[id] || null;
}

/**
 * Group findings by what actually caused them.
 *
 * Returns causes in taxonomy order — technical access first, because nothing
 * downstream matters on a page a crawler cannot reach — carrying only the
 * causes that this audit actually produced. An empty bucket rendered beside
 * full ones reads as "we checked and found nothing", which is a claim this
 * function has no business making on behalf of a check that may not have run.
 *
 * `severityRank` orders within a cause so the worst finding in a group leads.
 */
export function groupByRootCause(issues = [], { severityRank = () => 0 } = {}) {
  const buckets = new Map();
  for (const issue of issues) {
    const id = issue?.rootCause;
    if (!ROOT_CAUSES[id]) continue;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(issue);
  }
  return ROOT_CAUSE_IDS
    .filter((id) => buckets.has(id))
    .map((id) => ({
      ...ROOT_CAUSES[id],
      issues: [...buckets.get(id)].sort((a, b) => severityRank(a) - severityRank(b)),
      count: buckets.get(id).length,
    }));
}

/** The causes some issue in this set actually carries. */
export function rootCausesInUse(issues = []) {
  const seen = new Set(issues.map((i) => i?.rootCause).filter((id) => ROOT_CAUSES[id]));
  return ROOT_CAUSE_IDS.filter((id) => seen.has(id));
}

/**
 * The one cause to lead the report with.
 *
 * Taxonomy order, NOT count. The commonest cause on a broken page is usually
 * `weak_page_structure` simply because there are more structural codes to
 * trip; leading with it on a page that a crawler cannot fetch would tell the
 * reader to go and restructure headings nobody will ever see.
 */
export function primaryRootCause(issues = []) {
  const inUse = rootCausesInUse(issues);
  return inUse.length ? ROOT_CAUSES[inUse[0]] : null;
}
