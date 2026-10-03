import { describe, it, expect } from "vitest";
import {
  CREDIT_WEIGHTS, DISCOVERABILITY_BASE, DEFAULT_CITATION_PROMPTS,
  FREE_GRANT, FREE_DISCOVERABILITY_RESERVE, AGENCY_FAIR_USE,
  discoverabilityCredits, aiCredits, creditsFor, KIND_TO_REASON, KIND_TO_UNIT,
} from "./creditWeights.js";
import { LEDGER_REASONS, LEDGER_UNITS } from "./creditModel.js";

// ── EVERY WEIGHT IS ASSERTED, ON PURPOSE ────────────────────────────────────
// Moving one of these re-prices every plan at once. Pinning them means an
// "align the numbers" pass fails the build with the reasoning attached rather
// than silently re-pricing the product, which is the same guard
// scoringModel.test.js puts on the penalty model.
describe("the price list is pinned, not assumed", () => {
  it("holds the §1 table exactly", () => {
    expect(CREDIT_WEIGHTS).toEqual({
      page_fetch: 1,
      pagespeed: 1,
      ai_fast: 2,
      ai_deep: 5,
      enrichment: 3,
      monitor_page: 1,
      monitor_prompt: 2,
      bulk_row: 3,
      citation_prompt_extra: 2,
      outreach_email: 1,
    });
  });

  it("anchors everything on one page fetch", () => {
    expect(CREDIT_WEIGHTS.page_fetch).toBe(1);
  });
});

describe("a Discoverability run", () => {
  it("costs 19 at the default prompt set", () => {
    expect(DISCOVERABILITY_BASE).toBe(19);
    expect(discoverabilityCredits()).toBe(19);
    expect(discoverabilityCredits(DEFAULT_CITATION_PROMPTS)).toBe(19);
  });

  // The surcharge is what stops the most expensive run being the cheapest per
  // unit of work.
  it("costs 29 at the ten-prompt ceiling", () => {
    expect(discoverabilityCredits(10)).toBe(29);
  });

  it("does not go BELOW the base when fewer prompts are asked", () => {
    // Fewer prompts is a cheaper run, but the base already covers five and
    // the arithmetic must not turn a short run into a discount on the fetches.
    expect(discoverabilityCredits(2)).toBe(19);
    expect(discoverabilityCredits(0)).toBe(19);
  });

  it("survives nonsense rather than returning NaN into a ledger row", () => {
    expect(discoverabilityCredits(NaN)).toBe(19);
    expect(discoverabilityCredits(-4)).toBe(19);
    expect(discoverabilityCredits("seven")).toBe(19);
  });
});

// 🔴 The one action that demonstrates the product must work for a user who
// spent their pool on extractions first. A reserve that lags the weight is how
// that stops being true, silently.
describe("Free's reservation tracks the weight it reserves for", () => {
  it("reserves exactly one Discoverability run", () => {
    expect(FREE_DISCOVERABILITY_RESERVE).toBe(DISCOVERABILITY_BASE);
  });

  it("leaves a usable pool behind the reservation", () => {
    expect(FREE_GRANT).toBe(500);
    expect(FREE_GRANT - FREE_DISCOVERABILITY_RESERVE).toBeGreaterThan(50);
  });
});

describe("creditsFor", () => {
  it("multiplies by quantity", () => {
    expect(creditsFor("page_fetch", 7)).toEqual({ credits: 7, known: true, kind: "page_fetch" });
    expect(creditsFor("ai_deep", 2).credits).toBe(10);
  });

  // ⚠️ An unpriced kind must never be guessed at. Inventing a price bills a
  // customer for a number nobody decided; the parity test is what catches the
  // omission, and this is what stops a fallback hiding it.
  it("reports an unknown kind rather than inventing a price", () => {
    expect(creditsFor("teleportation")).toEqual({ credits: 0, known: false, kind: "teleportation" });
  });

  it("floors and clamps a nonsense quantity instead of charging NaN", () => {
    expect(creditsFor("page_fetch", -3).credits).toBe(0);
    expect(creditsFor("page_fetch", 2.9).credits).toBe(2);
    expect(creditsFor("page_fetch", NaN).credits).toBe(1);
  });
});

describe("aiCredits", () => {
  it("charges the deep tier more", () => {
    expect(aiCredits("deep")).toBe(5);
    expect(aiCredits("fast")).toBe(2);
  });

  // An unrecognised tier must not be the expensive one by accident.
  it("treats an unknown tier as fast", () => {
    expect(aiCredits("turbo")).toBe(2);
    expect(aiCredits()).toBe(2);
  });
});

// 🔴 A kind that maps to a reason the CHECK constraint refuses writes nothing
// and the charge is lost silently — the ledger call fails, the run succeeds,
// and nobody is billed. Derived from creditModel's own vocabulary so a new
// reason cannot be added here without existing in the schema.
describe("every kind maps onto the schema's own vocabulary", () => {
  it("maps every weight to a legal ledger reason", () => {
    for (const kind of Object.keys(CREDIT_WEIGHTS)) {
      expect(KIND_TO_REASON[kind], `${kind} has no reason`).toBeTruthy();
      expect(LEDGER_REASONS).toContain(KIND_TO_REASON[kind]);
    }
  });

  it("maps every weight to a legal ledger unit", () => {
    for (const kind of Object.keys(CREDIT_WEIGHTS)) {
      expect(KIND_TO_UNIT[kind], `${kind} has no unit`).toBeTruthy();
      expect(LEDGER_UNITS).toContain(KIND_TO_UNIT[kind]);
    }
  });

  it("maps the composite Discoverability kind too", () => {
    expect(LEDGER_REASONS).toContain(KIND_TO_REASON.discoverability);
    expect(LEDGER_UNITS).toContain(KIND_TO_UNIT.discoverability);
  });
});

describe("Agency fair use", () => {
  it("is the number the overage is quoted above", () => {
    expect(AGENCY_FAIR_USE).toBe(100_000);
  });
});
