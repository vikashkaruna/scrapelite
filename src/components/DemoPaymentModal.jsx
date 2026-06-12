// DemoPaymentModal — shown when !hasPayment and user clicks a paid plan.
// Gives a visible confirmation step instead of silently upgrading the plan.
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function DemoPaymentModal({ plan, billingPeriod, currency, rates, onConfirm, onCancel }) {
  if (!plan) return null;

  const price = billingPeriod === "annual"
    ? (currency === "INR" && plan.price_inr_annual
        ? plan.price_inr_annual
        : (plan.price_usd_annual ?? plan.price_usd))
    : (currency === "INR"
        ? Math.round(convertPrice(plan.price_usd, rates, "INR"))
        : plan.price_usd);

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onCancel(); };

  return (
    <div className="dpm-backdrop" onClick={handleBackdrop}>
      <div className="dpm-card" role="dialog" aria-modal="true" aria-label="Demo checkout">
        <button className="dpm-close" onClick={onCancel} aria-label="Cancel">
          <Icon name="x" size={18} />
        </button>

        <div className="dpm-demo-badge">
          <Icon name="info" size={13} />
          Demo mode — no real payment
        </div>

        <div className="dpm-header">
          <div className="dpm-plan-name">{plan.name}</div>
          <div className="dpm-plan-tagline">{plan.tagline}</div>
          <div className="dpm-plan-price">
            {formatPrice(price, currency)}
            <span className="dpm-period">/ mo{billingPeriod === "annual" ? ", billed annually" : ""}</span>
          </div>
        </div>

        <div className="dpm-mock-payment">
          <div className="dpm-mock-label">
            <Icon name="credit-card" size={14} />
            Payment details (demo)
          </div>
          <div className="dpm-mock-field-wrap">
            <div className="dpm-mock-field dpm-mock-full">•••• •••• •••• ••••</div>
            <div className="dpm-mock-row">
              <div className="dpm-mock-field">MM / YY</div>
              <div className="dpm-mock-field">CVC</div>
            </div>
          </div>
        </div>

        <p className="dpm-notice">
          No payment gateway is configured on this server. Clicking confirm activates
          the <strong>{plan.name}</strong> plan locally for testing — no real charge is made.
          To enable real payments, configure <code>VITE_RAZORPAY_KEY_ID</code> or{" "}
          <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in your Netlify environment variables.
        </p>

        <Button variant="primary" fullWidth onClick={onConfirm}>
          Confirm — activate {plan.name} (Demo)
        </Button>
        <button className="dpm-cancel-btn" onClick={onCancel}>
          Cancel, keep current plan
        </button>
      </div>
    </div>
  );
}
