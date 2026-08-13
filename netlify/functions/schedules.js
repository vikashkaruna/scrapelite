// Netlify Function — Supabase CRUD for recurring extraction schedules.
//
// Architecture: UI → /api/schedules → this function → Supabase (RLS per-user)
//
// The client (schedulerService.js) owns the schedule shape and stores it whole
// in the `data` jsonb column; a few fields are promoted to real columns so the
// scheduled-runner can query "active + due" efficiently. Mirrors extractions.js:
//   - No auth token            → 401 { useLocalStorage: true } (browser keeps localStorage)
//   - Supabase not configured  → 503 { useLocalStorage: true }
//
// Required Supabase migration (run once — see CLAUDE.md):
//   create table if not exists public.scheduled_tasks (
//     id text primary key,
//     user_id uuid references auth.users,
//     status text default 'active',
//     cron text,
//     next_run_at timestamptz,
//     data jsonb not null,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );
//   alter table public.scheduled_tasks enable row level security;
//   create policy "users own schedules" on public.scheduled_tasks
//     for all to authenticated
//     using (auth.uid() = user_id) with check (auth.uid() = user_id);

import { denyResponse, requireCapability } from "./lib/requireEntitlement.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";

const TABLE = "scheduled_tasks";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

/**
 * Strip platform-owned fields out of the client-supplied schedule blob before
 * it is stored in the `data` jsonb column.
 *
 * The column REVOKE in 0015 protects the real `system_paused` COLUMN, but the
 * whole client object is also persisted as jsonb, and the runner and UI read
 * fields out of that blob — so a client could otherwise plant a lookalike
 * `system_paused: false` inside `data` and confuse anything reading it there.
 */
function sanitizeSchedule(schedule) {
  const { system_paused, systemPaused, system_pause_reason, systemPauseReason, user_id, userId, ...safe } =
    schedule || {};
  return safe;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) {
    return respond(401, { error: "Authentication required", useLocalStorage: true });
  }

  // See extractions.js — `getUser()` with no argument 401s on every request
  // under supabase-js v2.108+. The shared helper passes the JWT and separates
  // a bad session (401) from a misconfigured server (503).
  const auth = await authenticateBearer(event, { label: "schedules" });
  if (!auth.ok) {
    return respond(auth.status, { ...auth.body, useLocalStorage: true });
  }
  const supabase = auth.client;
  const userId = auth.user.id;
  const id = event.queryStringParameters?.id;
  const method = event.httpMethod;

  try {
    // ── LIST ──────────────────────────────────────────────────────────────────
    if (method === "GET") {
      const { data, error } = await supabase
        .from(TABLE)
        .select("id, data")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Return the client schedule shape (data blob), ensuring id is present.
      const rows = (data || []).map((r) => ({ ...(r.data || {}), id: r.id }));
      return respond(200, rows);
    }

    // ── UPSERT ────────────────────────────────────────────────────────────────
    if (method === "POST") {
      let schedule;
      try { schedule = JSON.parse(event.body || "{}"); }
      catch { return respond(400, { error: "Invalid JSON body" }); }
      if (!schedule.id) return respond(400, { error: "schedule.id required" });

      // Creating or resuming a schedule requires the capability. A lapsed
      // subscriber must not be able to re-arm automation by calling the API
      // directly; scheduled_monitoring is also plan-gated (Pro and above).
      const { check } = await requireCapability(event, "schedules");
      if (!check.allowed) return denyResponse(check, CORS);

      // EXPLICIT ALLOWLIST — do not go back to spreading the client object.
      //
      // This used to be `data: schedule` with `status: schedule.status`, i.e.
      // the browser dictated every column. Two consequences: a client could
      // write privileged fields, and once the lifecycle can system-pause a
      // lapsed user's schedules, the very next client upsert would silently
      // un-pause them. `system_paused` is additionally protected by a
      // column-level REVOKE in 0015_scheduler_hardening.sql — that is the part
      // an attacker cannot route around by calling PostgREST directly.
      const row = {
        id: schedule.id,
        user_id: userId,
        status: schedule.status === "paused" ? "paused" : "active",
        cron: String(schedule.cron || ""),
        next_run_at: schedule.nextRunAt || null,
        data: sanitizeSchedule(schedule),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from(TABLE)
        .upsert(row, { onConflict: "id" })
        .select("id, data")
        .single();
      if (error) throw error;
      return respond(200, { ...(data.data || {}), id: data.id });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!id) return respond(400, { error: "id query param required" });
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(405, { error: "Method not allowed" });
  } catch (err) {
    return respond(500, { error: err.message, code: err.code });
  }
};
