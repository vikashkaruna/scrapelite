// schedulerService.js — recurring extraction & "track changes" schedules.
//
// A schedule turns a one-shot extraction into a recurring workflow:
//   • type "track"  → re-extract a single URL on a cadence; alert when content changes
//   • type "batch"  → re-run a multi-URL batch on a cadence
//
// Persistence: localStorage-first (key `datiq.schedules`) so the feature works
// with no backend, with optional Supabase sync via /api/schedules (same
// degrade-gracefully pattern as extractionsRepo.js). The actual recurring
// execution is performed server-side by netlify/functions/scheduled-runner.js
// (a Netlify Scheduled Function) — see that file + the SQL in CLAUDE.md.

import { uid, hashContent } from "./utils.js";
import { apiClient } from "./apiClient.js";

const LS_KEY = "datiq.schedules";
const MAX_SCHEDULES = 50;

// ── Cadence presets ──────────────────────────────────────────────────────────
// Intelligent defaults covering the common monitoring rhythms. `cron` is a
// standard 5-field expression evaluated server-side (UTC).
export const SCHEDULE_PRESETS = [
  { key: "6h",      label: "Every 6 hours",   desc: "Frequent monitoring",        icon: "clock",    cron: "0 */6 * * *",  approxPerDay: 4 },
  { key: "12h",     label: "Twice daily",     desc: "Morning & evening",          icon: "clock",    cron: "0 9,21 * * *", approxPerDay: 2 },
  { key: "daily",   label: "Daily",           desc: "Once every morning (9:00)",  icon: "calendar", cron: "0 9 * * *",    approxPerDay: 1 },
  { key: "weekday", label: "Every weekday",   desc: "Mon–Fri at 9:00",            icon: "calendar", cron: "0 9 * * 1-5",  approxPerDay: 1 },
  { key: "weekly",  label: "Weekly",          desc: "Mondays at 9:00",            icon: "calendar", cron: "0 9 * * 1",    approxPerDay: 0 },
  { key: "monthly", label: "Monthly",         desc: "1st of the month at 9:00",   icon: "calendar", cron: "0 9 1 * *",    approxPerDay: 0 },
];

export const DEFAULT_PRESET_KEY = "daily";

export function presetByKey(key) {
  return SCHEDULE_PRESETS.find((p) => p.key === key) || SCHEDULE_PRESETS.find((p) => p.key === DEFAULT_PRESET_KEY);
}

// ── Custom cadence builder (used by the /schedules editor) ────────────────────
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Build a 5-field cron from friendly editor inputs.
export function buildCron({ frequency = "daily", hour = 9, minute = 0, weekday = 1, dayOfMonth = 1, everyHours = 6 }) {
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  const h = Math.max(0, Math.min(23, Number(hour) || 0));
  switch (frequency) {
    case "hourly":  return `0 */${Math.max(1, Math.min(23, Number(everyHours) || 6))} * * *`;
    case "weekly":  return `${m} ${h} * * ${weekday}`;
    case "monthly": return `${m} ${h} ${Math.max(1, Math.min(28, Number(dayOfMonth) || 1))} * *`;
    case "weekday": return `${m} ${h} * * 1-5`;
    case "daily":
    default:        return `${m} ${h} * * *`;
  }
}

// Human-readable description of a cron string (covers the shapes we generate).
export function describeCron(cron) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return cron || "Custom";
  const [min, hour, dom, , dow] = parts;
  const time = () => {
    const h = parseInt(hour, 10); const m = parseInt(min, 10) || 0;
    if (!Number.isFinite(h)) return "";
    const ap = h < 12 ? "AM" : "PM"; const hr = ((h + 11) % 12) + 1;
    return ` at ${hr}:${String(m).padStart(2, "0")} ${ap}`;
  };
  if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  if (dow === "1-5") return `Every weekday${time()}`;
  if (dow !== "*" && dow !== "?") {
    const days = dow.split(",").map((d) => DOW_NAMES[parseInt(d, 10)] || d).join(", ");
    return `Weekly on ${days}${time()}`;
  }
  if (dom !== "*" && dom !== "?") return `Monthly on day ${dom}${time()}`;
  return `Daily${time()}`;
}

export function cadenceLabel(schedule) {
  if (!schedule) return "";
  const p = SCHEDULE_PRESETS.find((x) => x.key === schedule.cadenceKey);
  if (p) return p.label;
  return describeCron(schedule.cron);
}

// ── Next-run estimation (display only; server is the source of truth) ─────────
// A lightweight approximation so the UI can show "next run ~tomorrow 9:00".
export function estimateNextRun(cron, from = new Date()) {
  try {
    const [min, hour] = cron.split(" ");
    const next = new Date(from);
    next.setSeconds(0, 0);
    const targetHour = hour.includes("*") ? from.getHours() : parseInt(hour, 10);
    const targetMin = min.includes("*") ? 0 : parseInt(min, 10);
    if (Number.isFinite(targetHour) && Number.isFinite(targetMin)) {
      next.setHours(targetHour, targetMin);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next.toISOString();
    }
  } catch { /* fall through */ }
  // Fallback: ~1 day out.
  return new Date(from.getTime() + 86400000).toISOString();
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

// Errors that mean "no backend / not reachable" → degrade to localStorage only.
// 502/504 are included alongside 500/503 because a proxy/gateway in front of
// the Netlify Function (including the local dev proxy when `netlify dev`
// isn't running) reports an unreachable upstream as Bad Gateway / Gateway
// Timeout, not a 500 — without these, schedule creation fails outright
// instead of degrading to localStorage the moment functions aren't running.
//
// 401/403 are DELIBERATELY NOT HERE, unlike extractionsRepo's same-named
// helper. The asymmetry is the point: an extraction kept in localStorage still
// works — the user can see it, export it, come back to it. A schedule kept in
// localStorage is inert, because the thing that runs schedules is an hourly
// Netlify function reading Supabase, which cannot see a browser's storage. So
// treating "you are not signed in" as "the backend is down" produced a
// schedule that rendered as active, showed a next run time, and never fired.
// Callers must handle a 401 by getting the user signed in (see
// lib/pendingSchedule.js) rather than pretending the save succeeded.
function shouldFallback(err) {
  const s = err?.status;
  return (
    err?.useLocalStorage ||
    s === undefined || s === 404 ||
    s === 500 || s === 502 || s === 503 || s === 504
  );
}

/** True when this error means "sign in first", not "the backend is broken". */
export function isAuthError(err) {
  const s = err?.status;
  return s === 401 || s === 403;
}

// ── Public CRUD ───────────────────────────────────────────────────────────────

// Build a schedule object from composer / editor state. Does not persist.
// Pass either a preset `cadenceKey` OR cadenceKey:"custom" with an explicit `cron`.
export function buildSchedule({
  type, target, intent = "summary", customPrompt = "",
  cadenceKey = DEFAULT_PRESET_KEY, cron = "", alertEmail = "", label = "",
  renderJs = false, expiresAt = null,
}) {
  const isCustom = cadenceKey === "custom" && cron;
  const preset = isCustom ? null : presetByKey(cadenceKey);
  const effectiveCron = isCustom ? cron : preset.cron;
  const now = new Date().toISOString();
  return {
    id: "sch_" + uid().slice(3),
    type,                                  // "track" | "batch"
    target,                                // string (track) | string[] (batch)
    intent,
    customPrompt,
    renderJs,
    cadenceKey: isCustom ? "custom" : preset.key,
    cron: effectiveCron,
    alertEmail: alertEmail.trim(),
    expiresAt: expiresAt || null,          // ISO date string or null (no end)
    label: label.trim() || defaultLabel(type, target),
    status: "active",                      // "active" | "paused"
    createdAt: now,
    lastRunAt: null,
    lastHash: null,
    lastStatus: null,                      // "unchanged" | "changed" | "error" | null
    lastChangeAt: null,
    nextRunAt: estimateNextRun(effectiveCron),
    runCount: 0,
  };
}

// Apply editor changes to an existing schedule (preserves run history + id).
export function applyEdits(schedule, edits = {}) {
  const next = { ...schedule, ...edits };
  if (edits.cron || edits.cadenceKey) {
    next.nextRunAt = estimateNextRun(next.cron);
  }
  if (typeof next.label === "string") next.label = next.label.trim() || defaultLabel(next.type, next.target);
  if (typeof next.alertEmail === "string") next.alertEmail = next.alertEmail.trim();
  return next;
}

function defaultLabel(type, target) {
  if (type === "batch") {
    const n = Array.isArray(target) ? target.length : 0;
    return `Batch monitor · ${n} URLs`;
  }
  try { return `Track · ${new URL(target).hostname.replace(/^www\./, "")}`; }
  catch { return "Tracked page"; }
}

export async function listSchedules() {
  const local = readLocal();
  try {
    const remote = await apiClient.listSchedules();
    if (Array.isArray(remote)) {
      // Merge: server is the source of truth, but local-only items
      // (created offline or before the user signed in) are preserved
      // so they survive a server round-trip that returns []. The merge
      // also tolerates a transient server hiccup that returns []
      // mid-session: the local-only entries are kept around so the
      // next successful push can sync them up.
      if (remote.length === 0 && local.length > 0) {
        // Don't wipe local when the server says empty — the local items
        // may not have synced yet. Use the local set as the answer.
        return local;
      }
      // Server has authoritative data. Persist and return. Local-only
      // items (any with no server counterpart) are preserved so they
      // can be re-pushed by the next mutation.
      const remoteIds = new Set(remote.map((s) => s.id));
      const localOnly = local.filter((s) => s.id && !remoteIds.has(s.id));
      const merged = [...remote, ...localOnly];
      writeLocal(merged);
      return merged;
    }
  } catch (err) {
    // Reading is different from writing: a signed-out user should still see
    // the drafts sitting in their browser, so an auth error is fine here.
    // saveSchedule() is the one that must refuse to fake success.
    if (!shouldFallback(err) && !isAuthError(err)) throw err;
  }
  return local;
}

// Synchronous read for instant first paint (mirrors Dashboard's localStorage-first pattern).
export function listSchedulesLocal() {
  return readLocal();
}

export async function saveSchedule(schedule) {
  // Snapshot before any mutation, so a real (non-infra) rejection can be
  // rolled back cleanly — a schedule the server refuses to store (e.g. an
  // entitlement denial) will never actually run via scheduled-runner.js,
  // so leaving it in localStorage would show as "active" while being dead.
  const before = readLocal();
  const list = [...before];
  const idx = list.findIndex((s) => s.id === schedule.id);
  if (idx >= 0) {
    list[idx] = schedule;
  } else {
    // Q11 — analytics: monitor / schedule created (only on first save, not updates)
    try {
      const { lifecycle: analytics } = await import("./analyticsService.js");
      analytics.monitorCreated({ url: schedule.url, cadence: schedule.cadenceKey, name: schedule.name });
    } catch { /* analytics is best-effort */ }
    // Cap at MAX_SCHEDULES — reject the 51st.
    if (list.length >= MAX_SCHEDULES) {
      throw new Error(`Schedule limit reached (${MAX_SCHEDULES}). Delete one before adding another.`);
    }
    list.unshift(schedule);
  }
  // Optimistic local write so the UI updates immediately even if the backend is down.
  writeLocal(list);

  try {
    const saved = await apiClient.upsertSchedule(schedule);
    if (saved?.id) {
      // `_localOnly` is cleared here: the row reached Supabase, so
      // scheduled-runner.js can now see it and it will actually fire.
      const merged = readLocal().map((s) =>
        s.id === schedule.id ? { ...s, ...saved, _localOnly: false } : s,
      );
      writeLocal(merged);
      return merged.find((s) => s.id === saved.id) || saved;
    }
  } catch (err) {
    if (shouldFallback(err)) {
      // Backend unreachable — the local-only save stands, but flag it so the
      // Schedules table can say out loud that it isn't running yet. An
      // unflagged local row is indistinguishable from a live one, which is
      // exactly how these went unnoticed.
      const flagged = readLocal().map((s) =>
        s.id === schedule.id ? { ...s, _localOnly: true } : s,
      );
      writeLocal(flagged);
      return { ...schedule, _localOnly: true };
    }
    // A real rejection (e.g. 402 "scheduled monitoring is not on your plan",
    // or a validation error) — undo the optimistic write and surface the
    // server's actual reason (err.message) rather than leaving a phantom entry.
    writeLocal(before);
    throw err;
  }
  return schedule;
}

export async function deleteSchedule(id) {
  writeLocal(readLocal().filter((s) => s.id !== id));
  // Deleting is like listing, not like saving: a signed-out user removing a
  // local-only draft has nothing on the server to delete, so a 401 is a no-op
  // rather than a failure.
  try { await apiClient.deleteSchedule(id); }
  catch (err) { if (!shouldFallback(err) && !isAuthError(err)) throw err; }
}

export async function toggleSchedule(id) {
  const list = readLocal();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  s.status = s.status === "active" ? "paused" : "active";
  if (s.status === "active") s.nextRunAt = estimateNextRun(s.cron);
  writeLocal(list);
  // Same reasoning as deleteSchedule: pausing a local-only draft is local.
  try { await apiClient.upsertSchedule(s); }
  catch (err) { if (!shouldFallback(err) && !isAuthError(err)) throw err; }
  return s;
}

// Record the outcome of a run (used by the local "Run now" action and to reflect
// server runs that the UI re-fetches). Compares the new content hash against the
// stored one to flag a change.
export function recordRun(id, { content, error } = {}) {
  const list = readLocal();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  const now = new Date().toISOString();
  s.lastRunAt = now;
  s.runCount = (s.runCount || 0) + 1;
  s.nextRunAt = estimateNextRun(s.cron, new Date());
  if (error) {
    s.lastStatus = "error";
  } else {
    const newHash = hashContent(content || "");
    if (s.lastHash && s.lastHash !== newHash) {
      s.lastStatus = "changed";
      s.lastChangeAt = now;
    } else {
      s.lastStatus = "unchanged";
    }
    s.lastHash = newHash;
  }
  writeLocal(list);
  return s;
}
