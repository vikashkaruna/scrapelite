// googleSheets.test.js — DeepSeq QW#3 unit tests for the "Open in Google Sheets"
// helper. Mocks window.open + triggerDownload to verify the call shape without
// actually downloading or opening a window in jsdom.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openInGoogleSheets, GOOGLE_SHEETS_NEW_URL, csvDownload } from "./utils.js";

describe("DeepSeq QW#3 — openInGoogleSheets", () => {
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
});
