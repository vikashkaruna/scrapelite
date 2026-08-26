// PendingAuditFlush.jsx — resumes an audit request the visitor made before
// being asked to sign in.
//
// Mounted once, globally, in the Shell — same placement as
// PendingReferralFlush / PendingWorkspaceInviteFlush and for the same
// reason: OAuth sign-in navigates the whole document away and comes back on
// whatever route the callback lands on (the app's origin, not necessarily
// /discoverability), so this cannot live inside Discoverability.jsx itself.
//
// Unlike the referral/invite flushes, this one does not perform the action
// itself — running an audit needs Discoverability.jsx's own running/error
// state machinery (the AuditError panel, the retry-on-lastRequest wiring),
// and duplicating that here would be a second implementation to keep in
// sync. This component's only job is to get the stashed request back to
// that page, via router state, once a session exists.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "./AuthProvider.jsx";
import { getPendingAudit, clearPendingAudit } from "../lib/pendingAudit.js";

export default function PendingAuditFlush() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Guards a double-fire if the effect re-runs while already navigating
  // (StrictMode double-invokes effects in dev).
  const flushedRef = useRef(false);

  useEffect(() => {
    // Deliberately NOT gated on a signed-out -> signed-in transition — same
    // reasoning as the other Pending*Flush components: an OAuth callback
    // can land with the session already restored, so the first render may
    // show a user and never see the transition. The stash is the trigger.
    if (!user || flushedRef.current) return;
    const payload = getPendingAudit();
    if (!payload) return;

    flushedRef.current = true;
    clearPendingAudit();
    // `replace: true` so the resume doesn't leave a junk history entry the
    // user would have to back-button past, and so a page refresh right
    // after landing doesn't re-deliver the same state.
    navigate("/discoverability", { state: { resumeAudit: payload }, replace: true });
  }, [user, navigate]);

  return null;
}
