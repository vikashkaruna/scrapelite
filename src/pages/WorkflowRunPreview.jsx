// src/pages/WorkflowRunPreview.jsx — dedicated full-page preview for any workflow template run.
//
// Features a sticky top action bar that stays fixed during downward scrolling,
// providing immediate access to Back, Re-run, Export, and Share actions.

import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import StructuredFacts from "../components/StructuredFacts.jsx";
import ShareReportDialog from "../components/ShareReportDialog.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import * as api from "../lib/templates/templatesClient.js";
import { CAPABILITY_SCHEMAS } from "../lib/extractionSchemas.js";
import { createReport } from "../lib/reports/reportsClient.js";
import { runToItem } from "../lib/templates/runToItems.js";
import { useSeo } from "../hooks/useSeo.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";

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

export default function WorkflowRunPreview() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  let showToast = () => {};
  try { showToast = useToast(); } catch { /* test env */ }
  let user = null;
  let openAuth = () => {};
  try {
    const auth = useAuth();
    user = auth?.user;
    openAuth = auth?.openAuth;
  } catch { /* test env */ }

  const cachedRun = location.state?.run || readPageCache(`templateRun_${runId}`)?.data || null;
  const [run, setRun] = useState(cachedRun);
  const [loading, setLoading] = useState(!cachedRun);
  const [error, setError] = useState(null);
  const [shareFor, setShareFor] = useState(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    if (!run) setLoading(true);
    api.getRun(runId)
      .then((res) => {
        if (alive && res?.run) {
          setRun(res.run);
          writePageCache(`templateRun_${runId}`, res.run);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive && !run) {
          setError(err?.message || "Failed to load workflow run.");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [runId]);

  const target = run?.input?.domain || run?.input?.url || run?.output?.target || "Target";
  const title = run ? `${humanTemplate(run.template_key)} — ${target}` : "Workflow Run Preview";

  useSeo({
    title: `${title} | DatIQ`,
    description: `Workflow run output and intelligence report for ${target}.`,
  });

  if (loading) {
    return (
      <div className="page fade">
        <div className="container" style={{ paddingTop: 48, textAlign: "center" }}>
          <div className="wrh-loading">
            <Icon name="loader" size={20} className="spin" />
            <span>Loading workflow run details…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="page fade">
        <div className="container" style={{ paddingTop: 48 }}>
          <div className="card card-pad" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <Icon name="alert-circle" size={32} style={{ color: "var(--danger)", margin: "0 auto 12px" }} />
            <h2>Workflow Run Not Found</h2>
            <p style={{ color: "var(--text-2)", margin: "8px 0 20px" }}>
              {error || "We could not find the requested workflow run or you don't have permission to view it."}
            </p>
            <Button variant="primary" onClick={() => navigate("/dashboard?view=runs")}>
              <Icon name="arrow-left" size={14} /> Back to Workflow Runs
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const output = run.output || {};
  const summary = run.output_summary || output.summary || null;
  const talkingPoints = output.talking_points || null;
  const comparison = output.comparison || null;
  const fields = output.fields || output.data || output.facts || output.structured_data || null;
  const sources = run.sources || output.sources || [];
  const isFailed = String(run.status || "").toLowerCase() === "failed" || Boolean(run.error);

  function handleReRun() {
    navigate(`/templates?key=${encodeURIComponent(run.template_key)}`, {
      state: { prefill: run.input },
    });
  }

  async function handleShare() {
    if (!user) {
      openAuth?.("signup");
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
      showToast(`Couldn't create shareable report: ${e.message}`, "alert-circle");
    } finally {
      setSharing(false);
    }
  }

  const exportItem = runToItem(run);

  return (
    <div className="page fade wrp-page">
      {/* ── Fixed/Sticky Top Action Bar ──────────────────────────── */}
      <header className="wrp-sticky-bar">
        <div className="container wrp-bar-inner">
          <div className="wrp-bar-left">
            <button
              type="button"
              className="btn btn-ghost btn-sm wrp-back-btn"
              onClick={() => navigate("/dashboard?view=runs")}
            >
              <Icon name="arrow-left" size={15} />
              <span>Workflow Runs</span>
            </button>
            <div className="wrp-bar-divider" aria-hidden="true" />
            <div className="wrp-bar-identity">
              <h1 className="wrp-bar-title">{humanTemplate(run.template_key)}</h1>
              <span className="wrp-bar-target" title={target}>{target}</span>
            </div>
            <StatusPill status={run.status} />
            {Number.isFinite(run.credits_actual) && (
              <span className="wrp-bar-credits" title="Charged credits">
                {run.credits_actual} cr
              </span>
            )}
          </div>

          <div className="wrp-bar-right">
            {!isFailed && exportItem && (
              <ExportMenu
                items={[exportItem]}
                label="Export"
                buttonVariant="secondary"
                showPush
                showEmail
              />
            )}
            <Button variant="secondary" size="sm" onClick={handleReRun}>
              <Icon name="rotate-cw" size={14} />
              <span>Re-run in Templates</span>
            </Button>
            {!isFailed && (
              <Button variant="primary" size="sm" onClick={handleShare} disabled={sharing}>
                <Icon name="share-2" size={14} />
                <span>{sharing ? "Creating…" : "Share report"}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Report Content ────────────────────────────────────────── */}
      <main className="container wrp-container">
        {/* Meta Bar */}
        <div className="wrm-meta-bar" style={{ marginTop: 24, borderRadius: "var(--r-md)" }}>
          <div className="wrm-meta-item">
            <span className="wrm-meta-label">Created</span>
            <span className="wrm-meta-val">{when(run.created_at)}</span>
          </div>
          <div className="wrm-meta-item">
            <span className="wrm-meta-label">Credits charged</span>
            <span className="wrm-meta-val">
              {Number.isFinite(run.credits_actual) ? `${run.credits_actual} cr` : Number.isFinite(run.credits_charged) ? `${run.credits_charged} cr` : "0 cr"}
              {Number.isFinite(run.credits_estimated) && run.credits_estimated !== (run.credits_actual ?? run.credits_charged) && (
                <em className="wrm-meta-est"> (est. {run.credits_estimated})</em>
              )}
            </span>
          </div>
          {run.template_version && (
            <div className="wrm-meta-item">
              <span className="wrm-meta-label">Template Version</span>
              <span className="wrm-meta-val">v{run.template_version}</span>
            </div>
          )}
          {run.input && Object.keys(run.input).length > 1 && (
            <div className="wrm-meta-item">
              <span className="wrm-meta-label">Parameters</span>
              <span className="wrm-meta-val">
                {Object.entries(run.input)
                  .filter(([k]) => k !== "domain" && k !== "url")
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>

        {/* Report Body */}
        <div className="wrp-body card card-pad" style={{ marginTop: 20 }}>
          {isFailed ? (
            <div className="wrm-failed-box">
              <div className="wrm-failed-head">
                <Icon name="alert-circle" size={20} />
                <h3>Run execution failed</h3>
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
                  <h3>Executive Summary</h3>
                  <p className="tpl-ai" style={{ fontSize: "15px", lineHeight: "1.6" }}>{summary}</p>
                  <p className="tpl-ai-note">Synthesized by AI from verified on-page data.</p>
                </section>
              )}

              {Array.isArray(talkingPoints) && talkingPoints.length > 0 && (
                <section className="wrm-section">
                  <h3>Key Talking Points & Insights</h3>
                  <ol className="tpl-points">
                    {talkingPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ol>
                  <p className="tpl-ai-note">Actionable conversation starters and strategic takeaways.</p>
                </section>
              )}

              {comparison?.rows?.length > 0 && (
                <section className="wrm-section">
                  <h3>Side-by-Side Comparison</h3>
                  <div className="tpl-cmp-wrap">
                    <table className="tpl-cmp">
                      <thead>
                        <tr>
                          <th>Entity / Company</th>
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
                              {row.company === output.target && <span className="tpl-cmp-you">target</span>}
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
                  <h3>Structured Extracted Facts</h3>
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
                  <h3>Source Evidence & References</h3>
                  <ul className="tpl-sources">
                    {sources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.url}
                        </a>
                        <span className="tpl-src-meta">
                          {s.fetched_at ? ` · inspected ${new Date(s.fetched_at).toLocaleString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {shareFor && (
        <ShareReportDialog
          report={shareFor}
          onClose={() => setShareFor(null)}
          onChanged={(r) => setShareFor(r)}
        />
      )}
    </div>
  );
}
