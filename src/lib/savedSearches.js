// src/lib/savedSearches.js — Q3 (plan-aware saved-searches cap) pure logic.
//
// Free plan: capped at 10 saved extractions. Paid plans: unlimited (the
// plan's `extractions` monthly limit is the only real ceiling).
//
// The cap is enforced in two places:
//   1. extractionsRepo.saveExtraction — refuses to save when over the cap
//      and returns the existing record (with an `_capHit: true` marker).
//   2. The Dashboard / preview UI shows a friendly "cap reached" banner.
//
// Pure logic so it's testable in isolation.

import { getEffectivePlanById } from "./pricingOverrides.js";

const DEFAULT_FREE_CAP = 10;

export function getSavedSearchesCap(planId) {
  if (!planId || planId === "free") return DEFAULT_FREE_CAP;
  // Paid plans are unlimited from this cap's perspective (their monthly
  // extractions quota is enforced by canExtract, not by savedSearchesCap).
  return Infinity;
}

export function isOverCap({ count, planId }) {
  const cap = getSavedSearchesCap(planId);
  if (cap === Infinity) return false;
  return count >= cap;
}

export function remainingSlots({ count, planId }) {
  const cap = getSavedSearchesCap(planId);
  if (cap === Infinity) return Infinity;
  return Math.max(0, cap - count);
}

export function planSupportsUnlimitedSaved(planId) {
  return getSavedSearchesCap(planId) === Infinity;
}

// Pure formatter used by the UI to decide copy.
export function capMessage({ count, planId }) {
  const cap = getSavedSearchesCap(planId);
  if (cap === Infinity) return null;
  const remaining = Math.max(0, cap - count);
  if (count >= cap) {
    return {
      tone: "block",
      title: "Free plan limit reached",
      message: `You've saved ${count} of ${cap} extractions. Upgrade for unlimited saves.`,
      remaining: 0,
    };
  }
  if (count >= cap - 2) {
    return {
      tone: "warn",
      title: `Only ${remaining} save${remaining === 1 ? "" : "s"} left`,
      message: `Free plan is limited to ${cap} saved extractions. Upgrade for unlimited.`,
      remaining,
    };
  }
  return {
    tone: "ok",
    title: null,
    message: null,
    remaining,
  };
}
