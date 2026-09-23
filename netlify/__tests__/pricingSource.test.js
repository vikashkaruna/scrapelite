// netlify/functions/lib/pricingSource.test.js
// C-35 — Static-then-operator merge, 60-s cache, missing config row → static.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_BY_ID, TOPUP_BUNDLES } from "../../src/lib/pricingConfig.js";

// The server table is DERIVED from pricingConfig now, so these read it too —
// what they prove is the RESOLUTION ORDER (static fallback, per-field operator
// override), not any particular rupee figure.
const PRO = PLAN_BY_ID.pro;
const BATCH = TOPUP_BUNDLES.find((b) => b.id === "batch-pack");
import {
  ALLOWED_BUNDLES,
  ALLOWED_PLANS,
  globalFraction,
  loadPricing,
  resolveCouponInfo,
  resolveDiscountFraction,
} from "../functions/lib/pricingSource.js";

let fetchMock;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  return import("../functions/lib/pricingSource.js");
}

describe("loadPricing — static defaults (C-35)", () => {
  it("returns static tables when Supabase is unconfigured", async () => {
    const { loadPricing } = await load();
    const p = await loadPricing();
    expect(p.plans.pro).toEqual({
      usd: PRO.price_usd, usd_annual: PRO.price_usd_annual,
      inr: PRO.price_inr, inr_annual: PRO.price_inr_annual,
    });
    expect(p.bundles["batch-pack"]).toEqual({ usd: BATCH.price_usd, inr: BATCH.price_inr });
    expect(p.coupons.LAUNCH20).toMatchObject({ value: 20, planId: null, active: true });
    expect(p.global).toEqual({ percent: 0, active: false, expiresAt: null });
    // No fetch happened
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing config row (Supabase 200, empty array) → static fallback", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const { loadPricing } = await load();
    const p = await loadPricing();
    expect(p.plans.pro.usd).toBe(PRO.price_usd); // static
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Supabase fetch 4xx → static fallback (no throw)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const { loadPricing } = await load();
    const p = await loadPricing();
    expect(p.plans.pro.usd).toBe(PRO.price_usd);
  });
});

describe("loadPricing — operator overrides (C-35)", () => {
  it("operator overrides merge per-field on top of static", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { key: "plans", value: { pro: { usd: 49 } } },
        ]),
        { status: 200 },
      ),
    );
    const { loadPricing } = await load();
    const p = await loadPricing();
    // operator override on usd only — other fields stay
    expect(p.plans.pro.usd).toBe(49);
    expect(p.plans.pro.usd_annual).toBe(PRO.price_usd_annual);
    expect(p.plans.pro.inr).toBe(PRO.price_inr);
  });

  it("operator can add a new coupon", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { key: "coupons", value: { CUSTOM20: { value: 20, active: true, planId: null } } },
        ]),
        { status: 200 },
      ),
    );
    const { loadPricing } = await load();
    const p = await loadPricing();
    expect(p.coupons.CUSTOM20).toMatchObject({ value: 20, active: true });
    // The static coupons are preserved
    expect(p.coupons.LAUNCH20).toBeDefined();
  });

  it("operator can set an active global sale", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { key: "global", value: { percent: 25, active: true, expiresAt: "2099-01-01" } },
        ]),
        { status: 200 },
      ),
    );
    const { loadPricing } = await load();
    const p = await loadPricing();
    expect(p.global).toEqual({ percent: 25, active: true, expiresAt: "2099-01-01" });
  });
});

describe("loadPricing — 60s cache (C-35)", () => {
  it("a second call within TTL does not refetch", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const { loadPricing } = await load();
    await loadPricing();
    await loadPricing();
    await loadPricing();
    // One fetch, not three
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveCouponInfo", () => {
  it("unknown code → frac 0", async () => {
    const { loadPricing, resolveCouponInfo } = await load();
    const p = await loadPricing();
    const r = resolveCouponInfo(p, "NOPE", "pro");
    expect(r.frac).toBe(0);
  });

  it("expired coupon → frac 0", async () => {
    const { loadPricing, resolveCouponInfo } = await load();
    const p = await loadPricing();
    // EARLYBIRD is seeded as active:false
    const r = resolveCouponInfo(p, "EARLYBIRD", "pro");
    expect(r.frac).toBe(0);
  });

  it("plan-restricted coupon used on the wrong plan → frac 0", async () => {
    const { loadPricing, resolveCouponInfo } = await load();
    const p = await loadPricing();
    // INDIE10 is restricted to "select" plan
    const r = resolveCouponInfo(p, "INDIE10", "pro");
    expect(r.frac).toBe(0);
  });

  it("valid coupon → frac = value / 100", async () => {
    const { loadPricing, resolveCouponInfo } = await load();
    const p = await loadPricing();
    const r = resolveCouponInfo(p, "LAUNCH20", "pro");
    expect(r.frac).toBeCloseTo(0.2);
    expect(r.maxUses).toBe(100);
  });
});

describe("globalFraction + resolveDiscountFraction", () => {
  it("returns 0 when no global sale is active", async () => {
    const { loadPricing, globalFraction } = await load();
    const p = await loadPricing();
    expect(globalFraction(p)).toBe(0);
  });

  it("resolveDiscountFraction returns max(coupon, global)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { key: "global", value: { percent: 15, active: true, expiresAt: null } },
        ]),
        { status: 200 },
      ),
    );
    const { loadPricing, resolveDiscountFraction } = await load();
    const p = await loadPricing();
    // LAUNCH20 (20) wins over global (15)
    expect(resolveDiscountFraction(p, "LAUNCH20", "pro")).toBeCloseTo(0.2);
    // No coupon → global applies
    expect(resolveDiscountFraction(p, null, "pro")).toBeCloseTo(0.15);
  });
});

describe("ALLOWED_PLANS / ALLOWED_BUNDLES", () => {
  it("are the canonical plan / bundle id sets", () => {
    expect(ALLOWED_PLANS.has("pro")).toBe(true);
    expect(ALLOWED_PLANS.has("free")).toBe(true);
    expect(ALLOWED_PLANS.has("go")).toBe(true);
    expect(ALLOWED_PLANS.has("unknown")).toBe(false);
    expect(ALLOWED_BUNDLES.has("batch-pack")).toBe(true);
    expect(ALLOWED_BUNDLES.has("credits-500")).toBe(true);
    // 🔴 D15 — the Extractions Bundle sold pure consumption at 14x the
    // cheapest plan's credit rate. It has to be gone from the SERVER too, or
    // it stays purchasable by anyone who hand-builds the request, through a
    // door the UI no longer shows.
    expect(ALLOWED_BUNDLES.has("extractions-bundle")).toBe(false);
  });
});
