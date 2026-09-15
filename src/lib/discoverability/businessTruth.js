// businessTruth.js — the Canonical Business Truth Record. P2 · W9.
//
// PURE. Zero I/O. Imported by React AND `netlify/`, so the record the user
// approves is the record the server stores.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// Until now the module could say what a PAGE claims. It could not say what is
// TRUE. Those are different questions, and the second one is what every P2
// module needs: the entity graph needs a subject, brand scoring needs a brand,
// NAP matching needs a name-address-phone to match AGAINST, and the accuracy
// half of citation classification needs something to check an engine's answer
// against. `citationStates.js` says so in its own header — its accuracy check
// is deliberately narrowed to price because "P2's Canonical Business Truth
// Record is what makes general accuracy checkable; it does not exist".
//
// It exists now.
//
// ── `declared` IS NOT AN EVIDENCE METHOD, AND THAT IS THE POINT ────────────
// The obvious move is to add `customer_declared` to `EVIDENCE_METHODS` and
// reuse `makeEvidence` for everything. It is the wrong move.
//
// That model answers ONE question: *where on the web did you read this?* It
// requires a source URL, and carries a selector, a section and an excerpt. A
// customer typing their own legal name into a form has none of those. Forcing
// it through would mean inventing a source URL for a fact that was never on a
// page — fabricating provenance to satisfy a schema, which is the exact class
// of mistake this codebase keeps catching in other people's code.
//
// So a FACT carries a `source` from `FACT_SOURCES`, and when that source is
// `observed` it carries a real `makeEvidence` record. One evidence model, used
// wherever evidence exists; no second evidence model invented where it does
// not. `makeFact` REFUSES an observed fact with no evidence attached, which is
// what stops `observed` becoming a label anyone can apply to a guess.
//
// ── AUTHORITY IS NOT CONFIDENCE ────────────────────────────────────────────
// A declaration outranks a page reading for the CANONICAL value: the owner
// knows their registered legal name better than their own footer does, and the
// footer is frequently years stale. But `observed` carries a warranty
// `declared` can never have — somebody can go and look.
//
// 🔴 THE CONTRADICTION BETWEEN THEM IS THE MOST VALUABLE OUTPUT HERE. A record
// that merely stores what the customer typed is a form. A record that says
// "you told us Acme Technologies Pvt Ltd; your pricing page says Acme Tech;
// your schema says Acme" is a finding, and it is the finding that explains why
// three engines disagree about who they are. `detectConflicts` is that, and it
// is why this module ships with issue codes rather than just a table.
//
// ── APPROVAL BEFORE EXTERNAL EFFECT ────────────────────────────────────────
// A version is a proposal until somebody approves it, and the approver may not
// be the proposer. Enforced here, and again as a CHECK constraint in migration
// 0055 — because this record is about to become the thing other modules assert
// as true, and "approved" has to mean a second person looked.

import { isEvidence, evidenceConfidence, makeEvidence as makeEvidenceImpl } from "./evidenceModel.js";

// ── Where a fact came from ─────────────────────────────────────────────────
//
// `authority` orders these for choosing a canonical value. `verifiable` says
// whether anyone outside this company could check it — which is what makes
// `observed` worth keeping even though it loses every tie.
export const FACT_SOURCES = Object.freeze({
  declared: {
    id: "declared", authority: 1.00, verifiable: false, observed: false,
    label: "Declared by the business",
    warranty: "The business stated this about itself. Authoritative for what they intend to be true; unverifiable by us.",
  },
  imported: {
    id: "imported", authority: 0.85, verifiable: true, observed: true,
    label: "Imported from a connected system",
    warranty: "Read from a system the business authorised us to read — a business profile, a registry, a CRM. Real, and attributable to a source that is not a web page.",
  },
  observed: {
    id: "observed", authority: 0.70, verifiable: true, observed: true,
    label: "Observed on the web",
    warranty: "Read from the business's own pages or markup. Checkable by anyone; frequently stale.",
  },
  inferred: {
    id: "inferred", authority: 0.30, verifiable: false, observed: false,
    label: "Inferred",
    warranty: "A model's reading of ambiguous material. Never canonical without review.",
  },
});

export const FACT_SOURCE_IDS = Object.freeze(Object.keys(FACT_SOURCES));

/** Sources whose facts may be promoted to canonical without a human editing them. */
export const AUTO_CANONICAL_SOURCES = Object.freeze(["declared", "imported"]);

// ── The fields ─────────────────────────────────────────────────────────────
//
// ⚠️ `requiredForCanonical` IS DELIBERATELY TWO FIELDS, NOT FIFTEEN.
// A gate that blocks promotion until fifteen fields are filled is a gate people
// route around — they type placeholders to get past it, and the record ends up
// less true than if it had never asked. Only the two facts that IDENTIFY the
// business block promotion. Everything else a module needs is declared on that
// module's own row through `requiredFor`, so `readinessFor()` can say "local
// intelligence cannot run yet, it needs a locality" instead of a blanket
// refusal that names nothing.
export const TRUTH_FIELDS = Object.freeze({
  legal_name: {
    id: "legal_name", group: "identity", kind: "text", label: "Legal name",
    requiredForCanonical: true, requiredFor: ["entity_graph", "brand_discoverability"],
    describes: "The registered name. Not the brand, when they differ — the difference is itself a finding.",
  },
  brand_name: {
    id: "brand_name", group: "identity", kind: "text", label: "Brand name",
    requiredForCanonical: false, requiredFor: ["brand_discoverability", "ai_visibility"],
    describes: "What customers call them, and what an answer engine is asked about.",
  },
  also_known_as: {
    id: "also_known_as", group: "identity", kind: "list", label: "Also known as",
    requiredForCanonical: false, requiredFor: [],
    describes: "Former names, abbreviations and misspellings worth tracking. Feeds mention matching.",
  },
  description: {
    id: "description", group: "identity", kind: "text", label: "Description",
    requiredForCanonical: false, requiredFor: ["schema_intelligence"],
    describes: "One paragraph of what the business does, in their own words.",
  },
  founded_year: {
    id: "founded_year", group: "identity", kind: "year", label: "Founded",
    requiredForCanonical: false, requiredFor: [],
    describes: "Year of founding. A four-digit year, never a date we half-know.",
  },
  entity_type: {
    id: "entity_type", group: "identity", kind: "text", label: "Organisation type",
    requiredForCanonical: false, requiredFor: ["schema_intelligence"],
    describes: "The schema.org Organization subtype this business is, when one fits.",
  },
  logo_url: {
    id: "logo_url", group: "identity", kind: "url", label: "Logo URL",
    requiredForCanonical: false, requiredFor: ["schema_intelligence"],
    describes: "Canonical logo. Used by schema and by knowledge panels.",
  },

  canonical_domain: {
    id: "canonical_domain", group: "digital", kind: "domain", label: "Canonical domain",
    requiredForCanonical: true, requiredFor: ["entity_graph", "local_directory"],
    describes: "The one domain this business is. Also the bridge key to public.canonical_entities, so a company is resolved once.",
  },
  social_profiles: {
    id: "social_profiles", group: "digital", kind: "urlList", label: "Social profiles",
    requiredForCanonical: false, requiredFor: ["schema_intelligence", "trust_proof"],
    describes: "Profile URLs. These are schema.org sameAs, which is how an engine ties scattered mentions to one entity.",
  },
  primary_locale: {
    id: "primary_locale", group: "digital", kind: "text", label: "Primary locale",
    requiredForCanonical: false, requiredFor: [],
    describes: "The language and region the business publishes in first.",
  },

  primary_phone: {
    id: "primary_phone", group: "contact", kind: "phone", label: "Primary phone",
    requiredForCanonical: false, requiredFor: ["local_directory"],
    describes: "The P in NAP. Directory matching compares against this.",
  },
  primary_email: {
    id: "primary_email", group: "contact", kind: "email", label: "Primary email",
    requiredForCanonical: false, requiredFor: [],
    describes: "Public contact address.",
  },
  contact_page_url: {
    id: "contact_page_url", group: "contact", kind: "url", label: "Contact page",
    requiredForCanonical: false, requiredFor: [],
    describes: "Where a human is told to get in touch.",
  },

  street_address: {
    id: "street_address", group: "location", kind: "text", label: "Street address",
    requiredForCanonical: false, requiredFor: ["local_directory"],
    describes: "The A in NAP, street line only.",
  },
  locality: {
    id: "locality", group: "location", kind: "text", label: "City",
    requiredForCanonical: false, requiredFor: ["local_directory"],
    describes: "City or town.",
  },
  region: {
    id: "region", group: "location", kind: "text", label: "State or region",
    requiredForCanonical: false, requiredFor: [],
    describes: "State, province or region.",
  },
  postal_code: {
    id: "postal_code", group: "location", kind: "text", label: "Postal code",
    requiredForCanonical: false, requiredFor: [],
    describes: "Postal or PIN code.",
  },
  country: {
    id: "country", group: "location", kind: "text", label: "Country",
    requiredForCanonical: false, requiredFor: ["local_directory"],
    describes: "Country. Two-letter code or full name, stored as given.",
  },
  service_areas: {
    id: "service_areas", group: "location", kind: "list", label: "Service areas",
    requiredForCanonical: false, requiredFor: ["service_findability"],
    describes: "Where the business will actually serve a customer. Feeds the service-radius builder.",
  },

  categories: {
    id: "categories", group: "commercial", kind: "list", label: "Categories",
    requiredForCanonical: false, requiredFor: ["local_directory", "service_findability"],
    describes: "What the business sells, in the vocabulary a directory uses.",
  },
  price_range: {
    id: "price_range", group: "commercial", kind: "text", label: "Price range",
    requiredForCanonical: false, requiredFor: [],
    describes: "Indicative range. This is what an engine quoting a wrong price is checked against.",
  },
  registry_identifiers: {
    id: "registry_identifiers", group: "commercial", kind: "object", label: "Registry identifiers",
    requiredForCanonical: false, requiredFor: ["entity_graph"],
    describes: "GSTIN, CIN, DUNS, VAT and the like. The only fields here that resolve a company unambiguously.",
  },
});

export const TRUTH_FIELD_IDS = Object.freeze(Object.keys(TRUTH_FIELDS));

export const TRUTH_FIELD_GROUPS = Object.freeze([
  { id: "identity", label: "Identity" },
  { id: "digital", label: "Digital presence" },
  { id: "contact", label: "Contact" },
  { id: "location", label: "Location" },
  { id: "commercial", label: "Commercial" },
]);

export const REQUIRED_FOR_CANONICAL = Object.freeze(
  TRUTH_FIELD_IDS.filter((id) => TRUTH_FIELDS[id].requiredForCanonical),
);

// ── Version lifecycle ──────────────────────────────────────────────────────
//
// Five states. `superseded` is not a sixth kind of draft — it is how an
// approved version retires when a newer one is promoted, and keeping it means
// the history is readable rather than a list of rows that all claim to be
// current.
export const VERSION_STATES = Object.freeze({
  draft: {
    id: "draft", label: "Draft", order: 0, canonical: false, terminal: false,
    describes: "Being edited. Nobody has asked for it to be reviewed.",
    next: ["pending_review", "rejected"],
  },
  pending_review: {
    id: "pending_review", label: "Pending review", order: 1, canonical: false, terminal: false,
    describes: "Submitted. Waiting on somebody who is not the proposer.",
    next: ["approved", "rejected", "draft"],
  },
  approved: {
    id: "approved", label: "Approved", order: 2, canonical: true, terminal: false,
    describes: "A second person accepted it. This is the version other modules may assert as true.",
    next: ["superseded"],
  },
  rejected: {
    id: "rejected", label: "Rejected", order: 3, canonical: false, terminal: true,
    describes: "Declined, with a reason. Kept, because a rejection and its reason is evidence about the record.",
    next: [],
  },
  superseded: {
    id: "superseded", label: "Superseded", order: 4, canonical: false, terminal: true,
    describes: "Was approved; a newer version replaced it. The history, not the truth.",
    next: [],
  },
});

export const VERSION_STATE_IDS = Object.freeze(Object.keys(VERSION_STATES));

/** May a version move from `from` to `to`? Unknown states are always refused. */
export function canTransition(from, to) {
  const s = VERSION_STATES[from];
  if (!s || !VERSION_STATES[to]) return false;
  return s.next.includes(to);
}

// ── Conflict codes — A PUBLIC CONTRACT ─────────────────────────────────────
//
// These travel in stored rows, JSON payloads and every historical diff, exactly
// like the signal and issue codes. Add codes; never repurpose or renumber one.
export const TRUTH_CONFLICT_CODES = Object.freeze({
  "BT-01": { code: "BT-01", label: "Canonical value contradicted on the page", severity: "high" },
  "BT-02": { code: "BT-02", label: "Canonical value absent from the page", severity: "medium" },
  "BT-03": { code: "BT-03", label: "Required identifying fact missing", severity: "high" },
  "BT-04": { code: "BT-04", label: "Canonical value rests on inference alone", severity: "medium" },
});

// ── Normalisation ──────────────────────────────────────────────────────────

const TEXT_MAX = 1000;
const LIST_MAX = 50;

function normText(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, TEXT_MAX) : null;
}

function normList(v) {
  const arr = Array.isArray(v) ? v : (typeof v === "string" ? v.split(/[,\n]/) : []);
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const t = normText(item);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= LIST_MAX) break;
  }
  return out.length ? out : null;
}

function normEmail(v) {
  const t = normText(v);
  if (!t) return null;
  const lower = t.toLowerCase();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(lower) ? lower : null;
}

/**
 * Phone: keep the digits and a leading `+`, drop presentation.
 *
 * ⚠️ DELIBERATELY NOT A COUNTRY-CODE PARSER. Guessing that a 10-digit Indian
 * number is `+91` and an American one is `+1` is exactly the kind of inference
 * that would then be stored as a DECLARED fact and matched against directories
 * as though the customer had said it. Presentation is stripped; meaning is not
 * added. W12's matcher compares digit tails, which is what survives formatting.
 */
function normPhone(v) {
  const t = normText(v);
  if (!t) return null;
  const plus = t.trim().startsWith("+");
  const digits = t.replace(/\D+/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return (plus ? "+" : "") + digits;
}

function normUrl(v) {
  const t = normText(v);
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

function normUrlList(v) {
  const arr = normList(v);
  if (!arr) return null;
  const out = arr.map(normUrl).filter(Boolean);
  return out.length ? out : null;
}

function normDomain(v) {
  const t = normText(v);
  if (!t) return null;
  let host = t.toLowerCase();
  const asUrl = normUrl(host);
  if (asUrl) { try { host = new URL(asUrl).hostname; } catch { /* keep host */ } }
  host = host.replace(/^www\./, "").replace(/\/+$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

/**
 * Year: a four-digit year that could plausibly be a founding year.
 *
 * The upper bound is not `new Date().getFullYear()` on purpose — this module is
 * pure and has no clock, and a "current year" read at import time in a
 * long-lived server process is wrong for most of the process's life. 2200 is a
 * bound that rejects typos without pretending to know today's date.
 */
function normYear(v) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  if (!Number.isInteger(n)) return null;
  return n >= 1000 && n <= 2200 ? n : null;
}

function normObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const [k, raw] of Object.entries(v)) {
    const key = normText(k);
    const val = normText(raw) ?? (typeof raw === "number" ? String(raw) : null);
    if (key && val) out[key.toLowerCase()] = val;
  }
  return Object.keys(out).length ? out : null;
}

const NORMALISERS = Object.freeze({
  text: normText, list: normList, urlList: normUrlList, email: normEmail,
  phone: normPhone, url: normUrl, domain: normDomain, year: normYear, object: normObject,
});

/** Normalise one value for one field. Returns null when it is not usable as that kind. */
export function normalizeFieldValue(fieldId, value) {
  const field = TRUTH_FIELDS[fieldId];
  if (!field) return null;
  const fn = NORMALISERS[field.kind];
  return fn ? fn(value) : null;
}

// ── A single fact ──────────────────────────────────────────────────────────

function toIso(when) {
  if (when === undefined || when === null || when === "") return null;
  const d = when instanceof Date ? when : new Date(when);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build one field's value plus its provenance.
 *
 * 🔴 REFUSES an `observed` or `imported` fact with no evidence record attached.
 * Those two sources are the ones that claim somebody could go and check, and a
 * claim of verifiability with nothing to verify against is worse than an
 * admitted guess — it is a guess wearing a warranty. Use `inferred`, or attach
 * the evidence.
 *
 * @returns {object|null} a frozen fact, or null when it would not be a fact.
 */
export function makeFact({
  field,
  value,
  source,
  evidence = null,
  statedBy = null,
  statedAt,
  note = null,
} = {}) {
  const meta = TRUTH_FIELDS[field];
  if (!meta) return null;                          // unknown field — never invent one
  const src = FACT_SOURCES[source];
  if (!src) return null;                           // unknown source — never default one

  const normalised = normalizeFieldValue(field, value);
  if (normalised === null) return null;            // unusable value for this kind

  const at = toIso(statedAt);
  if (!at) return null;                            // an undated assertion cannot be aged

  const ev = isEvidence(evidence) ? evidence : null;
  if (src.verifiable && !ev) return null;          // see the header above

  return Object.freeze({
    field,
    value: Object.isFrozen(normalised) ? normalised : deepFreeze(normalised),
    source,
    authority: src.authority,
    observed: src.observed,
    evidence: ev,
    confidence: ev ? evidenceConfidence(ev) : src.authority,
    stated_by: statedBy ? String(statedBy).slice(0, 200) : null,
    stated_at: at,
    note: note ? String(note).slice(0, 500) : null,
  });
}

function deepFreeze(v) {
  if (Array.isArray(v)) return Object.freeze(v.map(deepFreeze));
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) v[k] = deepFreeze(v[k]);
    return Object.freeze(v);
  }
  return v;
}

/** Is this a record `makeFact` would have produced? */
export function isFact(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.field === "string"
    && TRUTH_FIELDS[value.field]
    && typeof value.source === "string"
    && FACT_SOURCES[value.source]
    && value.value !== undefined
    && value.value !== null
    && typeof value.stated_at === "string",
  );
}

/**
 * Reduce many candidate facts for the same field to the one that should be
 * canonical, highest authority first and newest as the tiebreak.
 *
 * ⚠️ THIS DOES NOT DISCARD THE LOSERS, AND CALLERS MUST NOT EITHER. A page
 * reading that lost to a declaration is precisely the input `detectConflicts`
 * needs; throwing it away here would delete the finding before anyone saw it.
 */
export function pickCanonicalFact(facts = []) {
  const valid = (Array.isArray(facts) ? facts : []).filter(isFact);
  if (!valid.length) return null;
  return valid.slice().sort((a, b) => {
    if (b.authority !== a.authority) return b.authority - a.authority;
    return String(b.stated_at).localeCompare(String(a.stated_at));
  })[0];
}

/** Build a `{ fieldId: fact }` map from loose candidates, keeping the best of each. */
export function buildFieldMap(facts = []) {
  const byField = new Map();
  for (const f of (Array.isArray(facts) ? facts : [])) {
    if (!isFact(f)) continue;
    const list = byField.get(f.field) || [];
    list.push(f);
    byField.set(f.field, list);
  }
  const out = {};
  for (const [field, list] of byField) {
    const best = pickCanonicalFact(list);
    if (best) out[field] = best;
  }
  return out;
}

// ── Completeness ───────────────────────────────────────────────────────────

/**
 * How much of the record is filled in.
 *
 * ⚠️ `notApplicable` FIELDS ARE EXCLUDED AND NAMED, never scored as zero —
 * the same discipline `weightedMean` applies to signals. A business with no
 * physical premises has no street address, and counting that absence against
 * them would report a correct record as a deficient one.
 *
 * ⚠️ But a field that is simply MISSING is missing. The redistribution rule is
 * about things that do not APPLY, not about things nobody has filled in yet —
 * an inventory that excused every gap would always read 100% and mean nothing.
 */
export function truthCompleteness(fields = {}, { notApplicable = [] } = {}) {
  const skip = new Set((Array.isArray(notApplicable) ? notApplicable : []).filter((id) => TRUTH_FIELDS[id]));
  const applicable = TRUTH_FIELD_IDS.filter((id) => !skip.has(id));
  const known = applicable.filter((id) => isFact(fields?.[id]));
  const missing = applicable.filter((id) => !isFact(fields?.[id]));
  return Object.freeze({
    known: known.length,
    applicable: applicable.length,
    excluded: Object.freeze([...skip]),
    missing: Object.freeze(missing),
    percent: applicable.length ? Math.round((known.length / applicable.length) * 1000) / 10 : null,
  });
}

/**
 * Can a downstream module run against this record yet, and if not, what does it
 * still need? Named fields, never a bare "incomplete".
 */
export function readinessFor(moduleId, fields = {}) {
  const needs = TRUTH_FIELD_IDS.filter((id) => TRUTH_FIELDS[id].requiredFor.includes(moduleId));
  const missing = needs.filter((id) => !isFact(fields?.[id]));
  return Object.freeze({
    module: moduleId,
    ready: needs.length > 0 && missing.length === 0,
    declares: needs.length > 0,
    requires: Object.freeze(needs),
    missing: Object.freeze(missing),
  });
}

// ── The approval gate ──────────────────────────────────────────────────────

/**
 * May this version become the canonical record?
 *
 * Returns every blocker at once rather than the first — a reviewer told one
 * problem, who fixes it and is then told a second, learns to distrust the gate.
 *
 * 🔴 SELF-APPROVAL IS A BLOCKER. The whole value of "approved" is that a second
 * person looked; one signature in both boxes is a draft with extra steps. The
 * DB carries the same rule as a CHECK constraint, because a gate that lives
 * only in application code is a gate the next endpoint forgets.
 */
export function canPromote(version = {}) {
  const blockers = [];

  const state = version.state;
  if (!VERSION_STATES[state]) {
    blockers.push({ code: "unknown_state", message: `Unknown version state "${state}".` });
  } else if (!VERSION_STATES[state].canonical) {
    blockers.push({
      code: "not_approved",
      message: `A ${VERSION_STATES[state].label.toLowerCase()} version cannot become canonical — it must be approved first.`,
    });
  }

  const fields = version.fields || {};
  const missingRequired = REQUIRED_FOR_CANONICAL.filter((id) => !isFact(fields[id]));
  if (missingRequired.length) {
    blockers.push({
      code: "missing_required",
      fields: missingRequired,
      message: `Missing the fact${missingRequired.length > 1 ? "s" : ""} that identify the business: ${missingRequired.map((id) => TRUTH_FIELDS[id].label).join(", ")}.`,
    });
  }

  const proposer = version.proposed_by || null;
  const approver = version.reviewed_by || null;
  const isSingleFounder = Boolean(version.singleFounderApproval || (typeof version.review_note === "string" && version.review_note.includes("[Single-founder approval]")));
  if (!approver) {
    blockers.push({ code: "no_approver", message: "No approver recorded." });
  } else if (proposer && approver === proposer && !isSingleFounder) {
    blockers.push({
      code: "self_approval",
      message: "The approver is the proposer. Approval means a second person looked, or record single-founder self-approval.",
    });
  }

  const inferredRequired = REQUIRED_FOR_CANONICAL
    .filter((id) => isFact(fields[id]) && fields[id].source === "inferred");
  if (inferredRequired.length) {
    blockers.push({
      code: "inferred_required",
      fields: inferredRequired,
      message: `Identifying fact${inferredRequired.length > 1 ? "s" : ""} rest on inference alone: ${inferredRequired.map((id) => TRUTH_FIELDS[id].label).join(", ")}. Confirm or correct before approving.`,
    });
  }

  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze(blockers) });
}

// ── Version diff ───────────────────────────────────────────────────────────

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue(a[k], b[k]));
  }
  return a === b;
}

/**
 * What changed between two versions, field by field.
 *
 * ⚠️ A SOURCE CHANGE WITH NO VALUE CHANGE IS A REAL EVENT and gets its own
 * bucket. "We inferred your founding year, then you confirmed it" moves nothing
 * on screen but changes what the product is entitled to assert — reporting it
 * as `unchanged` would hide the one thing that actually happened.
 */
export function diffVersions(prev = {}, next = {}) {
  const prevFields = prev?.fields || {};
  const nextFields = next?.fields || {};
  const added = []; const removed = []; const changed = []; const resourced = []; const unchanged = [];

  for (const id of TRUTH_FIELD_IDS) {
    const a = isFact(prevFields[id]) ? prevFields[id] : null;
    const b = isFact(nextFields[id]) ? nextFields[id] : null;
    if (!a && !b) continue;
    if (!a && b) { added.push({ field: id, to: b.value, source: b.source }); continue; }
    if (a && !b) { removed.push({ field: id, from: a.value, source: a.source }); continue; }
    if (!sameValue(a.value, b.value)) {
      changed.push({ field: id, from: a.value, to: b.value, from_source: a.source, to_source: b.source });
    } else if (a.source !== b.source) {
      resourced.push({ field: id, value: b.value, from_source: a.source, to_source: b.source });
    } else {
      unchanged.push({ field: id, value: b.value, source: b.source });
    }
  }

  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
    resourced: Object.freeze(resourced),
    unchanged: Object.freeze(unchanged),
    changeCount: added.length + removed.length + changed.length + resourced.length,
  });
}

// ── Conflicts — the diagnostic this record exists to produce ───────────────

function comparableText(v) {
  if (typeof v === "string") return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * Where does the page disagree with the approved record?
 *
 * 🔴 AN ABSENCE IS NOT A CONTRADICTION, AND THE TWO GET DIFFERENT CODES.
 * `BT-01` means the page states something else. `BT-02` means the page does not
 * state it at all. Collapsing them would tell a customer their address is wrong
 * when the real finding is that their contact page never mentions it — opposite
 * remedies, and the wrong one wastes the fix.
 *
 * 🔴 ONLY FIELDS PRESENT ON BOTH SIDES ARE COMPARED FOR BT-01. A canonical
 * value with nothing observed against it produces `BT-02` at most, never a
 * contradiction — we cannot contradict what we did not read.
 *
 * @param {object} canonical  the approved version's `{ fieldId: fact }` map
 * @param {object} observed   `{ fieldId: fact }` read from the audited pages
 * @param {object} [opts]
 * @param {string[]} [opts.fields]  restrict to these fields; defaults to all
 */
export function detectConflicts(canonical = {}, observed = {}, { fields = null } = {}) {
  const scope = (Array.isArray(fields) && fields.length ? fields : TRUTH_FIELD_IDS)
    .filter((id) => TRUTH_FIELDS[id]);
  const out = [];

  for (const id of scope) {
    const c = isFact(canonical[id]) ? canonical[id] : null;
    if (!c) continue;

    const o = isFact(observed[id]) ? observed[id] : null;
    if (!o) {
      out.push(Object.freeze({
        code: "BT-02",
        field: id,
        label: TRUTH_FIELDS[id].label,
        severity: TRUTH_CONFLICT_CODES["BT-02"].severity,
        canonical_value: c.value,
        observed_value: null,
        evidence: null,
        message: `${TRUTH_FIELDS[id].label} is in the canonical record but was not found on the pages audited.`,
      }));
      continue;
    }

    const cv = comparableText(c.value);
    const ov = comparableText(o.value);
    if (cv === null || ov === null) continue;      // lists and objects: W10's job, not a text compare
    if (cv === ov) continue;
    if (cv && ov && (cv.includes(ov) || ov.includes(cv))) continue;  // "Acme Ltd" vs "Acme" is not a contradiction

    out.push(Object.freeze({
      code: "BT-01",
      field: id,
      label: TRUTH_FIELDS[id].label,
      severity: TRUTH_CONFLICT_CODES["BT-01"].severity,
      canonical_value: c.value,
      observed_value: o.value,
      evidence: o.evidence,
      message: `${TRUTH_FIELDS[id].label} differs: the record says "${c.value}", the page says "${o.value}".`,
    }));
  }

  return Object.freeze(out);
}

/**
 * Record-level health: what a reviewer should be told before they approve.
 * Pure assembly of the functions above — no new rules live here.
 */
export function summariseRecord(version = {}, { notApplicable = [] } = {}) {
  const fields = version?.fields || {};
  const completeness = truthCompleteness(fields, { notApplicable });
  const gate = canPromote(version);
  const state = VERSION_STATES[version?.state] || null;
  return Object.freeze({
    state: state ? state.id : null,
    stateLabel: state ? state.label : null,
    canonical: Boolean(state?.canonical),
    completeness,
    promotable: gate.ok,
    blockers: gate.blockers,
    declaredCount: TRUTH_FIELD_IDS.filter((id) => fields[id]?.source === "declared").length,
    inferredCount: TRUTH_FIELD_IDS.filter((id) => fields[id]?.source === "inferred").length,
  });
}

// ── Reading facts off a page ───────────────────────────────────────────────

/** Where a schema.org node keeps each truth field, and how to lift it out. */
const SCHEMA_MAP = Object.freeze({
  legal_name: (n) => n.legalName || n.name,
  brand_name: (n) => (typeof n.brand === "string" ? n.brand : n.brand?.name) || n.name,
  description: (n) => n.description,
  logo_url: (n) => (typeof n.logo === "string" ? n.logo : n.logo?.url),
  founded_year: (n) => (typeof n.foundingDate === "string" ? n.foundingDate.slice(0, 4) : null),
  primary_phone: (n) => n.telephone || n.contactPoint?.telephone,
  primary_email: (n) => n.email,
  street_address: (n) => n.address?.streetAddress,
  locality: (n) => n.address?.addressLocality,
  region: (n) => n.address?.addressRegion,
  postal_code: (n) => n.address?.postalCode,
  country: (n) => n.address?.addressCountry,
  price_range: (n) => n.priceRange,
  social_profiles: (n) => n.sameAs,
  canonical_domain: (n) => n.url,
});

/**
 * Lift truth facts out of a schema.org Organization / LocalBusiness node.
 *
 * ⚠️ EVERY FACT THIS PRODUCES IS `observed`, AND EVERY ONE CARRIES EVIDENCE.
 * That is not a formality — `makeFact` refuses an observed fact without it, so
 * a caller that cannot supply a source URL gets nothing rather than a set of
 * facts wearing a warranty nobody can honour.
 *
 * 🔴 IT NEVER PROPOSES A CANONICAL VALUE. What a page says is an observation
 * ABOUT the business, never a decision BY it — so the version a caller builds
 * from this is always a draft, and `pickCanonicalFact` will rank every one of
 * these below the owner's own declaration.
 *
 * @param {object} node        a parsed JSON-LD Organization-family node
 * @param {object} opts
 * @param {string} opts.sourceUrl   the page it was read from
 * @param {*}      opts.collectedAt when
 * @param {string} [opts.method]    evidence method; `json_ld` by default
 */
export function factsFromSchemaOrg(node, { sourceUrl, collectedAt, method = "json_ld" } = {}) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return {};
  const out = {};
  for (const [field, read] of Object.entries(SCHEMA_MAP)) {
    let raw;
    try { raw = read(node); } catch { continue; }
    if (raw === undefined || raw === null || raw === "") continue;

    const evidence = makeEvidenceRef({
      method, sourceUrl, collectedAt,
      selector: field === "social_profiles" ? "sameAs" : field,
      section: `${node["@type"] || "Organization"} JSON-LD`,
      observedValue: Array.isArray(raw) ? raw.slice(0, 8) : raw,
    });
    const fact = makeFact({ field, value: raw, source: "observed", evidence, statedAt: collectedAt });
    if (fact) out[field] = fact;
  }
  return out;
}

// Kept as a named indirection so this module has exactly one place that builds
// evidence, and so a test can prove the mapper is producing real records rather
// than object literals that merely look like them.
function makeEvidenceRef(input) {
  return makeEvidenceImpl(input);
}

/**
 * The fields a page can be READ for, as a lookup.
 *
 * Callers scope `detectConflicts` with this. Without a scope, every field the
 * record holds that a single page never mentions becomes a BT-02, and one audit
 * of a blog post would raise twenty absences — a page not stating the company's
 * postal code is not a finding, it is a question that audit did not ask.
 */
export const SCHEMA_READABLE = Object.freeze(
  Object.fromEntries(Object.keys(SCHEMA_MAP).map((f) => [f, true])),
);
