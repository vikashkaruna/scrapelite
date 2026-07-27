// invoiceEmail.js — emails the invoice, with the PDF attached.
//
// SENDER: BILLING_EMAIL_FROM, its own env var, per the one-var-per-sender rule
// in CLAUDE.md. `billing@datiq.app` is SEND-ONLY and replies are directed to
// hello@datiq.app, so this does not create a third inbox anyone has to monitor
// and the two-inbox policy still holds.
//
// Note: no other function in this codebase has ever sent a Resend attachment.
// The shape is `attachments: [{ filename, content }]` with base64 content.
import { buildInvoiceDoc } from "../../../src/lib/invoiceModel.js";
import { invoiceFilename, invoicePdfBuffer } from "../../../src/lib/invoicePdf.js";
import { claimInvoiceEmail } from "./invoiceService.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REPLY_TO = "hello@datiq.app";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function db() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

export async function fetchInvoiceLines(invoiceId) {
  const d = db();
  if (!d || !invoiceId) return [];
  try {
    const res = await fetch(
      `${d.base}/invoice_lines?invoice_id=eq.${encodeURIComponent(invoiceId)}&select=*&order=line_no.asc`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    return (await res.json()) || [];
  } catch {
    return [];
  }
}

/** HTML body. Mirrors the house style: 560px, brand header, bordered body. */
export function invoiceEmailHtml(model, { downloadUrl } = {}) {
  const rows = model.totals
    .map(
      (t) => `<tr>
        <td style="padding:6px 0;color:${t.emphasis ? "#20222c" : "#6e7484"};font-size:${t.emphasis ? "15px" : "13px"};font-weight:${t.emphasis ? 700 : 400}">${escapeHtml(t.label)}</td>
        <td align="right" style="padding:6px 0;color:#20222c;font-size:${t.emphasis ? "15px" : "13px"};font-weight:${t.emphasis ? 700 : 400}">${escapeHtml(t.value)}</td>
      </tr>`,
    )
    .join("");

  const items = model.lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 0;color:#20222c;font-size:13px">${escapeHtml(l.description)}</td>
        <td align="right" style="padding:6px 0;color:${l.isCredit ? "#6e7484" : "#20222c"};font-size:13px">${escapeHtml(l.amountText)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#4f46e5;border-radius:12px 12px 0 0;padding:20px 24px">
      <div style="color:#fff;font-size:18px;font-weight:700">DatIQ</div>
      <div style="color:#c7d2fe;font-size:12px">Intelligence from every URL</div>
    </div>
    <div style="background:#fff;border:1px solid #e1e3e9;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <h1 style="margin:0 0 4px;font-size:17px;color:#20222c">${escapeHtml(model.title)} ${escapeHtml(model.invoiceNo)}</h1>
      <p style="margin:0 0 18px;font-size:13px;color:#6e7484">
        Thanks for your payment. Your ${escapeHtml(model.title.toLowerCase())} is attached as a PDF.
      </p>
      <table width="100%" style="border-collapse:collapse;margin-bottom:8px">${items}</table>
      <div style="border-top:1px solid #e1e3e9;margin:8px 0"></div>
      <table width="100%" style="border-collapse:collapse">${rows}</table>
      ${
        downloadUrl
          ? `<div style="margin-top:20px"><a href="${escapeHtml(downloadUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">View in DatIQ</a></div>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:11px;color:#9aa0af;line-height:1.6">
        ${model.notes.map((n) => escapeHtml(n)).join("<br>")}
      </p>
    </div>
    <p style="text-align:center;color:#9aa0af;font-size:11px;margin-top:16px">
      Questions? Just reply to this email.
    </p>
  </div></body></html>`;
}

export function invoiceEmailText(model) {
  return [
    `${model.title} ${model.invoiceNo}`,
    "",
    ...model.lines.map((l) => `${l.description}  ${l.amountText}`),
    "",
    ...model.totals.map((t) => `${t.label}: ${t.value}`),
    "",
    ...model.notes,
  ].join("\n");
}

/**
 * Send the invoice email.
 *
 * Idempotent: claimInvoiceEmail() takes the (invoice_id, kind) row FIRST and
 * returns false if another container already owns this send, so a webhook retry
 * or a verify/webhook race cannot email the customer twice.
 *
 * Never throws. A mail failure must not surface as a payment failure — the
 * invoice exists and is downloadable regardless.
 */
export async function sendInvoiceEmail(invoice, { kind = "issued" } = {}) {
  const key = process.env.RESEND_API_KEY;
  const to = invoice?.email;
  if (!key) {
    console.warn("[invoiceEmail] skipped — no RESEND_API_KEY");
    return { sent: false, reason: "no_key" };
  }
  if (!to) {
    console.warn(`[invoiceEmail] skipped — invoice ${invoice?.invoice_no} has no email`);
    return { sent: false, reason: "no_recipient" };
  }

  const owned = await claimInvoiceEmail(invoice.id, kind);
  if (!owned) return { sent: false, reason: "already_sent" };

  const from = process.env.BILLING_EMAIL_FROM || "DatIQ Billing <billing@datiq.app>";
  const siteUrl = process.env.URL || process.env.SITE_URL || "https://datiq.app";

  try {
    const lines = await fetchInvoiceLines(invoice.id);
    const model = buildInvoiceDoc(invoice, lines);
    const bytes = Buffer.from(invoicePdfBuffer(invoice, lines));

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: REPLY_TO,
        subject: `${model.title} ${model.invoiceNo} — DatIQ`,
        // Links to /account, where the invoice list lives. There is deliberately
        // no /account/invoices/:id route — the list and viewer are a section +
        // modal on the Account page — so linking there would 404 the customer.
        html: invoiceEmailHtml(model, { downloadUrl: `${siteUrl}/account` }),
        text: invoiceEmailText(model),
        attachments: [{ filename: invoiceFilename(invoice.invoice_no), content: bytes.toString("base64") }],
        tags: [{ name: "stream", value: "billing" }],
      }),
    });

    if (!res.ok) {
      // Deliberately do NOT echo the response body — it can contain the key.
      console.error(`[invoiceEmail] Resend HTTP ${res.status} for ${invoice.invoice_no}`);
      return { sent: false, reason: "resend_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[invoiceEmail] threw:", err?.message);
    return { sent: false, reason: "exception" };
  }
}
