// usageRepo.js — sync layer for usage records.
// localStorage is the primary store; the server is synced asynchronously via
// /api/usage-sync, never Supabase directly.
//
// This used to call the Supabase JS client directly from the browser with the
// anon key — for every visitor, guest or signed-in, since this whole
// subsystem is keyed on a client-generated session_id, not user_id. That was
// only possible because usage_records/usage_alerts carried an `anon full
// access` RLS policy, which let anyone holding the public anon key read or
// write EVERY session's row, not just their own. Routed through
// netlify/functions/usage-sync.js (service key only) so 0034_usage_rls.sql
// could lock the table down without breaking guest sync — see that
// function's header comment for the full reasoning.

const ENDPOINT = "/api/usage-sync";
const SESSION_KEY = "datiq.sessionId";

export function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch { return "anonymous"; }
}

// Upsert this month's usage to the server.
export async function syncUsageToDb(usage, planId) {
  const sessionId = getSessionId();
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        month: usage.month,
        extractions: usage.extractions,
        enrichments: Object.values(usage.enrichments ?? {}).reduce((s, v) => s + v, 0),
        planId,
      }),
    });
  } catch (err) {
    console.warn("[DatIQ] Usage DB sync failed:", err?.message ?? err);
  }
}

// Fetch this month's usage from the server (used on first load to hydrate state).
export async function fetchUsageFromDb(month) {
  const sessionId = getSessionId();
  try {
    const res = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&month=${encodeURIComponent(month)}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.ok ? data.row : null;
  } catch {
    return null;
  }
}

// ── Alert preferences ─────────────────────────────────────────────────────────
export async function syncAlertsToDb(alertConfig) {
  if (!alertConfig.email) return;
  const sessionId = getSessionId();
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "alert",
        sessionId,
        email: alertConfig.email,
        thresholds: alertConfig.thresholds ?? [80, 95],
        enabled: alertConfig.enabled ?? true,
      }),
    });
  } catch (err) {
    console.warn("[DatIQ] Alert config sync failed:", err?.message ?? err);
  }
}
