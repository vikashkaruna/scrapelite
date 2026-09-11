import { describe, it, expect, vi, beforeEach } from "vitest";

// Every external boundary is mocked; the routing, gating and shaping are real.
const authenticate = vi.fn();
const publicUrl = vi.fn();
const compliance = vi.fn();
const consent = vi.fn();
const entitlement = vi.fn();
const auditRun = vi.fn();
const storeMock = {};
const dispatchWebhook = vi.fn(async () => ({ delivered: 0, failed: 0, results: [] }));

vi.mock("../../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => authenticate(...a),
}));
vi.mock("../../functions/lib/publicUrl.js", () => ({
  isPublicHttpUrlAsync: (...a) => publicUrl(...a),
  isPublicHttpUrl: () => true,
  fetchPublicUrl: vi.fn(),
}));
vi.mock("../../functions/lib/complianceEngine.js", () => ({
  checkCompliance: (...a) => compliance(...a),
  fetchRobotsText: vi.fn(),
  evaluateAgentAccess: vi.fn(),
}));
vi.mock("../../functions/lib/scrapeConsent.js", () => ({
  hasScrapeConsent: (...a) => consent(...a),
}));
vi.mock("../../functions/lib/rateLimiter.js", () => ({
  takeTokenBlocking: vi.fn(async () => true),
  configFromEnv: () => ({ capacity: 5, refillPerSec: 1 }),
}));
vi.mock("../../functions/lib/requireEntitlement.js", async () => {
  const actual = await vi.importActual("../../functions/lib/requireEntitlement.js");
  return { ...actual, resolveRequestEntitlement: (...a) => entitlement(...a) };
});
vi.mock("../../functions/lib/audit/auditPipeline.js", () => ({
  runAudit: (...a) => auditRun(...a),
  inferPageType: vi.fn(),
  PIPELINE_STAGES: [],
}));
// 🔴 THE MOCK'S EXPORT LIST IS DERIVED FROM THE REAL MODULE, NOT COPIED.
// The older suite in this directory keeps a hand-written list and guards it
// with a parity test — which works, and which this file was about to duplicate
// a stale copy of. An async factory can `importActual`, so the names come from
// the module itself and cannot drift: a store export added tomorrow is mocked
// tomorrow, with no list to remember to update.
vi.mock("../../functions/lib/audit/auditStore.js", async () => {
  const real = await vi.importActual("../../functions/lib/audit/auditStore.js");
  return Object.fromEntries(Object.keys(real).map((name) => [
    name,
    (...args) => (storeMock[name] || (storeMock[name] = vi.fn()))(...args),
  ]));
});



const summarise = vi.fn();
vi.mock("../../functions/lib/audit/aiEvaluator.js", () => ({
  summariseAudit: (...a) => summarise(...a),
}));
vi.mock("../../functions/lib/audit/webhookDispatch.js", () => ({
  dispatchAuditEvent: (...a) => dispatchWebhook(...a),
  buildWebhookPayload: vi.fn(),
  WEBHOOK_EVENTS: ["audit.completed"],
}));

const { handler, parsePath, parseAuditOptions, MAX_BENCHMARK_URLS } =
  await import("../../functions/discoverability.js");
// The REAL plan map. Handing checkCapability a null map makes every request
// deny with UNKNOWN_PLAN, which would mask whichever gate the test is aiming at.
const { PLAN_BY_ID } = await import("../../../src/lib/pricingConfig.js");

const call = (method, splat, { body = null, query = {} } = {}) => handler({
  httpMethod: method,
  queryStringParameters: { splat, ...query },
  headers: { authorization: "Bearer token" },
  body: body ? JSON.stringify(body) : null,
});

const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(storeMock)) delete storeMock[k];
  authenticate.mockResolvedValue({ ok: true, user: { id: "user-1" } });
  publicUrl.mockResolvedValue(true);
  compliance.mockResolvedValue({ allowed: true, host: "example.com", code: "allowed" });
  consent.mockResolvedValue(false);
  entitlement.mockResolvedValue({
    userId: "user-1", guest: false, degraded: false,
    entitlement: { plan_id: "pro", status: "active" }, planMap: PLAN_BY_ID,
  });
  dispatchWebhook.mockResolvedValue({ delivered: 0, failed: 0, results: [] });
});

// ═══ W10 · /entity-graph ════════════════════════════════════════════════════

const ORG = { id: "e-org", entity_type: "organization", name: "Acme", state: "approved", source: "declared", created_at: "2026-09-11T10:00:00Z" };
const BRAND = { id: "e-brand", entity_type: "brand", name: "Acme Cloud", state: "approved", source: "declared", created_at: "2026-09-11T10:00:00Z" };
const REVIEW = { id: "e-rev", entity_type: "review", name: "A review", state: "approved", source: "declared", created_at: "2026-09-11T10:00:00Z" };

const relRow = (over = {}) => ({
  id: "r-1", subject_id: "e-org", predicate: "owns", object_id: "e-brand",
  state: "proposed", source: "declared", evidence_json: null, confidence: null,
  created_at: "2026-09-11T10:00:00Z", ...over,
});

describe("GET /entity-graph/schema", () => {
  it("serves fourteen types and nine predicates with their domains and ranges", () => {
    return call("GET", "entity-graph/schema").then((res) => {
      expect(res.statusCode).toBe(200);
      const b = parse(res);
      expect(b.entity_types).toHaveLength(14);
      expect(b.predicates).toHaveLength(9);
      expect(b.predicates.find((p) => p.id === "owns").domain).toEqual(["organization"]);
      expect(b.identifying_types).toContain("organization");
      expect(b.identifying_types).not.toContain("topic");
      expect(b.conflict_codes.map((c) => c.code)).toContain("EG-01");
      expect(b.review_states.map((s) => s.id)).toEqual(["proposed", "approved", "rejected"]);
    });
  });
});

describe("POST /entity-graph/entities", () => {
  beforeEach(() => {
    storeMock.createEntity = vi.fn(async () => ({ ok: true, entity: ORG }));
  });

  it("proposes an entity", async () => {
    const res = await call("POST", "entity-graph/entities", {
      body: { entity_type: "organization", name: "  Acme   Technologies " },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.createEntity.mock.calls[0][1].name).toBe("Acme Technologies");
  });

  it("refuses an unknown type and names what is allowed", async () => {
    const res = await call("POST", "entity-graph/entities", { body: { entity_type: "wizard", name: "Merlin" } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).allowed).toHaveLength(14);
    expect(storeMock.createEntity).not.toHaveBeenCalled();
  });

  it("refuses an unnamed node — it resolves nothing", async () => {
    const res = await call("POST", "entity-graph/entities", { body: { entity_type: "organization", name: "   " } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.createEntity).not.toHaveBeenCalled();
  });

  it("🔴 refuses a client claiming `observed` provenance", async () => {
    // Same rule as the truth record. `observed` promises somebody could go and
    // check; this endpoint has no evidence to attach.
    const res = await call("POST", "entity-graph/entities", {
      body: { entity_type: "organization", name: "Acme", source: "observed" },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("SOURCE_NOT_ACCEPTED");
    expect(storeMock.createEntity).not.toHaveBeenCalled();
  });

  it("normalises the bridge domain to a bare host", async () => {
    await call("POST", "entity-graph/entities", {
      body: { entity_type: "organization", name: "Acme", canonical_domain: "https://WWW.Acme.Example/x" },
    });
    expect(storeMock.createEntity.mock.calls[0][1].canonicalDomain).toBe("acme.example");
  });
});

describe("POST /entity-graph/relationships", () => {
  beforeEach(() => {
    storeMock.getEntity = vi.fn(async (u, id) =>
      ({ "e-org": ORG, "e-brand": BRAND, "e-rev": REVIEW }[id] || null));
    storeMock.createRelationship = vi.fn(async () => ({ ok: true, relationship: relRow() }));
  });

  it("proposes an edge that fits", async () => {
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "owns", object_id: "e-brand" },
    });
    expect(res.statusCode).toBe(201);
    expect(parse(res).relationship.state).toBe("proposed");
  });

  it("🔴 CHECKS THE SHAPE AGAINST THE STORED ENTITIES, not types the client sent", async () => {
    // A caller that could name its own endpoint types could declare any edge
    // legal, and the domain/range rules would enforce nothing.
    const res = await call("POST", "entity-graph/relationships", {
      body: {
        subject_id: "e-rev", predicate: "employs", object_id: "e-brand",
        subject_type: "organization", object_type: "person",   // lies, and ignored
      },
    });
    expect(res.statusCode).toBe(422);
    expect(parse(res).code).toBe("INVALID_RELATIONSHIP");
    expect(parse(res).problems.map((p) => p.code)).toContain("subject_out_of_domain");
    expect(storeMock.createRelationship).not.toHaveBeenCalled();
  });

  it("🔴 refuses a self-edge", async () => {
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "part_of", object_id: "e-org" },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("SELF_EDGE");
  });

  it("404s when an endpoint is not this user's", async () => {
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "owns", object_id: "somebody-elses" },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.createRelationship).not.toHaveBeenCalled();
  });

  it("refuses an unknown predicate and names the nine", async () => {
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "vibes", object_id: "e-brand" },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).allowed).toHaveLength(9);
  });

  it("🔴 refuses a client claiming `observed` provenance", async () => {
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "owns", object_id: "e-brand", source: "observed" },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("SOURCE_NOT_ACCEPTED");
  });

  it("reports a duplicate as 409 — re-observing corroborates, it does not add a copy", async () => {
    storeMock.createRelationship = vi.fn(async () => ({ ok: false, duplicate: true }));
    const res = await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "owns", object_id: "e-brand" },
    });
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe("RELATIONSHIP_EXISTS");
  });
});

describe("approving a relationship", () => {
  beforeEach(() => {
    storeMock.getRelationship = vi.fn(async () => relRow({ state: "approved" }));
    storeMock.listEntities = vi.fn(async () => [ORG, BRAND]);
    storeMock.listRelationships = vi.fn(async () => [relRow({ state: "approved" })]);
    storeMock.listGraphConflicts = vi.fn(async () => []);
    storeMock.recordGraphConflicts = vi.fn(async () => ({ ok: true, count: 0 }));
  });

  it("approves and reports the conflict sweep", async () => {
    storeMock.approveEntityRelationship = vi.fn(async () => ({ ok: true }));
    const res = await call("POST", "entity-graph/relationships/r-1/approve", { body: { note: "Checked." } });
    expect(res.statusCode).toBe(200);
    expect(parse(res).approved).toBe(true);
    expect(parse(res).conflicts).toMatchObject({ found: expect.any(Number), recorded: expect.any(Number) });
  });

  it("🔴 turns self-approval into 403", async () => {
    storeMock.approveEntityRelationship = vi.fn(async () => ({ ok: false, verdict: "self_approval" }));
    const res = await call("POST", "entity-graph/relationships/r-1/approve");
    expect(res.statusCode).toBe(403);
    expect(parse(res).error).toMatch(/second person/i);
  });

  it("🔴 turns a rejected endpoint into 409, naming why", async () => {
    // Approving the edge would silently revive a node somebody explicitly
    // rejected.
    storeMock.approveEntityRelationship = vi.fn(async () => ({ ok: false, verdict: "endpoint_rejected" }));
    const res = await call("POST", "entity-graph/relationships/r-1/approve");
    expect(res.statusCode).toBe(409);
    expect(parse(res).error).toMatch(/silently revive/i);
  });

  it("does not fall through to 200 on an unrecognised verdict", async () => {
    storeMock.approveEntityRelationship = vi.fn(async () => ({ ok: false, verdict: "something_new" }));
    expect((await call("POST", "entity-graph/relationships/r-1/approve")).statusCode).toBe(500);
  });

  it("🔴 there is no route that creates an approved row", async () => {
    storeMock.createRelationship = vi.fn(async () => ({ ok: true, relationship: relRow() }));
    storeMock.getEntity = vi.fn(async (u, id) => ({ "e-org": ORG, "e-brand": BRAND }[id] || null));
    await call("POST", "entity-graph/relationships", {
      body: { subject_id: "e-org", predicate: "owns", object_id: "e-brand", state: "approved" },
    });
    expect(storeMock.createRelationship.mock.calls[0][1].state).toBeUndefined();
  });
});

describe("🔴 the graph-conflict sweep actually WRITES", () => {
  // This repo's own history is three columns declared, merged and never
  // written. audit_entity_conflicts must not be the fourth.
  beforeEach(() => {
    storeMock.approveEntityRelationship = vi.fn(async () => ({ ok: true }));
    storeMock.getRelationship = vi.fn(async () => relRow({ state: "approved" }));
    storeMock.listGraphConflicts = vi.fn(async () => []);
    storeMock.recordGraphConflicts = vi.fn(async () => ({ ok: true, count: 1 }));
  });

  it("records a conflict the approved graph now contains", async () => {
    const HQ = { id: "e-hq", entity_type: "location", name: "Bengaluru", state: "approved", source: "declared", created_at: "2026-09-11T10:00:00Z" };
    const HQ2 = { id: "e-hq2", entity_type: "location", name: "Delhi", state: "approved", source: "declared", created_at: "2026-09-11T10:00:00Z" };
    storeMock.listEntities = vi.fn(async () => [ORG, HQ, HQ2]);
    storeMock.listRelationships = vi.fn(async () => [
      relRow({ id: "r-a", subject_id: "e-org", predicate: "located_at", object_id: "e-hq", state: "approved" }),
      relRow({ id: "r-b", subject_id: "e-org", predicate: "located_at", object_id: "e-hq2", state: "approved" }),
    ]);

    const res = await call("POST", "entity-graph/relationships/r-b/approve");
    expect(res.statusCode).toBe(200);
    expect(storeMock.recordGraphConflicts).toHaveBeenCalledTimes(1);
    const written = storeMock.recordGraphConflicts.mock.calls[0][3];
    expect(written.some((c) => c.code === "EG-01")).toBe(true);
    // The FK only ever receives a real entity id.
    expect(written.find((c) => c.code === "EG-01").subject_entity_id).toBe("e-org");
  });

  it("🔴 JOINS the endpoint types from the entities, so a cross-type sameAs is caught", async () => {
    // The edge row holds no types. Without the join, EG-03 could never fire on
    // a stored relationship — it would compare null against null for ever.
    storeMock.listEntities = vi.fn(async () => [ORG, BRAND]);
    storeMock.listRelationships = vi.fn(async () => [
      relRow({ id: "r-s", subject_id: "e-org", predicate: "same_as", object_id: "e-brand", state: "approved" }),
    ]);

    await call("POST", "entity-graph/relationships/r-s/approve");
    const written = storeMock.recordGraphConflicts.mock.calls[0][3];
    expect(written.some((c) => c.code === "EG-03")).toBe(true);
  });

  it("⚠️ does NOT re-write a conflict that is already open", async () => {
    // A queue that grows while nothing gets worse is a queue people stop
    // reading.
    storeMock.listEntities = vi.fn(async () => [ORG, BRAND]);
    storeMock.listRelationships = vi.fn(async () => [
      relRow({ id: "r-s", subject_id: "e-org", predicate: "same_as", object_id: "e-brand", state: "approved" }),
    ]);
    storeMock.listGraphConflicts = vi.fn(async () => [
      { id: "c-1", code: "EG-03", subject_id: "e-org", predicate: "same_as" },
    ]);

    await call("POST", "entity-graph/relationships/r-s/approve");
    expect(storeMock.recordGraphConflicts).not.toHaveBeenCalled();
  });

  it("🔴 never fails an approval that already succeeded", async () => {
    storeMock.listEntities = vi.fn(async () => { throw new Error("Supabase is down"); });
    const res = await call("POST", "entity-graph/relationships/r-1/approve");
    expect(res.statusCode).toBe(200);
    expect(parse(res).approved).toBe(true);
    expect(parse(res).conflicts).toBeNull();
  });
});

describe("rejection needs a reason", () => {
  it("🔴 refuses an entity rejection with no reason", async () => {
    storeMock.rejectGraphRow = vi.fn();
    const res = await call("POST", "entity-graph/entities/e-org/reject", { body: { reason: "  " } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("REASON_REQUIRED");
    expect(storeMock.rejectGraphRow).not.toHaveBeenCalled();
  });

  it("🔴 refuses a relationship rejection with no reason", async () => {
    storeMock.rejectGraphRow = vi.fn();
    const res = await call("POST", "entity-graph/relationships/r-1/reject", { body: {} });
    expect(res.statusCode).toBe(400);
    expect(storeMock.rejectGraphRow).not.toHaveBeenCalled();
  });

  it("accepts one that carries a reason", async () => {
    storeMock.rejectGraphRow = vi.fn(async () => ({ ok: true, row: relRow({ state: "rejected" }) }));
    const res = await call("POST", "entity-graph/relationships/r-1/reject", { body: { reason: "Wrong direction." } });
    expect(res.statusCode).toBe(200);
    expect(storeMock.rejectGraphRow.mock.calls[0][3]).toBe("Wrong direction.");
  });
});

describe("GET /entity-graph", () => {
  it("returns the graph with coverage computed by the pure model", async () => {
    storeMock.listEntities = vi.fn(async () => [ORG, BRAND]);
    storeMock.listRelationships = vi.fn(async () => [
      relRow({ state: "approved" }), relRow({ id: "r-2", state: "proposed" }),
    ]);
    storeMock.listGraphConflicts = vi.fn(async () => []);

    const b = parse(await call("GET", "entity-graph"));
    expect(b.entities).toHaveLength(2);
    expect(b.coverage.approvedRelations).toBe(1);
    expect(b.coverage.pendingReview).toBe(1);
    expect(b.coverage.predicatesUsed).toEqual(["owns"]);
    // Predicates nothing here could use are EXCLUDED, not counted as gaps.
    expect(b.coverage.predicatesExcluded).toContain("employs");
    expect(b.pending).toEqual({ entities: 0, relationships: 1 });
  });

  it("scopes to a truth record when asked", async () => {
    storeMock.listEntities = vi.fn(async () => []);
    storeMock.listRelationships = vi.fn(async () => []);
    storeMock.listGraphConflicts = vi.fn(async () => []);
    await call("GET", "entity-graph", { query: { truth_record_id: "rec-1" } });
    expect(storeMock.listEntities.mock.calls[0][1].truthRecordId).toBe("rec-1");
  });
});

describe("graph conflicts endpoint", () => {
  it("lists the open ones", async () => {
    storeMock.listGraphConflicts = vi.fn(async () => [{ id: "c1", code: "EG-02" }]);
    const b = parse(await call("GET", "entity-graph/conflicts"));
    expect(b.count).toBe(1);
  });

  it("refuses an invented resolution", async () => {
    storeMock.resolveGraphConflict = vi.fn();
    const res = await call("POST", "entity-graph/conflicts/c1/resolve", { body: { resolution: "shrug" } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.resolveGraphConflict).not.toHaveBeenCalled();
  });

  it("resolves one that names a real outcome", async () => {
    storeMock.resolveGraphConflict = vi.fn(async () => ({ ok: true }));
    const res = await call("POST", "entity-graph/conflicts/c1/resolve", { body: { resolution: "entity_merged" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("authentication", () => {
  it("refuses every entity-graph route without a session", async () => {
    authenticate.mockResolvedValue({ ok: false });
    for (const [m, p] of [["GET", "entity-graph"], ["GET", "entity-graph/schema"],
                          ["POST", "entity-graph/entities"], ["POST", "entity-graph/relationships"]]) {
      expect((await call(m, p)).statusCode, `${m} ${p}`).toBe(401);
    }
  });
});
