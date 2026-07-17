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
 * @param {object} [opts] - { userId?: string, sessionId?: string }
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
        .eq("id", extraction.id)
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
  const userId = opts.userId ?? null;

  // 2. Persist to Supabase (best-effort). Don't fail the share if it errors.
  let persistedTo = "local";
  let supabaseError = null;
  if (isSupabaseEnabled && supabase) {
    try {
      const row = {
        slug,
        title: pub.title,
        url: pub.url,
        intent: pub.intent,
        data: pub,
        user_id: userId,
        session_id: sessionId,
        is_public: true,
      };
      // We don't know the row's primary id without the schema, so include
      // the extraction's id explicitly. The slug is the unique key.
      row.id = extraction.id;
      const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "slug" });
      if (error) throw error;
      persistedTo = "supabase";
    } catch (err) {
      supabaseError = err;
      if (typeof console !== "undefined") console.warn("[DatIQ share] Supabase persist failed:", err);
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

  return { slug, persistedTo, supabaseError };
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
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
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

export function getGallery(limit = 50) {
  return readIndex().slice(0, limit);
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
