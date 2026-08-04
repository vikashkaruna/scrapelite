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
const FUNCTIONS   = "/.netlify/functions";

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
// It reports whether the SDK is loaded, whether the script tag is in the DOM,
// and whether the CDN is reachable from the current network — the three things
// that explain every "Unable to load the payment portal" error we've ever seen.
if (typeof window !== "undefined") {
  window.__datiqDiagnoseRazorpay__ = async function diagnoseRazorpay() {
    const rzp = !!window.Razorpay;
    const tag = document.querySelector('script[src*="checkout.razorpay.com"]');
    const state = tag?.dataset?.rzpState || (tag ? "loaded-no-marker" : "no-tag");
    let cdn = "unknown";
    try {
      const resp = await fetch("https://checkout.razorpay.com/v1/checkout.js", { method: "HEAD", mode: "no-cors" });
      cdn = resp.ok || resp.type === "opaque" ? "reachable" : `status-${resp.status}`;
    } catch (e) {
      cdn = `blocked: ${e?.message || e}`;
    }
    const out = { rzpLoaded: rzp, scriptTagState: state, cdnReachable: cdn };
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

// ── Razorpay SDK loader (CDN, lazy) ──────────────────────────────────────────
// History of failures this loader has had to fix:
//   v1: no timeout, no dedupe, no pre-load. Users waited 30s+ on "Setting up
//       payment…" or saw the modal fail with no recourse.
//   v2: added preloadRazorpay() + 10s timeout + concurrent-call dedup. But it
//       had a second bug — if the PRE-load failed (ad blocker, network), the
//       failed <script> element was left in the DOM. The next call to
//       loadRazorpay() would find it, attach new listeners, and hang forever
//       (no timeout in the "reuse" branch) because the element had already
//       fired its `error` event.
//
//   v3 (this version) tracks the script element + its terminal state in a
//       dataset attribute. On a retry:
//         • if the element is still pending  → reuse + attach listeners + timeout
//         • if the element errored/timed out → remove it and create a fresh one
//         • if window.Razorpay exists         → fast-path return
//       This means "Try again" actually retries, and the pre-load can't poison
//       the real call.
let rzpLoaded = false;
let rzpLoadingPromise = null;
let rzpScriptElement = null;
const RZP_LOAD_TIMEOUT_MS = 10000;
const RZP_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function makeRzpLoadError(detail) {
  return new Error(
    "Unable to load the payment portal. " +
    "This is usually caused by an ad blocker or a privacy extension blocking " +
    "checkout.razorpay.com — please allow it for datiq.app and try again. " +
    "If the issue persists, contact hello@datiq.app." +
    (detail ? ` (${detail})` : "")
  );
}

function makeRzpTimeoutError() {
  return new Error(
    "The payment portal took too long to load. " +
    "Please check your connection, allow checkout.razorpay.com in any " +
    "ad blocker, then try again."
  );
}

export function preloadRazorpay() {
  // Fire-and-forget. Called from Pricing.jsx on mount so the SDK is warm by
  // the time the user clicks "Proceed to payment". Errors are swallowed here —
  // the real load happens again in loadRazorpay() which surfaces a clean error.
  loadRazorpay().catch(() => { /* pre-warm only; surface the error on the real call */ });
}

async function loadRazorpay() {
  // Fast path — already loaded
  if (rzpLoaded || window.Razorpay) { rzpLoaded = true; return; }
  // Dedup concurrent calls — if a load is already in flight, wait on it
  if (rzpLoadingPromise) return rzpLoadingPromise;

  // If a previous attempt left a terminal-state script in the DOM, remove it
  // before we try again. Without this, attaching fresh listeners to a dead
  // element hangs the promise forever.
  if (rzpScriptElement && rzpScriptElement.dataset.rzpState &&
      rzpScriptElement.dataset.rzpState !== "pending") {
    rzpScriptElement.remove();
    rzpScriptElement = null;
  }
  // Also clean up any stale script tags from earlier failed attempts that we
  // didn't track (e.g. before a hot-reload replaced this module).
  document.querySelectorAll('script[src*="checkout.razorpay.com"][data-rzp-state="error"],script[src*="checkout.razorpay.com"][data-rzp-state="timeout"]')
    .forEach((n) => n.remove());

  rzpLoadingPromise = new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      rzpLoaded = true;
      resolve();
    };
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    // Create a fresh <script>. We do NOT reuse a pending element from outside
    // this module — it might be in a state we can't reason about after an
    // HMR reload. Creating a new one costs nothing because the browser caches
    // by URL, and it gives us a clean listener set every time.
    const s = document.createElement("script");
    s.src = RZP_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.dataset.rzpState = "pending";

    const onLoad = () => {
      s.dataset.rzpState = "loaded";
      settleResolve();
    };
    const onError = (evt) => {
      s.dataset.rzpState = "error";
      // Most "error" events from a script tag mean the request was blocked
      // (ad blocker, firewall, DNS, CSP). The browser gives us almost no
      // detail in the event itself — log what we have so the dev console
      // shows the URL and the failure mode.
      const detail = `script src=${RZP_SCRIPT_SRC} failed to load`;
      if (typeof console !== "undefined") {
        console.warn("[DatIQ] Razorpay SDK failed to load:", { src: RZP_SCRIPT_SRC, event: evt?.type || "error" });
      }
      settleReject(makeRzpLoadError(detail));
    };

    s.addEventListener("load", onLoad);
    s.addEventListener("error", onError);

    // Timeout guard — catches slow networks / partial loads where the script
    // is appended but neither load nor error fires within a reasonable window.
    // This also covers CSP silent-blocks and DNS hangs.
    const timer = setTimeout(() => {
      s.dataset.rzpState = "timeout";
      settleReject(makeRzpTimeoutError());
    }, RZP_LOAD_TIMEOUT_MS);
    s.addEventListener("load",  () => clearTimeout(timer), { once: true });
    s.addEventListener("error", () => clearTimeout(timer), { once: true });

    rzpScriptElement = s;
    document.head.appendChild(s);
  });

  try {
    await rzpLoadingPromise;
  } finally {
    // Clear so a subsequent retry can re-enter the loader cleanly
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

  const { url } = await resp.json();
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

  // Step 1: Load SDK
  onStageChange?.(PAYMENT_STAGE.PREPARING, "Loading payment portal…");
  await loadRazorpay(); // throws with user-friendly message on failure

  // NOTE: the charged amount is computed SERVER-SIDE (create-checkout.js) — the server
  // is authoritative and ignores any client amount. We no longer send `amount`.
  const periodLabel = billingPeriod === "annual"
    ? `annual · ${rzpCurrency === "INR" ? `₹${(plan?.price_inr_annual || 0).toLocaleString("en-IN")}/mo` : `$${plan?.price_usd_annual || plan?.price_usd || 0}/mo`}`
    : billingPeriod === "once" ? "one-time" : "monthly";

  // Step 2: Create order on server (server computes the authoritative amount + GST)
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

  const { orderId, amount: orderAmount, currency: orderCurrency } = await orderResp.json();

  // Save pending data for recovery (Razorpay doesn't redirect, but useful for debugging)
  savePendingPayment({ provider: "razorpay", planId, orderId, currency: rzpCurrency, billingPeriod });

  // Step 4: Open Razorpay modal
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
