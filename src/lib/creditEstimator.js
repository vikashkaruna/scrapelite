// src/lib/creditEstimator.js — Q2 (pre-flight credit estimator) pure logic.
//
// Estimates the cost of running N extractions given the current plan and
// remaining quota. Returns a single shape so UI can render the same banner
// for single-URL, batch, and scheduled runs.
//
// Returns:
//   {
//     required:    number            // credits needed for this run
//     remaining:   number            // credits left this month (Infinity = unlimited)
//     afterRun:    number            // credits that would be left after this run
//     allowed:     boolean           // true if the run can proceed
//     planId:      string            // the plan the user is currently on
//     planName:    string            // human label
//     reason:      string?           // human reason when allowed=false
//     overage:     number            // credits that would push past the limit
//     message:     string            // short UI message (always present)
//     tone:        "ok" | "warn" | "block"
//   }

import { readUsage } from "./usageService.js";
import { getEffectivePlanById, getEffectivePlanMap } from "./pricingOverrides.js";

const DEFAULT_LIMITS = { free: 10, select: 100, pro: 500, business: 2000, agency: 10000 };

function safeRemainingFromUsage(planId, plan, usage) {
  // Mirrors usageService.canExtract so we don't need to import that and risk
  // a circular dep (extractionsRepo <-> usageService) at module load.
  if (plan.limits?.extractions === Infinity) return Infinity;
  const base = (DEFAULT_LIMITS[planId] ?? plan.limits?.extractions ?? 10) +
    (usage.bonusExtractions || 0);
  return Math.max(0, base - (usage.extractions || 0));
}

export function estimateCredits({
  count = 1,
  planId = "free",
  bonusExtractions = 0,
  usageOverride = null,
} = {}) {
  const safeCount = Math.max(0, Math.floor(count) || 0);
  const usage = usageOverride ?? readUsage();
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free ?? getEffectivePlanById(planId);
  const isUnlimited = plan?.limits?.extractions === Infinity;
  const remaining = isUnlimited
    ? Infinity
    : safeRemainingFromUsage(planId, plan, { ...usage, bonusExtractions });
  const afterRun = isUnlimited ? Infinity : Math.max(0, remaining - safeCount);
  const overage = isUnlimited ? 0 : Math.max(0, safeCount - remaining);
  const allowed = safeCount === 0 || isUnlimited || remaining >= safeCount;

  let tone = "ok";
  let message = isUnlimited
    ? `${safeCount} extraction${safeCount === 1 ? "" : "s"} — unlimited on ${plan?.name ?? planId}`
    : `${safeCount} of ${remaining} remaining will be used`;
  let reason = null;

  if (safeCount === 0) {
    tone = "ok";
    message = "Enter at least 1 URL to estimate cost";
  } else if (!allowed) {
    tone = "block";
    reason = `You need ${safeCount} extraction${safeCount === 1 ? "" : "s"} but only ${remaining} remain this month on ${plan?.name ?? planId}. Upgrade or purchase a top-up bundle.`;
    message = `Blocked — ${remaining} remaining, ${safeCount} needed`;
  } else if (afterRun <= Math.max(1, Math.floor((isUnlimited ? 0 : remaining) * 0.2))) {
    tone = "warn";
    message = `${safeCount} of ${remaining} remaining — ${afterRun} will be left after this run`;
  }

  return {
    required: safeCount,
    remaining,
    afterRun,
    allowed,
    planId,
    planName: plan?.name ?? planId,
    reason,
    overage,
    message,
    tone,
    isUnlimited,
  };
}

export function estimateBatchCredits({ urlCount, planId, bonusExtractions = 0 }) {
  return estimateCredits({ count: urlCount, planId, bonusExtractions });
}
