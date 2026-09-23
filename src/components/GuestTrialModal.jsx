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
import { useLocation } from "react-router";
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

  // Closing this modal never grants anything — it only hides the dialog. The
  // limit lives in the counters, and every extraction entry point re-runs the
  // pre-flight (see GuestTrialProvider.requireGuestCredit), so a closed dialog
  // reappears the moment the user tries again.
  //
  // Opening the auth modal specifically must NOT close the hard block:
  // previously both buttons ran `openAuth(...); dismiss()`, so closing the auth
  // modal without signing up left the gate cleared while the counters stood.
  // Only a real auth transition clears it — GuestTrialProvider's
  // `isLoggedIn && !wasLoggedIn` branch.
  //
  // The hard block is still not *casually* dismissible (no Escape, no backdrop
  // click) but it does keep one explicit exit, because this overlay covers the
  // whole viewport: without it an over-limit guest cannot reach /pricing to
  // upgrade, which is the one thing the block is trying to sell them.
  const dismiss = isHard ? () => setShowHardBlock(false) : () => setShowPrompt(false);

  // FA3 — task-aware copy. For the hard block, force the kind to match the
  // reason (so a blocked batch run sees batch copy, not single-URL copy).
  //
  // "batch_runs", not "batch": the guest exhausted their allowance of RUNS,
  // which has nothing to do with how many URLs fit in one batch. Passing
  // { kind: "batch", urls: BATCH_LIMIT * 4 } made the dialog announce "You
  // need 20 URLs in one batch" — a limit they never hit, quoting a number
  // invented by that multiplication.
  const ctx = hardBlockReason === "batch"
    ? { kind: "batch_runs", used: BATCH_LIMIT }
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
    : "Create a free account to keep going. The free plan includes 100 credits that never expire, full AI summaries, and more.";

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
          {/* Was "Batch mode (up to 200 URLs)" — 200 is the Business tier. The
              account this dialog offers is Free, which allows 5 URLs a batch,
              so it promised 40x what it delivers at the exact moment someone
              decides to sign up. */}
          {isHard && <li><Icon name="check" size={14} /> Batch mode included</li>}
        </ul>
        <div className="gtm-actions">
          {/* Note: these only OPEN the auth modal. They must not dismiss the
              hard block — see `dismiss` above. In soft mode closing the prompt
              is harmless, so it still closes there. */}
          <Button
            variant="primary"
            icon="user-plus"
            onClick={() => { openAuth("signup"); if (!isHard) setShowPrompt(false); }}
          >
            {/* Only name a plan when there's actually one to sell. A guest out
                of batch runs is recommended the Free plan, which would render
                "Create free account & start Free". */}
            {isHard && paywall.recommendedPlanId && paywall.recommendedPlanId !== "free"
              ? `Create free account & start ${paywall.recommendedPlanName}`
              : "Create free account"}
          </Button>
          <Button
            variant="ghost"
            icon="log-in"
            onClick={() => { openAuth("signin"); if (!isHard) setShowPrompt(false); }}
          >
            Sign in
          </Button>
        </div>
        {/* Exit link. In soft mode it's "keep going, limited". In hard mode it
            only closes the dialog so the user can still browse and reach
            /pricing — no further extraction is possible either way. */}
        <button className="gtm-dismiss" onClick={dismiss}>
          {isHard ? "Keep browsing (no extractions left)" : "Continue as guest (limited)"}
        </button>
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
