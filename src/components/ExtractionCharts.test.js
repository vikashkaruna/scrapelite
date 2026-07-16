// ExtractionCharts.test.js — QW#3 unit tests for the chart data builder.
// The chart UI itself is covered by integration tests; the aggregator is the
// logic-heavy piece worth pinning down with deterministic tests.
import { describe, it, expect } from "vitest";
import { buildChartData } from "./ExtractionCharts.jsx";

describe("QW#3 — buildChartData", () => {
  it("returns zeros for an empty extraction", () => {
    const d = buildChartData({});
    expect(d.stats.links).toBe(0);
    expect(d.stats.headings).toBe(0);
    expect(d.stats.words).toBe(0);
    expect(d.stats.readingMinutes).toBe(1); // floor at 1 minute
    expect(d.depthCounts).toHaveLength(6);
    expect(d.depthCounts.every((c) => c.count === 0)).toBe(true);
    expect(d.categories).toEqual([]);
  });

  it("counts headings by depth (H1..H6)", () => {
    const d = buildChartData({
      headings: [
        { tag: "H1", text: "One" },
        { tag: "H1", text: "Two" },
        { tag: "H2", text: "Sub one" },
        { tag: "H3", text: "Sub sub" },
        { tag: "H6", text: "Tiny" },
      ],
    });
    expect(d.depthCounts.find((c) => c.tag === "H1").count).toBe(2);
    expect(d.depthCounts.find((c) => c.tag === "H2").count).toBe(1);
    expect(d.depthCounts.find((c) => c.tag === "H3").count).toBe(1);
    expect(d.depthCounts.find((c) => c.tag === "H4").count).toBe(0);
    expect(d.depthCounts.find((c) => c.tag === "H5").count).toBe(0);
    expect(d.depthCounts.find((c) => c.tag === "H6").count).toBe(1);
  });

  it("derives link categories when missing", () => {
    const d = buildChartData({
      url: "https://stripe.com/pricing",
      links: [
        { text: "Buy",    href: "https://stripe.com/buy" },
        { text: "Sign up", href: "https://stripe.com/signup" },
        { text: "Docs",   href: "https://stripe.com/docs" },
        { text: "Help",   href: "https://help.stripe.com" },
        { text: "About",  href: "https://stripe.com/about" },
      ],
    });
    // Same-domain /pricing-style links should mostly bucket into known cats.
    expect(d.categories.length).toBeGreaterThan(0);
    expect(d.stats.links).toBe(5);
  });

  it("respects pre-tagged link categories", () => {
    const d = buildChartData({
      url: "https://example.com",
      links: [
        { text: "Email",  href: "mailto:hi@example.com",       category: "email" },
        { text: "Twitter", href: "https://twitter.com/example", category: "social" },
        { text: "Doc",    href: "https://example.com/file.pdf", category: "document" },
      ],
    });
    const cats = Object.fromEntries(d.categories.map((c) => [c.key, c.count]));
    expect(cats.email).toBe(1);
    expect(cats.social).toBe(1);
    expect(cats.document).toBe(1);
  });

  it("sums words from headings, summary, title, and link text", () => {
    const d = buildChartData({
      page_title: "Hello world",
      ai_summary: "A short summary with six words total here.",
      headings: [
        { tag: "H1", text: "Big heading with five words" },
        { tag: "H2", text: "Two words" },
      ],
      links: [{ text: "Click here", href: "https://example.com" }],
    });
    // "Hello world" = 2
    // summary: 8 words ("A short summary with six words total here." → 8)
    // H1: 5, H2: 2, link: 2
    // Total: 2 + 8 + 5 + 2 + 2 = 19
    expect(d.stats.words).toBe(19);
  });

  it("computes reading time using 200 wpm with a 1-minute floor", () => {
    const d = buildChartData({ ai_summary: "x" }); // 1 word → ceil(1/200) = 1 (floor)
    expect(d.stats.readingMinutes).toBe(1);

    // 1000 words → 5 min
    const big = buildChartData({
      ai_summary: Array(1000).fill("word").join(" "),
    });
    expect(big.stats.readingMinutes).toBe(5);
  });

  it("handles a null / undefined extraction defensively", () => {
    const d = buildChartData(null);
    expect(d.stats.links).toBe(0);
    expect(d.stats.headings).toBe(0);
    expect(d.categories).toEqual([]);
  });
});
