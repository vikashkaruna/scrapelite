// tagsService.test.js — Groke QW#2 unit tests.
import { describe, it, expect } from "vitest";
import {
  addTagPure,
  removeTagPure,
  suggestFromUrl,
  suggestTags,
  TAG_LIMITS,
} from "./tagsService.js";

describe("Groke QW#2 — tagsService pure helpers", () => {
  describe("addTagPure", () => {
    it("adds a normalised tag", () => {
      expect(addTagPure([], "  Research  ")).toEqual(["research"]);
    });
    it("lowercases + hyphenates whitespace", () => {
      expect(addTagPure([], "  Pricing Tier ")).toEqual(["pricing-tier"]);
    });
    it("strips unsafe characters", () => {
      expect(addTagPure([], "<script>alert(1)</script>")).toEqual(["scriptalert1script"]);
    });
    it("truncates to MAX_TAG_LEN", () => {
      const long = "a".repeat(200);
      const out = addTagPure([], long);
      expect(out[0].length).toBe(TAG_LIMITS.MAX_TAG_LEN);
    });
    it("dedupes (case-insensitive)", () => {
      expect(addTagPure(["stripe"], "STRIPE")).toEqual(["stripe"]);
    });
    it("no-ops on empty / whitespace input", () => {
      expect(addTagPure(["x"], "")).toEqual(["x"]);
      expect(addTagPure(["x"], "   ")).toEqual(["x"]);
      expect(addTagPure(["x"], null)).toEqual(["x"]);
    });
    it("caps at MAX_TAGS_PER_ITEM", () => {
      const tags = Array.from({ length: TAG_LIMITS.MAX_TAGS_PER_ITEM }, (_, i) => `t${i}`);
      const out = addTagPure(tags, "overflow");
      expect(out.length).toBe(TAG_LIMITS.MAX_TAGS_PER_ITEM);
      expect(out).toEqual(tags); // unchanged
    });
  });

  describe("removeTagPure", () => {
    it("removes an existing tag (case-insensitive)", () => {
      expect(removeTagPure(["stripe", "pricing"], "STRIPE")).toEqual(["pricing"]);
    });
    it("returns the same array when the tag isn't present", () => {
      expect(removeTagPure(["stripe"], "missing")).toEqual(["stripe"]);
    });
    it("handles non-array tags gracefully", () => {
      expect(removeTagPure(undefined, "x")).toEqual([]);
    });
  });

  describe("suggestFromUrl", () => {
    it("returns the host label for a plain domain", () => {
      expect(suggestFromUrl("https://stripe.com/pricing")).toBe("stripe");
    });
    it("strips www.", () => {
      expect(suggestFromUrl("https://www.stripe.com/")).toBe("stripe");
    });
    it("handles multi-part TLDs (co.uk)", () => {
      expect(suggestFromUrl("https://acme.co.uk/about")).toBe("acme");
    });
    it("handles subdomains (uses the registrable part)", () => {
      expect(suggestFromUrl("https://blog.stripe.com/post")).toBe("stripe");
    });
    it("returns empty string for invalid URLs", () => {
      expect(suggestFromUrl("not a url")).toBe("");
      expect(suggestFromUrl("")).toBe("");
      expect(suggestFromUrl(null)).toBe("");
    });
  });

  describe("suggestTags", () => {
    it("prefix matches rank first, then substring matches", () => {
      const known = new Set(["stripe", "stripe-checkout", "subscription", "pricing"]);
      const out = suggestTags("str", known);
      expect(out[0]).toBe("stripe");         // exact prefix
      expect(out).toContain("stripe-checkout"); // also prefix
      expect(out).not.toContain("pricing");  // doesn't contain "str"
    });
    it("caps at MAX_TAG_SUGGESTIONS", () => {
      const known = new Set(Array.from({ length: 50 }, (_, i) => `tag-${i}`));
      const out = suggestTags("tag", known);
      expect(out.length).toBeLessThanOrEqual(TAG_LIMITS.MAX_TAG_SUGGESTIONS);
    });
    it("excludes exact matches from the result (user is typing it)", () => {
      const known = new Set(["stripe", "subscription"]);
      const out = suggestTags("stripe", known);
      expect(out).not.toContain("stripe");
    });
    it("returns [] for empty / no-match queries", () => {
      expect(suggestTags("", new Set(["x"]))).toEqual([]);
      expect(suggestTags("zzz", new Set(["x"]))).toEqual([]);
    });
    it("handles undefined / non-Set input", () => {
      expect(suggestTags("x", null)).toEqual([]);
      expect(suggestTags("x", undefined)).toEqual([]);
    });
  });
});
