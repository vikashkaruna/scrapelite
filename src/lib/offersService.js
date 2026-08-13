// offersService.js — derives publicly-displayable active coupons/discounts
// from the same client-side sources Pricing.jsx's existing discount banner
// and PaymentConfirmModal already read (adminService coupons + the global
// sale), so Home/Pricing/Account all agree with what checkout will actually
// apply. Admin-assign-only ("manual") coupons are never surfaced here — see
// AdminUsers.jsx / Account.jsx for how those reach the specific user they
// were assigned to.
import { getCoupons } from "./adminService.js";
import { getGlobalDiscount } from "./pricingOverrides.js";

function isActiveCoupon(c) {
  if (!c.active || c.planId === "manual") return false;
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return false;
  if (c.maxUses && c.uses >= c.maxUses) return false;
  return true;
}

/** Active global sale, or null. */
export function getActiveSale() {
  const d = getGlobalDiscount();
  if (!d?.active || !d.percent) return null;
  if (d.expiresAt && new Date(d.expiresAt) < new Date()) return null;
  return d;
}

/** Every publicly-advertisable active coupon (excludes admin-assign-only "manual" codes). */
export function getPublicCoupons() {
  return getCoupons().filter(isActiveCoupon);
}

/** Public coupons restricted to one specific plan id. */
export function getCouponsForPlan(planId) {
  return getPublicCoupons().filter((c) => c.planId === planId);
}

/** Public coupons with no plan restriction (apply to any plan). */
export function getUnrestrictedCoupons() {
  return getPublicCoupons().filter((c) => !c.planId);
}

/**
 * Single best headline offer for a compact, page-level banner — prefers the
 * global sale, then the highest-value unrestricted percent coupon, then the
 * largest unrestricted bonus-extractions coupon. Returns null when nothing
 * is active.
 */
export function getHeadlineOffer() {
  const sale = getActiveSale();
  if (sale) return { kind: "sale", percent: sale.percent, label: sale.label, expiresAt: sale.expiresAt };

  const unrestricted = getUnrestrictedCoupons();
  const bestPercent = unrestricted
    .filter((c) => c.type === "percent")
    .sort((a, b) => b.value - a.value)[0];
  if (bestPercent) {
    return { kind: "coupon", code: bestPercent.code, percent: bestPercent.value, expiresAt: bestPercent.expiresAt };
  }

  const bestBonus = unrestricted
    .filter((c) => c.type === "extractions")
    .sort((a, b) => b.value - a.value)[0];
  if (bestBonus) {
    return { kind: "bonus", code: bestBonus.code, amount: bestBonus.value, expiresAt: bestBonus.expiresAt };
  }

  return null;
}
