// src/lib/analyticsService.js — Q11 (product analytics) pure logic.
//
// Records lifecycle events to the Supabase `analytics_events` table and falls
// back to localStorage when Supabase is not configured. The localStorage
// buffer is flushed opportunistically on a 5-min tick.
//
// Funnel stages we track (the canonical names Cloud BI called out):
//   activation   — first extraction completed
//   retention    — return visit (any extractions in a 7-day window)
//   extraction   — every successful extraction (success-extraction rate)
//   save         — every save-to-dashboard event (save conversion)
//   export       — every CSV/PDF/MD/JSON/email export (export conversion)
//   monitor      — every schedule creation (monitor conversion)
//   first_insight — first extraction (time-to-first-insight timestamp)

import { supabase } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";
import { apiClient } from "./apiClient.js";

export const ANALYTICS_TABLE = "analytics_events";
const LS_KEY = "datiq.analytics";
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Funnel-stage names — exported so analytics consumers can import them.
// Note: stage names match the *event name family*, so the ACTIVATION stage
// ("extraction") matches `extraction_success` and `extraction_failed` via
// the prefix check inside computeFunnel().
export const FUNNEL = Object.freeze({
  ACTIVATION:   "extraction",
  RETENTION:    "retention",
  EXTRACTION:   "extraction",
  SAVE:         "save",
  EXPORT:       "export",
  MONITOR:      "monitor",
  FIRST_INSIGHT:"first_insight",
});

// In-memory pending buffer (one-shot per page; persists to LS on flush).
let _pending = [];
let _flushTimer = null;

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function lsWrite(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(-2000))); } catch { /* skip */ }
}

function makeEvent({ name, properties = {}, userId = null, sessionId = null }) {
  return {
    name,
    properties,
    user_id: userId,
    session_id: sessionId || safeSessionId(),
    ts: new Date().toISOString(),
  };
}

function safeSessionId() {
  try { return getSessionId(); } catch { return "anon"; }
}

/**
 * Track a single event. Pushes onto the in-memory buffer and tries to flush.
 * Safe to call from any UI code — never throws.
 *
 * @param {string} name - the event name (e.g. "extraction_success")
 * @param {object} [properties] - extra key-value properties
 * @param {object} [opts] - { userId?: string, flushNow?: boolean }
 */
export async function track(name, properties = {}, opts = {}) {
  try {
    const event = makeEvent({ name, properties, userId: opts.userId });
    _pending.push(event);
    if (opts.flushNow) {
      return flush();
    }
    scheduleFlush();
    return { ok: true, queued: true };
  } catch (err) {
    // Tracking must never break the user flow.
    if (typeof console !== "undefined") console.warn("[DatIQ analytics] track failed:", err);
    return { ok: false, error: String(err) };
  }
}

function scheduleFlush() {
  if (_flushTimer) return;
  if (typeof window === "undefined") return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flush().catch(() => { /* swallow */ });
  }, FLUSH_INTERVAL_MS);
}

/**
 * Flush the pending buffer to Supabase (or to localStorage on failure).
 * Returns the number of events successfully persisted.
 */
export async function flush() {
  if (_pending.length === 0) {
    // Even with an empty buffer, opportunistically merge LS buffer in.
    const lsBuf = lsRead();
    if (lsBuf.length > 0 && isIngestAvailable()) {
      _pending = lsBuf.concat(_pending);
    } else {
      return 0;
    }
  }
  const events = _pending.slice();
  _pending = [];

  if (!isIngestAvailable()) {
    // localStorage fallback
    const existing = lsRead();
    lsWrite(existing.concat(events));
    return events.length;
  }
  try {
    const rows = events.map((e) => ({
      name: e.name,
      properties: e.properties,
      // user_id is sent for shape compatibility only — the server IGNORES it
      // and resolves the real user from the JWT. See netlify/functions/analytics.js.
      user_id: e.user_id,
      session_id: e.session_id,
      ts: e.ts,
    }));
    await apiClient.recordAnalytics({ events: rows });
    return events.length;
  } catch (err) {
    // Persist to localStorage so we don't lose the events.
    const existing = lsRead();
    lsWrite(existing.concat(events));
    if (typeof console !== "undefined") console.warn("[DatIQ analytics] flush failed:", err);
    return 0;
  }
}

// Events used to go straight from the browser into Supabase with the anon key.
// That required an `insert with check (true)` RLS policy, and 0005 paired it
// with `select using (true)` — so the whole event log was readable by anyone
// holding the published anon key. 0024_analytics_rls.sql drops both policies
// and POST /api/analytics (service key) is now the only write path.
//
// The gate is still `supabase` being configured, because that is the same
// signal the endpoint itself checks: with no Supabase there is nowhere for the
// events to land, and buffering to localStorage is the correct behaviour.
function isIngestAvailable() {
  return !!supabase;
}

// ── Flush on the way out ──────────────────────────────────────────────────
// The 5-minute timer alone loses every event from a visitor who leaves sooner,
// which is most of them: the buffer is in memory, so it goes with the tab.
// `visibilitychange` is the reliable signal (Safari and mobile browsers may
// never fire `pagehide`/`beforeunload`), and sendBeacon is the only transport
// guaranteed to survive the teardown.
function flushBeacon() {
  try {
    if (_pending.length === 0) return;
    const events = _pending.slice();
    _pending = [];

    if (!isIngestAvailable() || typeof navigator === "undefined" || !navigator.sendBeacon) {
      lsWrite(lsRead().concat(events));
      return;
    }
    const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
    const sent = navigator.sendBeacon("/api/analytics", blob);
    // sendBeacon cannot carry the Authorization header, so these land as
    // anonymous rows. That is an acceptable trade for not losing them —
    // session_id still ties the events together for funnel purposes.
    if (!sent) lsWrite(lsRead().concat(events));
  } catch {
    /* never throw during teardown */
  }
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBeacon();
  });
}

// ── Funnel queries ────────────────────────────────────────────────────────────

/**
 * Compute funnel conversion rates for the given events. Pure function over a
 * flat events array (so tests don't need a Supabase).
 *
 * @param {Array<{name:string,ts?:string,user_id?:string,session_id?:string}>} events
 * @param {object} [opts] - { windowMs?: number }
 * @returns {{
 *   stages: { name: string, count: number, conversionFromFirst: number }[],
 *   activationRate: number,        // % of sessions that did an activation event
 *   saveConversion: number,        // % of activation sessions that saved
 *   exportConversion: number,      // % of activation sessions that exported
 *   monitorConversion: number,     // % of activation sessions that scheduled
 *   avgTimeToFirstInsightMs: number|null,
 * }}
 */
export function computeFunnel(events, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const sessionId = (e) => e.session_id || "anon";
  const sessions = new Set(list.map(sessionId));

  // Stages in canonical order. Counts are unique sessions.
  // "extraction" (ACTIVATION) matches any event starting with "extraction_"
  // — so extraction_success and extraction_failed both count as activation.
  // "first_insight" events also count as ACTIVATION (they represent the
  // first extraction timestamp we know about).
  const STAGE_NAMES = [
    FUNNEL.ACTIVATION,    // extraction_success / extraction_failed / first_insight
    FUNNEL.SAVE,          // any save event
    FUNNEL.EXPORT,        // any export
    FUNNEL.MONITOR,       // any schedule
  ];
  const stageCounts = STAGE_NAMES.map((stage) => {
    const set = new Set();
    for (const e of list) {
      const n = e.name || "";
      const matchesStage =
        n === stage ||
        n.startsWith(stage + "_") ||
        (stage === FUNNEL.ACTIVATION && n === FUNNEL.FIRST_INSIGHT);
      if (matchesStage) set.add(sessionId(e));
    }
    return { name: stage, count: set.size };
  });
  const firstStageCount = stageCounts[0]?.count || 0;
  const stages = stageCounts.map((s) => ({
    ...s,
    conversionFromFirst: firstStageCount > 0 ? s.count / firstStageCount : 0,
  }));

  const activationRate = sessions.size > 0
    ? stageCounts[0].count / sessions.size
    : 0;

  // Time-to-first-insight: the gap between a session's first NON-insight
  // event (i.e. session start = first page_view / signup / etc.) and its
  // first first_insight or extraction event. If a session has no non-insight
  // start (or its first event is already the insight), we can't compute —
  // return null.
  const firstStartBySession = new Map();   // earliest non-insight event per session
  for (const e of list) {
    if (!e.ts) continue;
    const n = e.name || "";
    const isInsight = n === FUNNEL.FIRST_INSIGHT || n.startsWith("extraction_");
    if (isInsight) continue;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    const sid = sessionId(e);
    const cur = firstStartBySession.get(sid);
    if (cur === undefined || t < cur) firstStartBySession.set(sid, t);
  }
  const firstInsightBySession = new Map();
  for (const e of list) {
    if (!e.ts) continue;
    const n = e.name || "";
    const isInsight = n === FUNNEL.FIRST_INSIGHT || n.startsWith("extraction_");
    if (!isInsight) continue;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    const sid = sessionId(e);
    const cur = firstInsightBySession.get(sid);
    if (cur === undefined || t < cur) firstInsightBySession.set(sid, t);
  }
  const deltas = [];
  for (const [sid, insight] of firstInsightBySession) {
    const start = firstStartBySession.get(sid);
    if (start !== undefined && insight >= start) deltas.push(insight - start);
  }
  const avgTimeToFirstInsightMs = deltas.length > 0
    ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
    : null;

  return {
    stages,
    activationRate,
    saveConversion:      firstStageCount > 0 ? stageCounts[1].count / firstStageCount : 0,
    exportConversion:    firstStageCount > 0 ? stageCounts[2].count / firstStageCount : 0,
    monitorConversion:   firstStageCount > 0 ? stageCounts[3].count / firstStageCount : 0,
    avgTimeToFirstInsightMs,
  };
}

// ── One-call lifecycle helpers ────────────────────────────────────────────────

export const lifecycle = {
  extractionSucceeded(properties) { return track("extraction_success", properties); },
  extractionFailed(properties)    { return track("extraction_failed", properties); },
  saved(properties)               { return track(FUNNEL.SAVE, properties); },
  exported(properties)            { return track(FUNNEL.EXPORT, properties); },
  monitorCreated(properties)      { return track(FUNNEL.MONITOR, properties); },
  firstInsight(properties)        { return track(FUNNEL.FIRST_INSIGHT, properties); },
  pageView(properties)            { return track("page_view", properties); },
};

// Stop the flush timer (used in tests to prevent open handles).
export function _resetForTests() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  _pending = [];
}
