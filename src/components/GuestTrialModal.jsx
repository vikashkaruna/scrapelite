// GuestTrialModal.jsx — shown when a non-logged-in user hits the trial extraction limit.
// Soft gate: user can dismiss and continue with limited use; they'll see it again
// every RE_PROMPT_INTERVAL extractions after the limit.
import { useEffect } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function GuestTrialModal() {
  const { user, openAuth } = useAuth();
  const { showPrompt, setShowPrompt, TRIAL_LIMIT } = useGuestTrial();

  // Close on Escape key
  useEffect(() => {
    if (!showPrompt) return;
    const handler = (e) => { if (e.key === "Escape") setShowPrompt(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showPrompt, setShowPrompt]);

  if (!showPrompt || user) return null;

  return (
    <div className="guest-trial-overlay" role="dialog" aria-modal="true" aria-label="Sign up to continue">
      <div className="guest-trial-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gtm-icon-wrap">
          <Icon name="sparkles" size={28} />
        </div>
        <h2 className="gtm-headline">
          You've used your {TRIAL_LIMIT} free extractions
        </h2>
        <p className="gtm-body">
          Create a free account to keep going. The free plan includes&nbsp;
          <b>10 extractions per month</b>, full access to AI summaries, exports, and more.
        </p>
        <ul className="gtm-benefits">
          <li><Icon name="check" size={14} /> 10 free extractions every month</li>
          <li><Icon name="check" size={14} /> AI summaries + link intelligence</li>
          <li><Icon name="check" size={14} /> CSV export &amp; saved dashboard</li>
          <li><Icon name="check" size={14} /> Contacts, pricing &amp; custom extraction</li>
        </ul>
        <div className="gtm-actions">
          <Button variant="primary" icon="user-plus" onClick={() => { openAuth("signup"); setShowPrompt(false); }}>
            Create free account
          </Button>
          <Button variant="ghost" icon="log-in" onClick={() => { openAuth("signin"); setShowPrompt(false); }}>
            Sign in
          </Button>
        </div>
        <button className="gtm-dismiss" onClick={() => setShowPrompt(false)}>
          Continue as guest (limited)
        </button>
      </div>
      {/* Backdrop click dismisses */}
      <div className="guest-trial-backdrop" aria-hidden="true" onClick={() => setShowPrompt(false)} />
    </div>
  );
}
