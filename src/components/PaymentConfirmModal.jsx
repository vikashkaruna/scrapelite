// PaymentConfirmModal — pre-payment confirmation with GST breakdown (INR) and plan upgrade option.
import { useState } from "react";
import { getEffectivePlans } from "../lib/pricingOverrides.js";
import { hasPayment } from "../lib/paymentConfig.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

const GST_RATE = 0.18;

function computePricing(plan, billingPeriod, currency) {
  const isINR = currency === "INR";
  let baseTotal, gst, total;

  if (isINR) {
    const baseMonthly = billingPeriod === "annual"
      ? (plan.price_inr_annual || 0)
      : (plan.price_inr || 0);
    baseTotal = billingPeriod === "annual" ? baseMonthly * 12 : baseMonthly;
    gst   = Math.round(baseTotal * GST_RATE);
    total = baseTotal + gst;
  } else {
    const baseMonthly = billingPeriod === "annual"
      ? (plan.price_usd_annual ?? plan.price_usd)
      : plan.price_usd;
    baseTotal = billingPeriod === "annual" ? baseMonthly * 12 : baseMonthly;
    gst   = 0;
    total = baseTotal;
  }

  return { baseTotal, gst, total };
}

function fmt(amt, currency) {
  if (currency === "INR") return "₹" + Math.round(amt).toLocaleString("en-IN");
  return "$" + amt;
}

export default function PaymentConfirmModal({
  planId,
  billingPeriod,
  currency,
  currentPlanId,
  onConfirm,
  onCancel,
}) {
  const [selectedId, setSelectedId] = useState(planId);
  const isDemo = !hasPayment;
  const isINR  = currency === "INR";

  const allPlans = getEffectivePlans().filter((p) => !p.comingSoon && p.price_usd > 0);
  const plan        = allPlans.find((p) => p.id === selectedId);
  const currentPlan = getEffectivePlans().find((p) => p.id === currentPlanId);

  if (!plan) return null;

  const { baseTotal, gst, total } = computePricing(plan, billingPeriod, currency);

  // Higher plans relative to the currently selected plan (up to 2)
  const upgradePlans = allPlans
    .filter((p) => p.price_usd > plan.price_usd)
    .slice(0, 2);

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onCancel(); };

  const periodLabel = billingPeriod === "annual" ? "Annual (12 months)" : "Monthly";
  const confirmLabel = isDemo
    ? `Confirm — activate ${plan.name} (Demo)`
    : `Proceed to payment — ${fmt(total, currency)}`;

  return (
    <div className="pcm-backdrop" onClick={handleBackdrop}>
      <div className="pcm-card" role="dialog" aria-modal="true" aria-label="Confirm payment">
        <button className="pcm-close" onClick={onCancel} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        {isDemo && (
          <div className="pcm-demo-badge">
            <Icon name="info" size={13} />
            Demo mode — no real payment
          </div>
        )}

        <div className="pcm-header">
          {currentPlan && currentPlan.id !== plan.id && (
            <div className="pcm-upgrade-path">
              <span className="pcm-from-plan">{currentPlan.name}</span>
              <Icon name="arrow-right" size={13} />
              <span className="pcm-to-plan">{plan.name}</span>
            </div>
          )}
          <div className="pcm-plan-name">{plan.name}</div>
          <div className="pcm-plan-tagline">{plan.tagline}</div>
        </div>

        <div className="pcm-breakdown">
          <div className="pcm-breakdown-title">Price breakdown</div>
          <div className="pcm-row">
            <span>{plan.name} — {periodLabel}</span>
            <span>{fmt(baseTotal, currency)}</span>
          </div>
          {isINR && (
            <>
              <div className="pcm-row pcm-gst-row">
                <span>GST (18%)</span>
                <span>+ {fmt(gst, currency)}</span>
              </div>
              <div className="pcm-breakdown-divider" />
              <div className="pcm-row pcm-total-row">
                <span>Total charged</span>
                <span>{fmt(total, currency)}</span>
              </div>
            </>
          )}
          {billingPeriod === "annual" && (
            <div className="pcm-per-month-note">
              {fmt(isINR ? Math.round((plan.price_inr_annual || 0) * (1 + GST_RATE)) : (plan.price_usd_annual ?? plan.price_usd), currency)}/mo
              {isINR ? " incl. GST" : ""}
            </div>
          )}
        </div>

        {isDemo && (
          <p className="pcm-demo-notice">
            Activates <strong>{plan.name}</strong> locally for testing — no real charge is made.
          </p>
        )}

        <Button variant="primary" fullWidth onClick={() => onConfirm(selectedId)}>
          {confirmLabel}
        </Button>
        <button className="pcm-cancel-btn" onClick={onCancel}>
          Cancel, keep current plan
        </button>

        {upgradePlans.length > 0 && (
          <div className="pcm-upgrade-section">
            <div className="pcm-upgrade-title">Or step up to a higher plan</div>
            {upgradePlans.map((up) => {
              const { total: upTotal } = computePricing(up, billingPeriod, currency);
              return (
                <button
                  key={up.id}
                  className={`pcm-upgrade-plan${selectedId === up.id ? " pcm-upgrade-plan-active" : ""}`}
                  onClick={() => setSelectedId(up.id)}
                >
                  <div className="pcm-up-left">
                    <div className="pcm-up-name">{up.name}</div>
                    <div className="pcm-up-desc">{up.tagline}</div>
                  </div>
                  <div className="pcm-up-price">
                    {fmt(upTotal, currency)}
                    <span>/{billingPeriod === "annual" ? "yr" : "mo"}{isINR ? " incl. GST" : ""}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
