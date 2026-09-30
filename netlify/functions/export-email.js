// netlify/functions/export-email.js — POST /api/export-email
//
// Emails one or more saved extractions as a real file attachment (CSV / PDF /
// Markdown / JSON), via Resend, styled like the invoice emails.
//
// Replaces the old client-side flow in src/lib/emailService.js, which handed
// off to a webhook or a mailto: draft — no server, no attachment, no
// branding, and no plan enforcement (the client-side checkCanEmail() gate
// was the only check, and it is trivially bypassed by calling the API
// directly). This endpoint re-checks BOTH `export.email` and `export.<fmt>`
// server-side, mirroring the exact capability names entitlementModel.js
// already uses for downloads, so emailing a format can never be more
// permissive than downloading it.
//
// Auth: signed-in only, unconditionally (unlike most capability checks in
// this codebase, which fail open for guests per requireEntitlement.js's
// documented "guests are not covered here" rule). This endpoint sends mail
// to an ARBITRARY, client-supplied recipient list — failing open for an
// unauthenticated caller would make it a free spam relay. Every plan that
// has email_export=true already requires an account (Free is the only
// email_export=false plan and has no seats to abuse), so this costs no
// legitimate user anything.
//
// SENDER: EXPORT_EMAIL_FROM, its own env var, per the one-var-per-sender
// rule in CLAUDE.md — a new email TYPE gets a new var, never a fallback
// chain onto an existing sender's identity.

import { extractionsToCsv, extractionsToMarkdown, extractionsToJson, isValidEmail, hostOf } from "../../src/lib/utils.js";
import { extractionsPdfBuffer, extractionsPdfFilename } from "../../src/lib/pdfExport.js";
import { buildBrandingContext, brandingEmailHtml, brandingEmailText } from "../../src/lib/exportBranding.js";
import { validateBrandKit } from "../../src/lib/brandKitValidation.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { requireCapabilityForUser, denyBody, DENY_STATUS } from "./lib/requireEntitlement.js";
import { mailReady, sendMail } from "./lib/mailTransport.js";

const REPLY_TO = "hello@datiq.app";
const MAX_ITEMS = 200; // matches the largest batch tier (Agency, 500) with headroom trimmed for mail size
const MAX_RECIPIENTS = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FORMAT_META = {
  csv: { label: "CSV", mime: "text/csv", ext: "csv" },
  markdown: { label: "Markdown", mime: "text/markdown", ext: "md" },
  json: { label: "JSON", mime: "application/json", ext: "json" },
  pdf: { label: "PDF", mime: "application/pdf", ext: "pdf" },
};

/**
 * Build the file content for the given format. PDF returns a Buffer; the
 * rest return strings. `brandKit` flows straight into the same builders
 * Dashboard/Preview/Batch downloads already use (extractionsToCsv etc. and
 * buildExtractionsPdf, via extractionsPdfBuffer) — this is not a second
 * branding implementation, it is the existing one finally reached from the
 * email path too.
 */
function buildAttachment(format, items, brandKit) {
  switch (format) {
    case "csv":
      return { content: extractionsToCsv(items, { brandKit }), filename: filenameFor(items, "csv") };
    case "markdown":
      return { content: extractionsToMarkdown(items, { brandKit }), filename: filenameFor(items, "md") };
    case "json":
      return { content: extractionsToJson(items, { brandKit }), filename: filenameFor(items, "json") };
    case "pdf":
      return {
        content: Buffer.from(extractionsPdfBuffer(items, { brandKit })),
        filename: extractionsPdfFilename(items),
      };
    default:
      return null;
  }
}

function filenameFor(items, ext) {
  return items.length === 1
    ? `datiq-${hostOf(items[0].url)}-${items[0].id || "export"}.${ext}`
    : `datiq-export-${items.length}-pages.${ext}`;
}

/**
 * The item-preview list, as an HTML `<table>` fragment — handed to
 * `brandingEmailHtml`'s `bodyHtml` slot so the envelope itself (header,
 * accent color, logo, footer, poweredByLine) comes from exportBranding.js
 * rather than a second hand-rolled template.
 */
function itemListHtml(items) {
  const rows = items
    .slice(0, 25)
    .map(
      (it) => `<tr>
        <td style="padding:6px 0;color:#20222c;font-size:13px">${escapeHtml(it.page_title || hostOf(it.url))}</td>
        <td style="padding:6px 0;color:#6e7484;font-size:12px" align="right">${escapeHtml(hostOf(it.url))}</td>
      </tr>`,
    )
    .join("");
  const more = items.length > 25
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9aa0af">+ ${items.length - 25} more, included in the attached file.</p>`
    : "";
  return `<table width="100%" style="border-collapse:collapse">${rows}</table>${more}`;
}

function itemListText(items) {
  return [
    ...items.slice(0, 25).map((it) => `- ${it.page_title || hostOf(it.url)}  (${hostOf(it.url)})`),
    items.length > 25 ? `\n+ ${items.length - 25} more, included in the attached file.` : "",
  ].filter(Boolean).join("\n");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  const auth = await authenticateBearer(event, { label: "export-email" });
  if (!auth.ok) return respond(auth.status || 401, auth.body || { error: "Authentication required" });
  const userId = auth.user.id;

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const format = body?.format;
  if (!FORMAT_META[format]) {
    return respond(400, { error: `format must be one of: ${Object.keys(FORMAT_META).join(", ")}` });
  }

  const items = Array.isArray(body?.items) ? body.items.filter((x) => x && typeof x === "object") : [];
  if (items.length === 0) return respond(400, { error: "items must be a non-empty array" });
  if (items.length > MAX_ITEMS) {
    return respond(400, { error: `A single email can carry at most ${MAX_ITEMS} extractions. Split into multiple sends.` });
  }

  const rawRecipients = Array.isArray(body?.to) ? body.to : typeof body?.to === "string" ? [body.to] : [];
  const to = [...new Set(rawRecipients.map((r) => String(r).trim()).filter(Boolean))];
  if (to.length === 0) return respond(400, { error: "At least one recipient email is required" });
  if (to.length > MAX_RECIPIENTS) return respond(400, { error: `At most ${MAX_RECIPIENTS} recipients per send.` });
  const invalid = to.filter((r) => !isValidEmail(r));
  if (invalid.length) return respond(400, { error: `Invalid email address: ${invalid[0]}` });

  // Server-side mirror of checkCanEmail() + checkCanExport(format) — a client
  // that skips the UI and POSTs directly must still be refused exactly the
  // same way a direct download would be.
  const [emailCheck, formatCheck] = await Promise.all([
    requireCapabilityForUser(userId, "export.email"),
    requireCapabilityForUser(userId, `export.${format}`),
  ]);
  if (!emailCheck.check.allowed) return respond(DENY_STATUS, denyBody(emailCheck.check));
  if (!formatCheck.check.allowed) return respond(DENY_STATUS, denyBody(formatCheck.check));

  // The Brand Kit lives in browser localStorage (whiteLabelTemplate.js); this
  // function has no access to it, so the client includes its own read in the
  // body — same pattern report-email.js already uses for the same reason.
  // Re-validated here rather than trusted, and re-checked against
  // white_label_pdf server-side: the UI never offers Brand Kit customization
  // below Business/Agency, but a hand-built request could still include one.
  // A disallowed or malformed Brand Kit is silently dropped, not an error the
  // sender ever sees — a report emailed with the default DatIQ look is still
  // a correct outcome.
  let brandKit = null;
  if (body.brandKit && typeof body.brandKit === "object") {
    const v = validateBrandKit(body.brandKit);
    if (v.ok && Object.keys(v.value).length) {
      const { check } = await requireCapabilityForUser(userId, "white_label_pdf");
      if (check.allowed) brandKit = v.value;
    }
  }

  if (!mailReady()) return respond(503, { error: "Email is not configured (RESEND_API_KEY missing)." });

  let attachment;
  try {
    attachment = buildAttachment(format, items, brandKit);
  } catch (err) {
    console.error("[export-email] build attachment failed:", err?.message);
    return respond(500, { error: "Couldn't build the export file. Please try again." });
  }
  const content = Buffer.isBuffer(attachment.content)
    ? attachment.content.toString("base64")
    : Buffer.from(attachment.content, "utf8").toString("base64");

  const meta = FORMAT_META[format];
  const ctx = buildBrandingContext({
    kind: "extraction",
    sourceUrls: items.map((it) => hostOf(it.url)),
    generatedAt: new Date().toISOString(),
    brandKit,
  });
  // A Brand Kit swaps the visual identity of the message body and the
  // attached file; the SENDING address is a delivery-infrastructure detail
  // (SPF/DKIM alignment for datiq.app) and stays DatIQ's own regardless —
  // same split invoiceEmail.js and reportEmail.js already make.
  const from = process.env.EXPORT_EMAIL_FROM || "DatIQ <hello@datiq.app>";
  const heading = `${items.length} extraction${items.length === 1 ? "" : "s"}, as ${meta.label}`;

  try {
    const r = await sendMail({
      from,
      to,
      reply_to: REPLY_TO,
      subject: `${ctx.brand} — ${heading}`,
      html: brandingEmailHtml(ctx, {
        heading,
        bodyHtml: itemListHtml(items),
        attachmentLabel: attachment.filename,
      }),
      text: brandingEmailText(ctx, { heading, bodyText: itemListText(items), attachmentLabel: attachment.filename }),
      attachments: [{ filename: attachment.filename, content }],
      tags: [{ name: "stream", value: "export" }],
    });
    if (!r.ok) {
      // r.error is the raw error body; only a JSON `.message` hint from it is
      // ever surfaced. Deliberately do NOT echo the full response body — it can
      // contain secrets.
      let resendMsg = "";
      try {
        const errJson = JSON.parse(r.error || "");
        if (errJson?.message && typeof errJson.message === "string") {
          resendMsg = errJson.message.replace(/[\r\n]+/g, " ").slice(0, 200);
        }
      } catch { /* ignore */ }
      console.error(`[export-email] Resend HTTP ${r.status}${resendMsg ? `: ${resendMsg}` : ""}`);
      return respond(502, {
        error: `Email delivery failed (Resend HTTP ${r.status}${resendMsg ? `: ${resendMsg}` : ""}).`,
      });
    }
  } catch (err) {
    // Defensive: sendMail maps transport failures to its result, never throws.
    console.error("[export-email] threw:", err?.message);
    return respond(502, { error: "Email delivery failed. Please try again." });
  }

  return respond(200, { ok: true, sent: to.length, format, count: items.length });
};
