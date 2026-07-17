// src/components/CreditEstimator.jsx — Q2 (pre-flight credit estimator) UI.
//
// Small banner that shows the user the cost of a planned run before they hit
// the button. Hidden when there's no actionable input. Tones:
//   "ok"    → normal green/quiet
//   "warn"  → amber, used when the run would leave ≤ 20% remaining
//   "block" → red, the run can't proceed (caller should disable the action)

import Icon from "./Icon.jsx";

export default function CreditEstimator({ estimate, compact = false }) {
  if (!estimate) return null;
  // Hide when the user hasn't entered anything yet, or when unlimited
  // plans + 0 cost don't need any UI noise.
  if (estimate.required === 0) return null;
  if (estimate.isUnlimited && estimate.tone === "ok" && compact) return null;

  const cls = `credit-estimator tone-${estimate.tone}${compact ? " compact" : ""}`;
  const icon =
    estimate.tone === "block" ? "shield-alert" :
    estimate.tone === "warn"  ? "alert-triangle" :
                                "info";

  return (
    <div className={cls} role="status" aria-live="polite">
      <Icon name={icon} size={14} />
      <span className="credit-estimator-text">{estimate.message}</span>
      {!compact && estimate.tone !== "block" && (
        <span className="credit-estimator-after">
          ({estimate.afterRun} after this run)
        </span>
      )}
    </div>
  );
}
