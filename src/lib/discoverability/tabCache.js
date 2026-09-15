// tabCache.js — localStorage-first, database-authoritative loading for the
// Discoverability tabs.
//
// Every tab (Business Truth, Schema & Trust, SXO, Subject Scores, Entity Graph,
// Local Directory, History) used to start blank and spin on each visit, because
// its data lived only in React state. Now a tab paints what it last showed
// straight from localStorage, then refreshes from the database and overwrites
// the cache. The DATABASE is always the answer; the cache only removes the
// blank screen while that answer is on its way.
//
// ⚠️ Keys are scoped by USER and WORKSPACE. A shared browser must never paint
// one account's entity graph for another, and switching workspace must never
// flash the previous workspace's truth records. Sign-out also sweeps the whole
// prefix (see GuestTrialProvider).
//
// ⚠️ Every storage access is wrapped: localStorage can throw (private windows,
// blocked site data) or be full, and a cache failure must never break a tab.

export const CACHE_PREFIX = "datiq.dsc.cache.v1:";
export const ACTIVE_AUDIT_PREFIX = "datiq.dsc.activeAudit.v1:";

/** Skip caching payloads larger than this; the database still serves them. */
const MAX_BYTES = 400_000;

function scope({ userId = null, workspaceId = null } = {}) {
  return `${userId || "anon"}:${workspaceId || "personal"}`;
}

export function cacheKey(name, ctx = {}, params = "") {
  return `${CACHE_PREFIX}${scope(ctx)}:${name}${params ? `:${params}` : ""}`;
}

/** @returns {{ data: any, savedAt: number } | null} */
export function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "data" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  try {
    const raw = JSON.stringify({ data, savedAt: Date.now() });
    if (raw.length > MAX_BYTES) return false;
    localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Paint from cache (if any), then fetch from the database and repaint.
 *
 * `apply` is called up to twice: once synchronously with the cached value and
 * `{ fromCache: true }`, then with the fresh value and `{ fromCache: false }`.
 * A failed fetch keeps the cached paint and rethrows, so callers keep their
 * existing error handling.
 */
export async function loadWithCache(key, fetcher, apply) {
  const cached = readCache(key);
  if (cached) apply(cached.data, { fromCache: true, savedAt: cached.savedAt });
  const fresh = await fetcher();
  writeCache(key, fresh);
  apply(fresh, { fromCache: false, savedAt: Date.now() });
  return fresh;
}

/** Remember the audit the user is working on, so every tab keeps its context. */
export function rememberActiveAudit(ctx, summary) {
  if (!summary?.id) return;
  try {
    localStorage.setItem(`${ACTIVE_AUDIT_PREFIX}${scope(ctx)}`, JSON.stringify(summary));
  } catch { /* ignore */ }
}

export function readActiveAudit(ctx) {
  try {
    const raw = localStorage.getItem(`${ACTIVE_AUDIT_PREFIX}${scope(ctx)}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Sign-out sweep: remove every cached Discoverability payload and context. */
export function clearDiscoverabilityCache() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith(ACTIVE_AUDIT_PREFIX))) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/**
 * The compact, useful description of an audit for the active-context bar:
 * "(id8) acme.com · Balanced · Mobile · Pricing page · 15 Sep 2026, 14:05".
 * Accepts either a raw `audits` row or the results shape the audit page holds.
 */
export function summarizeAudit(input) {
  if (!input) return null;
  const row = input.audit && typeof input.audit === "object" ? input.audit : input;
  const target = input.target || {};
  const id = row.id || input.auditId || null;
  if (!id) return null;
  const url = row.target_url || target.url || input.targetUrl || "";
  let domain = url;
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
  return {
    id,
    shortId: String(id).slice(0, 8),
    domain: domain || null,
    url: url || null,
    profile: row.audit_profile || target.audit_profile || null,
    device: row.device_profile || target.device_profile || null,
    pageType: row.page_type || target.page_type_label || target.page_type || row.page_type_hint || null,
    createdAt: row.created_at || input.meta?.startedAt || null,
  };
}

const TITLE = (s) => String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function formatAuditContext(summary) {
  if (!summary) return "";
  let when = null;
  if (summary.createdAt) {
    const d = new Date(summary.createdAt);
    if (!Number.isNaN(d.getTime())) {
      when = d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  }
  return [
    summary.domain,
    summary.profile && TITLE(summary.profile),
    summary.device && TITLE(summary.device),
    summary.pageType && TITLE(summary.pageType),
    when,
  ].filter(Boolean).join(" · ");
}
