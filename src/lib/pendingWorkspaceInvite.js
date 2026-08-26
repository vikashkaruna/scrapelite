// src/lib/pendingWorkspaceInvite.js — stash an invite token until there's a
// session to redeem it with.
//
// sessionStorage, not localStorage: same reasoning as lib/pendingSchedule.js
// and referralService.js's pending code — OAuth navigates the whole document
// away and back, discarding in-memory state, and a stashed invite should not
// outlive the visit that arrived with it.

const PENDING_KEY = "datiq.pendingWorkspaceInvite";

export function setPendingWorkspaceInvite(token) {
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) return false;
  try { sessionStorage.setItem(PENDING_KEY, clean); return true; } catch { return false; }
}

export function getPendingWorkspaceInvite() {
  try { return sessionStorage.getItem(PENDING_KEY) || ""; } catch { return ""; }
}

export function clearPendingWorkspaceInvite() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* skip */ }
}
