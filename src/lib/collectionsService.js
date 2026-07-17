// collectionsService.js — Groke QW#3 (tag-based collections, col-2 variant).
// A "collection" is a single string field (`collection`) on an extraction.
// It's the simplest model that still gives users a way to bucket extractions
// into named projects (e.g. "Stripe research", "Q2 competitors") and filter
// the Dashboard by collection.
import { listExtractions, saveExtraction } from "./extractionsRepo.js";

const MAX_NAME_LEN = 48;

// Pure — sanitise a collection name. Empty / whitespace → "". Strips
// characters that would be awkward in URLs / search / DB queries.
export function normalizeCollectionName(raw) {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  // Allow letters, numbers, spaces, hyphens, underscores, dots, ampersand, parens
  const cleaned = trimmed
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_.&()]/gu, "")
    .slice(0, MAX_NAME_LEN);
  return cleaned;
}

// Pure — given an array of items, return an array of { name, count, latestAt }
export function summariseCollections(items) {
  const map = new Map();
  for (const it of items || []) {
    const name = it?.collection;
    if (!name) continue;
    const e = map.get(name) || { name, count: 0, latestAt: "" };
    e.count += 1;
    if ((it?.created_at || "") > e.latestAt) e.latestAt = it.created_at;
    map.set(name, e);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Pure — filter items by collection name ("" or null = untagged).
export function filterByCollection(items, name) {
  if (!Array.isArray(items)) return [];
  if (name === "__untagged__") return items.filter((it) => !it?.collection);
  if (!name) return items;
  return items.filter((it) => it?.collection === name);
}

// Async — assign a collection to an item and persist.
export async function setCollection(item, rawName) {
  const name = normalizeCollectionName(rawName);
  const next = { ...item };
  if (name) next.collection = name;
  else delete next.collection;
  await saveExtraction(next);
  return next;
}

// Async — list every collection in the store (sorted by count desc).
export async function listAllCollections() {
  const items = await listExtractions();
  return summariseCollections(items);
}

export const COLLECTION_LIMITS = { MAX_NAME_LEN };
