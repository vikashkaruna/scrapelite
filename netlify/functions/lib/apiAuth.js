// netlify/functions/lib/apiAuth.js
//
// Authentication middleware for the public REST API (F-INT-1).
//
// Reads the Authorization header, looks up the key, applies the per-key
// rate limit, attaches a request-scoped `auth` object to the event for the
// downstream handler to consume. All response shapes are centralised in
// this file so error envelopes stay consistent across every endpoint.
//
// Response envelope (matches docs/DatIQ-Developer-API.md "Errors" section):
//   { "error": { "code": "invalid_request", "message": "..." } }
//
// Standard status codes (mirrors the existing /api/* functions):
//   400  invalid_request       — bad input
//   401  unauthorized          — missing or invalid key
//   402  quota_exceeded        — monthly quota reached
//   403  forbidden             — key's plan does not include this capability
//   404  not_found             — resource missing
//   422  unprocessable         — could not process (e.g. upstream scrape failed)
//   429  rate_limited          — per-minute burst exhausted
//   500  server_error          — unexpected
//
// ── FAIL-OPEN ON INFRASTRUCTURE ────────────────────────────────────────────
// A Supabase outage must NOT take down the public API. The per-key token
// bucket is in-process, so it can still rate-limit; the only thing that
// fails open is the monthly quota check (we mark `degraded: true` in the
// response headers so the user can see).

import { findActiveApiKey, touchApiKey } from "./apiKeyStore.js";
import { validateKeyShape, envOf } from "./apiKeyService.js";
import { takeApiKeyToken } from "./apiRateLimiter.js";

// ── Response helpers ─────────────────────────────────────────────────────────

export function errorBody(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

export function errorResponse(statusCode, code, message, extra = {}, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      ...headers,
    },
    body: JSON.stringify(errorBody(code, message, extra)),
  };
}

/**
 * Success response. Standardised headers so every endpoint reports the
 * same rate-limit metadata. Per the developer API doc:
 *   X-RateLimit-Limit       — per-minute ceiling
 *   X-RateLimit-Remaining   — tokens left in the current window
 *   X-RateLimit-Reset       — Unix seconds when the bucket refills
 */
export function okResponse(statusCode, body, { rateLimit, degraded } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
  if (rateLimit) {
    headers["X-RateLimit-Limit"] = String(rateLimit.limit ?? 0);
    headers["X-RateLimit-Remaining"] = String(rateLimit.remaining ?? 0);
    headers["X-RateLimit-Reset"] = String(rateLimit.reset ?? 0);
  }
  if (degraded) headers["X-DatIQ-Degraded"] = "true";
  return { statusCode, headers, body: JSON.stringify(body) };
}

// ── Header parsing ───────────────────────────────────────────────────────────

/**
 * Pull the bearer token out of an event. Accepts both `authorization` and
 * `Authorization` (Netlify normalises headers inconsistently across
 * function versions).
 */
export function bearerFromEvent(event) {
  const h = event?.headers || {};
  return h.authorization || h.Authorization || "";
}

/**
 * Strip "Bearer " / "bearer " prefix and return the raw key, or null if
 * the header doesn't look like a bearer request.
 */
export function extractBearer(headerValue) {
  if (typeof headerValue !== "string") return null;
  const trimmed = headerValue.trim();
  if (!/^Bearer\s+/i.test(trimmed)) return null;
  return trimmed.replace(/^Bearer\s+/i, "").trim();
}

// ── The auth pipeline ────────────────────────────────────────────────────────

/**
 * Authenticate a request. Returns one of:
 *   { ok: true,  auth: { key, user, plan, rateLimit } }
 *   { ok: false, response: <Netlify function response> }   — short-circuits
 *
 * The caller is expected to check `result.ok`. If false, return
 * `result.response` directly. If true, use `result.auth` for downstream
 * scoping.
 */
export async function authenticateApiRequest(event, options = {}) {
  const { env = process.env, fetchFn, skipRateLimit = false } = options;

  // 1. OPTIONS preflight — let it through. The router decides whether
  //    the actual endpoint accepts the method; preflight never carries
  //    an Authorization header that we need to validate.
  if (event.httpMethod === "OPTIONS") {
    return {
      ok: false,
      response: {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        },
        body: "",
      },
    };
  }

  // 2. Bearer parsing
  const raw = bearerFromEvent(event);
  const token = extractBearer(raw);
  if (!token) {
    return {
      ok: false,
      response: errorResponse(401, "unauthorized", 'Missing "Authorization: Bearer <api_key>" header.'),
    };
  }

  // 3. Shape check (cheap; rejects obvious garbage before hitting the DB)
  const shapeErr = validateKeyShape(token);
  if (shapeErr) {
    return { ok: false, response: errorResponse(401, "unauthorized", shapeErr) };
  }
  const keyEnv = envOf(token);

  // 4. DB lookup
  const lookup = await findActiveApiKey(token, { env });
  if (!lookup.ok) {
    // Lookup itself errored. Fail OPEN on infra errors (matches the
    // requireEntitlement.js policy) — but we still deny because we
    // cannot confirm the key. Surface the degraded flag so the user
    // knows we couldn't verify their key.
    if (lookup.error === "service_db_unconfigured" || lookup.error === "network") {
      return {
        ok: false,
        response: errorResponse(
          503,
          "service_unavailable",
          "API authentication is temporarily unavailable.",
          { degraded: true },
        ),
      };
    }
    return { ok: false, response: errorResponse(500, "server_error", `auth lookup failed: ${lookup.error}`) };
  }
  if (!lookup.key) {
    return { ok: false, response: errorResponse(401, "unauthorized", "API key is invalid, revoked, or expired.") };
  }
  const key = lookup.key;
  // Sanity: the env embedded in the key string should match the env stored
  // at issue time. If they differ, something is very wrong.
  if (key.env && keyEnv && key.env !== keyEnv) {
    return { ok: false, response: errorResponse(401, "unauthorized", "API key env mismatch.") };
  }

  // 5. Per-key rate limit (in-process token bucket)
  if (!skipRateLimit) {
    const rl = takeApiKeyToken(key.id);
    if (!rl.allowed) {
      return {
        ok: false,
        response: errorResponse(
          429,
          "rate_limited",
          `Per-key rate limit exceeded; retry in ${rl.waitMs}ms.`,
          {},
          {
            "Retry-After": String(Math.ceil(rl.waitMs / 1000)),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
          },
        ),
      };
    }
    // 6. Touch last_used_at (fire-and-forget)
    touchApiKey(key.id, { env }).catch(() => {});
    return {
      ok: true,
      auth: {
        key,
        user: { id: key.user_id },
        env: key.env,
        plan: key.plan_id,
        rateLimit: {
          limit: rl.limit,
          remaining: rl.remaining,
          reset: Math.floor(Date.now() / 1000) + 60,
        },
      },
    };
  }
  return {
    ok: true,
    auth: {
      key,
      user: { id: key.user_id },
      env: key.env,
      plan: key.plan_id,
      rateLimit: { limit: 0, remaining: 0, reset: 0 },
    },
  };
}

export const _internal = { extractBearer, bearerFromEvent, errorBody, errorResponse, okResponse };
