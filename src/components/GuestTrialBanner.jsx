// GuestTrialBanner.jsx — slim info bar shown to non-logged-in users.
// Communicates trial mode status and nudges toward sign-up.
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import Icon from "./Icon.jsx";

export default function GuestTrialBanner() {
  const { user, openAuth } = useAuth();
  const { count, TRIAL_LIMIT } = useGuestTrial();

  if (user) return null;

  const remaining = Math.max(0, TRIAL_LIMIT - count);
  const atLimit = count >= TRIAL_LIMIT;

  return (
    <div className={"guest-trial-bar" + (atLimit ? " gtb-urgent" : "")} role="status">
      <div className="guest-trial-bar-inner">
        <span className="gtb-text">
          <Icon name={atLimit ? "alert-triangle" : "flask"} size={13} />
          {atLimit
            ? "You've reached your free trial limit — sign up to keep extracting."
            : <>Trial mode &mdash; <b>{remaining}</b> free extraction{remaining !== 1 ? "s" : ""} remaining.</>}
        </span>
        <button
          className="gtb-cta"
          onClick={() => openAuth(atLimit ? "signup" : "signup")}
        >
          {atLimit ? "Create free account" : "Sign up free"} →
        </button>
        <button
          className="gtb-signin"
          onClick={() => openAuth("signin")}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
