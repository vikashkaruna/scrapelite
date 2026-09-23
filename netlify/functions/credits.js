// credits.js — GET /api/credits. The caller's own credit position.
//
// ⚠️ READ-ONLY, AND FOR PAINTING A SCREEN. Nothing here authorises anything.
// Every gate re-resolves the balance server-side at the moment it charges,
// with the service key, because a balance the browser holds is a hint the user
// is free to tamper with — the same rule entitlementClient.js states for the
// entitlement row.
//
// 🔴 `enforced: false` IS NOT `available: 0`.
// An account that has never been granted credits is not on the credit system,
// and a UI that rendered "0 credits remaining" for it would be telling every
// customer they were out of something they had never been given. The flag is
// what separates the two, and the screen must branch on it.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { available, grant } from "./lib/creditMeter.js";
import { loadPricing, reserveCoupon } from "./lib/pricingSource.js";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: {} };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await authenticateBearer(event, { label: "credits" });

  // ── §4.6 — A CREDIT COUPON MUST BE REDEEMED ON THE SERVER ───────────────
  //
  // 🔴 THE THIRD WRITER OF `bonusExtractions` WAS BillingProvider, IN THE
  // BROWSER. It added the coupon's value to a localStorage object, which fed
  // a quota that is now retired — so under credits the same code would have
  // shown a success toast and granted nothing that any gate could see. A
  // balance lives in an append-only ledger behind the service key; the
  // browser cannot write to it, and it should not be able to.
  //
  // ⚠️ SIGNED-IN ONLY. A credit grant has to attach to an account; an
  // anonymous identity can be re-made without limit, which is the same
  // reasoning scrape consent and referrals already hold.
  if (event.httpMethod === "POST") {
    if (!auth.ok || !auth.user) {
      return json(401, {
        error: "Sign in to redeem a credit coupon — credits attach to an account.",
        code: "SIGN_IN_REQUIRED",
      });
    }
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: "Invalid JSON body" }); }
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) return json(400, { error: "A coupon code is required.", code: "CODE_REQUIRED" });

    // Validated against pricing_config — the SAME server-authoritative source
    // checkout uses. A coupon that only exists in an admin's localStorage is
    // not a coupon; that was how the old extraction-bonus coupons worked and
    // it is why they could never have been honoured here.
    const pricing = await loadPricing();
    const coupon = pricing.coupons?.[code];
    const credits = Number(coupon?.credits);
    if (!coupon || !coupon.active || !Number.isFinite(credits) || credits <= 0) {
      return json(404, { error: "That code isn't a valid credit coupon.", code: "INVALID_COUPON" });
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return json(410, { error: "That coupon has expired.", code: "EXPIRED_COUPON" });
    }

    // Atomic: claims the per-user slot and the global cap in one statement.
    // ⚠️ A null verdict means enforcement is UNAVAILABLE, not that the coupon
    // was refused — but unlike checkout, which falls through unenforced so a
    // payment never hard-fails, a grant that cannot be de-duplicated must not
    // proceed. Handing out credits twice is not a degraded experience.
    const verdict = await reserveCoupon(code, auth.user.id, coupon.maxUses, `credits:${code}`);
    if (verdict === "already_redeemed") {
      return json(409, { error: "You've already redeemed that coupon.", code: "ALREADY_REDEEMED" });
    }
    if (verdict === "cap_reached") {
      return json(409, { error: "That coupon has been fully redeemed.", code: "CAP_REACHED" });
    }
    if (verdict !== "ok") {
      return json(503, {
        error: "Coupons are temporarily unavailable. This is a problem on our side — try again shortly.",
        code: "REDEMPTION_UNAVAILABLE",
      });
    }

    // ⚠️ NO EXPIRY — a coupon was redeemed, not allowanced.
    const granted = await grant(auth.user.id, credits, {
      period: `coupon:${code}`,
      expiresAt: null,
      meta: { kind: "coupon", code },
    });
    if (!granted?.ok && granted?.reason !== "already_granted") {
      return json(502, { error: "The coupon could not be applied. Nothing was changed.", code: "GRANT_FAILED" });
    }
    const after = await available(auth.user.id);
    return json(200, {
      ok: true, code, granted: credits, unit: "credits",
      available: after.degraded ? null : after.available,
    });
  }

  if (!auth.ok || !auth.user) {
    // A guest has no ledger to read. Answered rather than refused, so the UI
    // renders the signed-out state instead of an error banner.
    return json(200, { enforced: false, guest: true, available: 0, grants: 0 });
  }

  const status = await available(auth.user.id);
  if (status.degraded) {
    // ⚠️ "We could not read it" is not "you have none". Said explicitly so the
    // screen shows nothing rather than a confident zero.
    return json(200, {
      enforced: false, degraded: true, available: null, reason: status.reason,
    });
  }

  return json(200, {
    enforced: status.enforced,
    available: status.available,
    grants: status.grants,
    granted: status.granted,
    spent: status.spent,
  });
};
