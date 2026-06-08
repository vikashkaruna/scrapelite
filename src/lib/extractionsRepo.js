// extractionsRepo.js — persistence for saved extractions.
//
// Uses Supabase when configured; otherwise falls back to localStorage so the
// app is fully usable with zero setup. Same async API either way.

import { supabase, isSupabaseEnabled, EXTRACTIONS_TABLE } from "./supabaseClient.js";
import { notifyWebhook } from "./webhook.js";
import { uid } from "./utils.js";

const LS_KEY = "datiq.saved";

// ── localStorage backend ─────────────────────────────────────────────────────
const local = {
  read() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
  write(items) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota / private-mode errors */
    }
  },
  // Insert-or-replace a single extraction, newest first.
  upsert(item) {
    const items = this.read().filter((x) => x.id !== item.id);
    this.write([item, ...items]);
  },
  // Merge fields into an existing extraction (no-op if it isn't stored locally).
  patch(id, fields) {
    const items = this.read();
    const idx = items.findIndex((x) => x.id === id);
    if (idx === -1) return;
    items[idx] = { ...items[idx], ...fields };
    this.write(items);
  },
  remove(id) {
    this.write(this.read().filter((x) => x.id !== id));
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/** List saved extractions, newest first. Each row is tagged `_saved` so the app
 *  knows it's already persisted (and can sync later edits like enrichments). */
export async function listExtractions() {
  if (isSupabaseEnabled) {
    const { data, error } = await supabase
      .from(EXTRACTIONS_TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({ ...r, _saved: true }));
  }
  return local
    .read()
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => ({ ...r, _saved: true }));
}

// Postgres/PostgREST signals for "this column doesn't exist yet" — emitted when
// a V2 migration (custom_extraction / domain_map / enrichments) hasn't been run
// on the DB. Detecting them lets us write the V2 columns when present but degrade
// safely to the V1 schema otherwise, so an un-migrated database never breaks.
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

/** Persist an extraction and (optionally) notify the webhook. Returns the saved row. */
export async function saveExtraction(extraction) {
  // V1 base columns (always present).
  const base = {
    url: extraction.url,
    page_title: extraction.page_title,
    headings: extraction.headings,
    links: extraction.links,
    ai_summary: extraction.ai_summary,
  };
  // V2 columns — only included when the extraction actually carries them, so a
  // plain V1 extraction produces a byte-identical payload to before.
  const v2 = {};
  if (extraction.custom_extraction != null) v2.custom_extraction = extraction.custom_extraction;
  if (extraction.domain_map != null) v2.domain_map = extraction.domain_map;
  if (extraction.enrichments && Object.keys(extraction.enrichments).length)
    v2.enrichments = extraction.enrichments;
  const payload = { ...base, ...v2 };

  let saved;
  if (isSupabaseEnabled) {
    let { data, error } = await supabase
      .from(EXTRACTIONS_TABLE)
      .insert(payload)
      .select()
      .single();
    // If the V2 columns aren't in the schema yet, retry with V1-only columns so
    // the save still succeeds (the data is also mirrored to localStorage below).
    if (error && Object.keys(v2).length && isMissingColumnError(error)) {
      console.warn(
        "[DatIQ] V2 columns (custom_extraction/domain_map/enrichments) not found in " +
          "Supabase; saving base fields only. Run the V2 migration in README to persist them.",
      );
      ({ data, error } = await supabase
        .from(EXTRACTIONS_TABLE)
        .insert(base)
        .select()
        .single());
    }
    if (error) throw error;
    // Keep the V2 fields on the returned row for the current session even if the
    // DB couldn't store them, so the Preview/Dashboard still render them now.
    saved = { ...v2, ...data, _saved: true };
  } else {
    saved = {
      ...payload,
      id: extraction.id || uid(),
      created_at: extraction.created_at || new Date().toISOString(),
      _saved: true,
    };
  }

  // Always mirror the saved page contents into the browser (localStorage) so a
  // copy persists locally — backup against DB failures and usable offline.
  local.upsert(saved);

  notifyWebhook(saved); // fire-and-forget
  return saved;
}

/** Update just the enrichments map of an already-saved extraction (live sync of
 *  Quick Enrichment tabs). No-op if the row isn't persisted; degrades safely if
 *  the `enrichments` column hasn't been migrated yet. */
export async function updateEnrichments(id, enrichments) {
  if (!id) return;
  if (isSupabaseEnabled) {
    const { error } = await supabase
      .from(EXTRACTIONS_TABLE)
      .update({ enrichments })
      .eq("id", id);
    if (error && !isMissingColumnError(error)) throw error;
  }
  // Keep the browser copy in step too.
  local.patch(id, { enrichments });
}

/** Delete a saved extraction by id. */
export async function deleteExtraction(id) {
  if (isSupabaseEnabled) {
    const { error } = await supabase.from(EXTRACTIONS_TABLE).delete().eq("id", id);
    if (error) throw error;
  }
  // Keep the browser copy in sync regardless of backend.
  local.remove(id);
}
