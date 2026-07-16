// collectionsService.test.js — Groke QW#3 (col-2 variant) unit tests.
import { describe, it, expect } from "vitest";
import {
  normalizeCollectionName,
  summariseCollections,
  filterByCollection,
  COLLECTION_LIMITS,
} from "./collectionsService.js";

describe("Groke QW#3 — collectionsService pure helpers", () => {
  describe("normalizeCollectionName", () => {
    it("trims whitespace", () => {
      expect(normalizeCollectionName("  Stripe research  ")).toBe("Stripe research");
    });
    it("collapses internal whitespace", () => {
      expect(normalizeCollectionName("Q2   competitors")).toBe("Q2 competitors");
    });
    it("strips unsafe characters", () => {
      expect(normalizeCollectionName("Bad<name>!@#")).toBe("Badname");
    });
    it("preserves common safe punctuation", () => {
      expect(normalizeCollectionName("Acme (Q2) & Co.")).toBe("Acme (Q2) & Co.");
    });
    it("truncates to MAX_NAME_LEN", () => {
      const long = "a".repeat(200);
      const out = normalizeCollectionName(long);
      expect(out.length).toBe(COLLECTION_LIMITS.MAX_NAME_LEN);
    });
    it("returns '' for empty / null", () => {
      expect(normalizeCollectionName("")).toBe("");
      expect(normalizeCollectionName("   ")).toBe("");
      expect(normalizeCollectionName(null)).toBe("");
      expect(normalizeCollectionName(undefined)).toBe("");
    });
  });

  describe("summariseCollections", () => {
    it("counts items per collection and sorts by count desc", () => {
      const items = [
        { id: "1", collection: "Stripe", created_at: "2026-07-10" },
        { id: "2", collection: "Stripe", created_at: "2026-07-12" },
        { id: "3", collection: "Q2",     created_at: "2026-07-11" },
      ];
      const out = summariseCollections(items);
      expect(out[0]).toMatchObject({ name: "Stripe", count: 2 });
      expect(out[1]).toMatchObject({ name: "Q2", count: 1 });
    });
    it("tracks the latest created_at per collection", () => {
      const items = [
        { id: "1", collection: "A", created_at: "2026-07-10" },
        { id: "2", collection: "A", created_at: "2026-07-15" },
        { id: "3", collection: "A", created_at: "2026-07-12" },
      ];
      const out = summariseCollections(items);
      expect(out[0].latestAt).toBe("2026-07-15");
    });
    it("skips items without a collection", () => {
      const items = [
        { id: "1", collection: "A" },
        { id: "2" },
        { id: "3", collection: null },
        { id: "4", collection: "" },
      ];
      const out = summariseCollections(items);
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe("A");
    });
    it("handles empty input", () => {
      expect(summariseCollections([])).toEqual([]);
      expect(summariseCollections(null)).toEqual([]);
    });
  });

  describe("filterByCollection", () => {
    const items = [
      { id: "1", collection: "A" },
      { id: "2", collection: "B" },
      { id: "3" },
      { id: "4", collection: null },
    ];
    it("returns all items for empty filter", () => {
      expect(filterByCollection(items, "")).toHaveLength(4);
    });
    it("filters by exact collection name", () => {
      const out = filterByCollection(items, "A");
      expect(out.map((i) => i.id)).toEqual(["1"]);
    });
    it("filters to untagged items when sentinel is passed", () => {
      const out = filterByCollection(items, "__untagged__");
      expect(out.map((i) => i.id).sort()).toEqual(["3", "4"]);
    });
  });
});
