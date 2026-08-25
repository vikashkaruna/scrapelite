// IssueMatrix.jsx — the severity × pillar heatmap, and the issue list under it.

import { useMemo } from "react";
import Icon from "../Icon.jsx";
import { SEVERITIES } from "../../lib/discoverability/issueCatalog.js";
import { PILLAR_IDS, pillarLabel } from "../../lib/discoverability/signalRegistry.js";

const SEV_META = {
  critical: { label: "Critical", icon: "alert-octagon" },
  high:     { label: "High",     icon: "alert-triangle" },
  medium:   { label: "Medium",   icon: "alert-circle" },
  low:      { label: "Low",      icon: "help-circle" },
};

export default function IssueMatrix({ issues = [], onSelectCell, activeCell }) {
  const grid = useMemo(() => {
    const g = {};
    for (const sev of SEVERITIES) {
      g[sev] = Object.fromEntries(PILLAR_IDS.map((p) => [p, 0]));
    }
    for (const i of issues) {
      if (g[i.severity]?.[i.pillar] !== undefined) g[i.severity][i.pillar] += 1;
    }
    return g;
  }, [issues]);

  const totals = useMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s, issues.filter((i) => i.severity === s).length])),
    [issues],
  );

  if (issues.length === 0) {
    return (
      <div className="dsc-empty dsc-empty-good">
        <Icon name="check-circle" size={22} />
        <p>No issues found. Every signal this audit could measure came back clean.</p>
      </div>
    );
  }

  return (
    <div className="dsc-matrix-wrap">
      <table className="dsc-matrix">
        <caption className="sr-only">Issues by severity and pillar</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            {PILLAR_IDS.map((p) => (
              <th key={p} scope="col" className="dsc-matrix-col">{pillarLabel(p)}</th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {SEVERITIES.map((sev) => (
            <tr key={sev}>
              <th scope="row" className={`dsc-sev dsc-sev-${sev}`}>
                <Icon name={SEV_META[sev].icon} size={14} /> {SEV_META[sev].label}
              </th>
              {PILLAR_IDS.map((p) => {
                const n = grid[sev][p];
                const isActive = activeCell?.severity === sev && activeCell?.pillar === p;
                return (
                  <td key={p} className="dsc-matrix-cell">
                    {n > 0 ? (
                      <button
                        type="button"
                        className={`dsc-matrix-count dsc-heat-${sev}${isActive ? " dsc-matrix-count-active" : ""}`}
                        onClick={() => onSelectCell?.(isActive ? null : { severity: sev, pillar: p })}
                        aria-pressed={isActive}
                        aria-label={`${n} ${SEV_META[sev].label} ${pillarLabel(p)} issue${n === 1 ? "" : "s"}`}
                      >
                        {n}
                      </button>
                    ) : (
                      // A dash, not a 0. Zero invites the eye; nothing here
                      // deserves attention, so nothing draws it.
                      <span className="dsc-matrix-zero" aria-label="none">–</span>
                    )}
                  </td>
                );
              })}
              <td className="dsc-matrix-total">{totals[sev]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The issues themselves, grouped by severity, with their evidence. */
export function IssueList({ issues = [], filter = null, framework = null }) {
  const shown = useMemo(() => {
    let out = issues;
    if (filter) out = out.filter((i) => i.severity === filter.severity && i.pillar === filter.pillar);
    if (framework && framework !== "overall") {
      out = out.filter((i) => (i.frameworks || []).includes(framework) || (i.frameworks || []).includes("common"));
    }
    return out;
  }, [issues, filter, framework]);

  if (shown.length === 0) {
    return <p className="dsc-muted">No issues match this filter.</p>;
  }

  return (
    <ul className="dsc-issue-list">
      {SEVERITIES.flatMap((sev) => {
        const group = shown.filter((i) => i.severity === sev);
        if (group.length === 0) return [];
        return group.map((i) => (
          <li key={i.code} className="dsc-issue">
            <span className={`dsc-sev-chip dsc-sev-${i.severity}`}>
              <Icon name={SEV_META[i.severity].icon} size={12} />
              {SEV_META[i.severity].label}
            </span>
            <div className="dsc-issue-body">
              <p className="dsc-issue-title">
                <code className="dsc-issue-code">{i.code}</code> {i.title}
              </p>
              {i.evidence && <p className="dsc-issue-evidence">{i.evidence}</p>}
              <p className="dsc-issue-meta">
                {pillarLabel(i.pillar)}
                {(i.frameworks || []).length > 0 && (
                  <> · affects {i.frameworks.map((f) => f.toUpperCase()).join(", ")}</>
                )}
              </p>
            </div>
          </li>
        ));
      })}
    </ul>
  );
}
