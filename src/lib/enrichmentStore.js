// enrichmentStore.js — persists Quick Enrichment results (and the last-viewed
// extraction) in localStorage so they survive navigation and page reloads.
//
// Enrichments are keyed by the searched URL, then by capability key, so every
// capability you run against a URL is saved and reloads as a tab when you view
// that URL's extraction again. Re-running a capability overwrites its entry
// (acts as a refresh).

const ENRICH_KEY = "datiq.enrichments"; // { [url]: { [capKey]: entry } }
const CURRENT_KEY = "datiq.current"; // last extraction shown on /preview

function readAll() {
  try {
    const raw = localStorage.getItem(ENRICH_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(ENRICH_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** All saved enrichment entries for a URL, as a { [capKey]: entry } map. */
export function readEnrichments(url) {
  if (!url) return {};
  return readAll()[url] || {};
}

/** Insert-or-replace a single enrichment entry for a URL (refresh = overwrite). */
export function saveEnrichment(url, entry) {
  if (!url || !entry?.key) return;
  const all = readAll();
  all[url] = { ...(all[url] || {}), [entry.key]: entry };
  writeAll(all);
}

/**
 * Combine persisted and local enrichment maps. When the same capability exists
 * in both places, retain the newest result so an older cross-device response
 * cannot overwrite a freshly refreshed local tab.
 */
export function mergeEnrichments(persisted = {}, local = {}) {
  const merged = { ...(persisted || {}) };
  for (const [key, entry] of Object.entries(local || {})) {
    const previous = merged[key];
    if (!previous || new Date(entry?.created_at || 0) >= new Date(previous?.created_at || 0)) {
      merged[key] = entry;
    }
  }
  return merged;
}

/** Persist the last-viewed extraction so /preview survives a browser reload. */
export function saveCurrent(extraction) {
  try {
    if (extraction) localStorage.setItem(CURRENT_KEY, JSON.stringify(extraction));
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

/** Read back the last-viewed extraction (or null). */
export function readCurrent() {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
