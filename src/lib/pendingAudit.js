// src/lib/pendingAudit.js — stash a requested audit until there's a session
// to run it with.
//
// Audits are signed-in only (see discoverability.js's own header comment).
// Discoverability.jsx's run() opens the auth modal and returns when the
// caller isn't signed in — but for Google/Microsoft sign-in that means a
// full-page navigation away and back, which discards every bit of React
// state, including whatever the composer's URL field held. sessionStorage
// survives that round trip; component state does not. Same reasoning as
// lib/pendingWorkspaceInvite.js and lib/pendingSchedule.js.

const PENDING_KEY = "datiq.pendingAudit";

/** `payload` is exactly the object AuditComposer builds for onRun(). */
export function setPendingAudit(payload) {
  if (!payload || typeof payload !== "object" || !payload.target_url) return false;
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload)); return true; } catch { return false; }
}

export function getPendingAudit() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.target_url ? parsed : null;
  } catch { return null; }
}

export function clearPendingAudit() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* skip */ }
}
