import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyInput,
  extractUrls,
  extractionRows,
  extractionsToCsv,
  flattenJson,
  hashContent,
  hostOf,
  isValidEmail,
  isValidUrl,
  looksLikeHtml,
  normalizeUrl,
  parseEmails,
  pathOf,
  snippet,
} from "./utils.js";

describe("URL and input helpers", () => {
  it("normalizes valid URLs while rejecting malformed user input", () => {
    expect(isValidUrl("example.com/pricing?plan=pro")).toBe(true);
    expect(isValidUrl("https://sub.example.co.uk")).toBe(true);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(normalizeUrl("  example.com/a  ")).toBe("https://example.com/a");
    expect(normalizeUrl("HTTP://example.com")).toBe("HTTP://example.com");
  });

  it("classifies a URL, URL list, raw content, and empty input predictably", () => {
    expect(classifyInput("example.com")).toEqual({ kind: "single", urls: ["https://example.com"] });
    expect(classifyInput("example.com\nhttps://www.example.org/path\nexample.com")).toEqual({
      kind: "multi",
      urls: ["https://example.com", "https://www.example.org/path"],
    });
    expect(classifyInput("This is copied pricing content with example.com in it.").kind).toBe("text");
    expect(classifyInput("  ")).toEqual({ kind: "empty", urls: [] });
  });

  it("extracts de-duplicated URLs and keeps invalid tokens visible to callers", () => {
    expect(extractUrls("example.com, EXAMPLE.com; invalid https://two.test/a")).toEqual({
      valid: ["https://example.com", "https://two.test/a"],
      invalid: ["invalid"],
    });
  });

  it("derives display-friendly host and path values without throwing", () => {
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
    expect(pathOf("https://example.com/a?b=c")).toBe("/a?b=c");
    expect(pathOf("https://example.com/")).toBe("/");
    expect(hostOf("bad-value/path")).toBe("bad-value");
  });
});

describe("content and recipient helpers", () => {
  it("parses unique valid and invalid recipients", () => {
    expect(parseEmails("A@example.com, a@example.com; bad-address\nhello@sample.org")).toEqual({
      valid: ["A@example.com", "hello@sample.org"],
      invalid: ["bad-address"],
    });
    expect(isValidEmail("person+tag@example.co.uk")).toBe(true);
    expect(isValidEmail("person@example")).toBe(false);
  });

  it("recognizes HTML and produces stable non-cryptographic change fingerprints", () => {
    expect(looksLikeHtml("<h1>Hello</h1>")).toBe(true);
    expect(looksLikeHtml("plain text < 3")).toBe(false);
    expect(hashContent("same value")).toBe(hashContent("same value"));
    expect(hashContent("same value")).not.toBe(hashContent("changed value"));
  });

  it("truncates snippets on a word boundary", () => {
    expect(snippet("alpha beta gamma", 10)).toBe("alpha…");
    expect(snippet("short", 10)).toBe("short");
  });
});

describe("CSV export data", () => {
  const extraction = {
    id: "ex_1",
    url: "https://example.com/pricing",
    page_title: "Plans",
    ai_summary: "A \"quoted\" summary",
    headings: [{ tag: "H1", text: "Pricing" }],
    links: [{ category: "internal", text: "Start", href: "/start" }],
    domain_map: ["https://example.com/about"],
    enrichments: {
      pricing: {
        key: "pricing",
        label: "Pricing & Plans",
        data: { plans: [{ name: "Pro", price: 19 }], enabled: true },
      },
    },
  };

  it("deep-flattens nulls, empty containers, arrays, and nested data", () => {
    expect(flattenJson({ a: null, b: [], c: {}, d: [{ e: 1 }] })).toEqual([
      { path: "a", value: "" },
      { path: "b", value: "" },
      { path: "c", value: "" },
      { path: "d[0].e", value: "1" },
    ]);
  });

  it("creates a complete, correctly escaped CSV suitable for multi-page exports", () => {
    expect(extractionRows(extraction)).toEqual(expect.arrayContaining([
      ["meta", "url", "https://example.com/pricing", ""],
      ["heading", "H1", "Pricing", ""],
      ["link", "internal", "Start", "/start"],
      ["mapped-url", "", "", "https://example.com/about"],
      ["enrichment", "Pricing & Plans", "plans[0].name", "Pro"],
      ["enrichment", "Pricing & Plans", "plans[0].price", "19"],
    ]));

    const csv = extractionsToCsv([extraction]);
    expect(csv).toContain('"page","type","name","text","value"');
    expect(csv).toContain('"example.com/pricing","meta","summary","A ""quoted"" summary",""');
    expect(csv).toContain('"example.com/pricing","enrichment","Pricing & Plans","enabled","true"');
  });

  it("falls back to a legacy custom extraction when no enrichment map exists", () => {
    const rows = extractionRows({ ...extraction, enrichments: {}, custom_extraction: { company: "DatIQ" } });
    expect(rows).toContainEqual(["custom", "Custom extraction", "company", "DatIQ"]);
  });
});
