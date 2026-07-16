// netlify/functions/schedules.test.js
// C-31 — Per-user RLS scoping on GET/POST/DELETE; idempotent DELETE; OPTIONS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => chain),
    _chain: chain,
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => supabaseMock) }));

let handler;

function resetChainDefaults() {
  supabaseMock._chain.select.mockReturnThis();
  supabaseMock._chain.eq.mockReturnThis();
  supabaseMock._chain.order.mockReturnThis();
  supabaseMock._chain.upsert.mockReturnThis();
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
  supabaseMock.from.mockImplementation(() => supabaseMock._chain);
  supabaseMock._chain.select.mockReset();
  supabaseMock._chain.eq.mockReset();
  supabaseMock._chain.order.mockReset();
  supabaseMock._chain.upsert.mockReset();
  supabaseMock._chain.delete.mockReset();
  supabaseMock._chain.single.mockReset();
  resetChainDefaults();
});

afterEach(() => { vi.clearAllMocks(); });

async function loadHandler() {
  const mod = await import("./schedules.js");
  return mod.handler;
}

function userClient() {
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

describe("schedules — auth", () => {
  it("missing Authorization → 401 + useLocalStorage:true", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).useLocalStorage).toBe(true);
  });

  it("Supabase unconfigured + auth → 503 + useLocalStorage:true", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET", headers: { authorization: "Bearer some.jwt" },
    });
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body).useLocalStorage).toBe(true);
  });

  it("invalid/expired session → 401", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    supabaseMock.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: "Bearer stale.jwt" } });
    expect(r.statusCode).toBe(401);
  });
});

describe("schedules GET (C-31) — per-user scoping", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
  });

  it("returns rows for the authenticated user only", async () => {
    userClient();
    supabaseMock._chain.order.mockResolvedValueOnce({
      data: [
        { id: "sch_1", data: { id: "sch_1", name: "Morning" }, user_id: "user-1" },
        { id: "sch_2", data: { id: "sch_2", name: "Evening" }, user_id: "user-1" },
      ],
      error: null,
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: "Bearer valid.jwt" } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body).toHaveLength(2);
    // The query is scoped by user_id
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("empty result → 200 with []", async () => {
    userClient();
    supabaseMock._chain.order.mockResolvedValueOnce({ data: [], error: null });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: { authorization: "Bearer valid.jwt" } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual([]);
  });
});

describe("schedules POST (C-31)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
  });

  it("missing schedule.id → 400", async () => {
    userClient();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({ name: "No id" }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/id required/);
  });

  it("invalid JSON → 400", async () => {
    userClient();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", headers: { authorization: "Bearer valid.jwt" },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("valid POST → upsert is called with user_id scoping", async () => {
    userClient();
    supabaseMock._chain.single.mockResolvedValueOnce({
      data: { id: "sch_new", data: { id: "sch_new", name: "Daily" } },
      error: null,
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", headers: { authorization: "Bearer valid.jwt" },
      body: JSON.stringify({
        id: "sch_new", name: "Daily", cron: "0 9 * * *", status: "active",
        nextRunAt: "2026-07-16T03:30:00.000Z",
      }),
    });
    expect(r.statusCode).toBe(200);
    const upserted = supabaseMock._chain.upsert.mock.calls[0][0];
    expect(upserted.id).toBe("sch_new");
    expect(upserted.user_id).toBe("user-1");
    expect(upserted.cron).toBe("0 9 * * *");
    expect(upserted.status).toBe("active");
    expect(upserted.next_run_at).toBe("2026-07-16T03:30:00.000Z");
  });
});

describe("schedules DELETE (C-31) — idempotent", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
  });

  it("deletes a schedule by id (scoped by user_id)", async () => {
    userClient();
    // Chain: from().delete().eq("id", id).eq("user_id", userId) — second eq is terminal
    supabaseMock._chain.eq
      .mockReturnValueOnce(supabaseMock._chain)
      .mockResolvedValueOnce({ error: null });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "DELETE", headers: { authorization: "Bearer valid.jwt" },
      queryStringParameters: { id: "sch_1" },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("id", "sch_1");
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("missing id query param → 400", async () => {
    userClient();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "DELETE", headers: { authorization: "Bearer valid.jwt" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("schedules — method handling", () => {
  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });

  it("PUT → 405 (only GET/POST/DELETE supported)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    userClient();
    const h = await loadHandler();
    const r = await h({ httpMethod: "PUT", headers: { authorization: "Bearer valid.jwt" } });
    expect(r.statusCode).toBe(405);
  });
});
