// utils.clipboard.test.js — F01 (clipboard copy) helper tests.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildClipboardPayload, listClipboardFormats, copyToClipboard,
} from "./utils.js";

const SAMPLE = [
  {
    id: "x1",
    url: "https://stripe.com/pricing",
    title: "Stripe — Pricing",
    ai_summary: "Stripe charges 2.9% + 30¢ per online card transaction.",
    meta: { description: "Online payment processing" },
    capabilities: {},
  },
];

describe("F01 — buildClipboardPayload", () => {
  it("produces CSV text from the same extractionsToCsv pipeline", () => {
    const { text, mime } = buildClipboardPayload(SAMPLE, "csv");
    expect(mime).toBe("text/csv");
    expect(text).toContain("Stripe");
    expect(text).toContain("2.9%");
  });

  it("produces JSON text wrapped in { export: { ... }, pages: [...] }", () => {
    const { text, mime } = buildClipboardPayload(SAMPLE, "json");
    expect(mime).toBe("application/json");
    const parsed = JSON.parse(text);
    expect(parsed.export).toBeDefined();
    expect(parsed.export.tool).toBe("DatIQ");
    expect(Array.isArray(parsed.pages)).toBe(true);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0].url).toContain("stripe.com");
  });

  it("produces Markdown text containing the URL heading", () => {
    const { text, mime } = buildClipboardPayload(SAMPLE, "markdown");
    expect(mime).toBe("text/markdown");
    expect(text).toMatch(/^# DatIQ Extraction Report/m);
    expect(text).toContain("stripe.com");
  });

  it("produces summary text (just the ai_summary fields joined)", () => {
    const { text, mime } = buildClipboardPayload(SAMPLE, "summary");
    expect(mime).toBe("text/plain");
    expect(text).toContain("2.9%");
  });

  it("builds a tsv payload for spreadsheet paste", () => {
    const { text, mime } = buildClipboardPayload(SAMPLE, "tsv");
    expect(mime).toBe("text/tab-separated-values");
    expect(text).toContain("page\ttype\tname\ttext\tvalue");
    expect(text).toContain("stripe.com");
  });

  it("rejects unknown formats", () => {
    expect(() => buildClipboardPayload(SAMPLE, "xml")).toThrow(/unknown format/);
  });
});

describe("F01 — listClipboardFormats", () => {
  it("returns the supported formats including tsv", () => {
    expect(listClipboardFormats().sort()).toEqual(["csv", "json", "markdown", "summary", "tsv"]);
  });
});

describe("F01 — copyToClipboard", () => {
  let writeTextSpy;
  beforeEach(() => {
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    writeTextSpy = null;
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const out = await copyToClipboard(SAMPLE, "csv");
    expect(out.ok).toBe(true);
    expect(out.format).toBe("csv");
    expect(out.chars).toBeGreaterThan(0);
    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy.mock.calls[0][0]).toContain("stripe.com");
  });

  it("returns ok:false for unknown format", async () => {
    const out = await copyToClipboard(SAMPLE, "xml");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/unsupported_format/);
    expect(writeTextSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false for empty payload (no summary field)", async () => {
    const out = await copyToClipboard([{ id: "x2", url: "https://x.com" }], "summary");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/empty_payload/);
  });

  it("falls back to execCommand when navigator.clipboard.writeText throws", async () => {
    writeTextSpy.mockRejectedValue(new Error("NotAllowedError"));
    // Stub execCommand on document
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const out = await copyToClipboard(SAMPLE, "json");
    expect(out.ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns ok:false when both writeText and execCommand fail", async () => {
    writeTextSpy.mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    const out = await copyToClipboard(SAMPLE, "markdown");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/execCommand_failed/);
  });
});
