// paywallCopy.test.js — FA3 (task-aware paywall + annual anchoring) tests.
import { describe, it, expect } from "vitest";
import { buildPaywallCopy, pickRecommendedPlan } from "./paywallCopy.js";

const FREE = { id: "free", name: "Free", limits: { extractions: 10, batch_max_urls: 5 }, price_usd: 0, price_usd_annual: 0, price_inr: 0, price_inr_annual: 0 };
const PRO  = { id: "pro",  name: "Pro",  limits: { extractions: 1000, batch_max_urls: 100 }, price_usd: 20.4, price_usd_annual: 17, price_inr: 1799, price_inr_annual: 1499 };

describe("FA3 — pickRecommendedPlan", () => {
  it("defaults to Pro for an unknown context", () => {
    expect(pickRecommendedPlan({}).id).toBe("pro");
  });

  it("picks Go for a small batch (6-20 URLs, Go = 20 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 8 }).id).toBe("go");
  });

  it("picks Select for a batch over Go's cap but within Select's (21-50 URLs, Select = 50 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 35 }).id).toBe("select");
  });

  it("picks Pro for a batch over Select's cap but within Pro's (51-100 URLs, Pro = 100 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 75 }).id).toBe("pro");
  });

  it("picks Business for a batch over Pro's cap but within Business's (101-250 URLs, Business = 250 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 150 }).id).toBe("business");
  });

  it("picks Agency for a batch with more than 250 URLs (Agency = 500 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 300 }).id).toBe("agency");
  });

  it("picks Go for JSON export (all paid plans now include every export format)", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "json" }).id).toBe("go");
  });

  it("picks Go for PDF / Markdown export", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "pdf" }).id).toBe("go");
    expect(pickRecommendedPlan({ kind: "export", format: "markdown" }).id).toBe("go");
  });

  it("picks Select for scheduled monitoring (Go is 0, Select is the first tier with it)", () => {
    expect(pickRecommendedPlan({ kind: "schedule" }).id).toBe("select");
  });

  it("picks Select for push integrations (Free/Go are excluded)", () => {
    expect(pickRecommendedPlan({ kind: "integrations" }).id).toBe("select");
  });

  it("picks Business for API access", () => {
    expect(pickRecommendedPlan({ kind: "api" }).id).toBe("business");
  });
});

describe("FA3 — buildPaywallCopy", () => {
  it("renders task-aware title for a batch over the Free limit", () => {
    const out = buildPaywallCopy({
      route: "/batch",
      ctx: { kind: "batch", urls: 30 },
      currentPlan: FREE,
      usage: { extractions: 5 },
    });
    expect(out.title).toMatch(/Batch mode maxes out at 5 URLs/i);
    expect(out.body).toMatch(/URLs per batch/i);
    // Go's batch cap is 20 URLs, so a 30-URL batch needs Select (cap 50).
    expect(out.recommendedPlanId).toBe("select");
  });

  it("anchors on the annual price (not monthly) in the CTA label", () => {
    const out = buildPaywallCopy({
      route: "/dashboard",
      ctx: { kind: "export", format: "json" },
      currentPlan: FREE,
      usage: { extractions: 10 },
    });
    // JSON export now recommends Go: annual price is 4 (USD), monthly 4.8.
    expect(out.ctaLabel).toMatch(/\$4\/mo, billed annually/);
    expect(out.ctaLabel).not.toMatch(/^\$4\.8/);
  });

  it("uses INR formatting when currency='INR'", () => {
    const out = buildPaywallCopy({
      route: "/dashboard",
      ctx: { kind: "export", format: "json" },
      currentPlan: FREE,
      usage: { extractions: 10 },
      currency: "INR",
    });
    expect(out.annualStr).toMatch(/^₹/);
    expect(out.ctaLabel).toMatch(/₹/);
  });

  it("computes a savings label when annual < monthly by ≥ 15%", () => {
    const out = buildPaywallCopy({
      route: "/",
      ctx: { kind: "single" },
      currentPlan: FREE,
      usage: { extractions: 10 },
    });
    // Pro: $17 annual vs $20.4 monthly → (20.4-17)/20.4 = ~17% savings
    expect(out.savingsLabel).toMatch(/Save \d+% with annual billing/i);
  });

  it("derives context from route when ctx is omitted", () => {
    const batch = buildPaywallCopy({ route: "/batch", usage: { batchUrls: 12 }, currentPlan: FREE });
    expect(batch.context.kind).toBe("batch");
    const sched = buildPaywallCopy({ route: "/schedules", currentPlan: FREE });
    expect(sched.context.kind).toBe("schedule");
  });

  it("over-limit copy when extractions >= limit", () => {
    const out = buildPaywallCopy({
      route: "/",
      ctx: { kind: "single" },
      currentPlan: FREE,
      usage: { extractions: 10 },
    });
    expect(out.title).toMatch(/used all 10 free extractions/i);
  });
});

// ── "you ran out of batch RUNS" is not "your batch is too BIG" ──────────────
//
// These are two different limits and they shared one context kind. A guest who
// exhausted guest_batch_hard_limit (a count of RUNS) was shown copy built from
// the batch_max_urls path, producing "You need 20 URLs in one batch" — a limit
// they never hit, quoting a number that came from multiplying their run
// allowance by four.

describe("batch_runs — exhausted free batch runs", () => {
  const args = (ctx) => ({
    route: "/batch",
    usage: { extractions: 0 },
    currentPlan: { id: "free", name: "Free", limits: { extractions: 10 } },
    ctx,
    currency: "USD",
  });

  it("names the limit the user actually hit", () => {
    const copy = buildPaywallCopy(args({ kind: "batch_runs", used: 5 }));
    expect(copy.title).toBe("You've used all 5 free batch runs");
  });

  it("never talks about URLs-per-batch, which is a different limit", () => {
    const copy = buildPaywallCopy(args({ kind: "batch_runs", used: 5 }));
    expect(copy.title).not.toMatch(/URLs in one batch/i);
    expect(`${copy.title} ${copy.body}`).not.toMatch(/\b20\b/);
  });

  it("singularises a limit of one", () => {
    expect(buildPaywallCopy(args({ kind: "batch_runs", used: 1 })).title)
      .toBe("You've used all 1 free batch run");
  });

  it("recommends an account, not an upgrade — free plan already has batch", () => {
    const copy = buildPaywallCopy(args({ kind: "batch_runs", used: 5 }));
    expect(copy.recommendedPlanId).toBe("free");
    expect(copy.ctaLabel).toBe("Create a free account");
  });

  it("leaves the size-based batch copy untouched", () => {
    // The genuine "this batch is too big for your plan" case still works.
    // (usage at the cap is what selects the "You need N URLs" phrasing.)
    const copy = buildPaywallCopy({
      route: "/batch",
      usage: { extractions: 10 },
      currentPlan: { id: "free", name: "Free", limits: { extractions: 10, batch_max_urls: 5 } },
      ctx: { kind: "batch", urls: 120 },
      currency: "USD",
    });
    expect(copy.title).toMatch(/120 URLs in one batch/);
    expect(copy.recommendedPlanId).toBe("business");
  });
});
