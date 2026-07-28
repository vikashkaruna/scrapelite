// admin-billing.js — operator control over billing.
//
// GET  ?action=invoices&q=          search invoices
// GET  ?action=account&userId=      one account's entitlement + invoices
// POST { action: 'suspend'|'reactivate'|'comp'|'offline_payment'|'resend_invoice'|'refund', ... }
//
// EVERY MUTATION REQUIRES A REASON AND IS AUDITED. These actions move money,
// restore paid access without payment, and issue legally-numbered documents, so
// "who did this and why" must survive the person who did it. `reason` is
// NOT NULL in billing_audit_log and validated here rather than defaulted —
// a blank reason is a rejected request, not an empty string in the log.
//
// Gated by the existing admin session token (lib/adminToken.js), the same
// HMAC scheme as admin-users / admin-revenue.
import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import { computeLifecycle } from "../../src/lib/entitlementModel.js";
import { SERIES, getSupplierSnapshot, resolveDocType } from "./lib/invoiceConfig.js";
import { sendInvoiceEmail } from "./lib/invoiceEmail.js";
import { PLAN_BY_ID } from "../../src/lib/pricingConfig.js";
import { computeChargeMinor, grossMajor } from "../../src/lib/chargeMath.js";
import { addPeriod } from "./lib/invoiceService.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    body: JSON.stringify(body),
  };
}

function db() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function req(path, method = "GET", body, extra = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers, ...extra },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    base,
    headers,
    req,
    async rows(path) {
      const res = await req(path);
      return (await res.json().catch(() => [])) || [];
    },
    async audit(entry) {
      return req("/billing_audit_log", "POST", entry, { Prefer: "return=minimal" });
    },
    async patchEntitlement(userId, patch) {
      return req(`/entitlements?user_id=eq.${encodeURIComponent(userId)}`, "PATCH", patch, {
        Prefer: "return=minimal",
      });
    },
    async upsertEntitlement(row) {
      return req("/entitlements", "POST", row, {
        Prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
  };
}

/** Bump `version` so every client cache invalidates on the next read. */
function bump(current) {
  return { version: (current ?? 0) + 1, updated_at: new Date().toISOString() };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const auth = verifyAdminToken(bearerFromEvent(event));
  if (!auth.ok) return json(401, { error: "Admin authentication required", reason: auth.reason });
  const actor = auth.demo ? "admin:demo" : "admin";

  const d = db();
  if (!d) return json(503, { error: "Supabase not configured" });

  try {
    // ── Reads ────────────────────────────────────────────────────────────────
    if (event.httpMethod === "GET") {
      const p = event.queryStringParameters || {};

      if (p.action === "invoices") {
        const q = (p.q || "").trim();
        let path = "/invoices?select=*&order=issued_at.desc&limit=100";
        if (q) {
          // Match invoice number, email, or provider payment/order id.
          const enc = encodeURIComponent(`*${q}*`);
          path =
            `/invoices?select=*&order=issued_at.desc&limit=100` +
            `&or=(invoice_no.ilike.${enc},email.ilike.${enc},` +
            `provider_payment_id.ilike.${enc},provider_order_id.ilike.${enc})`;
        }
        return json(200, { invoices: await d.rows(path) });
      }

      if (p.action === "account") {
        if (!p.userId) return json(400, { error: "userId required" });
        const uid = encodeURIComponent(p.userId);
        const [ent] = await d.rows(`/entitlements?user_id=eq.${uid}&select=*&limit=1`);
        const invoices = await d.rows(
          `/invoices?user_id=eq.${uid}&select=*&order=issued_at.desc&limit=50`,
        );
        const notices = await d.rows(
          `/billing_notice_log?user_id=eq.${uid}&select=*&order=sent_at.desc&limit=20`,
        );
        return json(200, {
          entitlement: ent ?? null,
          lifecycle: ent ? computeLifecycle(ent) : null,
          invoices,
          notices,
        });
      }

      if (p.action === "audit") {
        return json(200, {
          entries: await d.rows("/billing_audit_log?select=*&order=created_at.desc&limit=100"),
        });
      }

      return json(400, { error: "Unknown action" });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const { action, userId, reason } = body;

    // A reason is mandatory on every mutation — see the header.
    if (!reason || !String(reason).trim()) {
      return json(400, { error: "A reason is required for every billing override.", code: "REASON_REQUIRED" });
    }

    const uid = userId ? encodeURIComponent(userId) : null;
    const [current] = uid ? await d.rows(`/entitlements?user_id=eq.${uid}&select=*&limit=1`) : [];

    switch (action) {
      // ── Force-suspend ─────────────────────────────────────────────────────
      case "suspend": {
        if (!userId) return json(400, { error: "userId required" });
        await d.patchEntitlement(userId, {
          status: "suspended",
          suspended_at: new Date().toISOString(),
          ...bump(current?.version),
        });
        // Automation stops with the account.
        await d.req(
          `/scheduled_tasks?user_id=eq.${uid}&system_paused=is.false`,
          "PATCH",
          { system_paused: true, system_pause_reason: "subscription_suspended" },
          { Prefer: "return=minimal" },
        );
        await d.audit({ actor, action: "suspend", user_id: userId, reason });
        return json(200, { ok: true });
      }

      // ── Restore access without a payment ──────────────────────────────────
      case "reactivate": {
        if (!userId) return json(400, { error: "userId required" });
        // Clear every lifecycle marker, or stale timestamps would re-suspend
        // the account on the next sweep.
        await d.patchEntitlement(userId, {
          status: "active",
          suspended_at: null,
          deactivated_at: null,
          purge_after: null,
          last_notice_kind: null,
          ...bump(current?.version),
        });
        await d.req(
          `/scheduled_tasks?user_id=eq.${uid}&system_pause_reason=eq.subscription_suspended`,
          "PATCH",
          { system_paused: false, system_pause_reason: null },
          { Prefer: "return=minimal" },
        );
        await d.audit({ actor, action: "reactivate", user_id: userId, reason });
        return json(200, { ok: true });
      }

      // ── Goodwill / incident credit: free time, no charge ──────────────────
      case "comp": {
        if (!userId) return json(400, { error: "userId required" });
        // Validate the RAW input before clamping. Clamping first would turn a
        // mistaken `days: 0` (or a typo'd string) into a silent 1-day comp,
        // hiding the caller's error instead of reporting it.
        const rawDays = parseInt(body.days, 10);
        if (!Number.isFinite(rawDays) || rawDays < 1 || rawDays > 365) {
          return json(400, { error: "days must be a whole number between 1 and 365", code: "INVALID_DAYS" });
        }
        const days = rawDays;
        const from = current?.comp_until && Date.parse(current.comp_until) > Date.now()
          ? Date.parse(current.comp_until)
          : Date.now();
        const compUntil = new Date(from + days * 86400_000).toISOString();
        await d.patchEntitlement(userId, {
          comp_until: compUntil,
          // A comp implies the account should be usable right now.
          status: "active",
          last_notice_kind: null,
          ...bump(current?.version),
        });
        await d.req(
          `/scheduled_tasks?user_id=eq.${uid}&system_pause_reason=eq.subscription_suspended`,
          "PATCH",
          { system_paused: false, system_pause_reason: null },
          { Prefer: "return=minimal" },
        );
        await d.audit({
          actor, action: "comp", user_id: userId, reason,
          detail: { days, comp_until: compUntil },
        });
        return json(200, { ok: true, comp_until: compUntil });
      }

      // ── Money received outside the gateway ────────────────────────────────
      // Bank transfer, UPI paid off-platform, an Enterprise deal closed over
      // email. Issues a REAL numbered invoice through the same RPC as an online
      // payment, so the series stays gapless and the document is
      // indistinguishable from any other.
      case "offline_payment": {
        if (!userId) return json(400, { error: "userId required" });
        const planId = body.planId;
        const plan = PLAN_BY_ID[planId];
        if (!plan) return json(400, { error: `Unknown plan '${planId}'`, code: "UNKNOWN_PLAN" });

        const currency = body.currency === "USD" ? "USD" : "INR";
        const billingPeriod = body.billingPeriod === "annual" ? "annual" : "monthly";
        const gross = grossMajor({ prices: plan, billingPeriod, currency });
        const charge = computeChargeMinor({
          gross,
          currency,
          supplierState: process.env.SUPPLIER_STATE || "",
          placeOfSupply: body.placeOfSupply || "",
        });

        const periodStart = new Date().toISOString();
        const payload = {
          series: SERIES.INVOICE,
          doc_type: resolveDocType({ currency }),
          user_id: userId,
          email: body.email || null,
          plan_id: planId,
          billing_period: billingPeriod,
          qty: 1,
          period_start: periodStart,
          period_end: addPeriod(periodStart, billingPeriod),
          currency,
          gross_minor: charge.grossMinor,
          discount_minor: charge.discountMinor,
          proration_credit_minor: 0,
          taxable_minor: charge.taxableMinor,
          tax_rate: charge.taxRate,
          tax_treatment: charge.taxTreatment,
          cgst_minor: charge.cgstMinor,
          sgst_minor: charge.sgstMinor,
          igst_minor: charge.igstMinor,
          tax_minor: charge.taxMinor,
          total_minor: charge.totalMinor,
          place_of_supply: charge.placeOfSupply,
          supplier_snapshot: getSupplierSnapshot(),
          buyer_snapshot: body.buyer || null,
          provider: "offline",
          // The operator's own reference (bank ref, UPI id) is the idempotency
          // key, so re-submitting the same reference cannot double-invoice.
          provider_payment_id: body.reference ? `offline:${body.reference}` : null,
          status: "paid",
          lines: [
            {
              kind: "plan",
              description: `${plan.name} plan — ${billingPeriod}`,
              hsn_sac: null,
              qty: 1,
              unit_minor: charge.grossMinor,
              amount_minor: charge.grossMinor,
            },
          ],
        };

        const res = await d.req("/rpc/issue_invoice", "POST", { p: payload });
        const out = await res.json().catch(() => null);
        const invoice = out?.invoice ?? null;
        if (!invoice) return json(502, { error: "Could not issue the invoice." });

        await d.upsertEntitlement({
          user_id: userId,
          plan_id: planId,
          billing_period: billingPeriod,
          period_start: periodStart,
          period_end: payload.period_end,
          status: "active",
          source: "payment",
          suspended_at: null,
          deactivated_at: null,
          purge_after: null,
          last_notice_kind: null,
          ...bump(current?.version),
        });

        if (out?.created && body.email) await sendInvoiceEmail({ ...invoice, email: body.email });

        await d.audit({
          actor, action: "offline_payment", user_id: userId, invoice_id: invoice.id, reason,
          detail: { planId, billingPeriod, currency, total_minor: charge.totalMinor, reference: body.reference || null },
        });
        return json(200, { ok: true, invoice });
      }

      // ── Support: send the customer their invoice again ────────────────────
      case "resend_invoice": {
        const invoiceId = body.invoiceId;
        if (!invoiceId) return json(400, { error: "invoiceId required" });
        const [invoice] = await d.rows(
          `/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=*&limit=1`,
        );
        if (!invoice) return json(404, { error: "Invoice not found" });
        const result = await sendInvoiceEmail(
          { ...invoice, email: body.email || invoice.email },
          { kind: `resend:${Date.now()}` },
        );
        await d.audit({
          actor, action: "invoice_resend", user_id: invoice.user_id, invoice_id: invoice.id, reason,
          detail: { sent: result.sent, to: body.email || invoice.email },
        });
        return result.sent ? json(200, { ok: true }) : json(502, { error: "Could not send." });
      }

      // ── Refund → credit note ──────────────────────────────────────────────
      case "refund": {
        const invoiceId = body.invoiceId;
        if (!invoiceId) return json(400, { error: "invoiceId required" });
        const [invoice] = await d.rows(
          `/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=*&limit=1`,
        );
        if (!invoice) return json(404, { error: "Invoice not found" });

        // Default to a full refund; a partial must be explicit.
        const amount = body.amountMinor == null
          ? invoice.total_minor
          : Math.max(0, Math.min(invoice.total_minor, Math.round(Number(body.amountMinor))));
        if (!amount) return json(400, { error: "Refund amount must be greater than zero." });

        const alreadyRefunded = Number(invoice.refunded_minor) || 0;
        if (alreadyRefunded + amount > invoice.total_minor) {
          return json(400, { error: "Refund would exceed the invoice total.", code: "OVER_REFUND" });
        }

        // Reverse the tax IN THE SAME PROPORTION as the refund, so a partial
        // credit note does not over- or under-reverse output tax.
        const frac = amount / invoice.total_minor;
        const part = (v) => Math.round((Number(v) || 0) * frac);

        const creditPayload = {
          series: SERIES.CREDIT_NOTE,
          doc_type: "credit_note",
          user_id: invoice.user_id,
          session_id: invoice.session_id,
          email: invoice.email,
          plan_id: invoice.plan_id,
          billing_period: invoice.billing_period,
          qty: invoice.qty,
          currency: invoice.currency,
          gross_minor: part(invoice.gross_minor),
          discount_minor: 0,
          proration_credit_minor: 0,
          taxable_minor: part(invoice.taxable_minor),
          tax_rate: invoice.tax_rate,
          tax_treatment: invoice.tax_treatment,
          cgst_minor: part(invoice.cgst_minor),
          sgst_minor: part(invoice.sgst_minor),
          igst_minor: part(invoice.igst_minor),
          tax_minor: part(invoice.tax_minor),
          total_minor: amount,
          place_of_supply: invoice.place_of_supply,
          supplier_snapshot: invoice.supplier_snapshot,
          buyer_snapshot: invoice.buyer_snapshot,
          provider: invoice.provider,
          provider_payment_id: `refund:${invoice.provider_payment_id || invoice.id}:${alreadyRefunded + amount}`,
          provider_order_id: invoice.provider_order_id,
          status: "paid",
          credit_note_of: invoice.id,
          lines: [
            {
              kind: "plan",
              description: `Refund against ${invoice.invoice_no}`,
              hsn_sac: null,
              qty: 1,
              unit_minor: part(invoice.taxable_minor),
              amount_minor: part(invoice.taxable_minor),
            },
          ],
        };

        const res = await d.req("/rpc/issue_invoice", "POST", { p: creditPayload });
        const out = await res.json().catch(() => null);
        const creditNote = out?.invoice ?? null;
        if (!creditNote) return json(502, { error: "Could not issue the credit note." });

        // The original invoice is IMMUTABLE except for these two fields — the
        // DB trigger enforces that, so this cannot silently rewrite history.
        const totalRefunded = alreadyRefunded + amount;
        await d.req(`/invoices?id=eq.${encodeURIComponent(invoice.id)}`, "PATCH", {
          refunded_minor: totalRefunded,
          status: totalRefunded >= invoice.total_minor ? "refunded" : "partially_refunded",
        }, { Prefer: "return=minimal" });

        await d.audit({
          actor, action: "refund", user_id: invoice.user_id, invoice_id: invoice.id, reason,
          detail: { amount_minor: amount, credit_note: creditNote.invoice_no },
        });
        return json(200, { ok: true, creditNote });
      }

      default:
        return json(400, { error: `Unknown action '${action}'` });
    }
  } catch (err) {
    console.error("[admin-billing]", err?.message);
    return json(500, { error: "Billing operation failed." });
  }
};
