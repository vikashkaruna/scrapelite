// prorationMath.test.js — credit for unused time, and plan-change warnings.
import { describe, expect, it } from "vitest";
import { PLAN_BY_ID } from "./pricingConfig.js";
import {
  describePlanChange,
  isDowngrade,
  isUpgrade,
  planRank,
  prorate,
} from "./prorationMath.js";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-07-01T00:00:00Z");
const END = Date.parse("2026-07-31T00:00:00Z"); // a clean 30-day period
const period = { periodStart: new Date(START), periodEnd: new Date(END) };
const at = (d) => new Date(START + d * DAY);

describe("prorate", () => {
  it("credits the full amount when nothing has been used", () => {
    expect(prorate({ paidTaxableMinor: 300000, ...period, now: at(0) })).toBe(300000);
  });

  it("credits nothing at the moment the period ends", () => {
    expect(prorate({ paidTaxableMinor: 300000, ...period, now: at(30) })).toBe(0);
  });

  it("credits the remaining fraction mid-period", () => {
    // 20 of 30 days remain → two thirds of 300000.
    expect(prorate({ paidTaxableMinor: 300000, ...period, now: at(10) })).toBe(200000);
  });

  it("never returns a negative credit once the period has passed", () => {
    expect(prorate({ paidTaxableMinor: 300000, ...period, now: at(45) })).toBe(0);
  });

  it("never credits more than was actually paid, even with clock skew", () => {
    expect(prorate({ paidTaxableMinor: 300000, ...period, now: at(-10) })).toBe(300000);
  });

  it("returns 0 when there is no invoice to base the credit on", () => {
    // A legacy row, an admin comp, or a migrated subscription: we cannot
    // evidence what was paid, so we credit nothing rather than invent a figure.
    expect(prorate({ paidTaxableMinor: 0, ...period, now: at(10) })).toBe(0);
    expect(prorate({ paidTaxableMinor: null, ...period, now: at(10) })).toBe(0);
  });

  it("returns 0 for a malformed or zero-length period", () => {
    expect(prorate({ paidTaxableMinor: 300000, periodStart: null, periodEnd: null, now: at(10) })).toBe(0);
    expect(
      prorate({ paidTaxableMinor: 300000, periodStart: new Date(END), periodEnd: new Date(END), now: at(10) }),
    ).toBe(0);
    expect(
      prorate({ paidTaxableMinor: 300000, periodStart: "nonsense", periodEnd: "also-nonsense", now: at(10) }),
    ).toBe(0);
  });

  it("is based on what was PAID, not on list price", () => {
    // Same plan, same day, but this customer used a 20% coupon. Their credit
    // must be 20% smaller — crediting list price would refund money they never
    // handed over.
    const listPrice = prorate({ paidTaxableMinor: 300000, ...period, now: at(15) });
    const withCoupon = prorate({ paidTaxableMinor: 240000, ...period, now: at(15) });
    expect(withCoupon).toBeLessThan(listPrice);
    expect(withCoupon).toBe(120000);
  });

  it("always returns an integer number of minor units", () => {
    const r = prorate({ paidTaxableMinor: 100001, ...period, now: at(7) });
    expect(Number.isInteger(r)).toBe(true);
  });

  it("handles an annual period", () => {
    const annual = {
      periodStart: new Date(Date.parse("2026-01-01T00:00:00Z")),
      periodEnd: new Date(Date.parse("2027-01-01T00:00:00Z")),
    };
    const half = prorate({
      paidTaxableMinor: 1200000,
      ...annual,
      now: new Date(Date.parse("2026-07-02T12:00:00Z")),
    });
    expect(half).toBeGreaterThan(590000);
    expect(half).toBeLessThan(610000);
  });
});

describe("plan ranking", () => {
  it("orders the tiers", () => {
    expect(planRank("agency")).toBeGreaterThan(planRank("business"));
    expect(planRank("business")).toBeGreaterThan(planRank("pro"));
    expect(planRank("pro")).toBeGreaterThan(planRank("select"));
    expect(planRank("select")).toBeGreaterThan(planRank("go"));
    expect(planRank("go")).toBeGreaterThan(planRank("free"));
  });

  it("ranks an unknown plan lowest so it never wins a merge", () => {
    expect(planRank("mystery")).toBe(0);
    expect(planRank(null)).toBe(1); // null defaults to free
  });

  it("classifies direction", () => {
    expect(isUpgrade("select", "pro")).toBe(true);
    expect(isDowngrade("business", "select")).toBe(true);
    expect(isUpgrade("pro", "pro")).toBe(false);
    expect(isDowngrade("pro", "pro")).toBe(false);
  });
});

describe("describePlanChange", () => {
  it("lists concrete losses on a downgrade", () => {
    const d = describePlanChange(PLAN_BY_ID.business, PLAN_BY_ID.select);
    expect(d.direction).toBe("downgrade");
    expect(d.losses.join(" | ")).toMatch(/Extractions per month drops from 10,000 to 500/);
    expect(d.losses.join(" | ")).toMatch(/URLs per batch drops from 250 to 50/);
    // Business and Select both include every export format (JSON included) —
    // white-label PDF and API access are the real exclusive losses here.
    expect(d.losses.join(" | ")).toMatch(/White-label PDF/);
    expect(d.losses.join(" | ")).toMatch(/API access/);
  });

  it("schedules a downgrade for period end, not immediately", () => {
    // The customer has already paid for the rest of this period.
    expect(describePlanChange(PLAN_BY_ID.business, PLAN_BY_ID.select).effective).toBe("period_end");
  });

  it("applies an upgrade immediately and lists the gains", () => {
    const u = describePlanChange(PLAN_BY_ID.select, PLAN_BY_ID.business);
    expect(u.direction).toBe("upgrade");
    expect(u.effective).toBe("now");
    expect(u.gains.join(" | ")).toMatch(/API access/);
    expect(u.losses).toHaveLength(0);
  });

  // ⚠️ SYNTHETIC PLANS ON PURPOSE. This used to read agency → pro, because
  // Agency's extraction limit was Infinity. The 2026-09-23 repricing made every
  // shipped plan finite, so no real pair exercises the "unlimited" wording any
  // more — but the branch is still reachable, since an operator override can
  // set Infinity on any limit. Deleting the test would leave that path
  // uncovered the day somebody does; driving it directly keeps it honest and
  // stops the test quietly re-pinning whatever the top plan happens to be.
  it("describes a drop from unlimited in words rather than as a number", () => {
    const unlimited = { ...PLAN_BY_ID.agency, limits: { ...PLAN_BY_ID.agency.limits, extractions: Infinity } };
    const d = describePlanChange(unlimited, PLAN_BY_ID.pro);
    expect(d.losses.join(" | ")).toMatch(/Extractions per month drops from unlimited to 1,000/);
  });

  it("no shipped plan is unlimited any more — the ladder is finite end to end", () => {
    for (const p of Object.values(PLAN_BY_ID)) {
      expect(Number.isFinite(p.limits.extractions), `${p.id}.extractions`).toBe(true);
      expect(Number.isFinite(p.limits.credits), `${p.id}.credits`).toBe(true);
      expect(Number.isFinite(p.limits.scheduled_monitoring), `${p.id}.scheduled_monitoring`).toBe(true);
    }
  });

  it("reports no change between a plan and itself", () => {
    const s = describePlanChange(PLAN_BY_ID.pro, PLAN_BY_ID.pro);
    expect(s.direction).toBe("same");
    expect(s.losses).toHaveLength(0);
    expect(s.gains).toHaveLength(0);
  });

  it("never throws on missing plans", () => {
    expect(() => describePlanChange(null, undefined)).not.toThrow();
    expect(describePlanChange(null, PLAN_BY_ID.pro).direction).toBe("upgrade");
  });

  it("derives losses from limits, so it cannot drift from the plan table", () => {
    // Losing scheduled monitoring is a real consequence of pro -> select and
    // must be surfaced without anyone writing bespoke copy for it.
    const d = describePlanChange(PLAN_BY_ID.pro, PLAN_BY_ID.select);
    expect(d.losses.join(" | ")).toMatch(/Scheduled monitors/);
  });
});
