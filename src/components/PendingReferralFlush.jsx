// PendingReferralFlush.jsx — redeems an invite code the visitor arrived with,
// once they have an account.
//
// Mounted once, globally, in the Shell. Renders nothing; it exists purely to
// watch for a session. It lives here rather than in ReferralBanner because
// OAuth sign-up navigates the whole document away and comes back on whatever
// route the callback lands on, and because the banner only renders near the
// quota ceiling — a brand-new invitee is nowhere near it.
//
// Redemption is signed-in only (see lib/referralService.js): a referral grants
// real, paid quota, and an anonymous identity can be cleared and re-made
// without limit. So App.jsx stashes ?ref=CODE and this component spends it.
import { useEffect, useRef } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import {
  getPendingReferral,
  clearPendingReferral,
  redeemReferralCode,
} from "../lib/referralService.js";

export default function PendingReferralFlush() {
  const { user } = useAuth();
  const showToast = useToast();
  const billing = useBilling();
  // Guards a double-redeem if the effect re-runs while the request is still in
  // flight (StrictMode double-invokes effects in dev).
  const flushingRef = useRef(false);

  useEffect(() => {
    // Deliberately NOT gated on a signed-out → signed-in transition: an OAuth
    // callback can land with the session already restored, so the first render
    // may show a user and never see the transition. The stash is the trigger.
    if (!user || flushingRef.current) return;
    const code = getPendingReferral();
    if (!code) return;

    flushingRef.current = true;
    redeemReferralCode(code).then((result) => {
      if (result.ok) {
        clearPendingReferral();
        // Mirror the server's grant into the local subscription so the
        // client-side quota gate honours it on THIS page load. The server is
        // authoritative — entitlements.bonus_extractions is what survives a
        // reload — but without this the user would have to refresh before the
        // extractions they were just told about became usable.
        billing?.applyBonus?.(result.bonus);
        showToast(`Welcome bonus: ${result.bonus} credits added to your account.`, "gift");
        return;
      }
      // "unavailable" is the only retryable verdict — the store could not
      // answer, so keep the code for the next page load rather than burning
      // it. Everything else is settled: invalid, self, or already redeemed.
      if (result.reason === "unavailable") {
        flushingRef.current = false;
        return;
      }
      clearPendingReferral();
      // A refusal here is not the user's doing — they clicked a link. Only
      // "already" is worth saying out loud, so they understand why no bonus
      // appeared; an invalid or self code is silent.
      if (result.reason === "already") {
        showToast("You've already used an invite code on this account.", "info");
      }
    });
  }, [user, billing, showToast]);

  return null;
}
