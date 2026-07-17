// GuestTrialModal.jsx — shown when a non-logged-in user hits a trial limit.
//
// Two modes:
//  • Soft prompt (showPrompt)   — dismissible; re-appears every N extractions
//  • Hard block (showHardBlock) — NOT dismissible; user must sign up or sign in
//    to continue.  hardBlockReason: "single" | "batch"
//
// FA3 — task-aware + annual anchoring: the headline + body + benefits list
// now reflect what the user was actually trying to do (single URL vs batch
// with N URLs) and anchor on the annual upgrade price (per the council
// note: "Upgrade screen at the exact moment of trial exhaustion, showing
// which paid feature completes the current task; annual anchoring").
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import { buildPaywallCopy } from "../lib/paywallCopy.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function GuestTrialModal() {
  const { user, openAuth } = useAuth();
  const location = useLocation();
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

  // FA3 — task-aware copy. For the hard block, force the kind to match the
  // reason (so a blocked batch run sees batch copy, not single-URL copy).
  const ctx = hardBlockReason === "batch"
    ? { kind: "batch", urls: BATCH_LIMIT * 4 } // worst-case hint: a batch of 4× their limit
    : hardBlockReason === "schedule"
      ? { kind: "schedule" }
      : undefined;
  const paywall = buildPaywallCopy({
    route: location.pathname,
    usage: { extractions: SINGLE_LIMIT },
    currentPlan: { id: "free", name: "Free", limits: { extractions: SINGLE_LIMIT } },
    ctx,
    currency: "USD",
  });

  const headlineText = isHard
    ? paywall.title
    : `You've used your ${TRIAL_LIMIT} free trial extractions`;

  const bodyText = isHard
    ? paywall.body
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

        {/* FA3 — annual-anchored upgrade badge for the hard block */}
        {isHard && paywall.savingsLabel && (
          <div className="gtm-anchor-pill">
            <Icon name="trending-down" size={12} />
            <span>{paywall.savingsLabel}</span>
          </div>
        )}

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
            {isHard
              ? `Create free account & start ${paywall.recommendedPlanName}`
              : "Create free account"}
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
