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
import { getSavedSearchesCap } from "./savedSearches.js";
import { readSubscription } from "./usageService.js";

function getCapForCurrentPlan() {
  try {
    const sub = readSubscription();
    return getSavedSearchesCap(sub?.planId || "free");
  } catch {
    return getSavedSearchesCap("free");
  }
}

const LS_KEY = "datiq.saved";

// Decide whether an API error warrants a localStorage fallback.
// Covers: explicit useLocalStorage flag, 401/403/404/500/503, and network failures.
// 500 is included so unexpected Supabase/function errors fall back gracefully
// rather than surfacing a hard error to the user.
function shouldFallback(err) {
  return (
    err.useLocalStorage ||
    err.status === 401 || // no auth token
    err.status === 403 || // insufficient permissions
    err.status === 404 || // API endpoint not found (Netlify Functions not running)
    err.status === 500 || // unexpected server error — degrade gracefully
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
    console.warn("[DatIQ] listExtractions: API unavailable, using localStorage:", err.message);
    return local
      .read()
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((r) => ({ ...r, _saved: true }));
  }
}

/** Persist an extraction and notify the webhook. Returns the saved row. */
export async function saveExtraction(extraction) {
  // Strip batch-internal fields (added by runBatch). The schema does not
  // know about them and they would otherwise be sent to Supabase.
  const { _status, _error, ...clean } = extraction;

  // Q3 — saved-searches cap (free plan = 10, paid = unlimited). We allow
  // the save to proceed but flag the result so the UI can show a cap
  // warning. The Dashboard / preview decide what to do with the flag.
  const cap = getCapForCurrentPlan();
  const existingCount = (local.read() || []).filter((e) => e?.id !== clean.id).length;
  const wouldOverCap = cap !== Infinity && existingCount >= cap;
  if (wouldOverCap) {
    // Don't persist the new save; the UI will see _capHit=true and surface
    // the upgrade CTA. We still return a *result* so callers don't crash.
    notifyWebhook({ ...clean, _capHit: true, _cap: cap });
    return { ...clean, _saved: false, _capHit: true, _cap: cap };
  }

  try {
    const saved = await apiClient.createExtraction(clean);
    const result = { ...saved, _saved: true };
    local.upsert(result); // mirror locally for offline access
    notifyWebhook(result);
    return result;
  } catch (err) {
    if (shouldFallback(err)) {
      // localStorage fallback when Supabase is not configured.
      const saved = {
        ...clean,
        id: clean.id || uid(),
        created_at: clean.created_at || new Date().toISOString(),
        _saved: true,
      };
      local.upsert(saved);
      notifyWebhook(saved);
      return saved;
    }
    throw err;
  }
}

/**
 * Persist a scheduled-run extraction to the Dashboard. Strips paste-only and
 * batch-status fields and never sends extra columns to Supabase — the
 * "scheduled" categorisation is tracked client-side (batchRunsService), the same
 * schema-free approach batch runs use. Returns the saved row.
 */
export async function saveScheduledExtraction(structure, schedule) {
  const { _status, _error, is_pasted, raw_text, ...clean } = structure;
  const record = {
    ...clean,
    id: uid(),
    created_at: new Date().toISOString(),
    ai_summary: structure.ai_summary || `Scheduled run · ${schedule.label}`,
  };
  return saveExtraction(record);
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
