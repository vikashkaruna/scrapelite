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
import { getSessionId } from "./usageRepo.js";
import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

function getCapForCurrentPlan() {
  try {
    const sub = readSubscription();
    return getSavedSearchesCap(sub?.planId || "free");
  } catch {
    return getSavedSearchesCap("free");
  }
}

// Identify the current "owner" of an extraction. Logged-in users get
// their auth user id; guests get a stable per-browser session id. The
// Recent Extractions widget on Home uses this to filter items so user A
// never sees user B's saved extractions on a shared device. Items that
// predate this change (no owner field) are hidden from the per-user
// widget — they still appear in the full Dashboard.
async function getOwnerId() {
  try {
    if (isSupabaseEnabled && supabase) {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) return { userId: data.user.id, sessionId: null };
    }
  } catch { /* fall through to sessionId */ }
  try {
    return { userId: null, sessionId: getSessionId() };
  } catch {
    return { userId: null, sessionId: "anonymous" };
  }
}

const LS_KEY = "datiq.saved";

// Decide whether an API error warrants a localStorage fallback.
// Covers: explicit useLocalStorage flag, 401/403/404/500/502/503/504, and
// network failures. 500 is included so unexpected Supabase/function errors
// fall back gracefully rather than surfacing a hard error to the user.
function shouldFallback(err) {
  return (
    err.useLocalStorage ||
    err.status === 401 || // no auth token
    err.status === 403 || // insufficient permissions
    err.status === 404 || // API endpoint not found (Netlify Functions not running)
    err.status === 500 || // unexpected server error — degrade gracefully
    err.status === 502 || // gateway can't reach the function (e.g. netlify dev not running locally)
    err.status === 503 || // Supabase not configured
    err.status === 504 || // gateway timeout reaching the function
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

function sortedLocalItems() {
  return local
    .read()
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => ({ ...r, _saved: true }));
}

/** List saved extractions, newest first. */
export async function listExtractions() {
  const localItems = sortedLocalItems();
  try {
    const data = await apiClient.listExtractions();
    const serverItems = (data || []).map((r) => ({ ...r, _saved: true }));
    // Merge rather than replace: an item saved while unauthenticated (or
    // one whose save fell back to localStorage) lives only in `local` and
    // never reaches this account's server rows. A legitimately-empty (or
    // partial) server response must not make those items vanish from the
    // full Dashboard, which — unlike the owner-filtered Home widget — is
    // documented to show every local item regardless of ownership.
    const serverIds = new Set(serverItems.map((r) => r.id));
    const localOnly = localItems.filter((r) => !serverIds.has(r.id));
    return [...serverItems, ...localOnly].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
  } catch (err) {
    // Read is always safe to degrade — any API failure falls back to localStorage.
    // Writes (save/delete) remain strict and surface errors to the user.
    console.warn("[DatIQ] listExtractions: API unavailable, using localStorage:", err.message);
    return localItems;
  }
}

/** Persist an extraction and notify the webhook. Returns the saved row. */
export async function saveExtraction(extraction) {
  // Strip batch-internal fields (added by runBatch). The schema does not
  // know about them and they would otherwise be sent to Supabase.
  const { _status, _error, ...clean } = extraction;

  // Attach the current owner (auth user id for signed-in users, per-browser
  // session id for guests) so the Recent Extractions widget on Home can
  // filter to the current user. Done before the cap check so the same
  // shape is returned whether or not the save proceeds.
  const owner = await getOwnerId();
  const owned = { ...clean, user_id: owner.userId, session_id: owner.sessionId };

  // Q3 — saved-searches cap (free plan = 10, paid = unlimited). We allow
  // the save to proceed but flag the result so the UI can show a cap
  // warning. The Dashboard / preview decide what to do with the flag.
  const cap = getCapForCurrentPlan();
  const existingCount = (local.read() || []).filter((e) => e?.id !== owned.id).length;
  const wouldOverCap = cap !== Infinity && existingCount >= cap;
  if (wouldOverCap) {
    // Don't persist the new save; the UI will see _capHit=true and surface
    // the upgrade CTA. We still return a *result* so callers don't crash.
    notifyWebhook({ ...owned, _capHit: true, _cap: cap });
    return { ...owned, _saved: false, _capHit: true, _cap: cap };
  }

  try {
    const saved = await apiClient.createExtraction(owned);
    const result = { ...saved, _saved: true };
    local.upsert(result); // mirror locally for offline access
    notifyWebhook(result);
    return result;
  } catch (err) {
    if (shouldFallback(err)) {
      // localStorage fallback when Supabase is not configured.
      const saved = {
        ...owned,
        id: owned.id || uid(),
        created_at: owned.created_at || new Date().toISOString(),
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
