// emailService.js — email one or more saved extractions to chosen recipients.
//
// Delivery is handed off, in priority order, to:
//   1. VITE_WEBHOOK_URL    → POST an "email.send" event; your webhook (Zapier / n8n /
//                            Make / custom) performs the actual send. (Preferred.)
//   2. VITE_EMAIL_API_URL  → POST JSON to a dedicated email endpoint.
//   3. (neither configured) → fall back to a prefilled mailto: draft in the user's
//                             own mail app, so the feature works with zero setup.

import { hasWebhook, WEBHOOK_URL, hasEmail, EMAIL_API_URL } from "./config.js";
import { fmtDate, snippet } from "./utils.js";

const MAX_SUMMARY = 600; // trim long summaries so mailto bodies stay deliverable
const MAX_MAILTO_BODY = 1800;

// Turn a failed webhook response into a concise, actionable message instead of
// dumping a raw HTML error page (e.g. a 404) into the UI.
function webhookErrorMessage(status, detail) {
  const looksLikeHtml = /<!doctype|<html[\s>]/i.test(detail || "");
  if (status === 404 || looksLikeHtml) {
    return (
      `Couldn't reach the email webhook (HTTP ${status}). ` +
      `The webhook URL looks wrong or inactive — check VITE_WEBHOOK_URL ` +
      `(use the full https:// production URL).`
    );
  }
  const msg = (detail || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `Email webhook failed (HTTP ${status})${msg ? ": " + msg : ""}.`;
}

function lineFor(it, i) {
  const meta =
    `${(it.headings || []).length} headings · ` +
    `${(it.links || []).length} links · saved ${fmtDate(it.created_at)}`;
  const sum = it.ai_summary ? `\n   Summary: ${snippet(it.ai_summary, MAX_SUMMARY)}` : "";
  return `${i + 1}. ${it.page_title}\n   ${it.url}\n   ${meta}${sum}`;
}

// Compose the subject + plain-text body for a set of extractions.
export function buildEmail(items) {
  const n = items.length;
  const subject = `DatIQ — ${n} extraction${n === 1 ? "" : "s"}`;
  const intro = `Shared from DatIQ — ${n} extracted page${n === 1 ? "" : "s"}:`;
  const body = `${intro}\n\n${items.map(lineFor).join("\n\n")}`;
  return { subject, body };
}

/**
 * Send the given extractions to one or more recipients.
 * @param {{ to: string[]|string, items: object[] }} args
 * @returns {Promise<{ via: "webhook"|"api"|"mailto", count: number }>}
 */
export async function sendExtractionsEmail({ to, items }) {
  const recipients = Array.isArray(to) ? to : [to];
  const { subject, body } = buildEmail(items);

  // Preferred: hand the email off to the configured webhook to deliver.
  // On 5xx the webhook is misbehaving (not "config wrong"); fall through to
  // the email API so the user doesn't see a hard error. On 4xx the
  // webhook is configured wrong — re-throw so the user knows to fix it.
  // Network-level failures also fall through to mailto.
  if (hasWebhook) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "email.send",
          sent_at: new Date().toISOString(),
          to: recipients,
          subject,
          body,
          data: items,
        }),
      });
      if (res.ok) return { via: "webhook", count: recipients.length };
      const status = res.status;
      const detail = await res.text().catch(() => "");
      // 5xx → misbehaving webhook, fall through
      if (status >= 500 && status < 600) {
        console.warn("[DatIQ] Email webhook returned", status, "— falling through to email API");
        // fall through to email API below
      } else {
        // 4xx → configuration problem, surface to the user
        throw new Error(webhookErrorMessage(status, detail));
      }
    } catch (err) {
      // Network-level failure (webhook down, CORS): fall through to mailto.
      if (err && err.message && (err.message.startsWith("Couldn't reach") || err.message.startsWith("Email webhook"))) {
        throw err; // configuration error from above
      }
      console.warn("[DatIQ] Email webhook unreachable, falling back:", err?.message);
      // fall through to mailto below
    }
  }

  if (hasEmail) {
    const res = await fetch(EMAIL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients, subject, body, items }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Email request failed (${res.status}). ${detail}`.trim());
    }
    return { via: "api", count: recipients.length };
  }

  // Fallback: open the user's email client with a prefilled draft.
  let mailBody = body;
  if (mailBody.length > MAX_MAILTO_BODY) {
    mailBody = mailBody.slice(0, MAX_MAILTO_BODY) + "\n\n… (truncated — open DatIQ for the full details)";
  }
  const href =
    `mailto:${encodeURIComponent(recipients.join(","))}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(mailBody)}`;

  const a = document.createElement("a");
  a.href = href;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { via: "mailto", count: recipients.length };
}
