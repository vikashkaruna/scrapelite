// pricingMath.js — canonical charge computation for DISPLAY purposes.
// The server (create-checkout.js) is the source of truth for the amount actually
// charged; this helper exists so the modal, paymentService, and any UI show the
// exact same number the server computes — no double-rounding drift.
//
// INR prices are BASE (pre-GST). 18% GST is added at checkout for INR only.
// USD has no GST.

export const GST_RATE = 0.18;

// Clamp a percent (0–100) to a fraction (0–1).
function discFrac(discountPercent) {
  const p = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  return p / 100;
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
  const isINR   = currency === "INR";
  const annual  = billingPeriod === "annual";
  const frac    = discFrac(discountPercent);

  if (isINR) {
    const baseMonthly = annual ? (plan.price_inr_annual || 0) : (plan.price_inr || 0);
    const gross       = annual ? baseMonthly * 12 : baseMonthly;
    const base        = Math.round(gross * (1 - frac) * 100) / 100;
    const totalMinor  = Math.round(gross * (1 - frac) * (1 + GST_RATE) * 100);
    const total       = totalMinor / 100;
    const gst         = Math.round((total - base) * 100) / 100;
    return { gross, discount: Math.round((gross - base) * 100) / 100, base, gst, total, totalMinor };
  }

  // USD (no GST). Bundles ("once") fall here with price_usd only.
  const baseMonthly = annual ? (plan.price_usd_annual ?? plan.price_usd ?? 0) : (plan.price_usd ?? 0);
  const gross       = annual ? baseMonthly * 12 : baseMonthly;
  const base        = Math.round(gross * (1 - frac) * 100) / 100;
  return { gross, discount: Math.round((gross - base) * 100) / 100, base, gst: 0, total: base, totalMinor: Math.round(base * 100) };
}

// Per-month figure (incl. GST for INR) for annual-plan display.
export function perMonthIncl(plan, currency) {
  const isINR = currency === "INR";
  if (isINR) return Math.round((plan.price_inr_annual || 0) * (1 + GST_RATE));
  return plan.price_usd_annual ?? plan.price_usd ?? 0;
}
