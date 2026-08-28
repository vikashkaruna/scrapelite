// usage-sync.js — the server-side write path usage_records/usage_alerts needed
// before their RLS could be locked down.
//
// ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
// src/lib/usageRepo.js used to call the Supabase JS client DIRECTLY from the
// browser with the anon key — for every visitor, guest or signed-in, since
// this whole subsystem is keyed on a client-generated `session_id`, not
// `user_id`. That only worked because 0001_core_tables_and_billing.sql gave
// both tables an `anon full access` policy: `for all using (true) with check
// (true)`. Anyone holding the public anon key (which ships in the browser
// bundle for every visitor) could read or write EVERY session's usage row,
// not just their own — a real privacy leak, though not an entitlement
// escalation, since nothing authorizes off these rows (see entitlementModel.js).
//
// 0014_billing_rls.sql locked `subscriptions`/`payment_events` the same way
// but deliberately left these two alone, with a comment saying exactly why:
// locking them would break guest usage sync until the writes moved behind a
// server function. This file is that function; 0034_usage_rls.sql is the
// migration that then locks the RLS.
//
// ── WHY THIS DOESN'T NEED AUTH ───────────────────────────────────────────────
// `session_id` was always the trust boundary here, not a login — a guest has
// no account to authenticate. This endpoint keeps that same boundary (a
// caller still names its own session_id in the body, exactly as the direct
// Supabase write did) — nothing here is a NEW trust decision. What changes is
// that the raw table is no longer reachable at all from a browser: only this
// endpoint, using the service key, can reach it, so a third party can no
// longer enumerate or tamper with every OTHER session's usage row by simply
// having the anon key (which every visitor's browser already has).

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

function sb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

function cleanSessionId(v) {
  const s = String(v || "").trim().slice(0, 100);
  return s || null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const db = sb();
  // Fails the same way the client-side call used to when Supabase wasn't
  // configured (isSupabaseEnabled was false → the old code silently no-op'd).
  // A caller here gets an explicit signal instead, and usageRepo.js's own
  // fetch wrapper treats any non-2xx as "sync unavailable, keep going".
  if (!db) return respond(200, { ok: false, reason: "supabase_not_configured" });

  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    const sessionId = cleanSessionId(params.sessionId);
    const month = String(params.month || "").trim().slice(0, 7);
    if (!sessionId || !month) return respond(400, { ok: false, error: "sessionId and month are required" });

    const res = await fetch(
      `${db.base}/usage_records?session_id=eq.${encodeURIComponent(sessionId)}&month=eq.${encodeURIComponent(month)}&limit=1`,
      { headers: db.headers },
    );
    if (!res.ok) return respond(200, { ok: false });
    const rows = await res.json().catch(() => []);
    return respond(200, { ok: true, row: rows?.[0] || null });
  }

  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

  const sessionId = cleanSessionId(body.sessionId);
  if (!sessionId) return respond(400, { ok: false, error: "sessionId is required" });

  if (body.type === "alert") {
    const email = String(body.email || "").trim().slice(0, 200);
    if (!email) return respond(400, { ok: false, error: "email is required" });
    const res = await fetch(`${db.base}/usage_alerts?on_conflict=session_id`, {
      method: "POST",
      headers: { ...db.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        session_id: sessionId,
        email,
        thresholds: Array.isArray(body.thresholds) ? body.thresholds : [80, 95],
        enabled: body.enabled !== false,
      }),
    });
    return respond(200, { ok: res.ok });
  }

  // Default: usage sync (matches usageRepo.js's syncUsageToDb shape).
  const month = String(body.month || "").trim().slice(0, 7);
  if (!month) return respond(400, { ok: false, error: "month is required" });
  const res = await fetch(`${db.base}/usage_records?on_conflict=session_id,month`, {
    method: "POST",
    headers: { ...db.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      session_id: sessionId,
      month,
      extractions: Number(body.extractions) || 0,
      enrichments: Number(body.enrichments) || 0,
      plan_id: body.planId ? String(body.planId).slice(0, 40) : "free",
      updated_at: new Date().toISOString(),
    }),
  });
  return respond(200, { ok: res.ok });
};
