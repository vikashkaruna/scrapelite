// guestTrialService.js — tracks free-trial extraction count for non-logged-in
// visitors. Uses localStorage for persistence + sessionStorage for a browser-
// session fingerprint. Tracks single-URL extractions and batch runs separately.
//
// count      = total single-URL extractions (drives soft-prompt + single hard limit)
// batchCount = total batch runs (drives batch hard limit)

import { randomUuid } from "./secureRandom.js";

const TRIAL_KEY = "datiq.guestTrial";
const SESSION_KEY = "datiq.sid";

// Built-in fallback limits (overridden by global settings loaded from the server).
export const TRIAL_LIMIT = 3;          // soft-prompt after N single extractions
export const SINGLE_HARD_LIMIT = 10;   // hard block single-URL extraction after N
export const BATCH_HARD_LIMIT = 5;     // hard block batch mode after N runs
const RE_PROMPT_INTERVAL = 2;          // re-show soft prompt every N after limit

function getOrCreateSid() {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = randomUuid();
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
    return raw ? JSON.parse(raw) : { count: 0, batchCount: 0, sid: null };
  } catch {
    return { count: 0, batchCount: 0, sid: null };
  }
}

function writeTrial(data) {
  try { localStorage.setItem(TRIAL_KEY, JSON.stringify(data)); } catch { /* skip */ }
}

/** Current single-URL extraction count. */
export function getGuestCount() {
  return readTrial().count || 0;
}

/** Current batch run count. */
export function getGuestBatchCount() {
  return readTrial().batchCount || 0;
}

/** Increment single-URL count by n. Returns new count. */
export function incrementGuestCount(n = 1) {
  const sid = getOrCreateSid();
  const data = readTrial();
  data.count = (data.count || 0) + n;
  data.sid = sid;
  writeTrial(data);
  return data.count;
}

/** Increment batch run count by n. Returns new batch count. */
export function incrementGuestBatchCount(n = 1) {
  const sid = getOrCreateSid();
  const data = readTrial();
  data.batchCount = (data.batchCount || 0) + n;
  data.sid = sid;
  writeTrial(data);
  return data.batchCount;
}

/** True if the sign-up soft prompt should fire for this extraction count. */
export function shouldShowTrialPrompt(count, softLimit = TRIAL_LIMIT, interval = RE_PROMPT_INTERVAL) {
  if (count < softLimit) return false;
  const excess = count - softLimit;
  return excess === 0 || excess % interval === 0;
}

/** True if the guest has reached or passed the soft trial limit. */
export function isTrialLimitReached(count, softLimit = TRIAL_LIMIT) {
  return count >= softLimit;
}

/** True if the single-URL hard block should fire. */
export function isSingleHardLimitReached(count, hardLimit = SINGLE_HARD_LIMIT) {
  return count >= hardLimit;
}

/** True if the batch-mode hard block should fire. */
export function isBatchHardLimitReached(batchCount, hardLimit = BATCH_HARD_LIMIT) {
  return batchCount >= hardLimit;
}

/** Clear trial state — no longer auto-called on login; kept for future use. */
export function clearGuestTrial() {
  try { localStorage.removeItem(TRIAL_KEY); } catch { /* skip */ }
}
