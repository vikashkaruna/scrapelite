// Netlify Function — Supabase CRUD for the extractions table.
// Moving persistence server-side means the Supabase service-role key can be
// used here when needed, and the anon key is no longer required in the browser.
//
// GET    /api/extractions            → list all, newest first
// POST   /api/extractions            → insert one extraction
// PATCH  /api/extractions?id={id}   → update fields (used for enrichments sync)
// DELETE /api/extractions?id={id}   → delete one extraction
//
// Returns 503 { useLocalStorage: true } when Supabase is not configured so the
// browser can fall back to its localStorage path gracefully.

import { createClient } from "@supabase/supabase-js";

const TABLE = "extractions";

function getSupabase() {
  const url =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||  // preferred: service role (bypasses RLS)
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

// Detects errors caused by V2 columns (custom_extraction / domain_map /
// enrichments) not yet existing on the live DB. Allows a safe retry with only
// V1 columns so a non-migrated database never breaks saves.
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
      msg.includes("schema cache"))
  );
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return respond(503, {
      error: "Supabase not configured",
      useLocalStorage: true,
    });
  }

  const id = event.queryStringParameters?.id;
  const method = event.httpMethod;

  try {
    // ── LIST ─────────────────────────────────────────────────────────────────
    if (method === "GET") {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return respond(200, data || []);
    }

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (method === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON body" });
      }

      // Separate V1 and V2 columns so we can retry without V2 if the migration
      // hasn't been applied yet.
      const {
        custom_extraction,
        domain_map,
        enrichments,
        id: _id,       // never insert a client-supplied id
        _saved: _s,    // strip internal flags
        ...base
      } = payload;

      const v2 = {};
      if (custom_extraction != null) v2.custom_extraction = custom_extraction;
      if (domain_map != null) v2.domain_map = domain_map;
      if (enrichments && Object.keys(enrichments).length) {
        v2.enrichments = enrichments;
      }

      let { data, error } = await supabase
        .from(TABLE)
        .insert({ ...base, ...v2 })
        .select()
        .single();

      if (error && Object.keys(v2).length && isMissingColumnError(error)) {
        console.warn(
          "[API/extractions] V2 columns not found; saving base fields only. " +
            "Run the V2 migration from README to enable full persistence."
        );
        ({ data, error } = await supabase
          .from(TABLE)
          .insert(base)
          .select()
          .single());
      }

      if (error) throw error;
      // Return V2 fields on the response even if DB couldn't store them so the
      // current session still renders them.
      return respond(201, { ...v2, ...data });
    }

    // ── UPDATE (enrichments sync) ─────────────────────────────────────────────
    if (method === "PATCH") {
      if (!id) return respond(400, { error: "id query param required for PATCH" });
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON body" });
      }
      const { error } = await supabase
        .from(TABLE)
        .update(body)
        .eq("id", id);
      // Silently ignore missing-column errors for enrichments patch; caller
      // always also writes to localStorage.
      if (error && !isMissingColumnError(error)) throw error;
      return respond(200, { ok: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!id) return respond(400, { error: "id query param required for DELETE" });
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", id);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(405, { error: "Method not allowed" });
  } catch (err) {
    return respond(500, { error: err.message, code: err.code });
  }
};
