// netlify/functions/contact-email.js — POST /api/contact-email
//
// Delivers a /contact submission as an email via the shared mail transport
// (lib/mailTransport.js — Resend in production, the local Mailpit container
// when MAIL_TRANSPORT=mailpit), the same pipeline that already sends welcome /
// re-engagement / schedule-alert mail. One mail pipeline for the whole platform.
//
// Why this runs server-side rather than posting from the browser:
//
//   1. ROUTING IS AUTHORITATIVE HERE. The client sends an enquiry *type*; this
//      function resolves the destination from its own table. A tampered client
//      cannot make DatIQ send mail to an arbitrary address, so the endpoint is
//      not an open relay.
//   2. THE API KEY STAYS SECRET. RESEND_API_KEY never reaches the bundle.
//   3. EXACTLY ONE RECIPIENT per submission — the inbox that owns the enquiry.
//      No duplicate delivery to both mailboxes.
//
// The routing table is imported from src/lib/contactRouting.js so the address a
// user is shown in the form and the address that actually receives the mail can
// never drift apart. That module is dependency-free and browser/node agnostic.

import {
  INBOX_EMAIL,
  buildSubject,
  emailForType,
  inboxForType,
  labelForType,
  normalizeContactType,
} from "../../src/lib/contactRouting.js";
import { wrapEmail } from "../../src/lib/emailBranding.js";
import { mailReady, sendMail } from "./lib/mailTransport.js";

// Guard rails on inbound field sizes. Generous for a human, cheap to enforce.
const LIMITS = { name: 200, email: 320, subject: 300, message: 20000 };

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  // Honeypot: a real browser leaves this empty; bots fill every field they see.
  // Answer 200 so the bot believes it succeeded and doesn't retry.
  if (String(body.botcheck || "").trim()) {
    return json(200, { ok: true, inbox: "hello", routeTo: INBOX_EMAIL.hello, skipped: "bot" });
  }

  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  if (!email || !message) {
    return json(400, { error: "Email address and message are both required." });
  }
  if (!isPlausibleEmail(email)) {
    return json(400, { error: "That email address doesn't look valid." });
  }
  const tooLong = Object.entries(LIMITS).find(
    ([field, max]) => String(body[field] || "").length > max
  );
  if (tooLong) {
    return json(400, { error: `The ${tooLong[0]} field is too long (max ${tooLong[1]} characters).` });
  }

  // ── Routing decided here, never by the caller. ─────────────────────────────
  const type    = normalizeContactType(body.type);
  const inbox   = inboxForType(type);
  const routeTo = emailForType(type);

  if (!mailReady()) {
    // 503 → the client shows its mailto: fallback rather than losing the message.
    return json(503, { error: "Email delivery is not configured. Please email us directly." });
  }
  // INBOUND mail — visitor → our own inbox. A no-reply sender is correct here
  // and should not be "corrected" to hello@: the submitter's address is
  // unverified, so sending as them would forge an identity we haven't checked,
  // and sending as hello@ would make hello@ mail itself. `reply_to` below
  // carries the real human, so hitting Reply in the mailbox still works.
  //
  // OUTBOUND mail — DatIQ → a user (welcome, re-engagement) — is the opposite
  // case and sends from hello@datiq.app. See welcome-email.js / reengagement.js.
  //
  // Reads FORM_EMAIL_FROM and nothing else. The other two senders are outbound
  // (CONTACT_EMAIL_FROM = hello@ for user mail, ALERT_EMAIL_FROM = alerts@ for
  // schedule alerts); if this path fell back to either, pointing them at hello@
  // would make hello@ mail itself. One variable per direction, no fallbacks.
  const FROM = process.env.FORM_EMAIL_FROM || "DatIQ Contact <noreply@datiq.app>";

  const name    = String(body.name || "").trim();
  const subject = String(body.subject || "").trim();

  const payload = {
    from: FROM,
    to: [routeTo],
    // Replying in the mailbox goes straight back to the person who wrote in.
    reply_to: email,
    subject: buildSubject(type, subject),
    html: contactHtml({ type, name, email, subject, message }),
    text: contactText({ type, name, email, subject, message }),
    // Tags make these findable in the mail provider's dashboard and give the
    // future delivery-webhook something to filter on without parsing the
    // subject.
    tags: [
      { name: "stream", value: "contact" },
      { name: "inbox", value: inbox },
      { name: "enquiry_type", value: type },
    ],
  };

  let r;
  try {
    r = await sendMail(payload);
  } catch (err) {
    // Defensive: sendMail maps transport failures to its result, never throws.
    return json(502, { error: `Could not reach the mail service: ${err.message}` });
  }

  if (!r.ok) {
    // status 0 = the transport itself was unreachable (sendMail folds network
    // failures into its result rather than throwing) — keep the same wording
    // the old thrown-fetch path used, so a refusal is still distinguishable
    // from an outage.
    if (!r.status) {
      return json(502, { error: `Could not reach the mail service: ${r.error || "unknown error"}` });
    }
    console.warn(`[DatIQ] contact-email: resend ${r.status}: ${r.error}`);
    return json(502, { error: `The mail service rejected the message (HTTP ${r.status}).` });
  }

  return json(200, { ok: true, inbox, routeTo, id: r.id || null });
};

// Deliberately permissive: reject the obviously-broken, let the mail server be
// the real authority on deliverability.
function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function contactText({ type, name, email, subject, message }) {
  return [
    `Enquiry type: ${labelForType(type)}`,
    `From: ${name || "(not provided)"} <${email}>`,
    `Subject: ${subject || "(none)"}`,
    "",
    message,
  ].join("\n");
}

function contactHtml({ type, name, email, subject, message }) {
  const row = (label, value) =>
    `<tr>` +
    `<td style="padding:5px 14px 5px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${label}</td>` +
    `<td style="padding:5px 0;color:#111827;font-size:13px">${value}</td>` +
    `</tr>`;

  // Body only — the DatIQ mark, wordmark, tagline and the Axiom Minds
  // signature come from the one shared shell (src/lib/emailBranding.js).
  const body = (
    `<div style="font-size:12px;letter-spacing:.05em;color:#6b7280;text-transform:uppercase">Contact form</div>` +
    `<h1 style="margin:3px 0 16px;font-size:19px;font-weight:800;color:#1f2330">${escapeHtml(labelForType(type))}</h1>` +
    `<table style="border-collapse:collapse;margin-bottom:16px">` +
    row("From", escapeHtml(name || "(not provided)")) +
    row("Email", `<a href="mailto:${escapeHtml(email)}" style="color:#4f46e5">${escapeHtml(email)}</a>`) +
    (subject ? row("Subject", escapeHtml(subject)) : "") +
    `</table>` +
    `<div style="border-top:1px solid #e5e7eb;padding-top:16px;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap">` +
    `${escapeHtml(message)}</div>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Reply to this email to answer ${escapeHtml(email)} directly.</p>`
  );
  return wrapEmail(body, { preheader: `${labelForType(type)} from ${name || email}` });
}
