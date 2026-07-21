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
//   Authorization: Bearer {apiKey}
//   Body: { records: [{ fields: {...} }, ...], typecast: true }

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
 * Convert an extraction row into an Airtable `fields` object.
 * Flattens simple key/value pairs; the "headings", "links", and
 * "domain_map" arrays are stringified to keep the v1 contract simple.
 */
export function extractionToAirtableFields(extraction) {
  if (!extraction) return {};
  const out = {};
  const setField = (k, v) => {
    const key = toAirtableFieldKey(k);
    if (!key) return;
    if (v == null) return;
    if (Array.isArray(v)) {
      out[key] = v.length > 0 ? v.join(", ") : "";
    } else if (typeof v === "object") {
      out[key] = JSON.stringify(v);
    } else {
      out[key] = String(v);
    }
  };
  setField("URL", extraction.url);
  setField("Title", extraction.page_title || extraction.title || "");
  setField("Host", extraction.host || "");
  setField("Summary", extraction.ai_summary || extraction.summary || "");
  if (extraction.created_at) {
    setField("Created at", extraction.created_at);
  }
  setField("Headings", extraction.headings);
  setField("Links", extraction.links);
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
export function buildAirtableRequestBody(chunk) {
  return {
    records: (chunk || []).map((item) => ({
      fields: extractionToAirtableFields(item),
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

// ── Side-effecting: do the push (browser fetch) ─────────────────────────────

/**
 * Push `items` to an Airtable base/table. Returns
 *   { ok, pushed, total, errors: [], failedRecords: [] }
 * The caller is expected to handle auth/network errors. fetchFn defaults
 * to global fetch but is overridable for tests.
 */
export async function pushToAirtable(items, { apiKey, baseId, tableId, fetchFn = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
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
    const body = buildAirtableRequestBody(chunk);
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
      try {
        const data = await res.json();
        if (data?.error?.message) msg = `${msg}: ${data.error.message}`;
      } catch { /* body wasn't JSON */ }
      failedRecords.push(...chunk.map((it) => ({ url: it?.url, error: msg })));
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

const LS_KEY = "datiq.airtableConfig";

/**
 * Read a previously-saved config. We deliberately do NOT persist the API
 * key — Airtable PATs are sensitive. The user re-pastes it each session.
 */
export function readAirtableConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { baseId: "", tableId: "" };
    const v = JSON.parse(raw);
    return {
      baseId: typeof v?.baseId === "string" ? v.baseId : "",
      tableId: typeof v?.tableId === "string" ? v.tableId : "",
    };
  } catch {
    return { baseId: "", tableId: "" };
  }
}

export function writeAirtableConfig({ baseId, tableId } = {}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ baseId, tableId }));
  } catch { /* skip */ }
}

export const _internal = { MAX_RECORDS_PER_REQUEST, MAX_REQUESTS_PER_PUSH, AIRTABLE_API_BASE };
