// BillingProvider.jsx — V5 subscription + usage context with DB sync, alerts, and payment.
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  readSubscription, writeSubscription, readUsage,
  incrementExtractions, incrementEnrichments,
  canExtract, canEnrich, canExport, canEmailExport,
} from "../lib/usageService.js";
import { getRates, getDefaultRates } from "../lib/currencyService.js";
import { getEffectivePlanMap } from "../lib/pricingOverrides.js";
import { validateCoupon, incrementCouponUses } from "../lib/adminService.js";
import { syncUsageToDb, fetchUsageFromDb, getSessionId } from "../lib/usageRepo.js";
import { checkAndFireAlerts } from "../lib/alertService.js";
import { initiateCheckout, hasPayment } from "../lib/paymentService.js";
import { syncSubscriptionToDb, fetchSubscriptionFromDb, logPaymentEvent, fetchPaymentHistory } from "../lib/paymentRepo.js";
import { getPaymentProvider, PROVIDER_META } from "../lib/paymentConfig.js";

const CURRENCY_KEY = "datiq.currency";
function readCurrency() { try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch { return "USD"; } }

const BillingContext = createContext(null);

export function BillingProvider({ children }) {
  const [subscription, setSubscription] = useState(() => readSubscription());
  const [usage, setUsageState]          = useState(() => readUsage());
  const [currency, setCurrencyState]    = useState(() => readCurrency());
  const [rates, setRates]               = useState(() => getDefaultRates());
  const [couponError, setCouponError]   = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError]     = useState("");
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [dbSubscription, setDbSubscription] = useState(null);

  // Reload effective plan map on every render to pick up admin overrides immediately
  const planMap = getEffectivePlanMap();

  useEffect(() => { getRates().then(setRates); }, []);

  // Hydrate usage + subscription from Supabase on mount
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

    fetchSubscriptionFromDb().then((dbSub) => {
      if (!dbSub) return;
      setDbSubscription(dbSub);
      // Sync DB plan into local state if it differs
      const localSub = readSubscription();
      if (dbSub.plan_id && dbSub.plan_id !== localSub.planId) {
        const merged = { ...localSub, planId: dbSub.plan_id };
        setSubscription(merged);
        writeSubscription(merged);
      }
    });

    fetchPaymentHistory().then(setPaymentHistory);
  }, []);

  const planId = subscription.planId  || "free";
  const bonus  = subscription.bonusExtractions || 0;
  const plan   = planMap[planId] ?? planMap.free;

  const setCurrency = (c) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch {}
  };

  // Debounced DB sync ref
  const syncTimer   = useRef(null);
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

  // ── Plan upgrade (local-only, used for free plan and post-payment confirmation) ──
  const upgradePlan = useCallback((newPlanId) => {
    const sub = { ...subscription, planId: newPlanId, activatedAt: new Date().toISOString() };
    setSubscription(sub);
    writeSubscription(sub);
    setUsageState(readUsage());
  }, [subscription]);

  // ── Real payment initiation ───────────────────────────────────────────────
  const initiatePayment = useCallback(async (targetPlanId) => {
    if (targetPlanId === "free") { upgradePlan("free"); return { status: "free" }; }
    setPaymentLoading(true);
    setPaymentError("");
    try {
      const result = await initiateCheckout({
        planId:          targetPlanId,
        currency,
        rates,
        discountPercent: subscription.discountPercent || 0,
        sessionId:       getSessionId(),
        email:           subscription.email || null,
      });

      if (result.status === "demo_mode") {
        upgradePlan(targetPlanId);
      } else if (result.status === "success") {
        // Razorpay in-modal success — verify + activate
        upgradePlan(targetPlanId);
        await syncSubscriptionToDb(targetPlanId, result.provider, {
          subscriptionId: result.subscriptionId,
          customerId:     result.customerId,
        });
        await logPaymentEvent({
          type:        result.provider === "razorpay" ? "payment.captured" : "checkout.session.completed",
          provider:    result.provider,
          providerId:  result.paymentId || result.orderId,
          planId:      targetPlanId,
          amountCents: result.amount,
          currency:    result.currency,
        });
        setPaymentHistory(await fetchPaymentHistory());
      }
      return result; // caller (Pricing.jsx) uses this to decide navigation
    } catch (e) {
      setPaymentError(e.message || "Payment failed. Please try again.");
      throw e;
    } finally {
      setPaymentLoading(false);
    }
  }, [currency, rates, subscription, upgradePlan]);

  // ── Post-Stripe-redirect confirmation (called from PaymentSuccess page) ──
  const confirmPayment = useCallback(async (confirmedPlanId, { provider } = {}) => {
    await syncSubscriptionToDb(confirmedPlanId, provider || null, {});
    setPaymentHistory(await fetchPaymentHistory());
  }, []);

  const trackExtraction = useCallback(() => {
    const u = incrementExtractions();
    setUsage(u);
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
  }, [subscription, planId]);

  const removeCoupon = useCallback(() => {
    const sub = { ...subscription, coupon: null, discountPercent: 0 };
    setSubscription(sub);
    writeSubscription(sub);
    setCouponSuccess("");
    setCouponError("");
  }, [subscription]);

  const refreshUsage = useCallback(() => {
    setUsageState(readUsage());
  }, []);

  // Derived: payment provider for current currency
  const paymentProvider = getPaymentProvider(currency);
  const providerMeta    = paymentProvider ? PROVIDER_META[paymentProvider] : null;

  const ctx = useMemo(() => ({
    subscription, plan, planId, bonus, usage,
    currency, rates, setCurrency,
    upgradePlan,
    initiatePayment, confirmPayment,
    paymentLoading, paymentError, setPaymentError,
    paymentProvider, providerMeta, hasPayment,
    paymentHistory, dbSubscription,
    trackExtraction, trackEnrichment,
    checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess,
  }), [
    subscription, plan, planId, bonus, usage,
    currency, rates, setCurrency,
    upgradePlan,
    initiatePayment, confirmPayment,
    paymentLoading, paymentError, setPaymentError,
    paymentProvider, providerMeta, hasPayment,
    paymentHistory, dbSubscription,
    trackExtraction, trackEnrichment,
    checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess,
  ]);

  return (
    <BillingContext.Provider value={ctx}>
      {children}
    </BillingContext.Provider>
  );
}

export const useBilling = () => useContext(BillingContext);
