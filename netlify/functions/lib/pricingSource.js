// pricingSource.js — Shared, SERVER-AUTHORITATIVE source of truth for charged
// amounts and discounts. Imported by create-checkout.js (the only function that
// computes a charge amount; verify-payment.js compares against the Razorpay order
// and never recomputes from tables).
//
// Resolution order — operator overrides PREVAIL, static is the fallback:
//   1. Static tables below (mirror src/lib/pricingConfig.js + adminService.js seeds).
//   2. Operator overrides in the Supabase `pricing_config` table — rows keyed
//      'plans' | 'bundles' | 'coupons' | 'global', each holding a jsonb value.
//
// There is intentionally NO public write endpoint: these values drive real charge
// amounts, so the operator edits the `pricing_config` table directly (SQL/dashboard).
// The table is RLS-locked to the service key. If Supabase is not configured
// (no SUPABASE_URL / SUPABASE_SERVICE_KEY) or the fetch fails, the static tables
// are used — nothing ever hard-fails, so "static is the start" always holds.

import { PLANS, TOPUP_BUNDLES, CREDIT_PACKS } from "../../../src/lib/pricingConfig.js";

export const GST_RATE = 0.18; // 18% GST, INR only

// ── Static price tables (BASE prices; INR is pre-GST) ──────────────────────────
//
// 🔴 THESE ARE DERIVED FROM `src/lib/pricingConfig.js`, NOT COPIED FROM IT.
// They used to be a hand-written mirror carrying a comment that said "MUST
// MIRROR src/lib/pricingConfig.js" — which is a request, not a mechanism, and
// this is the one table where a divergence charges a customer something other
// than the number they were shown. Deriving them makes a repricing one edit,
// which is the whole point of PLAN_TABLE existing.
//
// ⚠️ `verify-payment.js` already imports from the same module, so reaching
// across into src/ from a Netlify function is established here and the bundler
// handles it. Nothing browser-only is pulled in: pricingConfig is pure data.
//
// ⚠️ INR IS A SET PRICE, NEVER CONVERTED, on both sides. See PLAN_TABLE's
// header for why a converted price is the wrong thing to charge.
const STATIC_PLANS = Object.fromEntries(
  PLANS.map((p) => [p.id, {
    usd: p.price_usd,
    usd_annual: p.price_usd_annual,
    inr: p.price_inr,
    inr_annual: p.price_inr_annual,
  }]),
);

// `extractions-bundle` is gone (D15) — it sold pure consumption at 14x the
// cheapest plan's credit rate. `credits: N` marks a pack whose purchase GRANTS
// that many credits; a bundle without it buys capacity and grants none.
//
// ⚠️ `hubspot-addon` is NOT in the client catalogue and is kept deliberately:
// `paymentConfig.js` still maps a Stripe price id for it, so an order could
// name it. Dropping its price here would make that order resolve to 0.
const STATIC_BUNDLES = {
  ...Object.fromEntries(TOPUP_BUNDLES.map((b) => [b.id, { usd: b.price_usd, inr: b.price_inr }])),
  ...Object.fromEntries(CREDIT_PACKS.map((p) => [p.id, { usd: p.price_usd, inr: p.price_inr, credits: p.credits }])),
  "hubspot-addon": { usd: 12, inr: 999 },
};

// Mirrors the percent-type seed coupons in src/lib/adminService.js.
// ⚠️ CREDIT coupons are a different thing and DO belong here — they are
// redeemed server-side by POST /api/credits, which validates against this
// same table. A coupon that exists only in an admin's localStorage cannot be
// honoured by anything, which is exactly why the old extraction-bonus coupons
// granted nothing a gate could see.
// maxUses = global redemption cap (0/absent = unlimited). Enforced server-side via
// reserveCoupon() against the coupon_redemptions/coupon_counters tables.
const STATIC_COUPONS = {
  LAUNCH20:  { value: 20, planId: null,     expiresAt: "2026-12-31", active: true,  maxUses: 100 },
  INDIE10:   { value: 10, planId: "select", expiresAt: "2026-09-30", active: true,  maxUses: 50  },
  EARLYBIRD: { value: 30, planId: null,     expiresAt: "2026-04-01", active: false, maxUses: 30  },
};

const STATIC_GLOBAL = { percent: 0, active: false, expiresAt: null };

export const ALLOWED_PLANS   = new Set(Object.keys(STATIC_PLANS));
export const ALLOWED_BUNDLES = new Set(Object.keys(STATIC_BUNDLES));

// ── Supabase REST read (service key only; pricing_config is RLS-locked) ─────────
async function fetchOverrides() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/pricing_config?select=key,value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const out = {};
    for (const r of rows || []) out[r.key] = r.value;
    return out; // { plans?, bundles?, coupons?, global? }
  } catch {
    return null; // network/JSON error → fall back to static
  }
}

// ── Merge + per-container cache ─────────────────────────────────────────────────
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000; // refetch at most once per minute per warm container

function mergeConfig(ov) {
  if (!ov) {
    return { plans: STATIC_PLANS, bundles: STATIC_BUNDLES, coupons: STATIC_COUPONS, global: STATIC_GLOBAL };
  }
  const plans = {};
  for (const id of Object.keys(STATIC_PLANS)) {
    plans[id] = { ...STATIC_PLANS[id], ...(ov.plans?.[id] || {}) }; // override per-field
  }
  const bundles = {};
  for (const id of Object.keys(STATIC_BUNDLES)) {
    bundles[id] = { ...STATIC_BUNDLES[id], ...(ov.bundles?.[id] || {}) };
  }
  const coupons = { ...STATIC_COUPONS };
  if (ov.coupons && typeof ov.coupons === "object") {
    for (const [code, c] of Object.entries(ov.coupons)) coupons[String(code).toUpperCase()] = c;
  }
  const global = ov.global ? { ...STATIC_GLOBAL, ...ov.global } : STATIC_GLOBAL;
  return { plans, bundles, coupons, global };
}

// Returns merged { plans, bundles, coupons, global }. Always resolves (never throws).
export async function loadPricing() {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  const ov = await fetchOverrides();
  _cache = mergeConfig(ov);
  _cacheAt = now;
  return _cache;
}

// ── Discount resolution ──────────────────────────────────────────────────────
// A coupon and a global sale never STACK — the caller takes the larger of the two
// so combining them can't drive an accidental near-zero charge. The result is
// always <= what the UI shows (UI applies global only), so the customer is never
// charged MORE than displayed.

// Validity-only coupon resolution (does NOT check maxUses — that's enforced at
// reservation time via reserveCoupon). Returns { frac, maxUses } (frac 0 if invalid).
export function resolveCouponInfo(pricing, couponCode, planId) {
  if (!couponCode) return { frac: 0, maxUses: 0 };
  const c = pricing.coupons[String(couponCode).trim().toUpperCase()];
  if (!c || !c.active) return { frac: 0, maxUses: 0 };
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { frac: 0, maxUses: 0 };
  if (c.planId && c.planId !== planId) return { frac: 0, maxUses: 0 };
  return { frac: clampFrac(c.value), maxUses: Math.max(0, parseInt(c.maxUses, 10) || 0) };
}

export function globalFraction(pricing) {
  const g = pricing.global;
  if (!g || !g.active || !g.percent) return 0;
  if (g.expiresAt && new Date(g.expiresAt) < new Date()) return 0;
  return clampFrac(g.percent);
}

// Back-compat convenience: validity-only max(coupon, global), NO maxUses enforcement.
export function resolveDiscountFraction(pricing, couponCode, planId) {
  return Math.max(resolveCouponInfo(pricing, couponCode, planId).frac, globalFraction(pricing));
}

function clampFrac(pct) {
  return Math.min(100, Math.max(0, Number(pct) || 0)) / 100;
}

// ── Coupon redemption (atomic, server-enforced maxUses + one-per-user) ──────────
// Calls the Supabase `redeem_coupon` RPC, which atomically (a) claims a per-user
// slot via the unique (coupon_code, session_id) constraint and (b) increments a
// per-coupon counter only while under maxUses. Returns one of:
//   'ok' | 'already_redeemed' | 'cap_reached' | null
// `null` means enforcement is unavailable (Supabase not configured or the RPC
// errored) — the caller then falls back to applying the coupon WITHOUT enforcement
// (today's behavior), so payments never hard-fail on an infra gap.
export async function reserveCoupon(couponCode, sessionId, maxUses, orderRef) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !couponCode || !sessionId) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/redeem_coupon`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_code:    String(couponCode).trim().toUpperCase(),
        p_session: String(sessionId),
        p_max:     Math.max(0, parseInt(maxUses, 10) || 0),
        p_order:   orderRef || null,
      }),
    });
    if (!res.ok) return null;
    const out = await res.json().catch(() => null); // RPC returns a scalar text
    const val = Array.isArray(out) ? out[0] : out;
    return typeof val === "string" ? val : null;
  } catch {
    return null; // infra error → unenforced fallback
  }
}
