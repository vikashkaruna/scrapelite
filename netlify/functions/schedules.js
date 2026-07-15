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

import { createClient } from "@supabase/supabase-js";

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

function getSupabaseForUser(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) {
    return respond(401, { error: "Authentication required", useLocalStorage: true });
  }

  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) {
    return respond(503, { error: "Supabase not configured", useLocalStorage: true });
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return respond(401, { error: "Invalid or expired session.", useLocalStorage: true });
  }

  const userId = user.id;
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

      const row = {
        id: schedule.id,
        user_id: userId,
        status: schedule.status || "active",
        cron: schedule.cron || "",
        next_run_at: schedule.nextRunAt || null,
        data: schedule,
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
    console.error("[schedules] request failed", err);
    return respond(500, { error: "Unable to complete the schedule request right now." });
  }
};
