// DiscoverabilityStats.jsx — the discoverability half of Plan & usage.
//
// ── WHY IT IS ITS OWN CARD ─────────────────────────────────────────────────
// Audits have their OWN monthly budget (free 3 · go 10 · select 25 · pro 100 ·
// business 500 · agency 2,000 · developer 250) rather than debiting extraction
// credits — one audit is two fetches, a robots check, a PageSpeed lookup, a
// citation sample and an AI call. So folding audits into the extraction counter
// would misreport both. Separate budget, separate card.
//
// Everything here is READ from what the server already stores. Nothing is
// recomputed client-side: the audit count that matters is the one the quota
// gate reads, which is the `audits` table itself.

import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { discoverability } from "../lib/discoverability/discoverabilityClient.js";
import { scoreBand } from "../lib/discoverability/scoringModel.js";

/** Rounded to one place, or null — never 0 for "we don't know". */
function meanScore(audits) {
  const scored = audits
    .map((a) => Number(a.audit_results?.final_score ?? a.audit_results?.[0]?.final_score))
    .filter((n) => Number.isFinite(n));
  if (!scored.length) return null;
  return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10;
}

export default function DiscoverabilityStats({ auditLimit }) {
  const [state, setState] = useState({ loading: true, audits: [], monitors: [] });

  useEffect(() => {
    let alive = true;
    Promise.all([
      discoverability.listAudits({ limit: 100 }).catch(() => ({ audits: [] })),
      discoverability.listSchedules().catch(() => ({ schedules: [] })),
    ]).then(([a, s]) => {
      if (!alive) return;
      setState({ loading: false, audits: a?.audits || [], monitors: s?.schedules || [] });
    });
    return () => { alive = false; };
  }, []);

  if (state.loading) {
    return (
      <div className="card card-pad account-stats">
        <div className="card-section-title"><Icon name="scan-search" size={15} />Discoverability</div>
        <p className="astat-note"><Icon name="loader" size={13} className="spin" /> Loading…</p>
      </div>
    );
  }

  const thisMonth = new Date().toISOString().slice(0, 7);
  // Matches the server's own rule: a FAILED audit is not charged, so it must
  // not be counted here either or the two numbers disagree and the user is
  // told they have less quota than the gate will actually give them.
  const used = state.audits.filter(
    (a) => a.status !== "failed" && String(a.created_at || "").startsWith(thisMonth),
  ).length;
  const activeMonitors = state.monitors.filter((m) => m.status === "active" && !m.system_paused).length;
  const avg = meanScore(state.audits);
  const band = avg === null ? null : scoreBand(avg);

  return (
    <div className="card card-pad account-stats">
      <div className="card-section-title"><Icon name="scan-search" size={15} />Discoverability</div>

      <div className="astat-row">
        <span className="astat-label">Audits this month</span>
        <span className="astat-val">{used.toLocaleString()}</span>
      </div>
      <div className="astat-row">
        <span className="astat-label">Remaining this month</span>
        <span className="astat-val">
          {auditLimit === Infinity ? "∞"
            : auditLimit > 0 ? Math.max(0, auditLimit - used).toLocaleString()
            : <a href="/pricing" style={{ color: "var(--accent)", fontSize: "0.85em" }}>Upgrade to unlock</a>}
        </span>
      </div>
      <div className="astat-row">
        <span className="astat-label">Pages audited</span>
        <span className="astat-val">
          {new Set(state.audits.map((a) => a.target_url).filter(Boolean)).size.toLocaleString()}
        </span>
      </div>
      <div className="astat-row">
        <span className="astat-label">Active monitors</span>
        <span className="astat-val">{activeMonitors.toLocaleString()}</span>
      </div>
      <div className="astat-row">
        <span className="astat-label">Average score</span>
        {/* `unknown` is never 0. With nothing measured this says so rather than
            printing a zero somebody would read as a very bad score. */}
        <span className={"astat-val" + (band ? ` dsc-tone-${band.tone}` : "")}>
          {avg === null ? "not measured yet" : avg}
        </span>
      </div>
    </div>
  );
}
