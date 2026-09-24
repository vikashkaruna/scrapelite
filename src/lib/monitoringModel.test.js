// monitoringModel.test.js — the automation monitoring contract.
//
// Every function here is pure, so these tests are the real specification: if
// the dashboard and the runner ever disagree about when a cron fires, or about
// whether a job is stale, it will show up here first.

import { describe, it, expect } from "vitest";
import {
  AUTOMATION_JOBS, JOB_IDS, jobById, canRunManually,
  matchCronField, cronMatchesHour, nextCronRun,
  deriveJobStatus, JOB_STATE, severityOf, worstState, summarizeJobs,
  deriveScheduleStatus, SCHEDULE_STATE, summarizeSchedules,
  jobStateMeta, scheduleStateMeta, formatDuration, formatRelative,
  GRACE_MULTIPLIER, STUCK_AFTER_MS,
} from "./monitoringModel.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ── Registry ─────────────────────────────────────────────────────────────────

describe("AUTOMATION_JOBS registry (M-01)", () => {
  it("registers the thirteen platform jobs", () => {
    // Pinned deliberately. AUTOMATION_JOBS is the EXPECTATION and netlify.toml
    // is the REALITY: adding a job here does not schedule it, and scheduling one
    // without adding it here means it runs unmonitored. Both halves have to be
    // edited together, and this assertion is what forces the second one.
    expect(JOB_IDS).toEqual([
      "scheduled-runner",
      // W6.5. Deliberately NOT folded into discoverability-monitor: that cron
      // re-audits a page and compares scores, this re-samples an answer engine
      // and compares citation states. They share a cadence and nothing else,
      // and an engine outage must not pause page auditing.
      "prompt-monitor",
      "discoverability-monitor",
      // PRD 4 and PRD 3's execution engines. Before these, a watchlist's
      // cadence was stored and never honoured, and a bulk job advanced only
      // while the browser tab that started it stayed open.
      "watchlist-monitor", "bulk-runner",
      // The Prospect Engagement Engine's send queue (0082). Claims per message,
      // re-checks every opt-out at send time.
      "engagement-dispatcher",
      // PRD 5's "retry failed actions".
      "signal-retry",
      "reengagement", "billing-lifecycle", "billing-purge", "health-monitor",
      // The v2 workflow pipeline's dispatch loop. Added 2026-09-06: it had
      // declared config.schedule in its own source since it shipped, which is
      // ignored for v1 handlers, and was absent from BOTH registries — so it
      // had never once run on a cron and was invisible to this dashboard.
      "workflow-orchestrator-cron",
      // Stage 3 analytics imports are queued and processed off the audit path.
      "sxo-analytics-import-worker",
    ]);
  });

  it("gives every job the fields the dashboard renders", () => {
    for (const j of AUTOMATION_JOBS) {
      expect(typeof j.label).toBe("string");
      expect(j.label.length).toBeGreaterThan(0);
      expect(typeof j.description).toBe("string");
      expect(j.expectedIntervalMs).toBeGreaterThan(0);
      expect(j.cron.split(/\s+/)).toHaveLength(5);
      expect(typeof j.manualRunAllowed).toBe("boolean");
    }
  });

  it("declares exactly one destructive job", () => {
    const destructive = AUTOMATION_JOBS.filter((j) => j.destructive);
    expect(destructive.map((j) => j.id)).toEqual(["billing-purge"]);
  });

  // The safety property this whole feature hangs on.
  it("never allows a destructive job to be run by hand", () => {
    for (const j of AUTOMATION_JOBS) {
      if (j.destructive) expect(j.manualRunAllowed).toBe(false);
    }
    expect(canRunManually("billing-purge")).toBe(false);
    expect(canRunManually("scheduled-runner")).toBe(true);
  });

  it("canRunManually rejects ids that are not in the registry", () => {
    expect(canRunManually("rm-rf-slash")).toBe(false);
    expect(canRunManually(undefined)).toBe(false);
    expect(jobById("nope")).toBeNull();
  });

  it("reengagement carries no caveat — the user_id/email-resolution fix closed it", () => {
    // Was: selected a user_email column scheduled_tasks never had, the query
    // 400'd and the error was swallowed, so a green run row was a lie. Fixed
    // by reading user_id (the column that actually exists) and resolving the
    // email via the Supabase Auth Admin API, same as admin-users.js.
    expect(jobById("reengagement").caveat).toBeUndefined();
  });
});

// ── Cron matching ────────────────────────────────────────────────────────────

describe("matchCronField (M-02)", () => {
  it("matches the wildcards", () => {
    expect(matchCronField("*", 0)).toBe(true);
    expect(matchCronField("*", 23)).toBe(true);
    expect(matchCronField("?", 7)).toBe(true);
  });

  it("matches an exact value", () => {
    expect(matchCronField("9", 9)).toBe(true);
    expect(matchCronField("9", 10)).toBe(false);
  });

  it("matches a list", () => {
    expect(matchCronField("9,21", 21)).toBe(true);
    expect(matchCronField("9,21", 15)).toBe(false);
  });

  it("matches a range", () => {
    expect(matchCronField("1-5", 3)).toBe(true);
    expect(matchCronField("1-5", 6)).toBe(false);
  });

  it("matches a step", () => {
    expect(matchCronField("*/6", 0)).toBe(true);
    expect(matchCronField("*/6", 6)).toBe(true);
    expect(matchCronField("*/6", 7)).toBe(false);
  });

  it("matches a stepped range", () => {
    expect(matchCronField("2-10/4", 2)).toBe(true);
    expect(matchCronField("2-10/4", 6)).toBe(true);
    expect(matchCronField("2-10/4", 7)).toBe(false);
  });

  it("rejects a malformed step instead of matching everything", () => {
    expect(matchCronField("*/0", 5)).toBe(false);
    expect(matchCronField("*/x", 5)).toBe(false);
  });
});

describe("cronMatchesHour (M-03)", () => {
  it("matches hourly", () => {
    expect(cronMatchesHour("0 * * * *", new Date("2026-07-27T05:00:00Z"))).toBe(true);
  });

  it("matches a daily hour in UTC", () => {
    expect(cronMatchesHour("0 9 * * *", new Date("2026-07-27T09:00:00Z"))).toBe(true);
    expect(cronMatchesHour("0 9 * * *", new Date("2026-07-27T10:00:00Z"))).toBe(false);
  });

  // The runner fires hourly, so the minute field cannot change whether a given
  // hour runs. Asserting it explicitly stops someone "fixing" it later.
  it("ignores the minute field", () => {
    const at9 = new Date("2026-07-27T09:00:00Z");
    expect(cronMatchesHour("0 9 * * *", at9)).toBe(true);
    expect(cronMatchesHour("45 9 * * *", at9)).toBe(true);
  });

  it("matches weekdays only", () => {
    // 2026-07-27 is a Monday, 2026-08-01 a Saturday.
    expect(cronMatchesHour("0 9 * * 1-5", new Date("2026-07-27T09:00:00Z"))).toBe(true);
    expect(cronMatchesHour("0 9 * * 1-5", new Date("2026-08-01T09:00:00Z"))).toBe(false);
  });

  it("matches a day of month", () => {
    expect(cronMatchesHour("0 9 1 * *", new Date("2026-08-01T09:00:00Z"))).toBe(true);
    expect(cronMatchesHour("0 9 1 * *", new Date("2026-08-02T09:00:00Z"))).toBe(false);
  });

  it("returns false for anything that is not a 5-field expression", () => {
    expect(cronMatchesHour("@hourly", NOW)).toBe(false);
    expect(cronMatchesHour("", NOW)).toBe(false);
    expect(cronMatchesHour(null, NOW)).toBe(false);
    expect(cronMatchesHour("0 9 * *", NOW)).toBe(false);
  });
});

describe("nextCronRun (M-04)", () => {
  it("finds the next hourly slot", () => {
    expect(nextCronRun("0 * * * *", new Date("2026-07-27T12:15:00Z")))
      .toBe("2026-07-27T13:00:00.000Z");
  });

  it("rolls to tomorrow when today's slot has passed", () => {
    expect(nextCronRun("0 9 * * *", new Date("2026-07-27T12:00:00Z")))
      .toBe("2026-07-28T09:00:00.000Z");
  });

  it("finds today's slot when it is still ahead", () => {
    expect(nextCronRun("0 21 * * *", new Date("2026-07-27T12:00:00Z")))
      .toBe("2026-07-27T21:00:00.000Z");
  });

  it("is strictly in the future, never the current hour", () => {
    const from = new Date("2026-07-27T09:00:00Z");
    expect(nextCronRun("0 9 * * *", from)).toBe("2026-07-28T09:00:00.000Z");
  });

  it("skips the weekend for a weekday cron", () => {
    // From Friday 2026-07-31 10:00Z the next weekday slot is Monday 2026-08-03.
    expect(nextCronRun("0 9 * * 1-5", new Date("2026-07-31T10:00:00Z")))
      .toBe("2026-08-03T09:00:00.000Z");
  });

  it("handles a monthly cron across a month boundary", () => {
    expect(nextCronRun("0 9 1 * *", new Date("2026-07-27T12:00:00Z")))
      .toBe("2026-08-01T09:00:00.000Z");
  });

  it("returns null rather than a wrong date for an impossible expression", () => {
    expect(nextCronRun("0 0 30 2 *", NOW)).toBeNull(); // 30 February
  });

  it("returns null for a malformed expression", () => {
    expect(nextCronRun("@daily", NOW)).toBeNull();
    expect(nextCronRun("", NOW)).toBeNull();
  });
});

// ── Job status derivation ────────────────────────────────────────────────────

const job = jobById("billing-lifecycle"); // daily

describe("deriveJobStatus (M-05)", () => {
  const success = (at) => ({ status: "success", started_at: at });

  it("is healthy when the last run succeeded inside the window", () => {
    const s = deriveJobStatus(job, {
      lastRun: success(ago(2 * HOUR)), lastSuccess: success(ago(2 * HOUR)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.HEALTHY);
    expect(s.ageMs).toBe(2 * HOUR);
  });

  it("goes stale only past the grace multiplier", () => {
    const justInside = job.expectedIntervalMs * GRACE_MULTIPLIER - HOUR;
    const justOutside = job.expectedIntervalMs * GRACE_MULTIPLIER + HOUR;
    expect(deriveJobStatus(job, {
      lastRun: success(ago(justInside)), lastSuccess: success(ago(justInside)), now: NOW,
    }).state).toBe(JOB_STATE.HEALTHY);
    expect(deriveJobStatus(job, {
      lastRun: success(ago(justOutside)), lastSuccess: success(ago(justOutside)), now: NOW,
    }).state).toBe(JOB_STATE.STALE);
  });

  it("reports a failing last run", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "error", started_at: ago(HOUR), error: "supabase 503" },
      lastSuccess: success(ago(2 * HOUR)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.FAILING);
    expect(s.reason).toContain("supabase 503");
  });

  it("reports a fresh in-flight run as running, not stuck", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "running", started_at: ago(60_000) }, lastSuccess: success(ago(DAY)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.RUNNING);
  });

  it("reports a long in-flight run as stuck", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "running", started_at: ago(STUCK_AFTER_MS + 60_000) },
      lastSuccess: success(ago(DAY)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.STUCK);
    expect(s.reason).toMatch(/never finished/i);
  });

  it("reports never-run when there is no history at all", () => {
    const s = deriveJobStatus(job, { lastRun: null, lastSuccess: null, now: NOW });
    expect(s.state).toBe(JOB_STATE.NEVER_RUN);
    // The actual root cause the last time this happened, so it is in the copy.
    expect(s.reason).toMatch(/netlify\.toml/i);
  });

  it("reports never-run when runs exist but none has succeeded", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "skipped", started_at: ago(HOUR) }, lastSuccess: null, now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.NEVER_RUN);
  });

  // A skipped run is a healthy no-op (the kill switch is on for that cycle), not
  // an outage — provided something succeeded recently.
  it("treats a skipped run after a recent success as healthy", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "skipped", started_at: ago(HOUR) },
      lastSuccess: success(ago(3 * HOUR)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.HEALTHY);
    expect(s.reason).toMatch(/skipped/i);
  });

  // Deliberate precedence: once an operator stops a job, "it has not run" is
  // noise that hides the rows they still need to act on.
  it("reports a disabled job as stopped and not as stale", () => {
    const s = deriveJobStatus(job, {
      enabled: false, lastRun: success(ago(30 * DAY)), lastSuccess: success(ago(30 * DAY)), now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.DISABLED);
    expect(s.reason).toMatch(/operator/i);
  });

  it("shows no next run for a disabled job", () => {
    const s = deriveJobStatus(job, { enabled: false, lastRun: null, now: NOW });
    expect(s.nextRunAt).toBeNull();
  });

  it("computes the next run for an enabled job", () => {
    const s = deriveJobStatus(job, {
      lastRun: success(ago(HOUR)), lastSuccess: success(ago(HOUR)), now: NOW,
    });
    expect(s.nextRunAt).toBe("2026-07-28T03:00:00.000Z"); // cron "0 3 * * *"
  });

  it("accepts camelCase run rows as well as snake_case ones", () => {
    const s = deriveJobStatus(job, {
      lastRun: { status: "success", startedAt: ago(HOUR) },
      lastSuccess: { status: "success", startedAt: ago(HOUR) }, now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.HEALTHY);
    expect(s.lastSuccessAt).toBe(ago(HOUR));
  });

  it("falls back to a daily interval for an unregistered job", () => {
    const s = deriveJobStatus({ id: "mystery", cron: "0 * * * *" }, {
      lastRun: { status: "success", started_at: ago(3 * DAY) },
      lastSuccess: { status: "success", started_at: ago(3 * DAY) }, now: NOW,
    });
    expect(s.state).toBe(JOB_STATE.STALE);
  });
});

describe("severity ranking (M-06)", () => {
  it("ranks failure above staleness above disabled", () => {
    expect(severityOf(JOB_STATE.FAILING)).toBeGreaterThan(severityOf(JOB_STATE.STALE));
    expect(severityOf(JOB_STATE.STALE)).toBeGreaterThan(severityOf(JOB_STATE.NEVER_RUN));
    expect(severityOf(JOB_STATE.NEVER_RUN)).toBeGreaterThan(severityOf(JOB_STATE.DISABLED));
    expect(severityOf(JOB_STATE.HEALTHY)).toBe(0);
  });

  it("worstState picks the single worst entry", () => {
    expect(worstState([JOB_STATE.HEALTHY, JOB_STATE.STALE, JOB_STATE.DISABLED])).toBe(JOB_STATE.STALE);
    expect(worstState([JOB_STATE.HEALTHY, JOB_STATE.HEALTHY])).toBe(JOB_STATE.HEALTHY);
  });

  it("worstState is healthy for an empty list", () => {
    expect(worstState([])).toBe(JOB_STATE.HEALTHY);
    expect(worstState(undefined)).toBe(JOB_STATE.HEALTHY);
  });
});

describe("summarizeJobs (M-07)", () => {
  it("counts each state and surfaces the worst", () => {
    const out = summarizeJobs([
      { state: JOB_STATE.HEALTHY }, { state: JOB_STATE.HEALTHY },
      { state: JOB_STATE.DISABLED }, { state: JOB_STATE.FAILING },
      { state: JOB_STATE.STALE }, { state: JOB_STATE.NEVER_RUN },
      { state: JOB_STATE.RUNNING }, { state: JOB_STATE.STUCK },
    ]);
    expect(out).toMatchObject({
      total: 8, healthy: 2, disabled: 1, failing: 1,
      stale: 1, neverRun: 1, running: 1, stuck: 1,
    });
    expect(out.worst).toBe(JOB_STATE.FAILING);
  });

  it("handles an empty list", () => {
    expect(summarizeJobs([])).toMatchObject({ total: 0, worst: JOB_STATE.HEALTHY });
  });
});

// ── User schedules ───────────────────────────────────────────────────────────

describe("deriveScheduleStatus (M-08)", () => {
  const row = (over = {}) => ({
    id: "sch_1", user_id: "u1", status: "active", system_paused: false,
    cron: "0 9 * * *", next_run_at: "2026-07-28T09:00:00.000Z",
    data: { label: "Pricing page", target: "https://x.com/pricing", type: "track", intent: "pricing" },
    ...over,
  });

  it("classifies an active schedule", () => {
    const s = deriveScheduleStatus(row(), NOW);
    expect(s.state).toBe(SCHEDULE_STATE.ACTIVE);
    expect(s.label).toBe("Pricing page");
    expect(s.nextRunAt).toBe("2026-07-28T09:00:00.000Z");
  });

  it("classifies a user-paused schedule", () => {
    const s = deriveScheduleStatus(row({ status: "paused" }), NOW);
    expect(s.state).toBe(SCHEDULE_STATE.PAUSED);
    expect(s.userPaused).toBe(true);
  });

  it("classifies a system-paused schedule and keeps the reason", () => {
    const s = deriveScheduleStatus(
      row({ system_paused: true, system_pause_reason: "subscription_suspended" }), NOW);
    expect(s.state).toBe(SCHEDULE_STATE.SYSTEM_PAUSED);
    expect(s.systemPauseReason).toBe("subscription_suspended");
  });

  // The two axes must stay distinguishable: resuming a system pause must not be
  // allowed to imply the user's own pause is being overridden.
  it("keeps the user's own pause visible underneath a system pause", () => {
    const s = deriveScheduleStatus(row({ status: "paused", system_paused: true }), NOW);
    expect(s.state).toBe(SCHEDULE_STATE.SYSTEM_PAUSED);
    expect(s.userPaused).toBe(true);
  });

  it("classifies an expired schedule ahead of everything else", () => {
    const s = deriveScheduleStatus(
      row({ data: { label: "Old", endsAt: "2026-01-01T00:00:00Z" } }), NOW);
    expect(s.state).toBe(SCHEDULE_STATE.EXPIRED);
    expect(s.expired).toBe(true);
  });

  it("shows no next run for anything that will not run", () => {
    for (const over of [{ status: "paused" }, { system_paused: true },
      { data: { endsAt: "2026-01-01T00:00:00Z" } }]) {
      expect(deriveScheduleStatus(row(over), NOW).nextRunAt).toBeNull();
    }
  });

  it("computes a next run from the cron when the row has none stored", () => {
    const s = deriveScheduleStatus(row({ next_run_at: null }), NOW);
    expect(s.nextRunAt).toBe("2026-07-28T09:00:00.000Z");
  });

  it("survives a row with no data blob", () => {
    const s = deriveScheduleStatus({ id: "sch_2" }, NOW);
    expect(s.label).toBe("sch_2");
    expect(s.state).toBe(SCHEDULE_STATE.ACTIVE);
  });

  it("survives a null row", () => {
    expect(deriveScheduleStatus(null, NOW).id).toBeNull();
  });
});

describe("summarizeSchedules (M-09)", () => {
  it("counts every state plus failures", () => {
    const out = summarizeSchedules([
      { state: SCHEDULE_STATE.ACTIVE }, { state: SCHEDULE_STATE.ACTIVE, lastStatus: "error" },
      { state: SCHEDULE_STATE.PAUSED }, { state: SCHEDULE_STATE.SYSTEM_PAUSED },
      { state: SCHEDULE_STATE.EXPIRED },
    ]);
    expect(out).toEqual({ total: 5, active: 2, paused: 1, systemPaused: 1, expired: 1, failing: 1 });
  });
});

// ── Presentation ─────────────────────────────────────────────────────────────

describe("presentation helpers (M-10)", () => {
  it("gives every job state a label, tone and icon", () => {
    for (const state of Object.values(JOB_STATE)) {
      const m = jobStateMeta(state);
      expect(m.label).toBeTruthy();
      expect(["ok", "info", "warn", "danger", "muted"]).toContain(m.tone);
      expect(m.icon).toBeTruthy();
    }
  });

  it("degrades gracefully for an unknown state", () => {
    expect(jobStateMeta("wat").tone).toBe("muted");
    expect(scheduleStateMeta(undefined).tone).toBe("muted");
  });

  it("gives every schedule state a label", () => {
    for (const state of Object.values(SCHEDULE_STATE)) {
      expect(scheduleStateMeta(state).label).toBeTruthy();
    }
  });

  it("formats durations across every unit", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(3 * HOUR)).toBe("3h");
    expect(formatDuration(3 * HOUR + 10 * 60_000)).toBe("3h 10m");
    expect(formatDuration(2 * DAY + 4 * HOUR)).toBe("2d 4h");
    expect(formatDuration(2 * DAY)).toBe("2d");
  });

  it("returns a dash rather than NaN for a bad duration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration("abc")).toBe("—");
  });

  it("formats relative time in both directions", () => {
    expect(formatRelative(ago(3 * HOUR), NOW)).toBe("3h ago");
    expect(formatRelative(new Date(NOW.getTime() + 20 * 60_000).toISOString(), NOW)).toBe("in 20m");
    expect(formatRelative(NOW.toISOString(), NOW)).toBe("just now");
  });

  it("says never rather than Invalid Date", () => {
    expect(formatRelative(null, NOW)).toBe("never");
    expect(formatRelative("not-a-date", NOW)).toBe("never");
  });
});

// ── Expiry (regression) ─────────────────────────────────────────────────────
// deriveScheduleStatus read `data.endsAt || data.runUntil`, and no schedule has
// ever carried either: buildSchedule() persists `expiresAt`. So EXPIRED was
// unreachable and the admin dashboard's "Expired" filter always matched
// nothing, whatever was in the table — a filter that silently lies is worse
// than no filter, because it is read as evidence.
describe("deriveScheduleStatus — expiry", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  it("reads the field schedules actually persist (expiresAt)", () => {
    expect(deriveScheduleStatus({ status: "active", data: { expiresAt: past } }).state)
      .toBe(SCHEDULE_STATE.EXPIRED);
  });

  it("does not expire one whose end date is still ahead", () => {
    expect(deriveScheduleStatus({ status: "active", data: { expiresAt: future } }).state)
      .toBe(SCHEDULE_STATE.ACTIVE);
  });

  it("still honours the older field names", () => {
    expect(deriveScheduleStatus({ status: "active", data: { endsAt: past } }).state)
      .toBe(SCHEDULE_STATE.EXPIRED);
    expect(deriveScheduleStatus({ status: "active", data: { runUntil: past } }).state)
      .toBe(SCHEDULE_STATE.EXPIRED);
  });

  it("expiry outranks a pause — a stopped schedule that has also ended is ended", () => {
    expect(deriveScheduleStatus({ status: "paused", system_paused: true, data: { expiresAt: past } }).state)
      .toBe(SCHEDULE_STATE.EXPIRED);
  });

  it("a schedule with no end date never expires", () => {
    expect(deriveScheduleStatus({ status: "active", data: {} }).state).toBe(SCHEDULE_STATE.ACTIVE);
  });
});
