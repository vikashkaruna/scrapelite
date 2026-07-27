// netlify/functions/lib/apiKeyStore.js
//
// Persistence layer for the public REST API keys.
//
// Schema (see supabase/migrations/0019_api_keys.sql):
//   create table public.api_keys (
//     id          uuid primary key default gen_random_uuid(),
//     user_id     uuid not null references auth.users,
//     key_hash    text not null unique,           -- sha256 hex
//     key_prefix  text not null,                  -- e.g. "dq_live_aB3x…"
//     env         text not null check (env in ('live','test')),
//     label       text,
//     plan_id     text,                           -- the plan at issue time
//     last_used_at timestamptz,
//     expires_at   timestamptz,
//     revoked_at   timestamptz,
//     created_at   timestamptz not null default now()
//   );
//
// Design notes:
//   - `key_hash` is the only column that can identify a key. A DB dump does
//     NOT expose usable keys.
//   - `revoked_at` is soft-delete; rows stay around so we can audit
//     "this key was used in this request". A hard DELETE would break the
//     audit log.
//   - All functions take an explicit `db` argument (a fetch-based service
//     handle) so they can be unit-tested without a real Supabase.

import { hashApiKey, labelFor, envOf } from "./apiKeyService.js";

// ── Service-key REST handle (matches the house style) ────────────────────────

export function getServiceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

// ── Row construction (pure) ───────────────────────────────────────────────────

/**
 * Build the row that gets INSERTed into api_keys. Pure. The plaintext is
 * already in the caller's hand; we hash it here and never store the original.
 */
export function buildApiKeyRow({ plaintext, userId, label, planId, env, expiresAt }) {
  if (!plaintext) throw new Error("buildApiKeyRow: plaintext required");
  if (!userId) throw new Error("buildApiKeyRow: userId required");
  const resolvedEnv = env || envOf(plaintext);
  if (resolvedEnv !== "live" && resolvedEnv !== "test") {
    throw new Error("buildApiKeyRow: env must be 'live' or 'test'");
  }
  return {
    user_id: userId,
    key_hash: hashApiKey(plaintext),
    key_prefix: labelFor(plaintext),
    env: resolvedEnv,
    label: label || null,
    plan_id: planId || null,
    expires_at: expiresAt || null,
  };
}

// ── DB-backed lookups ────────────────────────────────────────────────────────

/**
 * Look up an API key by its plaintext. Returns the full row (sans hash) or
 * null if no matching active key exists. Revoked and expired keys are
 * treated as missing.
 */
export async function findActiveApiKey(plaintext, { db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  if (!plaintext) return { ok: false, error: "missing_key" };
  let hash;
  try {
    hash = hashApiKey(plaintext);
  } catch (err) {
    return { ok: false, error: "malformed_key", message: err.message };
  }
  let res;
  try {
    const qs = new URLSearchParams({
      key_hash: `eq.${hash}`,
      revoked_at: "is.null",
      select: "id,user_id,key_prefix,env,label,plan_id,expires_at,created_at",
    }).toString();
    res = await fetch(`${d.base}/api_keys?${qs}`, { headers: d.headers });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) {
    return { ok: false, error: `upstream_${res.status}` };
  }
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: true, key: null };
  // Defensive: an expired key is "not active" even if the row is still there.
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    return { ok: true, key: null };
  }
  return { ok: true, key: row };
}

/**
 * List all keys for a user. `includeRevoked` defaults to false — the typical
 * Account UI only shows active keys.
 */
export async function listApiKeysForUser(userId, { includeRevoked = false, db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (!includeRevoked) filters.push("revoked_at=is.null");
  filters.push("select=id,key_prefix,env,label,plan_id,last_used_at,expires_at,created_at,revoked_at");
  filters.push("order=created_at.desc");
  const qs = filters.join("&");
  let res;
  try {
    res = await fetch(`${d.base}/api_keys?${qs}`, { headers: d.headers });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
  const rows = await res.json();
  return { ok: true, keys: Array.isArray(rows) ? rows : [] };
}

/**
 * Revoke a key (soft delete). The caller must own the key. Returns { ok }.
 */
export async function revokeApiKey({ keyId, userId, db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  if (!keyId) return { ok: false, error: "missing_id" };
  const res = await fetch(
    `${d.base}/api_keys?id=eq.${encodeURIComponent(keyId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { ...d.headers, Prefer: "return=minimal" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
  return { ok: true };
}

/**
 * Touch `last_used_at` for a key. Fire-and-forget by design — we never want
 * a key-validation path to fail because we couldn't update the timestamp.
 */
export async function touchApiKey(keyId, { db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d || !keyId) return;
  try {
    await fetch(
      `${d.base}/api_keys?id=eq.${encodeURIComponent(keyId)}`,
      {
        method: "PATCH",
        headers: { ...d.headers, Prefer: "return=minimal" },
        body: JSON.stringify({ last_used_at: new Date().toISOString() }),
      },
    );
  } catch { /* best-effort */ }
}

/**
 * Insert a new key. Returns the inserted row id (the plaintext is NOT echoed
 * back — callers must show it to the user immediately after creation).
 */
export async function createApiKey({ row, db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  if (!row) return { ok: false, error: "missing_row" };
  const res = await fetch(`${d.base}/api_keys`, {
    method: "POST",
    headers: d.headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.message || data?.error || "";
    } catch { /* not JSON */ }
    return { ok: false, error: `upstream_${res.status}`, detail };
  }
  const rows = await res.json();
  const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
  return { ok: true, id };
}

export const _internal = { getServiceDb };
