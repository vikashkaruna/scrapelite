// src/lib/creditEstimator.js — Q2 (pre-flight credit estimator) pure logic.
//
// Tells the user what a planned run will cost BEFORE they press the button.
//
// 🔴 THIS FILE USED TO ESTIMATE EXTRACTIONS AGAINST THE RETIRED EXTRACTION
// QUOTA, AND AFTER THE CREDIT SWITCH THAT LIED IN THE BLOCKING DIRECTION.
// It read `plan.limits.extractions` (free = 10) minus `usage.extractions`, so a
// free account with a full 100-credit pool was told "Blocked — 10 remaining, 12
// needed" for a batch the server would have run for 12 credits. A pre-flight
// that refuses a run the gate would allow is worse than no pre-flight: the user
// never learns it was wrong, because they never press the button.
//
// It now costs the run in CREDITS, at `CREDIT_WEIGHTS.page_fetch` per page, and
// reads the balance from the same `credits` hint `entitlementModel.creditGate`
// decides against — so the banner and the gate cannot disagree about a number
// they are both looking at.
//
// ⚠️ IT MIRRORS `creditGate`'s FAIL-OPEN, DELIBERATELY. An unknown balance
// (guest, never granted, or an unreadable read) yields `known: false` and
// `allowed: true`, exactly as the gate returns ok(). A banner that blocks on a
// cache miss blocks paying customers during a blip, and it would be the only
// thing in the client doing so.
//
// Returns:
//   {
//     required:    number            // credits this run costs
//     remaining:   number            // credits in the pool (Infinity = unknown)
//     afterRun:    number            // credits left after this run
//     allowed:     boolean           // true if the run can proceed
//     known:       boolean           // false = we have no balance to show
//     planId, planName, reason?, overage, message, tone
//   }

import { getEffectivePlanById, getEffectivePlanMap } from "./pricingOverrides.js";
import { CREDIT_WEIGHTS } from "./credits/creditWeights.js";

/**
 * The one place the estimator reads a balance, and it reads it exactly as
 * `entitlementModel.creditsCtx` does. Keep the two in step: a divergence here
 * is a banner that contradicts the button it sits above.
 */
export function poolFrom(credits) {
  if (!credits || typeof credits !== "object") return { known: false, available: 0 };
  if (credits.degraded || credits.enforced !== true) return { known: false, available: 0 };
  const available = Number(credits.available);
  if (!Number.isFinite(available)) return { known: false, available: 0 };
  return { known: true, available };
}

export function estimateCredits({
  count = 1,
  planId = "free",
  credits = null,
  perUnit = CREDIT_WEIGHTS.page_fetch,
} = {}) {
  const safeCount = Math.max(0, Math.floor(count) || 0);
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free ?? getEffectivePlanById(planId);
  const planName = plan?.name ?? planId;

  const unit = Math.max(1, Math.floor(perUnit) || 1);
  const required = safeCount * unit;

  const pool = poolFrom(credits);
  const remaining = pool.known ? Math.max(0, pool.available) : Infinity;
  const afterRun = pool.known ? Math.max(0, remaining - required) : Infinity;
  const overage = pool.known ? Math.max(0, required - remaining) : 0;
  const allowed = safeCount === 0 || !pool.known || remaining >= required;

  const pages = `${safeCount} page${safeCount === 1 ? "" : "s"}`;
  const cost = `${required} credit${required === 1 ? "" : "s"}`;

  let tone = "ok";
  let reason = null;
  let message;

  if (safeCount === 0) {
    message = "Enter at least 1 URL to estimate cost";
  } else if (!pool.known) {
    // No balance to show. Name the price anyway — it is the half of the answer
    // we do have, and it is the half that does not depend on who is asking.
    message = `${pages} — ${cost}`;
  } else if (!allowed) {
    tone = "block";
    reason = `This run costs ${cost} and you have ${remaining}. `
      + `Top up with a credit pack, upgrade your plan, or wait for your allowance to renew.`;
    message = `Blocked — costs ${cost}, you have ${remaining}`;
  } else if (afterRun <= Math.max(1, Math.floor(remaining * 0.2))) {
    tone = "warn";
    message = `${pages} — ${cost} of ${remaining}, ${afterRun} left after this run`;
  } else {
    message = `${pages} — ${cost} of ${remaining}`;
  }

  return {
    required,
    remaining,
    afterRun,
    allowed,
    known: pool.known,
    planId,
    planName,
    reason,
    overage,
    message,
    tone,
    perUnit: unit,
    // Retained so `CreditEstimator.jsx` keeps hiding the "(N after this run)"
    // tail when there is no number to put in it. An unknown balance is not an
    // unlimited one, but both render the same way: without a count.
    isUnlimited: !pool.known,
  };
}

export function estimateBatchCredits({ urlCount, planId, credits = null }) {
  return estimateCredits({ count: urlCount, planId, credits });
}
