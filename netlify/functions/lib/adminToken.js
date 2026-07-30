// adminToken.js — verify the HMAC session token issued by admin-auth.js.
//
// Token format: `${base64url(JSON {exp})}.${base64url(HMAC-SHA256(payload, secret))}`
// where secret = ADMIN_TOKEN_SECRET || ADMIN_PIN_HASH || sha256(ADMIN_PIN).
//
// When no admin secret is configured (demo mode — same condition admin-auth.js
// uses), there is nothing to verify against, so we accept any non-empty token and
// flag it demo:true. Setting ADMIN_PIN_HASH (or ADMIN_PIN / ADMIN_TOKEN_SECRET)
// enables real verification.

import { createHash, createHmac, timingSafeEqual } from "crypto";

const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

function adminSecret(env = process.env) {
  if (env.ADMIN_TOKEN_SECRET) return env.ADMIN_TOKEN_SECRET;
  if (env.ADMIN_PIN_HASH) return env.ADMIN_PIN_HASH;
  if (env.ADMIN_PIN) return sha256Hex(env.ADMIN_PIN);
  return null; // demo mode
}

export function isDemoAdminAllowed(env = process.env) {
  return env.DATIQ_ALLOW_DEMO_ADMIN === "1" || env.CONTEXT === "dev" || env.NETLIFY_DEV === "true";
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** Extract a bearer token from an event's headers (case-insensitive). */
export function bearerFromEvent(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : "";
}

/** Returns { ok, demo, reason }. */
export function verifyAdminToken(token) {
  if (!token) return { ok: false, reason: "Missing admin token." };

  const secret = adminSecret();
  if (!secret) return isDemoAdminAllowed() ? { ok: true, demo: true } : { ok: false, reason: "Admin authentication is not configured." };

  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return { ok: false, reason: "Malformed token." };

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return { ok: false, reason: "Invalid token signature." };

  let exp = 0;
  try { exp = JSON.parse(Buffer.from(payload, "base64url").toString()).exp || 0; } catch {}
  if (exp && Date.now() > exp) return { ok: false, reason: "Token expired." };

  return { ok: true, demo: false };
}
