// adminConfigService.js — client wrapper for the admin AI provider config.
// Reads/writes via /api/admin-ai-config; POST sends the admin session token
// (issued by admin-auth.js, stored by adminService.js) as a Bearer header.

const ENDPOINT = "/api/admin-ai-config";
const ADMIN_AUTH_KEY = "scrapelite.adminAuth"; // session token (see adminService.js)

function adminToken() {
  return localStorage.getItem(ADMIN_AUTH_KEY) || "";
}

/** Fetch current effective config + per-provider key presence. */
export async function getAiConfig() {
  const res = await fetch(ENDPOINT, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Failed to load AI config (${res.status})`);
  return res.json(); // { ok, config, keyPresence, providers, persisted }
}

/** Persist a new config. Returns { ok, persisted, warning? }. */
export async function saveAiConfig(config) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(config),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

// ── General / global settings ────────────────────────────────────────────────

const GENERAL_ENDPOINT = "/api/admin-general-config";

/** Fetch current global application settings. */
export async function getGeneralConfig() {
  const res = await fetch(GENERAL_ENDPOINT, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return res.json(); // { ok, settings, persisted }
}

/** Persist global settings. Returns { ok, persisted, warning? }. */
export async function saveGeneralConfig(settings) {
  const res = await fetch(GENERAL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ settings }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

// ── User management ──────────────────────────────────────────────────────────

const USERS_ENDPOINT = "/api/admin-users";

/** Fetch all registered users from Supabase auth. Returns { users, fromSeed, warning? }. */
export async function fetchRealUsers() {
  const res = await fetch(USERS_ENDPOINT, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load users (${res.status})`);
  return data;
}

/** Extend a user's bonus extractions by writing to their auth metadata. */
export async function extendUserBonus(userId, bonus) {
  const res = await fetch(USERS_ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ userId, bonus }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Extend failed (${res.status})`);
  return data; // { ok, userId, newBonus }
}

/** Send a Supabase auth invite email. Returns { ok, userId, email } or throws. */
export async function inviteUserByEmail(form) {
  const res = await fetch(USERS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Invite failed (${res.status})`), { status: res.status, localOnly: data.localOnly });
  return data;
}

