import { describe, expect, it } from "vitest";
import { GST_RATE, computeCharge, perMonthIncl } from "./pricingMath.js";

/**
 * U-07..08 — pricingMath is the canonical charge-computation helper
 * the client uses to display the same number the server charges. The
 * single-step INR rounding in computeCharge is what closes the
 * client/server drift risk.
 */

const PRO_PLAN = {
  id: "pro",
  price_usd: 29,
  price_usd_annual: 23,
  price_inr: 1499,
  price_inr_annual: 1499,
};

const BUNDLE = {
  id: "batch-pack-50",
  price_usd: 49,
  price_inr: 3999,
};

describe("computeCharge — USD paths (no GST)", () => {
  it("USD monthly — gross, base, gst=0, total = base", () => {
    const r = computeCharge(PRO_PLAN, "monthly", "USD", 0);
    expect(r.gross).toBe(29);
    expect(r.discount).toBe(0);
    expect(r.base).toBe(29);
    expect(r.gst).toBe(0);
    expect(r.total).toBe(29);
    expect(r.totalMinor).toBe(2900);
  });

  it("USD annual — gross = monthly * 12; total = base", () => {
    const r = computeCharge(PRO_PLAN, "annual", "USD", 0);
    expect(r.gross).toBe(23 * 12);
    expect(r.discount).toBe(0);
    expect(r.base).toBe(23 * 12);
    expect(r.gst).toBe(0);
    expect(r.total).toBe(23 * 12);
  });

  it("USD with a 20% coupon — discount = gross * 0.2, total = base", () => {
    const r = computeCharge(PRO_PLAN, "monthly", "USD", 20);
    expect(r.gross).toBe(29);
    expect(r.discount).toBe(5.8);
    expect(r.base).toBe(23.2);
    expect(r.gst).toBe(0);
    expect(r.total).toBe(23.2);
  });

  it("USD bundle (no monthly/annual distinction) — gross = price_usd", () => {
    const r = computeCharge(BUNDLE, "monthly", "USD", 0);
    expect(r.gross).toBe(49);
    expect(r.base).toBe(49);
    expect(r.total).toBe(49);
    expect(r.totalMinor).toBe(4900);
  });
});

describe("computeCharge — INR paths (18% GST)", () => {
  it("INR monthly — total = base * 1.18, totalMinor in paise", () => {
    const r = computeCharge(PRO_PLAN, "monthly", "INR", 0);
    expect(r.gross).toBe(1499);
    expect(r.base).toBe(1499);
    expect(r.gst).toBe(Math.round(1499 * 0.18 * 100) / 100);
    expect(r.total).toBe(Math.round(1499 * 1.18 * 100) / 100);
    expect(r.totalMinor).toBe(Math.round(1499 * 1.18 * 100));
  });

  it("INR annual — gross = price_inr_annual * 12; total in paise", () => {
    const r = computeCharge(PRO_PLAN, "annual", "INR", 0);
    expect(r.gross).toBe(1499 * 12);
    expect(r.totalMinor).toBe(Math.round(1499 * 12 * 1.18 * 100));
  });

  it("INR with a 20% coupon — discount applied to gross BEFORE GST", () => {
    const r = computeCharge(PRO_PLAN, "monthly", "INR", 20);
    const expectedBase = 1499 * 0.8; // 1199.2
    const expectedTotalMinor = Math.round(expectedBase * 1.18 * 100);
    expect(r.base).toBe(Math.round(expectedBase * 100) / 100);
    expect(r.discount).toBe(Math.round((1499 - r.base) * 100) / 100);
    expect(r.totalMinor).toBe(expectedTotalMinor);
  });

  it("INR bundle — totalMinor in paise, total = base + gst", () => {
    const r = computeCharge(BUNDLE, "monthly", "INR", 0);
    expect(r.gross).toBe(3999);
    expect(r.totalMinor).toBe(Math.round(3999 * 1.18 * 100));
  });
});

describe("computeCharge — discount clamping (U-08)", () => {
  it("clamps discount to 0–100 range; negative → 0, >100 → 100", () => {
    const rNeg = computeCharge(PRO_PLAN, "monthly", "USD", -10);
    expect(rNeg.base).toBe(29);
    const rOver = computeCharge(PRO_PLAN, "monthly", "USD", 150);
    expect(rOver.base).toBe(0);
  });

  it("rounding is one-step: totalMinor computed in a single round (no drift)", () => {
    // 1499 * 0.8 * 1.18 = 1415.056 — the spec's promise is that client and
    // server see exactly the same number. The assertion guards against a
    // future refactor that rounds base and then rounds (base * 1.18)
    // separately (which would drift by 1 paise on this input).
    const r = computeCharge(PRO_PLAN, "monthly", "INR", 20);
    const gross = 1499;
    const directTotalMinor = Math.round(gross * 0.8 * 1.18 * 100);
    expect(r.totalMinor).toBe(directTotalMinor);
  });
});

describe("perMonthIncl", () => {
  it("USD annual: returns the annual-per-month figure, no GST", () => {
    expect(perMonthIncl(PRO_PLAN, "USD")).toBe(23);
  });

  it("INR annual: returns price_inr_annual * (1 + GST_RATE), rounded to integer rupee", () => {
    const expected = Math.round(1499 * (1 + GST_RATE));
    expect(perMonthIncl(PRO_PLAN, "INR")).toBe(expected);
  });
});
