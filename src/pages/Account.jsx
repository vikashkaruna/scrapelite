// Account.jsx — V5 billing & usage: plan details, usage meters, alerts, coupon.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectivePlans, getEffectivePlanById } from "../lib/pricingOverrides.js";
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import { getAlertConfig, saveAlertConfig } from "../lib/alertService.js";
import { useBilling } from "../components/BillingProvider.jsx";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

function UsageMeter({ label, used, limit, icon }) {
  const isUnlimited = limit === Infinity || limit == null;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const danger = !isUnlimited && pct >= 90;
  const warn   = !isUnlimited && pct >= 70 && !danger;
  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <div className="usage-meter-label"><Icon name={icon} size={15} /><span>{label}</span></div>
        <div className={"usage-meter-count" + (danger ? " danger" : warn ? " warn" : "")}>
          {isUnlimited
            ? <span className="usage-unlimited">Unlimited</span>
            : <>{used.toLocaleString()} <span>/ {limit.toLocaleString()}</span></>}
        </div>
      </div>
      {!isUnlimited && (
        <div className="usage-bar-track">
          <div className={"usage-bar-fill" + (danger ? " danger" : warn ? " warn" : "")}
               style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function AlertsSection() {
  const [config, setConfig] = useState(() => getAlertConfig());
  const [saved, setSaved]   = useState(false);

  const update = (patch) => setConfig((c) => ({ ...c, ...patch }));

  const toggleThreshold = (t) => {
    const ts = config.thresholds.includes(t)
      ? config.thresholds.filter((x) => x !== t)
      : [...config.thresholds, t].sort((a, b) => a - b);
    update({ thresholds: ts });
  };

  const save = () => {
    saveAlertConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card card-pad alerts-section">
      <div className="card-section-title"><Icon name="mail" size={15} />Usage alerts</div>

      <div className="alert-toggle-row">
        <label className="alert-toggle-label">
          <input type="checkbox" checked={config.enabled}
            onChange={(e) => update({ enabled: e.target.checked })} />
          <span>Enable email alerts when usage hits a threshold</span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div className="cf-field" style={{ marginTop: 14 }}>
            <label>Notification email</label>
            <input
              type="email"
              className="coupon-input"
              placeholder="you@example.com"
              value={config.email}
              onChange={(e) => update({ email: e.target.value })}
              style={{ textTransform: "none", letterSpacing: "normal" }}
            />
          </div>

          <div className="alert-thresholds">
            <div className="alert-thresholds-label">Alert me when I reach:</div>
            <div className="alert-threshold-chips">
              {[50, 70, 80, 90, 95].map((t) => (
                <button
                  key={t}
                  className={"threshold-chip" + (config.thresholds.includes(t) ? " active" : "")}
                  onClick={() => toggleThreshold(t)}
                >
                  {t}%
                </button>
              ))}
            </div>
          </div>

          <div className="alert-notify-row">
            <label className="alert-notify-label">
              <input type="checkbox" checked={config.notifyOn?.extractions ?? true}
                onChange={(e) => update({ notifyOn: { ...config.notifyOn, extractions: e.target.checked } })} />
              <span>Extractions threshold</span>
            </label>
          </div>
        </>
      )}

      <div className="alert-save-row">
        <Button variant="primary" size="sm" onClick={save}>
          {saved ? "Saved!" : "Save alert settings"}
        </Button>
        {saved && (
          <div className="coupon-msg success">
            <Icon name="check-circle" size={13} />Settings saved.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Account() {
  const navigate = useNavigate();
  const {
    plan: ctxPlan, planId, usage, bonus, currency, rates,
    applyCoupon, removeCoupon, couponError, couponSuccess,
    subscription,
  } = useBilling();

  // Always use effective plan (picks up admin overrides)
  const plan = getEffectivePlanById(planId);
  const allPlans = getEffectivePlans();

  const [couponInput, setCouponInput] = useState("");
  const [applying, setApplying]       = useState(false);

  const totalExtractionLimit = plan.limits.extractions === Infinity
    ? Infinity
    : plan.limits.extractions + (bonus || 0);

  const enrichmentEntries  = Object.entries(usage?.enrichments ?? {});
  const totalEnrichments   = enrichmentEntries.reduce((s, [, v]) => s + v, 0);

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    setApplying(true);
    await new Promise((r) => setTimeout(r, 600));
    applyCoupon(couponInput.trim().toUpperCase());
    setCouponInput("");
    setApplying(false);
  };

  const nextTier = allPlans.find((p) => p.price_usd > plan.price_usd);

  return (
    <div className="page account-page">
      <div className="container">
        <div className="account-header">
          <div>
            <div className="eyebrow"><Icon name="user" />Billing & Usage</div>
            <h1 className="account-title">Your plan & usage</h1>
          </div>
          <Button variant="secondary" size="sm" icon="zap" onClick={() => navigate("/pricing")}>
            View all plans
          </Button>
        </div>

        <div className="account-grid">
          {/* Left column */}
          <div className="account-main">
            {/* Current plan card */}
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
                  {subscription.discountPercent > 0 && (
                    <div className="apc-discount-note">
                      <Icon name="tag" size={13} />{subscription.discountPercent}% discount applied via coupon
                    </div>
                  )}
                </div>
                {plan.price_usd > 0 && (
                  <div className="apc-price">
                    <span className="appc-amount">
                      {formatPrice(convertPrice(plan.price_usd, rates, currency), currency)}
                    </span>
                    <span className="appc-period">/ mo</span>
                  </div>
                )}
              </div>
              {nextTier && (
                <div className="apc-upgrade-hint">
                  <Icon name="trending-up" size={14} />
                  <span>
                    Upgrade to <strong>{nextTier.name}</strong> for{" "}
                    {nextTier.limits.extractions === Infinity
                      ? "unlimited extractions"
                      : `${nextTier.limits.extractions.toLocaleString()} extractions / month`}
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
                  label="Extractions used"
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
                  <span>+{bonus} bonus extractions from top-up bundle or coupon.</span>
                </div>
              )}
            </div>

            {/* Plan features */}
            <div className="card card-pad">
              <div className="card-section-title"><Icon name="check-circle" size={16} />{plan.name} plan includes</div>
              <div className="plan-features-grid">
                {plan.features.map((f) => (
                  <div key={f.label} className={"plan-feat-pill" + (f.included ? "" : " excluded")}>
                    <Icon name={f.included ? "check" : "x"} size={13} />
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Metering alerts */}
            <AlertsSection />
          </div>

          {/* Right column */}
          <div className="account-aside">
            {/* Coupon */}
            <div className="card card-pad">
              <div className="card-section-title"><Icon name="bookmark" size={15} />Coupon / promo code</div>
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
                  <button className="remove-coupon-btn" onClick={removeCoupon} title="Remove coupon">
                    <Icon name="x" size={12} />
                  </button>
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
                <span className="astat-label">Remaining this month</span>
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
