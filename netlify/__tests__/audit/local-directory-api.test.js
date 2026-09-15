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
  publicUrl.mockResolvedValue(true);
  compliance.mockResolvedValue({ allowed: true, host: "example.com", code: "allowed" });
  consent.mockResolvedValue(false);
  entitlement.mockResolvedValue({
    userId: "user-1", guest: false, degraded: false,
    entitlement: { plan_id: "pro", status: "active" }, planMap: PLAN_BY_ID,
  });
  dispatchWebhook.mockResolvedValue({ delivered: 0, failed: 0, results: [] });
});

// ═══ W12 · /local-directory ═════════════════════════════════════════════════

const CANONICAL = {
  name: "Acme Technologies Pvt Ltd",
  address: "4th Floor, MG Road, Bengaluru",
  phone: "+91 80 4718 2200",
  postal_code: "560001",
};

const listing = (over = {}) => ({
  id: "l-1", source_id: "justdial", source_tier: "major_aggregator",
  acquisition: "public_listing", listing_url: "https://justdial.com/acme",
  observed_name: "Acme Technologies", observed_address: "4th Flr, MG Rd, Bengaluru",
  observed_phone: "08047182200", observed_postal_code: "560 001",
  observed_at: "2026-09-11T10:00:00Z",
  ...over,
});

describe("GET /local-directory/schema", () => {
  it("publishes the tiers, the sources, the NAP fields and the LD codes", async () => {
    const body = parse(await call("GET", "local-directory/schema"));
    expect(body.tiers).toHaveLength(5);
    expect(body.sources.length).toBeGreaterThan(10);
    expect(body.finding_codes.map((c) => c.code)).toContain("LD-01");
    expect(body.match_states.map((m) => m.id)).toContain("not_published");
  });

  it("tells the caller what unlocks each source that needs an action", async () => {
    const body = parse(await call("GET", "local-directory/schema"));
    const gbp = body.sources.find((s) => s.id === "google_business_profile");
    expect(gbp.unlock).toMatchObject({ action: "connect" });
    const jd = body.sources.find((s) => s.id === "justdial");
    expect(jd.unlock).toBeNull();
  });
});

describe("POST /local-directory/listings", () => {
  it("records a declared listing", async () => {
    storeMock.upsertDirectoryListing = vi.fn(async () => ({ ok: true, listing: listing() }));
    const res = await call("POST", "local-directory/listings", {
      body: {
        source_id: "justdial", listing_url: "https://justdial.com/acme",
        observed_name: "Acme Technologies", truth_record_id: "rec-1",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.upsertDirectoryListing).toHaveBeenCalledWith("user-1", expect.objectContaining({
      sourceId: "justdial", sourceTier: "major_aggregator", truthRecordId: "rec-1",
    }));
  });

  it("🔴 REFUSES an `authorized_api` claim from a request body", async () => {
    // Fidelity is a claim about HOW an observation was obtained. A claim a
    // client can set is not a claim — it is `?consented=true` wearing a third
    // hat, and it would let anyone badge a scraped value as API-sourced.
    storeMock.upsertDirectoryListing = vi.fn();
    const res = await call("POST", "local-directory/listings", {
      body: { source_id: "google_business_profile", acquisition: "authorized_api", listing_url: "https://x.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(storeMock.upsertDirectoryListing).not.toHaveBeenCalled();
  });

  it("refuses an unknown source rather than storing a value nothing can read", async () => {
    storeMock.upsertDirectoryListing = vi.fn();
    const res = await call("POST", "local-directory/listings", {
      body: { source_id: "made_up_directory", listing_url: "https://x.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/Unknown directory source/);
    expect(storeMock.upsertDirectoryListing).not.toHaveBeenCalled();
  });

  it("refuses an observation with no URL — evidence nobody can check is not evidence", async () => {
    storeMock.upsertDirectoryListing = vi.fn();
    const res = await call("POST", "local-directory/listings", { body: { source_id: "justdial" } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.upsertDirectoryListing).not.toHaveBeenCalled();
  });
});

describe("GET /local-directory/listings", () => {
  it("returns the listings with the honest coverage sentence", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    const body = parse(await call("GET", "local-directory/listings", { query: { truth_record_id: "rec-1" } }));
    expect(body.count).toBe(1);
    expect(body.coverage_claim).toMatch(/depends on what you authorise/i);
    expect(body.coverage_claim).not.toMatch(/directories audited/i);
  });
});

describe("POST /local-directory/check", () => {
  it("🔴 ACTUALLY WRITES the check, its matches and its findings", async () => {
    // This schema's own recorded failure mode is three columns declared,
    // reviewed, merged and written by nothing. The write is the assertion.
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const res = await call("POST", "local-directory/check", {
      body: { truth_record_id: "rec-1", canonical: CANONICAL, region: "IN" },
    });

    expect(res.statusCode).toBe(201);
    expect(storeMock.saveLocalCheck).toHaveBeenCalledWith("user-1", expect.objectContaining({
      truthRecordId: "rec-1", region: "IN",
    }));
    expect(parse(res).persisted).toBe(true);
  });

  it("passes the D7 subject through, so a local check is addressable", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));
    await call("POST", "local-directory/check", {
      body: { truth_record_id: "rec-1", subject_id: "subj-1", canonical: CANONICAL },
    });
    expect(storeMock.saveLocalCheck).toHaveBeenCalledWith("user-1", expect.objectContaining({
      subjectId: "subj-1",
    }));
  });

  it("🔴 raises NO finding for a listing that differs only in formatting", async () => {
    // The whole reason normalisation is most of napModel.js: a checker that
    // reports "Pvt Ltd" against "Private Limited" produces a list nobody reads,
    // and the one real mismatch in it goes unfixed.
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const body = parse(await call("POST", "local-directory/check", {
      body: { canonical: CANONICAL },
    }));
    expect(body.findings.map((f) => f.code)).not.toContain("LD-01");
    expect(body.findings.map((f) => f.code)).not.toContain("LD-02");
  });

  it("raises LD-02 and offers a correction pack when a phone genuinely differs", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing({ observed_phone: "+91 80 9999 0000" })]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const body = parse(await call("POST", "local-directory/check", { body: { canonical: CANONICAL } }));
    expect(body.findings.map((f) => f.code)).toContain("LD-02");
    const pack = body.corrections.find((c) => c.sourceId === "justdial");
    expect(pack.changeFields).toEqual(["phone"]);
    expect(pack.hasPlaceholders).toBe(false);
  });

  it("🔴 emits a TODO placeholder rather than inventing a value the record lacks", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing({ observed_address: "12 Brigade Road Mumbai" })]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const body = parse(await call("POST", "local-directory/check", {
      body: { canonical: { name: "Acme Technologies Pvt Ltd", address: "4th Floor MG Road" } },
    }));
    const pack = body.corrections.find((c) => c.sourceId === "justdial");
    expect(pack.hasPlaceholders).toBe(true);
    expect(pack.values.phone).toMatch(/^TODO:/);
  });

  it("🔴 RETURNS THE WORK when it could not be stored, rather than discarding it", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: false, error: "boom" }));

    const res = await call("POST", "local-directory/check", { body: { canonical: CANONICAL } });
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.persisted).toBe(false);
    expect(body.score).toBeTruthy();
    expect(body.warning).toMatch(/could not be stored/i);
  });

  it("🔴 scores null, never 0, when no listing could be read", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => []);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const body = parse(await call("POST", "local-directory/check", { body: { canonical: CANONICAL, region: "IN" } }));
    expect(body.score.score).toBeNull();
    expect(body.score.checkedCount).toBe(0);
    expect(body.score.configuredCount).toBeGreaterThan(0);
  });

  it("ignores a stored listing whose source is no longer in the registry", async () => {
    // A source could be retired. Scoring a row whose weighting nothing declares
    // would be scoring against a number nobody chose.
    storeMock.listDirectoryListings = vi.fn(async () => [listing({ source_id: "retired_directory" })]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));

    const body = parse(await call("POST", "local-directory/check", { body: { canonical: CANONICAL } }));
    expect(body.matches).toEqual([]);
  });
});

describe("GET /local-directory/checks", () => {
  it("lists the history for one record", async () => {
    storeMock.listLocalChecks = vi.fn(async () => [{ id: "chk-1", nap_score: 92 }]);
    const body = parse(await call("GET", "local-directory/checks", { query: { truth_record_id: "rec-1" } }));
    expect(body.count).toBe(1);
    expect(storeMock.listLocalChecks).toHaveBeenCalledWith("user-1", expect.objectContaining({ truthRecordId: "rec-1" }));
  });

  it("returns one check with its matches and findings", async () => {
    storeMock.getLocalCheckFull = vi.fn(async () => ({ check: { id: "chk-1" }, matches: [], findings: [] }));
    const res = await call("GET", "local-directory/checks/chk-1");
    expect(res.statusCode).toBe(200);
    expect(parse(res).check.id).toBe("chk-1");
  });

  it("404s another tenant's check without saying it exists", async () => {
    storeMock.getLocalCheckFull = vi.fn(async () => null);
    const res = await call("GET", "local-directory/checks/someone-elses");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/forbidden|not yours/i);
  });
});

describe("POST /local-directory/findings/{id}/resolve", () => {
  it("resolves with a listing-shaped verdict", async () => {
    storeMock.resolveLocalFinding = vi.fn(async () => ({ ok: true, finding: { id: "f-1", resolution: "listing_updated" } }));
    const res = await call("POST", "local-directory/findings/f-1/resolve", { body: { resolution: "listing_updated" } });
    expect(res.statusCode).toBe(200);
  });

  it("🔴 refuses a recommendation-queue workflow state", async () => {
    // D7 §4: these are about a record, not a task. Accepting "in_progress" here
    // would lose the difference between "this listing now agrees" and
    // "somebody did the task".
    storeMock.resolveLocalFinding = vi.fn();
    const res = await call("POST", "local-directory/findings/f-1/resolve", { body: { resolution: "in_progress" } });
    expect(res.statusCode).toBe(400);
    expect(storeMock.resolveLocalFinding).not.toHaveBeenCalled();
  });

  it("404s a finding that is not the caller's", async () => {
    storeMock.resolveLocalFinding = vi.fn(async () => ({ ok: false, notFound: true }));
    const res = await call("POST", "local-directory/findings/f-1/resolve", { body: { resolution: "wont_fix" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /local-directory/radius", () => {
  it("builds the queries and says plainly that it ran none of them", async () => {
    const body = parse(await call("POST", "local-directory/radius", {
      body: { categories: ["plumber"], service_areas: ["Koramangala"], brand_name: "Acme" },
    }));
    expect(body.queries.map((q) => q.query)).toContain("plumber in Koramangala");
    expect(body.executed).toBe(false);
  });

  it("🔴 builds nothing for a business that declared no service area", async () => {
    const body = parse(await call("POST", "local-directory/radius", { body: { categories: ["plumber"] } }));
    expect(body.queries).toEqual([]);
    expect(body.reason).toMatch(/No service area/);
  });

  it("names the areas no listing places the business near", async () => {
    const body = parse(await call("POST", "local-directory/radius", {
      body: {
        categories: ["plumber"], service_areas: ["Koramangala", "Whitefield"],
        listing_localities: ["Koramangala, Bengaluru"],
      },
    }));
    expect(body.coverage.uncovered).toEqual(["Whitefield"]);
  });
});

describe("routing", () => {
  it("404s an unknown local-directory endpoint", async () => {
    const res = await call("GET", "local-directory/nonsense");
    expect(res.statusCode).toBe(404);
  });
});


describe("🔴 a parent id in a request body is a claim, not a fact", () => {
  // W9 checks a truth record before creating one, and W10 checks BOTH entities
  // before drawing an edge between them. W12 shipped with neither check, so a
  // caller could attach a listing — or file a whole local check — against a row
  // belonging to another tenant. The write would carry the attacker's user_id
  // and the victim's foreign key, and every later join over that record would
  // read a row its owner never wrote.
  it("refuses a listing against a truth record the caller does not own", async () => {
    storeMock.getTruthRecord = vi.fn(async () => null);
    storeMock.upsertDirectoryListing = vi.fn();
    const res = await call("POST", "local-directory/listings", {
      body: {
        source_id: "justdial", listing_url: "https://justdial.com/acme",
        truth_record_id: "someone-elses-record",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.getTruthRecord).toHaveBeenCalledWith("user-1", "someone-elses-record");
    expect(storeMock.upsertDirectoryListing).not.toHaveBeenCalled();
  });

  it("...answers 404 rather than 403, so the id cannot be enumerated", async () => {
    // A 403 confirms the row exists. That turns the endpoint into an oracle
    // over other tenants' uuids — the same reason invoice-pdf.js returns 404.
    storeMock.getTruthRecord = vi.fn(async () => null);
    const res = await call("POST", "local-directory/listings", {
      body: { source_id: "justdial", listing_url: "https://x.com", truth_record_id: "rec-x" },
    });
    expect(res.statusCode).toBe(404);
    expect(parse(res).error).not.toMatch(/forbidden|not allowed|permission/i);
  });

  it("refuses a check against a truth record the caller does not own", async () => {
    storeMock.getTruthRecord = vi.fn(async () => null);
    storeMock.listDirectoryListings = vi.fn(async () => []);
    storeMock.saveLocalCheck = vi.fn();
    const res = await call("POST", "local-directory/check", {
      body: { truth_record_id: "someone-elses-record", canonical: { name: "Acme" } },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.saveLocalCheck).not.toHaveBeenCalled();
  });

  it("refuses a check filed against a SUBJECT the caller does not own", async () => {
    // Otherwise a local score lands on somebody else's brand.
    storeMock.getSubject = vi.fn(async () => null);
    storeMock.listDirectoryListings = vi.fn(async () => []);
    storeMock.saveLocalCheck = vi.fn();
    const res = await call("POST", "local-directory/check", {
      body: { subject_id: "someone-elses-subject", canonical: { name: "Acme" } },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.getSubject).toHaveBeenCalledWith("user-1", "someone-elses-subject");
    expect(storeMock.saveLocalCheck).not.toHaveBeenCalled();
  });

  it("does not look up references the caller never supplied", async () => {
    // The guard must not turn an ordinary unscoped check into two wasted reads.
    storeMock.listDirectoryListings = vi.fn(async () => []);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "c-1" } }));
    const res = await call("POST", "local-directory/check", { body: { canonical: { name: "Acme" } } });
    expect(res.statusCode).toBe(201);
    expect(storeMock.getTruthRecord).not.toHaveBeenCalled();
    expect(storeMock.getSubject).not.toHaveBeenCalled();
  });
});

// ═══ 0076 · directory sources marked not applicable ═════════════════════════

describe("/local-directory/ignores", () => {
  it("records an ignore with its reason, scoped to the truth record", async () => {
    storeMock.ignoreDirectorySource = vi.fn(async () => ({ ok: true, ignore: { source_id: "practo" } }));
    const res = await call("POST", "local-directory/ignores", {
      body: { truth_record_id: "rec-1", source_id: "practo", reason: "Not relevant to our industry" },
    });
    expect(res.statusCode).toBe(201);
    expect(storeMock.ignoreDirectorySource).toHaveBeenCalledWith("user-1", expect.objectContaining({
      truthRecordId: "rec-1", sourceId: "practo", reason: "Not relevant to our industry",
    }));
  });

  it("🔴 refuses an ignore with no reason — an unexplained ignore reads as a mis-click", async () => {
    storeMock.ignoreDirectorySource = vi.fn();
    const res = await call("POST", "local-directory/ignores", {
      body: { truth_record_id: "rec-1", source_id: "practo", reason: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe("REASON_REQUIRED");
    expect(storeMock.ignoreDirectorySource).not.toHaveBeenCalled();
  });

  it("refuses an unknown source", async () => {
    storeMock.ignoreDirectorySource = vi.fn();
    const res = await call("POST", "local-directory/ignores", {
      body: { source_id: "made_up_directory", reason: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(storeMock.ignoreDirectorySource).not.toHaveBeenCalled();
  });

  it("🔴 404s an ignore against another tenant's truth record", async () => {
    storeMock.getTruthRecord = vi.fn(async () => null);
    storeMock.ignoreDirectorySource = vi.fn();
    const res = await call("POST", "local-directory/ignores", {
      body: { truth_record_id: "someone-else", source_id: "practo", reason: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(storeMock.ignoreDirectorySource).not.toHaveBeenCalled();
  });

  it("lists ignores and restores a source", async () => {
    storeMock.listDirectorySourceIgnores = vi.fn(async () => [{ source_id: "practo", reason: "n/a" }]);
    const list = parse(await call("GET", "local-directory/ignores", { query: { truth_record_id: "rec-1" } }));
    expect(list.count).toBe(1);
    storeMock.unignoreDirectorySource = vi.fn(async () => ({ ok: true }));
    const res = await call("DELETE", "local-directory/ignores/practo", { body: { truth_record_id: "rec-1" } });
    expect(res.statusCode).toBe(200);
    expect(storeMock.unignoreDirectorySource).toHaveBeenCalledWith("user-1", expect.objectContaining({ sourceId: "practo", truthRecordId: "rec-1" }));
  });

  it("🔴 a NAP check excludes an ignored source from both the scored listings and the configured set", async () => {
    storeMock.listDirectoryListings = vi.fn(async () => [listing()]);
    storeMock.listDirectorySourceIgnores = vi.fn(async () => [{ source_id: "justdial", reason: "Not relevant" }]);
    storeMock.saveLocalCheck = vi.fn(async () => ({ ok: true, check: { id: "chk-1" } }));
    const res = await call("POST", "local-directory/check", {
      body: { truth_record_id: "rec-1", canonical: CANONICAL, region: "in" },
    });
    const body = parse(res);
    expect(body.ignored_sources).toEqual(["justdial"]);
    expect(body.matches.map((m) => m.sourceId)).not.toContain("justdial");
    expect(storeMock.saveLocalCheck.mock.calls[0][1].matches.map((m) => m.sourceId)).not.toContain("justdial");
  });
});
