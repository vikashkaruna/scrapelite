// src/lib/credits/creditPressure.test.js
//
// Three surfaces render from this — UsageUpsellBanner, ReferralBanner and
// Account's usage meter — and the assertion that matters is not the threshold,
// it is that an UNKNOWN balance never becomes a zero. A guest, an account never
// granted credits, and an unreadable read must all render nothing rather than
// "0 credits remaining", which would tell a customer they are out of something
// they were never given.

import { describe, expect, it } from "vitest";
import { creditPressure, LOW_PCT } from "./creditPressure.js";

const pool = (available) => ({ enforced: true, degraded: false, available, grants: 1 });

describe("creditPressure — unknown is never zero", () => {
  it.each([
    ["nothing cached",       null],
    ["undefined",            undefined],
    ["never granted",        { enforced: false, degraded: false, available: null }],
    ["unreadable",           { enforced: true, degraded: true, available: null }],
    ["a non-numeric balance",{ enforced: true, degraded: false, available: "some" }],
  ])("%s → known:false, and NOT low and NOT empty", (_label, credits) => {
    const p = creditPressure({ credits, allowance: 100 });
    expect(p.known).toBe(false);
    // 🔴 Both of these must be false, not just `known`. A surface that branches
    // on `low` alone would still render an upsell for an account whose balance
    // we simply could not read.
    expect(p.low).toBe(false);
    expect(p.empty).toBe(false);
    expect(p.remainingPct).toBeNull();
  });
});

describe("creditPressure — the low band", () => {
  it("is not low with a full pool", () => {
    expect(creditPressure({ credits: pool(100), allowance: 100 }).low).toBe(false);
  });

  it(`is low at exactly ${LOW_PCT * 100}% of the allowance`, () => {
    expect(creditPressure({ credits: pool(20), allowance: 100 }).low).toBe(true);
  });

  it("is not low just above the band", () => {
    expect(creditPressure({ credits: pool(21), allowance: 100 }).low).toBe(false);
  });

  it("an empty pool is low AND empty", () => {
    const p = creditPressure({ credits: pool(0), allowance: 100 });
    expect(p.empty).toBe(true);
    expect(p.low).toBe(true);
  });

  it("a negative balance is empty — it is a real state, not clamped away", () => {
    // credit_available() returns a signed integer on purpose: an account that
    // went negative through a race is a fact worth surfacing, not a zero.
    const p = creditPressure({ credits: pool(-30), allowance: 100 });
    expect(p.known).toBe(true);
    expect(p.available).toBe(-30);
    expect(p.empty).toBe(true);
  });
});

describe("creditPressure — rollover", () => {
  it("reports remainingPct ABOVE 1 rather than clamping it", () => {
    // A monthly grant expires at the end of the FOLLOWING month, so two can be
    // live at once and an account can hold 2x its allowance. Clamping would
    // draw a full bar for an account holding twice that.
    const p = creditPressure({ credits: pool(200), allowance: 100 });
    expect(p.remainingPct).toBe(2);
    expect(p.low).toBe(false);
  });
});

describe("creditPressure — no allowance to measure against", () => {
  it("can still say 'empty', the one claim needing no denominator", () => {
    const p = creditPressure({ credits: pool(0), allowance: null });
    expect(p.known).toBe(true);
    expect(p.remainingPct).toBeNull();
    expect(p.empty).toBe(true);
    expect(p.low).toBe(true);
  });

  it("does not call a healthy balance low when it cannot compute a share", () => {
    const p = creditPressure({ credits: pool(5000), allowance: null });
    expect(p.low).toBe(false);
  });
});
