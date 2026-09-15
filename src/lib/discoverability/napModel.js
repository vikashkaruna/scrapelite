// napModel.js — W12. NAP consistency, per-directory matching and the local score.
//
// PURE. Zero I/O. Imported by React AND `netlify/`.
//
// ── THE PROBLEM ───────────────────────────────────────────────────────────
// "NAP" is Name, Address, Phone: the three values that resolve a business to a
// place. When the Google profile says "Acme Technologies Pvt Ltd, 4th Floor,
// MG Road" and Justdial says "Acme Tech, 4 Flr, Mahatma Gandhi Rd", an engine
// asked "where is Acme" has two answers. It does not error; it picks one.
//
// 🔴 SO THE HARD PART IS NOT COMPARING STRINGS — IT IS NOT CRYING WOLF.
// "Pvt Ltd" against "Private Limited" is the SAME NAME. "Rd" against "Road" is
// the SAME STREET. "+91 80 4718 2200" against "08047182200" is the SAME PHONE.
// A checker that reports those three as mismatches produces a list nobody
// reads, and then the one real mismatch in it goes unfixed. Normalisation is
// most of this file for exactly that reason, and every equivalence it applies
// is a declared, testable rule rather than a fuzzy ratio.
//
// ── AND `unknown` IS STILL NEVER `0` ──────────────────────────────────────
// Three different things look like "no match" and only one of them is a
// problem:
//   · the source does not PUBLISH that field  → excluded, weight redistributed
//   · the source was not CHECKED (D5: unauthorised) → excluded, named
//   · the source publishes a DIFFERENT value → a finding
// Collapsing them would score a customer down for our own coverage gaps and
// then show a phantom improvement the day they authorise a connection. Every
// score here routes through `weightedMean`, the one implementation.

import { weightedMean } from "./scoringModel.js";
import { SOURCE_BY_ID, weightOf } from "./directorySources.js";

// ── Normalisation ──────────────────────────────────────────────────────────

const lower = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const squash = (v) => v.replace(/\s+/g, " ").trim();

/**
 * Legal-form suffixes that carry NO identity.
 *
 * ⚠️ These are STRIPPED, not normalised to one spelling. "Acme Pvt Ltd" and
 * "Acme" are the same business under every one of these forms, and a customer
 * told their Facebook page "disagrees" because it omits "Private Limited" will
 * conclude the whole report is noise.
 */
const LEGAL_SUFFIXES = [
  "private limited", "pvt limited", "pvt ltd", "pvt. ltd.", "p ltd", "pte ltd",
  "public limited", "limited", "ltd", "llp", "llc", "inc", "incorporated",
  "corporation", "corp", "gmbh", "s a", "b v", "company", "co", "and co",
];

/** Address abbreviations, expanded to the long form so both sides agree. */
const ADDRESS_EXPANSIONS = Object.freeze({
  rd: "road", st: "street", ave: "avenue", av: "avenue", ln: "lane",
  blvd: "boulevard", hwy: "highway", sq: "square", cr: "cross", crs: "cross",
  flr: "floor", fl: "floor", flt: "flat", apt: "flat", bldg: "building",
  bldgs: "buildings", bhavan: "bhavan", opp: "opposite", nr: "near",
  jn: "junction", jnc: "junction", sec: "sector", ph: "phase",
  ind: "industrial", estt: "estate", ext: "extension", clny: "colony",
  nag: "nagar", mkt: "market", complx: "complex", twr: "tower",
  no: "number", "#": "number", hno: "house number",
});

/** Words that add no discriminating information to an address. */
const ADDRESS_NOISE = new Set(["the", "of", "at", "and", "&"]);

/**
 * Normalise a business name for comparison.
 * Lower-cases, drops punctuation, removes every legal suffix, collapses space.
 */
export function normaliseName(value) {
  let s = lower(value);
  if (!s) return "";
  s = s.replace(/[.,'"`’]/g, " ").replace(/[-/\\|]/g, " ");
  s = squash(s);
  // Repeat: "Acme Technologies Pvt Ltd Co" carries two.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(" " + suffix)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return squash(s);
}

/**
 * Normalise a phone number to its national significant number.
 *
 * ⚠️ INDIA-FIRST AND EXPLICIT ABOUT IT. `+91 80 4718 2200`, `08047182200` and
 * `80-4718-2200` are one number; the country code and the trunk `0` are
 * formatting, not identity. `country` widens this without guessing: a 10-digit
 * tail is the right rule for IN and wrong for several other markets, so it is
 * applied only where it is declared, and everything else falls back to the
 * digits as given.
 */
export function normalisePhone(value, { country = "IN" } = {}) {
  const raw = typeof value === "string" ? value : (typeof value === "number" ? String(value) : "");
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  const cc = String(country || "").toUpperCase();
  if (cc === "IN") {
    if (digits.startsWith("0091")) digits = digits.slice(4);
    else if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
    if (digits.length > 10) digits = digits.slice(-10);
  }
  return digits;
}

/** Normalise an address into a comparable token list. */
export function normaliseAddressTokens(value) {
  let s = lower(value);
  if (!s) return [];
  s = s.replace(/[.,;:'"`’()]/g, " ").replace(/[-/\\|]/g, " ");
  return squash(s)
    .split(" ")
    .map((t) => ADDRESS_EXPANSIONS[t] || t)
    .filter((t) => t && !ADDRESS_NOISE.has(t));
}

/** The same, as one comparable string. */
export function normaliseAddress(value) {
  return normaliseAddressTokens(value).join(" ");
}

/** Postal codes compare on digits alone — "560 001" is "560001". */
export function normalisePostal(value) {
  const raw = typeof value === "string" ? value : (typeof value === "number" ? String(value) : "");
  return raw.replace(/[^\dA-Za-z]/g, "").toUpperCase();
}

// ── Per-field matching ─────────────────────────────────────────────────────

/**
 * The match states, and what each is worth.
 *
 * ⚠️ `not_published` AND `absent` BOTH SCORE `null`, AND THEY ARE STILL
 * DIFFERENT STATES. `not_published` is our knowledge of the source's format
 * (G2 shows no address, so it can never contradict one). `absent` is the
 * source having a field and leaving it empty, which IS worth telling the
 * customer about even though it cannot be scored as a contradiction. Merging
 * them would lose the only actionable half.
 */
export const MATCH_STATES = Object.freeze({
  exact:         { id: "exact",         score: 100, label: "Exact match" },
  strong:        { id: "strong",        score: 92,  label: "Match after normalisation" },
  weak:          { id: "weak",          score: 55,  label: "Partial match" },
  mismatch:      { id: "mismatch",      score: 0,   label: "Different value" },
  absent:        { id: "absent",        score: null, label: "Not stated by this source" },
  not_published: { id: "not_published", score: null, label: "This source never publishes it" },
});

export const MATCH_STATE_IDS = Object.freeze(Object.keys(MATCH_STATES));

/** Jaccard overlap over token sets — used only to separate `weak` from `mismatch`. */
function overlap(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / new Set([...A, ...B]).size;
}

export const WEAK_THRESHOLD = 0.5;

/**
 * Compare one field.
 *
 * `canonical` is the truth record's value (W9); `observed` is the directory's.
 * `published` says whether this source shows the field at all.
 */
export function matchField(field, canonical, observed, { published = true, country = "IN" } = {}) {
  if (!published) return { field, state: "not_published", canonical: canonical ?? null, observed: null };

  const hasCanonical = canonical !== null && canonical !== undefined && String(canonical).trim() !== "";
  const hasObserved = observed !== null && observed !== undefined && String(observed).trim() !== "";

  // Nothing to compare against on our own side is not the DIRECTORY's fault.
  // Reporting it as a mismatch would blame the customer's listing for a gap in
  // the truth record they were never asked to fill — LD-07 raises that instead.
  if (!hasCanonical) return { field, state: "not_published", canonical: null, observed: hasObserved ? observed : null, reason: "no canonical value to compare against" };
  if (!hasObserved) return { field, state: "absent", canonical, observed: null };

  if (field === "phone") {
    const c = normalisePhone(canonical, { country });
    const o = normalisePhone(observed, { country });
    if (!c || !o) return { field, state: "absent", canonical, observed };
    if (String(canonical).trim() === String(observed).trim()) return { field, state: "exact", canonical, observed };
    if (c === o) return { field, state: "strong", canonical, observed, note: "same number, different formatting" };
    return { field, state: "mismatch", canonical, observed };
  }

  if (field === "postal_code") {
    const c = normalisePostal(canonical);
    const o = normalisePostal(observed);
    if (c === o) {
      return { field, state: String(canonical).trim() === String(observed).trim() ? "exact" : "strong", canonical, observed };
    }
    return { field, state: "mismatch", canonical, observed };
  }

  if (field === "name") {
    if (String(canonical).trim() === String(observed).trim()) return { field, state: "exact", canonical, observed };
    const c = normaliseName(canonical);
    const o = normaliseName(observed);
    if (!c || !o) return { field, state: "absent", canonical, observed };
    if (c === o) return { field, state: "strong", canonical, observed, note: "same name once the legal form is set aside" };
    const ov = overlap(c.split(" "), o.split(" "));
    return { field, state: ov >= WEAK_THRESHOLD ? "weak" : "mismatch", canonical, observed, overlap: ov };
  }

  // address and everything else token-based
  if (String(canonical).trim() === String(observed).trim()) return { field, state: "exact", canonical, observed };
  const ct = normaliseAddressTokens(canonical);
  const ot = normaliseAddressTokens(observed);
  if (!ct.length || !ot.length) return { field, state: "absent", canonical, observed };
  if (ct.join(" ") === ot.join(" ")) {
    return { field, state: "strong", canonical, observed, note: "same address once abbreviations are expanded" };
  }
  const ov = overlap(ct, ot);
  return { field, state: ov >= WEAK_THRESHOLD ? "weak" : "mismatch", canonical, observed, overlap: ov };
}

/**
 * The NAP fields and their relative importance WITHIN one listing.
 *
 * ⚠️ ADDRESS OUTWEIGHS NAME because an engine resolving a local query is
 * answering "where", and two businesses with similar names at one address are
 * a far smaller problem than one business at two addresses.
 */
export const NAP_FIELDS = Object.freeze({
  name:        { id: "name",        weight: 0.30, label: "Name" },
  address:     { id: "address",     weight: 0.40, label: "Address" },
  phone:       { id: "phone",       weight: 0.20, label: "Phone" },
  postal_code: { id: "postal_code", weight: 0.10, label: "Postal code" },
});

export const NAP_FIELD_IDS = Object.freeze(Object.keys(NAP_FIELDS));

/**
 * `Match_d` — how well ONE directory listing agrees with the truth record.
 *
 * Returns `score: null` when nothing on the listing was comparable, never `0`.
 * A listing we could not read and a listing that is wrong must not produce the
 * same number.
 */
export function matchDirectory(sourceId, canonical = {}, observed = {}, { country = "IN" } = {}) {
  const source = SOURCE_BY_ID[sourceId];
  if (!source) return null;

  const fields = NAP_FIELD_IDS.map((f) => {
    const published = source.publishes.includes(f)
      // A source that publishes "address" publishes the postal code with it.
      || (f === "postal_code" && source.publishes.includes("address"));
    return matchField(f, canonical[f], observed[f], { published, country });
  });

  const { score, coverage } = weightedMean(
    fields.map((r) => ({ value: MATCH_STATES[r.state].score, weight: NAP_FIELDS[r.field].weight })),
  );

  return {
    sourceId,
    sourceLabel: source.label,
    tier: source.tier,
    tierWeight: weightOf(sourceId),
    score,
    coverage,
    fields,
    mismatches: fields.filter((f) => f.state === "mismatch").map((f) => f.field),
    absent: fields.filter((f) => f.state === "absent").map((f) => f.field),
  };
}

// ── The weighted NAP score ─────────────────────────────────────────────────

/**
 * Roll every checked directory into one score, weighted by tier.
 *
 * 🔴 AN UNCHECKED SOURCE IS EXCLUDED AND NAMED, NEVER SCORED ZERO. Under D5
 * most customers will have authorised nothing, so a zero-for-unchecked rule
 * would open every local report at a near-zero score that says more about our
 * connectors than about their business — and would then show a phantom jump
 * the day they connect one. `coverage` and `unchecked` carry that fact instead.
 *
 * @param {Array} matches results from `matchDirectory`
 * @param {string[]} configured every source id in scope, checked or not
 */
export function napScore(matches = [], configured = []) {
  const byId = new Map(matches.filter(Boolean).map((m) => [m.sourceId, m]));
  const scope = configured.length ? configured : [...byId.keys()];

  const entries = scope.map((id) => ({
    value: byId.get(id)?.score ?? null,
    weight: weightOf(id) || 0.01,
  }));
  const { score, coverage } = weightedMean(entries);

  const checked = scope.filter((id) => byId.has(id) && byId.get(id).score !== null);
  const unchecked = scope.filter((id) => !byId.has(id));
  const unreadable = scope.filter((id) => byId.has(id) && byId.get(id).score === null);

  return {
    score,
    coverage,
    checkedCount: checked.length,
    configuredCount: scope.length,
    checked,
    unchecked,
    unreadable,
    // The single most valuable thing on the screen: the highest-weighted
    // listing that disagrees. Fixing tier 1 moves more than fixing five of
    // tier 5, and a list sorted by anything else buries that.
    worstOffender: [...byId.values()]
      .filter((m) => m.score !== null && m.mismatches.length > 0)
      .sort((a, b) => (b.tierWeight - a.tierWeight) || (a.score - b.score))[0] || null,
  };
}

// ── Findings ───────────────────────────────────────────────────────────────

/**
 * The LD codes.
 *
 * ⚠️ A PUBLIC CONTRACT, like every other code in this module. They travel in
 * stored rows and every historical diff. Add codes; never repurpose one.
 *
 * 🔴 LD-05 EXISTS BECAUSE THE OBVIOUS CHECK IS WRONG ON REGISTRIES. A company's
 * registered office is routinely NOT its trading address, and that is legal and
 * normal. Reporting it as a NAP mismatch would send a customer to amend a
 * statutory filing to match a shopfront — expensive, slow, and the wrong fix.
 * So a registry difference gets its own, lower-severity code that says what it
 * actually means.
 */
export const LOCAL_FINDING_CODES = Object.freeze({
  "LD-01": {
    code: "LD-01", severity: "critical", field: "address",
    title: "A high-authority listing shows a different address",
    why: "The record an engine answers from disagrees with your own. Whichever it picks, some callers arrive somewhere you are not.",
    rootCause: "location_radius_mismatch",
  },
  "LD-02": {
    code: "LD-02", severity: "high", field: "phone",
    title: "A listing shows a different phone number",
    why: "A number that is not yours routes enquiries away from you, and it is the one NAP field a customer can verify in a second.",
    rootCause: "location_radius_mismatch",
  },
  "LD-03": {
    code: "LD-03", severity: "high", field: "name",
    title: "A listing shows a materially different name",
    why: "Two names over one address is what makes an engine resolve you as two businesses, splitting your reviews and your authority between them.",
    rootCause: "entity_ambiguity",
  },
  "LD-04": {
    code: "LD-04", severity: "medium", field: null,
    title: "A high-authority source has no listing at all",
    why: "Absence is not neutral here. A business with no profile on the record an engine reads first is answered from whatever else it can find.",
    rootCause: "location_radius_mismatch",
  },
  "LD-05": {
    code: "LD-05", severity: "low", field: "address",
    title: "A registry address differs from the trading address",
    why: "Usually correct and usually not worth changing — a registered office is not a shopfront. Worth knowing only because an engine reading the registry may quote it.",
    rootCause: "location_radius_mismatch",
  },
  "LD-06": {
    code: "LD-06", severity: "medium", field: null,
    title: "Service areas and listing locations do not agree",
    why: "You claim to serve an area no listing places you near. Local answers are distance-weighted, so the claim does not reach the queries it was written for.",
    rootCause: "location_radius_mismatch",
  },
  "LD-07": {
    code: "LD-07", severity: "medium", field: null,
    title: "The truth record has no address to check listings against",
    why: "Nothing here is wrong yet, because nothing can be compared. This is a gap in what you have told us, not a fault in a listing.",
    rootCause: "entity_ambiguity",
  },
  "LD-08": {
    code: "LD-08", severity: "low", field: null,
    title: "A listing exists but states no address or phone",
    why: "An empty profile still resolves as a profile. It does not contradict you; it just adds nothing an engine can use.",
    rootCause: "entity_ambiguity",
  },
});

export const LOCAL_FINDING_CODE_IDS = Object.freeze(Object.keys(LOCAL_FINDING_CODES));

const TOP_TIERS = new Set(["authoritative", "major_aggregator"]);

/**
 * Turn matches into findings.
 *
 * ⚠️ ONE FINDING PER PROBLEM, NOT ONE PER FIELD PER DIRECTORY. Eighteen sources
 * times four fields is seventy-two possible rows, and a queue that long is one
 * nobody works through. Findings are raised per (code, source) and carry the
 * fields inside them.
 */
export function localFindings(matches = [], { canonical = {}, uncheckedTopTier = [] } = {}) {
  const out = [];

  const hasCanonicalAddress = Boolean(String(canonical.address || "").trim());
  if (!hasCanonicalAddress) {
    out.push({ ...LOCAL_FINDING_CODES["LD-07"], sourceId: null, fields: ["address"] });
  }

  for (const m of matches.filter(Boolean)) {
    const isRegistry = SOURCE_BY_ID[m.sourceId]?.tier === "registry";

    if (m.mismatches.includes("address") || m.mismatches.includes("postal_code")) {
      const fields = m.mismatches.filter((f) => f === "address" || f === "postal_code");
      if (isRegistry) out.push({ ...LOCAL_FINDING_CODES["LD-05"], sourceId: m.sourceId, fields });
      else if (TOP_TIERS.has(m.tier)) out.push({ ...LOCAL_FINDING_CODES["LD-01"], sourceId: m.sourceId, fields });
      else out.push({ ...LOCAL_FINDING_CODES["LD-01"], severity: "medium", sourceId: m.sourceId, fields });
    }
    if (m.mismatches.includes("phone")) {
      out.push({ ...LOCAL_FINDING_CODES["LD-02"], sourceId: m.sourceId, fields: ["phone"] });
    }
    if (m.mismatches.includes("name")) {
      out.push({ ...LOCAL_FINDING_CODES["LD-03"], sourceId: m.sourceId, fields: ["name"] });
    }
    // An entirely empty listing: read, and stating nothing comparable.
    if (m.score === null && m.absent.length > 0) {
      out.push({ ...LOCAL_FINDING_CODES["LD-08"], sourceId: m.sourceId, fields: m.absent });
    }
  }

  for (const id of uncheckedTopTier) {
    if (TOP_TIERS.has(SOURCE_BY_ID[id]?.tier)) {
      out.push({ ...LOCAL_FINDING_CODES["LD-04"], sourceId: id, fields: [] });
    }
  }

  return out;
}

// ── Correction packs ───────────────────────────────────────────────────────

const PLACEHOLDER = (field) => `TODO: add your ${field} to the business truth record first`;

/**
 * What to paste into one directory to make it agree.
 *
 * 🔴 PLACEHOLDERS, NEVER INVENTIONS — the same rule the P1 construct templates
 * hold to, and for a sharper reason here: these values get pasted into a LIVE
 * public listing. A generated address that looks plausible and is wrong does
 * not get reviewed, it gets published, and then it is one more contradicting
 * record. `hasPlaceholders` drives the "needs your details" badge.
 */
export function correctionPack(sourceId, canonical = {}, match = null) {
  const source = SOURCE_BY_ID[sourceId];
  if (!source) return null;

  const wanted = NAP_FIELD_IDS.filter(
    (f) => source.publishes.includes(f) || (f === "postal_code" && source.publishes.includes("address")),
  );

  const values = {};
  for (const f of wanted) {
    const v = canonical[f];
    values[f] = v !== null && v !== undefined && String(v).trim() !== "" ? String(v).trim() : PLACEHOLDER(NAP_FIELDS[f].label.toLowerCase());
  }

  const needsChange = match
    ? match.fields.filter((r) => r.state === "mismatch" || r.state === "weak" || r.state === "absent").map((r) => r.field)
    : wanted;

  return {
    sourceId,
    sourceLabel: source.label,
    tier: source.tier,
    acquisition: source.acquisition,
    values,
    // Only what actually differs. A pack that says "change all four" when one is
    // wrong invites a re-type of three correct values, and re-typing is where
    // the next inconsistency comes from.
    changeFields: needsChange,
    hasPlaceholders: Object.values(values).some((v) => v.startsWith("TODO:")),
    note: source.note || null,
  };
}

export function hasPlaceholders(pack) {
  return Boolean(pack && pack.hasPlaceholders);
}

// ── Service radius ─────────────────────────────────────────────────────────

/**
 * Build the queries that test whether a claimed service area actually resolves.
 *
 * ⚠️ THE QUERIES ARE BUILT, NOT RUN. This is a pure builder; sampling them is
 * the citation path's job, under its own budget. Generating and executing in
 * one call is exactly the shape that produced this module's August 504.
 *
 * ⚠️ AND IT RETURNS NOTHING FOR A BUSINESS THAT DECLARED NO SERVICE AREA,
 * rather than inventing one from the address. "Near me" coverage for an area
 * the customer never claimed is a test they cannot fail meaningfully, and
 * failing it would produce LD-06 against a claim nobody made.
 */
export function serviceRadiusQueries({ categories = [], serviceAreas = [], brandName = null } = {}) {
  const areas = (Array.isArray(serviceAreas) ? serviceAreas : [])
    .map((a) => (typeof a === "string" ? a.trim() : ""))
    .filter(Boolean);
  const cats = (Array.isArray(categories) ? categories : [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean);

  if (!areas.length || !cats.length) {
    return {
      queries: [],
      reason: !areas.length
        ? "No service area has been declared, so there is nothing to test coverage against."
        : "No category has been declared, so a location query has nothing to ask for.",
    };
  }

  const queries = [];
  for (const area of areas) {
    for (const cat of cats) {
      queries.push({ intent: "discovery", area, category: cat, query: `${cat} in ${area}` });
      queries.push({ intent: "comparison", area, category: cat, query: `best ${cat} in ${area}` });
      if (brandName) {
        queries.push({ intent: "branded", area, category: cat, query: `${brandName} ${area}` });
      }
    }
  }
  return { queries, reason: null };
}

/**
 * Which declared service areas no checked listing places the business near.
 * Pure set arithmetic — it states the gap, it does not guess a cause.
 */
export function radiusCoverage({ serviceAreas = [], listingLocalities = [] } = {}) {
  const norm = (s) => normaliseAddressTokens(s).join(" ");
  const have = new Set(listingLocalities.map(norm).filter(Boolean));
  const want = (serviceAreas || []).map((a) => ({ area: a, key: norm(a) })).filter((a) => a.key);

  if (!want.length) return { covered: [], uncovered: [], coverage: null, reason: "No service area declared." };

  const covered = want.filter((w) => [...have].some((h) => h.includes(w.key) || w.key.includes(h)));
  const uncovered = want.filter((w) => !covered.includes(w));

  return {
    covered: covered.map((c) => c.area),
    uncovered: uncovered.map((u) => u.area),
    // null, not 0, when nothing was checked — the same rule as everywhere else.
    coverage: have.size ? covered.length / want.length : null,
    reason: have.size ? null : "No listing locality was read, so coverage could not be measured.",
  };
}
