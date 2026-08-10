// netlify/functions/integrations-airtable.js
//
// F-INT-6 — Airtable server-side push. Mirrors the browser adapter in
// src/lib/airtable.js so users can keep their Airtable Personal Access
// Token server-side.
//
// Endpoints:
//   GET    /api/integrations/airtable/status
//   POST   /api/integrations/airtable/connect   { apiKey, baseId, tableId }
//   DELETE /api/integrations/airtable/connect
//   POST   /api/integrations/airtable/push      { items, baseId?, tableId? }

import { createClient } from "@supabase/supabase-js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import {
  pushToAirtable,
  validateAirtableConfig,
} from "../../src/lib/airtable.js";

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
  const r = await getConnection({ userId, provider: "airtable" });
  if (!r.ok) return respond(500, { error: r.error });
  if (!r.connection) return respond(200, { connected: false, provider: "airtable" });
  const { access_token, refresh_token, config, ...safe } = r.connection;
  return respond(200, {
    connected: true,
    provider: "airtable",
    connection: {
      ...safe,
      base_id: config?.base_id || null,
      table_id: config?.table_id || null,
      has_api_key: !!config?.api_key,
    },
  });
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
  const r = await upsertConnection({
    userId,
    provider: "airtable",
    fields: {
      config: { api_key: apiKey, base_id: baseId, table_id: tableId },
      account_label: body?.accountLabel || "Airtable",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: true });
}

async function handleDisconnect(userId) {
  const r = await deleteConnection({ userId, provider: "airtable" });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: false });
}

async function handlePush(event, userId) {
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) return respond(400, { error: "'items' must be a non-empty array." });
  const conn = await getConnection({ userId, provider: "airtable", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  const apiKey = body?.apiKey || conn.connection?.config?.api_key;
  const baseId = body?.baseId || conn.connection?.config?.base_id;
  const tableId = body?.tableId || conn.connection?.config?.table_id;
  if (!apiKey || !baseId || !tableId) return respond(400, { error: "Connect Airtable first." });
  const r = await pushToAirtable(items, { apiKey, baseId, tableId });
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
  if (event.httpMethod === "POST" && subPath[0] === "connect") return handleConnect(event, userId);
  // Disconnect is the only DELETE endpoint for Airtable; route it
  // regardless of the sub-path (DELETE is unambiguous).
  if (event.httpMethod === "DELETE") return handleDisconnect(userId);
  if (event.httpMethod === "POST" && subPath[0] === "push") return handlePush(event, userId);

  return respond(404, { error: `No such endpoint: /integrations/airtable/${subPath.join("/")} (${event.httpMethod})` });
};
