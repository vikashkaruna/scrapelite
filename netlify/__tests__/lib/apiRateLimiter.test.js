// netlify/__tests__/lib/apiRateLimiter.test.js
import { describe, it, expect, beforeEach } from "vitest";
import {
  takeApiKeyToken,
  limitsForPlan,
  checkApiKeyQuota,
  _resetApiRateLimiterForTests,
  _internal,
} from "../../functions/lib/apiRateLimiter.js";

describe("apiRateLimiter", () => {
  beforeEach(() => {
    _resetApiRateLimiterForTests();
  });

  describe("takeApiKeyToken", () => {
    it("returns allowed:true with a fresh bucket", () => {
      const r = takeApiKeyToken("k1");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBeGreaterThan(0);
      expect(r.limit).toBe(30);
    });
    it("drains the bucket and then refuses", () => {
      // Burst is 30 by default; take 30 then expect refusal
      for (let i = 0; i < 30; i++) {
        const r = takeApiKeyToken("k1");
        expect(r.allowed).toBe(true);
      }
      const denied = takeApiKeyToken("k1");
      expect(denied.allowed).toBe(false);
      expect(denied.waitMs).toBeGreaterThan(0);
    });
    it("uses custom burst / refill when provided", () => {
      const r = takeApiKeyToken("k2", { burst: 2, refillPerSec: 0.5 });
      expect(r.limit).toBe(2);
      // 2-token bucket: the very first call above took 1, leaving 1 token.
      // The next call should be allowed, and the one after that should be
      // denied (bucket is empty; refill is 0.5/sec, so the next token
      // arrives in ~2 seconds, well after these calls).
      expect(takeApiKeyToken("k2", { burst: 2, refillPerSec: 0.5 }).allowed).toBe(true);
      expect(takeApiKeyToken("k2", { burst: 2, refillPerSec: 0.5 }).allowed).toBe(false);
    });
    it("returns allowed:true for missing keyId (defensive)", () => {
      const r = takeApiKeyToken("");
      expect(r.allowed).toBe(true);
      expect(r.limit).toBe(0);
    });
  });

  describe("limitsForPlan", () => {
    it("returns per-minute + monthly quota for known plans", () => {
      expect(limitsForPlan("business")).toEqual({ perMinute: 120, monthlyQuota: 25_000 });
      expect(limitsForPlan("enterprise")).toEqual({ perMinute: 600, monthlyQuota: 250_000 });
    });
    it("returns 0/0 for unknown plans (deny by default)", () => {
      expect(limitsForPlan("free")).toEqual({ perMinute: 0, monthlyQuota: 0 });
    });
  });

  describe("checkApiKeyQuota", () => {
    it("denies when the plan has no API access", async () => {
      const r = await checkApiKeyQuota({ key: { plan_id: "free" } });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("plan_not_eligible");
    });
    it("denies when the monthly quota is exhausted", async () => {
      const r = await checkApiKeyQuota({ key: { plan_id: "business" }, monthlyCount: 25_000 });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("monthly_quota_exceeded");
    });
    it("allows when under the quota", async () => {
      const r = await checkApiKeyQuota({ key: { plan_id: "business" }, monthlyCount: 100 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(25_000 - 100);
    });
    it("denies when no key is passed", async () => {
      const r = await checkApiKeyQuota({});
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("no_key");
    });
  });

  describe("_internal", () => {
    it("exposes the bucket primitive", () => {
      expect(_internal.KeyTokenBucket).toBeDefined();
    });
  });
});
