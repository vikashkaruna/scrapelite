import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_META,
  ENTERPRISE_PLAN,
  PLANS,
  PLAN_BY_ID,
  TOPUP_BUNDLES,
} from "./pricingConfig.js";

/**
 * U-12..14 — pricingConfig is the source of truth for the plan table.
 * Schema invariants here are what allow every other price-aware code
 * path to skip defensive checks (computeCharge, Pricing UI, payment
 * server). Breaking any of these is a release-blocker.
 */

const ALLOWED_LIMIT_KEYS = new Set([
  "extractions",
  "enrichments_per_extraction",
  "exports",
  "email_export",
  "scheduled_monitoring",
  "team_seats",
  "extra_seat_usd",
  "api_access",
  "white_label_pdf",
  "priority_support",
  "workspaces",
  "batch_max_urls",
]);

const ALLOWED_EXPORT_FORMATS = new Set(["csv", "pdf", "markdown", "json", "jsonl"]);

describe("PLANS schema (U-12)", () => {
  it("every plan has the required fields and valid limit values", () => {
    for (const p of PLANS) {
      expect(p.id, `plan.id is required`).toBeTruthy();
      expect(p.name, `plan.name is required`).toBeTruthy();
      expect(p.tagline, `plan.tagline is required`).toBeTruthy();
      expect(typeof p.price_usd, `${p.id}.price_usd must be a number`).toBe("number");
      expect(typeof p.price_usd_annual, `${p.id}.price_usd_annual must be a number`).toBe("number");
      expect(typeof p.price_inr, `${p.id}.price_inr must be a number`).toBe("number");
      expect(typeof p.price_inr_annual, `${p.id}.price_inr_annual must be a number`).toBe("number");
      // Limits — every limit key is from the allowed set
      for (const key of Object.keys(p.limits)) {
        expect(ALLOWED_LIMIT_KEYS.has(key), `plan ${p.id} has unknown limit ${key}`).toBe(true);
        const v = p.limits[key];
        if (typeof v === "number") {
          expect(Number.isFinite(v) || v === Infinity, `${p.id}.limits.${key} must be a non-negative number or Infinity`).toBe(true);
          expect(v, `${p.id}.limits.${key} must be >= 0`).toBeGreaterThanOrEqual(0);
        }
      }
      // exports must be a subset of allowed formats
      expect(Array.isArray(p.limits.exports), `${p.id}.limits.exports must be an array`).toBe(true);
      for (const f of p.limits.exports) {
        expect(ALLOWED_EXPORT_FORMATS.has(f), `${p.id} has unknown export ${f}`).toBe(true);
      }
      // email_export is boolean
      expect(typeof p.limits.email_export, `${p.id}.limits.email_export must be boolean`).toBe("boolean");
    }
  });

  it("Free plan has a non-zero trialCredit (R4 FR-Z-02)", () => {
    const free = PLAN_BY_ID.free;
    expect(free.trialCredit).toBe(25);
  });
});

describe("ENTERPRISE_PLAN + plan count (U-13)", () => {
  it("ENTERPRISE_PLAN has price = 'Custom' and required fields", () => {
    expect(ENTERPRISE_PLAN.id).toBe("enterprise");
    expect(ENTERPRISE_PLAN.name).toBe("Enterprise");
    expect(ENTERPRISE_PLAN.tagline).toMatch(/Custom/i);
    expect(Array.isArray(ENTERPRISE_PLAN.features)).toBe(true);
  });

  it("PLANS contains the 7 priced plans (Free / Go / Select / Pro / Business / Agency / Developer); Enterprise is rendered separately via ENTERPRISE_PLAN", () => {
    // Enterprise is its own object (ENTERPRISE_PLAN) — the "8th plan"
    // in the spec is Enterprise + 7 PLANS = 8 total, but Enterprise is
    // excluded from PLANS because it has no published price.
    expect(PLANS.length).toBe(7);
    const ids = PLANS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["free", "go", "select", "pro", "business", "agency", "developer"]),
    );
  });

  it("Go sits strictly below Select in extractions and batch size (U-12 GO tier)", () => {
    const go = PLAN_BY_ID.go;
    const select = PLAN_BY_ID.select;
    expect(go.limits.extractions).toBeLessThan(select.limits.extractions);
    expect(go.limits.batch_max_urls).toBeLessThan(select.limits.batch_max_urls);
    // Everything else about Go mirrors Select's original feature set.
    expect(go.limits.exports).toEqual(select.limits.exports);
    expect(go.limits.email_export).toBe(select.limits.email_export);
    expect(go.limits.scheduled_monitoring).toBe(select.limits.scheduled_monitoring);
    expect(go.limits.api_access).toBe(select.limits.api_access);
  });

  it("Developer plan is marked 'coming soon' with a 'Coming H3 2026' badge", () => {
    const dev = PLAN_BY_ID.developer;
    expect(dev.comingSoon).toBe(true);
    expect(dev.badge).toBe("Coming H3 2026");
  });

  it("Agency is the only 'Best Value' plan (the trigger for the amber border highlight)", () => {
    const bestValues = PLANS.filter((p) => p.badge === "Best Value");
    expect(bestValues.map((p) => p.id)).toEqual(["agency"]);
  });

  // 2026-08-02: Business now ships with white-label PDF and priority support
  // (previously Agency-only). This regression test pins the new parity so a
  // future refactor that quietly flips either flag back to false will fail
  // loudly in CI rather than surprise billing-support.
  it("Business ships with both white_label_pdf and priority_support (2026-08-02 parity)", () => {
    const biz = PLAN_BY_ID.business;
    expect(biz.limits.white_label_pdf, "Business must ship with white-label PDF").toBe(true);
    expect(biz.limits.priority_support, "Business must ship with priority support").toBe(true);
  });

  it("Agency still has both flags (parity with Business is additive, not subtractive)", () => {
    const agy = PLAN_BY_ID.agency;
    expect(agy.limits.white_label_pdf).toBe(true);
    expect(agy.limits.priority_support).toBe(true);
  });

  it("Free / Go / Select / Pro still do NOT ship with either flag", () => {
    for (const id of ["free", "go", "select", "pro"]) {
      expect(PLAN_BY_ID[id].limits.white_label_pdf, `${id} should not have white-label PDF`).toBe(false);
      expect(PLAN_BY_ID[id].limits.priority_support, `${id} should not have priority support`).toBe(false);
    }
  });
});

describe("workspace-addon (U-12: Extra Workspace inherits plan features)", () => {
  it("workspace-addon declares feature-parity flags so the entitlement model can honour them", () => {
    const ws = TOPUP_BUNDLES.find((b) => b.id === "workspace-addon");
    expect(ws).toBeDefined();
    expect(ws.inheritsParentPlanFeatures).toBe(true);
    expect(ws.cappedByParentTeamSeats).toBe(true);
  });
});

describe("TOPUP_BUNDLES (U-14)", () => {
  it("is non-empty; every bundle has id, name, price_usd, price_inr, and either a numeric bonus* or a feature description", () => {
    expect(TOPUP_BUNDLES.length).toBeGreaterThan(0);
    for (const b of TOPUP_BUNDLES) {
      expect(b.id, `bundle.id is required`).toBeTruthy();
      expect(b.name, `bundle.name is required`).toBeTruthy();
      expect(typeof b.price_usd, `${b.id}.price_usd must be a number`).toBe("number");
      expect(typeof b.price_inr, `${b.id}.price_inr must be a number`).toBe("number");
      // A bundle is well-formed if it grants something explicitly OR is
      // a "feature" top-up (e.g. Scheduled Monitor unlocks scheduling).
      // Feature top-ups have a `unit` field but no `bonus*` numeric.
      const explicitGrants =
        (b.bonusExtractions || 0) +
        (b.bonusBatchUrls || 0) +
        (b.bonusScheduledMonitors || 0) +
        (b.bonusWorkspaces || 0);
      const isFeatureTopup = !!b.unit && b.unit !== "per 100 extractions" && b.unit !== "per 50 URLs";
      expect(
        explicitGrants > 0 || isFeatureTopup,
        `${b.id} must grant something (numeric bonus* or feature unit)`,
      ).toBe(true);
    }
  });
});

describe("CURRENCIES + CURRENCY_META", () => {
  it("supports exactly USD + INR", () => {
    expect(CURRENCIES).toEqual(["USD", "INR"]);
    expect(Object.keys(CURRENCY_META).sort()).toEqual(["INR", "USD"]);
    expect(CURRENCY_META.USD.symbol).toBe("$");
    expect(CURRENCY_META.INR.symbol).toBe("₹");
  });
});
