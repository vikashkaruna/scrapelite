// GuestTrialModal.jsx — shown when a non-logged-in user hits a trial limit.
//
// Two modes:
//  • Soft prompt (showPrompt)   — dismissible; re-appears every N extractions
//  • Hard block (showHardBlock) — NOT dismissible; user must sign up or sign in
//    to continue.  hardBlockReason: "single" | "batch"
import { useEffect } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function GuestTrialModal() {
  const { user, openAuth } = useAuth();
  const {
    showPrompt, setShowPrompt,
    showHardBlock, setShowHardBlock,
    hardBlockReason,
    TRIAL_LIMIT, SINGLE_LIMIT, BATCH_LIMIT,
  } = useGuestTrial();

  const isHard = showHardBlock && !user;
  const isSoft = showPrompt && !user && !isHard;

  // Escape key closes the soft prompt only (not the hard block).
  useEffect(() => {
    if (!isSoft) return;
    const handler = (e) => { if (e.key === "Escape") setShowPrompt(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isSoft, setShowPrompt]);

  if (!isHard && !isSoft) return null;

  const dismiss = isHard
    ? () => setShowHardBlock(false) // only reachable via auth buttons; backdrop doesn't fire
    : () => setShowPrompt(false);

  const headlineText = isHard
    ? hardBlockReason === "batch"
      ? `You've reached the guest batch limit (${BATCH_LIMIT} runs)`
      : `You've reached the guest extraction limit (${SINGLE_LIMIT} extractions)`
    : `You've used your ${TRIAL_LIMIT} free trial extractions`;

  const bodyText = isHard
    ? "Create a free account to keep going. No credit card required — free plan includes 10 extractions per month."
    : "Create a free account to keep going. The free plan includes 10 extractions per month, full AI summaries, and more.";

  return (
    <div
      className={"guest-trial-overlay" + (isHard ? " gtm-hard" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={isHard ? "Sign up to continue" : "Trial limit reached"}
    >
      <div className="guest-trial-modal" onClick={(e) => e.stopPropagation()}>
        <div className={"gtm-icon-wrap" + (isHard ? " gtm-icon-warn" : "")}>
          <Icon name={isHard ? "alert-triangle" : "sparkles"} size={28} />
        </div>
        <h2 className="gtm-headline">{headlineText}</h2>
        <p className="gtm-body">{bodyText}</p>
        <ul className="gtm-benefits">
          <li><Icon name="check" size={14} /> 10 free extractions every month</li>
          <li><Icon name="check" size={14} /> AI summaries + link intelligence</li>
          <li><Icon name="check" size={14} /> CSV export &amp; saved dashboard</li>
          <li><Icon name="check" size={14} /> Contacts, pricing &amp; custom extraction</li>
          {isHard && <li><Icon name="check" size={14} /> Batch mode (up to 200 URLs)</li>}
        </ul>
        <div className="gtm-actions">
          <Button
            variant="primary"
            icon="user-plus"
            onClick={() => { openAuth("signup"); dismiss(); }}
          >
            Create free account
          </Button>
          <Button
            variant="ghost"
            icon="log-in"
            onClick={() => { openAuth("signin"); dismiss(); }}
          >
            Sign in
          </Button>
        </div>
        {/* Dismiss link — only in soft mode */}
        {!isHard && (
          <button className="gtm-dismiss" onClick={() => setShowPrompt(false)}>
            Continue as guest (limited)
          </button>
        )}
      </div>
      {/* Backdrop — dismisses soft prompt, but NOT the hard block */}
      {!isHard && (
        <div
          className="guest-trial-backdrop"
          aria-hidden="true"
          onClick={() => setShowPrompt(false)}
        />
      )}
    </div>
  );
}
