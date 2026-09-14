import { describe, it, expect } from "vitest";
import {
  FACT_SOURCES, FACT_SOURCE_IDS, AUTO_CANONICAL_SOURCES,
  TRUTH_FIELDS, TRUTH_FIELD_IDS, TRUTH_FIELD_GROUPS, REQUIRED_FOR_CANONICAL,
  VERSION_STATES, VERSION_STATE_IDS, canTransition,
  TRUTH_CONFLICT_CODES,
  normalizeFieldValue, makeFact, isFact, pickCanonicalFact, buildFieldMap,
  truthCompleteness, readinessFor, canPromote, diffVersions, detectConflicts,
  summariseRecord, factsFromSchemaOrg,
} from "./businessTruth.js";
import { makeEvidence } from "./evidenceModel.js";

const AT = "2026-09-11T10:00:00.000Z";
const LATER = "2026-09-12T10:00:00.000Z";
const URL = "https://acme.example/about";

const ev = (overrides = {}) => makeEvidence({
  method: "raw_html", sourceUrl: URL, collectedAt: AT, ...overrides,
});

const declared = (field, value, extra = {}) =>
  makeFact({ field, value, source: "declared", statedBy: "owner@acme.example", statedAt: AT, ...extra });

const observed = (field, value, extra = {}) =>
  makeFact({ field, value, source: "observed", evidence: ev(), statedAt: AT, ...extra });

// ── Registries ─────────────────────────────────────────────────────────────

describe("FACT_SOURCES", () => {
  it("declares authority, verifiability and a warranty for every source", () => {
    for (const id of FACT_SOURCE_IDS) {
      const s = FACT_SOURCES[id];
      expect(typeof s.authority, id).toBe("number");
      expect(s.authority, id).toBeGreaterThan(0);
      expect(s.authority, id).toBeLessThanOrEqual(1);
      expect(typeof s.verifiable, id).toBe("boolean");
      expect(typeof s.observed, id).toBe("boolean");
      expect(s.label, id).toBeTruthy();
      expect(s.warranty, id).toBeTruthy();
    }
  });

  it("ranks a declaration above every web reading, and inference below all of them", () => {
    // Authority is not confidence. The owner knows their registered name better
    // than their own footer does; a model guessing at it knows least.
    expect(FACT_SOURCES.declared.authority).toBeGreaterThan(FACT_SOURCES.observed.authority);
    expect(FACT_SOURCES.imported.authority).toBeGreaterThan(FACT_SOURCES.observed.authority);
    const others = FACT_SOURCE_IDS.filter((id) => id !== "inferred").map((id) => FACT_SOURCES[id].authority);
    expect(FACT_SOURCES.inferred.authority).toBeLessThan(Math.min(...others));
  });

  it("marks exactly the two checkable sources as verifiable", () => {
    // If a source is added, this forces a decision about whether anyone outside
    // the company could check it — rather than letting it default.
    const verifiable = FACT_SOURCE_IDS.filter((id) => FACT_SOURCES[id].verifiable).sort();
    expect(verifiable).toEqual(["imported", "observed"]);
  });

  it("never lets an unverifiable source be auto-canonical unless a human stated it", () => {
    for (const id of AUTO_CANONICAL_SOURCES) {
      expect(FACT_SOURCES[id], id).toBeTruthy();
      expect(FACT_SOURCES[id].authority, id).toBeGreaterThanOrEqual(FACT_SOURCES.observed.authority);
    }
    expect(AUTO_CANONICAL_SOURCES).not.toContain("inferred");
  });
});

describe("TRUTH_FIELDS", () => {
  it("gives every field a known group, a known kind and a description", () => {
    const groups = new Set(TRUTH_FIELD_GROUPS.map((g) => g.id));
    const kinds = new Set(["text", "list", "urlList", "email", "phone", "url", "domain", "year", "object"]);
    for (const id of TRUTH_FIELD_IDS) {
      const f = TRUTH_FIELDS[id];
      expect(f.id, id).toBe(id);
      expect(groups.has(f.group), `${id} group ${f.group}`).toBe(true);
      expect(kinds.has(f.kind), `${id} kind ${f.kind}`).toBe(true);
      expect(f.label, id).toBeTruthy();
      expect(f.describes, id).toBeTruthy();
      expect(Array.isArray(f.requiredFor), id).toBe(true);
    }
  });

  it("gates promotion on the two identifying facts only", () => {
    // A gate that blocks on fifteen fields is a gate people type placeholders
    // past. Only what identifies the business blocks; everything else is
    // reported per-module by readinessFor().
    expect([...REQUIRED_FOR_CANONICAL].sort()).toEqual(["canonical_domain", "legal_name"]);
  });

  it("normalises every field kind it declares", () => {
    // A field whose kind has no normaliser silently accepts anything.
    for (const id of TRUTH_FIELD_IDS) {
      expect(normalizeFieldValue(id, "x"), id).not.toBe(undefined);
    }
  });
});

describe("VERSION_STATES", () => {
  it("has exactly one canonical state", () => {
    const canonical = VERSION_STATE_IDS.filter((id) => VERSION_STATES[id].canonical);
    expect(canonical).toEqual(["approved"]);
  });

  it("never lets a draft reach approved without passing review", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "approved")).toBe(true);
  });

  it("refuses transitions out of terminal states and between unknown states", () => {
    expect(canTransition("rejected", "draft")).toBe(false);
    expect(canTransition("superseded", "approved")).toBe(false);
    expect(canTransition("vibes", "approved")).toBe(false);
    expect(canTransition("draft", "vibes")).toBe(false);
  });

  it("points every declared `next` at a state that exists", () => {
    for (const id of VERSION_STATE_IDS) {
      for (const n of VERSION_STATES[id].next) {
        expect(VERSION_STATES[n], `${id} -> ${n}`).toBeTruthy();
      }
    }
  });
});

describe("TRUTH_CONFLICT_CODES", () => {
  it("keeps codes and their meanings stable — they are a public contract", () => {
    expect(Object.keys(TRUTH_CONFLICT_CODES).sort()).toEqual(["BT-01", "BT-02", "BT-03", "BT-04"]);
    expect(TRUTH_CONFLICT_CODES["BT-01"].label).toMatch(/contradict/i);
    expect(TRUTH_CONFLICT_CODES["BT-02"].label).toMatch(/absent/i);
    for (const [code, meta] of Object.entries(TRUTH_CONFLICT_CODES)) {
      expect(meta.code, code).toBe(code);
      expect(meta.severity, code).toBeTruthy();
    }
  });
});

// ── Normalisation ──────────────────────────────────────────────────────────

describe("normalizeFieldValue", () => {
  it("collapses whitespace and refuses an empty string", () => {
    expect(normalizeFieldValue("legal_name", "  Acme   Technologies  ")).toBe("Acme Technologies");
    expect(normalizeFieldValue("legal_name", "   ")).toBeNull();
  });

  it("strips presentation from a phone without inventing a country code", () => {
    // Guessing +91 for a 10-digit number would store an inference as a
    // declaration and match it against directories as though a human said it.
    expect(normalizeFieldValue("primary_phone", "(080) 4567-8901")).toBe("08045678901");
    expect(normalizeFieldValue("primary_phone", "+91 80 4567 8901")).toBe("+918045678901");
    expect(normalizeFieldValue("primary_phone", "12345")).toBeNull();
  });

  it("reduces a domain to a bare host so it can bridge to canonical_entities", () => {
    expect(normalizeFieldValue("canonical_domain", "https://www.Acme.Example/pricing")).toBe("acme.example");
    expect(normalizeFieldValue("canonical_domain", "WWW.acme.example")).toBe("acme.example");
    expect(normalizeFieldValue("canonical_domain", "not a domain")).toBeNull();
  });

  it("lower-cases an email and refuses one that is not an address", () => {
    expect(normalizeFieldValue("primary_email", " Sales@Acme.Example ")).toBe("sales@acme.example");
    expect(normalizeFieldValue("primary_email", "sales@acme")).toBeNull();
  });

  it("dedupes a list case-insensitively and keeps first-seen casing", () => {
    expect(normalizeFieldValue("categories", ["SaaS", "saas", " Analytics "])).toEqual(["SaaS", "Analytics"]);
    expect(normalizeFieldValue("categories", "SaaS, Analytics")).toEqual(["SaaS", "Analytics"]);
    expect(normalizeFieldValue("categories", [])).toBeNull();
  });

  it("drops non-URLs from a URL list rather than storing them", () => {
    expect(normalizeFieldValue("social_profiles", ["linkedin.com/company/acme", "nope"]))
      .toEqual(["https://linkedin.com/company/acme"]);
  });

  it("accepts a four-digit year and refuses a date it only half-knows", () => {
    expect(normalizeFieldValue("founded_year", "2014")).toBe(2014);
    expect(normalizeFieldValue("founded_year", 2014)).toBe(2014);
    expect(normalizeFieldValue("founded_year", "14")).toBeNull();
    expect(normalizeFieldValue("founded_year", "March 2014")).toBeNull();
  });

  it("returns null for an unknown field rather than passing the value through", () => {
    expect(normalizeFieldValue("favourite_colour", "blue")).toBeNull();
  });
});

// ── makeFact ───────────────────────────────────────────────────────────────

describe("makeFact — what it refuses to build", () => {
  it("refuses an unknown field or an unknown source", () => {
    expect(makeFact({ field: "vibes", value: "x", source: "declared", statedAt: AT })).toBeNull();
    expect(makeFact({ field: "legal_name", value: "Acme", source: "vibes", statedAt: AT })).toBeNull();
  });

  it("refuses an undated assertion", () => {
    expect(makeFact({ field: "legal_name", value: "Acme", source: "declared" })).toBeNull();
    expect(makeFact({ field: "legal_name", value: "Acme", source: "declared", statedAt: "not a date" })).toBeNull();
  });

  it("refuses a value that is not usable as that field's kind", () => {
    expect(makeFact({ field: "primary_email", value: "not-an-email", source: "declared", statedAt: AT })).toBeNull();
  });

  it("REFUSES an observed fact with no evidence attached", () => {
    // This is the guard that stops `observed` becoming a label anyone can put
    // on a guess. A claim of verifiability with nothing to verify against is a
    // guess wearing a warranty.
    expect(makeFact({ field: "legal_name", value: "Acme", source: "observed", statedAt: AT })).toBeNull();
    expect(makeFact({ field: "legal_name", value: "Acme", source: "imported", statedAt: AT })).toBeNull();
    expect(makeFact({
      field: "legal_name", value: "Acme", source: "observed", statedAt: AT, evidence: { method: "vibes" },
    })).toBeNull();
  });

  it("allows an unverifiable source with no evidence, because none is claimed", () => {
    expect(declared("legal_name", "Acme Technologies")).toBeTruthy();
    expect(makeFact({ field: "legal_name", value: "Acme", source: "inferred", statedAt: AT })).toBeTruthy();
  });

  it("carries the evidence record's own confidence when there is evidence", () => {
    const f = observed("legal_name", "Acme");
    expect(f.evidence).toBeTruthy();
    expect(f.confidence).toBe(0.99);          // raw_html
    expect(declared("legal_name", "Acme").confidence).toBe(FACT_SOURCES.declared.authority);
  });

  it("normalises the value it stores and freezes the result", () => {
    const f = declared("categories", ["SaaS", "saas"]);
    expect(f.value).toEqual(["SaaS"]);
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.value)).toBe(true);
  });

  it("recognises only what it would have produced", () => {
    expect(isFact(declared("legal_name", "Acme"))).toBe(true);
    expect(isFact({ field: "legal_name", value: "Acme" })).toBe(false);
    expect(isFact(null)).toBe(false);
    expect(isFact([declared("legal_name", "Acme")])).toBe(false);
  });
});

// ── Choosing a canonical value ─────────────────────────────────────────────

describe("pickCanonicalFact", () => {
  it("prefers the declaration over the page reading", () => {
    const page = observed("legal_name", "Acme Tech");
    const owner = declared("legal_name", "Acme Technologies Private Limited");
    expect(pickCanonicalFact([page, owner]).source).toBe("declared");
    expect(pickCanonicalFact([owner, page]).source).toBe("declared");
  });

  it("breaks a tie on recency", () => {
    const older = declared("brand_name", "Acme");
    const newer = makeFact({ field: "brand_name", value: "Acme Cloud", source: "declared", statedAt: LATER });
    expect(pickCanonicalFact([older, newer]).value).toBe("Acme Cloud");
  });

  it("ignores anything that is not a fact, and returns null when nothing is", () => {
    expect(pickCanonicalFact([null, { field: "legal_name" }])).toBeNull();
    expect(pickCanonicalFact([])).toBeNull();
    expect(pickCanonicalFact("nonsense")).toBeNull();
  });

  it("builds a one-fact-per-field map from loose candidates", () => {
    const map = buildFieldMap([
      observed("legal_name", "Acme Tech"),
      declared("legal_name", "Acme Technologies"),
      declared("canonical_domain", "acme.example"),
      null,
    ]);
    expect(Object.keys(map).sort()).toEqual(["canonical_domain", "legal_name"]);
    expect(map.legal_name.source).toBe("declared");
  });
});

// ── Completeness and readiness ─────────────────────────────────────────────

describe("truthCompleteness", () => {
  it("reports known against applicable, and names what is missing", () => {
    const fields = buildFieldMap([declared("legal_name", "Acme"), declared("canonical_domain", "acme.example")]);
    const c = truthCompleteness(fields);
    expect(c.known).toBe(2);
    expect(c.applicable).toBe(TRUTH_FIELD_IDS.length);
    expect(c.missing).toContain("primary_phone");
    expect(c.missing).not.toContain("legal_name");
    expect(c.percent).toBeCloseTo(Math.round((2 / TRUTH_FIELD_IDS.length) * 1000) / 10, 5);
  });

  it("EXCLUDES a not-applicable field and says so, rather than scoring it zero", () => {
    // A business with no premises has no street address. Counting that absence
    // against them reports a correct record as a deficient one.
    const fields = buildFieldMap([declared("legal_name", "Acme"), declared("canonical_domain", "acme.example")]);
    const c = truthCompleteness(fields, { notApplicable: ["street_address", "postal_code"] });
    expect(c.applicable).toBe(TRUTH_FIELD_IDS.length - 2);
    expect([...c.excluded].sort()).toEqual(["postal_code", "street_address"]);
    expect(c.missing).not.toContain("street_address");
    expect(c.percent).toBeGreaterThan(truthCompleteness(fields).percent);
  });

  it("does NOT excuse a field that is merely unfilled", () => {
    // The redistribution rule is about what does not apply, not about gaps.
    // An inventory that excused every gap would always read 100%.
    const c = truthCompleteness({});
    expect(c.known).toBe(0);
    expect(c.percent).toBe(0);
    expect(c.missing.length).toBe(TRUTH_FIELD_IDS.length);
  });

  it("ignores an unknown field id in notApplicable rather than shrinking the denominator", () => {
    const c = truthCompleteness({}, { notApplicable: ["favourite_colour"] });
    expect(c.applicable).toBe(TRUTH_FIELD_IDS.length);
    expect(c.excluded).toEqual([]);
  });
});

describe("readinessFor", () => {
  it("names the fields a module still needs instead of a bare 'incomplete'", () => {
    const fields = buildFieldMap([declared("canonical_domain", "acme.example")]);
    const r = readinessFor("local_directory", fields);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("primary_phone");
    expect(r.missing).toContain("locality");
    expect(r.missing).not.toContain("canonical_domain");
  });

  it("is ready once every field that module declared is present", () => {
    const fields = buildFieldMap([
      declared("canonical_domain", "acme.example"),
      declared("primary_phone", "+918045678901"),
      declared("street_address", "12 MG Road"),
      declared("locality", "Bengaluru"),
      declared("country", "IN"),
      declared("categories", ["Analytics"]),
    ]);
    expect(readinessFor("local_directory", fields).ready).toBe(true);
  });

  it("reports a module nothing requires as not-declaring rather than ready", () => {
    // "ready: true" for a module no field feeds would be a false green.
    const r = readinessFor("nothing_needs_this", {});
    expect(r.declares).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.requires).toEqual([]);
  });
});

// ── The approval gate ──────────────────────────────────────────────────────

describe("canPromote", () => {
  const goodFields = () => buildFieldMap([
    declared("legal_name", "Acme Technologies"),
    declared("canonical_domain", "acme.example"),
  ]);

  it("promotes an approved version with both identifying facts and two people", () => {
    const gate = canPromote({
      state: "approved", fields: goodFields(), proposed_by: "u1", reviewed_by: "u2",
    });
    expect(gate.ok).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("REFUSES self-approval", () => {
    // The whole value of "approved" is that a second person looked.
    const gate = canPromote({
      state: "approved", fields: goodFields(), proposed_by: "u1", reviewed_by: "u1",
    });
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toContain("self_approval");
  });

  it("refuses a version nobody reviewed", () => {
    const gate = canPromote({ state: "approved", fields: goodFields(), proposed_by: "u1" });
    expect(gate.blockers.map((b) => b.code)).toContain("no_approver");
  });

  it("refuses a draft however complete it is", () => {
    const gate = canPromote({
      state: "draft", fields: goodFields(), proposed_by: "u1", reviewed_by: "u2",
    });
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toContain("not_approved");
  });

  it("refuses an unknown state rather than treating it as a draft", () => {
    const gate = canPromote({ state: "totally_fine", fields: goodFields(), proposed_by: "u1", reviewed_by: "u2" });
    expect(gate.blockers.map((b) => b.code)).toContain("unknown_state");
  });

  it("names the missing identifying facts", () => {
    const gate = canPromote({
      state: "approved",
      fields: buildFieldMap([declared("brand_name", "Acme")]),
      proposed_by: "u1", reviewed_by: "u2",
    });
    const blocker = gate.blockers.find((b) => b.code === "missing_required");
    expect(blocker).toBeTruthy();
    expect([...blocker.fields].sort()).toEqual(["canonical_domain", "legal_name"]);
    expect(blocker.message).toMatch(/Legal name/);
  });

  it("refuses to make an inferred identity canonical", () => {
    const fields = buildFieldMap([
      makeFact({ field: "legal_name", value: "Acme Technologies", source: "inferred", statedAt: AT }),
      declared("canonical_domain", "acme.example"),
    ]);
    const gate = canPromote({ state: "approved", fields, proposed_by: "u1", reviewed_by: "u2" });
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toContain("inferred_required");
  });

  it("returns EVERY blocker at once, not the first", () => {
    // A reviewer told one problem, who fixes it and is then told a second,
    // learns to distrust the gate.
    const gate = canPromote({ state: "draft", fields: {}, proposed_by: "u1", reviewed_by: "u1" });
    const codes = gate.blockers.map((b) => b.code).sort();
    expect(codes).toEqual(["missing_required", "not_approved", "self_approval"]);
  });
});

// ── Diff ───────────────────────────────────────────────────────────────────

describe("diffVersions", () => {
  it("separates added, removed and changed", () => {
    const prev = { fields: buildFieldMap([declared("legal_name", "Acme"), declared("brand_name", "Acme")]) };
    const next = { fields: buildFieldMap([
      declared("legal_name", "Acme Technologies"),
      declared("canonical_domain", "acme.example"),
    ]) };
    const d = diffVersions(prev, next);
    expect(d.added.map((x) => x.field)).toEqual(["canonical_domain"]);
    expect(d.removed.map((x) => x.field)).toEqual(["brand_name"]);
    expect(d.changed.map((x) => x.field)).toEqual(["legal_name"]);
    expect(d.changed[0].from).toBe("Acme");
    expect(d.changed[0].to).toBe("Acme Technologies");
    expect(d.changeCount).toBe(3);
  });

  it("reports a SOURCE change with no value change as its own event", () => {
    // "We inferred your founding year, then you confirmed it" moves nothing on
    // screen but changes what the product may assert. Calling it `unchanged`
    // would hide the only thing that happened.
    const prev = { fields: buildFieldMap([makeFact({ field: "founded_year", value: 2014, source: "inferred", statedAt: AT })]) };
    const next = { fields: buildFieldMap([declared("founded_year", 2014)]) };
    const d = diffVersions(prev, next);
    expect(d.unchanged).toEqual([]);
    expect(d.resourced).toHaveLength(1);
    expect(d.resourced[0]).toMatchObject({ field: "founded_year", from_source: "inferred", to_source: "declared" });
    expect(d.changeCount).toBe(1);
  });

  it("treats an identical fact as unchanged and counts nothing", () => {
    const fields = buildFieldMap([declared("legal_name", "Acme")]);
    const d = diffVersions({ fields }, { fields });
    expect(d.unchanged.map((x) => x.field)).toEqual(["legal_name"]);
    expect(d.changeCount).toBe(0);
  });

  it("compares list values by content, not by reference", () => {
    const prev = { fields: buildFieldMap([declared("categories", ["Analytics", "SaaS"])]) };
    const next = { fields: buildFieldMap([declared("categories", ["Analytics", "SaaS"])]) };
    expect(diffVersions(prev, next).changeCount).toBe(0);

    const reordered = { fields: buildFieldMap([declared("categories", ["SaaS", "Analytics"])]) };
    expect(diffVersions(prev, reordered).changed).toHaveLength(1);
  });

  it("survives an empty or malformed version on either side", () => {
    expect(diffVersions({}, {}).changeCount).toBe(0);
    expect(diffVersions(null, undefined).changeCount).toBe(0);
  });
});

// ── Conflicts ──────────────────────────────────────────────────────────────

describe("detectConflicts", () => {
  const canonical = () => buildFieldMap([
    declared("legal_name", "Acme Technologies"),
    declared("primary_phone", "+918045678901"),
  ]);

  it("raises BT-01 when the page states something else", () => {
    const seen = buildFieldMap([observed("legal_name", "Globex Industries")]);
    const conflicts = detectConflicts(canonical(), seen, { fields: ["legal_name"] });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe("BT-01");
    expect(conflicts[0].canonical_value).toBe("Acme Technologies");
    expect(conflicts[0].observed_value).toBe("Globex Industries");
    expect(conflicts[0].evidence).toBeTruthy();
    expect(conflicts[0].evidence.source_url).toBe(URL);
  });

  it("raises BT-02 — a different code — when the page does not state it at all", () => {
    // Absence and contradiction have opposite remedies. Telling a customer
    // their address is wrong when their contact page simply never mentions it
    // wastes the fix.
    const conflicts = detectConflicts(canonical(), {}, { fields: ["legal_name"] });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe("BT-02");
    expect(conflicts[0].observed_value).toBeNull();
    expect(conflicts[0].message).toMatch(/not found/i);
  });

  it("never contradicts something it did not read — an observed-only field yields nothing", () => {
    const seen = buildFieldMap([observed("brand_name", "Acme Cloud")]);
    expect(detectConflicts({}, seen)).toEqual([]);
  });

  it("does not treat a shorter form of the same name as a contradiction", () => {
    // "Acme Ltd" on the page against "Acme Technologies Ltd" in the record is
    // a real-world abbreviation, not a disagreement. Flagging it teaches the
    // reader to dismiss the ones that matter.
    const seen = buildFieldMap([observed("legal_name", "Acme")]);
    expect(detectConflicts(canonical(), seen, { fields: ["legal_name"] })).toEqual([]);
  });

  it("ignores punctuation and case differences", () => {
    const seen = buildFieldMap([observed("legal_name", "acme  technologies.")]);
    expect(detectConflicts(canonical(), seen, { fields: ["legal_name"] })).toEqual([]);
  });

  it("skips list and object fields rather than text-comparing them", () => {
    const can = buildFieldMap([declared("categories", ["Analytics"])]);
    const seen = buildFieldMap([observed("categories", ["SaaS"])]);
    expect(detectConflicts(can, seen, { fields: ["categories"] })).toEqual([]);
  });

  it("scans every field by default and honours an explicit scope", () => {
    const seen = buildFieldMap([observed("legal_name", "Globex")]);
    const all = detectConflicts(canonical(), seen);
    expect(all.map((c) => c.field).sort()).toEqual(["legal_name", "primary_phone"]);
    const scoped = detectConflicts(canonical(), seen, { fields: ["primary_phone"] });
    expect(scoped.map((c) => c.code)).toEqual(["BT-02"]);
  });

  it("ignores an unknown field id in the scope", () => {
    expect(detectConflicts(canonical(), {}, { fields: ["favourite_colour"] })).toEqual([]);
  });
});

// ── Summary ────────────────────────────────────────────────────────────────

describe("summariseRecord", () => {
  it("tells a reviewer the state, the completeness and every blocker", () => {
    const version = {
      state: "pending_review",
      proposed_by: "u1",
      fields: buildFieldMap([
        declared("legal_name", "Acme Technologies"),
        makeFact({ field: "founded_year", value: 2014, source: "inferred", statedAt: AT }),
      ]),
    };
    const s = summariseRecord(version);
    expect(s.state).toBe("pending_review");
    expect(s.canonical).toBe(false);
    expect(s.promotable).toBe(false);
    expect(s.declaredCount).toBe(1);
    expect(s.inferredCount).toBe(1);
    expect(s.completeness.known).toBe(2);
    expect(s.blockers.map((b) => b.code)).toContain("not_approved");
  });

  it("reports an unknown state as null rather than guessing one", () => {
    const s = summariseRecord({ state: "whatever", fields: {} });
    expect(s.state).toBeNull();
    expect(s.canonical).toBe(false);
  });

  it("passes notApplicable through to completeness", () => {
    const s = summariseRecord({ state: "draft", fields: {} }, { notApplicable: ["street_address"] });
    expect(s.completeness.excluded).toEqual(["street_address"]);
  });
});

// ── Reading facts off a page ───────────────────────────────────────────────

describe("factsFromSchemaOrg", () => {
  const NODE = {
    "@type": "Organization",
    legalName: "Acme Technologies Private Limited",
    name: "Acme",
    url: "https://www.acme.example/",
    description: "Analytics for logistics.",
    telephone: "+91 80 4567 8901",
    email: "Hello@Acme.Example",
    foundingDate: "2014-03-01",
    logo: { url: "https://acme.example/logo.png" },
    sameAs: ["https://linkedin.com/company/acme", "not-a-url"],
    address: {
      streetAddress: "12 MG Road", addressLocality: "Bengaluru",
      addressRegion: "KA", postalCode: "560001", addressCountry: "IN",
    },
  };
  const opts = { sourceUrl: URL, collectedAt: AT };

  it("lifts the fields it maps and normalises each one", () => {
    const facts = factsFromSchemaOrg(NODE, opts);
    expect(facts.legal_name.value).toBe("Acme Technologies Private Limited");
    expect(facts.brand_name.value).toBe("Acme");
    expect(facts.primary_phone.value).toBe("+918045678901");
    expect(facts.primary_email.value).toBe("hello@acme.example");
    expect(facts.founded_year.value).toBe(2014);
    expect(facts.canonical_domain.value).toBe("acme.example");
    expect(facts.logo_url.value).toBe("https://acme.example/logo.png");
    expect(facts.locality.value).toBe("Bengaluru");
  });

  it("drops the junk inside a list rather than storing it", () => {
    expect(factsFromSchemaOrg(NODE, opts).social_profiles.value)
      .toEqual(["https://linkedin.com/company/acme"]);
  });

  it("🔴 marks every fact observed and attaches REAL evidence to each", () => {
    // makeFact refuses an observed fact with no evidence, so a mapper that
    // built object literals resembling evidence would silently produce nothing.
    const facts = factsFromSchemaOrg(NODE, opts);
    expect(Object.keys(facts).length).toBeGreaterThan(8);
    for (const [id, f] of Object.entries(facts)) {
      expect(f.source, id).toBe("observed");
      expect(f.observed, id).toBe(true);
      expect(f.evidence, id).toBeTruthy();
      expect(f.evidence.method, id).toBe("json_ld");
      expect(f.evidence.source_url, id).toBe(URL);
      expect(f.evidence.collected_at, id).toBe(AT);
    }
  });

  it("🔴 produces NOTHING without a source URL, rather than unevidenced facts", () => {
    // A page reading with nowhere to point is not a page reading.
    expect(factsFromSchemaOrg(NODE, { collectedAt: AT })).toEqual({});
    expect(factsFromSchemaOrg(NODE, { sourceUrl: URL })).toEqual({});
  });

  it("ranks everything it produces BELOW the owner's own declaration", () => {
    // What a page says is an observation about the business, never a decision
    // by it.
    const fromPage = factsFromSchemaOrg(NODE, opts).legal_name;
    const fromOwner = declared("legal_name", "Acme Technologies Pvt Ltd");
    expect(pickCanonicalFact([fromPage, fromOwner]).source).toBe("declared");
  });

  it("skips absent, empty and unreadable properties without throwing", () => {
    expect(factsFromSchemaOrg({ "@type": "Organization", name: "", address: null }, opts)).toEqual({});
    expect(factsFromSchemaOrg(null, opts)).toEqual({});
    expect(factsFromSchemaOrg([NODE], opts)).toEqual({});
    expect(factsFromSchemaOrg("Organization", opts)).toEqual({});
  });

  it("reads a LocalBusiness node through the same map", () => {
    const facts = factsFromSchemaOrg(
      { "@type": "LocalBusiness", name: "Acme", priceRange: "$$", telephone: "080-4567-8901" }, opts);
    expect(facts.price_range.value).toBe("$$");
    expect(facts.primary_phone.value).toBe("08045678901");
    expect(facts.brand_name.evidence.section).toMatch(/LocalBusiness/);
  });

  it("feeds detectConflicts end to end", () => {
    // The whole point: the record says one thing, the page says another, and
    // the finding carries the evidence for the page's side.
    const canonical = buildFieldMap([declared("legal_name", "Globex Industries")]);
    const seen = factsFromSchemaOrg(NODE, opts);
    const conflicts = detectConflicts(canonical, seen, { fields: ["legal_name"] });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe("BT-01");
    expect(conflicts[0].evidence.source_url).toBe(URL);
  });
});
