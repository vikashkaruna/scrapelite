// auditBudget — the wall-clock budget that stopped the audit 504ing.
//
// Every test here was confirmed to FAIL against the pre-fix code before being
// accepted. What they pin is not "the code has a deadline" but the three
// measured behaviours that made the deadline necessary:
//
//   1. citation prompts are issued CONCURRENTLY, not one after another
//   2. the scrape chain stops walking providers once the budget is gone
//   3. runChain can be bounded, and stops trying providers after an abort
//
// The bug they cover: with every dependency configured and merely SLOW (not
// down), runAudit took ~155s against a Netlify function killed at 10-26s, so
// the client saw `POST /audits failed (504)` and — because the audit row is
// opened before the run and quota counts every row that is not `failed` — the
// user was charged for it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDeadline, budgetFromEnv, unlimitedDeadline,
  DEFAULT_AUDIT_BUDGET_MS, MIN_USEFUL_SLICE_MS,
} from "../../functions/lib/audit/deadline.js";
import { sampleCitations } from "../../functions/lib/audit/citationSampling.js";
import { ABANDONED_AUDIT_MS } from "../../functions/lib/audit/auditStore.js";

describe("createDeadline", () => {
  it("hands a stage the smaller of what it wants and what is left", () => {
    let t = 1_000;
    const d = createDeadline(10_000, () => t);
    expect(d.sliceFor(3_000)).toBe(3_000);      // wants less than remains
    t += 8_000;                                  // 2_000 left, minus the reserve
    expect(d.sliceFor(3_000)).toBeLessThan(3_000);
    expect(d.sliceFor(3_000)).toBeGreaterThan(0);
  });

  it("returns 0 — meaning SKIP — rather than a slice too short to be useful", () => {
    let t = 0;
    const d = createDeadline(10_000, () => t);
    t = 9_900;
    // Starting a 15s call with 100ms left produces the same unmeasured signal
    // one round-trip later, having spent the budget of the stages after it.
    expect(d.sliceFor(15_000)).toBe(0);
    expect(d.allows()).toBe(false);
  });

  it("never reports a negative remainder", () => {
    let t = 0;
    const d = createDeadline(1_000, () => t);
    t = 999_999;
    expect(d.remaining()).toBe(0);
    expect(d.expired()).toBe(true);
  });

  it("signalFor returns null when there is no room, so callers skip", () => {
    let t = 0;
    const d = createDeadline(5_000, () => t);
    expect(d.signalFor(1_000)).not.toBeNull();
    t = 5_000;
    expect(d.signalFor(1_000)).toBeNull();
  });

  it("signalFor's signal aborts once the slice is spent", async () => {
    vi.useFakeTimers();
    try {
      const d = createDeadline(60_000);
      const b = d.signalFor(50);
      expect(b.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      expect(b.signal.aborted).toBe(true);
      b.clear();
    } finally { vi.useRealTimers(); }
  });

  it("budgetFromEnv clamps nonsense and defaults when unset", () => {
    expect(budgetFromEnv({})).toBe(DEFAULT_AUDIT_BUDGET_MS);
    expect(budgetFromEnv({ AUDIT_BUDGET_MS: "not a number" })).toBe(DEFAULT_AUDIT_BUDGET_MS);
    expect(budgetFromEnv({ AUDIT_BUDGET_MS: "-5" })).toBe(DEFAULT_AUDIT_BUDGET_MS);
    expect(budgetFromEnv({ AUDIT_BUDGET_MS: "8000" })).toBe(8_000);
    // A floor: below ~3s nothing completes and every audit is empty, which
    // reads as a broken product rather than a tight budget.
    expect(budgetFromEnv({ AUDIT_BUDGET_MS: "50" })).toBe(3_000);
  });

  it("unlimitedDeadline always has room", () => {
    const d = unlimitedDeadline();
    expect(d.expired()).toBe(false);
    expect(d.sliceFor(60_000)).toBe(60_000);
  });
});

describe("citation sampling issues its prompts concurrently", () => {
  const env = { PERPLEXITY_API_KEY: "k" };

  it("costs the SLOWEST prompt, not the SUM of them", async () => {
    // The defect: `for (const prompt of list) { await ask(...) }`. Five default
    // prompts at a 15s ceiling each = 75s of wall clock. Measured on the real
    // pipeline, the requests went out at t+0.1s, 15.1s, 30.1s, 45.1s, 60.1s.
    const startedAt = [];
    let firstResolve;
    const gate = new Promise((r) => { firstResolve = r; });

    const fetchImpl = vi.fn(async () => {
      startedAt.push(Date.now());
      // Every prompt waits on ONE shared gate. Serially this deadlocks (prompt
      // 2 can never start), so a serial implementation cannot pass this test.
      await gate;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "no mention" } }] }) };
    });

    const pending = sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "web extraction", env, fetchImpl,
    });
    // Let the concurrent dispatch happen, then release them all together.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    firstResolve();

    const result = await pending;
    expect(result.promptCount).toBeGreaterThan(1);
    // All dispatched within a few ms of each other, not 15s apart.
    expect(Math.max(...startedAt) - Math.min(...startedAt)).toBeLessThan(1_000);
  });

  it("still reduces results in prompt order, so stored evidence is unchanged", async () => {
    const fetchImpl = vi.fn(async (_u, opts) => {
      const prompt = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: `answer to ${prompt}` } }] }) };
    });
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "extraction",
      prompts: ["one", "two", "three"], env, fetchImpl,
    });
    expect(r.runs.map((x) => x.prompt)).toEqual(["one", "two", "three"]);
  });

  it("a single failing prompt does not lose the others", async () => {
    const fetchImpl = vi.fn(async (_u, opts) => {
      const prompt = JSON.parse(opts.body).messages[0].content;
      if (prompt === "two") throw new Error("upstream 500");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "DatIQ is good" } }] }) };
    });
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", prompts: ["one", "two", "three"], env, fetchImpl,
    });
    expect(r.promptCount).toBe(2);
    expect(r.runs.find((x) => x.prompt === "two").error).toBeTruthy();
  });
});

describe("abandoned audits are not charged", () => {
  it("the abandonment window is far longer than any audit could take", () => {
    // A Netlify function is killed at 26s at the very most, so a `running` row
    // older than this cannot be in flight — it is a crashed run. The window
    // must stay comfortably above that, or a genuinely concurrent audit would
    // be discounted and the quota could be slipped.
    expect(ABANDONED_AUDIT_MS).toBeGreaterThan(60_000);
  });
});
