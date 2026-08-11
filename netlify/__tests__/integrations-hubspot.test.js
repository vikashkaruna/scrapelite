// netlify/__tests__/integrations-hubspot.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the supabase JWT verification so we don't need a real Supabase.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "u1", email: "u1@example.com" } },
        error: null,
      }),
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
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
  });
});
