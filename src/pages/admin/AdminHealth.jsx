// AdminHealth.jsx — servers, databases, services and connectivity at a glance.
//
// The design rule this page follows everywhere: "not checked" is rendered as a
// distinct, neutral state — never as green and never as red. An operator must
// be able to tell "Razorpay is fine" from "nobody configured the Razorpay
// probe" without reading the code. See src/lib/healthModel.js.

import { useCallback, useEffect, useRef, useState } from "react";
import { getHealthSnapshot } from "../../lib/monitoringService.js";
import {
  healthStatusMeta, HEALTH_STATUS, HEALTH_GROUPS, latencyBudget,
} from "../../lib/healthModel.js";
import { formatRelative } from "../../lib/monitoringModel.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const REFRESH_MS = 60_000;

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
  { hours: 720, label: "30d" },
];

const OVERALL_COPY = {
  [HEALTH_STATUS.OK]: "All monitored systems are operational.",
  [HEALTH_STATUS.DEGRADED]: "Something is slow or partially unavailable.",
  [HEALTH_STATUS.DOWN]: "A critical system is unreachable.",
  [HEALTH_STATUS.UNKNOWN]: "Nothing could be checked — no service is configured.",
};

function StatusDot({ status }) {
  const meta = healthStatusMeta(status);
  return <span className={`ops-dot ops-dot-${meta.tone}`} aria-label={meta.label} title={meta.label} />;
}

function LatencyBadge({ ms, grade, componentId }) {
  if (ms === null || ms === undefined) return <span className="ops-muted">—</span>;
  const { fast, slow } = latencyBudget(componentId);
  return (
    <span
      className={`ops-latency ops-latency-${grade || "none"}`}
      title={`Budget for this component: fast ≤ ${fast}ms, slow ≥ ${slow}ms`}
    >
      {ms}ms
    </span>
  );
}

function detailPairs(detail) {
  if (!detail || typeof detail !== "object") return [];
  return Object.entries(detail)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .slice(0, 6);
}

function ComponentCard({ c, uptime, windowLabel }) {
  const meta = healthStatusMeta(c.status);
  const unknown = c.status === HEALTH_STATUS.UNKNOWN;
  return (
    <div className={`ops-health-card ops-health-${meta.tone}` + (unknown ? " ops-health-unchecked" : "")}>
      <div className="ops-health-card-head">
        <StatusDot status={c.status} />
        <div className="ops-health-card-title">
          {c.label}
          {c.critical && <span className="ops-tag" title="A failure here breaks the product">Critical</span>}
        </div>
        <span className={`ops-pill ops-pill-${meta.tone}`}>{meta.label}</span>
      </div>

      <p className="ops-health-desc">{c.description}</p>
      {c.note && <p className="ops-health-note">{c.note}</p>}

      <div className="ops-health-metrics">
        <div className="ops-metric">
          <span className="ops-metric-label">Latency</span>
          <LatencyBadge ms={c.latencyMs} grade={c.latencyGrade} componentId={c.id} />
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Uptime ({windowLabel})</span>
          <span className="ops-metric-value">
            {uptime ? `${uptime.uptimePct}%` : <span className="ops-muted">no data</span>}
          </span>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Avg latency</span>
          <span className="ops-metric-value">
            {uptime?.avgLatencyMs != null ? `${uptime.avgLatencyMs}ms` : <span className="ops-muted">—</span>}
          </span>
        </div>
      </div>

      {!!detailPairs(c.detail).length && (
        <dl className="ops-health-detail">
          {detailPairs(c.detail).map(([k, v]) => (
            <div key={k} className="ops-health-detail-row">
              <dt>{k}</dt><dd title={String(v)}>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function AdminHealth() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [windowHours, setWindowHours] = useState(24);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async ({ quiet = false, record = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const snapshot = await getHealthSnapshot({ windowHours, record });
      if (!alive.current) return;
      setData(snapshot);
      setError("");
    } catch (e) {
      if (!alive.current) return;
      setError(e.message || "Failed to load health data.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [windowHours]);

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

  if (loading && !data) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading">
          <Icon name="loader" size={18} className="spin" /> Probing services…
        </div>
      </div>
    );
  }

  const components = data?.components || [];
  const summary = data?.summary || {};
  const uptime = data?.uptime || {};
  const overallMeta = healthStatusMeta(data?.overall);
  const windowLabel = WINDOWS.find((w) => w.hours === windowHours)?.label || `${windowHours}h`;

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">Service Health</h2>
          <p className="admin-section-sub">
            Live reachability and latency for hosting, database, identity and the external services
            the product depends on. Probes run on request; uptime comes from the hourly{" "}
            <code>health-monitor</code> samples.
            {data?.generatedAt && <> Probed {formatRelative(data.generatedAt)}.</>}
          </p>
        </div>
        <div className="ops-head-actions">
          <label className="ops-auto-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => load()}>Probe now</Button>
          <Button
            variant="ghost" size="sm"
            onClick={async () => {
              await load({ record: true });
              showToast("Probed and stored a sample.");
            }}
            title="Probe and store this round as a health sample"
          >
            Probe &amp; record
          </Button>
        </div>
      </div>

      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      {/* ── Headline ────────────────────────────────────────────────────── */}
      <div className={`ops-overall ops-overall-${overallMeta.tone}`}>
        <Icon name={overallMeta.icon} size={22} />
        <div className="ops-overall-body">
          <div className="ops-overall-title">{overallMeta.label}</div>
          <div className="ops-overall-sub">{OVERALL_COPY[data?.overall] || ""}</div>
        </div>
        <div className="ops-overall-counts">
          <span className="ops-count ops-count-ok">{summary.ok ?? 0} operational</span>
          <span className="ops-count ops-count-warn">{summary.degraded ?? 0} degraded</span>
          <span className="ops-count ops-count-danger">{summary.down ?? 0} down</span>
          <span className="ops-count ops-count-muted">{summary.unknown ?? 0} not checked</span>
        </div>
      </div>

      {(summary.unknown ?? 0) > 0 && (
        <div className="admin-ai-notice">
          <Icon name="info" size={15} />
          <span>
            &quot;Not checked&quot; means the credentials for that probe are absent, so nothing was
            asked. It is deliberately not counted as an outage and never affects the headline above
            or the uptime figures.
          </span>
        </div>
      )}

      {/* ── Grouped cards ───────────────────────────────────────────────── */}
      {HEALTH_GROUPS.map((group) => {
        const inGroup = components.filter((c) => c.group === group.id);
        if (!inGroup.length) return null;
        return (
          <div className="admin-general-group card card-pad" key={group.id}>
            <div className="admin-general-group-head">
              <Icon name={group.icon} size={18} />
              <div>
                <h3 className="admin-general-group-title">{group.label}</h3>
                <p className="admin-general-group-desc">
                  {inGroup.filter((c) => c.status === HEALTH_STATUS.OK).length} of {inGroup.length} operational.
                </p>
              </div>
            </div>
            <div className="ops-health-grid">
              {inGroup.map((c) => (
                <ComponentCard key={c.id} c={c} uptime={uptime[c.id]} windowLabel={windowLabel} />
              ))}
            </div>
          </div>
        );
      })}

      {/* ── Benchmarks ──────────────────────────────────────────────────── */}
      <div className="admin-general-group card card-pad">
        <div className="admin-general-group-head">
          <Icon name="gauge" size={18} />
          <div>
            <h3 className="admin-general-group-title">Benchmarks</h3>
            <p className="admin-general-group-desc">
              Latency is graded against a per-component budget, not one global threshold — a
              same-region database query and a third-party status page have budgets an order of
              magnitude apart.
            </p>
          </div>
        </div>

        <div className="ops-filters">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              className={"ops-filter" + (windowHours === w.hours ? " active" : "")}
              onClick={() => setWindowHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </div>

        {!data?.historyAvailable ? (
          <div className="admin-ai-notice warn">
            <Icon name="alert-triangle" size={15} />
            <span>
              Uptime history is off: <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_KEY</code> are
              not set, so no samples are stored. Current status still works.
            </span>
          </div>
        ) : data.samplesInWindow === 0 ? (
          <div className="admin-ai-notice">
            <Icon name="info" size={15} />
            <span>
              No samples in this window yet. <code>health-monitor</code> stores one per component per
              hour; use <strong>Probe &amp; record</strong> to add one now.
            </span>
          </div>
        ) : null}

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Component</th><th>Status</th><th>Latency</th>
                <th>Uptime ({windowLabel})</th><th>Avg</th><th>Peak</th><th>Samples</th><th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                const u = uptime[c.id];
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="ops-job-name">{c.label}</div>
                      <div className="ops-job-id"><code>{c.id}</code></div>
                    </td>
                    <td><StatusDot status={c.status} /> {healthStatusMeta(c.status).label}</td>
                    <td><LatencyBadge ms={c.latencyMs} grade={c.latencyGrade} componentId={c.id} /></td>
                    <td>{u ? `${u.uptimePct}%` : <span className="ops-muted">—</span>}</td>
                    <td>{u?.avgLatencyMs != null ? `${u.avgLatencyMs}ms` : <span className="ops-muted">—</span>}</td>
                    <td>{u?.maxLatencyMs != null ? `${u.maxLatencyMs}ms` : <span className="ops-muted">—</span>}</td>
                    <td>{u?.samples ?? <span className="ops-muted">0</span>}</td>
                    <td title={c.checkedAt || ""}>{formatRelative(c.checkedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
