import { describe, it, expect } from "vitest";
import {
  chargeableEvents, toLedgerEntries, actualCredits, reconcile, checkAllowance,
  describeEstimate, LEDGER_REASONS, LEDGER_UNITS, UNIT_TO_REASON, OVERRUN_TOLERANCE,
} from "./creditModel.js";

const ev = (over = {}) => ({ unit: "page", credits: 1, quantity: 1, ...over });

describe("chargeableEvents — never charge for work we did not do", () => {
  it("charges a real fetch", () => {
    expect(chargeableEvents([ev()])).toHaveLength(1);
  });

  it("does NOT charge a cache hit", () => {
    // resultCache served it; no provider call happened.
    expect(chargeableEvents([ev({ cached: true })])).toHaveLength(0);
  });

  it("does NOT charge a page skipped by the unchanged-content pre-filter", () => {
    // §1.4: the hash matched, so nothing was read and nothing was inferred.
    expect(chargeableEvents([ev({ skipped: true })])).toHaveLength(0);
  });

  it("does NOT charge a failed provider call — the user gets no value", () => {
    expect(chargeableEvents([ev({ failed: true })])).toHaveLength(0);
  });

  it("does NOT charge zero or negative credits", () => {
    expect(chargeableEvents([ev({ credits: 0 }), ev({ credits: -3 })])).toHaveLength(0);
  });

  it("drops events whose unit is not a real ledger unit", () => {
    expect(chargeableEvents([ev({ unit: "vibes" })])).toHaveLength(0);
  });

  it("survives junk input rather than throwing mid-run", () => {
    expect(chargeableEvents(null)).toEqual([]);
    expect(chargeableEvents([null, undefined, "x", 7])).toEqual([]);
  });

  it("a run that was refused at a gate produces NO ledger rows at all", () => {
    // The whole point: extract.js declines above the charge, so nothing bills.
    expect(toLedgerEntries([])).toEqual([]);
    expect(actualCredits([])).toBe(0);
  });
});

describe("toLedgerEntries — a legible audit trail, not a firehose", () => {
  it("collapses many events into one row per (reason, unit)", () => {
    const events = [
      ...Array.from({ length: 40 }, () => ev({ unit: "page", credits: 1 })),
      ...Array.from({ length: 40 }, () => ev({ unit: "ai_call", credits: 2 })),
    ];
    const rows = toLedgerEntries(events, { runId: "trun_1", userId: "u1" });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.unit === "page")).toMatchObject({
      reason: "page_fetch", credits: 40, quantity: 40, run_id: "trun_1", user_id: "u1",
    });
    expect(rows.find((r) => r.unit === "ai_call")).toMatchObject({ reason: "ai_call", credits: 80 });
  });

  it("maps every estimate unit onto a real ledger reason", () => {
    for (const [unit, reason] of Object.entries(UNIT_TO_REASON)) {
      expect(LEDGER_UNITS).toContain(unit);
      expect(LEDGER_REASONS).toContain(reason);
    }
  });

  it("excludes non-chargeable events from the rows it builds", () => {
    const rows = toLedgerEntries([ev(), ev({ cached: true }), ev({ failed: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1);
  });

  it("carries the workspace so team spend is attributable", () => {
    expect(toLedgerEntries([ev()], { workspaceId: "ws1" })[0].workspace_id).toBe("ws1");
  });
});

describe("reconcile — estimate vs actual", () => {
  it("reports on_estimate when the two agree", () => {
    const r = reconcile(10, [ev({ credits: 10 })]);
    expect(r).toMatchObject({ estimated: 10, actual: 10, delta: 0, verdict: "on_estimate" });
    expect(r.needsDisclosure).toBe(false);
  });

  it("flags an overrun — the case the USER is owed an explanation for", () => {
    const r = reconcile(10, [ev({ credits: 20 })]);
    expect(r.verdict).toBe("overrun");
    expect(r.delta).toBe(10);
    expect(r.needsDisclosure).toBe(true);
  });

  it("flags an underrun — a pricing problem, not a trust problem", () => {
    const r = reconcile(100, [ev({ credits: 10 })]);
    expect(r.verdict).toBe("underrun");
    expect(r.needsDisclosure).toBe(false);
  });

  it("tolerates small drift in both directions", () => {
    const within = 1 + OVERRUN_TOLERANCE - 0.01;
    expect(reconcile(100, [ev({ credits: Math.round(100 * within) })]).verdict).toBe("on_estimate");
    expect(reconcile(100, [ev({ credits: 80 })]).verdict).toBe("on_estimate");
  });

  it("a cache-served run costs nothing even against a real estimate", () => {
    const r = reconcile(12, [ev({ cached: true, credits: 12 })]);
    expect(r.actual).toBe(0);
    expect(r.verdict).toBe("underrun");
  });

  it("handles a zero estimate that then spent something", () => {
    expect(reconcile(0, [ev({ credits: 5 })]).verdict).toBe("overrun");
    expect(reconcile(0, []).verdict).toBe("on_estimate");
  });
});

describe("checkAllowance", () => {
  it("allows a run that fits", () => {
    expect(checkAllowance({ spent: 10, allowance: 100, estimated: 20 }))
      .toMatchObject({ ok: true, remaining: 90, wouldExceedBy: 0 });
  });

  it("refuses a run that does not, and says by how much", () => {
    const r = checkAllowance({ spent: 90, allowance: 100, estimated: 30 });
    expect(r.ok).toBe(false);
    expect(r.wouldExceedBy).toBe(20);
  });

  it("offers a partial run rather than a flat refusal when SOME of it fits", () => {
    // "Run the first 10 of your 30 domains" beats "you cannot do this".
    expect(checkAllowance({ spent: 90, allowance: 100, estimated: 30 }).partialPossible).toBe(true);
    expect(checkAllowance({ spent: 100, allowance: 100, estimated: 30 }).partialPossible).toBe(false);
  });

  it("treats an unlimited plan as unlimited", () => {
    expect(checkAllowance({ spent: 1e9, allowance: Infinity, estimated: 1e6 }))
      .toMatchObject({ ok: true, remaining: Infinity });
  });

  it("never reports negative remaining after an overspend", () => {
    expect(checkAllowance({ spent: 150, allowance: 100, estimated: 1 }).remaining).toBe(0);
  });
});

describe("describeEstimate", () => {
  it("reads as a sentence a human can check", () => {
    const s = describeEstimate({ credits: 6, breakdown: [
      { unit: "run", quantity: 1, credits: 1, label: "Workflow setup" },
      { unit: "page", quantity: 3, credits: 3, label: "Pages fetched" },
      { unit: "ai_call", quantity: 1, credits: 2, label: "AI analysis" },
    ] });
    expect(s).toBe("6 credits — 1 × Workflow setup, 3 × Pages fetched, 1 × AI analysis");
  });

  it("says so plainly when nothing will be charged", () => {
    expect(describeEstimate({ credits: 0, breakdown: [] })).toMatch(/No credits/);
    expect(describeEstimate(null)).toMatch(/No credits/);
  });

  it("uses the singular for one credit", () => {
    expect(describeEstimate({ credits: 1, breakdown: [{ unit: "run", quantity: 1, credits: 1, label: "Setup" }] }))
      .toMatch(/^1 credit —/);
  });
});
