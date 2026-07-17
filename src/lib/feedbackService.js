// src/lib/feedbackService.js — Q5 (AI summary thumbs up/down feedback).
//
// Pure-logic helper. Persists feedback to the Supabase `summary_feedback`
// table when configured, falls back to localStorage. The same record is
// exposed to the UI layer so a single thumbs-up click can be both
// recorded AND rendered (so the user sees their selection stick).

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";

const TABLE = "summary_feedback";
const LS_KEY = "datiq.summaryFeedback"; // map: extractionId -> { rating, comment, updatedAt }

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function lsWrite(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* skip */ }
}

function isValidRating(r) {
  return r === -1 || r === 0 || r === 1;
}

/**
 * Pure feedback shape:
 *   { extractionId, rating: -1|0|1, comment?: string, updatedAt: ISO }
 */
function normalise({ extractionId, rating, comment }) {
  return {
    extractionId: String(extractionId || ""),
    rating: isValidRating(rating) ? rating : 0,
    comment: typeof comment === "string" ? comment.slice(0, 2000) : "",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Submit (or update) a feedback record. Idempotent: re-submitting the same
 * extractionId overwrites the previous record.
 *
 * @param {object} input
 * @param {string} input.extractionId
 * @param {number} input.rating   -1 | 0 | 1
 * @param {string} [input.comment]
 * @param {object} [opts] - { userId?: string, url?: string, intent?: string }
 * @returns {Promise<{ persistedTo: 'supabase'|'local'|'both' }>}
 */
export async function submitFeedback(input, opts = {}) {
  if (!input || !input.extractionId) {
    throw new Error("submitFeedback: extractionId is required");
  }
  const norm = normalise(input);
  const sessionId = (() => { try { return getSessionId(); } catch { return null; } })();
  const userId = opts.userId ?? null;

  // 1. Always mirror to localStorage (works offline; survives Supabase hiccups).
  const local = lsRead();
  local[norm.extractionId] = norm;
  lsWrite(local);

  // 2. Best-effort write to Supabase.
  let persistedTo = "local";
  if (isSupabaseEnabled && supabase) {
    try {
      const row = {
        extraction_id: norm.extractionId,
        url: opts.url || null,
        intent: opts.intent || null,
        rating: norm.rating,
        comment: norm.comment || null,
        user_id: userId,
        session_id: sessionId,
      };
      const { error } = await supabase
        .from(TABLE)
        .upsert(row, { onConflict: "extraction_id,session_id" });
      if (error) throw error;
      persistedTo = "supabase";
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[DatIQ feedback] Supabase persist failed:", err);
    }
  }
  return { persistedTo, feedback: norm };
}

/**
 * Look up the most recent feedback for an extraction. Local-first for
 * snappy UI; falls back to Supabase if the user is on a different device
 * than the one that wrote the feedback.
 */
export async function getFeedbackForExtraction(extractionId) {
  if (!extractionId) return null;
  const local = lsRead()[extractionId];
  if (local) return local;
  if (isSupabaseEnabled && supabase) {
    try {
      const sessionId = (() => { try { return getSessionId(); } catch { return null; } })();
      let q = supabase.from(TABLE).select("rating, comment, created_at")
        .eq("extraction_id", extractionId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (sessionId) q = q.eq("session_id", sessionId);
      const { data, error } = await q.maybeSingle();
      if (!error && data) {
        return {
          extractionId,
          rating: data.rating,
          comment: data.comment || "",
          updatedAt: data.created_at,
        };
      }
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[DatIQ feedback] Supabase read failed:", err);
    }
  }
  return null;
}

/** Local-only lookup (used to render feedback state synchronously). */
export function getLocalFeedback(extractionId) {
  if (!extractionId) return null;
  return lsRead()[extractionId] || null;
}

/** Pure helper: aggregate rating stats. Useful for the Admin panel later. */
export function summariseRatings(records) {
  const out = { up: 0, down: 0, neutral: 0, total: 0 };
  for (const r of records || []) {
    out.total += 1;
    if (r.rating === 1) out.up += 1;
    else if (r.rating === -1) out.down += 1;
    else out.neutral += 1;
  }
  return out;
}

export function _resetFeedbackForTests() {
  lsWrite({});
}
