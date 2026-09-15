// ClosedLoopRibbon.jsx — Closed-Loop Operating Flow for Discoverability Intelligence.
//
// Numbering is HIERARCHICAL on purpose. Running an audit performs Discover,
// Score, Diagnose and Recommend in one pass, so those four are sub-steps of
// stage 1 (1.1–1.4) rather than four separate things the user must do. The
// remaining stages are distinct acts: 2 Implement → 3 Validate → 4 Benchmark
// → 5 Expand.

import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import Icon from "../Icon.jsx";

export const CLOSED_LOOP_STEPS = Object.freeze([
  { id: "discover", number: "1.1", group: "audit", label: "Discover", icon: "scan-search", path: "/discoverability" },
  { id: "score", number: "1.2", group: "audit", label: "Score", icon: "bar-chart-2", path: "/discoverability" },
  { id: "diagnose", number: "1.3", group: "audit", label: "Diagnose", icon: "alert-triangle", path: "/discoverability" },
  { id: "recommend", number: "1.4", group: "audit", label: "Recommend", icon: "list-checks", path: "/discoverability" },
  { id: "implement", number: "2", group: "implement", label: "Implement", icon: "database", path: "/discoverability/truth" },
  { id: "validate", number: "3", group: "validate", label: "Validate", icon: "zap", path: "/discoverability/sxo" },
  { id: "benchmark", number: "4", group: "benchmark", label: "Benchmark", icon: "award", path: "/discoverability/scores" },
  { id: "expand", number: "5", group: "expand", label: "Expand", icon: "share-2", path: "/discoverability/entities" },
]);

/** Display number for a step id ("1.2", "3", …), or null for an unknown id. */
export function stepNumber(id) {
  return CLOSED_LOOP_STEPS.find((s) => s.id === id)?.number || null;
}

const STEP_GUIDES = {
  discover: {
    title: "Audit · Crawl & Discover",
    hint: "Enter your target URL to run a fresh multi-engine discoverability scan. One audit covers steps 1.1–1.4.",
  },
  score: {
    title: "Audit · Visibility Scores",
    hint: "Review your balanced SEO, AEO, and GEO baseline scores across the four pillars.",
  },
  diagnose: {
    title: "Audit · Root Cause Diagnosis",
    hint: "Inspect critical crawl, indexability, rendering, and technical performance issues.",
  },
  recommend: {
    title: "Audit · Actionable Recommendations",
    hint: "Prioritize copy-ready fixes ranked by impact for classic search, answer engines, and LLMs.",
  },
  implement: {
    title: "Implement Truth & Schema",
    hint: "Establish canonical facts in Business Truth, self-approve records, and verify schema trust.",
  },
  validate: {
    title: "Validate SXO Outcomes",
    hint: "Re-evaluate SXO journey friction, conversion funnels, and calculate master composite.",
  },
  benchmark: {
    title: "Competitive Benchmark",
    hint: "Compare visibility velocity against competitors and track trend history.",
  },
  expand: {
    title: "Expand Graph & Local",
    hint: "Scale knowledge graph relationships, entity connections, and local directories.",
  },
};

export default function ClosedLoopRibbon({ auditId = null, currentStep = "discover", onStepClick = null }) {
  const location = useLocation();

  const activeStep = useMemo(() => {
    if (currentStep) return currentStep;
    const path = location.pathname;
    if (path.includes("/truth") || path.includes("/trust")) return "implement";
    if (path.includes("/sxo")) return "validate";
    if (path.includes("/scores")) return "benchmark";
    if (path.includes("/entities") || path.includes("/local")) return "expand";
    return "discover";
  }, [currentStep, location.pathname]);

  const guide = STEP_GUIDES[activeStep] || STEP_GUIDES.discover;
  const activeIndex = Math.max(0, CLOSED_LOOP_STEPS.findIndex((s) => s.id === activeStep));
  const activeNumber = CLOSED_LOOP_STEPS[activeIndex].number;

  return (
    <div className="dsc-closed-loop-wrapper" style={{ marginBottom: "18px" }}>
      <div
        className="closed-loop-ribbon"
        role="navigation"
        aria-label="Closed-loop operating process"
      >
        {CLOSED_LOOP_STEPS.map((s, idx) => {
          const isActive = s.id === activeStep;
          const isPast = idx < activeIndex;
          // The arrow between two audit sub-steps is lighter: they happen in
          // one run, not as a hand-off to a separate stage.
          const next = CLOSED_LOOP_STEPS[idx + 1];
          const withinAudit = next && s.group === "audit" && next.group === "audit";
          const targetUrl = `${s.path}${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`;

          return (
            <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <Link
                to={targetUrl}
                onClick={(e) => {
                  if (onStepClick) {
                    onStepClick(s.id, e);
                  }
                }}
                className={`closed-loop-step${isActive ? " is-active" : ""}${isPast ? " is-complete" : ""}`}
                title={`Step ${s.number}: ${s.label}`}
                aria-current={isActive ? "step" : undefined}
              >
                <span className="closed-loop-step-num" style={{ fontSize: "11px", opacity: 0.7 }}>{s.number}</span>
                <Icon name={s.icon} size={13} />
                <span>{s.label}</span>
              </Link>
              {idx < CLOSED_LOOP_STEPS.length - 1 && (
                <span className="closed-loop-arrow" aria-hidden="true" style={withinAudit ? { opacity: 0.45 } : undefined}>&rarr;</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="closed-loop-next-card">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "inline-grid",
              placeItems: "center",
              minWidth: "22px",
              padding: "0 5px",
              height: "22px",
              borderRadius: "50%",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {activeNumber}
          </span>
          <div>
            <strong>Step {activeNumber}: {guide.title}</strong>
            <span style={{ color: "var(--text-2)", marginLeft: "8px" }}>
              {guide.hint}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
