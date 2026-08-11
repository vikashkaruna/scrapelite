// src/lib/apiClient.test.js
//
// Focused on the two error paths the user has actually hit in production:
//   1. Netlify Edge Access (site-wide basic auth) returns 401 with
//      text/html — the apiClient must surface a clear "refresh and
//      sign in" message instead of the bare "API ... failed (401)".
//   2. Non-2xx with JSON { error } in the body — surfaced as-is.
//   3. Successful response shape (sanity).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabaseClient.js", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

let setAuthToken;
let apiClient;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  const mod = await import("./apiClient.js");
  setAuthToken = mod.setAuthToken;
  apiClient = mod.apiClient;
  setAuthToken(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiClient — error path: Edge Access (HTML 401)", () => {
  it("surfaces a clear 'site authentication required' message when the server returns text/html 401", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<!DOCTYPE html>...Login Redirect...",
      json: async () => { throw new Error("Unexpected HTML body"); },
    });
    let caught;
    try { await apiClient.extract("https://example.com"); }
    catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/site authentication required/i);
    expect(caught.message).toMatch(/refresh the page/i);
    expect(caught.status).toBe(401);
    expect(caught.edgeAccess).toBe(true);
  });

  it("uses the server's `error` field when the response is JSON 401", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "Authentication required" }),
    });
    let caught;
    try { await apiClient.extract("https://example.com"); }
    catch (e) { caught = e; }
    expect(caught.message).toBe("Authentication required");
    expect(caught.status).toBe(401);
    expect(caught.edgeAccess).toBeUndefined();
  });

  it("falls back to the default 'API … failed (…)' message when JSON 401 has no `error` field", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
    });
    let caught;
    try { await apiClient.extract("https://example.com"); }
    catch (e) { caught = e; }
    expect(caught.message).toBe("API POST /extract failed (401)");
  });
});

describe("apiClient — credentials header", () => {
  it("sends `credentials: same-origin` so the Edge Access cookie travels with the request", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "ok" }),
    });
    await apiClient.extract("https://example.com");
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.credentials).toBe("same-origin");
  });

  it("attaches `Authorization: Bearer <jwt>` when setAuthToken is called", async () => {
    setAuthToken("jwt-from-authprovider");
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "ok" }),
    });
    await apiClient.extract("https://example.com");
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers["Authorization"]).toBe("Bearer jwt-from-authprovider");
  });

  it("omits the Authorization header when no token is set", async () => {
    setAuthToken(null);
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "ok" }),
    });
    await apiClient.extract("https://example.com");
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers["Authorization"]).toBeUndefined();
  });
});

describe("apiClient — happy path", () => {
  it("returns the parsed JSON body on 2xx", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { html: "<p>hello</p>" }, source: "firecrawl" }),
    });
    const out = await apiClient.extract("https://example.com");
    expect(out).toEqual({ data: { html: "<p>hello</p>" }, source: "firecrawl" });
  });
});
