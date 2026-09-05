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
import { SEVERITY, STAGES } from "../lib/workflows/workflowGraph.js";
import { getWorkflowGraph } from "../lib/workflows/workflowClient.js";

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

export default function Workflows() {
  const { user } = useAuth();
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // No SEO call here, matching /rules and /watchlists: /workflows is a PRIVATE
  // prefix, and the noindex is enforced in the four places the page-ownership
  // invariant checks (site-routes.mjs, netlify.toml's X-Robots-Tag, robots.txt,
  // and index.html's inline guard) rather than from inside the component.

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const g = await getWorkflowGraph();
        if (!cancelled) setGraph(g);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
          {/* ── WHAT IS BROKEN ────────────────────────────────────────────── */}
          <section className="wf-issues">
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
                      {i.fix && (
                        <Link to={i.fix.href} className="wf-issue-fix">
                          {i.fix.label} <Icon name="arrow-right" size={13} />
                        </Link>
                      )}
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

          <p className="wf-foot">
            Rules listen for a <em>kind</em> of event, not a specific list or watchlist — so a rule
            watching for competitor changes fires for all of them.
          </p>
        </>
      )}
    </div>
  );
}
