// monitoringModel.js — PURE. The shared contract for automation monitoring.
//
// Imported by BOTH the React admin pages and the Netlify functions (same
// pattern as entitlementModel.js), so the dashboard's idea of "this job is
// stale" and the server's idea of it can never drift apart. Nothing in this
// file touches the network, the DOM, localStorage or process.env — every
// function is a pure transformation, which is what makes the whole monitoring
// surface testable without a database.
//
// Three things live here:
//   1. AUTOMATION_JOBS — the registry of platform crons. This is the ONLY
//      in-code list of what is supposed to be running.
//   2. The cron matcher + next-run estimator, shared with scheduled-runner.js.
//   3. Status derivation — turning (job, last run, now) into a health verdict.

// ── Job registry ─────────────────────────────────────────────────────────────
//
// ⚠️ THIS LIST IS NOT WHAT SCHEDULES THE JOBS. netlify.toml is. Netlify reads
// its [functions."<name>"] schedule blocks and nothing else — the
// `export const config = { schedule }` in each function is ignored for v1
// handlers, which is how all four crons sat unscheduled from R19 until
// 2026-07-27. This registry is the EXPECTATION; netlify.toml is the reality;
// admin-monitoring.js compares job_runs against this to tell you when they
// disagree. Adding a job here does not schedule it. Adding it to netlify.toml
// without adding it here means it runs unmonitored.
//
// `expectedIntervalMs` drives staleness: a job is stale when nothing has
// succeeded within GRACE_MULTIPLIER × its interval.
export const AUTOMATION_JOBS = [
  {
    id: "scheduled-runner",
    label: "Schedule runner",
    schedule: "@hourly",
    cron: "0 * * * *",
    expectedIntervalMs: 60 * 60 * 1000,
    category: "extraction",
    description:
      "Executes every user monitoring schedule that is due this hour: re-scrapes the target, " +
      "fingerprints the content, and alerts on change.",
    destructive: false,
    // Manual invocation is safe: the job is idempotent within an hour (it skips
    // schedules whose lastRunAt is inside the current window).
    manualRunAllowed: true,
  },
  {
    id: "discoverability-monitor",
    label: "Discoverability monitor",
    schedule: "@daily",
    cron: "0 0 * * *",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    category: "extraction",
    description:
      "Re-audits every page a user is watching, compares the result against the previous run, " +
      "and alerts when the overall score moves past that schedule's threshold or a new critical " +
      "issue appears.",
    destructive: false,
    // Safe by hand: each schedule advances its own next_run_at, so a manual run
    // re-audits what is due and then falls back to its cadence.
    manualRunAllowed: true,
  },
  {
    id: "watchlist-monitor",
    label: "Competitor watchlist monitor",
    schedule: "@hourly",
    cron: "0 * * * *",
    expectedIntervalMs: 60 * 60 * 1000,
    category: "extraction",
    description:
      "Crawls every monitored competitor page whose watchlist cadence says it is due, extracts a " +
      "structured snapshot of the business fields (pricing, product, positioning), diffs it against " +
      "the previous snapshot, and routes material changes to the user's signal rules.",
    destructive: false,
    // Safe by hand: each target advances its own last_checked_at, so a manual
    // run re-crawls only what is due and then falls back to its cadence.
    manualRunAllowed: true,
    // Runs hourly and honours each watchlist's own cadence internally, rather
    // than three separate crons. An hourly watchlist needs an hourly tick; a
    // weekly one simply is not due on most of them.
  },
  {
    id: "bulk-runner",
    label: "Bulk enrichment runner",
    schedule: "*/5 * * * *",
    cron: "*/5 * * * *",
    expectedIntervalMs: 5 * 60 * 1000,
    category: "extraction",
    description:
      "Advances queued bulk account-enrichment jobs so a list finishes whether or not the browser " +
      "tab that started it is still open. Claims work per item, so it is safe to run alongside the " +
      "client-driven chunk endpoint.",
    destructive: false,
    // Safe by hand: work is claimed per item (queued -> running -> completed),
    // so a manual run alongside the cron does less work, never duplicate work.
    manualRunAllowed: true,
  },
  {
    id: "signal-retry",
    label: "Signal dispatch retry",
    schedule: "*/5 * * * *",
    cron: "*/5 * * * *",
    expectedIntervalMs: 5 * 60 * 1000,
    category: "extraction",
    description:
      "Re-attempts signal-rule dispatches whose backoff has elapsed (1m, 5m, 30m, 2h, 12h, then " +
      "settled as failed). Retries DELIVERY only — it never re-evaluates the rule's conditions, " +
      "because the decision to act was made when the event was detected.",
    destructive: false,
    // Safe by hand: each row's next_retry_at is cleared before the outbound
    // call, so a manual run alongside the cron cannot deliver the same dispatch
    // twice.
    manualRunAllowed: true,
  },
  {
    id: "reengagement",
    label: "Re-engagement digest",
    schedule: "@daily",
    cron: "0 6 * * *",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    category: "lifecycle",
    description:
      "Daily digest + win-back email to users who have gone quiet.",
    destructive: false,
    manualRunAllowed: true,
  },
  {
    id: "billing-lifecycle",
    label: "Billing lifecycle & dunning",
    schedule: "@daily",
    cron: "0 3 * * *",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    category: "billing",
    description:
      "Drives active → suspended → deactivated transitions, sends the dunning notice series, " +
      "and pauses/resumes automation with the subscription.",
    destructive: false,
    manualRunAllowed: true,
    // billing-purge refuses to delete anything unless this job has succeeded
    // recently, so its staleness is not cosmetic — it silently disarms the purge.
    critical: true,
  },
  {
    id: "billing-purge",
    label: "Data purge (day 90)",
    schedule: "@daily",
    cron: "0 4 * * *",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    category: "billing",
    description:
      "The only destructive job in the system. Deletes the data of accounts deactivated 90+ days " +
      "ago, behind five independent interlocks, and ships disarmed (PURGE_ENABLED unset).",
    destructive: true,
    // DELIBERATELY NOT MANUALLY RUNNABLE. Every other control on this dashboard
    // is reversible; this one is not. A destructive job gets exactly one trigger
    // path — its schedule — so that "I clicked the wrong row" can never be the
    // first step in an unrecoverable deletion.
    manualRunAllowed: false,
    critical: true,
  },
  {
    id: "health-monitor",
    label: "Service health sampler",
    schedule: "@hourly",
    cron: "30 * * * *",
    expectedIntervalMs: 60 * 60 * 1000,
    category: "platform",
    description:
      "Probes Netlify, Supabase and the third-party services, stores a sample per component, " +
      "and alerts when a critical component changes state.",
    destructive: false,
    manualRunAllowed: true,
  },
];

export const JOB_IDS = AUTOMATION_JOBS.map((j) => j.id);

const JOB_BY_ID = AUTOMATION_JOBS.reduce((m, j) => ((m[j.id] = j), m), {});

export function jobById(id) {
  return JOB_BY_ID[id] || null;
}

/** True when this job may be triggered by hand from the admin console. */
export function canRunManually(id) {
  const job = jobById(id);
  return !!job && job.manualRunAllowed === true;
}

// A job is "stale" once it has missed this many of its own intervals. Netlify
// cron firing times drift by minutes, and a cold start plus a slow Supabase can
// push an hourly job past the hour, so 1× would alarm on healthy systems.
export const GRACE_MULTIPLIER = 2.5;

// A run still marked 'running' after this long did not finish — the container
// was killed, or the handler threw past its own catch. Netlify's function
// timeout is well under this.
export const STUCK_AFTER_MS = 15 * 60 * 1000;

// ── Cron matching ────────────────────────────────────────────────────────────
// Shared with netlify/functions/scheduled-runner.js, which imports these rather
// than keeping its own copy. That is the point: the "next run" this dashboard
// shows is computed by the same code that decides whether a schedule fires.

/** Match one 5-field cron field against a numeric value. Supports *, a, a-b, a,b, and steps. */
export function matchCronField(field, value) {
  if (field === "*" || field === "?") return true;
  return String(field).split(",").some((part) => {
    const step = part.includes("/") ? parseInt(part.split("/")[1], 10) : 1;
    if (!Number.isFinite(step) || step < 1) return false;
    const range = part.split("/")[0];
    if (range === "*") return value % step === 0;
    if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
      return value >= lo && value <= hi && (value - lo) % step === 0;
    }
    return Number(range) === value;
  });
}

/**
 * Does this 5-field cron match the given date, to the hour, in UTC?
 *
 * The MINUTE FIELD IS IGNORED, and that is not an approximation to be tightened
 * later — the runner fires hourly, so "0 9 * * *" and "45 9 * * *" are the same
 * schedule as far as execution goes. Pretending otherwise on the dashboard
 * would promise a precision the platform does not provide.
 */
export function cronMatchesHour(cron, date) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, hour, dom, mon, dow] = parts;
  return (
    matchCronField(hour, date.getUTCHours()) &&
    matchCronField(dom, date.getUTCDate()) &&
    matchCronField(mon, date.getUTCMonth() + 1) &&
    matchCronField(dow, date.getUTCDay())
  );
}

// Walking hour by hour covers a leap year, which is enough for every cadence the
// scheduler can produce (the longest is monthly).
const MAX_LOOKAHEAD_HOURS = 24 * 366;

/**
 * Next UTC hour at which `cron` fires, strictly after `from`.
 * Returns an ISO string, or null when the expression can never match
 * (malformed, or something like "0 0 30 2 *" — 30 February).
 */
export function nextCronRun(cron, from = new Date()) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const cursor = new Date(from);
  cursor.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < MAX_LOOKAHEAD_HOURS; i++) {
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    if (cronMatchesHour(cron, cursor)) return cursor.toISOString();
  }
  return null;
}

// ── Status derivation ────────────────────────────────────────────────────────

export const JOB_STATE = {
  HEALTHY: "healthy",
  RUNNING: "running",
  STALE: "stale",
  FAILING: "failing",
  STUCK: "stuck",
  DISABLED: "disabled",
  NEVER_RUN: "never-run",
};

// Ordered worst-first. Used to rank a mixed list down to one headline verdict.
const SEVERITY = {
  [JOB_STATE.FAILING]: 4,
  [JOB_STATE.STUCK]: 4,
  [JOB_STATE.STALE]: 3,
  [JOB_STATE.NEVER_RUN]: 2,
  [JOB_STATE.DISABLED]: 1,
  [JOB_STATE.RUNNING]: 0,
  [JOB_STATE.HEALTHY]: 0,
};

export function severityOf(state) {
  return SEVERITY[state] ?? 0;
}

/** The single worst state in a list, or 'healthy' for an empty one. */
export function worstState(states) {
  let worst = JOB_STATE.HEALTHY;
  for (const s of states || []) {
    if (severityOf(s) > severityOf(worst)) worst = s;
  }
  return worst;
}

const ms = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : null;
};

/**
 * Derive one job's health from its registry entry and its recent runs.
 *
 * @param {object}  job       registry entry (or {id, expectedIntervalMs})
 * @param {object}  opts
 * @param {boolean} opts.enabled       operator kill switch (default true)
 * @param {object}  opts.lastRun       most recent job_runs row, or null
 * @param {object}  opts.lastSuccess   most recent SUCCESSFUL run, or null
 * @param {Date}    opts.now
 * @returns {{state, severity, reason, lastRunAt, lastSuccessAt, ageMs, nextRunAt, overdueBy}}
 *
 * ORDER MATTERS. A disabled job is reported as disabled and NOT ALSO as stale:
 * once an operator has deliberately stopped something, telling them it has not
 * run is noise that buries the rows they still need to act on.
 */
export function deriveJobStatus(job, opts = {}) {
  const { enabled = true, lastRun = null, lastSuccess = null, now = new Date() } = opts;
  const nowMs = now.getTime();
  const interval = job?.expectedIntervalMs || 24 * 60 * 60 * 1000;

  const lastRunAt = lastRun?.started_at ?? lastRun?.startedAt ?? null;
  const lastSuccessAt = lastSuccess?.started_at ?? lastSuccess?.startedAt ?? null;
  const successMs = ms(lastSuccessAt);
  const ageMs = successMs === null ? null : nowMs - successMs;
  const nextRunAt = enabled ? nextCronRun(job?.cron, now) : null;

  const base = { lastRunAt, lastSuccessAt, ageMs, nextRunAt, overdueBy: null };

  if (!enabled) {
    return { ...base, state: JOB_STATE.DISABLED, severity: severityOf(JOB_STATE.DISABLED),
      reason: "Stopped by an operator." };
  }

  // A run that never reported back. Checked before failure so a container that
  // died mid-write is not mislabelled as a clean error.
  if (lastRun && (lastRun.status === "running")) {
    const startedMs = ms(lastRunAt);
    if (startedMs !== null && nowMs - startedMs > STUCK_AFTER_MS) {
      return { ...base, state: JOB_STATE.STUCK, severity: severityOf(JOB_STATE.STUCK),
        reason: "Started but never finished — the run was cut off mid-flight." };
    }
    return { ...base, state: JOB_STATE.RUNNING, severity: severityOf(JOB_STATE.RUNNING),
      reason: "Currently running." };
  }

  if (!lastRun) {
    return { ...base, state: JOB_STATE.NEVER_RUN, severity: severityOf(JOB_STATE.NEVER_RUN),
      reason: "No run has ever been recorded. Check that netlify.toml declares its schedule." };
  }

  if (lastRun.status === "error") {
    return { ...base, state: JOB_STATE.FAILING, severity: severityOf(JOB_STATE.FAILING),
      reason: lastRun.error ? `Last run failed: ${lastRun.error}` : "Last run failed." };
  }

  // Staleness is measured from the last SUCCESS, not the last run: a job whose
  // every attempt is skipped has run recently and achieved nothing.
  if (ageMs === null) {
    return { ...base, state: JOB_STATE.NEVER_RUN, severity: severityOf(JOB_STATE.NEVER_RUN),
      reason: "Runs have been recorded but none has succeeded." };
  }

  const limit = interval * GRACE_MULTIPLIER;
  if (ageMs > limit) {
    return { ...base, state: JOB_STATE.STALE, severity: severityOf(JOB_STATE.STALE),
      overdueBy: ageMs - interval,
      reason: `No successful run in ${formatDuration(ageMs)} (expected every ${formatDuration(interval)}).` };
  }

  return { ...base, state: JOB_STATE.HEALTHY, severity: severityOf(JOB_STATE.HEALTHY),
    reason: lastRun.status === "skipped" ? "Last run was skipped; a recent run succeeded." : "Running on schedule." };
}

// ── User schedule (scheduled_tasks) derivation ───────────────────────────────

export const SCHEDULE_STATE = {
  ACTIVE: "active",
  PAUSED: "paused",
  SYSTEM_PAUSED: "system-paused",
  EXPIRED: "expired",
};

/**
 * Classify one scheduled_tasks row.
 *
 * `status` (user intent) and `system_paused` (platform intent) are separate
 * axes on purpose — see 0015_scheduler_hardening.sql. SYSTEM_PAUSED is reported
 * ahead of PAUSED because it is the one an operator can act on, but the user's
 * own 'paused' intent is still carried in `userPaused` so the UI never claims a
 * resume will start something the user had deliberately stopped.
 */
export function deriveScheduleStatus(row, now = new Date()) {
  const data = row?.data || {};
  const userPaused = row?.status === "paused";
  const systemPaused = row?.system_paused === true;
  // ⚠️ `expiresAt` is the field schedulerService.buildSchedule() actually
  // persists — see its shape there. This read `endsAt || runUntil`, neither of
  // which any schedule has ever carried, so deriveScheduleStatus could never
  // return EXPIRED and the admin dashboard's "Expired" filter was dead: it
  // always matched nothing, whatever was in the table. The other two names are
  // kept as fallbacks in case an older row used them.
  const endsAt = data.expiresAt || data.endsAt || data.runUntil || null;
  const expired = !!endsAt && Date.parse(endsAt) < now.getTime();

  let state = SCHEDULE_STATE.ACTIVE;
  if (expired) state = SCHEDULE_STATE.EXPIRED;
  else if (systemPaused) state = SCHEDULE_STATE.SYSTEM_PAUSED;
  else if (userPaused) state = SCHEDULE_STATE.PAUSED;

  const cron = row?.cron || data.cron || "";
  const willRun = state === SCHEDULE_STATE.ACTIVE;

  return {
    id: row?.id ?? null,
    userId: row?.user_id ?? null,
    label: data.label || data.name || row?.id || "Untitled schedule",
    target: data.target ?? null,
    type: data.type || "track",
    intent: data.intent || "summary",
    cron,
    state,
    userPaused,
    systemPaused,
    systemPauseReason: row?.system_pause_reason || null,
    expired,
    endsAt,
    lastRunAt: data.lastRunAt || null,
    lastStatus: data.lastStatus || null,
    // A paused schedule has no next run. Showing one implies it is coming.
    nextRunAt: willRun ? (row?.next_run_at || nextCronRun(cron, now)) : null,
  };
}

/** Roll a list of derived schedule statuses into dashboard counters. */
export function summarizeSchedules(list = []) {
  const out = { total: list.length, active: 0, paused: 0, systemPaused: 0, expired: 0, failing: 0 };
  for (const s of list) {
    if (s.state === SCHEDULE_STATE.ACTIVE) out.active++;
    else if (s.state === SCHEDULE_STATE.PAUSED) out.paused++;
    else if (s.state === SCHEDULE_STATE.SYSTEM_PAUSED) out.systemPaused++;
    else if (s.state === SCHEDULE_STATE.EXPIRED) out.expired++;
    if (s.lastStatus === "error") out.failing++;
  }
  return out;
}

/** Roll a list of derived job statuses into dashboard counters + a headline. */
export function summarizeJobs(list = []) {
  const out = {
    total: list.length, healthy: 0, running: 0, stale: 0,
    failing: 0, stuck: 0, disabled: 0, neverRun: 0,
  };
  for (const j of list) {
    switch (j.state) {
      case JOB_STATE.HEALTHY:   out.healthy++;  break;
      case JOB_STATE.RUNNING:   out.running++;  break;
      case JOB_STATE.STALE:     out.stale++;    break;
      case JOB_STATE.FAILING:   out.failing++;  break;
      case JOB_STATE.STUCK:     out.stuck++;    break;
      case JOB_STATE.DISABLED:  out.disabled++; break;
      case JOB_STATE.NEVER_RUN: out.neverRun++; break;
      default: break;
    }
  }
  out.worst = worstState(list.map((j) => j.state));
  return out;
}

// ── Presentation helpers ─────────────────────────────────────────────────────

const STATE_META = {
  [JOB_STATE.HEALTHY]:   { label: "Healthy",     tone: "ok",      icon: "check-circle" },
  [JOB_STATE.RUNNING]:   { label: "Running",     tone: "info",    icon: "loader" },
  [JOB_STATE.STALE]:     { label: "Stale",       tone: "warn",    icon: "alert-triangle" },
  [JOB_STATE.FAILING]:   { label: "Failing",     tone: "danger",  icon: "alert-octagon" },
  [JOB_STATE.STUCK]:     { label: "Stuck",       tone: "danger",  icon: "alert-octagon" },
  [JOB_STATE.DISABLED]:  { label: "Stopped",     tone: "muted",   icon: "pause" },
  [JOB_STATE.NEVER_RUN]: { label: "Never run",   tone: "warn",    icon: "help-circle" },
};

export function jobStateMeta(state) {
  return STATE_META[state] || { label: String(state || "Unknown"), tone: "muted", icon: "help-circle" };
}

const SCHEDULE_STATE_META = {
  [SCHEDULE_STATE.ACTIVE]:        { label: "Active",        tone: "ok" },
  [SCHEDULE_STATE.PAUSED]:        { label: "Paused by user", tone: "muted" },
  [SCHEDULE_STATE.SYSTEM_PAUSED]: { label: "System paused",  tone: "warn" },
  [SCHEDULE_STATE.EXPIRED]:       { label: "Expired",        tone: "muted" },
};

export function scheduleStateMeta(state) {
  return SCHEDULE_STATE_META[state] || { label: String(state || "Unknown"), tone: "muted" };
}

/** Compact duration: "45s", "12m", "3h 10m", "2d 4h". */
export function formatDuration(msValue) {
  // Number(null) is 0, so an unguarded conversion renders a missing duration as
  // a confident "0s". Reject the absent values first.
  if (msValue === null || msValue === undefined || msValue === "") return "—";
  const v = Number(msValue);
  if (!Number.isFinite(v) || v < 0) return "—";
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return h && m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** "3h ago" / "in 20m" / "never". Signed relative time against `now`. */
export function formatRelative(iso, now = new Date()) {
  const t = ms(iso);
  if (t === null) return "never";
  const delta = t - now.getTime();
  const abs = Math.abs(delta);
  if (abs < 45_000) return "just now";
  return delta < 0 ? `${formatDuration(abs)} ago` : `in ${formatDuration(abs)}`;
}
