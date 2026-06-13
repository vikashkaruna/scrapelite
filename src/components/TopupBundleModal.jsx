// TopupBundleModal.jsx — Quantity-selector modal for top-up bundle purchases.
import { useState } from "react";
import { getEffectivePlans } from "../lib/pricingOverrides.js";
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

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
  const GST_RATE = 0.18;
  const basePrice    = isINR && bundle.price_inr ? bundle.price_inr : bundle.price_usd;
  const subtotal     = basePrice * qty;
  const gst          = isINR ? Math.round(subtotal * GST_RATE) : 0;
  const totalPrice   = subtotal + gst;
  const sym          = isINR ? "₹" : "$";

  const fmtINR = (n) => sym + Math.round(n).toLocaleString("en-IN");
  const fmtUSD = (n) => sym + n;
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
            <span>{fmtAmt(subtotal)}</span>
          </div>
          {qty > 1 && (
            <div className="tbm-summary-row tbm-summary-per">
              <span>{formattedUnit} per bundle</span>
            </div>
          )}
          {isINR && (
            <>
              <div className="tbm-summary-row tbm-gst-row">
                <span>GST (18%)</span>
                <span>+ {fmtINR(gst)}</span>
              </div>
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
                    {formatPrice(plan.price_usd_annual ?? plan.price_usd, "USD")}
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
