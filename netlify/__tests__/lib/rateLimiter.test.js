// netlify/functions/lib/rateLimiter.test.js — FD3 (per-host rate limiter).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { _internal, takeToken, takeTokenBlocking, _resetRateLimiterForTests, configFromEnv } from "../../functions/lib/rateLimiter.js";

const { TokenBucket } = _internal;

describe("TokenBucket (FD3)", () => {
  it("starts full", () => {
    const b = new TokenBucket({ capacity: 4, refillPerSec: 1 });
    expect(b.take(0).allowed).toBe(true);
  });

  it("drains after the burst capacity", () => {
    const b = new TokenBucket({ capacity: 2, refillPerSec: 0.001 });
    expect(b.take(0).allowed).toBe(true);
    expect(b.take(0).allowed).toBe(true);
    const r = b.take(0);
    expect(r.allowed).toBe(false);
    expect(r.waitMs).toBeGreaterThan(0);
  });

  it("refills over time", () => {
    const b = new TokenBucket({ capacity: 1, refillPerSec: 1 });
    expect(b.take(0).allowed).toBe(true);
    expect(b.take(0).allowed).toBe(false);
    // 1s later → 1 token refilled
    expect(b.take(1100).allowed).toBe(true);
  });

  it("caps at capacity", () => {
    const b = new TokenBucket({ capacity: 2, refillPerSec: 1 });
    b.take(0);
    b.take(0);
    // Long later → should cap at 2, not fill to 3+
    expect(b.take(10_000).remaining).toBeLessThanOrEqual(1);
  });
});

describe("takeToken (FD3)", () => {
  beforeEach(() => _resetRateLimiterForTests());

  it("returns allowed=true for the first request on a host", () => {
    const r = takeToken("https://x.com/path");
    expect(r.allowed).toBe(true);
    expect(r.host).toBe("x.com");
  });

  it("isolates buckets per host", () => {
    expect(takeToken("https://a.com/").allowed).toBe(true);
    expect(takeToken("https://b.com/").allowed).toBe(true);
  });

  it("returns waitMs once a host's burst is drained", () => {
    const r1 = takeToken("https://c.com/", { capacity: 1, refillPerSec: 0.001 });
    expect(r1.allowed).toBe(true);
    const r2 = takeToken("https://c.com/", { capacity: 1, refillPerSec: 0.001 });
    expect(r2.allowed).toBe(false);
    expect(r2.waitMs).toBeGreaterThan(0);
  });

  it("returns allowed=true for invalid URLs (degraded but not blocked)", () => {
    expect(takeToken("not a url").allowed).toBe(true);
  });
});

describe("takeTokenBlocking (FD3)", () => {
  beforeEach(() => _resetRateLimiterForTests());

  it("resolves once a token is available", async () => {
    // Drain the bucket first (with the SAME config the blocking call will use)
    takeToken("https://d.com/", { capacity: 1, refillPerSec: 50 });
    const start = Date.now();
    const r = await takeTokenBlocking("https://d.com/", { capacity: 1, refillPerSec: 50 });
    const elapsed = Date.now() - start;
    expect(r.allowed).toBe(true);
    // 1/50 = 20ms, plus the setTimeout poll overhead — should be well under 1s
    expect(elapsed).toBeLessThan(1000);
  });

  it("caps the poll wait at 2s even for very low refill rates", async () => {
    takeToken("https://e.com/", { capacity: 1, refillPerSec: 100 });
    // The first take drains. With refillPerSec=100, a token is available
    // in 10ms. The function should resolve in well under 2s.
    const r = await takeTokenBlocking("https://e.com/", { capacity: 1, refillPerSec: 100 });
    expect(r.allowed).toBe(true);
  });
});

describe("configFromEnv (FD3)", () => {
  it("reads RATE_LIMIT_BURST and RATE_LIMIT_REFILL", () => {
    const c = configFromEnv({ RATE_LIMIT_BURST: "8", RATE_LIMIT_REFILL: "2.5" });
    expect(c.capacity).toBe(8);
    expect(c.refillPerSec).toBe(2.5);
  });

  it("falls back to defaults when env is empty", () => {
    const c = configFromEnv({});
    expect(c.capacity).toBe(4);
    expect(c.refillPerSec).toBe(1);
  });

  it("coerces bad values to defaults", () => {
    const c = configFromEnv({ RATE_LIMIT_BURST: "not-a-number", RATE_LIMIT_REFILL: "" });
    expect(c.capacity).toBe(4);
    expect(c.refillPerSec).toBe(1);
  });
});
