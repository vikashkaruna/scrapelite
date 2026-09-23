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
  workspaceAddonFeaturesForPlan,
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

  it("expires an admin grant at its period end without entering paid dunning", () => {
    const grant = {
      plan_id: "pro",
      status: STATUS.ACTIVE,
      source: "admin_coupon",
      period_end: new Date(T0).toISOString(),
    };
    expect(computeLifecycle(grant, at(-1000)).status).toBe(STATUS.ACTIVE);
    expect(computeLifecycle(grant, at(0)).status).toBe(STATUS.GRANT_EXPIRED);
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

describe("admin coupon grant expiry", () => {
  const grant = {
    plan_id: "pro",
    status: STATUS.ACTIVE,
    source: "admin_coupon",
    period_end: new Date(T0).toISOString(),
  };

  it("denies gated work with a dedicated grant-expired code", () => {
    const result = can(grant, "extract", ctx({ now: at(1) }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("GRANT_EXPIRED");
  });

  it("still permits exports after expiry for data portability", () => {
    expect(can(grant, "export.csv", ctx({ now: at(1) })).allowed).toBe(true);
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
  // ── THE SWITCH: ONE POOL, NOT THREE BUDGETS ─────────────────────────────
  // `usage.extractions` and `L.extractions` are no longer consulted by
  // anything. These tests used to pin the extraction cap and the top-up
  // bundle that fed it; both are retired (D1, D15). What replaces them is a
  // single credit balance, supplied by the caller.
  it("blocks a Free user who has spent their pool", () => {
    const r = can(activeEntitlement("free"), "extract",
      ctx({ credits: { enforced: true, available: 0 } }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("INSUFFICIENT_CREDITS");
  });

  // ⚠️ The message NAMES THE COST. "Not enough credits" is not actionable;
  // "costs 19 and you have 4" tells them whether to buy or wait.
  it("names the cost and the balance in the refusal", () => {
    const r = can(activeEntitlement("free"), "audit",
      ctx({ credits: { enforced: true, available: 4 } }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/19 credits/);
    expect(r.reason).toMatch(/you have 4/);
  });

  // 🔴 THE FAIL-OPEN RULE. A browser that has not fetched the balance, a
  // Supabase blip, or an account never granted credits must all read through
  // — refusing a paying customer because we could not look is far worse than
  // letting one request past.
  it("reads through when the balance is unknown, degraded, or not enforced", () => {
    const stale = can(activeEntitlement("free"), "extract", ctx());
    const degraded = can(activeEntitlement("free"), "extract",
      ctx({ credits: { degraded: true, enforced: true, available: null } }));
    const notOnSystem = can(activeEntitlement("free"), "extract",
      ctx({ credits: { enforced: false, available: 0 } }));
    for (const r of [stale, degraded, notOnSystem]) expect(r.allowed).toBe(true);
  });

  it("charges a batch by its page count", () => {
    const ten = ctx({ urlCount: 10, credits: { enforced: true, available: 9 } });
    expect(can(activeEntitlement("pro"), "extract.batch", ten).allowed).toBe(false);
    const enough = ctx({ urlCount: 10, credits: { enforced: true, available: 10 } });
    expect(can(activeEntitlement("pro"), "extract.batch", enough).allowed).toBe(true);
  });

  // The surcharge falls out of charging actuals: a ten-prompt run spends more
  // AI calls, so it costs more, with no separate rule.
  it("prices a Discoverability run by its prompt set", () => {
    const bal = (n) => ctx({ credits: { enforced: true, available: n } });
    expect(can(activeEntitlement("pro"), "audit", bal(19)).allowed).toBe(true);
    expect(can(activeEntitlement("pro"), "audit", { ...bal(19), promptCount: 10 }).allowed).toBe(false);
    expect(can(activeEntitlement("pro"), "audit", { ...bal(29), promptCount: 10 }).allowed).toBe(true);
  });

  // ⚠️ Benchmarks stay a PLAN capability. Letting them through on balance
  // alone would sell Select's headline feature to anyone with the credits.
  it("keeps competitive benchmarks behind the plan, not just the balance", () => {
    const rich = ctx({ urlCount: 3, credits: { enforced: true, available: 10_000 } });
    expect(can(activeEntitlement("free"), "audit.benchmark", rich).code).toBe("PLAN_REQUIRED");
    expect(can(activeEntitlement("select"), "audit.benchmark", rich).allowed).toBe(true);
  });

  it("blocks batch on Free with an upgrade target", () => {
    const r = can(activeEntitlement("free"), "batch", ctx({ urlCount: 20 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/batch limit|not available/i);
  });

  it("blocks scheduled monitoring below Select and points at Select", () => {
    const free = can(activeEntitlement("free"), "schedules", ctx());
    expect(free.allowed).toBe(false);
    expect(free.upgradeTo).toBe("select");
    expect(can(activeEntitlement("go"), "schedules", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("select"), "schedules", ctx()).allowed).toBe(true);
  });

  it("gates export formats by plan", () => {
    expect(can(activeEntitlement("free"), "export.pdf", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("free"), "export.csv", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("free"), "export.json", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("go"), "export.json", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("select"), "export.json", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("pro"), "export.json", ctx()).allowed).toBe(true);
  });

  it("gates push integrations and the browser extension flag by plan (Select and up; Free/Go excluded)", () => {
    expect(can(activeEntitlement("free"), "integrations", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("go"), "integrations", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("select"), "integrations", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("free"), "browser_extension", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("go"), "browser_extension", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("select"), "browser_extension", ctx()).allowed).toBe(true);
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

// White-label PDF + priority support + workspace add-on (2026-08-02)
//
// Business and Agency now both ship with white_label_pdf and priority_support.
// Free / Go / Select / Pro get a clean deny with an upgrade hint pointing at
// the right tier. The matrix below is the safety net for that contract — if
// any of these start returning `allowed: true` for the wrong plan, a billing
// regression has shipped and we want a loud test failure.
describe("white_label_pdf cap (Business + Agency only)", () => {
  it("Free / Go / Select / Pro are denied with an upgrade hint", () => {
    for (const planId of ["free", "go", "select", "pro"]) {
      const r = can(activeEntitlement(planId), "white_label_pdf", ctx());
      expect(r.allowed, `expected ${planId} to be denied`).toBe(false);
      expect(r.code).toBe("NOT_IN_PLAN");
      expect(r.upgradeTo).toBe("business");
    }
  });

  it("Business and Agency are allowed (post 2026-08-02 release)", () => {
    expect(can(activeEntitlement("business"), "white_label_pdf", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("agency"),   "white_label_pdf", ctx()).allowed).toBe(true);
  });
});

describe("priority_support cap (Business + Agency only)", () => {
  it("Free / Go / Select / Pro are denied with an upgrade hint", () => {
    for (const planId of ["free", "go", "select", "pro"]) {
      const r = can(activeEntitlement(planId), "priority_support", ctx());
      expect(r.allowed, `expected ${planId} to be denied`).toBe(false);
      expect(r.code).toBe("NOT_IN_PLAN");
      expect(r.upgradeTo).toBe("business");
    }
  });

  it("Business and Agency are allowed", () => {
    expect(can(activeEntitlement("business"), "priority_support", ctx()).allowed).toBe(true);
    expect(can(activeEntitlement("agency"),   "priority_support", ctx()).allowed).toBe(true);
  });
});

describe("workspace.extra cap (only when the add-on is actually purchased)", () => {
  it("denies when workspacesPurchased is 0 or missing", () => {
    expect(can(activeEntitlement("business"), "workspace.extra", ctx()).allowed).toBe(false);
    expect(can(activeEntitlement("business"), "workspace.extra", ctx({ workspacesPurchased: 0 })).allowed).toBe(false);
  });

  it("allows when workspacesPurchased is at least 1", () => {
    const r = can(activeEntitlement("business"), "workspace.extra", ctx({ workspacesPurchased: 2 }));
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });
});

describe("workspace.team_seats cap (bounded by the PARENT plan's team_seats)", () => {
  it("Business team_seats is 3, Agency is 5", () => {
    const biz  = can(activeEntitlement("business"), "workspace.team_seats", ctx());
    const agy  = can(activeEntitlement("agency"),   "workspace.team_seats", ctx());
    expect(biz.allowed).toBe(true);
    expect(biz.remaining).toBe(3);
    expect(agy.allowed).toBe(true);
    expect(agy.remaining).toBe(5);
  });

  it("denies when the parent plan has team_seats === 0 (synthetic plan)", () => {
    // Build a planMap with a single zero-seat plan so the deny path is hit.
    const zeroPlanMap = {
      solo: { id: "solo", name: "Solo", limits: { team_seats: 0, exports: [], batch_max_urls: 0, scheduled_monitoring: 0, email_export: false, api_access: false, white_label_pdf: false, priority_support: false } },
    };
    const r = can(activeEntitlement("solo"), "workspace.team_seats", { planMap: zeroPlanMap });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_IN_PLAN");
  });

  it("remaining = cap − seatsUsed", () => {
    const r = can(activeEntitlement("business"), "workspace.team_seats", ctx({ seatsUsed: 1 }));
    expect(r.remaining).toBe(2);
  });

  it("denies once the workspace is AT its seat cap — cap>0 alone is not room", () => {
    // Regression: the original implementation returned ok(cap - seatsUsed)
    // unconditionally whenever cap > 0, so a workspace already full (or over
    // its cap after a downgrade) was reported as allowed with remaining <= 0.
    // Nothing called this capability until the workspaces feature landed, so
    // the bug was latent rather than caught by a live caller.
    const atCap = can(activeEntitlement("business"), "workspace.team_seats", ctx({ seatsUsed: 3 }));
    expect(atCap.allowed).toBe(false);
    expect(atCap.code).toBe("QUOTA_EXCEEDED");

    const overCap = can(activeEntitlement("business"), "workspace.team_seats", ctx({ seatsUsed: 4 }));
    expect(overCap.allowed).toBe(false);
  });
});

describe("workspace.create cap (how many workspaces this user may OWN)", () => {
  it("base plans allow exactly 1 (their default workspace)", () => {
    const r = can(activeEntitlement("business"), "workspace.create", ctx({ workspacesOwned: 0 }));
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it("denies creating a second workspace on a plan capped at 1", () => {
    const r = can(activeEntitlement("business"), "workspace.create", ctx({ workspacesOwned: 1 }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("QUOTA_EXCEEDED");
  });

  it("Agency's base allotment is 5", () => {
    const r = can(activeEntitlement("agency"), "workspace.create", ctx({ workspacesOwned: 4 }));
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it("a purchased Extra Workspace bundle raises the cap by 1, on any plan", () => {
    const r = can(activeEntitlement("business"), "workspace.create", ctx({ workspacesOwned: 1, workspacesPurchased: 1 }));
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
  });
});

describe("workspaceAddonFeaturesForPlan — feature parity helper", () => {
  it("returns null when no extra workspaces are purchased", () => {
    expect(workspaceAddonFeaturesForPlan(activeEntitlement("business"), planMap, 0)).toBeNull();
    expect(workspaceAddonFeaturesForPlan(activeEntitlement("business"), planMap)).toBeNull();
  });

  it("returns null for plans with no team seats (synthetic zero-seat plan)", () => {
    const zeroPlanMap = {
      solo: { id: "solo", name: "Solo", limits: { team_seats: 0, exports: [], batch_max_urls: 0, scheduled_monitoring: 0, email_export: false, api_access: false, white_label_pdf: false, priority_support: false } },
    };
    expect(workspaceAddonFeaturesForPlan(activeEntitlement("solo"), zeroPlanMap, 1)).toBeNull();
  });

  it("mirrors the parent plan's features, including white_label_pdf + priority_support (Business + Agency)", () => {
    const biz = workspaceAddonFeaturesForPlan(activeEntitlement("business"), planMap, 2);
    expect(biz).toMatchObject({
      sourcePlanId: "business",
      teamSeats: 3,
      whiteLabelPdf: true,
      prioritySupport: true,
    });

    const agy = workspaceAddonFeaturesForPlan(activeEntitlement("agency"), planMap, 1);
    expect(agy).toMatchObject({
      sourcePlanId: "agency",
      teamSeats: 5,
      whiteLabelPdf: true,
      prioritySupport: true,
    });
  });

  it("exposes exports as a NEW array (not a reference to the plan's array)", () => {
    const r = workspaceAddonFeaturesForPlan(activeEntitlement("business"), planMap, 1);
    expect(r.exports).toEqual(expect.arrayContaining(["csv", "pdf", "json", "markdown"]));
    r.exports.push("mutated");
    // Mutating the result must not leak into the underlying plan object.
    expect(planMap.business.limits.exports).not.toContain("mutated");
  });
});

// ── Account freeze / member pause ───────────────────────────────────────────
// A SEPARATE AXIS from `status`, and these tests exist mainly to keep it that
// way. `status = 'suspended'` is the billing lifecycle: it starts dunning and a
// day-90 purge countdown and means "this account has lapsed". A freeze means
// the opposite — "keep charging me, keep my data, just stop anyone consuming
// units". Collapsing the two would enrol a paying customer in a dunning
// sequence and start a deletion clock on data they explicitly asked to keep.
describe("can() — frozen accounts and paused seats", () => {
  const active = { plan_id: "pro", status: "active", source: "payment",
                   period_end: new Date(Date.now() + 20 * 86400000).toISOString() };

  const UNIT_CAPS = ["extract", "enrich", "audit", "batch", "ai"];

  it("denies every unit-consuming capability while frozen", () => {
    const frozen = { ...active, frozen_at: new Date().toISOString() };
    for (const cap of UNIT_CAPS) {
      const v = can(frozen, cap, { planMap, usage: { extractions: 0, enrichments: {} } });
      expect(v.allowed, `${cap} was allowed on a frozen account`).toBe(false);
      expect(v.code).toBe("FROZEN");
    }
  });

  it("still allows every export — this is 'view-only', not 'locked out'", () => {
    const frozen = { ...active, frozen_at: new Date().toISOString() };
    for (const cap of ["export.csv", "export.pdf", "export.markdown", "export.json", "export.email"]) {
      expect(can(frozen, cap, { planMap }).allowed, `${cap} was denied on a frozen account`).toBe(true);
    }
  });

  it("does not confuse a freeze with a lapse", () => {
    // The billing status is untouched, so nothing downstream should read a
    // freeze as a reason to dun or to purge.
    const frozen = { ...active, frozen_at: new Date().toISOString() };
    expect(computeLifecycle(frozen).status).toBe("active");
  });

  it("a normal active account is unaffected", () => {
    expect(can(active, "extract", { planMap, usage: { extractions: 0, enrichments: {} } }).allowed).toBe(true);
  });

  it("reports a pending deletion distinctly from a plain freeze", () => {
    // Different remedy, so different code: one is "unfreeze", the other is
    // "cancel the deletion". Telling somebody to unfreeze an account that is
    // scheduled for deletion sends them to a button that will refuse them.
    const deleting = {
      ...active,
      frozen_at: new Date().toISOString(),
      deletion_requested_at: new Date().toISOString(),
    };
    const v = can(deleting, "extract", { planMap, usage: { extractions: 0, enrichments: {} } });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("DELETION_PENDING");
    expect(v.reason).toMatch(/cancel the deletion/i);
  });

  it("a paused workspace seat is denied the same capabilities", () => {
    for (const cap of UNIT_CAPS) {
      const v = can(active, cap, { planMap, memberPaused: true, usage: { extractions: 0, enrichments: {} } });
      expect(v.allowed, `${cap} was allowed on a paused seat`).toBe(false);
      expect(v.code).toBe("MEMBER_PAUSED");
    }
    expect(can(active, "export.csv", { planMap, memberPaused: true }).allowed).toBe(true);
  });

  it("a purged account outranks a freeze", () => {
    // Nothing is recoverable from purged, so the freeze is not the story.
    const purged = { ...active, status: "purged", frozen_at: new Date().toISOString() };
    expect(can(purged, "export.csv", { planMap }).code).toBe("PURGED");
  });
});

// ── Intelligence Workflows capabilities (PRD 3, 4, 5) ────────────────────────
// Added 2026-09-04. These three endpoints shipped with no entitlement check at
// all, which made the BRD's own upgrade triggers unenforceable and left three
// cost-bearing operations unmetered. Each reuses a limit the pricing page
// already sells rather than inventing a new per-tier number.
describe("bulk.enrich — answers to its OWN allowance, not the batch one", () => {
  const free = { plan_id: "free", status: "active" };
  const go = { plan_id: "go", status: "active" };
  const business = { plan_id: "business", status: "active" };

  // 🔴 THE SPLIT THAT MADE THIS ITS OWN KEY. Bulk enrichment and batch mode
  // both read `batch_max_urls` until the 2026-09-23 repricing. Free is now
  // batch 5 / bulk 0, so the shared key would have kept handing Free a 5-row
  // account list — a product it is not sold. A batch fetches pages; a bulk list
  // fetches, enriches and ICP-scores each row at 3 credits apiece.
  it("Free has a batch allowance and NO bulk allowance", () => {
    expect(PLAN_BY_ID.free.limits.batch_max_urls).toBeGreaterThan(0);
    expect(PLAN_BY_ID.free.limits.bulk_list_max).toBe(0);
    const r = can(free, "bulk.enrich", ctx({ rowCount: 1 }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_IN_PLAN");
  });

  it("allows a list within the plan's bulk allowance", () => {
    expect(can(go, "bulk.enrich", ctx({ rowCount: 3 })).allowed).toBe(true);
  });

  it("denies a list larger than the plan's bulk allowance", () => {
    const r = can(go, "bulk.enrich", ctx({ rowCount: 500 }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("PLAN_LIMIT");
  });

  it("a bigger plan allows a bigger list", () => {
    const goCap = PLAN_BY_ID.go.limits.bulk_list_max;
    expect(can(go, "bulk.enrich", ctx({ rowCount: goCap + 1 })).allowed).toBe(false);
    expect(can(business, "bulk.enrich", ctx({ rowCount: goCap + 1 })).allowed).toBe(true);
  });

  // ⚠️ An operator override written before the split carries batch_max_urls and
  // no bulk_list_max. Resolving that to 0 would REVOKE bulk enrichment from
  // whoever wrote the override, which is the opposite of what one is for.
  it("falls back to batch_max_urls for an override written before the split", () => {
    const legacy = { free: { id: "free", price_usd: 0, limits: { batch_max_urls: 50 } } };
    const r = can(free, "bulk.enrich", { planMap: legacy, rowCount: 20 });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(30);
  });

  it("honours a deliberate bulk_list_max of 0 over the batch fallback", () => {
    const explicit = { free: { id: "free", price_usd: 0, limits: { batch_max_urls: 50, bulk_list_max: 0 } } };
    expect(can(free, "bulk.enrich", { planMap: explicit, rowCount: 1 }).allowed).toBe(false);
  });

  it("purchased batch bundles raise the bulk ceiling too", () => {
    const cap = PLAN_BY_ID.go.limits.bulk_list_max;
    expect(can(go, "bulk.enrich", ctx({ rowCount: cap + 10 })).allowed).toBe(false);
    expect(
      can(go, "bulk.enrich", ctx({ rowCount: cap + 10, bonusBatchUrls: 50 })).allowed
    ).toBe(true);
  });

  it("reports remaining headroom so the client can show it before a run", () => {
    const r = can(business, "bulk.enrich", ctx({ rowCount: 1 }));
    expect(r.remaining).toBe(PLAN_BY_ID.business.limits.batch_max_urls - 1);
  });
});

describe("watchlist.create — answers to the scheduled-monitoring allowance", () => {
  it("denies a plan that includes no scheduled monitoring", () => {
    // A watchlist crawls forever on a cadence. A user who may keep no
    // schedules must not acquire the right to keep them via a different object
    // — the same reasoning audit.schedule already documents.
    const free = { plan_id: "free", status: "active" };
    expect(PLAN_BY_ID.free.limits.scheduled_monitoring).toBe(0);
    const r = can(free, "watchlist.create", ctx({ watchlistCount: 0 }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("PLAN_REQUIRED");
  });

  it("allows a plan that does, up to its cap", () => {
    const select = { plan_id: "select", status: "active" };
    const cap = PLAN_BY_ID.select.limits.scheduled_monitoring;
    expect(can(select, "watchlist.create", ctx({ watchlistCount: cap - 1 })).allowed).toBe(true);
    expect(can(select, "watchlist.create", ctx({ watchlistCount: cap })).allowed).toBe(false);
  });

  it("an unlimited plan is never capped", () => {
    const agency = { plan_id: "agency", status: "active" };
    if (PLAN_BY_ID.agency.limits.scheduled_monitoring === Infinity) {
      expect(can(agency, "watchlist.create", ctx({ watchlistCount: 9999 })).allowed).toBe(true);
    }
  });
});

describe("rule.create — answers to the integrations entitlement", () => {
  it("denies a plan without integrations", () => {
    const free = { plan_id: "free", status: "active" };
    const r = can(free, "rule.create", ctx());
    expect(r.allowed).toBe(false);
    // A rule's only purpose is pushing into HubSpot/Slack/a webhook, so gating
    // it anywhere else would reopen the four push providers `integrations` was
    // added to gate.
    expect(can(free, "integrations", ctx()).allowed).toBe(false);
  });

  it("allows a plan with integrations, and agrees with the integrations gate", () => {
    for (const planId of ["select", "pro", "business", "agency"]) {
      const ent = { plan_id: planId, status: "active" };
      expect(can(ent, "rule.create", ctx()).allowed).toBe(
        can(ent, "integrations", ctx()).allowed
      );
    }
  });
});
