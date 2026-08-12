// netlify/__tests__/integrations-notion.test.js
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

vi.mock("../../src/lib/notion.js", () => ({
  pushToNotion: vi.fn(),
  fetchNotionSchema: vi.fn(),
  buildNotionPageBody: vi.fn(),
  validateNotionConfig: vi.fn(() => []),
  defaultNotionSchema: vi.fn(() => ({ Title: { type: "title" } })),
}));

import { handler } from "../functions/integrations-notion.js";
import { pushToNotion, fetchNotionSchema } from "../../src/lib/notion.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: { authorization: "Bearer jwt" },
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("integrations-notion", () => {
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

  describe("GET /status", () => {
    it("returns connected:false when nothing is stored", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });
    it("returns the connection (no secrets)", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          id: "c1", user_id: "u1", provider: "notion",
          config: { api_key: "secret", database_id: "abc" },
        },
      });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      const body = JSON.parse(r.body);
      expect(body.connected).toBe(true);
      expect(body.connection.has_api_key).toBe(true);
      expect(body.connection.config).toBeUndefined(); // masked
    });
  });

  describe("POST /connect", () => {
    it("rejects a missing config", async () => {
      // Force validation to fail
      const { validateNotionConfig } = await import("../../src/lib/notion.js");
      validateNotionConfig.mockReturnValueOnce(["missing fields"]);
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({}),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("probes the database and stores the config", async () => {
      fetchNotionSchema.mockResolvedValue({
        ok: true,
        properties: { Name: "title" },
        titleColumn: "Name",
      });
      mockStore.upsert.mockResolvedValue({ ok: true, created: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ apiKey: "secret_abcdefghijklmnop", databaseId: "abc".repeat(11) }),
      }));
      expect(r.statusCode).toBe(200);
      expect(mockStore.upsert).toHaveBeenCalled();
    });
    it("rejects when the probe fails", async () => {
      fetchNotionSchema.mockResolvedValue({ ok: false, error: "invalid token" });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ apiKey: "secret_abcdefghijklmnop", databaseId: "abc".repeat(11) }),
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
    it("delegates to pushToNotion with the stored token", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { config: { api_key: "secret_xyz", database_id: "db" } },
      });
      pushToNotion.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ url: "x" }, { url: "y" }] }),
      }));
      expect(r.statusCode).toBe(200);
      expect(pushToNotion).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ apiKey: "secret_xyz", databaseId: "db" }),
      );
    });
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
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
      // Simulate the broken behavior: if the code calls getUser() with
      // no argument, the JWT-less getUser should return an error
      // (this is what supabase-js does in production). The mocked
      // getUser would only return the success response if called with
      // a non-undefined arg, so we make the bare-call case return an
      // error and verify the function still works.
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
      // The bare-call path (getUser with no arg) must NOT have been
      // taken — that was the bug.
      const calls = mockGetUser.mock.calls;
      expect(calls.every((c) => c[0] !== undefined)).toBe(true);
    });

    it("returns 401 when the auth header is missing the bearer prefix", async () => {
      // No "Bearer " prefix → no extractable JWT → 401 before supabase is touched.
      mockGetUser.mockClear();
      const r = await handler(baseEvent({ headers: { authorization: "just-a-token-no-bearer" } }));
      expect(r.statusCode).toBe(401);
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });

  // 2026-08-11 fix: the Notion handler used to have no top-level
  // try/catch (only Airtable + HubSpot did). When a downstream call
  // threw — e.g. the connection store crashed, or pushToNotion threw on
  // a malformed item — the function surfaced as a Netlify 502 with no
  // body, which the modal then rendered as a bare "HTTP 502". The fix
  // wraps the dispatch in try/catch and returns 500 + err.message. This
  // test pins that contract.
  describe("uncaught throw → 500 with err.message (2026-08-11 fix)", () => {
    it("returns 500 with the error message when handleStatus throws", async () => {
      mockStore.get.mockRejectedValueOnce(new Error("simulated db down"));
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/simulated db down/);
    });

    it("returns 500 with the error message when handleConnect throws", async () => {
      // The schema probe must succeed first (it's the step before
      // upsert in handleConnect). If we don't mock it, the probe
      // returns undefined and the handler bails with 400 before the
      // upsert throw is reached.
      fetchNotionSchema.mockResolvedValueOnce({
        ok: true,
        properties: { Title: { type: "title" } },
        titleColumn: "Title",
      });
      mockStore.upsert.mockRejectedValueOnce(new Error("upsert blew up"));
      // /connect is the path the user hits from the Account page; this
      // is the EXACT scenario that was rendering "HTTP 502" before the
      // fix.
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ apiKey: "secret_abcdefghijklmnop", databaseId: "abc".repeat(11) }),
      }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/upsert blew up/);
    });

    it("returns 500 with the error message when handlePush throws", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { config: { api_key: "secret_xyz", database_id: "db" } },
      });
      pushToNotion.mockRejectedValueOnce(new Error("notion push crashed"));
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ url: "x" }] }),
      }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/notion push crashed/);
    });
  });
});
