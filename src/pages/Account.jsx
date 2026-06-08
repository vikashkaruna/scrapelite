// Account.jsx — V5 usage dashboard + subscription management.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLAN_BY_ID, PLANS } from "../lib/pricingConfig.js";
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import { useBilling } from "../components/BillingProvider.jsx";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

function UsageMeter({ label, used, limit, icon }) {
  const isUnlimited = limit === Infinity || limit === null;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const danger = pct >= 90;
  const warn   = pct >= 70 && !danger;
  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <div className="usage-meter-label">
          <Icon name={icon} size={15} />
          <span>{label}</span>
        </div>
        <div className={"usage-meter-count" + (danger ? " danger" : warn ? " warn" : "")}>
          {isUnlimited ? (
            <span className="usage-unlimited">Unlimited</span>
          ) : (
            <>{used.toLocaleString()} <span>/ {limit.toLocaleString()}</span></>
          )}
        </div>
      </div>
      {!isUnlimited && (
        <div className="usage-bar-track">
          <div
            className={"usage-bar-fill" + (danger ? " danger" : warn ? " warn" : "")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanFeaturePill({ feature }) {
  return (
    <div className={"plan-feat-pill" + (feature.included ? "" : " excluded")}>
      <Icon name={feature.included ? "check" : "x"} size={13} />
      <span>{feature.label}</span>
    </div>
  );
}

export default function Account() {
  const navigate = useNavigate();
  const {
    plan, planId, usage, bonus, currency, rates,
    applyCoupon, couponError, couponSuccess,
    subscription,
  } = useBilling();

  const [couponInput, setCouponInput] = useState("");
  const [applying, setApplying] = useState(false);

  const totalExtractionLimit = plan.limits.extractions === Infinity
    ? Infinity
    : plan.limits.extractions + (bonus || 0);
  const enrichmentEntries = Object.entries(usage?.enrichments ?? {});
  const totalEnrichments = enrichmentEntries.reduce((s, [, v]) => s + v, 0);

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    setApplying(true);
    await new Promise((r) => setTimeout(r, 600));
    applyCoupon(couponInput.trim().toUpperCase());
    setApplying(false);
  };

  const nextTier = PLANS.find((p) => p.price_usd > plan.price_usd);

  return (
    <div className="page account-page">
      <div className="container">
        <div className="account-header">
          <div>
            <div className="eyebrow"><Icon name="user" />Account</div>
            <h1 className="account-title">Your usage & plan</h1>
          </div>
          <Button variant="secondary" size="sm" icon="zap" onClick={() => navigate("/pricing")}>
            View all plans
          </Button>
        </div>

        <div className="account-grid">
          {/* Left: usage */}
          <div className="account-main">
            {/* Plan card */}
            <div className="card card-pad account-plan-card">
              <div className="apc-top">
                <div>
                  <div className="apc-label">Current plan</div>
                  <div className="apc-plan-name">
                    {plan.name}
                    {planId === "free" && <span className="apc-free-badge">Free</span>}
                  </div>
                  {subscription.activatedAt && (
                    <div className="apc-since">
                      Active since {new Date(subscription.activatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  )}
                </div>
                {plan.price_usd > 0 ? (
                  <div className="apc-price">
                    <span className="appc-amount">
                      {formatPrice(convertPrice(plan.price_usd, rates, currency), currency)}
                    </span>
                    <span className="appc-period">/ mo</span>
                  </div>
                ) : null}
              </div>
              {nextTier && (
                <div className="apc-upgrade-hint">
                  <Icon name="trending-up" size={14} />
                  <span>
                    Upgrade to <strong>{nextTier.name}</strong> for{" "}
                    {nextTier.limits.extractions === Infinity
                      ? "unlimited extractions"
                      : `${nextTier.limits.extractions.toLocaleString()} extractions`}
                  </span>
                  <Button variant="primary" size="sm" onClick={() => navigate("/pricing")}>Upgrade</Button>
                </div>
              )}
            </div>

            {/* Usage meters */}
            <div className="card card-pad">
              <div className="card-section-title">
                <Icon name="bar-chart" size={16} />
                Usage this month ({usage?.month ?? "—"})
              </div>
              <div className="usage-meters">
                <UsageMeter
                  label="Extractions"
                  icon="zap"
                  used={usage?.extractions ?? 0}
                  limit={totalExtractionLimit}
                />
                <UsageMeter
                  label="Enrichments (total)"
                  icon="sparkles"
                  used={totalEnrichments}
                  limit={plan.limits.enrichments_per_extraction === Infinity ? Infinity : null}
                />
              </div>
              {bonus > 0 && (
                <div className="usage-bonus-note">
                  <Icon name="zap" size={13} />
                  <span>+{bonus} bonus extractions from top-up / coupon applied to your account.</span>
                </div>
              )}
            </div>

            {/* Plan features */}
            <div className="card card-pad">
              <div className="card-section-title">
                <Icon name="check-circle" size={16} />
                {plan.name} plan includes
              </div>
              <div className="plan-features-grid">
                {plan.features.map((f) => <PlanFeaturePill key={f.label} feature={f} />)}
              </div>
            </div>
          </div>

          {/* Right: coupon + addons */}
          <div className="account-aside">
            {/* Coupon */}
            <div className="card card-pad">
              <div className="card-section-title">
                <Icon name="bookmark" size={15} />
                Coupon / promo code
              </div>
              <form className="coupon-form" onSubmit={handleApplyCoupon}>
                <input
                  className="coupon-input"
                  type="text"
                  placeholder="Enter code (e.g. LAUNCH20)"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  maxLength={32}
                />
                <Button variant="primary" size="sm" type="submit" disabled={applying || !couponInput.trim()}>
                  {applying ? "Applying…" : "Apply"}
                </Button>
              </form>
              {couponError   && <div className="coupon-msg error"><Icon name="alert-triangle" size={13} />{couponError}</div>}
              {couponSuccess && <div className="coupon-msg success"><Icon name="check-circle" size={13} />{couponSuccess}</div>}
              {subscription.coupon && (
                <div className="applied-coupon">
                  <Icon name="bookmark" size={13} />
                  <span><strong>{subscription.coupon.code}</strong> applied on {new Date(subscription.coupon.appliedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="card card-pad account-stats">
              <div className="card-section-title"><Icon name="database" size={15} />Quick stats</div>
              <div className="astat-row">
                <span className="astat-label">Extractions used</span>
                <span className="astat-val">{(usage?.extractions ?? 0).toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Extractions remaining</span>
                <span className="astat-val">
                  {totalExtractionLimit === Infinity
                    ? "∞"
                    : Math.max(0, totalExtractionLimit - (usage?.extractions ?? 0)).toLocaleString()}
                </span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Enrichments total</span>
                <span className="astat-val">{totalEnrichments.toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Plan tier</span>
                <span className="astat-val plan-tier-val">{plan.name}</span>
              </div>
              {plan.limits.scheduled_monitoring > 0 && (
                <div className="astat-row">
                  <span className="astat-label">Scheduled monitors</span>
                  <span className="astat-val">
                    {plan.limits.scheduled_monitoring === Infinity ? "Unlimited" : plan.limits.scheduled_monitoring}
                  </span>
                </div>
              )}
              {plan.limits.team_seats > 1 && (
                <div className="astat-row">
                  <span className="astat-label">Team seats</span>
                  <span className="astat-val">{plan.limits.team_seats}</span>
                </div>
              )}
            </div>

            <Button variant="ghost" size="sm" icon="zap" fullWidth onClick={() => navigate("/pricing")}>
              Explore top-up bundles
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
