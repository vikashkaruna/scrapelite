// src/lib/airtable.js — F18 (Airtable export adapter).
//
// Council intent: "Where extracted data actually lives for non-technical
// personas; cheapest 'integrations' checkbox."
//
// API-key-paste flow (no OAuth): the user pastes their Airtable Personal
// Access Token (PAT) plus their Base ID + Table ID, and we POST records
// to Airtable's REST API directly from the browser. v1 ships without
// server-side proxying because the PAT is scoped to specific bases the
// user has access to — risk profile is acceptable for v1.
//
// API shape: https://airtable.com/developers/web/api/rest-api
//   POST /v0/{baseId}/{tableId}         — create up to 10 records
//   GET  /v0/meta/bases/{baseId}/tables/{tableId}  — fetch field schema
//   Authorization: Bearer {apiKey}
//   Body: { records: [{ fields: {...} }, ...], typecast: true }
//
// Field mapping: Airtable rejects "Unknown field name" on 422 (typecast
// does NOT add new fields; it only coerces existing-field VALUES to
// their declared type). We therefore discover the table's actual field
// list at connect time and let the user confirm (or override) the
// mapping from each Airtable column to an extraction field. See
// defaultAirtableFieldMap / autoMapAirtableFields below.

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";
const MAX_RECORDS_PER_REQUEST = 10;
const MAX_REQUESTS_PER_PUSH = 10; // hard cap: 100 records per push

// ── Pure helpers (unit-testable, no fetch) ──────────────────────────────────

/**
 * Normalise a key to a valid Airtable field name. Airtable allows
 * alphanumerics, spaces, underscores, hyphens, and a few others — but
 * trimming and stable-casing is enough for v1.
 */
export function toAirtableFieldKey(key) {
  if (key == null) return "";
  return String(key)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s_\-./&()]/gu, "");
}

/**
 * Map an Airtable column name to the extraction key it should pull from.
 * Best-effort heuristic; falls back to the column name itself (treated as
 * a literal extraction key) so the user can still see what they have.
 */
export function mapAirtableColumnToKey(name) {
  const n = String(name || "").toLowerCase();
  if (n === "url" || n === "link" || n === "source url" || n === "source" || n === "address" || n === "site") return "url";
  if (n === "title" || n === "name" || n === "page title" || n === "page") return "page_title";
  if (n === "host" || n === "domain") return "host";
  if (n === "summary" || n === "ai summary" || n === "description" || n === "desc") return "ai_summary";
  if (n === "headings" || n === "h1/h2/h3" || n === "h1-h6") return "headings";
  if (n === "links" || n === "all links" || n === "urls") return "links";
  if (n === "created" || n === "created at" || n === "date" || n === "added on" || n === "timestamp") return "created_at";
  return ""; // empty = no auto-mapping; user can set it manually
}

/**
 * The default field map we ship with. The KEY is the Airtable field name
 * we *suggest* the user have in their base; the VALUE is which extraction
 * key to read from. If the user has a column literally called "URL" this
 * works out of the box. If they don't, the schema-fetch + auto-map path
 * (see autoMapAirtableFields) builds a per-table map.
 */
export function defaultAirtableFieldMap() {
  return {
    URL:        { key: "url" },
    Title:      { key: "page_title" },
    Host:       { key: "host" },
    Summary:    { key: "ai_summary" },
    "Created at": { key: "created_at" },
    Headings:   { key: "headings" },
    Links:      { key: "links" },
  };
}

/**
 * Build a field map from the table's actual field list. We use the
 * `mapAirtableColumnToKey` heuristic to auto-pick a sensible extraction
 * key for each Airtable column. Airtable columns that we don't recognise
 * are OMITTED — the user can extend the map manually after loading.
 *
 * @param {Array<{name: string, type?: string}>} tableFields  result of fetchAirtableSchema
 * @returns {Object}  fieldMap keyed by Airtable column name
 */
export function autoMapAirtableFields(tableFields) {
  const out = {};
  if (!Array.isArray(tableFields)) return out;
  for (const f of tableFields) {
    if (!f || !f.name) continue;
    const key = mapAirtableColumnToKey(f.name);
    if (key) out[f.name] = { key };
  }
  return out;
}

/**
 * Convert an extraction row into an Airtable `fields` object.
 * @param {object} extraction
 * @param {object} [fieldMap]  map of { AirtableColumnName: { key: extractionKey } }.
 *                             Defaults to defaultAirtableFieldMap().
 */
export function extractionToAirtableFields(extraction, fieldMap) {
  if (!extraction) return {};
  const map = fieldMap && Object.keys(fieldMap).length > 0 ? fieldMap : defaultAirtableFieldMap();
  const out = {};
  const setField = (airtableCol, v) => {
    const col = toAirtableFieldKey(airtableCol);
    if (!col) return;
    if (v == null) return;
    if (Array.isArray(v)) {
      out[col] = v.length > 0 ? v.join(", ") : "";
    } else if (typeof v === "object") {
      out[col] = JSON.stringify(v);
    } else {
      out[col] = String(v);
    }
  };
  for (const [col, def] of Object.entries(map)) {
    const k = def?.key;
    if (!k) continue;
    if (k === "headings" || k === "links") {
      setField(col, extraction[k]);
    } else if (k === "host") {
      let v = extraction.host;
      if (!v && extraction.url) {
        try { v = new URL(extraction.url).hostname; } catch { v = ""; }
      }
      setField(col, v || "");
    } else if (k === "page_title") {
      setField(col, extraction.page_title || extraction.title || "");
    } else if (k === "ai_summary") {
      setField(col, extraction.ai_summary || extraction.summary || "");
    } else {
      setField(col, extraction[k]);
    }
  }
  return out;
}

/**
 * Split `items` into chunks of at most 10 records (Airtable's per-request
 * cap). Returns an array of arrays.
 */
export function chunkForAirtable(items, perChunk = MAX_RECORDS_PER_REQUEST) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const out = [];
  for (let i = 0; i < list.length; i += perChunk) {
    out.push(list.slice(i, i + perChunk));
  }
  return out;
}

/**
 * Validate an Airtable config: apiKey (starts with "pat" or "key" prefix
 * for older accounts), baseId (starts with "app"), tableId (starts with
 * "tbl" or "viw").
 */
export function validateAirtableConfig({ apiKey, baseId, tableId } = {}) {
  const errors = [];
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
    errors.push("Airtable API key is required (paste it from your Airtable account page).");
  } else if (!/^(pat|key)[A-Za-z0-9._\-]/i.test(apiKey.trim())) {
    // Soft warning — the Airtable PAT format starts with "pat..." but we
    // don't hard-fail on legacy keys.
  }
  if (!baseId || !/^app[A-Za-z0-9]{8,}$/i.test(baseId.trim())) {
    errors.push("Base ID is required and should look like 'appXXXXXXXXXXXXXX'.");
  }
  if (!tableId || !/^(tbl|viw)[A-Za-z0-9]{8,}$/i.test(tableId.trim())) {
    errors.push("Table ID is required and should look like 'tblXXXXXXXXXXXXXX'.");
  }
  return errors;
}

/**
 * Build the Airtable request body for one chunk of records.
 * Pure: no fetch call.
 */
export function buildAirtableRequestBody(chunk, fieldMap) {
  return {
    records: (chunk || []).map((item) => ({
      fields: extractionToAirtableFields(item, fieldMap),
    })),
    typecast: true,
  };
}

/**
 * Build the request URL for an Airtable batch.
 */
export function buildAirtableRequestUrl(baseId, tableId) {
  const b = (baseId || "").trim();
  const t = (tableId || "").trim();
  return `${AIRTABLE_API_BASE}/${b}/${t}`;
}

/**
 * Fetch a table's schema (field list). Hits the Airtable Meta API:
 *   GET /v0/meta/bases/{baseId}/tables/{tableId}
 * Requires `schema.bases:read` scope on the PAT. If the token doesn't
 * have that scope, the API returns 403 — we surface that as a
 * structured error so the UI can fall back to manual field entry.
 */
export async function fetchAirtableSchema({ apiKey, baseId, tableId, fetchFn = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
  if (!fetchFn) return { ok: false, error: "No fetch available (SSR?)" };
  const v = validateAirtableConfig({ apiKey, baseId, tableId });
  if (v.length) return { ok: false, error: v.join(" ") };
  const url = `${AIRTABLE_API_BASE}/meta/bases/${encodeURIComponent(baseId.trim())}/tables/${encodeURIComponent(tableId.trim())}`;
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!res.ok) {
      let msg = `Airtable ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error?.message) msg = `${msg}: ${data.error.message}`;
        if (data?.error?.type) msg = `${msg} (${data.error.type})`;
      } catch { /* body wasn't JSON */ }
      // Translate the most common 403 reason into an actionable hint
      if (res.status === 403) {
        msg += " — your token needs the 'schema.bases:read' scope to load column names. You can still push records using the default column names (URL, Title, Host, Summary).";
      } else if (res.status === 404) {
        msg += " — check the Base ID and Table ID are correct and the token has access to them.";
      }
      return { ok: false, error: msg };
    }
    const data = await res.json();
    const fields = Array.isArray(data?.fields)
      ? data.fields.map((f) => ({ name: f.name, type: f.type, id: f.id, description: f.description || "" }))
      : [];
    return { ok: true, tableName: data?.name || "", tableId: data?.id || tableId, fields };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}

// ── Side-effecting: do the push (browser fetch) ─────────────────────────────

/**
 * Push `items` to an Airtable base/table. Returns
 *   { ok, pushed, total, errors: [], failedRecords: [] }
 * The caller is expected to handle auth/network errors. fetchFn defaults
 * to global fetch but is overridable for tests.
 *
 * @param {Array} items
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.baseId
 * @param {string} opts.tableId
 * @param {object} [opts.fieldMap]  map of { AirtableColumnName: { key: extractionKey } }
 * @param {Function} [opts.fetchFn]
 */
export async function pushToAirtable(items, { apiKey, baseId, tableId, fieldMap, fetchFn = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
  if (!fetchFn) {
    return { ok: false, pushed: 0, total: 0, errors: ["No fetch available (SSR?)"], failedRecords: [] };
  }
  const errors = validateAirtableConfig({ apiKey, baseId, tableId });
  if (errors.length) {
    return { ok: false, pushed: 0, total: 0, errors, failedRecords: [] };
  }
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return { ok: true, pushed: 0, total: 0, errors: [], failedRecords: [] };
  }
  const chunks = chunkForAirtable(list).slice(0, MAX_REQUESTS_PER_PUSH);
  const url = buildAirtableRequestUrl(baseId, tableId);
  let pushed = 0;
  const failedRecords = [];
  for (const chunk of chunks) {
    const body = buildAirtableRequestBody(chunk, fieldMap);
    let res;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      failedRecords.push(...chunk.map((it) => ({ url: it?.url, error: err?.message || "network error" })));
      continue;
    }
    if (!res.ok) {
      let msg = `Airtable ${res.status}`;
      let unknownFields = [];
      try {
        const data = await res.json();
        if (data?.error?.message) msg = `${msg}: ${data.error.message}`;
        // Airtable's 422 for unknown fields includes the rejected field
        // names in error.message like: `Unknown field name: "URL"`
        // We surface them so the user knows exactly which columns to
        // rename or add in Airtable (and offer a hint to load the
        // table's actual columns if they haven't yet).
        if (typeof data?.error?.message === "string") {
          const matches = data.error.message.match(/"([^"]+)"/g);
          if (matches) unknownFields = matches.map((s) => s.replace(/"/g, ""));
        }
        if (data?.error?.type === "UNKNOWN_FIELD_NAME" && unknownFields.length === 0) {
          unknownFields = ["(unknown — see error message)"];
        }
      } catch { /* body wasn't JSON */ }
      if (res.status === 422 && unknownFields.length > 0) {
        msg += ` — these field names don't exist in your Airtable table. ` +
               `Either rename your Airtable columns to match (e.g. "URL", "Title", "Host", "Summary") or click "Load columns" to map our fields to your columns.`;
      }
      failedRecords.push(...chunk.map((it) => ({ url: it?.url, error: msg, unknownFields })));
      continue;
    }
    try {
      const data = await res.json();
      pushed += Array.isArray(data?.records) ? data.records.length : chunk.length;
    } catch {
      pushed += chunk.length;
    }
  }
  return {
    ok: failedRecords.length === 0,
    pushed,
    total: list.length,
    errors: failedRecords.length ? [`${failedRecords.length} record(s) failed`] : [],
    failedRecords,
  };
}

// ── Persist + restore config in localStorage (key is per-tenant safe) ───────
//
// We persist per-table:
//   - Base ID + Table ID (so the user only re-pastes the PAT on each session)
//   - The fieldMap (which extraction key goes into which Airtable column)
//   - The table metadata (column names + types) for the schema display
//
// We use a single localStorage slot but key the per-table config by
// `${baseId}::${tableId}`. Switching between tables no longer wipes
// the previous table's saved map — the user can flip back and forth.
//
// The PAT itself is NEVER persisted — the user re-pastes it each session.

const LS_KEY = "datiq.airtableConfig";

function tableKey(baseId, tableId) {
  return `${(baseId || "").trim()}::${(tableId || "").trim()}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { currentBaseId: "", currentTableId: "", tables: {} };
    const v = JSON.parse(raw);
    return {
      currentBaseId: typeof v?.currentBaseId === "string" ? v.currentBaseId : (typeof v?.baseId === "string" ? v.baseId : ""),
      currentTableId: typeof v?.currentTableId === "string" ? v.currentTableId : (typeof v?.tableId === "string" ? v.tableId : ""),
      tables: v?.tables && typeof v.tables === "object" ? v.tables : {},
    };
  } catch {
    return { currentBaseId: "", currentTableId: "", tables: {} };
  }
}

function writeAll(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* skip */ }
}

/**
 * Read a previously-saved config for the current (baseId, tableId). If
 * the saved baseId/tableId match a table we have stored metadata for,
 * we return that table's fieldMap + tableMeta. Otherwise we return
 * null for fieldMap and let the caller fall back to defaults.
 */
export function readAirtableConfig() {
  const all = readAll();
  const baseId = all.currentBaseId;
  const tableId = all.currentTableId;
  const tk = tableKey(baseId, tableId);
  const tableEntry = all.tables?.[tk] || null;
  return {
    baseId,
    tableId,
    // null means "no map saved for this table" — caller falls back to
    // defaultAirtableFieldMap(). Only set to a real object after a
    // successful "Load columns" call.
    fieldMap: tableEntry?.fieldMap && typeof tableEntry.fieldMap === "object" ? tableEntry.fieldMap : null,
    tableMeta: tableEntry?.tableMeta && typeof tableEntry.tableMeta === "object" ? tableEntry.tableMeta : null,
  };
}

export function writeAirtableConfig({ baseId, tableId, fieldMap, tableMeta } = {}) {
  const all = readAll();
  // Update the "current" pointers (which table the user is working on).
  if (baseId !== undefined) all.currentBaseId = baseId || "";
  if (tableId !== undefined) all.currentTableId = tableId || "";
  // Per-table entry. We always read-modify-write the entry for the
  // current (baseId, tableId) — that way partial updates merge with
  // existing data, but switches to a new table create a fresh entry.
  const tk = tableKey(all.currentBaseId, all.currentTableId);
  const prev = all.tables[tk] || {};
  const nextEntry = { ...prev };
  if (fieldMap === null) {
    delete nextEntry.fieldMap;
  } else if (fieldMap !== undefined) {
    nextEntry.fieldMap = fieldMap;
  }
  if (tableMeta === null) {
    delete nextEntry.tableMeta;
  } else if (tableMeta !== undefined) {
    nextEntry.tableMeta = tableMeta;
  }
  if (Object.keys(nextEntry).length > 0) {
    all.tables[tk] = nextEntry;
  } else {
    delete all.tables[tk];
  }
  writeAll(all);
}

/**
 * Clear any saved Airtable config. Useful when the user disconnects
 * (drops their PAT) and we want to make sure nothing stale remains
 * in localStorage.
 */
export function clearAirtableConfig() {
  try { localStorage.removeItem(LS_KEY); } catch { /* skip */ }
}

export const _internal = { MAX_RECORDS_PER_REQUEST, MAX_REQUESTS_PER_PUSH, AIRTABLE_API_BASE };
