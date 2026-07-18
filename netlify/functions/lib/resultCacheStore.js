// netlify/functions/lib/resultCacheStore.js — FD2 (Supabase durable cache).
//
// Mirrors src/lib/resultCache.js for server-side use. Reads/writes the
// `extraction_cache` Supabase table over REST. Service-key only — never
// importable from the browser bundle.
//
// Schema (see scripts/result-cache.sql):
//   url          text NOT NULL          — normalised URL
//   options_hash text NOT NULL          — hash of the options that produced the result
//   result       jsonb NOT NULL         — full { html, metadata, source } payload
//   status       text NOT NULL          — 'ok' | 'error'
//   cached_at    timestamptz NOT NULL
//   expires_at   timestamptz NOT NULL
//   hit_count    integer NOT NULL DEFAULT 0
//
//   PRIMARY KEY (url, options_hash)
//   INDEX on (expires_at) for the cleanup sweep.

const TABLE = "extraction_cache";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function getEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return { url, key, base: `${url}/rest/v1` };
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function getCached(cacheKey, options = {}) {
  const env = getEnv();
  if (!env) return null;
  // cacheKey = "url::optionsHash"
  const sep = cacheKey.lastIndexOf("::");
  if (sep < 0) return null;
  const url = cacheKey.slice(0, sep);
  const optionsHash = cacheKey.slice(sep + 2);

  const { data, error } = await fetch(
    `${env.base}/${TABLE}?url=eq.${encodeURIComponent(url)}&options_hash=eq.${encodeURIComponent(optionsHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=result,status,hit_count`,
    { headers: headers(env.key) },
  ).then((r) => r.json().then((d) => ({ data: d, error: null })).catch((e) => ({ data: null, error: e })));
  if (error || !Array.isArray(data) || data.length === 0) return null;

  // Bump hit count (best-effort, fire-and-forget).
  try {
    fetch(
      `${env.base}/${TABLE}?url=eq.${encodeURIComponent(url)}&options_hash=eq.${encodeURIComponent(optionsHash)}`,
      {
        method: "PATCH",
        headers: { ...headers(env.key), Prefer: "return=minimal" },
        body: JSON.stringify({ hit_count: (data[0].hit_count || 0) + 1 }),
      },
    ).catch(() => {});
  } catch { /* ignore */ }

  return { status: data[0].status, result: data[0].result };
}

export async function setCached(cacheKey, status, result, options = {}) {
  const env = getEnv();
  if (!env) return false;
  const sep = cacheKey.lastIndexOf("::");
  if (sep < 0) return false;
  const url = cacheKey.slice(0, sep);
  const optionsHash = cacheKey.slice(sep + 2);
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const row = {
    url,
    options_hash: optionsHash,
    status,
    result,
    cached_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
  try {
    const res = await fetch(`${env.base}/${TABLE}`, {
      method: "POST",
      headers: { ...headers(env.key), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.warn(`[DatIQ cache] write failed (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[DatIQ cache] write error:", err.message);
    return false;
  }
}

export async function deleteCached(cacheKey) {
  const env = getEnv();
  if (!env) return false;
  const sep = cacheKey.lastIndexOf("::");
  if (sep < 0) return false;
  const url = cacheKey.slice(0, sep);
  const optionsHash = cacheKey.slice(sep + 2);
  try {
    const res = await fetch(
      `${env.base}/${TABLE}?url=eq.${encodeURIComponent(url)}&options_hash=eq.${encodeURIComponent(optionsHash)}`,
      { method: "DELETE", headers: headers(env.key) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
