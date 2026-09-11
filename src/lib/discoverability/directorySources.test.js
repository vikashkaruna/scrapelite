import { describe, it, expect } from "vitest";
import {
  SOURCE_TIERS, TIER_IDS, ACQUISITION, ACQUISITION_IDS,
  DIRECTORY_SOURCES, SOURCE_BY_ID, SOURCE_IDS,
  weightOf, sourcesForRegion, sourcesForVertical, coverageClaim, unlockAction,
} from "./directorySources.js";

describe("the tier model", () => {
  it("declares exactly five tiers, ranked 1-5", () => {
    expect(TIER_IDS).toHaveLength(5);
    expect(TIER_IDS.map((t) => SOURCE_TIERS[t].rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("weights descend with rank, so tier 1 always outweighs tier 5", () => {
    const w = TIER_IDS.map((t) => SOURCE_TIERS[t].weight);
    for (let i = 1; i < w.length; i += 1) expect(w[i]).toBeLessThan(w[i - 1]);
  });

  it("🔴 ranks a registry BELOW a major aggregator — reach, not trust", () => {
    // A statutory filing is the most trustworthy record a business has and one
    // of the least read. Ranking by trust would send a customer to amend an MCA
    // filing while their Google profile stays wrong.
    expect(SOURCE_TIERS.registry.weight).toBeLessThan(SOURCE_TIERS.major_aggregator.weight);
  });
});

describe("the registry", () => {
  it("has no duplicate source ids — they are a public contract", () => {
    expect(new Set(SOURCE_IDS).size).toBe(SOURCE_IDS.length);
  });

  it("every source names a real tier and a real acquisition mode", () => {
    for (const s of DIRECTORY_SOURCES) {
      expect(TIER_IDS, s.id).toContain(s.tier);
      expect(ACQUISITION_IDS, s.id).toContain(s.acquisition);
    }
  });

  it("every source declares which NAP fields it publishes", () => {
    // A source that never shows a phone number cannot contradict one, and
    // counting it as a mismatch manufactures a finding from the source's format.
    for (const s of DIRECTORY_SOURCES) {
      expect(s.publishes.length, s.id).toBeGreaterThan(0);
    }
  });

  it("carries at least one source in every tier, so no tier is a dead branch", () => {
    for (const t of TIER_IDS) {
      expect(DIRECTORY_SOURCES.some((s) => s.tier === t), t).toBe(true);
    }
  });

  it("weightOf reads the tier weight, and is 0 for an unknown source", () => {
    expect(weightOf("google_business_profile")).toBe(SOURCE_TIERS.authoritative.weight);
    expect(weightOf("nope")).toBe(0);
  });
});

describe("region and vertical filters", () => {
  it("an IN pack includes the Indian aggregators AND the global sources", () => {
    const ids = sourcesForRegion("IN").map((s) => s.id);
    expect(ids).toContain("justdial");
    expect(ids).toContain("google_business_profile");
  });

  it("a region with no local pack still gets the global sources", () => {
    const ids = sourcesForRegion("DE").map((s) => s.id);
    expect(ids).toContain("google_business_profile");
    expect(ids).not.toContain("justdial");
  });

  it("a source with no declared vertical applies to every vertical", () => {
    const ids = sourcesForVertical("healthcare").map((s) => s.id);
    expect(ids).toContain("practo");
    expect(ids).toContain("google_business_profile");
    expect(ids).not.toContain("zomato");
  });
});

describe("coverageClaim — the one place the coverage sentence is built", () => {
  it("says what is CONFIGURED and what was CHECKED, separately", () => {
    const s = coverageClaim({ checked: 4 });
    expect(s).toMatch(/4 of \d+ sources/);
    expect(s).toMatch(/depends on what you authorise/i);
  });

  it("does not claim a check happened when none did", () => {
    expect(coverageClaim({ checked: 0 })).toMatch(/None checked yet/);
  });

  it("🔴 NEVER produces a flat 'N directories audited' claim", () => {
    // D5's copy rule. That sentence is false for every customer who has
    // authorised nothing, and it is the same over-claim this repo has already
    // had to strip off live pages twice.
    for (const checked of [0, 1, 9, 18]) {
      for (const region of [null, "IN"]) {
        const s = coverageClaim({ checked, region });
        expect(s, `${checked}/${region}`).not.toMatch(/directories audited/i);
        expect(s, `${checked}/${region}`).not.toMatch(/\d+\+\s*(directories|sources)/i);
      }
    }
  });
});

describe("unlockAction", () => {
  it("asks for a connection on an authorised-API source", () => {
    expect(unlockAction("google_business_profile")).toMatchObject({ action: "connect" });
  });

  it("asks for a URL on a declared-listing source", () => {
    expect(unlockAction("bing_places")).toMatchObject({ action: "declare_url" });
  });

  it("asks for nothing on a public listing — that one needs no customer action", () => {
    expect(unlockAction("justdial")).toBeNull();
  });

  it("returns null for an unknown source rather than inventing an action", () => {
    expect(unlockAction("nope")).toBeNull();
  });
});
