// userWebhook.js — per-user webhook URL storage.
//
// The platform-wide VITE_WEBHOOK_URL is set per-deploy and shared
// across every user. That's fine for a single-tenant automation, but
// it doesn't let one DatIQ user pipe extractions to their own Zapier
// while another pipes to a different n8n instance. This module lets
// each user (each browser/device) override with their own URL, saved
// in localStorage.
//
// Precedence (resolved in src/lib/webhook.js at call time):
//   1. Per-user URL (this module)            — wins if set
//   2. Platform VITE_WEBHOOK_URL (config.js) — fallback
//   3. Nothing                                 — feature off, no-op
//
// The URL is stored as-is (no encryption). Treat localStorage like a
// notebook: anyone with the device can read it. We don't put it in
// the URL bar, we don't log it, and we don't ship it to the server.

const STORAGE_KEY = "datiq.webhook.url";

// Minimal validation. We accept http(s) and refuse javascript:/data:
// to prevent an XSS-style attack where a malicious saved URL is sent
// to fetch() at save time. We also refuse relative URLs.
export function isValidWebhookUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  // The URL constructor accepts "." as a hostname (it's a valid IDN
  // encoding escape) but nobody actually means that — reject it.
  if (parsed.hostname === "." || parsed.hostname.startsWith(".")) return false;
  return true;
}

// Read the user-set URL. Returns null when unset, empty string cleared,
// or invalid. The caller (webhook.js) reads this at call time, not at
// module load, so a user can update their URL and the next event uses
// the new value without a reload.
export function getUserWebhookUrl(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return isValidWebhookUrl(raw) ? raw : null;
}

// Save the URL. Throws on invalid input so the UI catches the error
// and shows a clear message instead of silently writing garbage.
export function setUserWebhookUrl(url, storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) throw new Error("userWebhook: no storage available");
  if (url == null || url === "") {
    storage.removeItem(STORAGE_KEY);
    return;
  }
  if (!isValidWebhookUrl(url)) {
    throw new Error("userWebhook: not a valid http(s) URL");
  }
  storage.setItem(STORAGE_KEY, url.trim());
}

// Remove the user-set URL. After this, the platform VITE_WEBHOOK_URL
// is used if set.
export function clearUserWebhookUrl(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}

export { STORAGE_KEY };
