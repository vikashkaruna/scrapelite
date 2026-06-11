// PaymentSuccess.jsx — /payment/success — confirms payment and activates plan.
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useBilling } from "../components/BillingProvider.jsx";
import { confirmStripeSession, clearPendingPayment } from "../lib/paymentService.js";
import { logPaymentEvent } from "../lib/paymentRepo.js";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

export default function PaymentSuccess() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const { upgradePlan, confirmPayment } = useBilling();

  const provider  = params.get("provider") || "stripe";
  const planId    = params.get("plan");
  const sessionId = params.get("session_id");   // Stripe checkout session ID

  const [status, setStatus]   = useState("verifying"); // verifying | success | error
  const [planName, setPlanName] = useState(planId || "");
  const [error, setError]      = useState("");

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        let verified = false;
        let resolvedPlanId = planId;

        if (provider === "stripe" && sessionId) {
          const result = await confirmStripeSession(sessionId);
          if (result?.verified) {
            verified = true;
            resolvedPlanId = result.planId || planId;
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
          // Razorpay verification already happened in the modal handler;
          // if we're on this page, payment was confirmed by the frontend.
          verified      = true;
          resolvedPlanId = planId;
          await logPaymentEvent({
            type:     "payment.captured",
            provider: "razorpay",
            planId:   resolvedPlanId,
          });
        } else {
          // Demo mode or direct navigation — treat as success
          verified = true;
        }

        if (!cancelled && verified && resolvedPlanId) {
          upgradePlan(resolvedPlanId);
          await confirmPayment?.(resolvedPlanId, { provider });
          clearPendingPayment();
          setPlanName(getEffectivePlanById(resolvedPlanId)?.name || resolvedPlanId);
          setStatus("success");
        } else if (!cancelled) {
          setStatus("error");
          setError("We could not verify your payment. Please contact support.");
        }
      } catch (e) {
        if (!cancelled) { setStatus("error"); setError(e.message); }
      }
    }

    verify();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === "verifying") {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <div className="payment-icon-ring pending"><Icon name="refresh" size={28} /></div>
          <h1 className="payment-title">Confirming your payment…</h1>
          <p className="payment-sub">Just a moment while we activate your plan.</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <div className="payment-icon-ring error"><Icon name="alert-circle" size={28} /></div>
          <h1 className="payment-title">Payment not confirmed</h1>
          <p className="payment-sub">{error}</p>
          <p className="payment-sub" style={{ marginTop: 8, fontSize: ".84em", color: "var(--text-3)" }}>
            If your card was charged, please email <strong>support@datiq.app</strong> with your payment reference.
          </p>
          <div className="payment-actions">
            <Button variant="primary" onClick={() => navigate("/pricing")}>Back to Pricing</Button>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="pd-row">
            <span>Status</span>
            <span className="status-badge active">Active</span>
          </div>
        </div>
        <div className="payment-actions">
          <Button variant="primary" onClick={() => navigate("/")}>Start extracting</Button>
          <Button variant="ghost"   onClick={() => navigate("/account")}>View account</Button>
        </div>
      </div>
    </div>
  );
}
