// netlify/functions/scrape-consent.test.js
// The record behind "I have permission to extract this site".
//
// The properties under test are the ones that keep this an OVERRIDE rather than
// a bypass: it needs a verified identity, it never trusts a body-supplied
// user_id, an unreadable record reads as "no record", and the audit trail is
// written for both directions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_EVENT = { httpMethod: "GET", headers: { authorization: "Bearer t" }, queryStringParameters: {} };

let fetchMock;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

/** Load the handler with authenticateBearer resolving to `user` (or failing). */
async function loadHandler(user = { id: "user-1" }) {
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user ? { ok: true, user, client: {} } : { ok: false, status: 401, body: { error: "Authentication required" } },
    ),
  }));
  return (await import("../functions/scrape-consent.js")).handler;
}

describe("scrape-consent — identity", () => {
  it("refuses an unauthenticated caller with 401", async () => {
    // Guests cannot attest: an anonymous cookie can be cleared and re-made
    // without limit, so it is nobody to attribute a permission claim to.
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "POST", headers: {}, body: JSON.stringify({ host: "linkedin.com", confirmed: true }) });
    expect(r.statusCode).toBe(401);
  });

  it("NEVER takes user_id from the request body", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const h = await loadHandler({ id: "real-user" });
    await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "linkedin.com", confirmed: true, user_id: "victim", userId: "victim" }),
    });
    const upsert = fetchMock.mock.calls.find(([u]) => String(u).includes("scrape_consent_records"));
    const sent = JSON.parse(upsert[1].body);
    expect(sent.user_id).toBe("real-user");
  });
});

describe("scrape-consent — grant", () => {
  it("requires an explicit confirmation, not just a host", async () => {
    // The UI gates its button on a checkbox; this is the server half of the
    // same rule, so a mis-wired client cannot attest on someone's behalf.
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "linkedin.com" }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/confirm/i);
  });

  it("rejects a host that isn't a host", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "not a host", confirmed: true }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("normalises www. away so one grant covers both spellings", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "https://www.LinkedIn.com/in/someone", confirmed: true }),
    });
    expect(JSON.parse(r.body).host).toBe("linkedin.com");
  });

  it("writes an audit row alongside the grant", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "linkedin.com", confirmed: true }),
    });
    const audit = fetchMock.mock.calls.find(([u]) => String(u).includes("scrape_consent_audit"));
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit[1].body).action).toBe("granted");
  });

  it("surfaces a storage failure instead of reporting a grant that did not happen", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ host: "linkedin.com", confirmed: true }),
    });
    expect(r.statusCode).toBe(502);
  });
});

describe("scrape-consent — read", () => {
  it("reports an existing unexpired grant", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ host: "linkedin.com", expires_at: "2099-01-01T00:00:00Z" }]), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({ ...AUTH_EVENT, queryStringParameters: { host: "linkedin.com" } });
    expect(JSON.parse(r.body).granted).toBe(true);
  });

  it("filters expiry in the query, so an expired grant can never read as granted", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const h = await loadHandler();
    const r = await h({ ...AUTH_EVENT, queryStringParameters: { host: "linkedin.com" } });
    expect(JSON.parse(r.body).granted).toBe(false);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/expires_at=gt\./);
  });

  it("FAILS CLOSED when the record cannot be read", async () => {
    // The one lookup in the extract path that must not fail open: failing open
    // would mean an unreachable Supabase silently grants everyone permission to
    // scrape every disallowed host on earth.
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const h = await loadHandler();
    const body = JSON.parse((await h({ ...AUTH_EVENT, queryStringParameters: { host: "linkedin.com" } })).body);
    expect(body.granted).toBe(false);
    expect(body.degraded).toBe(true);
  });
});

describe("scrape-consent — withdraw", () => {
  it("deletes the grant and records the withdrawal", async () => {
    // Consent you cannot revoke is not consent.
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "DELETE",
      headers: { authorization: "Bearer t" },
      queryStringParameters: { host: "linkedin.com" },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).granted).toBe(false);
    const del = fetchMock.mock.calls.find(([, o]) => o?.method === "DELETE");
    expect(String(del[0])).toContain("scrape_consent_records");
    const audit = fetchMock.mock.calls.find(([u]) => String(u).includes("scrape_consent_audit"));
    expect(JSON.parse(audit[1].body).action).toBe("withdrawn");
  });
});

describe("scrape-consent — method guard", () => {
  it("rejects anything else with 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "PATCH", headers: { authorization: "Bearer t" } });
    expect(r.statusCode).toBe(405);
  });
});
