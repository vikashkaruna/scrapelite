// invoiceService.js — issues exactly one invoice per captured payment.
//
// ── THE RACE THIS EXISTS TO SURVIVE ──────────────────────────────────────────
// Two independent paths learn about the same payment:
//   1. verify-payment.js  — synchronous, right after the Razorpay modal closes
//   2. payment-webhook.js — asynchronous `payment.captured`, possibly first,
//                           possibly while (1) is still running, and possibly
//                           again on a provider retry
//
// Both call finalizeInvoice(). Exactly one invoice, one number and one email
// must result. The dedup is a DATABASE CONSTRAINT plus an RPC that catches
// unique_violation — deliberately NOT the read-then-write check used by
// payment-webhook.js's insertPaymentEvent, which has a window between the SELECT
// and the INSERT and cannot hold under genuine concurrency.
//
// `created` from issue_invoice is the only thing that authorises side effects
// (PDF render, email). Everything downstream must branch on it.
import { getInvoiceDraft, markDraftIssued } from "./invoiceDraft.js";
import { DOC_TYPE, SERIES, getSupplierSnapshot, resolveDocType } from "./invoiceConfig.js";
import { computeChargeMinor, grossMajor } from "../../../src/lib/chargeMath.js";
import { loadPricing } from "./pricingSource.js";
import { buildInvoiceLines } from "./invoiceDraft.js";

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

/** Add one billing period to a date. */
export function addPeriod(from, billingPeriod) {
  const d = new Date(from);
  if (billingPeriod === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (billingPeriod === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else return null; // one-time purchases carry no period
  return d.toISOString();
}

/**
 * Rebuild a draft from the provider's own order when none was persisted.
 *
 * This is the recovery path for "Supabase was down at checkout" (see the
 * fail-open decision in create-checkout.js) and for any order created before
 * this feature shipped. The resulting invoice is flagged `reconstructed` so it
 * can be reviewed — the price table may have moved since the charge.
 */
export function reconstructDraft({ order, provider, pricing, env = process.env }) {
  const notes = order?.notes || {};
  const planId = notes.planId || "unknown";
  const currency = order?.currency || "INR";
  const billingPeriod = notes.billingPeriod || "monthly";
  const isBundle = Boolean(pricing?.bundles?.[planId]);
  const priceRow = isBundle ? pricing.bundles[planId] : pricing?.plans?.[planId];

  // Derive the decomposition from the amount ACTUALLY charged, working
  // backwards, rather than from today's price table — the total is ground truth.
  const totalMinor = Number(order?.amount) || 0;
  const rate = currency === "INR" ? 0.18 : 0;
  const taxableMinor = Math.round(totalMinor / (1 + rate));
  const taxMinor = totalMinor - taxableMinor;
  const cgstMinor = rate ? Math.floor(taxMinor / 2) : 0;
  const sgstMinor = rate ? taxMinor - cgstMinor : 0;

  return {
    order_id: order?.id,
    provider,
    session_id: notes.sessionId || null,
    email: notes.email || null,
    kind: isBundle ? "bundle" : "plan",
    plan_id: planId,
    billing_period: billingPeriod,
    qty: 1,
    currency,
    gross_minor: taxableMinor,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: taxableMinor,
    tax_rate: rate,
    tax_treatment: rate ? "intra" : "none",
    cgst_minor: cgstMinor,
    sgst_minor: sgstMinor,
    igst_minor: 0,
    tax_minor: taxMinor,
    total_minor: totalMinor,
    coupon_code: null,
    discount_pct: 0,
    place_of_supply: null,
    price_snapshot: priceRow ?? {},
    buyer_snapshot: null,
    supplier_snapshot: getSupplierSnapshot(env),
    lines: [
      {
        kind: isBundle ? "bundle" : "plan",
        description: `${planId} — ${billingPeriod}`,
        hsn_sac: null,
        qty: 1,
        unit_minor: taxableMinor,
        amount_minor: taxableMinor,
      },
    ],
    reconstructed: true,
  };
}

/** Map a draft row onto the issue_invoice payload. */
export function draftToInvoicePayload(draft, { paymentId, provider, env = process.env }) {
  const docType = resolveDocType({ currency: draft.currency, env });
  const periodStart = draft.period_start || new Date().toISOString();
  const periodEnd =
    draft.period_end ||
    (draft.kind === "bundle" ? null : addPeriod(periodStart, draft.billing_period));

  return {
    series: SERIES.INVOICE,
    doc_type: docType,
    user_id: draft.user_id || null,
    session_id: draft.session_id || null,
    email: draft.email || null,
    plan_id: draft.plan_id,
    billing_period: draft.billing_period,
    qty: draft.qty ?? 1,
    period_start: periodStart,
    period_end: periodEnd,
    currency: draft.currency,
    gross_minor: draft.gross_minor,
    discount_minor: draft.discount_minor,
    proration_credit_minor: draft.proration_credit_minor,
    taxable_minor: draft.taxable_minor,
    tax_rate: draft.tax_rate,
    tax_treatment: draft.tax_treatment,
    cgst_minor: draft.cgst_minor,
    sgst_minor: draft.sgst_minor,
    igst_minor: draft.igst_minor,
    tax_minor: draft.tax_minor,
    total_minor: draft.total_minor,
    coupon_code: draft.coupon_code,
    place_of_supply: draft.place_of_supply,
    supplier_snapshot: draft.supplier_snapshot,
    buyer_snapshot: draft.buyer_snapshot,
    provider,
    provider_payment_id: paymentId,
    provider_order_id: draft.order_id,
    status: "paid",
    reconstructed: Boolean(draft.reconstructed),
    lines: draft.lines || [],
  };
}

/**
 * Issue (or find) the invoice for a captured payment.
 *
 * @returns {Promise<{invoice: object|null, created: boolean, reason?: string}>}
 *   created === true means THIS call issued it and owns the side effects.
 */
export async function finalizeInvoice({ orderId, paymentId, provider = "razorpay", order = null }) {
  const d = db();
  if (!d) return { invoice: null, created: false, reason: "supabase_unconfigured" };

  let draft = await getInvoiceDraft(orderId);
  if (!draft) {
    if (!order) return { invoice: null, created: false, reason: "no_draft" };
    const pricing = await loadPricing().catch(() => ({ plans: {}, bundles: {} }));
    draft = reconstructDraft({ order, provider, pricing });
    console.warn(`[invoiceService] reconstructing invoice for order ${orderId} — no draft found`);
  }

  const payload = draftToInvoicePayload(draft, { paymentId, provider });

  try {
    const res = await fetch(`${d.base}/rpc/issue_invoice`, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify({ p: payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[invoiceService] issue_invoice HTTP ${res.status}: ${text}`);
      return { invoice: null, created: false, reason: "rpc_error" };
    }
    const out = await res.json();
    const invoice = out?.invoice ?? null;
    const created = Boolean(out?.created);
    if (created && invoice?.id) {
      await markDraftIssued(orderId, invoice.id);
    }
    return { invoice, created };
  } catch (err) {
    console.error("[invoiceService] issue_invoice threw:", err?.message);
    return { invoice: null, created: false, reason: "exception" };
  }
}

/**
 * Grant entitlements from an ISSUED INVOICE — never from the client, and never
 * from the pre-existing entitlement row.
 *
 * The invoice is the only artifact that records what was actually paid for, so
 * it is the only safe source for what to activate. This is what makes
 * "whatever the user paid for, and only that, gets activated" true.
 *
 * period_start = max(now, previous period_end) gives both correct commercial
 * answers at once:
 *   • renew early  → the remaining days you already paid for are preserved
 *   • renew late   → you are not credited for the days you were suspended
 *
 * Bundles never touch plan_id or the period; they only add bonus allowances.
 */
export function nextPeriodFromInvoice(invoice, previous, now = new Date()) {
  const nowMs = now.getTime();
  const prevEnd = previous?.period_end ? Date.parse(previous.period_end) : 0;
  const startMs = Math.max(nowMs, Number.isFinite(prevEnd) ? prevEnd : 0);
  const periodStart = new Date(startMs).toISOString();
  return {
    period_start: periodStart,
    period_end: addPeriod(periodStart, invoice.billing_period),
  };
}

export async function activateFromInvoice(invoice, { now = new Date() } = {}) {
  const d = db();
  if (!d || !invoice) return false;
  const userId = invoice.user_id;
  if (!userId) return false; // guest purchase — activated on claim instead

  try {
    const res = await fetch(
      `${d.base}/entitlements?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: d.headers },
    );
    const rows = res.ok ? await res.json() : [];
    const previous = Array.isArray(rows) && rows[0] ? rows[0] : null;

    const isBundle = !invoice.billing_period || invoice.billing_period === "once";
    const patch = isBundle
      ? {
          user_id: userId,
          // Bundles top up allowances only; the plan and its period are untouched.
          bonus_extractions: previous?.bonus_extractions ?? 0,
          bonus_batch_urls: previous?.bonus_batch_urls ?? 0,
          version: (previous?.version ?? 0) + 1,
          updated_at: new Date().toISOString(),
        }
      : {
          user_id: userId,
          plan_id: invoice.plan_id,
          billing_period: invoice.billing_period,
          ...nextPeriodFromInvoice(invoice, previous, now),
          status: "active",
          source: "payment",
          // Clear every lifecycle marker so a reactivated account is genuinely
          // clean and cannot be re-suspended by stale timestamps.
          suspended_at: null,
          deactivated_at: null,
          purge_after: null,
          last_notice_kind: null,
          scheduled_plan_id: null,
          scheduled_at: null,
          version: (previous?.version ?? 0) + 1,
          updated_at: new Date().toISOString(),
        };

    const up = await fetch(`${d.base}/entitlements`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(patch),
    });

    // Requirement 10: whatever the payment bought comes back on immediately,
    // with no action from the user. Automation that the lifecycle paused for a
    // lapse is un-paused here rather than at the next daily sweep — a customer
    // who has just paid should not watch their monitors stay dead until
    // tomorrow.
    //
    // Scoped by system_pause_reason so it resumes ONLY what the platform
    // paused. A schedule the user paused themselves carries status='paused'
    // and is deliberately left alone (requirement 11: reactivate what they
    // actually had, not more).
    if (!isBundle) {
      try {
        await fetch(
          `${d.base}/scheduled_tasks?user_id=eq.${encodeURIComponent(userId)}` +
            `&system_pause_reason=eq.subscription_suspended`,
          {
            method: "PATCH",
            headers: { ...d.headers, Prefer: "return=minimal" },
            body: JSON.stringify({ system_paused: false, system_pause_reason: null }),
          },
        );
      } catch (err) {
        // The entitlement is already restored; a failed resume is recoverable
        // by the daily sweep and must not fail the payment.
        console.warn("[invoiceService] schedule resume failed:", err?.message);
      }
    }

    return up.ok;
  } catch (err) {
    console.error("[invoiceService] activateFromInvoice:", err?.message);
    return false;
  }
}

/** Record that an invoice email was sent. Returns false if already sent. */
export async function claimInvoiceEmail(invoiceId, kind = "issued") {
  const d = db();
  if (!d || !invoiceId) return false;
  try {
    const res = await fetch(`${d.base}/invoice_emails`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ invoice_id: invoiceId, kind }),
    });
    if (!res.ok) return false;
    const rows = await res.json().catch(() => []);
    // Empty array back → the row already existed → somebody else owns this send.
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export { DOC_TYPE, SERIES };
