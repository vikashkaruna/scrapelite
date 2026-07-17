// src/lib/creditEstimator.test.js — Q2 (pre-flight credit estimator) unit tests.

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("./usageService.js", () => ({
  readUsage: () => ({ extractions: 0, month: "2026-07" }),
}));

const { estimateCredits, estimateBatchCredits } = await import("./creditEstimator.js");

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch {}
});

describe("Q2 — creditEstimator: pure logic", () => {
  it("defaults to 1 credit when count is missing/0", () => {
    const r = estimateCredits({});
    expect(r.required).toBe(1);
    expect(r.remaining).toBeGreaterThanOrEqual(1);
  });

  it("rounds fractional counts up to 0 and treats 0 as 'no input yet'", () => {
    const r0 = estimateCredits({ count: 0 });
    expect(r0.required).toBe(0);
    expect(r0.message).toMatch(/at least 1/i);

    const rNeg = estimateCredits({ count: -3 });
    expect(rNeg.required).toBe(0);

    const rFloat = estimateCredits({ count: 1.7 });
    expect(rFloat.required).toBe(1);
  });

  it("tone=ok when within remaining quota", () => {
    const r = estimateCredits({ count: 2, planId: "free" });
    expect(r.tone).toBe("ok");
    expect(r.allowed).toBe(true);
    expect(r.message).toMatch(/2 of/);
  });

  it("tone=block when over remaining quota", () => {
    // Free plan = 10/mo, 5 already used → 5 remaining. Need 7.
    const r = estimateCredits({ count: 7, planId: "free", usageOverride: { extractions: 5, month: "2026-07" } });
    expect(r.allowed).toBe(false);
    expect(r.tone).toBe("block");
    expect(r.overage).toBe(2);
    expect(r.reason).toMatch(/need 7/);
  });

  it("tone=warn when run would leave ≤ 20% remaining", () => {
    // Free plan = 10/mo, 1 already used → 9 remaining. Need 8 → afterRun = 1 (≤ 20% of 9 = 1.8).
    const r = estimateCredits({ count: 8, planId: "free", usageOverride: { extractions: 1, month: "2026-07" } });
    expect(r.allowed).toBe(true);
    expect(r.tone).toBe("warn");
    expect(r.afterRun).toBe(1);
  });

  it("isUnlimited=true for agency plan", () => {
    const r = estimateCredits({ count: 9999, planId: "agency" });
    expect(r.isUnlimited).toBe(true);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Infinity);
  });

  it("returns planName from the effective plan map", () => {
    const r = estimateCredits({ count: 1, planId: "pro" });
    expect(r.planId).toBe("pro");
    expect(r.planName.toLowerCase()).toContain("pro");
  });

  it("estimateBatchCredits delegates to estimateCredits with the URL count", () => {
    const r = estimateBatchCredits({ urlCount: 4, planId: "free" });
    expect(r.required).toBe(4);
    expect(r.allowed).toBe(true);
  });
});
