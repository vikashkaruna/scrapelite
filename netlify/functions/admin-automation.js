// netlify/functions/admin-automation.js
//
// Read + write endpoint for /admin/automation.
//   GET  → aggregated stats + recent events (all kinds)
//   POST action="retry"     { event_id }     → reset attempts + set pending
//   POST action="cancel"    { event_id, reason? }
//   POST action="dispatch"  { event_id }     → force-dispatch now
//   POST action="run-now"                    → trigger orchestrator poll
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §6 (admin surface)
//
// Auth: Bearer admin session token (HMAC of admin-auth.js).

import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import { runOnce, dispatchOne } from "./lib/workflowOrchestrator.js";

const HEADERS = { "Content-Type": "application/json" };
const ok = (body) => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(body) });
const bad = (code, msg) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) });

// Minimal REST helper (same shape as admin-revenue.js / admin-users.js).
function getDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    base,
    headers,
    async rest(path) {
      const res = await fetch(path, { headers });
      if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
  };
}

// ── Aggregations ───────────────────────────────────────────────────────
async function getStats(db) {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Single round-trip with PostgREST count + filter combinations.
  const base = `${db.base}/workflow_events?select=state,kind,attempts,finished_at,started_at,created_at`;
  const [all, last24h, kinds] = await Promise.all([
    db.rest(`${base}&state=in.(pending,processing,failed,done,cancelled)&limit=500`),
    db.rest(`${base}&created_at=gte.${encodeURIComponent(oneDayAgo)}&limit=500`),
    db.rest(`${db.base}/workflow_events?select=kind&limit=1000`),
  ]);

  const byState = { pending: 0, processing: 0, failed: 0, done: 0, cancelled: 0 };
  let last24hFailed = 0;
  let last24hDone = 0;
  let totalTimeMs = 0;
  let timedCount = 0;
  for (const r of all) {
    if (byState[r.state] !== undefined) byState[r.state]++;
    if (r.state === "failed" && r.created_at >= oneDayAgo) last24hFailed++;
    if (r.state === "done" && r.created_at >= oneDayAgo) last24hDone++;
    if (r.state === "done" && r.started_at && r.finished_at) {
      const t = new Date(r.finished_at) - new Date(r.started_at);
      if (t > 0 && t < 60_000) {
        totalTimeMs += t;
        timedCount++;
      }
    }
  }
  const byKind = {};
  for (const r of kinds) byKind[r.kind] = (byKind[r.kind] || 0) + 1;

  return {
    byState,
    byKind,
    last24h: { failed: last24hFailed, done: last24hDone, total: last24h.length },
    avgTimeToDoneMs: timedCount > 0 ? Math.round(totalTimeMs / timedCount) : null,
    last24hTotal: last24h.length,
  };
}

async function getRecentEvents(db, limit) {
  return db.rest(
    `${db.base}/workflow_events?select=id,kind,ref_id,user_id,state,attempts,max_attempts,next_attempt_at,last_error,created_at,finished_at&order=created_at.desc&limit=${Math.min(limit || 50, 200)}`
  );
}

async function getEventDetail(db, eventId) {
  const [events, runs] = await Promise.all([
    db.rest(`${db.base}/workflow_events?id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`),
    db.rest(`${db.base}/workflow_runs?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=attempt_n.desc&limit=20`),
  ]);
  return { event: Array.isArray(events) ? events[0] : null, runs: Array.isArray(runs) ? runs : [] };
}

async function retryEvent(db, eventId) {
  const res = await fetch(
    `${db.base}/workflow_events?id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { ...db.headers, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        state: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        finished_at: null,
        started_at: null,
      }),
    }
  );
  if (!res.ok) return { ok: false, error: `supabase ${res.status}` };
  const rows = await res.json();
  return { ok: true, event: Array.isArray(rows) ? rows[0] : null };
}

async function cancelEvent(db, eventId, reason) {
  const res = await fetch(
    `${db.base}/workflow_events?id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { ...db.headers, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        state: "cancelled",
        finished_at: new Date().toISOString(),
        last_error: String(reason || "cancelled by admin").slice(0, 1000),
      }),
    }
  );
  if (!res.ok) return { ok: false, error: `supabase ${res.status}` };
  const rows = await res.json();
  return { ok: true, event: Array.isArray(rows) ? rows[0] : null };
}

// ── Pipeline Configuration ─────────────────────────────────────────────
export const DEFAULT_PIPELINE_CONFIG = {
  mode: "event_driven", // "event_driven" | "scheduled" | "paused"
  polling_interval_minutes: 60,
  scale_to_zero: true,
  last_updated_at: new Date().toISOString(),
  updated_by: "system",
};

export async function getPipelineConfig(db) {
  if (!db) return DEFAULT_PIPELINE_CONFIG;
  try {
    const res = await fetch(`${db.base}/app_config?key=eq.automation_pipeline&select=value&limit=1`, { headers: db.headers });
    if (!res.ok) return DEFAULT_PIPELINE_CONFIG;
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.value) {
      return { ...DEFAULT_PIPELINE_CONFIG, ...rows[0].value };
    }
    return DEFAULT_PIPELINE_CONFIG;
  } catch {
    return DEFAULT_PIPELINE_CONFIG;
  }
}

export async function savePipelineConfig(db, config, actor = "admin") {
  if (!db) return { ok: false, error: "supabase not configured" };
  try {
    const mode = ["event_driven", "scheduled", "paused"].includes(config?.mode) ? config.mode : "event_driven";
    const interval = Number(config?.polling_interval_minutes) || 60;
    const merged = {
      mode,
      polling_interval_minutes: interval,
      scale_to_zero: config?.scale_to_zero !== false,
      last_updated_at: new Date().toISOString(),
      updated_by: actor,
    };
    const res = await fetch(`${db.base}/app_config?on_conflict=key`, {
      method: "POST",
      headers: {
        ...db.headers,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        key: "automation_pipeline",
        value: merged,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return { ok: true, config: merged };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to save pipeline configuration" };
  }
}

// ── Handlers ───────────────────────────────────────────────────────────
async function handleGet(event) {
  const params = event.queryStringParameters || {};
  const db = getDb();
  if (!db) return bad(503, "supabase not configured");

  if (params.event_id) {
    const detail = await getEventDetail(db, params.event_id);
    return ok({ ok: true, ...detail });
  }

  const [stats, events, config] = await Promise.all([
    getStats(db),
    getRecentEvents(db, Number(params.limit) || 50),
    getPipelineConfig(db),
  ]);
  return ok({ ok: true, stats, events, config });
}

async function handlePost(event) {
  const auth = bearerFromEvent(event);
  const v = verifyAdminToken(auth);
  if (!v.ok) return bad(401, v.reason || "unauthorized");

  const db = getDb();
  if (!db) return bad(503, "supabase not configured");

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return bad(400, "invalid JSON"); }
  const action = body.action;

  if (action === "set-config") {
    const r = await savePipelineConfig(db, body.config, v.actor || "admin");
    return r.ok ? ok(r) : bad(500, r.error);
  }
  if (action === "get-config") {
    const config = await getPipelineConfig(db);
    return ok({ ok: true, config });
  }
  if (action === "retry") {
    if (!body.event_id) return bad(400, "missing event_id");
    const r = await retryEvent(db, body.event_id);
    return r.ok ? ok(r) : bad(500, r.error);
  }
  if (action === "cancel") {
    if (!body.event_id) return bad(400, "missing event_id");
    const r = await cancelEvent(db, body.event_id, body.reason);
    return r.ok ? ok(r) : bad(500, r.error);
  }
  if (action === "dispatch") {
    if (!body.event_id) return bad(400, "missing event_id");
    const getRes = await fetch(`${db.base}/workflow_events?id=eq.${encodeURIComponent(body.event_id)}&select=*`, { headers: db.headers });
    if (!getRes.ok) return bad(502, `supabase ${getRes.status}`);
    const rows = await getRes.json();
    const eventRow = Array.isArray(rows) ? rows[0] : null;
    if (!eventRow) return bad(404, "event not found");
    const orchEnv = {
      n8nBase: process.env.N8N_BASE_URL || "",
      n8nSecret: process.env.N8N_WEBHOOK_SECRET || "",
    };
    const r = await dispatchOne(orchEnv, db, eventRow);
    return ok({ ok: true, dispatched: r });
  }
  if (action === "run-now") {
    const orchEnv = {
      n8nBase: process.env.N8N_BASE_URL || "",
      n8nSecret: process.env.N8N_WEBHOOK_SECRET || "",
    };
    const r = await runOnce(orchEnv, db);
    return ok({ ok: true, ran: r });
  }
  return bad(400, `unknown action '${action}'`);
}

export const handler = async (event) => {
  const method = event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (method === "GET") return await handleGet(event);
  if (method === "POST") return await handlePost(event);
  return bad(405, "method not allowed");
};
