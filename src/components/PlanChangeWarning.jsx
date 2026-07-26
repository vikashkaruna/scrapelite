// PlanChangeWarning.jsx — confirm a plan change, spelling out the consequences.
//
// Requirement 12: when moving to a LOWER plan, tell the user exactly what they
// lose — but never stand in their way. This is a confirm step, not a gate:
// "Yes, downgrade" is always available and always works.
//
// The loss list is DERIVED from the two plans' `limits` (describePlanChange in
// prorationMath.js) rather than written by hand, so it cannot quietly go stale
// when a plan's allowances change.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { describePlanChange } from "../lib/prorationMath.js";

function fmtDate(v) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

export default function PlanChangeWarning({ fromPlan, toPlan, periodEnd, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!fromPlan || !toPlan) return null;
  const change = describePlanChange(fromPlan, toPlan);
  const isDowngrade = change.direction === "downgrade";

  return createPortal(
    <div className="error-backdrop" role="dialog" aria-modal="true" aria-labelledby="pcw-title" onClick={onCancel}>
      <div className="error-modal card plan-change-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost btn-icon btn-sm error-close" onClick={onCancel} aria-label="Close">
          <Icon name="x" size={17} />
        </button>

        <div className={`error-icon-wrap${isDowngrade ? " pcw-warn" : ""}`}>
          <Icon name={isDowngrade ? "alert-triangle" : "trending-up"} size={24} />
        </div>

        <div className="error-body">
          <h2 className="error-title" id="pcw-title">
            {isDowngrade ? `Move to ${toPlan.name}?` : `Upgrade to ${toPlan.name}`}
          </h2>
          <p className="error-message">
            {isDowngrade ? (
              <>
                You are moving from <strong>{fromPlan.name}</strong> down to <strong>{toPlan.name}</strong>.
                {periodEnd
                  ? ` You keep everything you have paid for until ${fmtDate(periodEnd)}; the change takes effect then.`
                  : " The change takes effect at the end of your current period."}
              </>
            ) : (
              <>
                Your new allowances apply straight away, and any unused time on{" "}
                <strong>{fromPlan.name}</strong> is credited against this invoice.
              </>
            )}
          </p>
        </div>

        {isDowngrade && change.losses.length > 0 && (
          <div className="pcw-losses">
            <div className="pcw-losses-label">What you will lose</div>
            <ul>
              {change.losses.map((l) => (
                <li key={l}>
                  <Icon name="x" size={13} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            {/* Nothing is deleted by a downgrade — say so, or people assume it is. */}
            <p className="pcw-note">
              Your saved extractions and collections are not affected. Anything above the new
              limits simply stops being available until you upgrade again.
            </p>
          </div>
        )}

        {!isDowngrade && change.gains.length > 0 && (
          <div className="pcw-gains">
            <div className="pcw-losses-label">What you gain</div>
            <ul>
              {change.gains.map((g) => (
                <li key={g}>
                  <Icon name="check" size={13} />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="error-actions">
          <Button variant="secondary" onClick={onCancel}>
            Keep {fromPlan.name}
          </Button>
          {/* Never blocked — the user's decision is theirs to make. */}
          <Button variant={isDowngrade ? "danger" : "primary"} onClick={onConfirm}>
            {isDowngrade ? `Yes, move to ${toPlan.name}` : `Continue to payment`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
