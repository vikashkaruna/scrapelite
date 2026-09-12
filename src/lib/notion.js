// src/lib/notion.js — F18 (Notion export adapter).
//
// Council intent: same as airtable.js — non-technical personas store their
// data in Notion, so we ship an adapter that POSTs to the Notion API
// using a per-page integration token.
//
// API-key-paste flow (no OAuth): the user pastes their Notion Internal
// Integration Secret and a target Database ID. We POST pages directly.
//
// API shape: https://developers.notion.com/reference/post-page
//   POST /v1/pages
//   Authorization: Bearer {apiKey}
//   Notion-Version: 2022-06-28
//   Body: { parent: { database_id }, properties: {...}, children: [...] }
//
// Property types we know how to set:
//   - title      → { title: [{ text: { content: "..." } }] }
//   - rich_text  → { rich_text: [{ text: { content: "..." } }] }
//   - url        → { url: "..." }
//   - number     → { number: <n> }
//   - checkbox   → { checkbox: true|false }
//   - select     → { select: { name: "..." } }
//   - multi_select → { multi_select: [{ name: "..." }, ...] }
//   - date       → { date: { start: "..." } }
//   - email      → { email: "..." }
//   - phone_number → { phone_number: "..." }

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_REQUESTS_PER_PUSH = 25;

export const NOTION_READ_ONLY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "button",
]);

import { canonicalSourceUrl, sourceUrlField } from "./urlIdentity.js";

// ── Pure helpers (unit-testable) ─────────────────────────────────────────────

/**
 * Convert a single value to a Notion property payload, given the column's
 * declared `type`. We pass type in because the database schema (returned
 * by the schema-fetch path) is the only place that knows if a column is
 * `title` vs `rich_text` etc.
 */
export function toNotionProperty(value, type) {
  if (value == null) return null;
  const t = String(type || "rich_text").toLowerCase();
  switch (t) {
    case "title": {
      const s = String(value ?? "").trim() || "Untitled Extraction";
      return { title: [{ type: "text", text: { content: s.slice(0, 2000) } }] };
    }
    case "rich_text": {
      const s = String(value ?? "");
      return s ? { rich_text: [{ type: "text", text: { content: s.slice(0, 2000) } }] } : null;
    }
    case "url": {
      const s = String(value ?? "").trim();
      return /^https?:\/\//i.test(s) ? { url: s } : null;
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? { number: n } : null;
    }
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "select": {
      const s = String(value ?? "").trim();
      return s ? { select: { name: s.slice(0, 100) } } : null;
    }
    case "multi_select": {
      const arr = Array.isArray(value) ? value : String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return arr.length > 0
        ? { multi_select: arr.slice(0, 100).map((name) => ({ name: String(name).slice(0, 100) })) }
        : null;
    }
    case "date": {
      const s = String(value ?? "").trim();
      if (!s) return null;
      const parsed = Date.parse(s);
      if (Number.isNaN(parsed)) return null;
      return { date: { start: s } };
    }
    case "email": {
      const s = String(value ?? "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { email: s } : null;
    }
    case "phone_number": {
      const s = String(value ?? "").trim();
      return s ? { phone_number: s } : null;
    }
    default: {
      const s = String(value ?? "");
      return s ? { rich_text: [{ type: "text", text: { content: s.slice(0, 2000) } }] } : null;
    }
  }
}

/**
 * Map a Notion column name and type to the extraction key it should pull from.
 */
export function mapNotionColumnToKey(name, type) {
  const n = String(name || "").trim().toLowerCase();
  const t = String(type || "").trim().toLowerCase();
  if (t === "title") return "page_title";
  if (n === "url" || n === "link" || n === "source url" || n === "source" || n === "address" || n === "site" || n === "website" || n === "page url") return "url";
  if (n === "title" || n === "name" || n === "page title" || n === "page" || n === "company") return "page_title";
  if (n === "host" || n === "domain" || n === "hostname") return "host";
  if (n === "summary" || n === "ai summary" || n === "description" || n === "desc" || n === "notes" || n === "overview" || n === "about") return "ai_summary";
  if (n === "headings" || n === "h1/h2/h3" || n === "h1-h6" || n === "headers" || n === "outline") return "headings";
  if (n === "links" || n === "all links" || n === "urls") return "links";
  if (n === "created" || n === "created at" || n === "date" || n === "added on" || n === "timestamp" || n === "extracted" || n === "extracted at") return "created_at";
  if (t === "url") return "url";
  if (t === "date") return "created_at";
  return "";
}

/**
 * Build a default schema for an extraction. The user can later "Map fields"
 * to override the column type. We default to:
 *   - Title (title)        ← page_title
 *   - URL (url)            ← url
 *   - Host (rich_text)     ← host
 *   - Summary (rich_text)  ← ai_summary
 *   - Headings (rich_text) ← joined
 *   - Created (date)       ← created_at
 */
export function defaultNotionSchema() {
  return {
    Title:    { type: "title",     key: "page_title" },
    URL:      { type: "url",       key: "url" },
    Host:     { type: "rich_text", key: "host" },
    Summary:  { type: "rich_text", key: "ai_summary" },
    Headings: { type: "rich_text", key: "headings" },
    Created:  { type: "date",      key: "created_at" },
  };
}

/**
 * Convert any Notion database properties representation into a normalized schema:
 *   { [columnName]: { type: string, key: string } }
 * Handles:
 *   - full schema maps: { Title: { type: "title", key: "page_title" } }
 *   - raw type maps:    { Name: "title", URL: "url", Summary: "rich_text" }
 *   - partial objects:  { Name: { type: "title" } }
 */
export function autoMapNotionSchema(properties, titleColumn) {
  if (!properties || typeof properties !== "object") return defaultNotionSchema();
  const entries = Object.entries(properties);
  if (entries.length === 0) return defaultNotionSchema();

  const isAlreadyFullSchema = entries.every(
    ([, v]) => v && typeof v === "object" && typeof v.type === "string" && typeof v.key === "string"
  );
  if (isAlreadyFullSchema) {
    return properties;
  }

  const out = {};
  for (const [colName, val] of entries) {
    let type = typeof val === "string" ? val : (val?.type || "rich_text");
    if (NOTION_READ_ONLY_TYPES.has(String(type).toLowerCase())) continue;

    let key = typeof val === "object" && val?.key ? val.key : "";
    if (!key) {
      if (type === "title" || colName === titleColumn) {
        key = "page_title";
        type = "title";
      } else {
        key = mapNotionColumnToKey(colName, type);
      }
    }
    if (key || type === "title") {
      out[colName] = { type, key: key || "page_title" };
    }
  }

  const hasTitle = Object.values(out).some((def) => def.type === "title");
  if (!hasTitle) {
    const titleName = titleColumn || "Title";
    out[titleName] = { type: "title", key: "page_title" };
  }

  return Object.keys(out).length > 0 ? out : defaultNotionSchema();
}

function readExtractionValue(extraction, key) {
  if (!extraction || !key) return null;
  if (key === "headings" || key === "links") {
    if (Array.isArray(extraction[key])) {
      return extraction[key].length > 0 ? extraction[key].join(", ") : "";
    }
    return extraction[key] ?? "";
  }
  if (key === "host") {
    if (extraction.host) return extraction.host;
    try { return new URL(extraction.url || extraction.source_url).hostname; } catch { return ""; }
  }
  if (key === "page_title") {
    return extraction.page_title || extraction.title || extraction.url || "";
  }
  if (key === "ai_summary") {
    return extraction.ai_summary || extraction.summary || "";
  }
  if (key === "url") {
    return extraction.url || extraction.source_url || "";
  }
  if (key === "created_at") {
    return extraction.created_at || extraction.date || "";
  }
  return extraction[key] ?? "";
}

/**
 * Convert an extraction into Notion `properties` using a schema map.
 * Pure: no fetch.
 */
export function extractionToNotionProperties(extraction, schema = defaultNotionSchema()) {
  if (!extraction) return {};
  const normalizedSchema = autoMapNotionSchema(schema);
  const out = {};
  for (const [columnName, def] of Object.entries(normalizedSchema || {})) {
    const rawKey = def?.key || mapNotionColumnToKey(columnName, def?.type);
    let raw = readExtractionValue(extraction, rawKey);
    // Guarantee title column is never nullish if we have any identity
    if ((def?.type === "title" || (!raw && def?.key === "page_title")) && !raw) {
      raw = extraction.page_title || extraction.title || extraction.url || "Untitled Extraction";
    }
    const prop = toNotionProperty(raw, def?.type);
    if (prop != null) out[columnName] = prop;
  }
  return out;
}

/**
 * Build page body blocks (children) so that opening the Notion page reveals
 * the full extraction summary, source link, and headings outline.
 */
export function buildNotionPageChildren(extraction) {
  if (!extraction) return [];
  const children = [];

  // 1. AI Summary Callout
  const summary = String(extraction.ai_summary || extraction.summary || "").trim();
  if (summary) {
    children.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: summary.slice(0, 2000) } }],
        icon: { type: "emoji", emoji: "💡" },
      },
    });
  }

  // 2. Source Link paragraph
  const sourceUrl = String(extraction.url || extraction.source_url || "").trim();
  if (/^https?:\/\//i.test(sourceUrl)) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "Source URL: " } },
          { type: "text", text: { content: sourceUrl.slice(0, 1000), link: { url: sourceUrl } } },
        ],
      },
    });
  }

  // 3. Headings outline
  const headings = Array.isArray(extraction.headings)
    ? extraction.headings.filter(Boolean)
    : typeof extraction.headings === "string" && extraction.headings
      ? extraction.headings.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  if (headings.length > 0) {
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Key Headings" } }],
      },
    });
    for (const h of headings.slice(0, 8)) {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: String(h).slice(0, 2000) } }],
        },
      });
    }
  }

  return children;
}

/**
 * Build the Notion request body for one extraction.
 */
export function buildNotionPageBody(extraction, { databaseId, schema } = {}) {
  if (!databaseId) throw new Error("databaseId is required");
  const properties = extractionToNotionProperties(extraction, schema);
  const body = {
    parent: { database_id: String(databaseId).replace(/-/g, "") },
    properties,
  };
  const children = buildNotionPageChildren(extraction);
  if (children.length > 0) {
    body.children = children;
  }
  return body;
}

export function buildNotionUrlQuery(databaseId, schema, url) {
  const normalizedSchema = autoMapNotionSchema(schema);
  const field = sourceUrlField(normalizedSchema);
  const canonical = canonicalSourceUrl(url);
  if (!databaseId || !canonical || !field) return null;
  // If the schema is populated and does not have this property, don't query
  if (schema && typeof schema === "object" && Object.keys(schema).length > 0 && !normalizedSchema[field]) {
    return null;
  }
  const propDef = normalizedSchema[field];
  const isRichText = propDef?.type === "rich_text";
  const filter = isRichText
    ? { property: field, rich_text: { equals: canonical } }
    : { property: field, url: { equals: canonical } };
  return {
    url: `${NOTION_API_BASE}/databases/${String(databaseId).replace(/-/g, "")}/query`,
    body: { page_size: 1, filter },
  };
}

async function findNotionPage({ apiKey, databaseId, schema, url, fetchFn }) {
  const query = buildNotionUrlQuery(databaseId, schema, url);
  if (!query) return { ok: true, page: null };
  const res = await fetchFn(query.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify(query.body),
  });
  if (!res.ok) {
    // If Notion rejected the query with 400 (e.g. filter property not in database),
    // proceed to create without failing the push.
    if (res.status === 400) {
      return { ok: true, page: null, dedupSkipped: true };
    }
    return { ok: false, error: `Notion deduplication query failed (${res.status}).` };
  }
  const data = await res.json();
  return { ok: true, page: data?.results?.[0] || null };
}

async function updateNotionPage({ apiKey, pageId, properties, fetchFn }) {
  const res = await fetchFn(`${NOTION_API_BASE}/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    let msg = `Notion update failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) msg += `: ${data.message}`;
    } catch {}
    return { ok: false, error: msg };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, id: data?.id || pageId };
}

/**
 * Validate a Notion config. Secret starts with "secret_" or "ntn_" (new
 * format) per Notion docs. Database ID is a 32-char hex.
 */
export function validateNotionConfig({ apiKey, databaseId } = {}) {
  const errors = [];
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 20) {
    errors.push("Notion API key is required (paste it from your integration settings).");
  } else if (!/^(secret_|ntn_)[A-Za-z0-9_\-]+/i.test(apiKey.trim())) {
    // Soft warning — Notion's "Internal Integration Secret" format.
  }
  if (!databaseId || !/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(databaseId.trim())) {
    errors.push("Database ID is required and should be a 32-char UUID.");
  }
  return errors;
}

/**
 * Fetch the database schema (so the user can see columns and pick the
 * right title column). Hits GET /v1/databases/{id}.
 */
export async function fetchNotionSchema({ apiKey, databaseId, fetchFn = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
  if (!fetchFn) return { ok: false, error: "No fetch available (SSR?)" };
  const dbId = (databaseId || "").replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(dbId)) {
    return { ok: false, error: "Invalid database ID format" };
  }
  try {
    const res = await fetchFn(`${NOTION_API_BASE}/databases/${dbId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) {
      let msg = `Notion ${res.status}`;
      try {
        const data = await res.json();
        if (data?.message) msg = `${msg}: ${data.message}`;
      } catch { /* body wasn't JSON */ }
      return { ok: false, error: msg };
    }
    const data = await res.json();
    const rawProperties = data.properties || {};
    const titleColumn = Object.entries(rawProperties).find(([, p]) => p.type === "title")?.[0] || "Name";
    const properties = Object.fromEntries(
      Object.entries(rawProperties).map(([name, p]) => [name, p.type]),
    );
    const schema = autoMapNotionSchema(properties, titleColumn);
    return {
      ok: true,
      titleColumn,
      properties,
      schema,
      rawTitle: data.title?.[0]?.plain_text || "",
    };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}

// ── Side-effecting: do the push (browser fetch) ─────────────────────────────

export async function pushToNotion(items, { apiKey, databaseId, schema, fetchFn } = {}) {
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, pushed: 0, total: 0, errors: ["No fetch available (SSR?)"], failedRecords: [] };
  const errors = validateNotionConfig({ apiKey, databaseId });
  if (errors.length) return { ok: false, pushed: 0, total: 0, errors, failedRecords: [] };
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { ok: true, pushed: 0, total: 0, errors: [], failedRecords: [] };

  const effectiveSchema = autoMapNotionSchema(schema);
  const slice = list.slice(0, MAX_REQUESTS_PER_PUSH);
  let pushed = 0;
  let created = 0;
  let updated = 0;
  const failedRecords = [];

  for (const item of slice) {
    let body;
    try {
      body = buildNotionPageBody(item, { databaseId, schema: effectiveSchema });
    } catch (err) {
      failedRecords.push({ url: item?.url, error: err.message || "build error" });
      continue;
    }
    let res;
    try {
      const existing = await findNotionPage({ apiKey, databaseId, schema: effectiveSchema, url: item?.url, fetchFn: f });
      if (!existing.ok) throw new Error(existing.error);
      if (existing.page?.id) {
        const result = await updateNotionPage({ apiKey, pageId: existing.page.id, properties: body.properties, fetchFn: f });
        if (!result.ok) throw new Error(result.error);
        updated++;
        pushed++;
        continue;
      }
      res = await f(`${NOTION_API_BASE}/pages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
        body: JSON.stringify(body),
      });
    } catch (err) {
      failedRecords.push({ url: item?.url, error: err?.message || "network error" });
      continue;
    }
    if (!res.ok) {
      let msg = `Notion ${res.status}`;
      try {
        const data = await res.json();
        if (data?.message) msg = `${msg}: ${data.message}`;
      } catch { /* body wasn't JSON */ }
      failedRecords.push({ url: item?.url, error: msg });
      continue;
    }
    pushed++;
    created++;
  }
  const allSucceeded = failedRecords.length === 0 && (list.length === 0 || pushed > 0);
  return {
    ok: allSucceeded,
    pushed,
    created,
    updated,
    total: list.length,
    errors: failedRecords.length ? [`${failedRecords.length} page(s) failed`, ...failedRecords.map((r) => r.error)] : [],
    failedRecords,
  };
}

// ── localStorage for non-secret parts of the config ────────────────────────

const LS_KEY = "datiq.notionConfig";

export function readNotionConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { databaseId: "", schema: defaultNotionSchema() };
    const v = JSON.parse(raw);
    return {
      databaseId: typeof v?.databaseId === "string" ? v.databaseId : "",
      schema: v?.schema && typeof v.schema === "object" ? autoMapNotionSchema(v.schema) : defaultNotionSchema(),
    };
  } catch {
    return { databaseId: "", schema: defaultNotionSchema() };
  }
}

export function writeNotionConfig({ databaseId, schema } = {}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ databaseId, schema: autoMapNotionSchema(schema) }));
  } catch { /* skip */ }
}

export const _internal = { MAX_REQUESTS_PER_PUSH, NOTION_API_BASE, NOTION_VERSION, NOTION_READ_ONLY_TYPES };
