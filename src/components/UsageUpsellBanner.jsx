// UsageUpsellBanner.jsx — shows an in-app banner when the user hits ≥80% of their plan limit.
//
// FA3 — task-aware paywall + annual anchoring. The banner reads the current
// route (via useLocation) and uses `paywallCopy.buildPaywallCopy` to render a
// specific headline + CTA that names the paid plan that completes the
// current task. Default-anchors on the annual price.
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { buildPaywallCopy } from "../lib/paywallCopy.js";

const DISMISS_KEY = "datiq.upsellDismissedMonth";

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function UsageUpsellBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { usage, subscription, plan } = useBilling();
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
  };

  if (dismissed) return null;

  const limit = plan?.limits?.extractions;
  if (!limit || limit === Infinity) return null;

  const used = usage?.extractions ?? 0;
  const bonus = subscription?.bonusExtractions ?? 0;
  const total = limit + bonus;
  const pct = total > 0 ? Math.floor((used / total) * 100) : 0;

  if (pct < 80) return null;

  const remaining = Math.max(0, total - used);
  const isOver = used >= total;

  // FA3 — derive task-aware copy from the current route + usage.
  const paywall = buildPaywallCopy({
    route: location.pathname,
    usage: { ...usage, extractions: used, batchUrls: usage?.batchUrls },
    currentPlan: plan,
    currency: subscription?.currency || "USD",
  });

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
    <div className={"usage-upsell-banner-wrap" + (isOver ? " usage-upsell-over" : "")}>
      <div className="usage-upsell-banner">
        <div className="uub-icon">
          <Icon name={isOver ? "alert-circle" : "zap"} size={16} />
        </div>
        <div className="uub-content">
          <span className="uub-title">{paywall.title}</span>
          <span className="uub-desc">
            {isOver && !paywall.body
              ? "You've used all your extractions this month."
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
                <span className="uub-remaining">{remaining} left on {plan.name} this month</span>
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
