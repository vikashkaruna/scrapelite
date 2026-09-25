// PostAuthOnboardingRedirect.jsx — decides where a fresh sign-in lands.
//
// Mounted once in the Shell, beside the other Pending*Flush components, and for
// the same reason: OAuth navigates the whole document away and back, so the
// decision cannot live in AuthModal.
//
// TASK FIRST, PERSONA SECOND (see lib/postAuthIntent.js):
//   - Front-door sign-up (Home, pricing, marketing) and the account has no role
//       → /onboarding, carrying ?next= and a use-case ?role= hint.
//   - Mid-task sign-in (Preview, Discover, Batch, an invite…)
//       → back to the task; PersonaNudge offers the role choice on the page.
//   - Already onboarded → back to where they were, nothing else.
//
// It only acts on a FRESH sign-in — an intent stashed by openAuth(), or a page
// load that is an auth callback. A reload with a stored session, or Supabase
// re-emitting SIGNED_IN when a tab regains focus, never redirects anybody.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "./AuthProvider.jsx";
import { usePersona } from "./PersonaProvider.jsx";
import {
  peekPostAuthIntent,
  clearPostAuthIntent,
  classifyPostAuth,
  onboardingUrl,
  isOnboardingExempt,
} from "../lib/postAuthIntent.js";
import { track } from "../lib/analyticsService.js";

export default function PostAuthOnboardingRedirect() {
  const { user, arrivedViaAuthCallback } = useAuth();
  const { onboarded, synced } = usePersona();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const handledFor = useRef(null);

  useEffect(() => {
    if (!user || !synced) return;
    if (handledFor.current === user.id) return;

    const intent = peekPostAuthIntent();
    if (!intent && !arrivedViaAuthCallback) return; // not a fresh sign-in
    handledFor.current = user.id;
    clearPostAuthIntent();

    // An exempt landing (password reset, a payment return, admin) keeps its
    // own flow; the card will offer the role choice later.
    if (isOnboardingExempt(pathname)) return;

    const here = pathname + search;
    const { kind, returnTo, role } = classifyPostAuth(intent?.returnTo || here);

    if (!onboarded && kind === "plain") {
      try { track("onboarding_started", { entry: role ? "use_case" : "sign_up" }); } catch { /* best-effort */ }
      navigate(onboardingUrl({ next: returnTo, role }), { replace: true });
      return;
    }

    // Mid-task, or already onboarded: go back to where they were. The OAuth
    // callback lands on "/", so this is what returns them to their task.
    if (returnTo !== here && pathname === "/" && returnTo !== "/") {
      navigate(returnTo, { replace: true });
    }
  }, [user, synced, onboarded, arrivedViaAuthCallback, pathname, search, navigate]);

  return null;
}
