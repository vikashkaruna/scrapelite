import { describe, it, expect } from "vitest";
import {
  SUBJECT_KINDS, SUBJECT_KIND_IDS, SUBJECT_REFS,
  makeSubject, refOf, scoreIdFor, sameSubject, subjectMismatchReason, describeSubject,
} from "./subjectModel.js";

const T = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
const R = "33333333-3333-3333-3333-333333333333";

describe("SUBJECT_KINDS — the vocabulary", () => {
  it("declares exactly the six kinds the CHECK constraint accepts", () => {
    expect(SUBJECT_KIND_IDS).toEqual(["page", "domain", "brand", "product", "service", "location"]);
  });

  it("every kind names at least one reference it is allowed to carry", () => {
    for (const k of SUBJECT_KIND_IDS) {
      expect(SUBJECT_KINDS[k].requires.length).toBeGreaterThan(0);
      for (const r of SUBJECT_KINDS[k].requires) expect(SUBJECT_REFS).toContain(r);
    }
  });

  it("domain is the ONLY kind that accepts two references", () => {
    const multi = SUBJECT_KIND_IDS.filter((k) => SUBJECT_KINDS[k].requires.length > 1);
    expect(multi).toEqual(["domain"]);
  });

  it("the three scored kinds map to the three subject-score formulas", () => {
    expect(scoreIdFor("brand")).toBe("brand");
    expect(scoreIdFor("product")).toBe("product");
    expect(scoreIdFor("service")).toBe("service");
  });

  it("page, domain and location have NO single-number formula, and say so with null", () => {
    // A score invented for a kind the PRD gives no formula for would be a
    // number nobody produced — the defect subjectScoring exists to prevent.
    expect(scoreIdFor("page")).toBeNull();
    expect(scoreIdFor("domain")).toBeNull();
    expect(scoreIdFor("location")).toBeNull();
  });
});

describe("makeSubject — refuses what the database refuses", () => {
  it("builds a page subject over a target", () => {
    const r = makeSubject({ kind: "page", targetId: T, label: "Pricing", canonicalDomain: "Acme.com" });
    expect(r.ok).toBe(true);
    expect(r.subject.subject_kind).toBe("page");
    expect(r.subject.target_id).toBe(T);
    expect(r.subject.entity_id).toBeNull();
    expect(r.subject.truth_record_id).toBeNull();
  });

  it("lower-cases the canonical domain — the bridge key must be spelled one way", () => {
    expect(makeSubject({ kind: "page", targetId: T, label: "x", canonicalDomain: "Acme.COM" }).subject.canonical_domain)
      .toBe("acme.com");
  });

  it("refuses a subject with NO reference", () => {
    const r = makeSubject({ kind: "page", label: "orphan" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exactly one reference/);
  });

  it("refuses a subject with TWO references — this is the whole point of D7", () => {
    const r = makeSubject({ kind: "page", targetId: T, entityId: E, label: "two" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exactly one reference/);
  });

  it("refuses a page subject pointing at an entity, and NAMES the mismatch", () => {
    const r = makeSubject({ kind: "page", entityId: E, label: "wrong" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/page subject must reference target/);
  });

  it("refuses a brand subject pointing at a target", () => {
    const r = makeSubject({ kind: "brand", targetId: T, label: "wrong" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/brand subject must reference entity/);
  });

  it("accepts a domain subject over EITHER a target or a truth record", () => {
    expect(makeSubject({ kind: "domain", targetId: T, label: "acme" }).ok).toBe(true);
    expect(makeSubject({ kind: "domain", truthRecordId: R, label: "acme" }).ok).toBe(true);
  });

  it("refuses a blank label", () => {
    expect(makeSubject({ kind: "page", targetId: T, label: "   " }).ok).toBe(false);
  });

  it("refuses an unknown kind rather than storing it", () => {
    const r = makeSubject({ kind: "campaign", targetId: T, label: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown subject kind/);
  });
});

describe("refOf", () => {
  it("names which of the three columns a stored subject uses", () => {
    expect(refOf({ target_id: T })).toBe("target");
    expect(refOf({ entity_id: E })).toBe("entity");
    expect(refOf({ truth_record_id: R })).toBe("truth_record");
    expect(refOf({})).toBeNull();
    expect(refOf(null)).toBeNull();
  });
});

describe("sameSubject — comparability, including every pre-0057 row", () => {
  it("two audits with the same subject are comparable", () => {
    expect(sameSubject({ subject_id: "s1", target_id: T }, { subject_id: "s1", target_id: T })).toBe(true);
  });

  it("two audits with DIFFERENT subjects are not — even over the same target", () => {
    // A brand audit and a page audit can share a target's domain. Falling back
    // to target_id here would compare a brand score against a page score.
    expect(sameSubject({ subject_id: "s1", target_id: T }, { subject_id: "s2", target_id: T })).toBe(false);
  });

  it("🔴 falls back to target_id when either side is a pre-0057 audit", () => {
    expect(sameSubject({ subject_id: null, target_id: T }, { subject_id: "s1", target_id: T })).toBe(true);
    expect(sameSubject({ subject_id: null, target_id: T }, { subject_id: null, target_id: T })).toBe(true);
  });

  it("🔴 two NULL subjects over DIFFERENT targets are NOT comparable", () => {
    // The trap this rule exists to avoid: treating null === null as a match
    // would make every pre-0057 audit comparable with every other one.
    expect(sameSubject({ subject_id: null, target_id: T }, { subject_id: null, target_id: "other" })).toBe(false);
  });

  it("an audit with neither a subject nor a target is comparable with nothing", () => {
    expect(sameSubject({ subject_id: null, target_id: null }, { subject_id: null, target_id: null })).toBe(false);
    expect(sameSubject({ subject_id: null, target_id: null }, { subject_id: "s1", target_id: T })).toBe(false);
  });

  it("refuses a missing side rather than throwing", () => {
    expect(sameSubject(null, { subject_id: "s1" })).toBe(false);
    expect(sameSubject({ subject_id: "s1" }, undefined)).toBe(false);
  });
});

describe("subjectMismatchReason", () => {
  it("returns null when the two ARE comparable", () => {
    expect(subjectMismatchReason({ subject_id: "s1" }, { subject_id: "s1" })).toBeNull();
  });

  it("says 'different subjects' when both carry one", () => {
    expect(subjectMismatchReason({ subject_id: "s1" }, { subject_id: "s2" }))
      .toMatch(/different subjects/);
  });

  it("says 'different pages' on the pre-0057 fallback path", () => {
    expect(subjectMismatchReason({ subject_id: null, target_id: T }, { subject_id: null, target_id: "other" }))
      .toMatch(/different pages/);
  });

  it("names the real problem when an audit records nothing to compare", () => {
    expect(subjectMismatchReason({ subject_id: null, target_id: null }, { subject_id: null, target_id: T }))
      .toMatch(/no subject and no target/);
  });
});

describe("describeSubject", () => {
  it("renders a stored row for a list without inventing anything", () => {
    expect(describeSubject({
      id: "s1", subject_kind: "brand", entity_id: E, label: "Acme Cloud", canonical_domain: "acme.com",
    })).toEqual({
      id: "s1", kind: "brand", kindLabel: "Brand", label: "Acme Cloud",
      canonicalDomain: "acme.com", ref: "entity", scoreId: "brand",
    });
  });

  it("returns null for nothing", () => {
    expect(describeSubject(null)).toBeNull();
  });
});
