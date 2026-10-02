// netlify/functions/lib/mailTransport.js — THE one email send choke point.
// Every transactional sender routes through sendMail() instead of hand-
// rolling its own Resend fetch. Two transports, chosen per environment:
//
//   MAIL_TRANSPORT=mailpit → the local Mailpit container's Send API
//     (POST {MAILPIT_URL}/api/v1/send — no credential). What the local
//     stack "sends" becomes visible at http://localhost:8025, which is what
//     the deployment README always claimed Mailpit did. Nothing else
//     changes: callers keep their own gating, error mapping and payloads.
//   unset / anything else  → Resend (RESEND_ENDPOINT, Bearer RESEND_API_KEY),
//     the production path — byte-identical to the inline fetches this
//     module replaced. A missing key is `mailReady() === false`, so callers
//     that used to skip on `!RESEND_API_KEY` now skip on `!mailReady()`.
//
// 🔴 DO NOT add a new `fetch("https://api.resend.com/…")` anywhere else.
// A sender that bypasses this module will silently skip Mailpit locally
// and drift from the response contract the rest of the app maps on.

const DEFAULT_RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_MAILPIT_URL = "http://mailpit:8025";

/** Which transport would sendMail() use? ("mailpit" | "resend") */
export function mailTransportName(env = process.env) {
  return env.MAIL_TRANSPORT === "mailpit" ? "mailpit" : "resend";
}

/**
 * Can a send actually go out on the selected transport? This is what callers
 * gate on — `mailpit` needs no credential, `resend` needs RESEND_API_KEY.
 */
export function mailReady(env = process.env) {
  if (mailTransportName(env) === "mailpit") return true;
  return Boolean(env.RESEND_API_KEY);
}

/** "Name <a@b>" / "a@b" / {email, name} → {email, name}. */
export function parseAddress(value) {
  if (!value) return { email: "", name: "" };
  if (typeof value === "object") return { email: String(value.email || ""), name: String(value.name || "") };
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(String(value));
  if (m) return { email: m[2].trim(), name: m[1].trim().replace(/^"|"$/g, "") };
  return { email: String(value).trim(), name: "" };
}

function asAddressArray(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(Boolean).map(parseAddress).filter((a) => a.email);
}

/**
 * Send one email.
 *
 * @param {object} payload  RESEND-shaped — exactly what the senders already
 *   build: { from, to, subject, html?, text?, reply_to?, cc?, bcc?,
 *   attachments? [{filename, content(base64)}], tags? [{name,value}] }.
 * @param {object} [env]    env-like override (tests); defaults to process.env.
 * @returns {Promise<{ok: boolean, status: number, id: string|null, error: string|null}>}
 */
export async function sendMail(payload, env = process.env) {
  if (mailTransportName(env) === "mailpit") return sendViaMailpit(payload, env);
  return sendViaResend(payload, env);
}

async function sendViaResend(payload, env) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, status: 0, id: null, error: "no_key" };
  }
  try {
    const res = await fetch(env.RESEND_ENDPOINT || DEFAULT_RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Guarded reads: some callers (and their test doubles) hand us bare
      // {ok} objects without .text/.json — a missing method must not flip a
      // successful send into a failure. Real Responses always have both.
      const text = typeof res.text === "function" ? await res.text().catch(() => "") : "";
      return { ok: false, status: res.status, id: null, error: text.slice(0, 500) };
    }
    const body = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
    return { ok: true, status: res.status, id: body?.id || null, error: null };
  } catch (err) {
    return { ok: false, status: 0, id: null, error: err?.message || "network error" };
  }
}

async function sendViaMailpit(payload, env) {
  const base = (env.MAILPIT_URL || DEFAULT_MAILPIT_URL).replace(/\/+$/, "");
  const body = {
    from: parseAddress(payload.from),
    to: asAddressArray(payload.to),
    subject: String(payload.subject || ""),
  };
  if (payload.cc) body.cc = asAddressArray(payload.cc);
  if (payload.bcc) body.bcc = asAddressArray(payload.bcc);
  if (payload.reply_to) body.reply_to = asAddressArray(payload.reply_to);
  if (payload.html) body.html = payload.html;
  if (payload.text) body.text = payload.text;
  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    // Resend shape {filename, content(base64)} maps 1:1 onto Mailpit's send API.
    body.attachments = payload.attachments
      .filter((a) => a && a.content && a.filename)
      .map((a) => ({ filename: a.filename, content: a.content }));
  }
  if (Array.isArray(payload.tags) && payload.tags.length) {
    // Mailpit derives tags from the X-Tags header; values joined, names dropped.
    body.headers = { "X-Tags": payload.tags.map((t) => String(t.value || t.name || "")).filter(Boolean).join(",") };
  }
  try {
    const res = await fetch(`${base}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = typeof res.text === "function" ? await res.text().catch(() => "") : "";
      return { ok: false, status: res.status, id: null, error: text.slice(0, 500) };
    }
    const out = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
    return { ok: true, status: res.status, id: out?.ID || out?.id || null, error: null };
  } catch (err) {
    return { ok: false, status: 0, id: null, error: err?.message || "network error" };
  }
}
