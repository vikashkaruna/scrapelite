// Pricing.jsx — V5 public pricing page with payment integration (Stripe/Razorpay/UPI).
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getEffectivePlans, getEffectiveBundles,
  getGlobalDiscount, applyGlobalDiscount,
} from "../lib/pricingOverrides.js";
import { CURRENCIES, CURRENCY_META } from "../lib/pricingConfig.js";
import { convertPrice, formatPrice } from "../lib/currencyService.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { PROVIDER_META } from "../lib/paymentConfig.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

function CurrencyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref  = useRef(null);
  const meta = CURRENCY_META[value] ?? {};

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="currency-picker" ref={ref} style={{ position: "relative" }}>
      <button className="currency-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        <span>{meta.flag}</span>
        <span>{value}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="currency-dropdown" role="listbox">
          {CURRENCIES.map((c) => (
            <button
              key={c}
              role="option"
              aria-selected={c === value}
              className={"currency-option" + (c === value ? " selected" : "")}
              onClick={() => { onChange(c); setOpen(false); }}
            >
              <span>{CURRENCY_META[c]?.flag}</span>
              <span className="co-code">{c}</span>
              <span className="co-label">{CURRENCY_META[c]?.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, displayPrice, currency, currentPlanId, onSelect, loading }) {
  const isCurrent = plan.id === currentPlanId;
  const isFree    = plan.price_usd === 0;
  const isLoading = loading === plan.id;

  return (
    <div className={"plan-card" + (plan.highlight ? " plan-highlight" : "")}>
      {plan.badge && <div className="plan-badge">{plan.badge}</div>}
      <div className="plan-header">
        <div className="plan-name">{plan.name}</div>
        <div className="plan-tagline">{plan.tagline}</div>
      </div>
      <div className="plan-price">
        {isFree ? (
          <><span className="price-amount">Free</span><span className="price-period"> forever</span></>
        ) : (
          <>
            <span className="price-amount">{formatPrice(displayPrice, currency)}</span>
            <span className="price-period"> / month</span>
          </>
        )}
      </div>
      <Button
        variant={plan.highlight ? "primary" : isCurrent ? "ghost" : "secondary"}
        size="sm"
        fullWidth
        onClick={() => !isCurrent && !isLoading && onSelect(plan.id)}
        disabled={isCurrent || isLoading}
      >
        {isLoading ? (
          <span className="btn-loading"><Icon name="refresh" size={14} />Processing…</span>
        ) : (
          isCurrent ? "Current plan" : isFree ? "Get started free" : `Get ${plan.name}`
        )}
      </Button>
      <ul className="plan-features">
        {plan.features.map((f) => (
          <li key={f.label} className={"pf-item" + (f.included ? "" : " pf-excluded")}>
            <Icon name={f.included ? "check-circle" : "x"} size={15} />
            <span>{f.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderBadge({ provider }) {
  const meta = PROVIDER_META[provider];
  if (!meta) return null;
  return (
    <div className="provider-badge">
      <Icon name={meta.icon} size={13} />
      <span>{meta.badge}</span>
    </div>
  );
}

function TopupCard({ bundle, price, currency, onBuy, loading }) {
  const isLoading = loading === bundle.id;
  return (
    <div className="topup-card">
      <div className="topup-icon"><Icon name={bundle.icon} size={20} /></div>
      <div className="topup-body">
        <div className="topup-name">{bundle.name}</div>
        <div className="topup-desc">{bundle.description}</div>
      </div>
      <div className="topup-right">
        <div className="topup-price">
          <span className="topup-amount">{formatPrice(price, currency)}</span>
          <span className="topup-unit">{bundle.unit}</span>
        </div>
        {onBuy && (
          <Button variant="secondary" size="sm" onClick={() => onBuy(bundle.id)} disabled={isLoading}>
            {isLoading ? <><Icon name="refresh" size={12} />Adding…</> : "Add to plan"}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Pricing() {
  const navigate  = useNavigate();
  const {
    currency, rates, setCurrency, planId: currentPlanId,
    initiatePayment, paymentLoading, paymentError, setPaymentError,
    paymentProvider, hasPayment, subscription,
  } = useBilling();

  const [loadingPlan, setLoadingPlan]     = useState(null);
  const [loadingBundle, setLoadingBundle] = useState(null);
  const [localError, setLocalError]       = useState("");

  const plans    = getEffectivePlans();
  const bundles  = getEffectiveBundles();
  const discount = getGlobalDiscount();

  // Clear errors when provider/currency changes
  useEffect(() => { setLocalError(""); setPaymentError?.(""); }, [currency]);

  const handleSelect = async (planId) => {
    if (planId === "free") {
      initiatePayment?.("free");
      navigate("/account");
      return;
    }
    setLoadingPlan(planId);
    setLocalError("");
    try {
      const result = await initiatePayment?.(planId);
      // demo_mode or success (Razorpay in-modal) → go to account
      if (result?.status === "demo_mode" || result?.status === "success") {
        navigate("/account");
      }
      // "redirecting"   → Stripe redirect in progress — page will be replaced
      // "cancelled"     → Razorpay modal dismissed — stay on page
      // "contact_sales" → mailto opened — stay on page
    } catch (e) {
      setLocalError(e.message || "Payment initiation failed. Please try again.");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBundleBuy = async (bundleId) => {
    setLoadingBundle(bundleId);
    setLocalError("");
    try {
      // For now, open a contact mailto — full bundle checkout is a future enhancement
      window.open(
        `mailto:hello@scrapelite.io?subject=${encodeURIComponent(`Add-on: ${bundleId}`)}&body=${encodeURIComponent(`I'd like to add the ${bundleId} bundle to my account.`)}`,
        "_blank"
      );
    } finally {
      setLoadingBundle(null);
    }
  };

  const showError = localError || paymentError;

  return (
    <div className="page pricing-page">
      <div className="container">
        <div className="pricing-hero">
          <div className="eyebrow"><Icon name="zap" />Pricing</div>
          <h1 className="pricing-title">Simple, transparent pricing</h1>
          <p className="pricing-sub">
            Start free. Upgrade when you need more extractions, team features, or automation.
          </p>

          {discount.active && (
            <div className="global-discount-banner">
              <Icon name="gift" size={16} />
              <strong>{discount.percent}% off</strong> — {discount.label}
              {discount.expiresAt && (
                <span className="discount-expiry"> · Ends {new Date(discount.expiresAt).toLocaleDateString()}</span>
              )}
            </div>
          )}

          {subscription.discountPercent > 0 && !discount.active && (
            <div className="global-discount-banner coupon-discount-banner">
              <Icon name="tag" size={16} />
              <strong>{subscription.discountPercent}% coupon discount</strong> will be applied at checkout.
            </div>
          )}

          <div className="pricing-hero-actions">
            <CurrencyPicker value={currency} onChange={setCurrency} />
            <span className="pricing-rates-note">Rates updated daily at 5:00 AM IST</span>
            {paymentProvider && <ProviderBadge provider={paymentProvider} />}
          </div>

          {!hasPayment && (
            <div className="payment-demo-notice">
              <Icon name="info" size={14} />
              <span>Demo mode — no payment configured. Upgrades are simulated locally.</span>
            </div>
          )}
        </div>

        {showError && (
          <div className="payment-error-banner">
            <Icon name="alert-circle" size={16} />
            <span>{showError}</span>
            <button className="peb-close" onClick={() => { setLocalError(""); setPaymentError?.(""); }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="plans-grid">
          {plans.map((plan) => {
            const baseUsd    = plan.price_usd;
            const discounted = applyGlobalDiscount(baseUsd);
            const price      = convertPrice(discounted, rates, currency);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                displayPrice={price}
                currency={currency}
                currentPlanId={currentPlanId}
                onSelect={handleSelect}
                loading={loadingPlan}
              />
            );
          })}
        </div>

        {/* UPI note for INR */}
        {currency === "INR" && hasPayment && paymentProvider === "razorpay" && (
          <div className="upi-note">
            <Icon name="shield" size={14} />
            <span>Pay with UPI, Net Banking, Credit/Debit card — powered by Razorpay.</span>
          </div>
        )}

        <div className="topup-section">
          <div className="topup-section-head">
            <h2 className="topup-section-title">Top-up bundles</h2>
            <p className="topup-section-sub">
              Add capacity or features to any plan — no upgrade required.
            </p>
          </div>
          <div className="topup-grid">
            {bundles.map((bundle) => (
              <TopupCard
                key={bundle.id}
                bundle={bundle}
                price={convertPrice(bundle.price_usd, rates, currency)}
                currency={currency}
                onBuy={handleBundleBuy}
                loading={loadingBundle}
              />
            ))}
          </div>
        </div>

        <div className="pricing-footer">
          <div className="pricing-faq-row">
            <div className="pricing-faq-item">
              <Icon name="info" size={16} />
              <span>All plans include a <strong>free 10-extraction trial</strong> — no card required.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="shield" size={16} />
              <span>Prices shown exclude local taxes. INR prices are inclusive of 18% GST.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="refresh" size={16} />
              <span>Usage resets on the 1st of every month. Unused extractions don't roll over.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
