// netlify/functions/lib/rateLimiter.js — FD3 (per-domain rate limiter).
//
// Council intent: "Prevents shared-infra IP bans (one abusive user
// blackholes everyone)".
//
// Two-layer design:
//   1. In-process token-bucket per host. Defaults: 1 request per 1s,
//      burst of 4. Configurable via env vars.
//   2. Optional Supabase `rate_limit_log` table for cross-warm-container
//      enforcement. v1 ships with the in-process layer; the Supabase
//      layer is a follow-up (requires a cheap counter table that we
//      already have the schema for).
//
// The limiter is permissive: a "wait this many ms" hint is returned
// rather than a hard reject. The caller (extract.js) waits and retries;
// a hard 429 would interrupt the SPA UX.

const DEFAULT_BUCKET_CAPACITY = 4;
const DEFAULT_REFILL_RATE = 1; // tokens per second
const DEFAULT_BURST = 4;

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

class TokenBucket {
  constructor({ capacity = DEFAULT_BUCKET_CAPACITY, refillPerSec = DEFAULT_REFILL_RATE } = {}) {
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
  /**
   * Take one token. Returns { allowed, waitMs, remaining }.
   * If `allowed` is false, the caller should sleep `waitMs` and retry.
   */
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

// Per-host bucket registry.
const buckets = new Map(); // host → TokenBucket

export function _resetRateLimiterForTests() {
  buckets.clear();
}

function getBucket(host, options = {}) {
  let b = buckets.get(host);
  if (!b) {
    b = new TokenBucket({
      capacity: options.capacity || DEFAULT_BUCKET_CAPACITY,
      refillPerSec: options.refillPerSec || DEFAULT_REFILL_RATE,
    });
    buckets.set(host, b);
  }
  return b;
}

/**
 * Try to consume a token for `url`'s host. Returns:
 *   { allowed, waitMs, host }
 *
 * Callers should sleep `waitMs` and retry if `allowed` is false.
 */
export function takeToken(url, options = {}) {
  const host = hostOf(url);
  if (!host) return { allowed: true, waitMs: 0, host: "" };
  const b = getBucket(host, options);
  const r = b.take();
  return { allowed: r.allowed, waitMs: r.waitMs, host, remaining: r.remaining };
}

/**
 * Wait until a token is available, then take it. Uses setTimeout under the
 * hood. Resolves with the same shape as takeToken().
 */
export function takeTokenBlocking(url, options = {}) {
  return new Promise((resolve) => {
    const tryOnce = () => {
      const r = takeToken(url, options);
      if (r.allowed) return resolve(r);
      setTimeout(tryOnce, Math.min(r.waitMs, 2000));
    };
    tryOnce();
  });
}

// ── Configuration helpers (env-driven) ───────────────────────────────────────
export function configFromEnv(env = process.env) {
  return {
    capacity: parseInt(env.RATE_LIMIT_BURST || env.RL_BURST || DEFAULT_BURST, 10) || DEFAULT_BURST,
    refillPerSec: parseFloat(env.RATE_LIMIT_REFILL || env.RL_REFILL || DEFAULT_REFILL_RATE) || DEFAULT_REFILL_RATE,
  };
}

export const _internal = { TokenBucket, DEFAULT_BUCKET_CAPACITY, DEFAULT_REFILL_RATE, DEFAULT_BURST };
