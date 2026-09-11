import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES, ENTITY_TYPE_IDS, IDENTIFYING_TYPES,
  PREDICATES, PREDICATE_IDS, SYMMETRIC_PREDICATES,
  RELATION_SOURCES, RELATION_SOURCE_IDS,
  REVIEW_STATES, REVIEW_STATE_IDS, canReview,
  GRAPH_CONFLICT_CODES,
  makeEntity, isEntity, makeRelation, isRelation, isApproved,
  validateRelation, canApproveRelation,
  buildIndex, objectsOf, detectGraphConflicts, graphCoverage,
} from "./entityGraph.js";
import { makeEvidence } from "./evidenceModel.js";

const AT = "2026-09-11T10:00:00.000Z";
const URL = "https://acme.example/about";
const ev = () => makeEvidence({ method: "json_ld", sourceUrl: URL, collectedAt: AT });

const entity = (type, name, over = {}) =>
  makeEntity({ type, name, source: "declared", statedAt: AT, ...over });

const rel = (subjectType, predicate, objectType, over = {}) => makeRelation({
  subjectId: over.subjectId || "s1", subjectType,
  predicate,
  objectId: over.objectId || "o1", objectType,
  source: "declared", statedAt: AT, ...over,
});

const approve = (r) => ({ ...r, state: "approved" });

// ── Registries ─────────────────────────────────────────────────────────────

describe("ENTITY_TYPES", () => {
  it("declares the fourteen the plan calls for", () => {
    expect(ENTITY_TYPE_IDS).toHaveLength(14);
  });

  it("maps every type to a schema.org class, so the graph and the markup agree", () => {
    for (const id of ENTITY_TYPE_IDS) {
      const t = ENTITY_TYPES[id];
      expect(t.id, id).toBe(id);
      expect(t.schemaType, id).toBeTruthy();
      expect(t.label, id).toBeTruthy();
      expect(t.describes, id).toBeTruthy();
      expect(typeof t.identifying, id).toBe("boolean");
    }
  });

  it("marks as identifying only the types that can anchor a graph", () => {
    // An Organization is somebody. A Topic is not, and treating it as an anchor
    // would make "unconnected entity" fire on ordinary subject matter.
    expect([...IDENTIFYING_TYPES].sort())
      .toEqual(["brand", "location", "organization", "person", "product", "service"]);
  });
});

describe("PREDICATES", () => {
  it("declares the nine the plan calls for", () => {
    expect(PREDICATE_IDS).toHaveLength(9);
  });

  it("gives every predicate a domain and a range drawn from real types", () => {
    // Without this a graph is a bag of edges: "this review employs that topic"
    // is storable, meaningless, and impossible to notice later.
    for (const id of PREDICATE_IDS) {
      const p = PREDICATES[id];
      expect(p.domain.length, id).toBeGreaterThan(0);
      expect(p.range.length, id).toBeGreaterThan(0);
      for (const t of [...p.domain, ...p.range]) expect(ENTITY_TYPES[t], `${id}:${t}`).toBeTruthy();
      expect(typeof p.functional, id).toBe("boolean");
      expect(p.inverse, id).toBeTruthy();
      expect(p.describes, id).toBeTruthy();
    }
  });

  it("identifies the symmetric predicates by their own inverse", () => {
    expect([...SYMMETRIC_PREDICATES].sort()).toEqual(["competes_with", "same_as"]);
  });

  it("marks exactly the one-value relationships as functional", () => {
    // If a predicate is added, this forces a decision about whether a second
    // approved value is richer data or a contradiction.
    const functional = PREDICATE_IDS.filter((id) => PREDICATES[id].functional).sort();
    expect(functional).toEqual(["located_at", "part_of"]);
  });
});

describe("RELATION_SOURCES and REVIEW_STATES", () => {
  it("ranks a declaration above an observation and inference below both", () => {
    expect(RELATION_SOURCES.declared.authority).toBeGreaterThan(RELATION_SOURCES.observed.authority);
    expect(RELATION_SOURCES.inferred.authority).toBeLessThan(RELATION_SOURCES.observed.authority);
  });

  it("marks exactly the checkable source as verifiable", () => {
    expect(RELATION_SOURCE_IDS.filter((id) => RELATION_SOURCES[id].verifiable)).toEqual(["observed"]);
  });

  it("has exactly one approved state, and refuses unknown transitions", () => {
    expect(REVIEW_STATE_IDS.filter((id) => REVIEW_STATES[id].approved)).toEqual(["approved"]);
    expect(canReview("proposed", "approved")).toBe(true);
    expect(canReview("rejected", "approved")).toBe(false);
    expect(canReview("approved", "proposed")).toBe(false);
    expect(canReview("vibes", "approved")).toBe(false);
  });
});

describe("GRAPH_CONFLICT_CODES", () => {
  it("keeps codes stable — they are a public contract", () => {
    expect(Object.keys(GRAPH_CONFLICT_CODES).sort())
      .toEqual(["EG-01", "EG-02", "EG-03", "EG-04", "EG-05", "EG-06"]);
    for (const [code, meta] of Object.entries(GRAPH_CONFLICT_CODES)) {
      expect(meta.code, code).toBe(code);
      expect(meta.severity, code).toBeTruthy();
      expect(meta.label, code).toBeTruthy();
    }
  });
});

// ── Entities ───────────────────────────────────────────────────────────────

describe("makeEntity", () => {
  it("refuses an unknown type, an unknown source and an unnamed node", () => {
    expect(makeEntity({ type: "vibes", name: "x", source: "declared", statedAt: AT })).toBeNull();
    expect(makeEntity({ type: "organization", name: "x", source: "vibes", statedAt: AT })).toBeNull();
    // An unnamed node resolves nothing, which is the only job an entity has.
    expect(entity("organization", "   ")).toBeNull();
    expect(entity("organization", "Acme", { statedAt: null })).toBeNull();
  });

  it("🔴 refuses an OBSERVED entity with no evidence", () => {
    expect(makeEntity({ type: "organization", name: "Acme", source: "observed", statedAt: AT })).toBeNull();
    expect(makeEntity({
      type: "organization", name: "Acme", source: "observed", statedAt: AT, evidence: ev(),
    })).toBeTruthy();
  });

  it("normalises the bridge domain to a bare host", () => {
    // canonical_entities is UNIQUE on this column. Two spellings resolve one
    // company twice, and the halves then disagree.
    expect(entity("organization", "Acme", { canonicalDomain: "https://WWW.Acme.Example/x" }).canonical_domain)
      .toBe("acme.example");
    expect(entity("organization", "Acme", { canonicalDomain: "nonsense" }).canonical_domain).toBeNull();
  });

  it("carries the evidence record's confidence, and the source's authority otherwise", () => {
    const observed = makeEntity({ type: "brand", name: "Acme", source: "observed", statedAt: AT, evidence: ev() });
    expect(observed.confidence).toBe(0.99);
    expect(entity("brand", "Acme").confidence).toBe(RELATION_SOURCES.declared.authority);
  });

  it("recognises only what it would have produced", () => {
    expect(isEntity(entity("organization", "Acme"))).toBe(true);
    expect(isEntity({ type: "organization", name: "Acme" })).toBe(false);
    expect(isEntity(null)).toBe(false);
  });
});

// ── Relation shape ─────────────────────────────────────────────────────────

describe("validateRelation", () => {
  it("accepts an edge that fits", () => {
    expect(validateRelation({ subjectType: "organization", predicate: "owns", objectType: "brand" }).ok).toBe(true);
  });

  it("🔴 refuses an edge that could not be true in principle", () => {
    const r = validateRelation({ subjectType: "review", predicate: "employs", objectType: "topic" });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code).sort()).toEqual(["object_out_of_range", "subject_out_of_domain"]);
    expect(r.problems[0].message).toBeTruthy();
  });

  it("refuses an unknown predicate without also guessing at the types", () => {
    const r = validateRelation({ subjectType: "organization", predicate: "vibes", objectType: "brand" });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ code: "unknown_predicate", predicate: "vibes" }]);
  });

  it("names an unknown type rather than silently allowing it", () => {
    const r = validateRelation({ subjectType: "wizard", predicate: "owns", objectType: "brand" });
    expect(r.problems.map((p) => p.code)).toContain("unknown_subject_type");
  });
});

describe("makeRelation", () => {
  it("builds an edge that fits, always in the proposed state", () => {
    // Nothing creates an approved edge. An edge a crawler read and nobody
    // looked at is a suggestion, and treating it as knowledge is how a graph
    // fills with confident nonsense.
    const r = rel("organization", "owns", "brand");
    expect(r.state).toBe("proposed");
    expect(isApproved(r)).toBe(false);
  });

  it("🔴 refuses an edge whose endpoints do not fit the predicate", () => {
    expect(rel("review", "employs", "topic")).toBeNull();
    expect(rel("organization", "employs", "topic")).toBeNull();
  });

  it("🔴 refuses a SELF-edge", () => {
    // "Acme is part of Acme" is vacuously true and pollutes every traversal.
    expect(rel("organization", "part_of", "organization", { subjectId: "x", objectId: "x" })).toBeNull();
    expect(rel("organization", "same_as", "organization", { subjectId: "x", objectId: "x" })).toBeNull();
  });

  it("🔴 refuses an OBSERVED edge with no evidence", () => {
    expect(rel("organization", "owns", "brand", { source: "observed" })).toBeNull();
    expect(rel("organization", "owns", "brand", { source: "observed", evidence: ev() })).toBeTruthy();
  });

  it("refuses an unknown predicate, an unknown source and an undated edge", () => {
    expect(rel("organization", "vibes", "brand")).toBeNull();
    expect(rel("organization", "owns", "brand", { source: "vibes" })).toBeNull();
    expect(rel("organization", "owns", "brand", { statedAt: "nope" })).toBeNull();
  });

  it("refuses an edge with a missing endpoint id", () => {
    expect(rel("organization", "owns", "brand", { subjectId: "" })).toBeNull();
    expect(rel("organization", "owns", "brand", { objectId: null })).toBeNull();
  });
});

// ── The approval gate ──────────────────────────────────────────────────────

describe("canApproveRelation", () => {
  const r = () => rel("organization", "owns", "brand");

  it("approves a well-formed proposal reviewed by somebody else", () => {
    const gate = canApproveRelation(r(), { proposedBy: "u1", reviewerId: "u2" });
    expect(gate.ok).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("🔴 REFUSES self-approval", () => {
    // An edge one person both proposed and approved has had exactly as much
    // review as one nobody looked at.
    const gate = canApproveRelation(r(), { proposedBy: "u1", reviewerId: "u1" });
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toContain("self_approval");
  });

  it("refuses with no approver at all", () => {
    expect(canApproveRelation(r(), { proposedBy: "u1" }).blockers.map((b) => b.code)).toContain("no_approver");
  });

  it("refuses to revive a rejection", () => {
    const gate = canApproveRelation({ ...r(), state: "rejected" }, { proposedBy: "u1", reviewerId: "u2" });
    expect(gate.blockers.map((b) => b.code)).toContain("rejected");
  });

  it("refuses an edge that is not a relation at all", () => {
    expect(canApproveRelation({ nope: true }, { reviewerId: "u2" }).blockers.map((b) => b.code))
      .toEqual(["not_a_relation"]);
  });

  it("🔴 refuses an approved-shaped row whose endpoints do not fit", () => {
    // Unreachable through makeRelation — which is exactly why it is checked.
    // A row that got in another way is the one nobody is looking for.
    const bad = { ...r(), subject_type: "review", object_type: "topic", predicate: "employs" };
    const gate = canApproveRelation(bad, { proposedBy: "u1", reviewerId: "u2" });
    expect(gate.blockers.map((b) => b.code)).toContain("invalid_shape");
  });

  it("refuses an observed edge that lost its evidence", () => {
    const stripped = { ...rel("organization", "owns", "brand", { source: "observed", evidence: ev() }), evidence: null };
    expect(canApproveRelation(stripped, { proposedBy: "u1", reviewerId: "u2" }).blockers.map((b) => b.code))
      .toContain("no_evidence");
  });

  it("returns every blocker at once", () => {
    const gate = canApproveRelation({ ...r(), state: "rejected" }, { proposedBy: "u1", reviewerId: "u1" });
    expect(gate.blockers.map((b) => b.code).sort()).toEqual(["rejected", "self_approval"]);
  });
});

// ── Traversal ──────────────────────────────────────────────────────────────

describe("buildIndex and objectsOf", () => {
  it("🔴 indexes APPROVED edges only", () => {
    // A proposal is a suggestion. Reasoning over it would make the review queue
    // change the answers before anyone reviewed anything.
    const idx = buildIndex([rel("organization", "owns", "brand")]);
    expect(idx.bySubject.size).toBe(0);
  });

  it("indexes a symmetric predicate BOTH ways from one stored row", () => {
    // Writing competes_with twice would double every count and make "who do we
    // compete with" depend on which row was read first.
    const r = approve(rel("organization", "competes_with", "organization",
      { subjectId: "acme", objectId: "globex" }));
    const idx = buildIndex([r]);
    expect(objectsOf(idx, "acme", "competes_with")).toEqual(["globex"]);
    expect(objectsOf(idx, "globex", "competes_with")).toEqual(["acme"]);
    expect(idx.byPredicate.get("competes_with")).toHaveLength(1);
  });

  it("does not index an asymmetric predicate backwards", () => {
    const idx = buildIndex([approve(rel("organization", "owns", "brand",
      { subjectId: "acme", objectId: "cloud" }))]);
    expect(objectsOf(idx, "acme", "owns")).toEqual(["cloud"]);
    expect(objectsOf(idx, "cloud", "owns")).toEqual([]);
  });

  it("survives junk in the relation list", () => {
    expect(buildIndex([null, { nope: true }, "x"]).bySubject.size).toBe(0);
    expect(buildIndex(null).bySubject.size).toBe(0);
    expect(objectsOf(null, "x", "owns")).toEqual([]);
  });
});

// ── Conflicts ──────────────────────────────────────────────────────────────

describe("detectGraphConflicts", () => {
  const ents = { acme: entity("organization", "Acme"), hq: entity("location", "Bengaluru") };

  it("🔴 EG-01 — two approved values for a one-value relationship", () => {
    const conflicts = detectGraphConflicts(ents, [
      approve(rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq" })),
      approve(rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq2" })),
    ]);
    const c = conflicts.find((x) => x.code === "EG-01");
    expect(c).toBeTruthy();
    expect(c.values).toEqual(["hq", "hq2"]);
  });

  it("does not report a functional predicate re-stating the SAME value", () => {
    // Two rows agreeing is corroboration, not a contradiction.
    const conflicts = detectGraphConflicts(ents, [
      approve(rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq" })),
      approve(rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq" })),
    ]);
    expect(conflicts.filter((c) => c.code === "EG-01")).toHaveLength(0);
  });

  it("🔴 EG-02 — a cycle in the hierarchy, reported ONCE", () => {
    // A hierarchy that loops makes every rollup either infinite or silently
    // truncated, and the truncation is the dangerous one: it looks like an
    // answer.
    const conflicts = detectGraphConflicts({}, [
      approve(rel("organization", "part_of", "organization", { subjectId: "a", objectId: "b" })),
      approve(rel("organization", "part_of", "organization", { subjectId: "b", objectId: "c" })),
      approve(rel("organization", "part_of", "organization", { subjectId: "c", objectId: "a" })),
    ]);
    expect(conflicts.filter((c) => c.code === "EG-02")).toHaveLength(1);
  });

  it("does not report a plain chain as a cycle", () => {
    const conflicts = detectGraphConflicts({}, [
      approve(rel("organization", "part_of", "organization", { subjectId: "a", objectId: "b" })),
      approve(rel("organization", "part_of", "organization", { subjectId: "b", objectId: "c" })),
    ]);
    expect(conflicts.filter((c) => c.code === "EG-02")).toHaveLength(0);
  });

  it("🔴 EG-03 — sameAs across two different types", () => {
    // Not a merge, a category error — following it corrupts every traversal
    // that trusted the type.
    const conflicts = detectGraphConflicts({}, [
      approve(rel("organization", "same_as", "product", { subjectId: "acme", objectId: "cloud" })),
    ]);
    expect(conflicts.find((c) => c.code === "EG-03")).toBeTruthy();
  });

  it("accepts sameAs between two records of the SAME type", () => {
    const conflicts = detectGraphConflicts({}, [
      approve(rel("organization", "same_as", "organization", { subjectId: "a", objectId: "b" })),
    ]);
    expect(conflicts.filter((c) => c.code === "EG-03")).toHaveLength(0);
  });

  it("EG-04 — an approved row whose endpoints do not fit, however it got in", () => {
    const smuggled = { ...rel("organization", "owns", "brand"), state: "approved", object_type: "review" };
    expect(detectGraphConflicts({}, [smuggled]).find((c) => c.code === "EG-04")).toBeTruthy();
  });

  it("🔴 EG-05 — an IDENTIFYING entity nothing connects to", () => {
    const conflicts = detectGraphConflicts({ acme: entity("organization", "Acme") }, []);
    const c = conflicts.find((x) => x.code === "EG-05");
    expect(c).toBeTruthy();
    expect(c.message).toMatch(/Acme/);
  });

  it("does NOT report an unconnected non-identifying entity", () => {
    // A Topic nothing points at yet is an ordinary state of affairs. An
    // Organization nothing points at is a node that resolves nobody.
    expect(detectGraphConflicts({ t: entity("topic", "Logistics") }, [])
      .filter((c) => c.code === "EG-05")).toHaveLength(0);
  });

  it("EG-06 — an approved edge resting on inference alone", () => {
    const inferred = approve(rel("organization", "owns", "brand", { source: "inferred" }));
    expect(detectGraphConflicts({}, [inferred]).find((c) => c.code === "EG-06")).toBeTruthy();
  });

  it("🔴 reads APPROVED edges only — a proposal never conflicts", () => {
    // Reporting a proposal as a conflict would make the review queue argue with
    // itself.
    const conflicts = detectGraphConflicts(ents, [
      approve(rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq" })),
      rel("organization", "located_at", "location", { subjectId: "acme", objectId: "hq2" }),
    ]);
    expect(conflicts.filter((c) => c.code === "EG-01")).toHaveLength(0);
  });

  it("carries the evidence of the offending edge where there is any", () => {
    const c = detectGraphConflicts({}, [
      approve(rel("organization", "same_as", "product",
        { subjectId: "a", objectId: "b", source: "observed", evidence: ev() })),
    ]).find((x) => x.code === "EG-03");
    expect(c.evidence.source_url).toBe(URL);
  });

  it("survives empty and malformed input", () => {
    expect(detectGraphConflicts()).toEqual([]);
    expect(detectGraphConflicts(null, null)).toEqual([]);
    expect(detectGraphConflicts([{ nope: 1 }], [null])).toEqual([]);
  });

  it("🔴 accepts an ARRAY without also registering every index as an entity", () => {
    // Object.entries over an array yields "0", "1", "2" as keys. Reading both
    // ways registered each entity twice — once under its id, once under its
    // index — and EG-05 then fired on a node called "1" that nothing connects
    // to. This assertion counts, because the version that only checked EG-05
    // EXISTED passed against the broken code.
    const a = { ...entity("organization", "Acme"), id: "acme" };
    const b = { ...entity("brand", "Acme Cloud"), id: "cloud" };
    const found = detectGraphConflicts([a, b], []).filter((c) => c.code === "EG-05");
    expect(found.map((c) => c.subject_id).sort()).toEqual(["acme", "cloud"]);
  });

  it("🔴 a connected array entity raises no EG-05 at all", () => {
    const a = { ...entity("organization", "Acme"), id: "acme" };
    const b = { ...entity("brand", "Acme Cloud"), id: "cloud" };
    const found = detectGraphConflicts([a, b], [
      approve(rel("organization", "owns", "brand", { subjectId: "acme", objectId: "cloud" })),
    ]);
    expect(found.filter((c) => c.code === "EG-05")).toEqual([]);
  });
});

// ── Coverage ───────────────────────────────────────────────────────────────

describe("graphCoverage", () => {
  it("🔴 EXCLUDES a predicate no entity here could use, and says which", () => {
    // Counting `employs` against a graph with no people would mark down a
    // product catalogue for having no staff directory.
    const c = graphCoverage([entity("organization", "Acme"), entity("brand", "Acme")], []);
    expect(c.predicatesExcluded).toContain("employs");
    expect(c.predicatesExcluded).toContain("about");
    expect(c.predicatesApplicable).toContain("owns");
  });

  it("reports the fraction of APPLICABLE predicates actually used", () => {
    const ents = [
      { ...entity("organization", "Acme"), id: "acme" },
      { ...entity("brand", "Acme Cloud"), id: "cloud" },
    ];
    const none = graphCoverage(ents, []);
    expect(none.percent).toBe(0);

    const some = graphCoverage(ents, [
      approve(rel("organization", "owns", "brand", { subjectId: "acme", objectId: "cloud" })),
    ]);
    expect(some.predicatesUsed).toEqual(["owns"]);
    expect(some.percent).toBeGreaterThan(0);
    expect(some.approvedRelations).toBe(1);
  });

  it("counts proposals separately from approved edges", () => {
    const c = graphCoverage([entity("organization", "Acme"), entity("brand", "B")], [
      rel("organization", "owns", "brand"),
      approve(rel("organization", "owns", "brand", { objectId: "o2" })),
    ]);
    expect(c.pendingReview).toBe(1);
    expect(c.approvedRelations).toBe(1);
  });

  it("reports null rather than zero when NOTHING is applicable", () => {
    // An empty graph has no coverage to report. Zero would read as "we checked
    // nine predicates and found none", which is a different claim.
    expect(graphCoverage([], []).percent).toBeNull();
  });

  it("accepts entities as a map as well as an array", () => {
    const c = graphCoverage({ a: entity("organization", "Acme"), b: entity("brand", "B") }, []);
    expect(c.entities).toBe(2);
  });
});
