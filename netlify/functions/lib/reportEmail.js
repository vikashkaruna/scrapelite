// reportEmail.js — emails an extraction/batch/discoverability report, with
// the actual file attached. Generalizes netlify/functions/lib/invoiceEmail.js
// (the first — and until now, only — function in this codebase to send a
// real Resend attachment) so extraction and discoverability reports get the
// same real-attachment, real-branding treatment invoices already have,
// instead of emailService.js's old plain-text-only paths.
//
// SENDER: REPORT_EMAIL_FROM, its own env var, per the one-var-per-sender rule
// in CLAUDE.md (CONTACT_EMAIL_FROM / ALERT_EMAIL_FROM / FORM_EMAIL_FROM /
// BILLING_EMAIL_FROM already exist for their own senders — this is not a
// fallback chain onto any of them). Reply-to is hello@datiq.app, same as
// every other outbound sender, so this never becomes a third inbox to watch.
import { buildExtractionsPdf, extractionsPdfFilename } from "../../../src/lib/pdfExport.js";
import { extractionsToCsv, extractionsToMarkdown, extractionsToJson } from "../../../src/lib/utils.js";
import { auditPdfBuffer, auditPdfFilename } from "../../../src/lib/discoverability/auditPdf.js";
import { buildMarkdownReport, brandCsv, toJsonPayload, bundleToCsv } from "../../../src/lib/discoverability/auditReport.js";
import { buildBrandingContext, brandingEmailHtml, brandingEmailText } from "../../../src/lib/exportBranding.js";
import { mailReady, sendMail } from "./mailTransport.js";

const REPLY_TO = "hello@datiq.app";

function b64(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

/**
 * Build the file attachment for one export request.
 *
 * @param {"extraction"|"batch"} kind
 * @param {"pdf"|"csv"|"markdown"|"json"} format
 * @param {object[]} items  the extraction row(s)
 * @param {object} opts  { generatedAt, brandKit }
 */
function buildExtractionAttachment(kind, format, items, opts) {
  if (format === "pdf") {
    const buf = buildExtractionsPdf(items, opts).output("arraybuffer");
    return { filename: extractionsPdfFilename(items), content: Buffer.from(buf).toString("base64") };
  }
  if (format === "csv") {
    return { filename: `datiq-export-${items.length}-pages.csv`, content: b64(extractionsToCsv(items, opts)) };
  }
  if (format === "json") {
    return { filename: `datiq-export-${items.length}-pages.json`, content: b64(extractionsToJson(items, opts)) };
  }
  // markdown, the default
  return { filename: `datiq-export-${items.length}-pages.md`, content: b64(extractionsToMarkdown(items, opts)) };
}

/**
 * Build the file attachment for a discoverability audit.
 *
 * @param {"pdf"|"csv"|"markdown"|"json"} format
 * @param {object} audit  the rehydrated audit
 * @param {object} opts  { generatedAt, brandKit }
 */
function buildAuditAttachment(format, audit, opts) {
  if (format === "pdf") {
    const buf = auditPdfBuffer(audit, { ...opts, includeConstructs: true });
    return { filename: auditPdfFilename(audit), content: Buffer.from(buf).toString("base64") };
  }
  if (format === "csv") {
    return { filename: "discoverability-report.csv", content: b64(brandCsv(bundleToCsv(audit), audit, opts)) };
  }
  if (format === "json") {
    return { filename: "discoverability-report.json", content: b64(JSON.stringify(toJsonPayload(audit, opts), null, 2)) };
  }
  return { filename: "discoverability-report.md", content: b64(buildMarkdownReport(audit, { ...opts, includeConstructs: true })) };
}

/**
 * Send a report email with the requested export attached.
 *
 * Never throws — a mail failure must not surface as an export failure; the
 * file itself was already generated and (if this is called from the "email
 * this export" action) can still be downloaded directly.
 *
 * @param {object} params
 * @param {"extraction"|"batch"|"discoverability"} params.kind
 * @param {string} params.recipient  ALWAYS server-resolved by the caller from
 *   the verified session — never accept this from the request body.
 * @param {"pdf"|"csv"|"markdown"|"json"} [params.format]
 * @param {object[]} [params.items]  extraction rows (kind extraction/batch)
 * @param {object} [params.audit]  rehydrated audit (kind discoverability)
 * @param {string} [params.generatedAt]  ISO timestamp; defaults to now
 * @param {object|null} [params.brandKit]
 * @param {string} [params.ctaUrl]
 */
export async function sendReportEmail({
  kind, recipient, format = "pdf", items = null, audit = null, generatedAt = null, brandKit = null, ctaUrl = null,
} = {}) {
  if (!mailReady()) {
    console.warn("[reportEmail] skipped — no mail transport configured");
    return { sent: false, reason: "no_key" };
  }
  if (!recipient) {
    console.warn("[reportEmail] skipped — no recipient");
    return { sent: false, reason: "no_recipient" };
  }

  const genAt = generatedAt || new Date().toISOString();
  const opts = { generatedAt: genAt, brandKit };
  const from = process.env.REPORT_EMAIL_FROM || "DatIQ Reports <reports@datiq.app>";

  try {
    let attachment, sourceUrls, heading, bodyHtml, bodyText, brandingKind;
    if (kind === "discoverability") {
      if (!audit) return { sent: false, reason: "no_data" };
      attachment = buildAuditAttachment(format, audit, opts);
      sourceUrls = audit?.target?.url || audit?.url || null;
      heading = "Your discoverability report is ready";
      bodyText = `Overall score: ${audit?.finalScore ?? "not measured"}.`;
      bodyHtml = `<p style="margin:0 0 4px;font-size:13px;color:#6e7484"><strong>Overall score:</strong> ${audit?.finalScore ?? "not measured"}</p>`;
      brandingKind = "discoverability";
    } else {
      if (!items || !items.length) return { sent: false, reason: "no_data" };
      attachment = buildExtractionAttachment(kind, format, items, opts);
      sourceUrls = items.map((e) => e.url).filter(Boolean);
      heading = items.length > 1 ? "Your batch extraction report is ready" : "Your extraction report is ready";
      const firstSummary = items.find((e) => e.ai_summary)?.ai_summary;
      bodyText = firstSummary || "";
      bodyHtml = firstSummary
        ? `<p style="margin:0 0 4px;font-size:13px;color:#20222c">${firstSummary.slice(0, 280)}${firstSummary.length > 280 ? "…" : ""}</p>`
        : "";
      brandingKind = items.length > 1 ? "batch" : "extraction";
    }

    const ctx = buildBrandingContext({ kind: brandingKind, sourceUrls, generatedAt: genAt, brandKit });

    const r = await sendMail({
      from,
      to: [recipient],
      reply_to: REPLY_TO,
      subject: `${heading} — ${ctx.brand}`,
      html: brandingEmailHtml(ctx, { heading, bodyHtml, attachmentLabel: attachment.filename, ctaUrl }),
      text: brandingEmailText(ctx, { heading, bodyText, attachmentLabel: attachment.filename }),
      attachments: [attachment],
      tags: [{ name: "stream", value: "reports" }],
    });

    if (!r.ok) {
      console.error(`[reportEmail] Resend HTTP ${r.status} for kind=${kind}`);
      return { sent: false, reason: "resend_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[reportEmail] threw:", err?.message);
    return { sent: false, reason: "exception" };
  }
}
