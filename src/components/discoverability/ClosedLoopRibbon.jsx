// ClosedLoopRibbon.jsx — Closed-Loop Operating Flow for Discoverability Intelligence:
// Discover → Score → Diagnose → Recommend → Implement → Validate → Benchmark → Expand

import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import Icon from "../Icon.jsx";

export const CLOSED_LOOP_STEPS = Object.freeze([
  { id: "discover", label: "Discover", icon: "scan-search", path: "/discoverability" },
  { id: "score", label: "Score", icon: "bar-chart-2", path: "/discoverability" },
  { id: "diagnose", label: "Diagnose", icon: "alert-triangle", path: "/discoverability" },
  { id: "recommend", label: "Recommend", icon: "list-checks", path: "/discoverability" },
  { id: "implement", label: "Implement", icon: "database", path: "/discoverability/truth" },
  { id: "validate", label: "Validate", icon: "zap", path: "/discoverability/sxo" },
  { id: "benchmark", label: "Benchmark", icon: "award", path: "/discoverability/scores" },
  { id: "expand", label: "Expand", icon: "share-2", path: "/discoverability/entities" },
]);

const STEP_GUIDES = {
  discover: {
    step: 1,
    title: "Crawl & Discover",
    hint: "Enter your target URL to run a fresh multi-engine discoverability scan.",
    cta: "Run crawl below",
  },
  score: {
    step: 2,
    title: "Visibility Scores",
    hint: "Review your balanced SEO, AEO, and GEO baseline scores across the four pillars.",
    cta: "Review scores below",
  },
  diagnose: {
    step: 3,
    title: "Root Cause Diagnosis",
    hint: "Inspect critical crawl, indexability, rendering, and technical performance issues.",
    cta: "Analyze issue matrix",
  },
  recommend: {
    step: 4,
    title: "Actionable Recommendations",
    hint: "Prioritize copy-ready fixes ranked by impact for classic search, answer engines, and LLMs.",
    cta: "View recommendation queue",
  },
  implement: {
    step: 5,
    title: "Implement Truth & Schema",
    hint: "Establish canonical facts in Business Truth, self-approve records, and verify schema trust.",
    cta: "Manage Business Truth",
  },
  validate: {
    step: 6,
    title: "Validate SXO Outcomes",
    hint: "Re-evaluate SXO journey friction, conversion funnels, and calculate master composite.",
    cta: "Evaluate SXO",
  },
  benchmark: {
    step: 7,
    title: "Competitive Benchmark",
    hint: "Compare visibility velocity against competitors and track trend history.",
    cta: "View subject scores",
  },
  expand: {
    step: 8,
    title: "Expand Graph & Local",
    hint: "Scale knowledge graph relationships, entity connections, and local directories.",
    cta: "Explore entity graph",
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

  return (
    <div className="dsc-closed-loop-wrapper" style={{ marginBottom: "18px" }}>
      <div
        className="closed-loop-ribbon"
        role="navigation"
        aria-label="Closed-loop operating process"
      >
        {CLOSED_LOOP_STEPS.map((s, idx) => {
          const isActive = s.id === activeStep;
          const isPast = guide.step > idx + 1;
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
                title={`Step ${idx + 1}: ${s.label}`}
              >
                <span style={{ fontSize: "11px", opacity: 0.7 }}>{idx + 1}.</span>
                <Icon name={s.icon} size={13} />
                <span>{s.label}</span>
              </Link>
              {idx < CLOSED_LOOP_STEPS.length - 1 && (
                <span className="closed-loop-arrow" aria-hidden="true">&rarr;</span>
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
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {guide.step}
          </span>
          <div>
            <strong>Step {guide.step}: {guide.title}</strong>
            <span style={{ color: "var(--text-2)", marginLeft: "8px" }}>
              {guide.hint}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
