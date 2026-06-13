// create-checkout.js — Backend: create a Stripe Checkout session or Razorpay order.
// POST body: { provider, planId, priceId?, currency, amount?, billingPeriod?,
//              couponCode?, sessionId, email?, successUrl?, cancelUrl? }
// The discount is resolved server-side from `couponCode` (see resolveDiscount);
// any client-supplied `discountPercent`/`amount` is ignored.

// ── Server-side price tables — AUTHORITATIVE source of truth for charged amounts ──
// Must mirror src/lib/pricingConfig.js. The client `amount` is IGNORED for plans;
// the server recomputes from planId + billingPeriod + currency below.
// INR prices are BASE (pre-GST); 18% GST is added server-side for INR.
const PLAN_PRICES_USD          = { free: 0, select: 19,   pro: 29,   business: 79,   agency: 299   };
const PLAN_PRICES_USD_ANNUAL   = { free: 0, select: 15,   pro: 23,   business: 63,   agency: 239   };
const PLAN_PRICES_INR_MONTHLY  = { free: 0, select: 1899, pro: 2899, business: 7899, agency: 29899 };
const PLAN_PRICES_INR_ANNUAL   = { free: 0, select: 999,  pro: 1499, business: 3999, agency: 14999 }; // per-month base

const GST_RATE = 0.18; // 18% GST, INR only

const BUNDLE_PRICES = {
  "extractions-bundle": { usd: 9,  inr: 749  },
  "batch-pack":         { usd: 9,  inr: 749  },
  "scheduler-addon":    { usd: 5,  inr: 399  },
  "workspace-addon":    { usd: 19, inr: 1499 },
  "hubspot-addon":      { usd: 12, inr: 999  },
};

const ALLOWED_PLANS      = new Set(["free", "select", "pro", "business", "agency"]);
const ALLOWED_BUNDLES    = new Set(Object.keys(BUNDLE_PRICES));
const ALLOWED_CURRENCIES = new Set(["INR", "USD"]);

// ── Server-side coupon table — AUTHORITATIVE source of truth for discounts ──
// Mirrors the percent-type coupons in src/lib/adminService.js (seedCoupons). The
// client-supplied `discountPercent` is IGNORED; the server resolves the real discount
// from `couponCode` against this table so a tampered client can't dictate its own price.
// NOTE: `maxUses` is intentionally NOT enforced here — there is no server-side usage
// persistence (usage is counted client-side in localStorage). Extraction-bonus coupons
// (e.g. BONUS50EX) grant bonus credits client-side and do NOT reduce the charged amount,
// so they are deliberately absent from this table.
const COUPONS = {
  LAUNCH20:  { value: 20, planId: null,     expiresAt: "2026-09-14", active: true  },
  INDIE10:   { value: 10, planId: "select", expiresAt: "2026-09-30", active: true  },
  EARLYBIRD: { value: 30, planId: null,     expiresAt: "2026-04-01", active: false },
};

// Resolve a coupon code to a discount fraction in [0, 1]. Unknown, inactive, expired,
// or plan-mismatched codes resolve to 0 (no discount) — never an error.
function resolveDiscount(couponCode, planId) {
  if (!couponCode) return 0;
  const c = COUPONS[String(couponCode).trim().toUpperCase()];
  if (!c || !c.active) return 0;
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return 0;
  if (c.planId && c.planId !== planId) return 0;
  return Math.min(100, Math.max(0, Number(c.value) || 0)) / 100;
}

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
  // resolves the discount itself from `couponCode` via resolveDiscount() below.

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

  // Server-authoritative discount: resolved from the coupon code, not the client number.
  const serverDiscount = resolveDiscount(couponCode, planId); // fraction in [0, 1]

  // ── Stripe ──────────────────────────────────────────────────────────────────
  if (provider === "stripe") {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Stripe payment is not configured. Please contact support@datiq.app.", code: "STRIPE_NOT_CONFIGURED" }),
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
        body: JSON.stringify({ error: "Razorpay payment is not configured. Please contact support@datiq.app.", code: "RAZORPAY_NOT_CONFIGURED" }),
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
      const prices   = BUNDLE_PRICES[planId];
      const baseUnit = isINR ? prices.inr : prices.usd;
      const base     = baseUnit * qty * (1 - disc);
      finalAmount    = isINR
        ? Math.round(base * (1 + GST_RATE) * 100)  // INR bundle incl. GST
        : Math.round(base * 100);                  // USD bundle, no GST
    } else if (isINR) {
      const baseMonthly = annual ? (PLAN_PRICES_INR_ANNUAL[planId] || 0) : (PLAN_PRICES_INR_MONTHLY[planId] || 0);
      const base        = (annual ? baseMonthly * 12 : baseMonthly) * (1 - disc);
      finalAmount       = Math.round(base * (1 + GST_RATE) * 100); // incl. 18% GST
    } else {
      // USD via Razorpay is defensive only (USD normally routes to Stripe). No GST.
      const baseMonthly = annual ? (PLAN_PRICES_USD_ANNUAL[planId] || 0) : (PLAN_PRICES_USD[planId] || 0);
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
    return "The selected plan is not configured in Stripe. Please contact support@datiq.app.";
  }
  if (type === "StripeAuthenticationError") {
    return "Payment gateway authentication failed. Please contact support@datiq.app.";
  }
  if (msg.includes("card was declined")) {
    return "Your card was declined. Please try a different payment method.";
  }
  return "Payment setup failed. Please try again or contact support@datiq.app.";
}

function classifyRazorpayCreateError(e) {
  const desc = ((e.error?.description) || e.message || "").toLowerCase();
  if (desc.includes("authentication") || desc.includes("key_id") || desc.includes("key id")) {
    return "Payment gateway authentication failed. Please contact support@datiq.app.";
  }
  if (desc.includes("bad request") || desc.includes("invalid amount")) {
    return "Invalid payment details. Please try again.";
  }
  if (desc.includes("network") || desc.includes("econnrefused") || desc.includes("etimedout")) {
    return "Could not reach the payment gateway. Please check your internet connection and try again.";
  }
  return "Payment gateway error. Please try again or contact support@datiq.app.";
}
