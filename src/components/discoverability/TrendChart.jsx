// TrendChart.jsx — score history for one target, as inline SVG.
//
// ── GAPS ARE DRAWN AS GAPS ─────────────────────────────────────────────────
// A point with no measurement breaks the line rather than being interpolated
// across. Joining two measured points through an unmeasured one draws a
// continuity that was never observed, and on a validation chart — whose entire
// job is to show whether a change worked — that is the one lie that matters.

import { useMemo } from "react";
import Icon from "../Icon.jsx";

const SERIES = [
  { key: "overall", label: "Overall", cls: "dsc-line-overall" },
  { key: "seo", label: "SEO", cls: "dsc-line-seo" },
  { key: "aeo", label: "AEO", cls: "dsc-line-aeo" },
  { key: "geo", label: "GEO", cls: "dsc-line-geo" },
];

const W = 640;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

export default function TrendChart({ trend, active = ["overall"], onToggleSeries }) {
  const points = trend?.points || [];

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

    const paths = {};
    for (const s of SERIES) {
      // Split into contiguous runs of measured points. Each run is its own
      // path, so an unmeasured point leaves a visible break.
      const runs = [];
      let run = [];
      points.forEach((p, i) => {
        const v = p[s.key];
        if (v === null || v === undefined) {
          if (run.length) runs.push(run);
          run = [];
        } else {
          run.push([x(i), y(v)]);
        }
      });
      if (run.length) runs.push(run);
      paths[s.key] = runs.map((r) =>
        r.length === 1
          ? `M ${r[0][0]} ${r[0][1]} l 0.01 0`   // a lone point still renders
          : `M ${r.map(([px, py]) => `${px} ${py}`).join(" L ")}`,
      );
    }
    return { x, y, paths, innerH };
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="dsc-empty">
        <Icon name="trending-up" size={20} />
        <p>Run this page again to start a trend. One audit is a reading; two are a direction.</p>
      </div>
    );
  }

  const gridLines = [0, 25, 50, 75, 100];

  return (
    <div className="dsc-trend">
      <div className="dsc-trend-legend">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`dsc-legend-item ${s.cls}${active.includes(s.key) ? " dsc-legend-on" : ""}`}
            onClick={() => onToggleSeries?.(s.key)}
            aria-pressed={active.includes(s.key)}
          >
            <span className="dsc-legend-swatch" aria-hidden="true" />
            {s.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="dsc-trend-svg"
        role="img"
        aria-label={`Score trend across ${points.length} audits`}
      >
        {gridLines.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={geometry.y(g)} y2={geometry.y(g)}
              className="dsc-grid-line"
            />
            <text x={PAD.left - 6} y={geometry.y(g) + 4} className="dsc-axis-label" textAnchor="end">{g}</text>
          </g>
        ))}

        {SERIES.filter((s) => active.includes(s.key)).map((s) =>
          geometry.paths[s.key].map((d, idx) => (
            <path key={`${s.key}-${idx}`} d={d} className={`dsc-trend-line ${s.cls}`} fill="none" />
          )),
        )}

        {points.map((p, i) => (
          <g key={p.auditId || i}>
            {SERIES.filter((s) => active.includes(s.key) && p[s.key] !== null && p[s.key] !== undefined).map((s) => (
              <circle
                key={s.key}
                cx={geometry.x(i)} cy={geometry.y(p[s.key])} r={3}
                className={`dsc-trend-dot ${s.cls}`}
              >
                <title>{`${s.label} ${p[s.key]} · ${new Date(p.at).toLocaleDateString()}${
                  p.coverage != null && p.coverage < 100 ? ` · ${p.coverage}% coverage` : ""}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>

      <p className="dsc-trend-foot">
        {points.length} audits
        {trend.change?.comparable && (
          <> · {trend.change.change > 0 ? "+" : ""}{trend.change.change} overall since the first measured run</>
        )}
      </p>
    </div>
  );
}
