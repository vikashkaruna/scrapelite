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

// ═══ W9 · /business-truth ═══════════════════════════════════════════════════
//
// The routing, the gating and the shaping are real; only the store and the
// authentication boundary are doubled. These tests are about the rules the
// route enforces on top of the store — above all the ones that stop a fact
// becoming canonical without a second person, and the ones that stop a client
// claiming provenance it cannot have.

const AT = "2026-09-11T10:00:00.000Z";

const factRow = (field, value, source = "declared") => ({
  field, value, source,
  authority: source === "declared" ? 1 : 0.7,
  observed: false, evidence: null, confidence: 1,
  stated_by: "u", stated_at: AT, note: null,
});

const IDENTIFIED = {
  legal_name: factRow("legal_name", "Acme Technologies"),
  canonical_domain: factRow("canonical_domain", "acme.example"),
};

const RECORD = {
  id: "rec-1", user_id: "user-1", canonical_domain: "acme.example",
  display_name: "Acme", status: "active", current_version_id: null,
  not_applicable: [], workspace_id: null,
};

const version = (over = {}) => ({
  id: "ver-1", record_id: "rec-1", version_no: 1, state: "draft",
  fields_json: IDENTIFIED, completeness: 9.1, origin: "manual",
  proposed_by: "user-1", reviewed_by: null, reviewed_at: null, review_note: null,
  ...over,
});

describe("GET /business-truth/fields — reference data", () => {
  it("serves the field registry, the sources and the states", async () => {
    const res = await call("GET", "business-truth/fields");
    expect(res.statusCode).toBe(200);
    const b = parse(res);
    expect(b.fields.length).toBeGreaterThan(10);
    expect(b.groups.map((g) => g.id)).toContain("identity");
    expect(b.sources.map((s) => s.id).sort()).toEqual(["declared", "imported", "inferred", "observed"]);
    expect(b.required_for_canonical.sort()).toEqual(["canonical_domain", "legal_name"]);
    expect(b.conflict_codes.map((c) => c.code)).toContain("BT-01");
  });

  it("needs no record, so it is answered before any lookup", async () => {
    storeMock.getTruthRecord = vi.fn();
    await call("GET", "business-truth/fields");
    expect(storeMock.getTruthRecord).not.toHaveBeenCalled();
  });
});

describe("POST /business-truth — creating a record", () => {
  it("normalises the domain to a bare host before storing it", async () => {
    // The bridge key to canonical_entities. If the two sides spell it
    // differently we resolve the same company twice and disagree with ourselves.
    storeMock.createTruthRecord = vi.fn(async () => ({ ok: true, record: RECORD }));
    const res = await call("POST", "business-truth", {
      body: { canonical_domain: "https://WWW.Acme.Example/pricing" },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.createTruthRecord.mock.calls[0][1].canonicalDomain).toBe("acme.example");
  });

  it("refuses a domain it cannot normalise, rather than storing the raw string", async () => {
    storeMock.createTruthRecord = vi.fn();
    const res = await call("POST", "business-truth", { body: { canonical_domain: "not a domain" } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.createTruthRecord).not.toHaveBeenCalled();
  });

  it("reports a duplicate as 409, not 500 — the collision is the table working", async () => {
    storeMock.createTruthRecord = vi.fn(async () => ({ ok: false, duplicate: true }));
    const res = await call("POST", "business-truth", { body: { domain: "acme.example" } });
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe("RECORD_EXISTS");
    expect(parse(res).error).toMatch(/two answers/i);
  });

  it("drops unknown field ids from not_applicable rather than shrinking completeness by accident", async () => {
    storeMock.createTruthRecord = vi.fn(async () => ({ ok: true, record: RECORD }));
    await call("POST", "business-truth", {
      body: { domain: "acme.example", not_applicable: ["street_address", "favourite_colour"] },
    });
    expect(storeMock.createTruthRecord.mock.calls[0][1].notApplicable).toEqual(["street_address"]);
  });
});

describe("GET /business-truth/:id", () => {
  it("says a record has nothing approved rather than returning a blank canonical", async () => {
    // "none_approved" and "empty" are different diagnoses: one is a to-do, the
    // other is a bug. A blank canonical with no explanation reads as the second.
    storeMock.getTruthRecordFull = vi.fn(async () => ({ ...RECORD, versions: [version()], conflicts: [] }));
    const res = await call("GET", "business-truth/rec-1");
    expect(res.statusCode).toBe(200);
    expect(parse(res).canonical_state).toBe("none_approved");
    expect(parse(res).canonical).toBeNull();
  });

  it("attaches the pure model's verdict to every version it returns", async () => {
    storeMock.getTruthRecordFull = vi.fn(async () => ({
      ...RECORD, current_version_id: "ver-1",
      versions: [version({ state: "approved", reviewed_by: "user-2" })], conflicts: [],
    }));
    const b = parse(await call("GET", "business-truth/rec-1"));
    expect(b.canonical.summary.completeness.known).toBe(2);
    expect(b.canonical.gate.ok).toBe(true);
    expect(b.canonical_state).toBe("approved");
  });

  it("404s a record this user does not own", async () => {
    storeMock.getTruthRecordFull = vi.fn(async () => null);
    expect((await call("GET", "business-truth/rec-9")).statusCode).toBe(404);
  });
});

describe("POST /business-truth/:id/versions — proposing facts", () => {
  beforeEach(() => {
    storeMock.getTruthRecord = vi.fn(async () => RECORD);
    storeMock.createTruthVersion = vi.fn(async () => ({ ok: true, version: version() }));
  });

  it("🔴 REFUSES a client claiming `observed` or `imported`", async () => {
    // Those two sources promise somebody could go and check. This endpoint has
    // no evidence to attach, so accepting the claim would make verifiability a
    // flag anyone can set — the same defect as an `?consented=true` parameter.
    for (const source of ["observed", "imported"]) {
      const res = await call("POST", "business-truth/rec-1/versions", {
        body: { source, fields: { legal_name: "Acme" } },
      });
      expect(res.statusCode, source).toBe(400);
      expect(parse(res).code, source).toBe("SOURCE_NOT_ACCEPTED");
    }
    expect(storeMock.createTruthVersion).not.toHaveBeenCalled();
  });

  it("accepts declared and inferred, which claim no evidence", async () => {
    for (const source of ["declared", "inferred"]) {
      const res = await call("POST", "business-truth/rec-1/versions", {
        body: { source, fields: { legal_name: "Acme" } },
      });
      expect(res.statusCode, source).toBe(201);
    }
  });

  it("refuses an unknown source rather than defaulting one", async () => {
    const res = await call("POST", "business-truth/rec-1/versions", {
      body: { source: "vibes", fields: { legal_name: "Acme" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("REPORTS the fields it could not store instead of dropping them silently", async () => {
    // A field the caller sent and we did not keep is the one thing they most
    // need told.
    const res = await call("POST", "business-truth/rec-1/versions", {
      body: { fields: { legal_name: "Acme", favourite_colour: "blue", primary_email: "nope" } },
    });
    expect(res.statusCode).toBe(201);
    const rejected = parse(res).rejected;
    expect(rejected).toEqual(expect.arrayContaining([
      { field: "favourite_colour", reason: "unknown_field" },
      { field: "primary_email", reason: "unusable_value" },
    ]));
  });

  it("stores a NEW version as a draft — never approved, whatever the body asks", async () => {
    await call("POST", "business-truth/rec-1/versions", {
      body: { state: "approved", fields: { legal_name: "Acme" } },
    });
    const arg = storeMock.createTruthVersion.mock.calls[0][2];
    expect(arg.origin).toBe("manual");
    expect(arg.state).toBeUndefined();      // the store's own default is `draft`
  });

  it("computes completeness against the record's not-applicable list", async () => {
    storeMock.getTruthRecord = vi.fn(async () => ({ ...RECORD, not_applicable: ["street_address"] }));
    await call("POST", "business-truth/rec-1/versions", { body: { fields: { legal_name: "Acme" } } });
    const withExclusion = storeMock.createTruthVersion.mock.calls[0][2].completeness;

    storeMock.getTruthRecord = vi.fn(async () => RECORD);
    storeMock.createTruthVersion = vi.fn(async () => ({ ok: true, version: version() }));
    await call("POST", "business-truth/rec-1/versions", { body: { fields: { legal_name: "Acme" } } });
    expect(withExclusion).toBeGreaterThan(storeMock.createTruthVersion.mock.calls[0][2].completeness);
  });

  it("refuses a body with no usable facts at all", async () => {
    const res = await call("POST", "business-truth/rec-1/versions", { body: { fields: { nope: "x" } } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.createTruthVersion).not.toHaveBeenCalled();
  });

  it("reports a racing proposal as 409 rather than overwriting it", async () => {
    storeMock.createTruthVersion = vi.fn(async () => ({ ok: false, conflict: true }));
    const res = await call("POST", "business-truth/rec-1/versions", { body: { fields: { legal_name: "Acme" } } });
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe("VERSION_CONFLICT");
  });
});

describe("version verbs — submit, withdraw, reject", () => {
  beforeEach(() => {
    storeMock.setTruthVersionState = vi.fn(async (u, r, v, state) => ({ ok: true, version: version({ state }) }));
  });

  it("submits a draft for review", async () => {
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "draft" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/submit");
    expect(res.statusCode).toBe(200);
    expect(storeMock.setTruthVersionState.mock.calls[0][3]).toBe("pending_review");
  });

  it("🔴 refuses a transition the lifecycle does not allow", async () => {
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "superseded" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/submit");
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe("INVALID_TRANSITION");
    expect(storeMock.setTruthVersionState).not.toHaveBeenCalled();
  });

  it("🔴 refuses a rejection with no reason", async () => {
    // Three months from now the reason is the only thing that explains the
    // decision. Refused here, and again by a CHECK constraint.
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "pending_review" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/reject", { body: { note: "   " } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("REASON_REQUIRED");
    expect(storeMock.setTruthVersionState).not.toHaveBeenCalled();
  });

  it("accepts a rejection that carries one", async () => {
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "pending_review" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/reject", {
      body: { note: "Address is the old office." },
    });
    expect(res.statusCode).toBe(200);
    expect(storeMock.setTruthVersionState.mock.calls[0][4].note).toBe("Address is the old office.");
  });

  it("404s a version this user cannot see", async () => {
    storeMock.getTruthVersion = vi.fn(async () => null);
    expect((await call("POST", "business-truth/rec-1/versions/ver-9/submit")).statusCode).toBe(404);
  });

  it("does not recognise an invented verb", async () => {
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "draft" }));
    expect((await call("POST", "business-truth/rec-1/versions/ver-1/yolo")).statusCode).toBe(404);
  });
});

describe("promotion — the approval gate on the wire", () => {
  beforeEach(() => {
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "pending_review" }));
  });

  it("promotes and returns the refreshed record", async () => {
    storeMock.promoteTruthVersion = vi.fn(async () => ({ ok: true }));
    storeMock.getTruthRecordFull = vi.fn(async () => ({
      ...RECORD, current_version_id: "ver-1",
      versions: [version({ state: "approved", reviewed_by: "user-2" })], conflicts: [],
    }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/promote", { body: { note: "Checked." } });
    expect(res.statusCode).toBe(200);
    expect(parse(res).promoted).toBe(true);
    expect(parse(res).record.current_version_id).toBe("ver-1");
  });

  it("🔴 turns a self-approval verdict into 403, not a generic failure", async () => {
    storeMock.promoteTruthVersion = vi.fn(async () => ({ ok: false, verdict: "self_approval" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/promote");
    expect(res.statusCode).toBe(403);
    expect(parse(res).error).toMatch(/second person/i);
  });

  it("turns a missing identifying fact into 422, naming both facts", async () => {
    storeMock.promoteTruthVersion = vi.fn(async () => ({ ok: false, verdict: "missing_required" }));
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/promote");
    expect(res.statusCode).toBe(422);
    expect(parse(res).error).toMatch(/Legal name/);
    expect(parse(res).error).toMatch(/Canonical domain/);
  });

  it("turns an unreviewable state into 409", async () => {
    storeMock.promoteTruthVersion = vi.fn(async () => ({ ok: false, verdict: "not_reviewable" }));
    expect((await call("POST", "business-truth/rec-1/versions/ver-1/promote")).statusCode).toBe(409);
  });

  it("does not fall through to a 200 on an unrecognised verdict", async () => {
    // Fails safe: an unknown verdict is our fault, never a silent success that
    // makes an unapproved fact canonical.
    storeMock.promoteTruthVersion = vi.fn(async () => ({ ok: false, verdict: "something_new" }));
    expect((await call("POST", "business-truth/rec-1/versions/ver-1/promote")).statusCode).toBe(500);
  });

  it("🔴 there is no PATCH path to `approved` — promotion is the only way in", async () => {
    // A second promotion path would be the one that forgets the interlocks.
    storeMock.getTruthVersion = vi.fn(async () => version({ state: "pending_review" }));
    storeMock.setTruthVersionState = vi.fn();
    const res = await call("POST", "business-truth/rec-1/versions/ver-1/approve");
    expect(res.statusCode).toBe(404);
    expect(storeMock.setTruthVersionState).not.toHaveBeenCalled();
  });
});

describe("GET /business-truth/:id/diff", () => {
  const v1 = version({ id: "v1", version_no: 1, fields_json: { legal_name: factRow("legal_name", "Acme") } });
  const v2 = version({ id: "v2", version_no: 2, fields_json: IDENTIFIED });

  it("defaults to the newest version against the one before it", async () => {
    storeMock.getTruthRecordFull = vi.fn(async () => ({ ...RECORD, versions: [v2, v1], conflicts: [] }));
    const b = parse(await call("GET", "business-truth/rec-1/diff"));
    expect(b.comparable).toBe(true);
    expect(b.from.version_no).toBe(1);
    expect(b.to.version_no).toBe(2);
    expect(b.diff.added.map((x) => x.field)).toEqual(["canonical_domain"]);
    expect(b.diff.changed.map((x) => x.field)).toEqual(["legal_name"]);
  });

  it("says WHY the first version is not comparable instead of returning an empty diff", async () => {
    // An empty diff with no explanation reads as "nothing changed".
    storeMock.getTruthRecordFull = vi.fn(async () => ({ ...RECORD, versions: [v1], conflicts: [] }));
    const b = parse(await call("GET", "business-truth/rec-1/diff"));
    expect(b.comparable).toBe(false);
    expect(b.reason).toMatch(/first version/i);
  });

  it("honours explicit from and to", async () => {
    storeMock.getTruthRecordFull = vi.fn(async () => ({ ...RECORD, versions: [v2, v1], conflicts: [] }));
    const b = parse(await call("GET", "business-truth/rec-1/diff", { query: { from: "v2", to: "v1" } }));
    expect(b.from.version_no).toBe(2);
    expect(b.diff.removed.map((x) => x.field)).toEqual(["canonical_domain"]);
  });
});

describe("conflicts", () => {
  it("lists the open ones", async () => {
    storeMock.getTruthRecordFull = vi.fn(async () => ({
      ...RECORD, versions: [],
      conflicts: [{ id: "c1", code: "BT-01", field: "legal_name" }],
    }));
    const b = parse(await call("GET", "business-truth/rec-1/conflicts"));
    expect(b.count).toBe(1);
    expect(b.conflicts[0].code).toBe("BT-01");
  });

  it("refuses an invented resolution", async () => {
    storeMock.resolveTruthConflict = vi.fn();
    const res = await call("POST", "business-truth/rec-1/conflicts/c1", { body: { resolution: "ignored" } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.resolveTruthConflict).not.toHaveBeenCalled();
  });

  it("resolves one that names a real outcome", async () => {
    storeMock.resolveTruthConflict = vi.fn(async () => ({ ok: true }));
    const res = await call("POST", "business-truth/rec-1/conflicts/c1", { body: { resolution: "page_updated" } });
    expect(res.statusCode).toBe(200);
    expect(storeMock.resolveTruthConflict.mock.calls[0][3]).toBe("page_updated");
  });
});

describe("authentication", () => {
  it("refuses every business-truth route without a session", async () => {
    authenticate.mockResolvedValue({ ok: false });
    for (const [m, p] of [["GET", "business-truth"], ["POST", "business-truth"],
                          ["GET", "business-truth/rec-1"], ["GET", "business-truth/fields"]]) {
      expect((await call(m, p)).statusCode, `${m} ${p}`).toBe(401);
    }
  });
});

// ═══ The audit → truth-record check ═════════════════════════════════════════
//
// 🔴 THIS IS THE TEST THAT MATTERS MOST IN THIS FILE. This repo's own history
// is three columns across two migrations that were declared, reviewed, merged
// and never written — invisible, because the read path returns null exactly as
// it would for "not applicable". audit_business_truth_conflicts must not be the
// fourth, so these assert the WRITE.

const AUDIT_RESULT = {
  status: "completed", unreachable: false, finalScore: 78.4, seoScore: 75,
  aeoScore: 82, geoScore: 71, coverage: 92.5,
  pillars: {}, frameworks: {}, issues: [], recommendations: [],
  penalties: [], penaltyMultiplier: 1, evidence: {},
  target: { page_type: "article" }, meta: { engine: {} }, scoreMath: {},
  facts: {
    organization_node: {
      "@type": "Organization",
      legalName: "Globex Industries",
      telephone: "+91 80 1111 2222",
    },
  },
};

function happyAudit() {
  storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 0, degraded: false }));
  storeMock.findByIdempotencyKey = vi.fn(async () => null);
  storeMock.ensureTarget = vi.fn(async () => "target-1");
  storeMock.createAudit = vi.fn(async () => ({ ok: true, audit: { id: "audit-1" } }));
  storeMock.persistResult = vi.fn(async () => ({ ok: true }));
  storeMock.persistPromptRuns = vi.fn(async () => ({ ok: true }));
  storeMock.recordEvent = vi.fn(async () => {});
  auditRun.mockResolvedValue({ ...AUDIT_RESULT });
}

const CANONICAL_VERSION = {
  id: "ver-1", record_id: "rec-1", version_no: 3, state: "approved",
  fields_json: {
    legal_name: factRow("legal_name", "Acme Technologies"),
    primary_phone: factRow("primary_phone", "+918045678901"),
    // Not readable from a schema.org node, so it must never become a finding.
    registry_identifiers: { ...factRow("registry_identifiers", { gstin: "29A" }), value: { gstin: "29a" } },
  },
};

const runAuditOn = (url = "https://acme.example/pricing") =>
  call("POST", "audits", { body: { target_url: url } });

describe("audit → business truth", () => {
  beforeEach(happyAudit);

  it("🔴 WRITES the conflicts it finds, rather than only returning them", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => ({ ok: true, count: 2 }));

    const res = await runAuditOn();
    expect(res.statusCode).toBe(201);
    expect(storeMock.recordTruthConflicts).toHaveBeenCalledTimes(1);

    const [recordId, auditId, versionId, conflicts] = storeMock.recordTruthConflicts.mock.calls[0];
    expect(recordId).toBe("rec-1");
    expect(auditId).toBe("audit-1");
    expect(versionId).toBe("ver-1");
    expect(conflicts.map((c) => `${c.code}:${c.field}`).sort())
      .toEqual(["BT-01:legal_name", "BT-01:primary_phone"]);
    expect(conflicts[0].evidence.source_url).toBe("https://acme.example/pricing");
  });

  it("reports the check on the audit response so the UI need not re-fetch", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => ({ ok: true, count: 2 }));

    const b = parse(await runAuditOn());
    expect(b.businessTruth.record_id).toBe("rec-1");
    expect(b.businessTruth.version_no).toBe(3);
    expect(b.businessTruth.identity_markup_present).toBe(true);
    expect(b.businessTruth.conflicts).toHaveLength(2);
  });

  it("🔴 SCOPES the check to fields a page could have stated", async () => {
    // Without a scope, every field the record holds that this page never
    // mentions becomes a BT-02, and one audit of a blog post raises twenty
    // absences. A page not stating the GSTIN is not a finding.
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => ({ ok: true, count: 2 }));

    const b = parse(await runAuditOn());
    expect(b.businessTruth.checked_fields).toEqual(["legal_name", "primary_phone"]);
    expect(b.businessTruth.conflicts.map((c) => c.field)).not.toContain("registry_identifiers");
  });

  it("🔴 NEVER compares a page against an UNAPPROVED draft", async () => {
    // Raising findings against facts nobody agreed are true is the exact effect
    // the approval gate exists to prevent.
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: null },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn();
    storeMock.recordTruthConflicts = vi.fn();

    const b = parse(await runAuditOn());
    expect(storeMock.getCanonicalTruthVersion).not.toHaveBeenCalled();
    expect(storeMock.recordTruthConflicts).not.toHaveBeenCalled();
    expect(b.businessTruth).toBeUndefined();
  });

  it("does nothing when this domain has no record at all", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-2", canonical_domain: "globex.example", current_version_id: "ver-9" },
    ]);
    storeMock.recordTruthConflicts = vi.fn();
    const res = await runAuditOn();
    expect(res.statusCode).toBe(201);
    expect(storeMock.recordTruthConflicts).not.toHaveBeenCalled();
  });

  it("writes nothing when the page agrees with the record", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => ({
      ...CANONICAL_VERSION,
      fields_json: {
        legal_name: factRow("legal_name", "Globex Industries"),
        primary_phone: factRow("primary_phone", "+918011112222"),
      },
    }));
    storeMock.recordTruthConflicts = vi.fn();

    const b = parse(await runAuditOn());
    expect(storeMock.recordTruthConflicts).not.toHaveBeenCalled();
    expect(b.businessTruth.conflicts).toEqual([]);
    // "We compared and found nothing" — distinct from having nothing to compare.
    expect(b.businessTruth.identity_markup_present).toBe(true);
  });

  it("says so when the page carried no identity markup to compare against", async () => {
    auditRun.mockResolvedValue({ ...AUDIT_RESULT, facts: {} });
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => ({ ok: true, count: 2 }));

    const b = parse(await runAuditOn());
    expect(b.businessTruth.identity_markup_present).toBe(false);
    // Everything in scope is now an ABSENCE, not a contradiction.
    expect(b.businessTruth.conflicts.every((c) => c.code === "BT-02")).toBe(true);
  });

  it("🔴 NEVER fails an audit the user has already been charged for", async () => {
    // The audit ran. A truth record that is briefly unreadable is not a reason
    // to lose it.
    storeMock.listTruthRecords = vi.fn(async () => { throw new Error("Supabase is down"); });
    const res = await runAuditOn();
    expect(res.statusCode).toBe(201);
    expect(parse(res).businessTruth).toBeUndefined();
    expect(parse(res).persisted).toBe(true);
  });

  it("survives the conflict write itself failing", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => { throw new Error("write failed"); });
    expect((await runAuditOn()).statusCode).toBe(201);
  });

  it("matches the record by normalised host, not by the audited URL", async () => {
    storeMock.listTruthRecords = vi.fn(async () => [
      { id: "rec-1", canonical_domain: "acme.example", current_version_id: "ver-1" },
    ]);
    storeMock.getCanonicalTruthVersion = vi.fn(async () => CANONICAL_VERSION);
    storeMock.recordTruthConflicts = vi.fn(async () => ({ ok: true, count: 2 }));

    const b = parse(await runAuditOn("https://WWW.Acme.Example/deep/page?x=1"));
    expect(b.businessTruth.record_id).toBe("rec-1");
  });
});
