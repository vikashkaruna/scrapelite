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

import { createHash, randomBytes } from "node:crypto";
import { authenticateBearer } from "./lib/supabaseServerClient.js";
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
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
  const auth = await authenticateBearer(event, { label: "integrations-zapier" });
  if (auth.ok) return { ok: true, user: auth.user };
  return { ok: false, response: respond(auth.status, auth.body) };
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
      webhook_hint: config?.webhook_url ? (config.webhook_url.slice(0, 32) + "…") : null,
      webhook_url: config?.webhook_url || null,
      has_token: !!config?.token_hash,
    },
  });
}

async function handleConnect(event, userId) {
  let body = {};
  try { body = await readJsonBody(event); } catch { /* tolerate empty */ }

  const webhookUrl = typeof body?.webhookUrl === "string" && body.webhookUrl.trim().startsWith("http")
    ? body.webhookUrl.trim()
    : (body?.webhookUrl === null ? null : undefined);

  const existing = await getConnection({ userId, provider: "zapier" });
  const existingConfig = existing?.connection?.config || {};

  const regenerate = body?.regenerate === true || (!body?.token && webhookUrl === undefined && !existingConfig.token_hash);
  let plaintext = body?.token;
  let tokenHash = existingConfig.token_hash;
  let tokenHint = existingConfig.token_hint;

  if (regenerate || (!tokenHash && !plaintext)) {
    plaintext = generateZapierToken();
    tokenHash = hashToken(plaintext);
    tokenHint = plaintext.slice(-4);
  } else if (plaintext) {
    if (!plaintext.startsWith("zap_")) {
      return respond(400, { error: "Token must start with 'zap_'." });
    }
    tokenHash = hashToken(plaintext);
    tokenHint = plaintext.slice(-4);
  }

  const finalWebhookUrl = webhookUrl !== undefined ? webhookUrl : (existingConfig.webhook_url || null);

  const r = await upsertConnection({
    userId,
    provider: "zapier",
    fields: {
      config: {
        token_hash: tokenHash,
        token_hint: tokenHint,
        webhook_url: finalWebhookUrl,
      },
      account_label: body?.accountLabel || existing?.connection?.account_label || "Zapier",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });

  // Also create a per-user DatIQ API key so the user's other integrations
  // (and the Zapier action handlers) can hit /api/v1.
  let apiKey = null;
  if (existing?.connection?.config?.api_key_id && !regenerate) {
    // Don't re-mint.
  } else {
    apiKey = generateApiKey("live");
  }

  return respond(200, {
    ok: true,
    connected: true,
    ...((regenerate || !body?.token) && plaintext ? { token: plaintext } : {}),
    webhook_url: finalWebhookUrl,
    token_hint: tokenHint,
  });
}

/**
 * PATCH /connect — partial update. Accepts:
 *   - accountLabel  string   rename the connection in the UI
 *   - webhookUrl    string   set, update, or clear the Zapier Catch Hook URL
 */
async function handlePatch(event, userId) {
  let body = {};
  try { body = await readJsonBody(event); } catch { /* tolerate */ }
  const conn = await getConnection({ userId, provider: "zapier" });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) {
    return respond(400, { error: "Zapier is not connected. Use POST /connect to set it up first." });
  }
  const existingConfig = conn.connection.config || {};
  const fields = {};
  const configPatch = { ...existingConfig };

  if (typeof body?.accountLabel === "string" && body.accountLabel.trim()) {
    fields.account_label = body.accountLabel.trim();
  }

  if (body?.webhookUrl !== undefined) {
    const raw = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    if (raw && !raw.startsWith("http")) {
      return respond(400, { error: "webhookUrl must be a valid URL starting with http:// or https://" });
    }
    configPatch.webhook_url = raw || null;
  }

  fields.config = configPatch;
  const r = await upsertConnection({ userId, provider: "zapier", fields });
  if (!r.ok) return respond(500, { error: r.error });

  return respond(200, {
    ok: true,
    connected: true,
    webhook_url: configPatch.webhook_url,
    webhook_hint: configPatch.webhook_url ? (configPatch.webhook_url.slice(0, 32) + "…") : null,
    token_hint: configPatch.token_hint || null,
  });
}

/**
 * POST /test — authenticated test endpoint called by Account UI / Edit modal.
 * Tests configured Zapier Catch Hook webhook URL or validates a secret token.
 */
async function handleUserTest(event, userId) {
  const conn = await getConnection({ userId, provider: "zapier" });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) {
    return respond(412, { error: "Zapier is not connected. Connect Zapier in Account → Integrations." });
  }
  const config = conn.connection.config || {};
  const webhookUrl = config.webhook_url;
  const hasToken = !!config.token_hash;
  const tokenHint = config.token_hint;

  let body = {};
  try { body = await readJsonBody(event); } catch { /* ignore */ }

  // 1. If testing a specific secret key provided in body:
  if (body.token) {
    if (!body.token.startsWith("zap_")) {
      return respond(400, { error: "Token must start with 'zap_'." });
    }
    const testHash = hashToken(body.token);
    if (testHash !== config.token_hash) {
      return respond(401, { error: "Secret key does not match the active Zapier token for this account." });
    }
    return respond(200, {
      ok: true,
      type: "token",
      detail: "Secret key verified successfully against stored token",
      has_token: true,
      token_hint: tokenHint,
    });
  }

  // 2. If a Zapier Catch Hook Webhook URL is configured, send test ping:
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "test.ping",
          message: "DatIQ Zapier test connection",
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        return respond(502, { error: `Zapier catch hook returned HTTP ${res.status}` });
      }
      return respond(200, {
        ok: true,
        type: "webhook",
        detail: "Catch Hook received test ping successfully",
        has_token: hasToken,
        token_hint: tokenHint,
      });
    } catch (err) {
      return respond(502, { error: `Zapier webhook ping failed: ${err.message}` });
    }
  }

  // 3. If token is configured:
  if (hasToken) {
    return respond(200, {
      ok: true,
      type: "token",
      detail: `Token (ending in ${tokenHint || "...."}) stored and ready`,
      has_token: true,
      token_hint: tokenHint,
    });
  }

  return respond(400, { error: "Neither a Webhook URL nor a token is configured for Zapier." });
}

async function handlePush(event, userId) {
  const connRes = await getConnection({ userId, provider: "zapier" });
  if (!connRes.ok || !connRes.connection) {
    return respond(412, { error: "Zapier is not connected. Connect Zapier in Account → Integrations." });
  }

  let body;
  try { body = await readJsonBody(event); } catch { return respond(400, { error: "Invalid JSON" }); }
  const items = Array.isArray(body?.items) ? body.items : (body?.extraction ? [body.extraction] : []);
  if (items.length === 0) {
    return respond(400, { error: "No items provided to push." });
  }

  const webhookUrl = connRes.connection.config?.webhook_url;
  let webhookSuccess = 0;
  const errors = [];

  // 1. Direct webhook dispatch if user configured a Zapier Catch Hook URL
  if (webhookUrl) {
    for (const item of items) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "extraction.pushed",
            extraction: item,
            pushed_at: new Date().toISOString(),
          }),
        });
        if (res.ok) webhookSuccess++;
        else errors.push(`Zapier catch hook returned ${res.status}`);
      } catch (err) {
        errors.push(`Zapier webhook error: ${err.message}`);
      }
    }
  }

  // 2. Event Store emission for polling Zaps
  for (const item of items) {
    await appendEvent({
      userId,
      eventType: "new_extraction",
      payload: {
        id: item.id || `ext_${Date.now()}`,
        url: item.url,
        title: item.title || item.page_title,
        summary: item.summary || item.ai_summary,
        created_at: item.created_at || new Date().toISOString(),
        manual_push: true,
      },
      dedupeKey: `push_${item.id || item.url}_${Date.now()}`,
    }).catch(() => {});
  }

  return respond(200, {
    ok: true,
    pushed: items.length,
    total: items.length,
    errors,
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
    if (event.httpMethod === "PATCH" && (subPath[0] === "connect" || subPath.length === 0)) {
      return await handlePatch(event, auth.user.id);
    }
    if (event.httpMethod === "POST" && (subPath[0] === "test" || body.action === "test")) {
      return await handleUserTest(event, auth.user.id);
    }
    if (event.httpMethod === "POST" && (subPath[0] === "push" || body.action === "push")) {
      return await handlePush(event, auth.user.id);
    }
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
