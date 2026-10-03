// src/components/ReferralBanner.jsx — FA2 (referral loop "give 25 / get 25" banner).
//
// The reward is a CREDIT GRANT (0079), not a bonus-extraction counter. Both
// sides are granted REFERRAL_BONUS credits with no expiry, and credits are the
// one pool every feature spends from — see CREDITS-UNIFICATION-PROPOSAL.md §4.6.
//
// Appears in the same slot as UsageUpsellBanner / GuestTrialBanner. Two
// surfaces:
//
//  1. Low-pool trigger — when the CREDIT POOL is nearly spent we show
//     "Invite a friend, get 25 more credits" with a copy-able invite URL (or
//     share button on mobile). It used to trigger off `plan.limits.extractions`,
//     a quota nothing enforces any more, so it fired on a free account holding
//     90 unspent credits and never fired for anyone who topped up.
//  2. Just-shared surface — when a successful referral redemption happens
//     (the `?ref=CODE` URL handler in App.jsx flips `?ref_redeemed=1`),
//     we show a one-time "Welcome bonus: 25 credits added" toast.
//
// The "invite code → credit grant" wiring lives in src/lib/referralService.js.
// This component is pure presentation + a "Copy" button.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import Icon from "./Icon.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { buildReferralUrl, fetchReferralStatus, REFERRAL_BONUS } from "../lib/referralService.js";
import { creditPressure } from "../lib/credits/creditPressure.js";
import { useAutoDismissBanner, bannerAutoHidden, announceBannerChange, BANNER_CHANGE_EVENT } from "../hooks/useAutoDismissBanner.js";

const DISMISS_KEY = "datiq.referralDismissedMonth";

/** Show the invite once the pool is down to a tenth of a month's allowance. */
const REFERRAL_TRIGGER_PCT = 0.1;

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReferralBanner() {
  const showToast = useToast();
  const { plan, credits } = useBilling();
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
      showToast(`Welcome bonus: ${REFERRAL_BONUS} credits added to your account.`, "gift");
      const next = new URLSearchParams(searchParams);
      next.delete("ref_redeemed");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger: only when the credit pool is nearly spent. An unknown balance
  // renders nothing — see creditPressure.js. `REFERRAL_TRIGGER_PCT` is tighter
  // than the upsell banner's own band so the two do not both appear at once;
  // the upsell is the first nudge, this is the second.
  const pressure = creditPressure({ credits, allowance: plan?.limits?.credits });
  const lowEnough = pressure.known
    && (pressure.empty || (pressure.remainingPct !== null && pressure.remainingPct <= REFERRAL_TRIGGER_PCT));
  // No real code → no banner. Signed-out visitors and a store that cannot
  // answer both land here. Showing an invite link that nobody can be credited
  // for is worse than showing nothing.
  // One advisory at a time: while the usage-limit banner is up (it is the more
  // urgent of the two) this one waits, then takes its slot when that leaves.
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(BANNER_CHANGE_EVENT, on);
    return () => window.removeEventListener(BANNER_CHANGE_EVENT, on);
  }, []);
  let upsellUp = false;
  try {
    upsellUp = pressure.known && pressure.low
      && localStorage.getItem("datiq.upsellDismissedMonth") !== getCurrentMonth()
      && !bannerAutoHidden("usage-upsell");
  } catch { /* storage blocked: assume not showing */ }
  const visible = lowEnough && !dismissed && !!myCode && !upsellUp;

  // Leaves on its own once read, like the GA4 bar — see useAutoDismissBanner.
  // (Hooks run before the early return, hence `visible` above.)
  const { phase, hoverProps } = useAutoDismissBanner("referral", { active: visible, textLength: 150 });
  if (!visible || phase === "gone") return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(myUrl);
      setCopied(true);
      showToast(`Invite link copied — share it to get ${REFERRAL_BONUS} credits.`, "clipboard-copy");
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
        title: `Try DatIQ — get ${REFERRAL_BONUS} credits`,
        text: `Use my invite code ${myCode} to get ${REFERRAL_BONUS} extra credits on DatIQ.`,
        url: myUrl,
      });
    } catch { /* user cancelled */ }
  };

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, getCurrentMonth()); } catch {}
    announceBannerChange();
  };

  return (
    <div
      className={"usage-upsell-banner-wrap referral-banner-wrap" + (phase === "leaving" ? " uub-leaving" : "")}
      {...hoverProps}
    >
      <div className="usage-upsell-banner referral-banner" role="status">
        <div className="uub-icon">
          <Icon name="gift" size={16} />
        </div>
        <div className="uub-content uub-flow">
          <span className="uub-title">
            {pressure.empty ? "Out of credits?" : "Running low?"} Invite a friend, get {REFERRAL_BONUS} more.
          </span>
          <span className="uub-desc">
            You and your friend both get {REFERRAL_BONUS} extra credits when they sign up with your link.
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
