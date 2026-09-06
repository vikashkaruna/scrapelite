// netlify/functions/workflow-orchestrator-cron.js
//
// The scheduled half of the v2 workflow pipeline.
//
// WHY THIS IS A SEPARATE FUNCTION FROM workflow-orchestrator.js
// -------------------------------------------------------------
// A Netlify function can be a cron OR an HTTP endpoint, not both. Declaring a
// schedule in netlify.toml makes Netlify refuse public HTTP access to that
// function (see netlify.toml's header — it is the same mechanism that keeps
// billing-purge off the open internet). workflow-orchestrator.js has three live
// HTTP callers and therefore cannot carry the schedule:
//
//   * n8n/workflows/00-datiq-smoke-test.json          -> /api/workflow-orchestrator/ping
//   * n8n/workflows/datiq_process_pending_workflow.json -> /api/workflow-orchestrator/dispatch
//   * the operator smoke test in the deployment guide  -> /api/workflow-orchestrator/run-now
//
// Scheduling that function would have started the cron and simultaneously
// 404'd all three. So the cron lives here, the HTTP surface stays there, and
// both call the SAME runOnce() from lib/workflowOrchestrator.js — there is no
// second copy of the poll logic that could drift from the one n8n exercises.
//
// Registered in netlify.toml AND in AUTOMATION_JOBS (src/lib/monitoringModel.js).
// cron-registry-parity.test.js asserts all three agree.

import { runOnce } from "./lib/workflowOrchestrator.js";
import { withJobRun } from "./lib/jobControl.js";
import { getPipelineConfig } from "./admin-automation.js";

const JOB_ID = "workflow-orchestrator-cron";

function getEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_KEY || "",
    n8nBase: process.env.N8N_BASE_URL || "",
    n8nSecret: process.env.N8N_WEBHOOK_SECRET || "",
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

// withJobRun writes the job_runs row /admin/monitoring reads and honours the
// operator kill switch. Without it this job would show on the dashboard
// permanently reading "never run", and Stop would silently do nothing.
export const handler = withJobRun(JOB_ID, async () => {
  const env = getEnv();
  const client = sbClient(env);

  if (!client) return { statusCode: 200, body: "skipped (no supabase)" };
  if (!env.n8nBase) return { statusCode: 200, body: "skipped (no N8N_BASE_URL)" };

  // The admin pipeline mode is a separate control from the kill switch:
  // "paused" means events queue for a manual Run now, which is a product
  // setting, whereas the kill switch is an operator stopping the job outright.
  const pipelineConfig = await getPipelineConfig(client);
  if (pipelineConfig.mode === "paused") {
    console.log("[DatIQ] orchestrator-cron: skipped (pipeline paused by admin)");
    return { statusCode: 200, body: "skipped (pipeline paused by admin)" };
  }

  const result = await runOnce(env, client);
  const summary = `scanned=${result.scanned || 0} dispatched=${result.dispatched || 0} failed=${result.failed || 0} requeued=${result.requeued || 0}`;
  console.log(`[DatIQ] orchestrator-cron: ${summary}`);
  return { statusCode: result.ok ? 200 : 500, body: summary };
});
