// Pricing.jsx — V6: annual/monthly toggle, USD+INR, Developer+Enterprise tiers.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getEffectivePlans, getEffectiveBundles,
  getGlobalDiscount, applyGlobalDiscount,
} from "../lib/pricingOverrides.js";
import { CURRENCIES, CURRENCY_META, ENTERPRISE_PLAN } from "../lib/pricingConfig.js";
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

// Returns the display price for a plan given billing period + currency.
function resolvePrice(plan, billingPeriod, currency, rates) {
  if (plan.price_usd === 0) return 0;
  if (billingPeriod === "annual") {
    if (currency === "INR" && plan.price_inr_annual) return plan.price_inr_annual;
    return plan.price_usd_annual ?? plan.price_usd;
  }
  if (currency === "INR") return Math.round(convertPrice(plan.price_usd, rates, "INR"));
  return plan.price_usd;
}

function BillingToggle({ value, onChange }) {
  return (
    <div className="billing-toggle-wrap">
      <button
        className={"billing-toggle-btn" + (value === "monthly" ? " active" : "")}
        onClick={() => onChange("monthly")}
      >
        Monthly
      </button>
      <button
        className={"billing-toggle-btn" + (value === "annual" ? " active" : "")}
        onClick={() => onChange("annual")}
      >
        Annual
        <span className="billing-save-badge">Save 20%</span>
      </button>
    </div>
  );
}

function PlanCard({ plan, displayPrice, currency, billingPeriod, currentPlanId, onSelect, loading }) {
  const isCurrent = plan.id === currentPlanId;
  const isFree    = plan.price_usd === 0;
  const isLoading = loading === plan.id;
  const isSoon    = plan.comingSoon;

  return (
    <div className={"plan-card" + (plan.highlight ? " plan-highlight" : "") + (isSoon ? " plan-coming-soon" : "")}>
      {plan.badge && <div className="plan-badge">{plan.badge}</div>}
      <div className="plan-header">
        <div className="plan-name">{plan.name}</div>
        <div className="plan-tagline">{plan.tagline}</div>
      </div>
      <div className="plan-price">
        {isFree ? (
          <><span className="price-amount">Free</span><span className="price-period"> forever</span></>
        ) : isSoon ? (
          <><span className="price-amount">{formatPrice(displayPrice, currency)}</span><span className="price-period"> / mo</span></>
        ) : (
          <>
            <span className="price-amount">{formatPrice(displayPrice, currency)}</span>
            <span className="price-period"> / mo{billingPeriod === "annual" ? ", billed annually" : ""}</span>
          </>
        )}
      </div>
      <Button
        variant={plan.highlight ? "primary" : isCurrent ? "ghost" : "secondary"}
        size="sm"
        fullWidth
        onClick={() => !isCurrent && !isLoading && !isSoon && onSelect(plan.id)}
        disabled={isCurrent || isLoading || isSoon}
      >
        {isLoading ? (
          <span className="btn-loading"><Icon name="refresh" size={14} />Processing…</span>
        ) : isSoon ? (
          "Notify me"
        ) : isCurrent ? "Current plan" : isFree ? "Get started free" : `Get ${plan.name}`}
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

function EnterpriseCard({ onContact }) {
  return (
    <div className="plan-card enterprise-card">
      <div className="plan-header">
        <div className="plan-name">{ENTERPRISE_PLAN.name}</div>
        <div className="plan-tagline">{ENTERPRISE_PLAN.tagline}</div>
      </div>
      <div className="plan-price">
        <span className="price-amount">Custom</span>
        <span className="price-period"> pricing</span>
      </div>
      <Button variant="secondary" size="sm" fullWidth onClick={onContact}>
        Contact sales
      </Button>
      <ul className="plan-features">
        {ENTERPRISE_PLAN.features.map((f) => (
          <li key={f.label} className="pf-item">
            <Icon name="check-circle" size={15} />
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

function TopupCard({ bundle, currency, onBuy, loading }) {
  const isLoading = loading === bundle.id;
  const price = currency === "INR" && bundle.price_inr ? bundle.price_inr : bundle.price_usd;
  const sym   = currency === "INR" ? "₹" : "$";
  return (
    <div className="topup-card">
      <div className="topup-icon"><Icon name={bundle.icon} size={20} /></div>
      <div className="topup-body">
        <div className="topup-name">{bundle.name}</div>
        <div className="topup-desc">{bundle.description}</div>
      </div>
      <div className="topup-right">
        <div className="topup-price">
          <span className="topup-amount">{sym}{currency === "INR" ? price.toLocaleString("en-IN") : price}</span>
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
    initiatePayment, purchaseBatchPack, paymentLoading, paymentError, setPaymentError,
    paymentProvider, hasPayment, subscription,
  } = useBilling();

  const [billingPeriod, setBillingPeriod]   = useState("annual");
  const [loadingPlan, setLoadingPlan]       = useState(null);
  const [loadingBundle, setLoadingBundle]   = useState(null);
  const [localError, setLocalError]         = useState("");

  const plans    = getEffectivePlans();
  const bundles  = getEffectiveBundles();
  const discount = getGlobalDiscount();

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
      if (result?.status === "demo_mode" || result?.status === "success") {
        navigate("/account");
      }
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
      const result = await purchaseBatchPack?.(bundleId);
      if (result?.status === "demo_mode" || result?.status === "success") {
        navigate("/account");
      }
    } catch (e) {
      setLocalError(e.message || "Purchase failed. Please try again.");
    } finally {
      setLoadingBundle(null);
    }
  };

  const handleContactSales = () => {
    window.open("mailto:support@datiq.app?subject=Enterprise%20Inquiry&body=Hi%2C%20I%27m%20interested%20in%20DatIQ%20Enterprise.%20Please%20share%20pricing%20and%20onboarding%20details.", "_blank");
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

          {subscription?.discountPercent > 0 && !discount.active && (
            <div className="global-discount-banner coupon-discount-banner">
              <Icon name="tag" size={16} />
              <strong>{subscription.discountPercent}% coupon discount</strong> will be applied at checkout.
            </div>
          )}

          <div className="pricing-hero-controls">
            <BillingToggle value={billingPeriod} onChange={setBillingPeriod} />
            <div className="pricing-hero-actions">
              <CurrencyPicker value={currency} onChange={setCurrency} />
              {paymentProvider && <ProviderBadge provider={paymentProvider} />}
            </div>
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
            const displayPrice = resolvePrice(plan, billingPeriod, currency, rates);
            const discountedUsd = applyGlobalDiscount(displayPrice);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                displayPrice={discountedUsd}
                currency={currency}
                billingPeriod={billingPeriod}
                currentPlanId={currentPlanId}
                onSelect={handleSelect}
                loading={loadingPlan}
              />
            );
          })}
          <EnterpriseCard onContact={handleContactSales} />
        </div>

        {currency === "INR" && billingPeriod === "annual" && (
          <p className="inr-annual-note">
            <Icon name="info" size={13} />
            INR annual prices are promotional rates. Monthly INR billing converted from USD at market rates.
          </p>
        )}

        {currency === "INR" && hasPayment && paymentProvider === "razorpay" && (
          <div className="upi-note">
            <Icon name="shield" size={14} />
            <span>Pay with UPI, Net Banking, Credit/Debit card — powered by Razorpay. Compliant with DPDP Act, 2023.</span>
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
                currency={currency}
                onBuy={handleBundleBuy}
                loading={loadingBundle}
              />
            ))}
          </div>
        </div>

        {/* Referral program teaser */}
        <div className="referral-teaser">
          <div className="referral-teaser-icon"><Icon name="gift" size={22} /></div>
          <div>
            <div className="referral-teaser-title">Referral program — coming soon</div>
            <div className="referral-teaser-desc">
              Earn 10% lifetime discount for every friend you refer, or a 40% one-time discount on your current plan.
              <a href="mailto:support@datiq.app?subject=Referral%20Program" className="referral-teaser-link"> Get early access →</a>
            </div>
          </div>
        </div>

        <div className="pricing-footer">
          <div className="pricing-faq-row">
            <div className="pricing-faq-item">
              <Icon name="gift" size={16} />
              <span>Free plan includes <strong>25 trial credits</strong> at signup — no card required.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="shield" size={16} />
              <span>INR prices include 18% GST. USD prices exclude local taxes.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="refresh" size={16} />
              <span>Usage resets on the 1st of every month. Unused extractions don't roll over.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="info" size={16} />
              <span>Annual billing locks in the 20% discount for the full year, billed upfront.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
