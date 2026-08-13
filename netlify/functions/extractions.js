// Netlify Function — Supabase CRUD for the extractions table, with per-user auth.
//
// Architecture: UI → /api/extractions → this function → Supabase (RLS applied)
//
// Auth flow:
//   - Browser sends Authorization: Bearer <supabase_jwt> (set by AuthProvider)
//   - This function creates a Supabase client with that JWT
//   - Supabase RLS policies enforce per-user data isolation automatically
//   - If no token: returns 401 { useLocalStorage: true } → browser uses localStorage
//   - If Supabase not configured: returns 503 { useLocalStorage: true }
//
// Required Supabase migration (run once in SQL editor):
//   alter table public.extractions add column if not exists user_id uuid references auth.users;
//   drop policy if exists "anon full access" on public.extractions;
//   create policy "users own extractions" on public.extractions
//     for all to authenticated
//     using (auth.uid() = user_id) with check (auth.uid() = user_id);

import { notifyExtractionComplete } from "./lib/notify.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";

const TABLE = "extractions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("column") &&
    (msg.includes("does not exist") || msg.includes("could not find")) &&
    (msg.includes("custom_extraction") ||
      msg.includes("domain_map") ||
      msg.includes("enrichments") ||
      msg.includes("user_id") ||
      msg.includes("schema cache"))
  );
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";

  // Require authentication for all DB operations.
  // No token → browser falls back to localStorage gracefully.
  if (!authHeader) {
    return respond(401, {
      error: "Authentication required",
      useLocalStorage: true,
    });
  }

  // Verify the token and get the authenticated user's ID. This used to call
  // `getUser()` with NO argument, which supabase-js v2.108+ rejects with
  // AuthSessionMissingError on a session-less server client — i.e. this
  // endpoint 401'd every authenticated request and silently pushed every user
  // onto the localStorage fallback. The shared helper passes the JWT
  // explicitly and tells a bad session (401) apart from a misconfigured
  // server (503).
  const auth = await authenticateBearer(event, { label: "extractions" });
  if (!auth.ok) {
    // useLocalStorage keeps the client's graceful degradation intact for
    // every failure mode, including the new 503.
    return respond(auth.status, { ...auth.body, useLocalStorage: true });
  }
  const supabase = auth.client;
  const userId = auth.user.id;
  const id = event.queryStringParameters?.id;
  const method = event.httpMethod;

  try {
    // ── LIST ───────────────────────────────────────────────────────────────────
    if (method === "GET") {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return respond(200, data || []);
    }

    // ── CREATE ─────────────────────────────────────────────────────────────────
    if (method === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON body" });
      }

      const {
        custom_extraction,
        domain_map,
        enrichments,
        _saved: _s,
        _demo: _d,
        _status: _st,
        _error: _er,
        ...base
      } = payload;

      const v2 = {};
      if (custom_extraction != null) v2.custom_extraction = custom_extraction;
      if (domain_map != null) v2.domain_map = domain_map;
      if (enrichments && Object.keys(enrichments).length) v2.enrichments = enrichments;

      const row = { ...base, ...v2, user_id: userId };

      let { data, error } = await supabase
        .from(TABLE)
        .insert(row)
        .select()
        .single();

      if (error && Object.keys(v2).length && isMissingColumnError(error)) {
        console.warn("[API/extractions] V2 columns not found; saving base fields only.");
        ({ data, error } = await supabase
          .from(TABLE)
          .insert({ ...base, user_id: userId })
          .select()
          .single());
      }

      if (error) throw error;
      // Fire-and-forget: fan out to the user's connected channels (Slack,
      // Zapier). notifyExtractionComplete swallows per-channel errors, so a
      // Slack outage can never break the save flow. We log but never await
      // in the request path — the user has their saved row already.
      notifyExtractionComplete({ userId, extraction: data }).catch((err) => {
        console.warn("[API/extractions] notifyExtractionComplete failed:", err?.message || err);
      });
      return respond(201, { ...v2, ...data });
    }

    // ── UPDATE (enrichments sync) ──────────────────────────────────────────────
    if (method === "PATCH") {
      if (!id) return respond(400, { error: "id query param required" });
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON body" });
      }
      const { error } = await supabase
        .from(TABLE)
        .update(body)
        .eq("id", id)
        .eq("user_id", userId); // extra safety: only update own rows
      if (error && !isMissingColumnError(error)) throw error;
      return respond(200, { ok: true });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!id) return respond(400, { error: "id query param required" });
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", userId); // only delete own rows
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(405, { error: "Method not allowed" });
  } catch (err) {
    return respond(500, { error: err.message, code: err.code });
  }
};
