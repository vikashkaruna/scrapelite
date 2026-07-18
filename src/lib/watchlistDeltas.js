// src/lib/watchlistDeltas.js — FC1 (Watchlist Home: monitored URLs + deltas).
//
// Council intent: "The Bloomberg-terminal opening screen for web data; gives
// history + monitoring a daily-open surface."
//
// Pure logic layer. Given a list of schedules (with lastHash, lastRunAt,
// lastStatus) and a "last visited at" timestamp, return the delta summary
// the Workspace needs for its top-of-page card.
//
// "Changed" = lastChangeAt > lastVisitedAt OR (lastStatus === "changed"
// AND we haven't seen the new hash yet).
// "Unchanged" = lastRunAt > lastVisitedAt AND lastStatus === "unchanged".
// "Stale" = lastRunAt <= lastVisitedAt OR no lastRunAt yet.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function classifyDelta(schedule, lastVisitedAt) {
  if (!schedule) return { kind: "unknown", label: "Unknown" };
  const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
  const lastChange = schedule.lastChangeAt ? new Date(schedule.lastChangeAt).getTime() : 0;
  const visited = lastVisitedAt ? new Date(lastVisitedAt).getTime() : 0;

  if (!lastRun) {
    return { kind: "never_run", label: "Not run yet" };
  }
  if (lastChange > visited && schedule.lastStatus === "changed") {
    return { kind: "changed_since_visit", label: "Changed" };
  }
  if (lastChange > visited) {
    return { kind: "changed_since_visit", label: "Changed" };
  }
  if (lastRun > visited) {
    return { kind: "ran_since_visit", label: "No change" };
  }
  return { kind: "stale", label: "No activity" };
}

export function summariseWatchlist(schedules, lastVisitedAt, now = Date.now()) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return {
      total: 0,
      changed: 0,
      unchanged: 0,
      stale: 0,
      neverRun: 0,
      nextRunAt: null,
      rows: [],
    };
  }
  const rows = schedules
    .map((s) => ({ schedule: s, delta: classifyDelta(s, lastVisitedAt) }))
    .sort((a, b) => {
      // Changed first, then ran-since-visit, then stale, then never-run
      const order = { changed_since_visit: 0, ran_since_visit: 1, stale: 2, never_run: 3, unknown: 4 };
      return (order[a.delta.kind] ?? 99) - (order[b.delta.kind] ?? 99);
    });
  const counts = rows.reduce(
    (acc, r) => {
      if (r.delta.kind === "changed_since_visit") acc.changed++;
      else if (r.delta.kind === "ran_since_visit") acc.unchanged++;
      else if (r.delta.kind === "stale") acc.stale++;
      else if (r.delta.kind === "never_run") acc.neverRun++;
      return acc;
    },
    { changed: 0, unchanged: 0, stale: 0, neverRun: 0 },
  );
  const nextRunAt = schedules
    .map((s) => (s.nextRunAt ? new Date(s.nextRunAt).getTime() : null))
    .filter((n) => n != null && n > now)
    .sort((a, b) => a - b)[0] || null;

  return {
    total: rows.length,
    ...counts,
    nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
    rows,
  };
}

// "Visit tracking" — remembers the last time the user opened /workspace.
// Persisted in localStorage so it survives reloads.
const VISIT_KEY = "datiq.workspaceLastVisitedAt";

export function readLastVisitedAt() {
  try {
    const v = localStorage.getItem(VISIT_KEY);
    if (!v) return null;
    return v;
  } catch { return null; }
}

export function writeLastVisitedAt(iso = new Date().toISOString()) {
  try { localStorage.setItem(VISIT_KEY, iso); } catch { /* skip */ }
  return iso;
}

export const _internal = { MS_PER_DAY };
