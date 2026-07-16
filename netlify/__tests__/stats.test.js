// netlify/functions/stats.test.js
// C-29 — GET /api/stats: distinct sessions, sum extractions, 0 when empty, null on fetch error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/stats.js");
  return mod.handler;
}

describe("stats handler — Supabase unconfigured", () => {
  it("returns { teams: null, extractions: null } when env is missing", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body).toEqual({ teams: null, extractions: null });
  });
});

describe("stats handler — Supabase configured (C-29)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
  });

  it("counts distinct session_ids and sums extractions", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { session_id: "a", extractions: 5 },
          { session_id: "a", extractions: 3 },
          { session_id: "b", extractions: 7 },
          { session_id: "c", extractions: 0 },
        ]),
        { status: 200 },
      ),
    );
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.teams).toBe(3); // a, b, c — 3 distinct
    expect(body.extractions).toBe(15); // 5+3+7+0
  });

  it("empty table → teams:0, extractions:0", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.teams).toBe(0);
    expect(body.extractions).toBe(0);
  });

  it("5xx from Supabase → null (does not throw)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.teams).toBeNull();
    expect(body.extractions).toBeNull();
  });

  it("non-array response (e.g. invalid JSON shape) → null", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.teams).toBeNull();
    expect(body.extractions).toBeNull();
  });

  it("network error → null", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.teams).toBeNull();
    expect(body.extractions).toBeNull();
  });

  it("response includes 5-min Cache-Control header", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.headers["Cache-Control"]).toMatch(/max-age=300/);
  });

  it("OPTIONS preflight → 204 with CORS headers", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
