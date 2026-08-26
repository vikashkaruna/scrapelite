// PendingWorkspaceInviteFlush.jsx — accepts an invite the visitor arrived
// with, once they have an account whose email matches the invite.
//
// Mounted once, globally, in the Shell — same placement as
// PendingReferralFlush and for the same reason: OAuth sign-up navigates the
// whole document away and comes back on whatever route the callback lands
// on, so this cannot live inside the workspace page itself.
//
// Acceptance is signed-in only (see workspacesService.js / 0031's own
// comment): a workspace seat is real and billable, and the server checks the
// accepting account's OWN verified email against the invite — so a stashed
// token is useless to anyone but the person it was actually sent to.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "./AuthProvider.jsx";
import { useToast } from "./Toast.jsx";
import {
  getPendingWorkspaceInvite,
  clearPendingWorkspaceInvite,
} from "../lib/pendingWorkspaceInvite.js";
import { acceptWorkspaceInvite } from "../lib/workspacesService.js";

const REASON_COPY = {
  revoked: "That invite has been revoked.",
  expired: "That invite has expired — ask for a new one.",
  already_accepted: "That invite has already been used.",
  email_mismatch: "That invite was sent to a different email address than the one you signed in with.",
};

export default function PendingWorkspaceInviteFlush() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  // Guards a double-accept if the effect re-runs while the request is still
  // in flight (StrictMode double-invokes effects in dev).
  const flushingRef = useRef(false);

  useEffect(() => {
    // Deliberately NOT gated on a signed-out -> signed-in transition — same
    // reasoning as PendingReferralFlush: an OAuth callback can land with the
    // session already restored.
    if (!user || flushingRef.current) return;
    const token = getPendingWorkspaceInvite();
    if (!token) return;

    flushingRef.current = true;
    acceptWorkspaceInvite(token).then((result) => {
      if (result.ok) {
        clearPendingWorkspaceInvite();
        showToast("You've joined the workspace.", "check");
        navigate(`/workspace?tab=team&workspace=${encodeURIComponent(result.workspaceId || "")}`);
        return;
      }
      // "unavailable" is the only retryable verdict — keep the token for the
      // next page load rather than burning it on an infrastructure blip.
      if (!result.reason || result.reason === "unavailable") {
        flushingRef.current = false;
        return;
      }
      clearPendingWorkspaceInvite();
      showToast(REASON_COPY[result.reason] || "Couldn't accept that invite.", "alert-circle");
    });
  }, [user, navigate, showToast]);

  return null;
}
