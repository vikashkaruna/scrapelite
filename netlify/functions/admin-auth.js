// admin-auth.js — Server-side admin PIN verification.
// The admin secret NEVER enters the browser bundle. POST { pin } → the PIN is
// hashed and compared (timing-safe) against a server-only env var; on success a
// short-lived HMAC-signed session token is returned.
//
// Configure in Netlify env (NO VITE_ prefix — these must stay server-only):
//   ADMIN_PIN_HASH      — SHA-256 hex of your strong PIN (PREFERRED). Generate with:
//                           printf '%s' 'your-strong-pin' | shasum -a 256
//   ADMIN_PIN           — plaintext PIN (fallback if you can't pre-hash it)
//   ADMIN_TOKEN_SECRET  — optional HMAC key for the session token (defaults to the hash)
//
// This endpoint is disabled when no server-only secret is configured. Production
// deployments must set ADMIN_PIN_HASH or ADMIN_PIN; there is no default/demo PIN.

import { createHash, createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

// Constant-time compare of two SHA-256 hex digests (always 32 bytes → no length leak).
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "hex");
  const bb = Buffer.from(String(b), "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

function signToken(secret) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, exp };
}

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED" }) };

  let pin = "";
  try { pin = String(JSON.parse(event.body || "{}").pin || ""); } catch {}
  if (!pin)
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "PIN required.", code: "MISSING_PIN" }) };

  const envHash = process.env.ADMIN_PIN_HASH;
  const envPin  = process.env.ADMIN_PIN;
  if (!envHash && !envPin) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ ok: false, error: "Admin access is not configured.", code: "ADMIN_NOT_CONFIGURED" }),
    };
  }

  const expectedHash = envHash || sha256Hex(envPin);
  const ok = safeEqualHex(sha256Hex(pin), expectedHash);

  // Small fixed delay to blunt online brute-forcing (client also enforces lockout).
  await new Promise((r) => setTimeout(r, 250));

  if (!ok)
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: "Incorrect PIN.", code: "BAD_PIN" }) };

  const secret = process.env.ADMIN_TOKEN_SECRET || expectedHash;
  const { token, exp } = signToken(secret);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, exp, demo: false }) };
};
