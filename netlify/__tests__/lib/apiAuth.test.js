// netlify/__tests__/lib/apiAuth.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  bearerFromEvent,
  extractBearer,
  errorBody,
  errorResponse,
  okResponse,
  authenticateApiRequest,
  _internal,
} from "../../functions/lib/apiAuth.js";
import {
  _resetApiRateLimiterForTests,
  takeApiKeyToken,
} from "../../functions/lib/apiRateLimiter.js";
import { generateApiKey } from "../../functions/lib/apiKeyService.js";

// ── Mock the apiKeyStore findActiveApiKey so tests don't need a DB ──────────
vi.mock("../../functions/lib/apiKeyStore.js", async () => {
  const actual = await vi.importActual("../../functions/lib/apiKeyStore.js");
  return {
    ...actual,
    findActiveApiKey: vi.fn(),
    touchApiKey: vi.fn().mockResolvedValue(undefined),
  };
});

import { findActiveApiKey, touchApiKey } from "../../functions/lib/apiKeyStore.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: {},
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("apiAuth", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    _resetApiRateLimiterForTests();
    vi.clearAllMocks();
  });

  describe("bearerFromEvent", () => {
    it("reads lowercase 'authorization'", () => {
      expect(bearerFromEvent({ headers: { authorization: "Bearer x" } })).toBe("Bearer x");
    });
    it("reads uppercase 'Authorization'", () => {
      expect(bearerFromEvent({ headers: { Authorization: "Bearer x" } })).toBe("Bearer x");
    });
    it("returns empty string when missing", () => {
      expect(bearerFromEvent({ headers: {} })).toBe("");
      expect(bearerFromEvent({})).toBe("");
    });
  });

  describe("extractBearer", () => {
    it("returns the raw key for a Bearer header", () => {
      expect(extractBearer("Bearer dq_live_abc")).toBe("dq_live_abc");
      expect(extractBearer("bearer dq_live_abc")).toBe("dq_live_abc");
      expect(extractBearer("BEARER   dq_live_abc  ")).toBe("dq_live_abc");
    });
    it("returns null for non-Bearer headers", () => {
      expect(extractBearer("Basic abc")).toBeNull();
      expect(extractBearer("dq_live_abc")).toBeNull();
      expect(extractBearer(null)).toBeNull();
    });
  });

  describe("errorBody / errorResponse / okResponse", () => {
    it("errorBody wraps code + message in { error: { ... } }", () => {
      expect(errorBody("not_found", "missing")).toEqual({ error: { code: "not_found", message: "missing" } });
    });
    it("errorResponse emits the right status + CORS headers", () => {
      const r = errorResponse(401, "unauthorized", "nope");
      expect(r.statusCode).toBe(401);
      expect(r.headers["Content-Type"]).toBe("application/json");
      expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(JSON.parse(r.body).error.code).toBe("unauthorized");
    });
    it("okResponse adds X-RateLimit-* headers when rateLimit is passed", () => {
      const r = okResponse(200, { ok: true }, { rateLimit: { limit: 30, remaining: 29, reset: 1700000000 } });
      expect(r.headers["X-RateLimit-Limit"]).toBe("30");
      expect(r.headers["X-RateLimit-Remaining"]).toBe("29");
      expect(r.headers["X-RateLimit-Reset"]).toBe("1700000000");
    });
  });

  describe("authenticateApiRequest", () => {
    it("short-circuits OPTIONS preflight", async () => {
      const r = await authenticateApiRequest(baseEvent({ httpMethod: "OPTIONS" }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(204);
    });

    it("rejects a request with no Authorization header", async () => {
      const r = await authenticateApiRequest(baseEvent());
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(401);
      expect(JSON.parse(r.response.body).error.code).toBe("unauthorized");
    });

    it("rejects a malformed bearer token", async () => {
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: "Bearer short" } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(401);
    });

    it("returns 401 when the key is not in the store", async () => {
      findActiveApiKey.mockResolvedValue({ ok: true, key: null });
      const token = generateApiKey("live");
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(401);
    });

    it("returns 503 when the store is unconfigured", async () => {
      findActiveApiKey.mockResolvedValue({ ok: false, error: "service_db_unconfigured" });
      const token = generateApiKey("live");
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(503);
    });

    it("returns 503 on a network error from the store", async () => {
      findActiveApiKey.mockResolvedValue({ ok: false, error: "network", message: "boom" });
      const token = generateApiKey("live");
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(503);
    });

    it("returns auth context on success and touches the key", async () => {
      const token = generateApiKey("live");
      findActiveApiKey.mockResolvedValue({
        ok: true,
        key: { id: "k1", user_id: "u1", env: "live", plan_id: "business" },
      });
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(true);
      expect(r.auth.user.id).toBe("u1");
      expect(r.auth.key.id).toBe("k1");
      expect(r.auth.plan).toBe("business");
      expect(r.auth.rateLimit.limit).toBeGreaterThan(0);
      // touchApiKey called fire-and-forget
      expect(touchApiKey).toHaveBeenCalledWith("k1", expect.any(Object));
    });

    it("rejects when the env embedded in the key doesn't match the stored row", async () => {
      const token = generateApiKey("live");
      findActiveApiKey.mockResolvedValue({
        ok: true,
        key: { id: "k1", user_id: "u1", env: "test", plan_id: "business" }, // wrong
      });
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(401);
    });

    it("returns 429 with Retry-After when the rate limit is exhausted", async () => {
      const token = generateApiKey("live");
      findActiveApiKey.mockResolvedValue({
        ok: true,
        key: { id: "rl-key", user_id: "u1", env: "live", plan_id: "business" },
      });
      // Drain the bucket
      for (let i = 0; i < 30; i++) takeApiKeyToken("rl-key");
      const r = await authenticateApiRequest(baseEvent({ headers: { authorization: `Bearer ${token}` } }));
      expect(r.ok).toBe(false);
      expect(r.response.statusCode).toBe(429);
      expect(r.response.headers["Retry-After"]).toBeDefined();
    });
  });

  describe("_internal", () => {
    it("re-exports helpers for tests", () => {
      expect(_internal.bearerFromEvent).toBe(bearerFromEvent);
    });
  });
});
