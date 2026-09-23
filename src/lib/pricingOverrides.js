// pricingOverrides.js — Admin-configurable plan price and limit overrides.
// Defaults come from pricingConfig.js; overrides are layered on top and stored
// in localStorage so nothing is hardcoded.

const OVERRIDES_KEY       = "datiq.pricingOverrides";
const GLOBAL_DISCOUNT_KEY = "datiq.globalDiscount";
const TOPUP_OVERRIDES_KEY = "datiq.topupOverrides";
const PACK_OVERRIDES_KEY  = "datiq.creditPackOverrides";

function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Plan overrides ────────────────────────────────────────────────────────────
// Returns { [planId]: { price_usd?, limits?: {...}, name?, tagline?, badge? } }
export function getPricingOverrides() {
  return ls(OVERRIDES_KEY) ?? {};
}

export function setPlanOverride(planId, overrides) {
  const all = getPricingOverrides();
  all[planId] = { ...(all[planId] ?? {}), ...overrides };
  lsSet(OVERRIDES_KEY, all);
  return all;
}

export function resetPlanOverride(planId) {
  const all = getPricingOverrides();
  delete all[planId];
  lsSet(OVERRIDES_KEY, all);
}

export function resetAllOverrides() {
  localStorage.removeItem(OVERRIDES_KEY);
}

// ── Effective plans ───────────────────────────────────────────────────────────
// Merges default plan config with any admin overrides.
import {
  PLANS as DEFAULT_PLANS,
  TOPUP_BUNDLES as DEFAULT_BUNDLES,
  CREDIT_PACKS as DEFAULT_PACKS,
  PLAN_BY_ID as DEFAULT_BY_ID,
} from "./pricingConfig.js";

export function getEffectivePlans() {
  const overrides = getPricingOverrides();
  return DEFAULT_PLANS.map((plan) => {
    const ov = overrides[plan.id];
    if (!ov) return plan;
    return {
      ...plan,
      ...(ov.price_usd        !== undefined ? { price_usd:        ov.price_usd        } : {}),
      ...(ov.price_usd_annual !== undefined ? { price_usd_annual: ov.price_usd_annual } : {}),
      ...(ov.price_inr        !== undefined ? { price_inr:        ov.price_inr        } : {}),
      ...(ov.price_inr_annual !== undefined ? { price_inr_annual: ov.price_inr_annual } : {}),
      ...(ov.name      ? { name:      ov.name      } : {}),
      ...(ov.tagline   ? { tagline:   ov.tagline   } : {}),
      ...(ov.badge !== undefined ? { badge: ov.badge } : {}),
      ...(ov.highlight !== undefined ? { highlight: ov.highlight } : {}),
      limits: ov.limits ? { ...plan.limits, ...ov.limits } : plan.limits,
    };
  });
}

/**
 * Lenient lookup — an unknown id resolves to the FREE plan.
 *
 * Safe for display (a pricing card must render something), but NEVER use this
 * to decide a capability: a corrupted, renamed or attacker-supplied plan id
 * would silently be GRANTED the Free tier instead of being refused. Use
 * getPlanByIdStrict for anything that gates access.
 */
export function getEffectivePlanById(planId) {
  return getEffectivePlans().find((p) => p.id === planId) ?? DEFAULT_BY_ID.free;
}

/**
 * Strict lookup — returns null for an unknown id instead of falling back.
 *
 * This is the authorization-safe counterpart to getEffectivePlanById.
 * entitlementModel.can() performs the same strict resolution against its own
 * plan map and denies with code "UNKNOWN_PLAN".
 */
export function getPlanByIdStrict(planId) {
  return getEffectivePlans().find((p) => p.id === planId) ?? null;
}

export function getEffectivePlanMap() {
  return Object.fromEntries(getEffectivePlans().map((p) => [p.id, p]));
}

// ── Global discount ───────────────────────────────────────────────────────────
export function getGlobalDiscount() {
  return ls(GLOBAL_DISCOUNT_KEY) ?? { percent: 0, label: "", active: false, expiresAt: null };
}
export function setGlobalDiscount(discount) {
  lsSet(GLOBAL_DISCOUNT_KEY, discount);
}

// Returns the effective price after applying the global discount
export function applyGlobalDiscount(priceUsd) {
  const disc = getGlobalDiscount();
  if (!disc.active || !disc.percent) return priceUsd;
  if (disc.expiresAt && new Date(disc.expiresAt) < new Date()) return priceUsd;
  return Math.round(priceUsd * (1 - disc.percent / 100) * 100) / 100;
}

// ── Top-up bundle overrides ───────────────────────────────────────────────────
export function getTopupOverrides() {
  return ls(TOPUP_OVERRIDES_KEY) ?? {};
}
export function setTopupOverride(bundleId, override) {
  const all = getTopupOverrides();
  all[bundleId] = { ...(all[bundleId] ?? {}), ...override };
  lsSet(TOPUP_OVERRIDES_KEY, all);
}
export function getEffectiveBundles() {
  const overrides = getTopupOverrides();
  return DEFAULT_BUNDLES.map((b) => {
    const ov = overrides[b.id];
    return ov ? { ...b, ...ov } : b;
  });
}

// ── Credit-pack overrides ─────────────────────────────────────────────────────
//
// Its own key rather than sharing the bundle one, because the two are different
// products: a bundle buys a CAPABILITY (a monitor slot, 50 URLs of list size)
// and a pack buys CREDITS outright. They land in the same `bundles` row of the
// server's `pricing_config` — that table is keyed by purchasable id and does
// not care about the distinction — but an admin editing "Batch Pack" and an
// admin editing "2,000 credits" are doing different jobs and should not be able
// to collide in one storage key.
//
// ⚠️ `credits` IS OVERRIDABLE AND MUST REACH THE SERVER TOO. It decides how
// many credits a purchase GRANTS (verify-payment reads it), so an override that
// changed the price on screen and left the grant behind would sell 2,000
// credits and deliver 500.
export function getCreditPackOverrides() {
  return ls(PACK_OVERRIDES_KEY) ?? {};
}
export function setCreditPackOverride(packId, override) {
  const all = getCreditPackOverrides();
  all[packId] = { ...(all[packId] ?? {}), ...override };
  lsSet(PACK_OVERRIDES_KEY, all);
}
export function resetCreditPackOverrides() {
  try { localStorage.removeItem(PACK_OVERRIDES_KEY); } catch { /* private mode */ }
}
export function getEffectiveCreditPacks() {
  const overrides = getCreditPackOverrides();
  return DEFAULT_PACKS.map((p) => {
    const ov = overrides[p.id];
    return ov ? { ...p, ...ov } : p;
  });
}
