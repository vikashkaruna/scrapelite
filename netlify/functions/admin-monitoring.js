// admin-monitoring.js — automation monitoring and control for /admin/monitoring.
//
//   GET  /api/admin-monitoring          → platform jobs + user schedules + run history
//   POST /api/admin-monitoring          → one control action (see ACTIONS below)
//
// Both are gated by the admin session token. GET is gated too, not just POST:
// the response lists every user's schedule targets and the internal job ids.
//
// ── EVERY MUTATION REQUIRES A WRITTEN REASON ─────────────────────────────────
// Same rule as admin-billing.js. A blank reason is a REJECTED REQUEST, not an
// empty audit row — an entry that says only "someone stopped the billing cron"
// looks like an answer while containing none. The database enforces it too
// (ops_audit_log's CHECK, 0018), so neither layer can be the only guard.
//
// ── THE DESTRUCTIVE JOB CANNOT BE TRIGGERED FROM HERE ────────────────────────
// `run_job` refuses billing-purge. Every other control on this endpoint is
// reversible; deletion is not, so it keeps exactly one trigger path — its
// schedule. The rule lives in monitoringModel.js (`manualRunAllowed`) so the UI
// disables the button and the server rejects the call, independently.

import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import {
  jobEnabledMap, writeJobEnabled, listRecentRuns, _resetOpsCacheForTests,
} from "./lib/jobControl.js";
import {
  AUTOMATION_JOBS, JOB_IDS, jobById, canRunManually,
  deriveJobStatus, deriveScheduleStatus, summarizeJobs, summarizeSchedules,
} from "../../src/lib/monitoringModel.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

const ACTIONS = new Set([
  "set_job_enabled",   // start/stop a platform cron
  "run_job",           // trigger a non-destructive cron by hand
  "pause_schedule",    // system-pause one user's schedule
  "resume_schedule",   // release a system pause we applied
]);

// Static map so esbuild bundles each target. billing-purge is deliberately
// absent: a module that is never imported cannot be invoked by a typo.
const RUNNABLE = {
  "scheduled-runner": () => import("./scheduled-runner.js"),
  "reengagement": () => import("./reengagement.js"),
  "billing-lifecycle": () => import("./billing-lifecycle.js"),
  "health-monitor": () => import("./health-monitor.js"),
};

// Marks a schedule paused by an admin rather than by the billing lifecycle.
// billing-lifecycle's resume is scoped by system_pause_reason, so using a
// distinct value here means a subscription reactivation will NOT silently
// un-pause something an operator stopped on purpose (and vice versa).
const ADMIN_PAUSE_REASON = "admin_paused";

function db() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort user directory lookup. We hit auth.users with the service key —
 * a real table read rather than `auth.admin.getUserById` in a loop, because
 * the loop is N HTTP round-trips and the dashboard asks for 200 schedules at
 * a time. Returns a Map<userId, { email, createdAt }>. On ANY failure returns
 * an empty map; the UI shows the raw userId and never pretends to know more.
 */
async function loadUserEmails(ids) {
  const out = new Map();
  if (!ids?.length) return out;
  const d = db();
  if (!d) return out;
  // Cap to keep the URL under sensible limits. 200 ids → ~7.2 KB.
  const slice = ids.slice(0, 200);
  const filter = slice.map((id) => `"${id}"`).join(",");
  try {
    const url = `${d.base}/auth.users?select=id,email,created_at&id=in.(${filter})&limit=${slice.length}`;
    const res = await fetchWithTimeout(url, { headers: d.headers });
    if (!res.ok) return out;
    const rows = await res.json().catch(() => []);
    for (const r of rows) {
      if (r?.id) out.set(r.id, {
        email: r.email || "",
        createdAt: r.created_at || "",
      });
    }
  } catch { /* empty map — UI shows the userId */ }
  return out;
}

async function loadSchedules(limit = 200) {
  const d = db();
  if (!d) return [];
  try {
    const n = Math.max(1, Math.min(500, Number(limit) || 200));
    const res = await fetchWithTimeout(
      `${d.base}/scheduled_tasks?select=id,user_id,status,cron,next_run_at,system_paused,` +
        `system_pause_reason,created_at,updated_at,data&order=updated_at.desc&limit=${n}`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeAudit({ actor, action, target, reason, detail }) {
  const d = db();
  if (!d) return false;
  try {
    const res = await fetchWithTimeout(`${d.base}/ops_audit_log`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        actor, action, target,
        reason: String(reason).slice(0, 1000),
        detail: detail && typeof detail === "object" ? detail : {},
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function recentAudit(limit = 25) {
  const d = db();
  if (!d) return [];
  try {
    const n = Math.max(1, Math.min(100, Number(limit) || 25));
    const res = await fetchWithTimeout(
      `${d.base}/ops_audit_log?select=id,actor,action,target,reason,detail,created_at` +
        `&order=created_at.desc&limit=${n}`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Flip system_paused on one schedule. Only the service key may write these columns. */
async function setSchedulePaused(id, paused) {
  const d = db();
  if (!d) return { ok: false, error: "Supabase not configured." };
  try {
    const res = await fetchWithTimeout(
      `${d.base}/scheduled_tasks?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { ...d.headers, Prefer: "return=representation" },
        body: JSON.stringify(
          paused
            ? { system_paused: true, system_pause_reason: ADMIN_PAUSE_REASON }
            : { system_paused: false, system_pause_reason: null },
        ),
      },
    );
    if (!res.ok) return { ok: false, error: `Supabase returned HTTP ${res.status}.` };
    const rows = await res.json().catch(() => []);
    if (!rows.length) return { ok: false, error: "No schedule with that id." };
    return { ok: true, row: rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Group runs by job, newest first, so each job gets its own history without a
// query per job.
function indexRuns(runs) {
  const byJob = {};
  for (const r of runs) (byJob[r.job] ||= []).push(r);
  return byJob;
}

async function buildSnapshot() {
  const [enabledMap, runs, scheduleRows, audit] = await Promise.all([
    jobEnabledMap(),
    listRecentRuns(200),
    loadSchedules(200),
    recentAudit(25),
  ]);

  const byJob = indexRuns(runs);
  const now = new Date();

  const jobs = AUTOMATION_JOBS.map((job) => {
    const history = byJob[job.id] || [];
    const control = enabledMap[job.id] || { enabled: true, source: "default" };
    const status = deriveJobStatus(job, {
      enabled: control.enabled,
      lastRun: history[0] || null,
      lastSuccess: history.find((r) => r.status === "success") || null,
      now,
    });
    return {
      id: job.id,
      label: job.label,
      description: job.description,
      schedule: job.schedule,
      cron: job.cron,
      category: job.category,
      destructive: !!job.destructive,
      critical: !!job.critical,
      caveat: job.caveat || "",
      manualRunAllowed: canRunManually(job.id),
      enabled: control.enabled,
      control,
      ...status,
      // Capped: the dashboard shows a short history inline and nothing needs
      // 200 rows per job in one payload.
      runs: history.slice(0, 10),
    };
  });

  const schedules = scheduleRows.map((r) => deriveScheduleStatus(r, now));

  // Operational toggles the dashboard needs to explain why a job is in the
  // state it is. All are advisory, do not gate any control, and never include
  // the value of any secret.
  const envFlags = {
    purgeEnabled: process.env.PURGE_ENABLED === "1",
    purgeDryRun:  process.env.PURGE_DRY_RUN === "1",
    opsJobsDisabled: String(process.env.OPS_JOBS_DISABLED || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };

  // Per-user schedules enriched with the owning account's email + signup date.
  // We only fetch this when there's a service key, since auth.users is gated
  // to the service role. On the failure path the schedules still come back
  // with `userId` only — the UI must show that.
  const userEmails = await loadUserEmails(
    Array.from(new Set(schedules.map((s) => s.userId).filter(Boolean))),
  );

  return {
    ok: true,
    generatedAt: now.toISOString(),
    jobs,
    jobSummary: summarizeJobs(jobs),
    schedules: schedules.map((s) => ({
      ...s,
      // Attach the user directory if we have it. The server is the only place
      // that can read auth.users with the service key; the client never sees
      // a service key. If the lookup failed, userId is still in the response
      // and the UI shows it.
      user: s.userId ? (userEmails.get(s.userId) || { email: "", createdAt: "" }) : null,
    })),
    scheduleSummary: summarizeSchedules(schedules),
    audit,
    envFlags,
    // The dashboard renders very differently with no history: without Supabase
    // every job reads "never run", which is true but would otherwise look like
    // a five-alarm fire rather than an unconfigured environment.
    historyAvailable: !!db(),
  };
}

export const handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const auth = verifyAdminToken(bearerFromEvent(event));
  if (!auth.ok) return respond(401, { ok: false, error: auth.reason });

  const actor = auth.demo ? "admin:demo" : "admin";

  // ── GET ───────────────────────────────────────────────────────────────────
  if (!event.httpMethod || event.httpMethod === "GET") {
    try {
      return respond(200, { ...(await buildSnapshot()), demo: auth.demo === true });
    } catch (err) {
      return respond(500, { ok: false, error: err.message });
    }
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method not allowed." });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { ok: false, error: "Invalid JSON." }); }

  const { action, job, id, enabled, reason } = body;

  if (!ACTIONS.has(action)) {
    return respond(400, { ok: false, error: `Unknown action. Expected one of: ${[...ACTIONS].join(", ")}.` });
  }

  // Checked before anything else so no code path can reach a mutation without
  // one. `String(reason ?? "")` because a numeric or null reason is not a reason.
  const trimmedReason = String(reason ?? "").trim();
  if (!trimmedReason) {
    return respond(400, {
      ok: false,
      error: "A reason is required. It is written to the audit log and read by whoever investigates this later.",
    });
  }

  try {
    switch (action) {
      // ── Start / stop a platform cron ────────────────────────────────────
      case "set_job_enabled": {
        if (!JOB_IDS.includes(job)) {
          return respond(400, { ok: false, error: `Unknown job "${job}".` });
        }
        if (typeof enabled !== "boolean") {
          return respond(400, { ok: false, error: "`enabled` must be true or false." });
        }
        const res = await writeJobEnabled(job, enabled, { reason: trimmedReason, actor });
        // 503 = there is no database to write the switch to (the operator needs
        // to configure Supabase). 502 = the database rejected the write (an
        // upstream fault). Collapsing them sends the operator to the wrong place.
        if (!res.ok) return respond(res.configured === false ? 503 : 502, { ok: false, error: res.error });

        await writeAudit({
          actor, action: enabled ? "job_enable" : "job_disable",
          target: job, reason: trimmedReason,
          detail: { enabled, destructive: !!jobById(job)?.destructive },
        });
        return respond(200, {
          ok: true, job, enabled,
          message: enabled ? `${job} will run on its next schedule.` : `${job} is stopped.`,
        });
      }

      // ── Trigger a cron by hand ──────────────────────────────────────────
      case "run_job": {
        if (!JOB_IDS.includes(job)) {
          return respond(400, { ok: false, error: `Unknown job "${job}".` });
        }
        if (!canRunManually(job)) {
          // 403, not 400: the request is well-formed and deliberately refused.
          return respond(403, {
            ok: false,
            error: `"${job}" cannot be triggered by hand. It is destructive, so its schedule is its only trigger path.`,
          });
        }
        const load = RUNNABLE[job];
        if (!load) return respond(400, { ok: false, error: `No runner is wired for "${job}".` });

        await writeAudit({ actor, action: "job_run", target: job, reason: trimmedReason, detail: { trigger: "manual" } });

        const mod = await load();
        // `opsTrigger` marks the job_runs row as manual, so a surprising run in
        // the history can be traced back to this audit entry.
        const result = await mod.handler({ opsTrigger: "manual" });
        const output = typeof result?.body === "string" ? result.body.slice(0, 500) : "";
        return respond(200, {
          ok: true, job, ran: true,
          statusCode: result?.statusCode ?? 200,
          output,
        });
      }

      // ── Pause / resume one user's schedule ──────────────────────────────
      case "pause_schedule":
      case "resume_schedule": {
        if (!id || typeof id !== "string") {
          return respond(400, { ok: false, error: "`id` (schedule id) is required." });
        }
        const paused = action === "pause_schedule";
        const res = await setSchedulePaused(id, paused);
        if (!res.ok) {
          return respond(res.error === "No schedule with that id." ? 404 : 502,
            { ok: false, error: res.error });
        }

        await writeAudit({
          actor, action: paused ? "schedule_pause" : "schedule_resume",
          target: id, reason: trimmedReason,
          detail: { userId: res.row?.user_id || null, pauseReason: ADMIN_PAUSE_REASON },
        });

        const derived = deriveScheduleStatus(res.row, new Date());
        return respond(200, {
          ok: true, id, paused, schedule: derived,
          // The user's own pause is a separate axis and survives this. Saying so
          // stops an operator concluding that a resume restarted something the
          // user had deliberately stopped.
          message: paused
            ? "Schedule system-paused. The user's own pause state is unchanged."
            : derived.userPaused
              ? "System pause released — the schedule stays paused because the user paused it themselves."
              : "Schedule resumed.",
        });
      }

      default:
        return respond(400, { ok: false, error: "Unhandled action." });
    }
  } catch (err) {
    return respond(500, { ok: false, error: err.message });
  }
};

export const _internal = {
  buildSnapshot, indexRuns, setSchedulePaused, writeAudit, loadSchedules,
  ADMIN_PAUSE_REASON, RUNNABLE, ACTIONS, _resetOpsCacheForTests,
};
