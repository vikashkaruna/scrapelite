// netlify/functions/admin-gallery.test.js
// The human-verification gate for the public gallery: GET is token-gated
// (unlike admin-general-config's public GET, this returns every report's
// full data projection); POST curate/uncurate requires a valid persona id
// and never touches is_public.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;

const TEST_SECRET = "test-secret";
function makeAdminToken() {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/admin-gallery.js");
  return mod.handler;
}

describe("admin-gallery — auth", () => {
  it("GET without a token → 401", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
  });

  it("POST without a token → 401", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: {}, body: "{}" });
    expect(r.statusCode).toBe(401);
  });

  it("OPTIONS → 204, no auth required", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});

describe("admin-gallery GET", () => {
  it("Supabase unconfigured → 200, empty list, warning", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: `Bearer ${makeAdminToken()}` } });
    const body = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(body.reports).toEqual([]);
    expect(body.warning).toMatch(/not configured/);
  });

  it("returns the reports Supabase sends back, including uncurated ones", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: "r1", slug: "abc123", title: "T1", curated: false, persona: null, data: {} },
      { id: "r2", slug: "def456", title: "T2", curated: true, persona: "seo", data: {} },
    ]), { status: 200 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: `Bearer ${makeAdminToken()}` } });
    const body = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(body.reports).toHaveLength(2);
    expect(body.reports[0].curated).toBe(false);
    expect(body.reports[1].persona).toBe("seo");
  });

  it("a failed Supabase fetch → 502", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: `Bearer ${makeAdminToken()}` } });
    expect(r.statusCode).toBe(502);
  });
});

describe("admin-gallery POST curate", () => {
  it("missing id → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "curate", persona: "seo" }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("an unknown persona id → 400, never reaches Supabase", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "curate", id: "r1", persona: "not-a-real-persona" }),
    });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("valid persona → PATCHes curated=true, persona, reviewed_at/by; never touches is_public", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(null, { status: 204 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "curate", id: "r1", persona: "sales" }),
    });
    expect(r.statusCode).toBe(200);
    expect(captured.url).toContain("id=eq.r1");
    expect(captured.body.curated).toBe(true);
    expect(captured.body.persona).toBe("sales");
    expect(captured.body.reviewed_at).toBeTruthy();
    expect(captured.body.reviewed_by).toBeTruthy();
    expect(captured.body).not.toHaveProperty("is_public");
  });
});

describe("admin-gallery POST uncurate", () => {
  it("PATCHes curated=false and nothing else destructive", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(null, { status: 204 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "uncurate", id: "r1" }),
    });
    expect(r.statusCode).toBe(200);
    expect(captured.body).toEqual({ curated: false });
  });
});

describe("admin-gallery — misc", () => {
  it("unknown action → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "delete-everything", id: "r1" }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("invalid JSON body → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("unsupported method → 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "DELETE", headers: { authorization: `Bearer ${makeAdminToken()}` } });
    expect(r.statusCode).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin takedown of a published page.
// ─────────────────────────────────────────────────────────────────────────────
describe("admin-gallery — takedown", () => {
  // Same token + dynamic-import pattern the suite above uses: beforeEach calls
  // vi.resetModules(), so the handler must be imported inside each test.
  const post = async (body) => {
    const { handler } = await import("../functions/admin-gallery.js");
    return handler({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify(body),
    });
  };

  // Mandatory, matching every other operator mutation here — ops_audit_log
  // enforces the same thing with a CHECK constraint.
  it("refuses a takedown with no written reason", async () => {
    const r = await post({ action: "takedown", id: "r1" });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/reason/i);
    expect(JSON.parse(r.body).error).not.toMatch(/undefined/);
  });

  it("refuses a blank reason, not just a missing one", async () => {
    expect((await post({ action: "takedown", id: "r1", reason: "   " })).statusCode).toBe(400);
  });

  it("still requires an id", async () => {
    expect((await post({ action: "takedown", reason: "spam" })).statusCode).toBe(400);
  });
});
