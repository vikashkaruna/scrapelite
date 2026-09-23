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
  updateWatchlist,
  deleteWatchlist,
  recordFieldChange,
  submitChangeFeedback,
  serviceDb,
} from "./lib/watchlistStore.js";
// The SAME differ the @hourly cron runs. A "check now" that used a second
// implementation would eventually disagree with the scheduled run, and a diff
// that disagrees with itself makes every alert noise — the reasoning
// watchlist-monitor.js already applies to sharing one evaluator.
import { _internal as monitorInternals } from "./watchlist-monitor.js";
import { chargeLedger } from "./lib/templateStore.js";
import { createDeadline } from "./lib/audit/deadline.js";

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

  if (action === "update") {
    const { watchlistId, name, description, cadence, domains } = body;
    if (!watchlistId) return json(400, { error: "watchlistId is required." });
    if (!(await assertWatchlistOwner(watchlistId, userId))) {
      return json(404, { error: "Watchlist not found" });
    }
    const res = await updateWatchlist(userId, watchlistId, { name, description, cadence, domains });
    if (!res.ok) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "delete") {
    const { watchlistId } = body;
    if (!watchlistId) return json(400, { error: "watchlistId is required." });
    if (!(await assertWatchlistOwner(watchlistId, userId))) {
      return json(404, { error: "Watchlist not found" });
    }
    const res = await deleteWatchlist(userId, watchlistId);
    if (!res.ok) return json(res.status || 400, { error: res.reason });
    return json(200, res);
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

  // ── CHECK NOW ─────────────────────────────────────────────────────────────
  // Replaces "Simulate Delta", which INSERTED A FABRICATED CHANGE
  // ($49/mo → $79/mo) into the user's real change feed via record_change. That
  // is invented competitor movement sitting in the same list as observed
  // movement, indistinguishable once written, in the feed a RevOps user acts
  // on. This repo has already had to undo exactly that shape twice (fixture
  // prose badged ai_generated; firmographics invented from a domain string).
  // A preview that fabricates is worse than no preview.
  if (action === "run_now") {
    const { watchlistId } = body;
    if (!watchlistId) return json(400, { error: "watchlistId is required." });

    // 404 not 403, so ids cannot be enumerated by probing — same rule as
    // record_change directly below.
    if (!(await assertWatchlistOwner(watchlistId, userId))) {
      return json(404, { error: "Watchlist not found" });
    }

    const wl = await getWatchlist(watchlistId, userId);
    if (!wl) return json(404, { error: "Watchlist not found" });
    const targets = wl.targets || [];
    if (targets.length === 0) {
      return json(200, { ok: true, checked: 0, changes: 0, note: "This watchlist has no competitors to check yet." });
    }

    const db = serviceDb();
    if (!db) return json(503, { error: "Monitoring is not configured.", code: "not_configured" });

    // Budgeted from the REQUEST, like every other synchronous path here. The
    // cron gets RUN_BUDGET_MS across a whole sweep; one user waiting on one
    // watchlist gets less, and a target that does not fit is left for the
    // scheduled run rather than taking the request down.
    const deadline = createDeadline(Number(process.env.WATCHLIST_NOW_BUDGET_MS) || 18_000);
    const deadlineAt = deadline.startedAt + deadline.totalMs;

    const totals = { checked: 0, pages: 0, changes: 0, discovered: 0, skipped: 0, errors: [] };
    for (const target of targets) {
      if (deadline.expired()) { totals.skipped += 1; continue; }
      try {
        const sres = await monitorInternals.processTarget(db, wl, target, deadlineAt);
        totals.checked += 1;
        totals.pages += sres.pages;
        totals.changes += sres.changes;
        totals.discovered += sres.discovered || 0;
        if (sres.errors?.length) totals.errors.push(...sres.errors.slice(0, 2));

        // Charged for pages actually READ, exactly as the cron does — a target
        // we could not fetch costs nothing.
        if (sres.pages > 0) {
          try {
            await chargeLedger([{
              user_id: userId,
              reason: "monitor_check",
              unit: "monitor_check",
              credits: sres.pages,
              quantity: sres.pages,
              metadata: { watchlist_id: wl.id, target_id: target.id, domain: target.domain, on_demand: true },
            }]);
          } catch (e) {
            // Bookkeeping never breaks the job — same rule as withJobRun.
            totals.errors.push(`ledger: ${e.message}`);
          }
        }
      } catch (e) {
        totals.errors.push(`${target.domain}: ${e.message}`);
      }
    }

    return json(200, { ok: true, ...totals });
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
