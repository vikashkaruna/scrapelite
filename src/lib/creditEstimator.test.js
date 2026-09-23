// src/lib/creditEstimator.test.js — Q2 (pre-flight credit estimator) unit tests.
//
// The estimator's whole job is to agree with the gate. These tests are written
// against `entitlementModel.creditGate`'s contract, not against the estimator's
// own convenience: the one that matters most is the LAST one, which runs the
// real gate and the estimator over the same inputs and asserts they reach the
// same verdict. The pre-switch version of this file could not have had that
// test, because the two were reading different pools.

import { describe, expect, it, beforeEach } from "vitest";

import { estimateCredits, estimateBatchCredits, poolFrom } from "./creditEstimator.js";
import { CREDIT_WEIGHTS } from "./credits/creditWeights.js";
import { can } from "./entitlementModel.js";
import { getEffectivePlanMap } from "./pricingOverrides.js";

const pool = (available, extra = {}) => ({ enforced: true, degraded: false, available, grants: 1, ...extra });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* private mode */ }
});

describe("Q2 — creditEstimator: cost", () => {
  it("costs a page at CREDIT_WEIGHTS.page_fetch, not at one-per-extraction", () => {
    const r = estimateCredits({ count: 4, credits: pool(100) });
    expect(r.required).toBe(4 * CREDIT_WEIGHTS.page_fetch);
    expect(r.perUnit).toBe(CREDIT_WEIGHTS.page_fetch);
  });

  it("treats 0, negative and fractional counts as the user not having typed a run yet", () => {
    expect(estimateCredits({ count: 0, credits: pool(100) }).required).toBe(0);
    expect(estimateCredits({ count: 0, credits: pool(100) }).message).toMatch(/at least 1/i);
    expect(estimateCredits({ count: -3, credits: pool(100) }).required).toBe(0);
    expect(estimateCredits({ count: 1.7, credits: pool(100) }).required).toBe(CREDIT_WEIGHTS.page_fetch);
  });

  it("estimateBatchCredits delegates with the URL count", () => {
    const r = estimateBatchCredits({ urlCount: 4, planId: "free", credits: pool(100) });
    expect(r.required).toBe(4 * CREDIT_WEIGHTS.page_fetch);
    expect(r.allowed).toBe(true);
  });
});

describe("Q2 — creditEstimator: the pool it reads", () => {
  it("reads a real balance as known", () => {
    expect(poolFrom(pool(42))).toEqual({ known: true, available: 42 });
  });

  it.each([
    ["nothing cached",       null],
    ["not on the system",    { enforced: false, degraded: false, available: null }],
    ["unreadable",           { enforced: true, degraded: true, available: null }],
    ["a non-finite balance", { enforced: true, degraded: false, available: "lots" }],
  ])("treats %s as UNKNOWN, never as zero", (_label, credits) => {
    expect(poolFrom(credits).known).toBe(false);
    // The consequence that matters: an unknown balance never blocks.
    const r = estimateCredits({ count: 500, credits });
    expect(r.known).toBe(false);
    expect(r.allowed).toBe(true);
    expect(r.tone).toBe("ok");
  });

  it("still names the price when the balance is unknown", () => {
    const r = estimateCredits({ count: 3, credits: null });
    expect(r.message).toContain(`${3 * CREDIT_WEIGHTS.page_fetch} credit`);
    expect(r.message).not.toMatch(/\b0\b/);
  });
});

describe("Q2 — creditEstimator: tone", () => {
  it("tone=ok well inside the pool", () => {
    const r = estimateCredits({ count: 2, planId: "free", credits: pool(100) });
    expect(r.tone).toBe("ok");
    expect(r.allowed).toBe(true);
    expect(r.afterRun).toBe(100 - 2 * CREDIT_WEIGHTS.page_fetch);
  });

  it("tone=block when the run costs more than the pool holds, and NAMES both numbers", () => {
    const r = estimateCredits({ count: 12, planId: "free", credits: pool(5) });
    expect(r.allowed).toBe(false);
    expect(r.tone).toBe("block");
    expect(r.overage).toBe(12 * CREDIT_WEIGHTS.page_fetch - 5);
    expect(r.reason).toContain(`${12 * CREDIT_WEIGHTS.page_fetch} credit`);
    expect(r.reason).toContain("you have 5");
  });

  it("tone=warn when the run would leave ≤ 20% of the pool", () => {
    // 10 in the pool, a run costing 9 leaves 1, and 1 ≤ floor(10 * 0.2) = 2.
    const r = estimateCredits({ count: 9 / CREDIT_WEIGHTS.page_fetch, planId: "free", credits: pool(10) });
    expect(r.allowed).toBe(true);
    expect(r.tone).toBe("warn");
    expect(r.afterRun).toBe(1);
  });

  it("returns planName from the effective plan map", () => {
    const r = estimateCredits({ count: 1, planId: "pro", credits: pool(100) });
    expect(r.planId).toBe("pro");
    expect(r.planName.toLowerCase()).toContain("pro");
  });
});

describe("Q2 — creditEstimator: it agrees with the gate", () => {
  // 🔴 THE REGRESSION THIS FILE EXISTS FOR. The old estimator read
  // `plan.limits.extractions` (free = 10) while the gate reads the credit pool,
  // so a free account with 100 credits was told a 12-URL batch was "Blocked —
  // 10 remaining, 12 needed" for a run the gate allows at 12 credits.
  const planMap = getEffectivePlanMap();
  const entitlement = { plan_id: "free", status: "active" };

  it.each([
    [12, 100],   // the exact case the old code refused
    [1, 100],
    [40, 39],    // genuinely short
    [40, 40],    // exactly affordable
    [5, 0],      // empty pool
  ])("urlCount=%i against a pool of %i reaches the gate's verdict", (urlCount, available) => {
    const credits = pool(available);
    const gate = can(entitlement, "extract.batch", { planMap, credits, urlCount });
    const est = estimateBatchCredits({ urlCount, planId: "free", credits });
    expect(est.allowed).toBe(gate.allowed);
  });

  it("agrees with the gate when the balance is unknown — both fail OPEN", () => {
    const credits = { enforced: false, degraded: false, available: null };
    const gate = can(entitlement, "extract.batch", { planMap, credits, urlCount: 9999 });
    const est = estimateBatchCredits({ urlCount: 9999, planId: "free", credits });
    expect(gate.allowed).toBe(true);
    expect(est.allowed).toBe(true);
  });
});
