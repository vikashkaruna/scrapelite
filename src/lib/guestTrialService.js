// guestTrialService.js — tracks free-trial extraction count for non-logged-in visitors.
// Uses localStorage for persistence across page reloads + sessionStorage for a
// browser-session fingerprint so each browser session is identified.

const TRIAL_KEY = "datiq.guestTrial";
const SESSION_KEY = "datiq.sid";

export const TRIAL_LIMIT = 3;
const RE_PROMPT_INTERVAL = 2; // re-show prompt every N extractions after limit

function getOrCreateSid() {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return "unknown";
  }
}

function readTrial() {
  try {
    const raw = localStorage.getItem(TRIAL_KEY);
    return raw ? JSON.parse(raw) : { count: 0, sid: null };
  } catch {
    return { count: 0, sid: null };
  }
}

function writeTrial(data) {
  try { localStorage.setItem(TRIAL_KEY, JSON.stringify(data)); } catch { /* skip */ }
}

/** Current guest extraction count. */
export function getGuestCount() {
  return readTrial().count || 0;
}

/** Increment count by n. Returns new count. */
export function incrementGuestCount(n = 1) {
  const sid = getOrCreateSid();
  const data = readTrial();
  data.count = (data.count || 0) + n;
  data.sid = sid;
  writeTrial(data);
  return data.count;
}

/** True if the sign-up prompt should be shown for this count. */
export function shouldShowTrialPrompt(count) {
  if (count < TRIAL_LIMIT) return false;
  const excess = count - TRIAL_LIMIT;
  return excess === 0 || excess % RE_PROMPT_INTERVAL === 0;
}

/** True if the guest has reached or passed the trial limit. */
export function isTrialLimitReached(count) {
  return count >= TRIAL_LIMIT;
}

/** Clear trial state — called when user logs in. */
export function clearGuestTrial() {
  try { localStorage.removeItem(TRIAL_KEY); } catch { /* skip */ }
}
