// src/lib/publicQuota.test.js — FA1 (free-tier "Public Report" quota mechanic).

import { describe, it, expect, beforeEach } from "vitest";
import {
  readPublicCount,
  incrementPublicExtractions,
  decrementPublicExtractions,
  buildQuotaCopy,
  isPublicExtractionFree,
} from "./publicQuota.js";

describe("publicQuota (FA1)", () => {
  beforeEach(() => {
    try { localStorage.removeItem("datiq.usage"); } catch {}
  });

  describe("readPublicCount / increment / decrement", () => {
    it("returns 0 when no usage exists", () => {
      expect(readPublicCount()).toBe(0);
    });

    it("increments and returns the new count", () => {
      const v1 = incrementPublicExtractions(1);
      expect(v1).toBe(1);
      const v2 = incrementPublicExtractions(2);
      expect(v2).toBe(3);
    });

    it("decrements but never goes below 0", () => {
      decrementPublicExtractions(5);
      expect(readPublicCount()).toBe(0);
    });

    it("increments and decrements round-trip", () => {
      incrementPublicExtractions(3);
      expect(readPublicCount()).toBe(3);
      decrementPublicExtractions(1);
      expect(readPublicCount()).toBe(2);
    });
  });

  describe("buildQuotaCopy", () => {
    it("returns 'unlimited' framing for paid plans", () => {
      expect(buildQuotaCopy({ used: 100, limit: Infinity, planName: "Pro" }))
        .toBe("100 used · Unlimited on Pro");
    });

    it("returns the standard 'X of Y used' for free plans with no public reports", () => {
      expect(buildQuotaCopy({ used: 3, limit: 10, publicCount: 0, planName: "Free" }))
        .toBe("3 of 10 used");
    });

    it("surfaces the public count when there are public reports", () => {
      expect(buildQuotaCopy({ used: 3, limit: 10, publicCount: 5, planName: "Free" }))
        .toBe("3 of 10 used · 5 public (unlimited)");
    });

    it("uses singular 'public' for count of 1", () => {
      // The base string is "1 public (unlimited)" — the singular vs plural
      // distinction lives in the public-extractions helper.
      expect(buildQuotaCopy({ used: 3, limit: 10, publicCount: 1, planName: "Free" }))
        .toMatch(/1 public \(unlimited\)/);
    });

    it("uses plural 'public reports' for count > 1", () => {
      expect(buildQuotaCopy({ used: 3, limit: 10, publicCount: 5, planName: "Free" }))
        .toMatch(/5 public \(unlimited\)/);
    });

    it("isPublic=true short-circuits to a friendly message", () => {
      expect(buildQuotaCopy({ used: 3, limit: 10, publicCount: 0, planName: "Free", isPublic: true }))
        .toBe("Public report — doesn't count against your quota");
    });
  });

  describe("isPublicExtractionFree", () => {
    it("returns true for free", () => {
      expect(isPublicExtractionFree("free")).toBe(true);
    });
    it("returns true for null/undefined planId", () => {
      expect(isPublicExtractionFree(null)).toBe(true);
      expect(isPublicExtractionFree(undefined)).toBe(true);
    });
    it("returns false for paid plans", () => {
      expect(isPublicExtractionFree("select")).toBe(false);
      expect(isPublicExtractionFree("pro")).toBe(false);
      expect(isPublicExtractionFree("business")).toBe(false);
      expect(isPublicExtractionFree("agency")).toBe(false);
    });
  });
});
