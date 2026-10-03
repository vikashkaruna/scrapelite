// Pricing.jsx — V6: annual/monthly toggle, USD+INR, Developer+Enterprise tiers.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  getEffectivePlans, getEffectiveBundles,
  getGlobalDiscount, applyGlobalDiscount,
} from "../lib/pricingOverrides.js";
import { CURRENCIES, CURRENCY_META, ENTERPRISE_PLAN, CREDIT_PACKS, AGENCY_OVERAGE } from "../lib/pricingConfig.js";
import { DISCOVERABILITY_BASE, discoverabilityCredits } from "../lib/credits/creditWeights.js";
import { getCouponsForPlan } from "../lib/offersService.js";
import { formatPrice } from "../lib/currencyService.js";
import { resolvePlanPrice, annualSavingsPercent } from "../lib/planPricing.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { PROVIDER_META } from "../lib/paymentConfig.js";
import { preloadRazorpay } from "../lib/paymentService.js";
import Icon from "../components/Icon.jsx";
import PricingMatrix from "../components/PricingMatrix.jsx";
import Button from "../components/Button.jsx";
import TopupBundleModal from "../components/TopupBundleModal.jsx";
import OffersBanner from "../components/OffersBanner.jsx";
import { useToast } from "../components/Toast.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { lifecycle } from "../lib/analyticsService.js";
import { seoFor } from "../lib/pageSeo.js";

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

// resolvePlanPrice / annualSavingsPercent live in lib/planPricing.js so the
// plan cards and the comparison matrix below them read ONE rule.
const resolvePrice = resolvePlanPrice;

function BillingToggle({ value, onChange }) {
  return (
    <div className="billing-toggle-wrap" role="group" aria-label="Billing period">
      <button
        type="button"
        className={"billing-toggle-btn" + (value === "monthly" ? " active" : "")}
        onClick={() => onChange("monthly")}
        aria-pressed={value === "monthly"}
        aria-label="Monthly billing"
      >
        Monthly
      </button>
      <button
        type="button"
        className={"billing-toggle-btn" + (value === "annual" ? " active" : "")}
        onClick={() => onChange("annual")}
        aria-pressed={value === "annual"}
        aria-label="Annual billing"
      >
        Annual
      </button>
    </div>
  );
}

function PlanCard({ plan, currency, billingPeriod, rates, currentPlanId, onSelect, loading }) {
  const isCurrent = plan.id === currentPlanId;
  const isFree    = plan.price_usd === 0;
  const isLoading = loading === plan.id;
  const isSoon    = plan.comingSoon;
  const isAnnual  = billingPeriod === "annual";
  const isBestValue = plan.badge === "Best Value";

  // Per-month rate for the selected period (used for the button/monthly view),
  // and the regular (undiscounted-by-billing-period) monthly rate — the "list"
  // rate the strikethrough compares against when annual is selected.
  const periodRate  = applyGlobalDiscount(resolvePrice(plan, billingPeriod, currency, rates));
  const monthlyRate = applyGlobalDiscount(resolvePrice(plan, "monthly", currency, rates));
  // Annual view: derive the charged annual total from the (already discounted)
  // annual per-month rate, and the "list" annual total from the un-discounted
  // monthly rate × 12. Both are the per-year numbers, displayed alongside their
  // /yr (per-year) and /mo (per-month) counterparts.
  const chargedAnnualTotal  = isAnnual ? Math.round(periodRate * 12) : null;
  const originalAnnualTotal = isAnnual ? Math.round(monthlyRate * 12) : null;
  const annualSavings       = isAnnual ? Math.max(0, originalAnnualTotal - chargedAnnualTotal) : 0;
  // Savings % vs. paying the monthly rate for 12 months (the "list" annual total).
  const annualSavingsPct = isAnnual && originalAnnualTotal > 0
    ? Math.round((annualSavings / originalAnnualTotal) * 1000) / 10
    : 0;

  return (
    <div className={
      "plan-card" +
      (plan.highlight ? " plan-highlight" : "") +
      (isBestValue ? " plan-best-value" : "") +
      (isSoon ? " plan-coming-soon" : "") +
      (isCurrent ? " plan-current" : "") +
      (isLoading ? " plan-selecting" : "")
    }>
      {isCurrent && (
        <div className="plan-current-badge">
          <Icon name="check-circle" size={13} />
          <span>Your plan</span>
        </div>
      )}
      {plan.badge && <div className="plan-badge">{plan.badge}</div>}
      <div className="plan-header">
        <div className="plan-name">{plan.name}</div>
        <div className="plan-tagline">{plan.tagline}</div>
      </div>
      {getCouponsForPlan(plan.id).map((c) => (
        <div key={c.id} className="plan-offer-chip">
          <Icon name={c.type === "extractions" ? "gift" : "tag"} size={12} />
          {c.type === "extractions"
            ? <span>+{c.value} bonus credits with <strong>{c.code}</strong></span>
            : <span>{c.value}% off with <strong>{c.code}</strong></span>}
        </div>
      ))}
      <div className="plan-price">
        {isFree ? (
          <><span className="price-amount">Free</span><span className="price-period"> forever</span></>
        ) : isAnnual ? (
          <div className="plan-price-annual">
            <div className="plan-price-annual-row plan-price-annual-row--top">
              <span className="price-amount">{formatPrice(chargedAnnualTotal, currency)}</span>
              <span className="price-period"> / yr</span>
              {annualSavings > 0 && (
                <span className="price-original">{formatPrice(originalAnnualTotal, currency)}</span>
              )}
            </div>
            <div className="plan-price-annual-row plan-price-annual-row--monthly">
              <span className="price-amount-sub">{formatPrice(periodRate, currency)}</span>
              <span className="price-period-sub"> / mo</span>
              {annualSavings > 0 && (
                <span className="price-original price-original--monthly">{formatPrice(monthlyRate, currency)}</span>
              )}
            </div>
            {annualSavings > 0 && (
              <div className="price-save">
                Save {formatPrice(annualSavings, currency)} ({annualSavingsPct}%)
              </div>
            )}
          </div>
        ) : (
          <>
            <span className="price-amount">{formatPrice(periodRate, currency)}</span>
            <span className="price-period"> / mo</span>
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
          <li key={f.label} className={"pf-item" + (f.included ? "" : " pf-excluded") + (f.upcoming ? " pf-upcoming" : "")}>
            <Icon name={f.included ? "check-circle" : f.upcoming ? "clock" : "x"} size={15} />
            <span>{f.label}</span>
            {f.upcoming && <span className="pf-upcoming-tag">Upcoming</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnterpriseCard({ onContact }) {
  return (
    <div className="plan-card enterprise-card">
      {ENTERPRISE_PLAN.badge && <div className="plan-badge enterprise-badge">{ENTERPRISE_PLAN.badge}</div>}
      <div className="plan-header">
        <div className="plan-name">{ENTERPRISE_PLAN.name}</div>
        <div className="plan-tagline">{ENTERPRISE_PLAN.tagline}</div>
      </div>
      <div className="plan-price">
        <span className="price-amount">Custom</span>
        <span className="price-period"> pricing</span>
      </div>
      <div className="enterprise-price-note">{ENTERPRISE_PLAN.priceNote}</div>
      <div className="enterprise-highlights">
        {ENTERPRISE_PLAN.highlights.map((h) => (
          <div key={h.label} className="enterprise-highlight">
            <strong>{h.value}</strong><span>{h.label}</span>
          </div>
        ))}
      </div>
      <Button variant="primary" size="sm" fullWidth onClick={onContact}>
        {ENTERPRISE_PLAN.cta.primary}
      </Button>
      <a className="enterprise-demo-link" href="mailto:admin@datiq.app?subject=DatIQ%20Enterprise%20demo&body=Hi%2C%20I%27d%20like%20a%20demo%20of%20DatIQ%20Enterprise.">
        {ENTERPRISE_PLAN.cta.secondary} →
      </a>
      <div className="enterprise-includes">{ENTERPRISE_PLAN.includesNote}</div>
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
        {Array.isArray(bundle.benefits) && (
          <ul className="topup-benefits">
            {bundle.benefits.map((b) => (
              <li key={b.label}><Icon name={b.icon} size={12} />{b.label}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="topup-right">
        <div className="topup-price">
          <span className="topup-amount">{sym}{currency === "INR" ? price.toLocaleString("en-IN") : price}</span>
          <span className="topup-unit">{bundle.unit}</span>
        </div>
        {onBuy && (
          <Button variant="secondary" size="sm" onClick={() => onBuy(bundle)} disabled={isLoading}>
            {isLoading ? <><Icon name="refresh" size={12} />Adding…</> : "Add to plan"}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Pricing() {
  // PQL: "visited pricing page twice within seven days" (+10). The seven-day
  // window is computed at scoring time from the event timestamps, so this only
  // has to record the visit — see pqlModel.signalsFromEvents.
  useEffect(() => { void lifecycle.pricingViewed({}); }, []);
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/pricing/index.html this page now owns.
  useSeo(seoFor("/pricing"));

  const navigate  = useNavigate();
  const showToast = useToast();
  const {
    currency, rates, setCurrency, planId: currentPlanId, plan: currentPlan,
    initiatePayment, purchaseBatchPack, paymentLoading, paymentError, setPaymentError,
    paymentProvider, hasPayment, subscription,
  } = useBilling();

  const [billingPeriod, setBillingPeriod]   = useState("monthly");
  const [loadingPlan, setLoadingPlan]       = useState(null);
  const [loadingBundle, setLoadingBundle]   = useState(null);
  const [localError, setLocalError]         = useState("");
  const [bundleModal, setBundleModal]       = useState(null);

  // v1.0 ships all 4 paid plans (Select / Pro / Business / Agency) with
  // one-time Order payments. Recurring subscription billing (Razorpay
  // Subscriptions, Stripe Subscriptions) is deferred to v2.0 — see
  // docs/RECURRING-BILLING-DEFERRAL.md.
  const plans    = getEffectivePlans();
  const bundles  = getEffectiveBundles();
  const discount = getGlobalDiscount();

  useEffect(() => { setLocalError(""); setPaymentError?.(""); }, [currency]);

  // Pre-warm the Razorpay SDK as soon as /pricing mounts so the user doesn't
  // pay the CDN round-trip cost at the moment they click "Proceed to payment".
  // Fire-and-forget: errors are surfaced later, on the actual load attempt.
  useEffect(() => { preloadRazorpay(); }, []);

  const handleSelect = async (planId) => {
    if (planId === "free") {
      initiatePayment?.("free", billingPeriod);
      navigate("/account");
      return;
    }
    setLoadingPlan(planId);
    setLocalError("");
    try {
      const result = await initiatePayment?.(planId, billingPeriod);
      // demo_mode, free, and success all navigate to /account; cancelled stays on pricing
      if (result?.status === "free") {
        showToast("Your plan is now active — 100% off applied, no payment required.");
      }
      if (result?.status === "demo_mode" || result?.status === "success" || result?.status === "free") {
        navigate("/account");
      }
    } catch (e) {
      setLocalError(e.message || "Payment initiation failed. Please try again.");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBundleClick = (bundle) => {
    setBundleModal(bundle);
  };

  const handleBundlePurchase = async (bundleId, qty) => {
    setLoadingBundle(bundleId);
    setLocalError("");
    try {
      const result = await purchaseBatchPack?.(bundleId, qty);
      if (result?.status === "demo_mode" || result?.status === "success") {
        setBundleModal(null);
        navigate("/account");
      }
    } catch (e) {
      setLocalError(e.message || "Purchase failed. Please try again.");
    } finally {
      setLoadingBundle(null);
    }
  };

  const handleUpgradeFromBundle = (planId) => {
    setBundleModal(null);
    handleSelect(planId);
  };

  const handleContactSales = () => {
    window.open("mailto:admin@datiq.app?subject=Enterprise%20Inquiry&body=Hi%2C%20I%27m%20interested%20in%20DatIQ%20Enterprise.%20Please%20share%20pricing%20and%20onboarding%20details.", "_blank");
  };

  const showError = localError || paymentError;

  return (
    <div className="page pricing-page">
      <div className="container">
        <div className="pricing-hero">
          <div className="eyebrow"><Icon name="zap" />Pricing</div>
          <h1 className="pricing-title">Simple, transparent pricing</h1>
          <p className="pricing-sub">
            Start free. Everything is priced in one unit — credits — so upgrading buys a bigger pool,
            not another allowance to keep track of.
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
          {annualSavingsPercent(plans, currency) > 0 && (
            <p className="billing-savings-note">
              Save {annualSavingsPercent(plans, currency)}% when you pay annually
            </p>
          )}

          {!hasPayment && (
            <div className="payment-demo-notice">
              <Icon name="info" size={14} />
              <span>
                <strong>Demo mode</strong> — payment not configured.
                Set <code>VITE_RAZORPAY_KEY_ID</code> + <code>RAZORPAY_KEY_ID</code> + <code>RAZORPAY_KEY_SECRET</code> in
                Netlify env vars, then redeploy to enable real Razorpay checkout.
              </span>
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
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currency={currency}
              billingPeriod={billingPeriod}
              rates={rates}
              currentPlanId={currentPlanId}
              onSelect={handleSelect}
              loading={loadingPlan}
            />
          ))}
          <EnterpriseCard onContact={handleContactSales} />
        </div>

        {currency === "INR" && (
          <p className="inr-annual-note">
            <Icon name="info" size={13} />
            {billingPeriod === "annual"
              ? "INR annual prices are promotional fixed rates, billed upfront. Prices shown exclude 18% GST, which is added at checkout."
              : "INR monthly prices are fixed — no live USD conversion. Prices shown exclude 18% GST, which is added at checkout."}
          </p>
        )}

        {currency === "INR" && hasPayment && paymentProvider === "razorpay" && (
          <div className="upi-note">
            <Icon name="shield" size={14} />
            <span>Pay with UPI, Net Banking, Credit/Debit card — powered by Razorpay. Compliant with DPDP Act, 2023.</span>
          </div>
        )}

        {/* Credit packs — the ONE thing on this page that sells credits directly.
            🔴 `CREDIT_PACKS` was imported here and never rendered, so the packs
            that replaced the removed Extractions Bundle were purchasable by the
            server and reachable from nowhere. They buy credits outright and
            NEVER expire (verify-payment grants them with no expires_at), which
            is what separates a pack from a monthly allowance. */}
        <div className="topup-section">
          <div className="topup-section-head">
            <h2 className="topup-section-title">Credit packs</h2>
            <p className="topup-section-sub">
              Need more than your plan's monthly credits? Buy a pack on any plan, including Free.
              Packs never expire.
            </p>
          </div>
          <div className="topup-grid">
            {CREDIT_PACKS.map((pack) => (
              <TopupCard
                key={pack.id}
                bundle={pack}
                currency={currency}
                onBuy={handleBundleClick}
                loading={loadingBundle}
              />
            ))}
          </div>
        </div>

        <p className="topup-plan-note">
          <Icon name="info" size={13} />
          <span>
            Credits are what you spend; capacity is what you may run. Your {currentPlan?.name || "current"} plan allows batches of up to{" "}
            <strong>{(currentPlan?.limits?.batch_max_urls || 0) + (subscription?.bonusBatchUrls || 0)}</strong> URLs,{" "}
            <strong>{currentPlan?.limits?.bulk_list_max ?? currentPlan?.limits?.batch_max_urls ?? 0}</strong>-row account lists,{" "}
            <strong>{currentPlan?.limits?.scheduled_monitoring ?? 0}</strong> scheduled {(currentPlan?.limits?.scheduled_monitoring ?? 0) === 1 ? "monitor" : "monitors"} and{" "}
            <strong>{currentPlan?.limits?.workspaces ?? 1}</strong> {(currentPlan?.limits?.workspaces ?? 1) === 1 ? "workspace" : "workspaces"} — buying credits does not change those.
            Raise them with the capacity bundles below.
          </span>
        </p>

        <div className="topup-section">
          <div className="topup-section-head">
            <h2 className="topup-section-title">Top-up bundles</h2>
            <p className="topup-section-sub">
              Unlock a capability on any plan — no upgrade required. An add-on buys the
              right to do something; the doing still costs credits.
            </p>
          </div>
          <div className="topup-grid">
            {[...bundles].filter((b) => !b.hidden).sort((a, b) => a.price_usd - b.price_usd).map((bundle) => (
              <TopupCard
                key={bundle.id}
                bundle={bundle}
                currency={currency}
                onBuy={handleBundleClick}
                loading={loadingBundle}
              />
            ))}
          </div>
        </div>

        {/* Referral program teaser */}
        <div className="referral-teaser">
          <div className="referral-teaser-icon"><Icon name="gift" size={22} /></div>
          <div>
            <div className="referral-teaser-title">Invite a friend, you both get 25 credits</div>
            <div className="referral-teaser-desc">
              Sign in and share your invite link. When someone creates an account through it,
              25 credits are added to their account and 25 to yours — every time. They never expire.
              <a href="mailto:hello@datiq.app?subject=Referral%20Program" className="referral-teaser-link"> Questions? Talk to us →</a>
            </div>
          </div>
        </div>

        {/* F13 — tier × feature comparison matrix */}
        <PricingMatrix
          currentPlanId={currentPlanId}
          currency={currency}
          billingPeriod={billingPeriod}
          rates={rates}
          onSelectPlan={handleSelect}
        />

        <div className="pricing-footer">
          <div className="pricing-faq-row">
            <div className="pricing-faq-item">
              <Icon name="gift" size={16} />
              <span>Free plan includes <strong>500 credits</strong> at signup — no card required, and they never expire.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="shield" size={16} />
              <span>INR prices exclude 18% GST, added at checkout. USD prices exclude local taxes.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="refresh" size={16} />
              <span>Your plan's credits renew on the 1st. Unused credits roll over for one month, so you can hold at most two months' worth.</span>
            </div>
            <div className="pricing-faq-item">
              <Icon name="info" size={16} />
              <span>Annual billing locks in your discount for the full year, billed upfront.</span>
            </div>
          </div>
        </div>
      </div>

      {bundleModal && (
        <TopupBundleModal
          bundle={bundleModal}
          currency={currency}
          rates={rates}
          currentPlanId={currentPlanId}
          onClose={() => setBundleModal(null)}
          onPurchase={handleBundlePurchase}
          onUpgrade={handleUpgradeFromBundle}
          loading={loadingBundle === bundleModal?.id}
        />
      )}
    </div>
  );
}
