// src/lib/airtable.test.js — F18 (Airtable export adapter, unit tests).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toAirtableFieldKey,
  extractionToAirtableFields,
  chunkForAirtable,
  validateAirtableConfig,
  buildAirtableRequestBody,
  buildAirtableRequestUrl,
  pushToAirtable,
  readAirtableConfig,
  writeAirtableConfig,
  _internal,
} from "./airtable.js";

beforeEach(() => {
  try { localStorage.removeItem("datiq.airtableConfig"); } catch {}
});

describe("airtable (F18)", () => {
  describe("toAirtableFieldKey", () => {
    it("strips leading/trailing whitespace", () => {
      expect(toAirtableFieldKey("  Price  ")).toBe("Price");
    });
    it("preserves alphanumerics, spaces, hyphens, dots, parens, &", () => {
      expect(toAirtableFieldKey("Price (USD) & Tax / 2026.Q1")).toBe("Price (USD) & Tax / 2026.Q1");
    });
    it("removes disallowed characters", () => {
      expect(toAirtableFieldKey("name<script>")).toBe("namescript");
    });
    it("returns empty string for nullish", () => {
      expect(toAirtableFieldKey(null)).toBe("");
      expect(toAirtableFieldKey(undefined)).toBe("");
    });
  });

  describe("extractionToAirtableFields", () => {
    it("flattens simple key/value pairs into the fields object", () => {
      const fields = extractionToAirtableFields({
        url: "https://example.com",
        page_title: "Example",
        host: "example.com",
        ai_summary: "An example page",
      });
      expect(fields).toEqual({
        URL: "https://example.com",
        Title: "Example",
        Host: "example.com",
        Summary: "An example page",
      });
    });
    it("joins array values with comma-space", () => {
      const fields = extractionToAirtableFields({
        url: "u", page_title: "t", host: "h", ai_summary: "s",
        headings: ["H1", "H2", "H3"],
        links: ["a", "b"],
      });
      expect(fields.Headings).toBe("H1, H2, H3");
      expect(fields.Links).toBe("a, b");
    });
    it("stringifies nested objects (e.g. domain_map)", () => {
      const fields = extractionToAirtableFields({
        url: "u", page_title: "t", host: "h", ai_summary: "s",
        custom_extraction: { foo: "bar" },
      });
      // custom_extraction is not in the default key list, so it's dropped
      // (this is intentional — the default schema doesn't surface it).
      expect(fields.custom_extraction).toBeUndefined();
    });
    it("returns empty object for nullish input", () => {
      expect(extractionToAirtableFields(null)).toEqual({});
      expect(extractionToAirtableFields(undefined)).toEqual({});
    });
  });

  describe("chunkForAirtable", () => {
    it("chunks into 10-record slices", () => {
      const arr = Array.from({ length: 25 }, (_, i) => ({ url: `https://x${i}.com` }));
      const chunks = chunkForAirtable(arr);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(10);
      expect(chunks[2]).toHaveLength(5);
    });
    it("returns [] for empty list", () => {
      expect(chunkForAirtable([])).toEqual([]);
    });
    it("respects a custom perChunk value", () => {
      const arr = Array.from({ length: 7 }, (_, i) => ({ url: `https://x${i}.com` }));
      const chunks = chunkForAirtable(arr, 3);
      expect(chunks.map((c) => c.length)).toEqual([3, 3, 1]);
    });
  });

  describe("validateAirtableConfig", () => {
    it("rejects missing API key", () => {
      const errors = validateAirtableConfig({ apiKey: "", baseId: "app1234567890123", tableId: "tbl1234567890123" });
      expect(errors.some((e) => /API key/i.test(e))).toBe(true);
    });
    it("rejects malformed Base ID", () => {
      const errors = validateAirtableConfig({ apiKey: "pat1234567890", baseId: "bad", tableId: "tbl1234567890123" });
      expect(errors.some((e) => /Base ID/i.test(e))).toBe(true);
    });
    it("rejects malformed Table ID", () => {
      const errors = validateAirtableConfig({ apiKey: "pat1234567890", baseId: "app1234567890123", tableId: "bad" });
      expect(errors.some((e) => /Table ID/i.test(e))).toBe(true);
    });
    it("returns no errors for a valid config", () => {
      const errors = validateAirtableConfig({
        apiKey: "patABCDEFGHIJKLMNOP",
        baseId: "appABCDEFGHIJK",
        tableId: "tblABCDEFGHIJK",
      });
      expect(errors).toEqual([]);
    });
  });

  describe("buildAirtableRequestBody", () => {
    it("wraps each item in { fields: ... } and sets typecast: true", () => {
      const body = buildAirtableRequestBody([{ url: "u1", page_title: "T1", host: "h", ai_summary: "s" }]);
      expect(body.typecast).toBe(true);
      expect(body.records).toHaveLength(1);
      expect(body.records[0].fields).toMatchObject({ URL: "u1", Title: "T1" });
    });
  });

  describe("buildAirtableRequestUrl", () => {
    it("joins base + table IDs with the canonical API base", () => {
      expect(buildAirtableRequestUrl("appXXX", "tblYYY"))
        .toBe("https://api.airtable.com/v0/appXXX/tblYYY");
    });
    it("trims whitespace", () => {
      expect(buildAirtableRequestUrl("  appXXX  ", "  tblYYY  "))
        .toBe("https://api.airtable.com/v0/appXXX/tblYYY");
    });
  });

  describe("pushToAirtable", () => {
    const validConfig = {
      apiKey: "patABCDEFGHIJKLMNOP",
      baseId: "appABCDEFGHIJK",
      tableId: "tblABCDEFGHIJK",
    };

    it("returns ok:false with errors when config is invalid", async () => {
      const result = await pushToAirtable(
        [{ url: "u", page_title: "t" }],
        { ...validConfig, apiKey: "", fetchFn: vi.fn() },
      );
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("returns ok:true with pushed=0 for empty list", async () => {
      const result = await pushToAirtable([], { ...validConfig, fetchFn: vi.fn() });
      expect(result).toMatchObject({ ok: true, pushed: 0, total: 0 });
    });

    it("posts in 10-record chunks and aggregates results", async () => {
      const items = Array.from({ length: 22 }, (_, i) => ({
        url: `https://x${i}.com`, page_title: `T${i}`, host: `x${i}.com`, ai_summary: "s",
      }));
      // Mock that mirrors real Airtable: returns the actual chunk size
      // (Airtable echoes back the records it accepted).
      const fetchFn = vi.fn().mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ records: body.records.map((r) => ({ id: "rec", fields: r.fields })) }),
        };
      });
      const result = await pushToAirtable(items, { ...validConfig, fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(3); // 10 + 10 + 2
      expect(result.pushed).toBe(22);
      expect(result.ok).toBe(true);
    });

    it("captures failed records when a chunk returns 4xx", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: { message: "INVALID_VALUE_FOR_COLUMN" } }),
      });
      const result = await pushToAirtable(
        [{ url: "u", page_title: "t", host: "h", ai_summary: "s" }],
        { ...validConfig, fetchFn },
      );
      expect(result.ok).toBe(false);
      expect(result.pushed).toBe(0);
      expect(result.failedRecords).toHaveLength(1);
      expect(result.failedRecords[0].error).toMatch(/422/);
    });

    it("captures network errors per chunk", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("DNS failure"));
      const result = await pushToAirtable(
        [{ url: "u", page_title: "t", host: "h", ai_summary: "s" }],
        { ...validConfig, fetchFn },
      );
      expect(result.ok).toBe(false);
      expect(result.failedRecords[0].error).toBe("DNS failure");
    });
  });

  describe("localStorage config", () => {
    it("readAirtableConfig returns defaults when nothing stored", () => {
      expect(readAirtableConfig()).toEqual({ baseId: "", tableId: "" });
    });
    it("writeAirtableConfig persists baseId and tableId (NOT the API key)", () => {
      writeAirtableConfig({ baseId: "appXXX", tableId: "tblYYY" });
      const stored = JSON.parse(localStorage.getItem("datiq.airtableConfig"));
      expect(stored).toEqual({ baseId: "appXXX", tableId: "tblYYY" });
      expect(stored.apiKey).toBeUndefined();
    });
    it("readAirtableConfig round-trips what was written", () => {
      writeAirtableConfig({ baseId: "appAAA", tableId: "tblBBB" });
      expect(readAirtableConfig()).toEqual({ baseId: "appAAA", tableId: "tblBBB" });
    });
  });

  describe("_internal", () => {
    it("exposes the API cap constants", () => {
      expect(_internal.MAX_RECORDS_PER_REQUEST).toBe(10);
      expect(_internal.AIRTABLE_API_BASE).toBe("https://api.airtable.com/v0");
    });
  });
});
