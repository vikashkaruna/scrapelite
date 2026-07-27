// invoiceDraft.js — the price snapshot taken at order-creation time.
//
// WHY A DRAFT ROW EXISTS AT ALL
// Three problems it solves at once:
//
//  1. Prices are MUTABLE at runtime (pricing_config, 60s cache in
//     pricingSource.js). Without a snapshot taken at the moment of charge, an
//     invoice issued later cannot be reproduced.
//  2. verify-payment (synchronous) and payment-webhook (asynchronous) both need
//     the same numbers, and neither can trust the browser for them.
//  3. verify-payment.js currently reads `planId` straight out of the REQUEST
//     BODY and echoes it back — nothing cross-checks it against the order. The
//     draft is what lets that path stop trusting the client entirely.
//
// Service-key only: invoice_drafts has RLS enabled with no policy.
import { SAC_CODE, getSupplierSnapshot, isGstRegistered } from "./invoiceConfig.js";
import { PLAN_BY_ID, TOPUP_BUNDLES } from "../../../src/lib/pricingConfig.js";

const BUNDLE_BY_ID = Object.fromEntries((TOPUP_BUNDLES || []).map((b) => [b.id, b]));

function periodLabel(billingPeriod) {
  if (billingPeriod === "annual") return "annual, 12 months";
  if (billingPeriod === "once") return "one-time";
  return "monthly";
}

/**
 * Itemise the charge.
 *
 * Discount and proration credit are NEGATIVE lines against the taxable value
 * rather than adjustments after tax — both are known at the time of supply, so
 * GST is charged on the net. (A reduction discovered afterwards would need a
 * credit note instead.)
 */
export function buildInvoiceLines({ charge, planId, isBundle, period, env = process.env }) {
  const sac = isGstRegistered(env) ? SAC_CODE : null;
  const name = isBundle
    ? BUNDLE_BY_ID[planId]?.name || planId
    : PLAN_BY_ID[planId]?.name || planId;

  const lines = [
    {
      kind: isBundle ? "bundle" : "plan",
      description: isBundle
        ? `${name} (x${charge.qty ?? 1})`
        : `${name} plan — ${periodLabel(period)}`,
      hsn_sac: sac,
      qty: charge.qty ?? 1,
      unit_minor: Math.round((charge.grossMinor || 0) / (charge.qty || 1)),
      amount_minor: charge.grossMinor,
    },
  ];

  if (charge.discountMinor > 0) {
    lines.push({
      kind: "discount",
      description: charge.couponCode
        ? `Coupon ${String(charge.couponCode).toUpperCase()} (-${charge.discountPct}%)`
        : `Discount (-${charge.discountPct}%)`,
      hsn_sac: null,
      qty: 1,
      unit_minor: -charge.discountMinor,
      amount_minor: -charge.discountMinor,
    });
  }

  if (charge.prorationCreditMinor > 0) {
    lines.push({
      kind: "proration_credit",
      description: "Unused time on previous plan",
      hsn_sac: null,
      qty: 1,
      unit_minor: -charge.prorationCreditMinor,
      amount_minor: -charge.prorationCreditMinor,
    });
  }

  return lines;
}

function db() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

/**
 * Build the draft row from a computeChargeMinor() result plus order context.
 * Pure — no I/O — so it can be asserted directly in tests.
 */
export function buildDraft({
  orderId,
  provider,
  charge,
  planId,
  kind,
  billingPeriod,
  userId = null,
  sessionId = null,
  email = null,
  periodStart = null,
  periodEnd = null,
  priceSnapshot,
  buyerSnapshot = null,
  lines = [],
  env = process.env,
}) {
  return {
    order_id: orderId,
    provider,
    user_id: userId,
    session_id: sessionId,
    email,
    kind,
    plan_id: planId,
    billing_period: billingPeriod,
    qty: charge.qty ?? 1,
    currency: charge.currency,
    gross_minor: charge.grossMinor,
    discount_minor: charge.discountMinor,
    proration_credit_minor: charge.prorationCreditMinor ?? 0,
    taxable_minor: charge.taxableMinor,
    tax_rate: charge.taxRate,
    tax_treatment: charge.taxTreatment,
    cgst_minor: charge.cgstMinor,
    sgst_minor: charge.sgstMinor,
    igst_minor: charge.igstMinor,
    tax_minor: charge.taxMinor,
    total_minor: charge.totalMinor,
    coupon_code: charge.couponCode,
    discount_pct: charge.discountPct,
    period_start: periodStart,
    period_end: periodEnd,
    place_of_supply: charge.placeOfSupply,
    price_snapshot: priceSnapshot ?? {},
    buyer_snapshot: buyerSnapshot,
    supplier_snapshot: getSupplierSnapshot(env),
    lines,
    status: "pending",
  };
}

/**
 * Persist a draft. Idempotent on order_id.
 *
 * Returns false when Supabase is unconfigured or the write fails; the caller
 * decides what to do with that. For PLAN purchases create-checkout treats a
 * failure as fatal — taking money we cannot invoice is worse than a failed
 * checkout — while bundles proceed, because the webhook can still reconstruct.
 */
export async function saveInvoiceDraft(draft) {
  const d = db();
  if (!d) return false;
  try {
    const res = await fetch(`${d.base}/invoice_drafts`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[invoiceDraft] save failed HTTP ${res.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[invoiceDraft] save threw:", err?.message);
    return false;
  }
}

/** Fetch a draft by provider order id. Null when absent or unavailable. */
export async function getInvoiceDraft(orderId) {
  const d = db();
  if (!d || !orderId) return null;
  try {
    const res = await fetch(
      `${d.base}/invoice_drafts?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
      { headers: d.headers },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

/** Mark a draft as issued and link it to the invoice it produced. */
export async function markDraftIssued(orderId, invoiceId) {
  const d = db();
  if (!d || !orderId) return false;
  try {
    const res = await fetch(
      `${d.base}/invoice_drafts?order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: { ...d.headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "issued", invoice_id: invoiceId }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
