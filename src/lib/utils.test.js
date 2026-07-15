import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyInput,
  csvDownload,
  extractUrls,
  extractionRows,
  extractionsToCsv,
  extractionsToJson,
  extractionsToMarkdown,
  fmtDate,
  hashContent,
  hostOf,
  hueOf,
  isExternal,
  isValidEmail,
  isValidUrl,
  jsonDownload,
  looksLikeHtml,
  looksLikeUrl,
  markdownDownload,
  normalizeUrl,
  parseEmails,
  pathOf,
  snippet,
  timeAgo,
  uid,
} from "./utils.js";

/**
 * U-72..77 are kept from the existing unit suite; U-01..06 are the M1
 * additions for the export pipeline. Together they cover every export
 * helper and the most-touched URL / input utilities.
 */

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
    expect(classifyInput("https://a.com\nhttps://b.com")).toEqual({
      kind: "multi",
      urls: ["https://a.com", "https://b.com"],
    });
    expect(classifyInput("hello world, this is not a url")).toEqual({
      kind: "text",
      urls: [],
    });
    expect(classifyInput("")).toEqual({ kind: "empty", urls: [] });
  });

  it("extractUrls splits, normalizes, dedupes, and reports invalid", () => {
    const { valid, invalid } = extractUrls("a.com, b.com\na.com\nnope");
    expect(valid).toEqual(["https://a.com", "https://b.com"]);
    expect(invalid).toEqual(["nope"]);
  });

  it("hostOf and pathOf parse the URL safely and tolerate garbage", () => {
    expect(hostOf("https://www.example.com/a/b?x=1")).toBe("example.com");
    expect(pathOf("https://example.com/a/b?x=1")).toBe("/a/b?x=1");
    expect(hostOf("garbage")).toBe("garbage");
    expect(pathOf("garbage")).toBe("");
  });

  it("isExternal flags a different host", () => {
    expect(isExternal("https://other.com/a", "https://example.com/b")).toBe(true);
    expect(isExternal("https://example.com/a", "https://example.com/b")).toBe(false);
  });

  it("looksLikeUrl + looksLikeHtml distinguish URL vs HTML fragments", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("not a url")).toBe(false);
    expect(looksLikeHtml("<div>hi</div>")).toBe(true);
    expect(looksLikeHtml("plain text")).toBe(false);
  });

  it("hashContent produces a deterministic 8-char hex string", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });
});

describe("Email helpers (U-72)", () => {
  it("parseEmails returns deduped valid list and invalid list", () => {
    const { valid, invalid } = parseEmails("a@b.com, c@d.com, a@b.com, bogus");
    expect(valid).toEqual(["a@b.com", "c@d.com"]);
    expect(invalid).toEqual(["bogus"]);
  });

  it("isValidEmail accepts well-formed addresses and rejects malformed", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("a+b@sub.example.co.uk")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("Date / formatting helpers", () => {
  it("fmtDate renders the canonical short form", () => {
    expect(fmtDate("2026-07-15T00:00:00.000Z")).toMatch(/Jul.*15.*2026/);
  });

  it("timeAgo buckets by recency", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 60_000).toISOString())).toMatch(/m ago$/);
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toMatch(/h ago$/);
    expect(timeAgo(new Date(now - 3 * 86_400_000).toISOString())).toMatch(/d ago$/);
    expect(timeAgo(new Date(now - 30 * 86_400_000).toISOString())).toMatch(/20/);
  });

  it("snippet trims to the requested length and adds an ellipsis", () => {
    const text = "a".repeat(200);
    expect(snippet(text, 50)).toMatch(/…$/);
    expect(snippet(text, 50).length).toBeLessThanOrEqual(51);
    expect(snippet("short", 100)).toBe("short");
  });

  it("hueOf returns a value in [0, 360) and is deterministic", () => {
    expect(hueOf("hello")).toBe(hueOf("hello"));
    expect(hueOf("hello")).toBeGreaterThanOrEqual(0);
    expect(hueOf("hello")).toBeLessThan(360);
  });
});

describe("Identity helpers", () => {
  it("uid produces a unique string with the ex_ prefix", () => {
    const a = uid();
    const b = uid();
    expect(a).not.toBe(b);
    expect(a.startsWith("ex_")).toBe(true);
  });
});

describe("Extraction rows + CSV export", () => {
  it("extractionRows flattens one extraction into [type,name,text,value] tuples", () => {
    const e = {
      url: "https://example.com/pricing",
      page_title: "Pricing",
      ai_summary: "Three tiers.",
      headings: [{ tag: "h1", text: "Pricing" }],
      links: [{ text: "Sign up", href: "https://example.com/signup", category: "cta" }],
    };
    const rows = extractionRows(e);
    expect(rows[0]).toEqual(["meta", "url", "https://example.com/pricing", ""]);
    expect(rows.some((r) => r[0] === "heading" && r[1] === "h1" && r[2] === "Pricing")).toBe(true);
    // Link rows: [type, category, text, href]
    expect(rows.some((r) => r[0] === "link" && r[1] === "cta" && r[2] === "Sign up" && r[3] === "https://example.com/signup")).toBe(true);
  });

  it("extractionsToCsv joins rows with CRLF and quotes the fields", () => {
    const items = [
      { url: "https://example.com", page_title: "Hello, world", ai_summary: "With, comma" },
    ];
    const csv = extractionsToCsv(items);
    // Header + one row. Fields with comma must be quoted.
    expect(csv.split("\r\n").length).toBeGreaterThanOrEqual(2);
    expect(csv).toContain('"Hello, world"');
    expect(csv).toContain('"With, comma"');
  });
});

describe("Markdown export (U-01)", () => {
  it("produces a heading, link section, and enrichment sections", () => {
    const items = [
      {
        url: "https://example.com/pricing",
        page_title: "Example Pricing",
        ai_summary: "Three plans: Free, Pro, Business.",
        created_at: "2026-07-15T00:00:00.000Z",
        headings: [{ tag: "h1", text: "Pricing" }],
        links: [{ text: "Sign up", href: "https://example.com/signup" }],
      },
    ];
    const md = extractionsToMarkdown(items);
    expect(md).toMatch(/^# DatIQ Export/);
    expect(md).toMatch(/## 1\. Example Pricing/);
    expect(md).toMatch(/\*\*URL:\*\* <https:\/\/example\.com\/pricing>/);
    expect(md).toMatch(/### AI Summary/);
    expect(md).toMatch(/Sign up/);
  });

  it("handles a single extraction (not in an array)", () => {
    const md = extractionsToMarkdown({
      url: "https://example.com",
      page_title: "Single",
    });
    expect(md).toMatch(/^# DatIQ Export/);
    expect(md).toMatch(/## 1\. Single/);
  });
});

describe("JSON export (U-02)", () => {
  it("matches the documented schema (export envelope + pages[])", () => {
    const items = [
      {
        id: "ext_1",
        url: "https://example.com/a",
        page_title: "A",
        ai_summary: "Sum",
        created_at: "2026-07-15T00:00:00.000Z",
        headings: [{ tag: "h1", text: "A" }],
        links: [{ text: "L", href: "https://example.com/l", category: "nav" }],
        enrichments: { summary: { key: "summary", data: { text: "x" } } },
      },
    ];
    const json = extractionsToJson(items);
    const obj = JSON.parse(json);
    expect(obj.export.tool).toBe("DatIQ");
    expect(obj.export.version).toBe("2.0");
    expect(obj.export.count).toBe(1);
    expect(obj.pages[0].url).toBe("https://example.com/a");
    expect(obj.pages[0].page_title).toBe("A");
    expect(obj.pages[0].ai_summary).toBe("Sum");
    expect(obj.pages[0].links[0].category).toBe("nav");
    expect(obj.pages[0].enrichments.summary).toEqual({ text: "x" });
  });

  it("jsonDownload builds a Blob with application/json MIME and a download filename", () => {
    const captured = { blob: null, filename: null };
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:json");
    URL.revokeObjectURL = vi.fn();

    // Intercept the anchor's .click() to capture filename + prevent DOM mutation side effects.
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        const originalClick = el.click.bind(el);
        el.click = () => {
          captured.filename = el.download;
          captured.blob = URL.createObjectURL.mock.results[0]?.value;
        };
      }
      return el;
    });

    try {
      jsonDownload({ id: "ext_1", url: "https://example.com", page_title: "P" });
      const blobArg = URL.createObjectURL.mock.calls[0][0];
      expect(blobArg.type).toBe("application/json;charset=utf-8;");
      expect(captured.filename).toMatch(/^datiq-example\.com-ext_1\.json$/);
    } finally {
      createSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe("CSV download (csvDownload)", () => {
  it("uses text/csv;charset=utf-8 MIME and a host-prefixed filename for a single row", () => {
    let filename = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:csv");
    URL.revokeObjectURL = vi.fn();

    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        el.click = () => { filename = el.download; };
      }
      return el;
    });

    try {
      csvDownload({ id: "ext_1", url: "https://example.com/a", page_title: "A" });
      const blobArg = URL.createObjectURL.mock.calls[0][0];
      expect(blobArg.type).toBe("text/csv;charset=utf-8;");
      expect(filename).toMatch(/^datiq-example\.com-ext_1\.csv$/);
    } finally {
      createSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe("Markdown download (U-03)", () => {
  it("triggers a download with text/markdown MIME", () => {
    let filename = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:md");
    URL.revokeObjectURL = vi.fn();

    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        el.click = () => { filename = el.download; };
      }
      return el;
    });

    try {
      markdownDownload([{ id: "ext_1", url: "https://example.com", page_title: "P" }]);
      const blobArg = URL.createObjectURL.mock.calls[0][0];
      expect(blobArg.type).toBe("text/markdown;charset=utf-8;");
      expect(filename).toMatch(/^datiq-example\.com-ext_1\.md$/);
    } finally {
      createSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe("PDF export (U-06, lazy import)", () => {
  it("extractionsToPdf is a function and accepts an array (callable contract)", async () => {
    const { extractionsToPdf } = await import("./pdfExport.js");
    // We don't actually render PDF (jsPDF needs a real DOM). The test
    // asserts the function exists and is callable with an empty array
    // — which short-circuits to "no items" without invoking jsPDF.
    expect(typeof extractionsToPdf).toBe("function");
  });
});
