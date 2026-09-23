// src/lib/planSnapshot.test.js
//
// The rule under test, in one sentence: while the period you paid for is still
// running, nothing gets worse and improvements still reach you.
//
// The case that made this necessary is the last block — the 2026-09-23
// repricing cut Developer's batch and bulk limits from 500 to 250, and without
// a snapshot a subscriber three weeks into a paid month would have had their
// list size halved with no notice.

import { describe, expect, it } from "vitest";
import {
  snapshotPlan, effectivePlanFor, withinPaidPeriod, isRepriced,
} from "./planSnapshot.js";
import { PLAN_BY_ID } from "./pricingConfig.js";

const future = () => new Date(Date.now() + 30 * 864e5).toISOString();
const past   = () => new Date(Date.now() - 864e5).toISOString();

const bought = (plan, over = {}) => ({
  ...snapshotPlan(plan),
  ...over,
  limits: { ...plan.limits, ...(over.limits || {}) },
});

describe("snapshotPlan — what gets frozen", () => {
  it("keeps the price and the limits", () => {
    const s = snapshotPlan(PLAN_BY_ID.pro);
    expect(s.id).toBe("pro");
    expect(s.price_usd).toBe(PLAN_BY_ID.pro.price_usd);
    expect(s.price_inr).toBe(PLAN_BY_ID.pro.price_inr);
    expect(s.limits.credits).toBe(PLAN_BY_ID.pro.limits.credits);
  });

  it("does NOT freeze display copy — features, badge and tagline track the live product", () => {
    const s = snapshotPlan(PLAN_BY_ID.pro);
    expect(s.features).toBeUndefined();
    expect(s.badge).toBeUndefined();
    expect(s.tagline).toBeUndefined();
  });

  it("returns null for a plan it cannot resolve, never a half-built object", () => {
    // A gate reading limits off a half-built snapshot either refuses everything
    // or allows everything, depending on the key.
    expect(snapshotPlan(null)).toBeNull();
    expect(snapshotPlan("pro")).toBeNull();
  });
});

describe("withinPaidPeriod — the protection window", () => {
  it("is open while period_end is in the future", () => {
    expect(withinPaidPeriod({ period_end: future() })).toBe(true);
  });

  it("is closed once it passes — renewal is where a repricing lands", () => {
    expect(withinPaidPeriod({ period_end: past() })).toBe(false);
  });

  it("is closed with no period_end at all", () => {
    // A free account, and any row predating snapshots. A snapshot with no end
    // date would freeze them for ever.
    expect(withinPaidPeriod({})).toBe(false);
    expect(withinPaidPeriod(null)).toBe(false);
    expect(withinPaidPeriod({ period_end: "not a date" })).toBe(false);
  });
});

describe("effectivePlanFor — nothing gets worse", () => {
  const live = PLAN_BY_ID.pro;

  it("keeps a limit that was CUT", () => {
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { limits: { credits: live.limits.credits * 2 } }) };
    expect(effectivePlanFor(e, live).limits.credits).toBe(live.limits.credits * 2);
  });

  it("passes on a limit that was RAISED", () => {
    // Someone still on the old plan must not be worse off than a new signup
    // for having paid earlier.
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { limits: { credits: 10 } }) };
    expect(effectivePlanFor(e, live).limits.credits).toBe(live.limits.credits);
  });

  it("keeps a boolean capability that was REMOVED from the plan", () => {
    const stripped = { ...live, limits: { ...live.limits, integrations: false } };
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { limits: { integrations: true } }) };
    expect(effectivePlanFor(e, stripped).limits.integrations).toBe(true);
  });

  it("unions export formats rather than dropping one", () => {
    const stripped = { ...live, limits: { ...live.limits, exports: ["csv"] } };
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { limits: { exports: ["csv", "pdf"] } }) };
    expect(effectivePlanFor(e, stripped).limits.exports.sort()).toEqual(["csv", "pdf"]);
  });

  it("resolves a limit key added AFTER the snapshot, rather than leaving it undefined", () => {
    // 🔴 The reason this is a merge and not a substitution. A gate reading an
    // undefined limit either refuses everything or allows everything.
    const grown = { ...live, limits: { ...live.limits, brand_new_key: 7 } };
    const snap = bought(live);
    delete snap.limits.brand_new_key;
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: snap };
    expect(effectivePlanFor(e, grown).limits.brand_new_key).toBe(7);
  });

  it("charges the price they were charged, NOT the better of the two", () => {
    // A price is not a capability. Showing today's list price for a period they
    // already paid for is simply the wrong number, in either direction.
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { price_usd: 1, price_inr: 99 }) };
    const p = effectivePlanFor(e, live);
    expect(p.price_usd).toBe(1);
    expect(p.price_inr).toBe(99);
  });
});

describe("effectivePlanFor — when it does NOT apply", () => {
  const live = PLAN_BY_ID.pro;

  it("falls back to the live plan once the period has ended", () => {
    const e = { plan_id: "pro", period_end: past(), plan_snapshot: bought(live, { price_usd: 1 }) };
    expect(effectivePlanFor(e, live)).toBe(live);
  });

  it("falls back with no snapshot", () => {
    expect(effectivePlanFor({ plan_id: "pro", period_end: future() }, live)).toBe(live);
    expect(effectivePlanFor(null, live)).toBe(live);
  });

  it("ignores a snapshot of a DIFFERENT plan — the plan id is authoritative", () => {
    // The account changed plans and the row was written without refreshing the
    // snapshot. Trusting the snapshot there would keep selling the old plan.
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(PLAN_BY_ID.agency) };
    expect(effectivePlanFor(e, live)).toBe(live);
  });

  it("marks a grandfathered plan so a surface can say so", () => {
    const e = { plan_id: "pro", period_end: future(), plan_snapshot: bought(live, { price_usd: 1 }) };
    expect(effectivePlanFor(e, live)._grandfathered).toBe(true);
    expect(live._grandfathered).toBeUndefined();
  });
});

describe("the 2026-09-23 repricing — the case this exists for", () => {
  // Developer went 500 → 250 batch, 500 → 250 bulk, 28,000 → 25,000 credits,
  // and $32.40 → $55.
  const live = PLAN_BY_ID.developer;
  const asBought = {
    ...snapshotPlan(live),
    price_usd: 32.4, price_inr: 2999,
    limits: { ...live.limits, batch_max_urls: 500, bulk_list_max: 500, credits: 28000 },
  };

  it("a subscriber mid-period keeps everything they bought", () => {
    const p = effectivePlanFor({ plan_id: "developer", period_end: future(), plan_snapshot: asBought }, live);
    expect(p.limits.batch_max_urls).toBe(500);
    expect(p.limits.bulk_list_max).toBe(500);
    expect(p.limits.credits).toBe(28000);
    expect(p.price_usd).toBe(32.4);
  });

  it("and gets the new plan at renewal", () => {
    const p = effectivePlanFor({ plan_id: "developer", period_end: past(), plan_snapshot: asBought }, live);
    expect(p.limits.batch_max_urls).toBe(250);
    expect(p.limits.credits).toBe(25000);
    expect(p.price_usd).toBe(live.price_usd);
  });

  it("isRepriced reports the difference so they can be told", () => {
    expect(isRepriced({ plan_snapshot: asBought }, live)).toBe(true);
    expect(isRepriced({ plan_snapshot: snapshotPlan(live) }, live)).toBe(false);
  });
});
