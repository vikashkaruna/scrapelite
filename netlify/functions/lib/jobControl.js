// jobControl.js — the operator kill switch and the automation run log.
//
// Every platform cron is wrapped in `withJobRun`, which does three things:
//
//   1. Asks whether an operator has stopped this job, and returns without
//      running the body if so.
//   2. Writes a `job_runs` row when the run starts, and patches it when the run
//      ends — so a job that dies mid-flight leaves evidence.
//   3. Never lets its own bookkeeping break the job. A monitoring layer that can
//      take down billing is a worse problem than the one it was added to solve.
//
// ── THE FAILURE MODE THAT DRIVES THE DESIGN ──────────────────────────────────
//
// `isJobEnabled` FAILS OPEN. If Supabase is unreachable, or the config row is
// malformed, or the fetch times out, jobs RUN. This is the same asymmetry as
// requireEntitlement.js ("fail open on infrastructure, closed only on an
// explicitly-read status") and reserveCoupon in pricingSource.js, and it is not
// an oversight to be hardened later:
//
//   * Failing CLOSED means a Supabase blip silently stops billing, dunning and
//     every user's monitoring schedule — with no error anywhere, because "not
//     running" is exactly what a kill switch is supposed to look like. That is
//     the R19 bug (four unscheduled crons, no signal) reintroduced as a feature.
//   * Failing OPEN means a job an operator stopped might run once more during an
//     outage. Every job here is idempotent or interlocked against that:
//     billing-lifecycle keys its notices on the cycle, and billing-purge has
//     five further interlocks and ships disarmed.
//
// So the kill switch is an ADDITIONAL interlock, never the only one. For a
// break-glass stop that does not depend on the database at all, set the
// OPS_JOBS_DISABLED env var — that path cannot fail open, because it is read
// from the process environment.

import { JOB_IDS } from "../../../src/lib/monitoringModel.js";

const CONFIG_KEY = "ops";

// Warm-container cache. Short enough that an operator sees a stop take effect
// on the next fire of an hourly job, long enough that a cron that reads it once
// per run never adds a round trip that matters.
const CACHE_TTL_MS = 30_000;
let cache = { at: 0, value: null };

function db() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

// Bounded fetch. AbortSignal.timeout is deliberately avoided — see the
// "AbortSignal.timeout" entry in CLAUDE.md's critical-bugs list; it is not
// available across every runtime this code has run on.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Jobs stopped via env — a break-glass path that does not touch the database. */
function envDisabled() {
  return String(process.env.OPS_JOBS_DISABLED || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the operator control document (app_config row key='ops').
 *
 * Shape: { jobs: { "<job-id>": { enabled: boolean, reason?: string, at?: iso } } }
 * Returns {} on ANY failure — see the fail-open note at the top.
 */
export async function readOpsControl({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const d = db();
  if (!d) {
    cache = { at: Date.now(), value: {} };
    return {};
  }
  try {
    const res = await fetchWithTimeout(
      `${d.base}/app_config?key=eq.${CONFIG_KEY}&select=value&limit=1`,
      { headers: d.headers },
    );
    if (!res.ok) throw new Error(`app_config ${res.status}`);
    const rows = await res.json();
    const value = rows?.[0]?.value;
    const out = value && typeof value === "object" ? value : {};
    cache = { at: Date.now(), value: out };
    return out;
  } catch {
    // Do NOT cache a failure: the next call should retry rather than run blind
    // for the whole TTL.
    return {};
  }
}

/** Persist one job's enabled flag. Returns the merged control document. */
export async function writeJobEnabled(jobId, enabled, { reason = "", actor = "admin" } = {}) {
  const d = db();
  // `configured` is separate from `persisted` on purpose: the caller maps "there
  // is no database to write to" (503) and "the database refused the write"
  // (502) to different statuses, and both would otherwise be persisted:false.
  if (!d) return { ok: false, configured: false, persisted: false, error: "Supabase not configured." };

  const current = await readOpsControl({ force: true });
  const jobs = { ...(current.jobs || {}) };
  jobs[jobId] = {
    enabled: !!enabled,
    reason: String(reason || ""),
    at: new Date().toISOString(),
    by: actor,
  };
  const merged = { ...current, jobs };

  const res = await fetchWithTimeout(`${d.base}/app_config?on_conflict=key`, {
    method: "POST",
    headers: { ...d.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: CONFIG_KEY, value: merged, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    return { ok: false, configured: true, persisted: false, error: `Failed to persist (${res.status}).` };
  }
  cache = { at: Date.now(), value: merged };
  return { ok: true, persisted: true, control: merged };
}

/** Enabled state for every registered job, for the dashboard. */
export async function jobEnabledMap() {
  const control = await readOpsControl();
  const disabledByEnv = new Set(envDisabled());
  const out = {};
  for (const id of JOB_IDS) {
    const entry = control.jobs?.[id];
    const envOff = disabledByEnv.has(id);
    out[id] = {
      // Absent config means enabled: a job nobody has touched is running.
      enabled: envOff ? false : entry?.enabled !== false,
      source: envOff ? "env" : entry ? "config" : "default",
      reason: envOff ? "Stopped via OPS_JOBS_DISABLED." : entry?.reason || "",
      changedAt: envOff ? null : entry?.at || null,
      changedBy: envOff ? null : entry?.by || null,
    };
  }
  return out;
}

/** True unless an operator has explicitly stopped this job. Fails open. */
export async function isJobEnabled(jobId) {
  if (envDisabled().includes(jobId)) return false;
  const control = await readOpsControl();
  return control.jobs?.[jobId]?.enabled !== false;
}

// ── Run log ──────────────────────────────────────────────────────────────────

/**
 * Open a job_runs row. Returns a handle, or null when there is no database.
 *
 * Every failure here is swallowed: an unwritable run log must never stop the
 * job it is logging.
 */
export async function startJobRun(job, trigger = "schedule") {
  const d = db();
  if (!d) return null;
  try {
    const res = await fetchWithTimeout(`${d.base}/job_runs`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        job,
        status: "running",
        trigger: trigger === "manual" ? "manual" : "schedule",
        started_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    const id = rows?.[0]?.id;
    return id ? { id, job, startedAt: Date.now() } : null;
  } catch {
    return null;
  }
}

/** Close a job_runs row. Silent on failure, for the same reason. */
export async function finishJobRun(handle, { status = "success", detail = {}, error = null } = {}) {
  if (!handle?.id) return false;
  const d = db();
  if (!d) return false;
  try {
    const res = await fetchWithTimeout(`${d.base}/job_runs?id=eq.${encodeURIComponent(handle.id)}`, {
      method: "PATCH",
      headers: { ...d.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        finished_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - handle.startedAt),
        detail: detail && typeof detail === "object" ? detail : {},
        // Truncated: an error column is a signal, not a log sink.
        error: error ? String(error).slice(0, 1000) : null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Record a run that never started — the kill switch was on. */
export async function recordSkippedRun(job, reason, trigger = "schedule") {
  const d = db();
  if (!d) return false;
  try {
    const now = new Date().toISOString();
    const res = await fetchWithTimeout(`${d.base}/job_runs`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        job,
        status: "skipped",
        trigger: trigger === "manual" ? "manual" : "schedule",
        started_at: now,
        finished_at: now,
        duration_ms: 0,
        detail: { reason },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Most recent runs for one job, newest first. */
export async function listJobRuns(job, limit = 20) {
  const d = db();
  if (!d) return [];
  try {
    const n = Math.max(1, Math.min(100, Number(limit) || 20));
    const res = await fetchWithTimeout(
      `${d.base}/job_runs?job=eq.${encodeURIComponent(job)}` +
        `&select=id,job,status,trigger,started_at,finished_at,duration_ms,detail,error` +
        `&order=started_at.desc&limit=${n}`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Recent runs across every job in one round trip. */
export async function listRecentRuns(limit = 100) {
  const d = db();
  if (!d) return [];
  try {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    const res = await fetchWithTimeout(
      `${d.base}/job_runs?select=id,job,status,trigger,started_at,finished_at,duration_ms,detail,error` +
        `&order=started_at.desc&limit=${n}`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Some handlers return a Netlify response object; the run log wants a compact
// summary of what happened, not the whole body.
function detailFromResult(result) {
  if (!result || typeof result !== "object") return {};
  const out = {};
  if (typeof result.statusCode === "number") out.statusCode = result.statusCode;
  if (typeof result.body === "string") {
    try {
      const parsed = JSON.parse(result.body);
      if (parsed && typeof parsed === "object") {
        // Keep the scalar fields; drop arrays and nested objects so one busy run
        // cannot write a megabyte of JSON into the log.
        for (const [k, v] of Object.entries(parsed)) {
          if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
            out[k] = typeof v === "string" ? v.slice(0, 300) : v;
          }
        }
      }
    } catch {
      out.body = result.body.slice(0, 300);
    }
  }
  return out;
}

/**
 * Wrap a cron handler with the kill switch and the run log.
 *
 *   export const handler = withJobRun("reengagement", run);
 *
 * The wrapped handler keeps its original signature and return value. An error
 * is recorded and then RE-THROWN: swallowing it here would hide the failure
 * from Netlify's own function logs and retry behaviour, and the run log is
 * meant to add a view of failures, not to become the only one.
 */
export function withJobRun(job, fn) {
  return async (event = {}, context = {}) => {
    // A manual run from /admin/monitoring sets this flag; Netlify's scheduler
    // passes a bare event. Recorded so a surprising run can be traced to the
    // person who triggered it.
    const trigger = event?.opsTrigger === "manual" ? "manual" : "schedule";

    if (!(await isJobEnabled(job))) {
      await recordSkippedRun(job, "disabled_by_operator", trigger);
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true, job, skipped: true, reason: "disabled_by_operator",
          message: `${job} is stopped by an operator — no work was done.`,
        }),
      };
    }

    const handle = await startJobRun(job, trigger);
    try {
      const result = await fn(event, context);
      await finishJobRun(handle, { status: "success", detail: detailFromResult(result) });
      return result;
    } catch (err) {
      await finishJobRun(handle, { status: "error", error: err?.message || String(err) });
      throw err;
    }
  };
}

/** Test seam — the module-level cache is warm-container state, not test state. */
export function _resetOpsCacheForTests() {
  cache = { at: 0, value: null };
}

export const _internal = { detailFromResult, envDisabled, CONFIG_KEY, CACHE_TTL_MS };
