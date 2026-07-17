// ExtractSimilarCard.test.js — DeepSeq QW#1 unit tests for pickSiblings.
import { describe, it, expect } from "vitest";
import { pickSiblings } from "./ExtractSimilarCard.jsx";

describe("DeepSeq QW#1 — pickSiblings", () => {
  it("returns an empty list when there are no links or no baseUrl", () => {
    expect(pickSiblings([], "https://example.com")).toEqual([]);
    expect(pickSiblings(null, "https://example.com")).toEqual([]);
    expect(pickSiblings([{ href: "https://example.com" }], null)).toEqual([]);
    expect(pickSiblings([{ href: "https://example.com" }], "")).toEqual([]);
  });

  it("filters out external (off-domain) links", () => {
    const links = [
      { text: "Twitter",  href: "https://twitter.com/example" },
      { text: "Docs",     href: "https://docs.example.com/api" },
      { text: "About",    href: "https://example.com/about" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("https://example.com/about");
  });

  it("filters out the base URL itself", () => {
    const links = [
      { text: "Home",   href: "https://example.com" },
      { text: "About",  href: "https://example.com/about" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("https://example.com/about");
  });

  it("dedupes identical hrefs", () => {
    const links = [
      { text: "About",  href: "https://example.com/about" },
      { text: "About2", href: "https://example.com/about" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out).toHaveLength(1);
  });

  it("respects the limit (default 3)", () => {
    const links = [
      { text: "Pricing",  href: "https://example.com/pricing" },
      { text: "Features", href: "https://example.com/features" },
      { text: "About",    href: "https://example.com/about" },
      { text: "Blog",     href: "https://example.com/blog" },
      { text: "Contact",  href: "https://example.com/contact" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out).toHaveLength(3);
  });

  it("prefers shallow + high-intent paths (/pricing > deep /blog/2024/.../post)", () => {
    const links = [
      { text: "Old post", href: "https://example.com/blog/2024/03/some-post" },
      { text: "Pricing",  href: "https://example.com/pricing" },
    ];
    const out = pickSiblings(links, "https://example.com");
    // /pricing is shallow + high-intent (regex match); deep /blog/... post is not.
    expect(out[0].href).toBe("https://example.com/pricing");
    expect(out[1].href).toBe("https://example.com/blog/2024/03/some-post");
  });

  it("orders same-score candidates alphabetically by path", () => {
    // Both /features and /pricing match the high-intent regex → equal scores.
    // Tiebreaker is path localeCompare → 'features' < 'pricing'.
    const links = [
      { text: "Pricing",  href: "https://example.com/pricing" },
      { text: "Features", href: "https://example.com/features" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out[0].path).toBe("/features");
    expect(out[1].path).toBe("/pricing");
  });

  it("falls back to the link text when the path is shallow", () => {
    const links = [
      { text: "Meet the team", href: "https://example.com/team" },
    ];
    const out = pickSiblings(links, "https://example.com");
    expect(out[0].label).toBe("Meet the team");
  });
});
