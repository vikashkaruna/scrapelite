// pricingOverrides.js — Admin-configurable plan price and limit overrides.
// Defaults come from pricingConfig.js; overrides are layered on top and stored
// in localStorage so nothing is hardcoded.

const OVERRIDES_KEY       = "scrapelite.pricingOverrides";
const GLOBAL_DISCOUNT_KEY = "scrapelite.globalDiscount";
const TOPUP_OVERRIDES_KEY = "scrapelite.topupOverrides";

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
import { PLANS as DEFAULT_PLANS, TOPUP_BUNDLES as DEFAULT_BUNDLES, PLAN_BY_ID as DEFAULT_BY_ID } from "./pricingConfig.js";

export function getEffectivePlans() {
  const overrides = getPricingOverrides();
  return DEFAULT_PLANS.map((plan) => {
    const ov = overrides[plan.id];
    if (!ov) return plan;
    return {
      ...plan,
      ...(ov.price_usd !== undefined ? { price_usd: ov.price_usd } : {}),
      ...(ov.name      ? { name:      ov.name      } : {}),
      ...(ov.tagline   ? { tagline:   ov.tagline   } : {}),
      ...(ov.badge !== undefined ? { badge: ov.badge } : {}),
      ...(ov.highlight !== undefined ? { highlight: ov.highlight } : {}),
      limits: ov.limits ? { ...plan.limits, ...ov.limits } : plan.limits,
    };
  });
}

export function getEffectivePlanById(planId) {
  return getEffectivePlans().find((p) => p.id === planId) ?? DEFAULT_BY_ID.free;
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
