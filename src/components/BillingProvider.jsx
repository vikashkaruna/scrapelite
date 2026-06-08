// BillingProvider.jsx — V5 subscription + usage context.
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  readSubscription, writeSubscription, readUsage,
  incrementExtractions, incrementEnrichments,
  canExtract, canEnrich, canExport, canEmailExport,
} from "../lib/usageService.js";
import { getRates, getDefaultRates } from "../lib/currencyService.js";
import { PLAN_BY_ID } from "../lib/pricingConfig.js";
import { validateCoupon } from "../lib/adminService.js";

const CURRENCY_KEY = "scrapelite.currency";
function readCurrency() { try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch { return "USD"; } }

const BillingContext = createContext(null);

export function BillingProvider({ children }) {
  const [subscription, setSubscription] = useState(readSubscription);
  const [usage, setUsage] = useState(readUsage);
  const [currency, setCurrencyState] = useState(readCurrency);
  const [rates, setRates] = useState(getDefaultRates);
  const [couponError, setCouponError] = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  useEffect(() => { getRates().then(setRates); }, []);

  const planId  = subscription.planId  || "free";
  const bonus   = subscription.bonusExtractions || 0;
  const plan    = PLAN_BY_ID[planId] ?? PLAN_BY_ID.free;

  const setCurrency = (c) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch {}
  };

  const upgradePlan = useCallback((newPlanId) => {
    const sub = { ...subscription, planId: newPlanId, activatedAt: new Date().toISOString() };
    setSubscription(sub);
    writeSubscription(sub);
    setUsage(readUsage());
  }, [subscription]);

  const trackExtraction = useCallback(() => {
    setUsage(incrementExtractions());
  }, []);

  const trackEnrichment = useCallback((url) => {
    setUsage(incrementEnrichments(url));
  }, []);

  const checkCanExtract = useCallback(() => canExtract(planId, bonus), [planId, bonus, usage]);
  const checkCanEnrich  = useCallback((url) => canEnrich(planId, url), [planId, usage]);
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
    const { valid, reason, coupon } = validateCoupon(code);
    if (!valid) { setCouponError(reason); return false; }
    let sub = { ...subscription, coupon: { code: coupon.code, appliedAt: new Date().toISOString() } };
    if (coupon.type === "extractions") {
      sub.bonusExtractions = (sub.bonusExtractions || 0) + coupon.value;
    }
    setSubscription(sub);
    writeSubscription(sub);
    setCouponSuccess(`Coupon applied! ${coupon.type === "extractions" ? `+${coupon.value} bonus extractions added.` : `${coupon.value}% discount applied.`}`);
    return true;
  }, [subscription]);

  return (
    <BillingContext.Provider value={{
      subscription, plan, planId, bonus, usage,
      currency, rates, setCurrency,
      upgradePlan, trackExtraction, trackEnrichment,
      checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
      applyBonus, applyCoupon, couponError, couponSuccess,
    }}>
      {children}
    </BillingContext.Provider>
  );
}

export const useBilling = () => useContext(BillingContext);
