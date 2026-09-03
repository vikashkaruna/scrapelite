// netlify/functions/signal-rules.js — PRD 5 Native Signal Routing API.
//
// Endpoints:
//   GET  /api/signal-rules             → list user signal rules
//   POST /api/signal-rules { action: "create", name, trigger_source, conditions, action_type, action_config }
//   POST /api/signal-rules { action: "delete", ruleId }
//   POST /api/signal-rules { action: "test", rule, samplePayload }

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import {
  listRules,
  createRule,
  deleteRule,
  testRuleWithPayload,
} from "./lib/ruleStore.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[signal-rules] unhandled error:", e);
    return json(500, { error: e.message || "Signal rule operation failed." });
  }
};

async function handleGet(event) {
  const auth = await authenticateBearer(event, { label: "signal-rules" });
  const userId = auth.ok ? auth.user?.id : null;
  const res = await listRules(userId);
  return json(200, res);
}

async function handlePost(event) {
  const auth = await authenticateBearer(event, { label: "signal-rules" });
  const userId = auth.ok ? auth.user?.id : null;

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const action = body.action || "create";

  if (action === "create") {
    const { name, trigger_source, conditions, action_type, action_config } = body;
    if (!name?.trim()) return json(400, { error: "Rule name is required." });
    const res = await createRule(userId, {
      name,
      trigger_source,
      conditions,
      action_type,
      action_config,
    });
    return json(201, res);
  }

  if (action === "delete") {
    const { ruleId } = body;
    if (!ruleId) return json(400, { error: "ruleId is required." });
    const res = await deleteRule(ruleId, userId);
    return json(200, res);
  }

  if (action === "test") {
    const { rule, samplePayload } = body;
    if (!rule || !samplePayload) {
      return json(400, { error: "rule and samplePayload are required." });
    }
    const res = testRuleWithPayload(rule, samplePayload);
    return json(200, res);
  }

  return json(400, { error: `Unknown action: ${action}` });
}
