// netlify/functions/integrations-notion.js
//
// F-INT-5 — Notion server-side push. Mirrors the browser adapter in
// src/lib/notion.js so users can keep their Notion integration secret
// server-side instead of pasting it in the browser.
//
// Endpoints:
//   GET    /api/integrations/notion/status
//   POST   /api/integrations/notion/connect   { apiKey, databaseId }
//   DELETE /api/integrations/notion/connect
//   POST   /api/integrations/notion/schema    { apiKey?, databaseId? } → database properties
//   POST   /api/integrations/notion/push      { items, databaseId, schema? }
//
// The connect step validates the token + database by calling
// GET /v1/databases/{id} and stores both in integration_connections.

import { createClient } from "@supabase/supabase-js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import {
  pushToNotion,
  fetchNotionSchema,
  buildNotionPageBody,
  validateNotionConfig,
  defaultNotionSchema,
} from "../../src/lib/notion.js";

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

function getSupabaseForUser(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  });
}

async function readJsonBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) return JSON.parse(Buffer.from(event.body, "base64").toString("utf8"));
  return JSON.parse(event.body);
}

async function authenticateRequest(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) return { ok: false, response: respond(401, { error: "Authentication required" }) };
  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) return { ok: false, response: respond(503, { error: "Supabase not configured" }) };
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, response: respond(401, { error: "Invalid or expired session" }) };
  return { ok: true, user };
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleStatus(userId) {
  const r = await getConnection({ userId, provider: "notion" });
  if (!r.ok) return respond(500, { error: r.error });
  if (!r.connection) return respond(200, { connected: false, provider: "notion" });
  const { access_token, refresh_token, config, ...safe } = r.connection;
  const schema = config?.schema || {};
  const columnCount = Object.keys(schema).length;
  const titleColumn = Object.entries(schema).find(([, p]) => p?.type === "title")?.[0] || null;
  return respond(200, {
    connected: true,
    provider: "notion",
    connection: {
      ...safe,
      database_id: config?.database_id || null,
      has_api_key: !!config?.api_key,
      token_hint: tokenHint(config?.api_key),
      column_count: columnCount,
      title_column: titleColumn,
    },
  });
}

function tokenHint(token) {
  if (!token || typeof token !== "string") return null;
  const tail = token.slice(-4);
  if (token.length <= 4) return tail;
  return `${token.slice(0, 7)}…${tail}`;
}

async function handleConnect(event, userId) {
  const body = await readJsonBody(event);
  const apiKey = body?.apiKey;
  const databaseId = body?.databaseId;
  const errors = validateNotionConfig({ apiKey, databaseId });
  if (errors.length) return respond(400, { error: errors.join(" ") });

  // Probe the database
  const probe = await fetchNotionSchema({ apiKey, databaseId });
  if (!probe.ok) return respond(400, { error: probe.error });

  const r = await upsertConnection({
    userId,
    provider: "notion",
    fields: {
      config: { api_key: apiKey, database_id: databaseId, schema: probe.properties || defaultNotionSchema() },
      account_label: body?.accountLabel || "Notion",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, {
    ok: true,
    connected: true,
    schema: probe.properties,
    titleColumn: probe.titleColumn,
  });
}

async function handleDisconnect(userId) {
  const r = await deleteConnection({ userId, provider: "notion" });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: false });
}

async function handleSchema(event, userId) {
  const body = await readJsonBody(event).catch(() => ({}));
  const conn = await getConnection({ userId, provider: "notion", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  const apiKey = body?.apiKey || conn.connection?.config?.api_key;
  const databaseId = body?.databaseId || conn.connection?.config?.database_id;
  if (!apiKey || !databaseId) return respond(400, { error: "Connect Notion first, or pass apiKey + databaseId." });
  const probe = await fetchNotionSchema({ apiKey, databaseId });
  if (!probe.ok) return respond(400, { error: probe.error });
  return respond(200, { properties: probe.properties, titleColumn: probe.titleColumn, title: probe.rawTitle });
}

/**
 * POST /test — verify the stored token + database still work. Returns
 * { ok, titleColumn, columnCount } on success. Use this from the
 * Account UI's "Test connection" button.
 */
async function handleTest(event, userId) {
  const body = await readJsonBody(event).catch(() => ({}));
  const conn = await getConnection({ userId, provider: "notion", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(412, { error: "Notion is not connected. Set it up in Account → Integrations." });
  const apiKey = body?.apiKey || conn.connection.config?.api_key;
  const databaseId = body?.databaseId || conn.connection.config?.database_id;
  if (!apiKey || !databaseId) return respond(400, { error: "Notion connection is missing apiKey / databaseId. Reconnect." });
  const probe = await fetchNotionSchema({ apiKey, databaseId });
  if (!probe.ok) {
    if (/401|unauthor/i.test(probe.error || "")) {
      return respond(401, { error: "Notion rejected the integration secret (401). It may have been revoked. Reconnect in Account → Integrations." });
    }
    return respond(502, { error: probe.error });
  }
  const properties = probe.properties || {};
  return respond(200, {
    ok: true,
    titleColumn: probe.titleColumn,
    columnCount: Object.keys(properties).length,
    title: probe.rawTitle,
  });
}

/**
 * PATCH /connect — partial update. Accepts:
 *   - accountLabel  string   rename the connection
 *   - databaseId    string   change target database (re-fetches schema)
 *   - refreshSchema true     re-fetch schema for the current database
 *
 * The PAT (apiKey) is NEVER changeable via PATCH — token rotation
 * requires a full re-paste through POST /connect.
 */
async function handlePatch(event, userId) {
  const body = await readJsonBody(event);
  const conn = await getConnection({ userId, provider: "notion", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(400, { error: "Notion is not connected. Use POST /connect to set it up first." });
  const existingConfig = conn.connection.config || {};
  const fields = {};
  const configPatch = { ...existingConfig };

  if (typeof body?.accountLabel === "string" && body.accountLabel.trim()) {
    fields.account_label = body.accountLabel.trim();
  }

  const newDbId = typeof body?.databaseId === "string" && body.databaseId.trim() ? body.databaseId.trim() : existingConfig.database_id;
  const dbIdChanged = newDbId !== existingConfig.database_id;
  if (dbIdChanged) {
    configPatch.database_id = newDbId;
  }

  // Re-fetch schema when the database changes OR the caller asked for
  // a refresh. We also persist the new schema so subsequent pushes use
  // the latest column types.
  const shouldRefresh = dbIdChanged || body?.refreshSchema === true;
  if (shouldRefresh) {
    if (!existingConfig.api_key) {
      return respond(400, { error: "Cannot refresh schema: no API key on file. Reconnect with a token." });
    }
    const probe = await fetchNotionSchema({ apiKey: existingConfig.api_key, databaseId: newDbId });
    if (!probe.ok) return respond(400, { error: probe.error });
    configPatch.schema = probe.properties || defaultNotionSchema();
  }

  fields.config = configPatch;
  const r = await upsertConnection({ userId, provider: "notion", fields });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, {
    ok: true,
    connected: true,
    database_id: configPatch.database_id,
    schema: configPatch.schema,
    titleColumn: Object.entries(configPatch.schema || {}).find(([, p]) => p?.type === "title")?.[0] || null,
  });
}

async function handlePush(event, userId) {
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) return respond(400, { error: "'items' must be a non-empty array." });

  const conn = await getConnection({ userId, provider: "notion", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  const apiKey = body?.apiKey || conn.connection?.config?.api_key;
  const databaseId = body?.databaseId || conn.connection?.config?.database_id;
  const schema = body?.schema || conn.connection?.config?.schema || defaultNotionSchema();
  if (!apiKey || !databaseId) return respond(400, { error: "Connect Notion first." });

  const r = await pushToNotion(items, { apiKey, databaseId, schema });
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
  const fnName = "/.netlify/functions/integrations-notion";
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
  if (event.httpMethod === "POST" && subPath[0] === "connect") return handleConnect(event, userId);
  if (event.httpMethod === "PATCH" && subPath[0] === "connect") return handlePatch(event, userId);
  // Disconnect is the only DELETE endpoint for Notion; route it
  // regardless of the sub-path (DELETE is unambiguous).
  if (event.httpMethod === "DELETE") return handleDisconnect(userId);
  if (event.httpMethod === "POST" && subPath[0] === "test") return handleTest(event, userId);
  if (event.httpMethod === "POST" && subPath[0] === "schema") return handleSchema(event, userId);
  if (event.httpMethod === "POST" && subPath[0] === "push") return handlePush(event, userId);

  return respond(404, { error: `No such endpoint: /integrations/notion/${subPath.join("/")} (${event.httpMethod})` });
};

// Re-export so the function reads the lib/* paths consistently.
export const _internal = { buildNotionPageBody };
