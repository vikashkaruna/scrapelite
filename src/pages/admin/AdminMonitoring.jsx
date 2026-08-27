// AdminMonitoring.jsx — automation & workflow monitoring.
//
// Two tables, one question each:
//   • Platform jobs — are the crons running, when did they last succeed, when
//     do they run next, and can I stop one right now?
//   • User schedules — whose monitoring workflows are active, paused, or
//     paused by the platform, and can I intervene on one?
//
// Every control opens a reason prompt before it fires. That is not ceremony:
// the server rejects a blank reason and the database has a CHECK constraint
// behind it, so a dialog that skipped the reason would just produce a 400.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMonitoringSnapshot, setJobEnabled, runJobNow, pauseSchedule, resumeSchedule,
} from "../../lib/monitoringService.js";
import {
  jobStateMeta, scheduleStateMeta, formatRelative, formatDuration,
  SCHEDULE_STATE, JOB_STATE,
} from "../../lib/monitoringModel.js";
import { describeCron } from "../../lib/schedulerService.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const REFRESH_MS = 30_000;

// Per-job platform labels and the build/context tags shown next to them.
// Kept in one place so the column on Platform jobs, the section chip on
// User monitoring schedules, and the new Platform/Job filter on the audit
// log all read from the same source of truth.
const PLATFORM_META = {
  netlify: { label: "Netlify",          icon: "zap",        tone: "netlify" },
  db:      { label: "DB & Identity",    icon: "database",   tone: "db" },
};
const PLATFORMS = ["all", "netlify", "db"];

// Same classification the server uses — see JOB_PLATFORM in
// netlify/functions/admin-monitoring.js. Audit entries are addressed to a
// job id, so a quick lookup here is enough to bucket them by platform.
const JOB_PLATFORM = {
  "scheduled-runner":  "netlify",
  "reengagement":      "netlify",
  "billing-lifecycle": "db",
  "billing-purge":     "db",
  "health-monitor":    "db",
};
function jobPlatform(jobId) {
  return JOB_PLATFORM[jobId] || "netlify";
}

function PlatformTag({ platform, runtime, withRuntime = true }) {
  const meta = PLATFORM_META[platform] || PLATFORM_META.netlify;
  return (
    <span className={`ops-platform-tag ops-platform-${meta.tone}`} title={withRuntime ? runtime : undefined}>
      <Icon name={meta.icon} size={11} />
      <span className="ops-platform-label">{meta.label}</span>
      {withRuntime && runtime && (
        <span className="ops-platform-runtime"> · {runtime}</span>
      )}
    </span>
  );
}

function StatePill({ meta, title }) {
  return (
    <span className={`ops-pill ops-pill-${meta.tone}`} title={title || undefined}>
      {meta.icon && <Icon name={meta.icon} size={12} />}
      {meta.label}
    </span>
  );
}

function SummaryTile({ icon, label, value, tone = "muted" }) {
  return (
    <div className={`ops-tile ops-tile-${tone}`}>
      <div className="ops-tile-icon"><Icon name={icon} size={16} /></div>
      <div className="ops-tile-body">
        <div className="ops-tile-value">{value}</div>
        <div className="ops-tile-label">{label}</div>
      </div>
    </div>
  );
}

/**
 * Reason prompt. Modal rather than an inline field because these actions stop
 * billing, dunning and other people's automation — a single mis-click should
 * not be enough.
 */
function ReasonDialog({ open, action, onConfirm, onCancel, busy }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open, action?.key]);
  if (!open || !action) return null;

  const disabled = busy || !reason.trim();
  return (
    <div className="ops-modal-overlay" role="dialog" aria-modal="true" aria-label={action.title}>
      <div className="ops-modal card card-pad">
        <h3 className="ops-modal-title">{action.title}</h3>
        <p className="ops-modal-desc">{action.description}</p>
        {action.warning && (
          <div className="admin-ai-notice warn ops-modal-warn">
            <Icon name="alert-triangle" size={15} /><span>{action.warning}</span>
          </div>
        )}
        <label className="ops-modal-label" htmlFor="ops-reason">
          Reason <span className="ops-required">(required)</span>
        </label>
        <textarea
          id="ops-reason"
          className="ops-modal-input"
          rows={3}
          value={reason}
          autoFocus
          placeholder="Why are you doing this? Written to the audit log."
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="ops-modal-hint">
          Recorded in <code>ops_audit_log</code> with your admin identity and the time.
        </p>
        <div className="ops-modal-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={action.danger ? "danger" : "primary"}
            onClick={() => onConfirm(reason.trim())}
            disabled={disabled}
          >
            {busy ? "Working…" : action.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunHistory({ runs }) {
  if (!runs?.length) return <p className="ops-runs-empty">No runs recorded yet.</p>;
  return (
    <table className="ops-runs-table">
      <thead>
        <tr><th>Started</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Detail</th></tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td title={r.started_at}>{formatRelative(r.started_at)}</td>
            <td><span className={`ops-run-status ops-run-${r.status}`}>{r.status}</span></td>
            <td>{r.trigger}</td>
            <td>{r.duration_ms == null ? "—" : formatDuration(r.duration_ms)}</td>
            <td className="ops-run-detail">
              {r.error
                ? <span className="ops-run-error">{r.error}</span>
                : <code>{JSON.stringify(r.detail || {})}</code>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JobRow({ job, expanded, onToggle, onStart, onStop, onRun, runtime }) {
  const meta = jobStateMeta(job.state);
  return (
    <>
      <tr className={"ops-job-row" + (job.state === JOB_STATE.FAILING || job.state === JOB_STATE.STUCK ? " ops-row-alert" : "")}>
        <td>
          <button className="ops-expand" onClick={onToggle} aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${job.label}` : `Expand ${job.label}`}>
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
          </button>
        </td>
        <td>
          <div className="ops-job-name">
            {job.label}
            {job.destructive && <span className="ops-tag ops-tag-danger" title="Destructive job">Destructive</span>}
            {job.critical && !job.destructive && <span className="ops-tag">Critical</span>}
          </div>
          <div className="ops-job-id"><code>{job.id}</code></div>
        </td>
        <td><StatePill meta={meta} title={job.reason} /></td>
        <td><PlatformTag platform={job.platform} runtime={runtime} /></td>
        <td title={job.lastSuccessAt || ""}>{formatRelative(job.lastSuccessAt)}</td>
        <td title={job.nextRunAt || ""}>
          {job.enabled ? formatRelative(job.nextRunAt) : <span className="ops-muted">—</span>}
        </td>
        <td><code className="ops-cron">{job.schedule}</code></td>
        <td className="ops-actions-cell">
          {job.enabled ? (
            <button className="ops-icon-btn" title="Stop this job" onClick={onStop}>
              <Icon name="pause" size={14} />
            </button>
          ) : (
            <button className="ops-icon-btn ops-icon-start" title="Start this job" onClick={onStart}>
              <Icon name="play-circle" size={14} />
            </button>
          )}
          <button
            className="ops-icon-btn"
            title={job.manualRunAllowed
              ? "Run now"
              : "This job is destructive — its schedule is the only way to trigger it"}
            onClick={onRun}
            disabled={!job.manualRunAllowed}
          >
            <Icon name="zap" size={14} />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="ops-job-detail-row">
          <td colSpan={8}>
            <div className="ops-job-detail">
              <p className="ops-job-desc">{job.description}</p>
              <p className="ops-job-reason"><strong>Status:</strong> {job.reason}</p>
              {job.caveat && (
                <div className="admin-ai-notice warn">
                  <Icon name="alert-triangle" size={15} /><span>{job.caveat}</span>
                </div>
              )}
              {!job.enabled && job.control?.reason && (
                <p className="ops-job-reason">
                  <strong>Stopped:</strong> {job.control.reason}
                  {job.control.changedBy ? ` — by ${job.control.changedBy}` : ""}
                  {job.control.changedAt ? ` (${formatRelative(job.control.changedAt)})` : ""}
                  {job.control.source === "env" && " · set via OPS_JOBS_DISABLED, not changeable from here"}
                </p>
              )}
              <p className="ops-job-reason">
                <strong>Cron:</strong> <code>{job.cron}</code> (UTC) · declared in <code>netlify.toml</code>
              </p>
              <h4 className="ops-runs-title">Recent runs</h4>
              <RunHistory runs={job.runs} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ScheduleRow({ s, onPause, onResume }) {
  const meta = scheduleStateMeta(s.state);
  const userEmail = s.user?.email || "";
  const userIdShort = s.userId ? String(s.userId).slice(0, 8) : "";
  return (
    <tr>
      <td>
        <div className="ops-job-name">{s.label}</div>
        <div className="ops-job-id">
          <code>{s.id}</code>
        </div>
        <div className="ops-schedule-user" title={userEmail || s.userId || ""}>
          {userEmail ? (
            <>
              <Icon name="user" size={11} /> <span>{userEmail}</span>
              <span className="ops-muted ops-uid"> · {userIdShort}</span>
            </>
          ) : s.userId ? (
            <span className="ops-muted"><Icon name="user" size={11} /> user {userIdShort}</span>
          ) : (
            <span className="ops-muted"><Icon name="user" size={11} /> no owner</span>
          )}
        </div>
      </td>
      <td className="ops-target" title={typeof s.target === "string" ? s.target : ""}>
        {Array.isArray(s.target) ? `${s.target.length} URLs` : (s.target || "—")}
      </td>
      <td><StatePill meta={meta} title={s.systemPauseReason || ""} /></td>
      <td title={s.lastRunAt || ""}>{formatRelative(s.lastRunAt)}</td>
      <td title={s.nextRunAt || ""}>
        {s.nextRunAt ? formatRelative(s.nextRunAt) : <span className="ops-muted">—</span>}
      </td>
      <td><span className="ops-cron-desc" title={s.cron}>{describeCron(s.cron)}</span></td>
      <td className="ops-actions-cell">
        {s.systemPaused ? (
          <button className="ops-icon-btn ops-icon-start" title="Release the system pause" onClick={onResume}>
            <Icon name="play-circle" size={14} />
          </button>
        ) : (
          <button className="ops-icon-btn" title="System-pause this schedule" onClick={onPause}>
            <Icon name="pause" size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

export default function AdminMonitoring() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Schedules table filters
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [scheduleQuery,  setScheduleQuery]  = useState("");
  // Audit table filters
  const [auditPlatform,  setAuditPlatform]  = useState("all");
  const [auditJob,       setAuditJob]       = useState("all");
  const [auditAction,    setAuditAction]    = useState("all");
  const [auditActor,     setAuditActor]     = useState("all");
  const [auditQuery,     setAuditQuery]     = useState("");
  // Guards against a slow in-flight refresh overwriting state after unmount.
  const alive = useRef(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const snapshot = await getMonitoringSnapshot();
      if (!alive.current) return;
      setData(snapshot);
      setError("");
    } catch (e) {
      if (!alive.current) return;
      setError(e.message || "Failed to load monitoring data.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Reset the job filter if the operator narrows to a platform that does
  // not contain the currently selected job — same rule AdminHealth uses
  // for the Benchmarks platform/service pair.
  useEffect(() => {
    if (auditJob !== "all" && auditPlatform !== "all") {
      if (jobPlatform(auditJob) !== auditPlatform) setAuditJob("all");
    }
  }, [auditPlatform]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmAction(reason) {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await pending.run(reason);
      showToast(res.message || "Done.");
      await load({ quiet: true });
      setPending(null);
    } catch (e) {
      showToast(e.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading">
          <Icon name="loader" size={18} className="spin" /> Loading automation status…
        </div>
      </div>
    );
  }

  const jobs = data?.jobs || [];
  const js = data?.jobSummary || {};
  const ss = data?.scheduleSummary || {};
  // Schedule filter chain: status preset (top buttons) → free-text query
  // (matches label, user email, userId). Empty query means "no text filter".
  const q = scheduleQuery.trim().toLowerCase();
  const schedules = (data?.schedules || []).filter((s) => {
    if (scheduleFilter === "all") {
      // pass
    } else if (scheduleFilter === "attention") {
      if (!(s.state === SCHEDULE_STATE.SYSTEM_PAUSED || s.lastStatus === "error")) return false;
    } else if (s.state !== scheduleFilter) {
      return false;
    }
    if (q) {
      const hay = `${s.label || ""} ${s.user?.email || ""} ${s.userId || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Audit-log filter chain. platform + job + action + actor are dropdowns;
  // query is a free-text search across reason + target. Platform narrows
  // the job dropdown so the operator cannot pick a "db" job while the
  // platform filter is set to "netlify".
  const aq = auditQuery.trim().toLowerCase();
  const auditAll = data?.audit || [];
  const auditWithPlatform = auditAll.map((a) => ({
    ...a,
    _platform: jobPlatform(a.target || ""),
  }));
  // Reset the job filter if the user narrows to a platform that does not
  // contain the currently selected job, so a stale job cannot hide the
  // table after a platform switch.
  if (auditJob !== "all" && auditPlatform !== "all") {
    const jobPlatformOfSelected = jobPlatform(auditJob);
    if (jobPlatformOfSelected !== auditPlatform) {
      // The `setAuditJob` call must happen at the top of the component to
      // satisfy rules-of-hooks; we do the reset in a useEffect below.
    }
  }
  const audit = auditWithPlatform.filter((a) => {
    if (auditPlatform !== "all" && a._platform !== auditPlatform) return false;
    if (auditJob      !== "all" && a.target !== auditJob) return false;
    if (auditAction   !== "all" && a.action !== auditAction) return false;
    if (auditActor    !== "all" && a.actor  !== auditActor)  return false;
    if (aq) {
      const hay = `${a.reason || ""} ${a.target || ""} ${a.actor || ""}`.toLowerCase();
      if (!hay.includes(aq)) return false;
    }
    return true;
  });
  // Distinct values for the dropdowns, derived from the loaded audit set.
  // Capped at 50 each so the selects don't grow without bound.
  const auditActions = Array.from(new Set(auditAll.map((a) => a.action).filter(Boolean))).slice(0, 50);
  const auditActors  = Array.from(new Set(auditAll.map((a) => a.actor).filter(Boolean))).slice(0, 50);
  const auditJobs    = (() => {
    // Only jobs that have actually been audited + are visible under the
    // current platform filter. Sorted to give the operator a stable list.
    const set = new Set(
      auditWithPlatform
        .filter((a) => auditPlatform === "all" || a._platform === auditPlatform)
        .map((a) => a.target)
        .filter(Boolean),
    );
    return Array.from(set).sort().slice(0, 100);
  })();

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">Automation Monitoring</h2>
          <p className="admin-section-sub">
            Platform crons and user monitoring schedules — execution status, last and next run,
            and start/stop control. Refreshed {autoRefresh ? "every 30s" : "manually"}.
            {data?.generatedAt && <> Last updated {formatRelative(data.generatedAt)}.</>}
          </p>
        </div>
        <div className="ops-head-actions">
          <label className="ops-auto-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => load()}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      {data && !data.historyAvailable && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} />
          <span>
            No run history: <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_KEY</code> are not set,
            so every job reads &quot;never run&quot;. That reflects missing configuration here, not a
            stopped platform.
          </span>
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <div className="ops-tiles">
        <SummaryTile icon="check-circle" label="Jobs healthy" value={js.healthy ?? 0} tone="ok" />
        <SummaryTile icon="alert-octagon" label="Failing / stuck" value={(js.failing ?? 0) + (js.stuck ?? 0)}
          tone={(js.failing || js.stuck) ? "danger" : "muted"} />
        <SummaryTile icon="alert-triangle" label="Stale" value={js.stale ?? 0}
          tone={js.stale ? "warn" : "muted"} />
        <SummaryTile icon="pause" label="Stopped" value={js.disabled ?? 0} />
        <SummaryTile icon="calendar-clock" label="Active schedules" value={ss.active ?? 0} tone="ok" />
        <SummaryTile icon="alert-triangle" label="System paused" value={ss.systemPaused ?? 0}
          tone={ss.systemPaused ? "warn" : "muted"} />
      </div>

      {/* ── Platform jobs ───────────────────────────────────────────────── */}
      <div className="admin-general-group card card-pad">
        <div className="admin-general-group-head">
          <Icon name="activity" size={18} />
          <div>
            <h3 className="admin-general-group-title">Platform jobs</h3>
            <p className="admin-general-group-desc">
              Scheduled functions declared in <code>netlify.toml</code>. Stopping a job here writes an
              operator kill switch that the job checks before it does any work — it does not
              unschedule the cron, so the job still fires and records a skipped run.
            </p>
          </div>
        </div>

        {data && data.envFlags && data.envFlags.purgeEnabled === false &&
          (data.jobs || []).some((j) => j.id === "billing-purge") && (
          <div className="admin-ai-notice">
            <Icon name="shield" size={15} />
            <span>
              <strong>Data purge (day 90) is intentionally disarmed.</strong>{" "}
              It is the only destructive job on the platform and ships off by design:
              <code> PURGE_ENABLED</code> is not set to <code>&quot;1&quot;</code> in the environment, so
              every scheduled run returns <code>skipped (PURGE_ENABLED is not 1)</code> and
              no customer data is touched. To arm it, set <code>PURGE_ENABLED=1</code> in
              the Netlify environment (after the five independent interlocks in the
              source have been reviewed end-to-end — see{" "}
              <code>netlify/functions/billing-purge.js</code>).
              {data.envFlags.purgeDryRun && (
                <> <code>PURGE_DRY_RUN=1</code> is also set, so a future arming will report what would be deleted without actually deleting.</>
              )}
            </span>
          </div>
        )}

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th aria-label="Expand" />
                <th>Job</th><th>Status</th><th>Last success</th><th>Next run</th>
                <th>Platform / build</th>
                <th>Schedule</th><th>Control</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  expanded={!!expanded[job.id]}
                  runtime={data?.dataSource?.netlify}
                  onToggle={() => setExpanded((e) => ({ ...e, [job.id]: !e[job.id] }))}
                  onStop={() => setPending({
                    key: `stop-${job.id}`,
                    title: `Stop ${job.label}?`,
                    description: `${job.id} will stop doing work from its next scheduled fire. It will still run and record a skipped run, so you can see it is stopped rather than broken.`,
                    warning: job.critical
                      ? "This job is critical. billing-purge refuses to delete anything unless billing-lifecycle has succeeded recently, so stopping the lifecycle also disarms the purge."
                      : "",
                    confirmLabel: "Stop job",
                    danger: true,
                    run: (reason) => setJobEnabled(job.id, false, reason),
                  })}
                  onStart={() => setPending({
                    key: `start-${job.id}`,
                    title: `Start ${job.label}?`,
                    description: `${job.id} will resume work on its next scheduled fire.`,
                    confirmLabel: "Start job",
                    run: (reason) => setJobEnabled(job.id, true, reason),
                  })}
                  onRun={() => setPending({
                    key: `run-${job.id}`,
                    title: `Run ${job.label} now?`,
                    description: `Executes ${job.id} immediately, outside its schedule. The run is tagged 'manual' in the history.`,
                    confirmLabel: "Run now",
                    run: (reason) => runJobNow(job.id, reason),
                  })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── User schedules ──────────────────────────────────────────────── */}
      <div className="admin-general-group card card-pad">
        <div className="admin-general-group-head">
          <Icon name="calendar-clock" size={18} />
          <div>
            <h3 className="admin-general-group-title">
              User monitoring schedules
              {/* Every user schedule is fired by scheduled-runner from this
                  function's runtime context, so the section-level chip
                  shows where those crons actually run. The Platform filter
                  on the audit log can narrow by the same value. */}
              {data?.dataSource?.netlify && (
                <span className="ops-group-source" title="The Netlify context these user schedules are running in.">
                  <Icon name="zap" size={12} /> Netlify · {data.dataSource.netlify}
                </span>
              )}
            </h3>
            <p className="admin-general-group-desc">
              Recurring extraction workflows across all users ({ss.total ?? 0} total). A system pause
              applied here is tagged <code>admin_paused</code>, so the billing lifecycle will not
              release it — and it never overrides a pause the user set themselves.
            </p>
          </div>
        </div>

        <div className="ops-filters ops-filters-bench">
          <div className="ops-filters-row">
            {[
              ["all", `All (${ss.total ?? 0})`],
              ["attention", `Needs attention (${(ss.systemPaused ?? 0) + (ss.failing ?? 0)})`],
              [SCHEDULE_STATE.ACTIVE, `Active (${ss.active ?? 0})`],
              [SCHEDULE_STATE.PAUSED, `User paused (${ss.paused ?? 0})`],
              [SCHEDULE_STATE.SYSTEM_PAUSED, `System paused (${ss.systemPaused ?? 0})`],
              [SCHEDULE_STATE.EXPIRED, `Expired (${ss.expired ?? 0})`],
            ].map(([key, label]) => (
              <button
                key={key}
                className={"ops-filter" + (scheduleFilter === key ? " active" : "")}
                onClick={() => setScheduleFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ops-filters-row">
            <span className="ops-filters-label">Search</span>
            <input
              className="ops-filter-input"
              type="search"
              value={scheduleQuery}
              onChange={(e) => setScheduleQuery(e.target.value)}
              placeholder="label, user email or id…"
              aria-label="Search user monitoring schedules"
            />
            {scheduleQuery && (
              <button
                className="ops-filter"
                onClick={() => setScheduleQuery("")}
                title="Clear search"
              >
                <Icon name="x" size={11} /> Clear
              </button>
            )}
          </div>
        </div>

        {schedules.length === 0 ? (
          <p className="ops-runs-empty">
            {(ss.total ?? 0) === 0
              ? "No user schedules exist yet."
              : "No schedules match this filter."}
          </p>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Schedule</th><th>Target</th><th>Status</th>
                  <th>Last run</th><th>Next run</th><th>Cadence</th><th>Control</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    s={s}
                    onPause={() => setPending({
                      key: `pause-${s.id}`,
                      title: `Pause "${s.label}"?`,
                      description: "Stops this user's schedule from running. Their own pause state is untouched, so releasing this later will not restart something they paused themselves.",
                      confirmLabel: "Pause schedule",
                      danger: true,
                      run: (reason) => pauseSchedule(s.id, reason),
                    })}
                    onResume={() => setPending({
                      key: `resume-${s.id}`,
                      title: `Resume "${s.label}"?`,
                      description: "Releases the system pause. If the user also paused it, it stays paused.",
                      confirmLabel: "Resume schedule",
                      run: (reason) => resumeSchedule(s.id, reason),
                    })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Discoverability monitors ─────────────────────────────────────
          A SEPARATE table (audit_schedules) with a SEPARATE daily runner
          (discoverability-monitor). Listed here because an operator asking
          "what is scheduled on this platform?" means both, and a monitoring
          dashboard that can only see half the scheduled work is the R19
          failure in miniature: nothing errors, and something is silently
          unwatched.

          Read-only for now, deliberately. Pausing one needs the same
          reason-dialog + ops_audit_log path the extraction schedules have,
          and shipping a control that writes no audit row would be worse than
          shipping no control — this section exists so the work is VISIBLE. */}
      {!!data?.auditMonitors?.length && (
        <div className="admin-general-group card card-pad">
          <div className="admin-general-group-head">
            <Icon name="scan-search" size={18} />
            <div>
              <h3 className="admin-general-group-title">Discoverability monitors</h3>
              <p className="admin-general-group-desc">
                From <code>audit_schedules</code>, fired daily by <code>discoverability-monitor</code> —
                a different table and a different cron from the extraction schedules above
                ({data.auditMonitors.length} total). Read-only here: pausing one needs the same
                reason-and-audit-log path as above, which is a follow-up.
              </p>
            </div>
          </div>

          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Monitor</th><th>Owner</th><th>Target</th>
                  <th>Cadence</th><th>State</th><th>Last run</th><th>Next run</th>
                </tr>
              </thead>
              <tbody>
                {data.auditMonitors.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="ops-sched-label">{m.label || "(unnamed)"}</div>
                      <div className="ops-sched-id">{m.profile} · {m.device}</div>
                    </td>
                    <td>
                      <div>{m.user?.email || "—"}</div>
                      <div className="ops-sched-id">{m.userId || ""}</div>
                    </td>
                    <td className="ops-sched-target" title={m.target}>{m.target || "—"}</td>
                    <td>{m.cadence}</td>
                    <td>
                      {/* The platform's pause and the user's are different
                          facts and are never collapsed into one word. */}
                      {m.systemPaused ? (
                        <span className="ops-pill ops-pill-warn" title={m.systemPauseReason || ""}>
                          System paused
                        </span>
                      ) : m.status === "paused" ? (
                        <span className="ops-pill">User paused</span>
                      ) : (
                        <span className="ops-pill ops-pill-ok">Active</span>
                      )}
                    </td>
                    <td>{m.lastRunAt ? formatRelative(m.lastRunAt) : "never"}</td>
                    <td>{m.nextRunAt ? formatRelative(m.nextRunAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Audit trail ─────────────────────────────────────────────────── */}
      {!!data?.audit?.length && (
        <div className="admin-general-group card card-pad">
          <div className="admin-general-group-head">
            <Icon name="history" size={18} />
            <div>
              <h3 className="admin-general-group-title">Recent operator actions</h3>
              <p className="admin-general-group-desc">
                From <code>ops_audit_log</code>. Never pruned — this is the record of who
                stopped what, and why. {audit.length !== (data.audit?.length ?? 0)
                  ? `Showing ${audit.length} of ${data.audit.length}.`
                  : ""}
              </p>
            </div>
          </div>

          <div className="ops-filters ops-filters-bench">
            <div className="ops-filters-row">
              <span className="ops-filters-label">Platform</span>
              <select
                className="ops-filter-select"
                value={auditPlatform}
                onChange={(e) => setAuditPlatform(e.target.value)}
                aria-label="Filter audit log by platform"
              >
                <option value="all">All</option>
                <option value="netlify">Netlify</option>
                <option value="db">DB &amp; Identity</option>
              </select>
              <span className="ops-filters-label">Job</span>
              <select
                className="ops-filter-select"
                value={auditJob}
                onChange={(e) => setAuditJob(e.target.value)}
                aria-label="Filter audit log by job"
                disabled={auditJobs.length === 0}
              >
                <option value="all">All</option>
                {auditJobs.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
              <span className="ops-filters-label">Action</span>
              <select
                className="ops-filter-select"
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value)}
                aria-label="Filter audit log by action"
              >
                <option value="all">All</option>
                {auditActions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <span className="ops-filters-label">Actor</span>
              <select
                className="ops-filter-select"
                value={auditActor}
                onChange={(e) => setAuditActor(e.target.value)}
                aria-label="Filter audit log by actor"
              >
                <option value="all">All</option>
                {auditActors.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="ops-filters-row">
              <span className="ops-filters-label">Search</span>
              <input
                className="ops-filter-input"
                type="search"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                placeholder="reason, target, or actor…"
                aria-label="Search audit log"
              />
              {(auditPlatform !== "all" || auditJob !== "all" || auditAction !== "all" || auditActor !== "all" || auditQuery) && (
                <button
                  className="ops-filter"
                  onClick={() => {
                    setAuditPlatform("all");
                    setAuditJob("all");
                    setAuditAction("all");
                    setAuditActor("all");
                    setAuditQuery("");
                  }}
                  title="Clear filters"
                >
                  <Icon name="x" size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>When</th><th>Platform</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
              <tbody>
                {audit.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="ops-muted" style={{ textAlign: "center", padding: "16px 0" }}>
                      No audit entries match the current filters.
                    </td>
                  </tr>
                ) : audit.map((a) => (
                  <tr key={a.id}>
                    <td title={a.created_at}>{formatRelative(a.created_at)}</td>
                    <td><PlatformTag platform={a._platform} withRuntime={false} /></td>
                    <td>{a.actor}</td>
                    <td><code>{a.action}</code></td>
                    <td><code>{a.target || "—"}</code></td>
                    <td className="ops-audit-reason">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        action={pending}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
