// urlIngest.test.js — QW#1 (MetaAI) unit tests for the drag-drop URL ingest
// helper. Pure logic; the composer itself is just FileReader + dataTransfer glue.
import { describe, it, expect } from "vitest";
import { ingestUrls } from "./urlIngest.js";

describe("QW#1 — urlIngest.ingestUrls", () => {
  it("returns an empty list + 'none' source for empty / whitespace input", () => {
    expect(ingestUrls("")).toEqual({ urls: [], source: "none" });
    expect(ingestUrls("   \n  \n")).toEqual({ urls: [], source: "none" });
    expect(ingestUrls(null)).toEqual({ urls: [], source: "none" });
    expect(ingestUrls(undefined)).toEqual({ urls: [], source: "none" });
  });

  it("parses a CSV with a 'url' header", () => {
    const csv = "url\nhttps://a.com\nhttps://b.com\nhttps://c.com";
    const out = ingestUrls(csv);
    expect(out.source).toBe("csv");
    expect(out.urls).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("parses a CSV with an alternative header (website/link)", () => {
    const csv = "website,score\nhttps://a.com,1\nhttps://b.com,2";
    const out = ingestUrls(csv);
    expect(out.source).toBe("csv");
    expect(out.urls.length).toBe(2);
  });

  it("falls through to plain text when the CSV has no header hint and 0 data rows", () => {
    // parseUrlsFromCsv returns errors[] for <2 lines; the helper must fall back
    // to extractUrls. A single URL on one line is not a valid CSV.
    const out = ingestUrls("https://solo.example.com");
    expect(out.source).toBe("text");
    expect(out.urls).toEqual(["https://solo.example.com"]);
  });

  it("extracts one URL per line from plain text (no CSV header)", () => {
    const out = ingestUrls("https://a.com\nhttps://b.com\nhttps://c.com");
    expect(out.source).toBe("text");
    expect(out.urls).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("handles whitespace / comma / semicolon separators in plain text", () => {
    // Single line, no header — must take the 'text' path, not the CSV path.
    const out = ingestUrls("https://a.com, https://b.com; https://c.com");
    expect(out.source).toBe("text");
    expect(out.urls).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("handles whitespace / comma / semicolon separators across newlines in plain text", () => {
    const out = ingestUrls("https://a.com, https://b.com; https://c.com\nhttps://d.com");
    expect(out.source).toBe("text");
    expect(out.urls).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
      "https://d.com",
    ]);
  });

  it("dedupes case-insensitively (preserves the first casing seen)", () => {
    const out = ingestUrls("https://A.com\nHTTPS://a.com\nhttps://a.com/about");
    // First write wins (case-preserving); only the differing path survives.
    expect(out.urls).toEqual(["https://A.com", "https://a.com/about"]);
  });

  it("skips invalid entries instead of throwing", () => {
    const out = ingestUrls("not a url\nhttps://good.com\nstill not\n");
    expect(out.urls).toEqual(["https://good.com"]);
  });

  it("handles a single dragged URL (browser address bar drop)", () => {
    const out = ingestUrls("https://dragged.example.com/path");
    expect(out.source).toBe("text");
    expect(out.urls).toEqual(["https://dragged.example.com/path"]);
  });

  it("handles a real-world CSV with quotes and embedded commas", () => {
    const csv = `url,note
https://a.com,"hello, world"
https://b.com,plain`;
    const out = ingestUrls(csv);
    expect(out.source).toBe("csv");
    expect(out.urls).toEqual(["https://a.com", "https://b.com"]);
  });
});
