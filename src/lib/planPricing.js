// planPricing.js — the ONE rule for "what per-month price does /pricing show
// for this plan, billing period and currency".
//
// It used to live privately inside Pricing.jsx, and PricingMatrix.jsx kept its
// own copy that always read the ANNUAL figure. The page defaults to MONTHLY, so
// the plan cards said Select $14.4/mo while "Compare every plan" said $12/mo on
// the same screen. Both surfaces now call this module, so they cannot disagree.
//
// Prices are BASE prices: INR is pre-GST (18% is added at checkout by
// chargeMath.js), USD excludes local taxes. The global sale discount is NOT
// applied here — callers apply applyGlobalDiscount() so admin overrides flow
// through exactly one place.

/**
 * Per-month display price for a plan.
 *
 * 🔴 THERE IS NO LONGER A CONVERSION PATH, AND THAT IS THE POINT. This used to
 * fall back to `convertPrice(plan.price_usd, rates, "INR")` when a plan had no
 * fixed INR price. Two things were wrong with it: a converted price MOVES when
 * the rate moves, so the figure on the card and the figure charged could differ
 * between the page load and the checkout — and the server never converted
 * anything, so the two sides were computing a price by different rules. INR is
 * now a SET price on every plan (PLAN_TABLE), and a plan without one resolves
 * to 0 rather than inventing an amount.
 *
 * ⚠️ `rates` is still accepted so the four call sites need no change, and is
 * deliberately unused. Do not reintroduce it here.
 *
 * @param {object} plan           effective plan (see pricingOverrides.getEffectivePlans)
 * @param {"monthly"|"annual"} billingPeriod
 * @param {"USD"|"INR"} currency
 * @param {object} [_rates]       ignored — kept for call-site compatibility
 * @returns {number}
 */
export function resolvePlanPrice(plan, billingPeriod, currency, _rates) {
  if (!plan || plan.price_usd === 0) return 0;
  if (billingPeriod === "annual") {
    if (currency === "INR") return plan.price_inr_annual || 0;
    return plan.price_usd_annual ?? plan.price_usd;
  }
  if (currency === "INR") return plan.price_inr || 0;
  return plan.price_usd;
}

/**
 * Average "annual vs monthly" saving across paid, purchasable plans, rounded to
 * one decimal place. Derived from the live plan list rather than hardcoded, so
 * no copy can claim a discount the cards do not actually give.
 */
export function annualSavingsPercent(plans, currency) {
  const fracs = (plans || [])
    .filter((p) => p.price_usd > 0 && !p.comingSoon)
    .map((p) => {
      const monthly = currency === "INR" ? p.price_inr : p.price_usd;
      const annual  = currency === "INR" ? p.price_inr_annual : p.price_usd_annual;
      if (!monthly || annual == null) return null;
      return 1 - annual / monthly;
    })
    .filter((f) => f != null && f > 0);
  if (!fracs.length) return 0;
  return Math.round((fracs.reduce((a, b) => a + b, 0) / fracs.length) * 1000) / 10;
}
