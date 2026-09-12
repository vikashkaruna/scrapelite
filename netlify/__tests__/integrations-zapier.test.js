// netlify/__tests__/integrations-zapier.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

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

const mockEventStore = { append: vi.fn(), poll: vi.fn() };
vi.mock("../functions/lib/zapierEventStore.js", () => ({
  appendEvent: (...args) => mockEventStore.append(...args),
  pollEvents: (...args) => mockEventStore.poll(...args),
}));

import { handler } from "../functions/integrations-zapier.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: { authorization: "Bearer jwt" },
  queryStringParameters: {},
  body: null,
  ...overrides,
});

const TOKEN = "zap_abcdefghijklmnopqrstuvwxyz1234567890ABCDEF";
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");

describe("integrations-zapier", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_KEY = "service";
    vi.clearAllMocks();
  });

  describe("public endpoints (no JWT)", () => {
    it("GET /test returns 401 without X-Zapier-Token", async () => {
      const r = await handler(baseEvent({ headers: {}, queryStringParameters: { splat: "test" } }));
      expect(r.statusCode).toBe(401);
    });

    it("GET /test returns 401 with a malformed token", async () => {
      const r = await handler(baseEvent({
        headers: { "x-zapier-token": "not-a-zap-token" },
        queryStringParameters: { splat: "test" },
      }));
      expect(r.statusCode).toBe(401);
    });

    // Regression: Zapier's Visual Builder frequently misclassifies a JSON
    // `custom` auth as `api_key` auth on import, which sends the token
    // as `?api_key=<token>` instead of the X-Zapier-Token header. The
    // test endpoint now accepts both, so a "Connection failed" 401 in
    // Zapier's UI is no longer a death sentence — it just means we need
    // to know about the visual-builder quirk.
    it("GET /test accepts the token via ?api_key query param (Zapier 'API Key' auth mode)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: TOKEN_HASH } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      const r = await handler(baseEvent({
        // No X-Zapier-Token header — the visual builder never sets it
        // when the auth was classified as "API Key" on import.
        queryStringParameters: { splat: "test", api_key: TOKEN },
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(true);
    });

    it("GET /test accepts the token via ?token query param (some custom templates)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: TOKEN_HASH } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      const r = await handler(baseEvent({
        queryStringParameters: { splat: "test", token: TOKEN },
      }));
      expect(r.statusCode).toBe(200);
    });

    it("GET /test prefers the X-Zapier-Token header over the query-param fallbacks", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: TOKEN_HASH } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      const r = await handler(baseEvent({
        headers: { "x-zapier-token": TOKEN },
        queryStringParameters: { splat: "test", api_key: "wrong-zap-token" },
      }));
      expect(r.statusCode).toBe(200);
    });

    it("GET /test returns 401 with a helpful error when no token is present at all", async () => {
      const r = await handler(baseEvent({
        queryStringParameters: { splat: "test" },
      }));
      expect(r.statusCode).toBe(401);
      const body = JSON.parse(r.body);
      // The error message lists all three accepted locations so a user
      // debugging from the dashboard knows what to look for.
      expect(body.error).toMatch(/X-Zapier-Token/);
      expect(body.error).toMatch(/api_key/);
    });

    it("GET /test returns 200 when the token matches a stored hash", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: TOKEN_HASH } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      const r = await handler(baseEvent({
        headers: { "x-zapier-token": TOKEN },
        queryStringParameters: { splat: "test" },
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ok: true });
    });

    it("GET /test returns 401 when the token doesn't match", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: "wrong" } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      const r = await handler(baseEvent({
        headers: { "x-zapier-token": TOKEN },
        queryStringParameters: { splat: "test" },
      }));
      expect(r.statusCode).toBe(401);
    });

    it("GET /actions returns the action catalogue", async () => {
      const r = await handler(baseEvent({ queryStringParameters: { splat: "actions" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.actions.map((a) => a.key)).toEqual(
        expect.arrayContaining(["extract_url", "create_schedule", "enrich_extraction"]),
      );
    });

    it("GET /poll returns events since the cursor", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify([{ id: "c1", user_id: "u1", config: { token_hash: TOKEN_HASH } }]),
        { status: 200 },
      ));
      globalThis.fetch = fetchMock;
      mockEventStore.poll.mockResolvedValue({ ok: true, events: [{ id: "e1", event_type: "new_extraction" }] });
      const r = await handler(baseEvent({
        headers: { "x-zapier-token": TOKEN },
        queryStringParameters: { splat: "poll", event_type: "new_extraction" },
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).events).toHaveLength(1);
    });
  });

  describe("internal endpoints (require JWT)", () => {
    it("GET /status returns connected:false when no row exists", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });

    it("POST /connect with regenerate:true mints and stores a new token", async () => {
      mockStore.upsert.mockResolvedValue({ ok: true, created: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ regenerate: true }),
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.token).toMatch(/^zap_/);
      // Token hash should have been stored, not the plaintext
      expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
        fields: expect.objectContaining({
          config: expect.objectContaining({ token_hash: expect.any(String) }),
        }),
      }));
    });

    it("POST /connect with an existing token stores its hash but never echoes it back", async () => {
      mockStore.upsert.mockResolvedValue({ ok: true, created: false });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ token: TOKEN }),
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.token).toBeUndefined();
    });

    it("POST /connect rejects a non-zap_ token", async () => {
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ token: "dq_live_xxx" }),
      }));
      expect(r.statusCode).toBe(400);
    });

    it("DELETE /connect removes the connection", async () => {
      mockStore.delete.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({
        httpMethod: "DELETE",
        queryStringParameters: { splat: "connect" },
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });

    it("POST /events appends an event for the user", async () => {
      mockEventStore.append.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "events" },
        body: JSON.stringify({ event_type: "new_extraction", payload: { id: "e1" } }),
      }));
      expect(r.statusCode).toBe(201);
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        userId: "u1", eventType: "new_extraction",
      }));
    });

    it("POST /push returns 412 if Zapier is not connected", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ url: "https://example.com" }] }),
      }));
      expect(r.statusCode).toBe(412);
      expect(JSON.parse(r.body).error).toMatch(/Zapier is not connected/);
    });

    it("POST /push pushes to Zapier Catch Hook and emits event", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          id: "c1",
          config: { token_hash: TOKEN_HASH, webhook_url: "https://hooks.zapier.com/hooks/catch/123/456" },
        },
      });
      mockEventStore.append.mockResolvedValue({ ok: true });
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      globalThis.fetch = fetchMock;

      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "push" },
        body: JSON.stringify({ items: [{ id: "e1", url: "https://example.com", title: "Example" }] }),
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).ok).toBe(true);
      expect(mockEventStore.append).toHaveBeenCalled();
    });

    it("PATCH /connect updates webhook_url and account_label without changing token_hash", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          id: "c1",
          account_label: "Old Label",
          config: { token_hash: TOKEN_HASH, token_hint: "DEF", webhook_url: "https://hooks.zapier.com/old" },
        },
      });
      mockStore.upsert.mockResolvedValue({ ok: true });

      const r = await handler(baseEvent({
        httpMethod: "PATCH",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({
          accountLabel: "New Zapier Label",
          webhookUrl: "https://hooks.zapier.com/hooks/catch/new/path",
        }),
      }));

      expect(r.statusCode).toBe(200);
      const res = JSON.parse(r.body);
      expect(res.ok).toBe(true);
      expect(res.webhook_url).toBe("https://hooks.zapier.com/hooks/catch/new/path");

      expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
        fields: expect.objectContaining({
          account_label: "New Zapier Label",
          config: expect.objectContaining({
            token_hash: TOKEN_HASH,
            token_hint: "DEF",
            webhook_url: "https://hooks.zapier.com/hooks/catch/new/path",
          }),
        }),
      }));
    });

    it("GET /status returns full webhook_url in connection object", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: {
          id: "c1",
          account_label: "Zapier",
          config: {
            token_hash: TOKEN_HASH,
            token_hint: "DEF",
            webhook_url: "https://hooks.zapier.com/hooks/catch/123/456",
          },
        },
      });

      const r = await handler(baseEvent({
        httpMethod: "GET",
        queryStringParameters: { splat: "status" },
      }));

      expect(r.statusCode).toBe(200);
      const res = JSON.parse(r.body);
      expect(res.connection.webhook_url).toBe("https://hooks.zapier.com/hooks/catch/123/456");
      expect(res.connection.webhook_hint).toBe("https://hooks.zapier.com/hooks/c…");
    });

    describe("authenticated POST /test (Account UI / Edit modal)", () => {
      it("pings Zapier Catch Hook webhook URL when configured", async () => {
        mockStore.get.mockResolvedValue({
          ok: true,
          connection: {
            id: "c1",
            config: {
              token_hash: TOKEN_HASH,
              token_hint: "DEF",
              webhook_url: "https://hooks.zapier.com/hooks/catch/123/456",
            },
          },
        });
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success" }), { status: 200 }));
        globalThis.fetch = fetchMock;

        const r = await handler(baseEvent({
          httpMethod: "POST",
          queryStringParameters: { splat: "test" },
          body: JSON.stringify({ action: "test" }),
        }));

        expect(r.statusCode).toBe(200);
        const res = JSON.parse(r.body);
        expect(res.ok).toBe(true);
        expect(res.type).toBe("webhook");
        expect(res.detail).toMatch(/Catch Hook received test ping successfully/);
        expect(fetchMock).toHaveBeenCalledWith(
          "https://hooks.zapier.com/hooks/catch/123/456",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("test.ping"),
          })
        );
      });

      it("returns token confirmation when only token is configured", async () => {
        mockStore.get.mockResolvedValue({
          ok: true,
          connection: {
            id: "c1",
            config: {
              token_hash: TOKEN_HASH,
              token_hint: "DEF",
              webhook_url: null,
            },
          },
        });

        const r = await handler(baseEvent({
          httpMethod: "POST",
          queryStringParameters: { splat: "test" },
          body: JSON.stringify({ action: "test" }),
        }));

        expect(r.statusCode).toBe(200);
        const res = JSON.parse(r.body);
        expect(res.ok).toBe(true);
        expect(res.type).toBe("token");
        expect(res.detail).toMatch(/Token \(ending in DEF\) stored and ready/);
      });

      it("verifies a valid secret token sent in body", async () => {
        mockStore.get.mockResolvedValue({
          ok: true,
          connection: {
            id: "c1",
            config: {
              token_hash: TOKEN_HASH,
              token_hint: "DEF",
            },
          },
        });

        const r = await handler(baseEvent({
          httpMethod: "POST",
          queryStringParameters: { splat: "test" },
          body: JSON.stringify({ action: "test", token: TOKEN }),
        }));

        expect(r.statusCode).toBe(200);
        const res = JSON.parse(r.body);
        expect(res.ok).toBe(true);
        expect(res.type).toBe("token");
        expect(res.detail).toMatch(/Secret key verified successfully/);
      });

      it("rejects an invalid secret token sent in body", async () => {
        mockStore.get.mockResolvedValue({
          ok: true,
          connection: {
            id: "c1",
            config: {
              token_hash: TOKEN_HASH,
              token_hint: "DEF",
            },
          },
        });

        const r = await handler(baseEvent({
          httpMethod: "POST",
          queryStringParameters: { splat: "test" },
          body: JSON.stringify({ action: "test", token: "zap_wrongtoken12345678901234567890" }),
        }));

        expect(r.statusCode).toBe(401);
        const res = JSON.parse(r.body);
        expect(res.error).toMatch(/does not match/);
      });
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

  // 2026-08-11 fix: the Zapier handler used to have no top-level
  // try/catch (only Airtable + HubSpot did). When a downstream call
  // threw — e.g. the connection store crashed, or a Zapier token verify
  // blew up parsing a malformed response — the function surfaced as a
  // Netlify 502 with no body, which the modal then rendered as a bare
  // "HTTP 502". The fix wraps the dispatch in try/catch and returns 500
  // + err.message. This test pins that contract.
  describe("uncaught throw → 500 with err.message (2026-08-11 fix)", () => {
    it("returns 500 with the error message when handleStatus throws", async () => {
      mockStore.get.mockRejectedValueOnce(new Error("simulated db down"));
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/simulated db down/);
    });

    it("returns 500 with the error message when handleConnect throws", async () => {
      mockStore.upsert.mockRejectedValueOnce(new Error("upsert blew up"));
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ regenerate: true }),
      }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/upsert blew up/);
    });

    it("returns 500 with the error message when handleDisconnect throws", async () => {
      mockStore.delete.mockRejectedValueOnce(new Error("delete blew up"));
      const r = await handler(baseEvent({
        httpMethod: "DELETE",
        queryStringParameters: { splat: "connect" },
      }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/delete blew up/);
    });

    it("returns 500 with the error message when /events append throws", async () => {
      mockEventStore.append.mockRejectedValueOnce(new Error("event store down"));
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "events" },
        body: JSON.stringify({ event_type: "new_extraction", payload: { id: "e1" } }),
      }));
      expect(r.statusCode).toBe(500);
      expect(JSON.parse(r.body).error).toMatch(/event store down/);
    });
  });
});
