// Pricing.jsx — V5 public-facing pricing page with multi-currency support.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLANS, TOPUP_BUNDLES, CURRENCIES, CURRENCY_META } from "../lib/pricingConfig.js";
import { convertPrice, formatPrice } from "../lib/currencyService.js";
import { useBilling } from "../components/BillingProvider.jsx";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

function CurrencyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const meta = CURRENCY_META[value];
  return (
    <div className="currency-picker" style={{ position: "relative" }}>
      <button className="currency-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{meta?.flag}</span>
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

function PlanCard({ plan, price, currency, currentPlanId, onSelect }) {
  const isCurrent = plan.id === currentPlanId;
  const isFree = plan.price_usd === 0;
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
            <span className="price-amount">{formatPrice(price, currency)}</span>
            <span className="price-period"> / month</span>
          </>
        )}
      </div>
      <Button
        variant={plan.highlight ? "primary" : isCurrent ? "ghost" : "secondary"}
        size="sm"
        fullWidth
        onClick={() => onSelect(plan.id)}
        disabled={isCurrent}
      >
        {isCurrent ? "Current plan" : isFree ? "Get started free" : `Get ${plan.name}`}
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

function TopupCard({ bundle, price, currency }) {
  return (
    <div className="topup-card">
      <div className="topup-icon">
        <Icon name={bundle.icon} size={20} />
      </div>
      <div className="topup-body">
        <div className="topup-name">{bundle.name}</div>
        <div className="topup-desc">{bundle.description}</div>
      </div>
      <div className="topup-price">
        <span className="topup-amount">{formatPrice(price, currency)}</span>
        <span className="topup-unit">{bundle.unit}</span>
      </div>
    </div>
  );
}

export default function Pricing() {
  const navigate = useNavigate();
  const { currency, rates, setCurrency, planId: currentPlanId, upgradePlan } = useBilling();

  const handleSelect = (planId) => {
    upgradePlan(planId);
    navigate("/account");
  };

  const ratesToUse = rates || {};

  return (
    <div className="page pricing-page">
      <div className="container">
        <div className="pricing-hero">
          <div className="eyebrow">
            <Icon name="zap" />
            Pricing
          </div>
          <h1 className="pricing-title">Simple, transparent pricing</h1>
          <p className="pricing-sub">
            Start free. Upgrade when you need more extractions, team features, or automation.
          </p>
          <div className="pricing-hero-actions">
            <CurrencyPicker value={currency} onChange={setCurrency} />
            <span className="pricing-rates-note">
              Rates updated daily at 5:00 AM IST
            </span>
          </div>
        </div>

        <div className="plans-grid">
          {PLANS.map((plan) => {
            const price = convertPrice(plan.price_usd, ratesToUse, currency);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                price={price}
                currency={currency}
                currentPlanId={currentPlanId}
                onSelect={handleSelect}
              />
            );
          })}
        </div>

        {/* Top-up bundles */}
        <div className="topup-section">
          <div className="topup-section-head">
            <h2 className="topup-section-title">Top-up bundles</h2>
            <p className="topup-section-sub">
              Add capacity or features to any plan — no upgrade required.
            </p>
          </div>
          <div className="topup-grid">
            {TOPUP_BUNDLES.map((bundle) => {
              const price = convertPrice(bundle.price_usd, ratesToUse, currency);
              return <TopupCard key={bundle.id} bundle={bundle} price={price} currency={currency} />;
            })}
          </div>
        </div>

        {/* FAQ footer */}
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
