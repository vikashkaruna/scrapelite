// paymentConfig.js — Layer 1: payment provider configuration (Stripe + Razorpay/UPI).
// Reads env vars; exposes routing logic. Never import this directly in UI — use
// paymentService.js (Layer 2) instead.

export const STRIPE_PUBLISHABLE_KEY     = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY     || "";
export const RAZORPAY_KEY_ID            = import.meta.env.VITE_RAZORPAY_KEY_ID            || "";
export const PAYMENT_PROVIDER_OVERRIDE  = import.meta.env.VITE_PAYMENT_PROVIDER           || "auto";

export const hasStripe   = Boolean(STRIPE_PUBLISHABLE_KEY);
export const hasRazorpay = Boolean(RAZORPAY_KEY_ID);
export const hasPayment  = hasStripe || hasRazorpay;
// Local demos may opt in explicitly; production must never grant a paid plan
// merely because payment configuration is absent.
export const demoBillingEnabled = import.meta.env.VITE_ENABLE_DEMO_BILLING === "true";

// Stripe recurring price IDs (create in Stripe Dashboard → Products → Add price → Recurring)
export const STRIPE_PRICE_IDS = {
  select:               import.meta.env.VITE_STRIPE_PRICE_SELECT            || "",
  pro:                  import.meta.env.VITE_STRIPE_PRICE_PRO               || "",
  business:             import.meta.env.VITE_STRIPE_PRICE_BUSINESS          || "",
  agency:               import.meta.env.VITE_STRIPE_PRICE_AGENCY            || "",
  "extractions-bundle": import.meta.env.VITE_STRIPE_PRICE_EXTRACTIONS_BUNDLE || "",
  "scheduler-addon":    import.meta.env.VITE_STRIPE_PRICE_SCHEDULER_ADDON   || "",
  "hubspot-addon":      import.meta.env.VITE_STRIPE_PRICE_HUBSPOT_ADDON     || "",
};

// Razorpay subscription plan IDs (create in Razorpay Dashboard → Subscriptions → Plans)
export const RAZORPAY_PLAN_IDS = {
  select:   import.meta.env.VITE_RAZORPAY_PLAN_SELECT   || "",
  pro:      import.meta.env.VITE_RAZORPAY_PLAN_PRO       || "",
  business: import.meta.env.VITE_RAZORPAY_PLAN_BUSINESS  || "",
  agency:   import.meta.env.VITE_RAZORPAY_PLAN_AGENCY    || "",
};

// Razorpay handles INR (the only non-USD currency DatIQ supports). USD → Stripe.
export const RAZORPAY_CURRENCIES = ["INR"];

// Auto-route: INR → Razorpay, everything else → Stripe.
// Override via VITE_PAYMENT_PROVIDER=stripe|razorpay.
export function getPaymentProvider(currency) {
  if (PAYMENT_PROVIDER_OVERRIDE === "stripe"   && hasStripe)   return "stripe";
  if (PAYMENT_PROVIDER_OVERRIDE === "razorpay" && hasRazorpay) return "razorpay";
  if (RAZORPAY_CURRENCIES.includes(currency) && hasRazorpay)  return "razorpay";
  if (hasStripe)   return "stripe";
  if (hasRazorpay) return "razorpay";
  return null;
}

export const PROVIDER_META = {
  stripe:   { name: "Stripe",   icon: "credit-card", badge: "Secured by Stripe",   color: "#635bff" },
  razorpay: { name: "Razorpay", icon: "shield",       badge: "Powered by Razorpay", color: "#072654" },
};
