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
  autoMapNotionSchema,
} from "../../src/lib/notion.js";
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
  const auth = await authenticateBearer(event, { label: "integrations-notion" });
  if (auth.ok) return { ok: true, user: auth.user };
  return { ok: false, response: respond(auth.status, auth.body) };
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleStatus(userId) {
  const r = await getConnection({ userId, provider: "notion", includeSecrets: true });
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

  const mappedSchema = probe.schema || autoMapNotionSchema(probe.properties, probe.titleColumn) || defaultNotionSchema();
  const r = await upsertConnection({
    userId,
    provider: "notion",
    fields: {
      config: { api_key: apiKey, database_id: databaseId, schema: mappedSchema },
      account_label: body?.accountLabel || "Notion",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, {
    ok: true,
    connected: true,
    schema: probe.properties,
    mappedSchema,
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
  const mappedSchema = probe.schema || autoMapNotionSchema(properties, probe.titleColumn) || defaultNotionSchema();
  if (conn.connection && conn.connection.config) {
    await upsertConnection({
      userId,
      provider: "notion",
      fields: {
        config: { ...conn.connection.config, schema: mappedSchema },
      },
    }).catch((err) => console.warn("[integrations-notion] test schema refresh warning:", err?.message));
  }
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
    configPatch.schema = probe.schema || autoMapNotionSchema(probe.properties, probe.titleColumn) || defaultNotionSchema();
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
  // Server-side mirror of the client's checkCanIntegrations gate (Select and
  // up) — a client that skips the UI and POSTs directly must still be refused.
  const { check } = await requireCapabilityForUser(userId, "integrations");
  if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) return respond(400, { error: "'items' must be a non-empty array." });

  const conn = await getConnection({ userId, provider: "notion", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  const apiKey = body?.apiKey || conn.connection?.config?.api_key;
  const databaseId = body?.databaseId || conn.connection?.config?.database_id;
  const rawSchema = body?.schema || conn.connection?.config?.schema;
  const schema = autoMapNotionSchema(rawSchema) || defaultNotionSchema();
  if (!apiKey || !databaseId) return respond(400, { error: "Connect Notion first." });

  const r = await pushToNotion(items, { apiKey, databaseId, schema });
  if (!r.ok) {
    console.error(`[integrations-notion] push failed for user ${userId}:`, r.errors);
    return respond(400, r);
  }
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

  // Top-level try/catch (2026-08-11 fix): a thrown error in any handler
  // used to surface as a Netlify 502 with no body — opaque to the
  // browser. The modal then rendered "HTTP 502" with nothing to debug.
  // This wraps the whole dispatch and converts the throw into a 500
  // with err.message, which the modal can display verbatim. Airtable
  // and HubSpot already have this pattern; Notion did not.
  //
  // Subtle but critical: each `return handleX(...)` MUST be `return await
  // handleX(...)`. Returning the bare Promise from an async function
  // means the try/catch sees the return value (a Promise), NOT a
  // rejection — the rejection just becomes the function's return value,
  // which propagates straight to the caller. The fix: `await` every
  // handler return so rejections are thrown inside the try block, where
  // the catch can see them.
  try {
    const auth = await authenticateRequest(event);
    if (!auth.ok) return auth.response;
    const userId = auth.user.id;

    if (event.httpMethod === "GET" && (subPath.length === 0 || subPath[0] === "status")) {
      return await handleStatus(userId);
    }
    if (event.httpMethod === "POST" && subPath[0] === "connect") return await handleConnect(event, userId);
    if (event.httpMethod === "PATCH" && subPath[0] === "connect") return await handlePatch(event, userId);
    // Disconnect is the only DELETE endpoint for Notion; route it
    // regardless of the sub-path (DELETE is unambiguous).
    if (event.httpMethod === "DELETE") return await handleDisconnect(userId);
    if (event.httpMethod === "POST" && subPath[0] === "test") return await handleTest(event, userId);
    if (event.httpMethod === "POST" && subPath[0] === "schema") return await handleSchema(event, userId);
    if (event.httpMethod === "POST" && subPath[0] === "push") return await handlePush(event, userId);

    return respond(404, { error: `No such endpoint: /integrations/notion/${subPath.join("/")} (${event.httpMethod})` });
  } catch (err) {
    console.error("[integrations-notion] uncaught error", err);
    return respond(500, { error: `Internal error: ${err?.message || String(err)}` });
  }
};

// Re-export so the function reads the lib/* paths consistently.
export const _internal = { buildNotionPageBody };
