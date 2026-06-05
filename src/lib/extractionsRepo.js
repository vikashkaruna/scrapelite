// extractionsRepo.js — persistence for saved extractions.
//
// Uses Supabase when configured; otherwise falls back to localStorage so the
// app is fully usable with zero setup. Same async API either way.

import { supabase, isSupabaseEnabled, EXTRACTIONS_TABLE } from "./supabaseClient.js";
import { notifyWebhook } from "./webhook.js";
import { uid } from "./utils.js";

const LS_KEY = "scrapelite.saved";

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
};

// ── Public API ───────────────────────────────────────────────────────────────

/** List saved extractions, newest first. */
export async function listExtractions() {
  if (isSupabaseEnabled) {
    const { data, error } = await supabase
      .from(EXTRACTIONS_TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return local
    .read()
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** Persist an extraction and (optionally) notify the webhook. Returns the saved row. */
export async function saveExtraction(extraction) {
  const payload = {
    url: extraction.url,
    page_title: extraction.page_title,
    headings: extraction.headings,
    links: extraction.links,
    ai_summary: extraction.ai_summary,
  };

  let saved;
  if (isSupabaseEnabled) {
    const { data, error } = await supabase
      .from(EXTRACTIONS_TABLE)
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    saved = data;
  } else {
    saved = {
      ...payload,
      id: extraction.id || uid(),
      created_at: extraction.created_at || new Date().toISOString(),
    };
    const items = local.read().filter((x) => x.id !== saved.id);
    local.write([saved, ...items]);
  }

  notifyWebhook(saved); // fire-and-forget
  return saved;
}

/** Delete a saved extraction by id. */
export async function deleteExtraction(id) {
  if (isSupabaseEnabled) {
    const { error } = await supabase.from(EXTRACTIONS_TABLE).delete().eq("id", id);
    if (error) throw error;
    return;
  }
  local.write(local.read().filter((x) => x.id !== id));
}
