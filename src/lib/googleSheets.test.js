// googleSheets.test.js — DeepSeq QW#3 unit tests for the "Open in Google Sheets"
// helper. Mocks window.open + triggerDownload to verify the call shape without
// actually downloading or opening a window in jsdom.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openInGoogleSheets, GOOGLE_SHEETS_NEW_URL, csvDownload, extractionsToTsv, extractionsToExcel, excelDownload } from "./utils.js";

describe("DeepSeq QW#3 — openInGoogleSheets & Spreadsheet Exports", () => {
  beforeEach(() => {
    // jsdom doesn't implement anchor.click() downloads, so stub it.
    HTMLAnchorElement.prototype.click = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exposes the canonical Google Sheets 'new sheet' URL", () => {
    expect(GOOGLE_SHEETS_NEW_URL).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/create/);
  });

  it("opens the new-sheet URL in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    openInGoogleSheets([{ id: "x", url: "https://example.com", page_title: "X" }]);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(GOOGLE_SHEETS_NEW_URL, "_blank", expect.stringMatching(/noopener|noreferrer/));
  });

  it("triggers a CSV download as part of the flow", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    openInGoogleSheets([{ id: "x", url: "https://example.com", page_title: "X" }]);
    expect(clickSpy).toHaveBeenCalled();
  });

  it("returns TSV data and copied flag for seamless clipboard paste", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const res = openInGoogleSheets([{ id: "x", url: "https://example.com", page_title: "X", headings: ["Heading 1"] }]);
    expect(res.copied).toBe(true);
    expect(res.tsv).toContain("page\ttype\tname\ttext\tvalue");
    expect(res.tsv).toContain("example.com");
  });

  it("does not throw when window.open is unavailable (SSR-like guard)", () => {
    const originalOpen = window.open;
    // Simulate a non-browser environment
    delete window.open;
    expect(() => openInGoogleSheets([{ id: "x", url: "https://example.com" }])).not.toThrow();
    window.open = originalOpen;
  });

  it("csvDownload returns a name + CSV body so callers can display it", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const items = [{ id: "x", url: "https://example.com/about", page_title: "About" }];
    const meta = csvDownload(items);
    expect(meta.name).toMatch(/datiq-example\.com/);
    expect(typeof meta.csv).toBe("string");
    expect(meta.csv.length).toBeGreaterThan(0);
  });

  it("extractionsToTsv creates tab-separated columns for spreadsheet paste", () => {
    const items = [{ id: "x", url: "https://example.com/about", page_title: "About", headings: ["Title 1"] }];
    const tsv = extractionsToTsv(items);
    expect(tsv).toContain("page\ttype\tname\ttext\tvalue");
    const lines = tsv.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].split("\t")).toEqual(["page", "type", "name", "text", "value"]);
  });

  it("extractionsToExcel generates valid XML Spreadsheet document", () => {
    const items = [{ id: "x", url: "https://example.com/about", page_title: "About", headings: [{ tag: "h1", text: "Welcome" }] }];
    const xml = extractionsToExcel(items);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
    expect(xml).toContain('<Worksheet ss:Name="DatIQ Extraction">');
    expect(xml).toContain('<Cell><Data ss:Type="String">Welcome</Data></Cell>');
  });

  it("excelDownload triggers an .xls file download", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const items = [{ id: "x", url: "https://example.com/about", page_title: "About" }];
    const res = excelDownload(items);
    expect(clickSpy).toHaveBeenCalled();
    expect(res.name).toMatch(/datiq-example\.com.*\.xls$/);
    expect(res.xls).toContain("<Workbook");
  });
});
