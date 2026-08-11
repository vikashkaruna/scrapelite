// netlify/functions/lib/integrationConnectionStore.js
//
// Per-user OAuth/PAT storage for third-party integrations (HubSpot, Notion,
// Airtable, Zapier, Slack). All integrations that need to call an external
// API on the user's behalf read their token from this store.
//
// Schema (see supabase/migrations/0020_integration_connections.sql):
//   create table public.integration_connections (
//     id            uuid primary key default gen_random_uuid(),
//     user_id       uuid not null references auth.users,
//     provider      text not null,        -- 'hubspot' | 'notion' | 'airtable' | 'slack' | 'zapier'
//     access_token  text,
//     refresh_token text,
//     scopes        text,
//     account_id    text,
//     account_label text,
//     expires_at    timestamptz,
//     config        jsonb,                -- provider-specific (Base ID, DB ID, etc.)
//     created_at    timestamptz not null default now(),
//     updated_at    timestamptz not null default now(),
//     unique (user_id, provider)
//   );
//
// SECURITY: `access_token` and `refresh_token` are sensitive. In v1 we store
// them in plaintext (the only user that can read them is the SERVICE key
// holder, and RLS further restricts row visibility). v1.1 should switch to
// pgcrypto envelope encryption; flagged in INTEGRATIONS.md.

function getServiceDb(env = process.env) {
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

/**
 * Read a single connection row for a user + provider. Returns the row or
 * null. Tokens are masked in the response.
 */
export async function getConnection({ userId, provider, db, env, includeSecrets = false } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  if (!userId || !provider) return { ok: false, error: "missing_args" };
  const qs = new URLSearchParams({
    user_id: `eq.${userId}`,
    provider: `eq.${provider}`,
    select: "id,user_id,provider,scopes,account_id,account_label,expires_at,config,created_at,updated_at" + (includeSecrets ? ",access_token,refresh_token" : ""),
    limit: "1",
  }).toString();
  let res;
  try {
    res = await fetch(`${d.base}/integration_connections?${qs}`, { headers: d.headers });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
  const rows = await res.json();
  return { ok: true, connection: Array.isArray(rows) && rows[0] ? rows[0] : null };
}

/**
 * Upsert a connection. Sets the secrets only when `includeSecrets` is true.
 * `config` is provider-specific (e.g. Notion Database ID, Airtable Base ID).
 */
export async function upsertConnection({ userId, provider, fields, db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  if (!userId || !provider) return { ok: false, error: "missing_args" };

  const allowed = ["access_token", "refresh_token", "scopes", "account_id", "account_label", "expires_at", "config"];
  const patch = {};
  for (const k of allowed) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, k)) patch[k] = fields[k];
  }
  patch.updated_at = new Date().toISOString();

  // 1. Try PATCH first (idempotent update of an existing row)
  const matchQs = new URLSearchParams({
    user_id: `eq.${userId}`,
    provider: `eq.${provider}`,
  }).toString();
  let res;
  try {
    res = await fetch(`${d.base}/integration_connections?${matchQs}`, {
      method: "PATCH",
      headers: { ...d.headers, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) {
      return { ok: true, id: rows[0].id, created: false };
    }
  }

  // 2. No existing row → INSERT
  const insertRow = {
    user_id: userId,
    provider,
    ...patch,
    created_at: new Date().toISOString(),
  };
  try {
    res = await fetch(`${d.base}/integration_connections`, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify(insertRow),
    });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `upstream_${res.status}`, detail: txt.slice(0, 200) };
  }
  const rows = await res.json();
  const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
  return { ok: true, id, created: true };
}

/**
 * Delete a connection (disconnect). Returns { ok }.
 */
export async function deleteConnection({ userId, provider, db, env } = {}) {
  const d = db || getServiceDb(env);
  if (!d) return { ok: false, error: "service_db_unconfigured" };
  const qs = new URLSearchParams({
    user_id: `eq.${userId}`,
    provider: `eq.${provider}`,
  }).toString();
  let res;
  try {
    res = await fetch(`${d.base}/integration_connections?${qs}`, {
      method: "DELETE",
      headers: { ...d.headers, Prefer: "return=minimal" },
    });
  } catch (err) {
    return { ok: false, error: "network", message: err?.message };
  }
  if (!res.ok) return { ok: false, error: `upstream_${res.status}` };
  return { ok: true };
}

export const _internal = { getServiceDb };
