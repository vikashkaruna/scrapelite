// paymentService.js — Layer 2: payment orchestration (Stripe + Razorpay/UPI).
// Called by BillingProvider. Never calls UI code directly.

import {
  hasPayment,
  STRIPE_PRICE_IDS, RAZORPAY_KEY_ID,
  getPaymentProvider,
} from "./paymentConfig.js";
import { getEffectivePlanById } from "./pricingOverrides.js";
import { convertPrice } from "./currencyService.js";

const PENDING_KEY = "datiq.pendingPayment";
const FUNCTIONS   = "/api";

// ── Payment stage constants (consumed by PaymentProcessingModal via BillingProvider) ─
export const PAYMENT_STAGE = {
  IDLE:        "idle",
  PREPARING:   "preparing",    // creating order / Stripe session
  PORTAL_OPEN: "portal_open",  // Razorpay modal is open (user is interacting)
  VERIFYING:   "verifying",    // HMAC verification in progress
  ACTIVATING:  "activating",   // plan activation in progress
  CANCELLED:   "cancelled",    // user dismissed Razorpay modal without paying
  ERROR:       "error",        // payment failed at any stage
};

export const PAYMENT_STAGE_LABELS = {
  [PAYMENT_STAGE.PREPARING]:   "Setting up your payment…",
  [PAYMENT_STAGE.PORTAL_OPEN]: "Complete your payment in the secure portal",
  [PAYMENT_STAGE.VERIFYING]:   "Verifying payment…",
  [PAYMENT_STAGE.ACTIVATING]:  "Activating your plan…",
  [PAYMENT_STAGE.CANCELLED]:   "Payment cancelled — no charge was made.",
  [PAYMENT_STAGE.ERROR]:       "Payment failed. Please try again.",
};

// ── Pending payment (survives Stripe redirect; 30-min TTL) ───────────────────
export function savePendingPayment(data) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {}
}

// ── Debug helper exposed on window for diagnosing checkout issues ─────────────
// Operators can run this from the browser console when payment fails:
//   window.__datiqDiagnoseRazorpay__()
// It reports whether the SDK is loaded, which source served it, and whether
// the local proxy + CDN are reachable from the current network.
if (typeof window !== "undefined") {
  window.__datiqDiagnoseRazorpay__ = async function diagnoseRazorpay() {
    const rzp = !!window.Razorpay;
    const tags = Array.from(document.querySelectorAll("script[data-rzp-state]")).map((t) => ({
      src: t.src,
      state: t.dataset.rzpState,
    }));
    const probe = async (url) => {
      try {
        const r = await fetch(url, { method: "GET" });
        return r.ok ? `reachable (${r.status})` : `status-${r.status}`;
      } catch (e) {
        return `blocked: ${e?.message || e}`;
      }
    };
    const proxy = await probe("/api/razorpay-sdk");
    const cdn   = await probe("https://checkout.razorpay.com/v1/checkout.js");
    const out = { rzpLoaded: rzp, scriptTags: tags, proxy, cdn };
    console.info("[DatIQ diagnose] Razorpay:", out);
    return out;
  };
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

// ── Razorpay SDK loader (lazy, from the official Razorpay CDN) ───────────────
//
// History of the bugs this has fixed:
//   v1: no timeout, no dedupe, no pre-load. Users waited 30s+ on "Setting up
//       payment…" or saw the modal fail with no recourse.
//   v2: added preloadRazorpay() + 10s timeout + concurrent-call dedup, but
//       the pre-load left a failed <script> in the DOM that the real call
//       then attached fresh listeners to — hanging forever.
//   v3: tracked script lifecycle in a dataset state so "Try again" actually
//       retried. But the script STILL failed to load in a real production
//       environment (verified on the Netlify branch deploy) — ad blockers,
//       privacy extensions, corporate firewalls, strict CSP, and some
//       Netlify edge configurations all treat checkout.razorpay.com as
//       suspicious, and the user has no way past that.
//   v4: route the SDK through a SAME-ORIGIN Netlify Function
//       (netlify/functions/razorpay-sdk.js) that proxies checkout.razorpay.com
//       with an immutable 24h cache. The browser sees a same-origin script
//       load, which is the unblocked case for every extension and every
//       network policy. If the proxy 404s (local dev without `netlify dev`)
//       or returns 502, the loader falls back to the direct CDN URL.
//   v5 (this version): revert the source priority. Razorpay's SDK does its
//       own integrity check via document.currentScript.src — when the script
//       is served from any non-Razorpay origin (same-origin proxy included),
//       the SDK throws "Invalid script source" and refuses to initialise.
//       So the same-origin proxy that solved the ad-blocker problem actively
//       breaks the SDK today. The fix is the opposite of v4: load from the
//       official Razorpay CDN, and rely on the CSP `script-src` whitelisting
//       added in 017bfbe (script-src includes https://checkout.razorpay.com)
//       to keep the browser happy. The proxy function is still deployed
//       (kept for cache-warm diagnostics) but no longer referenced here.
//
// Source priority (first success wins):
//   1. https://checkout.razorpay.com/v1/checkout.js  (Razorpay's official
//                                                       CDN — required for the
//                                                       SDK's own integrity check)
//   2. Surface a final error to the user (likely an ad blocker, content
//      blocker, or strict firewall blocking checkout.razorpay.com)
let rzpLoaded = false;
let rzpLoadingPromise = null;
const RZP_LOAD_TIMEOUT_MS = 10000;
const RZP_SOURCES = [
  "https://checkout.razorpay.com/v1/checkout.js",
];

function makeRzpLoadError(detail) {
  return new Error(
    "Unable to load the payment portal. " +
    "This is almost always caused by an ad blocker, content blocker, or " +
    "strict firewall blocking checkout.razorpay.com — please allow scripts " +
    "from checkout.razorpay.com and try again. " +
    "If the issue persists, contact hello@datiq.app." +
    (detail ? ` (${detail})` : "")
  );
}

function makeRzpTimeoutError(src) {
  return new Error(
    `The payment portal took too long to load (${src}). ` +
    "Please check your connection and try again."
  );
}

export function preloadRazorpay() {
  // Fire-and-forget. Called from Pricing.jsx on mount so the SDK is warm by
  // the time the user clicks "Proceed to payment". Errors are swallowed here —
  // the real load happens again in loadRazorpay() which surfaces a clean error.
  loadRazorpay().catch(() => { /* pre-warm only; surface the error on the real call */ });
}

// Load a single <script src="src"> with a timeout. Resolves on the script's
// `load` event; rejects on `error` or timeout. Marks the element with
// data-rzp-state so a subsequent retry can recognise a dead element.
function loadScriptFrom(src) {
  return new Promise((resolve, reject) => {
    // Clean up any prior attempt at THIS exact src (failed or pending) so
    // a retry always starts from a clean slate. We don't touch other srcs —
    // the proxy and CDN are independent.
    document.querySelectorAll(`script[src="${src}"]`).forEach((n) => n.remove());

    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.dataset.rzpState = "pending";

    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      s.dataset.rzpState = "loaded";
      resolve();
    };
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      s.dataset.rzpState = "error";
      reject(err);
    };

    s.addEventListener("load", settleResolve);
    s.addEventListener("error", () => {
      if (typeof console !== "undefined") {
        console.warn("[DatIQ] Razorpay SDK failed to load:", { src, event: "error" });
      }
      settleReject(new Error(`script src=${src} failed to load`));
    });

    const timer = setTimeout(() => {
      settleReject(makeRzpTimeoutError(src));
    }, RZP_LOAD_TIMEOUT_MS);
    s.addEventListener("load",  () => clearTimeout(timer), { once: true });
    s.addEventListener("error", () => clearTimeout(timer), { once: true });

    document.head.appendChild(s);
  });
}

export async function loadRazorpay() {
  // Fast path — already loaded
  if (rzpLoaded || window.Razorpay) { rzpLoaded = true; return; }
  // Dedup concurrent calls — if a load is already in flight, wait on it
  if (rzpLoadingPromise) return rzpLoadingPromise;

  // Clean up any previously-failed elements we don't recognise (HMR-safe)
  document.querySelectorAll('script[data-rzp-state="error"],script[data-rzp-state="timeout"]')
    .forEach((n) => n.remove());

  rzpLoadingPromise = (async () => {
    let lastError = null;
    for (const src of RZP_SOURCES) {
      try {
        await loadScriptFrom(src);
        rzpLoaded = true;
        return;
      } catch (e) {
        lastError = e;
        if (typeof console !== "undefined") {
          console.info("[DatIQ] Razorpay source failed, trying next:", { src, error: e.message });
        }
        // Continue to next source
      }
    }
    // All sources failed — surface the LAST error wrapped in our user-facing message
    throw makeRzpLoadError(lastError?.message);
  })();

  try {
    await rzpLoadingPromise;
  } finally {
    rzpLoadingPromise = null;
  }
}

// ── fetch with timeout + retries ────────────────────────────────────────────
async function fetchSafe(url, options, retries = 2, timeoutMs = 12000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return resp;
    } catch (e) {
      clearTimeout(timer);
      const isTimeout = e.name === "AbortError";
      const isNetwork = !isTimeout;
      if (typeof console !== "undefined") {
        console.warn("[DatIQ] fetchSafe error:", { url, attempt, error: e?.message || e });
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1200));
        continue;
      }
      if (isTimeout) throw new Error("The request timed out. Please check your connection and try again.");
      throw new Error("Network error. Please check your internet connection and try again.");
    }
  }
}

// ── Normalize phone to +{countrycode}{number} (Razorpay prefers this; default +91) ─
function normalizeContact(mobile) {
  if (!mobile) return "";
  const trimmed = String(mobile).trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  // 10-digit Indian numbers → prefix +91; otherwise return digits with leading +
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

// ── Razorpay payment.failed error classifier ─────────────────────────────────
function describeRazorpayFailure(code, description, reason) {
  const lc = ((code || "") + " " + (description || "") + " " + (reason || "")).toLowerCase();
  if (lc.includes("insufficient") || lc.includes("bap002"))
    return "Payment declined — insufficient funds. Please try a different payment method.";
  if (lc.includes("declined") || lc.includes("refused") || lc.includes("bap001"))
    return "Your payment was declined by the bank. Please try a different card or contact your bank.";
  if (lc.includes("authentication") || lc.includes("bau002") || lc.includes("payment_failed"))
    return "Payment authentication failed (OTP/3D Secure). Please retry and complete the verification step.";
  if (lc.includes("invalid card") || lc.includes("invalid_card"))
    return "Invalid card details. Please double-check your card number, expiry, and CVV.";
  if (lc.includes("upi") && (lc.includes("fail") || lc.includes("error")))
    return "UPI payment failed. Please verify your UPI ID or try a different payment method.";
  if (lc.includes("network") || lc.includes("timeout"))
    return "Network error during payment. Please check your connection and try again.";
  if (lc.includes("expired"))
    return "Payment session expired. Please try again.";
  return `Payment failed${description ? `: ${description}` : ""}. Please try a different method or contact hello@datiq.app.`;
}

// ── Stripe Checkout (redirect flow) ─────────────────────────────────────────
async function initiateStripeCheckout({ planId, currency, rates, billingPeriod, couponCode, qty = 1, sessionId, email, mobile, onStageChange }) {
  const plan    = getEffectivePlanById(planId);
  const priceId = STRIPE_PRICE_IDS[planId];

  if (!priceId) {
    window.open(
      `mailto:hello@datiq.app?subject=${encodeURIComponent(`Upgrade to ${plan.name}`)}&body=${encodeURIComponent(
        `Hi,\n\nI'd like to upgrade to the ${plan.name} plan ($${plan.price_usd}/mo).\n\nSession: ${sessionId}`
      )}`,
      "_blank"
    );
    return { status: "contact_sales" };
  }

  onStageChange?.(PAYMENT_STAGE.PREPARING, "Creating your checkout session…");

  let resp;
  try {
    resp = await fetchSafe(`${FUNCTIONS}/create-checkout`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        provider:        "stripe",
        planId,
        priceId,
        currency,
        billingPeriod:   billingPeriod || "monthly",
        couponCode:      couponCode || undefined,
        qty:             qty > 1 ? qty : undefined,
        sessionId,
        email:           email || null,
        mobile:          mobile || null,
        successUrl:      `${window.location.origin}/payment/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
        cancelUrl:       `${window.location.origin}/payment/cancel?plan=${planId}`,
      }),
    });
  } catch (e) {
    throw new Error(e.message || "Unable to connect to the payment server. Please try again.");
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create checkout session. Please try again.");
  }

  const data = await resp.json();
  // A 100%-off coupon/sale — the server already granted the plan; there is no
  // Stripe session to redirect to.
  if (data.status === "free") {
    onStageChange?.(PAYMENT_STAGE.ACTIVATING, "Activating your plan…");
    return { status: "free", planId: data.planId || planId };
  }

  const { url } = data;
  savePendingPayment({ provider: "stripe", planId, currency, billingPeriod });
  onStageChange?.(PAYMENT_STAGE.PORTAL_OPEN, "Redirecting to secure checkout…");
  window.location.href = url;
  return { status: "redirecting" };
}

// ── Razorpay Checkout (modal, supports UPI/cards/netbanking/wallets) ─────────
async function initiateRazorpayCheckout({ planId, currency, rates, billingPeriod, couponCode, qty = 1, sessionId, email, mobile, onStageChange }) {
  // planId may be a plan id OR a bundle id; getEffectivePlanById returns undefined for bundles.
  const plan        = getEffectivePlanById(planId);
  const displayName = plan?.name || "Top-up";
  const rzpCurrency = currency === "INR" ? "INR" : "USD"; // INR-only in practice; USD routes to Stripe

  // NOTE: the charged amount is computed SERVER-SIDE (create-checkout.js) — the server
  // is authoritative and ignores any client amount. We no longer send `amount`.
  const periodLabel = billingPeriod === "annual"
    ? `annual · ${rzpCurrency === "INR" ? `₹${(plan?.price_inr_annual || 0).toLocaleString("en-IN")}/mo` : `$${plan?.price_usd_annual || plan?.price_usd || 0}/mo`}`
    : billingPeriod === "once" ? "one-time" : "monthly";

  // Step 1: Create order on server (server computes the authoritative amount + GST).
  // Done BEFORE loading the Razorpay SDK so a 100%-off coupon/sale — which the
  // server resolves into a { status: "free" } response instead of an order —
  // never has to load or open the payment portal at all.
  onStageChange?.(PAYMENT_STAGE.PREPARING, "Creating your order…");
  let orderResp;
  try {
    orderResp = await fetchSafe(`${FUNCTIONS}/create-checkout`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        provider:        "razorpay",
        planId,
        currency:        rzpCurrency,
        billingPeriod:   billingPeriod || "monthly",
        couponCode:      couponCode || undefined,
        qty:             qty > 1 ? qty : undefined,
        sessionId,
        email:           email || null,
      }),
    });
  } catch (e) {
    throw new Error(e.message || "Unable to connect to the payment server. Please try again.");
  }

  if (!orderResp.ok) {
    const err  = await orderResp.json().catch(() => ({}));
    const code = err.code || "";
    if (code === "RAZORPAY_NOT_CONFIGURED") {
      throw new Error(
        "Razorpay server keys are not configured. " +
        "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Netlify environment variables, then redeploy."
      );
    }
    throw new Error(err.error || "Failed to initiate payment. Please try again.");
  }

  const orderData = await orderResp.json();

  // A 100%-off coupon/sale — the server already granted the plan; skip loading
  // the SDK and opening the payment portal entirely.
  if (orderData.status === "free") {
    onStageChange?.(PAYMENT_STAGE.ACTIVATING, "Activating your plan…");
    return { status: "free", planId: orderData.planId || planId };
  }

  const { orderId, amount: orderAmount, currency: orderCurrency } = orderData;

  // Save pending data for recovery (Razorpay doesn't redirect, but useful for debugging)
  savePendingPayment({ provider: "razorpay", planId, orderId, currency: rzpCurrency, billingPeriod });

  // Step 2: Load the Razorpay SDK now that we know a real charge is needed.
  onStageChange?.(PAYMENT_STAGE.PREPARING, "Loading payment portal…");
  await loadRazorpay(); // throws with user-friendly message on failure

  // Step 3: Open Razorpay modal
  onStageChange?.(PAYMENT_STAGE.PORTAL_OPEN, "Complete your payment in the secure portal");

  return new Promise((resolve, reject) => {
    const rzpOptions = {
      key:         RAZORPAY_KEY_ID,
      amount:      orderAmount,
      currency:    orderCurrency,
      name:        "DatIQ",
      description: `${displayName} — ${periodLabel}`,
      image:       `${window.location.origin}/favicon.svg`,
      order_id:    orderId,
      prefill:     { email: email || "", contact: normalizeContact(mobile) },
      notes:       { planId, sessionId, billingPeriod: billingPeriod || "monthly" },
      theme:       { color: "#6366f1" },
      modal: {
        backdropclose: false, // prevent accidental modal close
        escape:        true,
        confirm_close: true,  // confirm before closing mid-payment
        ondismiss:     () => {
          onStageChange?.(PAYMENT_STAGE.CANCELLED, "Payment cancelled — no charge was made.");
          clearPendingPayment();
          resolve({ status: "cancelled" });
        },
      },

      // Called by Razorpay SDK after successful payment
      handler: async (rzpResponse) => {
        onStageChange?.(PAYMENT_STAGE.VERIFYING, "Verifying your payment…");

        let verifyResp;
        try {
          verifyResp = await fetchSafe(`${FUNCTIONS}/verify-payment`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              provider:      "razorpay",
              orderId:       rzpResponse.razorpay_order_id,
              paymentId:     rzpResponse.razorpay_payment_id,
              signature:     rzpResponse.razorpay_signature,
              planId,
              sessionId,
              billingPeriod: billingPeriod || "monthly",
            }),
          });
        } catch (netErr) {
          reject(new Error(
            `Payment was processed, but verification failed due to a network error. ` +
            `Please contact hello@datiq.app and quote your Payment ID: ${rzpResponse.razorpay_payment_id}`
          ));
          return;
        }

        const verifyResult = await verifyResp.json();

        if (verifyResult.verified) {
          onStageChange?.(PAYMENT_STAGE.ACTIVATING, "Activating your plan…");
          clearPendingPayment();
          resolve({
            status:        "success",
            provider:      "razorpay",
            planId,
            paymentId:     rzpResponse.razorpay_payment_id,
            orderId:       rzpResponse.razorpay_order_id,
            amount:        orderAmount,
            currency:      orderCurrency,
            billingPeriod: billingPeriod || "monthly",
          });
        } else {
          reject(new Error(
            `Payment signature verification failed. ` +
            `If your account was charged, please email hello@datiq.app with Payment ID: ${rzpResponse.razorpay_payment_id}`
          ));
        }
      },
    };

    const rzp = new window.Razorpay(rzpOptions);

    // Called when Razorpay detects a payment failure within the modal
    rzp.on("payment.failed", (failResponse) => {
      const code   = failResponse?.error?.code        || "";
      const desc   = failResponse?.error?.description || "";
      const reason = failResponse?.error?.reason      || "";
      const msg    = describeRazorpayFailure(code, desc, reason);
      onStageChange?.(PAYMENT_STAGE.ERROR, msg);
      reject(new Error(msg));
    });

    rzp.open();
  });
}

// ── Top-up bundle checkout ───────────────────────────────────────────────────
export async function initiateTopupCheckout({ bundleId, currency, rates, qty = 1, sessionId, email, mobile, onStageChange }) {
  const provider = getPaymentProvider(currency);
  if (!provider) return { status: "contact_sales" };

  if (provider === "stripe") {
    return initiateStripeCheckout({ planId: bundleId, currency, rates, billingPeriod: "once", couponCode: undefined, qty, sessionId, email, mobile, onStageChange });
  }
  return initiateRazorpayCheckout({ planId: bundleId, currency, rates, billingPeriod: "once", couponCode: undefined, qty, sessionId, email, mobile, onStageChange });
}

// ── Main entry point ─────────────────────────────────────────────────────────
export async function initiateCheckout({ planId, currency, rates, billingPeriod, couponCode, sessionId, email, mobile, onStageChange }) {
  if (!hasPayment) return { status: "demo_mode" };

  const provider = getPaymentProvider(currency);
  if (!provider) return { status: "contact_sales" };

  if (provider === "stripe")   return initiateStripeCheckout({ planId, currency, rates, billingPeriod, couponCode, sessionId, email, mobile, onStageChange });
  if (provider === "razorpay") return initiateRazorpayCheckout({ planId, currency, rates, billingPeriod, couponCode, sessionId, email, mobile, onStageChange });
  return { status: "contact_sales" };
}

// ── Stripe success-page verification ────────────────────────────────────────
export async function confirmStripeSession(stripeSessionId) {
  try {
    const resp = await fetchSafe(
      `${FUNCTIONS}/verify-payment?provider=stripe&session_id=${encodeURIComponent(stripeSessionId)}`,
      {}
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export { hasPayment, getPaymentProvider };
