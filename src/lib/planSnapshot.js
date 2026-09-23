// src/lib/planSnapshot.js — what a subscriber actually bought, held until renewal.
//
// PURE. Imported by React AND by netlify/, exactly as entitlementModel.js is,
// so the plan the gate decides against and the plan the screen shows cannot be
// computed by two different rules.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// `pricingConfig.js` is the LIVE table: change a number there and every account
// sees it on the next page load. That is right for a price list and wrong for a
// subscription. The 2026-09-23 repricing cut Developer's batch and bulk limits
// from 500 to 250 — without a snapshot, a Developer subscriber three weeks into
// a month they had paid for would have found their list size halved, with no
// notice and no way back. There were no paid users that day, which is exactly
// why it was the right day to build this.
//
// 🔴 THE RULE, IN ONE SENTENCE: WHILE THE PERIOD YOU PAID FOR IS STILL RUNNING,
// NOTHING GETS WORSE AND IMPROVEMENTS STILL REACH YOU. The price is the one you
// were charged; each limit is the better of what you bought and what the plan
// now offers. On renewal the snapshot is rewritten from the live table, which
// is where a repricing takes effect.
//
// ⚠️ A ONE-WAY MERGE, NOT A SUBSTITUTION. Taking the snapshot wholesale would
// mean a limit key added after the snapshot was taken reads `undefined` for
// every grandfathered account — and a gate reading `undefined` is a gate that
// either refuses everything or allows everything, depending on the key. It
// would also withhold a genuine increase from the people still on the old
// plan, who would be worse off than a new signup for having paid earlier.

/** The fields worth keeping. Deliberately not the whole plan object: `features`
 *  is display copy that should track the live product, and `badge`/`tagline`
 *  are marketing. What is frozen is what was BOUGHT — the price and the caps. */
export function snapshotPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  return {
    id: plan.id,
    name: plan.name,
    price_usd: plan.price_usd ?? 0,
    price_usd_annual: plan.price_usd_annual ?? 0,
    price_inr: plan.price_inr ?? 0,
    price_inr_annual: plan.price_inr_annual ?? 0,
    limits: { ...(plan.limits || {}) },
  };
}

/**
 * Merge one limit value the customer-favouring way.
 *
 * ⚠️ `Infinity` compares correctly with `>`, so an unlimited value on either
 * side wins without a special case.
 */
function betterLimit(bought, live) {
  if (bought === undefined) return live;
  if (live === undefined) return bought;
  if (typeof bought === "number" && typeof live === "number") {
    return Math.max(bought, live);
  }
  if (typeof bought === "boolean" || typeof live === "boolean") {
    // A capability granted by either side stays granted. Removing a feature
    // from a plan mid-period is the same broken promise as cutting a number.
    return Boolean(bought) || Boolean(live);
  }
  if (Array.isArray(bought) && Array.isArray(live)) {
    // `exports` — union, so dropping a format from the plan does not drop it
    // from someone already paying for it.
    return Array.from(new Set([...bought, ...live]));
  }
  // Anything else (null sentinels like extra_seat_usd): the live value, since
  // there is no ordering to take the better of.
  return live;
}

/**
 * Is this entitlement inside a period the customer has already paid for?
 *
 * ⚠️ NO `period_end` MEANS NO PROTECTION, deliberately. A free account and an
 * account whose row predates snapshots both land here, and both should track
 * the live table — a snapshot with no end date would freeze them for ever.
 */
export function withinPaidPeriod(entitlement, now = new Date()) {
  const end = entitlement?.period_end;
  if (!end) return false;
  const t = end instanceof Date ? end.getTime() : Date.parse(end);
  return Number.isFinite(t) && t > (now instanceof Date ? now.getTime() : Date.now());
}

/**
 * The plan to decide against, and to show.
 *
 * @param {object|null} entitlement  the server row (plan_snapshot, period_end)
 * @param {object|null} livePlan     the same plan id from the live table
 * @param {Date} [now]
 * @returns {object|null}
 */
export function effectivePlanFor(entitlement, livePlan, now = new Date()) {
  const snap = entitlement?.plan_snapshot;
  if (!snap || typeof snap !== "object" || !snap.id) return livePlan;
  // A snapshot of a DIFFERENT plan is stale — the account changed plans and the
  // row was written without refreshing it. Trust the plan id, never the
  // snapshot, about which plan this is.
  if (livePlan && snap.id !== livePlan.id) return livePlan;
  if (!withinPaidPeriod(entitlement, now)) return livePlan;
  if (!livePlan) return { ...snap, _grandfathered: true };

  const keys = new Set([
    ...Object.keys(livePlan.limits || {}),
    ...Object.keys(snap.limits || {}),
  ]);
  const limits = {};
  for (const k of keys) {
    limits[k] = betterLimit(snap.limits?.[k], livePlan.limits?.[k]);
  }

  return {
    ...livePlan,
    // The PRICE is the one they were charged — no "better of", because a price
    // is not a capability and showing them today's list price for a period they
    // already paid for is simply the wrong number.
    price_usd: snap.price_usd,
    price_usd_annual: snap.price_usd_annual,
    price_inr: snap.price_inr,
    price_inr_annual: snap.price_inr_annual,
    limits,
    _grandfathered: true,
  };
}

/** True when the live table has moved away from what this account bought. Used
 *  to tell them so, rather than leaving them to notice on a renewal invoice. */
export function isRepriced(entitlement, livePlan) {
  const snap = entitlement?.plan_snapshot;
  if (!snap || !livePlan || snap.id !== livePlan.id) return false;
  return snap.price_usd !== livePlan.price_usd || snap.price_inr !== livePlan.price_inr;
}
