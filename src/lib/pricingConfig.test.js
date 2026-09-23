import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_META,
  ENTERPRISE_PLAN,
  PLANS,
  PLAN_BY_ID,
  TOPUP_BUNDLES,
  CREDIT_PACKS,
  AGENCY_OVERAGE,
} from "./pricingConfig.js";

/**
 * U-12..14 — pricingConfig is the source of truth for the plan table.
 * Schema invariants here are what allow every other price-aware code
 * path to skip defensive checks (computeCharge, Pricing UI, payment
 * server). Breaking any of these is a release-blocker.
 */

const ALLOWED_LIMIT_KEYS = new Set([
  // 🔴 THE ONE AXIS EVERYTHING IS SOLD ON. 1 credit = one page fetch; every
  // other weight is a multiple of it (src/lib/credits/creditWeights.js).
  // `extractions` and `audits` below are now DESCRIPTIVE — three public
  // surfaces still print them — and are no longer what any gate reads.
  "credits",
  "extractions",
  // Separate from batch_max_urls since the 2026-09-23 repricing: Free gets a
  // 5-URL batch but NO bulk account list, which one shared key could not say.
  "bulk_list_max",
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
  // Discoverability audits carry their own monthly budget rather than debiting
  // extraction credits — an audit is several fetches, a PageSpeed lookup, a
  // citation sample and an AI call.
  "audits",
  // Push integrations (HubSpot, Notion, Airtable, Slack) — Select and up.
  "integrations",
  // Entitlement flag only — no shipping extension yet. Select and up.
  "browser_extension",
  // Fork a workflow template and edit its prompts. Go and up — Free can RUN
  // every template (that is PRD 1's activation path and is deliberately
  // ungated) but cannot rewrite one.
  "template_duplicate",
]);

const ALLOWED_EXPORT_FORMATS = new Set(["csv", "pdf", "markdown", "json", "jsonl"]);

/**
 * Every plan must declare an audit quota.
 *
 * The stronger half of the guard above. Registering the key only stops an
 * unknown one appearing; this stops a NEW plan shipping without one, which
 * would read as `undefined`, fall through `(L.audits || 0)` to zero, and deny
 * Discoverability to that plan's customers with a "not included in your plan"
 * message nobody wrote.
 */
const AUDIT_QUOTA_REQUIRED = true;

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
      // Every plan declares an audit quota. See AUDIT_QUOTA_REQUIRED.
      if (AUDIT_QUOTA_REQUIRED) {
        expect(typeof p.limits.audits, `plan ${p.id} is missing an audits limit`).toBe("number");
        expect(p.limits.audits, `plan ${p.id} has a negative audits limit`).toBeGreaterThanOrEqual(0);
      }

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

  it("Free's signup grant is the SERVER's, so no plan carries a trialCredit", () => {
    // R4's FR-Z-02 had the browser grant itself 25 extractions on signup. The
    // ledger grants FREE_GRANT once per account now (grant_period 'signup'), so
    // a surviving client-side grant would show a pool 25 larger than the one
    // the server will actually spend from.
    for (const p of PLANS) {
      expect(p.trialCredit, `${p.id} must not define trialCredit`).toBeUndefined();
    }
    expect(PLAN_BY_ID.free.limits.credits).toBeGreaterThan(0);
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
    // Export formats and email export are still identical between the two —
    // the split is in scheduled monitoring, integrations and the browser
    // extension, which are deliberately Select-and-up only (Go is a taster tier).
    expect(go.limits.exports).toEqual(select.limits.exports);
    expect(go.limits.email_export).toBe(select.limits.email_export);
    expect(go.limits.api_access).toBe(select.limits.api_access);
  });

  it("Go is excluded from scheduled monitoring, integrations and the browser extension; Select and up get all three", () => {
    const go = PLAN_BY_ID.go;
    for (const id of ["select", "pro", "business", "agency", "developer"]) {
      const plan = PLAN_BY_ID[id];
      expect(plan.limits.scheduled_monitoring, `${id} should have scheduled monitoring`).toBeGreaterThan(0);
      expect(plan.limits.integrations, `${id} should have integrations`).toBe(true);
      expect(plan.limits.browser_extension, `${id} should have the browser extension flag`).toBe(true);
    }
    expect(go.limits.scheduled_monitoring).toBe(0);
    expect(go.limits.integrations).toBe(false);
    expect(go.limits.browser_extension).toBe(false);
    expect(PLAN_BY_ID.free.limits.integrations).toBe(false);
    expect(PLAN_BY_ID.free.limits.browser_extension).toBe(false);
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

// ── §4.1 — the monthly pools, pinned ────────────────────────────────────────
// Moving one of these re-prices a plan. Pinning them means an "align the
// numbers" pass fails the build with the reasoning attached rather than
// silently changing what a customer gets, which is the same guard
// creditWeights.test.js puts on the price list itself.
describe("credit pools", () => {
  it("every plan carries one, and it is a positive integer", () => {
    for (const plan of PLANS) {
      expect(Number.isInteger(plan.limits.credits), `${plan.id}`).toBe(true);
      expect(plan.limits.credits, `${plan.id}`).toBeGreaterThan(0);
    }
  });

  it("holds the §4.1 table exactly", () => {
    expect(Object.fromEntries(PLANS.map((p) => [p.id, p.limits.credits]))).toEqual({
      free: 100, go: 750, select: 2500, pro: 6000,
      developer: 25000, business: 40000, agency: 100000,
    });
  });

  // 🔴 INR IS A SET PRICE ON EVERY PAID PLAN, NOT A CONVERSION — and the only
  // way to keep that true is to require it. `resolvePlanPrice` has no
  // conversion fallback any more, so a paid plan with no INR price would
  // resolve to 0 and render "₹0 / mo" on the card rather than failing loudly.
  it("every paid plan carries a set INR price, monthly and annual", () => {
    for (const p of PLANS.filter((x) => x.price_usd > 0)) {
      expect(p.price_inr, `${p.id}.price_inr`).toBeGreaterThan(0);
      expect(p.price_inr_annual, `${p.id}.price_inr_annual`).toBeGreaterThan(0);
      expect(p.price_usd_annual, `${p.id}.price_usd_annual`).toBeGreaterThan(0);
    }
  });

  // ⚠️ An annual rate at or above the monthly one would make the toggle a
  // penalty, and `annualSavingsPercent` — which derives the advertised badge —
  // would quietly report 0% rather than erroring.
  it("annual is cheaper per month than monthly, in both currencies", () => {
    for (const p of PLANS.filter((x) => x.price_usd > 0)) {
      expect(p.price_usd_annual, `${p.id} USD`).toBeLessThan(p.price_usd);
      expect(p.price_inr_annual, `${p.id} INR`).toBeLessThan(p.price_inr);
    }
  });

  // 🔴 A ladder where a bigger plan costs MORE per credit is not a ladder —
  // it makes upgrading worse value per unit, which is the opposite of what
  // the tiers are for.
  it("price per credit falls monotonically across the paid ladder", () => {
    const paid = ["go", "select", "pro", "developer", "business", "agency"]
      .map((id) => PLANS.find((p) => p.id === id))
      .map((p) => p.price_usd / p.limits.credits);
    for (let i = 1; i < paid.length; i++) {
      expect(paid[i], `step ${i}`).toBeLessThanOrEqual(paid[i - 1]);
    }
  });

  // ⚠️ Free reserves exactly one Discoverability run. A pool that could not
  // cover it would make the action that demonstrates the product the one a
  // free user cannot reach.
  it("Free's pool covers a Discoverability run with room left over", () => {
    const free = PLANS.find((p) => p.id === "free");
    expect(free.limits.credits).toBeGreaterThan(19);
  });
});

describe("top-ups sell capacity, never consumption", () => {
  // D15 — it sold pure consumption at 14x Go's plan rate.
  it("the Extractions Bundle is gone", () => {
    expect(TOPUP_BUNDLES.find((b) => b.id === "extractions-bundle")).toBeUndefined();
    expect(TOPUP_BUNDLES.some((b) => b.bonusExtractions)).toBe(false);
  });

  it("every remaining bundle is a structural cap, not spend", () => {
    expect(TOPUP_BUNDLES.map((b) => b.id).sort())
      .toEqual(["batch-pack", "scheduler-addon", "workspace-addon"]);
  });

  // D16 — the price is unchanged but it buys strictly less, so the copy must
  // say so or a customer reasonably expects the runs included.
  it("the Scheduled Monitor states that its runs cost credits", () => {
    const sched = TOPUP_BUNDLES.find((b) => b.id === "scheduler-addon");
    expect(sched.slotOnly).toBe(true);
    expect(sched.description).toMatch(/credit/i);
    expect(sched.price_usd).toBe(5);
  });
});

describe("credit packs", () => {
  it("ship the §4.4 table", () => {
    expect(CREDIT_PACKS.map((p) => [p.credits, p.price_usd]))
      .toEqual([[500, 5], [2000, 19], [10000, 89]]);
    expect(CREDIT_PACKS.map((p) => [p.credits, p.price_inr]))
      .toEqual([[500, 490], [2000, 1849], [10000, 11449]]);
  });

  // The packs must be worse value than any plan, or nobody upgrades.
  it("are more expensive per credit than every plan", () => {
    const worstPlanRate = Math.max(
      ...PLANS.filter((p) => p.price_usd > 0).map((p) => p.price_usd / p.limits.credits),
    );
    for (const pack of CREDIT_PACKS) {
      expect(pack.price_usd / pack.credits, pack.id).toBeGreaterThan(worstPlanRate);
    }
  });

  // ...but far cheaper than the bundle they replace ($0.09/credit).
  it("are dramatically cheaper per credit than the bundle they replace", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.price_usd / pack.credits, pack.id).toBeLessThan(0.09 / 2);
    }
  });

  it("get cheaper per credit as they get bigger", () => {
    const rates = CREDIT_PACKS.map((p) => p.price_usd / p.credits);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThan(rates[i - 1]);
  });
});

describe("Agency overage (D13)", () => {
  it("is quoted above the published fair-use pool", () => {
    const agency = PLANS.find((p) => p.id === "agency");
    expect(AGENCY_OVERAGE.fairUseCredits).toBe(agency.limits.credits);
    expect(AGENCY_OVERAGE.usdPer1000).toBe(2.0);
  });

  // 🔴 An agency has client deliverables. A hard stop mid-month damages THEIR
  // customer, not ours.
  it("never hard-stops mid-month", () => {
    expect(AGENCY_OVERAGE.hardStop).toBe(false);
    expect(AGENCY_OVERAGE.commitAtPct).toBeGreaterThan(AGENCY_OVERAGE.notifyAtPct);
  });

  // ~2x the committed rate: enough that the pool is worth committing to, far
  // below any top-up pack.
  it("prices overage above Agency's committed rate but below a pack", () => {
    const agency = PLANS.find((p) => p.id === "agency");
    const committed = agency.price_usd / agency.limits.credits;
    const overage = AGENCY_OVERAGE.usdPer1000 / 1000;
    // ⚠️ EQUAL IS ALLOWED, BELOW IS NOT, and the 2026-09-23 repricing made it
    // exactly equal: Agency is $200 for 100,000 credits, so its committed rate
    // is $0.002/credit and AGENCY_OVERAGE is $2.00/1,000 — the same number.
    // That is a coherent policy (past fair use you keep paying the plan's own
    // rate) and it is the pricing sheet's stated intent. What must never
    // happen is overage BELOW the committed rate, which would make overrunning
    // cheaper than the plan that grants the credits.
    expect(overage).toBeGreaterThanOrEqual(committed);
    expect(overage).toBeLessThan(Math.min(...CREDIT_PACKS.map((p) => p.price_usd / p.credits)));
  });
});
