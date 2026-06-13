// pricingMath.js — canonical charge computation for DISPLAY purposes.
// The server (create-checkout.js) is the source of truth for the amount actually
// charged; this helper exists so the modal, paymentService, and any UI show the
// exact same number the server computes — no double-rounding drift.
//
// INR prices are BASE (pre-GST). 18% GST is added at checkout for INR only.
// USD has no GST.

export const GST_RATE = 0.18;

// Returns { base, gst, total, totalMinor } for a plan/bundle.
// - base:      pre-GST amount in major units (₹ or $)
// - gst:       GST amount in major units (0 for USD)
// - total:     base + gst in major units
// - totalMinor: integer smallest-unit amount (paise/cents) that mirrors the server
//
// For INR, totalMinor is computed as round(base * 1.18 * 100) in ONE step to match
// the server and avoid the rounding drift that occurs when GST is rounded separately.
export function computeCharge(plan, billingPeriod, currency) {
  const isINR   = currency === "INR";
  const annual  = billingPeriod === "annual";

  if (isINR) {
    const baseMonthly = annual ? (plan.price_inr_annual || 0) : (plan.price_inr || 0);
    const base        = annual ? baseMonthly * 12 : baseMonthly;
    const totalMinor  = Math.round(base * (1 + GST_RATE) * 100);
    const total       = totalMinor / 100;
    const gst         = total - base;
    return { base, gst, total, totalMinor };
  }

  // USD (no GST). Bundles ("once") fall here with price_usd only.
  const baseMonthly = annual ? (plan.price_usd_annual ?? plan.price_usd ?? 0) : (plan.price_usd ?? 0);
  const base        = annual ? baseMonthly * 12 : baseMonthly;
  return { base, gst: 0, total: base, totalMinor: Math.round(base * 100) };
}

// Per-month figure (incl. GST for INR) for annual-plan display.
export function perMonthIncl(plan, currency) {
  const isINR = currency === "INR";
  if (isINR) return Math.round((plan.price_inr_annual || 0) * (1 + GST_RATE));
  return plan.price_usd_annual ?? plan.price_usd ?? 0;
}
