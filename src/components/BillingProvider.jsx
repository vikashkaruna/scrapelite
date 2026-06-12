// BillingProvider.jsx — V5 subscription + usage context with DB sync, alerts, and payment.
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./AuthProvider.jsx";
import {
  readSubscription, writeSubscription, readUsage,
  incrementExtractions, incrementEnrichments,
  canExtract, canEnrich, canExport, canEmailExport,
  canBatch, canExtractBatch,
} from "../lib/usageService.js";
import { getRates, getDefaultRates, detectCurrency } from "../lib/currencyService.js";
import { getEffectivePlanMap, getEffectiveBundles } from "../lib/pricingOverrides.js";
import { validateCoupon, incrementCouponUses } from "../lib/adminService.js";
import { syncUsageToDb, fetchUsageFromDb, getSessionId } from "../lib/usageRepo.js";
import { checkAndFireAlerts } from "../lib/alertService.js";
import {
  initiateCheckout, initiateTopupCheckout, hasPayment,
  PAYMENT_STAGE, PAYMENT_STAGE_LABELS,
} from "../lib/paymentService.js";
import { syncSubscriptionToDb, fetchSubscriptionFromDb, logPaymentEvent, fetchPaymentHistory } from "../lib/paymentRepo.js";
import { getPaymentProvider, PROVIDER_META } from "../lib/paymentConfig.js";
import PaymentProcessingModal from "./PaymentProcessingModal.jsx";
import DemoPaymentModal from "./DemoPaymentModal.jsx";

const CURRENCY_KEY = "datiq.currency";
function readCurrency() { try { return localStorage.getItem(CURRENCY_KEY) || detectCurrency(); } catch { return detectCurrency(); } }

const BillingContext = createContext(null);

export function BillingProvider({ children }) {
  const { user } = useAuth();
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

  // ── Payment progress state (drives PaymentProcessingModal) ──────────────────
  const [paymentStage, setPaymentStage]     = useState(PAYMENT_STAGE.IDLE);
  const [paymentStageMsg, setPaymentStageMsg] = useState("");
  const [paymentPlanName, setPaymentPlanName] = useState("");

  // ── Demo checkout modal state (no-key environments) ──────────────────────
  const [demoTarget, setDemoTarget]   = useState(null); // { planId, billingPeriod } | null
  const demoResolveRef                = useRef(null);   // holds the resolve fn while modal is open

  // Reload effective plan map on every render to pick up admin overrides immediately
  const planMap = getEffectivePlanMap();

  useEffect(() => { getRates().then(setRates); }, []);

  // Hydrate usage + subscription from Supabase on mount
  useEffect(() => {
    const current = readUsage();
    fetchUsageFromDb(current.month).then((dbRow) => {
      if (!dbRow) return;
      setUsageState({
        month:       dbRow.month,
        extractions: Math.max(current.extractions, dbRow.extractions),
        enrichments: current.enrichments,
      });
    });

    fetchSubscriptionFromDb().then((dbSub) => {
      if (!dbSub) return;
      setDbSubscription(dbSub);
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

  // Debounced DB sync
  const syncTimer    = useRef(null);
  const pendingUsage = useRef(null);
  const lastPaymentArgs = useRef(null); // stored for retry after payment failure
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

  // ── Plan upgrade (local-only) ─────────────────────────────────────────────
  const upgradePlan = useCallback((newPlanId) => {
    const sub = { ...subscription, planId: newPlanId, activatedAt: new Date().toISOString() };
    setSubscription(sub);
    writeSubscription(sub);
    setUsageState(readUsage());
  }, [subscription]);

  // ── onStageChange callback passed to paymentService ──────────────────────
  const handleStageChange = useCallback((stage, msg) => {
    setPaymentStage(stage);
    setPaymentStageMsg(msg || PAYMENT_STAGE_LABELS[stage] || "");
  }, []);

  // ── Real payment initiation ───────────────────────────────────────────────
  // billingPeriod: "monthly" | "annual" — passed from Pricing.jsx
  const initiatePayment = useCallback(async (targetPlanId, billingPeriod = "monthly") => {
    if (targetPlanId === "free") { upgradePlan("free"); return { status: "free" }; }

    lastPaymentArgs.current = { targetPlanId, billingPeriod };
    const targetPlan = planMap[targetPlanId] ?? planMap.free;
    setPaymentPlanName(targetPlan.name || targetPlanId);
    setPaymentStage(PAYMENT_STAGE.IDLE);
    setPaymentError("");
    setPaymentLoading(true);

    try {
      const result = await initiateCheckout({
        planId:          targetPlanId,
        currency,
        rates,
        billingPeriod,
        discountPercent: subscription.discountPercent || 0,
        sessionId:       getSessionId(),
        email:           user?.email || subscription.email || null,
        mobile:          user?.phone || subscription.mobile || null,
        onStageChange:   handleStageChange,
      });

      if (result.status === "demo_mode") {
        // Show a confirmation modal instead of silently upgrading.
        // Pause the async flow until the user clicks Confirm or Cancel.
        setPaymentLoading(false); // spinner off; modal takes over
        const confirmed = await new Promise((resolve) => {
          demoResolveRef.current = resolve;
          setDemoTarget({ planId: targetPlanId, billingPeriod });
        });
        setDemoTarget(null);
        demoResolveRef.current = null;
        if (confirmed) {
          upgradePlan(targetPlanId);
          return { status: "demo_mode" };
        } else {
          return { status: "cancelled" };
        }

      } else if (result.status === "success") {
        // Razorpay modal completed — paymentStage is already ACTIVATING from the callback
        upgradePlan(targetPlanId);
        await syncSubscriptionToDb(targetPlanId, result.provider, {
          subscriptionId: result.subscriptionId,
          customerId:     result.customerId,
        });
        await logPaymentEvent({
          type:        "payment.captured",
          provider:    result.provider,
          providerId:  result.paymentId || result.orderId,
          planId:      targetPlanId,
          amountCents: result.amount,
          currency:    result.currency,
        });
        setPaymentHistory(await fetchPaymentHistory());
        setPaymentStage(PAYMENT_STAGE.IDLE); // clear modal — page will navigate to /account

      } else if (result.status === "cancelled") {
        // Stage is already set to CANCELLED by paymentService callback — modal shows cancel message
        // Keep CANCELLED state so modal displays; user dismisses via onCancel

      } else if (result.status === "redirecting") {
        // Stripe redirect — page navigates away; no modal cleanup needed
      }

      return result;
    } catch (e) {
      const msg = e.message || "Payment failed. Please try again.";
      setPaymentStage(PAYMENT_STAGE.ERROR);
      setPaymentStageMsg(msg);
      setPaymentError(msg);
      throw e;
    } finally {
      setPaymentLoading(false);
    }
  }, [currency, rates, subscription, upgradePlan, planMap, handleStageChange]);

  // ── Top-up bundle purchase (extractions, batch URLs, schedulers, workspaces) ─
  const purchaseBatchPack = useCallback(async (bundleId = "batch-pack", qty = 1) => {
    const bundle    = getEffectiveBundles().find((b) => b.id === bundleId);
    const bonusUrls = (bundle?.bonusBatchUrls || 0) * qty;
    const bonusExtr = (bundle?.bonusExtractions || 0) * qty;

    const grantBundle = (sub) => {
      const updated = {
        ...sub,
        ...(bonusUrls > 0 ? { bonusBatchUrls: (sub.bonusBatchUrls || 0) + bonusUrls } : {}),
        ...(bonusExtr > 0 ? { bonusExtractions: (sub.bonusExtractions || 0) + bonusExtr } : {}),
      };
      setSubscription(updated);
      writeSubscription(updated);
    };

    if (!hasPayment) {
      grantBundle(subscription);
      return { status: "demo_mode", bonusUrls, bonusExtr };
    }

    setPaymentPlanName(bundle?.name || bundleId);
    setPaymentStage(PAYMENT_STAGE.IDLE);
    setPaymentLoading(true);
    setPaymentError("");

    try {
      const result = await initiateTopupCheckout({
        bundleId,
        currency,
        rates,
        qty,
        sessionId:     getSessionId(),
        email:         user?.email || subscription.email || null,
        mobile:        user?.phone || subscription.mobile || null,
        onStageChange: handleStageChange,
      });
      if (result?.status === "demo_mode" || result?.status === "success") {
        grantBundle(subscription);
      }
      setPaymentStage(PAYMENT_STAGE.IDLE);
      return result;
    } catch (e) {
      const msg = e.message || "Purchase failed. Please try again.";
      setPaymentStage(PAYMENT_STAGE.ERROR);
      setPaymentStageMsg(msg);
      setPaymentError(msg);
      throw e;
    } finally {
      setPaymentLoading(false);
    }
  }, [currency, rates, subscription, handleStageChange]);

  // ── Post-Stripe-redirect confirmation (called from PaymentSuccess page) ──
  const confirmPayment = useCallback(async (confirmedPlanId, { provider } = {}) => {
    await syncSubscriptionToDb(confirmedPlanId, provider || null, {});
    setPaymentHistory(await fetchPaymentHistory());
  }, []);

  const trackExtraction = useCallback((count = 1) => {
    const u = incrementExtractions(count);
    setUsage(u);
    const currentPlan = getEffectivePlanMap()[planId] ?? planMap.free;
    checkAndFireAlerts(u, currentPlan, subscription).catch(() => {});
  }, [planId, subscription, setUsage]);

  const trackEnrichment = useCallback((url) => {
    setUsage(incrementEnrichments(url));
  }, [setUsage]);

  const checkCanExtract      = useCallback(() => canExtract(planId, bonus), [planId, bonus]);
  const checkCanEnrich       = useCallback((url) => canEnrich(planId, url), [planId]);
  const checkCanExport       = useCallback((fmt) => canExport(planId, fmt), [planId]);
  const checkCanEmail        = useCallback(() => canEmailExport(planId), [planId]);
  const checkCanBatch        = useCallback((urlCount) => canBatch(planId, urlCount, subscription.bonusBatchUrls || 0), [planId, subscription]);
  const checkCanExtractBatch = useCallback((urlCount) => canExtractBatch(planId, urlCount, bonus), [planId, bonus]);

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
    if (coupon.type === "extractions") sub.bonusExtractions = (sub.bonusExtractions || 0) + coupon.value;
    if (coupon.type === "percent")     sub.discountPercent  = coupon.value;
    setSubscription(sub);
    writeSubscription(sub);
    setCouponSuccess(
      coupon.type === "extractions"
        ? `Coupon applied — ${coupon.value} bonus extractions added.`
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

  const paymentProvider = getPaymentProvider(currency);
  const providerMeta    = paymentProvider ? PROVIDER_META[paymentProvider] : null;

  // Reset modal after CANCELLED state if user navigates away (cleanup on unmount is not needed
  // since this provider lives at the root, but we expose setPaymentStage for page-level dismiss)
  const dismissPaymentModal = useCallback(() => {
    setPaymentStage(PAYMENT_STAGE.IDLE);
    setPaymentStageMsg("");
    setPaymentError("");
  }, []);

  // ── Demo modal confirm / cancel ───────────────────────────────────────────
  const confirmDemoPayment = useCallback(() => {
    const resolve = demoResolveRef.current;
    demoResolveRef.current = null;
    setDemoTarget(null);
    resolve?.(true);
  }, []);

  const cancelDemoPayment = useCallback(() => {
    const resolve = demoResolveRef.current;
    demoResolveRef.current = null;
    setDemoTarget(null);
    resolve?.(false);
  }, []);

  const retryPayment = useCallback(() => {
    const args = lastPaymentArgs.current;
    if (args) {
      initiatePayment(args.targetPlanId, args.billingPeriod);
    } else {
      dismissPaymentModal();
    }
  }, [initiatePayment, dismissPaymentModal]);

  const ctx = useMemo(() => ({
    subscription, plan, planId, bonus, usage,
    currency, rates, setCurrency,
    upgradePlan,
    initiatePayment, confirmPayment, purchaseBatchPack,
    paymentLoading, paymentError, setPaymentError,
    paymentProvider, providerMeta, hasPayment,
    paymentHistory, dbSubscription,
    // Payment stage (for PaymentProcessingModal — also useful for callers to poll)
    paymentStage, paymentStageMsg, dismissPaymentModal,
    trackExtraction, trackEnrichment,
    checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
    checkCanBatch, checkCanExtractBatch,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess,
  }), [
    subscription, plan, planId, bonus, usage,
    currency, rates, setCurrency,
    upgradePlan,
    initiatePayment, confirmPayment, purchaseBatchPack,
    paymentLoading, paymentError, setPaymentError,
    paymentProvider, providerMeta, hasPayment,
    paymentHistory, dbSubscription,
    paymentStage, paymentStageMsg, dismissPaymentModal,
    trackExtraction, trackEnrichment,
    checkCanExtract, checkCanEnrich, checkCanExport, checkCanEmail,
    checkCanBatch, checkCanExtractBatch,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess,
  ]);

  return (
    <BillingContext.Provider value={ctx}>
      {children}
      {/* Payment processing overlay — global, works for any payment trigger */}
      <PaymentProcessingModal
        stage={paymentStage}
        stageMsg={paymentStageMsg}
        planName={paymentPlanName}
        onRetry={retryPayment}
        onCancel={dismissPaymentModal}
      />
      {/* Demo checkout modal — shown when no payment gateway is configured */}
      {demoTarget && (
        <DemoPaymentModal
          plan={planMap[demoTarget.planId] ?? planMap.free}
          billingPeriod={demoTarget.billingPeriod}
          currency={currency}
          rates={rates}
          onConfirm={confirmDemoPayment}
          onCancel={cancelDemoPayment}
        />
      )}
    </BillingContext.Provider>
  );
}

export const useBilling = () => useContext(BillingContext);
