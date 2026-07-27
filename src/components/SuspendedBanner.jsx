// SuspendedBanner.jsx — persistent notice for a lapsed subscription.
//
// Deliberately NOT dismissible, unlike UsageUpsellBanner. A usage warning is
// advisory; this one explains why the product has stopped doing things and, in
// the deactivated phase, that data will be deleted on a date. Letting someone
// dismiss that and then losing their work would be indefensible.
//
// It is also deliberately calm. The user has not done anything wrong — a
// payment lapsed — and the two facts that matter most to them are "your data is
// safe" and "you can still export it".
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";

function fmt(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function SuspendedBanner() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { lifecycle, isSuspended, plan } = useBilling();

  // Guests and healthy accounts see nothing. A free account is never
  // lifecycle-managed, so this can only appear for someone who has paid before.
  if (!user || !isSuspended) return null;

  const purged = lifecycle.status === "purged";
  const deactivated = lifecycle.status === "deactivated";
  const days = lifecycle.daysUntilPurge;
  // Escalate the styling only in the last week, so urgency still means something.
  const urgent = purged || (Number.isFinite(days) && days <= 7);

  const title = purged
    ? "Your saved data has been removed"
    : deactivated
      ? "Your account is deactivated"
      : `Your ${plan?.name || ""} subscription has ended`.replace(/\s+/g, " ").trim();

  const detail = purged
    ? "Choose a plan to start again. Your invoices are still available in Account."
    : `Extractions, batches and scheduled monitors are paused. You can still open and export everything you have saved${
        lifecycle.purgeAt ? ` — your data is kept until ${fmt(lifecycle.purgeAt)}` : ""
      }.`;

  return (
    <div className={`suspended-banner-wrap${urgent ? " suspended-urgent" : ""}`} role="status">
      <div className="suspended-banner">
        <div className="sb-icon">
          <Icon name={urgent ? "alert-triangle" : "pause"} size={16} />
        </div>
        <div className="sb-content">
          <span className="sb-title">{title}</span>
          <span className="sb-desc">
            {detail}
            {!purged && Number.isFinite(days) && days <= 7 && days >= 0 && (
              <span className="sb-countdown">
                {days === 0 ? " Deleted today." : ` ${days} day${days === 1 ? "" : "s"} left.`}
              </span>
            )}
          </span>
        </div>
        <button className="sb-cta" onClick={() => navigate("/pricing")}>
          {purged ? "Choose a plan" : "Reactivate"}
        </button>
      </div>
    </div>
  );
}
