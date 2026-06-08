// Central HTTP client for all /api/* calls (Netlify Functions).
//
// Architecture: UI → apiClient → /api/* → Netlify Function → external/internal service
//
// All service modules (firecrawlService, aiService, extractionsRepo) use this
// instead of calling external APIs directly, keeping secret keys server-side.

const BASE = "/api";

async function request(path, method = "GET", body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(
      errData.error || `API ${method} ${path} failed (${res.status})`
    );
    e.status = res.status;
    e.detail = errData.detail;
    e.useLocalStorage = errData.useLocalStorage === true;
    throw e;
  }

  return res.json();
}

export const apiClient = {
  // ── Firecrawl ──────────────────────────────────────────────────────────────
  /** Scrape a single URL or map a domain (options.mapMode = true). */
  extract: (url, options = {}) =>
    request("/extract", "POST", { url, options }),

  // ── AI (Anthropic Claude) ──────────────────────────────────────────────────
  /** Send a messages-API request. Payload: { model?, max_tokens?, messages }. */
  ai: (payload) => request("/ai", "POST", payload),

  // ── Extractions CRUD ───────────────────────────────────────────────────────
  /** List all saved extractions, newest first. */
  listExtractions: () => request("/extractions", "GET"),

  /** Persist a new extraction. Returns the saved row with server-assigned id. */
  createExtraction: (payload) =>
    request("/extractions", "POST", payload),

  /** Merge fields into an existing extraction (used for enrichment tab sync). */
  patchExtraction: (id, fields) =>
    request(`/extractions?id=${encodeURIComponent(id)}`, "PATCH", fields),

  /** Delete an extraction by id. */
  deleteExtraction: (id) =>
    request(`/extractions?id=${encodeURIComponent(id)}`, "DELETE"),
};
