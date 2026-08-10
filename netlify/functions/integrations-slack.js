// netlify/functions/integrations-slack.js
//
// F-INT-4 — Slack notification endpoints.
//
// Endpoints:
//   GET    /api/integrations/slack/status
//   POST   /api/integrations/slack/connect  { webhookUrl }
//   DELETE /api/integrations/slack/connect
//   POST   /api/integrations/slack/test     { channel?: string }
//   POST   /api/integrations/slack/notify   { type: "new_extraction" | "new_enrichment", payload }
//
// v1 stores the Slack webhook URL per-user in integration_connections
// (provider='slack', config.webhook_url). v1.0 also honours the global
// SLACK_WEBHOOK_URL env var for self-hosted operators (this is what the
// existing scheduled-runner uses for change alerts).

import { createClient } from "@supabase/supabase-js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import { postToSlack, buildSlackWelcomeMessage } from "./lib/slackFormatter.js";
import { notifyExtractionComplete, buildSlackNewExtraction } from "./lib/notify.js";

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
  const r = await getConnection({ userId, provider: "slack" });
  if (!r.ok) return respond(500, { error: r.error });
  if (!r.connection) {
    return respond(200, {
      connected: false,
      provider: "slack",
      using_global_env: !!process.env.SLACK_WEBHOOK_URL,
    });
  }
  const { access_token, refresh_token, config, ...safe } = r.connection;
  return respond(200, {
    connected: true,
    provider: "slack",
    connection: { ...safe, has_webhook: !!config?.webhook_url },
  });
}

async function handleConnect(event, userId) {
  const body = await readJsonBody(event);
  const webhookUrl = body?.webhookUrl;
  if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
    return respond(400, { error: "webhookUrl must start with https://hooks.slack.com/" });
  }
  // Probe the webhook with a welcome message so the user can confirm the
  // configuration works before they enable it on real events.
  const probe = await postToSlack(
    buildSlackWelcomeMessage({ userName: "DatIQ user", planLabel: "Test" }),
    { webhookUrl },
  );
  if (!probe.ok) {
    return respond(400, { error: `Slack rejected the webhook: ${probe.status || probe.error}` });
  }
  const r = await upsertConnection({
    userId,
    provider: "slack",
    fields: {
      config: { webhook_url: webhookUrl },
      account_label: body?.accountLabel || "Slack",
    },
  });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: true });
}

async function handleDisconnect(userId) {
  const r = await deleteConnection({ userId, provider: "slack" });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: false });
}

async function handleTest(event, userId) {
  const conn = await getConnection({ userId, provider: "slack" });
  const webhookUrl = conn?.ok && conn.connection?.config?.webhook_url
    || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return respond(412, { error: "Slack is not connected. Set a webhook URL in Account → Integrations." });
  }
  const r = await postToSlack(
    buildSlackWelcomeMessage({ userName: "DatIQ user", planLabel: "Test" }),
    { webhookUrl },
  );
  if (!r.ok) return respond(502, { error: `Slack returned ${r.status || r.error}` });
  return respond(200, { ok: true });
}

async function handleNotify(event, userId) {
  const body = await readJsonBody(event);
  const type = body?.type;
  if (type === "new_extraction") {
    const r = await notifyExtractionComplete({ userId, extraction: body?.payload });
    return respond(200, r);
  }
  if (type === "new_enrichment") {
    const r = await notifyEnrichmentCompleteSafe({ userId, ...(body?.payload || {}) });
    return respond(200, r);
  }
  return respond(400, { error: `Unknown notify type: ${type}` });
}

import { notifyEnrichmentComplete } from "./lib/notify.js";
async function notifyEnrichmentCompleteSafe(args) {
  try { return await notifyEnrichmentComplete(args); }
  catch (err) { return { ok: false, error: err?.message }; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  // Resolve the sub-path from THREE sources, in priority order:
  //   1. body.action          — sent by the Account UI (2026-08-10 fix)
  //   2. event.queryStringParameters.splat — original Netlify redirect form
  //   3. event.path tail      — fallback for path-based routing
  // Sources 2 and 3 are kept for backward compatibility with curl tests and
  // any clients that don't send body.action. The body form is the only one
  // that's reliable in production because Netlify's redirect engine is
  // dropping the sub-path in the URL on this branch deploy.
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }
  const splatFromBody = (body && typeof body.action === "string") ? body.action : "";
  const splatFromQuery = event.queryStringParameters?.splat || "";
  const fnName = "/.netlify/functions/integrations-slack";
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
  if (event.httpMethod === "POST" && subPath[0] === "connect") {
    return handleConnect(event, userId);
  }
  // Disconnect is the only DELETE endpoint for Slack; route it regardless
  // of the sub-path (the body.action source only applies to POST).
  if (event.httpMethod === "DELETE") {
    return handleDisconnect(userId);
  }
  if (event.httpMethod === "POST" && subPath[0] === "test") {
    return handleTest(event, userId);
  }
  if (event.httpMethod === "POST" && subPath[0] === "notify") {
    return handleNotify(event, userId);
  }

  // Unknown sub-path. Log full context so the next session can diagnose
  // from the error string alone if this fires again.
  console.warn(
    "[integrations-slack] No such endpoint — splat:",
    JSON.stringify(splat),
    "rawQuery:",
    JSON.stringify(event.queryStringParameters),
    "path:",
    event.path,
    "method:",
    event.httpMethod
  );
  return respond(404, {
    error: `No such endpoint: /integrations/slack/${subPath.join("/")} (${event.httpMethod}) (splat=${JSON.stringify(splat)})`,
  });
};
