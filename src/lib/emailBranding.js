// emailBranding.js — PURE. The one branded shell every DatIQ email wears.
//
// WHY THIS EXISTS
// ---------------
// DatIQ had SIX independent mail builders (welcome, contact, export, invoice,
// report, re-engagement) and they agreed on nothing. An audit found: one had a
// logo, one had the tagline, and NOT ONE carried the company name or website.
// The welcome email — the first thing a new customer ever sees from us — was a
// purple band reading "DATIQ" with no mark, no tagline, and no signature.
//
// So the chrome is defined once and wrapped around each body, the same way
// exportBranding.js already does for PDF/CSV/Markdown exports. Adding a
// seventh mail builder should mean writing a <p>, not re-deriving a header.
//
// ── EMAIL HTML IS NOT WEB HTML ──────────────────────────────────────────────
// Tables, inline styles, no flexbox, no <style> block worth relying on: Gmail
// strips <head>, Outlook renders through Word. Everything below is table-based
// and inline-styled on purpose — it is not carelessness, and "tidying" it into
// semantic CSS will silently break Outlook while looking fine in every test.
//
// ── THE LOGO MUST DEGRADE ───────────────────────────────────────────────────
// Most clients block remote images by default, so the mark is decorative and
// the wordmark is TEXT beside it. An email whose branding disappears the
// moment images are blocked is not branded.

import { BRAND, SITE_URL, TAGLINE, LOGO_URL, COMPANY, COMPANY_URL, DEFAULT_ACCENT } from "./exportBranding.js";

const TEXT = "#1f2330";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

/** Minimal HTML escape. Every caller-supplied string passes through this. */
export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The header: DatIQ mark + wordmark + tagline, on the brand accent.
 * `accent` is overridable so a white-labelled report can use a Brand Kit
 * colour without forking the layout.
 */
export function emailHeader({ accent = DEFAULT_ACCENT } = {}) {
  return `
  <tr>
    <td style="background:${esc(accent)};padding:22px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:11px;vertical-align:middle;">
            <img src="${esc(LOGO_URL)}" width="34" height="34" alt=""
                 style="display:block;border:0;border-radius:7px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font:700 19px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.2px;">${esc(BRAND)}</div>
            <div style="font:400 12px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:rgba(255,255,255,.86);margin-top:2px;">${esc(TAGLINE)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * The footer: the legal entity and its website, plus the product link.
 *
 * `extra` is for a mail-specific line (an unsubscribe pointer, a "you are
 * receiving this because…"). It sits ABOVE the company signature so the
 * signature is always the last thing read.
 */
export function emailFooter({ extra = "" } = {}) {
  return `
  <tr>
    <td style="padding:18px 28px 24px;border-top:1px solid ${BORDER};">
      ${extra ? `<div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-bottom:10px;">${extra}</div>` : ""}
      <div style="font:600 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">${esc(COMPANY)}</div>
      <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        <a href="${esc(COMPANY_URL)}" style="color:${MUTED};text-decoration:underline;">${esc(COMPANY_URL.replace(/^https?:\/\//, ""))}</a>
        &nbsp;·&nbsp;
        <a href="${esc(SITE_URL)}" style="color:${MUTED};text-decoration:underline;">${esc(BRAND)}</a>
      </div>
    </td>
  </tr>`;
}

/**
 * Wrap a body in the branded shell.
 *
 * @param {string} bodyHtml  already-escaped inner HTML (the mail's own content)
 * @param {{accent?:string, footerExtra?:string, preheader?:string}} [opts]
 *   `preheader` is the grey snippet a client shows beside the subject. Hidden
 *   in the body but read by the inbox list — without one, clients pick the
 *   first visible text, which is the tagline on every single mail we send.
 */
export function wrapEmail(bodyHtml, { accent = DEFAULT_ACCENT, footerExtra = "", preheader = "" } = {}) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        ${emailHeader({ accent })}
        <tr><td style="padding:26px 28px;font:400 15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
          ${bodyHtml}
        </td></tr>
        ${emailFooter({ extra: footerExtra })}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The plain-text signature, so text/plain parts carry the same attribution. */
export function textSignature() {
  return `\n\n—\n${BRAND} — ${TAGLINE}\n${SITE_URL}\n\n${COMPANY}\n${COMPANY_URL}\n`;
}
