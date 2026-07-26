// entitlementModel.test.js — the authorization test file.
//
// This module decides what every user may do, in both runtimes, so the matrix
// below is the safety net for the whole billing lifecycle. Cases are named for
// the property they protect, not for the code path they execute.
import { describe, expect, it } from "vitest";
import { PLAN_BY_ID } from "./pricingConfig.js";
import {
  CAPS,
  DEACTIVATE_AFTER_DAYS,
  PURGE_AFTER_DAYS,
  STATUS,
  activeEntitlement,
  can,
  computeLifecycle,
  isLifecycleManaged,
} from "./entitlementModel.js";

const planMap = PLAN_BY_ID;
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-08-01T00:00:00Z"); // period_end for the paid fixtures

/** A paid, lifecycle-managed entitlement whose period ended at T0. */
const paid = (planId, over = {}) => ({
  plan_id: planId,
  status: STATUS.ACTIVE,
  source: "payment",
  period_end: new Date(T0).toISOString(),
  ...over,
});

const at = (offsetMs) => new Date(T0 + offsetMs);
const ctx = (extra) => ({ planMap, usage: { extractions: 0, enrichments: {} }, ...extra });

describe("isLifecycleManaged", () => {
  it("is false for a free/never-paid account so it can never be suspended", () => {
    expect(isLifecycleManaged({ plan_id: "free", source: null, period_end: null })).toBe(false);
  });

  it("is false for rows migrated from the legacy subscriptions table", () => {
    // 0012 lands legacy rows as source='migration' with a null period_end
    // precisely so existing customers are not retro-suspended on deploy.
    expect(
      isLifecycleManaged({ plan_id: "pro", source: "migration", period_end: null }),
    ).toBe(false);
  });

  it("is true only for a paid row with a real period_end", () => {
    expect(isLifecycleManaged(paid("pro"))).toBe(true);
  });
});

describe("computeLifecycle windows", () => {
  it("is active one second before period_end", () => {
    expect(computeLifecycle(paid("pro"), at(-1000)).status).toBe(STATUS.ACTIVE);
  });

  it("suspends exactly at period_end (day 0, no grace)", () => {
    expect(computeLifecycle(paid("pro"), at(0)).status).toBe(STATUS.SUSPENDED);
  });

  it("stays suspended through day 29", () => {
    expect(computeLifecycle(paid("pro"), at(29 * DAY)).status).toBe(STATUS.SUSPENDED);
  });

  it("deactivates at day 30", () => {
    expect(computeLifecycle(paid("pro"), at(DEACTIVATE_AFTER_DAYS * DAY)).status).toBe(
      STATUS.DEACTIVATED,
    );
  });

  it("stays deactivated through day 89", () => {
    expect(computeLifecycle(paid("pro"), at(89 * DAY)).status).toBe(STATUS.DEACTIVATED);
  });

  it("purges at day 90", () => {
    expect(computeLifecycle(paid("pro"), at(PURGE_AFTER_DAYS * DAY)).status).toBe(
      STATUS.PURGED,
    );
  });

  it("reports daysUntilPurge for the deletion-notice cron", () => {
    expect(computeLifecycle(paid("pro"), at(83 * DAY)).daysUntilPurge).toBe(7);
    expect(computeLifecycle(paid("pro"), at(88 * DAY)).daysUntilPurge).toBe(2);
  });

  it("never synthesises a status for a non-lifecycle account, however old", () => {
    const free = { plan_id: "free", status: STATUS.ACTIVE, source: null, period_end: null };
    expect(computeLifecycle(free, at(999 * DAY)).status).toBe(STATUS.ACTIVE);
  });
});

describe("computeLifecycle takes the STRICTER of stored and computed", () => {
  // This is what makes a stalled cron safe: the read path self-heals.
  it("denies a lapsed user even when the cron never updated the row", () => {
    const stale = paid("pro", { status: STATUS.ACTIVE });
    expect(computeLifecycle(stale, at(5 * DAY)).status).toBe(STATUS.SUSPENDED);
  });

  it("keeps an admin's manual suspension even when the dates say active", () => {
    const manual = paid("pro", {
      status: STATUS.SUSPENDED,
      period_end: new Date(T0 + 30 * DAY).toISOString(),
    });
    expect(computeLifecycle(manual, at(0)).status).toBe(STATUS.SUSPENDED);
  });

  it("never loosens: a purged row stays purged", () => {
    const purged = paid("pro", { status: STATUS.PURGED });
    expect(computeLifecycle(purged, at(-100 * DAY)).status).toBe(STATUS.PURGED);
  });
});

describe("comp_until (admin grace)", () => {
  it("keeps a lapsed user active while the comp window is open", () => {
    const comped = paid("pro", { comp_until: new Date(T0 + 10 * DAY).toISOString() });
    expect(can(comped, "extract", ctx({ now: at(5 * DAY) })).allowed).toBe(true);
  });

  it("stops protecting once the comp window closes", () => {
    const comped = paid("pro", { comp_until: new Date(T0 + 10 * DAY).toISOString() });
    expect(can(comped, "extract", ctx({ now: at(11 * DAY) })).allowed).toBe(false);
  });
});

describe("suspended access — read-only plus full export", () => {
  const now = at(5 * DAY);
  const pro = paid("pro");

  it.each(["export.csv", "export.pdf", "export.markdown", "export.json", "export.email"])(
    "allows %s so the user can retrieve their own data before the purge deadline",
    (cap) => {
      expect(can(pro, cap, ctx({ now })).allowed).toBe(true);
    },
  );

  it.each(["extract", "batch", "enrich", "ai", "schedules", "integrations", "webhooks"])(
    "blocks %s",
    (cap) => {
      const r = can(pro, cap, ctx({ now, urlCount: 2 }));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("SUSPENDED");
    },
  );

  it("explains when the plan lapsed and when data will be deleted", () => {
    const r = can(pro, "extract", ctx({ now }));
    expect(r.reason).toMatch(/lapsed/i);
    expect(r.reason).toMatch(/export/i);
  });

  it("grants export formats the plan itself does not include (portability wins)", () => {
    // Select has no JSON export, but a suspended Select user must still be able
    // to get their data out before we delete it.
    expect(can(paid("select"), "export.json", ctx({ now })).allowed).toBe(true);
  });
});

describe("deactivated access", () => {
  const now = at(45 * DAY);

  it("still allows export", () => {
    expect(can(paid("pro"), "export.csv", ctx({ now })).allowed).toBe(true);
  });

  it("blocks work with a DEACTIVATED code", () => {
    expect(can(paid("pro"), "extract", ctx({ now })).code).toBe("DEACTIVATED");
  });
});

describe("purged access", () => {
  const now = at(120 * DAY);

  it("blocks everything, including export — the content is gone", () => {
    for (const cap of CAPS) {
      const r = can(paid("pro"), cap, ctx({ now }));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("PURGED");
    }
  });
});

describe("unknown plan denies instead of falling back to Free", () => {
  // getEffectivePlanById() returns the Free plan for unknown ids. If can() did
  // the same, a corrupted or renamed plan_id would silently GRANT Free-tier
  // access. It must deny.
  it("denies an unrecognised plan id", () => {
    const r = can(activeEntitlement("enterprise-legacy"), "extract", ctx());
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("UNKNOWN_PLAN");
  });

  it("denies when the plan map is missing entirely", () => {
    const r = can(activeEntitlement("pro"), "extract", { usage: {} });
    expect(r.code).toBe("UNKNOWN_PLAN");
  });

  it("does not leak the Free plan's allowance through remaining", () => {
    expect(can(activeEntitlement("nope"), "extract", ctx()).remaining).toBe(0);
  });
});

describe("active accounts fall through to plan limits", () => {
  it("blocks a Free user at their monthly extraction cap", () => {
    const r = can(activeEntitlement("free"), "extract", ctx({ usage: { extractions: 10 } }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("QUOTA_EXCEEDED");
  });

  it("counts top-up bonus extractions toward the cap", () => {
    const r = can(
      activeEntitlement("free"),
      "extract",
      ctx({ usage: { extractions: 10 }, bonus: 25 }),
    );
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(25);
  });

  it("treats an Infinity plan limit as unlimited", () => {
    expect(can(activeEntitlement("agency"), "extract", ctx()).remaining).toBe(Infinity);
  });

  it("blocks batch on Free with an upgrade target", () => {
    const r = can(activeEntitlement("free"), "batch", ctx({ urlCount: 20 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/batch limit|not available/i);
  });

  it("blocks scheduled monitoring below Pro and points at Pro", () => {
    const free = can(activeEntitlement("free"), "schedules", ctx());
    expect(free.allowed).toBe(false);
    expect(free.upgradeTo).toBe("pro");
    expect(can(activeEntitlement("pro"), "schedules", ctx()).allowed).toBe(true);
  });

  it("gates export formats by plan", () => {
    expect(can(activeEntitlement("free"), "export.pdf", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("free"), "export.csv", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("select"), "export.json", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("pro"), "export.json", ctx()).allowed).toBe(true);
  });
});

describe("robustness", () => {
  it("never throws and never returns undefined for any capability", () => {
    for (const cap of CAPS) {
      for (const ent of [null, undefined, {}, activeEntitlement("pro"), paid("pro")]) {
        const r = can(ent, cap, ctx({ now: at(5 * DAY) }));
        expect(r).toBeDefined();
        expect(typeof r.allowed).toBe("boolean");
      }
    }
  });

  it("rejects an unknown capability rather than silently allowing it", () => {
    const r = can(activeEntitlement("pro"), "delete.everything", ctx());
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("UNKNOWN_CAPABILITY");
  });

  it("tolerates a malformed period_end instead of throwing", () => {
    const bad = { plan_id: "pro", status: "active", source: "payment", period_end: "not-a-date" };
    expect(can(bad, "extract", ctx()).allowed).toBe(true); // not lifecycle-managed
  });
});
