// PersonaNudge.jsx — the "Personalise DatIQ" card.
//
// Shown to a signed-in account that has not picked a role, on whatever page it
// is on: someone who signed in mid-task, or an existing account that never
// onboarded. It never blocks — "Not now" hides it for the session, and after
// two dismissals it is gone for good (Switch persona in the account menu
// remains). The button opens /onboarding with ?next= set to this page, so
// choosing a role brings the user straight back here.
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { usePersona } from "./PersonaProvider.jsx";
import {
  isOnboardingExempt,
  isNudgeDismissed,
  dismissNudge,
  onboardingUrl,
} from "../lib/postAuthIntent.js";
import { track } from "../lib/analyticsService.js";

export default function PersonaNudge() {
  const { user } = useAuth();
  const { onboarded, synced } = usePersona();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(isNudgeDismissed);

  if (!user || !synced || onboarded || hidden || isOnboardingExempt(pathname)) return null;

  const open = () => {
    try { track("onboarding_started", { entry: "nudge" }); } catch { /* best-effort */ }
    navigate(onboardingUrl({ next: pathname + search }));
  };
  const notNow = () => {
    dismissNudge();
    setHidden(true);
    try { track("onboarding_nudge_dismissed", {}); } catch { /* best-effort */ }
  };

  return (
    <div className="persona-nudge-wrap">
      <aside className="persona-nudge" role="region" aria-label="Personalise DatIQ">
        <span className="persona-nudge-icon" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
        <p className="persona-nudge-text">
          <b>Personalise DatIQ.</b> Pick your role and we'll tailor your home screen, templates and first steps — you'll come straight back here.
        </p>
        <div className="persona-nudge-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={open}>Tailor DatIQ to your role</button>
          <button type="button" className="ob-skip-link" onClick={notNow}>Not now</button>
        </div>
      </aside>
    </div>
  );
}
