// /workflows — the end-to-end orchestration view.
//
// Account Lists, Competitor Watchlists and Signal Rules are ONE pipeline
// presented as three unrelated screens. This is the screen that shows the
// pipeline, and — more usefully — the places it is disconnected.
//
// ⚠️ THE ISSUES LEAD, NOT THE DIAGRAM. A picture of what is wired is
// decoration; every gap this names fails silently today, so "What needs your
// attention" is the first thing on the page and the columns are context for it.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import Icon from "../components/Icon.jsx";
import SignedInRequired from "../components/SignedInRequired.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { SEVERITY, STAGES, nextStep } from "../lib/workflows/workflowGraph.js";
import InlineFix from "../components/workflows/InlineFix.jsx";
import TracePanel from "../components/workflows/TracePanel.jsx";
import { getWorkflowGraph } from "../lib/workflows/workflowClient.js";
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

/**
 * The one-page brief: what this pipeline is, and the single next thing to do.
 *
 * ⚠️ It states the MODEL, not just the action. "Create a rule" without
 * "a rule decides who hears about it" leaves the user clicking a button whose
 * consequence they cannot predict — and this pipeline's whole failure mode is
 * things that look configured and do nothing.
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

      {/* The mental model, once, in plain words. Three screens that each make
          sense alone still do not explain that they are one pipeline. */}
      <ol className="wf-guide-steps">
        <li><strong>Lists</strong><span>Accounts you sell to. Enrichment scores them against your ICP.</span></li>
        <li><strong>Watchlists</strong><span>Competitors you track. A check finds what changed since last time.</span></li>
        <li><strong>Rules</strong><span>What happens when either moves — Slack, email, webhook or HubSpot.</span></li>
      </ol>
    </section>
  );
}

export default function Workflows() {
  const { user } = useAuth();
  const cachedGraph = readPageCache("workflowGraph")?.data || null;
  const [graph, setGraph] = useState(cachedGraph);
  const [loading, setLoading] = useState(!cachedGraph);
  const [error, setError] = useState(null);

  // No SEO call here, matching /rules and /watchlists: /workflows is a PRIVATE
  // prefix, and the noindex is enforced in the four places the page-ownership
  // invariant checks (site-routes.mjs, netlify.toml's X-Robots-Tag, robots.txt,
  // and index.html's inline guard) rather than from inside the component.

  // Bumped by an inline fix so the diagnosis re-runs in place. Creating the
  // missing link and then still being told it is missing would undo the point.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
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
  }, [user, reloadKey]);

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
      <header className="wf-head">
        <h1>Workflow</h1>
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

          {/* ── SAVED WORKFLOWS (PIPELINES) ─────────────────────────────────── */}
          <section className="wf-pipelines" style={{ marginTop: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 style={{ fontSize: "1.1rem", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="git-merge" size={16} /> Saved Workflows & Pipelines
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
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
                      className="wf-stage"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        borderLeft: `3px solid ${
                          isHealthy
                            ? "var(--success, #10b981)"
                            : isPaused
                            ? "var(--border, #9ca3af)"
                            : isDisconnected
                            ? "var(--danger, #ef4444)"
                            : "var(--warning, #f59e0b)"
                        }`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <strong style={{ fontSize: "14px", display: "block" }}>{p.name}</strong>
                          <span style={{ fontSize: "12px", color: "var(--text-2)" }}>
                            Trigger: <b>{labelForTrigger(p.trigger_source)}</b>
                          </span>
                        </div>
                        <span className={badgeCls} style={badgeStyle}>
                          {p.health_label}
                        </span>
                      </div>

                      <div style={{ fontSize: "12px", background: "var(--surface-2, #f9fafb)", padding: "8px 10px", borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div>
                          <span style={{ color: "var(--text-3)" }}>Upstream: </span>
                          <span style={{ fontWeight: 500 }}>{p.upstream_stage}</span> — {p.upstream_summary}
                        </div>
                        <div>
                          <span style={{ color: "var(--text-3)" }}>Destination: </span>
                          <span style={{ fontWeight: 600, textTransform: "uppercase" }}>{p.action_type}</span>
                          {p.action_config?.to && ` (${p.action_config.to})`}
                          {p.action_config?.channel && ` (${p.action_config.channel})`}
                          {p.action_config?.url && ` (${p.action_config.url})`}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 6, fontSize: "11px", color: "var(--text-2)" }}>
                        <span>
                          {p.execution_count} execution{p.execution_count === 1 ? "" : "s"}
                          {p.last_execution && ` · Last: ${p.last_execution.status}`}
                        </span>
                        {p.fix ? (
                          <Link to={p.fix.href} className="wf-stage-link">
                            {p.fix.label} <Icon name="arrow-right" size={11} />
                          </Link>
                        ) : (
                          <Link to={`/rules?rule=${encodeURIComponent(p.rule_id)}`} className="wf-stage-link">
                            Configure rule <Icon name="arrow-right" size={11} />
                          </Link>
                        )}
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
    </div>
  );
}
