// /workflows — the end-to-end orchestration view.
//
// Account Lists, Competitor Watchlists and Signal Rules are ONE pipeline
// presented as three unrelated screens. This is the screen that shows the
// pipeline, and — more usefully — the places it is disconnected.
//
// ⚠️ THE ISSUES LEAD, NOT THE DIAGRAM. A picture of what is wired is
// decoration; every gap this names fails silently today, so "What needs your
// attention" is the first thing on the page and the columns are context for it.
import React, { Component, useEffect, useState } from "react";
import { Link } from "react-router";
import Icon from "../components/Icon.jsx";
import SignedInRequired from "../components/SignedInRequired.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { SEVERITY, STAGES, nextStep, labelForTrigger } from "../lib/workflows/workflowGraph.js";
import InlineFix from "../components/workflows/InlineFix.jsx";
import TracePanel from "../components/workflows/TracePanel.jsx";
import { getWorkflowGraph } from "../lib/workflows/workflowClient.js";
import { updateRule, deleteRule } from "../lib/rules/rulesClient.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";

const STAGE_META = {
  lists: { title: "Account lists", icon: "list", blurb: "Who you care about", href: "/lists" },
  watchlists: { title: "Competitor watchlists", icon: "eye", blurb: "What to watch", href: "/watchlists" },
  rules: { title: "Signal rules", icon: "zap", blurb: "What happens next", href: "/rules" },
};

const SEV_META = {
  [SEVERITY.BLOCKING]: { label: "Blocking", icon: "alert-circle", cls: "wf-sev-blocking" },
  [SEVERITY.WARNING]: { label: "Needs attention", icon: "alert-circle", cls: "wf-sev-warning" },
  [SEVERITY.INFO]: { label: "For information", icon: "info", cls: "wf-sev-info" },
};

class WorkflowsErrorBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="wf-stage" style={{ margin: "24px 0", borderLeft: "3px solid var(--danger, #ef4444)", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger, #ef4444)", marginBottom: 8 }}>
            <Icon name="alert-circle" size={18} />
            <strong style={{ fontSize: "14px" }}>Workflow view could not be rendered</strong>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-2)", margin: 0 }}>
            {this.state.error?.message || "An unexpected error occurred while rendering the workflow pipeline."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12 }}
          >
            Retry View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function WorkflowSkeleton() {
  return (
    <div className="page container wf-page" style={{ opacity: 0.7 }}>
      <header className="wf-head">
        <div style={{ height: 28, width: 160, background: "var(--surface-2)", borderRadius: "var(--r, 6px)", marginBottom: 8 }} />
        <div style={{ height: 16, width: "60%", background: "var(--surface-2)", borderRadius: "var(--r, 6px)" }} />
      </header>
      <div style={{ height: 90, background: "var(--surface-2)", borderRadius: "var(--r, 14px)", marginTop: 20 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 24 }}>
        <div style={{ height: 150, background: "var(--surface-2)", borderRadius: "var(--r, 14px)" }} />
        <div style={{ height: 150, background: "var(--surface-2)", borderRadius: "var(--r, 14px)" }} />
        <div style={{ height: 150, background: "var(--surface-2)", borderRadius: "var(--r, 14px)" }} />
      </div>
    </div>
  );
}

function EditWorkflowModal({ pipeline, onClose, onSaved }) {
  const [name, setName] = useState(pipeline.name || "");
  const [triggerSource, setTriggerSource] = useState(pipeline.trigger_source || "watchlist");
  const [actionType, setActionType] = useState(pipeline.action_type || "slack");
  const [destination, setDestination] = useState(
    pipeline.action_config?.to || pipeline.action_config?.channel || pipeline.action_config?.url || ""
  );
  const [status, setStatus] = useState(pipeline.health === "paused" ? "paused" : "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const actionConfig = { ...pipeline.action_config };
      if (actionType === "email") actionConfig.to = destination;
      else if (actionType === "slack") actionConfig.channel = destination;
      else if (actionType === "webhook") actionConfig.url = destination;

      await updateRule(pipeline.rule_id, {
        name: name.trim(),
        trigger_source: triggerSource,
        action_type: actionType,
        action_config: actionConfig,
        status,
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Failed to update workflow");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r, 14px)", maxWidth: 520, width: "100%", padding: 24, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: "16px", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="edit" size={16} /> Edit Workflow
          </h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && <p className="wf-error" style={{ marginBottom: 12 }}><Icon name="alert-circle" size={14} /> {error}</p>}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: 4, color: "var(--text-2)" }}>Workflow Name</label>
            <input
              type="text"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: 4, color: "var(--text-2)" }}>Trigger Source</label>
              <select
                className="input-field"
                value={triggerSource}
                onChange={(e) => setTriggerSource(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              >
                <option value="watchlist">Competitor Watchlist</option>
                <option value="bulk_enrichment">Account List Enrichment</option>
                <option value="workflow_run">Template Runs</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: 4, color: "var(--text-2)" }}>Status</label>
              <select
                className="input-field"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              >
                <option value="active">Active (firing)</option>
                <option value="paused">Paused (idle)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: 4, color: "var(--text-2)" }}>Destination Action</label>
              <select
                className="input-field"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              >
                <option value="slack">Slack</option>
                <option value="email">Email</option>
                <option value="webhook">Webhook</option>
                <option value="hubspot">HubSpot</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: 4, color: "var(--text-2)" }}>
                {actionType === "email" ? "Recipient Email" : actionType === "slack" ? "Channel / Webhook" : actionType === "webhook" ? "Target URL" : "Destination"}
              </label>
              <input
                type="text"
                className="input-field"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={actionType === "email" ? "ops@company.com" : actionType === "slack" ? "#signals" : "https://api..."}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteWorkflowModal({ pipeline, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    // Belt and braces: never send a delete for something that has no rule behind it.
    if (!pipeline.rule_id) {
      setError("This row isn't a saved workflow — there is nothing to delete. Connect a rule to it instead.");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteRule(pipeline.rule_id);
      onDeleted();
    } catch (err) {
      setError(err.message || "Failed to delete workflow");
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r, 14px)", maxWidth: 460, width: "100%", padding: 24, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--danger, #dc2626)", marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--danger-soft, #fee2e2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="alert-triangle" size={18} />
          </div>
          <h3 style={{ margin: 0, fontSize: "16px" }}>Delete this rule?</h3>
        </div>

        <p style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.5, margin: "0 0 12px" }}>
          Delete the rule <strong>{pipeline.name}</strong>? It stops acting on {pipeline.upstream_summary || "its source"}
          {pipeline.action_type && pipeline.action_type !== "none" ? <> and nothing more is sent to its destination</> : null}.
          Your lists and watchlists are not affected.
        </p>

        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r, 8px)", padding: "10px 12px", fontSize: "12px", color: "var(--text-2)", marginBottom: 16 }}>
          <Icon name="shield-check" size={14} style={{ color: "var(--success, #10b981)", verticalAlign: "-2px", marginRight: 6 }} />
          <strong>Audit Trail Preserved:</strong> All past execution logs, run traces, and historical deliveries remain archived in your audit records.
        </div>

        {error && <p className="wf-error" style={{ marginBottom: 12 }}><Icon name="alert-circle" size={14} /> {error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting} style={{ background: "var(--danger, #dc2626)", color: "#fff" }}>
            {deleting ? "Deleting…" : "Delete rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The one-page brief: what this pipeline is, and the single next thing to do.
 */
function GuidePanel({ step }) {
  if (!step) return null;
  return (
    <section className="wf-guide">
      <div className="wf-guide-main">
        <span className="wf-guide-kicker"><Icon name="compass" size={13} /> Start here</span>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="wf-guide-actions">
          {(step.actions || []).map((a) => (
            a.href.startsWith("#") ? (
              <a key={a.label} href={a.href} className={a.primary ? "wf-guide-cta" : "wf-guide-alt"}>
                {a.label} <Icon name="arrow-right" size={13} />
              </a>
            ) : (
              <Link key={a.label} to={a.href} className={a.primary ? "wf-guide-cta" : "wf-guide-alt"}>
                {a.label} <Icon name="arrow-right" size={13} />
              </Link>
            )
          ))}
        </div>
      </div>

      <ol className="wf-guide-steps">
        <li><strong>Lists</strong><span>Accounts you sell to. Enrichment scores them against your ICP.</span></li>
        <li><strong>Watchlists</strong><span>Competitors you track. A check finds what changed since last time.</span></li>
        <li><strong>Rules</strong><span>What happens when either moves — Slack, email, webhook or HubSpot.</span></li>
      </ol>
    </section>
  );
}

export default function Workflows() {
  const { user, authLoading } = useAuth();
  const cachedGraph = readPageCache("workflowGraph")?.data || null;
  const [graph, setGraph] = useState(cachedGraph);
  const [loading, setLoading] = useState(!cachedGraph);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editingPipeline, setEditingPipeline] = useState(null);
  const [deletingPipeline, setDeletingPipeline] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const g = await getWorkflowGraph();
        if (!cancelled) {
          setGraph(g);
          writePageCache("workflowGraph", g);
        }
      } catch (e) {
        if (!cancelled && !graph) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, reloadKey]);

  if (authLoading) {
    return <WorkflowSkeleton />;
  }

  if (!user) {
    return (
      <SignedInRequired
        title="Workflow orchestration"
        reason="This view is assembled from your own lists, watchlists and rules, so it needs an account to have anything to show."
      />
    );
  }

  return (
    <div className="page container wf-page">
      <WorkflowsErrorBoundary>
        <header className="wf-head">
        <h1>Workflow hub</h1>
        <p>
          Account lists, competitor watchlists and signal rules are one pipeline:
          who you care about → what to watch about them → what happens when it moves.
          This is where it connects, and where it does not.
        </p>
      </header>

      {loading && <p className="wf-muted">Assembling your workflow…</p>}
      {error && <p className="wf-error"><Icon name="alert-circle" size={14} /> {error}</p>}

      {graph && (
        <>
          {/* ── START HERE ────────────────────────────────────────────────
              ONE step, not a checklist. A user landing on an empty pipeline
              with five equally-weighted suggestions does none of them; the
              order in nextStep() is the order the pipeline runs, because a
              rule with nothing upstream is not progress, it is the unreachable
              rule this screen exists to warn about. */}
          <GuidePanel step={nextStep(graph)} />

          {/* ── WHAT IS BROKEN ────────────────────────────────────────────── */}
          <section className="wf-issues" id="wf-issues">
            <h2>
              What needs your attention
              {graph.counts.blocking > 0 && <span className="wf-badge wf-sev-blocking">{graph.counts.blocking} blocking</span>}
              {graph.counts.warning > 0 && <span className="wf-badge wf-sev-warning">{graph.counts.warning}</span>}
            </h2>

            {graph.issues.length === 0 ? (
              <p className="wf-ok">
                <Icon name="check" size={14} /> Every stage is wired and producing. Nothing is stuck.
              </p>
            ) : (
              <ul className="wf-issue-list">
                {graph.issues.map((i, n) => {
                  const sev = SEV_META[i.severity];
                  return (
                    <li key={`${i.code}-${i.subjectId || n}`} className={`wf-issue ${sev.cls}`}>
                      <Icon name={sev.icon} size={15} />
                      <div className="wf-issue-body">
                        <div className="wf-issue-title">
                          <strong>{i.title}</strong>
                          {i.subject && <span className="wf-issue-subject">{i.subject}</span>}
                        </div>
                        <p className="wf-issue-detail">{i.detail}</p>
                      </div>
                      <div className="wf-issue-side">
                        {i.fix && (
                          <Link to={i.fix.href} className="wf-issue-fix">
                            {i.fix.label} <Icon name="arrow-right" size={13} />
                          </Link>
                        )}
                        <InlineFix issue={i} graph={graph} onDone={() => setReloadKey((k) => k + 1)} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── THE PIPELINE ──────────────────────────────────────────────── */}
          <section className="wf-stages">
            {STAGES.map((stage, idx) => {
              const meta = STAGE_META[stage];
              const nodes = graph.nodes.filter((n) => n.stage === stage);
              return (
                <div className="wf-stage" key={stage}>
                  <div className="wf-stage-head">
                    <Icon name={meta.icon} size={15} />
                    <div>
                      <h3>{meta.title}</h3>
                      <span className="wf-stage-blurb">{meta.blurb}</span>
                    </div>
                  </div>

                  {nodes.length === 0 ? (
                    <p className="wf-stage-empty">Nothing here yet.</p>
                  ) : (
                    <ul className="wf-node-list">
                      {nodes.map((n) => (
                        <li key={n.id} className="wf-node">
                          <span className="wf-node-label">{n.label}</span>
                          <span className="wf-node-meta">{n.meta}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Link to={meta.href} className="wf-stage-link">
                    Open {meta.title.toLowerCase()} <Icon name="arrow-right" size={12} />
                  </Link>

                  {/* The arrow is a claim about flow, so it is only drawn
                      between stages that a rule actually connects. */}
                  {idx < STAGES.length - 1 && (
                    <div className="wf-arrow" aria-hidden="true"><Icon name="arrow-right" size={16} /></div>
                  )}
                </div>
              );
            })}
          </section>

          {/* ── WORKFLOW TEMPLATES LIBRARY LINK ─────────────────────────────── */}
          <div style={{
            background: "var(--surface-2, #f9fafb)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r, 14px)",
            padding: "16px 20px",
            marginTop: 24,
            marginBottom: 24,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: "var(--r, 10px)",
                background: "var(--accent-soft, #eef2ff)",
                color: "var(--accent, #4f46e5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <Icon name="layout-list" size={18} />
              </div>
              <div>
                <strong style={{ fontSize: "14px", display: "block", color: "var(--text)" }}>Workflow Templates Library</strong>
                <span style={{ fontSize: "12px", color: "var(--text-2)" }}>
                  Deploy pre-built workflows for competitor intelligence, account signals, recruiter sourcing, and agency teardowns.
                </span>
              </div>
            </div>
            <Link to="/templates?filter=workflows" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="sparkles" size={13} /> Browse Templates <Icon name="arrow-right" size={12} />
            </Link>
          </div>

          {/* ── SAVED WORKFLOWS (PIPELINES) ─────────────────────────────────── */}
          <section className="wf-pipelines" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 style={{ fontSize: "1.1rem", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="git-merge" size={16} /> Saved Workflows &amp; Pipelines
                  <span className="wf-badge" style={{ background: "var(--surface-2)", color: "var(--text-1)", border: "1px solid var(--border)" }}>
                    {graph.pipelines?.length || 0}
                  </span>
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-2)" }}>
                  End-to-end automated pipelines connecting sources, rules, and actions.
                </p>
              </div>
              <Link to="/rules?new=1" className="btn btn-secondary btn-sm">
                <Icon name="plus" size={13} /> New rule
              </Link>
            </div>

            {(!graph.pipelines || graph.pipelines.length === 0) ? (
              <div className="wf-stage" style={{ textAlign: "center", padding: "28px 16px" }}>
                <Icon name="git-branch" size={24} style={{ color: "var(--text-muted, #9ca3af)", margin: "0 auto 8px" }} />
                <p style={{ margin: 0, fontSize: "13px", color: "var(--text-2)" }}>
                  No automated pipelines configured yet. Create a signal rule to connect your lists or watchlists to actions.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {graph.pipelines.map((p) => {
                  const isHealthy = p.health === "healthy";
                  const isPaused = p.health === "paused";
                  const isDisconnected = p.health === "disconnected";
                  const badgeCls = isHealthy
                    ? "wf-badge"
                    : isPaused
                    ? "wf-badge wf-sev-info"
                    : isDisconnected
                    ? "wf-badge wf-sev-blocking"
                    : "wf-badge wf-sev-warning";
                  const badgeStyle = isHealthy
                    ? { background: "var(--success-soft, #d1fae5)", color: "var(--success, #059669)" }
                    : {};

                  return (
                    <div
                      key={p.id}
                      className="wf-pipeline-card"
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderLeft: `4px solid ${
                          isHealthy
                            ? "var(--success, #10b981)"
                            : isPaused
                            ? "var(--border, #9ca3af)"
                            : isDisconnected
                            ? "var(--danger, #ef4444)"
                            : "var(--warning, #f59e0b)"
                        }`,
                        borderRadius: "var(--r, 14px)",
                        padding: "16px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                      }}
                    >
                      {/* Pipeline Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <strong style={{ fontSize: "15px", color: "var(--text)" }}>{p.name}</strong>
                            <span className={badgeCls} style={badgeStyle}>
                              {p.health_label}
                            </span>
                          </div>
                          <span style={{ fontSize: "12px", color: "var(--text-3)" }}>
                            Trigger: <b>{labelForTrigger(p.trigger_source)}</b>
                          </span>
                        </div>
                        {/* An "Unconnected" row is built on the fly (lists or watchlists exist,
                            no rule listens). There is no stored workflow behind it — Edit and
                            Delete used to call the rules API with no id ("ruleId is required.").
                            It offers the two things that actually help instead. */}
                        {!p.rule_id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <Link to={p.fix?.href || "/rules?new=1"} className="btn btn-primary btn-sm">
                              <Icon name="plus" size={13} /> Connect a rule
                            </Link>
                            <Link to={p.trigger_source === "watchlist" ? "/watchlists" : "/lists"} className="btn btn-secondary btn-sm">
                              {p.trigger_source === "watchlist" ? "Manage watchlists" : "Manage lists"}
                            </Link>
                          </div>
                        ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingPipeline(p)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: "12px" }}
                          >
                            <Icon name="edit" size={13} /> Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setDeletingPipeline(p)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: "12px", color: "var(--danger, #dc2626)" }}
                            title="Delete workflow"
                          >
                            <Icon name="trash-2" size={13} /> Delete
                          </button>
                        </div>
                        )}
                      </div>

                      {/* End-to-End Steps Flow */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, alignItems: "stretch" }}>
                        {/* Step 1: Upstream Source */}
                        <div style={{ background: "var(--surface-2, #f9fafb)", border: "1px solid var(--border)", borderRadius: "var(--r, 10px)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "12px", color: "var(--text-2)", fontWeight: 600 }}>
                            <Icon name={p.trigger_source === "watchlist" ? "eye" : "list"} size={14} style={{ color: "var(--accent)" }} />
                            Step 1: Source ({p.upstream_stage})
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text)" }}>
                            {p.upstream_summary}
                          </div>
                          {p.upstream_items && p.upstream_items.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                              {p.upstream_items.slice(0, 3).map((item) => (
                                <Link
                                  key={item.id}
                                  to={item.href}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: "11px",
                                    background: "var(--surface)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "var(--r-pill, 999px)",
                                    padding: "2px 8px",
                                    textDecoration: "none",
                                    color: "var(--text)",
                                  }}
                                  title="View item details"
                                >
                                  <Icon name="external-link" size={10} />
                                  <span>{item.name}</span>
                                </Link>
                              ))}
                              {p.upstream_items.length > 3 && (
                                <span style={{ fontSize: "11px", color: "var(--text-3)", alignSelf: "center" }}>
                                  +{p.upstream_items.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Step 2: Trigger & Filter */}
                        <div style={{ background: "var(--surface-2, #f9fafb)", border: "1px solid var(--border)", borderRadius: "var(--r, 10px)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "12px", color: "var(--text-2)", fontWeight: 600 }}>
                            <Icon name="filter" size={14} style={{ color: "var(--accent)" }} />
                            Step 2: Signal Filter
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text)" }}>
                            Listens for: <strong>{labelForTrigger(p.trigger_source)}</strong>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-2)" }}>
                            {p.conditions && p.conditions.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {p.conditions.map((c, idx) => (
                                  <span key={idx} style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>
                                    {c.field} {c.operator} {c.value}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>No filter conditions (all signals pass)</span>
                            )}
                          </div>
                          <Link to={`/rules?rule=${encodeURIComponent(p.rule_id)}`} className="wf-stage-link" style={{ marginTop: "auto", paddingTop: 4 }}>
                            Modify rule <Icon name="arrow-right" size={11} />
                          </Link>
                        </div>

                        {/* Step 3: Destination Action */}
                        <div style={{ background: "var(--surface-2, #f9fafb)", border: "1px solid var(--border)", borderRadius: "var(--r, 10px)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "12px", color: "var(--text-2)", fontWeight: 600 }}>
                            <Icon name="zap" size={14} style={{ color: "var(--accent)" }} />
                            Step 3: Action Delivery
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text)" }}>
                            Destination: <strong style={{ textTransform: "uppercase" }}>{p.action_type}</strong>
                            <span style={{ color: "var(--text-2)", display: "block", fontSize: "11px" }}>
                              {p.action_config?.to && `To: ${p.action_config.to}`}
                              {p.action_config?.channel && `Channel: ${p.action_config.channel}`}
                              {p.action_config?.url && `Endpoint: ${p.action_config.url}`}
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-2)", marginTop: "auto", paddingTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>{p.execution_count} execution{p.execution_count === 1 ? "" : "s"}</span>
                            {p.last_execution && (
                              <span style={{ color: p.last_execution.status === "success" || p.last_execution.status === "delivered" ? "var(--success, #059669)" : "var(--danger, #dc2626)", fontWeight: 500 }}>
                                ● {p.last_execution.status} ({p.last_execution.latency_ms || 0}ms)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── RECENT EXECUTIONS ─────────────────────────────────────────── */}
          {graph.recent_executions && graph.recent_executions.length > 0 && (
            <section className="wf-executions" style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: "1.1rem", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="activity" size={16} /> Recent Signal Executions
              </h2>
              <div style={{ overflowX: "auto" }}>
                <table className="dash-table" style={{ width: "100%", fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "160px" }}>Timestamp</th>
                      <th>Rule</th>
                      <th style={{ width: "110px" }}>Status</th>
                      <th style={{ width: "90px" }}>Latency</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graph.recent_executions.slice(0, 10).map((ex) => {
                      const ruleNode = graph.nodes?.find((n) => n.id === ex.rule_id);
                      return (
                        <tr key={ex.id}>
                          <td style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                            {ex.executed_at ? new Date(ex.executed_at).toLocaleString() : "—"}
                          </td>
                          <td>
                            <strong>{ruleNode?.label || ex.rule_id}</strong>
                          </td>
                          <td>
                            <span
                              className={`wf-badge ${
                                ex.status === "success" || ex.status === "delivered"
                                  ? "wf-badge"
                                  : "wf-sev-blocking"
                              }`}
                              style={
                                ex.status === "success" || ex.status === "delivered"
                                  ? { background: "var(--success-soft, #d1fae5)", color: "var(--success, #059669)" }
                                  : {}
                              }
                            >
                              {ex.status}
                            </span>
                          </td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {ex.latency_ms ? `${ex.latency_ms}ms` : "—"}
                          </td>
                          <td style={{ color: ex.error ? "var(--danger, #dc2626)" : "var(--text-2)", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ex.error || "Dispatched successfully"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── WOULD IT FIRE? ────────────────────────────────────────────
              The question that comes straight after "is it connected", and
              which had no answer anywhere in the product before this. */}
          <TracePanel rules={graph.nodes.filter((n) => n.stage === "rules")} />

          <p className="wf-foot">
            Rules listen for a <em>kind</em> of event, not a specific list or watchlist — so a rule
            watching for competitor changes fires for all of them.
          </p>
        </>
      )}

      {editingPipeline && (
        <EditWorkflowModal
          pipeline={editingPipeline}
          onClose={() => setEditingPipeline(null)}
          onSaved={() => {
            setEditingPipeline(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {deletingPipeline && (
        <DeleteWorkflowModal
          pipeline={deletingPipeline}
          onClose={() => setDeletingPipeline(null)}
          onDeleted={() => {
            setDeletingPipeline(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      </WorkflowsErrorBoundary>
    </div>
  );
}
