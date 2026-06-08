// PaymentCancel.jsx — /payment/cancel — shown when user cancels checkout.
import { useSearchParams, useNavigate } from "react-router-dom";
import { clearPendingPayment } from "../lib/paymentService.js";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useEffect } from "react";

export default function PaymentCancel() {
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
