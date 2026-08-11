// netlify/__tests__/integrations-airtable.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "u1" } },
        error: null,
      }),
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

  describe("GET /status", () => {
    it("returns connected:false when nothing is stored", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
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
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
  });
});
