// src/lib/cache/pageCache.js
//
// Stale-while-revalidate localStorage cache utility for DatIQ pages.
// Accelerates first-paint across Workflows, Account Lists, Watchlists,
// Signal Rules, and Template runs so views render instantly without
// cold loading spinners, then revalidate in the background.

const PREFIX = "datiq.cache.";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read cached page data.
 * Returns { data, cachedAt, ageMs } if valid and fresh, or null otherwise.
 * Never throws — SSR safe and catches private-mode / localStorage exceptions.
 */
export function readPageCache(key, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now()) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const entry = safeParse(raw);
    if (!entry || typeof entry !== "object" || !("data" in entry)) return null;
    const age = now - Number(entry.cachedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return { data: entry.data, cachedAt: entry.cachedAt, ageMs: age };
  } catch {
    return null;
  }
}

/**
 * Persist page data to cache.
 * Returns boolean indicating whether write succeeded.
 * Catches QuotaExceededError and private-mode exceptions silently.
 */
export function writePageCache(key, data, now = Date.now()) {
  if (typeof window === "undefined" || !window.localStorage || data === undefined) return false;
  try {
    const payload = JSON.stringify({ data, cachedAt: now });
    localStorage.setItem(`${PREFIX}${key}`, payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a cached entry by key.
 */
export function clearPageCache(key) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

export const __testing = { PREFIX, DEFAULT_MAX_AGE_MS };
