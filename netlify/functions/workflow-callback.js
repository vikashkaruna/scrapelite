// netlify/functions/workflow-callback.js
//
// HTTP Endpoint: POST /api/workflow-callback
// Invoked by n8n workflows upon completion or failure of an automation run.
//
// Pattern: Server Callback API
// - Allows n8n to be completely stateless regarding database credentials.
// - n8n signs the callback with HMAC-SHA256 (X-DatIQ-Signature) or Bearer token.
// - DatIQ updates the event status in PostgreSQL using its own SUPABASE_SERVICE_KEY.

import { handleCallback } from "./lib/workflowCallback.js";

function getEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return {
    url,
    key,
    n8nSecret: process.env.N8N_WEBHOOK_SECRET || process.env.DATIQ_N8N_API_KEY || "",
    adminToken:
      process.env.WORKFLOW_ORCHESTRATOR_TOKEN ||
      process.env.ADMIN_TOKEN_SECRET ||
      process.env.ADMIN_PIN_HASH ||
      "",
  };
}

function sbClient(env) {
  if (!env.url || !env.key) return null;
  const base = env.url.startsWith("http") ? env.url : `https://${env.url}`;
  return {
    base,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
    },
    fetch: globalThis.fetch,
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
      body: JSON.stringify({ ok: false, error: "Method not allowed. Use POST." }),
    };
  }

  const env = getEnv();
  const client = sbClient(env);

  if (!client) {
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "database not configured on server" }),
    };
  }

  const res = await handleCallback(env, client, event.body || "{}", event.headers || {});

  return {
    statusCode: res.status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(res.body),
  };
};
