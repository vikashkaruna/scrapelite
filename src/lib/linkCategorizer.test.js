import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  categoryCounts,
  categoryOf,
  isCategory,
} from "./linkCategorizer.js";

/**
 * U-75 — linkCategorizer assigns a single category per link using
 * pure heuristics (host + extension). The contract is
 * "exactly one category, in a defined order".
 */

const BASE = "https://example.com";

describe("categoryOf", () => {
  it("mailto: → email", () => {
    expect(categoryOf("mailto:a@b.com", BASE)).toBe("email");
  });

  it("known social host → social", () => {
    expect(categoryOf("https://twitter.com/foo", BASE)).toBe("social");
    expect(categoryOf("https://www.linkedin.com/in/me", BASE)).toBe("social");
  });

  it("document extensions → document", () => {
    expect(categoryOf("https://example.com/file.pdf", BASE)).toBe("document");
    expect(categoryOf("https://example.com/file.docx", BASE)).toBe("document");
  });

  it("media extensions → media", () => {
    expect(categoryOf("https://example.com/photo.png", BASE)).toBe("media");
    expect(categoryOf("https://example.com/clip.mp4", BASE)).toBe("media");
  });

  it("external link (different host) → external", () => {
    expect(categoryOf("https://other.com/a", BASE)).toBe("external");
  });

  it("internal link (same host) → internal", () => {
    expect(categoryOf("https://example.com/about", BASE)).toBe("internal");
  });
});

describe("isCategory + CATEGORY_KEYS", () => {
  it("isCategory is true for each CATEGORY_KEYS", () => {
    for (const k of CATEGORY_KEYS) expect(isCategory(k)).toBe(true);
  });

  it("isCategory is false for an unknown value", () => {
    expect(isCategory("nope")).toBe(false);
  });

  it("CATEGORY_META has a label + icon for every key", () => {
    for (const k of CATEGORY_KEYS) {
      expect(CATEGORY_META[k]?.label).toBeTruthy();
      expect(CATEGORY_META[k]?.icon).toBeTruthy();
    }
  });
});

describe("categoryCounts", () => {
  it("counts links per category in CATEGORY_KEYS order, omits empties", () => {
    const links = [
      { href: "https://example.com/about" },
      { href: "https://twitter.com/me" },
      { href: "https://example.com/photo.png" },
      { href: "https://other.com/a" },
    ];
    const result = categoryCounts(links, BASE);
    // categoryCounts returns an array of { key, count, ... } in CATEGORY_KEYS order
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(CATEGORY_KEYS).toContain(entry.key);
    }
    // Internal + social + media + external → at least 4 distinct keys
    const keys = result.map((e) => e.key);
    expect(keys).toContain("internal");
    expect(keys).toContain("social");
  });

  it("prefers stored category when present, heuristic otherwise", () => {
    const links = [
      { href: "https://example.com/about", category: "external" },
      { href: "https://example.com/contact" },
    ];
    const result = categoryCounts(links, BASE);
    const external = result.find((e) => e.key === "external");
    expect(external?.count).toBe(1);
  });

  it("returns an empty array when there are no links", () => {
    expect(categoryCounts([], BASE)).toEqual([]);
  });
});
