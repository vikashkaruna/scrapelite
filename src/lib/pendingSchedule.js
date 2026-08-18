// pendingSchedule.js — holds a schedule a signed-out user just built, so it can
// be saved for real the moment they sign in.
//
// Why this exists: saveSchedule() posts to /api/schedules, a signed-out user
// gets 401, and schedulerService.shouldFallback() treated 401 as "backend
// unreachable" and kept the schedule in localStorage only. But the thing that
// actually RUNS schedules — netlify/functions/scheduled-runner.js, hourly —
// reads Supabase `scheduled_tasks`. It has no way to see a browser's
// localStorage. So a guest's schedule showed up in the Schedules table looking
// active, reported a next run time, and then never fired. Silently, forever.
//
// sessionStorage rather than a module variable because OAuth sign-in navigates
// the whole document away and back, which would discard in-memory state.

const KEY = "datiq.pendingSchedule";

/** Stash a schedule to save after sign-in. */
export function setPendingSchedule(schedule) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ schedule, stashedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false; // private mode / quota — caller falls back to a plain prompt
  }
}

/** Read the stashed schedule without consuming it. */
export function peekPendingSchedule() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.schedule || null;
  } catch {
    return null;
  }
}

/** Read and remove the stashed schedule. Returns null when there isn't one. */
export function takePendingSchedule() {
  const schedule = peekPendingSchedule();
  clearPendingSchedule();
  return schedule;
}

export function clearPendingSchedule() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
