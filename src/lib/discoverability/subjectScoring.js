// subjectScoring.js — Brand, Product and Service discoverability. P2 · W11.
//
// PURE. Zero I/O. Imported by React AND `netlify/`.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// P1 scores a PAGE. W9 recorded what is true about the business, W10 recorded
// how its entities relate. W11 is the first thing that scores a SUBJECT: a
// brand, a product, a service — the things a buyer actually asks an engine
// about. "Is my pricing page well structured" and "does an engine recommend us
// when somebody asks who to buy from" are different questions, and only the
// second one is what the customer is paying to influence.
//
// ── THE WEIGHTS ARE THE PRD'S. THE COMPONENT NAMES ARE DERIVED. ────────────
// The implementation plan states all three formulas verbatim:
//
//   BDS = 0.25·EC + 0.20·SD + 0.25·ASOV + 0.20·TC + 0.10·RA
//   PDS = 0.25·CF + 0.20·EA + 0.20·CC  + 0.15·TP + 0.10·AR + 0.10·RA
//   SFS = 0.25·IC + 0.20·VC + 0.20·PE  + 0.15·GA + 0.10·TR + 0.10·CR
//
// ⚠️ **THE WEIGHTS ARE AUTHORITATIVE AND ARE NOT TOUCHED.** They are copied
// exactly, and `subjectScoring.test.js` asserts every one of them, so an
// "align the numbers" pass fails the build with the reasoning attached rather
// than silently re-calibrating three scores in the product — the same guard
// `scoringModel.test.js` puts on the penalty model after D1.
//
// ⚠️ **THE ABBREVIATIONS ARE EXPANDED NOWHERE VISIBLE IN THIS REPOSITORY**,
// exactly as with W4's "M1-M13" and W10's fourteen types. Each `id` below is
// therefore DERIVED, and derived under one hard constraint: **every component
// must bind to something this engine can already measure or has already
// built.** A component with no source would be a weight applied to a number
// nobody produces, which is how a score becomes decoration.
//
// 🔴 THE BINDING IS THE POINT. `source` on each component names where its value
// comes from. Three of them (`trust_credibility`, `trust_proof`, `trust_signals`)
// bind to W13, which is NOT BUILT — and that is handled by the rule this whole
// module rests on rather than by inventing a number.
//
// ── `unknown` IS NEVER `0`, AND HERE IT CARRIES REAL WEIGHT ────────────────
// TC is 20% of BDS and does not exist yet. Scoring it 0 would take every brand
// score down by up to twenty points for a module we have not shipped, and then
// show a phantom twenty-point "improvement" on the day W13 lands — making the
// trend line a fiction, which is the exact failure `weightedMean` was written
// to prevent. Unmeasured components are EXCLUDED and their weight redistributed
// across what was measured, and the returned `coverage` says how much of the
// formula actually ran.
//
// ⚠️ **THERE IS ONE `weightedMean`, IN `scoringModel.js`, AND THESE THREE
// SCORES ROUTE THROUGH IT.** A second implementation here would be a second
// redistribution rule to keep in step with the first.

import { weightedMean } from "./scoringModel.js";

// ── Where a component's value comes from ───────────────────────────────────
//
// `built` is the honest state of its source today. A component whose source is
// not built yet reads `null` and is redistributed — it is never defaulted.
export const COMPONENT_SOURCES = Object.freeze({
  truth_record:   { id: "truth_record",   built: true,  workstream: "W9",  label: "Canonical Business Truth Record" },
  entity_graph:   { id: "entity_graph",   built: true,  workstream: "W10", label: "Entity Graph Builder" },
  page_signals:   { id: "page_signals",   built: true,  workstream: "P1",  label: "Page-level audit signals" },
  ai_visibility:  { id: "ai_visibility",  built: true,  workstream: "W6",  label: "AI Visibility Intelligence" },
  trust_proof:    { id: "trust_proof",    built: false, workstream: "W13", label: "Trust & Proof Audit" },
  local_directory:{ id: "local_directory",built: false, workstream: "W12", label: "Local & Directory Intelligence" },
});

export const UNBUILT_SOURCES = Object.freeze(
  Object.values(COMPONENT_SOURCES).filter((s) => !s.built).map((s) => s.id),
);

// ── Brand Discoverability Score ────────────────────────────────────────────
export const BDS_COMPONENTS = Object.freeze({
  entity_clarity: {
    id: "entity_clarity", abbr: "EC", weight: 0.25, source: "truth_record",
    label: "Entity clarity",
    describes: "Whether the business has one approved, unambiguous identity — the facts that identify it, and a graph that resolves it.",
  },
  structured_data: {
    id: "structured_data", abbr: "SD", weight: 0.20, source: "page_signals",
    label: "Structured data",
    describes: "Whether the markup declares that identity in a vocabulary an engine reads.",
  },
  ai_share_of_voice: {
    id: "ai_share_of_voice", abbr: "ASOV", weight: 0.25, source: "ai_visibility",
    label: "AI share of voice",
    describes: "How often the brand appears at all when an engine answers questions in its category.",
  },
  trust_credibility: {
    id: "trust_credibility", abbr: "TC", weight: 0.20, source: "trust_proof",
    label: "Trust and credibility",
    describes: "Third-party evidence that the business is real and well regarded. Defined by §9.8 — W13.",
  },
  recommendation_rate: {
    id: "recommendation_rate", abbr: "RA", weight: 0.10, source: "ai_visibility",
    label: "Recommendation rate",
    describes: "Of the commercial questions sampled, how often the engine recommends this brand rather than merely naming it.",
  },
});

// ── Product Discoverability Score ──────────────────────────────────────────
export const PDS_COMPONENTS = Object.freeze({
  fact_completeness: {
    id: "fact_completeness", abbr: "CF", weight: 0.25, source: "truth_record",
    label: "Fact completeness",
    describes: "Whether the facts a buyer asks for — price, availability, what it does — are stated at all.",
  },
  entity_association: {
    id: "entity_association", abbr: "EA", weight: 0.20, source: "entity_graph",
    label: "Entity association",
    describes: "Whether the product is connected to the brand that sells it, so an engine can attribute it.",
  },
  comparison_coverage: {
    id: "comparison_coverage", abbr: "CC", weight: 0.20, source: "page_signals",
    label: "Comparison coverage",
    describes: "Whether the product is described against the alternatives a buyer is weighing it against.",
  },
  trust_proof: {
    id: "trust_proof", abbr: "TP", weight: 0.15, source: "trust_proof",
    label: "Trust proof",
    describes: "Reviews, ratings and named customers attached to this product. Defined by §9.8 — W13.",
  },
  answer_readiness: {
    id: "answer_readiness", abbr: "AR", weight: 0.10, source: "page_signals",
    label: "Answer readiness",
    describes: "Whether the page answers a question directly, in a passage an engine can lift.",
  },
  recommendation_rate: {
    id: "recommendation_rate", abbr: "RA", weight: 0.10, source: "ai_visibility",
    label: "Recommendation rate",
    describes: "How often an engine recommends this product for the job it does.",
  },
});

// ── Service Findability Score ──────────────────────────────────────────────
export const SFS_COMPONENTS = Object.freeze({
  intent_coverage: {
    id: "intent_coverage", abbr: "IC", weight: 0.25, source: "page_signals",
    label: "Intent coverage",
    describes: "How much of the question set a buyer actually asks is answered anywhere on the site.",
  },
  vertical_coverage: {
    id: "vertical_coverage", abbr: "VC", weight: 0.20, source: "entity_graph",
    label: "Vertical coverage",
    describes: "Whether the service says which industries and audiences it serves — the other half of every service query.",
  },
  process_explained: {
    id: "process_explained", abbr: "PE", weight: 0.20, source: "page_signals",
    label: "Process explained",
    describes: "Whether how the service actually works is described, rather than only what it is called.",
  },
  geographic_availability: {
    id: "geographic_availability", abbr: "GA", weight: 0.15, source: "local_directory",
    label: "Geographic availability",
    describes: "Where the service will genuinely be delivered. Defined by §9.6/§9.9 — W12.",
  },
  trust_signals: {
    id: "trust_signals", abbr: "TR", weight: 0.10, source: "trust_proof",
    label: "Trust signals",
    describes: "Credentials, accreditations and proof of past work. Defined by §9.8 — W13.",
  },
  conversion_readiness: {
    id: "conversion_readiness", abbr: "CR", weight: 0.10, source: "page_signals",
    label: "Conversion readiness",
    describes: "Whether a reader who is convinced can act — a way to enquire, priced or scoped clearly enough to start.",
  },
});

export const SUBJECT_SCORES = Object.freeze({
  brand:   { id: "brand",   code: "BDS", label: "Brand discoverability",  components: BDS_COMPONENTS },
  product: { id: "product", code: "PDS", label: "Product discoverability", components: PDS_COMPONENTS },
  service: { id: "service", code: "SFS", label: "Service findability",     components: SFS_COMPONENTS },
});

export const SUBJECT_SCORE_IDS = Object.freeze(Object.keys(SUBJECT_SCORES));

// ── Scoring ────────────────────────────────────────────────────────────────

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Score one subject.
 *
 * ⚠️ ROUTES THROUGH `weightedMean`, THE ONE IMPLEMENTATION. A component with no
 * value is excluded and its weight redistributed; `coverage` reports how much
 * of the formula ran. A second redistribution rule here would be a second thing
 * to keep in step with the first.
 *
 * 🔴 AN UNBUILT SOURCE PRODUCES `null`, NEVER `0`. TC is 20% of BDS and W13 has
 * not shipped; defaulting it to zero would take every brand score down twenty
 * points for a module that does not exist, then show a phantom twenty-point
 * gain the day it lands. `unmeasured` names which components were left out and
 * `blockedBy` names the workstreams they are waiting on, so the reader is told
 * *why* coverage is short rather than being left to guess.
 *
 * @param {"brand"|"product"|"service"} kind
 * @param {object} values  `{ componentId: 0-100 | null }`
 */
export function scoreSubject(kind, values = {}) {
  const spec = SUBJECT_SCORES[kind];
  if (!spec) return null;

  const ids = Object.keys(spec.components);
  const entries = ids.map((id) => ({
    value: isNum(values[id]) ? values[id] : null,
    weight: spec.components[id].weight,
  }));

  const { score, coverage } = weightedMean(entries);

  const measured = ids.filter((id) => isNum(values[id]));
  const unmeasured = ids.filter((id) => !isNum(values[id]));
  const blockedBy = [...new Set(
    unmeasured
      .map((id) => COMPONENT_SOURCES[spec.components[id].source])
      .filter((s) => s && !s.built)
      .map((s) => s.workstream),
  )].sort();

  return Object.freeze({
    kind,
    code: spec.code,
    label: spec.label,
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    measured: Object.freeze(measured),
    unmeasured: Object.freeze(unmeasured),
    blockedBy: Object.freeze(blockedBy),
    components: Object.freeze(ids.map((id) => Object.freeze({
      ...spec.components[id],
      value: isNum(values[id]) ? values[id] : null,
      // What this component contributed to the final score, AFTER
      // redistribution — so the parts visibly sum to the whole. A reader
      // checking the arithmetic against the raw weights would otherwise find
      // they do not add up, and conclude the score is wrong rather than that
      // something was excluded.
      contribution: isNum(values[id]) && coverage > 0
        ? Math.round((values[id] * (spec.components[id].weight / coverage)) * 10) / 10
        : null,
    }))),
  });
}

/**
 * Is this score worth putting in front of a customer?
 *
 * ⚠️ A SCORE BUILT FROM HALF ITS FORMULA IS NOT A SMALLER SCORE, IT IS A
 * DIFFERENT ONE. The same reasoning the PDF export already applies when it
 * stamps a sub-70-coverage audit as THIN: a number gets screenshotted and
 * forwarded, and the caveat does not travel with it.
 */
export const THIN_COVERAGE = 70;

export function isThin(result) {
  return Boolean(result && (result.score === null || result.coverage < THIN_COVERAGE));
}

// ── The missing-facts matrix ───────────────────────────────────────────────

/**
 * Which facts a subject is missing, and what each one costs.
 *
 * ⚠️ ORDERED BY WEIGHT, NOT BY COUNT. A subject missing one 25%-weighted
 * component and six 10%-weighted ones should be told about the first. Ordering
 * by how many things are absent would bury it.
 *
 * ⚠️ AND A COMPONENT BLOCKED ON AN UNBUILT MODULE IS REPORTED SEPARATELY, never
 * as customer work. Telling somebody to "improve trust and credibility" when we
 * have not built the thing that measures it is a referral to nothing — the same
 * rule `gapTaxonomy` follows for its two P2-only root causes.
 */
export function missingFacts(result) {
  if (!result || !SUBJECT_SCORES[result.kind]) return Object.freeze({ actionable: [], blocked: [] });
  const spec = SUBJECT_SCORES[result.kind];

  const rows = result.unmeasured.map((id) => {
    const c = spec.components[id];
    const src = COMPONENT_SOURCES[c.source];
    return {
      component: id,
      abbr: c.abbr,
      label: c.label,
      weight: c.weight,
      // How many points of the final score this component can move. Expressed
      // as the weight it would carry if measured — which is what the reader is
      // deciding whether to spend effort on.
      worthPoints: Math.round(c.weight * 1000) / 10,
      source: c.source,
      sourceLabel: src?.label || c.source,
      describes: c.describes,
    };
  }).sort((a, b) => b.weight - a.weight || a.component.localeCompare(b.component));

  return Object.freeze({
    actionable: Object.freeze(rows.filter((r) => COMPONENT_SOURCES[r.source]?.built)),
    blocked: Object.freeze(rows.filter((r) => !COMPONENT_SOURCES[r.source]?.built)
      .map((r) => Object.freeze({ ...r, blockedBy: COMPONENT_SOURCES[r.source].workstream }))),
  });
}

// ── Service intent coverage ────────────────────────────────────────────────

/**
 * How much of a question set the site actually answers.
 *
 * 🔴 A QUESTION NOBODY ASKED IS NOT COVERAGE, AND A QUESTION WE DID NOT CHECK
 * IS NOT A GAP. `intents` is the set being measured against; an intent with no
 * `answered` verdict at all is UNKNOWN and excluded, exactly as an unmeasured
 * signal is. Counting an unchecked question as unanswered would report a site
 * as failing at something nobody looked at.
 *
 * @param {Array<{id:string,label?:string,answered?:boolean|null,weight?:number}>} intents
 */
export function intentCoverage(intents = []) {
  const list = (Array.isArray(intents) ? intents : []).filter((i) => i && typeof i.id === "string");
  const checked = list.filter((i) => typeof i.answered === "boolean");
  const unchecked = list.filter((i) => typeof i.answered !== "boolean");

  const totalW = checked.reduce((n, i) => n + (isNum(i.weight) ? i.weight : 1), 0);
  const metW = checked.filter((i) => i.answered)
    .reduce((n, i) => n + (isNum(i.weight) ? i.weight : 1), 0);

  return Object.freeze({
    score: totalW > 0 ? Math.round((metW / totalW) * 1000) / 10 : null,
    checked: checked.length,
    answered: checked.filter((i) => i.answered).length,
    gaps: Object.freeze(checked.filter((i) => !i.answered).map((i) => i.id)),
    // Named, not silently dropped: "we did not check these" is a different
    // statement from "these are missing", and the reader needs both.
    unchecked: Object.freeze(unchecked.map((i) => i.id)),
  });
}
