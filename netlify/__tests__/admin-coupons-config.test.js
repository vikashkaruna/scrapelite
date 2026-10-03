// netlify/functions/admin-coupons-config.test.js
// Closes the coupon-persistence bug: a coupon saved in /admin/coupons used to
// write only to the admin's own localStorage, so create-checkout.js (which
// resolves real coupons from pricingSource.js's Supabase pricing_config)
// could never see it. This function is the missing write side.

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
  const mod = await import("../functions/admin-coupons-config.js");
  return mod.handler;
}

describe("admin-coupons-config GET", () => {
  it("no auth token → 401", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
  });

  it("returns the checkout-facing coupon map (static merged with pricing_config)", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.coupons.LAUNCH20).toBeTruthy(); // static seed coupon, always present
  });
});

describe("admin-coupons-config POST", () => {
  it("no auth token → 401", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: {}, body: "{}" });
    expect(r.statusCode).toBe(401);
  });

  it("invalid JSON body → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: "{not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("Supabase unconfigured + valid token → 200 + persisted:false + warning", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ coupons: { SAVE20: { value: 20 } } }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.persisted).toBe(false);
    expect(body.warning).toMatch(/not persisted/i);
  });

  it("valid token + Supabase configured → upserts pricing_config key='coupons'", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock.mockImplementationOnce(async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response("", { status: 200 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ coupons: { SAVE20: { value: 20, planId: null, expiresAt: null, active: true, maxUses: 0 } } }),
    });
    expect(r.statusCode).toBe(200);
    expect(String(captured.url)).toContain("pricing_config");
    expect(captured.body.key).toBe("coupons");
    expect(captured.body.value.SAVE20.value).toBe(20);
  });

  it("drops a planId:'manual' entry — admin-assign coupons never go to checkout", async () => {
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
      body: JSON.stringify({ coupons: { ASSIGNED: { value: 50, planId: "manual" } } }),
    });
    expect(captured.value.ASSIGNED).toBeUndefined();
  });

  it("drops an out-of-range value (not a valid percent)", async () => {
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
      body: JSON.stringify({ coupons: { BAD: { value: 150 }, ZERO: { value: 0 } } }),
    });
    expect(captured.value.BAD).toBeUndefined();
    expect(captured.value.ZERO).toBeUndefined();
  });

  it("an empty map is a valid save — clears every previously-synced coupon", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock.mockImplementationOnce(async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response("", { status: 200 });
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ coupons: {} }),
    });
    expect(r.statusCode).toBe(200);
    expect(captured.value).toEqual({});
  });

  it("Supabase upsert 4xx → 502", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ coupons: { SAVE20: { value: 20 } } }),
    });
    expect(r.statusCode).toBe(502);
  });
});

describe("admin-coupons-config — credit coupons + admin catalog", () => {
  const authed = () => ({ authorization: `Bearer ${makeAdminToken()}` });

  it("accepts a credit coupon into the checkout map as {credits} with value 0 (never a discount)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc";
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: authed(), body: JSON.stringify({
      coupons: { BONUS50: { credits: 50, maxUses: 10, active: true } },
    }) });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).coupons.BONUS50).toMatchObject({ value: 0, credits: 50, maxUses: 10 });
  });

  it("persists the full catalog (manual-assign included) under its own pricing_config row", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc";
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: authed(), body: JSON.stringify({
      coupons: {},
      catalog: [
        { id: "m1", code: "vip 15", type: "percent", value: 15, planId: "manual" },
        { code: "BONUS", type: "extractions", value: 25 },
        { code: "BAD", type: "percent", value: 500 },   // out of range → dropped
      ],
    }) });
    expect(r.statusCode).toBe(200);
    const catalog = JSON.parse(r.body).catalog;
    expect(catalog.map((c) => c.code)).toEqual(["VIP15", "BONUS"]);
    expect(catalog[0].planId).toBe("manual");
    const keys = fetchMock.mock.calls.map(([, o]) => o?.body && JSON.parse(o.body).key).filter(Boolean);
    expect(keys).toEqual(["coupons", "coupon_catalog"]);
  });

  it("GET returns the stored catalog and real redemption counts", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc";
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("key=eq.coupon_catalog")) return { ok: true, json: async () => [{ value: [{ code: "VIP", type: "percent", value: 5 }] }] };
      if (u.includes("coupon_counters")) return { ok: true, json: async () => [{ coupon_code: "VIP", uses: 3 }] };
      return { ok: true, json: async () => [] };
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: authed() });
    const body = JSON.parse(r.body);
    expect(body.catalog).toEqual([{ code: "VIP", type: "percent", value: 5 }]);
    expect(body.uses).toEqual({ VIP: 3 });
  });
});

describe("admin-coupons-config — method handling", () => {
  it("PUT / DELETE / PATCH → 405", async () => {
    const h = await loadHandler();
    for (const httpMethod of ["PUT", "DELETE", "PATCH"]) {
      const r = await h({ httpMethod, headers: { authorization: `Bearer ${makeAdminToken()}` } });
      expect(r.statusCode).toBe(405);
    }
  });

  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS", headers: {} });
    expect(r.statusCode).toBe(204);
  });
});
