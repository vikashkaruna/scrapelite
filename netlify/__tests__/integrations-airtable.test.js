// netlify/__tests__/integrations-airtable.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist the mock so the regression test below can assert against it.
// 2026-08-12 fix: the production code now passes the JWT to
// `supabase.auth.getUser(jwt)` directly, because the bare
// `supabase.auth.getUser()` form returns `AuthSessionMissingError` on
// supabase-js v2.108+ when the client has no session and no
// `hasCustomAuthorizationHeader: true` flag (even though the global
// `Authorization` header IS set). This regression test pins that
// contract — if a future refactor drops the JWT arg, the test fails.
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "u1" } },
  error: null,
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

const mockStore = { get: vi.fn(), upsert: vi.fn(), delete: vi.fn() };
vi.mock("../functions/lib/integrationConnectionStore.js", () => ({
  getConnection: (...args) => mockStore.get(...args),
  upsertConnection: (...args) => mockStore.upsert(...args),
  deleteConnection: (...args) => mockStore.delete(...args),
}));

vi.mock("../../src/lib/airtable.js", () => ({
  pushToAirtable: vi.fn(),
  validateAirtableConfig: vi.fn(() => []),
}));

// The push entitlement gate hits the entitlements table via plain fetch() —
// not the mocked @supabase/supabase-js client — which would otherwise be a
// real, unmocked network call to the fake SUPABASE_URL during push tests.
const mockRequireCapabilityForUser = vi.fn().mockResolvedValue({ check: { allowed: true } });
vi.mock("../functions/lib/requireEntitlement.js", () => ({
  requireCapabilityForUser: (...args) => mockRequireCapabilityForUser(...args),
  denyBody: (check) => ({ error: check.reason, code: check.code }),
  DENY_STATUS: 402,
}));

import { handler } from "../functions/integrations-airtable.js";
import { pushToAirtable } from "../../src/lib/airtable.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: { authorization: "Bearer jwt" },
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("integrations-airtable", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_KEY = "service";
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const r = await handler(baseEvent({ headers: {} }));
    expect(r.statusCode).toBe(401);
  });

  // 2026-08-12 fix: supabase-js v2.108+ returns AuthSessionMissingError
  // when `supabase.auth.getUser()` is called on a client with no session
  // and no `hasCustomAuthorizationHeader: true` flag, even when the
  // global `Authorization` header IS set. The production code now
  // extracts the JWT from the request and calls `getUser(jwt)`. This
  // regression test pins that — if a future refactor drops the JWT
  // arg, the test fails with a clear 401 message.
  describe("auth passes JWT explicitly to getUser (2026-08-12 fix)", () => {
    it("calls getUser with the bearer token from the Authorization header", async () => {
      // The status handler calls the connection store first; mock it
      // to return no connection so the function completes with 200.
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      mockGetUser.mockImplementation((jwt) => {
        if (!jwt) {
          return Promise.resolve({
            data: { user: null },
            error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
          });
        }
        return Promise.resolve({ data: { user: { id: "u1" } }, error: null });
      });
      const r = await handler(baseEvent({
        httpMethod: "GET",
        headers: { authorization: "Bearer test-jwt-123" },
        queryStringParameters: { splat: "status" },
      }));
      expect(r.statusCode).toBe(200);
      expect(mockGetUser).toHaveBeenCalledWith("test-jwt-123");
      const calls = mockGetUser.mock.calls;
      expect(calls.every((c) => c[0] !== undefined)).toBe(true);
    });

    it("returns 401 when the auth header is missing the bearer prefix", async () => {
      mockGetUser.mockClear();
      const r = await handler(baseEvent({ headers: { authorization: "just-a-token-no-bearer" } }));
      expect(r.statusCode).toBe(401);
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });

  describe("GET /status", () => {
    it("returns connected:false when nothing is stored", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });

    // 2026-08-11 fix: handleStatus previously omitted token_hint, which
    // hid the Account page's "Token" line for Airtable and made users
    // think the PAT hadn't been saved. Notion/HubSpot/Zapier all return
    // token_hint; Airtable now does too.
    it("returns token_hint from config.api_key so the Account page shows the Token line", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          config: {
            api_key: "patABCDEFGHIJKLMNOP",
            base_id: "appXXX",
            table_id: "tblYYY",
          },
        },
      });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.connected).toBe(true);
      expect(body.connection.token_hint).toBe("patABCD…MNOP");
      expect(body.connection.has_api_key).toBe(true);
    });

    it("returns null token_hint when no api_key is stored (legacy row)", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { config: { base_id: "appXXX", table_id: "tblYYY" } },
      });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.connected).toBe(true);
      expect(body.connection.token_hint).toBeNull();
      expect(body.connection.has_api_key).toBe(false);
    });
  });

  describe("POST /connect", () => {
    it("rejects a missing config", async () => {
      const { validateAirtableConfig } = await import("../../src/lib/airtable.js");
      validateAirtableConfig.mockReturnValueOnce(["missing fields"]);
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({}),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("probes Airtable and stores the config", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      mockStore.upsert.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ apiKey: "patABCDEFGHIJKLMNOP", baseId: "appABCDEFGHIJK", tableId: "tblABCDEFGHIJK" }),
      }));
      expect(r.statusCode).toBe(200);
    });
    it("rejects when the probe fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ apiKey: "patABCDEFGHIJKLMNOP", baseId: "appABCDEFGHIJK", tableId: "tblABCDEFGHIJK" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("DELETE /connect", () => {
    it("removes the connection", async () => {
      mockStore.delete.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({ httpMethod: "DELETE", queryStringParameters: { splat: "connect" } }));
      expect(r.statusCode).toBe(200);
    });
  });

  describe("POST /push", () => {
    it("rejects an empty items array", async () => {
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [] }),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("delegates to pushToAirtable", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { config: { api_key: "patABCDEFGHIJK", base_id: "appXXX", table_id: "tblYYY" } },
      });
      pushToAirtable.mockResolvedValue({ ok: true, pushed: 3, total: 3, errors: [], failedRecords: [] });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ url: "a" }, { url: "b" }, { url: "c" }] }),
      }));
      expect(r.statusCode).toBe(200);
      expect(pushToAirtable).toHaveBeenCalled();
    });
    it("refuses the push server-side when the plan lacks the integrations capability", async () => {
      mockRequireCapabilityForUser.mockResolvedValueOnce({
        check: { allowed: false, reason: "Push integrations are Select and up.", code: "NOT_IN_PLAN" },
      });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ url: "a" }] }),
      }));
      expect(r.statusCode).toBe(402);
      expect(pushToAirtable).not.toHaveBeenCalled();
    });
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
  });
});
