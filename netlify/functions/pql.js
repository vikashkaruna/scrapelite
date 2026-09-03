// pql.js — activation event intake + PQL scoring.
//
//   POST /api/pql/events   { events: [{name, properties, occurredAt?}] }
//   POST /api/pql/score                              → recompute + store
//
// ── WHY THIS EXISTS INSTEAD OF REUSING analytics_events ────────────────────
// `analytics_events` (0005) is world-readable by design — `USING (true)` — on
// the stated grounds that it holds "non-PII, no user content". That was true
// of page views and a success/failure counter. It stops being true the moment
// an event carries `domain`, `templateKey` or `count`: those say WHICH
// COMPANIES a specific user researched and how many accounts they enriched.
// Publishing a recruiter's sourcing list to anyone holding the publishable key
// is not an analytics decision, it is a leak.
//
// So activation events go to `activation_events` (0040): service-key only, FK
// to auth.users, cascading on account deletion. `analytics_events` keeps its
// aggregate funnel role, unchanged.
//
// ── SIGNED-IN ONLY ─────────────────────────────────────────────────────────
// A PQL score is a claim about an ACCOUNT. An anonymous session is nobody to
// attribute one to, and can be re-made without limit — the same reasoning
// scrape consent and referrals already use. Guests are silently accepted and
// dropped rather than 401'd: analytics must never surface an error in a user
// flow, and a guest whose events are discarded has lost nothing they can see.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { serviceDb } from "./lib/templateStore.js";
import {
  scorePql, signalsFromEvents, PERSONA_TO_ACTIVATION,
} from "../../src/lib/pql/pqlModel.js";
import { conditionsFromEvents, ACTIVATION_EVENT_NAMES } from "../../src/lib/pql/activationEvents.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

const MAX_EVENTS_PER_CALL = 50;
const MAX_PROPERTY_BYTES = 4000;
// A score is computed from the account's whole history, but an unbounded read
// would grow without limit for a heavy user. 5k events is far past the point
// where any signal changes — every one of them saturates at a small count.
const MAX_EVENTS_SCANNED = 5000;

// Only names the vocabulary declares. An undeclared name can never be read by
// scoring, so storing it is pure noise in a table that cascades with an
// account — and accepting arbitrary client strings into a durable store is how
// a table becomes a dumping ground.
const VALID_NAMES = new Set(ACTIVATION_EVENT_NAMES);

function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, MAX_EVENTS_PER_CALL)) {
    if (!e || typeof e !== "object") continue;
    const name = String(e.name || "");
    if (!VALID_NAMES.has(name)) continue;
    let properties = e.properties && typeof e.properties === "object" && !Array.isArray(e.properties)
      ? e.properties : {};
    // Refuse an oversized blob rather than truncating it into something that
    // parses but means something else.
    if (JSON.stringify(properties).length > MAX_PROPERTY_BYTES) properties = {};
    const occurred = e.occurredAt ? new Date(e.occurredAt) : new Date();
    out.push({
      name,
      properties,
      occurred_at: Number.isFinite(occurred.getTime()) ? occurred.toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

/** Recompute and store one user's score. Exported for the scheduled job. */
export async function recomputeFor(db, userId, persona) {
  const { data, error } = await db
    .from("activation_events")
    .select("name, properties, occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: true })
    .limit(MAX_EVENTS_SCANNED);
  if (error) return { ok: false, reason: error.message };

  const events = (data || []).map((r) => ({ name: r.name, properties: r.properties, ts: r.occurred_at }));
  const signals = signalsFromEvents(events);
  const conditions = conditionsFromEvents(events);
  // `measurable` is left at the model's default (MEASURABLE_TODAY). That is
  // the honest answer for the product as it stands: two of the nine signals
  // have no source yet, and pretending otherwise would score every account as
  // if it had failed them.
  const result = scorePql(signals, { persona, conditions });

  const { data: verdict, error: rpcErr } = await db.rpc("record_pql_score", {
    p_user_id: userId,
    p_score: result.points,
    p_coverage: result.coverage,
    p_is_pql: result.isPql,
    p_activated: result.activated,
    p_persona: persona || null,
    p_signals: signals,
    p_excluded_signals: result.excluded,
  });
  if (rpcErr) return { ok: false, reason: rpcErr.message };
  return { ok: verdict === "ok", verdict, result, eventCount: events.length };
}

function resolveAction(event) {
  const path = String(event.path || "");
  const i = path.indexOf("/pql/");
  if (i >= 0) return path.slice(i + 5).split("?")[0].replace(/\/$/, "");
  return String(event.queryStringParameters?.action || "");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const action = resolveAction(event);

  const auth = await authenticateBearer(event, { label: "pql" });
  // Guests are accepted and dropped, never 401'd — see the header. Reporting
  // an auth error here would surface an analytics concern inside a user flow.
  if (!auth.ok) return json(200, { ok: true, recorded: 0, skipped: "not_signed_in" });

  const db = serviceDb();
  // Fail OPEN on infrastructure, exactly like requireEntitlement: a Supabase
  // blip must never surface in a flow the user is in the middle of. Scoring is
  // derived and recomputable, so a lost batch costs nothing permanent.
  if (!db) return json(200, { ok: true, recorded: 0, skipped: "not_configured" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  if (action === "events") {
    const rows = sanitizeEvents(body.events).map((r) => ({ ...r, user_id: auth.user.id }));
    if (!rows.length) return json(200, { ok: true, recorded: 0 });
    const { error } = await db.from("activation_events").insert(rows);
    if (error) {
      console.warn("[DatIQ] activation event insert failed:", error.message);
      return json(200, { ok: true, recorded: 0, degraded: true });
    }
    return json(200, { ok: true, recorded: rows.length });
  }

  if (action === "score") {
    const persona = PERSONA_TO_ACTIVATION[body.persona] ? body.persona : null;
    const r = await recomputeFor(db, auth.user.id, persona);
    if (!r.ok) return json(200, { ok: false, degraded: true, reason: r.reason });
    // The SCORE itself is deliberately not returned. It is a commercial
    // judgement about the user, read by /admin/revenue — a user must not be
    // able to discover how the product ranks them as a sales target, and an
    // endpoint they can call is the obvious place that would leak from.
    return json(200, { ok: true, computed: true, eventCount: r.eventCount });
  }

  return json(404, { error: `Unknown pql action '${action}'` });
};
