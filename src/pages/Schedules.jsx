// Schedules.jsx — manage recurring extraction / "track changes" schedules (route "/schedules").
//
// All scheduling configuration lives here (Home only arms a preset). Supports:
//   • Inline create/edit editor (ScheduleEditor) — incl. custom cadence + end date
//   • Pause / resume, run-now (single), delete, and edit for every schedule
//   • Expandable detail showing all parameters + lifecycle (last run, next run, alive-until)
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import ScheduleEditor from "../components/ScheduleEditor.jsx";
import { useToast } from "../components/Toast.jsx";
import { useGuestTrial } from "../components/GuestTrialProvider.jsx";
import {
  listSchedules,
  listSchedulesLocal,
  toggleSchedule,
  deleteSchedule,
  recordRun,
  cadenceLabel,
  describeCron,
} from "../lib/schedulerService.js";
import { extractStructure } from "../lib/firecrawlService.js";
import { saveScheduledExtraction } from "../lib/extractionsRepo.js";
import { recordScheduledItem } from "../lib/batchRunsService.js";
import { hostOf, timeAgo, fmtDate } from "../lib/utils.js";
import { useSeo } from "../hooks/useSeo.js";
import { discoverability } from "../lib/discoverability/discoverabilityClient.js";

const STATUS_META = {
  changed:   { icon: "alert-circle",   label: "Changed",   cls: "sch-status-changed" },
  unchanged: { icon: "check-circle",   label: "No change", cls: "sch-status-unchanged" },
  error:     { icon: "alert-triangle", label: "Error",     cls: "sch-status-error" },
};

function dtText(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fmtDate(iso)} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function DetailRow({ icon, label, children }) {
  return (
    <div className="sch-detail-row">
      <span className="sch-detail-label"><Icon name={icon} size={12} /> {label}</span>
      <span className="sch-detail-val">{children}</span>
    </div>
  );
}

function ScheduleCard({ schedule, expanded, onExpand, onToggle, onDelete, onRunNow, onEdit, running, highlight }) {
  const isBatch = schedule.type === "batch";
  const targetCount = isBatch ? (schedule.target?.length || 0) : 1;
  const status = schedule.lastStatus ? STATUS_META[schedule.lastStatus] : null;
  const paused = schedule.status === "paused";
  const expired = schedule.expiresAt && new Date(schedule.expiresAt) < new Date();
  // Never reached the database, so scheduled-runner.js (which reads Supabase
  // hourly) cannot see it. It will not fire. Say so instead of showing a next
  // run time that will never arrive.
  const localOnly = schedule._localOnly === true;

  return (
    <div className={"sch-card card" + (paused ? " sch-card-paused" : "") + (highlight ? " sch-card-hi" : "")}>
      <div className="sch-card-row">
        <button className="sch-card-main" onClick={onExpand} aria-expanded={expanded}>
          <span className="sch-card-icon">
            {isBatch ? <Icon name="layers-2" size={20} /> : <FaviconDot url={schedule.target} size={36} />}
          </span>
          <span className="sch-card-body">
            <span className="sch-card-title-row">
              <span className="sch-card-title">{schedule.label}</span>
              <span className="sch-card-type">
                <Icon name={isBatch ? "layers-2" : "repeat"} size={11} />
                {isBatch ? "Batch" : "Track"}
              </span>
              {paused && <span className="sch-card-paused-tag">Paused</span>}
              {expired && <span className="sch-card-paused-tag">Ended</span>}
              {localOnly && (
                <span className="sch-card-local-tag" title="Saved in this browser only — sign in so it actually runs">
                  <Icon name="alert-triangle" size={11} /> Not running
                </span>
              )}
            </span>
            <span className="sch-card-meta">
              <span><Icon name="globe" size={12} /> {isBatch ? `${targetCount} URLs` : hostOf(schedule.target)}</span>
              <span><Icon name="sparkles" size={12} /> {schedule.intent}</span>
              <span><Icon name="repeat" size={12} /> {cadenceLabel(schedule)}</span>
            </span>
            <span className="sch-card-runs">
              {status
                ? <span className={"sch-status " + status.cls}><Icon name={status.icon} size={12} /> {status.label}{schedule.lastRunAt && ` · ${timeAgo(schedule.lastRunAt)}`}</span>
                : <span className="sch-status sch-status-idle"><Icon name="clock" size={12} /> Not run yet</span>}
              {localOnly
                ? <span className="sch-next sch-next-warn"><Icon name="alert-triangle" size={12} /> Sign in to start this schedule</span>
                : !paused && !expired && <span className="sch-next"><Icon name="calendar" size={12} /> Next ≈ {dtText(schedule.nextRunAt)}</span>}
            </span>
          </span>
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} className="sch-card-caret" />
        </button>
        <div className="sch-card-actions">
          {!isBatch && (
            <Button variant="secondary" size="sm" icon={running ? "loader" : "play-circle"} onClick={onRunNow} disabled={running || paused} title="Run this check now">
              {running ? "Checking…" : "Run now"}
            </Button>
          )}
          <Button variant="ghost" size="sm" icon="edit" onClick={onEdit} title="Edit schedule" />
          <Button variant="ghost" size="sm" icon={paused ? "play-circle" : "pause"} onClick={onToggle} title={paused ? "Resume" : "Pause"} />
          <Button variant="ghost" size="sm" icon="trash" onClick={onDelete} title="Delete schedule" className="sch-delete-btn" />
        </div>
      </div>

      {expanded && (
        <div className="sch-detail">
          <DetailRow icon="layers-2" label="Type">{isBatch ? "Batch (multi-URL)" : "Track changes (single URL)"}</DetailRow>
          <DetailRow icon="globe" label="Target">
            {isBatch
              ? <span className="sch-detail-urls">{schedule.target.slice(0, 8).map((u) => <span key={u}>{u}</span>)}{schedule.target.length > 8 && <span className="muted">+{schedule.target.length - 8} more</span>}</span>
              : schedule.target}
          </DetailRow>
          <DetailRow icon="sparkles" label="Extract">{schedule.intent}{schedule.customPrompt ? ` — “${schedule.customPrompt}”` : ""}</DetailRow>
          <DetailRow icon="repeat" label="Cadence">{describeCron(schedule.cron)} <code className="sch-cron">{schedule.cron}</code></DetailRow>
          <DetailRow icon="mail" label="Alert">{schedule.alertEmail || <span className="muted">Dashboard only (no email)</span>}</DetailRow>
          <DetailRow icon="calendar" label="Created">{dtText(schedule.createdAt)}</DetailRow>
          <DetailRow icon="clock" label="Last run">{schedule.lastRunAt ? `${dtText(schedule.lastRunAt)} (${status?.label || "—"})` : "Not run yet"}</DetailRow>
          <DetailRow icon="calendar-clock" label="Next run">{localOnly ? "Never — not saved to your account" : paused ? "Paused" : expired ? "Ended" : dtText(schedule.nextRunAt)}</DetailRow>
          <DetailRow icon="calendar" label="Runs until">{schedule.expiresAt ? fmtDate(schedule.expiresAt) : <span className="muted">No end date</span>}</DetailRow>
          <DetailRow icon="check-circle" label="Total runs">{schedule.runCount || 0}</DetailRow>
        </div>
      )}
    </div>
  );
}

/**
 * One discoverability monitor.
 *
 * Deliberately a different card from ScheduleCard rather than a variant of it:
 * the two describe different things (a content hash vs four scores), have
 * different controls, and live in different tables. Making one component serve
 * both would mean a stream of `if (isAudit)` branches inside every row.
 */
function MonitorCard({ monitor, onToggle, onDelete, onOpen }) {
  const url = monitor.audit_targets?.canonical_url || monitor.target_url || "";
  const paused = monitor.status === "paused";
  // The PLATFORM's pause, which a user cannot lift — the column is REVOKEd
  // from clients. Saying which kind of pause this is matters: "resume" that
  // silently does nothing is worse than a disabled button with a reason.
  const systemPaused = Boolean(monitor.system_paused);

  return (
    <div className={"sch-card card" + (paused || systemPaused ? " sch-card-paused" : "")}>
      <div className="sch-card-main">
        <div className="sch-card-icon"><Icon name="scan-search" size={17} /></div>
        <div className="sch-card-body">
          <div className="sch-card-title-row">
            <span className="sch-card-title">{monitor.name || hostOf(url) || url}</span>
            <span className="sch-kind-badge">Discoverability</span>
            {systemPaused ? (
              <span className="sch-card-status sch-status-paused">Paused by DatIQ</span>
            ) : paused ? (
              <span className="sch-card-status sch-status-paused">Paused</span>
            ) : (
              <span className="sch-card-status sch-status-active">Active</span>
            )}
          </div>
          <div className="sch-card-meta">
            <span className="sch-card-url" title={url}>{url}</span>
            <span className="sch-summary-dot">·</span>
            <span>{monitor.cadence}</span>
            <span className="sch-summary-dot">·</span>
            <span>{monitor.audit_profile} · {monitor.device_profile}</span>
          </div>
          {systemPaused && monitor.system_pause_reason && (
            <p className="sch-card-note">
              <Icon name="info" size={12} /> {monitor.system_pause_reason === "compliance"
                ? "This site's robots.txt now disallows us, so the monitor was stopped."
                : monitor.system_pause_reason}
            </p>
          )}
        </div>
      </div>
      <div className="sch-card-actions">
        {monitor.last_audit_id && (
          <button className="sch-action" onClick={() => onOpen(monitor.last_audit_id)} title="Open the latest report">
            <Icon name="external-link" size={15} />
          </button>
        )}
        <button
          className="sch-action"
          onClick={onToggle}
          disabled={systemPaused}
          title={systemPaused ? "Paused by DatIQ — this cannot be resumed from here." : paused ? "Resume" : "Pause"}
        >
          <Icon name={paused ? "play" : "pause"} size={15} />
        </button>
        <button className="sch-action sch-action-danger" onClick={onDelete} title="Delete">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

export default function Schedules() {
  useSeo({
    title: "DatIQ Schedules — recurring extractions and change monitoring | DatIQ.app",
    description:
      "DatIQ Schedules — set up recurring extractions and get notified the moment a page changes. DatIQ.app is the zero-code web data extraction platform for monitoring competitor pricing, job posts, and more.",
    canonical: "https://datiq.app/schedules",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();
  const guestTrial = useGuestTrial();
  const [items, setItems] = useState(listSchedulesLocal);
  const [runningId, setRunningId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [editor, setEditor] = useState(null); // { draft } | { existing }
  const [highlightId, setHighlightId] = useState(null);
  // ── Discoverability monitors ──────────────────────────────────────────────
  // A separate list from a separate table (audit_schedules) run by a separate
  // cron. They are listed here, and only here, because the USER question is the
  // same — "keep watching this page for me" — and a second scheduling screen is
  // the thing this release removes elsewhere rather than adds.
  //
  // Held apart in state rather than merged into `items`: everything downstream
  // of `items` (toggle, delete, run-now, the local cache) speaks to
  // schedulerService, and teaching it to sometimes mean something else is how
  // two things end up sharing a name and neither behaving predictably.
  const [monitors, setMonitors] = useState([]);
  const loadMonitors = useCallback(() => {
    discoverability.listSchedules()
      .then((r) => setMonitors(r?.schedules || []))
      // Signed out, or the module is unavailable: show no monitors rather than
      // an error. The extraction schedules on this page are unaffected.
      .catch(() => setMonitors([]));
  }, []);

  // Handle hand-off from Home (preset arm → highlight; custom → open editor).
  useEffect(() => {
    const st = location.state || {};
    if (st.openEditor && st.draftSchedule) {
      setEditor({ draft: st.draftSchedule });
    }
    if (st.highlightId) {
      setHighlightId(st.highlightId);
      setTimeout(() => setHighlightId(null), 2400);
    }
    if (st.openEditor || st.highlightId || st.draftSchedule) {
      window.history.replaceState({}, "");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { listSchedules().then(setItems).catch(() => {}); }, []);
  useEffect(() => { loadMonitors(); }, [loadMonitors]);

  const refresh = useCallback(() => setItems(listSchedulesLocal()), []);

  const onToggle = async (id) => { await toggleSchedule(id); refresh(); };

  const onDelete = async (id) => {
    await deleteSchedule(id);
    refresh();
    showToast("Schedule deleted", "trash");
  };

  const onRunNow = async (schedule) => {
    // "Run now" is a real scrape — same gate as any other extraction. This
    // path reached extractStructure() ungated and uncounted.
    if (guestTrial?.requireGuestCredit?.("single") === false) return;
    setRunningId(schedule.id);
    try {
      const opts = {};
      if (schedule.renderJs) opts.renderJs = true;
      if (schedule.customPrompt) opts.customPrompt = schedule.customPrompt;
      const structure = await extractStructure(schedule.target, opts);
      const content = JSON.stringify({ title: structure.page_title, headings: structure.headings, custom: structure.custom_extraction ?? null });
      const updated = recordRun(schedule.id, { content });
      // Persist the run to the dashboard, grouped as a scheduled execution.
      saveScheduledExtraction(structure, schedule)
        .then((saved) => recordScheduledItem(schedule, saved?.id))
        .catch(() => {});
      refresh();
      if (updated?.lastStatus === "changed") showToast("Content changed since last check!", "alert-circle");
      else if (updated?.lastStatus === "unchanged") showToast("No changes detected", "check-circle");
    } catch (err) {
      console.error("[DatIQ] Run-now failed:", err);
      recordRun(schedule.id, { error: true });
      refresh();
      showToast("Check failed. We'll retry on the next scheduled run.");
    } finally {
      guestTrial?.trackGuestExtraction?.(1); // no-ops when signed in
      setRunningId(null);
    }
  };

  const onEditorSaved = () => {
    setEditor(null);
    refresh();
    listSchedules().then(setItems).catch(() => {});
    loadMonitors();
  };

  const onDeleteMonitor = async (id) => {
    try {
      await discoverability.deleteSchedule(id);
      showToast("Monitor deleted", "trash");
    } catch (err) {
      showToast(err?.message || "Couldn't delete that monitor.");
    }
    loadMonitors();
  };

  const onToggleMonitor = async (m) => {
    // `status` is the USER's intent. `system_paused` is the platform's, and it
    // is column-REVOKEd from clients — a monitor an operator paused must not be
    // resumable from here. Migration 0030 enforces that; this only ever writes
    // the user's own axis.
    const next = m.status === "paused" ? "active" : "paused";
    try {
      await discoverability.updateSchedule(m.id, { status: next });
    } catch (err) {
      showToast(err?.message || "Couldn't update that monitor.");
    }
    loadMonitors();
  };

  const active = items.filter((s) => s.status === "active");
  const activeMonitors = monitors.filter((m) => m.status === "active" && !m.system_paused);

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 40, paddingBottom: 72, maxWidth: 920 }}>
        <div className="sch-hero">
          <div className="eyebrow"><Icon name="repeat" size={13} /> Scheduler</div>
          <div className="sch-hero-row">
            <div>
              <h1 className="sch-h1">Monitoring & schedules</h1>
              <p className="sch-sub">
                Recurring extractions that watch pages for you. Get alerted when content changes —
                pricing updates, new contacts, edited copy.
              </p>
            </div>
            {!editor && (
              <Button variant="primary" icon="plus" onClick={() => setEditor({ draft: { type: "track" } })}>
                New schedule
              </Button>
            )}
          </div>
        </div>

        {editor && (
          <ScheduleEditor
            draft={editor.draft}
            existing={editor.existing}
            onSaved={onEditorSaved}
            onCancel={() => setEditor(null)}
          />
        )}

        {monitors.length > 0 && (
          <>
            <div className="sch-summary">
              <span><strong>{activeMonitors.length}</strong> active</span>
              <span className="sch-summary-dot">·</span>
              <span><strong>{monitors.length}</strong> discoverability monitor{monitors.length === 1 ? "" : "s"}</span>
            </div>
            <div className="sch-list">
              {monitors.map((m) => (
                <MonitorCard
                  key={m.id}
                  monitor={m}
                  onToggle={() => onToggleMonitor(m)}
                  onDelete={() => onDeleteMonitor(m.id)}
                  onOpen={(auditId) => navigate(`/discoverability?audit=${encodeURIComponent(auditId)}`)}
                />
              ))}
            </div>
          </>
        )}

        {items.length === 0 && !editor && monitors.length === 0 ? (
          <div className="sch-empty card">
            <div className="sch-empty-icon"><Icon name="calendar-clock" size={30} /></div>
            <h3>No schedules yet</h3>
            <p>
              From the home screen, enter a URL or turn on <strong>Batch</strong>, pick a <strong>Schedule</strong>
              preset, and hit the action button — or create one here with full custom options.
            </p>
            <div className="sch-empty-actions">
              <Button variant="primary" icon="plus" onClick={() => setEditor({ draft: { type: "track" } })}>New schedule</Button>
              <Button variant="ghost" icon="arrow-right" onClick={() => navigate("/")}>Go to extractor</Button>
            </div>
          </div>
        ) : items.length > 0 ? (
          <>
            <div className="sch-summary">
              <span><strong>{active.length}</strong> active</span>
              <span className="sch-summary-dot">·</span>
              <span><strong>{items.length}</strong> total</span>
            </div>
            <div className="sch-list">
              {items.map((s) => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  expanded={expandedId === s.id}
                  highlight={highlightId === s.id}
                  onExpand={() => setExpandedId((id) => (id === s.id ? null : s.id))}
                  onToggle={() => onToggle(s.id)}
                  onDelete={() => onDelete(s.id)}
                  onRunNow={() => onRunNow(s)}
                  onEdit={() => { setEditor({ existing: s }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  running={runningId === s.id}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
