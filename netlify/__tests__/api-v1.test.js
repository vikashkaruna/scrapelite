// netlify/__tests__/api-v1.test.js
//
// End-to-end tests for the public REST API router. We mock the auth layer
// and the DB layer; the goal here is to verify that:
//   • Every documented endpoint dispatches to the right handler
//   • The response envelope is the Developer-API shape
//   • Error paths (validation, 404, 405) are correct
//   • Pagination + reshaping work end-to-end
//
// The test fixture monkey-patches the auth and DB helpers so we don't need
// a live Supabase or Netlify runtime.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as apiV1 from "../functions/api-v1.js";
const { handler, routeApiV1, _internal } = apiV1;
import { generateApiKey } from "../functions/lib/apiKeyService.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mock authenticateApiRequest so tests can pass a fake auth context.
vi.mock("../functions/lib/apiAuth.js", async () => {
  const actual = await vi.importActual("../functions/lib/apiAuth.js");
  return {
    ...actual,
    authenticateApiRequest: vi.fn(),
  };
});

// Hoisted internal-call mocks (vi.mock factories run before module imports).
const { mockInternal } = vi.hoisted(() => ({
  mockInternal: { extract: vi.fn(), ai: vi.fn() },
}));

// Mock the internal-call helpers so the router can be tested without a real
// scrape/AI round-trip.
vi.mock("../functions/lib/apiV1Internals.js", () => ({
  getInternalBase: () => "http://test.local",
  callInternalExtract: mockInternal.extract,
  callInternalAi: mockInternal.ai,
}));

import { authenticateApiRequest, okResponse, errorResponse } from "../functions/lib/apiAuth.js";

const validAuth = {
  key: { id: "k1", user_id: "u1", env: "live", plan_id: "business" },
  user: { id: "u1" },
  env: "live",
  plan: "business",
  rateLimit: { limit: 30, remaining: 29, reset: 1700000000 },
};

const freeAuth = {
  ...validAuth,
  key: { ...validAuth.key, plan_id: "free" },
  plan: "free",
};

// ── DB mock ─────────────────────────────────────────────────────────────────
//
// The router uses fetch() against the service-key REST handle. We monkey-
// patch globalThis.fetch to route calls to a small in-memory store.
function makeDbStore(rows = {}) {
  const state = { ...rows };
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: new URL(url), init });
    const u = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    // Match by table + filter
    const matchRow = (table) => {
      const tableRows = state[table] || [];
      for (const row of tableRows) {
        let match = true;
        for (const [k, v] of u.searchParams) {
          if (k === "select" || k === "order" || k === "limit") continue;
          const [key, op, val] = v.split(".");
          if (op === "eq" && row[key] !== decodeURIComponent(val.replace(/^eq\./, ""))) { match = false; break; }
          if (op === "is" && val === "null" && row[key] != null) { match = false; break; }
        }
        if (match) return row;
      }
      return null;
    };
    // POST insert
    if (method === "POST") {
      const body = JSON.parse(init.body || "{}");
      const table = u.pathname.split("/").pop();
      if (!state[table]) state[table] = [];
      const id = `${table.slice(0, 3)}-${state[table].length + 1}`;
      const row = { id, ...body };
      state[table].push(row);
      return new Response(JSON.stringify([row]), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    // PATCH update
    if (method === "PATCH") {
      const body = JSON.parse(init.body || "{}");
      const table = u.pathname.split("/").pop();
      const tableRows = state[table] || [];
      let updated = null;
      for (const row of tableRows) {
        let match = true;
        for (const [k, v] of u.searchParams) {
          const [op, ...rest] = v.split(".");
          const val = rest.join(".");
          if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
        }
        if (match) {
          Object.assign(row, body);
          updated = row;
        }
      }
      return new Response(JSON.stringify(updated ? [updated] : []), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // DELETE
    if (method === "DELETE") {
      const table = u.pathname.split("/").pop();
      state[table] = (state[table] || []).filter((row) => {
        for (const [k, v] of u.searchParams) {
          const [op, ...rest] = v.split(".");
          const val = rest.join(".");
          if (op === "eq" && row[k] === decodeURIComponent(val || "")) return false;
        }
        return true;
      });
      return new Response(null, { status: 204 });
    }
    // GET
    const table = u.pathname.split("/").pop();
    const tableRows = state[table] || [];
    const matches = [];
    for (const row of tableRows) {
      let match = true;
      for (const [k, v] of u.searchParams) {
        if (k === "select" || k === "order" || k === "limit") continue;
        const [op, ...rest] = v.split(".");
        const val = rest.join(".");
        if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
        if (op === "is" && val === "null" && row[k] != null) { match = false; break; }
      }
      if (match) matches.push(row);
    }
    return new Response(JSON.stringify(matches), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { state, fetch: f, calls };
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.clearAllMocks();
  mockInternal.extract.mockReset();
  mockInternal.ai.mockReset();
  globalThis.fetch = vi.fn();
});

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: {},
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("api-v1 router", () => {
  describe("parsePath", () => {
    it("splits a splat into URL-decoded segments", () => {
      expect(_internal.parsePath("extractions/abc/enrichments"))
        .toEqual(["extractions", "abc", "enrichments"]);
    });
    it("returns [] for empty / null", () => {
      expect(_internal.parsePath("")).toEqual([]);
      expect(_internal.parsePath(null)).toEqual([]);
      expect(_internal.parsePath(undefined)).toEqual([]);
    });
  });

  describe("reshapeExtraction", () => {
    it("renames page_title → title and ai_summary → summary", () => {
      const out = _internal.reshapeExtraction({
        id: "x1",
        url: "https://example.com",
        page_title: "T",
        ai_summary: "S",
        headings: [],
        links: [],
        enrichments: {},
        created_at: "2026-07-28T10:00:00Z",
      });
      expect(out.title).toBe("T");
      expect(out.summary).toBe("S");
      expect(out.created_at).toBe("2026-07-28T10:00:00.000Z");
    });
    it("handles missing / null row", () => {
      expect(_internal.reshapeExtraction(null)).toBeNull();
    });
  });

  describe("OPTIONS preflight", () => {
    it("returns 204 without authenticating", async () => {
      const r = await handler(baseEvent({ httpMethod: "OPTIONS", queryStringParameters: { splat: "extractions" } }));
      expect(r.statusCode).toBe(204);
      expect(authenticateApiRequest).not.toHaveBeenCalled();
    });
  });

  describe("health check", () => {
    it("returns ok without auth on /v1/_health", async () => {
      const r = await handler(baseEvent({ queryStringParameters: { splat: "_health" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(true);
      expect(body.version).toBe("v1");
      expect(authenticateApiRequest).not.toHaveBeenCalled();
    });

    // Regression: netlify.toml used to forward the sub-path as a QUERY PARAM
    // (`?splat=:splat`), and that substitution was already found to silently
    // drop the value on an explicit-prefix wildcard rule in production —
    // the same shape /api/v1/* uses (see the integrations redirects'
    // comment in netlify.toml, and commit 87f5597). The redirect now
    // forwards the splat as a path segment instead, and both the health
    // check's own path resolution and routeApiV1's must fall back to
    // event.path when the query param is empty.
    it("resolves /v1/_health from event.path when the query param is empty", async () => {
      const r = await handler(baseEvent({
        queryStringParameters: {},
        path: "/.netlify/functions/api-v1/_health",
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(true);
    });

    it("resolves a real route from event.path too, not just the health check", async () => {
      const db = makeDbStore({ extractions: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        queryStringParameters: {},
        path: "/.netlify/functions/api-v1/extractions",
      }));
      expect(r.statusCode).not.toBe(404);
    });

    // Regression: the first fix assumed event.path always carries the
    // destination form (/.netlify/functions/api-v1/...). Deployed to
    // staging, discoverability.js's identical assumption still 404'd
    // "Unknown endpoint" — event.path's real shape for this rewrite may be
    // the ORIGINAL request path instead. Unlike discoverability.js, the
    // function name (api-v1, hyphen) and the route (/api/v1/, slash) are
    // different literal strings, so this needs its OWN marker for the
    // original-request-path shape, not just the destination one.
    it("resolves from event.path when it's the ORIGINAL request path (/api/v1/...), not the function's destination path", async () => {
      const r = await handler(baseEvent({
        queryStringParameters: {},
        path: "/api/v1/_health",
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(true);
    });
  });

  describe("auth", () => {
    it("rejects unauthenticated calls with the auth layer's response", async () => {
      authenticateApiRequest.mockResolvedValue({
        ok: false,
        response: errorResponse(401, "unauthorized", "missing token"),
      });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "extractions" } }));
      expect(r.statusCode).toBe(401);
    });
  });

  describe("/v1/extractions", () => {
    it("GET returns a paginated list in the documented shape", async () => {
      const db = makeDbStore({
        extractions: [
          { id: "e1", user_id: "u1", url: "https://a.com", page_title: "A", ai_summary: "SA", headings: [], links: [], enrichments: {}, created_at: "2026-07-28T10:00:00Z" },
          { id: "e2", user_id: "u1", url: "https://b.com", page_title: "B", ai_summary: "SB", headings: [], links: [], enrichments: {}, created_at: "2026-07-28T09:00:00Z" },
        ],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "extractions" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].title).toBe("A");
      expect(body.data[0].summary).toBe("SA");
      expect(body.next_cursor).toBeNull(); // < limit
      expect(r.headers["X-RateLimit-Limit"]).toBe("30");
    });

    it("POST creates a new extraction", async () => {
      mockInternal.extract.mockResolvedValue({
        ok: true,
        data: { metadata: { title: "X" }, summary: "summarised", headings: [], links: [] },
      });
      const db = makeDbStore({ extractions: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions" },
        body: JSON.stringify({ url: "https://x.com", intent: "summary" }),
      }));
      expect(r.statusCode).toBe(201);
      const body = JSON.parse(r.body);
      expect(body.url).toBe("https://x.com");
      expect(body.title).toBe("X");
      expect(db.state.extractions).toHaveLength(1);
    });

    it("POST rejects a missing url with 400", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions" },
        body: JSON.stringify({}),
      }));
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body).error.code).toBe("invalid_request");
    });

    it("POST returns 403 when the plan does not include this capability", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: freeAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions" },
        body: JSON.stringify({ url: "https://x.com" }),
      }));
      expect(r.statusCode).toBe(403);
    });
  });

  describe("/v1/extractions/{id}", () => {
    it("GET returns the extraction", async () => {
      const db = makeDbStore({
        extractions: [{ id: "e1", user_id: "u1", url: "https://a.com", page_title: "A", headings: [], links: [], enrichments: {}, created_at: "2026-07-28T10:00:00Z" }],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "extractions/e1" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).id).toBe("e1");
    });
    it("GET returns 404 when the row doesn't exist", async () => {
      const db = makeDbStore({ extractions: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "extractions/missing" } }));
      expect(r.statusCode).toBe(404);
    });
    it("DELETE returns 204", async () => {
      const db = makeDbStore({ extractions: [{ id: "e1", user_id: "u1" }] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "DELETE",
        queryStringParameters: { splat: "extractions/e1" },
      }));
      // Diagnostic — surface the error body in the assertion message
      expect(r.statusCode, JSON.stringify(JSON.parse(r.body), null, 2)).toBe(204);
      expect(db.state.extractions).toHaveLength(0);
    });
  });

  describe("/v1/extractions/{id}/enrichments", () => {
    it("POST runs the AI and persists the result", async () => {
      mockInternal.ai.mockResolvedValue({ ok: true, content: JSON.stringify({ emails: ["a@b.com"] }) });
      const db = makeDbStore({
        extractions: [{ id: "e1", user_id: "u1", enrichments: {} }],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions/e1/enrichments" },
        body: JSON.stringify({ focus: "contacts" }),
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.focus).toBe("contacts");
      expect(body.data.emails).toEqual(["a@b.com"]);
      expect(db.state.extractions[0].enrichments.contacts.data.emails).toEqual(["a@b.com"]);
    });
    it("rejects an unknown focus with 400", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions/e1/enrichments" },
        body: JSON.stringify({ focus: "bogus" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("/v1/extractions/{id}/content", () => {
    it("POST returns the generated content", async () => {
      mockInternal.ai.mockResolvedValue({ ok: true, content: "### Outline" });
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions/e1/content" },
        body: JSON.stringify({ format: "seo_outline" }),
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).content).toBe("### Outline");
    });
    it("rejects an unknown format with 400", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions/e1/content" },
        body: JSON.stringify({ format: "haiku" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("/v1/batches", () => {
    it("POST creates a queued batch row", async () => {
      const db = makeDbStore({ batch_runs: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "batches" },
        body: JSON.stringify({ urls: ["https://a.com", "https://b.com"] }),
      }));
      expect(r.statusCode).toBe(202);
      expect(db.state.batch_runs).toHaveLength(1);
      expect(db.state.batch_runs[0].status).toBe("queued");
      expect(db.state.batch_runs[0].source).toBe("api");
    });
    it("rejects an empty urls array", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "batches" },
        body: JSON.stringify({ urls: [] }),
      }));
      expect(r.statusCode).toBe(400);
    });
    it("rejects >50 URLs in a single batch", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "batches" },
        body: JSON.stringify({ urls: Array.from({ length: 51 }, (_, i) => `https://x${i}.com`) }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("/v1/schedules", () => {
    it("GET returns a list", async () => {
      const db = makeDbStore({
        schedules: [
          { id: "s1", user_id: "u1", url: "https://a.com", intent: "summary", cadence: "daily", status: "active", created_at: "2026-07-28T10:00:00Z" },
        ],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "schedules" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).data).toHaveLength(1);
    });
    it("POST creates a schedule", async () => {
      const db = makeDbStore({ schedules: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "schedules" },
        body: JSON.stringify({ url: "https://a.com", cadence: "daily" }),
      }));
      expect(r.statusCode).toBe(201);
      expect(db.state.schedules).toHaveLength(1);
    });
  });

  describe("/v1/schedules/{id}/run", () => {
    it("POST sets next_run_at to now", async () => {
      const db = makeDbStore({
        schedules: [{ id: "s1", user_id: "u1", url: "https://a.com", status: "active", created_at: "2026-07-28T10:00:00Z" }],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "schedules/s1/run" },
      }));
      expect(r.statusCode).toBe(202);
      expect(db.state.schedules[0].next_run_at).toBeDefined();
    });
  });

  describe("/v1/gallery", () => {
    it("returns the recent public reports", async () => {
      const db = makeDbStore({
        public_reports: [
          { slug: "abc", title: "T1", intent: "summary", created_at: "2026-07-28T10:00:00Z", extraction_id: "e1" },
        ],
      });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "gallery" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.data[0].slug).toBe("abc");
      expect(body.data[0].url).toMatch(/\/p\/abc$/);
    });
  });

  describe("unknown route", () => {
    it("returns 404", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
      expect(r.statusCode).toBe(404);
      expect(JSON.parse(r.body).error.code).toBe("not_found");
    });
  });

  describe("405 method handling", () => {
    it("PUT on /v1/extractions is not allowed", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ httpMethod: "PUT", queryStringParameters: { splat: "extractions" } }));
      expect(r.statusCode).toBe(405);
    });
  });

  describe("response envelope", () => {
    it("success responses always include CORS + X-RateLimit headers", async () => {
      const db = makeDbStore({ extractions: [] });
      globalThis.fetch = db.fetch;
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "extractions" } }));
      expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(r.headers["X-RateLimit-Limit"]).toBe("30");
    });
    it("error responses use the { error: { code, message } } shape", async () => {
      authenticateApiRequest.mockResolvedValue({ ok: true, auth: validAuth });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "extractions" },
        body: "not-json",
      }));
      expect(r.statusCode).toBe(400);
      const body = JSON.parse(r.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });
});


// ── D2 · /v1/discoverability/* is canonical, the bare prefixes are aliases ───

describe("D2 — the discoverability namespace", () => {
  it("🔴 routes both forms to the SAME inner path", async () => {
    // The PRD namespaces these under `discoverability`; the bare forms shipped
    // first and are in use. Both must reach one handler — a second route would
    // be one refactor away from applying a different set of gates, which is how
    // the guest-credit leak in CLAUDE.md happened.
    const seen = [];
    vi.doMock("../functions/discoverability.js", () => ({
      handler: async (e) => {
        seen.push(e.queryStringParameters?.splat);
        return { statusCode: 200, body: "{}" };
      },
    }));
    vi.resetModules();
    const mod = await import("../functions/api-v1.js");

    const ev = (path) => ({
      httpMethod: "GET",
      path: `/api/v1/${path}`,
      headers: {},
      queryStringParameters: {},
    });
    const auth = { ok: true, user: { id: "u1" } };

    await mod.routeApiV1(ev("audits/abc"), auth, ["audits", "abc"]);
    await mod.routeApiV1(ev("discoverability/audits/abc"), auth, ["discoverability", "audits", "abc"]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe("audits/abc");
    expect(seen[1]).toBe("audits/abc");   // the namespace segment is stripped
    vi.doUnmock("../functions/discoverability.js");
  });
});
