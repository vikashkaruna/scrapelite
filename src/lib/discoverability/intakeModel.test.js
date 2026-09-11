import { describe, it, expect } from "vitest";
import {
  AUDIT_TYPES, AUDIT_TYPE_IDS, SELECTABLE_AUDIT_TYPE_IDS,
  PRIMARY_GOALS, PRIMARY_GOAL_IDS, AUDIT_PROFILE_SOURCE_IDS,
  MAX_COMPETITOR_URLS, normaliseGeography, normaliseCompetitorUrls,
  inferAuditProfile, resolveAuditProfile, intakeVocabulary,
} from "./intakeModel.js";
import { AUDIT_PROFILES, PROFILE_IDS } from "./auditProfiles.js";

describe("the vocabulary is a contract", () => {
  it("carries all five audit types the BRD names", () => {
    expect(AUDIT_TYPE_IDS).toEqual(
      expect.arrayContaining(["url", "domain", "benchmark", "prompt_monitor", "rerun"]));
  });

  it("offers a caller only the types the engine can actually produce", () => {
    // The point of the whole `available` flag: a row must never claim to be a
    // domain snapshot when one page was fetched.
    expect(SELECTABLE_AUDIT_TYPE_IDS).toEqual(["url"]);
    expect(AUDIT_TYPES.domain.available).toBe(false);
    // W6.5 turned prompt monitoring ON, and it is still not selectable here —
    // it is created at POST /monitors, exactly as `rerun` is created by the
    // rerun route. Available and caller-selectable are different questions.
    expect(AUDIT_TYPES.prompt_monitor.available).toBe(true);
    expect(AUDIT_TYPES.prompt_monitor.callerSelectable).toBe(false);
  });

  it("gives every unavailable type a reason a customer can read", () => {
    for (const id of AUDIT_TYPE_IDS) {
      if (!AUDIT_TYPES[id].available) {
        expect(AUDIT_TYPES[id].unavailableReason).toBeTruthy();
      }
    }
  });

  it("keeps benchmark and rerun off the caller-selectable list", () => {
    // Both are set by the route that creates their context. A rerun with no
    // baseline is a re-audit of nothing.
    expect(AUDIT_TYPES.benchmark.callerSelectable).toBe(false);
    expect(AUDIT_TYPES.rerun.callerSelectable).toBe(false);
  });

  it("carries all six primary goals", () => {
    expect(PRIMARY_GOAL_IDS).toHaveLength(6);
    expect(PRIMARY_GOAL_IDS).toEqual(expect.arrayContaining([
      "seo_health", "ai_citations", "product_discovery",
      "service_leads", "local_discovery", "competitor_intelligence",
    ]));
  });

  it("points every goal at a profile that exists", () => {
    // A goal whose suggested profile were misspelt would silently fall through
    // to `balanced` in resolveAuditProfile and nobody would ever see it.
    for (const id of PRIMARY_GOAL_IDS) {
      expect(PROFILE_IDS).toContain(PRIMARY_GOALS[id].suggestedProfile);
    }
  });

  it("scores a competitor set under a lens that favours nobody", () => {
    expect(PRIMARY_GOALS.competitor_intelligence.suggestedProfile).toBe("balanced");
  });

  it("declares exactly the four profile sources the column allows", () => {
    expect(AUDIT_PROFILE_SOURCE_IDS).toEqual(["explicit", "goal", "inferred", "default"]);
  });

  it("hands the composer everything it needs in one object", () => {
    const v = intakeVocabulary();
    expect(v.primary_goals).toBe(PRIMARY_GOALS);
    expect(v.max_competitor_urls).toBe(MAX_COMPETITOR_URLS);
  });
});

describe("normaliseGeography", () => {
  it("returns null rather than {} for an empty intake", () => {
    // Absence has exactly one shape. Two would mean every consumer needs two
    // checks and one of them eventually gets forgotten.
    expect(normaliseGeography(null)).toBeNull();
    expect(normaliseGeography({})).toBeNull();
    expect(normaliseGeography({ country: "  ", city: "" })).toBeNull();
  });

  it("refuses a non-object rather than coercing one", () => {
    expect(normaliseGeography("India")).toBeNull();
    expect(normaliseGeography(["IN"])).toBeNull();
  });

  it("upper-cases a two-letter country code", () => {
    expect(normaliseGeography({ country: "in" }).country).toBe("IN");
  });

  it("leaves a country NAME as typed rather than half-guessing a code", () => {
    // Mapping some spellings and not others would make the column silently
    // inconsistent across rows, which is worse for P2 than free text.
    expect(normaliseGeography({ country: "India" }).country).toBe("India");
  });

  it("normalises a BCP-47 tag so one language is not stored as three rows", () => {
    expect(normaliseGeography({ language: "en-in" }).language).toBe("en-IN");
    expect(normaliseGeography({ language: "EN_IN" }).language).toBe("en-IN");
    expect(normaliseGeography({ language: "EN" }).language).toBe("en");
  });

  it("accepts `state` as an alias for region", () => {
    expect(normaliseGeography({ state: "Karnataka" }).region).toBe("Karnataka");
  });

  it("fills the fields nobody supplied with null, not with absence", () => {
    const g = normaliseGeography({ city: "Bengaluru" });
    expect(g).toEqual({ country: null, region: null, city: "Bengaluru", language: null });
  });

  it("caps a field rather than storing unbounded text", () => {
    expect(normaliseGeography({ city: "x".repeat(500) }).city).toHaveLength(80);
  });
});

describe("normaliseCompetitorUrls", () => {
  it("accepts a bare domain the way the URL bar does", () => {
    expect(normaliseCompetitorUrls(["competitor.com"]).urls[0]).toBe("https://competitor.com/");
  });

  it("names what it rejected instead of silently dropping it", () => {
    // A customer who believes a competitor is tracked when it is not will read
    // the next report as though it covered them.
    const r = normaliseCompetitorUrls(["https://ok.com", "http://[bad", "ftp://files.com"]);
    expect(r.urls).toHaveLength(1);
    expect(r.rejected).toEqual(["http://[bad", "ftp://files.com"]);
  });

  it("reports the overflow rather than keeping the first ten quietly", () => {
    const many = Array.from({ length: 13 }, (_, i) => `https://c${i}.com`);
    const r = normaliseCompetitorUrls(many);
    expect(r.urls).toHaveLength(MAX_COMPETITOR_URLS);
    expect(r.rejected).toHaveLength(3);
  });

  it("treats two URLs differing only by fragment as one competitor", () => {
    const r = normaliseCompetitorUrls(["https://a.com/p#one", "https://a.com/p#two"]);
    expect(r.urls).toEqual(["https://a.com/p"]);
  });

  it("lower-cases the host so casing does not double-count", () => {
    expect(normaliseCompetitorUrls(["https://EXAMPLE.com/A"]).urls)
      .toEqual(["https://example.com/A"]);
  });

  it("returns empty for a non-array rather than throwing", () => {
    expect(normaliseCompetitorUrls("https://a.com")).toEqual({ urls: [], rejected: [] });
  });
});

describe("inferAuditProfile", () => {
  it("returns null when the page argues for no lens at all", () => {
    // Much better than reaching for a weak signal: `balanced` is then chosen
    // as the DEFAULT and the stored source says so.
    expect(inferAuditProfile({ pageType: "page", schemaTypes: ["WebPage"] })).toBeNull();
    expect(inferAuditProfile({})).toBeNull();
  });

  it("reads a LocalBusiness subtype as local without enumerating 200 of them", () => {
    expect(inferAuditProfile({ schemaTypes: ["Dentist"] })).toBe("local");
    expect(inferAuditProfile({ schemaTypes: ["Restaurant"] })).toBe("local");
    expect(inferAuditProfile({ schemaTypes: ["LocalBusiness"] })).toBe("local");
  });

  it("reads the obvious declarations", () => {
    expect(inferAuditProfile({ schemaTypes: ["SoftwareApplication"] })).toBe("saas");
    expect(inferAuditProfile({ schemaTypes: ["Service"] })).toBe("services");
    expect(inferAuditProfile({ schemaTypes: ["Product"] })).toBe("ecommerce");
  });

  it("weighs schema above page type when the two disagree", () => {
    // Schema is the page asserting what it is; a page type is our reading of it.
    expect(inferAuditProfile({ pageType: "product", schemaTypes: ["LocalBusiness"] })).toBe("local");
  });

  it("falls back to the page type when nothing is declared", () => {
    expect(inferAuditProfile({ pageType: "location", schemaTypes: [] })).toBe("local");
    expect(inferAuditProfile({ pageType: "service", schemaTypes: [] })).toBe("services");
    expect(inferAuditProfile({ pageType: "docs", schemaTypes: [] })).toBe("saas");
  });

  it("only ever names a profile that exists", () => {
    const guesses = [
      inferAuditProfile({ schemaTypes: ["Dentist"] }),
      inferAuditProfile({ schemaTypes: ["SoftwareApplication"] }),
      inferAuditProfile({ schemaTypes: ["Service"] }),
      inferAuditProfile({ schemaTypes: ["Product"] }),
      inferAuditProfile({ pageType: "docs" }),
    ];
    for (const g of guesses) expect(AUDIT_PROFILES[g]).toBeTruthy();
  });
});

describe("resolveAuditProfile — and why it records its reason", () => {
  it("lets an explicit choice beat everything", () => {
    expect(resolveAuditProfile({
      requested: "seo", primaryGoal: "local_discovery",
      pageType: "location", schemaTypes: ["LocalBusiness"],
    })).toEqual({ profile: "seo", source: "explicit" });
  });

  it("lets a deliberate choice of the NEUTRAL lens survive inference", () => {
    // The trap this guards: "balanced" looks like a default, so a resolver that
    // treated it as one would quietly re-lens a competitive comparison.
    expect(resolveAuditProfile({
      requested: "balanced", schemaTypes: ["Product"],
    })).toEqual({ profile: "balanced", source: "explicit" });
  });

  it("prefers a stated goal over what the markup says", () => {
    // The customer told us their intent in words; the schema is our reading of
    // markup they may not control and may be trying to fix.
    expect(resolveAuditProfile({
      primaryGoal: "local_discovery", schemaTypes: ["SoftwareApplication"],
    })).toEqual({ profile: "local", source: "goal" });
  });

  it("reads the page when nobody said anything", () => {
    expect(resolveAuditProfile({ schemaTypes: ["Product"] }))
      .toEqual({ profile: "ecommerce", source: "inferred" });
  });

  it("falls back to balanced and SAYS it fell back", () => {
    expect(resolveAuditProfile({})).toEqual({ profile: "balanced", source: "default" });
  });

  it("ignores an unknown profile and an unknown goal rather than trusting them", () => {
    expect(resolveAuditProfile({ requested: "vibes" }).source).toBe("default");
    expect(resolveAuditProfile({ primaryGoal: "world_domination" }).source).toBe("default");
  });

  it("only ever returns a source the CHECK constraint allows", () => {
    const cases = [
      {}, { requested: "geo" }, { primaryGoal: "seo_health" }, { schemaTypes: ["Service"] },
    ];
    for (const c of cases) {
      expect(AUDIT_PROFILE_SOURCE_IDS).toContain(resolveAuditProfile(c).source);
    }
  });
});
