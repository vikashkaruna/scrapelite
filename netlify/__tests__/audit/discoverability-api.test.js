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
// Every store export, declared explicitly. vitest's ESM mock needs the export
// names up front — a Proxy factory returns a module with no declared exports
// and every call fails with "No <name> export is defined on the mock".
const STORE_EXPORTS = [
  "ABANDONED_AUDIT_MS",
  "countAuditsThisMonth", "createAudit", "deleteAudit", "ensureTarget",
  "findByIdempotencyKey", "getAudit", "getAuditFull", "getTargetTrend",
  "listAudits", "listTargets", "markAuditFailed", "monthStart",
  "persistPromptRuns", "persistResult", "recordEvent", "setRecommendationStatus",
  "saveAuditSummary",
  "createBenchmark", "attachBenchmarkAudit", "completeBenchmark", "getBenchmark",
  "listBenchmarks", "deleteBenchmark", "createPromptSet", "listPromptSets",
  "getPromptSet", "deletePromptSet", "createWebhook", "listWebhooks",
  "webhooksForEvent", "recordWebhookDelivery", "deleteWebhook",
  "createSchedule", "listSchedules", "updateSchedule", "deleteSchedule",
  "dueSchedules", "markScheduleRun", "nextRunAt",
];
vi.mock("../../functions/lib/audit/auditStore.js", () =>
  Object.fromEntries(STORE_EXPORTS.map((name) => [
    name,
    (...args) => (storeMock[name] || (storeMock[name] = vi.fn()))(...args),
  ])));



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

const AUDIT_RESULT = {
  status: "completed", unreachable: false, finalScore: 78.4, seoScore: 75,
  aeoScore: 82, geoScore: 71, coverage: 92.5,
  pillars: {}, frameworks: {}, issues: [], recommendations: [],
  penalties: [], penaltyMultiplier: 1, facts: {}, evidence: {},
  target: { page_type: "article" }, meta: { engine: {} }, scoreMath: {},
};

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
  auditRun.mockResolvedValue({ ...AUDIT_RESULT });
  dispatchWebhook.mockResolvedValue({ delivered: 0, failed: 0, results: [] });
});

// Configure the store proxy for a happy path.
function happyStore() {
  storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 0, degraded: false }));
  storeMock.findByIdempotencyKey = vi.fn(async () => null);
  storeMock.ensureTarget = vi.fn(async () => "target-1");
  storeMock.createAudit = vi.fn(async () => ({ ok: true, audit: { id: "audit-1" } }));
  storeMock.persistResult = vi.fn(async () => ({ ok: true }));
  storeMock.persistPromptRuns = vi.fn(async () => ({ ok: true }));
  storeMock.recordEvent = vi.fn(async () => {});
}

// A regression guard on the mock itself: if the store grows an export this list
// does not know about, the suite fails loudly here rather than silently
// exercising a route that always throws.
describe("test scaffolding", () => {
  it("the store mock covers every real export", async () => {
    const real = await vi.importActual("../../functions/lib/audit/auditStore.js");
    expect([...STORE_EXPORTS].sort()).toEqual(Object.keys(real).sort());
  });
});

describe("routing", () => {
  it("splits the splat into path segments", () => {
    expect(parsePath("audits/abc/compare/def")).toEqual(["audits", "abc", "compare", "def"]);
    expect(parsePath("")).toEqual([]);
    expect(parsePath(undefined)).toEqual([]);
  });

  it("answers CORS preflight without touching auth", async () => {
    const res = await handler({ httpMethod: "OPTIONS", queryStringParameters: {}, headers: {} });
    expect(res.statusCode).toBe(204);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("404s an unknown endpoint", async () => {
    const res = await call("GET", "nonsense");
    expect(res.statusCode).toBe(404);
  });

  // Regression: netlify.toml used to forward the sub-path as a QUERY PARAM
  // (`?splat=:splat`). That substitution was already found to silently drop
  // the value on an explicit-prefix wildcard rule in production — the exact
  // failure that once 404'd every integrations provider (commit 87f5597).
  // This is the same shape of rule, so the redirect now forwards the splat
  // as a PATH SEGMENT instead, and the handler must resolve it from
  // event.path when the query param is empty — which is exactly what a real
  // request looks like once that redirect form is live.
  it("resolves the route from event.path when the query param is empty (the production redirect bug)", async () => {
    storeMock.listAudits = vi.fn(async () => []);
    const res = await handler({
      httpMethod: "GET",
      // No `splat` in the query — this is what the OLD `?splat=:splat`
      // redirect form produced when Netlify's substitution silently failed.
      queryStringParameters: {},
      path: "/.netlify/functions/discoverability/audits",
      headers: { authorization: "Bearer token" },
      body: null,
    });
    expect(res.statusCode).not.toBe(404);
    expect(parse(res)).toEqual({ audits: [] });
  });

  // Regression: the FIRST fix for this bug assumed event.path always carries
  // the destination form (/.netlify/functions/discoverability/...), matching
  // the integrations fix's own pattern. Deployed to staging, it STILL 404'd
  // "Unknown endpoint" — event.path's actual shape for this rewrite is not
  // reliably one fixed thing, and was quite possibly the ORIGINAL request
  // path instead (/api/discoverability/...). resolveSplat now anchors on
  // the "/discoverability/" segment wherever it falls, not a hardcoded
  // prefix, so it must resolve correctly under BOTH shapes.
  it("resolves the route when event.path is the ORIGINAL request path, not the function's destination path", async () => {
    storeMock.listAudits = vi.fn(async () => []);
    const res = await handler({
      httpMethod: "GET",
      queryStringParameters: {},
      path: "/api/discoverability/audits",
      headers: { authorization: "Bearer token" },
      body: null,
    });
    expect(res.statusCode).not.toBe(404);
    expect(parse(res)).toEqual({ audits: [] });
  });

  it("still resolves via the query param when present (api-v1.js's in-process delegation)", async () => {
    storeMock.listAudits = vi.fn(async () => []);
    const res = await handler({
      httpMethod: "GET",
      queryStringParameters: { splat: "audits" },
      // No real event.path — this is what api-v1.js's manually-built inner
      // event looks like; it must not depend on the path fallback.
      headers: { authorization: "Bearer token" },
      body: null,
    });
    expect(res.statusCode).not.toBe(404);
  });

  it("rejects a malformed JSON body before doing any work", async () => {
    const res = await handler({
      httpMethod: "POST", queryStringParameters: { splat: "audits" },
      headers: { authorization: "Bearer t" }, body: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(auditRun).not.toHaveBeenCalled();
  });
});

describe("audits are signed-in only", () => {
  it("401s an anonymous caller", async () => {
    authenticate.mockResolvedValue({ ok: false, user: null });
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(401);
    expect(parse(res).code).toBe("AUTH_REQUIRED");
    expect(auditRun).not.toHaveBeenCalled();
  });
});

// ── The gate order, which CLAUDE.md documents as load-bearing ───────────────
// ── The delegated-identity field must not be reachable from the network ────
describe("_apiKeyUserId is an in-process channel only", () => {
  beforeEach(happyStore);

  it("is honoured when the api-v1 router sets it in-process", async () => {
    authenticate.mockResolvedValue({ ok: false, user: null });   // no JWT at all
    const res = await handler({
      httpMethod: "POST",
      queryStringParameters: { splat: "audits" },
      headers: {},
      body: JSON.stringify({ target_url: "https://example.com" }),
      _apiKeyUserId: "user-from-api-key",
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.ensureTarget).toHaveBeenCalledWith(
      "user-from-api-key", expect.any(String), expect.any(String), null,
    );
  });

  it("cannot be forged through a header, a query param or the body", async () => {
    // The claim in the handler's comment, made checkable. Netlify builds the
    // event from the HTTP request and has no way to set a root-level field, so
    // none of these three routes may become an identity.
    authenticate.mockResolvedValue({ ok: false, user: null });

    const attempts = [
      { headers: { _apiKeyUserId: "victim", "x-apikeyuserid": "victim" } },
      { queryStringParameters: { splat: "audits", _apiKeyUserId: "victim" } },
      { body: JSON.stringify({ target_url: "https://example.com", _apiKeyUserId: "victim" }) },
    ];

    for (const override of attempts) {
      const res = await handler({
        httpMethod: "POST",
        queryStringParameters: { splat: "audits" },
        headers: {},
        body: JSON.stringify({ target_url: "https://example.com" }),
        ...override,
      });
      expect(res.statusCode, JSON.stringify(override)).toBe(401);
      expect(JSON.parse(res.body).code).toBe("AUTH_REQUIRED");
    }
    expect(auditRun).not.toHaveBeenCalled();
  });
});

describe("gate order — nothing above the quota check may spend a credit", () => {
  beforeEach(happyStore);

  it("refuses a non-public URL before any other gate", async () => {
    publicUrl.mockResolvedValue(false);
    const res = await call("POST", "audits", { body: { target_url: "http://127.0.0.1/admin" } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("INVALID_URL");
    expect(compliance).not.toHaveBeenCalled();
    expect(storeMock.createAudit).not.toHaveBeenCalled();
    expect(auditRun).not.toHaveBeenCalled();
  });

  it("refuses a robots.txt disallow, and says it is overridable", async () => {
    compliance.mockResolvedValue({
      allowed: false, code: "robots_disallowed", host: "linkedin.com",
      reason: "robots.txt disallows this path",
    });
    const res = await call("POST", "audits", { body: { target_url: "https://linkedin.com/in/x" } });
    expect(res.statusCode).toBe(403);
    const b = parse(res);
    // Branch on the CODE, never the prose — matching prose is what made a
    // robots refusal render as "Something went wrong" with a stack trace.
    expect(b.code).toBe("robots_disallowed");
    expect(b._complianceBlocked).toBe(true);
    expect(b.overridable).toBe(true);
    // A refused request must not have opened an audit or spent a credit.
    expect(storeMock.createAudit).not.toHaveBeenCalled();
    expect(auditRun).not.toHaveBeenCalled();
  });

  it("honours a recorded per-host attestation and proceeds", async () => {
    compliance.mockResolvedValue({
      allowed: false, code: "robots_disallowed", host: "example.com", reason: "disallowed",
    });
    consent.mockResolvedValue(true);
    const res = await call("POST", "audits", { body: { target_url: "https://example.com/x" } });
    expect(res.statusCode).toBe(201);
    expect(auditRun).toHaveBeenCalled();
  });

  it("never lets an operator host block be overridden by a user attestation", async () => {
    // host_not_permitted is the OPERATOR's decision. A user must not be able to
    // attest their way past their own operator.
    compliance.mockResolvedValue({
      allowed: false, code: "host_not_permitted", host: "example.com", reason: "not permitted",
    });
    consent.mockResolvedValue(true);
    const res = await call("POST", "audits", { body: { target_url: "https://example.com/x" } });
    expect(res.statusCode).toBe(403);
    expect(parse(res).overridable).toBe(false);
    expect(consent).not.toHaveBeenCalled();
    expect(auditRun).not.toHaveBeenCalled();
  });

  it("refuses when the audit quota is exhausted, without running anything", async () => {
    storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 100, degraded: false }));
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(402);
    expect(parse(res).code).toBe("QUOTA_EXCEEDED");
    expect(auditRun).not.toHaveBeenCalled();
    expect(storeMock.createAudit).not.toHaveBeenCalled();
  });

  it("FAILS OPEN when the quota count could not be read", async () => {
    // Same asymmetry as requireEntitlement: a Supabase blip must not take
    // auditing down. It fails closed only on an explicitly-read over-quota state.
    storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 0, degraded: true }));
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(201);
    expect(auditRun).toHaveBeenCalled();
  });
});

describe("webhook notification on completion", () => {
  beforeEach(happyStore);

  it("notifies subscribers when an audit completes", async () => {
    await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(dispatchWebhook).toHaveBeenCalledWith("user-1", "audit.completed", expect.objectContaining({
      audit: expect.objectContaining({ id: "audit-1" }),
    }));
  });

  it("does not notify when the audit was never saved", async () => {
    storeMock.persistResult = vi.fn(async () => ({ ok: false, error: "write failed" }));
    await call("POST", "audits", { body: { target_url: "https://example.com" } });
    // Announcing an audit nobody can fetch would send subscribers a link to a
    // 404. The result still returns to the caller; it just is not broadcast.
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  beforeEach(happyStore);

  it("returns the original audit instead of spending a second credit", async () => {
    storeMock.findByIdempotencyKey = vi.fn(async () => ({ id: "audit-existing" }));
    storeMock.getAuditFull = vi.fn(async () => ({
      audit: { id: "audit-existing", target_url: "https://example.com" },
      result: { final_score: 78 }, signals: [], issues: [], recommendations: [], promptRuns: [],
    }));
    const res = await call("POST", "audits", {
      body: { target_url: "https://example.com", idempotency_key: "req-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(parse(res).idempotent_replay).toBe(true);
    expect(auditRun).not.toHaveBeenCalled();
    // Checked BEFORE the quota gate — a retry is not a second audit.
    expect(storeMock.countAuditsThisMonth).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  it("requires a target URL", () => {
    expect(parseAuditOptions({}).errors[0]).toMatch(/target_url is required/);
  });
  it("rejects an unknown audit profile rather than silently substituting one", () => {
    const p = parseAuditOptions({ target_url: "https://x.com", audit_profile: "vibes" });
    expect(p.errors[0]).toMatch(/audit_profile must be one of/);
  });
  it("defaults device and profile", () => {
    const p = parseAuditOptions({ target_url: "https://x.com" });
    expect(p.options.deviceProfile).toBe("mobile");
    expect(p.options.auditProfile).toBe("balanced");
  });
  it("caps prompts and tags rather than accepting an unbounded list", () => {
    const p = parseAuditOptions({
      target_url: "https://x.com",
      prompts: Array(50).fill("q"), tags: Array(50).fill("t"),
    });
    expect(p.options.prompts).toHaveLength(10);
    expect(p.options.tags).toHaveLength(10);
  });
});

describe("results and ownership", () => {
  it("404s another user's audit — never 403", async () => {
    // A 403 confirms the id is real, which is how an id space gets enumerated.
    storeMock.getAuditFull = vi.fn(async () => null);
    const res = await call("GET", "audits/someone-elses-id/results");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/forbidden|not yours/i);
  });

  it("scopes every read by the caller's user id", async () => {
    storeMock.getAuditFull = vi.fn(async () => null);
    await call("GET", "audits/abc/results");
    expect(storeMock.getAuditFull).toHaveBeenCalledWith("user-1", "abc");
  });
});

describe("a persistence failure returns the work rather than discarding it", () => {
  beforeEach(happyStore);

  it("says clearly that the audit was not saved", async () => {
    storeMock.persistResult = vi.fn(async () => ({ ok: false, error: "write failed" }));
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(200);
    const b = parse(res);
    // The user has already been charged for this work; throwing it away would
    // be worse. But nobody should go looking for it in their history.
    expect(b.persisted).toBe(false);
    expect(b.finalScore).toBe(78.4);
  });

  it("marks the audit failed when the pipeline throws", async () => {
    auditRun.mockRejectedValue(new Error("boom"));
    storeMock.markAuditFailed = vi.fn(async () => ({ ok: true }));
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(502);
    expect(storeMock.markAuditFailed).toHaveBeenCalledWith("audit-1", "boom");
  });
});

describe("recommendations", () => {
  it("refuses a dismissal with no reason", async () => {
    storeMock.setRecommendationStatus = vi.fn(async (_u, _i, status, reason) =>
      status === "dismissed" && !String(reason || "").trim()
        ? { ok: false, error: "A dismissal needs a reason." }
        : { ok: true, recommendation: { id: "r1", audit_id: "a1", code: "AC-01" } });
    const res = await call("POST", "recommendations/r1/dismiss", { body: {} });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/needs a reason/);
  });

  it("accepts a dismissal with one, and records it in the trail", async () => {
    storeMock.setRecommendationStatus = vi.fn(async () => ({
      ok: true, recommendation: { id: "r1", audit_id: "a1", code: "AC-01" },
    }));
    storeMock.recordEvent = vi.fn(async () => {});
    const res = await call("POST", "recommendations/r1/dismiss", { body: { reason: "Not applicable to this template." } });
    expect(res.statusCode).toBe(200);
    expect(storeMock.recordEvent).toHaveBeenCalledWith("user-1", expect.objectContaining({
      eventType: "recommendation.dismissed",
    }));
  });

  it("maps every queue action to the right status", async () => {
    storeMock.setRecommendationStatus = vi.fn(async () => ({ ok: true, recommendation: { audit_id: "a" } }));
    storeMock.recordEvent = vi.fn(async () => {});
    for (const [action, status] of [["accept", "accepted"], ["done", "done"], ["reopen", "open"]]) {
      await call("POST", `recommendations/r1/${action}`, { body: {} });
      expect(storeMock.setRecommendationStatus).toHaveBeenLastCalledWith("user-1", "r1", status, undefined);
    }
  });
});

describe("benchmarks", () => {
  it("needs at least two URLs to compare anything", async () => {
    const res = await call("POST", "benchmarks", { body: { urls: ["https://a.com"] } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/at least two/);
  });

  it("caps the set rather than running an unbounded number of audits", async () => {
    const res = await call("POST", "benchmarks", {
      body: { urls: Array.from({ length: 30 }, (_, i) => `https://s${i}.com`) },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(new RegExp(`${MAX_BENCHMARK_URLS} URLs`));
  });
});

describe("webhooks", () => {
  it("guards the registered URL with the same SSRF check an audit gets", async () => {
    publicUrl.mockResolvedValue(false);
    const res = await call("POST", "webhooks", { body: { target_url: "http://169.254.169.254/latest" } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/not a public web address/);
  });

  it("returns the signing secret exactly once, on creation", async () => {
    storeMock.createWebhook = vi.fn(async () => ({
      ok: true, webhook: { id: "wh1", has_secret: true }, secret: "whsec_abc",
    }));
    storeMock.listWebhooks = vi.fn(async () => [{ id: "wh1", has_secret: true }]);

    const created = parse(await call("POST", "webhooks", { body: { target_url: "https://hooks.example.com/x" } }));
    expect(created.secret).toBe("whsec_abc");

    // Never readable again. A secret a GET can retrieve is not a secret.
    const listed = parse(await call("GET", "webhooks"));
    expect(JSON.stringify(listed)).not.toContain("whsec_abc");
    expect(listed.webhooks[0].has_secret).toBe(true);
  });
});

describe("report export", () => {
  const full = {
    audit: { id: "a1", target_url: "https://example.com/geo", device_profile: "mobile", audit_profile: "balanced", created_at: "2026-08-26" },
    result: {
      final_score: 78, seo_score: 75, aeo_score: 82, geo_score: 71, coverage: 92.5,
      penalty_multiplier: 1, pre_penalty_score: 78, estimated_total_lift: 4,
      facts_json: {}, evidence_json: {}, engine_json: {},
      answer_clarity_score: 84, entity_authority_score: 71,
      structural_hierarchy_score: 81, technical_accessibility_score: 76,
    },
    signals: [], issues: [], recommendations: [], promptRuns: [],
  };

  beforeEach(() => { storeMock.getAuditFull = vi.fn(async () => full); });

  it("defaults to markdown", async () => {
    const res = await call("GET", "audits/a1/report");
    expect(res.headers["Content-Type"]).toMatch(/text\/markdown/);
    expect(res.body).toMatch(/# DatIQ Discoverability Audit/);
  });

  it("serves CSV and JSON on request", async () => {
    const csv = await call("GET", "audits/a1/report", { query: { format: "csv" } });
    expect(csv.headers["Content-Type"]).toMatch(/text\/csv/);
    const j = await call("GET", "audits/a1/report", { query: { format: "json" } });
    expect(JSON.parse(j.body).framework_scores.overall).toBe(78);
  });

  it("records the export in the audit trail", async () => {
    storeMock.recordEvent = vi.fn(async () => {});
    await call("GET", "audits/a1/report", { query: { format: "csv" } });
    expect(storeMock.recordEvent).toHaveBeenCalledWith("user-1", expect.objectContaining({
      eventType: "exported", auditId: "a1",
    }));
  });

  it("annotates the score with its coverage, so a thin audit is not oversold", async () => {
    const res = await call("GET", "audits/a1/report");
    expect(res.body).toMatch(/92\.5% of signals/);
  });
});

// ── POST /audits/{id}/summary ───────────────────────────────────────────────
// The executive summary is generated LAZILY, on first report view, and cached.
//
// It is deliberately NOT part of the audit run: AUDIT_BUDGET_MS defaults to
// 8000ms against Netlify's stock 10s timeout, and the 504 this module shipped
// in August came from exactly this shape of mistake — per-call timeouts
// composing additively with no notion of the platform's limit.
describe("POST /audits/{id}/summary", () => {
  /** A stored audit whose result may or may not already carry a summary. */
  const fullWith = (summary = null) => ({
    audit: { id: "audit-1", target_url: "https://example.com/pricing", page_type: "pricing",
             device_profile: "mobile", audit_profile: "balanced", created_at: "2026-08-27T00:00:00Z" },
    result: {
      final_score: 61, seo_score: 64, aeo_score: 55, geo_score: 58, coverage: 84,
      answer_clarity_score: 40, entity_authority_score: 60,
      structural_hierarchy_score: 30, technical_accessibility_score: 90,
      penalty_multiplier: 1, engine_json: {}, facts_json: {}, evidence_json: {},
      summary_md: summary, summary_model: summary ? "gemini" : null,
    },
    signals: [], issues: [], recommendations: [], promptRuns: [],
  });

  beforeEach(() => {
    happyStore();
    summarise.mockReset();
    storeMock.saveAuditSummary = vi.fn(async () => ({ ok: true }));
  });

  it("generates and caches when there is no summary yet", async () => {
    storeMock.getAuditFull = vi.fn(async () => fullWith(null));
    summarise.mockResolvedValue({ summary: "A clear verdict about this page.", provider: "gemini" });

    const res = await call("POST", "audits/audit-1/summary", { body: {} });
    expect(res.statusCode).toBe(200);
    const b = parse(res);
    expect(b.summary).toBe("A clear verdict about this page.");
    expect(b.cached).toBe(false);
    expect(storeMock.saveAuditSummary).toHaveBeenCalledWith("user-1", "audit-1",
      expect.objectContaining({ summary: "A clear verdict about this page.", model: "gemini" }));
  });

  it("returns the CACHED summary without spending another model call", async () => {
    // A reader refreshing the report must not pay for it twice, and two readers
    // of the same audit must see the same words.
    storeMock.getAuditFull = vi.fn(async () => fullWith("Already written."));
    const res = await call("POST", "audits/audit-1/summary", { body: {} });
    expect(parse(res).cached).toBe(true);
    expect(parse(res).summary).toBe("Already written.");
    expect(summarise).not.toHaveBeenCalled();
    expect(storeMock.saveAuditSummary).not.toHaveBeenCalled();
  });

  it("reports 200 with a null summary when the model is unavailable", async () => {
    // Not an error. A report with no summary is a report; the header degrades
    // to the deterministic facts, which are the part that matters.
    storeMock.getAuditFull = vi.fn(async () => fullWith(null));
    summarise.mockResolvedValue(null);
    const res = await call("POST", "audits/audit-1/summary", { body: {} });
    expect(res.statusCode).toBe(200);
    expect(parse(res).summary).toBeNull();
    expect(parse(res).unavailable).toBe(true);
    expect(storeMock.saveAuditSummary).not.toHaveBeenCalled();
  });

  it("still returns the summary when the cache write fails", async () => {
    // A summary that could not be stored gets regenerated next time; refusing
    // to show it would be losing work we already paid for.
    storeMock.getAuditFull = vi.fn(async () => fullWith(null));
    summarise.mockResolvedValue({ summary: "Generated but unsaved.", provider: "openai" });
    storeMock.saveAuditSummary = vi.fn(async () => ({ ok: false }));
    const res = await call("POST", "audits/audit-1/summary", { body: {} });
    expect(res.statusCode).toBe(200);
    expect(parse(res).summary).toBe("Generated but unsaved.");
    expect(parse(res).persisted).toBe(false);
  });

  it("404s another user's audit rather than 403", async () => {
    // A 403 confirms the id is real, which is how an id space gets enumerated.
    storeMock.getAuditFull = vi.fn(async () => null);
    const res = await call("POST", "audits/someone-elses/summary", { body: {} });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/forbidden|not yours/i);
  });

  it("scopes the read and the write by the caller's user id", async () => {
    storeMock.getAuditFull = vi.fn(async () => fullWith(null));
    summarise.mockResolvedValue({ summary: "x".repeat(60), provider: "gemini" });
    await call("POST", "audits/abc/summary", { body: {} });
    expect(storeMock.getAuditFull).toHaveBeenCalledWith("user-1", "abc");
    expect(storeMock.saveAuditSummary).toHaveBeenCalledWith("user-1", "abc", expect.anything());
  });
});

// ── Workspace member pause — the real wiring, not the isolated unit test ────
//
// entitlementModel.js's can() has had a ctx.memberPaused branch since Team
// Workspaces shipped, and workspaces.js has let an owner pause a seat since
// the same session — but until now nothing on the audit-create path ever set
// ctx.memberPaused to anything but its default false. These tests prove a
// request naming a workspace_id is actually checked against a real
// workspace_members row, not just accepted at face value.
describe("workspace member pause", () => {
  beforeEach(happyStore);

  const withServiceDb = (fn) => async () => {
    process.env.SUPABASE_URL = "https://db.example.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    const realFetch = globalThis.fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
    }
  };

  it("refuses a workspace the caller does not belong to, before spending any quota", withServiceDb(async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const res = await call("POST", "audits", {
      body: { target_url: "https://example.com", workspace_id: "ws-1" },
    });
    expect(res.statusCode).toBe(403);
    expect(parse(res).code).toBe("WORKSPACE_NOT_MEMBER");
    expect(storeMock.createAudit).not.toHaveBeenCalled();
    expect(auditRun).not.toHaveBeenCalled();
  }));

  it("denies audit creation for a paused seat, but does not touch quota logic", withServiceDb(async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ paused_at: "2026-08-01T00:00:00Z" }]), { status: 200 }),
    );
    const res = await call("POST", "audits", {
      body: { target_url: "https://example.com", workspace_id: "ws-1" },
    });
    expect(res.statusCode).toBe(402);
    expect(parse(res).code).toBe("MEMBER_PAUSED");
    expect(auditRun).not.toHaveBeenCalled();
  }));

  it("proceeds normally when no workspace_id is named at all", withServiceDb(async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const res = await call("POST", "audits", { body: { target_url: "https://example.com" } });
    expect(res.statusCode).toBe(201);
    // The workspace lookup is never even attempted for a personal request.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }));
});
