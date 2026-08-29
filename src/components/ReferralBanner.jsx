// src/components/ReferralBanner.jsx — FA2 (referral loop "give 25 / get 25" banner).
//
// Appears in the same slot as UsageUpsellBanner / GuestTrialBanner. Two
// surfaces:
//
//  1. Quota-exhaustion trigger — when the user is at 100% of their plan
//     limit, we show "Invite a friend, get 25 more extractions" with a
//     copy-able invite URL (or share button on mobile).
//  2. Just-shared surface — when a successful referral redemption happens
//     (the `?ref=CODE` URL handler in App.jsx flips `?ref_redeemed=1`),
//     we show a one-time "Welcome bonus: 25 extractions added" toast.
//
// The "invite code → bonus counter" wiring lives in src/lib/referralService.js.
// This component is pure presentation + a "Copy" button.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import Icon from "./Icon.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { buildReferralUrl, fetchReferralStatus, REFERRAL_BONUS } from "../lib/referralService.js";

const DISMISS_KEY = "datiq.referralDismissedMonth";

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReferralBanner() {
  const showToast = useToast();
  const { usage, plan, subscription } = useBilling();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { user } = useAuth();
  // The code is issued by the server, per account. It is deliberately NOT
  // derived client-side any more: the old derivation collided to "AAAAAAAA"
  // for every user, so no referral could ever be attributed. Until the fetch
  // returns, `status.code` is null and this banner renders nothing rather than
  // showing a placeholder that isn't a real code.
  const [status, setStatus] = useState({ code: null, referrals: 0, bonus: 0, degraded: false });

  useEffect(() => {
    if (!user) { setStatus({ code: null, referrals: 0, bonus: 0, degraded: false }); return; }
    let alive = true;
    fetchReferralStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [user]);

  const myCode = status.code;
  const myUrl = useMemo(() => (myCode ? buildReferralUrl(myCode) : ""), [myCode]);

  useEffect(() => {
    try {
      const val = localStorage.getItem(DISMISS_KEY);
      setDismissed(val === getCurrentMonth());
    } catch { /* skip */ }
  }, []);

  // One-shot toast on a successful redemption.
  useEffect(() => {
    if (searchParams.get("ref_redeemed") === "1") {
      showToast("Welcome bonus: 25 extractions added to your account.", "gift");
      const next = new URLSearchParams(searchParams);
      next.delete("ref_redeemed");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger: only when the user is at (or near) the plan limit.
  const limit = plan?.limits?.extractions;
  const used = usage?.extractions ?? 0;
  if (!limit || limit === Infinity) return null;
  const total = limit + (subscription?.bonusExtractions ?? 0);
  const pct = total > 0 ? Math.floor((used / total) * 100) : 0;
  const isOver = used >= total;
  if (pct < 90 && !isOver) return null;
  if (dismissed) return null;
  // No real code → no banner. Signed-out visitors and a store that cannot
  // answer both land here. Showing an invite link that nobody can be credited
  // for is worse than showing nothing.
  if (!myCode) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(myUrl);
      setCopied(true);
      showToast("Invite link copied — share it to get 25 extractions.", "clipboard-copy");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast("Copy failed. Select and copy manually.", "alert-triangle");
    }
  };

  const handleShare = async () => {
    if (typeof navigator === "undefined" || !navigator.share) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: "Try DatIQ — get 25 extractions",
        text: `Use my invite code ${myCode} to get 25 extra extractions on DatIQ.`,
        url: myUrl,
      });
    } catch { /* user cancelled */ }
  };

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, getCurrentMonth()); } catch {}
  };

  return (
    <div className="usage-upsell-banner-wrap referral-banner-wrap">
      <div className="usage-upsell-banner referral-banner">
        <div className="uub-icon">
          <Icon name="gift" size={16} />
        </div>
        <div className="uub-content">
          <span className="uub-title">Out of extractions? Invite a friend, get 25 more.</span>
          <span className="uub-desc">
            You and your friend both get {REFERRAL_BONUS} extra extractions when they sign up with your link.
            {status.referrals > 0 && (
              <>{" "}
                <strong>{status.referrals}</strong>
                {status.referrals === 1 ? " friend has" : " friends have"} joined so far.
              </>
            )}
            <span className="referral-code-row">
              <span className="referral-code-pill">
                <Icon name="ticket" size={11} />
                {myCode}
              </span>
              <span className="referral-code-hint">or share the link →</span>
            </span>
          </span>
        </div>
        <button className="uub-upgrade-btn" onClick={handleCopy} title="Copy invite link">
          {copied ? "Copied" : "Copy link"}
        </button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button className="referral-share-btn" onClick={handleShare} title="Share via…">
            <Icon name="share-2" size={14} />
          </button>
        )}
        <button className="uub-dismiss" onClick={dismiss} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
