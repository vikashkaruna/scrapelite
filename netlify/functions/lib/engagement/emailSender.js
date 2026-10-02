// netlify/functions/lib/engagement/emailSender.js — the one place an outreach
// email leaves DatIQ.
//
// ── IT NEVER REPORTS A SEND THAT DID NOT HAPPEN ─────────────────────────────
// 0081's dispatcher returned `ok: true, status: "sent"` with a fabricated id
// whenever a provider key was missing — so with only an email key configured,
// every WhatsApp and SMS message was recorded as sent and none left (review
// F-4). A fabricated success is worse than a failure: nobody looks behind it.
// Here, an unconfigured provider is a FAILURE with a code. Mock sending exists
// only when ENGAGEMENT_MOCK_SEND=1 AND the context is not production, and the
// mock id says so.
//
// ── IT CANNOT SEND THE SAME MESSAGE TWICE ───────────────────────────────────
// `Idempotency-Key` is the message id. If a function is killed after Resend
// accepted the email but before we recorded it, the dispatcher re-claims the
// stale send later and Resend answers with the ORIGINAL email instead of a
// second one (Resend honours the key for 24 hours).
//
// ── ENV ─────────────────────────────────────────────────────────────────────
// ENGAGEMENT_RESEND_API_KEY — deliberately NOT RESEND_API_KEY. Transactional
// mail (invoices, password resets, alerts) and customer outreach must be able
// to live on different accounts/domains; sharing the variable would make that
// impossible without a code change (review F-8).
//
// MAIL_TRANSPORT=mailpit is the one carve-out: the local stack has no
// engagement credential, so when the shared transport (lib/mailTransport.js)
// is Mailpit, sends bypass BOTH the mock branch and the ENGAGEMENT key check
// and go out through sendMail() — that is what makes local outreach visible
// in the Mailpit inbox at all.

import { mailTransportName, sendMail } from "../mailTransport.js";

export const ENGAGEMENT_EMAIL_PROVIDER = "resend";

function isProductionContext(env) {
  return env.CONTEXT === "production";
}

export function mockSendingEnabled(env = process.env) {
  return env.ENGAGEMENT_MOCK_SEND === "1" && !isProductionContext(env);
}

/** Fill the unsubscribe placeholder, or append a footer when a body has none. */
export function withUnsubscribe({ text, html }, url) {
  const PLACEHOLDER = /\{\{\s*unsubscribe_url\s*\}\}/g;
  const safeUrl = url || "";
  let t = String(text || "");
  let h = html ? String(html) : null;
  if (PLACEHOLDER.test(t)) t = t.replace(PLACEHOLDER, safeUrl);
  else if (safeUrl) t = `${t}\n\n---\nUnsubscribe: ${safeUrl}`;
  PLACEHOLDER.lastIndex = 0;
  if (h) {
    if (PLACEHOLDER.test(h)) h = h.replace(PLACEHOLDER, safeUrl.replace(/"/g, "&quot;"));
    else if (safeUrl) h = `${h}<hr/><p style="font-size:11px;color:#888"><a href="${safeUrl.replace(/"/g, "&quot;")}">Unsubscribe</a></p>`;
  }
  return { text: t, html: h };
}

function formatFrom(sender) {
  return sender.from_name ? `${sender.from_name} <${sender.from_email}>` : sender.from_email;
}

/**
 * Send one outreach email.
 *
 * @returns {Promise<{ ok: true, provider: string, externalId: string, mock?: boolean }
 *   | { ok: false, code: string, retryable: boolean, status?: number }>}
 */
export async function sendOutreachEmail({
  message, to, sender, unsubscribeUrl, env = process.env, fetchImpl = globalThis.fetch, signal,
}) {
  if (!to) return { ok: false, code: "no_address", retryable: false };
  if (!unsubscribeUrl) return { ok: false, code: "unsubscribe_not_configured", retryable: false };

  const { text, html } = withUnsubscribe({ text: message.body, html: message.body_html }, unsubscribeUrl);

  // Mailpit transport (MAIL_TRANSPORT=mailpit) — decided BEFORE the mock branch
  // and the ENGAGEMENT key check, so a local run's outreach lands in the
  // Mailpit inbox instead of being silently mocked or refused for a key the
  // local stack does not have.
  if (mailTransportName(env) === "mailpit") {
    const r = await sendMail({
      from: formatFrom(sender),
      to: [to],
      ...(sender.reply_to ? { reply_to: sender.reply_to } : {}),
      subject: message.subject || "",
      text,
      ...(html ? { html } : {}),
      // Mailpit's send API derives tags from X-Tags (lib/mailTransport.js).
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [{ name: "engagement_message", value: String(message.id).replace(/[^A-Za-z0-9_-]/g, "") }],
    }, env);
    if (r.ok) {
      return { ok: true, provider: ENGAGEMENT_EMAIL_PROVIDER, externalId: r.id || `mailpit-${message.id}` };
    }
    // Same failure vocabulary as the Resend path below.
    if (!r.status) return { ok: false, code: "network_error", retryable: true };
    const retryable = r.status === 429 || r.status >= 500;
    return { ok: false, code: retryable ? "provider_unavailable" : "provider_rejected", status: r.status, retryable };
  }

  if (mockSendingEnabled(env)) {
    return { ok: true, provider: ENGAGEMENT_EMAIL_PROVIDER, externalId: `mock_${message.id}`, mock: true };
  }

  const key = env.ENGAGEMENT_RESEND_API_KEY;
  if (!key) return { ok: false, code: "email_not_configured", retryable: false };

  let res;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `engagement-msg-${message.id}`,
      },
      body: JSON.stringify({
        from: formatFrom(sender),
        to: [to],
        ...(sender.reply_to ? { reply_to: sender.reply_to } : {}),
        subject: message.subject || "",
        text,
        ...(html ? { html } : {}),
        // RFC 8058 one-click unsubscribe — required by Gmail and Yahoo for
        // bulk senders since 2024, and what makes the mailbox's own
        // "Unsubscribe" button work.
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "engagement_message", value: String(message.id).replace(/[^A-Za-z0-9_-]/g, "") }],
      }),
    });
  } catch (err) {
    return { ok: false, code: err?.name === "AbortError" ? "timeout" : "network_error", retryable: true };
  }

  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }

  if (res.ok && data?.id) {
    return { ok: true, provider: ENGAGEMENT_EMAIL_PROVIDER, externalId: data.id };
  }
  // 429 and 5xx are worth another attempt; a 4xx is a refusal of THIS message.
  const retryable = res.status === 429 || res.status >= 500;
  return { ok: false, code: retryable ? "provider_unavailable" : "provider_rejected", status: res.status, retryable };
}
