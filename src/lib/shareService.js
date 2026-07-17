// src/lib/shareService.js — Q6 (shareable report links + public sample gallery).
//
// Generates a stable, URL-safe slug for an extraction and tracks the public
// index of all shared extractions. Pure logic — UI lives in components/.

import { uid } from "./utils.js";

const LS_INDEX = "datiq.publicGallery";
const LS_SHARED = "datiq.sharedExtractions";

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l — easier to type
const SLUG_LEN = 8;

function lsRead(k) {
  try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; }
}
function lsWrite(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* skip */ }
}

// Cryptographically OK (for a slug) — Math.random is good enough here since
// we only need uniqueness inside one user's gallery.
export function generateSlug() {
  let s = "";
  for (let i = 0; i < SLUG_LEN; i++) {
    s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return s;
}

function existsInGallery(slug) {
  return lsRead(LS_INDEX).some((entry) => entry.slug === slug);
}

// Public index entry: { slug, title, url, created_at, intent }
function readIndex() { return lsRead(LS_INDEX); }
function writeIndex(arr) { lsWrite(LS_INDEX, arr); }

function readShared() { return lsRead(LS_SHARED); }
function writeShared(arr) { lsWrite(LS_SHARED, arr); }

/**
 * Mark an extraction as publicly shareable. Returns the public slug.
 * Idempotent: re-sharing the same id returns the same slug.
 *
 * @param {object} extraction - { id, title, url, ai_summary, custom_extraction, ... }
 * @returns {string} the public slug (e.g. "k7m2p4qx")
 */
export function shareExtraction(extraction) {
  if (!extraction || !extraction.id) throw new Error("shareExtraction: extraction.id is required");
  const shared = readShared();
  const existing = shared.find((s) => s.id === extraction.id);
  const slug = existing?.slug || generateSlug();

  // Persist the public view of the extraction.
  const publicView = projectPublic(extraction, slug);
  if (existing) {
    Object.assign(existing, publicView);
  } else {
    shared.push(publicView);
  }
  writeShared(shared);

  // Update the gallery index.
  const index = readIndex();
  if (!index.some((e) => e.slug === slug)) {
    index.unshift({
      slug,
      title: publicView.title,
      url: publicView.url,
      created_at: publicView.created_at,
      intent: publicView.intent,
    });
    // Cap at 500 entries so localStorage doesn't grow unbounded.
    if (index.length > 500) index.length = 500;
    writeIndex(index);
  }
  return slug;
}

export function unshareExtraction(id) {
  if (!id) return false;
  const shared = readShared();
  const idx = shared.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  const slug = shared[idx].slug;
  shared.splice(idx, 1);
  writeShared(shared);
  writeIndex(readIndex().filter((e) => e.slug !== slug));
  return true;
}

// Public projection of an extraction — strip private fields, keep just
// what's needed to render the public page.
function projectPublic(extraction, slug) {
  return {
    id: extraction.id,
    slug,
    title: extraction.title || extraction.url,
    url: extraction.url,
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

export function getPublicBySlug(slug) {
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

export function isValidSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]{6,16}$/.test(slug);
}

// Used by tests to reset between runs.
export function _resetShareForTests() {
  lsWrite(LS_INDEX, []);
  lsWrite(LS_SHARED, []);
}
