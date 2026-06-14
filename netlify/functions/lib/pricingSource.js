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

export const GST_RATE = 0.18; // 18% GST, INR only

// ── Static price tables (BASE prices; INR is pre-GST) ──────────────────────────
// planId -> { usd, usd_annual, inr, inr_annual }. Annual figures are PER-MONTH base.
const STATIC_PLANS = {
  free:     { usd: 0,   usd_annual: 0,   inr: 0,     inr_annual: 0     },
  select:   { usd: 19,  usd_annual: 15,  inr: 1899,  inr_annual: 999   },
  pro:      { usd: 29,  usd_annual: 23,  inr: 2899,  inr_annual: 1499  },
  business: { usd: 79,  usd_annual: 63,  inr: 7899,  inr_annual: 3999  },
  agency:   { usd: 299, usd_annual: 239, inr: 29899, inr_annual: 14999 },
};

const STATIC_BUNDLES = {
  "extractions-bundle": { usd: 9,  inr: 749  },
  "batch-pack":         { usd: 9,  inr: 749  },
  "scheduler-addon":    { usd: 5,  inr: 399  },
  "workspace-addon":    { usd: 19, inr: 1499 },
  "hubspot-addon":      { usd: 12, inr: 999  },
};

// Mirrors the percent-type seed coupons in src/lib/adminService.js. Extraction-bonus
// coupons grant credits client-side and never reduce a charge, so they are absent here.
const STATIC_COUPONS = {
  LAUNCH20:  { value: 20, planId: null,     expiresAt: "2026-09-14", active: true  },
  INDIE10:   { value: 10, planId: "select", expiresAt: "2026-09-30", active: true  },
  EARLYBIRD: { value: 30, planId: null,     expiresAt: "2026-04-01", active: false },
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
// Returns a fraction in [0, 1]. A coupon and a global sale never STACK — we take
// the larger of the two so combining them can't drive an accidental near-zero
// charge. The result is always <= what the UI shows (UI applies global only),
// so the customer is never charged MORE than displayed.
export function resolveDiscountFraction(pricing, couponCode, planId) {
  return Math.max(couponDiscount(pricing.coupons, couponCode, planId), globalDiscount(pricing.global));
}

function couponDiscount(coupons, couponCode, planId) {
  if (!couponCode) return 0;
  const c = coupons[String(couponCode).trim().toUpperCase()];
  if (!c || !c.active) return 0;
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return 0;
  if (c.planId && c.planId !== planId) return 0;
  return clampFrac(c.value);
}

function globalDiscount(global) {
  if (!global || !global.active || !global.percent) return 0;
  if (global.expiresAt && new Date(global.expiresAt) < new Date()) return 0;
  return clampFrac(global.percent);
}

function clampFrac(pct) {
  return Math.min(100, Math.max(0, Number(pct) || 0)) / 100;
}
