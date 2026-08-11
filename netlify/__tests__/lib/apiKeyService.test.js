// netlify/__tests__/lib/apiKeyService.test.js
import { describe, it, expect, vi } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  envOf,
  labelFor,
  validateKeyShape,
  minuteWindow,
  planEligibleForApi,
  rateLimitForPlan,
  KEY_PREFIX_LIVE,
  KEY_PREFIX_TEST,
  _internal,
} from "../../functions/lib/apiKeyService.js";

describe("apiKeyService", () => {
  describe("generateApiKey", () => {
    it("generates a dq_live_ key when env=live", () => {
      const k = generateApiKey("live");
      expect(k.startsWith(KEY_PREFIX_LIVE)).toBe(true);
      // 7-char prefix + 32 bytes → 43 base64url chars (no padding)
      expect(k.length).toBe(KEY_PREFIX_LIVE.length + 43);
    });
    it("generates a dq_test_ key when env=test", () => {
      const k = generateApiKey("test");
      expect(k.startsWith(KEY_PREFIX_TEST)).toBe(true);
    });
    it("uses the injected random function (deterministic in tests)", () => {
      const fixed = Buffer.alloc(32, 7);
      const k = generateApiKey("live", { randomFn: () => fixed });
      expect(k.startsWith(KEY_PREFIX_LIVE)).toBe(true);
      // Two calls with the same injected randomness produce the same key
      const k2 = generateApiKey("live", { randomFn: () => fixed });
      expect(k).toBe(k2);
    });
    it("rejects invalid env values", () => {
      expect(() => generateApiKey("prod")).toThrow(/env must be/);
      expect(() => generateApiKey(undefined)).toThrow();
    });
    it("emits only base64url characters after the prefix", () => {
      const k = generateApiKey("live");
      const body = k.slice(KEY_PREFIX_LIVE.length);
      expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("hashApiKey", () => {
    it("is deterministic and 64 hex chars (SHA-256)", () => {
      const a = hashApiKey("dq_live_abc");
      const b = hashApiKey("dq_live_abc");
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });
    it("rejects short / non-string input", () => {
      expect(() => hashApiKey("")).toThrow();
      expect(() => hashApiKey("short")).toThrow();
      expect(() => hashApiKey(null)).toThrow();
      expect(() => hashApiKey(undefined)).toThrow();
      expect(() => hashApiKey(12345)).toThrow();
    });
    it("produces different hashes for different keys", () => {
      const a = hashApiKey("dq_live_AAAAAAAAAA");
      const b = hashApiKey("dq_live_BBBBBBBBBB");
      expect(a).not.toBe(b);
    });
  });

  describe("envOf", () => {
    it("returns 'live' for dq_live_ keys", () => {
      expect(envOf("dq_live_abc")).toBe("live");
    });
    it("returns 'test' for dq_test_ keys", () => {
      expect(envOf("dq_test_abc")).toBe("test");
    });
    it("returns null for malformed input", () => {
      expect(envOf("")).toBeNull();
      expect(envOf(null)).toBeNull();
      expect(envOf("dq_prod_abc")).toBeNull();
      expect(envOf("dq_live")).toBeNull();
    });
  });

  describe("labelFor", () => {
    it("truncates a key to the first 10 chars + ellipsis", () => {
      // KEY_LOOKUP_PREFIX_LEN = 10, so "dq_live_aB3xQzY7MnP9…" → "dq_live_aB…"
      expect(labelFor("dq_live_aB3xQzY7MnP9abcdefghij")).toBe("dq_live_aB…");
    });
    it("returns the full key when it is shorter than the prefix length", () => {
      expect(labelFor("dq_live_x")).toBe("dq_live_x");
    });
    it("returns empty string for non-strings", () => {
      expect(labelFor(null)).toBe("");
      expect(labelFor(undefined)).toBe("");
    });
  });

  describe("validateKeyShape", () => {
    it("accepts a well-formed key", () => {
      const k = generateApiKey("live");
      expect(validateKeyShape(k)).toBeNull();
    });
    it("rejects short keys", () => {
      expect(validateKeyShape("dq_live_x")).toMatch(/too short/);
    });
    it("rejects keys with the wrong prefix", () => {
      expect(validateKeyShape("dq_prod_abcdefghijklmnop")).toMatch(/dq_live_|dq_test_/);
    });
    it("rejects keys with invalid base64url characters", () => {
      // 20+ chars, valid prefix, but contains a space
      expect(validateKeyShape("dq_live_abc def ghi jkl")).toMatch(/invalid characters/);
    });
  });

  describe("minuteWindow", () => {
    it("returns an ISO string truncated to the minute", () => {
      const w = minuteWindow(new Date("2026-07-28T10:42:37.123Z"));
      expect(w).toBe("2026-07-28T10:42:00.000Z");
    });
    it("coerces non-Date input", () => {
      const w = minuteWindow("2026-07-28T10:42:37Z");
      expect(w).toBe("2026-07-28T10:42:00.000Z");
    });
  });

  describe("planEligibleForApi", () => {
    it("accepts business and enterprise", () => {
      expect(planEligibleForApi("business")).toBe(true);
      expect(planEligibleForApi("enterprise")).toBe(true);
      expect(planEligibleForApi("Business")).toBe(true); // case-insensitive
    });
    it("rejects free, starter, pro, and unknown plans", () => {
      expect(planEligibleForApi("free")).toBe(false);
      expect(planEligibleForApi("starter")).toBe(false);
      expect(planEligibleForApi("pro")).toBe(false);
      expect(planEligibleForApi("unknown")).toBe(false);
      expect(planEligibleForApi(null)).toBe(false);
      expect(planEligibleForApi("")).toBe(false);
    });
  });

  describe("rateLimitForPlan", () => {
    it("returns per-minute + monthly quota for known plans", () => {
      expect(rateLimitForPlan("business")).toEqual({ perMinute: 120, monthlyQuota: 25_000 });
      expect(rateLimitForPlan("enterprise")).toEqual({ perMinute: 600, monthlyQuota: 250_000 });
    });
    it("returns 0/0 for unknown plans (deny by default)", () => {
      expect(rateLimitForPlan("free")).toEqual({ perMinute: 0, monthlyQuota: 0 });
      expect(rateLimitForPlan("nope")).toEqual({ perMinute: 0, monthlyQuota: 0 });
    });
  });

  describe("_internal", () => {
    it("exposes the prefix constants", () => {
      expect(_internal.KEY_PREFIX_LIVE).toBe("dq_live_");
      expect(_internal.KEY_PREFIX_TEST).toBe("dq_test_");
      expect(_internal.KEY_RANDOM_BYTES).toBe(32);
    });
  });
});
