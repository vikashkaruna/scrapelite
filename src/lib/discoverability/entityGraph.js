// entityGraph.js — the Entity Graph Builder. P2 · W10.
//
// PURE. Zero I/O. Imported by React AND `netlify/`.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// W9 gave the module one approved set of FACTS about a business. A fact is a
// value; it says nothing about how things relate. "Acme sells Acme Cloud",
// "Acme Cloud is a product, not the company", "the Bengaluru office and the
// Delhi office are the same organisation" — those are edges, and they are what
// a knowledge graph resolves an entity by. An engine that cannot tell which
// Acme a page is about merges it into the wrong node, which is the failure
// `ENTITY_SCHEMA_INVALID` (EA-11) already fires on at the page level.
//
// ── D7 — THE DECISION THIS PROCEEDS ON, STATED PLAINLY ─────────────────────
// D7 (how business-level audits relate to page-level ones) is still open. This
// workstream does NOT pre-empt it. Graph conflicts get their own table, exactly
// as W9's truth conflicts did, rather than retrofitting `subject_type` +
// `subject_id` onto `audit_issues` — that retrofit touches every reader of the
// P1 queue, the diff engine and all four exports, so doing it as a side effect
// of building the graph would ship the two one bug apart. When D7 lands, these
// findings migrate into whatever it decides; nothing here blocks that.
//
// ── THE TAXONOMY ───────────────────────────────────────────────────────────
// §9.2 publishes fifteen semantic entity types and nine relationships. The
// original W10 registry pre-dates that source list, so `prdType` and
// `prdPredicate` make the mapping explicit. Existing stored ids remain stable;
// four missing entity concepts and four missing relationships are additive.
// `offer`, `event`, `topic`, `owns`, `part_of`, `same_as`, and `about` remain
// useful implementation extensions and deliberately have no §9.2 mapping.
//
// ── THE RULE THAT KEEPS A GRAPH HONEST ─────────────────────────────────────
// 🔴 EVERY RELATION CARRIES EVIDENCE AND A CONFIDENCE, OR IT IS NOT A RELATION.
// A graph is only worth reasoning over if each edge can be traced back to the
// bytes that justified it. `makeRelation` refuses an observed edge with no
// evidence for the same reason `makeFact` does, and an edge nobody can drill
// into is indistinguishable from one somebody made up.

import { isEvidence, evidenceConfidence } from "./evidenceModel.js";

// ── Entity types ───────────────────────────────────────────────────────────
//
// `schemaType` is the schema.org class this maps to, so the graph and the
// structured data the module already validates speak the same language.
// `identifying` marks the types that can anchor a graph on their own — an
// Organization is somebody; a Topic is not.
export const ENTITY_TYPES = Object.freeze({
  organization: {
    id: "organization", label: "Organization", schemaType: "Organization",
    prdType: "Organization/brand", identifying: true,
    describes: "A company or legal entity. The usual root of a business graph.",
  },
  brand: {
    id: "brand", label: "Brand", schemaType: "Brand", identifying: true,
    prdType: "Sub-brand",
    describes: "A name customers use, which is frequently not the legal name.",
  },
  product: {
    id: "product", label: "Product", schemaType: "Product", identifying: true,
    prdType: "Product",
    describes: "Something sold as a thing.",
  },
  service: {
    id: "service", label: "Service", schemaType: "Service", identifying: true,
    prdType: "Service",
    describes: "Something sold as work performed.",
  },
  location: {
    id: "location", label: "Location", schemaType: "Place", identifying: true,
    prdType: "Location",
    describes: "A physical place the business operates from or serves.",
  },
  person: {
    id: "person", label: "Person", schemaType: "Person", identifying: true,
    prdType: "Person/expert/founder",
    describes: "A named human — founder, author, executive.",
  },
  offer: {
    id: "offer", label: "Offer", schemaType: "Offer", identifying: false,
    prdType: null,
    describes: "A priced commitment attached to a product or service.",
  },
  review: {
    id: "review", label: "Review", schemaType: "Review", identifying: false,
    prdType: "Review profile",
    describes: "A published assessment. Evidence of trust, not a claim of it.",
  },
  credential: {
    id: "credential", label: "Credential", schemaType: "EducationalOccupationalCredential",
    prdType: "Certification", identifying: false,
    describes: "A certification, accreditation or award held by an entity.",
  },
  event: {
    id: "event", label: "Event", schemaType: "Event", identifying: false,
    prdType: null,
    describes: "Something scheduled — a conference, a webinar, an opening.",
  },
  content_asset: {
    id: "content_asset", label: "Content", schemaType: "CreativeWork", identifying: false,
    prdType: "Media/publication mention",
    describes: "A page, article or asset that mentions or explains other entities.",
  },
  topic: {
    id: "topic", label: "Topic", schemaType: "Thing", identifying: false,
    prdType: null,
    describes: "Subject matter. What content is about, and what a brand wants to be known for.",
  },
  industry: {
    id: "industry", label: "Industry", schemaType: "Thing", identifying: false,
    prdType: "Industry/vertical",
    describes: "A market category, in the vocabulary directories and engines use.",
  },
  audience: {
    id: "audience", label: "Audience", schemaType: "Audience", identifying: false,
    prdType: "Customer segment/persona",
    describes: "Who the business serves. The other half of every service-intent query.",
  },
  partner: {
    id: "partner", label: "Partner", schemaType: "Organization",
    prdType: "Partner", identifying: true,
    describes: "An organization with a declared commercial or delivery relationship.",
  },
  customer_case_study: {
    id: "customer_case_study", label: "Customer / case study", schemaType: "CreativeWork",
    prdType: "Customer/case study", identifying: false,
    describes: "A customer relationship or published case study that substantiates an outcome.",
  },
  directory_listing: {
    id: "directory_listing", label: "Directory listing", schemaType: "WebPage",
    prdType: "Directory listing", identifying: false,
    describes: "A directory record on which the business or one of its offerings is listed.",
  },
  competitor: {
    id: "competitor", label: "Competitor", schemaType: "Organization",
    prdType: "Competitor", identifying: true,
    describes: "A named organization competing for the same demand.",
  },
});

export const ENTITY_TYPE_IDS = Object.freeze(Object.keys(ENTITY_TYPES));
export const IDENTIFYING_TYPES = Object.freeze(
  ENTITY_TYPE_IDS.filter((id) => ENTITY_TYPES[id].identifying),
);

// ── Predicates ─────────────────────────────────────────────────────────────
//
// ⚠️ EVERY PREDICATE DECLARES ITS DOMAIN AND RANGE, and `validateRelation`
// enforces them. Without that a graph is a bag of edges: "this review employs
// that topic" is storable, meaningless, and impossible to notice later.
//
// `functional` marks predicates where one subject may have at most one
// APPROVED object. Two approved headquarters is not richer data, it is a
// contradiction — and `detectGraphConflicts` reports it as one.
export const PREDICATES = Object.freeze({
  owns: {
    id: "owns", label: "owns", inverse: "owned_by", functional: false,
    prdPredicate: null,
    domain: ["organization"], range: ["brand", "product", "service", "location"],
    describes: "The organization owns this. Ownership, not merely sale.",
  },
  offers: {
    id: "offers", label: "offers", inverse: "offered_by", functional: false,
    prdPredicate: "offers",
    domain: ["organization", "brand"], range: ["product", "service", "offer"],
    describes: "Available to buy from this entity.",
  },
  located_at: {
    id: "located_at", label: "located at", inverse: "location_of", functional: true,
    prdPredicate: "operatesAt",
    domain: ["organization", "person", "event"], range: ["location"],
    describes: "The primary place. Functional: a second approved one is a contradiction, not extra detail.",
  },
  employs: {
    id: "employs", label: "employs", inverse: "works_for", functional: false,
    prdPredicate: "employs",
    domain: ["organization"], range: ["person"],
    describes: "A named person publicly associated with the organization.",
  },
  part_of: {
    id: "part_of", label: "part of", inverse: "has_part", functional: true,
    prdPredicate: null,
    domain: ENTITY_TYPE_IDS, range: ENTITY_TYPE_IDS,
    describes: "Hierarchy — a division of a group, a module of a product. Cycles are refused.",
  },
  same_as: {
    id: "same_as", label: "same as", inverse: "same_as", functional: false,
    prdPredicate: null,
    domain: ENTITY_TYPE_IDS, range: ENTITY_TYPE_IDS,
    describes: "Two records are one entity. This is schema.org sameAs, and it is how scattered mentions resolve to one node.",
  },
  about: {
    id: "about", label: "about", inverse: "subject_of", functional: false,
    prdPredicate: null,
    domain: ["content_asset", "event"], range: ["topic", "product", "service", "organization", "brand", "industry"],
    describes: "What this content is actually about, as opposed to what it merely mentions.",
  },
  serves: {
    id: "serves", label: "serves", inverse: "served_by", functional: false,
    prdPredicate: "serves",
    domain: ["organization", "brand", "service", "product"],
    range: ["audience", "industry", "location"],
    describes: "Who and where. The other half of every service-intent query.",
  },
  competes_with: {
    id: "competes_with", label: "competes with", inverse: "competes_with", functional: false,
    prdPredicate: "competesWith",
    domain: ["organization", "brand", "product", "service"],
    range: ["organization", "brand", "product", "service"],
    describes: "A rival for the same demand. Symmetric, and never inferred from a single mention.",
  },
  provides: {
    id: "provides", label: "provides", inverse: "provided_by", functional: false,
    prdPredicate: "provides",
    domain: ["organization", "brand", "partner", "competitor"], range: ["service"],
    describes: "The subject performs or delivers this service.",
  },
  founded_by: {
    id: "founded_by", label: "founded by", inverse: "founded", functional: false,
    prdPredicate: "foundedBy",
    domain: ["organization", "brand", "partner", "competitor"], range: ["person"],
    describes: "The named person founded this organization or brand.",
  },
  validated_by: {
    id: "validated_by", label: "validated by", inverse: "validates", functional: false,
    prdPredicate: "validatedBy",
    domain: ["organization", "brand", "product", "service"],
    range: ["partner", "credential", "customer_case_study", "review"],
    describes: "An external relationship or record substantiates this entity's claim.",
  },
  listed_on: {
    id: "listed_on", label: "listed on", inverse: "lists", functional: false,
    prdPredicate: "listedOn",
    domain: ["organization", "brand", "product", "service", "location"],
    range: ["directory_listing", "review"],
    describes: "This entity has a discoverable directory or review-platform record.",
  },
});

export const PREDICATE_IDS = Object.freeze(Object.keys(PREDICATES));

/** Predicates that mean the same thing read backwards. */
export const SYMMETRIC_PREDICATES = Object.freeze(
  PREDICATE_IDS.filter((id) => PREDICATES[id].inverse === id),
);

// ── How an entity or a relation came to exist ──────────────────────────────
//
// Mirrors W9's FACT_SOURCES, and for the same reason: authority is not
// confidence, and a declaration outranks a page reading while a page reading is
// the only one anybody can check.
export const RELATION_SOURCES = Object.freeze({
  declared: {
    id: "declared", authority: 1.00, verifiable: false,
    label: "Declared by the business",
    warranty: "The business asserted this relationship. Authoritative; unverifiable by us.",
  },
  observed: {
    id: "observed", authority: 0.70, verifiable: true,
    label: "Observed in markup or content",
    warranty: "Read from the business's own pages. Checkable by anyone; frequently stale.",
  },
  inferred: {
    id: "inferred", authority: 0.30, verifiable: false,
    label: "Inferred",
    warranty: "A model's reading. Never approved without a human looking.",
  },
});

export const RELATION_SOURCE_IDS = Object.freeze(Object.keys(RELATION_SOURCES));

// ── Review states ──────────────────────────────────────────────────────────
//
// 🔴 `proposed` IS THE ONLY STATE ANYTHING IS EVER CREATED IN, whatever
// proposed it. An edge a crawler read and nobody looked at is a suggestion, and
// treating it as knowledge is how a graph fills with confident nonsense.
export const REVIEW_STATES = Object.freeze({
  proposed: {
    id: "proposed", label: "Proposed", approved: false, terminal: false,
    describes: "Read, or asserted, and not yet reviewed.",
    next: ["approved", "rejected"],
  },
  approved: {
    id: "approved", label: "Approved", approved: true, terminal: false,
    describes: "A person accepted it. Only approved edges are reasoned over.",
    next: ["rejected"],
  },
  rejected: {
    id: "rejected", label: "Rejected", approved: false, terminal: true,
    describes: "Declined, with a reason. Kept — a rejected edge that keeps being re-proposed is itself a finding.",
    next: [],
  },
});

export const REVIEW_STATE_IDS = Object.freeze(Object.keys(REVIEW_STATES));

export function canReview(from, to) {
  const s = REVIEW_STATES[from];
  return Boolean(s && REVIEW_STATES[to] && s.next.includes(to));
}

// ── Conflict codes — A PUBLIC CONTRACT ─────────────────────────────────────
export const GRAPH_CONFLICT_CODES = Object.freeze({
  "EG-01": { code: "EG-01", label: "Two approved values for a one-value relationship", severity: "high" },
  "EG-02": { code: "EG-02", label: "Hierarchy contains a cycle", severity: "high" },
  "EG-03": { code: "EG-03", label: "sameAs links two entities of different types", severity: "high" },
  "EG-04": { code: "EG-04", label: "Relationship endpoints do not fit the predicate", severity: "medium" },
  "EG-05": { code: "EG-05", label: "Entity has no approved relationship to anything", severity: "medium" },
  "EG-06": { code: "EG-06", label: "Approved relationship rests on inference alone", severity: "medium" },
});

// ── Entities ───────────────────────────────────────────────────────────────

function toIso(when) {
  if (when === undefined || when === null || when === "") return null;
  const d = when instanceof Date ? when : new Date(when);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const text = (v, max = 500) => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Build one entity.
 *
 * ⚠️ `canonicalDomain` IS THE BRIDGE to `public.canonical_entities`, which is
 * UNIQUE on that column. Same normalisation as W9's truth record — bare host,
 * lower-case, no `www.` — or a company gets resolved twice and the two halves
 * disagree.
 */
export function makeEntity({
  type, name, canonicalDomain = null, externalIds = null,
  source, evidence = null, statedAt, description = null,
} = {}) {
  const meta = ENTITY_TYPES[type];
  if (!meta) return null;
  const src = RELATION_SOURCES[source];
  if (!src) return null;

  const label = text(name, 300);
  if (!label) return null;                       // an unnamed node resolves nothing

  const at = toIso(statedAt);
  if (!at) return null;

  const ev = isEvidence(evidence) ? evidence : null;
  if (src.verifiable && !ev) return null;        // same rule as makeFact

  return Object.freeze({
    type,
    name: label,
    description: text(description, 1000),
    canonical_domain: normaliseDomain(canonicalDomain),
    external_ids: normaliseIds(externalIds),
    source,
    authority: src.authority,
    evidence: ev,
    confidence: ev ? evidenceConfidence(ev) : src.authority,
    stated_at: at,
  });
}

function normaliseDomain(v) {
  const t = text(v, 300);
  if (!t) return null;
  let host = t.toLowerCase().trim();
  try {
    host = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`).hostname;
  } catch { /* fall through to the regex below */ }
  host = host.replace(/^www\./, "").replace(/\/+$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

function normaliseIds(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const [k, raw] of Object.entries(v)) {
    const key = text(k, 60); const val = text(raw, 200) ?? (typeof raw === "number" ? String(raw) : null);
    if (key && val) out[key.toLowerCase()] = val;
  }
  return Object.keys(out).length ? out : null;
}

export function isEntity(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v)
    && typeof v.type === "string" && ENTITY_TYPES[v.type]
    && typeof v.name === "string" && v.name
    && typeof v.source === "string" && RELATION_SOURCES[v.source]);
}

// ── Relations ──────────────────────────────────────────────────────────────

/**
 * Does this edge fit the predicate it claims?
 *
 * Returns every problem, not the first. `ok` is false when there is any.
 */
export function validateRelation({ subjectType, predicate, objectType } = {}) {
  const problems = [];
  const p = PREDICATES[predicate];
  if (!p) {
    return Object.freeze({ ok: false, problems: Object.freeze([{ code: "unknown_predicate", predicate }]) });
  }
  if (!ENTITY_TYPES[subjectType]) problems.push({ code: "unknown_subject_type", type: subjectType });
  else if (!p.domain.includes(subjectType)) {
    problems.push({
      code: "subject_out_of_domain", type: subjectType,
      message: `A ${ENTITY_TYPES[subjectType].label.toLowerCase()} cannot be the subject of "${p.label}".`,
    });
  }
  if (!ENTITY_TYPES[objectType]) problems.push({ code: "unknown_object_type", type: objectType });
  else if (!p.range.includes(objectType)) {
    problems.push({
      code: "object_out_of_range", type: objectType,
      message: `"${p.label}" cannot point at a ${ENTITY_TYPES[objectType].label.toLowerCase()}.`,
    });
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

/**
 * Build one relation.
 *
 * 🔴 REFUSES an edge whose endpoints do not fit the predicate, and refuses an
 * `observed` edge with no evidence. Both for the same reason: an edge nobody
 * can drill into, or that could not be true in principle, is indistinguishable
 * from one somebody made up — and a graph is only worth reasoning over if every
 * edge traces back to the bytes that justified it.
 *
 * ⚠️ `state` is ALWAYS `proposed`. Nothing creates an approved edge; approval
 * is a separate act by a person, and it is the whole point of the state.
 */
export function makeRelation({
  subjectId, subjectType, predicate, objectId, objectType,
  source, evidence = null, statedAt, note = null,
} = {}) {
  const p = PREDICATES[predicate];
  if (!p) return null;
  const src = RELATION_SOURCES[source];
  if (!src) return null;

  const sId = text(subjectId, 200);
  const oId = text(objectId, 200);
  if (!sId || !oId) return null;

  // 🔴 A self-edge is never information. "Acme is part of Acme" and "Acme is
  // the same as Acme" are both vacuously true and both pollute every traversal.
  if (sId === oId) return null;

  const shape = validateRelation({ subjectType, predicate, objectType });
  if (!shape.ok) return null;

  const at = toIso(statedAt);
  if (!at) return null;

  const ev = isEvidence(evidence) ? evidence : null;
  if (src.verifiable && !ev) return null;

  return Object.freeze({
    subject_id: sId,
    subject_type: subjectType,
    predicate,
    object_id: oId,
    object_type: objectType,
    state: "proposed",
    source,
    authority: src.authority,
    evidence: ev,
    confidence: ev ? evidenceConfidence(ev) : src.authority,
    stated_at: at,
    note: text(note, 500),
  });
}

export function isRelation(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v)
    && typeof v.predicate === "string" && PREDICATES[v.predicate]
    && typeof v.subject_id === "string" && v.subject_id
    && typeof v.object_id === "string" && v.object_id
    && typeof v.source === "string" && RELATION_SOURCES[v.source]);
}

/** Only approved edges are reasoned over. Everything else is a suggestion. */
export const isApproved = (r) => Boolean(r && REVIEW_STATES[r.state]?.approved);

// ── The approval gate ──────────────────────────────────────────────────────

/**
 * May this relation be approved?
 *
 * Every blocker at once, for the same reason `canPromote` does it: a reviewer
 * told one problem, who fixes it and is then told a second, learns to distrust
 * the gate.
 *
 * 🔴 SELF-APPROVAL IS A BLOCKER, as it is for a truth version. An edge one
 * person both proposed and approved has had exactly as much review as one
 * nobody looked at.
 */
export function canApproveRelation(relation = {}, { proposedBy = null, reviewerId = null } = {}) {
  const blockers = [];

  if (!isRelation(relation)) {
    blockers.push({ code: "not_a_relation", message: "This is not a relationship record." });
    return Object.freeze({ ok: false, blockers: Object.freeze(blockers) });
  }

  if (!REVIEW_STATES[relation.state]) {
    blockers.push({ code: "unknown_state", message: `Unknown review state "${relation.state}".` });
  } else if (relation.state === "rejected") {
    blockers.push({ code: "rejected", message: "This relationship was rejected. Propose it again rather than reviving the rejection." });
  }

  const shape = validateRelation({
    subjectType: relation.subject_type, predicate: relation.predicate, objectType: relation.object_type,
  });
  if (!shape.ok) {
    blockers.push({ code: "invalid_shape", problems: shape.problems, message: shape.problems[0]?.message || "The endpoints do not fit this relationship." });
  }

  if (!reviewerId) {
    blockers.push({ code: "no_approver", message: "No approver recorded." });
  } else if (proposedBy && proposedBy === reviewerId) {
    blockers.push({ code: "self_approval", message: "You proposed this relationship. Approval means a second person looked." });
  }

  if (RELATION_SOURCES[relation.source]?.verifiable && !relation.evidence) {
    blockers.push({ code: "no_evidence", message: "An observed relationship must carry the evidence it was read from." });
  }

  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze(blockers) });
}

// ── Traversal helpers ──────────────────────────────────────────────────────

/**
 * Approved edges only, indexed both ways.
 *
 * ⚠️ A SYMMETRIC PREDICATE IS INDEXED IN BOTH DIRECTIONS but stored once —
 * writing `competes_with` twice would double every count and make "who do we
 * compete with" answer differently depending on which row was read first.
 */
export function buildIndex(relations = []) {
  const out = { bySubject: new Map(), byObject: new Map(), byPredicate: new Map() };
  for (const r of (Array.isArray(relations) ? relations : [])) {
    if (!isRelation(r) || !isApproved(r)) continue;
    push(out.bySubject, r.subject_id, r);
    push(out.byObject, r.object_id, r);
    push(out.byPredicate, r.predicate, r);
    if (SYMMETRIC_PREDICATES.includes(r.predicate)) {
      push(out.bySubject, r.object_id, r);
      push(out.byObject, r.subject_id, r);
    }
  }
  return out;
}

function push(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** Everything `entityId` points at under `predicate`, approved only. */
export function objectsOf(index, entityId, predicate) {
  return (index?.bySubject?.get(entityId) || [])
    .filter((r) => r.predicate === predicate)
    .map((r) => (r.subject_id === entityId ? r.object_id : r.subject_id));
}

// ── Conflicts — what a graph can be wrong about ────────────────────────────

/**
 * Structural problems in the approved graph.
 *
 * ⚠️ EVERY CHECK HERE READS APPROVED EDGES ONLY. A proposal that contradicts
 * the graph is not a conflict, it is a proposal — reporting it as a conflict
 * would make the review queue argue with itself.
 *
 * ⚠️ AND AN UNCONNECTED ENTITY IS ONLY REPORTED WHEN IT COULD ANCHOR SOMETHING
 * (`identifying`). A Topic nothing points at yet is an ordinary state of
 * affairs; an Organization nothing points at is a node that resolves nobody.
 */
export function detectGraphConflicts(entities = [], relations = [], { proposedBy = {} } = {}) {
  const out = [];
  // ⚠️ AN ARRAY AND A MAP ARE READ DIFFERENTLY, AND THE BRANCH IS LOAD-BEARING.
  // `Object.entries` over an ARRAY yields "0", "1", "2" as keys — so reading
  // both ways registered every entity twice, once under its real id and once
  // under its array index, and EG-05 then fired on the index copies because
  // nothing connects to a node called "1". Caught by a route test; the unit
  // test that was supposed to cover this asserted only that EG-05 existed, not
  // that nothing spurious did.
  const byId = new Map();
  if (Array.isArray(entities)) {
    for (const e of entities) if (isEntity(e) && e.id) byId.set(e.id, e);
  } else {
    for (const [id, e] of Object.entries(entities || {})) if (isEntity(e)) byId.set(id, e);
  }

  const approved = (Array.isArray(relations) ? relations : []).filter((r) => isRelation(r) && isApproved(r));

  // EG-01 — two approved objects for a functional predicate.
  const functionalSeen = new Map();
  for (const r of approved) {
    if (!PREDICATES[r.predicate]?.functional) continue;
    const key = `${r.subject_id}::${r.predicate}`;
    const prior = functionalSeen.get(key);
    if (prior && prior.object_id !== r.object_id) {
      out.push(conflict("EG-01", {
        predicate: r.predicate, subject_id: r.subject_id,
        values: [prior.object_id, r.object_id],
        evidence: r.evidence,
        message: `"${PREDICATES[r.predicate].label}" holds one value, and two are approved. One of them is wrong.`,
      }));
    } else if (!prior) {
      functionalSeen.set(key, r);
    }
  }

  // EG-02 — a cycle in `part_of`. A hierarchy that loops makes every rollup
  // either infinite or silently truncated, and the truncation is the dangerous
  // one because it looks like an answer.
  const parents = new Map();
  for (const r of approved) if (r.predicate === "part_of") parents.set(r.subject_id, r.object_id);
  for (const start of parents.keys()) {
    const seen = new Set([start]);
    let node = parents.get(start);
    while (node && !seen.has(node)) { seen.add(node); node = parents.get(node); }
    if (node && seen.has(node)) {
      out.push(conflict("EG-02", {
        predicate: "part_of", subject_id: start, values: [...seen],
        message: "This hierarchy loops back on itself, so nothing can be rolled up through it.",
      }));
      break;                                     // one report, not one per member
    }
  }

  // EG-03 — sameAs across types. Two records of DIFFERENT kinds declared one
  // entity is not a merge, it is a category error, and following it corrupts
  // every traversal that trusted the type.
  for (const r of approved) {
    if (r.predicate !== "same_as") continue;
    if (r.subject_type && r.object_type && r.subject_type !== r.object_type) {
      out.push(conflict("EG-03", {
        predicate: "same_as", subject_id: r.subject_id, values: [r.object_id],
        evidence: r.evidence,
        message: `A ${ENTITY_TYPES[r.subject_type]?.label.toLowerCase() || r.subject_type} and a ${ENTITY_TYPES[r.object_type]?.label.toLowerCase() || r.object_type} are declared the same entity.`,
      }));
    }
  }

  // EG-04 — an approved edge whose endpoints do not fit. Should be unreachable
  // through makeRelation, which is exactly why it is checked: a row that got in
  // another way is the one nobody is looking for.
  for (const r of approved) {
    const shape = validateRelation({
      subjectType: r.subject_type, predicate: r.predicate, objectType: r.object_type,
    });
    if (!shape.ok) {
      out.push(conflict("EG-04", {
        predicate: r.predicate, subject_id: r.subject_id, values: [r.object_id],
        message: shape.problems[0]?.message || "These endpoints do not fit this relationship.",
      }));
    }
  }

  // EG-05 — an identifying entity with no approved edge at all.
  const connected = new Set();
  for (const r of approved) { connected.add(r.subject_id); connected.add(r.object_id); }
  for (const [id, e] of byId) {
    if (!ENTITY_TYPES[e.type]?.identifying) continue;
    if (connected.has(id)) continue;
    out.push(conflict("EG-05", {
      subject_id: id, predicate: null, values: [],
      message: `${e.name} is in the graph with nothing connecting it, so nothing can resolve it.`,
    }));
  }

  // EG-06 — an approved edge resting on inference alone.
  for (const r of approved) {
    if (r.source !== "inferred") continue;
    out.push(conflict("EG-06", {
      predicate: r.predicate, subject_id: r.subject_id, values: [r.object_id],
      message: `This relationship was approved on inference alone. Confirm it against something observable.`,
    }));
  }

  return Object.freeze(out);
}

function conflict(code, extra) {
  return Object.freeze({
    code,
    label: GRAPH_CONFLICT_CODES[code].label,
    severity: GRAPH_CONFLICT_CODES[code].severity,
    evidence: null,
    ...extra,
  });
}

// ── Coverage ───────────────────────────────────────────────────────────────

/**
 * How resolvable is this graph?
 *
 * ⚠️ `unknown` IS NEVER `0`, HERE TOO. A predicate no entity in this graph
 * could use — `employs` when there are no people, `about` when there is no
 * content — is EXCLUDED and reported, not counted as a gap. Counting it would
 * mark down a product catalogue for having no staff directory.
 */
export function graphCoverage(entities = [], relations = []) {
  const list = Array.isArray(entities) ? entities.filter(isEntity) : Object.values(entities || {}).filter(isEntity);
  const types = new Set(list.map((e) => e.type));
  const approved = (Array.isArray(relations) ? relations : []).filter((r) => isRelation(r) && isApproved(r));

  const applicable = PREDICATE_IDS.filter((p) =>
    PREDICATES[p].domain.some((t) => types.has(t)) && PREDICATES[p].range.some((t) => types.has(t)));
  const used = applicable.filter((p) => approved.some((r) => r.predicate === p));
  const notApplicable = PREDICATE_IDS.filter((p) => !applicable.includes(p));

  const proposed = (Array.isArray(relations) ? relations : [])
    .filter((r) => isRelation(r) && r.state === "proposed").length;

  return Object.freeze({
    entities: list.length,
    approvedRelations: approved.length,
    pendingReview: proposed,
    predicatesUsed: Object.freeze(used),
    predicatesApplicable: Object.freeze(applicable),
    predicatesExcluded: Object.freeze(notApplicable),
    percent: applicable.length ? Math.round((used.length / applicable.length) * 1000) / 10 : null,
  });
}
