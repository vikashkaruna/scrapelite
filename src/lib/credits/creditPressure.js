// src/lib/credits/creditPressure.js — "is this account running low?", answered once.
//
// Three surfaces ask this question and used to answer it three different ways,
// all of them against the retired extraction quota: `UsageUpsellBanner` (show
// an upsell at ≥80% used), `ReferralBanner` (show an invite at ≥90%), and
// Account's usage meter. After the credit switch each of those read
// `plan.limits.extractions` — a number nothing enforces any more — so on a free
// account they fired at 8 extractions while the real pool still held 92
// credits, and they kept firing after a credit pack topped it back up.
//
// 🔴 THE RULE THAT MATTERS IS NOT THE THRESHOLD, IT IS `known`.
// An unknown balance — a guest, an account never granted credits, or a read
// that failed — MUST render nothing at all. `creditClient.js` states the
// reason and it is worth restating here, because this is where it would be
// violated: telling somebody "0 credits remaining" when they were never given
// any tells them they are out of something they never had, and telling them so
// during a Supabase blip is worse still. `known: false` is not `available: 0`,
// exactly as an unmeasured audit signal is not a signal that scored zero.
//
// ⚠️ `remainingPct` CAN EXCEED 1, AND THAT IS CORRECT. Rollover means an
// account can hold up to 2x its monthly allowance (a grant expires at the end
// of the FOLLOWING month, so at most two are ever live). Clamping it to 1
// would draw a full bar for an account holding twice that, which is a smaller
// lie than the alternative but still a lie; callers that need a bar width
// clamp at render time and say so.

import { poolFrom } from "../creditEstimator.js";

/** Below this share of a month's allowance, a surface may nudge. Matches the
 *  estimator's own 20% warn band so a screen showing both cannot disagree. */
export const LOW_PCT = 0.2;

/**
 * @param {object}  args
 * @param {object?} args.credits   the creditClient status hint
 * @param {number?} args.allowance the plan's monthly credit allowance
 * @returns {{known:boolean, available:number, allowance:number|null,
 *            remainingPct:number|null, low:boolean, empty:boolean}}
 */
export function creditPressure({ credits = null, allowance = null } = {}) {
  const pool = poolFrom(credits);
  if (!pool.known) {
    return { known: false, available: 0, allowance: null, remainingPct: null, low: false, empty: false };
  }
  const available = pool.available;
  const budget = Number.isFinite(allowance) && allowance > 0 ? allowance : null;
  const remainingPct = budget === null ? null : available / budget;
  return {
    known: true,
    available,
    allowance: budget,
    remainingPct,
    // With no allowance to measure against we can still say "empty", which is
    // the only claim that needs no denominator.
    low: available <= 0 || (remainingPct !== null && remainingPct <= LOW_PCT),
    empty: available <= 0,
  };
}
