// netlify/functions/admin-ai-config.test.js
// C-25 — GET returns config + key presence (no secrets); POST token-gated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
let handler;

const TEST_SECRET = "test-secret";

function makeAdminToken(secret = TEST_SECRET, exp = Date.now() + 60_000) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/admin-ai-config.js");
  return mod.handler;
}

describe("admin-ai-config GET (C-25)", () => {
  it("returns the config + key presence (no secrets)", async () => {
    process.env.GEMINI_API_KEY = "gem-secret";
    process.env.AI_API_KEY = "ant-secret";
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.config).toBeTruthy();
    expect(body.providers).toBeTruthy();
    expect(body.keyPresence).toBeTruthy();
    // No secrets leaked in the response body
    const json = JSON.stringify(body);
    expect(json).not.toContain("gem-secret");
    expect(json).not.toContain("ant-secret");
    // keyPresence reports true for both
    expect(body.keyPresence.gemini).toBe(true);
    expect(body.keyPresence.anthropic).toBe(true);
  });

  it("persisted:false when Supabase is unconfigured", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.persisted).toBe(false);
  });
});

describe("admin-ai-config POST (C-25)", () => {
  it("no auth token → 401", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ order: ["gemini"] }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("valid token + Supabase configured → 200 + persisted", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({
        order: ["gemini", "anthropic"],
        models: { gemini: "gemini-2.0-flash" },
        maxTokens: 1024,
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.persisted).toBe(true);
  });

  it("invalid JSON body → 400", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("empty body (nothing valid to save) → 400", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ unrelated: "value" }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("Supabase upsert 4xx → 502 (config did not persist)", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ order: ["gemini"] }),
    });
    expect(r.statusCode).toBe(502);
  });

  it("Supabase unconfigured + valid token → 200 + persisted:false + warning", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ order: ["gemini"] }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.persisted).toBe(false);
    expect(body.warning).toMatch(/Supabase not configured/);
  });

  it("sanitizes unknown providers out of the order", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock.mockImplementationOnce(async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response("", { status: 200 });
    });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ order: ["gemini", "unknown-provider", "anthropic"] }),
    });
    expect(captured.value.order).toEqual(["gemini", "anthropic"]);
  });
});

describe("admin-ai-config — method handling", () => {
  it("PUT / DELETE / PATCH → 405", async () => {
    const h = await loadHandler();
    for (const m of ["PUT", "DELETE", "PATCH"]) {
      const r = await h({ httpMethod: m });
      expect(r.statusCode).toBe(405);
    }
  });

  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});
