// src/lib/savedSearches.test.js — Q3 (saved searches cap) unit tests.

import { describe, expect, it, vi } from "vitest";

vi.mock("./pricingOverrides.js", () => ({
  getEffectivePlanById: (id) => ({ name: id }),
}));

const {
  getSavedSearchesCap,
  isOverCap,
  remainingSlots,
  planSupportsUnlimitedSaved,
  capMessage,
} = await import("./savedSearches.js");

describe("Q3 — savedSearchesCap: pure logic", () => {
  it("returns 10 for the free plan", () => {
    expect(getSavedSearchesCap("free")).toBe(10);
    expect(getSavedSearchesCap(null)).toBe(10);
    expect(getSavedSearchesCap(undefined)).toBe(10);
  });

  it("returns Infinity for paid plans", () => {
    expect(getSavedSearchesCap("select")).toBe(Infinity);
    expect(getSavedSearchesCap("pro")).toBe(Infinity);
    expect(getSavedSearchesCap("business")).toBe(Infinity);
    expect(getSavedSearchesCap("agency")).toBe(Infinity);
  });

  it("isOverCap returns true at the limit (count >= cap)", () => {
    expect(isOverCap({ count: 10, planId: "free" })).toBe(true);
    expect(isOverCap({ count: 11, planId: "free" })).toBe(true);
    expect(isOverCap({ count: 9,  planId: "free" })).toBe(false);
  });

  it("isOverCap is always false for paid plans", () => {
    expect(isOverCap({ count: 9999, planId: "pro" })).toBe(false);
  });

  it("remainingSlots returns the right gap for free, Infinity for paid", () => {
    expect(remainingSlots({ count: 5, planId: "free" })).toBe(5);
    expect(remainingSlots({ count: 10, planId: "free" })).toBe(0);
    expect(remainingSlots({ count: 12, planId: "free" })).toBe(0);
    expect(remainingSlots({ count: 9999, planId: "pro" })).toBe(Infinity);
  });

  it("planSupportsUnlimitedSaved matches paid plans", () => {
    expect(planSupportsUnlimitedSaved("free")).toBe(false);
    expect(planSupportsUnlimitedSaved("select")).toBe(true);
    expect(planSupportsUnlimitedSaved("pro")).toBe(true);
  });
});

describe("Q3 — capMessage: copy variants", () => {
  it("returns null copy for paid plans", () => {
    expect(capMessage({ count: 50, planId: "pro" })).toBeNull();
  });

  it("returns ok copy when comfortably under the cap", () => {
    const m = capMessage({ count: 3, planId: "free" });
    expect(m.tone).toBe("ok");
    expect(m.title).toBeNull();
    expect(m.message).toBeNull();
    expect(m.remaining).toBe(7);
  });

  it("returns warn copy at count >= cap - 2", () => {
    const m = capMessage({ count: 8, planId: "free" });
    expect(m.tone).toBe("warn");
    expect(m.title).toMatch(/2 saves left/);
    expect(m.remaining).toBe(2);
  });

  it("returns block copy at the cap", () => {
    const m = capMessage({ count: 10, planId: "free" });
    expect(m.tone).toBe("block");
    expect(m.title).toMatch(/limit reached/);
    expect(m.remaining).toBe(0);
  });
});
