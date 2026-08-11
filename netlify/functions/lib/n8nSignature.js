// netlify/functions/lib/n8nSignature.js
//
// HMAC-SHA256 signing of payloads sent from DatIQ → self-hosted n8n.
// The orchestrator signs every webhook POST; n8n's "Webhook" trigger
// has a built-in "Header Auth" + HMAC verification option, so the
// receiving workflow can reject unsigned requests.
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §6 + §11
//
// The signature covers:  timestamp + "." + rawBody
// so a replay-attack window is bounded (default 5 min). The webhook
// receiver must check that |now - timestamp| < toleranceMs.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

// Build the canonical string the HMAC is computed over.
function canonical(timestamp, rawBody) {
  return `${timestamp}.${rawBody}`;
}

// Compute signature for a payload. Returns the hex digest.
// timestamp defaults to current epoch ms — callers usually pass an
// explicit value so the signed timestamp and the one in the header
// are guaranteed to match.
export function sign(secret, rawBody, timestamp = Date.now()) {
  if (!secret) throw new Error("n8nSignature.sign: secret is required");
  if (typeof rawBody !== "string") {
    throw new Error("n8nSignature.sign: rawBody must be a string");
  }
  const ts = String(timestamp);
  return createHmac("sha256", secret).update(canonical(ts, rawBody)).digest("hex");
}

// Verify a signature. Constant-time compare. Returns:
//   { ok: true }                       — signature matches and timestamp is fresh
//   { ok: false, reason: "expired" }   — timestamp is outside tolerance
//   { ok: false, reason: "bad_sig" }   — signature mismatch
//   { ok: false, reason: "missing" }   — no signature provided
export function verify(secret, rawBody, headerValue, toleranceMs = DEFAULT_TOLERANCE_MS) {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!headerValue) return { ok: false, reason: "missing" };
  // Expected header format: "t=<ms>,v1=<hex>"
  const m = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(String(headerValue).trim());
  if (!m) return { ok: false, reason: "malformed" };
  const ts = Number(m[1]);
  const provided = m[2].toLowerCase();
  if (!Number.isFinite(ts)) return { ok: false, reason: "malformed_ts" };

  const drift = Math.abs(Date.now() - ts);
  if (drift > toleranceMs) return { ok: false, reason: "expired" };

  const expected = createHmac("sha256", secret)
    .update(canonical(String(ts), rawBody))
    .digest("hex");

  // timingSafeEqual requires equal-length buffers
  if (provided.length !== expected.length) {
    return { ok: false, reason: "bad_sig" };
  }
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_sig" };
  }
  return { ok: true };
}

// Build the header value DatIQ sends.
export function buildHeader(secret, rawBody, timestamp = Date.now()) {
  return `t=${timestamp},v1=${sign(secret, rawBody, timestamp)}`;
}

export const TOLERANCE_MS = DEFAULT_TOLERANCE_MS;
