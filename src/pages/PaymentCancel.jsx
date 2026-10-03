// PaymentCancel.jsx — /payment/cancel — shown when user cancels checkout.
import { useSearchParams, useNavigate } from "react-router";
import { clearPendingPayment } from "../lib/paymentService.js";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import { useSeo } from "../hooks/useSeo.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useEffect } from "react";

export default function PaymentCancel() {
  useSeo({
    title: "Payment cancelled — no charge was made | DatIQ.app",
    description:
      "DatIQ payment cancelled — no charge was made. Your existing plan and extractions are unchanged. DatIQ.app is the AI-enabled web data extraction platform for marketers and researchers.",
    canonical: "https://datiq.app/payment/cancel",
    robots: "noindex, nofollow",
  });
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const planId   = params.get("plan");
  const plan     = planId ? getEffectivePlanById(planId) : null;

  useEffect(() => { clearPendingPayment(); }, []);

  return (
    <div className="payment-page">
      <div className="payment-card">
        <div className="payment-icon-ring cancelled"><Icon name="x" size={28} /></div>
        <h1 className="payment-title">Checkout cancelled</h1>
        <p className="payment-sub">
          No charge was made.{plan ? ` You can upgrade to ${plan.name} anytime.` : ""}
        </p>
        <div className="payment-actions">
          <Button variant="primary" onClick={() => navigate("/pricing")}>View pricing</Button>
          <Button variant="ghost"   onClick={() => navigate("/")}>Back to app</Button>
        </div>
      </div>
    </div>
  );
}
