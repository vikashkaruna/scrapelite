// globalSettingsService.js — loads and caches global application settings
// (guest trial limits, etc.) from the admin-general-config endpoint.
// Falls back to built-in defaults when the server is unreachable (local dev).

const SETTINGS_KEY = "datiq.globalSettings";
const SETTINGS_TTL = 5 * 60 * 1000; // 5 min

export const DEFAULTS = {
  guest_trial_soft_limit: 3,
  guest_trial_reprompt_interval: 2,
  guest_single_hard_limit: 10,
  guest_batch_hard_limit: 5,
  // Contact page "Response times" card — three SLA rows editable by admins via
  // the /admin/general page. Each row is a (label, time) pair rendered in the
  // contact-page sidebar. Defaults are display copy only — they describe the
  // team's intended response posture, they are not enforced anywhere, and they
  // make no commitment to the user beyond the wording shown.
  contact_sla_general_label:    "General support",
  contact_sla_general_time:     "Within 48 h",
  contact_sla_billing_label:    "Billing issues",
  contact_sla_billing_time:     "Within 24 h",
  contact_sla_enterprise_label: "Enterprise enquiries",
  contact_sla_enterprise_time:  "Within 24 h",
};

function readCached() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const { ts, settings } = JSON.parse(raw);
    if (Date.now() - ts > SETTINGS_TTL) return null;
    return settings;
  } catch { return null; }
}

function writeCached(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ts: Date.now(), settings }));
  } catch { /* quota / private-mode */ }
}

/** Current settings synchronously — from cache or built-in defaults. */
export function getSettings() {
  return { ...DEFAULTS, ...(readCached() || {}) };
}

/** Async: fetch from server, cache, and return merged settings. */
export async function loadSettings() {
  // Cache-first: avoid hitting the network on every call. The cache
  // is invalidated by AdminGeneral's saveGeneralConfig (which calls
  // updateCachedSettings) or by the 5-min TTL.
  const cached = readCached();
  if (cached) return { ...DEFAULTS, ...cached };

  try {
    const res = await fetch("/api/admin-general-config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok && data.settings) {
      const merged = { ...DEFAULTS, ...data.settings };
      writeCached(merged);
      return merged;
    }
    throw new Error("no settings in response");
  } catch {
    return DEFAULTS;
  }
}

/** Save updated settings to cache (used by AdminGeneral after successful save). */
export function updateCachedSettings(settings) {
  writeCached({ ...DEFAULTS, ...settings });
}
