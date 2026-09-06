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
import { getPipelineConfig } from "./admin-automation.js";
import { withJobRun, isJobEnabled } from "./lib/jobControl.js";

// Must match the id in AUTOMATION_JOBS (src/lib/monitoringModel.js) and the
// [functions."..."] block in netlify.toml. cron-registry-parity asserts all three.
const JOB_ID = "workflow-orchestrator";

// Cron: every 5 minutes (acts as backup fallback when enabled).
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
  const splatFromBody = (body && typeof body.action === "string") ? body.action : "";
  const splatFromQuery = event.queryStringParameters?.splat || event.queryStringParameters?.action || "";
  const cleanPath = (event.path || "")
    .replace(/^\/\.netlify\/functions\/workflow-orchestrator\/?/i, "")
    .replace(/^\/api\/workflow-orchestrator\/?/i, "")
    .replace(/^\/workflow-orchestrator\/?/i, "")
    .replace(/^\/+/, "");
  const action = (splatFromBody || splatFromQuery || cleanPath || "run-now").replace(/^\/+/, "");

  if (action === "ping" || action.endsWith("/ping") || action.endsWith("ping")) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, pong: true, ts: new Date().toISOString() }) };
  }
  if (action === "dispatch") {
    return await forceDispatch(env, client, body);
  }
  if (action === "run-now" || action === "") {
    const result = await runOnce(env, client);
    return { statusCode: 200, body: JSON.stringify(result) };
  }
  return { statusCode: 404, body: JSON.stringify({ error: `unknown action '${action}'` }) };
}

// ── The scheduled poll ─────────────────────────────────────────────────
// Wrapped in withJobRun so it (a) writes a job_runs row that /admin/monitoring
// can read, and (b) honours the operator kill switch. Without this the job
// would appear on the dashboard permanently reading "never run", and the Stop
// button would silently do nothing — a dashboard that lies is worse than none.
const scheduledPoll = withJobRun(JOB_ID, async () => {
  const env = getEnv();
  const client = sbClient(env);

  if (!client) {
    return { statusCode: 200, body: "skipped (no supabase)" };
  }
  if (!env.n8nBase) {
    return { statusCode: 200, body: "skipped (no N8N_BASE_URL)" };
  }

  // Check admin pipeline configuration
  const pipelineConfig = await getPipelineConfig(client);
  if (pipelineConfig.mode === "paused") {
    console.log("[DatIQ] orchestrator: scheduled poll skipped (pipeline paused by admin)");
    return { statusCode: 200, body: "skipped (pipeline paused by admin)" };
  }

  const result = await runOnce(env, client);
  const summary = `scanned=${result.scanned || 0} dispatched=${result.dispatched || 0} failed=${result.failed || 0} requeued=${result.requeued || 0}`;
  console.log(`[DatIQ] orchestrator: ${summary}`);
  return { statusCode: result.ok ? 200 : 500, body: summary };
});

// ── Netlify entrypoint ─────────────────────────────────────────────────
export const handler = async (event) => {
  // HTTP path: POST /api/workflow-orchestrator/{run-now,dispatch}.
  // Callers are n8n (HMAC-signed) and the operator (Bearer token).
  if (event && event.httpMethod) {
    const env = getEnv();
    const client = sbClient(env);

    // The operator Stop switch gates the WORK, not the endpoint — a decision,
    // not an oversight. Three reasons it is shaped this way:
    //
    //  1. Stop has to mean stop. If it only halted the cron, an operator who
    //     stopped this job mid-incident would still watch events flow out via
    //     n8n's own /dispatch calls.
    //  2. It answers 200, not 4xx/5xx. n8n treats a non-2xx as a retryable
    //     failure, so refusing with an error would turn one operator stop into
    //     a retry storm against this endpoint.
    //  3. It deliberately writes NO job_runs row. job_runs is sized for a
    //     5-minute cron; n8n calls /dispatch per event, and prune_ops_history()
    //     still has no scheduled caller. The cron path keeps full run history.
    //
    // isJobEnabled FAILS OPEN, like everywhere else it is used: a Supabase blip
    // means the pipeline runs. Use OPS_JOBS_DISABLED for a stop that cannot.
    if (!(await isJobEnabled(JOB_ID))) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true, job: JOB_ID, skipped: true, reason: "disabled_by_operator",
          message: `${JOB_ID} is stopped by an operator — no work was done.`,
        }),
      };
    }

    return await handleHttp(event, env, client);
  }

  // Scheduled path (also the path a manual "Run now" takes: admin-monitoring
  // calls handler({ opsTrigger: "manual" }), which carries no httpMethod).
  return scheduledPoll(event);
};
