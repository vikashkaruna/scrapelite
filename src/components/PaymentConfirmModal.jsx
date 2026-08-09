// PaymentConfirmModal — pre-payment confirmation with discount + GST breakdown (INR)
// and inline coupon entry. The discount shown here mirrors the server's
// serverDiscount = max(coupon, global) so the displayed total matches what is charged.
import { useState } from "react";
import { getEffectivePlans, getGlobalDiscount } from "../lib/pricingOverrides.js";
import { validateCoupon } from "../lib/adminService.js";
import { hasPayment } from "../lib/paymentConfig.js";
import { computeCharge, perMonthIncl } from "../lib/pricingMath.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

// Active global-sale percent (0 when none / expired).
function globalPercent() {
  const d = getGlobalDiscount();
  if (!d?.active || !d.percent) return 0;
  if (d.expiresAt && new Date(d.expiresAt) < new Date()) return 0;
  return d.percent;
}

// Percent from a coupon code, validated against the selected plan (0 if invalid/non-percent).
function couponPercentFor(code, planId) {
  if (!code) return 0;
  const { valid, coupon } = validateCoupon(code, planId);
  if (!valid || coupon.type !== "percent") return 0;
  return coupon.value || 0;
}

// Thin adapter to the shared canonical helper (display-only; server is authoritative).
function computePricing(plan, billingPeriod, currency, discountPercent) {
  const { gross, discount, base, gst, total } = computeCharge(plan, billingPeriod, currency, discountPercent);
  return { gross, discount, baseTotal: base, gst: Math.round(gst), total };
}

function fmt(amt, currency) {
  if (currency === "INR") return "₹" + Math.round(amt).toLocaleString("en-IN");
  const rounded = Math.round(amt * 100) / 100;
  // Whole dollars → no decimals; fractional → 2 decimals (e.g. $604.80).
  return "$" + (Number.isInteger(rounded) ? rounded : rounded.toFixed(2));
}

export default function PaymentConfirmModal({
  planId,
  billingPeriod,
  currency,
  currentPlanId,
  appliedCouponCode,   // coupon already on the subscription (from /account)
  onApplyCoupon,       // (code) => boolean — persists coupon to subscription, returns validity
  onRemoveCoupon,      // () => void — clears the applied coupon
  onConfirm,           // (planId, couponCode) => void
  onCancel,
}) {
  const [selectedId, setSelectedId]   = useState(planId);
  const [period, setPeriod]           = useState(billingPeriod); // local toggle so prices update live
  const [couponInput, setCouponInput] = useState("");
  const [couponErr, setCouponErr]     = useState("");
  // Local mirror of the applied coupon so the breakdown updates instantly on apply/remove.
  const [activeCoupon, setActiveCoupon] = useState(appliedCouponCode || "");

  const isDemo = !hasPayment;
  const isINR  = currency === "INR";

  const allPlans = getEffectivePlans().filter((p) => !p.comingSoon && p.price_usd > 0);
  const plan        = allPlans.find((p) => p.id === selectedId);
  const currentPlan = getEffectivePlans().find((p) => p.id === currentPlanId);

  if (!plan) return null;

  // Effective discount = max(coupon-for-this-plan, global sale) — mirrors the server.
  const couponPct   = couponPercentFor(activeCoupon, selectedId);
  const globalPct   = globalPercent();
  const effectivePct = Math.max(couponPct, globalPct);
  const discountSrc  = couponPct >= globalPct && couponPct > 0 ? "coupon" : globalPct > 0 ? "global" : null;

  const { gross, discount, baseTotal, gst, total } = computePricing(plan, period, currency, effectivePct);

  // Higher plans relative to the currently selected plan (up to 2)
  const upgradePlans = allPlans
    .filter((p) => p.price_usd > plan.price_usd)
    .slice(0, 2);

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onCancel(); };

  const handleApply = (e) => {
    e.preventDefault();
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    // Validate against the selected plan first so we can show a precise error.
    const { valid, reason } = validateCoupon(code, selectedId);
    if (!valid) { setCouponErr(reason || "Invalid coupon code."); return; }
    // Persist to the subscription for display continuity (/account). The modal's own
    // validation above is authoritative for what's shown + sent; the server re-validates.
    onApplyCoupon?.(code);
    setActiveCoupon(code);
    setCouponInput("");
    setCouponErr("");
  };

  const handleRemove = () => {
    onRemoveCoupon?.();
    setActiveCoupon("");
    setCouponErr("");
  };

  const periodLabel = period === "annual" ? "Annual (12 months)" : "Monthly";
  const confirmLabel = isDemo
    ? `Confirm — activate ${plan.name} (Demo)`
    : `Proceed to payment — ${fmt(total, currency)}`;

  // A coupon is "applied but inactive for this plan" when it exists but doesn't grant a
  // percent for the selected plan (e.g. plan-restricted to a different tier).
  const couponInactive = activeCoupon && couponPct === 0;

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

          {/* In-modal billing period toggle — the prices below update live as
              the user switches between Annual and Monthly, without having to
              close the modal and re-click "Get X" on /pricing. */}
          <div className="billing-toggle-wrap pcm-period-toggle" role="group" aria-label="Billing period">
            <button
              type="button"
              className={"billing-toggle-btn" + (period === "monthly" ? " active" : "")}
              onClick={() => setPeriod("monthly")}
              aria-pressed={period === "monthly"}
            >
              Monthly
            </button>
            <button
              type="button"
              className={"billing-toggle-btn" + (period === "annual" ? " active" : "")}
              onClick={() => setPeriod("annual")}
              aria-pressed={period === "annual"}
            >
              Annual
            </button>
          </div>

          <div className="pcm-row">
            <span>{plan.name} — {periodLabel}</span>
            <span>{fmt(gross, currency)}</span>
          </div>
          {effectivePct > 0 && discount > 0 && (
            <div className="pcm-row pcm-discount-row">
              <span>
                <Icon name="tag" size={12} />
                {discountSrc === "coupon" ? `Coupon ${activeCoupon}` : "Sale"} (−{effectivePct}%)
              </span>
              <span>− {fmt(discount, currency)}</span>
            </div>
          )}
          <div className="pcm-breakdown-divider" />
          <div className="pcm-row">
            <span>Subtotal</span>
            <span>{fmt(baseTotal, currency)}</span>
          </div>
          {isINR && (
            <div className="pcm-row pcm-gst-row">
              <span>GST (18%)</span>
              <span>+ {fmt(gst, currency)}</span>
            </div>
          )}
          <div className="pcm-breakdown-divider" />
          <div className="pcm-row pcm-total-row">
            <span>Total charged</span>
            <span>{fmt(total, currency)}</span>
          </div>
          {period === "annual" && (
            <div className="pcm-per-month-note">
              {fmt(perMonthIncl(plan, currency), currency)}/mo
              {isINR ? " incl. GST" : ""}
            </div>
          )}
        </div>

        {/* ── Coupon entry / applied state ──────────────────────────────────── */}
        <div className="pcm-coupon">
          {activeCoupon ? (
            <div className={`pcm-coupon-applied${couponInactive ? " pcm-coupon-inactive" : ""}`}>
              <Icon name={couponInactive ? "alert-triangle" : "check-circle"} size={14} />
              <span>
                <strong>{activeCoupon}</strong>{" "}
                {couponInactive
                  ? "isn't valid for this plan"
                  : `applied — ${couponPct}% off`}
              </span>
              <button className="pcm-coupon-remove" onClick={handleRemove} title="Remove coupon">
                <Icon name="x" size={13} />
              </button>
            </div>
          ) : (
            <form className="pcm-coupon-form" onSubmit={handleApply}>
              <input
                className="pcm-coupon-input"
                type="text"
                placeholder="Promo code"
                value={couponInput}
                onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponErr(""); }}
                maxLength={32}
              />
              <button type="submit" className="pcm-coupon-apply" disabled={!couponInput.trim()}>
                Apply
              </button>
            </form>
          )}
          {couponErr && <div className="pcm-coupon-err"><Icon name="alert-triangle" size={12} />{couponErr}</div>}
        </div>

        {isDemo && (
          <p className="pcm-demo-notice">
            Activates <strong>{plan.name}</strong> locally for testing — no real charge is made.
          </p>
        )}

        <Button variant="primary" fullWidth onClick={() => onConfirm(selectedId, activeCoupon || null)}>
          {confirmLabel}
        </Button>
        <button className="pcm-cancel-btn" onClick={onCancel}>
          Cancel, keep current plan
        </button>

        {upgradePlans.length > 0 && (
          <div className="pcm-upgrade-section">
            <div className="pcm-upgrade-title">Or step up to a higher plan</div>
            {upgradePlans.map((up) => {
              const upPct = Math.max(couponPercentFor(activeCoupon, up.id), globalPct);
              const { total: upTotal } = computePricing(up, period, currency, upPct);
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
                    <span>/{period === "annual" ? "yr" : "mo"}{isINR ? " incl. GST" : ""}</span>
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
