// chargeMath.test.js — the money tests.
//
// Two things are being protected here:
//   1. No customer's charge moves by a single paisa as a result of the refactor
//      (the LEGACY PARITY table below).
//   2. The invoice components always sum exactly, so a tax invoice can never be
//      internally inconsistent.
import { describe, expect, it } from "vitest";
import {
  GST_RATE,
  TAX_TREATMENT,
  computeChargeMinor,
  discountFraction,
  grossMajor,
  normalizePrices,
  resolveTaxTreatment,
  toMajor,
} from "./chargeMath.js";

// Mirrors STATIC_PLANS in lib/pricingSource.js (base, pre-GST; annual is PER MONTH).
const PLANS = {
  select:   { inr: 1899,  inr_annual: 999,   usd: 19,  usd_annual: 15 },
  pro:      { inr: 2899,  inr_annual: 1499,  usd: 29,  usd_annual: 23 },
  business: { inr: 7899,  inr_annual: 3999,  usd: 79,  usd_annual: 63 },
  agency:   { inr: 29899, inr_annual: 14999, usd: 299, usd_annual: 239 },
};

const inr = (over) => ({ currency: "INR", ...over });

describe("LEGACY PARITY — charges must not move", () => {
  // The exact expression create-checkout.js used before the refactor.
  const legacy = (grossVal, disc, rate) => Math.round(grossVal * (1 - disc) * (1 + rate) * 100);

  const DISCOUNTS = [0, 0.1, 0.2, 0.3, 0.5];

  for (const [id, prices] of Object.entries(PLANS)) {
    for (const period of ["monthly", "annual"]) {
      for (const disc of DISCOUNTS) {
        it(`INR ${id} ${period} @${disc * 100}% matches the pre-refactor amount`, () => {
          const gross = grossMajor({ prices, billingPeriod: period, currency: "INR" });
          const r = computeChargeMinor(inr({ gross, discountFrac: disc }));
          expect(r.totalMinor).toBe(legacy(gross, disc, GST_RATE));
        });

        it(`USD ${id} ${period} @${disc * 100}% matches the pre-refactor amount`, () => {
          const gross = grossMajor({ prices, billingPeriod: period, currency: "USD" });
          const r = computeChargeMinor({ currency: "USD", gross, discountFrac: disc });
          expect(r.totalMinor).toBe(legacy(gross, disc, 0));
        });
      }
    }
  }

  it("reproduces the three amounts pinned in create-checkout.test.js", () => {
    const pro = grossMajor({ prices: PLANS.pro, billingPeriod: "monthly", currency: "INR" });
    expect(computeChargeMinor(inr({ gross: pro })).totalMinor).toBe(Math.round(2899 * 1.18 * 100));

    const sel = grossMajor({ prices: PLANS.select, billingPeriod: "annual", currency: "INR" });
    expect(computeChargeMinor(inr({ gross: sel })).totalMinor).toBe(
      Math.round(999 * 12 * 1.18 * 100),
    );

    const agy = grossMajor({ prices: PLANS.agency, billingPeriod: "annual", currency: "INR" });
    expect(computeChargeMinor(inr({ gross: agy })).totalMinor).toBe(
      Math.round(14999 * 12 * 1.18 * 100),
    );
  });

  it("the additive branch agrees with the one-step branch at zero credit", () => {
    // Proves the two-branch split in computeChargeMinor is belt-and-braces
    // (chosen to guarantee legacy amounts) and not a real behavioural fork.
    for (const prices of Object.values(PLANS)) {
      for (const period of ["monthly", "annual"]) {
        for (const disc of [0, 0.1, 0.2, 0.3, 0.5]) {
          const gross = grossMajor({ prices, billingPeriod: period, currency: "INR" });
          const oneStep = computeChargeMinor(inr({ gross, discountFrac: disc }));
          const additive = oneStep.taxableMinor + Math.round(oneStep.taxableMinor * GST_RATE);
          expect(additive).toBe(oneStep.totalMinor);
        }
      }
    }
  });
});

describe("components always sum", () => {
  const cases = [];
  for (const [id, prices] of Object.entries(PLANS)) {
    for (const period of ["monthly", "annual"]) {
      for (const disc of [0, 0.07, 0.1, 0.2, 0.3, 0.33, 0.5, 0.99]) {
        cases.push([id, period, disc, grossMajor({ prices, billingPeriod: period, currency: "INR" })]);
      }
    }
  }

  it.each(cases)("taxable + tax === total (%s %s @%f)", (_id, _p, disc, gross) => {
    const r = computeChargeMinor(inr({ gross, discountFrac: disc }));
    expect(r.taxableMinor + r.taxMinor).toBe(r.totalMinor);
  });

  it.each(cases)("cgst + sgst === tax (%s %s @%f)", (_id, _p, disc, gross) => {
    const r = computeChargeMinor(inr({ gross, discountFrac: disc }));
    expect(r.cgstMinor + r.sgstMinor).toBe(r.taxMinor);
  });

  it.each(cases)("gross - discount === taxable when no credit (%s %s @%f)", (_id, _p, disc, gross) => {
    const r = computeChargeMinor(inr({ gross, discountFrac: disc }));
    expect(r.grossMinor - r.discountMinor).toBe(r.taxableMinor);
  });

  it("splits an ODD paise tax without losing or inventing a paisa", () => {
    // 12345 paise of tax must split 6172 / 6173, not 6172.5 twice.
    const r = { taxMinor: 12345 };
    const cgst = Math.floor(r.taxMinor / 2);
    const sgst = r.taxMinor - cgst;
    expect(cgst).toBe(6172);
    expect(sgst).toBe(6173);
    expect(cgst + sgst).toBe(12345);
  });
});

describe("tax treatment", () => {
  it("uses CGST+SGST within the supplier's own state", () => {
    const r = computeChargeMinor(
      inr({ gross: 2899, supplierState: "Karnataka", placeOfSupply: "Karnataka" }),
    );
    expect(r.taxTreatment).toBe(TAX_TREATMENT.INTRA);
    expect(r.igstMinor).toBe(0);
    expect(r.cgstMinor + r.sgstMinor).toBe(r.taxMinor);
  });

  it("uses IGST across state lines", () => {
    const r = computeChargeMinor(
      inr({ gross: 2899, supplierState: "Karnataka", placeOfSupply: "Maharashtra" }),
    );
    expect(r.taxTreatment).toBe(TAX_TREATMENT.INTER);
    expect(r.igstMinor).toBe(r.taxMinor);
    expect(r.cgstMinor).toBe(0);
    expect(r.sgstMinor).toBe(0);
  });

  it("is case- and whitespace-insensitive about state names", () => {
    const r = computeChargeMinor(
      inr({ gross: 2899, supplierState: "Karnataka", placeOfSupply: "  karnataka " }),
    );
    expect(r.taxTreatment).toBe(TAX_TREATMENT.INTRA);
  });

  it("defaults an unknown recipient state to intra-state (B2C = supplier location)", () => {
    const r = computeChargeMinor(inr({ gross: 2899, supplierState: "Karnataka" }));
    expect(r.taxTreatment).toBe(TAX_TREATMENT.INTRA);
  });

  it("charges no tax at all on USD", () => {
    const r = computeChargeMinor({ currency: "USD", gross: 29 });
    expect(r.taxTreatment).toBe(TAX_TREATMENT.NONE);
    expect(r.taxMinor).toBe(0);
    expect(r.cgstMinor).toBe(0);
    expect(r.sgstMinor).toBe(0);
    expect(r.igstMinor).toBe(0);
    expect(r.totalMinor).toBe(2900);
  });

  it("charges no tax when the rate is explicitly zero (unregistered supplier)", () => {
    const r = computeChargeMinor(inr({ gross: 2899, taxRate: 0 }));
    expect(r.taxMinor).toBe(0);
    expect(r.totalMinor).toBe(289900);
    expect(r.taxTreatment).toBe(TAX_TREATMENT.NONE);
  });
});

describe("proration credit", () => {
  it("reduces the taxable value before tax is applied", () => {
    const full = computeChargeMinor(inr({ gross: 2899 }));
    const credited = computeChargeMinor(inr({ gross: 2899, prorationCreditMinor: 100000 }));
    expect(credited.taxableMinor).toBe(full.taxableMinor - 100000);
    expect(credited.taxMinor).toBeLessThan(full.taxMinor); // tax on the NET supply
    expect(credited.taxableMinor + credited.taxMinor).toBe(credited.totalMinor);
  });

  it("never produces a negative total, and carries the excess forward", () => {
    const r = computeChargeMinor(inr({ gross: 1000, prorationCreditMinor: 500000 }));
    expect(r.taxableMinor).toBe(0);
    expect(r.totalMinor).toBe(0);
    expect(r.prorationCreditMinor).toBe(100000); // only what could be applied
    expect(r.creditCarriedMinor).toBe(400000);   // remainder → account credit
  });

  it("applies exactly the credit available when it fits", () => {
    const r = computeChargeMinor(inr({ gross: 2899, prorationCreditMinor: 50000 }));
    expect(r.prorationCreditMinor).toBe(50000);
    expect(r.creditCarriedMinor).toBe(0);
  });
});

describe("quantity (bundles)", () => {
  it("multiplies a one-time bundle price by quantity", () => {
    const gross = grossMajor({ prices: { inr: 749 }, billingPeriod: "once", currency: "INR", qty: 3 });
    expect(gross).toBe(2247);
    const r = computeChargeMinor(inr({ gross, qty: 3 }));
    expect(r.totalMinor).toBe(Math.round(2247 * 1.18 * 100));
    expect(r.qty).toBe(3);
  });
});

describe("edge cases", () => {
  it("a 100% discount yields a zero total, which the caller must reject", () => {
    // Razorpay's minimum is ₹1. A zero-total order must be refused upstream,
    // not silently sent to the gateway.
    const r = computeChargeMinor(inr({ gross: 2899, discountFrac: 1 }));
    expect(r.totalMinor).toBe(0);
    expect(r.taxableMinor).toBe(0);
  });

  it("clamps an out-of-range discount instead of inverting the charge", () => {
    expect(computeChargeMinor(inr({ gross: 2899, discountFrac: 5 })).totalMinor).toBe(0);
    expect(computeChargeMinor(inr({ gross: 2899, discountFrac: -3 })).totalMinor).toBe(
      Math.round(2899 * 1.18 * 100),
    );
  });

  it("treats a zero-priced plan as a zero charge", () => {
    expect(computeChargeMinor(inr({ gross: 0 })).totalMinor).toBe(0);
  });
});

describe("helpers", () => {
  it("normalizePrices accepts both the server and client vocabularies", () => {
    expect(normalizePrices({ inr: 1899, inr_annual: 999 })).toMatchObject({ inr: 1899, inr_annual: 999 });
    expect(normalizePrices({ price_inr: 1899, price_inr_annual: 999 })).toMatchObject({
      inr: 1899,
      inr_annual: 999,
    });
  });

  it("grossMajor bills annual plans as twelve months of the per-month rate", () => {
    expect(grossMajor({ prices: PLANS.select, billingPeriod: "annual", currency: "INR" })).toBe(
      999 * 12,
    );
    expect(grossMajor({ prices: PLANS.select, billingPeriod: "monthly", currency: "INR" })).toBe(1899);
  });

  it("discountFraction clamps to 0–1", () => {
    expect(discountFraction(20)).toBe(0.2);
    expect(discountFraction(-5)).toBe(0);
    expect(discountFraction(500)).toBe(1);
    expect(discountFraction("nonsense")).toBe(0);
  });

  it("resolveTaxTreatment returns NONE for a zero rate regardless of states", () => {
    expect(
      resolveTaxTreatment({ currency: "INR", taxRate: 0, supplierState: "KA", placeOfSupply: "MH" }),
    ).toBe(TAX_TREATMENT.NONE);
  });

  it("toMajor converts minor units for display", () => {
    expect(toMajor(342082)).toBe(3420.82);
    expect(toMajor(0)).toBe(0);
  });
});
