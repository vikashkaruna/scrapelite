import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readCurrent,
  readEnrichments,
  saveCurrent,
  saveEnrichment,
} from "./enrichmentStore.js";

/**
 * U-74 — enrichmentStore is the persistence layer for Quick
 * Enrichment results + the last-viewed extraction.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("saveEnrichment + readEnrichments", () => {
  it("saves a single enrichment entry keyed by URL + capability", () => {
    saveEnrichment("https://example.com/a", { key: "summary", label: "AI Summary", data: { text: "x" } });
    const r = readEnrichments("https://example.com/a");
    expect(r.summary).toEqual({ key: "summary", label: "AI Summary", data: { text: "x" } });
  });

  it("multiple capabilities for the same URL are stored as siblings", () => {
    saveEnrichment("https://example.com/a", { key: "summary", label: "AI Summary", data: { text: "x" } });
    saveEnrichment("https://example.com/a", { key: "contacts", label: "Contacts", data: { list: [] } });
    const r = readEnrichments("https://example.com/a");
    expect(Object.keys(r).sort()).toEqual(["contacts", "summary"]);
  });

  it("re-running a capability overwrites the entry (acts as a refresh)", () => {
    saveEnrichment("https://example.com/a", { key: "summary", label: "AI Summary", data: { text: "v1" } });
    saveEnrichment("https://example.com/a", { key: "summary", label: "AI Summary", data: { text: "v2" } });
    const r = readEnrichments("https://example.com/a");
    expect(r.summary.data.text).toBe("v2");
  });

  it("ignores an entry without a key (no crash)", () => {
    saveEnrichment("https://example.com/a", { data: { text: "x" } });
    expect(readEnrichments("https://example.com/a")).toEqual({});
  });

  it("ignores a missing URL", () => {
    expect(readEnrichments(null)).toEqual({});
    expect(readEnrichments("")).toEqual({});
  });
});

describe("saveCurrent + readCurrent", () => {
  it("round-trips an extraction", () => {
    const e = { id: "ext_1", url: "https://example.com", page_title: "P" };
    saveCurrent(e);
    expect(readCurrent()).toEqual(e);
  });

  it("passing null removes the saved extraction", () => {
    saveCurrent({ id: "ext_1" });
    saveCurrent(null);
    expect(readCurrent()).toBeNull();
  });
});
