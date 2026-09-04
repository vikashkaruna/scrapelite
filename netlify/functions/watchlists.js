// netlify/functions/watchlists.js — PRD 4 Competitor Watchlists API.
//
// Endpoints:
//   GET  /api/watchlists                  → list user watchlists
//   GET  /api/watchlists?watchlistId=<id> → single watchlist with targets & changes
//   POST /api/watchlists { action: "create", name, description, cadence, domains }
//   POST /api/watchlists { action: "record_change", watchlistId, targetId, ... }
//   POST /api/watchlists { action: "feedback", fieldChangeId, feedback, notes }

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { resolveRequestEntitlement, checkCapability, denyResponse } from "./lib/requireEntitlement.js";
import {
  assertWatchlistOwner,
  listWatchlists,
  getWatchlist,
  createWatchlist,
  recordFieldChange,
  submitChangeFeedback,
} from "./lib/watchlistStore.js";

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
    console.error("[watchlists] unhandled error:", e);
    return json(500, { error: e.message || "Watchlist operation failed." });
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};
  // Auth failure refuses. Previously it fell through with userId=null, and the
  // store then ran a service-key query with no owner filter — returning every
  // tenant's competitor watchlists to an unauthenticated caller.
  const auth = await authenticateBearer(event, { label: "watchlists" });
  if (!auth.ok) return json(auth.status, auth.body);
  const userId = auth.user.id;

  if (qs.watchlistId) {
    const wl = await getWatchlist(qs.watchlistId, userId);
    if (!wl) return json(404, { error: "Watchlist not found" });
    return json(200, { watchlist: wl });
  }

  const res = await listWatchlists(userId);
  return json(200, res);
}

async function handlePost(event) {
  const auth = await authenticateBearer(event, { label: "watchlists" });
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
    const { name, description, cadence, domains } = body;
    if (!name?.trim()) return json(400, { error: "Watchlist name is required." });

    // A watchlist is a recurring monitor, so it spends the scheduled-monitoring
    // allowance. Counted from the rows themselves rather than a counter column,
    // for the reason discoverability audits already document: a counter that
    // drifts from what it counts eventually bills someone for work not there.
    const existing = await listWatchlists(userId);
    const resolved = await resolveRequestEntitlement(event);
    const gate = checkCapability(resolved, "watchlist.create", {
      watchlistCount: (existing.watchlists || []).length,
    });
    if (!gate.allowed) return denyResponse(gate, CORS);

    const res = await createWatchlist(userId, { name, description, cadence, domains });
    if (!res.ok) return json(res.status || 400, { error: res.reason });
    return json(201, res);
  }

  if (action === "record_change") {
    const { watchlistId, targetId, targetDomain, field, category, oldValue, newValue } = body;
    if (!watchlistId || !targetId || !field) {
      return json(400, { error: "Missing required fields for recording change." });
    }

    // `field_changes` hangs off a watchlist and carries no user_id of its own,
    // so ownership has to be proven here. Without this, any caller who knew or
    // guessed a watchlist id could inject fabricated "competitor changes" into
    // another tenant's intelligence feed — the alerts they act on.
    // 404, not 403, so watchlist ids cannot be enumerated by probing.
    if (!(await assertWatchlistOwner(watchlistId, userId))) {
      return json(404, { error: "Watchlist not found" });
    }

    const res = await recordFieldChange(watchlistId, targetId, {
      targetDomain,
      field,
      category,
      oldValue,
      newValue,
    });
    return json(200, res);
  }

  if (action === "feedback") {
    const { fieldChangeId, feedback, notes } = body;
    if (!fieldChangeId || !feedback) {
      return json(400, { error: "fieldChangeId and feedback are required." });
    }
    const res = await submitChangeFeedback(userId, { fieldChangeId, feedback, notes });
    return json(200, res);
  }

  return json(400, { error: `Unknown action: ${action}` });
}
