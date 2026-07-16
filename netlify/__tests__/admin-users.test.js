// netlify/functions/admin-users.test.js
// C-28 — GET returns planStart/End/couponAvailed; PATCH assign_coupon writes
// both auth.users.user_metadata AND coupon_redemptions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
let handler;

const TEST_SECRET = "test-secret";
function makeAdminToken() {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.ADMIN_TOKEN_SECRET;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/admin-users.js");
  return mod.handler;
}

describe("admin-users — auth", () => {
  it("missing token → 401 (for every method)", async () => {
    const h = await loadHandler();
    for (const m of ["GET", "PATCH", "POST"]) {
      const r = await h({ httpMethod: m, headers: {} });
      expect(r.statusCode).toBe(401);
    }
  });
});

describe("admin-users GET (C-28)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  });

  it("returns planStart/planEnd/couponAvailed per user", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/auth/v1/admin/users")) {
        return new Response(
          JSON.stringify({
            users: [
              {
                id: "u1",
                email: "alice@example.com",
                email_confirmed_at: "2026-07-01T00:00:00Z",
                created_at: "2026-06-01T00:00:00Z",
                last_sign_in_at: "2026-07-14T00:00:00Z",
                raw_user_meta_data: { full_name: "Alice" },
                app_metadata: {},
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes("/rest/v1/subscriptions")) {
        return new Response(
          JSON.stringify([
            {
              session_id: "u1",
              plan_id: "pro",
              status: "active",
              current_period_start: "2026-07-01T00:00:00Z",
              current_period_end:   "2026-08-01T00:00:00Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (u.includes("/rest/v1/usage_records")) return new Response("[]", { status: 200 });
      if (u.includes("/rest/v1/coupon_redemptions")) {
        return new Response(
          JSON.stringify([{ session_id: "u1", coupon_code: "LAUNCH20" }]),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    });
    const body = JSON.parse(r.body);
    expect(body.fromSeed).toBe(false);
    expect(body.users.length).toBe(1);
    const u = body.users[0];
    expect(u.id).toBe("u1");
    expect(u.planId).toBe("pro");
    expect(u.planStart).toBe("2026-07-01");
    expect(u.planEnd).toBe("2026-08-01");
    expect(u.couponAvailed).toBe("LAUNCH20");
    expect(u.name).toBe("Alice");
  });

  it("Supabase unconfigured → fromSeed:true + warning", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    });
    const body = JSON.parse(r.body);
    expect(body.fromSeed).toBe(true);
    expect(body.warning).toMatch(/SUPABASE_URL/);
    expect(body.users).toEqual([]);
  });
});

describe("admin-users PATCH (C-28)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  });

  it("assign_coupon writes auth user_metadata AND coupon_redemptions", async () => {
    const calls = [];
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body });
      if (u.includes("/auth/v1/admin/users/u1") && (init?.method === "GET" || !init?.method)) {
        return new Response(
          JSON.stringify({ id: "u1", raw_user_meta_data: { full_name: "Alice" } }),
          { status: 200 },
        );
      }
      if (u.includes("/auth/v1/admin/users/u1") && init?.method === "PUT") {
        // Echo a success body (the body is irrelevant — we just need a 2xx)
        return new Response(JSON.stringify({ id: "u1", ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("/rest/v1/coupon_redemptions")) {
        return new Response(JSON.stringify([{ session_id: "u1", coupon_code: "MANUAL50" }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "PATCH",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({
        action: "assign_coupon",
        userId: "u1",
        couponCode: "manual50",
        discountPct: 50,
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.couponCode).toBe("MANUAL50"); // uppercased
    expect(body.discountPct).toBe(50);

    // The auth metadata PUT body should include coupon_availed + coupon_discount
    const putCall = calls.find((c) => c.method === "PUT" && c.url.includes("/auth/v1/admin/users/u1"));
    expect(putCall).toBeTruthy();
    const sent = JSON.parse(putCall.body);
    expect(sent.user_metadata.coupon_availed).toBe("MANUAL50");
    expect(sent.user_metadata.coupon_discount).toBe(50);

    // The coupon_redemptions POST should also be made (with session_id=userId)
    const redemptionCall = calls.find((c) => c.url.includes("/rest/v1/coupon_redemptions"));
    expect(redemptionCall).toBeTruthy();
    const sent2 = JSON.parse(redemptionCall.body);
    expect(sent2.coupon_code).toBe("MANUAL50");
    expect(sent2.session_id).toBe("u1");
  });

  it("assign_coupon without userId or couponCode → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "PATCH",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ action: "assign_coupon" }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("extend bonus extractions writes new bonus to auth metadata", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/auth/v1/admin/users/u1") && (!init?.method || init?.method === "GET")) {
        return new Response(
          JSON.stringify({ id: "u1", raw_user_meta_data: { bonus_extractions: 10 } }),
          { status: 200 },
        );
      }
      if (init?.method === "PUT") {
        const sent = JSON.parse(init.body);
        expect(sent.user_metadata.bonus_extractions).toBe(60); // 10 + 50
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "PATCH",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ userId: "u1", bonus: 50 }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.newBonus).toBe(60);
  });

  it("invalid bonus (< 1) → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "PATCH",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ userId: "u1", bonus: 0 }),
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("admin-users POST (invite)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  });

  it("invites a new user via Supabase Auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u_new", email: "new@example.com" }), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ email: "new@example.com", name: "New User" }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.userId).toBe("u_new");
  });

  it("missing email → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(400);
  });
});
