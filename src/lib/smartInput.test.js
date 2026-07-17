// src/lib/smartInput.test.js — Q1 (smart multi-input Home) classifier tests.

import { describe, expect, it } from "vitest";
import { classifyInput, looksLikeCsv } from "./utils.js";

describe("Q1 — classifyInput: smart auto-detect", () => {
  it("classifies empty input as 'empty'", () => {
    expect(classifyInput("")).toEqual({ kind: "empty", urls: [] });
    expect(classifyInput("   \n  ")).toEqual({ kind: "empty", urls: [] });
  });

  it("classifies a single URL as 'single'", () => {
    const r = classifyInput("https://stripe.com/pricing");
    expect(r.kind).toBe("single");
    expect(r.urls).toEqual(["https://stripe.com/pricing"]);
  });

  it("classifies a bare domain as a single URL", () => {
    const r = classifyInput("stripe.com");
    expect(r.kind).toBe("single");
    expect(r.urls[0]).toMatch(/^https:\/\/stripe\.com/);
  });

  it("classifies multiple URLs (newline-separated) as 'multi'", () => {
    const r = classifyInput(
      "https://stripe.com/pricing\nhttps://linear.app/pricing\nhttps://notion.so/pricing",
    );
    expect(r.kind).toBe("multi");
    expect(r.urls).toHaveLength(3);
  });

  it("classifies multiple URLs (comma-separated) as 'multi'", () => {
    const r = classifyInput(
      "https://a.com, https://b.com, https://c.com",
    );
    expect(r.kind).toBe("multi");
    expect(r.urls).toHaveLength(3);
  });

  it("classifies a CSV header + data rows as 'csv'", () => {
    const csv = "name,url,description\nFoo,https://foo.com,Hello\nBar,https://bar.com,World";
    const r = classifyInput(csv);
    expect(r.kind).toBe("csv");
    expect(r.urls).toEqual(["https://foo.com", "https://bar.com"]);
  });

  it("treats raw text / HTML as 'text'", () => {
    const r = classifyInput("This is a paragraph of plain text with no URLs.");
    expect(r.kind).toBe("text");
  });

  it("treats HTML fragments as 'text'", () => {
    const r = classifyInput(
      "<div><h1>Title</h1><p>Some <em>rich</em> content here</p></div>",
    );
    expect(r.kind).toBe("text");
  });

  it("preserves the full URL list in every kind that surfaces URLs", () => {
    const r1 = classifyInput("https://a.com\nhttps://b.com");
    expect(r1.urls.length).toBe(2);
    const r2 = classifyInput("name,url\nFoo,https://a.com\nBar,https://b.com");
    expect(r2.urls.length).toBe(2);
  });
});

describe("Q1 — looksLikeCsv: pure CSV detection", () => {
  it("returns true for a multi-line header + record input", () => {
    expect(looksLikeCsv("name,url,description\nFoo,https://foo.com,Hi")).toBe(true);
  });

  it("returns false for single-line input (no newline)", () => {
    expect(looksLikeCsv("name,url,description")).toBe(false);
  });

  it("returns false when header has only one column", () => {
    expect(looksLikeCsv("name\nFoo")).toBe(false);
  });

  it("returns false when the first line is itself a URL", () => {
    // looksLikeUrl matches a single token. A line with multiple comma-separated
    // values is treated as CSV-shaped (could be a misformatted URL list), so
    // we only short-circuit when the first line is a single URL token.
    expect(looksLikeCsv("https://foo.com\nhttps://bar.com")).toBe(false);
  });

  it("returns false when the second line is itself a single URL", () => {
    expect(looksLikeCsv("name,url\nhttps://foo.com")).toBe(false);
  });

  it("returns true even when no 'url' column header is present", () => {
    expect(looksLikeCsv("name,website,description\nFoo,foo.com,Hi")).toBe(true);
  });
});
