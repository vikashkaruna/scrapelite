import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyGlobalDiscount,
  getEffectiveBundles,
  getEffectivePlanById,
  getEffectivePlanMap,
  getEffectivePlans,
  getGlobalDiscount,
  getPricingOverrides,
  getTopupOverrides,
  resetAllOverrides,
  setGlobalDiscount,
  setPlanOverride,
  setTopupOverride,
} from "./pricingOverrides.js";

/**
 * U-15..17 — pricingOverrides is the layer that lets /admin/pricing edit
 * live prices and limits without a redeploy. Every consumer (Pricing UI,
 * payment modal, server `pricingSource.js`) reads through this file's
 * `getEffective*` helpers — the override-on-read contract is what makes
 * the admin flow work.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("getEffectivePlanById (U-15)", () => {
  it("returns the base plan when no override is present", () => {
    const p = getEffectivePlanById("pro");
    expect(p.id).toBe("pro");
    expect(p.price_usd).toBe(25);
  });

  it("returns the override fields when set", () => {
    setPlanOverride("pro", { price_usd: 39, price_usd_annual: 31 });
    const p = getEffectivePlanById("pro");
    expect(p.price_usd).toBe(39);
    expect(p.price_usd_annual).toBe(31);
    // Non-overridden fields stay
    expect(p.tagline).toBeTruthy();
  });

  it("falls back to free plan for unknown planId", () => {
    const p = getEffectivePlanById("nonexistent");
    expect(p.id).toBe("free");
  });
});

describe("setPlanOverride / resetAllOverrides (U-16)", () => {
  it("setPlanOverride persists to localStorage and is read on next call", () => {
    setPlanOverride("select", { price_usd: 25 });
    const stored = getPricingOverrides();
    expect(stored.select.price_usd).toBe(25);
  });

  it("corrupt JSON in localStorage → getPricingOverrides returns {}", () => {
    localStorage.setItem("datiq.pricingOverrides", "{not valid json}");
    expect(getPricingOverrides()).toEqual({});
  });

  it("resetAllOverrides clears all plan overrides", () => {
    setPlanOverride("select", { price_usd: 25 });
    setPlanOverride("pro", { price_usd: 35 });
    resetAllOverrides();
    expect(getPricingOverrides()).toEqual({});
  });

  it("limits are deep-merged, not replaced wholesale", () => {
    setPlanOverride("free", { limits: { batch_max_urls: 20 } });
    const p = getEffectivePlanById("free");
    expect(p.limits.batch_max_urls).toBe(20);
    // Other limits stay
    expect(p.limits.extractions).toBe(50);
  });
});

describe("Global discount (U-17)", () => {
  it("getGlobalDiscount returns 0 percent + inactive by default", () => {
    const d = getGlobalDiscount();
    expect(d.percent).toBe(0);
    expect(d.active).toBe(false);
  });

  it("applyGlobalDiscount returns the input unchanged when no active discount", () => {
    expect(applyGlobalDiscount(100)).toBe(100);
  });

  it("applyGlobalDiscount(price, 20) returns 80% of price when active", () => {
    setGlobalDiscount({ percent: 20, label: "Launch", active: true, expiresAt: null });
    expect(applyGlobalDiscount(100)).toBe(80);
    expect(applyGlobalDiscount(29)).toBe(23.2);
  });

  it("applyGlobalDiscount ignores expired discounts", () => {
    setGlobalDiscount({ percent: 50, label: "Old", active: true, expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(applyGlobalDiscount(100)).toBe(100);
  });
});

describe("getEffectivePlans / getEffectivePlanMap", () => {
  it("returns the same plan count as PLANS (7 priced plans; Enterprise is its own object)", () => {
    expect(getEffectivePlans().length).toBe(7);
  });

  it("getEffectivePlanMap keys by id", () => {
    const map = getEffectivePlanMap();
    expect(map.free.id).toBe("free");
    expect(map.pro.id).toBe("pro");
    expect(map.select.id).toBe("select");
  });
});

describe("Top-up bundle overrides", () => {
  it("getTopupOverrides returns {} when nothing set", () => {
    expect(getTopupOverrides()).toEqual({});
  });

  // Was pinned to "extractions-bundle", which is retired (D15) — it sold pure
  // consumption at 14x the cheapest plan's credit rate. The override
  // mechanism is unchanged; only the bundle it was demonstrated on is gone.
  it("setTopupOverride persists and is reflected in getEffectiveBundles", () => {
    setTopupOverride("scheduler-addon", { price_usd: 19 });
    const bundle = getEffectiveBundles().find((b) => b.id === "scheduler-addon");
    expect(bundle.price_usd).toBe(19);
  });

  it("an override for a retired bundle does not resurrect it", () => {
    setTopupOverride("extractions-bundle", { price_usd: 19 });
    expect(getEffectiveBundles().some((b) => b.id === "extractions-bundle")).toBe(false);
  });
});
