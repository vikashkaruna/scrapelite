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
  // The caller owns its own references by default, so every test that is not
  // ABOUT ownership reads as it did before the guard existed. A test that wants
  // the refusal overrides these to return null, the way the store answers for a
  // row belonging to someone else.
  storeMock.getTruthRecord = vi.fn(async () => ({ id: "rec-1", user_id: "user-1" }));
  storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1" }));
  storeMock.getAudit = vi.fn(async () => ({ id: "aud-1", user_id: "user-1" }));
  publicUrl.mockResolvedValue(true);
  compliance.mockResolvedValue({ allowed: true, host: "example.com", code: "allowed" });
  consent.mockResolvedValue(false);
  entitlement.mockResolvedValue({
    userId: "user-1", guest: false, degraded: false,
    entitlement: { plan_id: "pro", status: "active" }, planMap: PLAN_BY_ID,
  });
  dispatchWebhook.mockResolvedValue({ delivered: 0, failed: 0, results: [] });
});

// ═══ W13 · /schema-trust ════════════════════════════════════════════════════

const ORG = { "@type": "Organization", name: "Acme", url: "https://acme.com", "@id": "https://acme.com/#org" };

describe("GET /schema-trust/schema-registry", () => {
  it("publishes the registries so a client never hardcodes them", () => {
    // The same reason the local-directory schema route exists: a client that
    // restates the vocabulary drifts from it, exactly as EVENT_TO_SOURCE did.
    return call("GET", "schema-trust/schema-registry").then((res) => {
      const b = parse(res);
      expect(res.statusCode).toBe(200);
      expect(b.excluded_types).toContain("WebSite");
      expect(b.independence.map((i) => i.id)).toEqual(
        expect.arrayContaining(["self_published", "self_attributed", "third_party"]));
      expect(b.tc_components).toHaveLength(6);
    });
  });
});

describe("POST /schema-trust/schema", () => {
  it("🔴 ACTUALLY WRITES — declared-and-never-written is this schema's own failure mode", async () => {
    // Four columns in this schema have been declared, reviewed, merged and
    // written by nothing. The contract test asserts the CALL, not the response.
    storeMock.saveSchemaEntity = vi.fn(async () => ({ ok: true, entity: { id: "se-1" } }));
    const res = await call("POST", "schema-trust/schema", {
      body: { json_ld: [ORG], page_type: "homepage", canonical_domain: "acme.com", subject_id: "subj-1" },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.saveSchemaEntity).toHaveBeenCalledWith("user-1", expect.objectContaining({
      schemaType: "Organization", validity: "valid", subjectId: "subj-1",
    }));
    expect(parse(res).persisted).toBe(1);
  });

  it("records an incomplete block as incomplete, naming what is missing", async () => {
    storeMock.saveSchemaEntity = vi.fn(async () => ({ ok: true, entity: { id: "se-2" } }));
    await call("POST", "schema-trust/schema", { body: { json_ld: [{ "@type": "Organization" }] } });
    expect(storeMock.saveSchemaEntity).toHaveBeenCalledWith("user-1", expect.objectContaining({
      validity: "incomplete", missingProperties: ["name", "url"],
    }));
  });

  it("does not write a WebSite block — it is excluded, not judged", async () => {
    storeMock.saveSchemaEntity = vi.fn(async () => ({ ok: true, entity: {} }));
    const res = await call("POST", "schema-trust/schema", {
      body: { json_ld: [{ "@type": "WebSite", url: "https://acme.com", potentialAction: {} }] },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.saveSchemaEntity).not.toHaveBeenCalled();
  });

  it("refuses a request carrying neither blocks nor a type", async () => {
    storeMock.saveSchemaEntity = vi.fn();
    const res = await call("POST", "schema-trust/schema", { body: {} });
    expect(res.statusCode).toBe(400);
    expect(storeMock.saveSchemaEntity).not.toHaveBeenCalled();
  });

  it("returns the gaps, with a contradiction ahead of an absence", async () => {
    storeMock.saveSchemaEntity = vi.fn(async () => ({ ok: true, entity: {} }));
    const res = await call("POST", "schema-trust/schema", {
      body: { json_ld: [{ "@type": "FAQPage", mainEntity: [{}] }], visible_faq: 0, page_type: "faq" },
    });
    expect(parse(res).gaps[0]).toMatchObject({ component: "fidelity", severity: "contradiction" });
  });
});

describe("🔴 POST /schema-trust/trust — provenance is never taken from the body", () => {
  it("REFUSES an `independence` claim from a request body", async () => {
    // It decides whether a claim is worth 25% or 100%. A client that could set
    // it could mint third-party standing for its own testimonials — the same
    // defect as `acquisition: authorized_api` and `?consented=true`.
    storeMock.saveTrustObservation = vi.fn();
    const res = await call("POST", "schema-trust/trust", {
      body: { signal: "ratings", independence: "third_party", observed_count: 40 },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/derived from the evidence/i);
    expect(storeMock.saveTrustObservation).not.toHaveBeenCalled();
  });

  it("records an observation WITH a source as independent", async () => {
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: true, observation: { id: "t-1" } }));
    await call("POST", "schema-trust/trust", {
      body: { signal: "ratings", observed_count: 6, source_url: "https://g2.com/acme" },
    });
    expect(storeMock.saveTrustObservation).toHaveBeenCalledWith("user-1", expect.objectContaining({
      independence: "third_party", verifiable: true, sourceUrl: "https://g2.com/acme",
    }));
  });

  it("...and one WITHOUT a source as self-published, however large the count", async () => {
    // The count is not what makes something independent.
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: true, observation: { id: "t-2" } }));
    await call("POST", "schema-trust/trust", { body: { signal: "ratings", observed_count: 500 } });
    expect(storeMock.saveTrustObservation).toHaveBeenCalledWith("user-1", expect.objectContaining({
      independence: "self_published", verifiable: false,
    }));
  });

  it("refuses an unknown signal rather than storing a value nothing can read", async () => {
    storeMock.saveTrustObservation = vi.fn();
    const res = await call("POST", "schema-trust/trust", { body: { signal: "vibes", observed_count: 1 } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.saveTrustObservation).not.toHaveBeenCalled();
  });

  it("reports a storage failure as 503, not as a successful record", async () => {
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: false, error: "down" }));
    const res = await call("POST", "schema-trust/trust", { body: { signal: "ratings", observed_count: 2 } });
    expect(res.statusCode).toBe(503);
  });
});

describe("GET /schema-trust/trust", () => {
  it("scores the stored observations for the requested subject kind", async () => {
    storeMock.listTrustObservations = vi.fn(async () => ([
      { signal: "ratings", independence: "third_party", observed_count: 5, verifiable: true },
      { signal: "credentials", independence: "self_published", observed_count: 2, verifiable: false },
    ]));
    const res = await call("GET", "schema-trust/trust", { query: { kind: "service" } });
    const b = parse(res);
    expect(res.statusCode).toBe(200);
    expect(b.trust.kind).toBe("service");
    expect(b.trust.score).toBeGreaterThan(0);
    // A service is not scored on absent product reviews — it is a different question.
    expect(b.trust.unmeasured).toContain("case_studies");
  });

  it("returns the PRD's TC breakdown only for a brand", async () => {
    storeMock.listTrustObservations = vi.fn(async () => ([
      { signal: "ratings", independence: "third_party", observed_count: 3, verifiable: true },
    ]));
    const brand = parse(await call("GET", "schema-trust/trust", { query: { kind: "brand" } }));
    const product = parse(await call("GET", "schema-trust/trust", { query: { kind: "product" } }));
    expect(brand.tc.code).toBe("TC");
    expect(brand.tc.components).toHaveLength(6);
    expect(product.tc).toBeNull();
  });

  it("an unaudited subject scores null, never 0", async () => {
    storeMock.listTrustObservations = vi.fn(async () => []);
    const b = parse(await call("GET", "schema-trust/trust", { query: { kind: "brand" } }));
    expect(b.trust.score).toBeNull();
  });
});

describe("🔴 a parent id in a request body is a claim, not a fact", () => {
  it("refuses a schema write against a subject the caller does not own", async () => {
    storeMock.getSubject = vi.fn(async () => null);
    storeMock.saveSchemaEntity = vi.fn();
    const res = await call("POST", "schema-trust/schema", {
      body: { json_ld: [ORG], subject_id: "someone-elses-subject" },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.saveSchemaEntity).not.toHaveBeenCalled();
  });

  it("refuses a trust write against an audit the caller does not own", async () => {
    storeMock.getAudit = vi.fn(async () => null);
    storeMock.saveTrustObservation = vi.fn();
    const res = await call("POST", "schema-trust/trust", {
      body: { signal: "ratings", observed_count: 1, audit_id: "someone-elses-audit" },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.saveTrustObservation).not.toHaveBeenCalled();
  });

  it("...answers 404 rather than 403, so ids cannot be enumerated", async () => {
    storeMock.getSubject = vi.fn(async () => null);
    const res = await call("POST", "schema-trust/schema", { body: { json_ld: [ORG], subject_id: "x" } });
    expect(res.statusCode).toBe(404);
    expect(parse(res).error).not.toMatch(/forbidden|permission/i);
  });

  it("does not look up references the caller never supplied", async () => {
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: true, observation: {} }));
    await call("POST", "schema-trust/trust", { body: { signal: "ratings", observed_count: 1 } });
    expect(storeMock.getSubject).not.toHaveBeenCalled();
    expect(storeMock.getAudit).not.toHaveBeenCalled();
  });
});
