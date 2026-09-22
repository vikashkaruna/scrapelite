// ClosedLoopRibbon.jsx — Closed-Loop Operating Flow for Discoverability Intelligence.
//
// Numbering is HIERARCHICAL on purpose. Running an audit performs Discover,
// Score, Diagnose and Recommend in one pass, so those four are sub-steps of
// stage 1 (1.1–1.4) rather than four separate things the user must do. The
// remaining stages are distinct acts following the audit → revenue loop:
//
//   2 Implement   — Business Truth (canonical facts)
//   3 Verify      — Schema & Trust (structured data correctness)
//   4 Build       — Entity Graph + Local Directory (knowledge foundation)
//   5 Score       — Subject Scores (BDS / PDS / SFS)
//   6 Validate    — SXO & Outcomes (journey friction + conversions)
//                   ↻ loops back to step 1 (Re-audit)
//
// Schema & Trust used to share step 2 with Business Truth — that collapsed two
// distinct acts. Entity Graph used to come AFTER Subject Scores, which is
// backwards: you can't score a subject until the entity exists. The order
// here puts the foundation (truth → schema → graph → local → scores) before
// the validation (sxo) so each step has its prerequisites satisfied.

// Imports
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import Icon from "../Icon.jsx";
import "./ClosedLoopRibbon.css";

// Note: isAuditTab is defined later with history handling.


export const CLOSED_LOOP_STEPS = Object.freeze([
  { id: "discover",   number: "1.1", group: "audit",     label: "Discover",  icon: "scan-search",    path: "/discoverability" },
  { id: "score",      number: "1.2", group: "audit",     label: "Score",     icon: "bar-chart-2",    path: "/discoverability" },
  { id: "diagnose",   number: "1.3", group: "audit",     label: "Diagnose",  icon: "alert-triangle", path: "/discoverability" },
  { id: "recommend",  number: "1.4", group: "audit",     label: "Recommend", icon: "list-checks",    path: "/discoverability" },
  { id: "implement",  number: "2",   group: "implement", label: "Implement", icon: "database",       path: "/discoverability/truth" },
  { id: "verify",     number: "3",   group: "verify",    label: "Verify",    icon: "shield-check",   path: "/discoverability/trust" },
  { id: "build",      number: "4",   group: "build",     label: "Build",     icon: "share-2",        path: "/discoverability/entities" },
  { id: "score_subj", number: "5",   group: "score",     label: "Score",     icon: "award",          path: "/discoverability/scores" },
  { id: "validate",   number: "6",   group: "validate",  label: "Validate",  icon: "zap",            path: "/discoverability/sxo" },
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
    title: "Implement Business Truth",
    hint: "Establish canonical facts (brand, product, service, location) and self-approve records. Each becomes the source of truth the rest of the loop measures against.",
  },
  verify: {
    title: "Verify Schema & Trust",
    hint: "Validate structured-data correctness and trust signals. Schema trust is what makes facts claimable to answer engines — and what lets us tell a valid declared fact from a machine-readable false statement.",
  },
  build: {
    title: "Build Entity Graph & Local Directory",
    hint: "Declare entities, draw verified relationships, and extend directory presence. The graph is the knowledge foundation Subject Scores run against.",
  },
  score_subj: {
    title: "Score Subjects (BDS / PDS / SFS)",
    hint: "Compute entity-level Brand, Product, and Service scores. Subject scores feed the rollups that SXO aggregates.",
  },
  validate: {
    title: "Validate SXO & Outcomes",
    hint: "Re-evaluate SXO journey friction, conversion funnels, and calculate master composite. Then close the loop and Re-audit.",
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
    if (activeTab === "audit" || activeTab === "history") return true;
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
    // Map each workspace route to its closed-loop step. Order matters only in
    // the sense that more specific paths should appear before less specific —
    // but every test path below is unique to a step, so simple inclusion works.
    if (path.includes("/truth")) return "implement";
    if (path.includes("/trust")) return "verify";
    if (path.includes("/entities") || path.includes("/local")) return "build";
    if (path.includes("/scores")) return "score_subj";
    if (path.includes("/sxo")) return "validate";
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
      {/* The loop is the product thesis, so it is named on screen rather than
          left for the user to infer from eight numbered pills. The steps stay
          at the top and the tabs sit below them, unchanged. */}
      <div className="closed-loop-title">
        <Icon name="refresh-cw" size={12} aria-hidden="true" />
        <span>Discoverability to Revenue Loop</span>
      </div>
      <div
        className="closed-loop-ribbon"
        role="navigation"
        aria-label="Discoverability to Revenue Loop"
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

        {/* 🔴 The backlink is what makes this a LOOP rather than a checklist.
            Without it the ribbon reads as "do these nine things and stop",
            which is the opposite of the point: validating SXO outcomes is what
            tells you what to re-audit. It links to the audit surface and is
            highlighted whenever the user is on Audit or History, so the cycle
            is visibly closed from the place the next pass starts. */}
        <div className="closed-loop-step-wrapper closed-loop-loopback">
          <span className="closed-loop-arrow closed-loop-arrow-back" aria-hidden="true">&crarr;</span>
          <Link
            to={`/discoverability${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`}
            className={`closed-loop-step closed-loop-reaudit${isAuditTab ? " is-audit-highlight is-complete" : ""}`}
            title="Close the loop: re-audit and measure what changed"
          >
            <Icon name="refresh-cw" size={12} />
            <span>Re-audit</span>
          </Link>
        </div>
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
