// UsageUpsellBanner.jsx — shows an in-app banner when the credit pool runs low.
//
// 🔴 IT TRIGGERS ON CREDITS NOW, NOT ON THE RETIRED EXTRACTION QUOTA. It used
// to read `plan.limits.extractions` — 10 on Free — so it appeared at the 8th
// extraction of a month in which the account still held 92 of its 100 credits,
// and it kept appearing after a credit pack refilled the pool, because the
// number it watched never moved. `creditPressure` is the one place the "are
// they low?" rule lives; see src/lib/credits/creditPressure.js.
//
// ⚠️ NOTHING RENDERS WHEN THE BALANCE IS UNKNOWN. A guest, an account never
// granted credits, or an unreadable read all yield `known: false`, and an
// upsell that fires on "we could not read your balance" is an upsell shown to
// a customer who is not actually short of anything.
//
// FA3 — task-aware paywall + annual anchoring. The banner reads the current
// route (via useLocation) and uses `paywallCopy.buildPaywallCopy` to render a
// specific headline + CTA that names the paid plan that completes the
// current task. Default-anchors on the annual price.
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { buildPaywallCopy } from "../lib/paywallCopy.js";
import { readPublicCount } from "../lib/publicQuota.js";
import { creditPressure } from "../lib/credits/creditPressure.js";
import { useAutoDismissBanner, announceBannerChange } from "../hooks/useAutoDismissBanner.js";

export const DISMISS_KEY = "datiq.upsellDismissedMonth";

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function UsageUpsellBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { usage, subscription, plan, credits } = useBilling();
  const [dismissed, setDismissed] = useState(false);

  // Re-show the banner each month
  useEffect(() => {
    try {
      const val = localStorage.getItem(DISMISS_KEY);
      if (val === getCurrentMonth()) setDismissed(true);
      else setDismissed(false);
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, getCurrentMonth()); } catch {}
    announceBannerChange();
  };

  const pressure = creditPressure({ credits, allowance: plan?.limits?.credits });
  const visible = !dismissed && pressure.known && pressure.low;
  const remaining = pressure.available;
  const isOver = pressure.empty;

  // FA3 — derive task-aware copy from the current route + usage.
  // ⚠️ `extractions` is passed only so `buildPaywallCopy`'s own "are they over?"
  // branch resolves; the decision to show this banner at all is made from the
  // credit pool (`visible`). Passing the plan's own (unenforced) extraction
  // limit when the pool is empty keeps that branch agreeing with the pool
  // rather than contradicting it.
  const paywall = buildPaywallCopy({
    route: location.pathname,
    usage: {
      ...usage,
      extractions: isOver ? (plan?.limits?.extractions ?? 0) : (usage?.extractions ?? 0),
      batchUrls: usage?.batchUrls,
    },
    currentPlan: plan,
    currency: subscription?.currency || "USD",
  });

  // Leaves on its own after the reader has had time to read it (like the GA4
  // bar). Hooks must run before any early return, hence `visible` above.
  const textLength = (paywall.title?.length || 0) + (paywall.body?.length || 0) + (paywall.ctaLabel?.length || 0);
  const { phase, hoverProps } = useAutoDismissBanner("usage-upsell", { active: visible, textLength });

  if (!visible || phase === "gone") return null;

  const handleCta = () => {
    try {
      // Pre-select the recommended plan on /pricing via a hash so the plan
      // card highlights the moment it renders.
      if (paywall.recommendedPlanId) {
        navigate(`/pricing?plan=${encodeURIComponent(paywall.recommendedPlanId)}&period=annual`);
      } else {
        navigate("/pricing");
      }
    } catch {
      navigate("/pricing");
    }
  };

  return (
    <div
      className={"usage-upsell-banner-wrap" + (isOver ? " usage-upsell-over" : "") + (phase === "leaving" ? " uub-leaving" : "")}
      {...hoverProps}
    >
      <div className="usage-upsell-banner" role="status">
        <div className="uub-icon">
          <Icon name={isOver ? "alert-circle" : "zap"} size={16} />
        </div>
        <div className="uub-content uub-flow">
          <span className="uub-title">{paywall.title}</span>
          <span className="uub-desc">
            {isOver && !paywall.body
              ? "You've used all your credits."
              : paywall.body}
            {paywall.savingsLabel && (
              <>
                {" "}
                <span className="uub-savings">{paywall.savingsLabel}</span>
              </>
            )}
            {!isOver && (
              <>
                {" "}
                <span className="uub-remaining">{remaining} credit{remaining === 1 ? "" : "s"} left on {plan.name}</span>
              </>
            )}
            {/* FA1 — show the public-quota mechanic if the user has
                published any extractions this month. Free plan only. */}
            {plan.id === "free" && readPublicCount() > 0 && (
              <>
                {" "}
                <span className="uub-public">
                  · {readPublicCount()} public report{readPublicCount() === 1 ? "" : "s"} (unlimited)
                </span>
              </>
            )}
          </span>
        </div>
        <button
          className="uub-upgrade-btn"
          onClick={handleCta}
          title="See plans"
        >
          {paywall.ctaLabel}
        </button>
        <button className="uub-dismiss" onClick={dismiss} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
