// netlify/__tests__/integrations-notion.test.js
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
});
