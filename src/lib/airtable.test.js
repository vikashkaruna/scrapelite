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
  fetchAirtableSchema,
  fetchAirtableTables,
  createAirtableTable,
  resolveAirtableTable,
  DEFAULT_AIRTABLE_TABLE_FIELDS,
  autoMapAirtableFields,
  defaultAirtableFieldMap,
  mapAirtableColumnToKey,
  clearAirtableConfig,
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

  describe("mapAirtableColumnToKey", () => {
    it("maps common URL column names to the url extraction key", () => {
      expect(mapAirtableColumnToKey("URL")).toBe("url");
      expect(mapAirtableColumnToKey("url")).toBe("url");
      expect(mapAirtableColumnToKey("Link")).toBe("url");
      expect(mapAirtableColumnToKey("Source URL")).toBe("url");
      expect(mapAirtableColumnToKey("Address")).toBe("url");
    });
    it("maps title/name/host/summary/headings/links/created columns", () => {
      expect(mapAirtableColumnToKey("Title")).toBe("page_title");
      expect(mapAirtableColumnToKey("Name")).toBe("page_title");
      expect(mapAirtableColumnToKey("Host")).toBe("host");
      expect(mapAirtableColumnToKey("Domain")).toBe("host");
      expect(mapAirtableColumnToKey("Summary")).toBe("ai_summary");
      expect(mapAirtableColumnToKey("AI Summary")).toBe("ai_summary");
      expect(mapAirtableColumnToKey("Description")).toBe("ai_summary");
      expect(mapAirtableColumnToKey("Headings")).toBe("headings");
      expect(mapAirtableColumnToKey("Links")).toBe("links");
      expect(mapAirtableColumnToKey("Created at")).toBe("created_at");
      expect(mapAirtableColumnToKey("Date")).toBe("created_at");
    });
    it("returns empty string for unknown column names (caller skips them)", () => {
      expect(mapAirtableColumnToKey("Favorite Color")).toBe("");
      expect(mapAirtableColumnToKey("Notes")).toBe("");
    });
  });

  describe("defaultAirtableFieldMap", () => {
    it("returns a fresh object each call (no shared mutation)", () => {
      const a = defaultAirtableFieldMap();
      const b = defaultAirtableFieldMap();
      expect(a).not.toBe(b);
      a.URL = { key: "mutated" };
      expect(b.URL.key).toBe("url");
    });
    it("covers URL, Title, Host, Summary, Created at, Headings, Links", () => {
      const map = defaultAirtableFieldMap();
      expect(Object.keys(map).sort()).toEqual([
        "Created at", "Headings", "Host", "Links", "Summary", "Title", "URL",
      ]);
    });
  });

  describe("autoMapAirtableFields", () => {
    it("builds a field map from Airtable's field list", () => {
      const tableFields = [
        { name: "URL", type: "url" },
        { name: "Title", type: "singleLineText" },
        { name: "Page Title", type: "singleLineText" },
        { name: "Favorite Color", type: "singleLineText" },
        { name: "Summary", type: "multilineText" },
        { name: "Created", type: "date" },
      ];
      const map = autoMapAirtableFields(tableFields);
      expect(map).toEqual({
        URL: { key: "url" },
        Title: { key: "page_title" },
        "Page Title": { key: "page_title" },
        Summary: { key: "ai_summary" },
        Created: { key: "created_at" },
      });
      // Favorite Color is not auto-mapped (no heuristic match)
      expect(map["Favorite Color"]).toBeUndefined();
    });
    it("returns empty map for non-array input", () => {
      expect(autoMapAirtableFields(null)).toEqual({});
      expect(autoMapAirtableFields(undefined)).toEqual({});
      expect(autoMapAirtableFields("not an array")).toEqual({});
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
    it("uses a custom fieldMap when provided (REGRESSION: bug that caused 422 'Unknown field name: URL')", () => {
      // The user's Airtable table has columns called "Link" and "Name"
      // instead of "URL" and "Title". After clicking "Load columns", the
      // auto-mapped fieldMap is { Link: { key: "url" }, Name: { key: "page_title" } }.
      // The push must use the user's column names — not the defaults.
      const customMap = {
        Link: { key: "url" },
        Name: { key: "page_title" },
      };
      const fields = extractionToAirtableFields(
        { url: "https://example.com", page_title: "Example" },
        customMap,
      );
      expect(fields).toEqual({ Link: "https://example.com", Name: "Example" });
      // The defaults (URL, Title) must NOT appear — that's the whole point.
      expect(fields.URL).toBeUndefined();
      expect(fields.Title).toBeUndefined();
    });
    it("derives host from url when host is missing", () => {
      const fields = extractionToAirtableFields({ url: "https://www.example.com/path" });
      expect(fields.Host).toBe("www.example.com");
    });
    it("falls back to the default fieldMap when custom map is empty/null", () => {
      const fields = extractionToAirtableFields({ url: "u" }, null);
      expect(fields.URL).toBe("u");
      const fields2 = extractionToAirtableFields({ url: "u" }, {});
      expect(fields2.URL).toBe("u");
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
    it("uses a custom fieldMap when provided", () => {
      const body = buildAirtableRequestBody(
        [{ url: "u1", page_title: "T1" }],
        { Link: { key: "url" }, Name: { key: "page_title" } },
      );
      expect(body.records[0].fields).toEqual({ Link: "u1", Name: "T1" });
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
        if (init.method === "GET") return { ok: true, status: 200, json: async () => ({ records: [] }) };
        const body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ records: body.records.map((r) => ({ id: "rec", fields: r.fields })) }) };
      });
      const result = await pushToAirtable(items, { ...validConfig, fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(44); // lookup + create per record
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
        [{ url: "https://example.com", page_title: "t", host: "h", ai_summary: "s" }],
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
        [{ url: "https://example.com", page_title: "t", host: "h", ai_summary: "s" }],
        { ...validConfig, fetchFn },
      );
      expect(result.ok).toBe(false);
      expect(result.failedRecords[0].error).toBe("DNS failure");
    });

    it("parses Unknown field name from 422 and lists the rejected fields + a hint to load columns (REGRESSION: '7 record(s) failed' error from user)", async () => {
      // Real Airtable response shape: { error: { type: "UNKNOWN_FIELD_NAME", message: "Unknown field name: \"URL\"" } }
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: { type: "UNKNOWN_FIELD_NAME", message: 'Unknown field name: "URL"' },
        }),
      });
      const result = await pushToAirtable(
        [{ url: "https://example.com", page_title: "Example" }],
        { ...validConfig, fetchFn },
      );
      expect(result.ok).toBe(false);
      expect(result.failedRecords).toHaveLength(1);
      expect(result.failedRecords[0].error).toMatch(/Unknown field name: "URL"/);
      expect(result.failedRecords[0].error).toMatch(/rename your Airtable columns|Load columns/i);
      expect(result.failedRecords[0].unknownFields).toEqual(["URL"]);
    });
  });

  describe("fetchAirtableSchema", () => {
    const validConfig = {
      apiKey: "patABCDEFGHIJKLMNOP",
      baseId: "appABCDEFGHIJK",
      tableId: "tblABCDEFGHIJK",
    };

    it("hits the Meta API and returns the field list", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tables: [
            {
              id: "tblOtherTable",
              name: "Other table",
              fields: [],
            },
            {
              id: "tblABCDEFGHIJK",
              name: "Scrape Results",
              fields: [
                { id: "fld1", name: "URL", type: "url" },
                { id: "fld2", name: "Title", type: "singleLineText" },
                { id: "fld3", name: "Notes", type: "multilineText" },
              ],
            },
          ],
        }),
      });
      const r = await fetchAirtableSchema({ ...validConfig, fetchFn });
      expect(fetchFn).toHaveBeenCalledWith(
        "https://api.airtable.com/v0/meta/bases/appABCDEFGHIJK/tables",
        expect.objectContaining({ method: "GET" }),
      );
      expect(r.ok).toBe(true);
      expect(r.tableName).toBe("Scrape Results");
      expect(r.fields).toEqual([
        { name: "URL", type: "url", id: "fld1", description: "" },
        { name: "Title", type: "singleLineText", id: "fld2", description: "" },
        { name: "Notes", type: "multilineText", id: "fld3", description: "" },
      ]);
    });

    it("returns ok:false with a schema-scope hint on 403", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { type: "INSUFFICIENT_PERMISSIONS", message: "You are not authorized to perform this operation." } }),
      });
      const r = await fetchAirtableSchema({ ...validConfig, fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/schema\.bases:read/);
    });

    it("returns ok:false with a Base/Table ID hint on 404", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { type: "NOT_FOUND", message: "Could not find table" } }),
      });
      const r = await fetchAirtableSchema({ ...validConfig, fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Base ID and Table ID/);
    });

    it("returns an actionable error when the configured table is absent from the base schema", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tables: [{ id: "tblOtherTable", name: "Other table", fields: [] }] }),
      });
      const r = await fetchAirtableSchema({ ...validConfig, fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/table was not found/i);
    });

    it("rejects an invalid config before fetching", async () => {
      const fetchFn = vi.fn();
      const r = await fetchAirtableSchema({ ...validConfig, apiKey: "", fetchFn });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(r.ok).toBe(false);
    });
  });

  describe("DEFAULT_AIRTABLE_TABLE_FIELDS", () => {
    it("contains standard extraction fields including URL, Title, Host, Summary, Created at, Headings, Links", () => {
      const names = DEFAULT_AIRTABLE_TABLE_FIELDS.map((f) => f.name);
      expect(names).toEqual(["URL", "Title", "Host", "Summary", "Created at", "Headings", "Links"]);
      expect(DEFAULT_AIRTABLE_TABLE_FIELDS.find((f) => f.name === "URL").type).toBe("url");
      expect(DEFAULT_AIRTABLE_TABLE_FIELDS.find((f) => f.name === "Created at").type).toBe("dateTime");
    });
  });

  describe("fetchAirtableTables", () => {
    it("lists all tables in a base", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tables: [
            { id: "tbl1", name: "Leads", fields: [{ id: "fld1", name: "URL", type: "url" }] },
            { id: "tbl2", name: "Competitors", fields: [{ id: "fld2", name: "Title", type: "singleLineText" }] },
          ],
        }),
      });
      const r = await fetchAirtableTables({ apiKey: "pat12345678901234", baseId: "app12345678", fetchFn });
      expect(r.ok).toBe(true);
      expect(r.tables.length).toBe(2);
      expect(r.tables[0].name).toBe("Leads");
      expect(r.tables[1].name).toBe("Competitors");
    });

    it("surfaces 403 scope error with actionable instruction", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { type: "AUTHENTICATION_REQUIRED", message: "Forbidden" } }),
      });
      const r = await fetchAirtableTables({ apiKey: "pat12345678901234", baseId: "app12345678", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/schema\.bases:read/);
    });

    it("rejects invalid Base ID", async () => {
      const fetchFn = vi.fn();
      const r = await fetchAirtableTables({ apiKey: "pat12345678901234", baseId: "invalidBase", fetchFn });
      expect(r.ok).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("createAirtableTable", () => {
    it("creates a table via Airtable Metadata API", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "tblNewTable123",
          name: "DatIQ Extractions",
          fields: [
            { id: "fld1", name: "URL", type: "url" },
            { id: "fld2", name: "Title", type: "singleLineText" },
          ],
        }),
      });
      const r = await createAirtableTable({
        apiKey: "pat12345678901234",
        baseId: "app12345678",
        tableName: "DatIQ Extractions",
        fetchFn,
      });
      expect(r.ok).toBe(true);
      expect(r.tableId).toBe("tblNewTable123");
      expect(r.tableName).toBe("DatIQ Extractions");
      expect(r.fields.length).toBe(2);
      expect(fetchFn).toHaveBeenCalledWith(
        "https://api.airtable.com/v0/meta/bases/app12345678/tables",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer pat12345678901234",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("surfaces 403 error explaining schema.bases:write scope requirement", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { type: "INVALID_PERMISSIONS", message: "Forbidden" } }),
      });
      const r = await createAirtableTable({
        apiKey: "pat12345678901234",
        baseId: "app12345678",
        tableName: "New Table",
        fetchFn,
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/schema\.bases:write/);
    });
  });

  describe("resolveAirtableTable", () => {
    it("resolves a table by exact tableId", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tables: [
            { id: "tblA", name: "Table A", fields: [{ name: "URL" }] },
            { id: "tblB", name: "Table B", fields: [{ name: "Title" }] },
          ],
        }),
      });
      const r = await resolveAirtableTable({
        apiKey: "pat12345678901234",
        baseId: "app12345678",
        tableIdOrName: "tblB",
        fetchFn,
      });
      expect(r.ok).toBe(true);
      expect(r.tableId).toBe("tblB");
      expect(r.tableName).toBe("Table B");
      expect(r.created).toBe(false);
    });

    it("resolves a table by friendly name (case-insensitive)", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tables: [
            { id: "tblA", name: "Prospects", fields: [{ name: "URL" }] },
          ],
        }),
      });
      const r = await resolveAirtableTable({
        apiKey: "pat12345678901234",
        baseId: "app12345678",
        tableIdOrName: "prospects",
        fetchFn,
      });
      expect(r.ok).toBe(true);
      expect(r.tableId).toBe("tblA");
      expect(r.tableName).toBe("Prospects");
      expect(r.created).toBe(false);
    });

    it("creates a new table when createIfMissing is true and table not found", async () => {
      const fetchFn = vi.fn()
        // First call: GET tables
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ tables: [{ id: "tblExisting", name: "Existing Table", fields: [] }] }),
        })
        // Second call: POST create table
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: "tblCreatedFresh",
            name: "New Extractions",
            fields: [{ id: "fld1", name: "URL", type: "url" }],
          }),
        });

      const r = await resolveAirtableTable({
        apiKey: "pat12345678901234",
        baseId: "app12345678",
        tableIdOrName: "New Extractions",
        createIfMissing: true,
        fetchFn,
      });
      expect(r.ok).toBe(true);
      expect(r.tableId).toBe("tblCreatedFresh");
      expect(r.tableName).toBe("New Extractions");
      expect(r.created).toBe(true);
    });
  });

  describe("localStorage config", () => {
    it("readAirtableConfig returns empty defaults when nothing stored", () => {
      const cfg = readAirtableConfig();
      expect(cfg.baseId).toBe("");
      expect(cfg.tableId).toBe("");
      expect(cfg.fieldMap).toBeNull();
      expect(cfg.tableMeta).toBeNull();
    });
    it("writeAirtableConfig persists the fieldMap under a per-table key", () => {
      writeAirtableConfig({
        baseId: "appAAA",
        tableId: "tblBBB",
        fieldMap: { Link: { key: "url" } },
        tableMeta: { tableName: "X", fields: [{ name: "Link", type: "url" }] },
      });
      const stored = JSON.parse(localStorage.getItem("datiq.airtableConfig"));
      expect(stored.currentBaseId).toBe("appAAA");
      expect(stored.currentTableId).toBe("tblBBB");
      expect(stored.tables["appAAA::tblBBB"]).toEqual({
        fieldMap: { Link: { key: "url" } },
        tableMeta: { tableName: "X", fields: [{ name: "Link", type: "url" }] },
      });
    });
    it("readAirtableConfig round-trips what was written", () => {
      writeAirtableConfig({
        baseId: "appAAA",
        tableId: "tblBBB",
        fieldMap: { Link: { key: "url" } },
        tableMeta: { tableName: "X", fields: [{ name: "Link" }] },
      });
      expect(readAirtableConfig()).toMatchObject({
        baseId: "appAAA",
        tableId: "tblBBB",
        fieldMap: { Link: { key: "url" } },
        tableMeta: { tableName: "X" },
      });
    });
    it("keeps separate fieldMaps per table (switching back restores the previous one)", () => {
      writeAirtableConfig({
        baseId: "appA",
        tableId: "tblA",
        fieldMap: { Link: { key: "url" } },
      });
      writeAirtableConfig({
        baseId: "appA",
        tableId: "tblB",
        fieldMap: { Source: { key: "url" } },
      });
      // Current is tblB
      expect(readAirtableConfig().fieldMap).toEqual({ Source: { key: "url" } });
      // Switch back to tblA — its fieldMap is still there
      writeAirtableConfig({ baseId: "appA", tableId: "tblA" });
      expect(readAirtableConfig().fieldMap).toEqual({ Link: { key: "url" } });
    });
    it("passing fieldMap: null explicitly clears it for the current table only", () => {
      writeAirtableConfig({
        baseId: "appA",
        tableId: "tblA",
        fieldMap: { Link: { key: "url" } },
      });
      writeAirtableConfig({ fieldMap: null });
      expect(readAirtableConfig().fieldMap).toBeNull();
      const stored = JSON.parse(localStorage.getItem("datiq.airtableConfig"));
      expect(stored.tables["appA::tblA"]).toBeUndefined();
    });
    it("clearAirtableConfig removes everything", () => {
      writeAirtableConfig({ baseId: "appX", tableId: "tblY" });
      clearAirtableConfig();
      expect(localStorage.getItem("datiq.airtableConfig")).toBeNull();
    });
    it("does not persist the API key", () => {
      writeAirtableConfig({
        baseId: "appX",
        tableId: "tblY",
        fieldMap: { Link: { key: "url" } },
      });
      const stored = JSON.parse(localStorage.getItem("datiq.airtableConfig"));
      expect(stored.apiKey).toBeUndefined();
      // Also no key nested anywhere
      const allJson = JSON.stringify(stored);
      expect(allJson).not.toMatch(/pat[A-Z]/);
    });
  });

  describe("_internal", () => {
    it("exposes the API cap constants", () => {
      expect(_internal.MAX_RECORDS_PER_REQUEST).toBe(10);
      expect(_internal.AIRTABLE_API_BASE).toBe("https://api.airtable.com/v0");
    });
  });
});
