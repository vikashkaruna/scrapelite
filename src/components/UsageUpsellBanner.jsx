// UsageUpsellBanner.jsx — shows an in-app banner when the user hits ≥80% of their plan limit.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useBilling } from "./BillingProvider.jsx";

const DISMISS_KEY = "datiq.upsellDismissedMonth";

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function UsageUpsellBanner() {
  const navigate = useNavigate();
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

  return (
    <div className={"usage-upsell-banner" + (isOver ? " usage-upsell-over" : "")}>
      <div className="uub-icon">
        <Icon name={isOver ? "alert-circle" : "zap"} size={16} />
      </div>
      <div className="uub-content">
        <span className="uub-title">
          {isOver
            ? "Extraction limit reached"
            : `${pct}% of your monthly extractions used`}
        </span>
        <span className="uub-desc">
          {isOver
            ? "You've used all your extractions this month."
            : `${remaining} extraction${remaining === 1 ? "" : "s"} remaining on ${plan.name} plan.`}
          {" "}Upgrade for more.
        </span>
      </div>
      <button
        className="uub-upgrade-btn"
        onClick={() => navigate("/pricing")}
      >
        Upgrade now
      </button>
      <button className="uub-dismiss" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
