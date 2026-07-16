// tagsService.js — Groke QW#2. Per-extraction tags + a global tag catalogue.
//
// Storage: piggybacks on the existing `datiq.saved` localStorage key. Each
// extraction gets a `tags: string[]` field (defaulted to []). No new
// top-level key, no migration needed — old items without the field are
// treated as untagged.
//
// Pure functions only — the UI components (TagChips) read and write via the
// extraction-saver helper so the change is picked up by Dashboard / Recent
// extractions on the next render.

import { listExtractions, saveExtraction } from "./extractionsRepo.js";

const MAX_TAG_LEN = 32;
const MAX_TAGS_PER_ITEM = 24;
const MAX_TAG_SUGGESTIONS = 8;

function normalizeTag(raw) {
  if (raw == null) return "";
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed) return "";
  // Replace whitespace with hyphens; strip anything not a-z, 0-9, hyphen, dot, +, #
  const cleaned = trimmed
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-+#.@]/g, "")
    .slice(0, MAX_TAG_LEN);
  return cleaned;
}

// Pure — returns a new tags array with the tag added (or no-op if invalid/dup).
export function addTagPure(tags, raw) {
  const tag = normalizeTag(raw);
  if (!tag) return tags || [];
  const list = Array.isArray(tags) ? tags.slice() : [];
  if (list.includes(tag)) return list;
  if (list.length >= MAX_TAGS_PER_ITEM) return list;
  list.push(tag);
  return list;
}

// Pure — returns a new tags array with the tag removed.
export function removeTagPure(tags, raw) {
  const tag = normalizeTag(raw);
  if (!tag) return tags || [];
  return (tags || []).filter((t) => t !== tag);
}

// Pure — given a URL, suggest a host-derived tag (e.g. "stripe" for stripe.com).
export function suggestFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!host) return "";
    // Use the last 2 parts for known TLDs (co.uk, com.au) else just the first label
    const parts = host.split(".");
    if (parts.length <= 2) return parts[0];
    // Common multi-part TLDs
    const last2 = parts.slice(-2).join(".");
    if (/(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i.test(last2)) {
      return parts[parts.length - 3] || parts[0];
    }
    return parts[parts.length - 2];
  } catch {
    return "";
  }
}

// Async — returns a Set of all unique tags across every saved extraction.
export async function getAllTags() {
  const items = await listExtractions();
  const set = new Set();
  for (const it of items || []) {
    for (const t of it?.tags || []) {
      if (t) set.add(t);
    }
  }
  return set;
}

// Async — add a tag to a specific item and persist.
export async function addTagToExtraction(item, raw) {
  const next = { ...item, tags: addTagPure(item?.tags, raw) };
  await saveExtraction(next);
  return next;
}

// Async — remove a tag from a specific item and persist.
export async function removeTagFromExtraction(item, raw) {
  const next = { ...item, tags: removeTagPure(item?.tags, raw) };
  await saveExtraction(next);
  return next;
}

// Pure — given a query and a Set of known tags, return up to MAX_TAG_SUGGESTIONS
// matching tags (prefix > substring > contains). Used by the chip-input.
export function suggestTags(query, knownTags) {
  const q = normalizeTag(query);
  if (!q) return [];
  const arr = Array.from(knownTags || []);
  const prefix = [];
  const contains = [];
  for (const t of arr) {
    if (t === q) continue;
    if (t.startsWith(q)) prefix.push(t);
    else if (t.includes(q)) contains.push(t);
  }
  return [...prefix, ...contains].slice(0, MAX_TAG_SUGGESTIONS);
}

export const TAG_LIMITS = { MAX_TAG_LEN, MAX_TAGS_PER_ITEM, MAX_TAG_SUGGESTIONS };
