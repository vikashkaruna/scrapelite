// src/lib/notion.test.js — F18 (Notion export adapter, unit tests).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toNotionProperty,
  defaultNotionSchema,
  extractionToNotionProperties,
  buildNotionPageBody,
  validateNotionConfig,
  fetchNotionSchema,
  pushToNotion,
  readNotionConfig,
  writeNotionConfig,
  autoMapNotionSchema,
  mapNotionColumnToKey,
  buildNotionPageChildren,
  _internal,
} from "./notion.js";

beforeEach(() => {
  try { localStorage.removeItem("datiq.notionConfig"); } catch {}
});

describe("notion (F18)", () => {
  describe("toNotionProperty", () => {
    it("returns null for nullish values", () => {
      expect(toNotionProperty(null, "title")).toBeNull();
      expect(toNotionProperty(undefined, "url")).toBeNull();
    });
    it("formats title", () => {
      const p = toNotionProperty("Hello", "title");
      expect(p).toEqual({ title: [{ type: "text", text: { content: "Hello" } }] });
    });
    it("formats rich_text", () => {
      const p = toNotionProperty("body text", "rich_text");
      expect(p).toEqual({ rich_text: [{ type: "text", text: { content: "body text" } }] });
    });
    it("formats url only for http(s) URLs", () => {
      expect(toNotionProperty("https://example.com", "url")).toEqual({ url: "https://example.com" });
      expect(toNotionProperty("not-a-url", "url")).toBeNull();
    });
    it("formats number", () => {
      expect(toNotionProperty(42, "number")).toEqual({ number: 42 });
      expect(toNotionProperty("NaN", "number")).toBeNull();
    });
    it("formats checkbox as boolean", () => {
      expect(toNotionProperty(true, "checkbox")).toEqual({ checkbox: true });
      expect(toNotionProperty(0, "checkbox")).toEqual({ checkbox: false });
    });
    it("formats select", () => {
      expect(toNotionProperty("High", "select")).toEqual({ select: { name: "High" } });
    });
    it("formats multi_select from array", () => {
      expect(toNotionProperty(["a", "b"], "multi_select")).toEqual({ multi_select: [{ name: "a" }, { name: "b" }] });
    });
    it("formats multi_select from comma-separated string", () => {
      expect(toNotionProperty("a, b, c", "multi_select")).toEqual({ multi_select: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    });
    it("formats date as { start }", () => {
      expect(toNotionProperty("2026-07-19", "date")).toEqual({ date: { start: "2026-07-19" } });
    });
    it("formats email and phone_number", () => {
      expect(toNotionProperty("a@b.com", "email")).toEqual({ email: "a@b.com" });
      expect(toNotionProperty("+1-555-0100", "phone_number")).toEqual({ phone_number: "+1-555-0100" });
    });
    it("truncates to 2000 chars for text properties", () => {
      const long = "x".repeat(3000);
      const p = toNotionProperty(long, "title");
      expect(p.title[0].text.content).toHaveLength(2000);
    });
    it("falls back to rich_text for unknown types", () => {
      const p = toNotionProperty("fallback", "unknown_type");
      expect(p).toHaveProperty("rich_text");
    });
  });

  describe("defaultNotionSchema", () => {
    it("returns 6 columns (Title, URL, Host, Summary, Headings, Created)", () => {
      const s = defaultNotionSchema();
      expect(Object.keys(s)).toEqual(["Title", "URL", "Host", "Summary", "Headings", "Created"]);
    });
    it("Title column has type 'title'", () => {
      expect(defaultNotionSchema().Title.type).toBe("title");
    });
  });

  describe("extractionToNotionProperties", () => {
    it("maps an extraction to the default schema", () => {
      const props = extractionToNotionProperties({
        url: "https://example.com",
        page_title: "Example",
        host: "example.com",
        ai_summary: "A summary",
        headings: ["H1", "H2"],
        created_at: "2026-07-19T00:00:00Z",
      });
      expect(props.Title).toEqual({ title: [{ type: "text", text: { content: "Example" } }] });
      expect(props.URL).toEqual({ url: "https://example.com" });
      expect(props.Host.rich_text[0].text.content).toBe("example.com");
      expect(props.Summary.rich_text[0].text.content).toBe("A summary");
      expect(props.Headings.rich_text[0].text.content).toBe("H1, H2");
      expect(props.Created).toEqual({ date: { start: "2026-07-19T00:00:00Z" } });
    });
    it("falls back to deriving host from url when host is missing", () => {
      const props = extractionToNotionProperties({ url: "https://fallback.com/path", page_title: "T", host: "", ai_summary: "s" });
      expect(props.Host.rich_text[0].text.content).toBe("fallback.com");
    });
    it("returns empty object for nullish input", () => {
      expect(extractionToNotionProperties(null)).toEqual({});
    });
  });

  describe("buildNotionPageBody", () => {
    it("sets the parent database_id and properties", () => {
      const body = buildNotionPageBody(
        { url: "https://x.com", page_title: "X", host: "x.com", ai_summary: "s" },
        { databaseId: "abc123" },
      );
      expect(body.parent).toEqual({ database_id: "abc123" });
      expect(body.properties).toBeDefined();
    });
    it("throws when databaseId is missing", () => {
      expect(() => buildNotionPageBody({ url: "u", page_title: "t" }, {})).toThrow(/databaseId/);
    });
  });

  describe("validateNotionConfig", () => {
    it("rejects missing API key", () => {
      const errors = validateNotionConfig({ apiKey: "", databaseId: "a".repeat(32) });
      expect(errors.some((e) => /API key/i.test(e))).toBe(true);
    });
    it("rejects malformed database ID", () => {
      const errors = validateNotionConfig({ apiKey: "secret_xxxxxxxxxxxxxxxx", databaseId: "bad" });
      expect(errors.some((e) => /Database ID/i.test(e))).toBe(true);
    });
    it("accepts UUID with dashes", () => {
      const errors = validateNotionConfig({ apiKey: "secret_xxxxxxxxxxxxxxxx", databaseId: "abcdef01-2345-6789-abcd-ef0123456789" });
      expect(errors).toEqual([]);
    });
    it("accepts UUID without dashes", () => {
      const errors = validateNotionConfig({ apiKey: "secret_xxxxxxxxxxxxxxxx", databaseId: "abcdef0123456789abcdef0123456789" });
      expect(errors).toEqual([]);
    });
  });

  describe("fetchNotionSchema", () => {
    it("rejects an invalid database ID format without calling fetch", async () => {
      const fetchFn = vi.fn();
      const result = await fetchNotionSchema({ apiKey: "secret_xxxxxxxxxxxxxxxx", databaseId: "bad", fetchFn });
      expect(result.ok).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("returns parsed properties on success", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          title: [{ plain_text: "My DB" }],
          properties: {
            Name: { type: "title" },
            URL:  { type: "url" },
            Tags: { type: "multi_select" },
          },
        }),
      });
      const r = await fetchNotionSchema({
        apiKey: "secret_xxxxxxxxxxxxxxxx",
        databaseId: "abcdef0123456789abcdef0123456789",
        fetchFn,
      });
      expect(r.ok).toBe(true);
      expect(r.titleColumn).toBe("Name");
      expect(r.properties).toEqual({ Name: "title", URL: "url", Tags: "multi_select" });
      expect(r.rawTitle).toBe("My DB");
    });

    it("surfaces 4xx errors with the Notion message", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "API token is invalid." }),
      });
      const r = await fetchNotionSchema({
        apiKey: "secret_xxxxxxxxxxxxxxxx",
        databaseId: "abcdef0123456789abcdef0123456789",
        fetchFn,
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/401.*API token is invalid/);
    });
  });

  describe("pushToNotion", () => {
    const validConfig = {
      apiKey: "secret_abcdefghijklmnop",
      databaseId: "abcdef0123456789abcdef0123456789",
    };

    it("returns ok:false with errors when config is invalid", async () => {
      const r = await pushToNotion(
        [{ url: "u", page_title: "t" }],
        { ...validConfig, apiKey: "", fetchFn: vi.fn() },
      );
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it("returns ok:true with pushed=0 for empty list", async () => {
      const r = await pushToNotion([], { ...validConfig, fetchFn: vi.fn() });
      expect(r).toMatchObject({ ok: true, pushed: 0, total: 0 });
    });

    it("posts one page per item and aggregates results", async () => {
      const fetchFn = vi.fn().mockImplementation(async (url) =>
        url.includes("/query")
          ? { ok: true, status: 200, json: async () => ({ results: [] }) }
          : { ok: true, status: 200, json: async () => ({ id: "p" }) },
      );
      const items = [
        { url: "https://a.com", page_title: "A", host: "a.com", ai_summary: "s" },
        { url: "https://b.com", page_title: "B", host: "b.com", ai_summary: "s" },
      ];
      const r = await pushToNotion(items, { ...validConfig, fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(4); // query + create per item
      expect(r.pushed).toBe(2);
      expect(r.ok).toBe(true);
    });

    it("captures per-item failures", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "validation_error" }) });
      const r = await pushToNotion(
        [{ url: "https://x.com", page_title: "X", host: "x.com", ai_summary: "s" }],
        { ...validConfig, fetchFn },
      );
      expect(r.ok).toBe(false);
      expect(r.pushed).toBe(0);
      expect(r.failedRecords[0].error).toMatch(/400/);
    });

    it("creates page with populated properties when raw schema { Name: 'title', URL: 'url' } is passed", async () => {
      let createdBody = null;
      const fetchFn = vi.fn().mockImplementation(async (url, init) => {
        if (url.includes("/query")) {
          return { ok: true, status: 200, json: async () => ({ results: [] }) };
        }
        if (url.includes("/pages")) {
          createdBody = JSON.parse(init.body);
          return { ok: true, status: 200, json: async () => ({ id: "page_123" }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });
      const item = {
        url: "https://lumio.ai",
        page_title: "Lumio - Visual Intelligence",
        host: "lumio.ai",
        ai_summary: "Visual AI platform",
        headings: ["Heading 1", "Heading 2"],
        created_at: "2026-09-08T00:00:00.000Z",
      };
      const rawSchema = { Name: "title", URL: "url", Summary: "rich_text" };
      const r = await pushToNotion([item], { ...validConfig, schema: rawSchema, fetchFn });
      expect(r.ok).toBe(true);
      expect(r.pushed).toBe(1);
      expect(createdBody).not.toBeNull();
      expect(createdBody.properties.Name.title[0].text.content).toBe("Lumio - Visual Intelligence");
      expect(createdBody.properties.URL.url).toBe("https://lumio.ai");
      expect(createdBody.properties.Summary.rich_text[0].text.content).toBe("Visual AI platform");
      expect(createdBody.children).toBeDefined();
      expect(createdBody.children.length).toBeGreaterThan(0);
    });

    it("falls back to creating page when deduplication query returns 400", async () => {
      let created = false;
      const fetchFn = vi.fn().mockImplementation(async (url) => {
        if (url.includes("/query")) {
          return { ok: false, status: 400, json: async () => ({ message: "Property not found" }) };
        }
        if (url.includes("/pages")) {
          created = true;
          return { ok: true, status: 200, json: async () => ({ id: "page_new" }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });
      const r = await pushToNotion(
        [{ url: "https://lumio.ai", page_title: "Lumio", host: "lumio.ai", ai_summary: "AI" }],
        { ...validConfig, fetchFn },
      );
      expect(r.ok).toBe(true);
      expect(r.pushed).toBe(1);
      expect(created).toBe(true);
    });
  });

  describe("autoMapNotionSchema", () => {
    it("converts raw Notion property types to normalized schema map", () => {
      const raw = {
        Name: "title",
        Website: "url",
        Notes: "rich_text",
        FormulaCol: "formula",
        RollupCol: "rollup",
      };
      const schema = autoMapNotionSchema(raw, "Name");
      expect(schema.Name).toEqual({ type: "title", key: "page_title" });
      expect(schema.Website).toEqual({ type: "url", key: "url" });
      expect(schema.Notes).toEqual({ type: "rich_text", key: "ai_summary" });
      expect(schema.FormulaCol).toBeUndefined(); // read-only skipped
      expect(schema.RollupCol).toBeUndefined(); // read-only skipped
    });

    it("preserves already normalized schema maps", () => {
      const existing = {
        Title: { type: "title", key: "page_title" },
        URL: { type: "url", key: "url" },
      };
      const schema = autoMapNotionSchema(existing);
      expect(schema).toBe(existing);
    });
  });

  describe("buildNotionPageChildren", () => {
    it("builds callout for summary, link for url, and bullet items for headings", () => {
      const item = {
        url: "https://lumio.ai",
        ai_summary: "AI powered scraper",
        headings: ["H1 Alpha", "H2 Beta"],
      };
      const blocks = buildNotionPageChildren(item);
      expect(blocks.some((b) => b.type === "callout")).toBe(true);
      expect(blocks.some((b) => b.type === "paragraph")).toBe(true);
      expect(blocks.some((b) => b.type === "bulleted_list_item")).toBe(true);
    });

    it("returns empty array when item has no content", () => {
      expect(buildNotionPageChildren({})).toEqual([]);
    });
  });

  describe("localStorage config", () => {
    it("readNotionConfig returns defaults when nothing stored", () => {
      expect(readNotionConfig().databaseId).toBe("");
      expect(readNotionConfig().schema).toBeDefined();
    });
    it("writeNotionConfig persists databaseId (NOT the API key)", () => {
      writeNotionConfig({ databaseId: "abc123" });
      const stored = JSON.parse(localStorage.getItem("datiq.notionConfig"));
      expect(stored.databaseId).toBe("abc123");
      expect(stored.apiKey).toBeUndefined();
    });
  });

  describe("_internal", () => {
    it("exposes the API constants", () => {
      expect(_internal.NOTION_API_BASE).toBe("https://api.notion.com/v1");
      expect(_internal.NOTION_VERSION).toBe("2022-06-28");
      expect(_internal.MAX_REQUESTS_PER_PUSH).toBe(25);
    });
  });
});
