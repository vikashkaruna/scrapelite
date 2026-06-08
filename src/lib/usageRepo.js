// usageRepo.js — Supabase sync layer for usage records.
// localStorage is the primary store; Supabase is synced asynchronously.
// Falls back silently when Supabase isn't configured.

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

const SESSION_KEY = "scrapelite.sessionId";

export function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch { return "anonymous"; }
}

// Upsert this month's usage to Supabase.
export async function syncUsageToDb(usage, planId) {
  if (!isSupabaseEnabled || !supabase) return;
  const sessionId = getSessionId();
  try {
    await supabase
      .from("usage_records")
      .upsert(
        {
          session_id:  sessionId,
          month:       usage.month,
          extractions: usage.extractions,
          enrichments: Object.values(usage.enrichments ?? {}).reduce((s, v) => s + v, 0),
          plan_id:     planId,
          updated_at:  new Date().toISOString(),
        },
        { onConflict: "session_id,month" }
      );
  } catch (err) {
    console.warn("[ScrapeLite] Usage DB sync failed:", err?.message ?? err);
  }
}

// Fetch this month's usage from Supabase (used on first load to hydrate state).
export async function fetchUsageFromDb(month) {
  if (!isSupabaseEnabled || !supabase) return null;
  const sessionId = getSessionId();
  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select("*")
      .eq("session_id", sessionId)
      .eq("month", month)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Alert preferences ─────────────────────────────────────────────────────────
export async function syncAlertsToDb(alertConfig) {
  if (!isSupabaseEnabled || !supabase || !alertConfig.email) return;
  const sessionId = getSessionId();
  try {
    await supabase
      .from("usage_alerts")
      .upsert(
        {
          session_id:   sessionId,
          email:        alertConfig.email,
          thresholds:   alertConfig.thresholds ?? [80, 95],
          enabled:      alertConfig.enabled ?? true,
        },
        { onConflict: "session_id" }
      );
  } catch (err) {
    console.warn("[ScrapeLite] Alert config sync failed:", err?.message ?? err);
  }
}

// ── Admin: all users' usage (for the admin revenue dashboard) ─────────────────
export async function fetchAllUsageFromDb(month) {
  if (!isSupabaseEnabled || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select("*")
      .eq("month", month);
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}
