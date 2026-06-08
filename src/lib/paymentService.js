// paymentService.js — Layer 2: payment orchestration (Stripe + Razorpay/UPI).
// Called by BillingProvider (Layer 3). Never calls UI code directly.

import {
  hasPayment, hasStripe, hasRazorpay,
  STRIPE_PRICE_IDS, RAZORPAY_KEY_ID,
  getPaymentProvider,
} from "./paymentConfig.js";
import { getEffectivePlanById } from "./pricingOverrides.js";
import { convertPrice } from "./currencyService.js";

const PENDING_KEY = "scrapelite.pendingPayment";
const FUNCTIONS   = "/.netlify/functions";

// ── Pending payment (survives Stripe redirect) ──────────────────────────────
export function savePendingPayment(data) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {}
}
export function readPendingPayment() {
  try {
    const d = JSON.parse(localStorage.getItem(PENDING_KEY));
    if (!d) return null;
    if (Date.now() - d.savedAt > 30 * 60 * 1000) { clearPendingPayment(); return null; }
    return d;
  } catch { return null; }
}
export function clearPendingPayment() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

// ── Razorpay SDK (loaded from CDN on demand) ─────────────────────────────────
let rzpLoaded = false;
async function loadRazorpay() {
  if (rzpLoaded || window.Razorpay) { rzpLoaded = true; return; }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload  = () => { rzpLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Could not load Razorpay SDK. Check your network connection."));
    document.head.appendChild(s);
  });
}

// ── Stripe Checkout ───────────────────────────────────────────────────────────
async function initiateStripeCheckout({ planId, currency, rates, discountPercent, sessionId, email }) {
  const plan    = getEffectivePlanById(planId);
  const priceId = STRIPE_PRICE_IDS[planId];

  if (!priceId) {
    // No Stripe price ID configured — open mailto contact
    window.open(
      `mailto:hello@scrapelite.io?subject=${encodeURIComponent(`Upgrade to ${plan.name}`)}&body=${encodeURIComponent(`Hi,\n\nI'd like to upgrade to the ${plan.name} plan ($${plan.price_usd}/mo).\n\nSession: ${sessionId}`)}`,
      "_blank"
    );
    return { status: "contact_sales" };
  }

  const resp = await fetch(`${FUNCTIONS}/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider:     "stripe",
      planId,
      priceId,
      currency,
      discountPercent: discountPercent || 0,
      sessionId,
      email:        email || null,
      successUrl:   `${window.location.origin}/payment/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
      cancelUrl:    `${window.location.origin}/payment/cancel?plan=${planId}`,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create checkout session. Please try again.");
  }

  const { url } = await resp.json();
  savePendingPayment({ provider: "stripe", planId, currency });
  window.location.href = url;
  return { status: "redirecting" };
}

// ── Razorpay Checkout (modal, supports UPI/cards/netbanking) ─────────────────
async function initiateRazorpayCheckout({ planId, currency, rates, discountPercent, sessionId, email }) {
  const plan = getEffectivePlanById(planId);
  await loadRazorpay();

  const rzpCurrency = ["INR"].includes(currency) ? "INR" : "USD";
  const baseUsd     = plan.price_usd * (1 - (discountPercent || 0) / 100);
  const finalAmount = Math.round(convertPrice(baseUsd, rates, rzpCurrency) * 100); // paise / cents

  const resp = await fetch(`${FUNCTIONS}/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "razorpay",
      planId,
      currency:  rzpCurrency,
      amount:    finalAmount,
      sessionId,
      email:     email || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create payment order. Please try again.");
  }

  const { orderId, amount: orderAmount, currency: orderCurrency } = await resp.json();

  return new Promise((resolve, reject) => {
    const options = {
      key:         RAZORPAY_KEY_ID,
      amount:      orderAmount,
      currency:    orderCurrency,
      name:        "ScrapeLite",
      description: `${plan.name} Plan — monthly`,
      order_id:    orderId,
      prefill:     { email: email || "" },
      notes:       { planId, sessionId },
      theme:       { color: "#6366f1" },
      handler: async (response) => {
        try {
          const verifyResp = await fetch(`${FUNCTIONS}/verify-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider:  "razorpay",
              orderId:   response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
              planId,
              sessionId,
            }),
          });
          const result = await verifyResp.json();
          if (result.verified) {
            resolve({
              status:    "success",
              provider:  "razorpay",
              planId,
              paymentId: response.razorpay_payment_id,
              orderId:   response.razorpay_order_id,
              amount:    orderAmount,
              currency:  orderCurrency,
            });
          } else {
            reject(new Error("Payment verification failed. Please contact support with your payment ID."));
          }
        } catch (e) { reject(e); }
      },
      modal: { ondismiss: () => resolve({ status: "cancelled" }) },
    };
    new window.Razorpay(options).open();
  });
}

// ── Top-up bundle checkout ───────────────────────────────────────────────────
export async function initiateTopupCheckout({ bundleId, currency, rates, sessionId, email }) {
  const provider = getPaymentProvider(currency);
  if (!provider) return { status: "contact_sales" };

  const plan = { price_usd: 0, name: bundleId }; // resolved in backend from bundleId
  const priceId = STRIPE_PRICE_IDS[bundleId] || "";

  if (provider === "stripe") {
    return initiateStripeCheckout({ planId: bundleId, currency, rates, discountPercent: 0, sessionId, email });
  }
  // Razorpay top-up (one-time payment)
  return initiateRazorpayCheckout({ planId: bundleId, currency, rates, discountPercent: 0, sessionId, email });
}

// ── Main entry point ─────────────────────────────────────────────────────────
export async function initiateCheckout({ planId, currency, rates, discountPercent, sessionId, email }) {
  if (!hasPayment) return { status: "demo_mode" };

  const provider = getPaymentProvider(currency);
  if (!provider) return { status: "contact_sales" };

  if (provider === "stripe")   return initiateStripeCheckout({ planId, currency, rates, discountPercent, sessionId, email });
  if (provider === "razorpay") return initiateRazorpayCheckout({ planId, currency, rates, discountPercent, sessionId, email });
  return { status: "contact_sales" };
}

// ── Stripe session verification (for /payment/success) ───────────────────────
export async function confirmStripeSession(stripeSessionId) {
  try {
    const resp = await fetch(
      `${FUNCTIONS}/verify-payment?provider=stripe&session_id=${encodeURIComponent(stripeSessionId)}`
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export { hasPayment, getPaymentProvider };
