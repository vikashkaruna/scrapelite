import { describe, it, expect } from "vitest";
import {
  CITATION_STATES, CITATION_STATE_IDS, citationState,
  readsAsRecommendation, classifyCitation, aggregateStates,
} from "./citationStates.js";
import {
  bareHost, rootHost, isNonCompetitorHost, competitorsInAnswer, shareOfVoice,
} from "./competitorTracking.js";

describe("the seven states", () => {
  it("are exactly the ones the PRD names", () => {
    expect([...CITATION_STATE_IDS].sort()).toEqual([
      "absent", "cited", "cited_and_recommended", "competitor_dominated",
      "mentioned", "misrepresented", "recommended",
    ].sort());
  });

  it("rank misrepresentation first, because its fix is different from every other", () => {
    // "Correct the record" rather than "publish more". A confident wrong claim
    // about you travels further than an absence does.
    expect(CITATION_STATE_IDS[0]).toBe("misrepresented");
    expect(CITATION_STATES.misrepresented.favourable).toBe(false);
  });

  it("separate 'we are invisible' from 'we are visible and losing'", () => {
    expect(CITATION_STATES.absent.present).toBe(false);
    expect(CITATION_STATES.competitor_dominated.present).toBe(false);
    expect(CITATION_STATES.absent.fix).not.toBe(CITATION_STATES.competitor_dominated.fix);
  });

  it("give every state a fix, since a state with no action is a label", () => {
    for (const id of CITATION_STATE_IDS) {
      expect(CITATION_STATES[id].fix, id).toBeTruthy();
      expect(CITATION_STATES[id].describes.length, id).toBeGreaterThan(30);
    }
  });

  it("returns null for an unknown state", () => {
    expect(citationState("invented")).toBeNull();
  });
});

describe("readsAsRecommendation", () => {
  it("🔴 is false on a non-commercial prompt whatever the wording", () => {
    // "DatIQ is the best tool for X" answering "what is DatIQ" is the engine
    // repeating a product's own claim, not recommending it.
    expect(readsAsRecommendation("DatIQ is the best tool for scraping.", "DatIQ", { commercial: false })).toBe(false);
  });

  it("is true when a commercial answer advocates for the brand", () => {
    expect(readsAsRecommendation("I would recommend DatIQ for this.", "DatIQ", { commercial: true })).toBe(true);
    expect(readsAsRecommendation("DatIQ is the best choice here.", "DatIQ", { commercial: true })).toBe(true);
  });

  it("🔴 does not credit us for advocacy aimed at somebody else", () => {
    // The advocacy language and our name are both present, in different
    // sentences about different products.
    const text = "I would recommend Clay for this. DatIQ also exists.";
    expect(readsAsRecommendation(text, "DatIQ", { commercial: true })).toBe(false);
    expect(readsAsRecommendation(text, "Clay", { commercial: true })).toBe(true);
  });

  it("is false when the brand is not named at all", () => {
    expect(readsAsRecommendation("I recommend Clay.", "DatIQ", { commercial: true })).toBe(false);
  });
});

describe("classifyCitation", () => {
  it("resolves every combination to exactly one state", () => {
    expect(classifyCitation({})).toBe("absent");
    expect(classifyCitation({ mentioned: true })).toBe("mentioned");
    expect(classifyCitation({ cited: true })).toBe("cited");
    expect(classifyCitation({ mentioned: true, commercial: true, recommended: true })).toBe("recommended");
    expect(classifyCitation({ cited: true, commercial: true, recommended: true })).toBe("cited_and_recommended");
  });

  it("🔴 cannot misrepresent a brand it never named", () => {
    // An engine that never mentioned us has said nothing false about us,
    // whatever else it got wrong.
    expect(classifyCitation({ mentioned: false, misrepresented: true })).toBe("absent");
    expect(classifyCitation({ mentioned: true, misrepresented: true })).toBe("misrepresented");
  });

  it("misrepresentation outranks even a citation", () => {
    expect(classifyCitation({ mentioned: true, cited: true, misrepresented: true })).toBe("misrepresented");
  });

  it("calls an absence with rivals present what it is", () => {
    expect(classifyCitation({ competitorsPresent: 2 })).toBe("competitor_dominated");
    expect(classifyCitation({ mentioned: true, competitorsPresent: 2 })).toBe("mentioned");
  });

  it("🔴 ignores recommendation wording on a non-commercial prompt", () => {
    expect(classifyCitation({ mentioned: true, recommended: true, commercial: false })).toBe("mentioned");
  });
});

describe("aggregateStates", () => {
  const run = (state, commercial = false) => ({ state, commercial });

  it("🔴 measures RecommendationRate over commercial prompts only", () => {
    // Including "what is X" would dilute the rate with questions that were
    // never a contest.
    const runs = [
      run("recommended", true), run("mentioned", true),
      run("mentioned"), run("mentioned"), run("mentioned"),
    ];
    const a = aggregateStates(runs);
    expect(a.commercialTotal).toBe(2);
    expect(a.recommendationRate).toBe(50);   // 1 of 2 commercial, not 1 of 5
    expect(a.mentionRate).toBe(100);
  });

  it("🔴 returns null, never zero, when nothing commercial was asked", () => {
    const a = aggregateStates([run("mentioned"), run("absent")]);
    expect(a.commercialTotal).toBe(0);
    expect(a.recommendationRate).toBeNull();
  });

  it("returns nulls for an empty or all-failed set", () => {
    expect(aggregateStates([]).mentionRate).toBeNull();
    expect(aggregateStates([{ error: "boom" }]).mentionRate).toBeNull();
  });

  it("counts a citation only where the domain was actually sourced", () => {
    const a = aggregateStates([run("cited"), run("cited_and_recommended", true), run("mentioned")]);
    expect(a.citationRate).toBeCloseTo(66.7, 1);
  });
});

describe("host handling", () => {
  it("gives one host one spelling", () => {
    expect(bareHost("https://WWW.Clay.com/pricing")).toBe("clay.com");
    expect(bareHost("clay.com/x")).toBe("clay.com");
    expect(bareHost("")).toBeNull();
  });

  it("treats a subdomain as the same rival", () => {
    expect(rootHost("docs.acme.com")).toBe("acme.com");
    expect(rootHost("acme.com")).toBe("acme.com");
  });

  it("handles two-part public suffixes", () => {
    expect(rootHost("shop.acme.co.uk")).toBe("acme.co.uk");
  });

  it("knows reference infrastructure is not a rival", () => {
    expect(isNonCompetitorHost("en.wikipedia.org")).toBe(true);
    expect(isNonCompetitorHost("reddit.com")).toBe(true);
    expect(isNonCompetitorHost("clay.com")).toBe(false);
  });
});

describe("competitorsInAnswer", () => {
  const cites = (...u) => u.map((url) => ({ url }));

  it("marks a declared rival as measured, and an unknown one as inferred", () => {
    const out = competitorsInAnswer({
      citations: cites("https://clay.com/a", "https://someone-else.com/b"),
      ourHost: "datiq.app",
      declared: ["https://clay.com"],
    });
    const clay = out.find((c) => c.host === "clay.com");
    const other = out.find((c) => c.host === "someone-else.com");
    expect(clay.declared).toBe(true);
    expect(clay.confidence).toBe(100);
    expect(other.declared).toBe(false);
    expect(other.confidence).toBeLessThan(60);
  });

  it("never reports our own domain as a competitor", () => {
    const out = competitorsInAnswer({ citations: cites("https://datiq.app/x"), ourHost: "datiq.app" });
    expect(out).toEqual([]);
  });

  it("🔴 drops reference sites rather than calling them rivals", () => {
    const out = competitorsInAnswer({
      citations: cites("https://en.wikipedia.org/wiki/X", "https://reddit.com/r/y"),
      ourHost: "datiq.app",
    });
    expect(out).toEqual([]);
  });

  it("⚠️ but honours the operator's judgement over our heuristic", () => {
    // If somebody declares a reference site as a competitor, they know their
    // market better than a hardcoded list does.
    const out = competitorsInAnswer({
      citations: cites("https://g2.com/x"), ourHost: "datiq.app", declared: ["https://g2.com"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].declared).toBe(true);
  });

  it("counts repeat citations of one rival once, with a tally", () => {
    const out = competitorsInAnswer({
      citations: cites("https://clay.com/a", "https://docs.clay.com/b"), ourHost: "datiq.app",
    });
    expect(out).toHaveLength(1);
    expect(out[0].citations).toBe(2);
  });
});

describe("shareOfVoice", () => {
  const r = (over = {}) => ({ mention: false, cited: false, competitors: [], ...over });
  const declared = (host) => ({ host, declared: true, confidence: 100, citations: 1 });
  const found = (host) => ({ host, declared: false, confidence: 45, citations: 1 });

  it("🔴 reports declared and observed share separately, never summed", () => {
    // The declared field is fixed and defensible; the observed one moves with
    // whatever the engine happened to cite. A single blended number would be
    // quoted as the first and computed as the second.
    const runs = [
      r({ mention: true, competitors: [declared("clay.com")] }),
      r({ competitors: [declared("clay.com"), found("random.com")] }),
    ];
    const sov = shareOfVoice(runs, { ourHost: "datiq.app" });
    expect(sov.sovDeclared).toBeCloseTo(33.3, 1);   // 1 of (1 + 2)
    expect(sov.sovObserved).toBe(25);               // 1 of (1 + 3)
    expect(sov.sovDeclared).not.toBe(sov.sovObserved);
  });

  it("ranks rivals by how often they appeared", () => {
    const runs = [
      r({ competitors: [declared("clay.com")] }),
      r({ competitors: [declared("clay.com"), declared("apify.com")] }),
    ];
    const sov = shareOfVoice(runs, { ourHost: "datiq.app" });
    expect(sov.declaredCompetitors[0]).toEqual({ host: "clay.com", appearances: 2 });
  });

  it("🔴 is null, not zero, when no answer cited anyone", () => {
    // "No answer cited anyone" and "we hold none of the share" are opposite
    // findings and must not render as the same number.
    const sov = shareOfVoice([r(), r()], { ourHost: "datiq.app" });
    expect(sov.sovDeclared).toBeNull();
    expect(sov.sovObserved).toBeNull();
  });

  it("ignores failed runs", () => {
    const sov = shareOfVoice([{ error: "boom" }], { ourHost: "datiq.app" });
    expect(sov.answeredRuns).toBe(0);
  });
});
