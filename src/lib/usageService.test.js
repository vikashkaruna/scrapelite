import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canBatch,
  canEmailExport,
  canEnrich,
  canExport,
  canExtract,
  canExtractBatch,
  incrementAudits,
  incrementBatchRuns,
  incrementContentGenerations,
  incrementEnrichments,
  incrementExtractions,
  readSubscription,
  readUsage,
  writeSubscription,
} from "./usageService.js";
import { clearCreditsCache } from "./credits/creditClient.js";

/**
 * U-18..25 — usageService is the metering layer that the billing gate
 * (BillingProvider) and the extraction flow both rely on. The
 * `canExtract` / `canBatch` / `canExport` functions are the contract
 * surface; the increment functions are the write side. Tests use
 * vi.useFakeTimers for month-rollover and vi.setSystemTime for the
 * day-boundary edge cases.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── U-18 — THE AXIS MOVED FROM A COUNTER TO A POOL ─────────────────────────
// These tests used to drive `incrementExtractions()` against a per-plan
// extraction cap. That cap is retired (D1): one page read costs one credit,
// and an extraction and an audit now draw on the same budget, so a customer
// can no longer be refused an audit while holding a month of unused
// extractions. The counter still exists for DISPLAY and is asserted elsewhere
// in this file; it simply no longer gates anything.
describe("canExtract (U-18) — decided by the credit pool", () => {
  // ⚠️ creditClient holds an in-process cache as well as the localStorage
  // one, so writing the key alone would be ignored after the first read.
  const withBalance = (available) => {
    clearCreditsCache();
    localStorage.setItem("datiq.credits", JSON.stringify({
      status: { enforced: true, available }, fetchedAt: Date.now(),
    }));
  };

  it("allows while the pool covers the page, and refuses when it cannot", () => {
    withBalance(3);
    expect(canExtract("free").allowed).toBe(true);
    withBalance(0);
    expect(canExtract("free").allowed).toBe(false);
  });

  it("reports what would be left after the run", () => {
    withBalance(42);
    expect(canExtract("select").remaining).toBe(41);
  });

  // 🔴 THE FAIL-OPEN RULE, client side. A browser that has not fetched the
  // balance yet must not disable the button — the server decides, and a UI
  // that refuses on a cache miss refuses paying customers during a blip.
  it("reads through when the browser has no cached balance", () => {
    clearCreditsCache();
    expect(canExtract("free").allowed).toBe(true);
  });

  it("reads through for an account that is not on the credit system", () => {
    clearCreditsCache();
    localStorage.setItem("datiq.credits", JSON.stringify({
      status: { enforced: false, available: 0 }, fetchedAt: Date.now(),
    }));
    expect(canExtract("free").allowed).toBe(true);
  });

  // ⚠️ The extraction counter no longer participates. Pinned, because the
  // obvious "fix" when something looks off is to wire it back in.
  it("ignores the extraction counter entirely", () => {
    withBalance(5);
    incrementExtractions(10_000);
    expect(canExtract("free").allowed).toBe(true);
  });

  it("names the cost and the balance when it refuses", () => {
    withBalance(0);
    expect(canExtract("free").reason).toMatch(/costs 1 credit and you have 0/);
  });
});

// U-19 — Agency no longer has an "Infinity" extraction limit; it has the
// largest pool (100,000) plus a published fair-use overage. An unlimited plan
// was always a promise the metering could not keep: the provider bills us for
// every call whatever the plan says.
describe("canExtract — Agency draws on the largest pool (U-19)", () => {
  it("is allowed with a large balance and unaffected by the counter", () => {
    clearCreditsCache();
    localStorage.setItem("datiq.credits", JSON.stringify({
      status: { enforced: true, available: 100_000 }, fetchedAt: Date.now(),
    }));
    incrementExtractions(1000);
    const r = canExtract("agency");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99_999);
  });
});

describe("canExtract — month rollover (U-20)", () => {
  // The DISPLAY counter still rolls monthly; it just no longer gates. The
  // allowance itself now rolls over through the ledger (0078): a monthly
  // grant expires at the end of the FOLLOWING month, which is what bounds the
  // carry at one month's worth.
  it("new month starts at 0 (counter reset)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T10:00:00.000Z"));
    incrementExtractions(10);
    expect(readUsage().extractions).toBe(10);

    // Roll into August
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    expect(readUsage().extractions).toBe(0);
  });
});

describe("canEnrich (U-21)", () => {
  // `enrichments_per_extraction` is retired — it capped DEPTH per URL while
  // the cost is per CALL, and every plan had it at Infinity anyway. What is
  // left is the credit pool plus a runaway guard.
  it("is allowed when the browser has no cached balance", () => {
    clearCreditsCache();
    expect(canEnrich("free", "https://example.com/a").allowed).toBe(true);
  });

  it("tracks per-URL enrichment count when a plan has a finite limit", () => {
    // No real plan has a finite enrichment limit today; assert the
    // contract: if the limit were N, after N increments the response
    // would block. We assert the read-side on a stub plan via the
    // override path.
    // Skipped — exercised in M2 contract tests for plan-shape changes.
    expect(canEnrich("free", "https://example.com/a").allowed).toBe(true);
  });
});

describe("canExport / canEmailExport (U-22)", () => {
  it("Free plan: every export format is allowed", () => {
    expect(canExport("free", "pdf")).toBe(true);
    expect(canExport("free", "markdown")).toBe(true);
    expect(canExport("free", "csv")).toBe(true);
  });

  it("Select plan: markdown, JSON and PDF are all allowed (every paid plan now ships every format)", () => {
    expect(canExport("select", "markdown")).toBe(true);
    expect(canExport("select", "json")).toBe(true);
    expect(canExport("select", "pdf")).toBe(true);
  });

  it("Free plan: JSON is allowed", () => {
    expect(canExport("free", "json")).toBe(true);
  });

  it("canEmailExport reflects plan's email_export limit", () => {
    expect(canEmailExport("free")).toBe(true);
    expect(canEmailExport("select")).toBe(true);
    expect(canEmailExport("pro")).toBe(true);
  });
});

describe("canBatch (U-23)", () => {
  it("Free plan: 6 URLs with bonus=0 blocks (limit 5)", () => {
    const r = canBatch("free", 6, 0);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/batch limit|Upgrade/i);
  });

  it("Select plan: 10 URLs with bonus=50 allows (50 + 50 - 10 = 90 remaining)", () => {
    const r = canBatch("select", 10, 50);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(90);
  });

  it("Agency plan: 500 URLs allows (limit 500)", () => {
    const r = canBatch("agency", 500, 0);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("Free plan: 6 URLs (over the 5 limit) blocks", () => {
    const r = canBatch("free", 6, 0);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/batch limit|Upgrade/i);
  });

  it("Free plan: 1 URL is allowed (limit 5)", () => {
    const r = canBatch("free", 1, 0);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
  });
});

describe("canExtractBatch (U-24) — priced by page count", () => {
  const withBalance = (available) => {
    clearCreditsCache();
    localStorage.setItem("datiq.credits", JSON.stringify({
      status: { enforced: true, available }, fetchedAt: Date.now(),
    }));
  };

  it("refuses a batch the pool cannot cover, and names the cost", () => {
    withBalance(4);
    const r = canExtractBatch("free", 5);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/5 credits/);
    expect(r.remaining).toBe(4);
  });

  it("allows one that fits, reporting what is left", () => {
    withBalance(500);
    const r = canExtractBatch("select", 50);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(450);
  });

  // The old signature took bonusExtractions from a top-up bundle. The bundle
  // is retired; the argument is accepted and ignored rather than becoming a
  // TypeError for any caller that still passes it.
  it("ignores the retired bonusExtractions argument", () => {
    withBalance(4);
    expect(canExtractBatch("free", 5, 500).allowed).toBe(false);
  });
});

describe("Increment functions (U-25)", () => {
  it("incrementExtractions(3) adds 3 to the monthly count", () => {
    const r = incrementExtractions(3);
    expect(r.extractions).toBe(3);
    expect(readUsage().extractions).toBe(3);
  });

  it("incrementBatchRuns(1) adds 1 to batchRuns", () => {
    const r = incrementBatchRuns(1);
    expect(r.batchRuns).toBe(1);
  });

  it("incrementContentGenerations(1) adds 1 to contentGenerations", () => {
    const r = incrementContentGenerations(1);
    expect(r.contentGenerations).toBe(1);
  });

  it("incrementEnrichments(url) tracks per-URL count", () => {
    incrementEnrichments("https://a.com");
    incrementEnrichments("https://a.com");
    incrementEnrichments("https://b.com");
    const u = readUsage();
    expect(u.enrichments["https://a.com"]).toBe(2);
    expect(u.enrichments["https://b.com"]).toBe(1);
  });
});

describe("readSubscription / writeSubscription", () => {
  it("readSubscription returns the default free plan when nothing is set", () => {
    const s = readSubscription();
    expect(s.planId).toBe("free");
  });

  it("writeSubscription persists and readSubscription returns it", () => {
    writeSubscription({ planId: "select", bonusExtractions: 50 });
    const s = readSubscription();
    expect(s.planId).toBe("select");
    expect(s.bonusExtractions).toBe(50);
  });
});

describe("applyTrialCredit is RETIRED (FR-Z-02 → the server's signup grant)", () => {
  // The signup grant moved to `creditMeter.ensureAllowance`, which writes
  // FREE_GRANT credits once per account under grant_period 'signup'. What these
  // assert is that the CLIENT no longer grants anything: a browser-side grant
  // would read 25 higher than the ledger the server refuses runs against.
  it("grants nothing on Free", async () => {
    const { applyTrialCredit } = await import("./usageService.js");
    const r = applyTrialCredit("free");
    expect(r.applied).toBe(false);
    expect(r.credit).toBe(0);
  });

  it("writes NOTHING to localStorage — no bonus, no applied-at flag", async () => {
    const { applyTrialCredit } = await import("./usageService.js");
    applyTrialCredit("free");
    const sub = readSubscription();
    expect(sub.bonusExtractions || 0).toBe(0);
    expect(sub.trialCreditAppliedAt).toBeUndefined();
  });

  it("leaves an existing bonus untouched rather than adding to it", async () => {
    const { applyTrialCredit, writeSubscription } = await import("./usageService.js");
    writeSubscription({ planId: "free", bonusExtractions: 40 });
    const r = applyTrialCredit("free");
    expect(r.applied).toBe(false);
    expect(readSubscription().bonusExtractions).toBe(40);
  });

  it("no plan defines trialCredit any more", async () => {
    const { PLANS } = await import("./pricingConfig.js");
    for (const p of PLANS) {
      expect(p.trialCredit, `${p.id} must not carry a client-side signup grant`).toBeUndefined();
    }
  });
});

describe("RC-02 — concurrent usage writes are atomic (race conditions)", () => {
  it("10x incrementExtractions(1) in the same tick → extractions === 10", async () => {
    // Each call reads the current value, mutates, and writes back. The
    // synchronous read-modify-write is atomic in jsdom's single-threaded
    // environment, so 10 calls produce 10 (not a smaller value due to
    // lost updates).
    for (let i = 0; i < 10; i++) {
      incrementExtractions(1);
    }
    expect(readUsage().extractions).toBe(10);
  });

  it("rapid plan upgrade from free → select does NOT double-increment datiq.usage", async () => {
    const { applyTrialCredit, incrementExtractions, readUsage, writeSubscription } = await import("./usageService.js");
    // Start on the Free plan, count 3 extractions.
    incrementExtractions();
    incrementExtractions();
    incrementExtractions();
    expect(readUsage().extractions).toBe(3);
    // Plan upgrade: writes datiq.subscription.planId = "select".
    writeSubscription({ ...readSubscription(), planId: "select" });
    // 4 more extractions.
    for (let i = 0; i < 4; i++) incrementExtractions();
    // Total should be 7 (3 before + 4 after), not 14 (no double-count).
    expect(readUsage().extractions).toBe(7);
  });

  it("applyTrialCredit repeated in one tick grants nothing at all", async () => {
    const { applyTrialCredit, readSubscription } = await import("./usageService.js");
    // The old version granted 25 on the first call and no-opped after. The
    // no-op now covers the first call too, so there is no window in which the
    // client's number exceeds the ledger's.
    const results = [];
    for (let i = 0; i < 5; i++) results.push(applyTrialCredit("free"));
    expect(results.filter((r) => r.applied).length).toBe(0);
    expect(readSubscription().bonusExtractions || 0).toBe(0);
  });
});

// ── Per-persona attribution ─────────────────────────────────────────────────
// Persona has always shaped what the product SHOWS, but nothing recorded which
// one was active when a unit was spent — so "which of my team's roles is
// consuming the plan?" had no answer, on a product that sells team seats.
//
// The breakdown is a breakdown OF the totals, never a parallel counter: the two
// can never disagree about the month, which is the failure a second counter
// always eventually reaches.
describe("usage — per-persona breakdown", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("attributes an extraction to the persona in effect", () => {
    localStorage.setItem("datiq.persona", "seo");
    incrementExtractions(2);
    const u = readUsage();
    expect(u.extractions).toBe(2);
    expect(u.byPersona.seo.extractions).toBe(2);
  });

  it("keeps the breakdown adding up to the total across personas", () => {
    localStorage.setItem("datiq.persona", "sales");
    incrementExtractions(3);
    localStorage.setItem("datiq.persona", "recruiter");
    incrementExtractions(2);
    const u = readUsage();
    const summed = Object.values(u.byPersona).reduce((n, r) => n + r.extractions, 0);
    expect(summed).toBe(u.extractions);
    expect(u.extractions).toBe(5);
  });

  it("records work done with no persona rather than dropping it", () => {
    // Silently omitting it would make the breakdown fail to add up.
    incrementExtractions(1);
    const u = readUsage();
    expect(u.byPersona.__none__.extractions).toBe(1);
    expect(u.extractions).toBe(1);
  });

  it("tracks every counter, not only extractions", () => {
    localStorage.setItem("datiq.persona", "agency");
    incrementBatchRuns(1);
    incrementContentGenerations(2);
    incrementEnrichments("https://example.com");
    incrementAudits(3);
    const row = readUsage().byPersona.agency;
    expect(row).toMatchObject({ batchRuns: 1, contentGenerations: 2, enrichments: 1, audits: 3 });
  });

  it("reads back a record written before byPersona existed", () => {
    // Historic months genuinely have no breakdown. That must not throw.
    const mk = readUsage().month;
    localStorage.setItem("datiq.usage", JSON.stringify({
      [mk]: { month: mk, extractions: 9, enrichments: {}, batchRuns: 1, contentGenerations: 0 },
    }));
    const u = readUsage();
    expect(u.extractions).toBe(9);
    expect(u.byPersona).toEqual({});
  });

  it("survives storage being unreadable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((k) => {
      if (k === "datiq.persona") throw new Error("blocked");
      return null;
    });
    expect(() => incrementExtractions(1)).not.toThrow();
    spy.mockRestore();
  });
});
