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
//   Body: { parent: { database_id }, properties: {...} }
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
    case "title":
      return { title: [{ type: "text", text: { content: String(value).slice(0, 2000) } }] };
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: String(value).slice(0, 2000) } }] };
    case "url":
      return /^https?:\/\//i.test(String(value)) ? { url: String(value) } : null;
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? { number: n } : null;
    }
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select": {
      const arr = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
      return { multi_select: arr.slice(0, 100).map((name) => ({ name: String(name) })) };
    }
    case "date":
      return { date: { start: String(value) } };
    case "email":
      return { email: String(value) };
    case "phone_number":
      return { phone_number: String(value) };
    default:
      return { rich_text: [{ type: "text", text: { content: String(value).slice(0, 2000) } }] };
  }
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
 * Convert an extraction into Notion `properties` using a schema map.
 * Pure: no fetch.
 */
export function extractionToNotionProperties(extraction, schema = defaultNotionSchema()) {
  if (!extraction) return {};
  const out = {};
  for (const [columnName, def] of Object.entries(schema || {})) {
    const rawKey = def?.key || "";
    const raw = readExtractionValue(extraction, rawKey);
    const prop = toNotionProperty(raw, def?.type);
    if (prop != null) out[columnName] = prop;
  }
  return out;
}

function readExtractionValue(extraction, key) {
  if (!extraction || !key) return null;
  if (key === "headings" || key === "links") {
    return Array.isArray(extraction[key]) ? extraction[key].join(", ") : "";
  }
  if (key === "host") {
    if (extraction.host) return extraction.host;
    try { return new URL(extraction.url).hostname; } catch { return ""; }
  }
  return extraction[key] ?? "";
}

/**
 * Build the Notion request body for one extraction.
 */
export function buildNotionPageBody(extraction, { databaseId, schema } = {}) {
  if (!databaseId) throw new Error("databaseId is required");
  return {
    parent: { database_id: databaseId },
    properties: extractionToNotionProperties(extraction, schema),
  };
}

export function buildNotionUrlQuery(databaseId, schema, url) {
  const field = sourceUrlField(schema);
  const canonical = canonicalSourceUrl(url);
  if (!databaseId || !canonical) return null;
  return {
    url: `${NOTION_API_BASE}/databases/${String(databaseId).replace(/-/g, "")}/query`,
    body: { page_size: 1, filter: { property: field, url: { equals: canonical } } },
  };
}

async function findNotionPage({ apiKey, databaseId, schema, url, fetchFn }) {
  const query = buildNotionUrlQuery(databaseId, schema, url);
  if (!query) return { ok: false, error: "A valid source URL is required for deduplication." };
  const res = await fetchFn(query.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify(query.body),
  });
  if (!res.ok) return { ok: false, error: `Notion deduplication query failed (${res.status}).` };
  const data = await res.json();
  return { ok: true, page: data?.results?.[0] || null };
}

async function updateNotionPage({ apiKey, pageId, properties, fetchFn }) {
  const res = await fetchFn(`${NOTION_API_BASE}/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) return { ok: false, error: `Notion update failed (${res.status}).` };
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
    const titleColumn = Object.entries(data.properties || {}).find(([, p]) => p.type === "title")?.[0] || "Name";
    const properties = Object.fromEntries(
      Object.entries(data.properties || {}).map(([name, p]) => [name, p.type]),
    );
    return { ok: true, titleColumn, properties, rawTitle: data.title?.[0]?.plain_text || "" };
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

  const slice = list.slice(0, MAX_REQUESTS_PER_PUSH);
  let pushed = 0;
  let created = 0;
  let updated = 0;
  const failedRecords = [];

  for (const item of slice) {
    let body;
    try {
      body = buildNotionPageBody(item, { databaseId, schema });
    } catch (err) {
      failedRecords.push({ url: item?.url, error: err.message || "build error" });
      continue;
    }
    let res;
    try {
      const existing = await findNotionPage({ apiKey, databaseId, schema: schema || defaultNotionSchema(), url: item?.url, fetchFn: f });
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
  return {
    ok: failedRecords.length === 0,
    pushed,
    created,
    updated,
    total: list.length,
    errors: failedRecords.length ? [`${failedRecords.length} page(s) failed`] : [],
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
      schema: v?.schema && typeof v.schema === "object" ? v.schema : defaultNotionSchema(),
    };
  } catch {
    return { databaseId: "", schema: defaultNotionSchema() };
  }
}

export function writeNotionConfig({ databaseId, schema } = {}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ databaseId, schema: schema || defaultNotionSchema() }));
  } catch { /* skip */ }
}

export const _internal = { MAX_REQUESTS_PER_PUSH, NOTION_API_BASE, NOTION_VERSION };
