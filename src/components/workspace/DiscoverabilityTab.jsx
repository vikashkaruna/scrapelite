// DiscoverabilityTab.jsx — the workspace's view of its audits and monitors.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// /discoverability is a working surface: run one audit, read one report. This
// answers the portfolio questions instead — which of our pages are worst, what
// are we monitoring, and did anything move — which is what somebody opening a
// workspace is actually asking.
//
// ── IT RUNS NOTHING ────────────────────────────────────────────────────────
// Every action here is a link into /discoverability or /schedules. One
// implementation of quota, compliance refusals and the signed-in rule, in one
// place — the same reason the Home composer's Discover button hands off rather
// than auditing.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import FaviconDot from "../FaviconDot.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { scoreBand } from "../../lib/discoverability/scoringModel.js";
import { hostOf, timeAgo } from "../../lib/utils.js";

/** PostgREST returns an embedded to-one row as an object OR a 1-element array. */
function resultOf(row) {
  const r = row?.audit_results;
  return (Array.isArray(r) ? r[0] : r) || null;
}

export default function DiscoverabilityTab() {
  const [state, setState] = useState({ loading: true, audits: [], monitors: [] });

  useEffect(() => {
    let alive = true;
    Promise.all([
      discoverability.listAudits({ limit: 50 }).catch(() => ({ audits: [] })),
      discoverability.listSchedules().catch(() => ({ schedules: [] })),
    ]).then(([a, s]) => {
      if (!alive) return;
      setState({ loading: false, audits: a?.audits || [], monitors: s?.schedules || [] });
    });
    return () => { alive = false; };
  }, []);

  if (state.loading) {
    return <div className="ws-team-loading"><Icon name="loader" size={16} className="spin" /> Loading discoverability…</div>;
  }

  const { audits, monitors } = state;

  if (!audits.length && !monitors.length) {
    return (
      <div className="sch-empty card">
        <div className="sch-empty-icon"><Icon name="scan-search" size={30} /></div>
        <h3>No audits yet</h3>
        <p>
          Score any page for classic search, answer engines and generative engines —
          four pillars, a prioritised fix queue, and copy-ready schema you can paste.
        </p>
        <div className="sch-empty-actions">
          <Link to="/discoverability"><Button variant="primary" icon="scan-search">Run an audit</Button></Link>
        </div>
      </div>
    );
  }

  // Worst first. A portfolio view exists to surface what needs attention, and
  // sorting by date would bury it under whatever was audited most recently.
  const scored = audits
    .map((a) => ({ row: a, result: resultOf(a) }))
    .filter((x) => Number.isFinite(Number(x.result?.final_score)))
    .sort((a, b) => Number(a.result.final_score) - Number(b.result.final_score));

  return (
    <>
      <section className="ws-section">
        <h2 className="ws-section-title">
          <Icon name="alert-triangle" size={14} />
          Pages needing attention
        </h2>
        {scored.length === 0 ? (
          <p className="ws-empty-note">No completed audits with a score yet.</p>
        ) : (
          <div className="ws-dsc-list">
            {scored.slice(0, 8).map(({ row, result }) => {
              const band = scoreBand(Number(result.final_score));
              return (
                <Link key={row.id} to={`/discoverability?audit=${encodeURIComponent(row.id)}`} className="ws-dsc-row">
                  <FaviconDot url={row.target_url} size={22} />
                  <div className="ws-dsc-body">
                    <div className="ws-dsc-host">{hostOf(row.target_url) || row.target_url}</div>
                    <div className="ws-dsc-path" title={row.target_url}>{row.target_url}</div>
                  </div>
                  {/* Coverage travels WITH the score. A 92 built on 40% of the
                      intended evidence is not a 92, and a portfolio table is
                      exactly where that gets forgotten. */}
                  <div className="ws-dsc-meta">
                    {Number.isFinite(Number(result.coverage)) && (
                      <span className="ws-dsc-coverage">{Math.round(result.coverage)}% evidence</span>
                    )}
                    {result.critical_count > 0 && (
                      <span className="ws-dsc-critical">{result.critical_count} critical</span>
                    )}
                    <span className="ws-dsc-when">{timeAgo(row.created_at)}</span>
                  </div>
                  <span className={`ws-dsc-score dsc-tone-${band.tone}`}>{Math.round(result.final_score)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="ws-section">
        <h2 className="ws-section-title">
          <Icon name="repeat" size={14} />
          Monitors
        </h2>
        {monitors.length === 0 ? (
          <p className="ws-empty-note">
            Nothing is being monitored.{" "}
            <Link to="/schedules" state={{ openEditor: true, draftSchedule: { jobKind: "discoverability" } }}>
              Set up a monitor
            </Link>{" "}
            to be alerted when a page's scores move.
          </p>
        ) : (
          <div className="ws-dsc-list">
            {monitors.map((m) => {
              const url = m.audit_targets?.canonical_url || m.target_url || "";
              const paused = m.status === "paused" || m.system_paused;
              return (
                <div key={m.id} className="ws-dsc-row ws-dsc-row-static">
                  <FaviconDot url={url} size={22} />
                  <div className="ws-dsc-body">
                    <div className="ws-dsc-host">{m.name || hostOf(url) || url}</div>
                    <div className="ws-dsc-path">{m.cadence} · {m.audit_profile} · {m.device_profile}</div>
                  </div>
                  <div className="ws-dsc-meta">
                    <span className={paused ? "sch-status-paused" : "sch-status-active"}>
                      {m.system_paused ? "Paused by DatIQ" : paused ? "Paused" : "Active"}
                    </span>
                    {m.last_run_at && <span className="ws-dsc-when">ran {timeAgo(m.last_run_at)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
