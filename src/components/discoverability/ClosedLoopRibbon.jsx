// ClosedLoopRibbon.jsx — Closed-Loop Operating Flow for Discoverability Intelligence.
//
// Numbering is HIERARCHICAL on purpose. Running an audit performs Discover,
// Score, Diagnose and Recommend in one pass, so those four are sub-steps of
// stage 1 (1.1–1.4) rather than four separate things the user must do. The
// remaining stages are distinct acts: 2 Implement → 3 Validate → 4 Benchmark
// → 5 Expand.

import { useEffect, useMemo, useState } from "react";
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
    auditingHint: "Auditing in progress… Crawling the target URL (raw & rendered) and reading crawler policies.",
  },
  score: {
    title: "Audit · Visibility Scores",
    hint: "Review your balanced SEO, AEO, and GEO baseline scores across the four pillars.",
    auditingHint: "Auditing in progress… Calculating balanced SEO, AEO, and GEO baseline scores across 4 pillars.",
  },
  diagnose: {
    title: "Audit · Root Cause Diagnosis",
    hint: "Inspect critical crawl, indexability, rendering, and technical performance issues.",
    auditingHint: "Auditing in progress… Inspecting indexability, schema syntax, and technical barriers.",
  },
  recommend: {
    title: "Audit · Actionable Recommendations",
    hint: "Prioritize copy-ready fixes ranked by impact for classic search, answer engines, and LLMs.",
    auditingHint: "Auditing in progress… Generating copy-ready fixes ranked by impact across search & AI engines.",
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

const AUDIT_PROGRESS_STEPS = ["discover", "score", "diagnose", "recommend"];

export default function ClosedLoopRibbon({
  auditId = null,
  currentStep = null,
  isAuditing = false,
  activeTab = null,
  hasAudit = false,
  onStepClick = null,
}) {
  const location = useLocation();
  const [auditStepIdx, setAuditStepIdx] = useState(0);

  // While auditing is in progress, advance through 1.1 Discover to 1.4 Recommend
  useEffect(() => {
    if (!isAuditing) {
      setAuditStepIdx(0);
      return;
    }
    setAuditStepIdx(0);
    const t1 = setTimeout(() => setAuditStepIdx(1), 1800);
    const t2 = setTimeout(() => setAuditStepIdx(2), 4200);
    const t3 = setTimeout(() => setAuditStepIdx(3), 6800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isAuditing]);

  const isAuditTab = useMemo(() => {
    if (activeTab === "audit") return true;
    if (!activeTab && !currentStep && (location.pathname === "/discoverability" || location.pathname === "/discoverability/")) {
      return true;
    }
    return false;
  }, [activeTab, currentStep, location.pathname]);

  const activeStep = useMemo(() => {
    if (isAuditing) {
      return AUDIT_PROGRESS_STEPS[auditStepIdx] || "discover";
    }
    if (currentStep) return currentStep;
    const path = location.pathname;
    if (path.includes("/truth") || path.includes("/trust")) return "implement";
    if (path.includes("/sxo")) return "validate";
    if (path.includes("/scores")) return "benchmark";
    if (path.includes("/entities") || path.includes("/local")) return "expand";
    return "discover";
  }, [isAuditing, auditStepIdx, currentStep, location.pathname]);

  const activeIndex = Math.max(0, CLOSED_LOOP_STEPS.findIndex((s) => s.id === activeStep));
  const activeNumber = CLOSED_LOOP_STEPS[activeIndex]?.number || "1.1";
  const stepGuide = STEP_GUIDES[activeStep] || STEP_GUIDES.discover;

  // Compute guide card presentation
  const guideInfo = useMemo(() => {
    if (isAuditing) {
      return {
        badge: activeNumber,
        title: `Step ${activeNumber}: ${stepGuide.title}`,
        hint: stepGuide.auditingHint || stepGuide.hint,
        isAuditComplete: false,
        badgeStyle: { background: "var(--accent)", color: "#fff" },
      };
    }
    if (isAuditTab) {
      return {
        badge: "1",
        title: "Step 1: Audit Complete · Discover, Score, Diagnose & Recommend",
        hint: hasAudit
          ? "All four audit stages (1.1–1.4) completed. Review scores and findings below, then proceed to Step 2 Implement to establish canonical facts and schema trust."
          : "One single audit covers steps 1.1–1.4: multi-engine crawl, visibility scoring, root cause diagnosis, and prioritized recommendations.",
        isAuditComplete: true,
        badgeStyle: { background: "var(--dsc-success, #15803d)", color: "#fff" },
      };
    }
    return {
      badge: activeNumber,
      title: `Step ${activeNumber}: ${stepGuide.title}`,
      hint: stepGuide.hint,
      isAuditComplete: false,
      badgeStyle: { background: "var(--accent)", color: "#fff" },
    };
  }, [isAuditing, isAuditTab, hasAudit, activeNumber, stepGuide]);

  return (
    <div className="dsc-closed-loop-wrapper">
      <div
        className="closed-loop-ribbon"
        role="navigation"
        aria-label="Closed-loop operating process"
      >
        {CLOSED_LOOP_STEPS.map((s, idx) => {
          const isAuditStep = s.group === "audit";
          let stepClasses = "closed-loop-step";
          let ariaCurrent = undefined;

          if (isAuditing) {
            if (isAuditStep) {
              const currentSubIdx = AUDIT_PROGRESS_STEPS.indexOf(s.id);
              if (currentSubIdx === auditStepIdx) {
                stepClasses += " is-active is-auditing";
                ariaCurrent = "step";
              } else if (currentSubIdx < auditStepIdx) {
                stepClasses += " is-audit-highlight is-complete";
              }
            }
          } else if (isAuditTab) {
            if (isAuditStep) {
              // On the Audit tab, entire 1.1 Discover to 1.4 Recommend are in highlighted green color
              stepClasses += " is-audit-highlight is-complete";
              if (s.id === activeStep) {
                ariaCurrent = "step";
              }
            } else {
              const isActive = s.id === activeStep;
              const isPast = idx < activeIndex;
              if (isActive) {
                stepClasses += " is-active";
                ariaCurrent = "step";
              } else if (isPast) {
                stepClasses += " is-complete";
              }
            }
          } else {
            const isActive = s.id === activeStep;
            const isPast = idx < activeIndex;
            if (isActive) {
              stepClasses += " is-active";
              ariaCurrent = "step";
            } else if (isPast) {
              stepClasses += " is-complete";
            }
          }

          const next = CLOSED_LOOP_STEPS[idx + 1];
          const withinAudit = next && isAuditStep && next.group === "audit";
          const isArrowAuditHighlight =
            (!isAuditing && isAuditTab && withinAudit) ||
            (isAuditing && withinAudit && AUDIT_PROGRESS_STEPS.indexOf(next.id) <= auditStepIdx);
          const targetUrl = `${s.path}${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`;

          return (
            <div key={s.id} className="closed-loop-step-wrapper">
              <Link
                to={targetUrl}
                onClick={(e) => {
                  if (onStepClick) {
                    onStepClick(s.id, e);
                  }
                }}
                className={stepClasses}
                title={`Step ${s.number}: ${s.label}`}
                aria-current={ariaCurrent}
              >
                <span className="closed-loop-step-num" style={{ fontSize: "10.5px", opacity: 0.75 }}>{s.number}</span>
                <Icon name={s.icon} size={12} />
                <span>{s.label}</span>
              </Link>
              {idx < CLOSED_LOOP_STEPS.length - 1 && (
                <span
                  className={`closed-loop-arrow${isArrowAuditHighlight ? " is-audit-highlight" : ""}`}
                  aria-hidden="true"
                  style={withinAudit && !isArrowAuditHighlight ? { opacity: 0.45 } : undefined}
                >
                  &rarr;
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className={`closed-loop-next-card${guideInfo.isAuditComplete ? " is-audit-complete" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "inline-grid",
              placeItems: "center",
              minWidth: "22px",
              padding: "0 5px",
              height: "22px",
              borderRadius: "50%",
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
              ...guideInfo.badgeStyle,
            }}
          >
            {guideInfo.badge}
          </span>
          <div>
            <strong>{guideInfo.title}</strong>
            <span style={{ color: "var(--text-2)", marginLeft: "8px" }}>
              {guideInfo.hint}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
