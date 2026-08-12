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
//   POST   /api/integrations/slack/send     { items: [extraction, ...] }
//
// v1 stores the Slack webhook URL per-user in integration_connections
// (provider='slack', config.webhook_url). v1.0 also honours the global
// SLACK_WEBHOOK_URL env var for self-hosted operators (this is what the
// existing scheduled-runner uses for change alerts).
//
// /send is the on-demand "Push to Slack" path used by PushIntegrationMenu
// and the ExportIntegrations modal. It only posts to Slack (no Zapier
// fan-out — that path is for event-driven triggers, not explicit user
// actions). Per-item failures are surfaced via failedRecords; the response
// shape mirrors pushToIntegration so the client can render it the same way
// as the other push providers.

import { createClient } from "@supabase/supabase-js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";
import { postToSlack, buildSlackWelcomeMessage } from "./lib/slackFormatter.js";
import { notifyExtractionComplete, buildSlackNewExtraction, resolveSlackWebhook } from "./lib/notify.js";
import { noRealtimeOptions } from "./lib/supabaseServerClient.js";

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
  if (error || !user) {
    // Swallowing the real Supabase error here is exactly why the
    // 2026-08-12 fix (passing `jwt` to getUser) was hard to distinguish
    // from other causes of the same client-visible message — a stale
    // access token, a JWT signed by a different Supabase project (see
    // "custom auth domain" note in CLAUDE.md), or genuine session
    // expiry all render identically to the user. Log the real reason
    // server-side and surface a non-sensitive `reason` string on the
    // response so a repeat report is diagnosable without guessing.
    console.warn("[integrations-slack] getUser(jwt) rejected:", error?.message || "no user returned", error?.status ?? "");
    return {
      ok: false,
      response: respond(401, { error: "Invalid or expired session", reason: error?.message || "no_user" }),
    };
  }
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
  const url = config?.webhook_url || "";
  return respond(200, {
    connected: true,
    provider: "slack",
    connection: {
      ...safe,
      has_webhook: !!url,
      // Surface only the host + a short tail of the path, never the
      // signing secret in the URL. Enough to confirm "yes, this is the
      // workspace webhook" without leaking the channel/secret segment.
      webhook_hint: webhookHint(url),
    },
  });
}

function webhookHint(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("slack.com")) return null;
    // Format: "hooks.slack.com · services/T0…/B0…/…xQ7z"
    const pathParts = u.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return u.hostname;
    // Mask everything but the first letter of each segment, except the
    // last segment which gets shown as last 4 chars only.
    const masked = pathParts.map((seg, i) => {
      if (i === pathParts.length - 1) return `…${seg.slice(-4)}`;
      return `${seg.slice(0, 3)}…`;
    });
    return `${u.hostname} · /${masked.join("/")}`;
  } catch {
    return null;
  }
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

/**
 * PATCH /connect — partial update. Accepts:
 *   - accountLabel  string   rename the connection in the UI
 *   - webhookUrl    string   change the webhook (probed first, same as
 *                            /connect — a typo would silently break
 *                            every notification)
 */
async function handlePatch(event, userId) {
  const body = await readJsonBody(event);
  const conn = await getConnection({ userId, provider: "slack", includeSecrets: true });
  if (!conn.ok) return respond(500, { error: conn.error });
  if (!conn.connection) return respond(400, { error: "Slack is not connected. Use POST /connect to set it up first." });
  const existingConfig = conn.connection.config || {};
  const fields = {};
  const configPatch = { ...existingConfig };

  if (typeof body?.accountLabel === "string" && body.accountLabel.trim()) {
    fields.account_label = body.accountLabel.trim();
  }

  if (typeof body?.webhookUrl === "string" && body.webhookUrl.trim()) {
    const newUrl = body.webhookUrl.trim();
    if (!/^https:\/\/hooks\.slack\.com\//.test(newUrl)) {
      return respond(400, { error: "webhookUrl must start with https://hooks.slack.com/" });
    }
    // Probe the new webhook the same way /connect does, so a typo
    // doesn't silently break every subsequent notification.
    const probe = await postToSlack(
      buildSlackWelcomeMessage({ userName: "DatIQ user", planLabel: "Test" }),
      { webhookUrl: newUrl },
    );
    if (!probe.ok) {
      return respond(400, { error: `Slack rejected the new webhook: ${probe.status || probe.error}` });
    }
    configPatch.webhook_url = newUrl;
  }

  if (Object.keys(fields).length === 0 && configPatch === existingConfig) {
    return respond(400, { error: "No updatable fields supplied. Use { accountLabel, webhookUrl }." });
  }
  fields.config = configPatch;

  const r = await upsertConnection({ userId, provider: "slack", fields });
  if (!r.ok) return respond(500, { error: r.error });
  return respond(200, { ok: true, connected: true, webhook_hint: webhookHint(configPatch.webhook_url) });
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

// On-demand "Push to Slack" — takes a list of items, posts one Block Kit
// message per item to the user's per-user webhook (with env fallback),
// and returns an aggregated { sent, total, failedRecords } response that
// mirrors the other push providers so the client can render a uniform
// toast.
//
// Distinct from /notify:
//   • /notify is event-driven (fires on new_extraction, new_enrichment),
//     and it ALSO emits a Zapier event per item. /send is explicit user
//     action — Slack only, no Zapier fan-out.
//   • /send is one call with N items; /notify is one call per event.
async function handleSend(event, userId) {
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) {
    return respond(400, { error: "items must be a non-empty array" });
  }

  // Resolve the user's webhook once (single DB hit), then loop the posts.
  // A null result means no Slack is configured — fail fast with the same
  // 412 the /test endpoint uses, so the client UI can show the same
  // "set up Slack first" message it already knows how to render.
  const webhookUrl = await resolveSlackWebhook({ userId });
  if (!webhookUrl) {
    return respond(412, {
      error: "Slack is not connected. Set a webhook URL in Account → Integrations.",
    });
  }

  const failedRecords = [];
  let sent = 0;
  for (const item of items) {
    const payload = buildSlackNewExtraction(item);
    if (!payload) {
      failedRecords.push({ url: item?.url || null, error: "invalid_item" });
      continue;
    }
    const r = await postToSlack(payload, { webhookUrl });
    if (r.ok) {
      sent += 1;
    } else {
      // Log the failing item so the next time this happens we can see the
      // exact payload in the Netlify function logs. Without this, all we
      // knew was `slack_400` (Slack's body was being discarded). Now
      // postToSlack surfaces the real reason, but we still want the
      // title-length context for the "long title overflows header" class
      // of bug, which is silent once the truncation is in place.
      console.warn("[integrations-slack] send failed", {
        url: item?.url,
        page_title_len: (item?.page_title || item?.title || "").length,
        summary_len: (item?.ai_summary || item?.summary || "").length,
        slackStatus: r.status,
        slackError: r.error,
      });
      failedRecords.push({
        url: item?.url || null,
        error: r.error || `slack_${r.status || "unknown"}`,
      });
    }
  }

  return respond(200, {
    ok: failedRecords.length === 0,
    sent,
    total: items.length,
    errors: failedRecords.map((r) => r.error),
    failedRecords,
  });
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

  // Top-level try/catch (2026-08-11 fix): a thrown error in any handler
  // used to surface as a Netlify 502 with no body — opaque to the
  // browser. The modal then rendered "HTTP 502" with nothing to debug.
  // This wraps the whole dispatch and converts the throw into a 500
  // with err.message, which the modal can display verbatim. Airtable
  // and HubSpot already have this pattern; Slack did not.
  //
  // Subtle but critical: each `return handleX(...)` MUST be `return await
  // handleX(...)`. Returning the bare Promise from an async function
  // means the try/catch sees the return value (a Promise), NOT a
  // rejection — the rejection just becomes the function's return value,
  // which propagates straight to the caller. The test that caught this
  // was `mockStore.get.mockRejectedValueOnce(new Error("..."))`, which
  // was a rejected Promise from the inner handler that escaped the
  // catch. The fix: `await` every handler return so rejections are
  // thrown inside the try block, where the catch can see them.
  try {
    const auth = await authenticateRequest(event);
    if (!auth.ok) return auth.response;
    const userId = auth.user.id;

    if (event.httpMethod === "GET" && (subPath.length === 0 || subPath[0] === "status")) {
      return await handleStatus(userId);
    }
    if (event.httpMethod === "POST" && subPath[0] === "connect") {
      return await handleConnect(event, userId);
    }
    if (event.httpMethod === "PATCH" && subPath[0] === "connect") {
      return await handlePatch(event, userId);
    }
    // Disconnect is the only DELETE endpoint for Slack; route it regardless
    // of the sub-path (the body.action source only applies to POST).
    if (event.httpMethod === "DELETE") {
      return await handleDisconnect(userId);
    }
    if (event.httpMethod === "POST" && subPath[0] === "test") {
      return await handleTest(event, userId);
    }
    if (event.httpMethod === "POST" && subPath[0] === "notify") {
      return await handleNotify(event, userId);
    }
    if (event.httpMethod === "POST" && subPath[0] === "send") {
      return await handleSend(event, userId);
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
  } catch (err) {
    console.error("[integrations-slack] uncaught error", err);
    return respond(500, { error: `Internal error: ${err?.message || String(err)}` });
  }
};
