// ExtractionCharts.jsx — three auto-generated visualisations rendered on the
// Preview screen right after the AI summary (QW#3). Hand-rolled SVG, no chart
// library — keeps the bundle small and matches the design-system tokens.
//
//   1. Stats cards   — 4 big numbers: links, headings, words, reading time
//   2. Heading depth — vertical bar chart of H1..H6 counts
//   3. Link category — horizontal bar chart of category counts
//
// Data sources are stable across the app: `extraction.headings` (array of
// {tag, text}), `extraction.links` (array of {text, href, category?}),
// `extraction.ai_summary` (string). Word count is a fair proxy using
// headings + link text + ai_summary + page_title (no full body available).
import { useMemo } from "react";
import Icon from "./Icon.jsx";
import { categoryCounts, CATEGORY_META, categoryOf } from "../lib/linkCategorizer.js";

const HEADING_LEVELS = ["H1", "H2", "H3", "H4", "H5", "H6"];

// Standard reading speed used by Medium / Pocket / many blog platforms.
const WPM = 200;

// Quick, dependency-free word count for the strings we have at hand.
function countWords(str) {
  if (!str) return 0;
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

// Aggregated metrics from the extraction. Pure so it's easy to unit-test.
export function buildChartData(extraction) {
  const headings = extraction?.headings || [];
  const links = extraction?.links || [];

  // Heading depth counts: { H1: 3, H2: 7, H3: 2, ... }
  const depthCounts = HEADING_LEVELS.map((tag) => ({
    tag,
    count: headings.filter((h) => h.tag === tag).length,
  }));

  // Link category counts using the same linkCategorizer the rest of the app uses.
  // Fall back to a derived category when an item doesn't have one set.
  const cats = categoryCounts(links, extraction?.url);

  // Word count proxy. The extraction doesn't carry the page body, so we sum
  // over the fields we DO have — still a useful signal for "how meaty is this".
  const words =
    countWords(extraction?.ai_summary) +
    countWords(extraction?.page_title) +
    headings.reduce((s, h) => s + countWords(h.text), 0) +
    links.reduce((s, l) => s + countWords(l.text), 0);

  const readingMinutes = Math.max(1, Math.ceil(words / WPM));

  return {
    stats: {
      links: links.length,
      headings: headings.length,
      words,
      readingMinutes,
    },
    depthCounts,
    categories: cats, // [{ key, count, label, icon }, ...]
  };
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ icon, value, label, hint }) {
  return (
    <div className="stat-card" title={hint || label}>
      <span className="stat-card-ico">
        <Icon name={icon} size={14} />
      </span>
      <span className="stat-card-num">{value}</span>
      <span className="stat-card-label">{label}</span>
    </div>
  );
}

function StatsGrid({ stats }) {
  return (
    <div className="chart-stats-grid" role="group" aria-label="Extraction summary stats">
      <StatCard icon="link"     value={stats.links}           label="links"      hint="Total links discovered on the page" />
      <StatCard icon="list-tree" value={stats.headings}       label="headings"   hint="H1–H6 headings" />
      <StatCard icon="type"     value={stats.words.toLocaleString()} label="words" hint="Approx. word count from headings + summary + link text" />
      <StatCard icon="clock-3"  value={stats.readingMinutes + "m"} label="read" hint={`At ${WPM} words per minute`} />
    </div>
  );
}

// Vertical bar chart, hand-rolled SVG. Empty state when no data.
function HeadingDepthChart({ depthCounts }) {
  const total = depthCounts.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="chart-empty">No headings found on this page.</div>;
  }
  const W = 360, H = 140, PAD_L = 30, PAD_B = 24, PAD_T = 8;
  const innerW = W - PAD_L;
  const innerH = H - PAD_B - PAD_T;
  const maxCount = Math.max(1, ...depthCounts.map((d) => d.count));
  const barW = innerW / depthCounts.length;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Heading depth distribution: ${depthCounts.map((d) => `${d.tag} ${d.count}`).join(", ")}`}
    >
      {/* Y axis baseline */}
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - 4} y2={PAD_T + innerH} stroke="var(--border)" strokeWidth="1" />
      {/* Bars */}
      {depthCounts.map((d, i) => {
        const h = (d.count / maxCount) * innerH;
        const x = PAD_L + i * barW + barW * 0.15;
        const y = PAD_T + innerH - h;
        const w = barW * 0.7;
        return (
          <g key={d.tag}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h || 2 /* keep a sliver when count is 0 */}
              rx="3"
              fill={d.count > 0 ? "var(--accent)" : "var(--border)"}
              opacity={d.count > 0 ? 0.9 : 0.5}
            />
            <text
              x={x + w / 2}
              y={PAD_T + innerH + 14}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="var(--text-3)"
            >
              {d.tag}
            </text>
            {d.count > 0 && (
              <text
                x={x + w / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="var(--text-2)"
              >
                {d.count}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Horizontal bar chart for link categories. Uses the existing CATEGORY_META
// for labels and icons. Empty state when no links.
function LinkCategoryChart({ categories, baseUrl, links }) {
  if (!categories || categories.length === 0) {
    // Fall back: derive categories on the fly when the extractor didn't tag them.
    if (!links || !links.length) return <div className="chart-empty">No links found on this page.</div>;
    const derived = categoryCounts(links, baseUrl);
    if (derived.length === 0) return <div className="chart-empty">No links found on this page.</div>;
    return <LinkCategoryChart categories={derived} baseUrl={baseUrl} links={null} />;
  }
  const W = 360, ROW_H = 26, PAD_L = 90, PAD_R = 36, PAD_T = 4;
  const H = PAD_T + categories.length * ROW_H + 4;
  const maxCount = Math.max(1, ...categories.map((c) => c.count));
  const barAreaW = W - PAD_L - PAD_R;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Link category distribution: ${categories.map((c) => `${c.label} ${c.count}`).join(", ")}`}
    >
      {categories.map((c, i) => {
        const w = (c.count / maxCount) * barAreaW;
        const y = PAD_T + i * ROW_H;
        return (
          <g key={c.key}>
            <text
              x={PAD_L - 8}
              y={y + ROW_H / 2 + 4}
              textAnchor="end"
              fontSize="11"
              fontWeight="600"
              fill="var(--text-2)"
            >
              {c.label}
            </text>
            <rect
              x={PAD_L}
              y={y + 4}
              width={Math.max(w, 2)}
              height={ROW_H - 10}
              rx="3"
              fill="var(--accent)"
              opacity={0.9}
            />
            <text
              x={PAD_L + w + 6}
              y={y + ROW_H / 2 + 4}
              fontSize="11"
              fontWeight="700"
              fill="var(--text-2)"
            >
              {c.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Container card ────────────────────────────────────────────────────────

export default function ExtractionCharts({ extraction }) {
  const data = useMemo(() => buildChartData(extraction), [extraction]);
  const isMap = Array.isArray(extraction?.domain_map);
  if (isMap) return null; // map extractions don't have headings/links to chart

  return (
    <div className="card rise extraction-charts" style={{ animationDelay: ".06s" }}>
      <div className="card-head">
        <span className="ch-icon">
          <Icon name="bar-chart" size={18} />
        </span>
        <div>
          <h3>At a glance</h3>
          <p className="ch-sub">Auto-generated visual breakdown of the page structure</p>
        </div>
        <span className="ai-badge ch-meta">
          <Icon name="sparkles" size={12} /> Auto
        </span>
      </div>
      <div className="card-pad">
        <StatsGrid stats={data.stats} />
        <div className="chart-row">
          <div className="chart-block">
            <div className="chart-block-head">
              <Icon name="list-tree" size={13} />
              <span>Heading depth</span>
            </div>
            <HeadingDepthChart depthCounts={data.depthCounts} />
          </div>
          <div className="chart-block">
            <div className="chart-block-head">
              <Icon name="link" size={13} />
              <span>Link categories</span>
            </div>
            <LinkCategoryChart
              categories={data.categories}
              baseUrl={extraction?.url}
              links={extraction?.links}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
