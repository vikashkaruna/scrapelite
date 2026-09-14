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
const { canTransition, requirementsFor } = await import("../../../src/lib/discoverability/workflowLifecycle.js");

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

// ═══ W14 · D9 — the entitlement gate the P2 layer shipped without ═══════════

const asPlan = (planId) => entitlement.mockResolvedValue({
  userId: "user-1", guest: false, degraded: false,
  entitlement: { plan_id: planId, status: "active" }, planMap: PLAN_BY_ID,
});

const P2_WRITES = [
  ["business-truth", "audit.business_truth", { canonical_domain: "acme.com", display_name: "Acme" }],
  ["entity-graph/entities", "audit.entity_graph", { entity_type: "Organization", name: "Acme" }],
  ["local-directory/listings", "audit.local_directory", { source_id: "justdial", listing_url: "https://justdial.com/a" }],
  ["schema-trust/trust", "audit.schema_trust", { signal: "ratings", observed_count: 2 }],
];

describe("🔴 every P2 write is gated — W9 through W13 shipped with NO check at all", () => {
  // Every truth record, graph edge, directory listing and trust observation
  // was writable on ANY plan including Free. The same gap Phases 4-6 had,
  // where three cost-bearing operations went unmetered and three of the BRD's
  // own upgrade triggers were unenforceable — and a 100% green gate proved
  // nothing about them, because nothing checked.
  it.each(P2_WRITES)("POST /%s is refused on a Free plan", async (route, capability, payload) => {
    asPlan("free");
    const res = await call("POST", route, { body: payload });
    expect(res.statusCode).toBe(402);
    expect(parse(res).capability).toBe(capability);
  });

  it.each(P2_WRITES)("POST /%s is allowed on Select", async (route, _cap, payload) => {
    asPlan("select");
    // Wire just enough store for the write to proceed past the gate; the gate
    // is what this asserts, not the handler's own success.
    storeMock.createTruthRecord = vi.fn(async () => ({ ok: true, record: { id: "r-1" } }));
    storeMock.createEntity = vi.fn(async () => ({ ok: true, entity: { id: "e-1" } }));
    storeMock.upsertDirectoryListing = vi.fn(async () => ({ ok: true, listing: { id: "l-1" } }));
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: true, observation: { id: "t-1" } }));
    const res = await call("POST", route, { body: payload });
    expect(res.statusCode).not.toBe(402);
  });

  it("⚠️ READS stay open — refusing to show an owned record is a different act", async () => {
    asPlan("free");
    storeMock.listTruthRecords = vi.fn(async () => []);
    storeMock.listDirectoryListings = vi.fn(async () => []);
    for (const route of ["business-truth", "local-directory/listings"]) {
      const res = await call("GET", route);
      expect(res.statusCode, route).toBe(200);
    }
  });

  it("⚠️ FAILS OPEN on infrastructure — a Supabase blip must not close the layer", async () => {
    // The same asymmetry requireEntitlement and gateAuditQuota already hold:
    // open on infra, closed only on an explicitly-read refusal.
    entitlement.mockResolvedValue({
      userId: "user-1", guest: false, degraded: true, entitlement: null, planMap: PLAN_BY_ID,
    });
    storeMock.saveTrustObservation = vi.fn(async () => ({ ok: true, observation: { id: "t-1" } }));
    const res = await call("POST", "schema-trust/trust", { body: { signal: "ratings", observed_count: 1 } });
    expect(res.statusCode).toBe(201);
  });

  it("names the plan that would unlock it, rather than a bare refusal", async () => {
    asPlan("free");
    const res = await call("POST", "schema-trust/trust", { body: { signal: "ratings", observed_count: 1 } });
    const b = parse(res);
    expect(b.error).toMatch(/Select plan/i);
    expect(b.upgradeTo || b.upgrade_to || b.recommendedPlan).toBeTruthy();
  });
});



// ═══ W14 · revalidation — explicit, gated, idempotent ═══════════════════════

const REC = {
  id: "rec-1", user_id: "user-1", status: "implemented",
  audit_id: "aud-baseline", code: "AC-01",
  revalidation_requested_at: null, revalidation_baseline_audit_id: null,
};

describe("🔴 POST /recommendations/{id}/revalidate", () => {
  beforeEach(() => {
    // Revalidation runs through the REAL audit quota gate, so the monthly
    // count has to be readable — it is what makes this a paid action rather
    // than a feature flag.
    storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 0, degraded: false }));
  });

  it("records the REQUEST and does not run an audit", async () => {
    // A re-audit is a paid action with its own monthly budget. A control that
    // silently spends one is the shape of thing a customer discovers on an
    // invoice, so this records intent and leaves the run to the monitor's tick.
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => REC);
    storeMock.claimRevalidation = vi.fn(async () => ({
      ok: true, claimed: true,
      recommendation: { ...REC, revalidation_requested_at: "2026-09-12T00:00:00Z", revalidation_baseline_audit_id: "aud-baseline" },
    }));
    const res = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(res.statusCode).toBe(201);
    expect(storeMock.claimRevalidation).toHaveBeenCalledWith("user-1", "rec-1",
      expect.objectContaining({ baselineAuditId: "aud-baseline" }));
    // The run is NOT started here.
    expect(auditRun).not.toHaveBeenCalled();
  });

  it("...carrying the BASELINE, because a re-audit alone is a number, not a change", async () => {
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => REC);
    storeMock.claimRevalidation = vi.fn(async () => ({
      ok: true, claimed: true,
      recommendation: { ...REC, revalidation_requested_at: "t", revalidation_baseline_audit_id: "aud-baseline" },
    }));
    const b = parse(await call("POST", "recommendations/rec-1/revalidate", { body: {} }));
    expect(b.revalidation.baseline_audit_id).toBe("aud-baseline");
  });

  it("🔴 IS IDEMPOTENT — clicking twice must not cost twice", async () => {
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => ({
      ...REC, status: "validation_scheduled", revalidation_requested_at: "2026-09-12T00:00:00Z",
    }));
    storeMock.claimRevalidation = vi.fn();
    const res = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(res.statusCode).toBe(200);
    expect(parse(res).already_requested).toBe(true);
    expect(storeMock.claimRevalidation).not.toHaveBeenCalled();
  });

  it("...and a LOST RACE is success, not an error and not a second audit", async () => {
    // The PATCH filters on revalidation_requested_at=is.null, so a concurrent
    // click gets zero rows back. That is the outcome the caller wanted.
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => REC);
    storeMock.claimRevalidation = vi.fn(async () => ({ ok: true, claimed: false, recommendation: null }));
    const res = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(res.statusCode).toBe(200);
    expect(parse(res).already_requested).toBe(true);
  });

  it("⚠️ checks idempotency BEFORE the quota", async () => {
    // A second click on an outstanding request must not read as "you are out
    // of audits" — it is not a new request at all, and refusing it for quota
    // would refuse something the customer is not asking to do.
    asPlan("free");
    storeMock.getRecommendation = vi.fn(async () => ({
      ...REC, revalidation_requested_at: "2026-09-12T00:00:00Z",
    }));
    const res = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(res.statusCode).toBe(200);
  });

  it("refuses to revalidate something that was never implemented", async () => {
    // Spending an audit to confirm what the last one already said.
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => ({ ...REC, status: "open" }));
    storeMock.claimRevalidation = vi.fn();
    const res = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe("NOT_IMPLEMENTED");
    expect(storeMock.claimRevalidation).not.toHaveBeenCalled();
  });

  it("refuses a recommendation the caller does not own, with 404", async () => {
    asPlan("pro");
    storeMock.getRecommendation = vi.fn(async () => null);
    const res = await call("POST", "recommendations/someone-elses/revalidate", { body: {} });
    expect(res.statusCode).toBe(404);
  });

  it("🔴 is gated on the AUDIT QUOTA, not on a feature flag", async () => {
    // ⚠️ MY FIRST DRAFT ASSERTED A FREE PLAN IS REFUSED AND THE CODE WAS
    // RIGHT. Free carries three audits, so a free user with quota left SHOULD
    // be able to re-check their own fix — that is precisely what "gated on the
    // quota rather than a feature flag" means. The refusal is EXHAUSTION, not
    // plan membership.
    asPlan("free");
    storeMock.getRecommendation = vi.fn(async () => REC);
    storeMock.claimRevalidation = vi.fn(async () => ({
      ok: true, claimed: true, recommendation: { ...REC, revalidation_requested_at: "t" },
    }));
    storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 0, degraded: false }));
    const allowed = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(allowed.statusCode).toBe(201);

    // ...and the same plan with its month spent is refused, naming the quota.
    storeMock.getRecommendation = vi.fn(async () => REC);
    storeMock.claimRevalidation = vi.fn();
    storeMock.countAuditsThisMonth = vi.fn(async () => ({ count: 3, degraded: false }));
    const refused = await call("POST", "recommendations/rec-1/revalidate", { body: {} });
    expect(refused.statusCode).toBe(402);
    expect(parse(refused).capability).toBe("audit.revalidate");
    expect(parse(refused).code).toBe("QUOTA_EXCEEDED");
    expect(storeMock.claimRevalidation).not.toHaveBeenCalled();
  });
});


// ═══ W14 · the lifecycle was ALREADY right — a correction ═══════════════════

describe("⚠️ prior-state is deliberately NOT a gate, and `validated` already cannot be faked", () => {
  // 🔴 A CORRECTION, RECORDED SO IT IS NOT "FIXED" AGAIN. W14's plan says
  // every transition should validate the prior state, and I started to add
  // that — then `canTransition`'s own header stopped it:
  //
  //   "ALWAYS TRUE FOR A KNOWN STATE, AND THAT IS THE DESIGN. `next` is what
  //    the UI should OFFER; it is not a gate. A state machine that refuses a
  //    legitimate jump teaches people to work around the tool — and the person
  //    moving the item knows more about their week than this table does."
  //
  // It returns `{allowed, suggested}`, so `!canTransition(...)` — what I wrote
  // — is `!{…}`, always false: the guard would have been DEAD CODE that read
  // as enforcement. And the integrity that actually matters was never missing:
  // `requirementsFor` has always refused `validated` without the audit that
  // re-measured the signal, because otherwise it is a claim, not a
  // measurement. These pin both halves so the "fix" is not attempted again.
  it("canTransition ADVISES, it does not forbid", () => {
    expect(canTransition("open", "validated")).toMatchObject({ allowed: true, suggested: false });
    expect(canTransition("open", "accepted")).toMatchObject({ allowed: true, suggested: true });
  });

  it("...but refuses a state that does not exist at all", () => {
    expect(canTransition("open", "vibes").allowed).toBe(false);
  });

  it("🔴 `validated` REQUIRES the audit that re-measured it — the real gate", () => {
    expect(requirementsFor("validated", {}).ok).toBe(false);
    expect(requirementsFor("validated", { validatedByAuditId: "aud-9" }).ok).toBe(true);
  });

  it("...so open → validated cannot be faked with a label, gate or no gate", () => {
    const r = requirementsFor("validated", {});
    expect(r.missing[0]).toMatch(/claim, not a measurement/i);
  });
});
