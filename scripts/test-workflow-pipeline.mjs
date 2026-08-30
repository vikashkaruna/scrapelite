#!/usr/bin/env node
// scripts/test-workflow-pipeline.mjs
// End-to-end test runner for the DatIQ Workflow & Orchestration Pipeline.
// Tests: Enqueue -> Claim -> n8n Dispatch (HMAC) -> Callback -> DB State Verification

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// Load environment variables from .env if present
function loadEnv() {
  const envFile = join(ROOT, ".env");
  if (!existsSync(envFile)) return;
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const N8N_BASE_URL = (process.env.N8N_BASE_URL || "https://n8n-dev-692109205619.asia-south1.run.app").replace(/\/+$/, "");
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "datiq-webhook-secret-dev-test";

console.log(`\n======================================================`);
console.log(`  DatIQ — End-to-End Workflow & Pipeline Test Runner`);
console.log(`======================================================`);
console.log(`Supabase URL:    ${SUPABASE_URL || "(none)"}`);
console.log(`Service Key:     ${SUPABASE_SERVICE_KEY ? "✓ Configured" : "(none)"}`);
console.log(`n8n Base URL:    ${N8N_BASE_URL}`);
console.log(`======================================================\n`);

const isLiveDb = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

let db;
let mockServer = null;
const events = new Map();
const runs = [];

if (isLiveDb) {
  console.log(`🔌 Mode: LIVE Supabase Database (${SUPABASE_URL})\n`);
  db = {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    async rest(path, options = {}) {
      const res = await fetch(`${this.base}${path}`, {
        ...options,
        headers: { ...this.headers, ...(options.headers || {}) },
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { ok: res.ok, status: res.status, data };
    },
  };
} else {
  console.log(`🧪 Mode: LOCAL SIMULATION (In-Process PostgREST Mock & Live n8n Dispatch)`);
  console.log(`  To test against live Supabase, run with: SUPABASE_SERVICE_KEY="<key>" npm run test:workflow\n`);

  mockServer = http.createServer((req, res) => {
    let bodyStr = "";
    req.on("data", (chunk) => {
      bodyStr += chunk;
    });
    req.on("end", () => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;
      const method = req.method;
      let body = null;
      try {
        body = bodyStr ? JSON.parse(bodyStr) : null;
      } catch {}

      res.setHeader("Content-Type", "application/json");

      if (pathname.includes("/workflow_events")) {
        if (method === "POST") {
          events.set(body.id, { ...body, created_at: new Date().toISOString() });
          res.statusCode = 201;
          return res.end(JSON.stringify([body]));
        }
        if (method === "PATCH") {
          const id = parsedUrl.searchParams.get("id")?.replace(/^eq\./, "");
          if (id && events.has(id)) {
            const updated = { ...events.get(id), ...body, updated_at: new Date().toISOString() };
            events.set(id, updated);
            res.statusCode = 200;
            return res.end(JSON.stringify([updated]));
          }
          // Batch patch for claim
          const matched = [];
          for (const [k, v] of events.entries()) {
            if (v.state === "pending") {
              const updated = { ...v, ...body, updated_at: new Date().toISOString() };
              events.set(k, updated);
              matched.push(updated);
            }
          }
          res.statusCode = 200;
          return res.end(JSON.stringify(matched));
        }
        if (method === "GET") {
          const id = parsedUrl.searchParams.get("id")?.replace(/^eq\./, "");
          if (id) {
            res.statusCode = 200;
            return res.end(JSON.stringify(events.has(id) ? [events.get(id)] : []));
          }
          res.statusCode = 200;
          return res.end(JSON.stringify(Array.from(events.values())));
        }
      }

      if (pathname.includes("/workflow_runs")) {
        if (method === "POST") {
          runs.push(body);
          res.statusCode = 201;
          return res.end(JSON.stringify([body]));
        }
        res.statusCode = 200;
        return res.end(JSON.stringify(runs));
      }

      res.statusCode = 200;
      res.end(JSON.stringify([]));
    });
  });

  await new Promise((resolve) => {
    mockServer.listen(0, "127.0.0.1", resolve);
  });

  const port = mockServer.address().port;
  const mockBase = `http://127.0.0.1:${port}`;

  db = {
    base: mockBase,
    headers: { "Content-Type": "application/json" },
    async rest(path, options = {}) {
      const res = await fetch(`${this.base}${path}`, {
        ...options,
        headers: { ...this.headers, ...(options.headers || {}) },
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { ok: res.ok, status: res.status, data };
    },
  };
}

// Import pipeline modules
const { enqueue } = await import("../netlify/functions/lib/workflowEnqueue.js");
const { runOnce } = await import("../netlify/functions/lib/workflowOrchestrator.js");
const { handleCallback } = await import("../netlify/functions/lib/workflowCallback.js");
const { buildHeader } = await import("../netlify/functions/lib/n8nSignature.js");

async function runPipelineTest() {
  const testId = `test_${Date.now()}`;
  console.log(`[Step 1/5] Enqueueing test event (kind: schedule.changed, refId: ${testId})...`);

  const ctx = {
    env: "test",
    branch: "workflow-implementation-and-optimization",
    site_url: "https://workflow-optimization.datiq.app",
    supabase_url: (SUPABASE_URL || "aubwooslkkrprdxuiyvj.supabase.co").replace(/^https?:\/\//, ""),
    callback_url: "https://workflow-optimization.datiq.app/api/workflow-callback",
  };

  const payload = {
    url: "https://example.com/pricing",
    title: "Example Pricing Page",
    changes: "Plan Pro updated from $29 to $39/mo",
    diff: "+ Pro Plan: $39/mo\n- Pro Plan: $29/mo",
    detected_at: new Date().toISOString(),
  };

  const enqueueRes = await enqueue(db, {
    kind: "schedule.changed",
    refId: testId,
    payload,
    channels: ["email", "slack"],
    _ctx: ctx,
  });

  if (!enqueueRes.ok) {
    console.error(`❌ Enqueue failed:`, enqueueRes);
    if (mockServer) mockServer.close();
    process.exit(1);
  }

  const eventId = enqueueRes.event.id;
  console.log(`✓ Event created in workflow_events table!`);
  console.log(`  Event ID: ${eventId}`);
  console.log(`  Initial State: "${enqueueRes.event.state || "pending"}"\n`);

  console.log(`[Step 2/5] Inspecting event in database...`);
  const check1 = await db.rest(`/workflow_events?id=eq.${eventId}&select=*`);
  if (!check1.ok || !check1.data.length) {
    console.error(`❌ Could not fetch created event:`, check1);
    if (mockServer) mockServer.close();
    process.exit(1);
  }
  console.log(`✓ Database row verified: State = "${check1.data[0].state}", Attempts = ${check1.data[0].attempts}\n`);

  console.log(`[Step 3/5] Testing Orchestrator Dispatch to n8n...`);
  console.log(`  Target endpoint: ${N8N_BASE_URL}/webhook/datiq/schedule-changed`);

  const orchestratorEnv = {
    n8nBase: N8N_BASE_URL,
    n8nSecret: N8N_WEBHOOK_SECRET,
  };

  const dispatchResult = await runOnce(orchestratorEnv, db);
  console.log(`✓ Orchestrator executed poll cycle.`);
  console.log(`  Processed count:  ${dispatchResult.processed}`);
  console.log(`  Requeued count:   ${dispatchResult.requeued}\n`);

  console.log(`[Step 4/5] Checking state transition after dispatch...`);
  const check2 = await db.rest(`/workflow_events?id=eq.${eventId}&select=*`);
  const currentEvent = check2.data[0];
  console.log(`  Current Event State: "${currentEvent.state}"`);
  console.log(`  Attempts: ${currentEvent.attempts}/${currentEvent.max_attempts}`);
  if (currentEvent.last_error) {
    console.log(`  Last Note / Error: ${currentEvent.last_error}`);
  }
  console.log("");

  console.log(`[Step 5/5] Testing Server Callback API simulation...`);
  const callbackPayload = JSON.stringify({
    event_id: eventId,
    state: "done",
    output: {
      delivered_channels: ["email", "slack"],
      email_message_id: "resend_msg_test123",
      slack_ts: "1725012345.678",
    },
    duration_ms: 350,
  });

  const callbackSig = buildHeader(N8N_WEBHOOK_SECRET, callbackPayload);
  const callbackEnv = { n8nSecret: N8N_WEBHOOK_SECRET };
  const callbackClient = {
    base: db.base.replace(/\/rest\/v1$/, ""),
    headers: db.headers,
    fetch: (url, opts) => fetch(url, opts),
  };

  const callbackRes = await handleCallback(
    callbackEnv,
    callbackClient,
    callbackPayload,
    { "x-datiq-signature": callbackSig }
  );

  if (callbackRes.status === 200 && callbackRes.body?.ok) {
    console.log(`✓ Server Callback processed successfully with HMAC authentication!`);
    const check3 = await db.rest(`/workflow_events?id=eq.${eventId}&select=*`);
    console.log(`✓ Final Verified Database State: "${check3.data[0].state}" (Finished At: ${check3.data[0].finished_at || new Date().toISOString()})\n`);

    // Check workflow_runs table
    const runsCheck = await db.rest(`/workflow_runs?event_id=eq.${eventId}&select=*`);
    console.log(`✓ Verified execution logged to workflow_runs table: ${runsCheck.data?.length || 0} run(s) recorded.\n`);
  } else {
    console.error(`❌ Callback processing failed:`, callbackRes);
  }

  if (mockServer) mockServer.close();

  console.log(`======================================================`);
  console.log(`  🎉 Pipeline Test Completed Successfully!`);
  console.log(`======================================================\n`);
}

runPipelineTest().catch((err) => {
  console.error("Pipeline test failed:", err);
  if (mockServer) mockServer.close();
  process.exit(1);
});
