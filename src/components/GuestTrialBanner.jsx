// GuestTrialBanner.jsx — slim info bar shown to non-logged-in users.
// Shows remaining extraction headroom against the hard limits, nudges sign-up.
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import { useLocation } from "react-router";
import Icon from "./Icon.jsx";
import OffersBanner from "./OffersBanner.jsx";
import { getHeadlineOffer } from "../lib/offersService.js";

export default function GuestTrialBanner() {
  const { user, openAuth } = useAuth();
  const { pathname } = useLocation();
  const { count, batchCount, SINGLE_LIMIT, BATCH_LIMIT } = useGuestTrial();

  if (user) return null;

  const singleRemaining = Math.max(0, SINGLE_LIMIT - count);
  const batchRemaining  = Math.max(0, BATCH_LIMIT  - batchCount);
  const atSingleLimit   = count >= SINGLE_LIMIT;
  const atBatchLimit    = batchCount >= BATCH_LIMIT;
  const atAnyLimit      = atSingleLimit || atBatchLimit;
  // A home-only offer belongs with the guest decision point, not in the
  // extraction workflow. Keep it data-driven so an expired campaign vanishes.
  const showHomeOffer = pathname === "/" && Boolean(getHeadlineOffer());

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
    <div className={"guest-trial-bar" + (atAnyLimit ? " gtb-urgent" : "") + (showHomeOffer ? " gtb-home-offer" : "")} role="status">
      <div className="guest-trial-bar-inner">
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
        <button className="gtb-cta" onClick={() => openAuth("signup")}>
          {atAnyLimit ? "Create free account" : "Sign up free"} →
        </button>
      </div>
      {showHomeOffer && <OffersBanner variant="trial" />}
    </div>
  );
}
