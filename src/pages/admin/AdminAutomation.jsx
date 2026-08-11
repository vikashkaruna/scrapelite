// AdminAutomation.jsx — observability page for the n8n workflow pipeline.
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §6 (admin surface)
//
// Shows: pending/processing/done/failed counts, recent events, 24h stats,
// and per-event retry/cancel/dispatch actions. Backed by /api/admin-automation.
import { useState, useEffect, useCallback, useRef } from "react";
import { adminToken } from "../../lib/adminConfigService.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const ENDPOINT = "/api/admin-automation";

function authedHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` };
}

const STATE_COLORS = {
  pending: "#f59e0b",
  processing: "#3b82f6",
  done: "#10b981",
  failed: "#ef4444",
  cancelled: "#94a3b8",
};

function StatePill({ state }) {
  return (
    <span className="automation-state-pill" style={{ "--pill-color": STATE_COLORS[state] || "#94a3b8" }}>
      {state}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, accent }) {
  return (
    <div className="admin-kpi-card card card-pad">
      <div className="kpi-icon" style={{ "--kpi-accent": accent ?? "var(--accent)" }}>
        <Icon name={icon} size={18} />
      </div>
      <div className="kpi-value">{value ?? "—"}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function EventRow({ event, selected, onClick }) {
  return (
    <tr
      className={"automation-event-row" + (selected ? " selected" : "")}
      onClick={() => onClick(event)}
    >
      <td><StatePill state={event.state} /></td>
      <td className="automation-kind-cell">{event.kind}</td>
      <td className="automation-refid-cell" title={event.ref_id || ""}>
        {event.ref_id ? event.ref_id.slice(0, 14) + (event.ref_id.length > 14 ? "…" : "") : "—"}
      </td>
      <td>{event.attempts}/{event.max_attempts}</td>
      <td className="automation-time-cell">{fmtTime(event.created_at)}</td>
      <td className="automation-error-cell" title={event.last_error || ""}>
        {event.last_error ? event.last_error.slice(0, 40) : "—"}
      </td>
    </tr>
  );
}

function EventDetail({ event, onClose, onAction, busy }) {
  if (!event) {
    return (
      <div className="automation-detail-empty">
        <Icon name="mouse-pointer-click" size={20} />
        <span>Select an event to view its attempts and channels.</span>
      </div>
    );
  }
  return (
    <div className="automation-detail">
      <div className="automation-detail-head">
        <div className="automation-detail-id">{event.id}</div>
        <button className="automation-detail-close" onClick={onClose} title="Close">
          <Icon name="x" size={14} />
        </button>
      </div>
      <dl className="automation-detail-grid">
        <dt>State</dt>      <dd><StatePill state={event.state} /></dd>
        <dt>Kind</dt>       <dd>{event.kind}</dd>
        <dt>Ref</dt>        <dd>{event.ref_id || "—"}</dd>
        <dt>User</dt>       <dd>{event.user_id || "—"}</dd>
        <dt>Attempts</dt>   <dd>{event.attempts}/{event.max_attempts}</dd>
        <dt>Next attempt</dt><dd>{fmtTime(event.next_attempt_at)}</dd>
        <dt>Created</dt>    <dd>{fmtTime(event.created_at)}</dd>
        <dt>Started</dt>    <dd>{fmtTime(event.started_at)}</dd>
        <dt>Finished</dt>   <dd>{fmtTime(event.finished_at)}</dd>
        {event.last_error && (<><dt>Error</dt><dd className="automation-detail-error">{event.last_error}</dd></>)}
      </dl>
      {event.channels && event.channels.length > 0 && (
        <div className="automation-detail-channels">
          <h4>Channels</h4>
          <ul>
            {event.channels.map((c, i) => (
              <li key={i}><code>{c.type}</code> {c.target || c.channel || c.to || ""}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="automation-detail-actions">
        {event.state === "failed" && (
          <Button variant="primary" size="sm" onClick={() => onAction("retry")} disabled={busy}>
            <Icon name="rotate-ccw" size={14} /> Retry
          </Button>
        )}
        {event.state === "pending" || event.state === "failed" ? (
          <Button variant="secondary" size="sm" onClick={() => onAction("dispatch")} disabled={busy}>
            <Icon name="zap" size={14} /> Dispatch now
          </Button>
        ) : null}
        {event.state !== "done" && event.state !== "cancelled" && (
          <Button variant="ghost" size="sm" onClick={() => onAction("cancel")} disabled={busy}>
            <Icon name="ban" size={14} /> Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminAutomation() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | failed | done
  const [warning, setWarning] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(ENDPOINT, { headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!alive.current) return;
      if (!res.ok || !data.ok) {
        setError(data.error || `Failed to load (${res.status})`);
      } else {
        setStats(data.stats);
        setEvents(data.events || []);
      }
    } catch (e) {
      if (!alive.current) return;
      setError(e.message || "Failed to load.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    try {
      const res = await fetch(`${ENDPOINT}?event_id=${encodeURIComponent(id)}`, { headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!alive.current) return;
      if (data.ok) setSelected({ ...data.event, runs: data.runs || [] });
    } catch {/* ignore */}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const onAction = useCallback(async (action) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ action, event_id: selected.id }),
      });
      const data = await res.json();
      if (!alive.current) return;
      if (!data.ok) {
        setError(data.error || `Action failed (${res.status})`);
      } else {
        setWarning("");
        await loadDetail(selected.id);
        await load();
      }
    } catch (e) {
      if (alive.current) setError(e.message || "Action failed");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [selected, loadDetail, load]);

  const onRunNow = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ action: "run-now" }),
      });
      const data = await res.json();
      if (!alive.current) return;
      if (!data.ok) {
        setError(data.error || "Run-now failed");
      } else {
        setWarning("Orchestrator poll triggered.");
        setTimeout(() => alive.current && setWarning(""), 3000);
        await load();
      }
    } catch (e) {
      if (alive.current) setError(e.message || "Run-now failed");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [load]);

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    return e.state === filter;
  });

  return (
    <div className="page admin-automation-page">
      <header className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Automation</h1>
          <p className="admin-page-sub">n8n workflow pipeline observability. v2 plan §6.</p>
        </div>
        <div className="admin-page-actions">
          <Button variant="secondary" size="sm" onClick={onRunNow} disabled={busy || loading}>
            <Icon name="zap" size={14} /> Run now
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <Icon name="refresh-cw" size={14} /> Refresh
          </Button>
        </div>
      </header>

      {warning && <div className="admin-warning-banner">{warning}</div>}
      {error && <div className="admin-error-banner">{error}</div>}

      <section className="automation-kpis">
        <KpiCard label="Pending" value={stats?.byState?.pending ?? 0} icon="clock" accent="#f59e0b" />
        <KpiCard label="Processing" value={stats?.byState?.processing ?? 0} icon="loader" accent="#3b82f6" />
        <KpiCard label="Failed (24h)" value={stats?.last24h?.failed ?? 0} icon="alert-circle" accent="#ef4444" />
        <KpiCard label="Done (24h)" value={stats?.last24h?.done ?? 0} icon="check-circle" accent="#10b981" />
        <KpiCard
          label="Avg time-to-done"
          value={fmtDuration(stats?.avgTimeToDoneMs)}
          icon="timer"
          accent="var(--accent)"
        />
        <KpiCard label="Total (24h)" value={stats?.last24hTotal ?? 0} icon="activity" />
      </section>

      {stats?.byKind && Object.keys(stats.byKind).length > 0 && (
        <section className="automation-kinds card card-pad">
          <h3>Events by kind</h3>
          <div className="automation-kind-chips">
            {Object.entries(stats.byKind).map(([k, n]) => (
              <span key={k} className="automation-kind-chip">
                <code>{k}</code> <strong>{n}</strong>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="automation-table-section">
        <div className="automation-table-head">
          <h3>Recent events</h3>
          <div className="automation-filter-group" role="tablist">
            {["all", "pending", "failed", "done", "cancelled"].map((f) => (
              <button
                key={f}
                className={"automation-filter-btn" + (filter === f ? " active" : "")}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {loading && events.length === 0 ? (
          <div className="automation-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="automation-empty">No events matching "{filter}".</div>
        ) : (
          <div className="automation-table-wrap">
            <table className="automation-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Kind</th>
                  <th>Ref ID</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <EventRow key={e.id} event={e} selected={selectedId === e.id} onClick={(ev) => setSelectedId(ev.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="automation-detail-section card card-pad">
        <EventDetail event={selected} onClose={() => { setSelectedId(null); setSelected(null); }} onAction={onAction} busy={busy} />
      </section>
    </div>
  );
}
