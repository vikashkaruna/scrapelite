// chargeMath.js — the money file. Decomposes a charge into the components a
// tax invoice legally has to show, in integer minor units (paise / cents).
//
// Until now create-checkout.js computed gross → discount → taxable → GST →
// total inline and returned ONLY the grand total; every component was thrown
// away. An invoice cannot be issued from a single number, so the decomposition
// is captured here, exported, and snapshotted at order time.
//
// ── THE INVARIANT THAT MATTERS MOST ──────────────────────────────────────────
// This refactor must not change what any customer is charged, by even one
// paisa. `totalMinor` is therefore still computed by the ORIGINAL one-step
// expression whenever there is no proration credit:
//
//     Math.round(gross * (1 - discount) * (1 + rate) * 100)
//
// One rounding step, exactly as before. netlify/__tests__/create-checkout.test.js
// pins literal paise values for three plans, and chargeMath.test.js adds a
// parity table across the whole plan × period × discount matrix.
//
// Everything else is DERIVED from that total so the parts always sum:
//     taxMinor = totalMinor - taxableMinor
// Never round the tax independently — that is how invoices end up off by a
// paisa and fail reconciliation.

export const GST_RATE = 0.18;

/** Tax treatment of a supply. */
export const TAX_TREATMENT = Object.freeze({
  INTRA: "intra", // same state  → CGST + SGST
  INTER: "inter", // other state → IGST
  NONE: "none",   // USD / unregistered / export
});

/** Clamp a percent (0–100) to a fraction (0–1). */
export function discountFraction(discountPercent) {
  const p = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  return p / 100;
}

/**
 * Normalise the two plan-price vocabularies into one shape.
 *
 * The server table (lib/pricingSource.js) uses `inr` / `inr_annual` / `usd` /
 * `usd_annual`; the client table (src/lib/pricingConfig.js) uses `price_inr` /
 * `price_inr_annual` / `price_usd` / `price_usd_annual`. Same numbers, two
 * names, and every consumer used to have to know which one it held.
 */
export function normalizePrices(p = {}) {
  return {
    inr: p.inr ?? p.price_inr ?? 0,
    inr_annual: p.inr_annual ?? p.price_inr_annual ?? 0,
    usd: p.usd ?? p.price_usd ?? 0,
    usd_annual: p.usd_annual ?? p.price_usd_annual ?? 0,
  };
}

/**
 * Gross (pre-discount, pre-tax) amount in MAJOR units.
 * Annual prices are stored PER MONTH and billed × 12.
 */
export function grossMajor({ prices, billingPeriod, currency, qty = 1 }) {
  const p = normalizePrices(prices);
  const isINR = currency === "INR";
  const annual = billingPeriod === "annual";

  if (billingPeriod === "once") {
    // Bundles: a single unit price, multiplied by quantity.
    return (isINR ? p.inr : p.usd) * qty;
  }
  const perMonth = isINR
    ? annual ? p.inr_annual : p.inr
    : annual ? p.usd_annual : p.usd;
  return (annual ? perMonth * 12 : perMonth) * qty;
}

/**
 * Decide CGST+SGST vs IGST.
 *
 * Place of supply for B2C defaults to the supplier's own state when the
 * recipient's address is unknown, which makes the supply intra-state. Only a
 * KNOWN, DIFFERENT recipient state makes it inter-state.
 */
export function resolveTaxTreatment({ currency, supplierState, placeOfSupply, taxRate }) {
  if (currency !== "INR" || !taxRate) return TAX_TREATMENT.NONE;
  const norm = (s) => String(s || "").trim().toLowerCase();
  const supplier = norm(supplierState);
  const buyer = norm(placeOfSupply);
  if (!supplier || !buyer) return TAX_TREATMENT.INTRA;
  return supplier === buyer ? TAX_TREATMENT.INTRA : TAX_TREATMENT.INTER;
}

/**
 * Full charge decomposition in integer minor units.
 *
 * @param {object}  a
 * @param {number}  a.gross                 pre-discount, pre-tax, MAJOR units
 * @param {number} [a.qty=1]
 * @param {number} [a.discountFrac=0]       0–1, server-resolved
 * @param {number} [a.prorationCreditMinor=0]  unused-time credit, MINOR units
 * @param {string}  a.currency              "INR" | "USD"
 * @param {number} [a.taxRate]              defaults to 18% for INR, 0 otherwise
 * @param {string} [a.supplierState]
 * @param {string} [a.placeOfSupply]
 * @param {string} [a.couponCode]
 */
export function computeChargeMinor({
  gross,
  qty = 1,
  discountFrac: disc = 0,
  prorationCreditMinor = 0,
  currency,
  taxRate,
  supplierState,
  placeOfSupply,
  couponCode = null,
}) {
  const isINR = currency === "INR";
  const rate = taxRate == null ? (isINR ? GST_RATE : 0) : taxRate;
  const d = Math.max(0, Math.min(1, Number(disc) || 0));
  const credit = Math.max(0, Math.round(Number(prorationCreditMinor) || 0));

  const grossMinor = Math.round(gross * 100);
  const discountedMajor = gross * (1 - d);
  const discountedMinor = Math.round(discountedMajor * 100);
  const discountMinor = grossMinor - discountedMinor;

  // Credit can never push the taxable value below zero. Any excess is returned
  // so the caller can park it as account credit rather than issuing a
  // negative-total invoice.
  const taxableMinor = Math.max(0, discountedMinor - credit);
  const creditAppliedMinor = discountedMinor - taxableMinor;
  const creditCarriedMinor = credit - creditAppliedMinor;

  // See the header: the legacy one-step expression is preserved verbatim for
  // the (overwhelmingly common) no-credit case so live charges cannot move.
  // The additive branch only runs for proration, which has no legacy to
  // preserve. chargeMath.test.js asserts the two agree at credit === 0.
  const totalMinor =
    credit === 0
      ? Math.round(discountedMajor * (1 + rate) * 100)
      : taxableMinor + Math.round(taxableMinor * rate);

  const taxMinor = totalMinor - taxableMinor; // derived, never independently rounded

  const treatment = resolveTaxTreatment({ currency, supplierState, placeOfSupply, taxRate: rate });
  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;
  if (treatment === TAX_TREATMENT.INTRA) {
    // Odd paise lands deterministically on SGST so the two always sum to taxMinor.
    cgstMinor = Math.floor(taxMinor / 2);
    sgstMinor = taxMinor - cgstMinor;
  } else if (treatment === TAX_TREATMENT.INTER) {
    igstMinor = taxMinor;
  }

  return {
    currency,
    qty,
    grossMinor,
    discountMinor,
    discountPct: Math.round(d * 10000) / 100,
    couponCode: couponCode || null,
    prorationCreditMinor: creditAppliedMinor,
    creditCarriedMinor,
    taxableMinor,
    taxRate: rate,
    taxTreatment: treatment,
    cgstMinor,
    sgstMinor,
    igstMinor,
    taxMinor,
    totalMinor,
    placeOfSupply: placeOfSupply || null,
  };
}

/** Minor units → major, for display. */
export function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100;
}
