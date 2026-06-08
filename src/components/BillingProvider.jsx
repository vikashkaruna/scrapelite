// BillingProvider.jsx — V5 subscription + usage context with DB sync and alerts.
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  readSubscription, writeSubscription, readUsage,
  incrementExtractions, incrementEnrichments,
  canExtract, canEnrich, canExport, canEmailExport,
} from "../lib/usageService.js";
import { getRates, getDefaultRates } from "../lib/currencyService.js";
import { getEffectivePlanMap } from "../lib/pricingOverrides.js";
import { validateCoupon, incrementCouponUses } from "../lib/adminService.js";
import { syncUsageToDb, fetchUsageFromDb } from "../lib/usageRepo.js";
import { checkAndFireAlerts } from "../lib/alertService.js";

const CURRENCY_KEY = "scrapelite.currency";
function readCurrency() { try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch { return "USD"; } }

const BillingContext = createContext(null);

export function BillingProvider({ children }) {
  const [subscription, setSubscription] = useState(() => readSubscription());
  const [usage, setUsageState]          = useState(() => readUsage());
  const [currency, setCurrencyState]    = useState(() => readCurrency());
  const [rates, setRates]               = useState(() => getDefaultRates());
  const [couponError, setCouponError]   = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  // Reload effective plan map on every render to pick up admin overrides immediately
  const planMap = getEffectivePlanMap();

  useEffect(() => { getRates().then(setRates); }, []);

  // Hydrate usage from Supabase on mount (overrides localStorage if DB has newer data)
  useEffect(() => {
    const current = readUsage();
    fetchUsageFromDb(current.month).then((dbRow) => {
      if (!dbRow) return;
      const merged = {
        month:       dbRow.month,
        extractions: Math.max(current.extractions, dbRow.extractions),
        enrichments: current.enrichments,
      };
      setUsageState(merged);
    });
  }, []);

  const planId = subscription.planId  || "free";
  const bonus  = subscription.bonusExtractions || 0;
  const plan   = planMap[planId] ?? planMap.free;

  const setCurrency = (c) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch {}
  };

  // Debounced DB sync ref — batches rapid increments into a single write
  const syncTimer = useRef(null);
  const pendingUsage = useRef(null);
  const syncToDb = useCallback((u) => {
    pendingUsage.current = u;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      if (pendingUsage.current) syncUsageToDb(pendingUsage.current, planId).catch(() => {});
    }, 2000);
  }, [planId]);

  const setUsage = useCallback((u) => {
    setUsageState(u);
    syncToDb(u);
  }, [syncToDb]);

  const upgradePlan = useCallback((newPlanId) => {
    const sub = { ...subscription, planId: newPlanId, activatedAt: new Date().toISOString() };
    setSubscription(sub);
    writeSubscription(sub);
    setUsageState(readUsage());
  }, [subscription]);

  const trackExtraction = useCallback(() => {
    const u = incrementExtractions();
    setUsage(u);
    // Fire alerts async — don't await (background check)
    const currentPlan = getEffectivePlanMap()[planId] ?? planMap.free;
    checkAndFireAlerts(u, currentPlan, subscription).catch(() => {});
  }, [planId, subscription, setUsage]);

  const trackEnrichment = useCallback((url) => {
    setUsage(incrementEnrichments(url));
  }, [setUsage]);

  const checkCanExtract = useCallback(() => canExtract(planId, bonus), [planId, bonus]);
  const checkCanEnrich  = useCallback((url) => canEnrich(planId, url), [planId]);
  const checkCanExport  = useCallback((fmt) => canExport(planId, fmt), [planId]);
  const checkCanEmail   = useCallback(() => canEmailExport(planId), [planId]);

  const applyBonus = useCallback((extra) => {
    const sub = { ...subscription, bonusExtractions: (subscription.bonusExtractions || 0) + extra };
    setSubscription(sub);
    writeSubscription(sub);
  }, [subscription]);

  const applyCoupon = useCallback((code) => {
    setCouponError("");
    setCouponSuccess("");
    const { valid, reason, coupon } = validateCoupon(code, planId);
    if (!valid) { setCouponError(reason); return false; }
    // Increment coupon use count in admin store
    incrementCouponUses(code);
    let sub = { ...subscription, coupon: { code: coupon.code, appliedAt: new Date().toISOString() } };
    if (coupon.type === "extractions") {
      sub.bonusExtractions = (sub.bonusExtractions || 0) + coupon.value;
    }
    if (coupon.type === "percent") {
      sub.discountPercent = coupon.value;
    }
    setSubscription(sub);
    writeSubscription(sub);
    setCouponSuccess(
      coupon.type === "extractions"
        ? `Coupon applied — ${coupon.value} bonus extractions added to your account.`
        : `Coupon applied — ${coupon.value}% discount on your next upgrade.`
    );
    return true;
  }, [subscription]);

  const removeCoupon = useCallback(() => {
    const sub = { ...subscription, coupon: null, discountPercent: 0 };
    setSubscription(sub);
    writeSubscription(sub);
    setCouponSuccess("");
    setCouponError("");
  }, [subscription]);

  // Refresh usage from localStorage (e.g. after a page focus)
  const refreshUsage = useCallback(() => {
    setUsageState(readUsage());
  }, []);

  return (
    <BillingContext.Provider value={{
      subscription, plan, planId, bonus, usage,
      currency, rates, setCurrency,
      upgradePlan, trackExtraction, trackEnrichment,
      checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
      applyBonus, applyCoupon, removeCoupon, refreshUsage,
      couponError, couponSuccess,
    }}>
      {children}
    </BillingContext.Provider>
  );
}

export const useBilling = () => useContext(BillingContext);
