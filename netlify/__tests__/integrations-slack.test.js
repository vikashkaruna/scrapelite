// netlify/__tests__/integrations-slack.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockStore = { get: vi.fn(), upsert: vi.fn(), delete: vi.fn() };
vi.mock("../functions/lib/integrationConnectionStore.js", () => ({
  getConnection: (...args) => mockStore.get(...args),
  upsertConnection: (...args) => mockStore.upsert(...args),
  deleteConnection: (...args) => mockStore.delete(...args),
}));

const mockNotify = { extract: vi.fn(), resolve: vi.fn() };
vi.mock("../functions/lib/notify.js", () => ({
  notifyExtractionComplete: (...args) => mockNotify.extract(...args),
  notifyEnrichmentComplete: vi.fn(),
  buildSlackNewExtraction: vi.fn(() => ({ text: "x", blocks: [] })),
  resolveSlackWebhook: (...args) => mockNotify.resolve(...args),
}));

import { handler } from "../functions/integrations-slack.js";

const baseEvent = (overrides = {}) => ({
  httpMethod: "GET",
  headers: { authorization: "Bearer jwt" },
  queryStringParameters: {},
  body: null,
  ...overrides,
});

describe("integrations-slack", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_KEY = "service";
    vi.clearAllMocks();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("returns 204 for OPTIONS preflight", async () => {
    const r = await handler(baseEvent({ httpMethod: "OPTIONS" }));
    expect(r.statusCode).toBe(204);
  });

  it("returns 401 without auth", async () => {
    const r = await handler(baseEvent({ headers: {} }));
    expect(r.statusCode).toBe(401);
  });

  describe("GET /status", () => {
    it("returns connected:false when nothing is configured", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.connected).toBe(false);
      expect(body.using_global_env).toBe(false);
    });
    it("flags using_global_env:true when SLACK_WEBHOOK_URL is set", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ queryStringParameters: { splat: "status" } }));
      const body = JSON.parse(r.body);
      expect(body.using_global_env).toBe(true);
    });
  });

  describe("POST /connect", () => {
    it("rejects a missing or malformed webhook URL", async () => {
      const r1 = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({}),
      }));
      expect(r1.statusCode).toBe(400);
      const r2 = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ webhookUrl: "https://example.com" }),
      }));
      expect(r2.statusCode).toBe(400);
    });
    it("probes Slack and stores the URL on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      mockStore.upsert.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ webhookUrl: "https://hooks.slack.com/services/X/Y/Z" }),
      }));
      expect(r.statusCode).toBe(200);
      expect(mockStore.upsert).toHaveBeenCalled();
    });
    it("rejects when Slack returns 4xx", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "connect" },
        body: JSON.stringify({ webhookUrl: "https://hooks.slack.com/services/X/Y/Z" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("DELETE /connect", () => {
    it("disconnects Slack", async () => {
      mockStore.delete.mockResolvedValue({ ok: true });
      const r = await handler(baseEvent({ httpMethod: "DELETE", queryStringParameters: { splat: "connect" } }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).connected).toBe(false);
    });
  });

  describe("POST /test", () => {
    it("returns 412 when no webhook is configured", async () => {
      mockStore.get.mockResolvedValue({ ok: true, connection: null });
      const r = await handler(baseEvent({ httpMethod: "POST", queryStringParameters: { splat: "test" } }));
      expect(r.statusCode).toBe(412);
    });
    it("posts a test message when a webhook is configured", async () => {
      mockStore.get.mockResolvedValue({
        ok: true,
        connection: { config: { webhook_url: "https://hooks.slack.com/x" } },
      });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const r = await handler(baseEvent({ httpMethod: "POST", queryStringParameters: { splat: "test" } }));
      expect(r.statusCode).toBe(200);
    });
  });

  describe("POST /notify", () => {
    it("dispatches new_extraction to notifyExtractionComplete", async () => {
      mockNotify.extract.mockResolvedValue({ ok: true, slack: { ok: true } });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "notify" },
        body: JSON.stringify({ type: "new_extraction", payload: { id: "e1" } }),
      }));
      expect(r.statusCode).toBe(200);
      expect(mockNotify.extract).toHaveBeenCalled();
    });
    it("rejects an unknown type", async () => {
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "notify" },
        body: JSON.stringify({ type: "unknown" }),
      }));
      expect(r.statusCode).toBe(400);
    });
  });

  describe("POST /send (Push to Slack — on-demand fan-out)", () => {
    it("returns 400 when items is missing or empty", async () => {
      const r1 = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "send" },
        body: JSON.stringify({}),
      }));
      expect(r1.statusCode).toBe(400);
      const r2 = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "send" },
        body: JSON.stringify({ items: [] }),
      }));
      expect(r2.statusCode).toBe(400);
    });

    it("returns 412 when Slack is not connected (no per-user webhook, no env)", async () => {
      mockNotify.resolve.mockResolvedValue(null);
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "send" },
        body: JSON.stringify({ items: [{ id: "e1", url: "https://x.com" }] }),
      }));
      expect(r.statusCode).toBe(412);
      const body = JSON.parse(r.body);
      expect(body.error).toMatch(/not connected/i);
    });

    it("posts one message per item and returns { ok, sent, total, failedRecords }", async () => {
      mockNotify.resolve.mockResolvedValue("https://hooks.slack.com/x");
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "send" },
        body: JSON.stringify({
          items: [
            { id: "e1", url: "https://a.com", page_title: "A" },
            { id: "e2", url: "https://b.com", page_title: "B" },
            { id: "e3", url: "https://c.com", page_title: "C" },
          ],
        }),
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(true);
      expect(body.sent).toBe(3);
      expect(body.total).toBe(3);
      expect(body.failedRecords).toEqual([]);
      // 3 Slack POSTs (one per item) + the connection-resolution lookup
      // (mocked, no fetch) + the supabase getUser (mocked, no fetch).
      const slackPosts = globalThis.fetch.mock.calls.filter(
        (c) => String(c[0]) === "https://hooks.slack.com/x"
      );
      expect(slackPosts).toHaveLength(3);
      // Every payload is a Block Kit message (text + blocks).
      for (const call of slackPosts) {
        const payload = JSON.parse(call[1].body);
        expect(payload.blocks).toBeDefined();
        expect(payload.text).toBeDefined();
      }
    });

    it("surfaces per-item Slack failures in failedRecords (other items still post)", async () => {
      mockNotify.resolve.mockResolvedValue("https://hooks.slack.com/x");
      // First call succeeds, second fails. The handler should report 1
      // sent + 1 failed instead of failing the whole batch.
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: false, status: 429 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        queryStringParameters: { splat: "send" },
        body: JSON.stringify({
          items: [
            { id: "e1", url: "https://a.com", page_title: "A" },
            { id: "e2", url: "https://b.com", page_title: "B" },
          ],
        }),
      }));
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.ok).toBe(false);
      expect(body.sent).toBe(1);
      expect(body.total).toBe(2);
      expect(body.failedRecords).toHaveLength(1);
      expect(body.failedRecords[0].url).toBe("https://b.com");
      expect(body.failedRecords[0].error).toMatch(/slack_429/);
    });

    it("dispatches via body.action when sub-path is empty (Netlify-redirect-safe)", async () => {
      // The previous fix (§16) made every handler accept body.action as
      // the primary dispatch source. /send must work the same way.
      mockNotify.resolve.mockResolvedValue("https://hooks.slack.com/x");
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const r = await handler(baseEvent({
        httpMethod: "POST",
        // no queryStringParameters.splat, no event.path tail — only the body
        body: JSON.stringify({
          action: "send",
          items: [{ id: "e1", url: "https://a.com" }],
        }),
      }));
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).sent).toBe(1);
    });
  });

  it("returns 404 for unknown sub-paths", async () => {
    const r = await handler(baseEvent({ queryStringParameters: { splat: "nope" } }));
    expect(r.statusCode).toBe(404);
  });
});
