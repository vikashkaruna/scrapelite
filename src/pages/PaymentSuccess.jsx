// PaymentSuccess.jsx — /payment/success — confirms payment and activates plan.
// Stripe: GET params  provider=stripe & session_id=... & plan=...
// Razorpay: GET params provider=razorpay & plan=... & payment_id=...
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useBilling } from "../components/BillingProvider.jsx";
import { confirmStripeSession, clearPendingPayment } from "../lib/paymentService.js";
import { logPaymentEvent } from "../lib/paymentRepo.js";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import { useSeo } from "../hooks/useSeo.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

// Auto-redirect countdown after success
const REDIRECT_DELAY_MS = 5000;

export default function PaymentSuccess() {
  useSeo({
    title: "Payment successful — welcome to DatIQ | DatIQ.app",
    description:
      "Welcome to DatIQ — your payment was successful and your plan is now active. Start extracting structured data from any URL. DatIQ.app is the AI-enabled web data extraction platform.",
    canonical: "https://datiq.app/payment/success",
    robots: "noindex, nofollow",
  });
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const { upgradePlan, confirmPayment } = useBilling();

  const provider    = params.get("provider") || "stripe";
  const planId      = params.get("plan");
  const sessionId   = params.get("session_id");   // Stripe session ID
  const paymentId   = params.get("payment_id");   // Razorpay payment ID (optional)

  const [status, setStatus]       = useState("verifying"); // verifying | success | error
  const [planName, setPlanName]   = useState(planId || "");
  const [error, setError]         = useState("");
  const [countdown, setCountdown] = useState(Math.ceil(REDIRECT_DELAY_MS / 1000));
  const [amount, setAmount]       = useState(null);
  const [currency, setCurrency]   = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        let verified       = false; // controls success display
        let grant          = false; // controls whether THIS page upgrades the plan
        let resolvedPlanId = planId;

        if (provider === "stripe" && sessionId) {
          const result = await confirmStripeSession(sessionId);
          if (result?.verified) {
            verified       = true;
            grant          = true; // Stripe is verified server-side here
            resolvedPlanId = result.planId || planId;
            setAmount(result.amountTotal);
            setCurrency(result.currency);
            await logPaymentEvent({
              type:        "checkout.session.completed",
              provider:    "stripe",
              providerId:  sessionId,
              planId:      resolvedPlanId,
              amountCents: result.amountTotal,
              currency:    result.currency,
            });
          }
        } else if (provider === "razorpay") {
          // Razorpay uses the handler-function flow: signature verification, capture
          // confirmation, activation, and the payment-event log ALL happen in the modal
          // handler + BillingProvider before navigation. This page is DISPLAY-ONLY for
          // Razorpay — we must NOT grant a plan here (prevents deep-link access abuse).
          verified       = true;
          grant          = false;
          resolvedPlanId = planId;
        } else {
          // Demo mode or direct navigation — treat as success (local-only)
          verified = true;
          grant    = true;
        }

        if (!cancelled && verified && resolvedPlanId) {
          if (grant) {
            upgradePlan(resolvedPlanId);
            await confirmPayment?.(resolvedPlanId, { provider });
          }
          clearPendingPayment();
          setPlanName(getEffectivePlanById(resolvedPlanId)?.name || resolvedPlanId);
          setStatus("success");
        } else if (!cancelled) {
          setStatus("error");
          setError("We could not verify your payment. Please contact hello@datiq.app.");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e.message || "Verification failed. Please contact hello@datiq.app.");
        }
      }
    }

    verify();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-redirect countdown after success
  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) { navigate("/"); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown, navigate]);

  // ── Verifying state ───────────────────────────────────────────────────────
  if (status === "verifying") {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <div className="payment-icon-ring pending"><Icon name="refresh" size={28} /></div>
          <h1 className="payment-title">Confirming your payment…</h1>
          <p className="payment-sub">Just a moment while we activate your plan.</p>
          <div className="pps-loading-steps">
            <div className="pps-loading-step active">
              <Icon name="shield"      size={14} /><span>Verifying with {provider}</span>
            </div>
            <div className="pps-loading-step pending">
              <Icon name="zap"         size={14} /><span>Activating plan</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <div className="payment-icon-ring error"><Icon name="alert-circle" size={28} /></div>
          <h1 className="payment-title">Payment not confirmed</h1>
          <p className="payment-sub">{error}</p>
          <div className="payment-details">
            <div className="pd-row">
              <span>Next step</span>
              <span style={{ color: "var(--text)", fontWeight: 700 }}>Contact support</span>
            </div>
            {paymentId && (
              <div className="pd-row">
                <span>Payment ID</span>
                <code style={{ fontSize: ".82em", color: "var(--text)", fontWeight: 700 }}>{paymentId}</code>
              </div>
            )}
            {sessionId && (
              <div className="pd-row">
                <span>Session ID</span>
                <code style={{ fontSize: ".82em", color: "var(--text)" }}>{sessionId.slice(0, 24)}…</code>
              </div>
            )}
          </div>
          <p className="payment-sub" style={{ marginTop: 8, fontSize: ".84em", color: "var(--text-3)" }}>
            Email <strong>hello@datiq.app</strong> with the details above and we'll resolve it within 24 hours.
          </p>
          <div className="payment-actions">
            <Button variant="primary" onClick={() => navigate("/pricing")}>Back to Pricing</Button>
            <Button variant="ghost"   onClick={() => navigate("/")}>Back to app</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────────
  return (
    <div className="payment-page">
      <div className="payment-card">
        <div className="payment-icon-ring success"><Icon name="check-circle" size={32} /></div>
        <h1 className="payment-title">Payment successful!</h1>
        <p className="payment-sub">
          Welcome to <strong>{planName}</strong> — your plan has been activated.
        </p>

        <div className="payment-details">
          <div className="pd-row">
            <span>Plan</span>
            <strong>{planName}</strong>
          </div>
          <div className="pd-row">
            <span>Provider</span>
            <strong style={{ textTransform: "capitalize" }}>{provider}</strong>
          </div>
          {amount && currency && (
            <div className="pd-row">
              <span>Amount</span>
              <strong>
                {currency.toUpperCase() === "INR"
                  ? `₹${(amount / 100).toLocaleString("en-IN")}`
                  : `$${(amount / 100).toFixed(2)}`}
              </strong>
            </div>
          )}
          {paymentId && (
            <div className="pd-row">
              <span>Payment ID</span>
              <code style={{ fontSize: ".82em", color: "var(--text)" }}>{paymentId}</code>
            </div>
          )}
          <div className="pd-row">
            <span>Status</span>
            <span className="status-badge active">Active</span>
          </div>
        </div>

        <div className="pps-redirect-note">
          <Icon name="arrow-right" size={14} />
          <span>Redirecting to app in <strong>{countdown}s</strong>…</span>
        </div>

        <div className="payment-actions">
          <Button variant="primary" onClick={() => navigate("/")}>Start extracting</Button>
          <Button variant="ghost"   onClick={() => navigate("/account")}>View account</Button>
        </div>
      </div>
    </div>
  );
}
