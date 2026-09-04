// src/components/WorkflowRunModal.jsx — view full details and outputs of a workflow run.
//
// Displayed when a user clicks any workflow run row in WorkflowRunHistory.jsx
// (on Dashboard or Account). Provides instant inspection of the run's facts,
// AI summary, sources, credit reconciliation, and actions (Re-run / Share).

import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import StructuredFacts from "./StructuredFacts.jsx";
import ShareReportDialog from "./ShareReportDialog.jsx";
import { useToast } from "./Toast.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { CAPABILITY_SCHEMAS } from "../lib/extractionSchemas.js";
import { createReport } from "../lib/reports/reportsClient.js";
import ExportMenu from "./ExportMenu.jsx";
import { runToItem } from "../lib/templates/runToItems.js";

const humanTemplate = (k) => String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const when = (v) => (v ? new Date(v).toLocaleString() : "—");

function StatusPill({ status }) {
  const s = String(status || "unknown").toLowerCase();
  const cls = s === "complete" || s === "succeeded" ? "wrh-pill-succeeded"
            : s === "partial" ? "wrh-pill-partial"
            : s === "failed" ? "wrh-pill-failed"
            : s === "running" ? "wrh-pill-running"
            : "wrh-pill-unknown";
  const label = s === "complete" || s === "succeeded" ? "Succeeded"
              : s === "partial" ? "Partial"
              : s === "failed" ? "Failed"
              : s === "running" ? "Running"
              : "Unknown";
  return <span className={`wrh-pill ${cls}`}>{label}</span>;
}

export default function WorkflowRunModal({ run, onClose }) {
  const navigate = useNavigate();
  let showToast = () => {};
  try { showToast = useToast(); } catch { /* test env */ }
  let user = null;
  let openAuth = () => {};
  try {
    const auth = useAuth();
    user = auth?.user;
    openAuth = auth?.openAuth;
  } catch { /* test env */ }

  const [shareFor, setShareFor] = useState(null);
  const [sharing, setSharing] = useState(false);

  if (!run) return null;

  const output = run.output || {};
  const summary = run.output_summary || output.summary || null;
  const talkingPoints = output.talking_points || null;
  const comparison = output.comparison || null;
  const fields = output.fields || output.data || null;
  const sources = run.sources || output.sources || [];
  const target = run.input?.domain || run.input?.url || output.target || "—";
  const isFailed = String(run.status || "").toLowerCase() === "failed" || Boolean(run.error);

  function handleReRun() {
    onClose?.();
    navigate(`/templates?key=${encodeURIComponent(run.template_key)}`, {
      state: { prefill: run.input },
    });
  }

  async function handleShare() {
    if (!user) {
      openAuth("signup");
      return;
    }
    setSharing(true);
    try {
      const sourceUrl = run.input?.domain
        ? `https://${run.input.domain}`
        : run.input?.url || output.target || window.location.origin;

      const r = await createReport({
        title: `${humanTemplate(run.template_key)} — ${target}`,
        runId: run.id,
        sourceUrl,
        templateKey: run.template_key,
        data: { output, summary, sources },
      });
      setShareFor(r.report);
    } catch (e) {
      showToast(`Couldn't create the report: ${e.message}`);
    } finally {
      setSharing(false);
    }
  }

  return createPortal(
    <div
      className="error-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wrm-title"
      onKeyDown={(e) => e.key === "Escape" && onClose?.()}
      onClick={onClose}
    >
      <div className="error-modal wrm-modal card" onClick={(e) => e.stopPropagation()}>
        <header className="wrm-header">
          <div className="wrm-title-group">
            <div className="wrm-eyebrow">
              <StatusPill status={run.status} />
              <span className="wrm-id" title={`Run ID: ${run.id}`}>
                {run.id ? run.id.slice(0, 8) : "Run"}
              </span>
            </div>
            <h2 id="wrm-title" className="wrm-title">
              {humanTemplate(run.template_key)}
            </h2>
            <div className="wrm-sub">
              Target: <strong>{target}</strong> · {when(run.created_at)}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm error-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="wrm-meta-bar">
          <div className="wrm-meta-item">
            <span className="wrm-meta-label">Credits charged</span>
            <span className="wrm-meta-val">
              {Number.isFinite(run.credits_actual) ? `${run.credits_actual} cr` : "0 cr"}
              {Number.isFinite(run.credits_estimated) && run.credits_estimated !== run.credits_actual && (
                <em className="wrm-meta-est"> (est. {run.credits_estimated})</em>
              )}
            </span>
          </div>
          {run.template_version && (
            <div className="wrm-meta-item">
              <span className="wrm-meta-label">Version</span>
              <span className="wrm-meta-val">v{run.template_version}</span>
            </div>
          )}
          {run.input && Object.keys(run.input).length > 1 && (
            <div className="wrm-meta-item">
              <span className="wrm-meta-label">Inputs</span>
              <span className="wrm-meta-val">
                {Object.entries(run.input)
                  .filter(([k]) => k !== "domain" && k !== "url")
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>

        <div className="wrm-body">
          {isFailed ? (
            <div className="wrm-failed-box">
              <div className="wrm-failed-head">
                <Icon name="alert-circle" size={18} />
                <h3>Run failed</h3>
              </div>
              <p className="wrm-failed-msg">
                {run.error || "The extraction could not be completed from the supplied source."}
              </p>
              <p className="wrm-failed-note">
                No credits were billed for this failed run.
              </p>
            </div>
          ) : (
            <>
              {summary && (
                <section className="wrm-section">
                  <h3>Summary</h3>
                  <p className="tpl-ai">{summary}</p>
                  <p className="tpl-ai-note">Written by AI from the extracted facts below.</p>
                </section>
              )}

              {Array.isArray(talkingPoints) && talkingPoints.length > 0 && (
                <section className="wrm-section">
                  <h3>Talking Points</h3>
                  <ol className="tpl-points">
                    {talkingPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ol>
                  <p className="tpl-ai-note">Written by AI from the extracted facts below.</p>
                </section>
              )}

              {comparison?.rows?.length > 0 && (
                <section className="wrm-section">
                  <h3>Side by Side Comparison</h3>
                  <div className="tpl-cmp-wrap">
                    <table className="tpl-cmp">
                      <thead>
                        <tr>
                          <th>Company</th>
                          {(comparison.axes || []).map((a) => (
                            <th key={a}>{a}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.rows.map((row, i) => (
                          <tr key={i} className={row.company === output.target ? "tpl-cmp-self" : ""}>
                            <th scope="row">
                              {row.company}
                              {row.company === output.target && <span className="tpl-cmp-you">you</span>}
                            </th>
                            {(comparison.axes || []).map((a) => {
                              const v = row.values?.[a];
                              return (
                                <td key={a}>
                                  {v == null || v === "" ? (
                                    <em className="tpl-cmp-null">not stated</em>
                                  ) : (
                                    String(v)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {fields && (
                <section className="wrm-section">
                  <h3>Extracted Facts</h3>
                  <StructuredFacts
                    data={fields}
                    groups={CAPABILITY_SCHEMAS[run.template_key]?.groups}
                    meta={output.extraction}
                    title={output.title || target}
                  />
                </section>
              )}

              {sources.length > 0 && (
                <section className="wrm-section">
                  <h3>Sources</h3>
                  <ul className="tpl-sources">
                    {sources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.url}
                        </a>
                        <span className="tpl-src-meta">
                          {s.fetched_at ? ` · read ${new Date(s.fetched_at).toLocaleString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="wrm-footer">
          {/* A completed run's output is the deliverable — until now the only
              way out of this modal was a shareable link. A failed run has
              nothing to export, so the menu is omitted rather than shown
              empty. */}
          {!isFailed && (
            <ExportMenu
              items={[runToItem(run)].filter(Boolean)}
              label="Export"
              buttonVariant="secondary"
              showPush
              showEmail
            />
          )}
          <Button variant="secondary" onClick={handleReRun}>
            <Icon name="rotate-cw" size={14} /> Re-run in Templates
          </Button>
          {!isFailed && (
            <Button variant="primary" onClick={handleShare} disabled={sharing}>
              <Icon name="share-2" size={14} /> {sharing ? "Creating report…" : "Create shareable report"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </footer>

        {shareFor && (
          <ShareReportDialog
            report={shareFor}
            onClose={() => setShareFor(null)}
            onChanged={(r) => setShareFor(r)}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
