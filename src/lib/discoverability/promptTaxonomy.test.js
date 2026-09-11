import { describe, it, expect } from "vitest";
import {
  PROMPT_KINDS, PROMPT_KIND_IDS, COMMERCIAL_KIND_IDS, MAX_GENERATED_PROMPTS,
  promptKind, isCommercialKind, placeFrom, competitorName,
  generatePrompts, describeDimensions, classifyPromptKind,
} from "./promptTaxonomy.js";

describe("the taxonomy", () => {
  it("has exactly the seven kinds the PRD names", () => {
    expect([...PROMPT_KIND_IDS].sort()).toEqual(
      ["brand", "buyer_problem", "category", "comparison", "industry", "local", "trust"].sort(),
    );
  });

  it("leads with the kinds that need no declaration", () => {
    // An audit samples the first N, so a kind placed low is one a small sample
    // never asks. Category and buyer problem apply to every subject.
    expect(PROMPT_KIND_IDS.slice(0, 2)).toEqual(["category", "buyer_problem"]);
  });

  it("puts the declaration-gated kinds last", () => {
    expect(PROMPT_KIND_IDS.slice(-2)).toEqual(["industry", "local"]);
  });

  it("separates advocacy from recall", () => {
    // Being named in "best tools for X" is a recommendation; being named in
    // "what is X" is recall. RecommendationRate is only meaningful over the first.
    expect(isCommercialKind("category")).toBe(true);
    expect(isCommercialKind("comparison")).toBe(true);
    expect(isCommercialKind("brand")).toBe(false);
    expect(isCommercialKind("trust")).toBe(false);
    expect(COMMERCIAL_KIND_IDS).not.toContain("brand");
  });

  it("returns null for an unknown kind", () => {
    expect(promptKind("invented")).toBeNull();
  });
});

describe("placeFrom", () => {
  it("prefers the most specific place available", () => {
    expect(placeFrom({ city: "Bengaluru", region: "Karnataka" })).toBe("Bengaluru, Karnataka");
    expect(placeFrom({ city: "Bengaluru" })).toBe("Bengaluru");
    expect(placeFrom({ region: "Karnataka" })).toBe("Karnataka");
  });

  it("🔴 refuses to treat a country as a local query", () => {
    // "Plumbers in India" is a national query wearing a local query's clothes.
    // Asking it and reporting the answer as local visibility would describe a
    // reach the business never had.
    expect(placeFrom({ country: "IN" })).toBeNull();
    expect(placeFrom({ country: "IN", language: "en-IN" })).toBeNull();
  });

  it("is null for nothing", () => {
    expect(placeFrom(null)).toBeNull();
    expect(placeFrom({})).toBeNull();
  });
});

describe("competitorName", () => {
  it("reads a usable name from a declared url", () => {
    expect(competitorName("https://www.clay.com/pricing")).toBe("clay");
    expect(competitorName("https://browse.ai")).toBe("browse");
  });
  it("keeps something usable from an unparseable entry", () => {
    expect(competitorName("apify.com")).toBe("apify.com");
    expect(competitorName("")).toBeNull();
  });
});

describe("generatePrompts", () => {
  it("🔴 asks nothing when neither subject nor brand was observed", () => {
    // A generic "what is this website" is not a measurement of anything.
    expect(generatePrompts({})).toEqual([]);
    expect(generatePrompts({ geography: { city: "Pune" } })).toEqual([]);
  });

  it("covers the undeclared kinds from a subject and a brand alone", () => {
    const p = generatePrompts({ subject: "web scraping", brand: "DatIQ" });
    const kinds = new Set(p.map((x) => x.kind));
    expect(kinds).toContain("category");
    expect(kinds).toContain("buyer_problem");
    expect(kinds).toContain("comparison");
    expect(kinds).toContain("brand");
    expect(kinds).toContain("trust");
  });

  it("🔴 asks no local prompt when no place was declared", () => {
    const p = generatePrompts({ subject: "plumbing", brand: "Acme" });
    expect(p.some((x) => x.kind === "local")).toBe(false);
  });

  it("asks a local prompt once a city is declared", () => {
    const p = generatePrompts({ subject: "plumbing", brand: "Acme", geography: { city: "Pune" } });
    const local = p.filter((x) => x.kind === "local");
    expect(local.length).toBeGreaterThan(0);
    expect(local[0].prompt).toContain("Pune");
  });

  it("🔴 asks no industry prompt when no sector was declared", () => {
    expect(generatePrompts({ subject: "billing", brand: "Acme" }).some((x) => x.kind === "industry")).toBe(false);
  });

  it("names declared competitors head to head, and asks for alternatives otherwise", () => {
    const withRivals = generatePrompts({
      subject: "enrichment", brand: "DatIQ", competitors: ["https://clay.com", "https://apify.com"],
    });
    const cmp = withRivals.filter((x) => x.kind === "comparison").map((x) => x.prompt);
    expect(cmp.some((t) => t.includes("clay"))).toBe(true);
    expect(cmp.some((t) => t.includes("apify"))).toBe(true);

    const none = generatePrompts({ subject: "enrichment", brand: "DatIQ" });
    expect(none.filter((x) => x.kind === "comparison")[0].prompt).toMatch(/alternatives to DatIQ/);
  });

  it("carries commercial intent by construction, not by guessing", () => {
    const p = generatePrompts({ subject: "web scraping", brand: "DatIQ" });
    for (const x of p) expect(x.commercial).toBe(PROMPT_KINDS[x.kind].commercial);
    expect(p.some((x) => x.commercial)).toBe(true);
    expect(p.some((x) => !x.commercial)).toBe(true);
  });

  it("is deterministic — two runs of a stored set must stay comparable", () => {
    const args = { subject: "web scraping", brand: "DatIQ", geography: { city: "Pune" } };
    expect(generatePrompts(args)).toEqual(generatePrompts(args));
  });

  it("emits no duplicate prompt text", () => {
    const p = generatePrompts({ subject: "DatIQ", brand: "DatIQ" });
    expect(new Set(p.map((x) => x.prompt)).size).toBe(p.length);
  });

  it("honours a limit, and never exceeds the hard cap", () => {
    expect(generatePrompts({ subject: "x", brand: "y", limit: 3 })).toHaveLength(3);
    expect(generatePrompts({
      subject: "x", brand: "y",
      competitors: Array.from({ length: 10 }, (_, i) => `https://c${i}.com`),
      industries: Array.from({ length: 10 }, (_, i) => `sector ${i}`),
      geography: { city: "Pune" }, limit: 999,
    }).length).toBeLessThanOrEqual(MAX_GENERATED_PROMPTS);
  });
});

describe("describeDimensions", () => {
  it("reports what was available, so a thin set can explain itself", () => {
    const d = describeDimensions({ subject: "x", competitors: ["https://a.com"], geography: { country: "IN" } });
    expect(d).toEqual({ subject: true, brand: false, competitors: 1, place: null, industries: 0 });
  });
});

describe("classifyPromptKind", () => {
  it("recognises the shapes a person actually types", () => {
    expect(classifyPromptKind("DatIQ vs Clay").kind).toBe("comparison");
    expect(classifyPromptKind("best scraping tools").kind).toBe("category");
    expect(classifyPromptKind("how do i scrape a site").kind).toBe("buyer_problem");
    expect(classifyPromptKind("plumbers near me").kind).toBe("local");
    expect(classifyPromptKind("is DatIQ trustworthy").kind).toBe("trust");
  });

  it("⚠️ reports LOW confidence when it had to fall back", () => {
    // A guessed intent should be read more cautiously than a declared one, the
    // same way a signal carries coverage.
    const guess = classifyPromptKind("What is DatIQ?");
    expect(guess.kind).toBe("brand");
    expect(guess.confidence).toBeLessThan(50);

    const matched = classifyPromptKind("best scraping tools");
    expect(matched.confidence).toBeGreaterThan(50);
  });

  it("has no opinion about an empty prompt", () => {
    expect(classifyPromptKind("")).toEqual({ kind: null, commercial: false, confidence: 0 });
  });
});
