// netlify/functions/usage-sync.test.js
//
// The server-side write path that let usage_records/usage_alerts' RLS be
// locked down (0034_usage_rls.sql) — see that migration and this function's
// own header comment. Before this, src/lib/usageRepo.js wrote directly to
// Supabase from the browser with the anon key, which an `anon full access`
// policy made world-readable and world-writable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  handler = (await import("../functions/usage-sync.js")).handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usage-sync — no auth required, session_id is the trust boundary", () => {
  it("Supabase unconfigured → ok:false, never throws", async () => {
    const r = await handler({ httpMethod: "GET", queryStringParameters: { sessionId: "s1", month: "2026-08" } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: false, reason: "supabase_not_configured" });
  });

  it("OPTIONS → 204", async () => {
    const r = await handler({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});

describe("usage-sync — GET", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("requires sessionId and month", async () => {
    const r = await handler({ httpMethod: "GET", queryStringParameters: {} });
    expect(r.statusCode).toBe(400);
  });

  it("returns the matching row using the SERVICE key, not anon", async () => {
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url: String(url), headers: init?.headers || {} };
      return new Response(JSON.stringify([{ session_id: "s1", month: "2026-08", extractions: 4 }]), { status: 200 });
    });
    const r = await handler({ httpMethod: "GET", queryStringParameters: { sessionId: "s1", month: "2026-08" } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.row.extractions).toBe(4);
    expect(captured.url).toContain("usage_records");
    expect(captured.url).toContain("session_id=eq.s1");
    expect(captured.headers.Authorization).toBe("Bearer sk");
  });

  it("no matching row → row:null, not an error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const r = await handler({ httpMethod: "GET", queryStringParameters: { sessionId: "s2", month: "2026-08" } });
    expect(JSON.parse(r.body)).toEqual({ ok: true, row: null });
  });
});

describe("usage-sync — POST usage", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("requires sessionId", async () => {
    const r = await handler({ httpMethod: "POST", body: JSON.stringify({ month: "2026-08" }) });
    expect(r.statusCode).toBe(400);
  });

  it("requires month", async () => {
    const r = await handler({ httpMethod: "POST", body: JSON.stringify({ sessionId: "s1" }) });
    expect(r.statusCode).toBe(400);
  });

  it("upserts usage_records with the service key", async () => {
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
      return new Response("", { status: 201 });
    });
    const r = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ sessionId: "s1", month: "2026-08", extractions: 3, enrichments: 1, planId: "select" }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(captured.url).toContain("usage_records");
    expect(captured.body.session_id).toBe("s1");
    expect(captured.body.extractions).toBe(3);
    expect(captured.body.plan_id).toBe("select");
    expect(captured.headers.Authorization).toBe("Bearer sk");
  });

  it("invalid JSON body → 400", async () => {
    const r = await handler({ httpMethod: "POST", body: "{not json" });
    expect(r.statusCode).toBe(400);
  });
});

describe("usage-sync — POST alert", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("requires an email", async () => {
    const r = await handler({ httpMethod: "POST", body: JSON.stringify({ type: "alert", sessionId: "s1" }) });
    expect(r.statusCode).toBe(400);
  });

  it("upserts usage_alerts with the service key", async () => {
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response("", { status: 201 });
    });
    const r = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ type: "alert", sessionId: "s1", email: "a@x.com", thresholds: [50, 90] }),
    });
    expect(r.statusCode).toBe(200);
    expect(captured.url).toContain("usage_alerts");
    expect(captured.body.email).toBe("a@x.com");
    expect(captured.body.thresholds).toEqual([50, 90]);
  });
});

describe("usage-sync — method handling", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("PUT / DELETE → 405", async () => {
    for (const httpMethod of ["PUT", "DELETE"]) {
      const r = await handler({ httpMethod });
      expect(r.statusCode).toBe(405);
    }
  });
});
