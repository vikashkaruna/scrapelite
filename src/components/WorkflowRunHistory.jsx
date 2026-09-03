// WorkflowRunHistory.jsx — every workflow-template run, filterable.
//
// Runs have been persisted since 0036 and `listRuns` has existed in the client
// since Phase 1 with NO CALLER. A user paid credits for each of these and
// could not reach any of them. This is that surface.
//
// `compact` renders the Account-page summary (counts + a short list); the full
// form renders the Dashboard view with filters.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import * as api from "../lib/templates/templatesClient.js";
import {
  filterRuns, summariseRuns, bucketOf, templateKeysIn, monthsIn, RUN_FILTERS,
} from "../lib/templates/runHistory.js";
import Icon from "./Icon.jsx";
import WorkflowRunModal from "./WorkflowRunModal.jsx";

const BUCKET_LABEL = {
  succeeded: "Succeeded", partial: "Partial", failed: "Failed",
  running: "Running", unknown: "Unknown",
};

const humanTemplate = (k) => String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const when = (v) => (v ? new Date(v).toLocaleString() : "—");

function StatusPill({ run }) {
  const b = bucketOf(run);
  return <span className={`wrh-pill wrh-pill-${b}`}>{BUCKET_LABEL[b]}</span>;
}

export default function WorkflowRunHistory({ compact = false, limit = null }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [bucket, setBucket] = useState("all");
  const [templateKey, setTemplateKey] = useState("all");
  const [month, setMonth] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedRun, setSelectedRun] = useState(null);

  useEffect(() => {
    let alive = true;
    api.listRuns()
      .then((r) => { if (alive) setRuns(r.runs || []); })
      // Signed-out users have no runs, which is not an error worth a banner.
      .catch((e) => { if (alive) { setRuns([]); setError(e?.status === 401 ? null : e.message); } });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const f = filterRuns(runs || [], { bucket, templateKey, month, query });
    return limit ? f.slice(0, limit) : f;
  }, [runs, bucket, templateKey, month, query, limit]);

  const summary = useMemo(() => summariseRuns(runs || []), [runs]);

  if (runs === null) return <div className="wrh-loading"><Icon name="loader" size={16} className="spin" /> Loading runs…</div>;

  if (!runs.length) {
    return (
      <div className="wrh-empty">
        <Icon name="layout-list" size={22} />
        <p>No workflow runs yet.</p>
        <Link className="btn btn-secondary btn-sm" to="/templates">Browse workflow templates</Link>
      </div>
    );
  }

  return (
    <div className={"wrh" + (compact ? " wrh-compact" : "")}>
      <div className="wrh-stats">
        <span className="wrh-stat"><b>{summary.total}</b> runs</span>
        <span className="wrh-stat"><b>{summary.succeeded}</b> succeeded</span>
        {/* Partial is shown as its OWN number, never folded into either side:
            it produced real output and stated a gap. */}
        <span className="wrh-stat"><b>{summary.partial}</b> partial</span>
        <span className="wrh-stat"><b>{summary.failed}</b> failed</span>
        <span className="wrh-stat">
          <b>{summary.creditsSpent}</b> credits
          {/* Actual only. An estimate is what we guessed before the work, and
              putting it on a billing surface with no ledger row behind it
              would be a number we cannot stand behind. */}
          <em title="Charged credits only — estimates for runs still in flight are excluded.">actual</em>
        </span>
        {summary.successRate !== null && (
          <span className="wrh-stat" title="Of finished runs — runs still in flight are excluded from the denominator.">
            <b>{Math.round(summary.successRate * 100)}%</b> success
          </span>
        )}
      </div>

      {!compact && (
        <div className="wrh-filters">
          <div className="wrh-chips" role="group" aria-label="Filter by outcome">
            {RUN_FILTERS.map((f) => (
              <button key={f.key}
                className={"wrh-chip" + (bucket === f.key ? " on" : "")}
                aria-pressed={bucket === f.key}
                onClick={() => setBucket(f.key)}>{f.label}</button>
            ))}
          </div>
          <select aria-label="Filter by template" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            <option value="all">All templates</option>
            {templateKeysIn(runs).map((k) => <option key={k} value={k}>{humanTemplate(k)}</option>)}
          </select>
          <select aria-label="Filter by month" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">All time</option>
            {monthsIn(runs).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="search" aria-label="Search runs" placeholder="Search domain or summary…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {error && <div className="wrh-error"><Icon name="alert-circle" size={14} /> {error}</div>}

      {shown.length === 0 ? (
        <p className="wrh-none">No runs match these filters.</p>
      ) : (
        <ul className="wrh-list">
          {shown.map((r) => (
            <li
              key={r.id}
              className="wrh-row wrh-row-interactive"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedRun(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedRun(r);
                }
              }}
              aria-label={`View details for ${humanTemplate(r.template_key)} run on ${r.input?.domain || r.input?.url || "target"}`}
            >
              <div className="wrh-row-main">
                <span className="wrh-template">{humanTemplate(r.template_key)}</span>
                <span className="wrh-target">{r.input?.domain || r.input?.url || "—"}</span>
                {r.output_summary && <span className="wrh-summary">{r.output_summary}</span>}
              </div>
              <div className="wrh-row-meta">
                <StatusPill run={r} />
                {/* Only a real charge is shown. A run with no actual has not
                    been charged, and showing its estimate here would read as
                    money spent. */}
                {Number.isFinite(r.credits_actual) && <span className="wrh-credits">{r.credits_actual} cr</span>}
                <span className="wrh-when">{when(r.created_at)}</span>
                <span className="wrh-open-affordance" aria-hidden="true" title="Open run">
                  <Icon name="arrow-up-right" size={13} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {compact && runs.length > shown.length && (
        <p className="wrh-more"><Link to="/dashboard?view=runs">See all {runs.length} runs →</Link></p>
      )}

      {selectedRun && (
        <WorkflowRunModal run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
}
