// netlify/functions/lib/engagement/engagementGuards.js — the small, sharp rules
// the Prospect Engagement Engine's endpoints share.
//
//   engagementAccess()   — the beta gate (who may use the module at all)
//   validateSender()     — who a campaign may send AS
//   sign/verifyUnsubscribeToken() — the recipient's unsubscribe link
//   verifyResendSignature()       — is this webhook really from Resend?
//
// Every secret is read from its OWN env var with no fallback to another
// (the house "one env var per sender" rule) — so repointing one cannot
// silently move another.

import { createHmac, timingSafeEqual } from "node:crypto";

// ── Beta gate ───────────────────────────────────────────────────────────────
//
// Owner decision (2026-09-23): built customer-ready, opened to DatIQ only.
// Both switches are read from process.env, so — unlike a database flag — they
// cannot fail OPEN when Supabase is unreachable.
//
//   ENGAGEMENT_ENABLED=1                     module on at all
//   ENGAGEMENT_ALLOWLIST=<uuid>,<uuid>|*     which accounts may use it

export function engagementAccess(userId, env = process.env) {
  if (env.ENGAGEMENT_ENABLED !== "1") {
    return { ok: false, status: 403, code: "engagement_disabled", error: "The engagement engine is not enabled." };
  }
  const list = String(env.ENGAGEMENT_ALLOWLIST || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*") || (userId && list.includes(userId))) return { ok: true };
  return {
    ok: false, status: 403, code: "engagement_beta",
    error: "The engagement engine is in private beta and not yet available on this account.",
  };
}

// ── Sender identity ─────────────────────────────────────────────────────────
//
// A campaign sends as `sender.from_email`. The domain must be one the operator
// has verified with Resend AND listed in ENGAGEMENT_SENDER_DOMAINS — otherwise
// any tenant could send as any domain, or as DatIQ's own transactional domain,
// whose reputation carries invoices and password resets (review F-8).
//
// ⚠️ CR/LF are refused in every field: they become email HEADERS, and a
// newline in a display name is header injection.

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HEADER_UNSAFE = /[\r\n<>"]/;

export function allowedSenderDomains(env = process.env) {
  return String(env.ENGAGEMENT_SENDER_DOMAINS || "")
    .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * @returns {{ ok: true, sender: object } | { ok: false, code: string, error: string }}
 */
export function validateSender(sender = {}, env = process.env) {
  const s = sender && typeof sender === "object" ? sender : {};
  const fromEmail = String(s.from_email || "").trim().toLowerCase();
  const fromName = String(s.from_name || "").trim();
  const replyTo = s.reply_to ? String(s.reply_to).trim().toLowerCase() : "";

  if (!fromEmail) return { ok: false, code: "sender_missing", error: "Set a sender email for this campaign." };
  if (!EMAIL_RE.test(fromEmail)) return { ok: false, code: "sender_invalid", error: "The sender email is not a valid address." };
  if (HEADER_UNSAFE.test(fromName) || fromName.length > 80) {
    return { ok: false, code: "sender_name_invalid", error: "The sender name must be under 80 characters with no line breaks or quotes." };
  }
  if (replyTo && !EMAIL_RE.test(replyTo)) return { ok: false, code: "reply_to_invalid", error: "The reply-to address is not valid." };

  const domain = fromEmail.split("@")[1];
  const allowed = allowedSenderDomains(env);
  if (!allowed.includes(domain)) {
    return {
      ok: false, code: "sender_domain_not_allowed",
      error: allowed.length
        ? `Send from one of the verified domains: ${allowed.join(", ")}.`
        : "No sending domain has been verified yet.",
    };
  }
  return { ok: true, sender: { from_email: fromEmail, from_name: fromName || null, reply_to: replyTo || null } };
}

// ── Unsubscribe token ───────────────────────────────────────────────────────
//
// A signed, self-contained link. No expiry on purpose: CAN-SPAM requires an
// opt-out to keep working for at least 30 days, and a recipient who digs out a
// six-month-old email and clicks "unsubscribe" must still be unsubscribed.
// The token names the TENANT (u), so an opt-out lands on the right suppression
// list and on no other tenant's.

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function unsubSecret(env) {
  const s = env.ENGAGEMENT_UNSUBSCRIBE_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function signUnsubscribeToken({ userId, prospectId, channel, address }, env = process.env) {
  const secret = unsubSecret(env);
  if (!secret) return null;
  const payload = b64u(JSON.stringify({ v: 1, u: userId, p: prospectId || null, c: channel, a: address }));
  const sig = b64u(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token, env = process.env) {
  const secret = unsubSecret(env);
  if (!secret || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest();
  let given;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.v !== 1 || !data.u || !data.c || !data.a) return null;
    return { userId: data.u, prospectId: data.p || null, channel: data.c, address: data.a };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(token, env = process.env) {
  const base = String(env.ENGAGEMENT_PUBLIC_URL || env.URL || "").replace(/\/$/, "");
  if (!base || !token) return null;
  return `${base}/api/engagement-unsubscribe?t=${encodeURIComponent(token)}`;
}

// ── Resend webhook signature (Svix) ─────────────────────────────────────────
//
// Resend signs with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`,
// keyed by the base64 part of the `whsec_…` secret, sent as
// `svix-signature: v1,<b64> [v1,<b64> …]` (several during a secret rotation).
// The timestamp is checked so a captured request cannot be replayed later.
//
// ⚠️ The BODY must be the raw string exactly as received — re-serialising
// parsed JSON changes whitespace and every signature fails.

export const SIGNATURE_TOLERANCE_S = 5 * 60;

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

export function verifyResendSignature({ headers, rawBody, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret) return { ok: false, code: "not_configured" };
  const id = header(headers, "svix-id");
  const ts = header(headers, "svix-timestamp");
  const sigHeader = header(headers, "svix-signature");
  if (!id || !ts || !sigHeader) return { ok: false, code: "missing_headers" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSeconds - tsNum) > SIGNATURE_TOLERANCE_S) {
    return { ok: false, code: "timestamp_out_of_range" };
  }

  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key;
  try { key = Buffer.from(keyB64, "base64"); } catch { return { ok: false, code: "bad_secret" }; }
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();

  for (const part of String(sigHeader).split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    let given;
    try { given = Buffer.from(value, "base64"); } catch { continue; }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id };
  }
  return { ok: false, code: "signature_mismatch" };
}
