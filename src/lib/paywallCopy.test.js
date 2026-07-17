// paywallCopy.test.js — FA3 (task-aware paywall + annual anchoring) tests.
import { describe, it, expect } from "vitest";
import { buildPaywallCopy, pickRecommendedPlan } from "./paywallCopy.js";

const FREE = { id: "free", name: "Free", limits: { extractions: 10, batch_max_urls: 5 }, price_usd: 0, price_usd_annual: 0, price_inr: 0, price_inr_annual: 0 };
const PRO  = { id: "pro",  name: "Pro",  limits: { extractions: 1000, batch_max_urls: 50 }, price_usd: 29, price_usd_annual: 23, price_inr: 2899, price_inr_annual: 1499 };

describe("FA3 — pickRecommendedPlan", () => {
  it("defaults to Pro for an unknown context", () => {
    expect(pickRecommendedPlan({}).id).toBe("pro");
  });

  it("picks Select for a small batch (≤ 10 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 8 }).id).toBe("select");
  });

  it("picks Business for a batch with more than 10 URLs (Business = 200 URLs)", () => {
    expect(pickRecommendedPlan({ kind: "batch", urls: 25 }).id).toBe("business");
  });

  it("picks Pro for JSON export", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "json" }).id).toBe("pro");
  });

  it("picks Select for PDF / Markdown export", () => {
    expect(pickRecommendedPlan({ kind: "export", format: "pdf" }).id).toBe("select");
    expect(pickRecommendedPlan({ kind: "export", format: "markdown" }).id).toBe("select");
  });

  it("picks Select for scheduled monitoring", () => {
    expect(pickRecommendedPlan({ kind: "schedule" }).id).toBe("select");
  });

  it("picks Business for API access", () => {
    expect(pickRecommendedPlan({ kind: "api" }).id).toBe("business");
  });
});

describe("FA3 — buildPaywallCopy", () => {
  it("renders task-aware title for a batch over the Free limit", () => {
    const out = buildPaywallCopy({
      route: "/batch",
      ctx: { kind: "batch", urls: 12 },
      currentPlan: FREE,
      usage: { extractions: 5 },
    });
    expect(out.title).toMatch(/Batch mode maxes out at 5 URLs/i);
    expect(out.body).toMatch(/URLs per batch/i);
    expect(out.recommendedPlanId).toBe("business");
  });

  it("anchors on the annual price (not monthly) in the CTA label", () => {
    const out = buildPaywallCopy({
      route: "/dashboard",
      ctx: { kind: "export", format: "json" },
      currentPlan: FREE,
      usage: { extractions: 10 },
    });
    // Annual price is 23 (USD), monthly 29. The CTA should mention the annual figure.
    expect(out.ctaLabel).toMatch(/\$23\/mo, billed annually/);
    expect(out.ctaLabel).not.toMatch(/^\$29/);
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
    // Pro: $23 annual vs $29 monthly → (29-23)/29 = ~21% savings
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
