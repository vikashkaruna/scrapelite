// netlify/functions/lib/apiKeyService.js
//
// Public REST API key model (F-INT-1 — API Access).
//
// Format:  dq_<env>_<32 random url-safe base64 chars>
//   env:    "live" (production) or "test" (sandbox, no quota consumed)
//
// Storage:  only the SHA-256 hash is stored. The plaintext key is shown to the
//   user ONCE at creation time and never persisted or logged. The prefix
//   (`dq_live_xxxxxx`) is stored for human-friendly identification in the
//   Account UI (e.g. "dq_live_aB3xQ… — created 2026-07-28").
//
// Verification: given a plaintext key, look up the row by its hash. The hash
//   is the only thing that can identify a key, so a DB leak does NOT leak
//   usable keys — they would still need the plaintext.
//
// All functions in this file are pure (no I/O) so they can be unit-tested
// without a database. The actual DB I/O lives in apiKeyStore.js (see
// note below — currently the store is colocated inside this file's caller
// path, but extracted here as soon as we need a second consumer).

import { createHash, randomBytes } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

export const KEY_PREFIX_LIVE = "dq_live_";
export const KEY_PREFIX_TEST = "dq_test_";
export const KEY_RANDOM_BYTES = 32; // 32 bytes → 43 url-safe base64 chars (no padding)
export const KEY_LOOKUP_PREFIX_LEN = 10; // store the first 10 chars of the key for display

export const PLAN_RANK = Object.freeze({
  free: 0,
  starter: 1,
  pro: 2,
  business: 3,
  enterprise: 4,
});

// Plans that unlock the public API. Keep in sync with src/lib/pricingConfig.js
// (the pricing plan IDs are the source of truth, this list is the API-specific
// gate that says "who can mint keys").
export const API_ELIGIBLE_PLANS = new Set(["business", "enterprise"]);

// Per-plan rate limits (requests per minute, sliding window).
export const PLAN_RATE_LIMITS = Object.freeze({
  business:   { perMinute: 120, monthlyQuota: 25_000 },
  enterprise: { perMinute: 600, monthlyQuota: 250_000 },
});

// ── Format helpers (pure) ────────────────────────────────────────────────────

/**
 * Generate a new API key.
 *   generateApiKey("live")  →  "dq_live_<43 random base64url chars>"
 *   generateApiKey("test")  →  "dq_test_<…>"
 */
export function generateApiKey(env, { randomFn = randomBytes } = {}) {
  if (env !== "live" && env !== "test") {
    throw new Error(`generateApiKey: env must be "live" or "test", got "${env}"`);
  }
  const prefix = env === "live" ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST;
  const body = randomFn(KEY_RANDOM_BYTES).toString("base64url");
  return `${prefix}${body}`;
}

/**
 * Hash a plaintext key for storage / lookup. SHA-256 hex.
 * Pure: deterministic, no I/O.
 */
export function hashApiKey(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length < 10) {
    throw new Error("hashApiKey: key must be a string of at least 10 characters");
  }
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Pull the env out of a key ("dq_live_…" → "live"). Returns null for malformed
 * keys so callers can reject with a clear "invalid API key" error rather than
 * a generic 500.
 */
export function envOf(plaintext) {
  if (typeof plaintext !== "string") return null;
  if (plaintext.startsWith(KEY_PREFIX_LIVE)) return "live";
  if (plaintext.startsWith(KEY_PREFIX_TEST)) return "test";
  return null;
}

/**
 * The short, human-friendly label shown in the Account UI. Uses the first
 * KEY_LOOKUP_PREFIX_LEN characters of the prefix. Example:
 *   "dq_live_aB3xQzY7MnP…" → "dq_live_aB3x…"
 */
export function labelFor(plaintext) {
  if (typeof plaintext !== "string") return "";
  const head = plaintext.slice(0, KEY_LOOKUP_PREFIX_LEN);
  if (plaintext.length <= head.length) return head;
  return `${head}…`;
}

/**
 * Lightweight key-shape validator. Returns the first error message, or null if
 * the key looks well-formed. DOES NOT verify that the key exists or has not
 * been revoked — that is the store's job.
 */
export function validateKeyShape(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length < 20) {
    return "API key is too short";
  }
  const env = envOf(plaintext);
  if (!env) {
    return 'API key must start with "dq_live_" or "dq_test_"';
  }
  // base64url alphabet: A-Z a-z 0-9 - _
  if (!/^[A-Za-z0-9_-]+$/.test(plaintext)) {
    return "API key contains invalid characters";
  }
  return null;
}

/**
 * Compute the rate-limit window for a key at a given moment. The window is
 * "current minute UTC". Pure / deterministic.
 */
export function minuteWindow(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  // YYYY-MM-DDTHH:MM:00.000Z — a string that is identical for every request
  // in the same wall-clock minute.
  return d.toISOString().slice(0, 16) + ":00.000Z";
}

/**
 * Determine whether a given plan unlocks the public API. Returns true/false.
 */
export function planEligibleForApi(planId) {
  if (!planId) return false;
  return API_ELIGIBLE_PLANS.has(String(planId).toLowerCase());
}

/**
 * Look up the rate limit for a plan. Falls back to the free tier if the plan
 * is unknown — this is a defense-in-depth "deny by default" rather than an
 * open door.
 */
export function rateLimitForPlan(planId) {
  if (planId && PLAN_RATE_LIMITS[planId]) return PLAN_RATE_LIMITS[planId];
  return { perMinute: 0, monthlyQuota: 0 };
}

/**
 * Resolve the user-id of the request's bearer token. Stub for tests; the
 * real implementation lives in apiKeyStore.js.
 */
export const _internal = {
  KEY_PREFIX_LIVE,
  KEY_PREFIX_TEST,
  KEY_RANDOM_BYTES,
  KEY_LOOKUP_PREFIX_LEN,
  PLAN_RANK,
  API_ELIGIBLE_PLANS,
  PLAN_RATE_LIMITS,
};
