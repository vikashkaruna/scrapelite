// IssueMatrix.jsx — the severity × pillar heatmap, and the issue list under it.

import { useMemo } from "react";
import Icon from "../Icon.jsx";
import { SEVERITIES } from "../../lib/discoverability/issueCatalog.js";
import { PILLAR_IDS, pillarLabel } from "../../lib/discoverability/signalRegistry.js";
import { groupByRootCause, MODULES } from "../../lib/discoverability/gapTaxonomy.js";

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

/**
 * What is actually wrong, above the list of what is wrong.
 *
 * ── WHY THIS SITS ABOVE THE MATRIX ────────────────────────────────────────
 * The severity x pillar grid answers "what is worst" and "where did points go".
 * Neither is the question a reader arrives with, which is "what do I have to go
 * and DO" — and forty individually-true findings do not answer it either.
 *
 * Eleven findings that all reduce to `entity_ambiguity` are one afternoon's
 * work. Seeing that is the difference between a report that gets worked and one
 * that gets filed, and it is invisible in every other view on this page.
 */
export function RootCauseSummary({ issues = [], onSelectCause, activeCause }) {
  const groups = useMemo(
    () => groupByRootCause(issues, { severityRank: (i) => SEVERITIES.indexOf(i.severity) }),
    [issues],
  );
  if (groups.length === 0) return null;

  return (
    <div className="dsc-cause-summary">
      <h3 className="dsc-cause-heading">What is actually wrong</h3>
      <ul className="dsc-cause-list">
        {groups.map((g) => {
          const isActive = activeCause === g.id;
          // Severity of the WORST finding in the group — the list is already
          // sorted worst-first by groupByRootCause.
          const worst = g.issues[0]?.severity || "low";
          return (
            <li key={g.id}>
              <button
                type="button"
                className={`dsc-cause${isActive ? " dsc-cause-on" : ""}`}
                onClick={() => onSelectCause?.(isActive ? null : g.id)}
                aria-pressed={isActive}
              >
                <span className={`dsc-cause-dot dsc-heat-${worst}`} aria-hidden="true" />
                <span className="dsc-cause-label">{g.label}</span>
                <span className="dsc-cause-count">{g.count}</span>
              </button>
              <p className="dsc-cause-desc">{g.description}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The issues themselves, grouped by severity, with their evidence. */
export function IssueList({ issues = [], filter = null, framework = null, cause = null }) {
  const shown = useMemo(() => {
    let out = issues;
    if (filter) out = out.filter((i) => i.severity === filter.severity && i.pillar === filter.pillar);
    if (cause) out = out.filter((i) => i.rootCause === cause);
    if (framework && framework !== "overall") {
      out = out.filter((i) => (i.frameworks || []).includes(framework) || (i.frameworks || []).includes("common"));
    }
    return out;
  }, [issues, filter, framework, cause]);

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
              {/* ── TWO CLAIMS, TWO LABELS ──────────────────────────────
                  These have different warranties and one paragraph launders
                  the weaker into the stronger. "The page has two H1 elements"
                  is something we measured and will defend; "this dilutes the
                  topical signal" is reasoning a fair expert could argue with.
                  A reader who disagrees needs to see which is which. */}
              {(i.observed || i.evidence) && (
                <p className="dsc-issue-evidence">
                  <span className="dsc-claim-tag dsc-claim-observed">Observed</span>
                  {i.observed || i.evidence}
                </p>
              )}
              {i.inference && (
                <p className="dsc-issue-inference">
                  <span className="dsc-claim-tag dsc-claim-inferred">Why it matters</span>
                  {i.inference}
                </p>
              )}
              <p className="dsc-issue-meta">
                {pillarLabel(i.pillar)}
                {(i.frameworks || []).length > 0 && (
                  <> · affects {i.frameworks.map((f) => f.toUpperCase()).join(", ")}</>
                )}
                {i.owner && <> · {i.owner}</>}
                {/* The referral, and honestly labelled when it is not built
                    yet. Showing "Entity Graph Builder" as though a customer
                    could click through to it would be selling a P2 module
                    inside a P1 report. */}
                {MODULES[i.module] && (
                  <> · {MODULES[i.module].label}
                    {!MODULES[i.module].available && <span className="dsc-soon"> (coming)</span>}
                  </>
                )}
              </p>
            </div>
          </li>
        ));
      })}
    </ul>
  );
}
