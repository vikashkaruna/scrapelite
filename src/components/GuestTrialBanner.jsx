// GuestTrialBanner.jsx — slim info bar shown to non-logged-in users.
// Shows remaining extraction headroom against the hard limits, nudges sign-up.
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import { useLocation } from "react-router";
import Icon from "./Icon.jsx";
import OffersBanner from "./OffersBanner.jsx";
import { getHeadlineOffer } from "../lib/offersService.js";

export const GUEST_TRIAL_AUTO_DISMISS_MS = 6_000;
// A limit warning has more to read, so it stays twice as long — then goes.
// Hiding it gives nothing away: every extraction path still calls
// requireGuestCredit(), and the next attempt raises the sign-up dialog.
export const GUEST_LIMIT_AUTO_DISMISS_MS = 12_000;

export default function GuestTrialBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { count, batchCount, SINGLE_LIMIT, BATCH_LIMIT } = useGuestTrial();

  const singleRemaining = Math.max(0, SINGLE_LIMIT - count);
  const batchRemaining  = Math.max(0, BATCH_LIMIT  - batchCount);
  const atSingleLimit   = count >= SINGLE_LIMIT;
  const atBatchLimit    = batchCount >= BATCH_LIMIT;
  const atAnyLimit      = atSingleLimit || atBatchLimit;
  const trialFingerprint = `${count}:${batchCount}:${atAnyLimit ? "limit" : "active"}`;
  const [dismissedFingerprint, setDismissedFingerprint] = useState(() => {
    try { return sessionStorage.getItem("datiq.guestTrialBannerDismissed"); } catch { return null; }
  });
  // Do not introduce the trial meter before someone has actually used it.
  // The campaign remains useful to a first-time visitor, so it stays visible
  // on Home even while this status row is absent.
  const panelDismissed = dismissedFingerprint === trialFingerprint;
  const showTrialMessage = (count > 0 || batchCount > 0 || atAnyLimit)
    && !panelDismissed;
  // A home-only offer belongs with the guest decision point, not in the
  // extraction workflow. Keep it data-driven so an expired campaign vanishes.
  const showHomeOffer = pathname === "/" && Boolean(getHeadlineOffer()) && !panelDismissed;

  const dismissTrialPanel = () => {
    setDismissedFingerprint(trialFingerprint);
    try { sessionStorage.setItem("datiq.guestTrialBannerDismissed", trialFingerprint); } catch { /* ignore */ }
  };

  useEffect(() => {
    // A new usage state deserves a fresh, informative trial status even when
    // the previous state was dismissed. In particular, never hide a limit.
    if (dismissedFingerprint && dismissedFingerprint !== trialFingerprint) {
      setDismissedFingerprint(null);
      try { sessionStorage.removeItem("datiq.guestTrialBannerDismissed"); } catch { /* ignore */ }
    }
  }, [dismissedFingerprint, trialFingerprint]);

  useEffect(() => {
    // Status is useful briefly, then should get out of the way. On Home this
    // dismisses the attached offer too, matching the explicit close button.
    // A limit warning gets longer to read but still leaves (owner decision
    // 2026-09-24); it comes back only when the usage state changes.
    if (!showTrialMessage) return undefined;
    const timer = window.setTimeout(dismissTrialPanel, atAnyLimit ? GUEST_LIMIT_AUTO_DISMISS_MS : GUEST_TRIAL_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [atAnyLimit, showTrialMessage, trialFingerprint]);

  if (user) return null;
  if (!showTrialMessage && !showHomeOffer) return null;

  let message;
  if (atSingleLimit && atBatchLimit) {
    message = "All guest limits reached — sign up for a free account to continue.";
  } else if (atSingleLimit) {
    message = `Single-URL extraction limit reached — sign up to continue. (${batchRemaining} batch run${batchRemaining !== 1 ? "s" : ""} remaining)`;
  } else if (atBatchLimit) {
    message = `Batch mode limit reached — sign up to continue. (${singleRemaining} single extraction${singleRemaining !== 1 ? "s" : ""} remaining)`;
  } else {
    message = (
      <>
        Trial mode &mdash; <b>{singleRemaining}</b> extraction{singleRemaining !== 1 ? "s" : ""} · <b>{batchRemaining}</b> batch run{batchRemaining !== 1 ? "s" : ""} remaining.
      </>
    );
  }

  return (
    <div className={"guest-trial-bar" + (atAnyLimit ? " gtb-urgent" : "") + (showHomeOffer ? " gtb-home-offer" : "") + (!showTrialMessage ? " gtb-offer-only" : "")} role={showTrialMessage ? "status" : undefined}>
      {showTrialMessage && <div className="guest-trial-bar-inner">
        <span className="gtb-text">
          <Icon name={atAnyLimit ? "alert-triangle" : "flask"} size={13} />
          {/* The message is wrapped so it is ONE flex item.
              `.gtb-text` is a flex container, and a flex container makes a
              separate item out of every child — including each bare text node
              between the <b> counts. Unwrapped, "Trial mode —", "10",
              "extractions ·", "5" and "batch runs remaining." became five
              independently-wrapping boxes, which on a narrow viewport shattered
              the sentence into a column of fragments with the numbers orphaned
              from the words they count. */}
          <span className="gtb-message">{message}</span>
        </span>
        <button type="button" className="gtb-dismiss" onClick={dismissTrialPanel} aria-label="Dismiss trial and offer">
          <Icon name="x" size={14} />
        </button>
      </div>}
      {showHomeOffer && <OffersBanner variant="trial" />}
    </div>
  );
}
