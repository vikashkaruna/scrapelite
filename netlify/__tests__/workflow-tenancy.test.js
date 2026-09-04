// Tenancy and entitlement contract tests for the Phase 4-6 endpoints:
//   bulk-enrichment.js (PRD 3) · watchlists.js (PRD 4) · signal-rules.js (PRD 5)
//
// These three shipped with NO contract tests at all, which is precisely how the
// following reached staging together:
//
//   1. `const userId = auth.ok ? auth.user?.id : null` — an auth FAILURE fell
//      through as an anonymous request rather than a refusal.
//   2. Every store then did `if (userId) q = q.eq("user_id", userId)`, so a
//      null id meant "no filter" on a query running under the SERVICE key,
//      which bypasses RLS. An unauthenticated GET returned every tenant's rows.
//   3. Nested writes (field_changes, review_queue, enrichment_jobs) matched on
//      an id alone, with no ownership check at all.
//   4. No entitlement check anywhere, so three of the BRD's own upgrade
//      triggers were unenforceable and three cost-bearing operations unmetered.
//
// The properties pinned here are the ones that leak or cost money:
//   - no valid JWT ⇒ 401, and NOTHING is read or written
//   - identity comes from the verified JWT, never from the body or query
//   - a nested write against someone else's parent object is 404, not 403
//     (404 so ids cannot be enumerated — the rule templates.js already follows)
//   - plan limits are checked BEFORE the write, so a refused request costs zero

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FREE_ENT = { plan_id: "free", status: "active", source: "signup", period_end: "2999-01-01" };
const BUSINESS_ENT = { plan_id: "business", status: "active", source: "payment", period_end: "2999-01-01" };

let fetchMock;
let entitlementRow;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  entitlementRow = FREE_ENT;
  vi.resetModules();
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/entitlements?")) return jsonRes([entitlementRow]);
    return jsonRes([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

/**
 * `user = null` simulates a request whose bearer token is absent, expired or
 * forged — exactly the case the old code treated as "anonymous, carry on".
 *
 * The whole supabaseServerClient surface is mocked, not just authenticateBearer:
 * requireEntitlement.js imports getUserScopedClient from the same module, and an
 * undefined import throws inside resolveRequestEntitlement, which the handler's
 * own try/catch then reports as an opaque 500 that looks like a handler bug.
 */
async function loadHandler(modulePath, user = { id: "user-1", email: "u1@x.com" }) {
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user ? { ok: true, user, client: {} }
           : { ok: false, status: 401, body: { error: "Authentication required" } }),
    getUserScopedClient: vi.fn(() => ({ client: null, problem: null, message: null })),
    bearerToken: vi.fn((h) => String(h || "").replace(/^Bearer\s+/i, "") || null),
  }));
  return (await import(modulePath)).handler;
}

const AUTH = { authorization: "Bearer t" };
const get = (qs = {}, headers = AUTH) => ({ httpMethod: "GET", headers, queryStringParameters: qs });
const post = (body, headers = AUTH) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });

/** Every Supabase REST call this test's fetch mock saw. */
const restCalls = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/rest/v1/"));

const ENDPOINTS = [
  { name: "bulk-enrichment", path: "../functions/bulk-enrichment.js" },
  { name: "watchlists", path: "../functions/watchlists.js" },
  { name: "signal-rules", path: "../functions/signal-rules.js" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authentication is a refusal, not a fall-through.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(ENDPOINTS)("$name — an unauthenticated caller is refused", ({ path }) => {
  it("GET without a valid token returns 401", async () => {
    const h = await loadHandler(path, null);
    const r = await h(get({}, {}));
    expect(r.statusCode).toBe(401);
  });

  it("GET without a valid token returns no rows of any kind", async () => {
    const h = await loadHandler(path, null);
    const body = JSON.parse((await h(get({}, {}))).body);
    // The pre-fix code answered 200 with every tenant's rows in one of these
    // three keys. Whichever key this endpoint uses, it must not be populated.
    expect(body.lists ?? []).toEqual([]);
    expect(body.watchlists ?? []).toEqual([]);
    expect(body.rules ?? []).toEqual([]);
  });

  it("GET without a valid token never reaches the database", async () => {
    const h = await loadHandler(path, null);
    await h(get({}, {}));
    // The strongest form of the assertion: a refusal that still queried would
    // be a refusal on the response only.
    expect(restCalls()).toEqual([]);
  });

  it("POST without a valid token returns 401 and writes nothing", async () => {
    const h = await loadHandler(path, null);
    const r = await h(post({ action: "create", name: "x", domains: ["a.com"] }, {}));
    expect(r.statusCode).toBe(401);
    expect(restCalls()).toEqual([]);
  });

  it("an unknown method is rejected", async () => {
    const h = await loadHandler(path);
    expect((await h({ httpMethod: "DELETE", headers: AUTH })).statusCode).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ownership: identity comes from the JWT, and nested writes prove the parent.
// ─────────────────────────────────────────────────────────────────────────────
describe("watchlists — cross-tenant writes", () => {
  it("refuses to record a change against a watchlist the caller does not own", async () => {
    // The ownership probe returns no row → not this caller's watchlist.
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([BUSINESS_ENT]);
      return jsonRes([]);
    });
    const h = await loadHandler("../functions/watchlists.js");
    const r = await h(post({
      action: "record_change",
      watchlistId: "someone-elses-watchlist",
      targetId: "t1",
      field: "pricing.tiers",
      oldValue: "$99",
      newValue: "$1",
    }));

    // 404, not 403: a 403 confirms the id exists and turns the endpoint into an
    // oracle for enumerating other tenants' watchlist ids.
    expect(r.statusCode).toBe(404);
    // And nothing was inserted into field_changes.
    expect(restCalls().some((u) => u.includes("field_changes"))).toBe(false);
  });

  it("never takes the owning user id from the request body", async () => {
    const h = await loadHandler("../functions/watchlists.js", { id: "user-1", email: "u1@x.com" });
    await h(post({ action: "create", name: "W", user_id: "user-2", domains: ["a.com"] }));
    const bodies = fetchMock.mock.calls
      .map((c) => c[1]?.body)
      .filter(Boolean)
      .map(String);
    expect(bodies.some((b) => b.includes("user-2"))).toBe(false);
  });
});

describe("bulk-enrichment — cross-tenant writes", () => {
  it("refuses to advance an enrichment job the caller does not own", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([BUSINESS_ENT]);
      return jsonRes([]); // ownership probe finds nothing
    });
    const h = await loadHandler("../functions/bulk-enrichment.js");
    const r = await h(post({ action: "process_chunk", jobId: "someone-elses-job" }));
    expect(r.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Plan enforcement — PRD 3 "usage cap and plan enforcement", checked BEFORE
//    the write so a refused request costs nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("bulk-enrichment — plan enforcement", () => {
  it("refuses a list larger than the plan's batch allowance with 402", async () => {
    entitlementRow = FREE_ENT; // free: batch_max_urls = 5
    const h = await loadHandler("../functions/bulk-enrichment.js");
    const domains = Array.from({ length: 50 }, (_, i) => `co${i}.com`);
    const r = await h(post({ action: "create", name: "Big list", domains }));

    // 402 Payment Required: unambiguously a billing problem, not a bug or a
    // login problem — the status denyResponse() uses everywhere else.
    expect(r.statusCode).toBe(402);
    // Nothing was written: the gate sits above the insert.
    expect(restCalls().some((u) => u.includes("/lists"))).toBe(false);
  });

  it("allows a list within the plan's allowance", async () => {
    entitlementRow = BUSINESS_ENT;
    const h = await loadHandler("../functions/bulk-enrichment.js");
    const r = await h(post({ action: "create", name: "Small list", domains: ["a.com", "b.com"] }));
    expect(r.statusCode).not.toBe(402);
  });
});

describe("signal-rules — plan enforcement and destination validation", () => {
  it("refuses rule creation on a plan without integrations", async () => {
    entitlementRow = FREE_ENT; // free: integrations = false
    const h = await loadHandler("../functions/signal-rules.js");
    const r = await h(post({
      action: "create",
      name: "Alert me",
      action_type: "slack",
      action_config: { url: "https://hooks.slack.com/services/T/B/C" },
    }));
    expect(r.statusCode).toBe(402);
  });

  it("refuses a webhook destination pointing at a private address (SSRF)", async () => {
    entitlementRow = BUSINESS_ENT;
    const h = await loadHandler("../functions/signal-rules.js");
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",   // cloud instance metadata
      "http://127.0.0.1:8080/admin",                 // loopback
      "http://10.0.0.5/internal",                    // RFC1918
      "file:///etc/passwd",                          // non-http scheme
    ]) {
      const r = await h(post({
        action: "create", name: "Exfil", action_type: "webhook", action_config: { url },
      }));
      expect(r.statusCode, `expected ${url} to be refused`).toBe(400);
      expect(restCalls().some((u) => u.includes("signal_rules"))).toBe(false);
    }
  });

  it("refuses a Slack action that posts somewhere other than Slack", async () => {
    entitlementRow = BUSINESS_ENT;
    const h = await loadHandler("../functions/signal-rules.js");
    const r = await h(post({
      action: "create",
      name: "Not really Slack",
      action_type: "slack",
      action_config: { url: "https://attacker.example.com/collect" },
    }));
    expect(r.statusCode).toBe(400);
  });

  it("accepts a genuine Slack webhook destination", async () => {
    entitlementRow = BUSINESS_ENT;
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([BUSINESS_ENT]);
      if (u.includes("signal_rules")) return jsonRes({ id: "rule-1", user_id: "user-1" });
      return jsonRes([]);
    });
    const h = await loadHandler("../functions/signal-rules.js");
    const r = await h(post({
      action: "create",
      name: "Pricing alert",
      action_type: "slack",
      action_config: { url: "https://hooks.slack.com/services/T00/B00/xyz" },
    }));
    expect(r.statusCode).toBe(201);
  });

  it("refuses an email action whose recipient carries a header-splitting newline", async () => {
    entitlementRow = BUSINESS_ENT;
    const h = await loadHandler("../functions/signal-rules.js");
    const r = await h(post({
      action: "create",
      name: "Relay",
      action_type: "email",
      action_config: { to: "ok@x.com\nBcc: everyone@victim.com" },
    }));
    expect(r.statusCode).toBe(400);
  });
});
