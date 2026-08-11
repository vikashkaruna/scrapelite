// netlify/functions/lib/zapierEventStore.js
//
// Event log for the Zapier integration. Triggers ("new_extraction",
// "new_enrichment", "monitoring_alert") append rows here when they fire;
// Zapier polls /api/integrations/zapier/poll and reads any new rows since
// the last poll.
//
// Schema (see supabase/migrations/0021_zapier_events.sql):
//   create table public.zapier_events (
//     id          uuid primary key default gen_random_uuid(),
//     user_id     uuid not null references auth.users,
//     event_type  text not null,    -- 'new_extraction' | 'new_enrichment' | 'monitoring_alert'
//     payload     jsonb not null,   -- the actual event body
//     created_at  timestamptz not null default now(),
//     dedupe_key  text             -- optional: caller-supplied idempotency key
//   );
//   unique (user_id, event_type, dedupe_key) when dedupe_key is set.
//
// Polling is "give me events for this user since timestamp T" — we
// deliberately don't expose a per-event delete; rows stay around so
// debugging a missed Zap is straightforward. A nightly cron can prune
// events older than 30 days.

function getServiceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

/**
 * Append an event to the log. The (user_id, event_type, dedupe_key) unique
 * index makes this safe to retry: a duplicate insert is silently ignored.
 */
export async function appendEvent({ userId, eventType, payload, dedupeKey }, { db, env, fetchFn } = {}) {
  const d = db || getServiceDb(env);
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!d || !f) return { ok: false, error: "unavailable" };
  if (!userId || !eventType) return { ok: false, error: "missing_args" };
  const row = {
    user_id: userId,
    event_type: eventType,
    payload: payload || {},
    dedupe_key: dedupeKey || null,
  };
  try {
    const res = await f(`${d.base}/zapier_events`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
}

/**
 * Poll for events since a timestamp. Default cursor = "epoch" (give me
 * everything). The cursor is the ISO timestamp of the LAST event the
 * caller saw; we return rows strictly newer than that.
 */
export async function pollEvents({ userId, eventType, since, limit = 25 }, { db, env, fetchFn } = {}) {
  const d = db || getServiceDb(env);
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!d || !f) return { ok: false, error: "unavailable" };
  if (!userId) return { ok: false, error: "missing_user" };
  const filters = [`user_id=eq.${userId}`];
  if (eventType) filters.push(`event_type=eq.${encodeURIComponent(eventType)}`);
  if (since) filters.push(`created_at=gt.${encodeURIComponent(since)}`);
  filters.push("select=id,event_type,payload,created_at,dedupe_key");
  filters.push("order=created_at.asc");
  filters.push(`limit=${Math.min(parseInt(limit, 10) || 25, 100)}`);
  const qs = filters.join("&");
  try {
    const res = await f(`${d.base}/zapier_events?${qs}`, { headers: d.headers });
    if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
    const rows = await res.json();
    return { ok: true, events: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
}

export const _internal = { getServiceDb };
