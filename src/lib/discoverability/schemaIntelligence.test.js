import { describe, it, expect } from "vitest";
import {
  SCHEMA_COMPONENTS, SCHEMA_COMPONENT_IDS, APPROVED_TYPES, EXCLUDED_TYPES,
  applicableTypes, validateBlock, schemaScore, scoreFidelity, scoreLinkage, schemaGaps,
} from "./schemaIntelligence.js";

const org = (extra = {}) => ({ "@type": "Organization", name: "Acme", url: "https://acme.com", ...extra });

describe("Schema weights are the PRD's, verbatim", () => {
  it.each([
    ["entity_object", "O", 0.30],
    ["lint_validity", "L", 0.30],
    ["type_spread", "S", 0.20],
    ["fidelity", "F", 0.10],
    ["graph_linkage", "G", 0.10],
  ])("%s (%s) weighs %f", (id, abbr, weight) => {
    expect(SCHEMA_COMPONENTS[id].weight).toBe(weight);
    expect(SCHEMA_COMPONENTS[id].abbr).toBe(abbr);
  });

  it("and they sum to 1", () => {
    const total = SCHEMA_COMPONENT_IDS.reduce((a, id) => a + SCHEMA_COMPONENTS[id].weight, 0);
    expect(Math.round(total * 100) / 100).toBe(1);
  });

  it("every component records that its NAME is derived and names what it binds to", () => {
    for (const id of SCHEMA_COMPONENT_IDS) {
      expect(SCHEMA_COMPONENTS[id].derivedFrom).toMatch(/weight verbatim/i);
      expect(SCHEMA_COMPONENTS[id].binding).toBeTruthy();
    }
  });
});

describe("🔴 WebSite is excluded, exactly as EA-11 excludes it", () => {
  it("does not judge a WebSite block", () => {
    // The sitelinks search-box pattern is a WebSite block with url +
    // potentialAction and no name — common AND correct. Judging it would fire
    // a finding across a large share of the healthy web.
    expect(EXCLUDED_TYPES).toContain("WebSite");
    expect(validateBlock({ "@type": "WebSite", url: "https://acme.com", potentialAction: {} })).toBeNull();
  });

  it("returns null for a type it does not judge, rather than a failing grade", () => {
    // "We do not check Recipe" and "your Recipe is broken" are different
    // statements and only one of them is true.
    expect(validateBlock({ "@type": "Recipe", name: "x" })).toBeNull();
  });
});

describe("validating a block", () => {
  it("accepts a complete identifying entity", () => {
    expect(validateBlock(org())).toMatchObject({ type: "Organization", valid: true, identifying: true });
  });

  it("names exactly which required properties are missing", () => {
    expect(validateBlock({ "@type": "Organization" })).toMatchObject({
      valid: false, missing: ["name", "url"],
    });
  });

  it("counts a language-tagged value as present", () => {
    // {"@value": "…"} is the correct way to write a localised name, and EA-11
    // already treats it as named.
    const r = validateBlock({ "@type": "Organization", name: { "@value": "Acme", "@language": "en" }, url: "https://acme.com" });
    expect(r.valid).toBe(true);
  });

  it("picks the approved type out of an array of types", () => {
    expect(validateBlock({ "@type": ["Thing", "Organization"], name: "A", url: "https://a.com" }).type)
      .toBe("Organization");
  });
});

describe("O — an identifying entity", () => {
  it("is null when there is no markup at all — absent is never zero", () => {
    const r = schemaScore({ jsonLd: [], microdata: [] });
    expect(r.components.find((c) => c.id === "entity_object").value).toBeNull();
  });

  it("🔴 is ZERO when markup exists but identifies nothing", () => {
    // A third state, not a worse version of absence: markup that cannot say
    // what it describes gets merged into the WRONG knowledge-graph entry,
    // which is the whole basis of EA-11's penalty multiplier.
    const r = schemaScore({ jsonLd: [{ "@type": "Article", headline: "Hi" }] });
    expect(r.components.find((c) => c.id === "entity_object").value).toBe(0);
  });

  it("is full when a valid identifying entity is present", () => {
    const r = schemaScore({ jsonLd: [org()] });
    expect(r.components.find((c) => c.id === "entity_object").value).toBe(100);
  });
});

describe("L — validity, where a parse failure outweighs a complete block", () => {
  it("a page with one valid block and one parse failure scores below one with neither", () => {
    const clean = schemaScore({ jsonLd: [org()] }).components.find((c) => c.id === "lint_validity").value;
    const broken = schemaScore({ jsonLd: [org()], parseFailures: 1 })
      .components.find((c) => c.id === "lint_validity").value;
    expect(broken).toBeLessThan(clean);
  });

  it("is null when there is nothing to lint", () => {
    expect(schemaScore({ jsonLd: [] }).components.find((c) => c.id === "lint_validity").value).toBeNull();
  });
});

describe("S — scoped to what the page could reasonably carry", () => {
  it("does not ask a pricing page for HowTo markup", () => {
    // Unscoped, this reports every healthy page as missing something, which
    // is true, useless, and teaches the reader to skip the section.
    expect(applicableTypes("pricing")).not.toContain("HowTo");
    expect(applicableTypes("guide")).toContain("HowTo");
  });

  it("always expects the identifying entity and breadcrumbs", () => {
    for (const t of ["homepage", "product", "article", null]) {
      expect(applicableTypes(t)).toEqual(expect.arrayContaining(["Organization", "BreadcrumbList"]));
    }
  });

  it("counts microdata towards spread, not only JSON-LD", () => {
    const withMicro = schemaScore({ jsonLd: [org()], microdata: [{ type: "BreadcrumbList", count: 1 }] });
    const without = schemaScore({ jsonLd: [org()] });
    const v = (r) => r.components.find((c) => c.id === "type_spread").value;
    expect(v(withMicro)).toBeGreaterThan(v(without));
  });
});

describe("🔴 F — the one score where MORE markup means a LOWER number", () => {
  it("a declared FAQPage with no visible questions scores zero, below having none", () => {
    // Machine-readable false statement. It is what gets rich results revoked,
    // and constructTemplates already refuses to generate one for this reason —
    // so rewarding its presence would recommend the defect we elsewhere report.
    const lying = scoreFidelity({ judged: [{ type: "FAQPage" }], visibleFaq: 0 });
    const silent = scoreFidelity({ judged: [], visibleFaq: null });
    expect(lying).toBe(0);
    expect(silent).toBeNull();
    expect(lying).toBeLessThan(60);
  });

  it("visible questions with NO markup is a miss, not a lie — and scores between", () => {
    const unmarked = scoreFidelity({ judged: [], visibleFaq: 6 });
    expect(unmarked).toBeGreaterThan(0);
    expect(unmarked).toBeLessThan(100);
  });

  it("declared and present scores full", () => {
    expect(scoreFidelity({ judged: [{ type: "FAQPage" }], visibleFaq: 6 })).toBe(100);
  });

  it("is null when there is nothing to compare", () => {
    // Declaring no FAQ on a page with no FAQ is not a fidelity problem.
    expect(scoreFidelity({ judged: [org()], visibleFaq: null, visibleSteps: null })).toBeNull();
  });
});

describe("G — do the blocks resolve to ONE entity", () => {
  it("is null when nothing identifying is present", () => {
    expect(scoreLinkage({ blocks: [], identifying: [] })).toBeNull();
  });

  it("an @id and a sameAs both raise linkage", () => {
    const bare = scoreLinkage({ blocks: [org()], identifying: [{ type: "Organization" }] });
    const linked = scoreLinkage({
      blocks: [org({ "@id": "https://acme.com/#org", sameAs: ["https://linkedin.com/company/acme"] })],
      identifying: [{ type: "Organization" }],
    });
    expect(linked).toBeGreaterThan(bare);
  });

  it("🔴 disagreeing with the canonical domain COSTS points", () => {
    // The canonical_domain bridge W9 established: spelled identically on both
    // sides, or the same company resolves twice.
    const agrees = scoreLinkage({
      blocks: [org({ "@id": "https://acme.com/#org" })],
      identifying: [{ type: "Organization" }], canonicalDomain: "acme.com",
    });
    const disagrees = scoreLinkage({
      blocks: [org({ "@id": "https://somethingelse.com/#org" })],
      identifying: [{ type: "Organization" }], canonicalDomain: "acme.com",
    });
    expect(disagrees).toBeLessThan(agrees);
  });

  it("ignores a leading www. on either side", () => {
    const r = scoreLinkage({
      blocks: [org({ "@id": "https://acme.com/#org" })],
      identifying: [{ type: "Organization" }], canonicalDomain: "www.acme.com",
    });
    expect(r).toBeGreaterThan(70);
  });
});

describe("the whole score", () => {
  it("redistributes unmeasured components rather than defaulting them", () => {
    const r = schemaScore({ jsonLd: [org()], pageType: "homepage" });
    expect(r.unmeasured).toContain("fidelity");
    expect(r.coverage).toBeLessThan(100);
    expect(r.score).toBeGreaterThan(0);
  });

  it("an empty page reports a MEASURED absence, not an unmeasurable", () => {
    // ⚠️ MY FIRST DRAFT OF THIS TEST ASSERTED `score === null` AND THE CODE WAS
    // RIGHT. "The page carries none of the types it should" is a measurement,
    // not a failure to measure — it is exactly what EA-01 reports. The three
    // components that genuinely could not be evaluated stay null and are
    // redistributed; `type_spread` is scored, because we looked and found none.
    const r = schemaScore({});
    expect(r.components.find((c) => c.id === "type_spread").value).toBe(0);
    expect(r.unmeasured).toEqual(expect.arrayContaining(["entity_object", "lint_validity", "graph_linkage"]));
    expect(r.score).toBe(0);
    // ...and coverage is low enough that `isThin` will stamp it, so the 0 is
    // never forwarded as a confident verdict on its own.
    expect(r.coverage).toBeLessThan(70);
  });
});

describe("gaps put a contradiction above an absence", () => {
  it("🔴 lists the FAQ contradiction first even though it weighs least", () => {
    // "Your FAQ markup describes questions that are not on the page" is a live
    // risk to something the site already has; "you have no HowTo" is an
    // opportunity. Sorting by weight alone would bury the first.
    const r = schemaScore({
      jsonLd: [{ "@type": "FAQPage", mainEntity: [{}] }, { "@type": "Organization" }],
      visibleFaq: 0, pageType: "faq",
    });
    const gaps = schemaGaps(r);
    expect(gaps[0].component).toBe("fidelity");
    expect(gaps[0].severity).toBe("contradiction");
  });

  it("a fidelity score that is merely imperfect is a gap, not a contradiction", () => {
    const r = schemaScore({ jsonLd: [org()], visibleFaq: 4, pageType: "homepage" });
    const f = schemaGaps(r).find((g) => g.component === "fidelity");
    expect(f.severity).toBe("gap");
  });

  it("never reports a component that scored full", () => {
    const r = schemaScore({ jsonLd: [org({ "@id": "https://acme.com/#o" })] });
    expect(schemaGaps(r).map((g) => g.component)).not.toContain("entity_object");
  });
});
