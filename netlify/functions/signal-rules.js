// netlify/functions/signal-rules.js — PRD 5 Native Signal Routing API.
//
// Endpoints:
//   GET  /api/signal-rules             → list user signal rules
//   POST /api/signal-rules { action: "create", name, trigger_source, conditions, action_type, action_config }
//   POST /api/signal-rules { action: "delete", ruleId }
//   POST /api/signal-rules { action: "test", rule, samplePayload }

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { performAction } from "./lib/signalDispatch.js";
import { resolveRequestEntitlement, checkCapability, denyResponse } from "./lib/requireEntitlement.js";
import {
  listRules,
  createRule,
  updateRule,
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
  // A failed authentication is a REFUSAL, not an anonymous request. The
  // previous `auth.ok ? auth.user?.id : null` fell through to a service-key
  // query with no user filter, so an unauthenticated GET returned every user's
  // rules — `action_config` and all, which is where Slack webhook URLs live.
  const auth = await authenticateBearer(event, { label: "signal-rules" });
  if (!auth.ok) return json(auth.status, auth.body);

  const res = await listRules(auth.user.id);
  return json(200, res);
}

async function handlePost(event) {
  const auth = await authenticateBearer(event, { label: "signal-rules" });
  if (!auth.ok) return json(auth.status, auth.body);
  const userId = auth.user.id;

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

    // A rule's only purpose is to dispatch into an integration, so it answers
    // to the integrations entitlement. Checked before the write, not after.
    const resolved = await resolveRequestEntitlement(event);
    const gate = checkCapability(resolved, "rule.create");
    if (!gate.allowed) return denyResponse(gate, CORS);

    const res = await createRule(userId, {
      name,
      trigger_source,
      conditions,
      action_type,
      action_config,
    });
    // A rejected destination URL is the caller's mistake, not a server fault.
    if (!res.ok) return json(res.status || 400, { error: res.reason });
    return json(201, res);
  }

  if (action === "update") {
    const { ruleId, updates } = body;
    if (!ruleId) return json(400, { error: "ruleId is required." });
    const res = await updateRule(userId, ruleId, updates || {});
    if (!res.ok) return json(res.status || 400, { error: res.reason });
    return json(200, res);
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

  // ── test_destination ────────────────────────────────────────────────────
  // Sends ONE real message to the destination the user is configuring, so
  // "Test" answers the only question that matters: does anything arrive.
  //
  // It runs through `performAction`, the SAME function the cron dispatches
  // with — not a parallel copy. That is deliberate for two reasons: a test
  // that disagrees with production is worse than no test, and `performAction`
  // is where the SSRF guard lives (`resolveDestination` → isPublicHttpUrlAsync),
  // so this endpoint cannot be turned into a probe for internal addresses.
  // Nothing is persisted and no execution row is written: a test is not part
  // of the rule's audit trail.
  if (action === "test_destination") {
    const { action_type, action_config } = body;
    if (!action_type || !action_config) {
      return json(400, { error: "action_type and action_config are required." });
    }
    const probeRule = {
      id: "test-destination",
      name: "DatIQ destination test",
      user_id: userId,
      action_type,
      action_config,
    };
    const probeEvent = {
      kind: "watchlist.change_detected",
      userId,
      occurredAt: new Date().toISOString(),
      payload: {
        domain: "example.com",
        materiality: "low",
        summary: "This is a DatIQ test message. Your destination is configured correctly.",
        _test: true,
      },
    };
    const outcome = await performAction(probeRule, probeEvent);
    return json(200, {
      ok: outcome.ok === true,
      status: outcome.status,
      // `error` here is about the user's OWN destination (a 404 webhook, a bad
      // channel), so it is theirs to see — unlike an AI provider fault.
      error: outcome.error || null,
      httpStatus: outcome.httpStatus ?? null,
    });
  }

  return json(400, { error: `Unknown action: ${action}` });
}
