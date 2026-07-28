// pricingMath.js — canonical charge computation for DISPLAY purposes.
// The server (create-checkout.js) is the source of truth for the amount actually
// charged; this helper exists so the modal, paymentService, and any UI show the
// exact same number the server computes — no double-rounding drift.
//
// INR prices are BASE (pre-GST). 18% GST is added at checkout for INR only.
// USD has no GST.

//
// The arithmetic itself now lives in chargeMath.js, which is the SAME module
// create-checkout.js uses to compute the real charge. This file is a thin
// adapter that keeps the display vocabulary ({gross, discount, base, gst,
// total}) the UI already destructures — PaymentConfirmModal.jsx:30 among
// others — while guaranteeing the number shown is the number charged.
import {
  GST_RATE as RATE,
  computeChargeMinor,
  discountFraction,
  grossMajor,
  toMajor,
} from "./chargeMath.js";

export const GST_RATE = RATE;

// Clamp a percent (0–100) to a fraction (0–1).
function discFrac(discountPercent) {
  return discountFraction(discountPercent);
}

// Returns { gross, discount, base, gst, total, totalMinor } for a plan/bundle.
// - gross:     pre-discount, pre-GST amount in major units (₹ or $)
// - discount:  amount removed by the discount in major units (0 if none)
// - base:      post-discount, pre-GST amount in major units (₹ or $)
// - gst:       GST amount in major units (0 for USD)
// - total:     base + gst in major units
// - totalMinor: integer smallest-unit amount (paise/cents) that mirrors the server
//
// `discountPercent` (0–100) mirrors the server's serverDiscount = max(coupon, global):
// the discount is applied to the gross base BEFORE GST, exactly like create-checkout.js.
// For INR, totalMinor is computed as round(gross * (1-disc) * 1.18 * 100) in ONE step to
// match the server and avoid rounding drift.
export function computeCharge(plan, billingPeriod, currency, discountPercent = 0) {
  // Bundles are priced as a single "once" unit and only carry price_usd/price_inr.
  const period = billingPeriod === "annual" ? "annual" : billingPeriod === "once" ? "once" : "monthly";
  const gross = grossMajor({ prices: plan, billingPeriod: period, currency });
  const c = computeChargeMinor({
    gross,
    discountFrac: discFrac(discountPercent),
    currency,
  });

  return {
    gross,
    discount: toMajor(c.discountMinor),
    base: toMajor(c.taxableMinor),
    gst: toMajor(c.taxMinor),
    total: toMajor(c.totalMinor),
    totalMinor: c.totalMinor,
  };
}

// Per-month figure (incl. GST for INR) for annual-plan display.
export function perMonthIncl(plan, currency) {
  const isINR = currency === "INR";
  if (isINR) return Math.round((plan.price_inr_annual || 0) * (1 + GST_RATE));
  return plan.price_usd_annual ?? plan.price_usd ?? 0;
}
