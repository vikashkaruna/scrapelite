// PaymentProcessingModal.jsx — Step-by-step payment progress overlay for Razorpay flow.
// Mounted in BillingProvider so it works for any payment triggered from any page.
import Icon from "./Icon.jsx";
import { PAYMENT_STAGE } from "../lib/paymentService.js";

const STEPS = [
  { stage: PAYMENT_STAGE.PREPARING,  label: "Setting up payment",   icon: "refresh"     },
  { stage: PAYMENT_STAGE.VERIFYING,  label: "Verifying payment",    icon: "shield"      },
  { stage: PAYMENT_STAGE.ACTIVATING, label: "Activating your plan", icon: "zap"         },
];

const STEP_ORDER = [PAYMENT_STAGE.PREPARING, PAYMENT_STAGE.VERIFYING, PAYMENT_STAGE.ACTIVATING];

function getStepStatus(step, currentStage) {
  const cur  = STEP_ORDER.indexOf(currentStage);
  const idx  = STEP_ORDER.indexOf(step.stage);
  if (cur < 0) return "pending";          // error / cancelled — treat all as pending
  if (idx < cur) return "done";
  if (idx === cur) return "active";
  return "pending";
}

export default function PaymentProcessingModal({ stage, stageMsg, planName, onRetry, onCancel }) {
  // Hidden states: idle (no payment), portal_open (Razorpay modal is covering the screen)
  if (!stage || stage === PAYMENT_STAGE.IDLE || stage === PAYMENT_STAGE.PORTAL_OPEN) return null;

  const isError     = stage === PAYMENT_STAGE.ERROR;
  const isCancelled = stage === PAYMENT_STAGE.CANCELLED;
  const isActive    = !isError && !isCancelled; // PREPARING | VERIFYING | ACTIVATING

  return (
    <div className="ppm-backdrop" role="dialog" aria-modal="true" aria-label="Payment status">
      <div className="ppm-card">

        {/* Icon ring */}
        <div className={`ppm-icon-ring ${isError ? "error" : isCancelled ? "cancelled" : "pending"}`}>
          {isError
            ? <Icon name="alert-circle" size={28} />
            : isCancelled
              ? <Icon name="x"          size={28} />
              : <Icon name="refresh"    size={28} className="ppm-spin" />}
        </div>

        {/* Title */}
        <h2 className="ppm-title">
          {isError     ? "Payment failed"     :
           isCancelled ? "Payment cancelled"  :
                         "Processing payment…"}
        </h2>

        {/* Plan label */}
        {planName && isActive && (
          <p className="ppm-plan-label">{planName} Plan</p>
        )}

        {/* Step indicator — only during active processing */}
        {isActive && (
          <div className="ppm-steps" aria-live="polite">
            {STEPS.map((step) => {
              const status = getStepStatus(step, stage);
              return (
                <div key={step.stage} className={`ppm-step ppm-step-${status}`}>
                  <span className="ppm-step-icon">
                    {status === "done"
                      ? <Icon name="check-circle" size={16} />
                      : status === "active"
                        ? <Icon name={step.icon} size={16} className="ppm-spin" />
                        : <Icon name={step.icon} size={16} />}
                  </span>
                  <span className="ppm-step-label">{step.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Contextual message */}
        {stageMsg && (
          <p className={`ppm-msg${isError ? " error" : isCancelled ? " muted" : ""}`}>
            {stageMsg}
          </p>
        )}

        {/* Error: retry + support actions */}
        {isError && (
          <div className="ppm-actions">
            {onRetry && (
              <button className="btn btn-primary btn-sm" onClick={onRetry}>
                <Icon name="refresh" size={14} />
                Try again
              </button>
            )}
            <a
              href="mailto:hello@datiq.app?subject=Payment%20issue"
              className="btn btn-ghost btn-sm"
            >
              <Icon name="mail" size={14} />
              Contact support
            </a>
          </div>
        )}

        {/* Cancelled: dismiss */}
        {isCancelled && onCancel && (
          <div className="ppm-actions">
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>
              Back to pricing
            </button>
          </div>
        )}

        {/* Security badge — only during active processing */}
        {isActive && (
          <div className="ppm-security-note">
            <Icon name="shield" size={13} />
            <span>Secured by Razorpay · Your payment details are encrypted</span>
          </div>
        )}
      </div>
    </div>
  );
}
