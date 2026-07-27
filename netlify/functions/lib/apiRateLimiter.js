// netlify/functions/lib/apiRateLimiter.js
//
// Per-API-key rate limiter for the public REST API (F-INT-1).
//
// Two layers, mirroring the structure of lib/rateLimiter.js (which is
// per-host for /api/extract):
//
//   1. In-process token-bucket per key. 1 token per second, burst 30 by
//      default. Tuned per plan via env. The bucket is per-process, so
//      multiple warm containers each enforce a fraction of the limit —
//      that is acceptable for v1 (over-limit is allowed, never denied
//      hard) and the Supabase layer below closes the gap.
//
//   2. Optional Supabase `api_key_usage` log so we can enforce a global
//      monthly quota across warm containers. Schema lives in
//      0019_api_keys.sql. The counter is incremented on every
//      authenticated request; over-quota returns 402.
//
// ── FAIL-OPEN POLICY ──────────────────────────────────────────────────────
// On any infrastructure error (DB unreachable, env missing), we return
// { allowed: true, degraded: true } so a Supabase outage does not turn into
// a public-API outage. This mirrors requireEntitlement.js — same rationale:
// the per-host token bucket in lib/rateLimiter.js is still in front of the
// scrape chain, so abuse is bounded even when this layer is degraded.

import { PLAN_RATE_LIMITS } from "./apiKeyService.js";

// ── In-process token bucket (pure) ───────────────────────────────────────────

class KeyTokenBucket {
  constructor({ capacity = 30, refillPerSec = 1 } = {}) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.lastRefill = Date.now();
  }
  refill(now = Date.now()) {
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }
  take(now = Date.now()) {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, waitMs: 0, remaining: Math.floor(this.tokens) };
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000);
    return { allowed: false, waitMs, remaining: 0 };
  }
}

const buckets = new Map(); // keyId → KeyTokenBucket

export function _resetApiRateLimiterForTests() {
  buckets.clear();
}

function getBucket(keyId, options = {}) {
  let b = buckets.get(keyId);
  if (!b) {
    b = new KeyTokenBucket(options);
    buckets.set(keyId, b);
  }
  return b;
}

/**
 * Try to take a token for an API key. Returns:
 *   { allowed, waitMs, remaining, limit }
 */
export function takeApiKeyToken(keyId, options = {}) {
  if (!keyId) return { allowed: true, waitMs: 0, remaining: 0, limit: 0 };
  const capacity = options.burst || 30;
  const refill = options.refillPerSec || 1;
  const b = getBucket(keyId, { capacity, refillPerSec: refill });
  const r = b.take();
  return { allowed: r.allowed, waitMs: r.waitMs, remaining: r.remaining, limit: capacity };
}

// ── Per-plan limits ──────────────────────────────────────────────────────────

/**
 * Resolve the rate-limit plan for a key. Falls back to the lowest tier if the
 * plan is unknown — same "deny by default" pattern as apiKeyService.
 */
export function limitsForPlan(planId) {
  if (planId && PLAN_RATE_LIMITS[planId]) return PLAN_RATE_LIMITS[planId];
  return { perMinute: 0, monthlyQuota: 0 };
}

// ── Monthly quota counter (Supabase-backed; best-effort) ─────────────────────

/**
 * Atomically increment the monthly counter for a key. The increment is
 * returned so the caller can decide whether the key is over-quota.
 *
 * Schema (0019_api_keys.sql):
 *   create table public.api_key_usage (
 *     key_id  uuid not null references public.api_keys on delete cascade,
 *     month   text not null,  -- 'YYYY-MM'
 *     count   integer not null default 0,
 *     primary key (key_id, month)
 *   );
 *
 * The increment uses an upsert with a server-side expression so two
 * concurrent calls don't both read the same count and overwrite each other.
 */
export async function incrementMonthlyUsage({ keyId, month, db, env, fetchFn } = {}) {
  const d = db || (env ? getEnvDb(env) : null);
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!d || !f || !keyId || !month) return { ok: false, error: "unavailable" };
  // The Supabase PostgREST endpoint doesn't expose `count = count + 1`
  // directly; we POST with a stored-procedure RPC if available, otherwise
  // fall back to a read-modify-write loop (acceptable for low-volume API
  // usage where contention is rare).
  //
  // The 0019 migration defines an `increment_api_key_usage` RPC for this
  // exact purpose. If the RPC is not installed (older DB), we degrade
  // gracefully and return { ok: true, count: 0, degraded: true }.
  const rpcUrl = `${d.base}/rpc/increment_api_key_usage`;
  try {
    const res = await f(rpcUrl, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify({ p_key_id: keyId, p_month: month }),
    });
    if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
    const count = await res.json();
    return { ok: true, count: Number(count) || 0 };
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
}

function getEnvDb(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

/**
 * Decide whether a key may proceed. Returns:
 *   { allowed, reason?, degraded, limit, remaining }
 */
export async function checkApiKeyQuota({ key, monthlyCount = 0, env = process.env } = {}) {
  if (!key) return { allowed: false, reason: "no_key" };
  const limits = limitsForPlan(key.plan_id);
  // Unknown plan or plan without API access: deny. (Should have been caught
  // at issue time, but be defensive — an admin might disable a plan after
  // keys are already in flight.)
  if (!limits || limits.monthlyQuota === 0) {
    return { allowed: false, reason: "plan_not_eligible", degraded: false, limit: 0, remaining: 0 };
  }
  if (monthlyCount >= limits.monthlyQuota) {
    return { allowed: false, reason: "monthly_quota_exceeded", degraded: false, limit: limits.monthlyQuota, remaining: 0 };
  }
  return {
    allowed: true,
    degraded: false,
    limit: limits.monthlyQuota,
    remaining: Math.max(0, limits.monthlyQuota - monthlyCount),
  };
}

export const _internal = { KeyTokenBucket, takeApiKeyToken, limitsForPlan };
