// create-checkout.js — Backend: create a Stripe Checkout session or Razorpay order.
// POST body: { provider, planId, priceId?, currency, amount?, billingPeriod?,
//              couponCode?, sessionId, email?, successUrl?, cancelUrl? }
//
// Prices, coupons, and the global discount come from pricingSource.loadPricing()
// — the SERVER-AUTHORITATIVE source of truth (Supabase operator overrides layered
// over a static table; static fallback when Supabase is absent). The client `amount`
// and any client-supplied discount are ignored; the server recomputes everything.

import {
  loadPricing, resolveCouponInfo, globalFraction, reserveCoupon,
  ALLOWED_PLANS, ALLOWED_BUNDLES, GST_RATE,
} from "./lib/pricingSource.js";

const ALLOWED_CURRENCIES = new Set(["INR", "USD"]);

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON in request body.", code: "INVALID_JSON" }) };
  }

  const {
    provider, planId, priceId, currency, amount,
    billingPeriod, couponCode, sessionId, email,
    successUrl, cancelUrl,
  } = body;
  // `discountPercent` (body.discountPercent) is intentionally NOT read — the server
  // resolves the discount itself from `couponCode` + global sale via loadPricing() below.

  const qty = Math.min(10, Math.max(1, parseInt(body.qty, 10) || 1));

  // ── Input validation ────────────────────────────────────────────────────────
  if (!provider || !["stripe", "razorpay"].includes(provider)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid provider. Use 'stripe' or 'razorpay'.", code: "INVALID_PROVIDER" }) };
  }
  if (!planId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "planId is required.", code: "MISSING_PLAN_ID" }) };
  }

  const isBundle = ALLOWED_BUNDLES.has(planId);
  const isPlan   = ALLOWED_PLANS.has(planId);
  if (!isPlan && !isBundle) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown plan or bundle: '${planId}'.`, code: "UNKNOWN_PLAN" }) };
  }
  if (currency && !ALLOWED_CURRENCIES.has(currency)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unsupported currency: '${currency}'.`, code: "INVALID_CURRENCY" }) };
  }

  // Server-authoritative pricing + discount. Operator overrides (Supabase) prevail
  // over the static table; the discount is the larger of the resolved coupon or the
  // active global sale (they never stack). Client-supplied discount is ignored.
  const pricing = await loadPricing();

  // Resolve coupon validity, then ATOMICALLY reserve it — this enforces both the
  // per-user one-time limit and the global maxUses cap. If the reservation is
  // rejected, the coupon is dropped (the global sale, if any, still applies). When
  // enforcement is unavailable (no Supabase / RPC error) reserveCoupon returns null
  // and we fall back to applying the coupon unenforced, so payments never hard-fail.
  const couponInfo = resolveCouponInfo(pricing, couponCode, planId);
  let couponFrac = couponInfo.frac;
  if (couponFrac > 0) {
    const orderRef = `co_${(sessionId || "").slice(-8)}_${Date.now().toString(36)}`;
    const reservation = await reserveCoupon(couponCode, sessionId, couponInfo.maxUses, orderRef);
    if (reservation === "already_redeemed" || reservation === "cap_reached") {
      console.warn(`[create-checkout] coupon ${String(couponCode).toUpperCase()} dropped: ${reservation}`);
      couponFrac = 0;
    }
  }
  const serverDiscount = Math.max(couponFrac, globalFraction(pricing)); // [0, 1]

  // ── Stripe ──────────────────────────────────────────────────────────────────
  if (provider === "stripe") {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Stripe payment is not configured. Please contact hello@datiq.app.", code: "STRIPE_NOT_CONFIGURED" }),
      };
    }
    if (!priceId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "priceId is required for Stripe.", code: "MISSING_PRICE_ID" }) };
    }
    if (!successUrl || !cancelUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "successUrl and cancelUrl are required.", code: "MISSING_URLS" }) };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const mode   = isBundle ? "payment" : "subscription";

    try {
      const params = {
        mode,
        line_items:  [{ price: priceId, quantity: isBundle ? qty : 1 }],
        success_url: successUrl,
        cancel_url:  cancelUrl,
        metadata: {
          sessionId:     sessionId     || "",
          planId:        planId        || "",
          billingPeriod: billingPeriod || "monthly",
        },
        ...(email ? { customer_email: email } : {}),
      };

      const stripeDiscPct = Math.round(serverDiscount * 100);
      if (stripeDiscPct > 0) {
        try {
          const coupon = await stripe.coupons.create({
            percent_off: stripeDiscPct,
            duration:    "once",
            name:        "DatIQ promotional discount",
          });
          params.discounts = [{ coupon: coupon.id }];
        } catch (ce) {
          console.warn("[create-checkout/stripe] Coupon creation skipped:", ce.message);
        }
      }

      const session = await stripe.checkout.sessions.create(params);
      return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, checkoutSessionId: session.id }) };
    } catch (e) {
      console.error("[create-checkout/stripe]", e.type, e.message);
      return { statusCode: 400, headers, body: JSON.stringify({ error: classifyStripeError(e), code: "STRIPE_ERROR", raw: e.message }) };
    }
  }

  // ── Razorpay ─────────────────────────────────────────────────────────────────
  if (provider === "razorpay") {
    const keyId     = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Razorpay payment is not configured. Please contact hello@datiq.app.", code: "RAZORPAY_NOT_CONFIGURED" }),
      };
    }

    const rzpCurrency = currency === "INR" ? "INR" : "USD";
    const isINR       = rzpCurrency === "INR";
    const annual      = billingPeriod === "annual";

    // Discount is server-resolved from the coupon code (see resolveDiscount). The
    // client cannot dictate a discount: an unknown/expired/mismatched code yields 0.
    const disc = serverDiscount;

    // Resolve amount in smallest unit (paise for INR, cents for USD).
    // SERVER-AUTHORITATIVE: the client `amount` is intentionally ignored. We recompute
    // everything from the price tables so the charged amount cannot be tampered with.
    // INR amounts include 18% GST (computed in one step to avoid rounding drift).
    let finalAmount;
    if (isBundle) {
      const prices   = pricing.bundles[planId];
      const baseUnit = isINR ? prices.inr : prices.usd;
      const base     = baseUnit * qty * (1 - disc);
      finalAmount    = isINR
        ? Math.round(base * (1 + GST_RATE) * 100)  // INR bundle incl. GST
        : Math.round(base * 100);                  // USD bundle, no GST
    } else if (isINR) {
      const p           = pricing.plans[planId];
      const baseMonthly = annual ? (p.inr_annual || 0) : (p.inr || 0);
      const base        = (annual ? baseMonthly * 12 : baseMonthly) * (1 - disc);
      finalAmount       = Math.round(base * (1 + GST_RATE) * 100); // incl. 18% GST
    } else {
      // USD via Razorpay is defensive only (USD normally routes to Stripe). No GST.
      const p           = pricing.plans[planId];
      const baseMonthly = annual ? (p.usd_annual || 0) : (p.usd || 0);
      const base        = (annual ? baseMonthly * 12 : baseMonthly) * (1 - disc);
      finalAmount       = Math.round(base * 100);
    }

    // Razorpay minimums: ₹1 (100 paise) for INR, $0.50 (50 cents) for USD
    const minAmount = rzpCurrency === "INR" ? 100 : 50;
    if (!finalAmount || finalAmount < minAmount) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: "Payment amount is below the minimum required.", code: "AMOUNT_TOO_SMALL" }),
      };
    }

    const { default: Razorpay } = await import("razorpay");
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

    // Receipt: max 40 chars, unique per order
    const receiptId = `r_${(sessionId || "").slice(-6)}${Date.now().toString(36)}`.slice(0, 40);

    try {
      const order = await rzp.orders.create({
        amount:   finalAmount,
        currency: rzpCurrency,
        receipt:  receiptId,
        notes: {
          sessionId:     sessionId     || "",
          planId:        planId        || "",
          billingPeriod: billingPeriod || "monthly",
          email:         email         || "",
          source:        "datiq_web",
        },
      });
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ orderId: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt }),
      };
    } catch (e) {
      console.error("[create-checkout/razorpay]", e.statusCode, e.error?.description || e.message);
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: classifyRazorpayCreateError(e), code: "RAZORPAY_ORDER_ERROR", raw: e.error?.description || e.message }),
      };
    }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown provider.", code: "INVALID_PROVIDER" }) };
};

// ── Error classifiers ─────────────────────────────────────────────────────────

function classifyStripeError(e) {
  const type = e.type  || "";
  const msg  = (e.message || "").toLowerCase();
  if (type === "StripeInvalidRequestError" && msg.includes("no such price")) {
    return "The selected plan is not configured in Stripe. Please contact hello@datiq.app.";
  }
  if (type === "StripeAuthenticationError") {
    return "Payment gateway authentication failed. Please contact hello@datiq.app.";
  }
  if (msg.includes("card was declined")) {
    return "Your card was declined. Please try a different payment method.";
  }
  return "Payment setup failed. Please try again or contact hello@datiq.app.";
}

function classifyRazorpayCreateError(e) {
  const desc = ((e.error?.description) || e.message || "").toLowerCase();
  if (desc.includes("authentication") || desc.includes("key_id") || desc.includes("key id")) {
    return "Payment gateway authentication failed. Please contact hello@datiq.app.";
  }
  if (desc.includes("bad request") || desc.includes("invalid amount")) {
    return "Invalid payment details. Please try again.";
  }
  if (desc.includes("network") || desc.includes("econnrefused") || desc.includes("etimedout")) {
    return "Could not reach the payment gateway. Please check your internet connection and try again.";
  }
  return "Payment gateway error. Please try again or contact hello@datiq.app.";
}
