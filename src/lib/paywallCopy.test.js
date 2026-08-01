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

  it("picks Pro for JSON export", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "json" }).id).toBe("pro");
  });

  it("picks Go for PDF / Markdown export", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "pdf" }).id).toBe("go");
    expect(pickRecommendedPlan({ kind: "export", format: "markdown" }).id).toBe("go");
  });

  it("picks Pro for scheduled monitoring (Go and Select both have scheduled_monitoring: 0)", () => {
    expect(pickRecommendedPlan({ kind: "schedule" }).id).toBe("pro");
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
    // Annual price is 17 (USD), monthly 20.4. The CTA should mention the annual figure.
    expect(out.ctaLabel).toMatch(/\$17\/mo, billed annually/);
    expect(out.ctaLabel).not.toMatch(/^\$20\.4/);
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
