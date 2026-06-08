// extractionsRepo.js — persistence for saved extractions.
//
// Architecture (V2 API layer):
//   UI → extractionsRepo → /api/extractions (Netlify Function) → Supabase
//
// The Supabase client is no longer imported in the browser. All DB operations
// go through the server-side function, which can use a service-role key if
// needed and handles the V2 column migration retry internally.
//
// localStorage remains as a browser-side fallback:
//   - When Supabase is not configured (function returns 503 + useLocalStorage)
//   - As a local cache / offline backup alongside Supabase

import { apiClient } from "./apiClient.js";
import { notifyWebhook } from "./webhook.js";
import { uid } from "./utils.js";

const LS_KEY = "scrapelite.saved";

// Decide whether an API error warrants a localStorage fallback.
// Covers: explicit useLocalStorage flag, 401/403 (no/invalid auth),
// 503 (Supabase not configured), and network-level failures (no status,
// e.g. Netlify Functions not running in vite preview mode).
function shouldFallback(err) {
  return (
    err.useLocalStorage ||
    err.status === 401 || // no auth token
    err.status === 403 || // insufficient permissions
    err.status === 404 || // API endpoint not found (Netlify Functions not running)
    err.status === 503 || // Supabase not configured
    !err.status // network-level failure
  );
}

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
  upsert(item) {
    const items = this.read().filter((x) => x.id !== item.id);
    this.write([item, ...items]);
  },
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

/** List saved extractions, newest first. */
export async function listExtractions() {
  try {
    const data = await apiClient.listExtractions();
    return (data || []).map((r) => ({ ...r, _saved: true }));
  } catch (err) {
    // Read is always safe to degrade — any API failure falls back to localStorage.
    // Writes (save/delete) remain strict and surface errors to the user.
    console.warn("[ScrapeLite] listExtractions: API unavailable, using localStorage:", err.message);
    return local
      .read()
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((r) => ({ ...r, _saved: true }));
  }
}

/** Persist an extraction and notify the webhook. Returns the saved row. */
export async function saveExtraction(extraction) {
  try {
    const saved = await apiClient.createExtraction(extraction);
    const result = { ...saved, _saved: true };
    local.upsert(result); // mirror locally for offline access
    notifyWebhook(result);
    return result;
  } catch (err) {
    if (shouldFallback(err)) {
      // localStorage fallback when Supabase is not configured.
      const saved = {
        ...extraction,
        id: extraction.id || uid(),
        created_at: extraction.created_at || new Date().toISOString(),
        _saved: true,
      };
      local.upsert(saved);
      notifyWebhook(saved);
      return saved;
    }
    throw err;
  }
}

/** Sync just the enrichments map of an already-saved row (live Quick Enrichment). */
export async function updateEnrichments(id, enrichments) {
  if (!id) return;
  try {
    await apiClient.patchExtraction(id, { enrichments });
  } catch (err) {
    // Silently degrade: if Supabase is missing or the column isn't migrated,
    // localStorage below still keeps data in the current session.
    if (!shouldFallback(err)) throw err;
  }
  local.patch(id, { enrichments });
}

/** Delete a saved extraction by id. */
export async function deleteExtraction(id) {
  try {
    await apiClient.deleteExtraction(id);
  } catch (err) {
    if (!shouldFallback(err)) throw err;
  }
  local.remove(id);
}
