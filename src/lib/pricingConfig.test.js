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

  it("PLANS contains the 6 priced plans (Free / Select / Pro / Business / Agency / Developer); Enterprise is rendered separately via ENTERPRISE_PLAN", () => {
    // Enterprise is its own object (ENTERPRISE_PLAN) — the "7th plan"
    // in the spec is Enterprise + 6 PLANS = 7 total, but Enterprise is
    // excluded from PLANS because it has no published price.
    expect(PLANS.length).toBe(6);
    const ids = PLANS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["free", "select", "pro", "business", "agency", "developer"]),
    );
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
