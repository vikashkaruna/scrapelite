// netlify/functions/lib/watchlistStore.js — Data access for Competitor Watchlists (PRD 4).
//
// Manages watchlists, targets, monitored pages, snapshots, field changes, and feedback.

import { createClient } from "@supabase/supabase-js";
import { normalizeDomain } from "../../src/lib/bulk/identityModel.js";
import { buildChangeRecord } from "../../src/lib/watchlist/materialityModel.js";

// In-memory mock storage for dev/test environments without live Supabase keys
const _localWatchlists = new Map();
const _localTargets = new Map();
const _localPages = new Map();
const _localSnapshots = new Map();
const _localChanges = new Map();
const _localFeedback = new Map();

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listWatchlists(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const list = Array.from(_localWatchlists.values()).filter((w) => !userId || w.user_id === userId);
    return { ok: true, watchlists: list };
  }

  let q = db.from("watchlists").select("*, watchlist_targets(count)").order("created_at", { ascending: false });
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message, watchlists: [] };
  return { ok: true, watchlists: data || [] };
}

export async function getWatchlist(watchlistId, userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const wl = _localWatchlists.get(watchlistId);
    if (!wl) return null;
    const targets = Array.from(_localTargets.values()).filter((t) => t.watchlist_id === watchlistId);
    const changes = Array.from(_localChanges.values()).filter((c) => c.watchlist_id === watchlistId);
    return { ...wl, targets, changes };
  }

  let q = db.from("watchlists").select("*").eq("id", watchlistId);
  if (userId) q = q.eq("user_id", userId);

  const { data: wl, error: wlErr } = await q.single();
  if (wlErr || !wl) return null;

  const { data: targets } = await db.from("watchlist_targets").select("*").eq("watchlist_id", watchlistId);
  const { data: changes } = await db
    .from("field_changes")
    .select("*, change_feedback(*)")
    .eq("watchlist_id", watchlistId)
    .order("detected_at", { ascending: false });

  return { ...wl, targets: targets || [], changes: changes || [] };
}

export async function createWatchlist(userId, { name, description = "", cadence = "daily", domains = [] }, env = process.env) {
  const db = serviceDb(env);
  const wlId = "wl_" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();

  const cleanDomains = domains.map(normalizeDomain).filter(Boolean);

  if (!db) {
    const newWl = {
      id: wlId,
      user_id: userId || "usr_demo",
      name: name || "Competitor Watchlist",
      description,
      cadence,
      status: "active",
      created_at: now,
      updated_at: now,
    };
    _localWatchlists.set(wlId, newWl);

    const createdTargets = [];
    for (const domain of cleanDomains) {
      const targetId = "target_" + Math.random().toString(36).slice(2, 10);
      const target = {
        id: targetId,
        watchlist_id: wlId,
        domain,
        company_name: domain.split(".")[0].toUpperCase(),
        status: "active",
        created_at: now,
      };
      _localTargets.set(targetId, target);
      createdTargets.push(target);
    }

    return { ok: true, watchlist: newWl, targets: createdTargets };
  }

  const { data: wl, error: wlErr } = await db
    .from("watchlists")
    .insert({
      user_id: userId,
      name: name || "Competitor Watchlist",
      description,
      cadence,
      status: "active",
    })
    .select()
    .single();

  if (wlErr) throw new Error(wlErr.message);

  let createdTargets = [];
  if (cleanDomains.length > 0) {
    const targetsPayload = cleanDomains.map((d) => ({
      watchlist_id: wl.id,
      domain: d,
      company_name: d.split(".")[0].toUpperCase(),
      status: "active",
    }));

    const { data: targets, error: targetsErr } = await db
      .from("watchlist_targets")
      .insert(targetsPayload)
      .select();

    if (!targetsErr) createdTargets = targets || [];
  }

  return { ok: true, watchlist: wl, targets: createdTargets };
}

export async function recordFieldChange(watchlistId, targetId, { targetDomain, field, category, oldValue, newValue }, env = process.env) {
  const changeRecord = buildChangeRecord({
    targetDomain,
    field,
    category,
    oldValue,
    newValue,
  });

  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const changeId = "chg_" + Math.random().toString(36).slice(2, 10);
    const change = {
      id: changeId,
      target_id: targetId,
      watchlist_id: watchlistId,
      field_name: field,
      category,
      old_value: oldValue,
      new_value: newValue,
      materiality: changeRecord.materiality,
      fact_summary: changeRecord.factSummary,
      ai_interpretation: changeRecord.aiInterpretation,
      detected_at: now,
      created_at: now,
    };
    _localChanges.set(changeId, change);
    return { ok: true, change };
  }

  const { data, error } = await db
    .from("field_changes")
    .insert({
      target_id: targetId,
      watchlist_id: watchlistId,
      field_name: field,
      category,
      old_value: oldValue,
      new_value: newValue,
      materiality: changeRecord.materiality,
      fact_summary: changeRecord.factSummary,
      ai_interpretation: changeRecord.aiInterpretation,
      detected_at: now,
    })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, change: data };
}

export async function submitChangeFeedback(userId, { fieldChangeId, feedback, notes = "" }, env = process.env) {
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const fbId = "fb_" + Math.random().toString(36).slice(2, 10);
    const fb = {
      id: fbId,
      field_change_id: fieldChangeId,
      user_id: userId || "usr_demo",
      feedback,
      notes,
      created_at: now,
    };
    _localFeedback.set(fbId, fb);
    return { ok: true, feedback: fb };
  }

  const { data, error } = await db
    .from("change_feedback")
    .insert({
      field_change_id: fieldChangeId,
      user_id: userId,
      feedback,
      notes,
    })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, feedback: data };
}
