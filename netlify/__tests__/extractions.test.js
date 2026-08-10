// netlify/functions/extractions.test.js
// C-08..11 — GET with anon/service key returns rows; POST strips unknown columns;
// DELETE is idempotent; 401/403 → graceful JSON error (useLocalStorage: true).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the supabase-js client so we don't hit a real DB.
const supabaseMock = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => chain),
    _chain: chain,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => supabaseMock),
}));

// Mock the notify dispatcher so POST tests can assert it was called with
// the right (userId, extraction) and don't accidentally hit Slack / Zapier
// during unit tests. notifyExtractionComplete is fire-and-forget from
// extractions.js (the caller does NOT await it) so the mock below returns
// a resolved promise and the test inspects it via vi.waitFor / a microtask.
const notifyMock = vi.hoisted(() => ({
  notifyExtractionComplete: vi.fn().mockResolvedValue({ ok: true, slack: null, zapier: null }),
  notifyEnrichmentComplete: vi.fn().mockResolvedValue({ ok: true, zapier: null }),
  notifyMonitoringChange: vi.fn().mockResolvedValue({ ok: true, slack: null, zapier: null }),
}));

vi.mock("../functions/lib/notify.js", () => notifyMock);

let handler;

function resetChainDefaults() {
  // Re-apply the default chainable behavior after mockReset/mockClear.
  supabaseMock._chain.select.mockReturnThis();
  supabaseMock._chain.eq.mockReturnThis();
  supabaseMock._chain.order.mockReturnThis();
  supabaseMock._chain.insert.mockReturnThis();
  supabaseMock._chain.update.mockReturnThis();
  supabaseMock._chain.delete.mockReturnThis();
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  vi.resetModules();
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.from.mockReset();
  // Restore from() implementation (mockReset clears it).
  supabaseMock.from.mockImplementation(() => supabaseMock._chain);
  supabaseMock._chain.select.mockReset();
  supabaseMock._chain.eq.mockReset();
  supabaseMock._chain.order.mockReset();
  supabaseMock._chain.insert.mockReset();
  supabaseMock._chain.update.mockReset();
  supabaseMock._chain.delete.mockReset();
  supabaseMock._chain.single.mockReset();
  resetChainDefaults();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/extractions.js");
  return mod.handler;
}

function userClient() {
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

describe("extractions — auth (C-11)", () => {
  it("missing Authorization header → 401 + useLocalStorage:true", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
    const body = JSON.parse(r.body);
    expect(body.useLocalStorage).toBe(true);
  });

  it("invalid/expired session (getUser error) → 401 + useLocalStorage:true", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    supabaseMock.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      headers: { authorization: "Bearer stale.jwt" },
    });
    expect(r.statusCode).toBe(401);
    const body = JSON.parse(r.body);
    expect(body.useLocalStorage).toBe(true);
  });

  it("Supabase unconfigured + auth header → 503 + useLocalStorage:true", async () => {
    // No SUPABASE_URL
    const h = await loadHandler();
    const r = await h({
      method: "GET",
      httpMethod: "GET",
      headers: { authorization: "Bearer some.jwt" },
    });
    expect(r.statusCode).toBe(503);
    const body = JSON.parse(r.body);
    expect(body.useLocalStorage).toBe(true);
  });
});

describe("extractions GET (C-08)", () => {
  it("returns rows for the authenticated user", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    supabaseMock._chain.order.mockResolvedValueOnce({
      data: [
        { id: "ext_1", url: "https://a.com", user_id: "user-1" },
        { id: "ext_2", url: "https://b.com", user_id: "user-1" },
      ],
      error: null,
    });
    const h = await loadHandler();
    const r = await h({
      method: "GET",
      httpMethod: "GET",
      headers: { authorization: "Bearer valid.jwt" },
    });
    if (r.statusCode !== 200) {
      console.log("DEBUG r.body:", r.body);
    }
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.length).toBe(2);
    expect(body[0].id).toBe("ext_1");
    // The query scoped by user_id
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("extractions POST (C-09)", () => {
  it("strips _status / _error / _saved / _demo before sending to Supabase", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    supabaseMock._chain.single.mockResolvedValueOnce({
      data: { id: "ext_1" },
      error: null,
    });
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({
        id: "ext_1",
        url: "https://example.com",
        page_title: "X",
        _status: "success",
        _error: "should be stripped",
        _saved: true,
        _demo: true,
      }),
    });
    expect(r.statusCode).toBe(201);
    const inserted = supabaseMock._chain.insert.mock.calls[0][0];
    expect(inserted._status).toBeUndefined();
    expect(inserted._error).toBeUndefined();
    expect(inserted._saved).toBeUndefined();
    expect(inserted._demo).toBeUndefined();
    expect(inserted.id).toBe("ext_1");
    expect(inserted.url).toBe("https://example.com");
    expect(inserted.user_id).toBe("user-1");
  });

  it("preserves V2 columns (custom_extraction / domain_map / enrichments) when present", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    supabaseMock._chain.single.mockResolvedValueOnce({
      data: { id: "ext_1" },
      error: null,
    });
    const h = await loadHandler();
    await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({
        id: "ext_1",
        url: "https://example.com",
        custom_extraction: { foo: "bar" },
        domain_map: ["https://a.com"],
        enrichments: { summary: { key: "summary" } },
      }),
    });
    const inserted = supabaseMock._chain.insert.mock.calls[0][0];
    expect(inserted.custom_extraction).toEqual({ foo: "bar" });
    expect(inserted.domain_map).toEqual(["https://a.com"]);
    expect(inserted.enrichments).toEqual({ summary: { key: "summary" } });
  });

  it("V2 missing-column error → retries with base fields only", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    // First insert: missing-column error
    supabaseMock._chain.single
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column \"custom_extraction\" does not exist" },
      })
      // Second insert (retry): success
      .mockResolvedValueOnce({ data: { id: "ext_1" }, error: null });
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({
        id: "ext_1",
        url: "https://example.com",
        custom_extraction: { foo: "bar" },
      }),
    });
    expect(r.statusCode).toBe(201);
    // Insert was called twice (initial + retry)
    expect(supabaseMock._chain.insert).toHaveBeenCalledTimes(2);
  });

  it("invalid JSON body → 400", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("fires notifyExtractionComplete on successful insert (Slack + Zapier fan-out)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    notifyMock.notifyExtractionComplete.mockClear();
    supabaseMock._chain.single.mockResolvedValueOnce({
      data: { id: "ext_42", url: "https://x.com", page_title: "X" },
      error: null,
    });
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({ id: "ext_42", url: "https://x.com", page_title: "X" }),
    });
    expect(r.statusCode).toBe(201);
    // The dispatcher is fire-and-forget — give the microtask a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifyMock.notifyExtractionComplete).toHaveBeenCalledTimes(1);
    expect(notifyMock.notifyExtractionComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        extraction: expect.objectContaining({ id: "ext_42", url: "https://x.com" }),
      }),
    );
  });

  it("does NOT fire notifyExtractionComplete on insert error (save failed)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    notifyMock.notifyExtractionComplete.mockClear();
    supabaseMock._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "RLS rejected" },
    });
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({ id: "ext_42", url: "https://x.com" }),
    });
    expect(r.statusCode).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifyMock.notifyExtractionComplete).not.toHaveBeenCalled();
  });
});

describe("extractions DELETE (C-10)", () => {
  it("deletes a row by id (idempotent: missing row → 200 ok)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    // Chain: from().delete().eq("id", id).eq("user_id", userId)
    // .eq is called twice — first returns chain (sync), second (terminal) returns Promise.
    supabaseMock._chain.eq
      .mockReturnValueOnce(supabaseMock._chain)
      .mockResolvedValueOnce({ error: null });
    const h = await loadHandler();
    const r = await h({
      method: "DELETE",
      httpMethod: "DELETE",
      queryStringParameters: { id: "ext_1" },
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    // The delete is scoped by user_id
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("id", "ext_1");
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("missing id query param → 400", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    const h = await loadHandler();
    const r = await h({
      method: "DELETE",
      httpMethod: "DELETE",
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("Supabase delete error → 500", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    // Chain: from().delete().eq("id", id).eq("user_id", userId)
    supabaseMock._chain.eq
      .mockReturnValueOnce(supabaseMock._chain)
      .mockResolvedValueOnce({ error: { message: "DB error" } });
    const h = await loadHandler();
    const r = await h({
      method: "DELETE",
      httpMethod: "DELETE",
      queryStringParameters: { id: "ext_1" },
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(r.statusCode).toBe(500);
  });
});

describe("extractions PATCH", () => {
  it("updates a row by id", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    // Chain: from().update(body).eq("id", id).eq("user_id", userId)
    supabaseMock._chain.eq
      .mockReturnValueOnce(supabaseMock._chain)
      .mockResolvedValueOnce({ error: null });
    const h = await loadHandler();
    const r = await h({
      method: "PATCH",
      httpMethod: "PATCH",
      queryStringParameters: { id: "ext_1" },
      headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({ enrichments: { summary: { text: "x" } } }),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("extractions — method handling", () => {
  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});
