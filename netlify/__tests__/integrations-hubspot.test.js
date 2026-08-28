// netlify/__tests__/integrations-hubspot.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist the mock so the regression test below can assert against it.
// 2026-08-12 fix: the production code now passes the JWT to
// `supabase.auth.getUser(jwt)` directly, because the bare
// `supabase.auth.getUser()` form returns `AuthSessionMissingError` on
// supabase-js v2.108+ when the client has no session and no
// `hasCustomAuthorizationHeader: true` flag (even though the global
// `Authorization` header IS set). This regression test pins that
// contract — if a future refactor drops the JWT arg, the test fails.
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "u1", email: "u1@example.com" } },
  error: null,
});

// Mock the supabase JWT verification so we don't need a real Supabase.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

// Mock the connection store + hubspot service so the test is hermetic.
const mockStore = {
  get: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
};
vi.mock("../functions/lib/integrationConnectionStore.js", () => ({
  getConnection: (...args) => mockStore.get(...args),
  upsertConnection: (...args) => mockStore.upsert(...args),
  deleteConnection: (...args) => mockStore.delete(...args),
}));

const mockHubspot = {
  push: vi.fn(),
};
vi.mock("../functions/lib/hubspotService.js", () => ({
  pushExtractionToHubSpot: (...args) => mockHubspot.push(...args),
  DEFAULT_CONTACT_MAPPING: { email: "email" },
  DEFAULT_COMPANY_MAPPING: { name: "page_title" },
}));

// The push entitlement gate hits the entitlements table via plain fetch() —
// not the mocked @supabase/supabase-js client — which would otherwise be a
// REAL, unmocked network call to the fake SUPABASE_URL below during "POST
// /push" tests (it happens to fail open on the DNS error, but a real lookup
// in a test is exactly the flakiness trap this codebase has been bitten by
// before — see CLAUDE.md's LinkedIn/DNS note).
const mockRequireCapabilityForUser = vi.fn().mockResolvedValue({ check: { allowed: true } });
vi.mock("../functions/lib/requireEntitlement.js", () => ({
  requireCapabilityForUser: (...args) => mockRequireCapabilityForUser(...args),
  denyBody: (check) => ({ error: check.reason, code: check.code }),
  DENY_STATUS: 402,
}));

import { handler } from "../functions/integrations-hubspot.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: { authorization: "Bearer jwt" },
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("integrations-hubspot", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_KEY = "service";
    vi.clearAllMocks();
  });

  it("returns 204 for OPTIONS preflight", async () => {
    const r = await handler(baseEvent({ httpMethod: "OPTIONS" }));
    expect(r.statusCode).toBe(204);
  });

  it("returns 401 when no Authorization header is set", async () => {
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
    it("returns connected:false when no connection exists", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ connected: false, provider: "hubspot" });
    });
    it("returns the connection but masks tokens", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          id: "c1", user_id: "u1", provider: "hubspot",
          account_label: "ACME", access_token: "secret", refresh_token: "rsecret",
        },
      });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.connected).toBe(true);
      expect(body.connection.account_label).toBe("ACME");
      expect(body.connection.access_token).toBeUndefined();
      expect(mockStore.get).toHaveBeenCalledWith({ userId: "u1", provider: "hubspot", includeSecrets: true });
    });
  });

  describe("POST /connect", () => {
    it("rejects a missing access token", async () => {
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({}),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("probes HubSpot, then stores the token", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock;
      mockStore.upsert.mockResolvedValue({ ok: true, created: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ accessToken: "pat-na1-very-long-token-1234" }),
      }));
      expect(r.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalled();
      expect(mockStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", provider: "hubspot", fields: expect.objectContaining({ access_token: expect.any(String) }) }),
      );
    });
    it("rejects when HubSpot's probe returns 4xx", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ accessToken: "pat-na1-very-long-token-1234" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("DELETE /connect", () => {
    it("removes the stored connection", async () => {
      mockStore.delete.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({
        httpMethod: "DELETE",
        queryStringParameters: { splat: "connect" },
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });
  });

  describe("POST /push", () => {
    it("rejects when no extraction is in the body", async () => {
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({}),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("returns 412 when HubSpot is not connected", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ extraction: { url: "x" } }),
      }));
      expect(r.statusCode).toBe(412);
    });
    it("delegates to pushExtractionToHubSpot with the stored token", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { access_token: "pat-xxx" },
      });
      mockHubspot.push.mockResolvedValue({
        ok: true, company: { id: "co-1" }, contacts: [], counts: { contacts_created: 0, contacts_updated: 0, contacts_attempted: 0 },
      });
      const extraction = { url: "https://acme.com", page_title: "Acme" };
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ extraction }),
      }));
      expect(r.statusCode).toBe(200);
      expect(mockHubspot.push).toHaveBeenCalledWith(
        extraction,
        expect.objectContaining({ accessToken: "pat-xxx" }),
      );
    });
    it("refuses the push server-side when the plan lacks the integrations capability", async () => {
      mockRequireCapabilityForUser.mockResolvedValueOnce({
        check: { allowed: false, reason: "Push integrations are Select and up.", code: "NOT_IN_PLAN" },
      });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ extraction: { url: "https://acme.com" } }),
      }));
      expect(r.statusCode).toBe(402);
      expect(mockHubspot.push).not.toHaveBeenCalled();
    });
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
  });
});
