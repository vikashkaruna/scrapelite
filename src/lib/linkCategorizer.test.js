import { describe, expect, it } from "vitest";
import { CATEGORY_KEYS, categoryCounts, categoryOf, isCategory } from "./linkCategorizer.js";

describe("link categorization", () => {
  it("assigns a mutually exclusive category in the documented priority order", () => {
    const base = "https://example.com/page";
    expect(categoryOf("mailto:hello@example.com", base)).toBe("email");
    expect(categoryOf("https://www.linkedin.com/company/datiq", base)).toBe("social");
    expect(categoryOf("https://example.com/report.pdf?download=1", base)).toBe("document");
    expect(categoryOf("https://cdn.example.com/video.mp4", base)).toBe("media");
    expect(categoryOf("/help", base)).toBe("internal");
    expect(categoryOf("https://other.example/about", base)).toBe("external");
  });

  it("uses valid saved categories and heuristics for absent or invalid values", () => {
    const counts = categoryCounts([
      { href: "/a", category: "external" },
      { href: "/b", category: "not-real" },
      { href: "mailto:team@example.com" },
    ], "https://example.com");

    expect(counts).toEqual([
      expect.objectContaining({ key: "email", count: 1 }),
      expect.objectContaining({ key: "internal", count: 1 }),
      expect.objectContaining({ key: "external", count: 1 }),
    ]);
    expect(CATEGORY_KEYS.every(isCategory)).toBe(true);
    expect(isCategory("not-real")).toBe(false);
  });
});
