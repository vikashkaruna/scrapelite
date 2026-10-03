// validate-coupon.js — read-only, unauthenticated coupon status check.
//
//   POST /api/validate-coupon   body: { code, planId? }
//   → { found: false }                                            — no such
//     server-canonical coupon (manual-assign coupons are deliberately not
//     self-redeemable and never reach here — see admin-coupons-config.js)
//   → { found: true, active, expired, exhausted, planId, type, value }
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// BillingProvider.applyCoupon() (Account page "Apply") used to validate
// entirely against a local, per-browser copy of coupon data with a local-only
// `uses` counter — so it could report "Coupon applied" for a coupon that had
// already hit its real, server-side usage cap (coupon_counters, only ever
// touched by reserveCoupon() at actual checkout). This endpoint gives the
// Apply step the same real data checkout itself resolves from
// (lib/pricingSource.js's loadPricing(), the shared source of truth), so
// "applied" can finally mean something true.
//
// This performs NO redemption/reservation — it never writes coupon_counters
// or coupon_redemptions, only reads them. A coupon code is not a secret (the
// /pricing page banner already advertises active sales), so this is safe to
// call unauthenticated, same trust level as the public pricing endpoints.
//
// Plan-restriction is reported, not judged, here: the caller decides what a
// mismatch means (e.g. "you're already on that plan" vs "wrong plan"),
// because this endpoint doesn't know what the caller is about to do with it.
// The actual charge-time gate (create-checkout.js → resolveCouponInfo) is
// untouched and remains the sole authority over what is actually charged.

import { loadPricing } from "./lib/pricingSource.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

// Reads the real, current redemption count for one coupon code. Returns null
// (never 0) when it can't be determined — Supabase unconfigured, network
// error, or no row yet (a coupon with zero redemptions has no counter row).
// The caller treats null as "unknown, assume not exhausted" — consistent with
// this codebase's fail-open-on-infra posture (see requireEntitlement.js);
// this is a read-only UX convenience, not the money gate.
async function readCouponUses(code) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/coupon_counters?coupon_code=eq.${encodeURIComponent(code)}&select=uses`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length === 0) return 0; // no row yet = never redeemed
    return Number(rows[0].uses) || 0;
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return respond(400, { ok: false, error: "code is required." });

  const pricing = await loadPricing();
  const coupon = pricing.coupons[code];
  if (!coupon) return respond(200, { ok: true, found: false });

  const now = new Date();
  const expired = Boolean(coupon.expiresAt && new Date(coupon.expiresAt) < now);
  const uses = coupon.maxUses ? await readCouponUses(code) : 0;
  const exhausted = Boolean(coupon.maxUses && uses !== null && uses >= coupon.maxUses);

  return respond(200, {
    ok: true,
    found: true,
    active: coupon.active !== false,
    expired,
    exhausted,
    planId: coupon.planId || null,
    // A credit coupon grants credits, not a discount — the client must route it
    // to the redemption endpoint instead of treating it as "0% off".
    type: Number(coupon.credits) > 0 ? "credits" : "percent",
    value: Number(coupon.credits) > 0 ? Number(coupon.credits) : coupon.value,
  });
};
