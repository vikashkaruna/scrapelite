// src/components/OnboardingTour.jsx — Q4 tour overlay UI.
//
// Renders the 6-step tour as a spotlight + popover. The popover points at
// the target element via a placement prop; for `center` placement it sits
// in the middle of the screen.

import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import {
  getTourSteps, isTourCompleted, isTourSkipped,
  markCompleted, markSkipped, nextStep, prevStep, progressFraction,
} from "../lib/onboardingTour.js";

function computeAnchor(target, placement) {
  if (typeof window === "undefined" || !target) return null;
  const el = document.querySelector(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, placement };
}

function popoverStyle(anchor) {
  if (!anchor || anchor.placement === "center") {
    return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }
  const { x, y, w, h, placement } = anchor;
  if (placement === "bottom") {
    return { left: x, top: y + h + 12, width: Math.max(280, w) };
  }
  if (placement === "top") {
    return { left: x, top: Math.max(12, y - 12), width: Math.max(280, w) };
  }
  if (placement === "right") {
    return { left: x + w + 12, top: y };
  }
  if (placement === "left") {
    return { right: Math.max(12, window.innerWidth - x), top: y };
  }
  return { left: x, top: y + h + 12 };
}

function spotlightStyle(anchor) {
  if (!anchor) return null;
  const { x, y, w, h } = anchor;
  return {
    left: x - 6, top: y - 6,
    width: w + 12, height: h + 12,
  };
}

export default function OnboardingTour({ forceOpen = false, onClose }) {
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const steps = getTourSteps();

  useEffect(() => {
    if (forceOpen) { setOpen(true); return; }
    if (!isTourCompleted() && !isTourSkipped()) {
      // Auto-start for first-time visitors.
      setOpen(true);
    }
  }, [forceOpen]);

  useEffect(() => {
    if (!open) return;
    const step = steps[stepIdx];
    if (!step) return;
    setAnchor(computeAnchor(step.target, step.placement));
    // Re-anchor on resize so the spotlight tracks the target.
    const onResize = () => setAnchor(computeAnchor(step.target, step.placement));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, stepIdx, steps]);

  // Esc closes the tour.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") handleSkip(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  const step = steps[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast  = stepIdx === steps.length - 1;

  function handleNext() {
    if (isLast) { handleFinish(); return; }
    setStepIdx(nextStep(stepIdx, steps.length));
  }
  function handlePrev() {
    if (isFirst) return;
    setStepIdx(prevStep(stepIdx));
  }
  function handleFinish() {
    markCompleted();
    setOpen(false);
    onClose?.();
  }
  function handleSkip() {
    markSkipped();
    setOpen(false);
    onClose?.();
  }

  const isCentre = step.placement === "center";

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Backdrop with a "hole" cut for the spotlight */}
      {!isCentre && anchor && (
        <div className="tour-spotlight" style={spotlightStyle(anchor)} />
      )}
      {isCentre && <div className="tour-backdrop-centre" />}

      {/* The popover */}
      <div className={"tour-popover" + (isCentre ? " tour-popover-center" : "")}
           style={popoverStyle(anchor)}>
        <div className="tour-progress">
          <span>Step {stepIdx + 1} of {steps.length}</span>
          <div className="tour-progress-bar">
            <span style={{ width: `${Math.round(progressFraction(stepIdx, steps.length) * 100)}%` }} />
          </div>
        </div>
        <h3 id="tour-title" className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={handleSkip}>
            Skip tour
          </button>
          <div className="tour-actions-right">
            {!isFirst && (
              <button type="button" className="tour-back" onClick={handlePrev}>
                <Icon name="arrow-left" size={12} /> Back
              </button>
            )}
            <button type="button" className="tour-next" onClick={handleNext}>
              {isLast ? "Finish" : <>Next <Icon name="arrow-right" size={12} /></>}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="tour-close"
          onClick={handleSkip}
          aria-label="Close tour"
          title="Close (Esc)"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
