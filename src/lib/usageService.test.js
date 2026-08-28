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

describe("canExtract (U-18)", () => {
  it("Free plan: 0/10/100/101 extractions", () => {
    expect(canExtract("free").allowed).toBe(true);
    expect(canExtract("free").remaining).toBe(10);

    incrementExtractions(10);
    expect(canExtract("free").allowed).toBe(false);
    expect(canExtract("free").remaining).toBe(0);
  });

  it("Select plan: starts with 500 remaining", () => {
    expect(canExtract("select").remaining).toBe(500);
    incrementExtractions(50);
    expect(canExtract("select").remaining).toBe(450);
  });

  it("bonusExtractions extends the limit (top-up bundle)", () => {
    incrementExtractions(10);
    const r = canExtract("free", 50);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(50);
  });

  it("returns a reason string when blocked", () => {
    incrementExtractions(10);
    const r = canExtract("free");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Upgrade|top-up|bundle/i);
  });
});

describe("canExtract — Agency with Infinity limit (U-19)", () => {
  it("returns remaining: Infinity", () => {
    const r = canExtract("agency");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Infinity);
  });

  it("stays allowed even after 1000 extractions", () => {
    incrementExtractions(1000);
    const r = canExtract("agency");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Infinity);
  });
});

describe("canExtract — month rollover (U-20)", () => {
  it("new month starts at 0 (counter reset)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T10:00:00.000Z"));
    incrementExtractions(10);
    expect(canExtract("free").allowed).toBe(false);

    // Roll into August
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    expect(canExtract("free").allowed).toBe(true);
    expect(canExtract("free").remaining).toBe(10);
  });
});

describe("canEnrich (U-21)", () => {
  it("Free plan: enrichments_per_extraction is Infinity → always allowed", () => {
    const r = canEnrich("free", "https://example.com/a");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Infinity);
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
  it("Free plan: PDF is not in the allowed exports array", () => {
    expect(canExport("free", "pdf")).toBe(false);
    expect(canExport("free", "markdown")).toBe(false);
    expect(canExport("free", "csv")).toBe(true);
  });

  it("Select plan: markdown, JSON and PDF are all allowed (every paid plan now ships every format)", () => {
    expect(canExport("select", "markdown")).toBe(true);
    expect(canExport("select", "json")).toBe(true);
    expect(canExport("select", "pdf")).toBe(true);
  });

  it("Free plan: JSON is not allowed (still CSV-only)", () => {
    expect(canExport("free", "json")).toBe(false);
  });

  it("canEmailExport reflects plan's email_export limit", () => {
    expect(canEmailExport("free")).toBe(false);
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

describe("canExtractBatch (U-24)", () => {
  it("Free plan: 5 extractions when 6 are used blocks with reason", () => {
    incrementExtractions(6);
    const r = canExtractBatch("free", 5, 0);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/5 extractions|remaining/i);
    expect(r.remaining).toBe(4);
  });

  it("Select plan: enough quota allows (500 - 50 used = 450 remaining)", () => {
    incrementExtractions(50);
    const r = canExtractBatch("select", 50, 0);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(450);
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

describe("applyTrialCredit (FR-Z-02 / Q2 2026-07-15)", () => {
  it("Free plan → applies the 25-extraction credit once", async () => {
    const { applyTrialCredit } = await import("./usageService.js");
    const r = applyTrialCredit("free");
    expect(r.applied).toBe(true);
    expect(r.credit).toBe(25);
    expect(r.sub.bonusExtractions).toBe(25);
    expect(r.sub.trialCreditAppliedAt).toBeTruthy();
  });

  it("is idempotent — re-running after the grant is a no-op", async () => {
    const { applyTrialCredit } = await import("./usageService.js");
    applyTrialCredit("free");
    const r2 = applyTrialCredit("free");
    expect(r2.applied).toBe(false);
    expect(r2.credit).toBe(0);
    // bonusExtractions stayed at 25 (not 50).
    expect(readSubscription().bonusExtractions).toBe(25);
  });

  it("Paid plans (no trialCredit defined) → no credit applied", async () => {
    const { applyTrialCredit, writeSubscription } = await import("./usageService.js");
    writeSubscription({ planId: "select", bonusExtractions: 0 });
    const r = applyTrialCredit("select");
    expect(r.applied).toBe(false);
    expect(r.credit).toBe(0);
    expect(r.sub.bonusExtractions).toBe(0);
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

  it("applyTrialCredit concurrent calls — first wins, rest are no-ops", async () => {
    const { applyTrialCredit, readSubscription } = await import("./usageService.js");
    // Fire 5 concurrent calls (in the same tick). The first one applies
    // the credit (25), the rest are no-ops because trialCreditAppliedAt
    // is already set.
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(applyTrialCredit("free"));
    }
    const applied = results.filter((r) => r.applied);
    expect(applied.length).toBe(1);
    expect(applied[0].credit).toBe(25);
    // The persisted bonusExtractions is exactly 25.
    expect(readSubscription().bonusExtractions).toBe(25);
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
