// BillingProvider.jsx — V5 subscription + usage context with DB sync, alerts, and payment.
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./AuthProvider.jsx";
import {
  readSubscription, writeSubscription, readUsage,
  incrementExtractions, incrementEnrichments,
  applyTrialCredit,
} from "../lib/usageService.js";
import { can, computeLifecycle } from "../lib/entitlementModel.js";
import { clearEntitlementCache, getCachedEntitlement, loadEntitlement } from "../lib/entitlementClient.js";
import { getRates, getDefaultRates, detectCurrency } from "../lib/currencyService.js";
import { getEffectivePlanMap, getEffectiveBundles } from "../lib/pricingOverrides.js";
import { validateCoupon, incrementCouponUses, checkCouponServer } from "../lib/adminService.js";
import { syncUsageToDb, fetchUsageFromDb, getSessionId } from "../lib/usageRepo.js";
import { fetchAdminGrantCoupon, redeemAdminGrantCoupon as redeemAdminGrantCouponRequest } from "../lib/billingRepo.js";
import { checkAndFireAlerts } from "../lib/alertService.js";
import {
  initiateCheckout, initiateTopupCheckout, hasPayment,
  PAYMENT_STAGE, PAYMENT_STAGE_LABELS,
} from "../lib/paymentService.js";
import { syncSubscriptionToDb, fetchSubscriptionFromDb, logPaymentEvent, fetchPaymentHistory } from "../lib/paymentRepo.js";
import { getPaymentProvider, PROVIDER_META } from "../lib/paymentConfig.js";
import PaymentProcessingModal from "./PaymentProcessingModal.jsx";
import PaymentConfirmModal from "./PaymentConfirmModal.jsx";

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
  // Server-authoritative entitlement row (null until loaded, or for guests).
  // Seeded synchronously from the cache so the first paint already knows the
  // lifecycle state and a suspended user never sees a flash of full access.
  const [entitlementRow, setEntitlementRow] = useState(() => getCachedEntitlement());
  const [adminGrantCoupon, setAdminGrantCoupon] = useState(null);

  // ── Payment progress state (drives PaymentProcessingModal) ──────────────────
  const [paymentStage, setPaymentStage]     = useState(PAYMENT_STAGE.IDLE);
  const [paymentStageMsg, setPaymentStageMsg] = useState("");
  const [paymentPlanName, setPaymentPlanName] = useState("");

  // ── Payment confirmation modal state (shown before every checkout) ───────
  const [confirmTarget, setConfirmTarget] = useState(null); // { planId, billingPeriod } | null
  const confirmResolveRef                 = useRef(null);   // holds the resolve fn while modal is open

  // Reload effective plan map on every render to pick up admin overrides immediately
  const planMap = getEffectivePlanMap();

  // Every mount fetch below is guarded by a `cancelled` flag. These resolve on
  // the network's schedule, so any of them can land after the provider has
  // unmounted — setState on a dead tree. Harmless in the app, but under vitest
  // the jsdom environment is gone by then, so React's dispatchSetState throws
  // "window is not defined" as an unhandled rejection and fails the suite even
  // though every test passed.
  useEffect(() => {
    let cancelled = false;
    getRates().then((r) => { if (!cancelled) setRates(r); });
    return () => { cancelled = true; };
  }, []);

  // Hydrate usage + subscription from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    const current = readUsage();
    fetchUsageFromDb(current.month).then((dbRow) => {
      if (cancelled || !dbRow) return;
      setUsageState({
        month:       dbRow.month,
        extractions: Math.max(current.extractions, dbRow.extractions),
        enrichments: current.enrichments,
      });
    });

    fetchSubscriptionFromDb().then((dbSub) => {
      if (cancelled || !dbSub) return;
      setDbSubscription(dbSub);
      const localSub = readSubscription();
      if (dbSub.plan_id && dbSub.plan_id !== localSub.planId) {
        const merged = { ...localSub, planId: dbSub.plan_id };
        setSubscription(merged);
        writeSubscription(merged);
      }
    });

    fetchPaymentHistory().then((h) => { if (!cancelled) setPaymentHistory(h); });

    return () => { cancelled = true; };
  }, []);

  // Load the server-authoritative entitlement, and reload whenever the signed-in
  // user changes. AuthProvider clears the cache on both sign-in and sign-out, so
  // this always refetches rather than serving the previous user's row.
  useEffect(() => {
    let cancelled = false;
    loadEntitlement()
      .then((row) => { if (!cancelled) setEntitlementRow(row); })
      .catch(() => { /* offline / unconfigured — plan-only gating still works */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    setAdminGrantCoupon(null);
    fetchAdminGrantCoupon().then((grant) => {
      if (!cancelled) setAdminGrantCoupon(grant);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  /** Force a re-read of the entitlement (after a payment, or on demand). */
  const refreshEntitlement = useCallback(async () => {
    clearEntitlementCache();
    const row = await loadEntitlement({ force: true }).catch(() => null);
    setEntitlementRow(row);
    return row;
  }, []);

  const planId = entitlementRow?.plan_id || subscription.planId || "free";
  const bonus  = subscription.bonusExtractions || 0;
  const plan   = planMap[planId] ?? planMap.free;

  /**
   * The entitlement the gates decide against.
   *
   * The server row wins whenever we have one — it is the authoritative answer
   * and the only place lifecycle status exists. localStorage is the fallback so
   * a signed-out or offline user still gets sensible plan-only gating, and so
   * nothing regresses before the migrations are applied.
   *
   * `status` deliberately defaults to "active": a user with no row is a
   * legitimate free user, not a suspended one.
   *
   * `frozen_at` / `deletion_requested_at` (and their two supporting fields)
   * MUST be carried through: `can()`'s freeze/deletion gate (entitlementModel.js
   * §1b) reads them directly off this object, and every client-side pre-flight
   * check (checkCanExtract, checkCanEnrich, checkCanBatch, ...) calls `can()`
   * with exactly this entitlement. Omitting them here doesn't just skip a
   * field — it makes every pre-flight check silently BLIND to a frozen or
   * deletion-pending account, so the request always looks fine client-side and
   * only the server (which reads the real row) ever refuses it. That is what
   * let a scheduled-for-deletion account keep hitting extract/enrich and
   * burning a real provider call each time before finding out.
   */
  const entitlement = useMemo(
    () => ({
      plan_id:               planId,
      status:                entitlementRow?.status ?? "active",
      source:                entitlementRow?.source ?? null,
      period_end:            entitlementRow?.period_end ?? null,
      comp_until:            entitlementRow?.comp_until ?? null,
      frozen_at:             entitlementRow?.frozen_at ?? null,
      frozen_reason:         entitlementRow?.frozen_reason ?? null,
      deletion_requested_at: entitlementRow?.deletion_requested_at ?? null,
      deletion_purge_after:  entitlementRow?.deletion_purge_after ?? null,
    }),
    [planId, entitlementRow],
  );

  const lifecycle = useMemo(() => computeLifecycle(entitlement), [entitlement]);
  const isSuspended = lifecycle.status !== "active";

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
    setPaymentStage(PAYMENT_STAGE.IDLE);
    setPaymentError("");

    // Step 1: Show confirmation modal with pricing breakdown (before any payment call)
    const confirmed = await new Promise((resolve) => {
      confirmResolveRef.current = resolve; // resolves with { planId, couponCode } or null (cancel)
      setConfirmTarget({ planId: targetPlanId, billingPeriod });
    });
    setConfirmTarget(null);
    confirmResolveRef.current = null;

    if (!confirmed) return { status: "cancelled" };

    // Step 2: Proceed with (possibly upgraded) plan + (possibly inline-applied) coupon.
    // Read the coupon from the modal's resolution (fresh) — the closure's `subscription`
    // may be stale if the user applied a coupon inside the modal this same render.
    const confirmedPlanId = confirmed.planId;
    const confirmedCoupon = confirmed.couponCode || subscription.coupon?.code || null;
    const targetPlan = planMap[confirmedPlanId] ?? planMap.free;
    setPaymentPlanName(targetPlan.name || confirmedPlanId);
    setPaymentLoading(true);

    try {
      const result = await initiateCheckout({
        planId:          confirmedPlanId,
        currency,
        rates,
        billingPeriod,
        couponCode:      confirmedCoupon,
        sessionId:       getSessionId(),
        email:           user?.email || subscription.email || null,
        mobile:          user?.phone || subscription.mobile || null,
        onStageChange:   handleStageChange,
      });

      if (result.status === "demo_mode") {
        // No payment keys — auto-upgrade locally (confirmation was already shown above)
        upgradePlan(confirmedPlanId);
        return { status: "demo_mode" };

      } else if (result.status === "free") {
        // Server resolved a 100%-off coupon/sale — the plan is granted without
        // ever loading Razorpay/Stripe. Mirrors the demo_mode bookkeeping (no
        // real gateway order exists to snapshot, so there is nothing more to
        // sync than the plan + a zero-amount audit trail).
        upgradePlan(confirmedPlanId);
        await syncSubscriptionToDb(confirmedPlanId, "free_coupon", {});
        await logPaymentEvent({
          type:        "payment.captured",
          provider:    "free_coupon",
          providerId:  confirmedCoupon || "sale",
          planId:      confirmedPlanId,
          amountCents: 0,
          currency,
        });
        setPaymentHistory(await fetchPaymentHistory());
        return { status: "free", planId: confirmedPlanId };

      } else if (result.status === "success") {
        // Razorpay modal completed — paymentStage is already ACTIVATING from the callback
        upgradePlan(confirmedPlanId);
        await syncSubscriptionToDb(confirmedPlanId, result.provider, {
          subscriptionId: result.subscriptionId,
          customerId:     result.customerId,
          orderId:        result.orderId,   // razorpay_order_id — persisted on subscription
        });
        await logPaymentEvent({
          type:        "payment.captured",
          provider:    result.provider,
          providerId:  result.paymentId || result.orderId, // razorpay_payment_id
          planId:      confirmedPlanId,
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
    // FR-Z-02 (Q2 2026-07-15) fallback: if the trial credit hasn't been
    // applied yet (e.g. a logged-in user who never went through the
    // signup-time branch), apply it now. Idempotent — re-runs are no-ops.
    if (!user) {
      const applied = applyTrialCredit(planId);
      if (applied.applied) {
        setSubscription(applied.sub);
      }
    }
    const u = incrementExtractions(count);
    setUsage(u);
    const currentPlan = getEffectivePlanMap()[planId] ?? planMap.free;
    checkAndFireAlerts(u, currentPlan, subscription).catch(() => {});
  }, [planId, subscription, setUsage, user]);

  const trackEnrichment = useCallback((url) => {
    setUsage(incrementEnrichments(url));
  }, [setUsage]);

  // ── Capability gates ────────────────────────────────────────────────────────
  // Reimplemented over entitlementModel.can(), the same pure function the
  // Netlify functions use, so the browser and the server can never disagree.
  //
  // Signatures and return shapes are UNCHANGED — including checkCanExport and
  // checkCanEmail returning a bare boolean — so the ~28 call sites in Preview /
  // Dashboard / Batch / ExtractionProvider need no edits. Reason strings for
  // plan limits are identical to before; the new case is lifecycle (suspended /
  // deactivated), which the existing per-call-site toasts cannot express. That
  // is deliberate: suspended UX belongs in one global banner and route guards
  // (PR3), not in 20 rewritten toast strings. Use whyCannot() for the reason.
  const gateCtx = useCallback(
    (extra) => ({ planMap, usage: readUsage(), bonus, bonusBatchUrls: subscription.bonusBatchUrls || 0, ...extra }),
    [planMap, bonus, subscription.bonusBatchUrls],
  );

  const checkCanExtract      = useCallback(() => can(entitlement, "extract", gateCtx()), [entitlement, gateCtx, usage]);
  const checkCanEnrich       = useCallback((url) => can(entitlement, "enrich", gateCtx({ url })), [entitlement, gateCtx, usage]);
  const checkCanExport       = useCallback((fmt) => can(entitlement, `export.${fmt}`, gateCtx()).allowed, [entitlement, gateCtx]);
  const checkCanEmail        = useCallback(() => can(entitlement, "export.email", gateCtx()).allowed, [entitlement, gateCtx]);
  const checkCanBatch        = useCallback((urlCount) => can(entitlement, "batch", gateCtx({ urlCount })), [entitlement, gateCtx]);
  const checkCanExtractBatch = useCallback((urlCount) => can(entitlement, "extract.batch", gateCtx({ urlCount })), [entitlement, gateCtx, usage]);
  // Push integrations (HubSpot, Notion, Airtable, Slack) — Select and up.
  // Google Sheets is NOT gated by this: it needs no connection and is a
  // client-side CSV download, not a real integration (see PushIntegrationMenu).
  const checkCanIntegrations = useCallback(() => can(entitlement, "integrations", gateCtx()).allowed, [entitlement, gateCtx]);

  /**
   * Full denial detail for any capability — `{ allowed, reason, code, upgradeTo }`.
   * Companion to the boolean gates above, for callers that need to explain WHY
   * (in particular to distinguish "your plan doesn't include this" from "your
   * subscription lapsed").
   */
  const whyCannot = useCallback(
    (capability, extra) => can(entitlement, capability, gateCtx(extra)),
    [entitlement, gateCtx],
  );

  const applyBonus = useCallback((extra) => {
    const sub = { ...subscription, bonusExtractions: (subscription.bonusExtractions || 0) + extra };
    setSubscription(sub);
    writeSubscription(sub);
  }, [subscription]);

  const applyCoupon = useCallback(async (code) => {
    setCouponError("");
    setCouponSuccess("");
    // Admin grant coupons use redeemAdminGrantCoupon() below. Keeping them out
    // of this path is what prevents a complimentary plan grant from touching
    // normal paid checkout or public coupon usage.
    const trimmed = String(code || "").trim();
    if (!trimmed) { setCouponError("Enter a coupon code."); return false; }

    // Prefer the server's real verdict — same source of truth checkout uses
    // (lib/pricingSource.js), including the actual redemption count, which a
    // purely local check has no way to see. Falls back to the local check
    // below only for coupon types the server doesn't track (extraction-bonus,
    // manual-assign) or if the request itself fails.
    const serverInfo = await checkCouponServer(trimmed);
    if (serverInfo) {
      if (!serverInfo.active) { setCouponError("This coupon has been deactivated."); return false; }
      if (serverInfo.expired) { setCouponError("This coupon has expired."); return false; }
      if (serverInfo.exhausted) { setCouponError("This coupon has reached its usage limit."); return false; }

      const restrictTo = serverInfo.planId || null;
      const restrictedPlan = restrictTo ? planMap[restrictTo] : null;
      const restrictedLabel = restrictedPlan?.name || restrictTo;

      const sub = { ...subscription, coupon: { code: trimmed.toUpperCase(), appliedAt: new Date().toISOString() } };
      sub.discountPercent = serverInfo.value;
      setSubscription(sub);
      writeSubscription(sub);

      if (restrictTo && restrictTo === planId) {
        // Already on the exact plan this coupon restricts to — applying it
        // now can't discount an upgrade that doesn't exist, so say so instead
        // of the generic "on your next upgrade" line, which would be untrue.
        setCouponSuccess(
          `This coupon is for the ${restrictedLabel} plan, which you're already on — it won't discount a different plan.`
        );
      } else if (restrictTo) {
        setCouponSuccess(`Coupon applied — ${serverInfo.value}% off when you upgrade to ${restrictedLabel}.`);
      } else {
        setCouponSuccess(`Coupon applied — ${serverInfo.value}% discount on your next upgrade.`);
      }
      return true;
    }

    const { valid, reason, coupon } = validateCoupon(trimmed, planId);
    if (!valid) { setCouponError(reason); return false; }
    incrementCouponUses(trimmed);
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
  }, [subscription, planId, planMap]);

  const redeemAdminGrant = useCallback(async (code) => {
    setCouponError("");
    setCouponSuccess("");
    try {
      const result = await redeemAdminGrantCouponRequest(code);
      setAdminGrantCoupon((current) => ({
        ...(current || {}),
        code: result.code,
        planId: result.plan_id,
        validityMonths: result.validity_months,
        status: "redeemed",
        periodStart: result.period_start,
        periodEnd: result.period_end,
        redeemedAt: new Date().toISOString(),
      }));
      await refreshEntitlement();
      setCouponSuccess(`Plan grant applied — ${result.plan_id} is active through ${new Date(result.period_end).toLocaleDateString()}.`);
      return true;
    } catch (err) {
      setCouponError(err.message || "Could not redeem this plan grant.");
      return false;
    }
  }, [refreshEntitlement]);

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

  // ── Payment confirm modal callbacks ──────────────────────────────────────
  const handlePaymentConfirm = useCallback((planId, couponCode) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmTarget(null);
    resolve?.(planId ? { planId, couponCode: couponCode || null } : null);
  }, []);

  const handlePaymentConfirmCancel = useCallback(() => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmTarget(null);
    resolve?.(null);
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
    checkCanBatch, checkCanExtractBatch, checkCanIntegrations, whyCannot,
    entitlement, lifecycle, isSuspended, refreshEntitlement,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess, adminGrantCoupon, redeemAdminGrant,
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
    checkCanBatch, checkCanExtractBatch, checkCanIntegrations, whyCannot,
    entitlement, lifecycle, isSuspended, refreshEntitlement,
    applyBonus, applyCoupon, removeCoupon, refreshUsage,
    couponError, couponSuccess, adminGrantCoupon, redeemAdminGrant,
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
      {/* Payment confirmation modal — shown before every checkout (real or demo) */}
      {confirmTarget && (
        <PaymentConfirmModal
          planId={confirmTarget.planId}
          billingPeriod={confirmTarget.billingPeriod}
          currency={currency}
          currentPlanId={planId}
          appliedCouponCode={subscription.coupon?.code || ""}
          assignedCoupon={
            user?.user_metadata?.coupon_availed
              ? {
                  code:    user.user_metadata.coupon_availed,
                  planId:  user.user_metadata.coupon_plan_id || null,
                }
              : null
          }
          onApplyCoupon={applyCoupon}
          onRemoveCoupon={removeCoupon}
          onConfirm={handlePaymentConfirm}
          onCancel={handlePaymentConfirmCancel}
        />
      )}
    </BillingContext.Provider>
  );
}

export const useBilling = () => useContext(BillingContext);
