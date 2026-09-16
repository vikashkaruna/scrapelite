// GET /api/workflow-graph — the end-to-end view of Lists → Watchlists → Rules.
//
// READ-ONLY, and deliberately so. Phase 1 of the orchestration screen is a
// diagnostic: it names the four ways the pipeline is silently disconnected.
// Creating the missing link is Phase 2, and doing it here first would mean
// shipping mutations before anyone had seen whether the diagnosis is right.
//
// The graph itself is computed by src/lib/workflows/workflowGraph.js — PURE and
// shared with the client, the same arrangement entitlementModel.js and the
// discoverability scoring model use, so the server and the browser cannot
// disagree about whether a rule is reachable.
import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { listLists } from "./lib/bulkStore.js";
import { listWatchlists, serviceDb } from "./lib/watchlistStore.js";
import { listRules, listExecutions } from "./lib/ruleStore.js";
import { buildWorkflowGraph } from "../../src/lib/workflows/workflowGraph.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const auth = await authenticateBearer(event, { label: "workflow-graph" });
  // ⚠️ NOT `auth.ok ? auth.user?.id : null`. That pattern turned an auth
  // FAILURE into an anonymous request, and the stores' `if (userId)` filters
  // then applied NO filter to a service-key query — the defect that returned
  // every tenant's signal rules, Slack webhook URLs included.
  if (!auth.ok || !auth.user?.id) return json(401, { error: "Sign in to view your workflow." });
  const userId = auth.user.id;

  try {
    const [listsRes, watchRes, rulesRes] = await Promise.all([
      listLists(userId),
      listWatchlists(userId),
      listRules(userId),
    ]);

    const lists = listsRes?.lists || listsRes || [];
    const watchlists = watchRes?.watchlists || watchRes || [];
    const rules = rulesRes?.rules || rulesRes || [];

    // Counts the graph needs but the list endpoints do not carry. Absent
    // counts are treated as 0 by the model, which is the conservative reading:
    // it reports "never fired" rather than silently assuming it did.
    const db = serviceDb();
    let executions = [];
    if (rules.length && typeof listExecutions === "function") {
      try {
        const execRes = await listExecutions(userId, { limit: 50 });
        executions = execRes?.executions || [];
      } catch {
        executions = [];
      }

      if (db) {
        const { data: execs } = await db
          .from("rule_executions")
          .select("rule_id")
          .in("rule_id", rules.map((r) => r.id));
        const tally = new Map();
        for (const e of execs || []) tally.set(e.rule_id, (tally.get(e.rule_id) || 0) + 1);
        for (const r of rules) r.execution_count = tally.get(r.id) || 0;
      } else {
        const tally = new Map();
        for (const e of executions) tally.set(e.rule_id, (tally.get(e.rule_id) || 0) + 1);
        for (const r of rules) r.execution_count = tally.get(r.id) || 0;
      }
    }
    if (db && watchlists.length) {
      const { data: changes } = await db
        .from("field_changes")
        .select("watchlist_id")
        .in("watchlist_id", watchlists.map((w) => w.id));
      const tally = new Map();
      for (const c of changes || []) tally.set(c.watchlist_id, (tally.get(c.watchlist_id) || 0) + 1);
      for (const w of watchlists) w.change_count = tally.get(w.id) || 0;
    }

    return json(200, buildWorkflowGraph({ lists, watchlists, rules, executions }));
  } catch (err) {
    console.warn("[DatIQ] workflow-graph failed:", err?.message || err);
    return json(502, { error: "Could not assemble the workflow view.", code: "graph_failed" });
  }
};
