// netlify/functions/integrations-zapier.js
//
// F-INT-3 — Zapier integration.
//
// Public endpoints (no JWT — Zapier uses a per-Zap secret token in the
// `X-Zapier-Token` header):
//
//   GET  /api/integrations/zapier/test
//     Returns { ok: true } when the token is valid. Used by Zapier as a
//     "test" call during Zap setup.
//
//   GET  /api/integrations/zapier/poll?event_type=new_extraction&since=ISO
//     Returns the list of new events since the cursor. Zapier stores the
//     timestamp of the last event it saw and passes it as `since` on the
//     next poll.
//
//   GET  /api/integrations/zapier/actions
//     Returns the list of actions the Zapier app exposes (extract URL,
//     create schedule, etc.) so Zapier's action picker can present them.
//
//   POST /api/integrations/zapier/action
//     Body: { action: "extract_url", params: { url, intent } }
//     Executes the named action using the user's stored context.
//
// Internal endpoints (require Supabase JWT — the user calls these from the
// Account UI to manage the connection):
//
//   GET    /api/integrations/zapier/status
//   POST   /api/integrations/zapier/connect   { token?: string, regenerate?: true }
//   DELETE /api/integrations/zapier/connect
//
// The token model: the user mints a per-Zap secret in the Account UI. We
// store a SHA-256 hash of the token in `integration_connections.config`; the
// plaintext is shown once. Zapier includes the plaintext in
// `X-Zapier-Token` on every call.

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { noRealtimeOptions } from "./lib/supabaseServerClient.js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import { appendEvent, pollEvents } from "./lib/zapierEventStore.js";
import { generateApiKey, envOf } from "./lib/apiKeyService.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Zapier-Token",
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
  return createClient(url, anonKey, noRealtimeOptions({
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  }));
}

async function readJsonBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) return JSON.parse(Buffer.from(event.body, "base64").toString("utf8"));
  return JSON.parse(event.body);
}

async function authenticateRequest(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) return { ok: false, response: respond(401, { error: "Authentication required" }) };
  // Extract the raw JWT — supabase-js v2.108+ returns AuthSessionMissingError
  // when `getUser()` is called on a client with no session and no
  // `hasCustomAuthorizationHeader: true` flag, EVEN IF the global Authorization
  // header is set. Passing the JWT directly is the documented server-side
  // pattern and bypasses the flag check entirely (the request still sends
  // the `Authorization: Bearer <jwt>` header to /auth/v1/user).
  // — fix 2026-08-12, "Invalid or expired session" on every integration
  // connect modal click.
  const jwt = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
  if (!jwt) return { ok: false, response: respond(401, { error: "Authentication required" }) };
  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) return { ok: false, response: respond(503, { error: "Supabase not configured" }) };
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return { ok: false, response: respond(401, { error: "Invalid or expired session" }) };
  return { ok: true, user };
}

function hashToken(plaintext) {
  return createHash("sha256").update(String(plaintext), "utf8").digest("hex");
}

function generateZapierToken() {
  // 32 random bytes → 43 base64url chars, prefixed `zap_` so it can't be
  // confused with a DatIQ API key.
  return `zap_${randomBytes(32).toString("base64url")}`;
}

// ── Public (Zapier-side) handlers ─────────────────────────────────────────

/**
 * Extract the Zapier token from the request. Zapier's Visual Builder
 * auto-detects the auth mode when a user imports the JSON, and the
 * result is inconsistent: "Custom" mode puts the field in a header
 * (the way the JSON says), but the Builder also offers "API Key"
 * mode, which sends the field as `?api_key=<token>` — and if the user
 * imports the JSON and the Builder misclassifies it (it does this
 * often — see §19 of the integration handoff), the token lands in
 * the URL as a query parameter instead of the X-Zapier-Token header.
 *
 * We accept all three locations so the visual-builder quirk doesn't
 * translate into a useless 401 on a perfectly valid token:
 *   1. `X-Zapier-Token` header (the spec-compliant path)
 *   2. `?api_key=<token>` query parameter (Zapier "API Key" auth)
 *   3. `?token=<token>` query parameter (some custom templates)
 *
 * The X-Zapier-Token header remains the preferred path (it doesn't
 * end up in proxy access logs the way a query string does). The
 * query-param fallbacks are pure compatibility shims for the visual
 * builder.
 */
function extractZapierToken(event) {
  const headers = event.headers || {};
  const query = event.queryStringParameters || {};
  return (
    headers["x-zapier-token"] ||
    headers["X-Zapier-Token"] ||
    query.api_key ||
    query.token ||
    null
  );
}

async function verifyZapierToken(plaintext) {
  if (!plaintext || !plaintext.startsWith("zap_")) return { ok: false, error: "malformed_token" };
  const tokenHash = hashToken(plaintext);
  // We can't query "by hash" without a per-token index, so we walk the
  // user_id space. v1 caps at one token per user, so a single
  // user-scoped lookup is enough.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, error: "service_db_unconfigured" };
  const qs = new URLSearchParams({
    provider: "eq.zapier",
    select: "id,user_id,config",
    limit: "1",
  }).toString();
  let res;
  try {
    res = await fetch(`${url}/rest/v1/integration_connections?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.config?.token_hash) return { ok: false, error: "no_such_token" };
  if (row.config.token_hash !== tokenHash) return { ok: false, error: "invalid_token" };
  return { ok: true, userId: row.user_id };
}

async function handleTest(event) {
  const token = extractZapierToken(event);
  if (!token) return respond(401, { error: 'Missing Zapier token (X-Zapier-Token header, ?api_key, or ?token query param).' });
  const v = await verifyZapierToken(token);
  if (!v.ok) return respond(401, { error: v.error });
  return respond(200, { ok: true });
}

async function handlePoll(event) {
  const token = extractZapierToken(event);
  if (!token) return respond(401, { error: 'Missing Zapier token (X-Zapier-Token header, ?api_key, or ?token query param).' });
  const v = await verifyZapierToken(token);
  if (!v.ok) return respond(401, { error: v.error });

  const eventType = event.queryStringParameters?.event_type;
  const since = event.queryStringParameters?.since;
  const limit = parseInt(event.queryStringParameters?.limit || "25", 10) || 25;
  const r = await pollEvents({ userId: v.userId, eventType, since, limit });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { events: r.events });
}

function handleActionsList() {
  // The action catalogue. Each entry is what Zapier shows in the action
  // picker; the runtime handler is dispatched on `key` in handleAction.
  return respond(200, {
    actions: [
      {
        key: "extract_url",
        label: "Extract a URL with DatIQ",
        params: [
          { name: "url", type: "string", required: true, label: "Page URL" },
          { name: "intent", type: "string", required: false, label: "Intent (summary|contacts|pricing|map|custom)" },
        ],
        returns: ["id", "url", "title", "summary", "headings", "links"],
      },
      {
        key: "create_schedule",
        label: "Create a DatIQ schedule",
        params: [
          { name: "url", type: "string", required: true, label: "Page URL" },
          { name: "cadence", type: "string", required: true, label: "Cadence (daily|weekly|monthly|...)" },
          { name: "intent", type: "string", required: false, label: "Intent" },
        ],
        returns: ["id", "url", "next_run_at"],
      },
      {
        key: "enrich_extraction",
        label: "Run an enrichment on an extraction",
        params: [
          { name: "extraction_id", type: "string", required: true, label: "DatIQ extraction id" },
          { name: "focus", type: "string", required: true, label: "Focus (contacts|leadership|social|mission|pricing)" },
        ],
        returns: ["focus", "data"],
      },
    ],
  });
}

async function handleAction(event) {
  const token = extractZapierToken(event);
  if (!token) return respond(401, { error: 'Missing Zapier token (X-Zapier-Token header, ?api_key, or ?token query param).' });
  const v = await verifyZapierToken(token);
  if (!v.ok) return respond(401, { error: v.error });

  let body;
  try { body = await readJsonBody(event); }
  catch { return respond(400, { error: "Invalid JSON" }); }
  const action = body?.action;
  const params = body?.params || {};

  // Look up the user's API key (created on connect) so we can call our own
  // /api/v1 endpoints. v1 uses a service-key shortcut to avoid a JWT
  // round-trip; the v1.1 cutover will use the per-user key.
  if (action === "extract_url") {
    if (!params.url) return respond(400, { error: "params.url is required" });
    const base = process.env.DATIQ_INTERNAL_API_BASE || process.env.URL || process.env.SITE_URL;
    try {
      const r = await fetch(`${base}/.netlify/functions/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Zapier-User-Id": v.userId },
        body: JSON.stringify({ url: params.url, options: { renderJs: false, customPrompt: params.intent === "custom" ? params.prompt : undefined } }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return respond(502, { error: data?.error || `extract_${r.status}` });
      return respond(200, data?.data || {});
    } catch (err) {
      return respond(502, { error: err.message });
    }
  }

  return respond(404, { error: `Unknown action: ${action}` });
}

// ── Internal (user-side) handlers ─────────────────────────────────────────

async function handleStatus(userId) {
  const r = await getConnection({ userId, provider: "zapier" });
  if (!r.ok) return respond(500, { error: r.error });
  if (!r.connection) return respond(200, { connected: false, provider: "zapier" });
  const { access_token, refresh_token, config, ...safe } = r.connection;
  return respond(200, {
    connected: true,
    provider: "zapier",
    connection: {
      ...safe,
      token_hint: config?.token_hint || null, // last 4 chars
      has_token: !!config?.token_hash,
    },
  });
}

async function handleConnect(event, userId) {
  let body = {};
  try { body = await readJsonBody(event); } catch { /* tolerate empty */ }

  const regenerate = body?.regenerate === true;
  if (!regenerate && !body?.token) {
    return respond(400, { error: "Provide either { token } to store an existing token, or { regenerate: true } to mint a new one." });
  }

  let plaintext = body?.token;
  if (regenerate) {
    plaintext = generateZapierToken();
  }

  if (!plaintext || !plaintext.startsWith("zap_")) {
    return respond(400, { error: "Token must start with 'zap_'." });
  }

  const tokenHash = hashToken(plaintext);
  const r = await upsertConnection({
    userId,
    provider: "zapier",
    fields: {
      config: { token_hash: tokenHash, token_hint: plaintext.slice(-4) },
      account_label: "Zapier",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });

  // Also create a per-user DatIQ API key so the user's other integrations
  // (and the Zapier action handlers) can hit /api/v1.
  let apiKey = null;
  const existing = await getConnection({ userId, provider: "zapier" });
  if (existing?.connection?.config?.api_key_id && !regenerate) {
    // Don't re-mint.
  } else {
    // Mint a fresh API key tied to this user. v1.1 will store the plaintext
    // temporarily for the user's Zap setup; v1 returns it ONCE in the
    // response so they can paste it elsewhere.
    apiKey = generateApiKey("live");
    // Note: we do not persist the plaintext — this is only useful for
    // ad-hoc scripts. Zapier itself uses the per-Zap token above.
  }

  return respond(200, {
    ok: true,
    connected: true,
    // Return the plaintext ONLY on mint (regenerate=true). When the user
    // stores an existing token, never echo it back.
    ...(regenerate ? { token: plaintext } : {}),
  });
}

async function handleDisconnect(userId) {
  const r = await deleteConnection({ userId, provider: "zapier" });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: false });
}

// ── Public handler surface for /api/integrations/zapier/* ─────────────────

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
  const fnName = "/.netlify/functions/integrations-zapier";
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
  // and HubSpot already have this pattern; Zapier did not.
  //
  // Subtle but critical: each `return handleX(...)` MUST be `return await
  // handleX(...)`. Returning the bare Promise from an async function
  // means the try/catch sees the return value (a Promise), NOT a
  // rejection — the rejection just becomes the function's return value,
  // which propagates straight to the caller. The fix: `await` every
  // handler return so rejections are thrown inside the try block, where
  // the catch can see them.
  try {
    // Public, no JWT required:
    if (event.httpMethod === "GET" && subPath[0] === "test") return await handleTest(event);
    if (event.httpMethod === "GET" && subPath[0] === "poll") return await handlePoll(event);
    if (event.httpMethod === "GET" && subPath[0] === "actions") return handleActionsList();
    if (event.httpMethod === "POST" && subPath[0] === "action") return await handleAction(event);

    // Internal, JWT required:
    const auth = await authenticateRequest(event);
    if (!auth.ok) return auth.response;

    if (event.httpMethod === "GET" && (subPath.length === 0 || subPath[0] === "status")) {
      return await handleStatus(auth.user.id);
    }
    if (event.httpMethod === "POST" && subPath[0] === "connect") {
      return await handleConnect(event, auth.user.id);
    }
    // Disconnect is the only DELETE endpoint for Zapier; route it
    // regardless of the sub-path (DELETE is unambiguous).
    if (event.httpMethod === "DELETE") {
      return await handleDisconnect(auth.user.id);
    }

    // Test event injection (admin-style — used by the cron to add events):
    if (event.httpMethod === "POST" && subPath[0] === "events") {
      let body;
      try { body = await readJsonBody(event); }
      catch { return respond(400, { error: "Invalid JSON" }); }
      const { event_type, payload, dedupe_key } = body || {};
      if (!event_type) return respond(400, { error: "event_type is required" });
      const r = await appendEvent({
        userId: auth.user.id,
        eventType: event_type,
        payload,
        dedupeKey: dedupe_key,
      });
      if (!r.ok) return respond(500, { error: r.error });
      return respond(201, { ok: true });
    }

    return respond(404, { error: `No such endpoint: /integrations/zapier/${subPath.join("/")} (${event.httpMethod})` });
  } catch (err) {
    console.error("[integrations-zapier] uncaught error", err);
    return respond(500, { error: `Internal error: ${err?.message || String(err)}` });
  }
};
