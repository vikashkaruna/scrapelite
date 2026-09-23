// WorkflowRunHistory.jsx — every workflow-template run, filterable.
//
// Upgraded to match the look-and-feel of the Extractions tab with rich
// table/cards layout, selection bar, batch actions, search, filters,
// and navigation to the dedicated full-page preview at /workflows/runs/:runId.

import { useEffect, useMemo, useState, useContext } from "react";
import { Link, useNavigate } from "react-router";
import * as api from "../lib/templates/templatesClient.js";
import {
  filterRuns, summariseRuns, bucketOf, templateKeysIn, monthsIn, RUN_FILTERS,
} from "../lib/templates/runHistory.js";
import { runToItem } from "../lib/templates/runToItems.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import ExportMenu from "./ExportMenu.jsx";
import PushIntegrationMenu from "./PushIntegrationMenu.jsx";
import { useToast } from "./Toast.jsx";
import { AuthContext } from "./AuthProvider.jsx";

const BUCKET_LABEL = {
  succeeded: "Succeeded", partial: "Partial", failed: "Failed",
  running: "Running", unknown: "Unknown",
};

const TEMPLATE_ICONS = {
  account_brief: "briefcase",
  competitor_pricing_tracker: "tag",
  executive_brief: "award",
  security_compliance_audit: "shield-check",
  tech_stack_detector: "cpu",
  seo_gap_analysis: "search",
};

const humanTemplate = (k) => String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const when = (v) => (v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function StatusPill({ run }) {
  const b = bucketOf(run);
  return <span className={`wrh-pill wrh-pill-${b}`}>{BUCKET_LABEL[b]}</span>;
}

function Check({ checked, indeterminate, onChange, title }) {
  return (
    <button
      type="button"
      className={"dash-check" + (checked ? " on" : indeterminate ? " ind" : "")}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={indeterminate && !checked ? "mixed" : checked}
      title={title}
    >
      {checked ? <Icon name="check" size={13} strokeWidth={3} /> : indeterminate ? <Icon name="minus" size={13} strokeWidth={3} /> : null}
    </button>
  );
}

export default function WorkflowRunHistory({ compact = false, limit = null }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const authContext = useContext(AuthContext);
  const user = authContext?.user || null;

  const [runs, setRuns] = useState(() => {
    try {
      const raw = localStorage.getItem("datiq.workflowRuns");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(() => !runs);
  const [error, setError] = useState(null);
  const [bucket, setBucket] = useState("all");
  const [templateKey, setTemplateKey] = useState("all");
  const [month, setMonth] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem("datiq.wrhLayout") || "table";
    } catch {
      return "table";
    }
  });

  const loadData = () => {
    setLoading(true);
    api.listRuns()
      .then((r) => {
        const fetched = r.runs || [];
        setRuns(fetched);
        setError(null);
        try {
          localStorage.setItem("datiq.workflowRuns", JSON.stringify(fetched));
        } catch { /* ignore storage error */ }
      })
      .catch((e) => {
        if (!runs) setRuns([]);
        setError(e?.status === 401 ? null : e.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const changeLayout = (l) => {
    setLayout(l);
    try { localStorage.setItem("datiq.wrhLayout", l); } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    const f = filterRuns(runs || [], { bucket, templateKey, month, query });
    return limit ? f.slice(0, limit) : f;
  }, [runs, bucket, templateKey, month, query, limit]);

  const summary = useMemo(() => summariseRuns(runs || []), [runs]);

  // Selection handlers
  const allIds = filtered.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));
  const selectedRuns = (runs || []).filter((r) => selected.has(r.id));

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allSelected) allIds.forEach((id) => next.delete(id));
    else allIds.forEach((id) => next.add(id));
    return next;
  });

  const clearSelection = () => setSelected(new Set());

  const handleOpenRun = (r) => {
    navigate(`/workflows/runs/${encodeURIComponent(r.id)}`, { state: { run: r } });
  };

  const handleReRun = (e, r) => {
    e.stopPropagation();
    navigate(`/templates?key=${encodeURIComponent(r.template_key)}`, {
      state: { prefill: r.input },
    });
  };

  if (runs === null || loading && !runs) {
    return (
      <div className="wrh-loading">
        <Icon name="loader" size={16} className="spin" />
        <span>Loading workflow runs…</span>
      </div>
    );
  }

  if (!runs.length) {
    return (
      <div className="wrh-empty">
        <Icon name="layout-list" size={28} />
        <p>No workflow runs yet.</p>
        <Link className="btn btn-primary btn-sm" to="/templates">
          <Icon name="play" size={14} /> Start a workflow template
        </Link>
      </div>
    );
  }

  // ── Compact Mode (for Account page) ───────────────────────────
  if (compact) {
    return (
      <div className="wrh wrh-compact">
        <div className="wrh-stats">
          <span className="wrh-stat"><b>{summary.total}</b> runs</span>
          <span className="wrh-stat"><b>{summary.succeeded}</b> succeeded</span>
          <span className="wrh-stat"><b>{summary.partial}</b> partial</span>
          <span className="wrh-stat"><b>{summary.failed}</b> failed</span>
          <span className="wrh-stat"><b>{summary.creditsSpent}</b> credits actual</span>
        </div>
        <ul className="wrh-list">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="wrh-row wrh-row-interactive"
              role="button"
              tabIndex={0}
              onClick={() => handleOpenRun(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleOpenRun(r);
                }
              }}
            >
              <div className="wrh-row-main">
                <span className="wrh-template">{humanTemplate(r.template_key)}</span>
                <span className="wrh-target">{r.input?.domain || r.input?.url || "—"}</span>
                {r.output_summary && <span className="wrh-summary">{r.output_summary}</span>}
              </div>
              <div className="wrh-row-meta">
                <StatusPill run={r} />
                {Number.isFinite(r.credits_actual) && <span className="wrh-credits">{r.credits_actual} cr</span>}
                <span className="wrh-when">{when(r.created_at)}</span>
                <span className="wrh-open-affordance" aria-hidden="true" title="Open run">
                  <Icon name="arrow-up-right" size={13} />
                </span>
              </div>
            </li>
          ))}
        </ul>
        {runs.length > filtered.length && (
          <p className="wrh-more">
            <Link to="/dashboard?view=runs">See all {runs.length} runs →</Link>
          </p>
        )}
      </div>
    );
  }

  // ── Full Dashboard Mode ───────────────────────────────────────
  const selectedExportItems = selectedRuns.map(runToItem).filter(Boolean);
  const allExportItems = filtered.map(runToItem).filter(Boolean);
  const exportItems = selectedExportItems.length > 0 ? selectedExportItems : allExportItems;

  return (
    <div className="wrh">
      {/* ── Header Summary Stats ──────────────────────────────────── */}
      <div className="wrh-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div className="wrh-stats">
          <span className="wrh-stat"><b>{summary.total}</b> runs</span>
          <span className="wrh-stat"><b>{summary.succeeded}</b> succeeded</span>
          <span className="wrh-stat"><b>{summary.partial}</b> partial</span>
          <span className="wrh-stat"><b>{summary.failed}</b> failed</span>
          <span className="wrh-stat">
            <b>{summary.creditsSpent}</b> credits
            <em title="Charged credits only — estimates for runs still in flight are excluded.">actual</em>
          </span>
          {summary.successRate !== null && (
            <span className="wrh-stat" title="Of finished runs">
              <b>{Math.round(summary.successRate * 100)}%</b> success
            </span>
          )}
        </div>

        <div className="dash-header-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="dash-view-toggle" role="group" aria-label="Layout">
            <button
              type="button"
              className={"dash-view-btn" + (layout === "table" ? " on" : "")}
              onClick={() => changeLayout("table")}
              title="Table view"
              aria-label="Table view"
            >
              <Icon name="grid" size={14} />
            </button>
            <button
              type="button"
              className={"dash-view-btn" + (layout === "cards" ? " on" : "")}
              onClick={() => changeLayout("cards")}
              title="Cards view"
              aria-label="Cards view"
            >
              <Icon name="layout-grid" size={14} />
            </button>
          </div>
          {exportItems.length > 0 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ExportMenu
                items={exportItems}
                label={selectedExportItems.length > 0 ? `Download (${selectedExportItems.length})` : "Download"}
                buttonVariant="secondary"
                showPush={false}
                showEmail={false}
              />
              <PushIntegrationMenu
                items={exportItems}
                buttonLabel={selectedExportItems.length > 0 ? `Push (${selectedExportItems.length})` : "Push to Integration"}
                buttonVariant="secondary"
              />
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadData}
            title="Refresh runs"
          >
            <Icon name="rotate-cw" size={13} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
          <Link to="/templates" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} />
            <span>New workflow run</span>
          </Link>
        </div>
      </div>

      {/* ── Toolbar: Outcome chips, Template dropdown, Search, Selection ── */}
      <div className="wrh-filters" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: "1 1 auto" }}>
          <div className="wrh-chips" role="group" aria-label="Filter by outcome">
            {RUN_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={"wrh-chip" + (bucket === f.key ? " on" : "")}
                aria-pressed={bucket === f.key}
                onClick={() => setBucket(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by template"
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            style={{ borderRadius: "var(--r-md)", padding: "5px 10px", fontSize: "13px" }}
          >
            <option value="all">All templates</option>
            {templateKeysIn(runs).map((k) => (
              <option key={k} value={k}>{humanTemplate(k)}</option>
            ))}
          </select>

          <select
            aria-label="Filter by month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ borderRadius: "var(--r-md)", padding: "5px 10px", fontSize: "13px" }}
          >
            <option value="all">All time</option>
            {monthsIn(runs).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <div style={{ position: "relative", minWidth: 200, flex: "1 1 200px" }}>
            <input
              type="search"
              aria-label="Search runs"
              placeholder="Search domain or summary…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%", paddingRight: 24 }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}
                aria-label="Clear search"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Floating Selection Bar */}
        {selected.size > 0 && (
          <div className="dash-selbar">
            <span className="dash-sel-count">
              {selected.size} {selected.size === 1 ? "run" : "runs"} selected
            </span>
            <button
              type="button"
              className="dash-sel-clear-btn"
              onClick={clearSelection}
              style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: "12px", cursor: "pointer", padding: "2px 6px" }}
            >
              Clear
            </button>
            {selectedExportItems.length > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ExportMenu
                  items={selectedExportItems}
                  label="Download"
                  buttonVariant="secondary"
                  showPush={false}
                  showEmail={false}
                />
                <PushIntegrationMenu
                  items={selectedExportItems}
                  buttonLabel="Push to Integration"
                  buttonVariant="secondary"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="wrh-error">
          <Icon name="alert-circle" size={14} /> {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: "40px 16px" }}>
          <div className="empty-orb"><Icon name="search" size={28} /></div>
          <h2>No matching workflow runs</h2>
          <p>Try clearing filters or search query to see other template runs.</p>
          <Button variant="secondary" size="sm" onClick={() => { setBucket("all"); setTemplateKey("all"); setMonth("all"); setQuery(""); }}>
            Clear all filters
          </Button>
        </div>
      ) : layout === "table" ? (
        /* ── Rich Table View ────────────────────────────────────────── */
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="dash-table" style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th className="col-check" style={{ width: "40px" }}>
                  <Check
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={toggleAll}
                    title={allSelected ? "Deselect all" : "Select all runs"}
                  />
                </th>
                <th style={{ width: "200px" }}>Template</th>
                <th style={{ width: "160px" }}>Target</th>
                <th className="col-sum">Summary</th>
                <th style={{ width: "105px" }}>Status</th>
                <th style={{ width: "85px" }}>Credits</th>
                <th className="col-date" style={{ width: "130px" }}>Run Date</th>
                <th className="col-act" style={{ width: "125px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isSelected = selected.has(r.id);
                const target = r.input?.domain || r.input?.url || "—";
                const iconName = TEMPLATE_ICONS[r.template_key] || "layout-list";
                const exportItem = runToItem(r);

                return (
                  <tr
                    key={r.id}
                    className={isSelected ? "sel" : ""}
                    onClick={() => handleOpenRun(r)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpenRun(r);
                      }
                    }}
                    title="Click to view run preview"
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <Check
                        checked={isSelected}
                        onChange={() => toggleOne(r.id)}
                        title={isSelected ? "Deselect run" : "Select run"}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--surface-2)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
                          <Icon name={iconName} size={15} />
                        </div>
                        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
                          {humanTemplate(r.template_key)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: "var(--text-2)", fontFamily: "monospace", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {target}
                      </span>
                    </td>
                    <td className="col-sum">
                      <div className="wrh-summary" style={{ WebkitLineClamp: 1 }}>
                        {r.output_summary || r.error || "—"}
                      </div>
                    </td>
                    <td>
                      <StatusPill run={r} />
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {Number.isFinite(r.credits_actual) ? `${r.credits_actual} cr` : "0 cr"}
                      </span>
                    </td>
                    <td className="col-date">
                      <span style={{ color: "var(--text-3)", fontSize: "12px" }}>
                        {when(r.created_at)}
                      </span>
                    </td>
                    <td className="col-act" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          onClick={() => handleOpenRun(r)}
                          title="View preview"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={(e) => handleReRun(e, r)}
                          title="Re-run in Templates"
                        >
                          <Icon name="rotate-cw" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Cards View ────────────────────────────────────────────── */
        <div className="dash-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginTop: 8 }}>
          {filtered.map((r) => {
            const isSelected = selected.has(r.id);
            const target = r.input?.domain || r.input?.url || "—";
            const iconName = TEMPLATE_ICONS[r.template_key] || "layout-list";
            const exportItem = runToItem(r);

            return (
              <div
                key={r.id}
                className={"dash-card card card-pad" + (isSelected ? " sel" : "")}
                onClick={() => handleOpenRun(r)}
                style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-2)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
                      <Icon name={iconName} size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text-1)", fontSize: "14px" }}>
                        {humanTemplate(r.template_key)}
                      </div>
                      <div style={{ color: "var(--text-3)", fontSize: "12px", fontFamily: "monospace" }}>
                        {target}
                      </div>
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Check
                      checked={isSelected}
                      onChange={() => toggleOne(r.id)}
                      title={isSelected ? "Deselect run" : "Select run"}
                    />
                  </div>
                </div>

                <div className="wrh-summary" style={{ WebkitLineClamp: 2, margin: 0, fontSize: "13px", color: "var(--text-2)" }}>
                  {r.output_summary || r.error || "No summary available."}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: "12px", color: "var(--text-3)" }}>
                  <StatusPill run={r} />
                  <span>{Number.isFinite(r.credits_actual) ? `${r.credits_actual} cr` : "0 cr"}</span>
                  <span>{when(r.created_at)}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => handleOpenRun(r)}>
                    View
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => handleReRun(e, r)} title="Re-run">
                    <Icon name="rotate-cw" size={13} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
