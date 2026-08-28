// netlify/functions/public-reports.test.js
//
// Closes the "Sync public link" bug: re-publishing an existing slug used to
// go straight to Supabase from the browser with the anon key, and 0007's
// "owner update" RLS policy can never be satisfied by an anonymous sharer
// (session_id ownership was checked against an x-session-id header this
// codebase never sends). This function replaces that direct write —
// ownership is checked server-side against a client-supplied sessionId in
// the POST BODY (never a header, never exposed via any SELECT) or the
// caller's own JWT.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authenticate = vi.fn();
let fetchMock;
let handler;

vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => authenticate(...a),
}));

beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  authenticate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  handler = (await import("../functions/public-reports.js")).handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body, headers = {}) =>
  handler({ httpMethod: "POST", headers, body: JSON.stringify(body) });

describe("public-reports — shape", () => {
  it("OPTIONS → 204", async () => {
    expect((await handler({ httpMethod: "OPTIONS" })).statusCode).toBe(204);
  });

  it("GET → 405 (write-only endpoint)", async () => {
    expect((await handler({ httpMethod: "GET" })).statusCode).toBe(405);
  });

  it("Supabase unconfigured → ok:false, never throws", async () => {
    const r = await post({ slug: "s1", title: "T", data: {} });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: false, reason: "supabase_not_configured" });
  });

  it("invalid JSON body → 400", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    const r = await handler({ httpMethod: "POST", headers: {}, body: "{not json" });
    expect(r.statusCode).toBe(400);
  });

  it("requires slug, title and data", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    const r = await post({ slug: "s1" });
    expect(r.statusCode).toBe(400);
  });
});

describe("public-reports — creating a new share (anonymous)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("anyone may create a NEW slug, signed in or not — no existing row to own", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 })) // no existing row
      .mockImplementationOnce(async (url, init) => {
        expect(String(url)).toContain("public_reports");
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body);
        expect(body.slug).toBe("newslug1");
        expect(body.session_id).toBe("sess-1");
        expect(body.user_id).toBeNull();
        return new Response("", { status: 201 });
      });
    const r = await post({ slug: "newslug1", title: "T", data: { x: 1 }, sessionId: "sess-1" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
  });
});

describe("public-reports — re-publishing an EXISTING slug (the actual bug)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
  });

  it("the original anonymous sharer CAN re-publish via session_id ownership — this is the fix", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ user_id: null, session_id: "sess-1" }]), { status: 200 }))
      .mockImplementationOnce(async (url, init) => {
        expect(init.method).toBe("PATCH");
        return new Response("", { status: 200 });
      });
    const r = await post({ slug: "abc12345", title: "T2", data: { x: 2 }, sessionId: "sess-1" });
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
  });

  it("a different session cannot overwrite it — reports refreshed:false, not an error", async () => {
    // The distinguishing behaviour: the link stays live, only the overwrite
    // is declined — never a thrown error for a legitimate ownership refusal.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ user_id: null, session_id: "sess-1" }]), { status: 200 }),
    );
    const r = await post({ slug: "abc12345", title: "T2", data: { x: 2 }, sessionId: "someone-elses-session" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(false);
    // Only 1 fetch call — the read. No PATCH was attempted with foreign data.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a signed-in owner can re-publish via user_id match", async () => {
    authenticate.mockResolvedValueOnce({ ok: true, user: { id: "user-1" }, client: {} });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ user_id: "user-1", session_id: null }]), { status: 200 }))
      .mockImplementationOnce(async (_url, init) => {
        expect(init.method).toBe("PATCH");
        return new Response("", { status: 200 });
      });
    const r = await post(
      { slug: "abc12345", title: "T3", data: { x: 3 }, sessionId: "irrelevant" },
      { authorization: "Bearer valid-jwt" },
    );
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
  });

  it("a caller whose JWT does not match the owner falls back to session_id, and still refuses if that doesn't match either", async () => {
    authenticate.mockResolvedValueOnce({ ok: true, user: { id: "someone-else" }, client: {} });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ user_id: "user-1", session_id: "sess-1" }]), { status: 200 }),
    );
    const r = await post(
      { slug: "abc12345", title: "T4", data: {}, sessionId: "not-sess-1" },
      { authorization: "Bearer someone-elses-jwt" },
    );
    const body = JSON.parse(r.body);
    expect(body.refreshed).toBe(false);
  });
});

describe("public-reports — never trusts an x-session-id header", () => {
  it("ownership is decided from the BODY's sessionId, ignoring any x-session-id header entirely", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ user_id: null, session_id: "real-owner" }]), { status: 200 }))
      .mockImplementationOnce(async () => new Response("", { status: 200 }));
    // A header claiming ownership must not substitute for the real body value.
    const r = await post(
      { slug: "abc12345", title: "T5", data: {}, sessionId: "real-owner" },
      { "x-session-id": "attacker-supplied-value" },
    );
    expect(JSON.parse(r.body).refreshed).toBe(true); // succeeds because the BODY sessionId matched, not the header
  });
});
