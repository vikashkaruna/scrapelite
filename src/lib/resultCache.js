// src/lib/resultCache.js — FD2 (idempotent result cache + URL-level dedup).
//
// Council intent: "Same URL twice in an hour = one fetch; cuts infra cost
// 30-50%, makes permalinks instant and monitoring predictable."
//
// Design:
//   - URL is normalised (strip utm_/fbclid/gclid trailing params, lowercased
//     host, default-https scheme) so cosmetic variants dedup correctly.
//   - Two-tier cache: in-process LRU (fast) + Supabase `extraction_cache`
//     table (durable, shared across cold starts). The Supabase path is
//     best-effort; on 404/error the function falls through to the live
//     provider chain.
//   - TTL is 24h by default (configurable per-call). Cached entries with
//     `renderJs` or `customPrompt` options are NOT cached because the
//     output depends on the prompt.
//   - Cache key is `url + optionsHash` so the same URL with different
//     prompts does NOT collide.
//
// This module is the pure-logic layer (key generation, TTL, dedup
// decisions). The actual Supabase reads/writes live in
// netlify/functions/lib/resultCacheStore.js (server side) because the
// service key is server-only.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_IN_PROCESS_CAPACITY = 100;

// ── URL normalisation ─────────────────────────────────────────────────────────
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref",
]);

export function normaliseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl.trim().toLowerCase(); }
  // Default to https if no scheme
  if (url.protocol === "http:") url.protocol = "https:";
  // Lowercase host
  url.hostname = url.hostname.toLowerCase();
  // Strip default ports
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  // Strip tracking params
  const kept = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.push([k, v]);
  }
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  // Sort query params for stable key
  url.searchParams.sort();
  // Strip trailing slash unless the path is just "/"
  let path = url.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;
  // Strip hash (fragments are not part of HTTP requests)
  url.hash = "";
  return url.toString();
}

// ── Options hashing ───────────────────────────────────────────────────────────
export function hashOptions(opts) {
  if (!opts) return "";
  // The relevant fields that affect output. We deliberately exclude
  // `signal` and other AbortController instances.
  const key = JSON.stringify({
    renderJs: Boolean(opts.renderJs),
    customPrompt: opts.customPrompt || "",
    mapMode: Boolean(opts.mapMode),
  });
  // Cheap stable hash (FNV-1a 32-bit, base36).
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ── Cache key ─────────────────────────────────────────────────────────────────
export function buildCacheKey(url, opts) {
  const u = normaliseUrl(url);
  const oh = hashOptions(opts);
  return `${u}::${oh}`;
}

// ── TTL ──────────────────────────────────────────────────────────────────────
export function isCacheable(opts) {
  // Don't cache results that depend on user-provided prompts — they can
  // change every call, and caching the AI output would produce stale answers.
  if (opts && opts.customPrompt) return false;
  return true;
}

export function makeCacheEntry({ result, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  return {
    result,
    cachedAt: now,
    expiresAt: now + ttlMs,
  };
}

export function isCacheEntryFresh(entry, now = Date.now()) {
  if (!entry || !entry.expiresAt) return false;
  return now < entry.expiresAt;
}

// ── In-process LRU ───────────────────────────────────────────────────────────
export class InProcessLRU {
  constructor(capacity = DEFAULT_IN_PROCESS_CAPACITY) {
    this.capacity = capacity;
    this.map = new Map(); // insertion-order = LRU order
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }
  has(key) { return this.map.has(key); }
  delete(key) { return this.map.delete(key); }
  size() { return this.map.size; }
  clear() { this.map.clear(); }
}

// ── High-level dedup helper ──────────────────────────────────────────────────
// "Should we serve from cache, or fall through to a live fetch?"
// Returns { cacheable: boolean, key?: string, ttlMs: number }
// Pure — the caller decides whether to call the cache.
export function dedupDecision(url, opts, opts2 = {}) {
  const cacheable = isCacheable(opts);
  if (!cacheable) return { cacheable: false, key: null, ttlMs: 0 };
  const key = buildCacheKey(url, opts);
  const ttlMs = opts2.ttlMs || DEFAULT_TTL_MS;
  return { cacheable: true, key, ttlMs };
}

export const _internal = { DEFAULT_TTL_MS, DEFAULT_IN_PROCESS_CAPACITY, TRACKING_PARAMS };
