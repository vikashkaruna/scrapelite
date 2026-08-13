// TopupBundleModal.jsx — Quantity-selector modal for top-up bundle purchases.
import { useState } from "react";
import { getEffectivePlans, getGlobalDiscount } from "../lib/pricingOverrides.js";
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import { computeCharge } from "../lib/pricingMath.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

// Active global-sale percent (0 when none / expired) — same source Pricing.jsx's
// own banner and PaymentConfirmModal read, so this modal never disagrees.
function activeSalePercent() {
  const d = getGlobalDiscount();
  if (!d?.active || !d.percent) return 0;
  if (d.expiresAt && new Date(d.expiresAt) < new Date()) return 0;
  return d.percent;
}

export default function TopupBundleModal({
  bundle,
  currency,
  rates,
  currentPlanId,
  onClose,
  onPurchase,
  onUpgrade,
  loading,
}) {
  const [qty, setQty] = useState(1);

  if (!bundle) return null;

  const isINR = currency === "INR";
  const sym   = isINR ? "₹" : "$";

  // computeCharge is the SAME helper PaymentConfirmModal uses for plan purchases —
  // using it here too means bundle purchases show (and the server, once a coupon
  // is wired into checkout for bundles, would charge) the same discounted total
  // instead of a second, hand-rolled GST calculation.
  const discountPercent = activeSalePercent();
  const { gross, discount, base: subtotal, gst, total: totalPrice } =
    computeCharge(bundle, "once", currency, discountPercent, qty);
  const basePrice = isINR && bundle.price_inr ? bundle.price_inr : bundle.price_usd;

  const fmtINR = (n) => sym + Math.round(n).toLocaleString("en-IN");
  const fmtUSD = (n) => sym + (Number.isInteger(n) ? n : n.toFixed(2));
  const fmtAmt = isINR ? fmtINR : fmtUSD;

  const formattedTotal = fmtAmt(totalPrice);
  const formattedUnit  = fmtAmt(basePrice);

  const bonusUrls = (bundle.bonusBatchUrls || 0) * qty;
  const bonusExtr = (bundle.bonusExtractions || 0) * qty;

  // Get up to 2 plans with higher price_usd than current, excluding comingSoon
  const allPlans = getEffectivePlans();
  const currentPlan = allPlans.find((p) => p.id === currentPlanId);
  const currentPriceUsd = currentPlan?.price_usd ?? 0;
  const upsellPlans = allPlans
    .filter((p) => !p.comingSoon && p.price_usd > currentPriceUsd && p.price_usd > 0)
    .slice(0, 2);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const decrementQty = () => setQty((q) => Math.max(1, q - 1));
  const incrementQty = () => setQty((q) => Math.min(10, q + 1));

  return (
    <div className="tbm-backdrop" onClick={handleBackdropClick}>
      <div className="tbm-card" role="dialog" aria-modal="true" aria-label={`Buy ${bundle.name}`}>
        <button className="tbm-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        <div className="tbm-header">
          <div className="tbm-icon">
            <Icon name={bundle.icon || "zap"} size={24} />
          </div>
          <div>
            <div className="tbm-title">{bundle.name}</div>
            <div className="tbm-desc">{bundle.description}</div>
          </div>
        </div>

        <div className="tbm-qty-section">
          <div className="tbm-qty-label">Quantity</div>
          <div className="tbm-qty-controls">
            <button
              className="tbm-qty-btn"
              onClick={decrementQty}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
            >
              <Icon name="minus" size={16} />
            </button>
            <span className="tbm-qty-val">{qty}</span>
            <button
              className="tbm-qty-btn"
              onClick={incrementQty}
              disabled={qty >= 10}
              aria-label="Increase quantity"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
        </div>

        <div className="tbm-summary">
          <div className="tbm-summary-row">
            <span>{bundle.name}{qty > 1 ? ` × ${qty}` : ""}</span>
            <span>{fmtAmt(gross)}</span>
          </div>
          {qty > 1 && (
            <div className="tbm-summary-row tbm-summary-per">
              <span>{formattedUnit} per bundle</span>
            </div>
          )}
          {discountPercent > 0 && discount > 0 && (
            <div className="tbm-summary-row tbm-discount-row">
              <span><Icon name="tag" size={12} /> Sale (−{discountPercent}%)</span>
              <span>− {fmtAmt(discount)}</span>
            </div>
          )}
          {isINR && (
            <div className="tbm-summary-row tbm-gst-row">
              <span>GST (18%)</span>
              <span>+ {fmtINR(gst)}</span>
            </div>
          )}
          {(isINR || discountPercent > 0) && (
            <>
              <div className="tbm-summary-divider" />
              <div className="tbm-summary-row tbm-total-row">
                <span>Total charged</span>
                <span>{formattedTotal}</span>
              </div>
            </>
          )}
          {bonusUrls > 0 && (
            <div className="tbm-summary-bonus">
              <Icon name="zap" size={13} />
              <span>+{bonusUrls.toLocaleString()} bonus batch URLs added to your plan</span>
            </div>
          )}
          {bonusExtr > 0 && (
            <div className="tbm-summary-bonus">
              <Icon name="zap" size={13} />
              <span>+{bonusExtr.toLocaleString()} bonus extractions added to your plan</span>
            </div>
          )}
        </div>

        <Button
          variant="primary"
          fullWidth
          onClick={() => onPurchase(bundle.id, qty)}
          disabled={loading}
        >
          {loading ? (
            <span className="btn-loading">
              <Icon name="refresh" size={14} />
              Processing…
            </span>
          ) : (
            `Add ${qty} bundle${qty > 1 ? "s" : ""} — ${formattedTotal}`
          )}
        </Button>

        {upsellPlans.length > 0 && (
          <>
            <div className="tbm-upsell-divider" />
            <div className="tbm-upsell">
              <div className="tbm-upsell-title">Or upgrade for unlimited capacity</div>
              {upsellPlans.map((plan) => (
                <button
                  key={plan.id}
                  className="tbm-upsell-plan"
                  onClick={() => { onUpgrade?.(plan.id); }}
                >
                  <div className="tbm-up-left">
                    <div className="tbm-up-name">{plan.name}</div>
                    <div className="tbm-up-desc">{plan.tagline}</div>
                  </div>
                  <div className="tbm-up-price">
                    {isINR && (plan.price_inr_annual || plan.price_inr)
                      ? "₹" + Math.round(plan.price_inr_annual || plan.price_inr).toLocaleString("en-IN")
                      : formatPrice(plan.price_usd_annual ?? plan.price_usd, "USD")}
                    <span>/mo</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
