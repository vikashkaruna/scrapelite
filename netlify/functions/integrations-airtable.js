// netlify/functions/integrations-airtable.js
//
// F-INT-6 — Airtable server-side push. Mirrors the browser adapter in
// src/lib/airtable.js so users can keep their Airtable Personal Access
// Token server-side.
//
// Endpoints:
//   GET    /api/integrations/airtable/status
//   POST   /api/integrations/airtable/connect   { apiKey, baseId, tableId }
//   PATCH  /api/integrations/airtable/connect   { accountLabel?, baseId?, tableId? }
//   DELETE /api/integrations/airtable/connect
//   POST   /api/integrations/airtable/test      { baseId?, tableId? } → { ok, tableName, fields }
//   POST   /api/integrations/airtable/push      { items, baseId?, tableId? }

import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import {
  pushToAirtable,
  fetchAirtableSchema,
  fetchAirtableTables,
  createAirtableTable,
  resolveAirtableTable,
  validateAirtableConfig,
  autoMapAirtableFields,
} from "../../src/lib/airtable.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { requireCapabilityForUser, denyBody, DENY_STATUS } from "./lib/requireEntitlement.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

async function readJsonBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) return JSON.parse(Buffer.from(event.body, "base64").toString("utf8"));
  return JSON.parse(event.body);
}

async function authenticateRequest(event) {
  // Shared implementation — see netlify/functions/lib/supabaseServerClient.js.
  // It distinguishes a genuinely bad session (401) from a server whose anon
  // key does not match its project URL (503, naming the variable), which is
  // the distinction this endpoint got wrong for three sessions running.
  const auth = await authenticateBearer(event, { label: "integrations-airtable" });
  if (auth.ok) return { ok: true, user: auth.user };
  return { ok: false, response: respond(auth.status, auth.body) };
}

async function probeAirtable(apiKey) {
  // List a single record to confirm the token works. We use the
  // /v0/meta/bases endpoint because listing bases is a low-cost probe
  // that doesn't require a specific Base ID.
  try {
    const res = await fetch("https://api.airtable.com/v0/meta/bases", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}

async function handleStatus(userId) {
  const r = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!r.ok) return respond(500, { error: r.error });
  if (!r.connection) return respond(200, { connected: false, provider: "airtable" });
  const { access_token, refresh_token, config, ...safe } = r.connection;
  return respond(200, {
    connected: true,
    provider: "airtable",
    connection: {
      ...safe,
      // token_hint is the 4-char-tail display of the stored PAT. The
      // Account page renders a "Token" line whenever token_hint is
      // defined (it does this for HubSpot, Notion, Slack, Zapier — but
      // Airtable was missing it, which made users think the PAT
      // hadn't been saved when in fact the row was correctly
      // populated). 2026-08-11 fix.
      token_hint: tokenHint(config?.api_key),
      base_id: config?.base_id || null,
      table_id: config?.table_id || null,
      has_api_key: !!config?.api_key,
      // field_map is the per-table column→extraction-key map. We persist
      // it server-side too (in addition to localStorage) so cross-device
      // sync works and the Account page can show what the user mapped.
      // field_map_summary is a short human-readable list for the UI.
      field_map: config?.field_map || null,
      field_map_summary: summarizeFieldMap(config?.field_map),
      table_meta: config?.table_meta || null,
    },
  });
}

// "pat…XXXX" — first 7 + last 4 with an ellipsis, mirroring HubSpot
// and Notion. Null when there's no token to hint at.
function tokenHint(token) {
  if (!token || typeof token !== "string") return null;
  const tail = token.slice(-4);
  if (token.length <= 4) return tail;
  return `${token.slice(0, 7)}…${tail}`;
}

function summarizeFieldMap(fieldMap) {
  if (!fieldMap || typeof fieldMap !== "object") return null;
  const entries = Object.entries(fieldMap)
    .filter(([_, def]) => def && def.key)
    .map(([col, def]) => `${col} → ${def.key}`);
  if (entries.length === 0) return null;
  if (entries.length <= 3) return entries.join(", ");
  return entries.slice(0, 3).join(", ") + ` (+${entries.length - 3} more)`;
}

async function handleConnect(event, userId) {
  const body = await readJsonBody(event);
  const apiKey = body?.apiKey;
  const baseId = body?.baseId;
  const tableId = body?.tableId;
  const errors = validateAirtableConfig({ apiKey, baseId, tableId });
  if (errors.length) return respond(400, { error: errors.join(" ") });
  const probe = await probeAirtable(apiKey);
  if (!probe.ok) return respond(400, { error: `Airtable rejected the token (status ${probe.status || probe.error}).` });
  // On initial connect, fetch the table schema + auto-build the field
  // map so the user has a working setup on first push (and the Account
  // page can show what columns will be used).
  let fieldMap = null;
  let tableMeta = null;
  try {
    const schemaRes = await fetchAirtableSchema({ apiKey, baseId, tableId });
    if (schemaRes.ok) {
      fieldMap = autoMapAirtableFields(schemaRes.fields);
      tableMeta = { tableName: schemaRes.tableName, fields: schemaRes.fields };
    }
  } catch { /* non-fatal: connection succeeds even if schema fetch 403s */ }
  const r = await upsertConnection({
    userId,
    provider: "airtable",
    fields: {
      config: { api_key: apiKey, base_id: baseId, table_id: tableId, field_map: fieldMap, table_meta: tableMeta },
      account_label: body?.accountLabel || "Airtable",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, {
    ok: true,
    connected: true,
    field_map: fieldMap,
    table_meta: tableMeta,
  });
}

/**
 * PATCH /connect — partial update. Accepts:
 *   - accountLabel     string   rename the connection in the UI
 *   - baseId           string   change target base
 *   - tableId          string   change target table
 *   - refreshSchema    true     re-fetch table schema + rebuild field map
 *
 * The PAT (apiKey) is NEVER changeable via PATCH — token rotation
 * requires a full re-paste through /connect. This is the same posture
 * we take everywhere else: secrets don't get partially updated, they
 * get replaced wholesale.
 */
async function handlePatch(event, userId) {
  const body = await readJsonBody(event);
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(400, { error: "Airtable is not connected. Use POST /connect to set it up first." });

  const existingConfig = conn.connection.config || {};
  const fields = {};
  const configPatch = { ...existingConfig };

  if (typeof body?.accountLabel === "string" && body.accountLabel.trim()) {
    fields.account_label = body.accountLabel.trim();
  }

  const baseId = typeof body?.baseId === "string" && body.baseId.trim() ? body.baseId.trim() : existingConfig.base_id;
  const tableId = typeof body?.tableId === "string" && body.tableId.trim() ? body.tableId.trim() : existingConfig.table_id;
  const idsChanged = baseId !== existingConfig.base_id || tableId !== existingConfig.table_id;
  if (idsChanged) {
    // IDs must pass the same validation as the initial connect.
    const v = validateAirtableConfig({ apiKey: existingConfig.api_key, baseId, tableId });
    if (v.length) return respond(400, { error: v.join(" ") });
    configPatch.base_id = baseId;
    configPatch.table_id = tableId;
  }

  // If the IDs changed OR the caller asked for an explicit refresh,
  // re-fetch the table schema and rebuild the field map. Otherwise the
  // existing field_map is preserved.
  const shouldRefresh = idsChanged || body?.refreshSchema === true;
  if (shouldRefresh) {
    if (!existingConfig.api_key) {
      return respond(400, { error: "Cannot refresh schema: no API key on file. Reconnect with a token." });
    }
    const schemaRes = await fetchAirtableSchema({ apiKey: existingConfig.api_key, baseId, tableId });
    if (!schemaRes.ok) return respond(400, { error: schemaRes.error });
    configPatch.field_map = autoMapAirtableFields(schemaRes.fields);
    configPatch.table_meta = { tableName: schemaRes.tableName, fields: schemaRes.fields };
  }

  // Allow the client to pass an explicit field_map override (used by
  // the EditIntegrationModal's "rebuild map" path — or by an advanced
  // user with a hand-tuned map).
  if (body?.fieldMap && typeof body.fieldMap === "object") {
    configPatch.field_map = body.fieldMap;
  }

  fields.config = configPatch;

  const r = await upsertConnection({
    userId,
    provider: "airtable",
    fields,
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, {
    ok: true,
    connected: true,
    base_id: configPatch.base_id,
    table_id: configPatch.table_id,
    field_map: configPatch.field_map || null,
    table_meta: configPatch.table_meta || null,
    field_map_summary: summarizeFieldMap(configPatch.field_map),
  });
}

/**
 * POST /test — verify the stored credentials still work AND the target
 * table still exists with the columns we know about. Returns:
 *   { ok, tableName, fieldCount, matched, total }
 * If the user changed their PAT in Airtable's dashboard without
 * reconnecting here, this will surface a 401 with the Airtable status.
 */
async function handleTest(event, userId) {
  const body = await readJsonBody(event).catch(() => ({}));
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(412, { error: "Airtable is not connected. Set it up in Account → Integrations." });
  const apiKey = conn.connection.config?.api_key;
  const baseId = body?.baseId || conn.connection.config?.base_id;
  const tableId = body?.tableId || conn.connection.config?.table_id;
  if (!apiKey || !baseId || !tableId) {
    return respond(400, { error: "Airtable connection is missing apiKey / baseId / tableId. Reconnect." });
  }
  const probe = await probeAirtable(apiKey);
  if (!probe.ok) return respond(502, { error: `Airtable rejected the token (status ${probe.status || probe.error}). The PAT may have been revoked — reconnect in Account → Integrations.` });
  const schemaRes = await fetchAirtableSchema({ apiKey, baseId, tableId });
  if (!schemaRes.ok) return respond(502, { error: schemaRes.error });
  const fieldMap = autoMapAirtableFields(schemaRes.fields);
  const matched = Object.keys(fieldMap).length;
  return respond(200, {
    ok: true,
    tableName: schemaRes.tableName,
    fieldCount: schemaRes.fields.length,
    matched,
    fieldMap,
  });
}

async function handleDisconnect(userId) {
  const r = await deleteConnection({ userId, provider: "airtable" });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: false });
}

async function handleTables(event, userId) {
  const body = await readJsonBody(event).catch(() => ({}));
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(412, { error: "Airtable is not connected. Set it up in Account → Integrations." });
  const apiKey = body?.apiKey || conn.connection.config?.api_key;
  const baseId = event.queryStringParameters?.baseId || body?.baseId || conn.connection.config?.base_id;
  if (!apiKey || !baseId) {
    return respond(400, { error: "Base ID is required to fetch Airtable tables." });
  }
  const res = await fetchAirtableTables({ apiKey, baseId });
  if (!res.ok) return respond(400, { error: res.error });
  return respond(200, { ok: true, baseId, tables: res.tables });
}

async function handleCreateTable(event, userId) {
  const body = await readJsonBody(event).catch(() => ({}));
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(412, { error: "Airtable is not connected. Set it up in Account → Integrations." });
  const apiKey = body?.apiKey || conn.connection.config?.api_key;
  const baseId = body?.baseId || conn.connection.config?.base_id;
  const tableName = body?.tableName || "DatIQ Extractions";
  const fields = body?.fields;
  if (!apiKey || !baseId) {
    return respond(400, { error: "Airtable API key and Base ID are required to create a table." });
  }
  const createRes = await createAirtableTable({ apiKey, baseId, tableName, fields });
  if (!createRes.ok) return respond(400, { error: createRes.error });

  const fieldMap = autoMapAirtableFields(createRes.fields);
  const tableMeta = { tableName: createRes.tableName, fields: createRes.fields };

  if (body?.setAsActive !== false) {
    const existingConfig = conn.connection.config || {};
    const updatedConfig = {
      ...existingConfig,
      base_id: baseId,
      table_id: createRes.tableId,
      field_map: fieldMap,
      table_meta: tableMeta,
    };
    await upsertConnection({
      userId,
      provider: "airtable",
      fields: { config: updatedConfig },
    });
  }

  return respond(200, {
    ok: true,
    tableId: createRes.tableId,
    tableName: createRes.tableName,
    fields: createRes.fields,
    field_map: fieldMap,
    table_meta: tableMeta,
  });
}

async function handlePush(event, userId) {
  // Server-side mirror of the client's checkCanIntegrations gate (Select and
  // up) — a client that skips the UI and POSTs directly must still be refused.
  const { check } = await requireCapabilityForUser(userId, "integrations");
  if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) return respond(400, { error: "'items' must be a non-empty array." });
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(412, { error: "Airtable is not connected. Set it up in Account → Integrations." });
  const apiKey = body?.apiKey || conn.connection?.config?.api_key;
  const baseId = body?.baseId || conn.connection?.config?.base_id;
  let tableId = body?.tableId || conn.connection?.config?.table_id;
  const tableName = body?.tableName;
  const createIfMissing = body?.createIfMissing === true;

  if (!apiKey || !baseId) return respond(400, { error: "Connect Airtable first (apiKey and baseId are required)." });

  let fieldMap = body?.fieldMap || conn.connection?.config?.field_map || null;

  if (tableName || createIfMissing || (!tableId && tableName)) {
    const resolved = await resolveAirtableTable({
      apiKey,
      baseId,
      tableIdOrName: tableName || tableId,
      createIfMissing,
      tableNameIfCreating: tableName,
    });
    if (!resolved.ok) return respond(400, { error: resolved.error });
    tableId = resolved.tableId;
    if (!fieldMap && resolved.fields?.length) {
      fieldMap = autoMapAirtableFields(resolved.fields);
    }
  }

  if (!tableId) return respond(400, { error: "A target Table ID or Table Name is required." });
  const r = await pushToAirtable(items, { apiKey, baseId, tableId, fieldMap });
  return respond(200, r);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  // Resolve the sub-path from THREE sources, in priority order:
  //   1. body.action          — sent by the Account UI (2026-08-10 fix)
  //   2. event.queryStringParameters.splat — original Netlify redirect form
  //   3. event.path tail      — fallback for path-based routing
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }
  const splatFromBody = (body && typeof body.action === "string") ? body.action : "";
  const splatFromQuery = event.queryStringParameters?.splat || "";
  const fnName = "/.netlify/functions/integrations-airtable";
  const tail = (event.path || "").startsWith(fnName)
    ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
    : "";
  const splat = splatFromBody || splatFromQuery || tail;
  const subPath = splat.split("/").filter(Boolean);

  const auth = await authenticateRequest(event);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  if (event.httpMethod === "GET" && (subPath.length === 0 || subPath[0] === "status")) {
    return handleStatus(userId);
  }
  if ((event.httpMethod === "GET" || event.httpMethod === "POST") && (subPath[0] === "tables" || splatFromBody === "tables")) {
    return handleTables(event, userId);
  }
  if (event.httpMethod === "POST" && (subPath[0] === "create-table" || splatFromBody === "create-table")) {
    return handleCreateTable(event, userId);
  }
  if (event.httpMethod === "POST" && subPath[0] === "connect") return handleConnect(event, userId);
  // PATCH /connect — partial update (rename, change IDs, refresh schema).
  // The PAT is NEVER changeable via PATCH — token rotation requires a
  // full re-paste through POST /connect.
  if (event.httpMethod === "PATCH" && subPath[0] === "connect") return handlePatch(event, userId);
  // Disconnect is the only DELETE endpoint for Airtable; route it
  // regardless of the sub-path (DELETE is unambiguous).
  if (event.httpMethod === "DELETE") return handleDisconnect(userId);
  if (event.httpMethod === "POST" && subPath[0] === "test") return handleTest(event, userId);
  if (event.httpMethod === "POST" && subPath[0] === "push") return handlePush(event, userId);

  return respond(404, { error: `No such endpoint: /integrations/airtable/${subPath.join("/")} (${event.httpMethod})` });
};
