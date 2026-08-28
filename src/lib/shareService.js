// src/lib/shareService.js — Q8 (shareable report links + public sample gallery).
//
// Persists shareable extraction reports to the Supabase `public_reports` table
// so the URL works in ANY browser, not just the originator's. Falls back to
// localStorage when Supabase is not configured (dev / demo) so the UI stays
// fully interactive without a backend.
//
// Public projection shape (mirrors what the /p/:slug page renders):
//   { id, slug, title, url, ai_summary, custom_extraction, enrichments,
//     headings, links, intent, created_at, is_public }

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";
import { incrementPublicExtractions, decrementPublicExtractions } from "./publicQuota.js";
import { getAuthToken } from "./apiClient.js";

const TABLE = "public_reports";
const LS_INDEX = "datiq.publicGallery";
const LS_SHARED = "datiq.sharedExtractions";

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l — easier to type
const SLUG_LEN = 8;

// ── localStorage helpers (offline + dev fallback) ─────────────────────────────
function lsRead(k) {
  try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; }
}
function lsWrite(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* skip */ }
}

function readIndex() { return lsRead(LS_INDEX); }
function writeIndex(arr) { lsWrite(LS_INDEX, arr); }

function readShared() { return lsRead(LS_SHARED); }
function writeShared(arr) { lsWrite(LS_SHARED, arr); }

// ── Slug generation ───────────────────────────────────────────────────────────
// Math.random is good enough here — slugs only need to be unique per user.
// (No PII; no auth claim; safe to be predictable.)
export function generateSlug() {
  let s = "";
  for (let i = 0; i < SLUG_LEN; i++) {
    s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return s;
}

export function isValidSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]{6,16}$/.test(slug);
}

// ── Public projection ─────────────────────────────────────────────────────────
function projectPublic(extraction, slug) {
  return {
    id: extraction.id,
    slug,
    title: extraction.title || extraction.url || "Untitled",
    url: extraction.url || null,
    ai_summary: extraction.ai_summary || "",
    custom_extraction: extraction.custom_extraction || null,
    enrichments: extraction.enrichments || {},
    headings: Array.isArray(extraction.headings) ? extraction.headings.slice(0, 30) : [],
    links: Array.isArray(extraction.links) ? extraction.links.slice(0, 50) : [],
    intent: extraction.intent || "summary",
    created_at: extraction.created_at || new Date().toISOString(),
    is_public: true,
  };
}

function safeUserId() {
  // AuthProvider may not be loaded in a pure-logic context. Return null when
  // there's no auth — Supabase will accept a NULL user_id.
  if (typeof window === "undefined") return null;
  try {
    // We can't import @supabase/supabase-js here without forcing it onto the
    // browser bundle. Use the supabase singleton's getUser() if available.
    if (supabase?.auth?.getUser) {
      // Not awaited on purpose — sync getter from the cached session.
      // The fallback below covers the un-awaited case.
    }
  } catch { /* noop */ }
  return null;
}

// ── Share / unshare ───────────────────────────────────────────────────────────

/**
 * Mark an extraction as publicly shareable. Returns the public slug.
 * Idempotent: re-sharing the same id returns the same slug.
 *
 * Tries Supabase first (so the URL works across browsers), then falls back
 * to localStorage. If both fail, throws.
 *
 * @param {object} extraction - { id, title, url, ai_summary, custom_extraction, ... }
 * @param {object} [opts] - { sessionId?: string }. The owning user id (for a
 *   signed-in sharer) is resolved server-side from the caller's own JWT via
 *   getAuthToken(), never accepted from this parameter — see
 *   netlify/functions/public-reports.js.
 * @returns {Promise<{slug: string, persistedTo: 'supabase'|'local'|'both'}>}
 */
export async function shareExtraction(extraction, opts = {}) {
  if (!extraction || !extraction.id) throw new Error("shareExtraction: extraction.id is required");

  // 1. Determine (or reuse) the slug. Look in both Supabase and localStorage
  //    so re-sharing returns the same slug.
  const existingLocal = readShared().find((s) => s.id === extraction.id);
  let slug = existingLocal?.slug;

  if (!slug && isSupabaseEnabled && supabase) {
    try {
      const { data } = await supabase
        .from(TABLE)
        .select("slug")
        // public_reports.id is a database-generated UUID. Extraction IDs
        // created by the local/offline path are intentionally not UUIDs
        // (e.g. `ex_...`), so the extraction identity lives in the public
        // projection rather than in the table primary key.
        .eq("data->>id", String(extraction.id))
        .maybeSingle();
      if (data?.slug) slug = data.slug;
    } catch (err) {
      // Ignore — we'll generate a new slug.
      if (typeof console !== "undefined") console.warn("[DatIQ share] lookup failed:", err);
    }
  }
  if (!slug) slug = generateSlug();

  const pub = projectPublic(extraction, slug);
  const sessionId = opts.sessionId || (() => { try { return getSessionId(); } catch { return null; } })();

  // 2. Persist server-side via public-reports.js (service key). When the app
  // is configured for Supabase, a public share must not report success while
  // only writing localStorage: that would create a link that works in this
  // browser but is absent from the database. The local fallback below is
  // reserved for the deliberately offline/demo mode where Supabase is not
  // configured at all.
  //
  // The write used to go straight to Supabase from the browser with the anon
  // key, which meant re-publishing an EXISTING slug (an UPDATE) was denied by
  // RLS for every anonymous sharer — see netlify/functions/public-reports.js's
  // header comment for the full story. That function now does this ownership
  // check server-side and reports refreshed:false rather than throwing when a
  // caller isn't the original sharer, so this call is a straight request/
  // response with no client-side probe-and-guess needed.
  let persistedTo = "local";
  let supabaseError = null;
  let refreshed = true;
  if (isSupabaseEnabled) {
    try {
      const authToken = getAuthToken();
      const res = await fetch("/api/public-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          slug,
          title: pub.title,
          url: pub.url,
          intent: pub.intent,
          data: pub,
          sessionId,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.ok) {
        const publishError = new Error(result?.error || "Couldn't publish the public link.");
        publishError.code = "PUBLIC_PUBLISH_FAILED";
        throw publishError;
      }
      persistedTo = "supabase";
      refreshed = result.refreshed !== false;
    } catch (err) {
      supabaseError = err;
      if (typeof console !== "undefined") console.warn("[DatIQ share] persist failed:", err);
      if (err?.code === "PUBLIC_PUBLISH_FAILED") throw err;
      const publishError = new Error("Couldn't publish the public link.");
      publishError.code = "PUBLIC_PUBLISH_FAILED";
      publishError.cause = err;
      throw publishError;
    }
  }

  // 3. Always mirror to localStorage so the local UI knows about it.
  const shared = readShared();
  const idx = shared.findIndex((s) => s.id === extraction.id);
  if (idx >= 0) shared[idx] = pub; else shared.push(pub);
  writeShared(shared);

  // 4. Update the gallery index.
  const index = readIndex();
  if (!index.some((e) => e.slug === slug)) {
    index.unshift({
      slug,
      title: pub.title,
      url: pub.url,
      created_at: pub.created_at,
      intent: pub.intent,
    });
    if (index.length > 500) index.length = 500;
    writeIndex(index);
  }

  return { slug, persistedTo, supabaseError, refreshed };
}

/** Was the given extraction already shared publicly? (sync) */
export function isPubliclyShared(id) {
  if (!id) return false;
  return Boolean(getSharedSlugForId(id));
}

/**
 * Notify the public-quota counter that an extraction was shared.
 * Called from the Preview share flow after a successful share.
 * Simple increment — the call site (Preview.jsx) is responsible for not
 * double-counting (it only calls this on a successful new share, never on
 * the idempotent re-share path inside shareExtraction).
 */
export function recordPublicShare(extractionId) {
  if (!extractionId) return null;
  return incrementPublicExtractions(1);
}

/**
 * Notify the public-quota counter that an extraction was unshared.
 * Matches recordPublicShare — decrements by 1 (never below 0).
 */
export function recordPublicUnshare() {
  return decrementPublicExtractions(1);
}

/**
 * Remove a publicly-shared report. Tries Supabase first, then localStorage.
 * Returns true if at least one of them reported success.
 */
export async function unshareExtraction(id) {
  if (!id) return false;
  let removed = false;

  if (isSupabaseEnabled && supabase) {
    try {
      // Match the extraction identity stored in the public projection. Using
      // public_reports.id here breaks for local IDs that are not UUIDs and
      // also targets the wrong identifier for server-saved extractions.
      const { error } = await supabase.from(TABLE).delete().eq("data->>id", String(id));
      if (!error) removed = true;
      else if (typeof console !== "undefined") console.warn("[DatIQ share] Supabase delete failed:", error);
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[DatIQ share] Supabase delete threw:", err);
    }
  }

  const shared = readShared();
  const idx = shared.findIndex((s) => s.id === id);
  if (idx !== -1) {
    const slug = shared[idx].slug;
    shared.splice(idx, 1);
    writeShared(shared);
    writeIndex(readIndex().filter((e) => e.slug !== slug));
    removed = true;
  }

  return removed;
}

// ── Read paths (the part that was BROKEN before) ──────────────────────────────

/**
 * Fetch a public report by slug. Tries Supabase first so the URL works
 * across browsers / devices, then falls back to localStorage for the
 * dev/offline path. Returns null when the slug is unknown to both.
 *
 * THIS is the function the user said was broken — fixed: cross-browser
 * works when Supabase is configured.
 */
export async function getPublicBySlug(slug) {
  if (!isValidSlug(slug)) return null;

  // 1. Try Supabase (the cross-browser path).
  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("data")
        .eq("slug", slug)
        .eq("is_public", true)
        .maybeSingle();
      if (!error && data?.data) {
        return data.data;
      }
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[DatIQ share] Supabase read failed:", err);
    }
  }

  // 2. Fall back to localStorage (dev / offline).
  return readShared().find((s) => s.slug === slug) || null;
}

/** Synchronous local-only lookup. Used for "did I share this in this browser?" */
export function getPublicBySlugLocal(slug) {
  if (!isValidSlug(slug)) return null;
  return readShared().find((s) => s.slug === slug) || null;
}

export function getSharedSlugForId(id) {
  return readShared().find((s) => s.id === id)?.slug || null;
}

/**
 * Synchronous, local-only read of this browser's share index. Used for instant
 * first paint before getGallery() resolves — the same localStorage-first
 * pattern Dashboard uses for saved extractions.
 */
export function getGalleryLocal(limit = 50) {
  return readIndex().slice(0, limit);
}

/**
 * The "recently shared" feed behind /gallery.
 *
 * This reads Supabase, not just localStorage. publish() already writes the row
 * to `public_reports` (that write is what makes /p/:slug resolve in another
 * browser at all), so a local-only read meant a visitor who had never shared
 * anything themselves saw an empty gallery on a public marketing page.
 *
 * Server rows are MERGED with local rows keyed on slug rather than replacing
 * them — reports published while signed out exist only in localStorage, and
 * extractionsRepo.listExtractions() had to learn this same lesson: a successful
 * query legitimately returning [] must not be trusted as authoritative and wipe
 * the local cache.
 *
 * Returns the local list (never throws) when Supabase is unconfigured or the
 * query fails, matching getCuratedGallery()'s degrade-quietly contract.
 */
export async function getGallery(limit = 50) {
  const local = readIndex();
  if (!isSupabaseEnabled || !supabase) return local.slice(0, limit);

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("slug,title,url,intent,created_at")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const bySlug = new Map();
    // Local first so a locally-known title survives, then let the server fill
    // in anything this browser has never seen.
    for (const row of local) if (row?.slug) bySlug.set(row.slug, row);
    for (const row of data || []) {
      if (!row?.slug) continue;
      bySlug.set(row.slug, { ...row, ...bySlug.get(row.slug) });
    }
    return [...bySlug.values()]
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, limit);
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[DatIQ share] gallery fetch failed:", err);
    return local.slice(0, limit);
  }
}

/**
 * The curated persona showcase — DISTINCT from getGallery() above. getGallery()
 * is every public report, newest first; this is only the rows an admin
 * explicitly promoted via /admin/gallery (see netlify/functions/admin-gallery.js,
 * 0025_gallery_curation.sql), so it is Supabase-only with no local fallback —
 * `curated` is server-side metadata that never lives in localStorage.
 *
 * `persona` filters to one persona id; omitted/null returns every curated row
 * regardless of persona. Returns [] (not a throw) when Supabase isn't
 * configured or the query fails — there is no meaningful local fallback here,
 * since "curated" is server-side-only metadata that never lives in localStorage.
 */
export async function getCuratedGallery({ persona, limit = 50 } = {}) {
  if (!isSupabaseEnabled || !supabase) return [];
  try {
    let query = supabase
      .from(TABLE)
      .select("slug,title,url,intent,persona,created_at")
      .eq("is_public", true)
      .eq("curated", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (persona) query = query.eq("persona", persona);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[DatIQ share] curated gallery fetch failed:", err);
    return [];
  }
}

export function buildPublicUrl(slug) {
  if (typeof window === "undefined") return `/p/${slug}`;
  return `${window.location.origin}/p/${slug}`;
}

// Used by tests to reset between runs.
export function _resetShareForTests() {
  lsWrite(LS_INDEX, []);
  lsWrite(LS_SHARED, []);
}
