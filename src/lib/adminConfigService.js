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
