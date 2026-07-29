// monitoringService.js — client wrapper for the ops monitoring endpoints.
//
// Mirrors adminConfigService.js: reads the admin session token that
// adminService.js stored, sends it as a Bearer header, and throws an Error
// carrying the server's own message so the page can show something useful
// instead of "Failed (500)".
//
// No caching. Both of these answer "what is true right now", and a stale
// monitoring dashboard is worse than a slow one.

const MONITORING_ENDPOINT = "/api/admin-monitoring";
const HEALTH_ENDPOINT = "/api/admin-health";
const ADMIN_AUTH_KEY = "scrapelite.adminAuth"; // session token (see adminService.js)

function adminToken() {
  try {
    return localStorage.getItem(ADMIN_AUTH_KEY) || "";
  } catch {
    return "";
  }
}

function authHeaders(extra = {}) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}`, ...extra };
}

async function parse(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface the server's wording. These endpoints explain *why* they refused
    // (a missing reason, a destructive job, an unconfigured database), and that
    // explanation is the whole value of the error.
    const err = new Error(data.error || `${fallback} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Automation ───────────────────────────────────────────────────────────────

/** Jobs, user schedules, run history and the recent audit trail. */
export async function getMonitoringSnapshot() {
  const res = await fetch(MONITORING_ENDPOINT, { headers: authHeaders() });
  return parse(res, "Failed to load monitoring data");
}

async function control(payload) {
  const res = await fetch(MONITORING_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parse(res, "Action failed");
}

/** Start or stop a platform cron. `reason` is mandatory — the server rejects a blank one. */
export function setJobEnabled(job, enabled, reason) {
  return control({ action: "set_job_enabled", job, enabled, reason });
}

/** Trigger a non-destructive cron by hand. billing-purge is refused server-side. */
export function runJobNow(job, reason) {
  return control({ action: "run_job", job, reason });
}

/** System-pause one user's schedule (distinct from the user's own pause). */
export function pauseSchedule(id, reason) {
  return control({ action: "pause_schedule", id, reason });
}

/** Release a system pause. Does not override a pause the user set themselves. */
export function resumeSchedule(id, reason) {
  return control({ action: "resume_schedule", id, reason });
}

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * Probe every service, host and database now.
 *
 * @param {object} opts
 * @param {number} opts.windowHours uptime window (default 24, clamped server-side)
 * @param {boolean} opts.record     also store this round as samples
 */
export async function getHealthSnapshot({ windowHours = 24, record = false } = {}) {
  const qs = new URLSearchParams();
  if (windowHours !== 24) qs.set("window", String(windowHours));
  if (record) qs.set("record", "1");
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`${HEALTH_ENDPOINT}${suffix}`, { headers: authHeaders() });
  return parse(res, "Failed to load health data");
}
