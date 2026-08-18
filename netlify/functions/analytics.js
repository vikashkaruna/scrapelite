// netlify/functions/analytics.js
//
// Server-side ingest for the in-house event log.
//
// ── Why this exists ──────────────────────────────────────────────────────
// The browser used to INSERT into public.analytics_events directly with the
// anon key, which required an `insert with check (true)` policy — and 0005
// paired it with `select using (true)`, making the entire behavioural log of
// every visitor readable by anyone who opened the JS bundle and copied the
// key. 0024_analytics_rls.sql drops both policies; this endpoint is the
// replacement write path, using the service key server-side.
//
//   POST /api/analytics   Body: { events: [ { name, properties?, session_id, ts? } ] }
//
// user_id is resolved from the Authorization JWT when present and is NEVER
// read from the body — otherwise any client could attribute events to any
// account, poisoning the funnel and, worse, planting rows that a later
// "erase my data" request would then delete from the wrong person.
//
// Failure posture: this endpoint never matters more than the user's actual
// work. Every error path returns a shape analyticsService can treat as "retry
// later", and the client keeps its localStorage buffer either way.

import { authenticateBearer } from "./lib/supabaseServerClient.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A single flush carries at most a few dozen events. The cap is a blast-radius
// limit on a hostile or looping client, not a tuning knob.
const MAX_EVENTS = 200;
const MAX_NAME = 120;
const MAX_SESSION = 128;
// jsonb has no practical size limit, which is precisely why one is imposed
// here — an unbounded `properties` blob is an unbounded storage bill.
const MAX_PROPERTIES_BYTES = 8 * 1024;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function readJsonBody(event) {
  if (!event?.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isIsoish(v) {
  if (typeof v !== "string" || v.length > 40) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

/**
 * Keep the well-formed events, drop the rest. Deliberately lenient: a single
 * malformed event should not cost the caller its whole batch, because the
 * client's only recovery is to re-send the same batch forever.
 */
function sanitize(events, userId) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== "object") continue;

    const name = typeof e.name === "string" ? e.name.trim().slice(0, MAX_NAME) : "";
    if (!name) continue;

    const sessionId =
      typeof e.session_id === "string" ? e.session_id.trim().slice(0, MAX_SESSION) : "";
    if (!sessionId) continue; // session_id is NOT NULL in the schema

    let properties = e.properties;
    if (properties == null || typeof properties !== "object" || Array.isArray(properties)) {
      properties = {};
    }
    try {
      if (JSON.stringify(properties).length > MAX_PROPERTIES_BYTES) properties = { _truncated: true };
    } catch {
      properties = {}; // circular or non-serialisable
    }

    out.push({
      name,
      properties,
      // Server-resolved only. See the header note.
      user_id: userId,
      session_id: sessionId,
      // A client clock can be wrong or hostile; fall back to server time.
      ts: isIsoish(e.ts) ? e.ts : new Date().toISOString(),
    });
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    // Not an error the visitor caused or can fix. 200 so the client stops
    // retrying a batch that can never land, and keeps its localStorage copy.
    return respond(200, { ok: true, stored: 0, reason: "service_db_unconfigured" });
  }

  // Anonymous events are expected and allowed — most traffic is signed out.
  let userId = null;
  if (event.headers?.authorization || event.headers?.Authorization) {
    const auth = await authenticateBearer(event, { label: "analytics" });
    if (auth.ok) userId = auth.user?.id || null;
    // A rejected token is NOT fatal: the events are still valid anonymous
    // ones, and refusing them would silently lose data whenever a session
    // expired mid-visit.
  }

  const body = readJsonBody(event);
  const rows = sanitize(body.events, userId);
  if (rows.length === 0) return respond(200, { ok: true, stored: 0 });

  try {
    const res = await fetch(`${url}/rest/v1/analytics_events`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[analytics] insert failed", res.status, detail.slice(0, 300));
      return respond(502, { error: `Insert failed (${res.status})` });
    }
    return respond(200, { ok: true, stored: rows.length });
  } catch (err) {
    console.error("[analytics] insert threw", err?.message);
    return respond(502, { error: "Insert failed" });
  }
};
