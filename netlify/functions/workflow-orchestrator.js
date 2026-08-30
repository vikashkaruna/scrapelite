// netlify/functions/workflow-orchestrator.js
//
// Thin Netlify handler. All the actual work is in
// netlify/functions/lib/workflowOrchestrator.js so it can be unit-tested
// without going through Netlify's runtime.
//
// Two invocation modes:
//   1. Scheduled  — Netlify invokes every 5 min via `config.schedule`.
//                    No httpMethod on the event. Runs the poll loop.
//   2. HTTP       — POST to /api/workflow-orchestrator/{action}.
//                    Auth: Bearer admin token OR X-DatIQ-Signature HMAC.
//                    Actions: 'run-now' (synchronous full poll) and
//                             'dispatch' (synchronous dispatch of one event).
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §6

import { runOnce } from "./lib/workflowOrchestrator.js";
import { verify as verifySig } from "./lib/n8nSignature.js";

// Cron: every 5 minutes.
export const config = { schedule: "*/5 * * * *" };

// ── Environment ────────────────────────────────────────────────────────
function getEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_KEY || "",
    n8nBase: process.env.N8N_BASE_URL || "", // e.g. https://n8n-dev-692109205619.asia-south1.run.app
    n8nSecret: process.env.N8N_WEBHOOK_SECRET || "",
    adminToken:
      process.env.WORKFLOW_ORCHESTRATOR_TOKEN ||
      process.env.ADMIN_TOKEN_SECRET ||
      process.env.ADMIN_PIN_HASH ||
      "",
  };
}

function sbClient(env) {
  if (!env.url || !env.key) return null;
  return {
    base: `${env.url}/rest/v1`,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
    },
  };
}

// ── Auth ───────────────────────────────────────────────────────────────
function authorized(event, env) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (env.adminToken && bearer === env.adminToken) return true;
  const sig = headers["x-datiq-signature"] || headers["X-DatIQ-Signature"];
  if (env.n8nSecret && sig) {
    const v = verifySig(env.n8nSecret, event.body || "", sig);
    if (v.ok) return true;
  }
  return false;
}

// ── HTTP: force-dispatch one event ─────────────────────────────────────
async function forceDispatch(env, client, body) {
  const eventId = body?.event_id;
  if (!eventId) {
    return { statusCode: 400, body: JSON.stringify({ error: "missing event_id" }) };
  }
  // Fetch the event.
  const res = await fetch(
    `${client.base}/workflow_events?id=eq.${encodeURIComponent(eventId)}&select=*`,
    { headers: client.headers }
  );
  if (!res.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: `supabase ${res.status}` }) };
  }
  const rows = await res.json();
  const event = Array.isArray(rows) ? rows[0] : null;
  if (!event) {
    return { statusCode: 404, body: JSON.stringify({ error: "event not found" }) };
  }
  if (event.state === "done" || event.state === "cancelled") {
    return { statusCode: 409, body: JSON.stringify({ error: `event is ${event.state}` }) };
  }
  // Reset and re-claim.
  await fetch(
    `${client.base}/workflow_events?id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        state: "processing",
        started_at: new Date().toISOString(),
        next_attempt_at: new Date().toISOString(),
        attempts: (event.attempts || 0) + 1,
        last_error: null,
      }),
    }
  );
  const { dispatchOne } = await import("./lib/workflowOrchestrator.js");
  const fresh = { ...event, state: "processing", attempts: (event.attempts || 0) + 1 };
  const result = await dispatchOne(env, client, fresh);
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: !!result.ok, ...result }),
  };
}

// ── HTTP handler ───────────────────────────────────────────────────────
async function handleHttp(event, env, client) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "method not allowed" }) };
  }
  if (!client) {
    return { statusCode: 503, body: JSON.stringify({ error: "supabase not configured" }) };
  }
  if (!authorized(event, env)) {
    return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "invalid JSON body" }) };
  }
  const action = body.action || (event.path || "").replace(/^\/+/, "");

  if (action === "dispatch" || action === "/dispatch") {
    return await forceDispatch(env, client, body);
  }
  if (action === "run-now" || action === "/run-now" || action === "") {
    const result = await runOnce(env, client);
    return { statusCode: 200, body: JSON.stringify(result) };
  }
  return { statusCode: 404, body: JSON.stringify({ error: `unknown action '${action}'` }) };
}

// ── Netlify entrypoint ─────────────────────────────────────────────────
export const handler = async (event) => {
  const env = getEnv();
  const client = sbClient(env);

  // HTTP path
  if (event && event.httpMethod) {
    return await handleHttp(event, env, client);
  }

  // Scheduled path
  if (!client) {
    return { statusCode: 200, body: "skipped (no supabase)" };
  }
  if (!env.n8nBase) {
    return { statusCode: 200, body: "skipped (no N8N_BASE_URL)" };
  }

  const result = await runOnce(env, client);
  const summary = `scanned=${result.scanned || 0} dispatched=${result.dispatched || 0} failed=${result.failed || 0} requeued=${result.requeued || 0}`;
  console.log(`[DatIQ] orchestrator: ${summary}`);
  return { statusCode: result.ok ? 200 : 500, body: summary };
};
