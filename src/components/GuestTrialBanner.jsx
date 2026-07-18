// GuestTrialBanner.jsx — slim info bar shown to non-logged-in users.
// Shows remaining extraction headroom against the hard limits, nudges sign-up.
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import Icon from "./Icon.jsx";

export default function GuestTrialBanner() {
  const { user, openAuth } = useAuth();
  const { count, batchCount, SINGLE_LIMIT, BATCH_LIMIT } = useGuestTrial();

  if (user) return null;

  const singleRemaining = Math.max(0, SINGLE_LIMIT - count);
  const batchRemaining  = Math.max(0, BATCH_LIMIT  - batchCount);
  const atSingleLimit   = count >= SINGLE_LIMIT;
  const atBatchLimit    = batchCount >= BATCH_LIMIT;
  const atAnyLimit      = atSingleLimit || atBatchLimit;

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
    <div className={"guest-trial-bar" + (atAnyLimit ? " gtb-urgent" : "")} role="status">
      <div className="guest-trial-bar-inner">
        <span className="gtb-text">
          <Icon name={atAnyLimit ? "alert-triangle" : "flask"} size={13} />
          {message}
        </span>
        <button className="gtb-cta" onClick={() => openAuth("signup")}>
          {atAnyLimit ? "Create free account" : "Sign up free"} →
        </button>
      </div>
    </div>
  );
}
