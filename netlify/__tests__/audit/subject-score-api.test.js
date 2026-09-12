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

// ═══ W11 / W13-step-5 · /subject-score ══════════════════════════════════════
//
// W11 shipped a complete, tested scoring model that NOTHING IMPORTED. Its two
// stated blockers — a subject model (D7) and TC/TP (W13) — both shipped, so the
// deferral expired. These tests exist to make sure it stays wired.

describe("GET /subject-score/registry", () => {
  it("publishes the weights and the model version so a client never hardcodes them", async () => {
    const res = await call("GET", "subject-score/registry");
    const b = parse(res);
    expect(res.statusCode).toBe(200);
    // s-series, never the page model's v-series.
    expect(b.model_version).toMatch(/^s\d+$/);
    expect(b.scores.map((x) => x.code)).toEqual(["BDS", "PDS", "SFS"]);
  });
});

describe("POST /subject-score/scores", () => {
  it("🔴 ACTUALLY WRITES — a model imported by nothing is this repo's own failure mode", async () => {
    // The assertion is the CALL, not the response body. Four columns in this
    // schema were declared, reviewed, merged and written by nothing; W11's
    // model was the fifth thing to sit unused. This is what stops it.
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "brand" }));
    storeMock.saveSubjectScore = vi.fn(async () => ({ ok: true, score: { id: "ss-1" } }));

    const res = await call("POST", "subject-score/scores", {
      body: { subject_id: "subj-1", components: { entity_clarity: 80, structured_depth: 60 } },
    });

    expect(res.statusCode).toBe(201);
    expect(storeMock.saveSubjectScore).toHaveBeenCalledTimes(1);
    const [, arg] = storeMock.saveSubjectScore.mock.calls[0];
    expect(arg.subjectId).toBe("subj-1");
    expect(arg.result.code).toBe("BDS");
  });

  it("🔴 stores `null` for an unmeasurable score, NEVER 0", async () => {
    // The one thing this whole module is built to prevent. A stored 0 is
    // indistinguishable, for ever, from a subject that genuinely scored zero.
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "brand" }));
    storeMock.saveSubjectScore = vi.fn(async () => ({ ok: true, score: { id: "ss-1" } }));

    await call("POST", "subject-score/scores", { body: { subject_id: "subj-1", components: {} } });

    const [, arg] = storeMock.saveSubjectScore.mock.calls[0];
    expect(arg.result.score).toBeNull();
    expect(arg.result.coverage).toBe(0);
  });

  it("stamps the model's OWN version — a caller cannot supply one", async () => {
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "product" }));
    storeMock.saveSubjectScore = vi.fn(async () => ({ ok: true, score: { id: "ss-1" } }));

    await call("POST", "subject-score/scores", {
      body: { subject_id: "subj-1", components: { content_fidelity: 70 }, model_version: "s999" },
    });

    const [, arg] = storeMock.saveSubjectScore.mock.calls[0];
    expect(arg.result.modelVersion).not.toBe("s999");
    expect(arg.result.modelVersion).toMatch(/^s\d+$/);
  });

  it("takes the kind from the STORED subject, never the request body", async () => {
    // A body that named its own kind could file a page under a brand score —
    // the category error the CHECK constraint refuses one layer down. The two
    // layers must not disagree about who decides.
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "service" }));
    storeMock.saveSubjectScore = vi.fn(async () => ({ ok: true, score: { id: "ss-1" } }));

    await call("POST", "subject-score/scores", {
      body: { subject_id: "subj-1", kind: "brand", components: { intent_coverage: 50 } },
    });

    const [, arg] = storeMock.saveSubjectScore.mock.calls[0];
    expect(arg.result.code).toBe("SFS");
  });

  it("refuses a subject kind that has no single-number formula, and says which do", async () => {
    // `scoreIdFor` returns null for page/domain/location. Scoring one anyway
    // would invent a number for a thing that has no formula.
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "page" }));
    storeMock.saveSubjectScore = vi.fn();

    const res = await call("POST", "subject-score/scores", { body: { subject_id: "subj-1" } });

    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/brand, product, service/);
    expect(storeMock.saveSubjectScore).not.toHaveBeenCalled();
  });

  it("refuses another tenant's subject with 404, never 403", async () => {
    // A 403 confirms the row exists and makes the endpoint an enumeration
    // oracle over other tenants' uuids.
    storeMock.getSubject = vi.fn(async () => null);
    storeMock.saveSubjectScore = vi.fn();

    const res = await call("POST", "subject-score/scores", { body: { subject_id: "someone-elses" } });

    expect(res.statusCode).toBe(404);
    expect(storeMock.saveSubjectScore).not.toHaveBeenCalled();
  });

  it("refuses a request with no subject at all", async () => {
    const res = await call("POST", "subject-score/scores", { body: { components: { entity_clarity: 80 } } });
    expect(res.statusCode).toBe(400);
  });

  it("reports `thin` beside the score rather than leaving the reader to derive it", async () => {
    // A number built from half its formula is a different number, and the
    // caveat does not travel with a screenshot.
    storeMock.getSubject = vi.fn(async () => ({ id: "subj-1", user_id: "user-1", subject_kind: "brand" }));
    storeMock.saveSubjectScore = vi.fn(async () => ({ ok: true, score: { id: "ss-1" } }));

    const res = await call("POST", "subject-score/scores", {
      body: { subject_id: "subj-1", components: { entity_clarity: 90 } },
    });

    expect(parse(res).thin).toBe(true);
  });
});

describe("W14/D9 · subject-score gating", () => {
  it("refuses a write on a plan below the threshold", async () => {
    entitlement.mockResolvedValue({
      userId: "user-1", guest: false, degraded: false,
      entitlement: { plan_id: "free", status: "active" }, planMap: PLAN_BY_ID,
    });
    storeMock.saveSubjectScore = vi.fn();

    const res = await call("POST", "subject-score/scores", { body: { subject_id: "subj-1" } });

    expect(res.statusCode).toBe(402);
    expect(storeMock.saveSubjectScore).not.toHaveBeenCalled();
  });

  it("⚠️ does NOT gate a read — the customer already owns these rows", async () => {
    entitlement.mockResolvedValue({
      userId: "user-1", guest: false, degraded: false,
      entitlement: { plan_id: "free", status: "active" }, planMap: PLAN_BY_ID,
    });
    storeMock.listSubjectScores = vi.fn(async () => [{ id: "ss-1" }]);

    const res = await call("GET", "subject-score/scores", { query: { subject_id: "subj-1" } });

    expect(res.statusCode).toBe(200);
    expect(storeMock.listSubjectScores).toHaveBeenCalled();
  });
});

describe("GET /subject-score/scores", () => {
  it("returns the history newest-first — the trend is the product", async () => {
    storeMock.listSubjectScores = vi.fn(async () => [{ id: "ss-2" }, { id: "ss-1" }]);
    const res = await call("GET", "subject-score/scores", { query: { subject_id: "subj-1" } });
    const b = parse(res);
    expect(res.statusCode).toBe(200);
    expect(b.count).toBe(2);
  });
});
